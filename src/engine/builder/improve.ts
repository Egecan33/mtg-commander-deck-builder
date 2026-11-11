import { analyzeBracket, findCombos } from '../brackets';
import { karstenSources } from '../mana';
import { rateDeck } from '../rating';
import { isBasicLand, validateDeck } from '../rules';
import { createScorer } from '../scoring';
import { AXIS_MEMBER, deckCards, isLandCard, summarizeDeck } from '../summary';
import { scaleTargets, targetsFor } from '../targets';
import type {
  BuildOptions, Card, CardDb, CardFeatures, Color, Deck, DeckRating, EngineContext, Fix, Role, SwapProposal, Violation,
} from '../types';
import { COLORS, addCard, buildPool, qtyOf, removeCard, themeFit } from './pool';
import type { Candidate, Pool } from './pool';
import { tallyDeck } from './plan';

type Filter = NonNullable<Fix['filter']>;
type Scorer = ReturnType<typeof createScorer>;

/** The rating an illegal deck is capped at (spec §11). */
const ILLEGAL_CAP = 40;
/** Most proposals `improveDeck` returns unless told otherwise (spec §12: "at most ~15"). */
export const MAX_PROPOSALS = 15;
/** Shortfalls looked at per climb step, and cards tried for each. */
const FIXES_PER_STEP = 3;
const INS_PER_FIX = 2;
const GENERIC_INS = 1;
const NONLAND_OUTS = 2;
/** Most swaps rated per step: rating a deck is the slow part (its combo search). */
const TRIALS_PER_STEP = 14;
/** Deck ratings `improveDeck` may spend in all. */
const IMPROVE_EVALS = 210;
/** Smallest rise of the unrounded rating that counts as an improvement. */
const MIN_GAIN = 0.2;
/** A spell must outscore the spell it replaces by this much, so every swap stands on its own. */
const SWAP_MARGIN = 3;
/** ...and by this much when no shortfall of the rating asks for the swap. */
const GENERIC_MARGIN = 10;
/** Theme fit and score from which a card is a strong on-theme card: such a card is not offered as a cut. */
const ON_THEME = 0.5;
const STRONG_THEME_SCORE = 45;
/**
 * A deck with many more theme cards than its bracket asks for may still trade its weakest ones:
 * this many past the theme target stay guarded, and cutting one must gain at least `THEME_CUT_GAIN`.
 */
const THEME_SURPLUS = 8;
const THEME_CUT_GAIN = 1;
/** Runs across flat ground are for decks rated under this; a good deck is not offered swaps that show no gain. */
const PLATEAU_BELOW = 75;
/** Deck ratings `suggestSwaps` may spend per suggestion asked for. */
const SUGGEST_TRIES = 3;
/** Longest run of one repeated swap tried when no single swap moves the rating. */
const PLATEAU_MAX = 8;

/**
 * The rating a proposal reports: unrounded, to one decimal. One swap often moves a deck by less
 * than a whole point, and a list of proposals that each read "71 → 71" would say nothing.
 */
export const shownRating = (r: DeckRating): number => Math.round(fineRating(r) * 10) / 10;

/**
 * The rating before rounding. A capped deck (see `ratingCapped`) stays under its cap: it is one
 * whose reported rating is below what its sub-scores add up to.
 */
export function fineRating(r: DeckRating): number {
  const sum = r.subscores.reduce((a, s) => a + s.weight * s.value, 0);
  return r.rating < Math.round(sum) ? Math.min(ILLEGAL_CAP, sum) : sum;
}
const isCapped = (r: DeckRating): boolean => r.rating < Math.round(r.subscores.reduce((a, s) => a + s.weight * s.value, 0));

/** One copy of `out` replaced by one copy of `into`. */
export function swapOne(deck: Deck, out: string, into: string): Deck {
  return addCard(removeCard(deck, out), into);
}

/** Applies swaps in order. A swap whose `out` card is no longer in the main deck is skipped. */
export function applySwaps(deck: Deck, swaps: SwapProposal[]): Deck {
  let d = deck;
  for (const s of swaps) {
    if (!d.main.some((e) => e.oracleId === s.out && qtyOf(e) >= 1)) continue;
    d = swapOne(d, s.out, s.in);
  }
  return d;
}

function basicCandidates(pool: Pool, ctx: EngineContext): Candidate[] {
  const out: Candidate[] = [];
  for (const k of [...COLORS, 'C'] as (Color | 'C')[]) {
    const card = pool.basics[k];
    if (!card) continue;
    if (k === 'C' ? pool.identity.length > 0 : !pool.identity.includes(k) && !pool.splash.includes(k)) continue;
    const f = ctx.db.features(card.oracleId);
    if (f) out.push({ card, f, land: true, jitter: 0, base: 0, adjust: 0, theme: 0, kind: { member: false, generic: false, spell: false, creature: false, fast: false } });
  }
  return out;
}

