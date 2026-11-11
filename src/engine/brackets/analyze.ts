import { deckCounts } from '../rules';
import { deckCards, isLandCard, type DeckCard } from '../summary';
import type { Bracket, BracketReport, Card, CardDb, Combo, Deck, EngineContext, FoundCombo, Role, Violation } from '../types';
import { findCombos, isEarly, isRelevant, isTwoCard } from './combos';

/** Combos named one by one in reasons; the rest are folded into one line. */
const MAX_COMBO_REASONS = 5;
/** Extra-turn cards from which chaining is likely (brackets.md §9 row 3 heuristic). */
const CHAINING_EXTRA_TURNS = 3;
const GC_LIMIT_B3 = 3;

/** A role flag with the user's per-card override on top (true adds the flag, false removes it). */
function flagged(oracleId: string, roles: readonly Role[] | undefined, role: Role, overrides: Record<string, boolean> | undefined): boolean {
  const o = overrides?.[oracleId];
  return typeof o === 'boolean' ? o : (roles?.includes(role) ?? false);
}
const isMld = (oracleId: string, roles: readonly Role[] | undefined, ctx: EngineContext) =>
  flagged(oracleId, roles, 'mass-land-denial', ctx.mldOverrides);
const isExtraTurn = (oracleId: string, roles: readonly Role[] | undefined, ctx: EngineContext) =>
  flagged(oracleId, roles, 'extra-turn', ctx.extraTurnOverrides);

const names = (ids: string[], db: CardDb) => ids.map((id) => db.get(id)?.name ?? 'unknown card').join(', ');
const comboIds = (c: Combo) => c.cards.map((x) => x.oracleId);
const comboText = (c: Combo, db: CardDb) => {
  const result = c.produces.slice(0, 2).join(', ');
  return `${comboIds(c).map((id) => db.get(id)?.name ?? 'unknown card').join(' + ')}${result ? ` (${result})` : ''}`;
};

interface PowerEstimate { score: number; parts: Record<string, number> }

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/**
 * Soft 0-100 power estimate behind "plays like Bracket X" (spec §9): fast mana, tutors, Game
 * Changers, free interaction, combo speed, average mana value and mean card power tier. Never a
 * rule. Constants are calibrated on the three fixture decks (precon 2, upgraded 3, cEDH 5) and on
 * auto-builds for 30 commanders (Brackets 1-2 read 2, Bracket 3 reads 3, 4 reads 4, 5 reads 5).
 */
export function powerEstimate(cards: DeckCard[], combos: FoundCombo[]): PowerEstimate {
  let fast = 0, tutors = 0, gameChangers = 0, free = 0, tierSum = 0, spells = 0, mvSum = 0;
  for (const { card, features: f, qty } of cards) {
    if (card.gameChanger) gameChangers += qty;
    if (isLandCard(f)) continue;
    spells += qty;
    mvSum += Math.max(0, card.cmc || 0) * qty;
    tierSum += f.powerTier * qty;
    if (f.roles.includes('fast-mana')) fast += qty;
    else if (f.powerTier === 5 && f.roles.some((r) => r === 'counterspell' || r === 'spot-removal' || r === 'protection')) free += qty;
    if (f.roles.includes('tutor')) tutors += qty;
  }
  if (spells === 0) return { score: 0, parts: {} };
  const relevant = combos.filter((c) => c.relevant);
  const combo = relevant.some((c) => c.twoCard && c.early) ? 1
    : relevant.some((c) => c.twoCard) ? 0.75
      : relevant.some((c) => c.early) ? 0.6
        // Slow combos of three or more cards turn up in any synergy deck, precons included: a nudge, not a signal.
        : relevant.length > 0 ? 0.25 : 0;
  const parts = {
    fastMana: 14 * clamp01(fast / 6),
    tutors: 9 * clamp01(tutors / 8),
    gameChangers: 12 * clamp01(gameChangers / 6),
    freeInteraction: 7 * clamp01(free / 4),
    combo: 12 * combo,
    avgMv: 16 * clamp01((4.6 - mvSum / spells) / 2.6),
    cardPower: 30 * clamp01((tierSum / spells - 1.3) / 1.7),
  };
  const score = Object.values(parts).reduce((a, b) => a + b, 0);
  return { score: Math.round(clamp01(score / 100) * 100), parts };
}

const playsLikeOf = (score: number): Bracket => (score >= 80 ? 5 : score >= 60 ? 4 : score >= 40 ? 3 : score >= 20 ? 2 : 1);

/**
 * Minimum bracket by the hard rules, with reasons, plus what the chosen target forbids
 * (spec §9, brackets.md §3 and §9). Never throws; unknown cards are skipped.
 */
