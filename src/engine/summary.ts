import { commanderThemeWeights } from './features';
import { commanderCards, deckCounts } from './rules';
import type { AxisId, Card, CardDb, CardFeatures, Color, Deck, DeckSummary, EngineContext, Role } from './types';

export const ROLES: readonly Role[] = [
  'land', 'ramp', 'fast-mana', 'draw', 'tutor', 'spot-removal', 'counterspell', 'wipe', 'protection',
  'recursion', 'graveyard-hate', 'win-condition', 'stax', 'extra-turn', 'mass-land-denial', 'game-changer',
];
const SOURCE_KEYS: readonly (Color | 'C')[] = ['W', 'U', 'B', 'R', 'G', 'C'];
/** Roles that answer what an opponent does. */
export const INTERACTION_ROLES: readonly Role[] = ['spot-removal', 'counterspell', 'wipe'];
/** An axis strength from here up makes a card a member of that axis. */
export const AXIS_MEMBER = 0.5;

const finite = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
const round = (n: number, digits: number) => Math.round(n * 10 ** digits) / 10 ** digits;

export interface DeckCard { card: Card; features: CardFeatures; qty: number }

/**
 * The deck's known cards with features and quantities, commanders included. With `exclude`, one
 * copy of that card is left out. `unknown` counts copies of cards the database or the features
 * table does not have; they take deck slots but contribute nothing else.
 */
export function deckCards(deck: Deck, db: CardDb, exclude?: string): { cards: DeckCard[]; unknown: number } {
  const cards: DeckCard[] = [];
  let unknown = 0;
  for (const [oracleId, count] of deckCounts(deck)) {
    const qty = oracleId === exclude ? count - 1 : count;
    if (qty <= 0) continue;
    const card = db.get(oracleId);
    const features = card ? db.features(oracleId) : undefined;
    if (card && features) cards.push({ card, features, qty });
    else unknown += qty;
  }
  return { cards, unknown };
}

/** A real land (front face is a land). MDFC land-spells are spells with a partial land weight. */
export const isLandCard = (f: CardFeatures): boolean => f.landWeight >= 1;

/**
 * Counts everything the rating and the scorer need from a deck (spec §11). Commanders are part of
 * the deck; the companion is not. Never throws: unknown cards and junk quantities are skipped.
 */
export function summarizeDeck(deck: Deck, db: CardDb, exclude?: string): DeckSummary {
  const { cards, unknown } = deckCards(deck, db, exclude);
  const roleCounts = Object.fromEntries(ROLES.map((r) => [r, 0])) as Record<Role, number>;
  const sources = Object.fromEntries(SOURCE_KEYS.map((k) => [k, 0])) as Record<Color | 'C', number>;
  const curve = [0, 0, 0, 0, 0, 0, 0, 0];
  const axisTotals: Record<AxisId, { e: number; p: number }> = {};
  const gameChangers: string[] = [];
  let cardCount = unknown;
  let landCount = 0;
  let landsEffective = 0;
  let taplands = 0;
  let mvSum = 0;
  let nonland = 0;
  let interaction = 0;
  let instantInteraction = 0;

  for (const { card, features: f, qty } of cards) {
    cardCount += qty;
    const land = isLandCard(f);
    if (land) landCount += qty;
    landsEffective += finite(f.landWeight) * qty;
    taplands += finite(f.taplandWeight) * qty;
    for (const role of f.roles) {
      if (role === 'land') continue; // counted from landWeight so the two always agree
      if (role in roleCounts) roleCounts[role] += qty;
    }
    for (const k of SOURCE_KEYS) sources[k] += finite(f.sources[k]) * qty;
    if (!land) {
      const mv = Math.max(0, finite(card.cmc));
      mvSum += mv * qty;
      nonland += qty;
      curve[Math.min(7, Math.floor(mv))] += qty;
    }
    for (const [axis, s] of Object.entries(f.axes)) {
      const e = finite(s?.e) >= AXIS_MEMBER;
      const p = finite(s?.p) >= AXIS_MEMBER;
      if (!e && !p) continue;
      const total = (axisTotals[axis] ??= { e: 0, p: 0 });
      if (e) total.e += qty;
      if (p) total.p += qty;
    }
    if (card.gameChanger) gameChangers.push(card.oracleId);
    if (f.roles.some((r) => INTERACTION_ROLES.includes(r))) {
      interaction += qty;
      if (f.instantSpeed) instantInteraction += qty;
    }
  }
  roleCounts.land = landCount;
  for (const k of SOURCE_KEYS) sources[k] = round(sources[k], 2);

  return {
    cardCount, landCount,
    landsEffective: round(landsEffective, 2),
    roleCounts,
    avgMv: nonland > 0 ? round(mvSum / nonland, 3) : 0,
    curve, sources,
    taplands: round(taplands, 2),
    axisTotals, gameChangers, instantInteraction, interaction,
  };
}