/** The first `n` candidates of a ranked list that the deck does not hold yet. */
function firstFree(list: Candidate[], have: Set<string>, n: number, pred: (c: Candidate) => boolean = () => true): Candidate[] {
  const out: Candidate[] = [];
  for (const c of list) {
    if (have.has(c.card.oracleId) || !pred(c)) continue;
    out.push(c);
    if (out.length >= n) break;
  }
  return out;
}

/**
 * Text of a card that really keeps graveyards in check: it empties one, exiles any card from one,
 * or stops cards getting there. A card that exiles one creature card to copy it (Dino DNA) carries
 * the role but is no answer to a graveyard deck, and is not brought in as one.
 */
const GRAVEYARD_HATE = /exiles? (?:all|each|target player's|that player's|up to \w+ target cards? from|any number of target cards? from)[^.]*graveyards?|exiles? all graveyards|exiles? target card from a graveyard|exiles? (?:a|two|three) cards? from (?:their|a|target player's) graveyard|would be put into (?:a|an opponent's|your opponents'|any) graveyard[^.]*exile|cards? in graveyards? (?:can't|lose all)|can't (?:cast spells|cast cards) from (?:their )?graveyards?|shuffles? (?:their|his or her|all) graveyards? into/i;

/** True for a card that keeps graveyards in check, by its text (see `GRAVEYARD_HATE`). */
export const isGraveyardHate = (oracleText: string): boolean => GRAVEYARD_HATE.test(oracleText);
/** Cards that win on a condition of their own (Laboratory Maniac, Approach of the Second Sun). */
const ALT_WIN = /\byou win the game\b/i;

function matches(c: Candidate, filter: Filter): boolean {
  const { f, card, land } = c;
  if (filter.role === 'graveyard-hate' && !GRAVEYARD_HATE.test(card.oracleText)) return false;
  if (filter.land && !land) return false;
  if (filter.color) {
    if (!land || !((f.sources[filter.color] ?? 0) > 0)) return false;
  }
  if (filter.role) {
    if (filter.role === 'land' ? !land : land || !f.roles.includes(filter.role)) return false;
  }
  if (filter.axis) {
    const hit = (axis: string) => {
      const a = f.axes[axis];
      return a !== undefined && Math.max(a.e, a.p) >= AXIS_MEMBER;
    };
    const ok = filter.axis === 'typal' ? Object.keys(f.axes).some((k) => (k === 'typal' || k.startsWith('typal:')) && hit(k)) : hit(filter.axis);
    if (!ok || land) return false;
  }
  if (filter.maxMv !== undefined && (land || !(card.cmc <= filter.maxMv))) return false;
  return true;
}

/** Best-scoring candidates for the deck that pass `pred` and are not already in it (basics may repeat). */
function bestOf(cands: Iterable<Candidate>, scorer: Scorer, have: Set<string>, n: number, pred: (c: Candidate) => boolean): { c: Candidate; score: number }[] {
  const top: { c: Candidate; score: number }[] = [];
  for (const c of cands) {
    if ((have.has(c.card.oracleId) && !isBasicLand(c.card)) || !pred(c)) continue;
    const s = scorer.score(c.card);
    if (s.gate) continue;
    const score = s.score + c.jitter + c.adjust;
    if (top.length === n && score <= top[n - 1].score) continue;
    top.push({ c, score });
    top.sort((a, b) => b.score - a.score || (a.c.card.oracleId < b.c.card.oracleId ? -1 : 1));
    if (top.length > n) top.length = n;
  }
  return top;
}

/** Rules the plan puts on what may come in: a typal deck at its cap of any-type typal cards takes no more. */
function planFilter(deck: Deck, ctx: EngineContext, pool: Pool): (c: Candidate) => boolean {
  const tally = tallyDeck(deck, ctx, pool.plan);
  const full = tally.generic >= pool.plan.genericTypalCap;
  const tutors = tally.tutors >= pool.plan.tutorCap;
  return (c) => !(full && c.kind.generic) && !(tutors && c.kind.tutor === true);
}

/**
 * The best legal card to take the place of `out` (already removed from `deck`): same role first,
 * a land for a land, else the best card of any kind.
 */