export function analyzeBracket(deck: Deck, ctx: EngineContext): BracketReport {
  const { db } = ctx;
  const target = Math.min(5, Math.max(1, Math.round(Number(deck.targetBracket) || 3)));
  const { cards, unknown } = deckCards(deck, db);
  const combos = findCombos(deck, db);
  const reasons: BracketReport['reasons'] = [];
  const warnings: string[] = [];
  const violations: Violation[] = [];

  const gcs: string[] = [];
  const mld: string[] = [];
  const extraTurns: string[] = [];
  let extraTurnCopies = 0;
  for (const { card, features, qty } of cards) {
    if (card.gameChanger) gcs.push(card.oracleId);
    if (isMld(card.oracleId, features.roles, ctx)) mld.push(card.oracleId);
    if (isExtraTurn(card.oracleId, features.roles, ctx)) { extraTurns.push(card.oracleId); extraTurnCopies += qty; }
  }

  if (gcs.length > 0) {
    const floor = gcs.length > GC_LIMIT_B3 ? 4 : 3;
    const count = `${gcs.length} Game Changer${gcs.length === 1 ? '' : 's'}`;
    reasons.push({
      text: `${count} (${names(gcs, db)}): ${floor === 4 ? 'more than three puts the deck in Bracket 4' : 'Bracket 3 allows up to three, Brackets 1-2 none'}.`,
      oracleIds: gcs, floor,
    });
    if (target <= 2) {
      violations.push({ code: 'game-changer', message: `Bracket ${target} allows no Game Changers: ${names(gcs, db)}.`, oracleIds: gcs });
    } else if (target === 3 && gcs.length > GC_LIMIT_B3) {
      violations.push({ code: 'game-changer-limit', message: `Bracket 3 allows up to three Game Changers; this deck has ${gcs.length}: ${names(gcs, db)}.`, oracleIds: gcs });
    }
  }

  if (mld.length > 0) {
    reasons.push({ text: `Mass land denial (${names(mld, db)}) is only expected in Bracket 4 and up.`, oracleIds: mld, floor: 4 });
    if (target <= 3) {
      violations.push({ code: 'mass-land-denial', message: `Bracket ${target} allows no mass land denial: ${names(mld, db)}.`, oracleIds: mld });
    }
  }

  if (extraTurns.length > 0) {
    reasons.push({ text: `Extra-turn card${extraTurns.length === 1 ? '' : 's'} (${names(extraTurns, db)}): not allowed in Bracket 1.`, oracleIds: extraTurns, floor: 2 });
    if (extraTurnCopies >= CHAINING_EXTRA_TURNS) {
      warnings.push(`${extraTurnCopies} extra-turn cards: chaining likely, plays like 4.`);
    }
    if (target === 1) {
      violations.push({ code: 'extra-turn', message: `Bracket 1 allows no extra-turn cards: ${names(extraTurns, db)}.`, oracleIds: extraTurns });
    }
  }

  const twoCard = combos.included.filter((c) => c.twoCard && c.relevant); // early ones first (findCombos order)
  twoCard.slice(0, MAX_COMBO_REASONS).forEach(({ combo, early }) => {
    reasons.push({
      text: early
        ? `Two-card combo that can come together early: ${comboText(combo, db)}. Bracket 4 and up.`
        : `Two-card combo: ${comboText(combo, db)}. Not allowed in Brackets 1-2.`,
      oracleIds: comboIds(combo), floor: early ? 4 : 3,
    });
  });
  const rest = twoCard.slice(MAX_COMBO_REASONS);
  if (rest.length > 0) {
    reasons.push({
      text: `${rest.length} more two-card combo${rest.length === 1 ? '' : 's'}.`,
      oracleIds: [...new Set(rest.flatMap((c) => comboIds(c.combo)))],
      floor: rest.some((c) => c.early) ? 4 : 3,
    });
  }
  for (const { combo, early } of twoCard) {
    if (target <= 2) {
      violations.push({ code: 'two-card-combo', message: `Bracket ${target} allows no two-card combos: ${comboText(combo, db)}.`, oracleIds: comboIds(combo) });
    } else if (target === 3 && early) {
      violations.push({ code: 'early-combo', message: `Bracket 3 allows no early two-card combos: ${comboText(combo, db)}.`, oracleIds: comboIds(combo) });
    }
  }

  const floor = Math.min(4, reasons.reduce<number>((m, r) => Math.max(m, r.floor), 1)) as BracketReport['floor'];
  const playsLike = playsLikeOf(powerEstimate(cards, combos.included).score);
  if (unknown > 0) warnings.push(`${unknown} card${unknown === 1 ? ' is' : 's are'} not in the database and could not be checked.`);
  if (playsLike > target && playsLike - target >= 2) warnings.push(`Plays like Bracket ${playsLike}, well above the Bracket ${target} target.`);

  return { floor, playsLike, reasons, warnings, violationsOfTarget: violations, combos };
}

