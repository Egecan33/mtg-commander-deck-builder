import type { Bracket, Card, CardFeatures, Color, Role } from '../types';

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
 * on curve. 0 pips → 0. Costs beyond the table use the nearest row/column. `deckSize` below 100
 * (Standard Brawl's 60) scales the 99-card table down.
 */
export function karstenSources(pips: number, mv: number, deckSize = 100): number {
  if (!(pips > 0)) return 0;
  const n0 = karstenSources99(pips, mv);
  return deckSize >= 100 ? n0 : Math.max(1, Math.round(n0 * SMALL_DECK_SOURCES));
}

/**
 * A 60-card deck needs about 0.73 of the 99-card sources (Karsten's 60-card table: 14 for one pip
 * on a one-drop against 19, 21 for two pips against 30).
 */
const SMALL_DECK_SOURCES = 0.73;

/** `extra` = columns past the card's own generic mana (a later turn, or X read as mana). */
function karstenSources99(pips: number, mv: number, extra = 0): number {
  const n = Math.max(1, Math.round(pips));
  const row = TABLE[Math.min(4, n)];
  const generic = Math.max(0, Math.round(Number.isFinite(mv) ? mv : n) - n) + extra;
  return row[Math.min(generic, row.length - 1)];
}

/**
 * Turns after its mana value allows that a Commander card is usually cast, unless it is an early
 * play. Karsten's column is turn − pips, so each turn of delay is one more column of his table.
 */
export const CAST_DELAY = 2;
/** Generic mana an {X} in the cost is read as. */
export const X_GENERIC = 2;
/**
 * Most of a deck's lands one colour can be asked to make, by the commander identity's colour count
 * (1 to 5): a mono-colour deck's lands can all make it, a three-colour deck's about 70%.
 */
export const COLOUR_LAND_SHARE: readonly number[] = [1, 0.85, 0.7, 0.6, 0.55];
/** Cheap cards of these roles have to come down on curve: ramp, and answers to what the table plays early. */
const EARLY_ROLES: readonly Role[] = ['ramp', 'spot-removal', 'counterspell'];
const EARLY_MAX_MV = 2;

export interface SourceNeed {
  /** Pips of this colour in the cost. */
  pips: number;
  /** Mana value (an X counts 0, as on the card). */
  mv: number;
  /** The cost holds {X}. */
  x?: boolean;
  /** Cast on curve: the commander, or a cheap ramp, removal or counter spell (`castsEarly`). */
  early?: boolean;
  /** The deck's effective land count, as a full deck. Not finite: no cap. */
  lands: number;
  /** Colours in the commander's identity (0 or unknown reads as 1, more than 5 as 5). */
  colours: number;
  /** 100, or 60 in Standard Brawl. */
  deckSize?: number;
}

/**
 * Sources of one colour a Commander deck needs for one card (deck-theory.md §4.2), shared by the
 * rating, the card scorer, the builder and Improve. Karsten's table, read for the turn the card is
 * usually cast: on curve for an early play, `CAST_DELAY` turns later for anything else, an {X} as
 * `X_GENERIC` more generic. Standard Brawl scales that by its 0.73. Never more than the deck's lands
 * can give one colour: `lands` × `COLOUR_LAND_SHARE` for its colour count, so a mono-colour deck is
 * never short while its lands make the colour; but never less than one source, however few lands
 * the deck has (a deck with none cannot cast its coloured cards). 0 pips → 0.
 */
export function sourcesNeeded(n: SourceNeed): number {
  if (!(n.pips > 0)) return 0;
  const extra = (n.early ? 0 : CAST_DELAY) + (n.x ? X_GENERIC : 0);
  const n0 = karstenSources99(n.pips, n.mv, extra);
  const table = (n.deckSize ?? 100) >= 100 ? n0 : Math.max(1, Math.round(n0 * SMALL_DECK_SOURCES));
  if (!Number.isFinite(n.lands)) return table;
  const colours = Number.isFinite(n.colours) ? Math.min(5, Math.max(1, Math.round(n.colours))) : 1;
  return Math.min(table, Math.max(1, n.lands * COLOUR_LAND_SHARE[colours - 1]));
}

/** True when the card has to be cast on curve: the commander, or ramp, removal or a counterspell of mana value ≤ 2. */
export function castsEarly(card: Pick<Card, 'cmc'>, f: Pick<CardFeatures, 'roles'>, commander: boolean): boolean {
  return commander || (card.cmc <= EARLY_MAX_MV && f.roles.some((r) => EARLY_ROLES.includes(r)));
}

const COLOUR_ORDER: readonly Color[] = ['W', 'U', 'B', 'R', 'G'];

/**
 * `sourcesNeeded` for each colour of one nonland card's cost, in WUBRG order (colours without pips
 * left out). `deck`: whether the card is its commander, the deck's effective land count as a full
 * deck, its identity's colour count and its size.
 */
export function cardSourceNeeds(
  card: Pick<Card, 'cmc' | 'manaCost'>, f: Pick<CardFeatures, 'pips' | 'roles'>,
  deck: { commander: boolean; lands: number; colours: number; deckSize?: number },
): [Color, number][] {
  const early = castsEarly(card, f, deck.commander);
  const x = /\{X\}/i.test(card.manaCost ?? '');
  const out: [Color, number][] = [];
  for (const c of COLOUR_ORDER) {
    const pips = f.pips[c];
    if (typeof pips !== 'number' || !(pips > 0)) continue;
    out.push([c, sourcesNeeded({ pips, mv: card.cmc, x, early, lands: deck.lands, colours: deck.colours, deckSize: deck.deckSize })]);
  }
  return out;
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