export function bestReplacement(
  deck: Deck, ctx: EngineContext, pool: Pool, out: { card?: Card; f?: CardFeatures }, allow: (c: Candidate) => boolean = () => true,
): Candidate | null {
  const scorer = createScorer(deck, ctx);
  const have = new Set([...deck.commanders, ...deck.main.map((e) => e.oracleId)]);
  const fits = planFilter(deck, ctx, pool);
  const only = (c: Candidate) => fits(c) && allow(c);
  const wasLand = out.f ? isLandCard(out.f) : false;
  if (wasLand) {
    const top = bestOf([...firstFree(pool.fixers, have, 3), ...basicCandidates(pool, ctx)], scorer, have, 1, () => true);
    if (top[0]) return top[0].c;
  }
  const roles: Role[] = (out.f?.roles ?? []).filter((r) => r !== 'land' && r !== 'game-changer' && r !== 'mass-land-denial' && r !== 'extra-turn');
  if (roles.length > 0) {
    const top = bestOf(pool.nonland, scorer, have, 1, (c) => only(c) && c.f.roles.some((r) => roles.includes(r)));
    if (top[0]) return top[0].c;
  }
  const any = bestOf(pool.nonland, scorer, have, 1, only);
  if (any[0]) return any[0].c;
  return bestOf(basicCandidates(pool, ctx), scorer, have, 1, () => true)[0]?.c ?? null;
}

/**
 * The next card to cut for a rule or target-bracket violation, with the violation, or null when
 * nothing removable is at fault. `keep` holds ids that may not be cut.
 */
export function nextOffender(deck: Deck, ctx: EngineContext, keep: Set<string>): { id: string; violation: Violation } | null {
  const removable = (id: string) => !keep.has(id) && deck.main.some((e) => e.oracleId === id && !e.locked && qtyOf(e) >= 1);
  for (const v of validateDeck(deck, ctx.db)) {
    if (v.code === 'size') continue;
    const id = v.oracleIds.find(removable);
    if (id) return { id, violation: v };
  }
  const report = analyzeBracket(deck, ctx);
  const target = Math.min(5, Math.max(1, Math.round(Number(deck.targetBracket) || 3)));
  const allowed = target <= 2 ? 2 : Math.min(4, target);
  const lists: Violation[] = [
    ...report.violationsOfTarget,
    ...report.reasons.filter((r) => r.floor > allowed).map((r) => ({ code: 'bracket', message: r.text, oracleIds: r.oracleIds })),
  ];
  for (const v of lists) {
    // Cut the piece the deck will miss least: an offender's own score is gated to 0, so the least
    // played one goes.
    let best: string | null = null;
    let worstRank = -1;
    for (const id of v.oracleIds) {
      if (!removable(id)) continue;
      const rank = ctx.db.get(id)?.edhrecRank ?? Infinity;
      if (rank > worstRank) { worstRank = rank; best = id; }
    }
    if (best) return { id: best, violation: v };
  }
  return null;
}

/** Nonland cards on one axis from which a deck is taken to have that axis as a plan of its own... */
const SIDE_THEME_CARDS = 6;
/** ...when that is at least this many times what a random pile from the legal pool would show. */
const SIDE_THEME_LIFT = 3;
/** Strength that counts toward a side theme (above plain membership of a card type). */
const SIDE_THEME_STRENGTH = 0.6;

const memberOf = (f: CardFeatures, axis: string): boolean => {
  const a = f.axes[axis];
  return a !== undefined && Math.max(a.e, a.p) >= SIDE_THEME_STRENGTH;
};

const poolShares = new WeakMap<CardDb, { all: readonly Card[]; shares: Map<string, number> }>();
/** Share of the legal nonland pool on each axis, cached per database. */
function axisShares(db: CardDb): Map<string, number> {
  const all = db.all();
  const hit = poolShares.get(db);
  if (hit && hit.all === all) return hit.shares;
  const counts = new Map<string, number>();
  let n = 0;
  for (const card of all) {
    const f = db.features(card.oracleId);
    if (!f || isLandCard(f)) continue;
    n++;
    for (const axis in f.axes) if (memberOf(f, axis)) counts.set(axis, (counts.get(axis) ?? 0) + 1);
  }
  const shares = new Map<string, number>();
  for (const [axis, c] of counts) shares.set(axis, c / Math.max(1, n));
  poolShares.set(db, { all, shares });
  return shares;
}

/**
 * Plans the deck follows that its theme weights do not name: axes on which six or more of its
 * nonland cards sit, at three times the rate of the legal pool or more (seven Shapeshifters in a
 * clone deck, a dozen mana Elves under a commander that only says "mana"). The scorer rates such
 * cards as off-theme, so without this the deck's "weakest cards" would be its own plan.
 */