// ---- bracketGate ---------------------------------------------------------------------------

interface DeckState {
  commanders: string[]; mainIds: string[]; mainQtys: number[];
  counts: Map<string, number>; commanderSet: Set<string>; gameChangers: Set<string>;
}
const states = new WeakMap<Deck, { db: CardDb; state: DeckState }>();

/** Per-deck lookup tables, rebuilt whenever the deck's cards differ from the cached snapshot. */
function deckState(deck: Deck, db: CardDb): DeckState {
  const hit = states.get(deck);
  if (hit && hit.db === db) {
    const s = hit.state;
    let same = s.commanders.length === deck.commanders.length && s.mainIds.length === deck.main.length;
    for (let i = 0; same && i < s.commanders.length; i++) same = s.commanders[i] === deck.commanders[i];
    for (let i = 0; same && i < s.mainIds.length; i++) {
      const e = deck.main[i];
      same = s.mainIds[i] === e.oracleId && Object.is(s.mainQtys[i], e.qty);
    }
    if (same) return s;
  }
  const counts = deckCounts(deck);
  const gameChangers = new Set<string>();
  for (const id of counts.keys()) if (db.get(id)?.gameChanger) gameChangers.add(id);
  const state: DeckState = {
    commanders: [...deck.commanders],
    mainIds: deck.main.map((e) => e.oracleId),
    mainQtys: deck.main.map((e) => e.qty),
    counts, commanderSet: new Set(deck.commanders), gameChangers,
  };
  states.set(deck, { db, state });
  return state;
}

const gateCombos = new WeakMap<CardDb, Map<string, Combo[]>>();
/** The card's two-card bracket-relevant combos, cached per database. */
function twoCardCombos(oracleId: string, db: CardDb): Combo[] {
  let perDb = gateCombos.get(db);
  if (!perDb) gateCombos.set(db, (perDb = new Map()));
  let list = perDb.get(oracleId);
  if (!list) perDb.set(oracleId, (list = db.combosFor(oracleId).filter((c) => isTwoCard(c) && isRelevant(c))));
  return list;
}

/**
 * Why `card` cannot be in `deck` at its target bracket, or null. The card may already be in the
 * deck (it is then not counted against itself). Brackets 4 and 5 gate nothing. Cheap enough to
 * call for every card in the pool: deck lookups are cached and re-checked against the deck's cards.
 */
export function bracketGate(card: Card, deck: Deck, ctx: EngineContext): { code: string; message: string } | null {
  const target = Math.min(5, Math.max(1, Math.round(Number(deck.targetBracket) || 3)));
  if (target >= 4) return null;
  const { db } = ctx;
  // Most cards need no deck lookups at all, so the deck state is fetched only when one is needed.
  let state: DeckState | null = null;

  if (card.gameChanger) {
    if (target <= 2) return { code: 'game-changer', message: `${card.name} is a Game Changer; Bracket ${target} allows none.` };
    state = deckState(deck, db);
    const others = state.gameChangers.size - (state.gameChangers.has(card.oracleId) ? 1 : 0);
    if (others >= GC_LIMIT_B3) {
      return { code: 'game-changer-limit', message: `${card.name} would be Game Changer number ${others + 1}; Bracket 3 allows three.` };
    }
  }
  const roles = db.features(card.oracleId)?.roles;
  if (isMld(card.oracleId, roles, ctx)) {
    return { code: 'mass-land-denial', message: `${card.name} is mass land denial; Bracket ${target} allows none.` };
  }
  if (target === 1 && isExtraTurn(card.oracleId, roles, ctx)) {
    return { code: 'extra-turn', message: `${card.name} is an extra-turn card; Bracket 1 allows none.` };
  }
  const combos = twoCardCombos(card.oracleId, db);
  if (combos.length === 0) return null;
  state ??= deckState(deck, db);
  const { counts, commanderSet } = state;
  for (const combo of combos) {
    const early = isEarly(combo, db);
    if (target === 3 && !early) continue;
    const complete = combo.cards.every((piece) => {
      if (piece.oracleId !== card.oracleId && !counts.has(piece.oracleId)) return false;
      return !piece.mustBeCommander || commanderSet.has(piece.oracleId);
    });
    if (!complete) continue;
    const partner = combo.cards.find((p) => p.oracleId !== card.oracleId);
    const partnerName = (partner && db.get(partner.oracleId)?.name) ?? 'a card in the deck';
    const result = combo.produces[0] ? ` (${combo.produces[0]})` : '';
    return target === 3
      ? { code: 'early-combo', message: `${card.name} + ${partnerName}${result} is an early two-card combo; Bracket 3 allows none.` }
      : { code: 'two-card-combo', message: `${card.name} + ${partnerName}${result} is a two-card combo; Bracket ${target} allows none.` };
  }
  return null;
}
