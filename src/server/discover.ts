import { createHash } from 'node:crypto';
import type { DiscoverEntry, DiscoverScope, DiscoverState, DiscoverTier, DiscoverTiersResponse } from '@/app/lib/api';
import { buyTiers, discoverCandidates, eagerTiers, preScore, quickFit, wildcardTiers, type TierDeck } from '@/engine/builder';
import { isBrawlFormat, isLegalIn } from '@/engine/format';
import type { Bracket, Card, EngineContext, Format } from '@/engine/types';
import { cardLookup, toClientCard } from './cards';
import { activeCollectionId, activeFormat, ownedSet } from './collection';
import { freeOwnedSet } from './holders';
import { HttpError } from './http';
import { getSettings } from './settings';
import { peekEdhrec } from './edhrec';
import { getCardDb, getDb } from './store';
import { getWildcards } from './wildcards';

/** Owned commanders that get a full build; above this the pre-score picks. */
export const DISCOVER_MAX = 40;
/** Commanders that are not owned: a cheap first look ranks them all, the real scoring sees this many, and this many get a deck. */
export const UNOWNED_SHORTLIST = 40;
export const UNOWNED_MAX = 20;
const LAZY_CAPS = [5, 10, 15, 20];
const KEPT = 6;

interface Job { key: string; stamp: string; state: DiscoverState; started: number; lazy: Map<string, DiscoverTier[]> }

// On globalThis, like the rest of the server state, but not dropped with the caches: a result is
// keyed by bracket, scope, `freeOnly` and the set of cards it searches (the owned cards, or with
// `freeOnly` the owned cards with a free copy), so it stays valid until that set changes.
const KEY = '__commanderForgeDiscover';
const holder = globalThis as unknown as Record<string, Map<string, Job> | undefined>;
const jobs = (): Map<string, Job> => (holder[KEY] ??= new Map());

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

/** The owned cards a search uses: with `freeOnly`, only cards with a copy no box or built deck holds. */
const ownedFor = (freeOnly: boolean): Set<string> => (freeOnly ? freeOwnedSet(new Set()) : ownedSet());

/** Which EDHREC pages are cached (and how fresh), read from the small columns only: a finished result built from other data is stale. A running job is found without it. */
function edhrecStamp(): string {
  if (!getSettings().edhrecEnabled) return 'off';
  const rows = getDb().prepare("SELECT key, fetched_at FROM edhrec_cache ORDER BY key").all() as { key: string; fetched_at: string }[];
  return createHash('sha1').update(JSON.stringify(rows)).digest('hex').slice(0, 12);
}

/**
 * The format the search builds in: MTG Arena's Brawl while an Arena collection is active (Arena
 * cards only, planeswalkers may lead, the wildcards as the budget), else Commander.
 */
const searchFormat = (arena?: unknown): Format => activeFormat(arena);

function keyOf(bracket: Bracket, scope: DiscoverScope, freeOnly: boolean, format: Format): string {
  const ids = [...ownedFor(freeOnly)].sort();
  // A Brawl result also depends on the wildcards it was built within.
  const budget = isBrawlFormat(format) ? getWildcards(activeCollectionId()).wildcards : null;
  return createHash('sha1').update(JSON.stringify([bracket, scope, freeOnly, ids, getCardDb(format).all().length, format, budget])).digest('hex');
}

/**
 * The engine context for one commander: the cached EDHREC data the deck page would use for a deck
 * with this commander at this bracket (`engineContext`), else none. Cache only, never a request.
 */
function context(commander: string, bracket: Bracket, format: Format): EngineContext {
  const s = getSettings();
  // EDHREC has no Standard Brawl data.
  const { data } = format === 'standardbrawl' ? { data: null } : peekEdhrec([commander], bracket);
  return { db: getCardDb(format), edhrec: data, mldOverrides: s.mldOverrides, extraTurnOverrides: s.extraTurnOverrides };
}