export function sideThemes(deck: Deck, ctx: EngineContext): Set<string> {
  const commanders = new Set(deck.commanders);
  const counts = new Map<string, number>();
  let nonland = 0;
  for (const { card, features, qty } of deckCards(deck, ctx.db).cards) {
    if (commanders.has(card.oracleId) || isLandCard(features)) continue;
    nonland += qty;
    for (const axis in features.axes) {
      if (axis !== 'typal' && memberOf(features, axis)) counts.set(axis, (counts.get(axis) ?? 0) + qty);
    }
  }
  const shares = axisShares(ctx.db);
  const out = new Set<string>();
  for (const [axis, n] of counts) {
    if (n >= SIDE_THEME_CARDS && n >= SIDE_THEME_LIFT * (shares.get(axis) ?? 0) * nonland) out.add(axis);
  }
  return out;
}

/** Cards of a combo the deck holds in full: the scorer gives combo pieces no credit, so they are never offered as cuts. */
export function comboPieces(deck: Deck, ctx: EngineContext): Set<string> {
  const ids = new Set<string>();
  for (const found of findCombos(deck, ctx.db).included) {
    if (!found.relevant) continue;
    for (const piece of found.combo.cards) ids.add(piece.oracleId);
  }
  return ids;
}

interface ClimbOptions {
  maxSwaps: number;
  evalBudget: number;
  /**
   * `improveDeck` sets this: a step that finds no gain among its first trials goes on through the
   * rating's other shortfalls, and then tries runs of the same swap (see `PLATEAU_MAX`).
   */
  thorough?: boolean;
}

interface Out { id: string; name: string; score: number; land: boolean; basic: boolean; cmc: number; qty: number; themed: boolean }
interface Trial { into: Candidate; out: string; reason: string; minGain: number }

/** Sources of each colour the deck's most demanding spell needs (Karsten), and what it holds. */
function colourBalance(deck: Deck, ctx: EngineContext): Record<Color, { need: number; have: number }> {
  const out = Object.fromEntries(COLORS.map((c) => [c, { need: 0, have: 0 }])) as Record<Color, { need: number; have: number }>;
  const { cards } = deckCards(deck, ctx.db);
  for (const { card, features, qty } of cards) {
    for (const c of COLORS) {
      out[c].have += (features.sources[c] ?? 0) * qty;
      if (isLandCard(features)) continue;
      const p = features.pips[c] ?? 0;
      if (p > 0) out[c].need = Math.max(out[c].need, karstenSources(p, card.cmc));
    }
  }
  return out;
}
const deckQty = (deck: Deck, id: string): number =>
  (deck.commanders.includes(id) ? 1 : 0) + deck.main.reduce((n, e) => n + (e.oracleId === id ? qtyOf(e) : 0), 0);

const COLOR_NAME: Record<Color, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

/**
 * The cards a deck may give up, weakest first, and the ones it may not: locked and kept cards,
 * pieces of a combo it holds, cards of a plan of its own (`sideThemes`), and its strong on-theme
 * cards (theme fit 0.5 and a score of 45 or more). When the deck holds well over its bracket's
 * count of theme cards, the weakest of the surplus are offered after all, marked `themed`: cutting
 * one of those has to earn a full rating point.
 */
function cuttable(deck: Deck, ctx: EngineContext, pool: Pool, keep: Set<string>, combo: Set<string>, scorer: Scorer): Out[] {
  const { db } = ctx;
  const side = sideThemes(deck, ctx);
  const outs: Out[] = [];
  const guarded: Out[] = [];
  const seen = new Set<string>();
  let onTheme = 0;
  for (const e of deck.main) {
    if (qtyOf(e) < 1 || seen.has(e.oracleId)) continue;
    seen.add(e.oracleId);
    const card = db.get(e.oracleId);
    const f = card ? db.features(e.oracleId) : undefined;
    const qty = deckQty(deck, e.oracleId);
    const free = deck.main.some((x) => x.oracleId === e.oracleId && !x.locked && qtyOf(x) >= 1) && !keep.has(e.oracleId);
    if (!card || !f) {
      if (free) outs.push({ id: e.oracleId, name: 'an unknown card', score: -1, land: false, basic: false, cmc: 0, qty, themed: false });
      continue;
    }
    const land = isLandCard(f);
    const themed = !land && themeFit(f, pool.weights) >= ON_THEME;
    if (themed) onTheme += qty;
    if (!free || combo.has(e.oracleId)) continue;
    const o: Out = { id: e.oracleId, name: card.name, score: scorer.score(card).score, land, basic: isBasicLand(card), cmc: card.cmc, qty, themed };
    if (!land && [...side].some((axis) => memberOf(f, axis))) continue;
    if (themed && o.score >= STRONG_THEME_SCORE) { guarded.push(o); continue; }
    outs.push({ ...o, themed: false });
  }
  const summary = summarizeDeck(deck, db);
  const want = scaleTargets(targetsFor(deck, ctx, summary), summary.cardCount).themeCards;
  let spare = Math.max(0, onTheme - want - THEME_SURPLUS);
  guarded.sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : 1));
  for (const o of guarded) {
    if (spare <= 0) break;
    outs.push(o);
    spare -= o.qty;
  }
  outs.sort((a, b) => a.score - b.score || (a.id < b.id ? -1 : 1));
  return outs;
}

