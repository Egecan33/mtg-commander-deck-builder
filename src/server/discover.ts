import { createHash } from 'node:crypto';
import type { DiscoverEntry, DiscoverState, DiscoverTier, DiscoverTiersResponse } from '@/app/lib/api';
import { buyTiers, discoverCandidates, eagerTiers, preScore, type TierDeck } from '@/engine/builder';
import type { Bracket, Card, EngineContext } from '@/engine/types';
import { cardLookup, toClientCard } from './cards';
import { ownedSet } from './collection';
import { HttpError } from './http';
import { getSettings } from './settings';
import { getCardDb } from './store';

/** Owned commanders that get a full build; above this the pre-score picks. */
export const DISCOVER_MAX = 40;
const LAZY_CAPS = [5, 10, 15, 20];
const KEPT = 6;

interface Job { key: string; state: DiscoverState; started: number; lazy: Map<string, DiscoverTier[]> }

// On globalThis, like the rest of the server state, but not dropped with the caches: a result is
// keyed by the collection and stays valid until the collection changes.
const KEY = '__commanderForgeDiscover';
const holder = globalThis as unknown as Record<string, Map<string, Job> | undefined>;
const jobs = (): Map<string, Job> => (holder[KEY] ??= new Map());

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

function keyOf(bracket: Bracket): string {
  const ids = [...ownedSet()].sort();
  return createHash('sha1').update(JSON.stringify([bracket, ids, getCardDb().all().length])).digest('hex');
}

function context(): EngineContext {
  const s = getSettings();
  return { db: getCardDb(), edhrec: null, mldOverrides: s.mldOverrides, extraTurnOverrides: s.extraTurnOverrides };
}

function toTier(t: TierDeck, ctx: EngineContext): DiscoverTier {
  let price = 0;
  let unpriced = 0;
  for (const id of t.buys) {
    const p = ctx.db.get(id)?.priceUsd;
    if (typeof p === 'number') price += p;
    else unpriced++;
  }
  return { cap: t.cap, rating: t.rating, buys: t.buys, price: Math.round(price * 100) / 100, unpriced, deck: t.deck };
}

const blank = (bracket: Bracket, status: DiscoverState['status']): DiscoverState => ({
  status, bracket, stage: '', done: 0, total: 0, considered: 0, built: 0, entries: [], cards: {}, error: null, ms: 0,
});

const withCards = (job: Job): DiscoverState => {
  const s = job.state;
  const ids = s.entries.flatMap((e) => [e.commander.oracleId, ...e.tiers.flatMap((t) => t.buys)]);
  return { ...s, ms: s.status === 'running' ? Date.now() - job.started : s.ms, cards: cardLookup(ids) };
};

async function run(job: Job, bracket: Bracket): Promise<void> {
  const s = job.state;
  try {
    const ctx = context();
    const owned = ownedSet();
    const ownedCards = [...owned].map((id) => ctx.db.get(id)).filter((c): c is Card => !!c && c.legality === 'legal');
    const candidates = discoverCandidates(ctx.db, owned, true);
    s.considered = candidates.length;

    let ranked = candidates.map((c) => ({ c, pre: 0 }));
    if (candidates.length > 0) {
      s.stage = 'Scoring your commanders';
      s.total = candidates.length;
      for (const r of ranked) {
        r.pre = preScore(r.c, ownedCards, ctx, bracket);
        s.done++;
        if (s.done % 4 === 0) await tick();
      }
      ranked.sort((a, b) => b.pre - a.pre || (a.c.oracleId < b.c.oracleId ? -1 : 1));
      ranked = ranked.slice(0, DISCOVER_MAX);
    }

    s.stage = 'Building decks';
    s.done = 0;
    s.total = ranked.length;
    s.built = ranked.length;
    for (const r of ranked) {
      await tick();
      const t = eagerTiers(r.c.oracleId, ctx, owned, bracket);
      const entry: DiscoverEntry = { commander: toClientCard(r.c, ctx.db, owned), preScore: Math.round(r.pre), tiers: [toTier(t.owned, ctx), toTier(t.unlimited, ctx)] };
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

export function readBracket(value: unknown): Bracket {
  const n = Number(value);
  if (![1, 2, 3, 4, 5].includes(n)) throw new HttpError(400, 'bracket must be 1 to 5.');
  return n as Bracket;
}

/** GET /api/discover: the job for this collection and bracket, if there is one. */
export function discoverState(bracket: Bracket): DiscoverState {
  if (ownedSet().size === 0) return blank(bracket, 'empty');
  const job = jobs().get(keyOf(bracket));
  return job ? withCards(job) : blank(bracket, 'idle');
}

/** POST /api/discover: starts the job unless a result (or a running job) for the same collection and bracket exists. */
export function startDiscover(bracket: Bracket): DiscoverState {
  if (ownedSet().size === 0) return blank(bracket, 'empty');
  const all = jobs();
  const key = keyOf(bracket);
  const hit = all.get(key);
  if (hit && hit.state.status !== 'error') return withCards(hit);
  const job: Job = { key, state: blank(bracket, 'running'), started: Date.now(), lazy: new Map() };
  all.delete(key);
  all.set(key, job);
  for (const [k, j] of all) {
    if (all.size <= KEPT) break;
    if (j.state.status !== 'running') all.delete(k);
  }
  void run(job, bracket);
  return withCards(job);
}

/** POST /api/discover/tiers: the 5/10/15/20-buy tiers of one listed commander. */
export function discoverTiers(bracket: Bracket, commander: unknown): DiscoverTiersResponse {
  const job = jobs().get(keyOf(bracket));
  const entry = typeof commander === 'string' ? job?.state.entries.find((e) => e.commander.oracleId === commander) : undefined;
  if (!job || !entry) throw new HttpError(404, 'That commander is not in the result for this bracket. Run the search again.');
  let tiers = job.lazy.get(entry.commander.oracleId);
  if (!tiers) {
    const ctx = context();
    tiers = buyTiers(entry.tiers[0].deck, ctx, ownedSet(), LAZY_CAPS).map((t) => toTier(t, ctx));
    job.lazy.set(entry.commander.oracleId, tiers);
  }
  return { tiers, cards: cardLookup(tiers.flatMap((t) => t.buys)) };
}
