import { RATING_WEIGHTS, rateDeck, ratingCapped } from '../rating';
import type { RatingKey } from '../rating';
import { isBasicLand, validateDeck } from '../rules';
import { createScorer } from '../scoring';
import { isLandCard } from '../summary';
import { ROLE_LABEL } from '../targets';
import type { AxisId, BuildOptions, Deck, DeckRating, EngineContext, Fix, FixChange, FixResult, Role, Violation } from '../types';
import { fillRestReport } from './auto';
import { improveDeck, replaceCard } from './goals';
import { applySwaps, comboPieces, cuttable, matches, shownRating, swapOne } from './improve';
import { buildPool, deckCount, qtyOf, removeCard } from './pool';

const DECK_SIZE = 100;
/** Swaps the improve step asks for. */
const FIX_SWAPS = 15;
/** Replacements rated for each card that breaks a rule. */
const REPLACEMENTS = 6;
/** Bound on the legality step: each round replaces or removes one copy. */
const MAX_REPAIRS = 200;
/** Rules only the commanders (or their choices) can break. Fix deck never changes commanders. */
const COMMANDER_CODES: ReadonlySet<string> = new Set(['no-commander', 'bad-commander', 'bad-pair', 'needs-color']);
/** What a card that breaks a rule is, by the rule's code. */
const OFFENCE: Record<string, string> = {
  banned: 'a banned card', identity: "a card outside the commander's colours", copies: 'an extra copy',
  'unknown-card': 'a card the card database does not know', companion: "a card the companion's condition rules out",
};

/** True for a key of `RATING_WEIGHTS` (a part of the rating `fixDeck` can be asked to fix alone). */
export const isRatingKey = (key: unknown): key is RatingKey => typeof key === 'string' && Object.prototype.hasOwnProperty.call(RATING_WEIGHTS, key);

/** The deck holds an unlocked copy of the card in its main deck (one Fix deck may cut). */
const removable = (deck: Deck, id: string): boolean => deck.main.some((e) => e.oracleId === id && !e.locked && qtyOf(e) >= 1);
const counts = (deck: Deck): Map<string, number> => {
  const out = new Map<string, number>();
  for (const e of deck.main) out.set(e.oracleId, (out.get(e.oracleId) ?? 0) + qtyOf(e));
  return out;
};

/** The note for a deck whose commanders are what breaks the rules (or that has none), else null. */
function commanderFault(deck: Deck, violations: readonly Violation[]): string | null {
  const commanders = new Set(deck.commanders);
  const stuck = violations.filter((v) => v.code !== 'size' && !v.oracleIds.some((id) => removable(deck, id))
    && (COMMANDER_CODES.has(v.code) || v.oracleIds.some((id) => commanders.has(id))));
  if (stuck.length === 0) return null;
  return `${stuck.map((v) => v.message).join(' ')} Fix deck never changes the commanders or their choices, so the deck was left as it is: fix that first.`;
}

/** Every card that breaks a rule (never a commander, never a locked card): the best agreeing replacement, else removed. */
function repairRules(start: Deck, ctx: EngineContext, opts: BuildOptions, changes: FixChange[]): Deck {
  let deck = start;
  for (let n = 0; n < MAX_REPAIRS; n++) {
    let target: { id: string; v: Violation } | null = null;
    for (const v of validateDeck(deck, ctx.db)) {
      if (v.code === 'size') continue;
      const id = v.oracleIds.find((x) => removable(deck, x));
      if (id) { target = { id, v }; break; }
    }
    if (!target) break;
    const { id, v } = target;
    const what = OFFENCE[v.code] ?? 'a card that breaks a rule';
    const known = ctx.db.get(id) !== undefined;
    const into = known ? replaceCard(deck, ctx, opts, id, REPLACEMENTS).find((p) => p.agrees !== false) : undefined;
    if (into) {
      deck = swapOne(deck, id, into.in);
      changes.push({ out: id, in: into.in, reason: `Replaces ${what}: ${v.message}` });
    } else {
      deck = removeCard(deck, id);
      changes.push({ out: id, in: '', reason: known ? `Removes ${what} that no card the options allow can replace: ${v.message}` : `Removes ${what}: ${v.message}` });
    }
  }
  return deck;
}

/**
 * Over 100 cards: the weakest unlocked cards go, one copy at a time, in the order Improve would cut
 * them (`cuttable`: weakest first, combo pieces, side plans and strong on-theme cards last).
 */
