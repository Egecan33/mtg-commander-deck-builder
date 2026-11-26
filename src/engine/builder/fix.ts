import { analyzeBracket } from '../brackets';
import { deckNetwork } from '../network';
import { ILLEGAL_CAP, RATING_WEIGHTS, rateDeck, ratingCapped } from '../rating';
import type { RatingKey } from '../rating';
import { isBasicLand, validateDeck } from '../rules';
import { createScorer } from '../scoring';
import { isLandCard, summarizeDeck } from '../summary';
import { ROLE_LABEL, roleNeeds, targetsFor } from '../targets';
import type { AxisId, BuildOptions, Color, Deck, DeckRating, EngineContext, FixChange, FixResult, Role, SubScore, Violation } from '../types';
import { fillRestReport } from './auto';
import { improveDeck, replaceCardFrom } from './goals';
import { applySwaps, comboPieces, cuttable, matches, shownRating, swapOne } from './improve';
import { buildPool, deckCount, qtyOf, removeCard } from './pool';
import type { Pool } from './pool';

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

/** A rule's offender in a change's one-line summary ("Legal: replaces an off-colour card"). */
const BROKE: Record<string, string> = {
  banned: 'a banned card', identity: 'an off-colour card', copies: 'an extra copy',
  'unknown-card': 'an unknown card', companion: 'a card the companion rules out',
};
/** What cutting a card does for the target bracket, by the bracket rule it broke. */
const BRACKET_CUT: Record<string, string> = {
  'game-changer': 'Bracket: cuts a Game Changer', 'game-changer-limit': 'Bracket: cuts a fourth Game Changer',
  'mass-land-denial': 'Bracket: cuts mass land denial', 'extra-turn': 'Bracket: cuts an extra-turn card',
  'two-card-combo': 'Bracket: breaks up a two-card combo', 'early-combo': 'Bracket: breaks up an early combo',
};
const COLOUR_WORD: Record<Color, string> = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const span = (lo: number, hi: number): string => (lo === hi ? `${lo}` : `${lo}–${hi}`);

/**
 * One short line on what a swap of an improve step did, from the deck before and after it: a card
 * the target bracket forbids that it cut; else the role it moved toward its band ("Ramp 6 → 7 of
 * 10–13": the largest shortfall it filled, else the largest surplus it trimmed); else the land count, the
 * tapped lands or a colour's sources; else a much cheaper card; else the scores of the two cards.
 */
function swapSummary(before: Deck, after: Deck, c: { out: string; in: string }, ctx: EngineContext): string {
  if (c.out !== '') {
    const v = analyzeBracket(before, ctx).violationsOfTarget.find((x) => x.oracleIds.includes(c.out));
    if (v) return BRACKET_CUT[v.code] ?? 'Bracket: cuts a card the target bracket forbids';
  }
  // A shortfall the change filled says more than a surplus it trimmed; the largest of either wins.
  const was = roleNeeds(before, ctx);
  let role: { line: string; rank: number } | null = null;
  for (const n of roleNeeds(after, ctx)) {
    const b = was.find((x) => x.role === n.role);
    if (!b || n.count === b.count) continue;
    const rank = n.count > b.count ? (b.short > 0 ? 1000 + b.short : 0) : b.over;
    if (rank > 0 && (!role || rank > role.rank)) role = { line: `${capital(b.label)} ${b.count} → ${n.count} of ${span(b.band.lo, b.band.hi)}`, rank };
  }
  if (role) return role.line;

  const sb = summarizeDeck(before, ctx.db);
  const sa = summarizeDeck(after, ctx.db);
  if (sa.landCount !== sb.landCount) return `Lands ${sb.landCount} → ${sa.landCount} of ${Math.round(targetsFor(after, ctx, sa).lands)}`;
  const inCard = ctx.db.get(c.in);
  const outCard = c.out !== '' ? ctx.db.get(c.out) : undefined;
  const inF = ctx.db.features(c.in);
  const outF = c.out !== '' ? ctx.db.features(c.out) : undefined;
  if (inF && outF && isLandCard(inF) && isLandCard(outF)) {
    if (Math.round(sa.taplands) < Math.round(sb.taplands)) return `Tapped lands ${Math.round(sb.taplands)} → ${Math.round(sa.taplands)}`;
    const colour = (Object.keys(COLOUR_WORD) as Color[])
      .map((k) => ({ k, gain: Math.round(sa.sources[k]) - Math.round(sb.sources[k]) }))
      .sort((x, y) => y.gain - x.gain)[0];
    if (colour && colour.gain > 0) return `${COLOUR_WORD[colour.k]} sources ${Math.round(sb.sources[colour.k])} → ${Math.round(sa.sources[colour.k])}`;
    return 'Better land for the deck';
  }
  if (inCard && outCard && outCard.cmc - inCard.cmc >= 2) return `Cheaper: mana value ${outCard.cmc} → ${inCard.cmc}`;
  const scorer = createScorer(before, ctx);
  const scoreOf = (card: typeof inCard): number => (card ? Math.max(0, scorer.score(card).score) : 0);
  return outCard ? `Stronger card: scores ${scoreOf(inCard)} against ${scoreOf(outCard)}` : `Adds a card that scores ${scoreOf(inCard)}`;
}

