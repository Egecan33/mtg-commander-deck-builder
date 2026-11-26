import { createHash } from 'node:crypto';
import type { CommanderRecsResponse, RecCard, RecSection, RecSectionId, RecTypeId, RecsQuery } from '@/app/lib/api';
import { budgetMax, type Budget } from '@/app/lib/filters';
import { isBasicLand } from '@/engine/rules';
import { AXIS_MEMBER } from '@/engine/summary';
import type { Card, CardFeatures, CardScore } from '@/engine/types';
import { cardLookup, poolIndex } from './cards';
import { ownedSet } from './collection';
import { getAnalysis } from './context';
import { commanderShell } from './commander-index';
import { freeOwnedSet, heldByFor } from './holders';
import { HttpError } from './http';
import { readBracket } from './discover';
import { newCardIds, newestSets } from './sets';
import { cacheSlot } from './state';
import { getCardDb } from './store';

export const MAX_SECTION_CARDS = 100;
const BUDGETS: readonly Budget[] = ['any', 'under-5', 'under-1'];
const MAX_MEMO = 12;

/** The recs query from a URL: bracket (default 3), budget, `owned=1`, and `free=1` only with `owned`. */
export function readRecsQuery(params: URLSearchParams): RecsQuery {
  const budget = params.get('budget') ?? 'any';
  if (!BUDGETS.includes(budget as Budget)) throw new HttpError(400, 'budget must be any, under-5 or under-1.');
  const ownedOnly = params.get('owned') === '1';
  return { bracket: readBracket(params.get('bracket') ?? 3), budget: budget as Budget, ownedOnly, freeOnly: ownedOnly && params.get('free') === '1' };
}

/** Cards the query counts as owned; null when it does not filter by collection. */
export function ownedFor(q: RecsQuery): Set<string> | null {
  if (!q.ownedOnly) return null;
  return q.freeOnly ? freeOwnedSet(new Set()) : ownedSet();
}

/** The type section a card belongs in. */
export function recTypeSection(card: Card, f: CardFeatures | undefined): RecTypeId {
  if (f && f.landWeight >= 1) {
    const utility = f.roles.some((r) => r !== 'land' && r !== 'ramp' && r !== 'fast-mana') || Object.values(f.axes).some((a) => Math.max(a.e, a.p) >= AXIS_MEMBER);
    return utility ? 'utility-lands' : 'lands';
  }
  const t = card.frontTypeLine;
  if (/\bCreature\b/.test(t)) return 'creatures';
  if (/\bPlaneswalker\b/.test(t)) return 'planeswalkers';
  if (/\bInstant\b/.test(t)) return 'instants';
  if (/\bSorcery\b/.test(t)) return 'sorceries';
  if (/\bArtifact\b/.test(t)) return f?.roles.some((r) => r === 'ramp' || r === 'fast-mana') ? 'mana-artifacts' : 'utility-artifacts';
  if (/\bEnchantment\b/.test(t)) return 'enchantments';
  return 'other';
}

const TYPE_ORDER: { id: RecTypeId; title: string }[] = [
  { id: 'creatures', title: 'Creatures' }, { id: 'instants', title: 'Instants' }, { id: 'sorceries', title: 'Sorceries' },
  { id: 'utility-artifacts', title: 'Utility artifacts' }, { id: 'mana-artifacts', title: 'Mana artifacts' },
  { id: 'enchantments', title: 'Enchantments' }, { id: 'planeswalkers', title: 'Planeswalkers' },
  { id: 'utility-lands', title: 'Utility lands' }, { id: 'lands', title: 'Lands' }, { id: 'other', title: 'Other cards' },
];

const share = (score: CardScore, key: 'synergy' | 'quality'): number => {
  const p = score.parts.find((x) => x.key === key);
  return p && p.max > 0 ? p.points / p.max : 0;
};

const edhrecIds = new WeakMap<object, number>();
let nextEdhrecId = 1;
const edhrecId = (data: object | null): number => {
  if (!data) return 0;
  let n = edhrecIds.get(data);
  if (!n) edhrecIds.set(data, (n = nextEdhrecId++));
  return n;
};

const nameOf = (cards: readonly Card[]): string => cards.map((c) => c.frontName).join(' and ');

