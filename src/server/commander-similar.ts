import type { RecsQuery, SimilarResponse } from '@/app/lib/api';
import { budgetMax } from '@/app/lib/budget';
import type { AxisId, Card, Color } from '@/engine/types';
import { resolveThemeWeights } from '@/engine/summary';
import { ownedSet } from './collection';
import { commanderIndex, commanderShell, toCommanderTile } from './commander-index';
import { allowedIdentity } from '@/engine/rules';
import { getCardDb } from './store';

export const SIMILAR_LIMIT = 24;
export const ONE_OFF = 0.85;
export const MIN_AXIS = 0.1;

type Weights = Record<AxisId, number>;
const vector = (w: Weights): Map<AxisId, number> => {
  const m = new Map<AxisId, number>();
  for (const [axis, v] of Object.entries(w)) if (axis !== 'typal' && v >= MIN_AXIS) m.set(axis, v);
  return m;
};

/** Sum of the smaller over the sum of the larger of each theme weight, 0 to 1 (0 when both are empty). */
export function themeSimilarity(a: Weights, b: Weights): number {
  const x = vector(a);
  const y = vector(b);
  let lo = 0;
  let hi = 0;
  for (const axis of new Set([...x.keys(), ...y.keys()])) {
    const p = x.get(axis) ?? 0;
    const q = y.get(axis) ?? 0;
    lo += Math.min(p, q);
    hi += Math.max(p, q);
  }
  return hi === 0 ? 0 : Math.round((lo / hi) * 1000) / 1000;
}

const rankOf = (c: Card) => (typeof c.edhrecRank === 'number' && c.edhrecRank > 0 ? c.edhrecRank : Number.MAX_SAFE_INTEGER);
const byRankName = (a: Card, b: Card) => rankOf(a) - rankOf(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function rankSimilar(
  page: { ids: string[]; identity: Color[]; weights: Weights },
  candidates: readonly { card: Card; weights: Weights }[],
  limit: number,
  keep: (c: Card) => boolean = () => true,
): { basis: 'themes' | 'popularity'; ranked: { card: Card; similarity: number | null; colorsOff: 0 | 1 }[] } {
  const off = (c: Card): number => {
    const mine = new Set(page.identity);
    const theirs = new Set(c.colorIdentity);
    return [...mine].filter((x) => !theirs.has(x)).length + [...theirs].filter((x) => !mine.has(x)).length;
  };
  const pool = candidates.filter((c) => !page.ids.includes(c.card.oracleId) && keep(c.card)).map((c) => ({ ...c, colorsOff: off(c.card) })).filter((c) => c.colorsOff <= 1);
  if (vector(page.weights).size === 0) {
    const ranked = pool.filter((c) => c.colorsOff === 0).sort((a, b) => byRankName(a.card, b.card)).slice(0, limit);
    return { basis: 'popularity', ranked: ranked.map((c) => ({ card: c.card, similarity: null, colorsOff: 0 as const })) };
  }
  const ranked = pool
    .map((c) => ({ ...c, similarity: themeSimilarity(page.weights, c.weights) }))
    .map((c) => ({ ...c, rank: c.similarity * (c.colorsOff ? ONE_OFF : 1) }))
    .filter((c) => c.rank > 0)
    .sort((a, b) => b.rank - a.rank || byRankName(a.card, b.card))
    .slice(0, limit);
  return { basis: 'themes', ranked: ranked.map((c) => ({ card: c.card, similarity: c.similarity, colorsOff: c.colorsOff as 0 | 1 })) };
}

/** The owned and budget filters apply before the cut to `SIMILAR_LIMIT`, so a filtered view is not left empty by the top 24. */
export function similarCommanders(cards: Card[], q: Pick<RecsQuery, 'ownedOnly' | 'budget'> = { ownedOnly: false, budget: 'any' }): SimilarResponse {
  const db = getCardDb();
  const index = commanderIndex();
  const ids = cards.map((c) => c.oracleId);
  const weights =
    cards.length === 1
      ? (index.byId.get(ids[0])?.weights ?? {})
      : resolveThemeWeights(commanderShell(ids, 3), { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} });
  const identity = [...allowedIdentity(commanderShell(ids, 3), db)];
  const owned = ownedSet();
  const cap = budgetMax(q.budget);
  const keep = (c: Card) => (!q.ownedOnly || owned.has(c.oracleId)) && (cap === null || (typeof c.priceUsd === 'number' && c.priceUsd <= cap));
  const { basis, ranked } = rankSimilar({ ids, identity, weights }, index.entries, SIMILAR_LIMIT, keep);
  return { basis, commanders: ranked.map((r) => ({ ...toCommanderTile(r.card, owned), similarity: r.similarity, colorsOff: r.colorsOff })) };
}