function trim(start: Deck, ctx: EngineContext, opts: BuildOptions, changes: FixChange[]): Deck {
  let deck = start;
  const scorer = createScorer(deck, ctx);
  const locked = new Set(deck.main.filter((e) => e.locked).map((e) => e.oracleId));
  const first = cuttable(deck, ctx, buildPool(deck, ctx, opts), locked, comboPieces(deck, ctx), scorer).map((o) => o.id);
  const scoreOf = (id: string): number => { const c = ctx.db.get(id); return c ? scorer.score(c).score : -1; };
  const taken = new Set(first);
  const rest = [...new Set(deck.main.filter((e) => !e.locked && qtyOf(e) >= 1).map((e) => e.oracleId))]
    .filter((id) => !taken.has(id))
    .sort((a, b) => scoreOf(a) - scoreOf(b) || (a < b ? -1 : 1));
  const order = [...first, ...rest];
  while (deckCount(deck) > DECK_SIZE) {
    const before = deckCount(deck);
    for (const id of order) {
      if (deckCount(deck) <= DECK_SIZE) break;
      if (!removable(deck, id)) continue;
      deck = removeCard(deck, id);
      changes.push({ out: id, in: '', reason: 'Cuts one of the weakest cards to bring the deck down to 100.' });
    }
    if (deckCount(deck) === before) break; // what is left over is locked
  }
  return deck;
}

/** Under 100 cards: `fillRest`, with every card it adds (and anything it had to drop) as a change. */
function fill(start: Deck, ctx: EngineContext, opts: BuildOptions, changes: FixChange[]): Deck {
  const { deck: built, notes } = fillRestReport(start, ctx, opts);
  const before = counts(start);
  const after = counts(built);
  for (const [id, n] of before) for (let k = after.get(id) ?? 0; k < n; k++) changes.push({ out: id, in: '', reason: 'Makes room while filling the deck to 100.' });
  if (start.companion && built.companion !== start.companion) {
    changes.push({ out: start.companion, in: '', reason: notes.find((x) => /companion/.test(x)) ?? 'Drops the companion: the deck cannot meet its condition.' });
  }
  for (const [id, n] of after) for (let k = before.get(id) ?? 0; k < n; k++) changes.push({ out: '', in: id, reason: 'Fills the deck to 100.' });
  return built;
}

const unique = <T>(xs: T[]): T[] => [...new Set(xs)];

/**
 * "Fix deck": solves the problems the deck's own rating lists, and says what it did.
 *
 * 1. Legal and complete first. Every card that breaks a rule (banned, outside the colour identity,
 *    over the copy limit, unknown) is replaced by the best `replaceCard` proposal the engine agrees
 *    with, or removed when there is none. Over 100 cards, the weakest unlocked cards are cut; under
 *    100, `fillRest` fills the deck. This step runs whenever the deck breaks a rule or is not 100
 *    cards, `only` or not.
 * 2. Then a directed `improveDeck` run whose goals come from the rating's current fixes (all parts,
 *    or only the part `only` names): role filters are emphasised roles, axis filters emphasised theme
 *    axes, at most 15 swaps, the deck's own target bracket. Proposals are applied in order; one the
 *    engine objects to (`agrees === false`) is skipped, and the run stops before one that would lower
 *    the rating. With `only`, a swap is kept only when its card is of the kind that part asks for and
 *    it raises that part.
 * 3. A result that rates below the start is not returned: the deck comes back unchanged with a note.
 *
 * Commanders and locked cards are never cut, and the options (owned only, free copies, price) hold
 * for every card brought in. A deck whose commanders break a rule comes back unchanged with a note,
 * as does an unknown `only`. `note` also says why nothing changed, or what still keeps the deck from
 * being legal. Never throws.
 */