/** True for a key of `RATING_WEIGHTS` (a part of the rating `fixDeck` can be asked to fix alone). */
export const isRatingKey = (key: unknown): key is RatingKey => typeof key === 'string' && Object.prototype.hasOwnProperty.call(RATING_WEIGHTS, key);

/** The deck holds an unlocked copy of the card in its main deck (one Fix deck may cut). */
const removable = (deck: Deck, id: string): boolean => deck.main.some((e) => e.oracleId === id && !e.locked && qtyOf(e) >= 1);
const counts = (deck: Deck): Map<string, number> => {
  const out = new Map<string, number>();
  for (const e of deck.main) out.set(e.oracleId, (out.get(e.oracleId) ?? 0) + qtyOf(e));
  return out;
};
const unique = <T>(xs: T[]): T[] => [...new Set(xs)];
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** The note for a deck whose commanders are what breaks the rules (or that has none), else null. */
function commanderFault(deck: Deck, violations: readonly Violation[]): string | null {
  const commanders = new Set(deck.commanders);
  const stuck = violations.filter((v) => v.code !== 'size' && !v.oracleIds.some((id) => removable(deck, id))
    && (COMMANDER_CODES.has(v.code) || v.oracleIds.some((id) => commanders.has(id))));
  if (stuck.length === 0) return null;
  return `${stuck.map((v) => v.message).join(' ')} Fix deck never changes the commanders or their choices, so the deck was left as it is: fix that first.`;
}

/** Every card that breaks a rule (never a commander, never a locked card): the best agreeing replacement, else removed. */
function repairRules(start: Deck, ctx: EngineContext, pool: () => Pool, changes: FixChange[]): Deck {
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
    const into = known ? replaceCardFrom(deck, ctx, pool(), id, REPLACEMENTS).find((p) => p.agrees !== false) : undefined;
    if (into) {
      deck = swapOne(deck, id, into.in);
      changes.push({ out: id, in: into.in, reason: `Replaces ${what}: ${v.message}`, summary: `Legal: replaces ${BROKE[v.code] ?? 'a card that breaks a rule'}` });
    } else {
      deck = removeCard(deck, id);
      changes.push({
        out: id, in: '', reason: known ? `Removes ${what} that no card the options allow can replace: ${v.message}` : `Removes ${what}: ${v.message}`,
        summary: `Legal: removes ${BROKE[v.code] ?? 'a card that breaks a rule'}`,
      });
    }
  }
  return deck;
}

/**
 * Over 100 cards: the weakest unlocked cards go, one copy at a time, in the order Improve would cut
 * them (`cuttable`: weakest first, combo pieces, side plans and strong on-theme cards last).
 */