/**
 * Bounded hill-climb (spec §12 step 5): each step reads the rating's largest shortfalls, tries the
 * best cards that fix them against the cards the deck can best give up, and keeps the single swap
 * that raises the rating most. Stops when nothing helps, or at the swap or evaluation budget.
 *
 * Every swap has to make sense on its own, whatever the rating says:
 * - a spell comes in for a spell only when it scores higher for this deck (by `SWAP_MARGIN`);
 * - a spell comes in for a land only when the deck holds more lands than its curve wants, and a
 *   land for a spell only when it holds fewer;
 * - a land for a colour replaces a land the deck can spare: a basic of a colour it has enough of,
 *   or one the new land covers;
 * - strong on-theme cards, combo pieces and the deck's own side plans are not cut (`cuttable`).
 * Reasons state the shortfall being fixed and the numbers the swap was chosen on.
 *
 * A badly built deck can sit on flat ground (60 lands where 37 are wanted: one swap does not move
 * the rating). In `thorough` mode a step that finds no single swap repeats the swap for one
 * shortfall up to `PLATEAU_MAX` times and keeps the run if the rating ends higher and never fell
 * on the way; the swaps of such a run before its last report an unchanged rating.
 */
export function climb(start: Deck, ctx: EngineContext, pool: Pool, keep: Set<string>, o: ClimbOptions): { deck: Deck; swaps: SwapProposal[] } {
  const { db } = ctx;
  let deck = start;
  let evals = 0;
  const swaps: SwapProposal[] = [];
  const basics = basicCandidates(pool, ctx);
  const combo = comboPieces(start, ctx);

  /** Lands over the deck's land target (negative when short). */
  const landSurplus = (d: Deck): number => {
    const summary = summarizeDeck(d, db);
    return summary.landsEffective - scaleTargets(targetsFor(d, ctx, summary), summary.cardCount).lands;
  };
  const wantsLand = (filter: Filter): boolean => filter.land === true || filter.color !== undefined || filter.role === 'land';
  const makesColour = (id: string, color: Color): boolean => (db.features(id)?.sources[color] ?? 0) > 0;
  const basicColour = (id: string): Color | null => COLORS.find((c) => pool.basics[c]?.oracleId === id) ?? null;

  /**
   * The swaps worth rating for one shortfall of the deck `d`, best guess first.
   * `fixText` is the rating's own sentence for the shortfall.
   */
  const trialsFor = (d: Deck, scorer: Scorer, outs: Out[], fixText: string, filter: Filter, perFix: number): Trial[] => {
    const have = new Set([...d.commanders, ...d.main.map((e) => e.oracleId)]);
    const fits = planFilter(d, ctx, pool);
    const surplus = landSurplus(d);
    const spells = outs.filter((x) => !x.land);
    const trials: Trial[] = [];
    const gainFor = (x: Out) => (x.themed ? THEME_CUT_GAIN : MIN_GAIN);

    if (wantsLand(filter)) {
      const ins: Candidate[] = [
        ...firstFree(pool.fixers, have, perFix, (x) => matches(x, filter) && !scorer.score(x.card).gate),
        ...bestOf(basics, scorer, have, 1, (x) => matches(x, filter)).map((x) => x.c),
      ];
      const balance = filter.color ? colourBalance(d, ctx) : null;
      for (const c of ins) {
        const inId = c.card.oracleId;
        if (surplus <= -1 && !filter.color) {
          // Short of lands: the land takes the place of the deck's lowest-scoring spell.
          const x = spells[0];
          if (x) trials.push({ into: c, out: x.id, minGain: gainFor(x), reason: `${fixText} ${x.name} is the lowest-scoring spell the deck can give up (${Math.max(0, x.score)}).` });
          continue;
        }
        // Otherwise a land replaces a land the deck can spare.
        const landOuts = outs.filter((x) => x.land && x.id !== inId);
        const spare: { x: Out; why: string; rank: number }[] = [];
        for (const x of landOuts) {
          const col = x.basic ? basicColour(x.id) : null;
          if (filter.color && makesColour(x.id, filter.color)) continue;
          if (col && balance) {
            const b = balance[col];
            if (makesColour(inId, col)) spare.push({ x, why: `${c.card.name} also makes ${COLOR_NAME[col]}, so the ${x.name} it replaces costs nothing.`, rank: 0 });
            else if (b.have - 1 >= b.need) spare.push({ x, why: `${x.name} can go: ${Math.round(b.have)} ${COLOR_NAME[col]} sources where ${Math.ceil(b.need)} are needed.`, rank: 1 - (b.have - b.need) / 100 });
          } else if (!x.basic && !c.card.typeLine.includes('Basic') && scorer.score(c.card).score >= x.score + SWAP_MARGIN) {
            spare.push({ x, why: `${x.name} is the deck's lowest-scoring land (${Math.max(0, x.score)}).`, rank: 2 });
          } else if (x.basic && !filter.color && !c.card.typeLine.includes('Basic')) {
            spare.push({ x, why: `${c.card.name} takes the place of a ${x.name}.`, rank: 3 - x.qty / 100 });
          }
        }
        spare.sort((a, b) => a.rank - b.rank || a.x.score - b.x.score || (a.x.id < b.x.id ? -1 : 1));
        for (const { x, why } of spare.slice(0, 2)) trials.push({ into: c, out: x.id, minGain: MIN_GAIN, reason: `${fixText} ${why}` });
      }
      return trials;
    }

    // "You win the game" cards answer a shortage of win conditions only in a deck built for them.
    const sensible = (x: Candidate): boolean => filter.role !== 'win-condition' || !ALT_WIN.test(x.card.oracleText)
      || x.theme >= ON_THEME || scorer.score(x.card).reasons.some((r) => /combo/i.test(r));
    const ins = bestOf(pool.nonland, scorer, have, perFix, (x) => fits(x) && matches(x, filter) && sensible(x));
    for (const { c, score } of ins) {
      const shown = Math.round(score - c.jitter - c.adjust);
      if (surplus >= 1.5) {
        // More lands than the curve wants: the spell takes the place of a land.
        const land = outs.filter((x) => x.basic).sort((a, b) => b.qty - a.qty || (a.id < b.id ? -1 : 1))[0] ?? outs.find((x) => x.land);
        if (land) trials.push({ into: c, out: land.id, minGain: MIN_GAIN, reason: `${fixText} The deck holds ${Math.round(surplus)} more lands than its curve wants, so a ${land.name} makes room.` });
      }
      const cands = filter.maxMv !== undefined ? spells.filter((x) => x.cmc > filter.maxMv!) : spells;
      let n = 0;
      for (const x of cands) {
        if (n >= NONLAND_OUTS) break;
        if (shown < x.score + SWAP_MARGIN) break; // outs are weakest first: nothing further down is beaten either
        n++;
        trials.push({ into: c, out: x.id, minGain: gainFor(x), reason: `${fixText} ${c.card.name} scores ${shown} for this deck, ${x.name} ${Math.max(0, x.score)}.` });
      }
    }
    return trials;
  };

  /** The best card the deck does not hold against its weakest: no shortfall asked for it, so it must win clearly. */
  const genericTrials = (d: Deck, scorer: Scorer, outs: Out[]): Trial[] => {
    const have = new Set([...d.commanders, ...d.main.map((e) => e.oracleId)]);
    const fits = planFilter(d, ctx, pool);
    const trials: Trial[] = [];
    const spells = outs.filter((x) => !x.land && !x.themed).slice(0, NONLAND_OUTS);
    const surplus = landSurplus(d);
    for (const { c, score } of bestOf(pool.nonland, scorer, have, GENERIC_INS, fits)) {
      const shown = Math.round(score - c.jitter - c.adjust);
      for (const x of spells) {
        if (shown >= x.score + GENERIC_MARGIN) trials.push({ into: c, out: x.id, minGain: MIN_GAIN, reason: `${c.card.name} scores ${shown} for this deck against ${Math.max(0, x.score)} for ${x.name}.` });
      }
      if (surplus >= 1.5) {
        const land = outs.filter((x) => x.basic).sort((a, b) => b.qty - a.qty || (a.id < b.id ? -1 : 1))[0] ?? outs.find((x) => x.land);
        if (land) trials.push({ into: c, out: land.id, minGain: MIN_GAIN, reason: `The deck holds ${Math.round(surplus)} more lands than its curve wants: ${c.card.name} (scores ${shown} for this deck) takes the place of a ${land.name}.` });
      }
    }
    return trials;
  };

  while (swaps.length < o.maxSwaps && evals < o.evalBudget) {
    const rating = rateDeck(deck, ctx);
    const cur = fineRating(rating);
    const shownCur = shownRating(rating);
    // A deck that already sits at the illegal cap cannot rate higher until it is legal: no swap can show a gain.
    if (isCapped(rating)) break;
    const scorer = createScorer(deck, ctx);
    const outs = cuttable(deck, ctx, pool, keep, combo, scorer);

    // Cards that may come in: the best answers to the rating's largest shortfalls, then the best overall.
    const fixes: { fix: Fix; filter: Filter }[] = [];
    const keys = new Set<string>();
    for (const s of [...rating.subscores].sort((a, b) => b.weight * (1 - b.value) - a.weight * (1 - a.value))) {
      for (const fix of s.fixes) {
        if (!fix.filter) continue;
        const key = JSON.stringify(fix.filter);
        if (keys.has(key)) continue;
        keys.add(key);
        fixes.push({ fix, filter: fix.filter });
      }
    }

    type Won = { deck: Deck; value: number; shown: number; t: Trial };
    let best: Won | null = null;
    let rated = 0;
    const tried = new Set<string>();
    const rate = (group: Trial[], cap: number) => {
      for (const t of group) {
        if (evals >= o.evalBudget || rated >= cap) break;
        const key = `${t.into.card.oracleId}>${t.out}`;
        if (t.into.card.oracleId === t.out || tried.has(key)) continue;
        tried.add(key);
        const next = swapOne(deck, t.out, t.into.card.oracleId);
        const r = rateDeck(next, ctx);
        evals++;
        rated++;
        const value = fineRating(r);
        const shown = shownRating(r);
        if (value < cur + t.minGain || shown <= shownCur) continue;
        if (!best || value > best.value) best = { deck: next, value, shown, t };
      }
    };
    for (const { fix, filter } of fixes.slice(0, FIXES_PER_STEP)) rate(trialsFor(deck, scorer, outs, fix.text, filter, INS_PER_FIX), TRIALS_PER_STEP);
    rate(genericTrials(deck, scorer, outs), TRIALS_PER_STEP);
    if (o.thorough) {
      // Nothing yet: the other shortfalls, one at a time, until one of them gives.
      for (const { fix, filter } of fixes.slice(FIXES_PER_STEP)) {
        if (best !== null || evals >= o.evalBudget) break;
        rate(trialsFor(deck, scorer, outs, fix.text, filter, INS_PER_FIX), Infinity);
      }
    }
    const won = best as Won | null;
    if (won) {
      swaps.push({ out: won.t.out, in: won.t.into.card.oracleId, reason: won.t.reason, ratingBefore: shownCur, ratingAfter: won.shown });
      deck = won.deck;
      continue;
    }
    if (!o.thorough || cur >= PLATEAU_BELOW) break;

    // Flat ground: a run of the same kind of swap for one shortfall.
    let run: { deck: Deck; steps: SwapProposal[] } | null = null;
    for (const { fix, filter } of fixes.slice(0, FIXES_PER_STEP)) {
      let d = deck;
      let prev = cur;
      let prevShown = shownCur;
      const steps: SwapProposal[] = [];
      let ok = false;
      for (let k = 0; k < PLATEAU_MAX && swaps.length + steps.length < o.maxSwaps && evals < o.evalBudget; k++) {
        const sc = k === 0 ? scorer : createScorer(d, ctx);
        const t = trialsFor(d, sc, k === 0 ? outs : cuttable(d, ctx, pool, keep, combo, sc), fix.text, filter, 1)[0];
        if (!t || t.out === t.into.card.oracleId) break;
        const next = swapOne(d, t.out, t.into.card.oracleId);
        const r = rateDeck(next, ctx);
        evals++;
        const value = fineRating(r);
        const shown = shownRating(r);
        if (value < prev - 1e-9 || shown < prevShown) break;
        steps.push({ out: t.out, in: t.into.card.oracleId, reason: t.reason, ratingBefore: prevShown, ratingAfter: shown });
        d = next;
        prev = value;
        prevShown = shown;
        if (value >= cur + MIN_GAIN && shown > shownCur) { ok = true; break; }
      }
      if (ok) { run = { deck: d, steps }; break; }
    }
    if (!run) break;
    swaps.push(...run.steps);
    deck = run.deck;
  }
  return { deck, swaps };
}