/** Deck size (commanders included) from which a deck's own contents may name its theme. */
export const INFER_MIN_CARDS = 40;
/** Nonland main-deck cards that must share the axis. */
export const INFER_MIN_MEMBERS = 12;
/** ...and how many times the count a random pile of that size from the legal pool would show. */
export const INFER_MIN_LIFT = 2;
/** Strength that counts toward an inferred theme: above plain membership of a card type (0.5). */
export const INFER_STRENGTH = 0.6;
/** A command-zone weight from here up is a named theme; below it the deck's contents may name one. */
export const NAMED_THEME_WEIGHT = 0.5;
/** Weight of the any-type typal axis next to a named creature type (same share as the commander path). */
const ANY_TYPE_SHARE = 0.8;

export interface ResolvedTheme {
  weights: Record<AxisId, number>;
  /** 'user' = the deck's own sliders, 'commander' = read off the command zone, 'deck' = inferred from the 99. */
  source: 'user' | 'commander' | 'deck';
  /** The axis inferred from the deck's contents, when `source` is 'deck'. */
  inferred: AxisId | null;
}

const axisStrength = (a: { e: number; p: number } | undefined): number => Math.max(finite(a?.e), finite(a?.p));

const poolShares = new WeakMap<CardDb, { all: readonly Card[]; shares: Map<AxisId, number> }>();
/** Share of the legal nonland pool with strength ≥ INFER_STRENGTH per axis, cached per database. */
function axisPoolShares(db: CardDb): Map<AxisId, number> {
  const all = db.all();
  const hit = poolShares.get(db);
  if (hit && hit.all === all) return hit.shares;
  const counts = new Map<AxisId, number>();
  let n = 0;
  for (const card of all) {
    const f = db.features(card.oracleId);
    if (!f || isLandCard(f)) continue;
    n++;
    for (const axis in f.axes) if (axisStrength(f.axes[axis]) >= INFER_STRENGTH) counts.set(axis, (counts.get(axis) ?? 0) + 1);
  }
  const shares = new Map<AxisId, number>();
  for (const [axis, c] of counts) shares.set(axis, c / Math.max(1, n));
  poolShares.set(db, { all, shares });
  return shares;
}

/**
 * The theme a deck's own cards name, or null (see `resolveTheme` for the rule). Only the nonland
 * main deck is read, so the answer does not depend on who sits in the command zone.
 */
export function inferDeckTheme(deck: Deck, db: CardDb): AxisId | null {
  const commanders = new Set(deck.commanders);
  const counts = new Map<AxisId, number>();
  let size = 0;
  let nonland = 0;
  for (const { card, features, qty } of deckCards(deck, db).cards) {
    size += qty;
    if (commanders.has(card.oracleId) || isLandCard(features)) continue;
    nonland += qty;
    for (const axis in features.axes) {
      if (axis === 'typal') continue; // the any-type bucket follows a named type, it never leads
      if (axisStrength(features.axes[axis]) >= INFER_STRENGTH) counts.set(axis, (counts.get(axis) ?? 0) + qty);
    }
  }
  if (size < INFER_MIN_CARDS) return null;
  const shares = axisPoolShares(db);
  let best: AxisId | null = null;
  let bestExcess = 0;
  for (const [axis, count] of counts) {
    if (count < INFER_MIN_MEMBERS) continue;
    const expected = (shares.get(axis) ?? 0) * nonland;
    if (count < INFER_MIN_LIFT * expected) continue;
    const excess = count - expected;
    if (excess > bestExcess || (excess === bestExcess && best !== null && axis < best)) { best = axis; bestExcess = excess; }
  }
  return best;
}

/**
 * The one theme resolution the scorer, the rating and the builder share.
 *
 * 1. Weights the user set on the deck win outright.
 * 2. Otherwise the command zone is read (`commanderThemeWeights`, with EDHREC themes when given).
 * 3. When that names no theme (no axis at 0.5 or more) and the deck holds at least 40 cards, the
 *    deck names its own: the axis on which at least 12 nonland main-deck cards have strength 0.6
 *    or more (doing the theme's work, or being a creature of one type; merely being an artifact or
 *    an instant does not count), provided that is at least twice what a random pile of the same
 *    size from the legal pool would show. The axis furthest above that expectation wins and is
 *    added at weight 1; a creature type also brings the any-type typal axis at 0.8.
 */
export function resolveTheme(deck: Deck, ctx: EngineContext): ResolvedTheme {
  if (deck.themeWeights) return { weights: deck.themeWeights, source: 'user', inferred: null };
  const weights = commanderThemeWeights(commanderCards(deck, ctx.db), ctx.edhrec?.themes);
  if (Object.values(weights).some((w) => finite(w) >= NAMED_THEME_WEIGHT)) return { weights, source: 'commander', inferred: null };
  const inferred = inferDeckTheme(deck, ctx.db);
  if (!inferred) return { weights, source: 'commander', inferred: null };
  const out = { ...weights, [inferred]: 1 };
  if (inferred.startsWith('typal:')) out.typal = Math.max(finite(out.typal), ANY_TYPE_SHARE);
  return { weights: out, source: 'deck', inferred };
}

/** The deck's theme weights (see `resolveTheme`). */
export function resolveThemeWeights(deck: Deck, ctx: EngineContext): Record<AxisId, number> {
  return resolveTheme(deck, ctx).weights;
}