function trim(start: Deck, ctx: EngineContext, pool: Pool, changes: FixChange[]): Deck {
  let deck = start;
  const scorer = createScorer(deck, ctx);
  const locked = new Set(deck.main.filter((e) => e.locked).map((e) => e.oracleId));
  const first = cuttable(deck, ctx, pool, locked, comboPieces(deck, ctx), scorer).map((o) => o.id);
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
      changes.push({ out: id, in: '', reason: 'Cuts one of the weakest cards to bring the deck down to 100.', summary: 'Cuts the deck down to 100' });
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
  for (const [id, n] of before) {
    for (let k = after.get(id) ?? 0; k < n; k++) changes.push({ out: id, in: '', reason: 'Makes room while filling the deck to 100.', summary: 'Makes room to fill the deck to 100' });
  }
  if (start.companion && built.companion !== start.companion) {
    changes.push({ out: start.companion, in: '', reason: notes.find((x) => /companion/.test(x)) ?? 'Drops the companion: the deck cannot meet its condition.', summary: 'Drops the companion' });
  }
  for (const [id, n] of after) for (let k = before.get(id) ?? 0; k < n; k++) changes.push({ out: '', in: id, reason: 'Fills the deck to 100.', summary: 'Fills the deck to 100' });
  return built;
}

/** " from the cards allowed (owned cards only, up to $2)" when the options narrow the search, else ''. */
export function searched(opts: BuildOptions): string {
  const limits: string[] = [];
  if (opts.ownedOnly) limits.push('owned cards only');
  if (typeof opts.maxPriceUsd === 'number' && Number.isFinite(opts.maxPriceUsd)) limits.push(`up to $${opts.maxPriceUsd}`);
  return limits.length > 0 ? ` from the cards allowed (${limits.join(', ')})` : '';
}

/** What the improve step kept, and (when it kept nothing) why, in a clause that follows "Nothing to fix: ". */
interface Stage { deck: Deck; rating: DeckRating; changes: FixChange[]; why: string }

/**
 * Step 2 of `fixDeck`, on a deck the legality step is done with. The goals come from the rating's
 * fixes (all parts, or `part` alone). Proposals are applied in order, skipping one the engine
 * objects to, and the rating is tracked after each: the run may dip on the way (bracket fit stays 0
 * until the last offender goes, while each Game Changer cut costs card quality). What is kept is the
 * prefix that ends at the highest rating reached, when that is above the stage's starting rating;
 * otherwise nothing. While every proposal so far has been applied, the plain run's own ratings are
 * for this very deck and are used as they are; any other step is rated.
 *
 * With `part`, a step is taken only for the kind of card that part asks for (its fix filters) and
 * when the part does not fall, and the prefix kept is the one that ends at the part's highest value
 * among the points rated at least the stage's start, when that is above the part's starting value.
 */