/**
 * Swap proposals for a deck (spec §12 "Improve deck"): first one cut per rule or target-bracket
 * violation, each replaced by the best legal card in the same role, then the hill-climb's swaps,
 * best gain first at every step. Ratings are those of the deck with all earlier proposals applied
 * (unrounded, to one decimal: see `shownRating`), so applying the list in order is valid. No
 * proposal lowers the rating. Two kinds leave it unchanged: a repair while the deck is still
 * illegal (an illegal deck is capped at 40 whatever else it holds), and the earlier swaps of a run
 * across flat ground (see `climb`), which always ends higher. Locked cards are never cut. Never throws.
 */
export function improveDeck(deck: Deck, ctx: EngineContext, opts: BuildOptions, max: number = MAX_PROPOSALS): SwapProposal[] {
  const limit = Math.max(0, Math.floor(Number.isFinite(max) ? max : MAX_PROPOSALS));
  if (limit === 0) return [];
  const pool = buildPool(deck, ctx, opts);
  const keep = new Set(deck.main.filter((e) => e.locked).map((e) => e.oracleId));
  const proposals: SwapProposal[] = [];
  let current = deck;

  while (proposals.length < limit) {
    const off = nextOffender(current, ctx, keep);
    if (!off) break;
    const without = removeCard(current, off.id);
    const into = bestReplacement(without, ctx, pool, { card: ctx.db.get(off.id), f: ctx.db.features(off.id) });
    if (!into) break;
    const next = addCard(without, into.card.oracleId);
    proposals.push({
      out: off.id, in: into.card.oracleId, reason: off.violation.message,
      ratingBefore: shownRating(rateDeck(current, ctx)), ratingAfter: shownRating(rateDeck(next, ctx)),
    });
    current = next;
  }

  const rest = limit - proposals.length;
  if (rest > 0) {
    proposals.push(...climb(current, ctx, pool, keep, { maxSwaps: rest, evalBudget: IMPROVE_EVALS, thorough: true }).swaps);
  }
  return proposals;
}