/** Card recs for one or two commanders. Memoised per commanders, query and EDHREC data. */
export function commanderRecs(commanders: string[], q: RecsQuery): CommanderRecsResponse {
  const db = getCardDb();
  const ids = [...commanders].sort();
  const shell = commanderShell(commanders, q.bracket);
  const analysis = getAnalysis(shell);
  const owned = ownedFor(q);
  const free = q.freeOnly && owned ? createHash('sha1').update([...owned].sort().join(',')).digest('hex') : '';
  const key = JSON.stringify([ids, q, edhrecId(analysis.ctx.edhrec), free]);
  const memo = cacheSlot('commander-recs', () => new Map<string, CommanderRecsResponse>());
  const hit = memo.get(key);
  if (hit) {
    memo.delete(key);
    memo.set(key, hit);
    return hit;
  }

  const pool = analysis.pool();
  const { cards: all } = poolIndex(db);
  const pageIds = new Set(commanders);
  const cap = budgetMax(q.budget);
  const names = nameOf(commanders.map((id) => db.get(id)).filter((c): c is Card => c !== undefined));
  const rank = (c: Card) => (typeof c.edhrecRank === 'number' && c.edhrecRank > 0 ? c.edhrecRank : Number.MAX_SAFE_INTEGER);

  const P: { card: Card; score: CardScore; f: CardFeatures | undefined }[] = [];
  all.forEach((card, i) => {
    const score = pool.scores[i];
    if (score.gate || pageIds.has(card.oracleId) || isBasicLand(card)) return;
    if (cap !== null && !(typeof card.priceUsd === 'number' && card.priceUsd <= cap)) return;
    if (owned && !owned.has(card.oracleId)) return;
    P.push({ card, score, f: db.features(card.oracleId) });
  });
  const byDefault = (a: (typeof P)[number], b: (typeof P)[number]) =>
    b.score.score - a.score.score || rank(a.card) - rank(b.card) || (a.card.name < b.card.name ? -1 : a.card.name > b.card.name ? 1 : 0) || (a.card.oracleId < b.card.oracleId ? -1 : 1);
  P.sort(byDefault);
  const isLand = (x: (typeof P)[number]) => (x.f?.landWeight ?? 0) >= 1;

  const sets = newestSets();
  const fresh = newCardIds();
  const ownedAll = ownedSet();
  const emptyFor = (id: RecSectionId): string => {
    if (id === 'new' && fresh === null) return 'Set release dates are missing. Sync printings under Card data to see new cards.';
    if (q.ownedOnly) {
      return ownedAll.size === 0
        ? 'Your collection is empty. Add cards under Collection.'
        : `Nothing in your collection fits ${names} with these filters. Turn off Only my collection to see every card.`;
    }
    if (id === 'owned') return ownedAll.size === 0 ? 'Your collection is empty. Add cards under Collection.' : `None of your cards fits ${names} here.`;
    if (cap !== null) return `No card under $${cap} fits here. Choose Any price to see more.`;
    return `No card fits ${names} here.`;
  };

  const section = (id: RecSectionId, title: string, list: typeof P, note?: string, headline = false): RecSection | null => {
    if (list.length === 0 && !headline) return null;
    const out: RecSection = { id, title, total: list.length, cards: list.slice(0, MAX_SECTION_CARDS).map(toRec) };
    if (note) out.note = note;
    if (list.length === 0) out.empty = emptyFor(id);
    return out;
  };
  const edhrec = analysis.ctx.edhrec;
  const toRec = ({ card, score }: (typeof P)[number]): RecCard => {
    const rec: RecCard = { oracleId: card.oracleId, synergy: Math.round(100 * share(score, 'synergy')), quality: Math.round(100 * share(score, 'quality')) };
    const e = edhrec?.cards[card.oracleId];
    if (e) {
      const of = e.potentialDecks > 0 ? e.potentialDecks : edhrec?.commanderDecks ?? 0;
      rec.edhrec = { inclusion: of > 0 ? Math.round((100 * e.numDecks) / of) : 0, decks: e.numDecks, lift: e.lift };
    }
    return rec;
  };

  const nonland = P.filter((x) => !isLand(x));
  const sections: (RecSection | null)[] = [
    section('new', 'New cards', fresh ? P.filter((x) => fresh.has(x.card.oracleId)) : [], sets.length > 0 ? `From ${sets.map((s) => s.name).join(' and ')}` : undefined, true),
    section('synergy', 'High synergy', nonland.filter((x) => share(x.score, 'synergy') >= 0.5).sort((a, b) => share(b.score, 'synergy') - share(a.score, 'synergy') || byDefault(a, b)), undefined, true),
    section('top', 'Top cards', [...nonland].sort((a, b) => share(b.score, 'quality') - share(a.score, 'quality') || byDefault(a, b)), undefined, true),
    q.bracket >= 3 ? section('game-changers', 'Game Changers', P.filter((x) => x.card.gameChanger), undefined, true) : null,
    section('owned', 'In your collection', P.filter((x) => (owned ?? ownedAll).has(x.card.oracleId)), undefined, true),
  ];
  const byType = new Map<RecTypeId, typeof P>();
  for (const x of P) {
    const t = recTypeSection(x.card, x.f);
    byType.set(t, [...(byType.get(t) ?? []), x]);
  }
  for (const t of TYPE_ORDER) sections.push(section(t.id, t.title, byType.get(t.id) ?? []));

  const real = sections.filter((s): s is RecSection => s !== null);
  const listed = new Set<string>();
  for (const s of real) for (const c of s.cards) listed.add(c.oracleId);
  const scoreOf = new Map(P.map((x) => [x.card.oracleId, x.score]));
  const scores: Record<string, CardScore> = {};
  for (const id of listed) scores[id] = scoreOf.get(id) as CardScore;

  const response: CommanderRecsResponse = {
    commanders, query: q, edhrec: analysis.edhrec, sections: real, scores, cards: cardLookup(listed), heldBy: heldByFor(shell, listed),
  };
  memo.set(key, response);
  while (memo.size > MAX_MEMO) memo.delete(memo.keys().next().value as string);
  return response;
}