function improveStage(start: Deck, startRating: DeckRating, ctx: EngineContext, opts: BuildOptions, part: SubScore | null): Stage {
  const none = (why: string): Stage => ({ deck: start, rating: startRating, changes: [], why });
  const fixes = part ? part.fixes : startRating.subscores.flatMap((s) => s.fixes);
  if (fixes.length === 0) return none(`the rating lists no problems${part ? ` with ${part.label}` : ''}`);
  if (ratingCapped(start, startRating.violations)) return none('a deck that breaks a rule is capped, so no swap can raise its rating');

  const roles = unique(fixes.map((f) => f.filter?.role).filter((r): r is Role => r !== undefined && ROLE_LABEL[r] !== undefined));
  const axes = unique(fixes.map((f) => f.filter?.axis).filter((a): a is AxisId => typeof a === 'string' && a.length > 0));
  const proposals = improveDeck(start, ctx, { ...opts, goals: { maxSwaps: FIX_SWAPS, emphasizeRoles: roles, emphasizeAxes: axes } });
  if (proposals.length === 0) return none(`Improve found no swap for the problems the rating lists${searched(opts)}`);

  const filters = fixes.flatMap((f) => (f.filter ? [f.filter] : []));
  const ofKind = (id: string): boolean => {
    if (!part || filters.length === 0) return true;
    const card = ctx.db.get(id);
    const f = ctx.db.features(id);
    return !!card && !!f && filters.some((x) => matches({ card, f, land: isLandCard(f) }, x));
  };
  const holds = (d: Deck, id: string): boolean => {
    const card = ctx.db.get(id);
    return !card || (!isBasicLand(card) && (d.commanders.includes(id) || d.main.some((e) => e.oracleId === id && qtyOf(e) >= 1)));
  };
  const value = (r: DeckRating): number => (part ? (r.subscores.find((s) => s.key === part.key)?.value ?? 0) : 0);
  const startShown = shownRating(startRating);

  let deck = start;
  let current: DeckRating | null = startRating; // null while only the plain run's own number is known
  let synced = true;
  // Each applied swap with the deck before and after it (for its summary, made for the kept ones only).
  const made: { out: string; in: string; reason: string; before: Deck; after: Deck }[] = [];
  /** The best point of the run so far: the prefix of `made` that ends there, and its rating. */
  let best: { deck: Deck; count: number; shown: number; rating: DeckRating | null; value: number } = { deck: start, count: 0, shown: startShown, rating: startRating, value: value(startRating) };
  let objected = 0;
  let offKind = 0;
  let partFell = 0;
  for (const p of proposals) {
    if (p.agrees === false) { objected++; synced = false; continue; }
    if (!ofKind(p.in)) { offKind++; synced = false; continue; }
    if ((p.out !== '' && !removable(deck, p.out)) || holds(deck, p.in)) { synced = false; continue; }
    const next = applySwaps(deck, [p]);
    let after: DeckRating | null = null;
    let shown: number;
    if (synced && !part && p.agrees === undefined) {
      shown = p.ratingAfter; // the plain run rated this very deck
    } else {
      after = rateDeck(next, ctx);
      shown = shownRating(after);
      if (part) {
        const before: DeckRating = current ?? rateDeck(deck, ctx);
        if (value(after) < value(before)) { partFell++; synced = false; current = before; continue; }
      }
    }
    made.push({ out: p.out, in: p.in, reason: p.reason, before: deck, after: next });
    deck = next;
    current = after;
    if (part) {
      if (after && shown >= startShown && value(after) > best.value) best = { deck, count: made.length, shown, rating: after, value: value(after) };
    } else if (shown > best.shown) {
      best = { deck, count: made.length, shown, rating: after, value: 0 };
    }
  }

  if (best.count > 0) {
    const changes = made.slice(0, best.count).map((m) => ({ out: m.out, in: m.in, reason: m.reason, summary: swapSummary(m.before, m.after, m, ctx) }));
    return { deck: best.deck, rating: best.rating ?? rateDeck(best.deck, ctx), changes, why: '' };
  }

  const because: string[] = [];
  if (objected > 0) because.push(`the engine objects to ${objected === 1 ? 'one' : objected} of them`);
  if (part && offKind > 0) because.push(`${offKind === 1 ? 'one brings in a card' : `${offKind} bring in cards`} of another kind than ${part.label} asks for`);
  if (part && partFell > 0) because.push(`${partFell === 1 ? 'one lowers' : `${partFell} lower`} ${part.label}`);
  if (made.length > 0) {
    because.push(part
      ? `the swaps Fix deck could make do not raise ${part.label} while keeping the rating at ${startShown} or more`
      : `the rating never rises above ${startShown} along the swaps Fix deck could make`);
  }
  const tail = because.length > 0 ? `, but ${because.join('; ')}` : ', but none of them could be applied to the deck as it is';
  return none(`Improve proposed ${plural(proposals.length, 'swap')}${searched(opts)}${tail}`);
}

/**
 * Step 3b of `fixDeck` for `only = 'synergy'`: every card the network says connects to nothing is
 * swapped, one at a time, for the best replacement the engine agrees with that does connect, as
 * long as neither the rating nor Synergy falls. Locked cards stay. The options hold for every
 * card brought in (the pool is built with them), so with nothing connected allowed nothing changes.
 */