/**
 * For the deck's lowest-scored unlocked cards, the best replacement in the same role (a land for a
 * land). Each proposal stands alone: its ratings are for that one swap on the deck as given. A swap
 * that would lower the rating is left out.
 */
export function suggestSwaps(deck: Deck, ctx: EngineContext, opts: BuildOptions, count = 5): SwapProposal[] {
  const n = Math.max(0, Math.floor(Number.isFinite(count) ? count : 5));
  if (n === 0) return [];
  const { db } = ctx;
  const pool = buildPool(deck, ctx, opts);
  const scorer = createScorer(deck, ctx);
  const combo = comboPieces(deck, ctx);
  const keep = new Set(deck.main.filter((e) => e.locked).map((e) => e.oracleId));
  // The same cards `improveDeck` may cut: no combo pieces, side plans or strong on-theme cards.
  const weakest = cuttable(deck, ctx, pool, keep, combo, scorer)
    .filter((x) => !x.basic && !x.themed)
    .map((x) => ({ id: x.id, score: x.score, card: db.get(x.id), f: db.features(x.id) }));

  const before = shownRating(rateDeck(deck, ctx));
  const out: SwapProposal[] = [];
  let current = deck; // earlier picks count as taken, so no card is proposed twice
  let rated = 0;
  for (const w of weakest) {
    if (out.length >= n || rated >= n * SUGGEST_TRIES) break;
    const without = removeCard(current, w.id);
    const into = bestReplacement(without, ctx, pool, w);
    if (!into) continue;
    const inScore = createScorer(removeCard(deck, w.id), ctx).score(into.card).score;
    if (inScore < w.score + SWAP_MARGIN) continue;
    // A card can score higher and still leave the deck worse off (its curve, its creature count):
    // such a swap is not suggested.
    const after = shownRating(rateDeck(swapOne(deck, w.id, into.card.oracleId), ctx));
    rated++;
    if (after < before) continue;
    const role = w.f && isLandCard(w.f) ? 'land' : (w.f?.roles.find((r) => into.f.roles.includes(r)) ?? null);
    out.push({
      out: w.id, in: into.card.oracleId,
      reason: `${into.card.name} scores ${inScore} for this deck against ${Math.max(0, w.score)} for ${w.card?.name ?? 'an unknown card'}${role ? ` (same role: ${role})` : ''}.`,
      ratingBefore: before,
      ratingAfter: after,
    });
    current = addCard(without, into.card.oracleId);
  }
  return out;
}
