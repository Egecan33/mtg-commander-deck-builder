import type { Bracket } from '../types';

/**
 * Frank Karsten's coloured-source requirements for 99-card decks (docs/research/deck-theory.md §4.2).
 * Row = coloured pips of one colour, column = generic mana in the cost.
 */
const TABLE: Record<number, number[]> = {
  1: [19, 19, 18, 16, 15, 14],
  2: [30, 28, 26, 23, 22, 20],
  3: [36, 33, 30, 28, 26],
  4: [39, 36],
};

/**
 * Sources of one colour needed to cast a spell with `pips` pips of that colour and mana value `mv`
 * on curve. 0 pips → 0. Costs beyond the table use the nearest row/column.
 */
export function karstenSources(pips: number, mv: number): number {
  if (!(pips > 0)) return 0;
  const n = Math.max(1, Math.round(pips));
  const row = TABLE[Math.min(4, n)];
  const generic = Math.max(0, Math.round(Number.isFinite(mv) ? mv : n) - n);
  return row[Math.min(generic, row.length - 1)];
}

const BRACKET_DELTA = [0, 0, 1, 3, 4];
const BRACKET_FLOOR = [36, 36, 35, 31, 26];
const LAND_CAP = 42;

/**
 * Land target (deck-theory.md §4.1): Karsten's regression minus a per-bracket discount, clamped to
 * the bracket floor and a cap of 42. `cheapRampDraw` = ramp and draw cards with mana value ≤ 2.
 */
export function landTarget(avgMv: number, cheapRampDraw: number, bracket: Bracket): number {
  const i = Math.min(5, Math.max(1, Math.round(bracket))) - 1;
  const mv = Number.isFinite(avgMv) ? Math.max(0, avgMv) : 3;
  const cheap = Number.isFinite(cheapRampDraw) ? Math.max(0, cheapRampDraw) : 0;
  const raw = Math.round(31.42 + 3.13 * mv - 0.28 * cheap) - BRACKET_DELTA[i];
  return Math.min(LAND_CAP, Math.max(BRACKET_FLOOR[i], raw));
}