function connectStage(start: Deck, startRating: DeckRating, ctx: EngineContext, poolOf: () => Pool): Stage {
  const synergyOf = (r: DeckRating): number => r.subscores.find((s) => s.key === 'synergy')?.value ?? 0;
  let deck = start;
  let rating = startRating;
  const changes: FixChange[] = [];
  const locked = new Set(start.main.filter((e) => e.locked).map((e) => e.oracleId));
  const tried = new Set<string>();
  for (let round = 0; round < FIX_SWAPS; round++) {
    const out = deckNetwork(deck, ctx).unconnected.find((id) => !locked.has(id) && !tried.has(id));
    if (out === undefined) break;
    tried.add(out);
    for (const p of replaceCardFrom(deck, ctx, poolOf(), out, 6)) {
      if (p.agrees === false || p.out !== out || p.in === '') continue;
      const next = applySwaps(deck, [p]);
      const net = deckNetwork(next, ctx);
      if (net.unconnected.includes(p.in)) continue;
      const after = rateDeck(next, ctx);
      if (shownRating(after) < shownRating(rating) || synergyOf(after) < synergyOf(rating)) continue;
      const names = (id: string) => ctx.db.get(id)?.name ?? id;
      const links = net.edges.filter((e) => e.kind !== 'commander' && (e.a === p.in || e.b === p.in)).length;
      changes.push({
        out, in: p.in,
        reason: `${names(out)} connects to nothing in this deck; ${names(p.in)} works with ${links === 0 ? 'the commander' : `${links} ${links === 1 ? 'card' : 'cards'} in it`}.`,
        summary: 'Synergy: swaps a card that connects to nothing',
      });
      deck = next;
      rating = after;
      break;
    }
  }
  return { deck, rating, changes, why: changes.length === 0 ? 'no card that connects to nothing has a better replacement among the cards allowed' : '' };
}