function toTier(t: TierDeck, ctx: EngineContext): DiscoverTier {
  let price = 0;
  let unpriced = 0;
  for (const id of t.buys) {
    const p = ctx.db.get(id)?.priceUsd;
    if (typeof p === 'number') price += p;
    else unpriced++;
  }
  const tier: DiscoverTier = { cap: t.cap, rating: t.rating, buys: t.buys, price: Math.round(price * 100) / 100, unpriced, deck: t.deck };
  if (t.kind) tier.kind = t.kind;
  if (t.wildcards) tier.wildcards = t.wildcards;
  return tier;
}

const blank = (bracket: Bracket, scope: DiscoverScope, freeOnly: boolean, status: DiscoverState['status']): DiscoverState => ({
  status, bracket, scope, freeOnly, stage: '', done: 0, total: 0, considered: 0, built: 0, entries: [], cards: {}, error: null, ms: 0,
});

const withCards = (job: Job): DiscoverState => {
  const s = job.state;
  const ids = s.entries.flatMap((e) => [e.commander.oracleId, ...e.tiers.flatMap((t) => t.buys)]);
  return { ...s, ms: s.status === 'running' ? Date.now() - job.started : s.ms, cards: cardLookup(ids) };
};

async function run(job: Job, bracket: Bracket, scope: DiscoverScope, freeOnly: boolean, format: Format): Promise<void> {
  const s = job.state;
  try {
    const db = getCardDb(format);
    const owned = ownedFor(freeOnly);
    const wildcards = isBrawlFormat(format) ? getWildcards(activeCollectionId()).wildcards : null;
    const ownedCards = [...owned].map((id) => db.get(id)).filter((c): c is Card => !!c && isLegalIn(c, db));
    // 'unowned': every commander the collection does not hold, ranked by what the owned cards build around it.
    const candidates = scope === 'owned' ? discoverCandidates(db, owned, true) : discoverCandidates(db, owned, false).filter((c) => !owned.has(c.oracleId));
    s.considered = candidates.length;

    let ranked = candidates.map((c) => ({ c, pre: 0 }));
    if (scope === 'unowned' && ranked.length > UNOWNED_SHORTLIST) {
      // Thousands of commanders: the real pre-score (about a second each on the full pool) is only for the best few.
      const quick = ranked.map((r) => ({ ...r, fit: quickFit(r.c, ownedCards, db) }));
      quick.sort((a, b) => b.fit - a.fit || (a.c.edhrecRank ?? 1e9) - (b.c.edhrecRank ?? 1e9) || (a.c.oracleId < b.c.oracleId ? -1 : 1));
      ranked = quick.slice(0, UNOWNED_SHORTLIST);
      await tick();
    }
    if (ranked.length > 0) {
      s.stage = scope === 'owned' ? 'Scoring your commanders' : 'Scoring commanders you do not own';
      s.total = ranked.length;
      for (const r of ranked) {
        r.pre = preScore(r.c, ownedCards, context(r.c.oracleId, bracket, format), bracket);
        s.done++;
        if (s.done % 4 === 0) await tick();
      }
      ranked.sort((a, b) => b.pre - a.pre || (a.c.oracleId < b.c.oracleId ? -1 : 1));
      ranked = ranked.slice(0, scope === 'owned' ? DISCOVER_MAX : UNOWNED_MAX);
    }

    s.stage = 'Building decks';
    s.done = 0;
    s.total = ranked.length;
    s.built = ranked.length;
    for (const r of ranked) {
      await tick();
      const ctx = context(r.c.oracleId, bracket, format);
      // On Arena: owned only, within the wildcards, and the whole Arena pool; else owned only and unlimited.
      const tiers = wildcards
        ? (({ owned: o, crafted, unlimited }) => [o, crafted, unlimited])(wildcardTiers(r.c.oracleId, ctx, owned, bracket, wildcards))
        : (({ owned: o, unlimited }) => [o, unlimited])(eagerTiers(r.c.oracleId, ctx, owned, bracket));
      // The green dot means owned at all, as everywhere else; `owned` may leave held copies out.
      const entry: DiscoverEntry = { commander: toClientCard(r.c, ctx.db, ownedSet()), preScore: Math.round(r.pre), basis: ctx.edhrec ? 'edhrec' : 'text', tiers: tiers.map((t) => toTier(t, ctx)) };
      s.entries = [...s.entries, entry].sort((a, b) => b.tiers[0].rating - a.tiers[0].rating || b.preScore - a.preScore);
      s.done++;
    }
    s.status = 'done';
    s.stage = '';
  } catch (err) {
    console.error(err);
    s.status = 'error';
    s.error = err instanceof Error ? err.message : String(err);
  }
  s.ms = Date.now() - job.started;
}

