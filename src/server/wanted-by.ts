import type { WantedByResponse } from '@/app/lib/api';
import { createScorer } from '@/engine/scoring';
import { legalityViolation } from '@/engine/format';
import type { AxisId, Bracket, CardFeatures, Format } from '@/engine/types';
import { commanderIndex, commanderShell, toCommanderTile } from './commander-index';
import { ownedSet } from './collection';
import { engineContext } from './context';
import { HttpError } from './http';
import { getSettings } from './settings';
import { cacheSlot } from './state';
import { getCardDb } from './store';

export const WANTED_CANDIDATES = 40;
export const WANTED_SHOWN = 12;

/** How much a commander's theme weights call for a card: sum of weight times the card's strength on that axis. */
export function themeFit(weights: Record<AxisId, number>, f: CardFeatures | undefined): number {
  if (!f) return 0;
  let sum = 0;
  for (const [axis, a] of Object.entries(f.axes)) sum += (weights[axis] ?? 0) * Math.max(a.e, a.p);
  return sum;
}

const rankOf = (c: { edhrecRank: number | null }) => (typeof c.edhrecRank === 'number' && c.edhrecRank > 0 ? c.edhrecRank : Number.MAX_SAFE_INTEGER);

/** The commanders whose decks want a card most. Cached per card, bracket, format and EDHREC setting. */
export function commandersWanting(oracleId: string, bracket: Bracket, format: Format = 'commander'): WantedByResponse {
  const db = getCardDb(format);
  const card = db.get(oracleId);
  if (!card) throw new HttpError(404, 'Unknown card.');
  if (card.legality !== 'legal') return { oracleId, bracket, considered: 0, commanders: [], note: legalityViolation(card, db).message };
  const memo = cacheSlot('wanted-by', () => new Map<string, WantedByResponse>());
  const key = `${oracleId}|${bracket}|${format}|${getSettings().edhrecEnabled}`;
  const hit = memo.get(key);
  if (hit) return hit;

  const features = db.features(oracleId);
  const candidates = commanderIndex(format).entries
    .filter((e) => e.card.oracleId !== oracleId && card.colorIdentity.every((c) => e.card.colorIdentity.includes(c)))
    .map((e) => ({ e, fit: themeFit(e.weights, features) }))
    .sort((a, b) => b.fit - a.fit || rankOf(a.e.card) - rankOf(b.e.card) || (a.e.card.name < b.e.card.name ? -1 : 1))
    .slice(0, WANTED_CANDIDATES);
  const owned = ownedSet();
  const scored: { fit: number; rank: number; score: number; synergy: number; tile: ReturnType<typeof toCommanderTile> }[] = [];
  for (const { e, fit } of candidates) {
    const shell = commanderShell([e.card.oracleId], bracket, null, format);
    const s = createScorer(shell, engineContext(shell).ctx).score(card);
    if (s.gate) continue;
    const syn = s.parts.find((p) => p.key === 'synergy');
    scored.push({ fit, rank: rankOf(e.card), score: s.score, synergy: syn && syn.max > 0 ? Math.round((100 * syn.points) / syn.max) : 0, tile: toCommanderTile(e.card, owned, format) });
  }
  scored.sort((a, b) => b.score - a.score || b.fit - a.fit || a.rank - b.rank);
  const out: WantedByResponse = {
    oracleId, bracket, considered: candidates.length, note: null,
    commanders: scored.slice(0, WANTED_SHOWN).map((x) => ({ commander: x.tile, score: x.score, synergy: x.synergy })),
  };
  memo.set(key, out);
  return out;
}