/**
 * "Fix deck": solves the problems the deck's own rating lists, and says what it did.
 *
 * 1. Legal and complete first. Every card that breaks a rule (banned, outside the colour identity,
 *    over the copy limit, unknown) is replaced by the best `replaceCard` proposal the engine agrees
 *    with, or removed when there is none. Over 100 cards, the weakest unlocked cards are cut; under
 *    100, `fillRest` fills the deck. This step runs whenever the deck breaks a rule or is not 100
 *    cards, `only` or not, and it stands even when it costs rating points: a deck that breaks a rule
 *    is capped at 40 and cannot be played (`note` then says what it cost). One card pool serves
 *    every replacement of the call.
 * 2. A deck that breaks its own target bracket's rules (the bracket report's violations of the
 *    target, such as Game Changers at Bracket 2) is brought inside it next, by the same routine as
 *    `only = 'bracket'` (judged over the run, best prefix). Only for a full fix: with `only`, the
 *    part asked for is the whole of step 3.
 * 3. Then a directed `improveDeck` run whose goals come from the rating's current fixes (all parts,
 *    or only the part `only` names): role filters are emphasised roles, axis filters emphasised theme
 *    axes, at most 15 swaps, the deck's own target bracket. Proposals are applied in order, one the
 *    engine objects to (`agrees === false`) skipped, and the prefix of the run that ends at its
 *    highest rating is kept when that is above the rating the steps before it left (the run may dip
 *    on the way). With `only`, a swap must bring in the kind of card that part asks for and must not
 *    lower the part, and the prefix kept ends at the part's highest value (see `improveStage`).
 *    So steps 2 and 3 never end below the rating they start from: if no point of a run is above
 *    it, none of that run's swaps are kept.
 *
 * Commanders and locked cards are never cut, and the options (owned only, free copies, price) hold
 * for every card brought in. A deck whose commanders break a rule comes back unchanged with a note,
 * as does an unknown `only`. `note` also says what the legality step cost, why nothing changed, or
 * what still keeps the deck from being legal. Never throws.
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
  // The pool is read from the commanders, the options, the bracket and the theme: one per call.
  let pool: Pool | null = null;
  const poolOf = (): Pool => (pool ??= buildPool(deck, ctx, plain));

  // 1. Legal, then 100 cards.
  if (start.violations.length > 0) {
    current = repairRules(current, ctx, poolOf, changes);
    if (validateDeck(current, ctx.db).some((v) => v.code === 'size')) {
      if (deckCount(current) > DECK_SIZE) current = trim(current, ctx, poolOf(), changes);
      else if (deckCount(current) < DECK_SIZE) current = fill(current, ctx, plain, changes);
    }
  }
  const legalChanges = changes.length;
  let mid = legalChanges > 0 ? rateDeck(current, ctx) : start;

  // 2. Inside the deck's own bracket next: the Bracket fit routine `only='bracket'` runs, judged
  // over its run (bracket fit stays 0 until the last offender goes).
  const outsideBracket = (d: Deck): boolean => analyzeBracket(d, ctx).violationsOfTarget.length > 0;
  let bracketStage: Stage | null = null;
  if (!only && !ratingCapped(current, mid.violations) && outsideBracket(current)) {
    bracketStage = improveStage(current, mid, ctx, opts, mid.subscores.find((s) => s.key === 'bracket') ?? null);
    current = bracketStage.deck;
    changes.push(...bracketStage.changes);
    mid = bracketStage.rating;
  }
  const beforeImprove = changes.length;

  // 3. The rating's own fixes, as the goals of a directed improve.
  const part = only ? (mid.subscores.find((s) => s.key === only) ?? null) : null;
  let stage = improveStage(current, mid, ctx, opts, part);
  // (A deck whose theme the rating itself calls unconfirmed is left to its theme weights first: no swap settles that.)
  if (only === 'synergy' && part && part.fixes.every((f) => f.actionable)) {
    const more = connectStage(stage.deck, stage.rating, ctx, poolOf);
    if (more.changes.length > 0) stage = { deck: more.deck, rating: more.rating, changes: [...stage.changes, ...more.changes], why: stage.why };
    else if (stage.changes.length === 0) stage = { ...stage, why: `${stage.why}; ${more.why}` };
  }
  current = stage.deck;
  changes.push(...stage.changes);
  const rating = stage.rating;
  const ratingAfter = shownRating(rating);

  const notes: string[] = [];
  if (ratingAfter < ratingBefore) {
    notes.push(ratingCapped(deck, start.violations)
      ? `Making the deck legal cost rating points (from ${ratingBefore} to ${ratingAfter}): a deck that breaks a rule is capped at ${ILLEGAL_CAP} and cannot be played as it was.`
      : `Filling the deck to 100 cards cost rating points (from ${ratingBefore} to ${ratingAfter}): a deck under 100 cards cannot be played as it was.`);
  }
  if (rating.violations.length > 0) {
    const lockedBlock = rating.violations.some((v) => v.oracleIds.some((id) => current.main.some((e) => e.oracleId === id && e.locked)));
    notes.push(`Still not legal: ${rating.violations.map((v) => v.message).join(' ')}${lockedBlock ? ' Locked cards are never cut: unlock them to let Fix deck replace them.' : ''}`);
  } else {
    if (bracketStage && outsideBracket(current)) {
      const still = analyzeBracket(current, ctx).violationsOfTarget.map((v) => v.message).join(' ');
      notes.push(`Still outside Bracket ${deck.targetBracket}: ${still}${bracketStage.changes.length === 0 ? ` (${bracketStage.why}.)` : ''}`);
    }
    if (stage.changes.length === 0 && (beforeImprove === 0 || part)) {
      const said = part && part.fixes.length > 0 ? ` The rating says about ${part.label}: ${part.fixes.map((f) => f.text).join(' ')}` : '';
      notes.push(`Nothing ${beforeImprove > 0 ? 'more ' : ''}to fix${part ? ` in ${part.label}` : ''}: ${stage.why}.${said}`);
    }
  }
  return { deck: current, changes, ratingBefore, ratingAfter, note: notes.length > 0 ? notes.join(' ') : null };
}