export function readScope(value: unknown): DiscoverScope {
  if (value === undefined || value === null || value === '') return 'owned';
  if (value !== 'owned' && value !== 'unowned') throw new HttpError(400, "scope must be 'owned' or 'unowned'.");
  return value;
}

export function readBracket(value: unknown): Bracket {
  const n = Number(value);
  if (![1, 2, 3, 4, 5].includes(n)) throw new HttpError(400, 'bracket must be 1 to 5.');
  return n as Bracket;
}

/** `freeOnly` from a JSON body (true) or a query string ("1" or "true"). */
export function readFreeOnly(value: unknown): boolean {
  return value === true || value === '1' || value === 'true';
}

/** GET /api/discover: the job for this collection, bracket, scope and freeOnly, if there is one. */
export function discoverState(bracket: Bracket, scope: DiscoverScope = 'owned', freeOnly = false, arena?: unknown): DiscoverState {
  if (ownedSet().size === 0) return blank(bracket, scope, freeOnly, 'empty');
  const job = jobs().get(keyOf(bracket, scope, freeOnly, searchFormat(arena)));
  return job && (job.state.status === 'running' || job.stamp === edhrecStamp()) ? withCards(job) : blank(bracket, scope, freeOnly, 'idle');
}

/** POST /api/discover: starts the job unless a result (or a running job) for the same collection, bracket, scope and freeOnly exists. */
export function startDiscover(bracket: Bracket, scope: DiscoverScope = 'owned', freeOnly = false, arena?: unknown): DiscoverState {
  if (ownedSet().size === 0) return blank(bracket, scope, freeOnly, 'empty');
  const all = jobs();
  const format = searchFormat(arena);
  const key = keyOf(bracket, scope, freeOnly, format);
  const hit = all.get(key);
  const stamp = edhrecStamp();
  if (hit && (hit.state.status === 'running' || (hit.state.status !== 'error' && hit.stamp === stamp))) return withCards(hit);
  const job: Job = { key, stamp, state: blank(bracket, scope, freeOnly, 'running'), started: Date.now(), lazy: new Map() };
  all.delete(key);
  all.set(key, job);
  for (const [k, j] of all) {
    if (all.size <= KEPT) break;
    if (j.state.status !== 'running') all.delete(k);
  }
  void run(job, bracket, scope, freeOnly, format);
  return withCards(job);
}

/** POST /api/discover/tiers: the 5/10/15/20-buy tiers of one listed commander. */
export function discoverTiers(bracket: Bracket, commander: unknown, scope: DiscoverScope = 'owned', freeOnly = false, arena?: unknown): DiscoverTiersResponse {
  const format = searchFormat(arena);
  const job = jobs().get(keyOf(bracket, scope, freeOnly, format));
  const entry = typeof commander === 'string' ? job?.state.entries.find((e) => e.commander.oracleId === commander) : undefined;
  if (!job || !entry) throw new HttpError(404, 'That commander is not in the result for this bracket. Run the search again.');
  // On Arena the wildcard tiers come with the result; there are no buy-count tiers.
  if (isBrawlFormat(format)) return { tiers: [], cards: {} };
  let tiers = job.lazy.get(entry.commander.oracleId);
  if (!tiers) {
    const ctx = context(entry.commander.oracleId, bracket, format);
    tiers = buyTiers(entry.tiers[0].deck, ctx, ownedFor(freeOnly), LAZY_CAPS).map((t) => toTier(t, ctx));
    job.lazy.set(entry.commander.oracleId, tiers);
  }
  return { tiers, cards: cardLookup(tiers.flatMap((t) => t.buys)) };
}