export function fixDeck(deck: Deck, ctx: EngineContext, opts: BuildOptions, only: string | null = null): FixResult {
  const start = rateDeck(deck, ctx);
  const ratingBefore = shownRating(start);
  const untouched = (note: string): FixResult => ({ deck, changes: [], ratingBefore, ratingAfter: ratingBefore, note });
  if (only !== null && only !== undefined && !isRatingKey(only)) {
    return untouched(`"${String(only)}" is not a part of the rating (${Object.keys(RATING_WEIGHTS).join(', ')}), so nothing was changed.`);
  }
  const fault = commanderFault(deck, start.violations);
  if (fault) return untouched(fault);

  const plain: BuildOptions = { ...opts, goals: null };
  const changes: FixChange[] = [];
  let current = deck;

  // 1. Legal, then 100 cards.
  if (start.violations.length > 0) {
    current = repairRules(current, ctx, plain, changes);
    if (validateDeck(current, ctx.db).some((v) => v.code === 'size')) {
      if (deckCount(current) > DECK_SIZE) current = trim(current, ctx, plain, changes);
      else if (deckCount(current) < DECK_SIZE) current = fill(current, ctx, plain, changes);
    }
  }

  // 2. The rating's own fixes, as the goals of a directed improve.
  let rating: DeckRating = changes.length > 0 ? rateDeck(current, ctx) : start;
  const part = only ? (rating.subscores.find((s) => s.key === only) ?? null) : null;
  const fixes: Fix[] = only ? (part?.fixes ?? []) : rating.subscores.flatMap((s) => s.fixes);
  if (fixes.length > 0 && !ratingCapped(current, rating.violations)) {
    const roles = unique(fixes.map((f) => f.filter?.role).filter((r): r is Role => r !== undefined && ROLE_LABEL[r] !== undefined));
    const axes = unique(fixes.map((f) => f.filter?.axis).filter((a): a is AxisId => typeof a === 'string' && a.length > 0));
    const proposals = improveDeck(current, ctx, { ...opts, goals: { maxSwaps: FIX_SWAPS, emphasizeRoles: roles, emphasizeAxes: axes } });

    const filters = fixes.flatMap((f) => (f.filter ? [f.filter] : []));
    const serves = (id: string): boolean => {
      if (!only || filters.length === 0) return true;
      const card = ctx.db.get(id);
      const f = ctx.db.features(id);
      return !!card && !!f && filters.some((x) => matches({ card, f, land: isLandCard(f) }, x));
    };
    const holds = (d: Deck, id: string): boolean => {
      const card = ctx.db.get(id);
      return !card || (!isBasicLand(card) && (d.commanders.includes(id) || d.main.some((e) => e.oracleId === id && qtyOf(e) >= 1)));
    };
    const value = (r: DeckRating): number => r.subscores.find((s) => s.key === only)?.value ?? 0;

    // While every proposal so far has been applied, the deck is the one the run proposed on: its own
    // check (`agrees`, or the plain run's rising ratings) stands, and no rating is needed.
    let synced = true;
    let known: DeckRating | null = rating;
    for (const p of proposals) {
      if (p.agrees === false || !serves(p.in) || (p.out !== '' && !removable(current, p.out)) || holds(current, p.in)) { synced = false; continue; }
      const next = applySwaps(current, [p]);
      if (!synced || only) {
        const before: DeckRating = known ?? rateDeck(current, ctx);
        const after: DeckRating = rateDeck(next, ctx);
        if (shownRating(after) < shownRating(before)) break;
        if (only && value(after) <= value(before)) { synced = false; known = before; continue; }
        known = after;
      } else {
        known = null;
      }
      current = next;
      changes.push({ out: p.out, in: p.in, reason: p.reason });
    }
    rating = known ?? rateDeck(current, ctx);
  }

  // 3. Never below the start.
  const ratingAfter = shownRating(rating);
  if (ratingAfter < ratingBefore) {
    const still = start.violations.length > 0 ? ` The deck still breaks a rule: ${start.violations.map((v) => v.message).join(' ')}` : '';
    return untouched(`Fix deck's changes would lower the rating from ${ratingBefore} to ${ratingAfter}, so nothing was changed.${still}`);
  }

  let note: string | null = null;
  if (rating.violations.length > 0) {
    const lockedBlock = rating.violations.some((v) => v.oracleIds.some((id) => current.main.some((e) => e.oracleId === id && e.locked)));
    note = `Still not legal: ${rating.violations.map((v) => v.message).join(' ')}${lockedBlock ? ' Locked cards are never cut: unlock them to let Fix deck replace them.' : ''}`;
  } else if (changes.length === 0) {
    note = fixes.length === 0
      ? `Nothing to fix: the rating lists no problems${part ? ` with ${part.label}` : ''}.`
      : `Nothing to fix with the cards allowed${opts.ownedOnly ? ' (owned cards only)' : ''}: no change the engine agrees with improves ${part ? `the ${part.label.toLowerCase()} part of the rating` : 'the rating'}.`;
  }
  return { deck: current, changes, ratingBefore, ratingAfter, note };
}
