import { analyzeBracket } from '../brackets';
import { rateDeck } from '../rating';
import { validateDeck } from '../rules';
import { createScorer } from '../scoring';
import { AXIS_MEMBER, isLandCard, resolveThemeWeights, summarizeDeck } from '../summary';
import { ROLE_LABEL, ROLE_TARGET_MAX, roleNeeds, scaleTargets, targetsFor } from '../targets';
import type { AxisId, Bracket, BuildOptions, CardFeatures, Color, Deck, EngineContext, ImproveGoals, Role, SwapProposal } from '../types';
import {
  COLOR_NAME, MAX_PROPOSALS, applySwaps, basicCandidates, bestOf, bestReplacement, colourBalance, comboPieces, cuttable, improveDeck as improvePlain,
  matches, nextOffender, planFilter, shownRating, swapOne,
} from './improve';
import type { Out } from './improve';
import { COLORS, RELIABLE_SOURCE, addCard, buildPool, deckCount, removeCard } from './pool';
import type { Candidate, Pool } from './pool';

/** Most proposals a directed run may be asked for. */
export const MAX_GOAL_SWAPS = 40;
/** An emphasised role's wanted count: this far above the bottom of its usual band... */
const EMPHASIS_RAISE = 3;
/** ...or this many more than the deck holds, whichever is higher, and never past the band's top plus the raise. */
const EMPHASIS_STEP = 2;
/** What the theme axes that are not emphasised keep of their weight. */
const OTHER_AXES = 0.8;
/** Swaps a goal may force past what the rating asks for (each is checked and may come back with an objection). */
const FORCED_PER_GOAL = 6;
const FORCED_POWER = 6;
const FORCED_THEME = 3;
const FORCED_TRIES = 10;
/** A rating has to fall by more than this for the engine to object. */
const DISSENT = 0.05;
const DECK_SIZE = 100;

/** "a win condition", for reasons. */
const ROLE_ONE: Partial<Record<Role, string>> = {
  ramp: 'a ramp piece', draw: 'a card-draw source', 'spot-removal': 'a removal spell', counterspell: 'a counterspell',
  wipe: 'a board wipe', protection: 'a protection piece', recursion: 'a recursion piece', tutor: 'a tutor',
  'win-condition': 'a win condition', 'graveyard-hate': 'a graveyard-hate piece', land: 'a land',
};
/** Roles `addOne` takes. */
export const ADD_ONE_ROLES: readonly Role[] = ['land', ...(Object.keys(ROLE_LABEL) as Role[])];

const axisName = (axis: AxisId): string => (axis.startsWith('typal:') ? `${axis.slice(6)} typal` : axis.replace(/-/g, ' '));
const sentence = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);
const onAxis = (f: CardFeatures | undefined, axis: AxisId): boolean => {
  const a = f?.axes[axis];
  return a !== undefined && Math.max(a.e, a.p) >= AXIS_MEMBER;
};

interface Goals { maxSwaps: number | null; bracket: Bracket; bracketChanged: boolean; roles: Role[]; axes: AxisId[] }

function cleanGoals(g: ImproveGoals, deck: Deck): Goals {
  const n = Number(g.maxSwaps);
  const b = Number(g.targetBracket);
  const bracket = ([1, 2, 3, 4, 5].includes(b) ? b : deck.targetBracket) as Bracket;
  const roles = Array.isArray(g.emphasizeRoles) ? [...new Set(g.emphasizeRoles)].filter((r) => ROLE_LABEL[r] !== undefined) : [];
  const axes = Array.isArray(g.emphasizeAxes) ? [...new Set(g.emphasizeAxes)].filter((a) => typeof a === 'string' && a.length > 0).slice(0, 4) : [];
  return {
    maxSwaps: Number.isFinite(n) ? Math.min(MAX_GOAL_SWAPS, Math.max(1, Math.floor(n))) : null,
    bracket, bracketChanged: bracket !== deck.targetBracket, roles, axes,
  };
}

/**
 * The deck a directed run works on: the chosen bracket as its target, the emphasised roles' wanted
 * counts raised (through `Deck.roleTargets`, so scorer, rating and builder all see the same band),
 * and the emphasised theme axes at weight 1 with the others scaled down. The cards are untouched,
 * so swaps found on it apply to the real deck.
 */
export function goalDeck(deck: Deck, ctx: EngineContext, goals: ImproveGoals): Deck {
  const g = cleanGoals(goals, deck);
  let d: Deck = g.bracketChanged ? { ...deck, targetBracket: g.bracket } : deck;
  if (g.roles.length > 0) {
    const summary = summarizeDeck(d, ctx.db);
    const targets = targetsFor(d, ctx, summary);
    const needs = roleNeeds(d, ctx, { summary, targets });
    const roleTargets: NonNullable<Deck['roleTargets']> = { ...(d.roleTargets ?? {}) };
    for (const role of g.roles) {
      const need = needs.find((x) => x.role === role);
      if (!need) continue; // no band for this deck (counterspells outside blue)
      const top = need.band.hi + EMPHASIS_RAISE;
      roleTargets[role] = Math.min(ROLE_TARGET_MAX, top, Math.max(need.band.lo + EMPHASIS_RAISE, need.count + EMPHASIS_STEP));
    }
    d = { ...d, roleTargets };
  }
  if (g.axes.length > 0) {
    const weights: Record<AxisId, number> = {};
    for (const [axis, w] of Object.entries(resolveThemeWeights(d, ctx))) weights[axis] = g.axes.includes(axis) ? 1 : w * OTHER_AXES;
    for (const axis of g.axes) weights[axis] = 1;
    d = { ...d, themeWeights: weights };
  }
  return d;
}

/** Cards that win on a condition of their own (Laboratory Maniac, Luck Bobblehead). */
const ALT_WIN = /\byou win the game\b/i;
/** Theme fit from which such a card belongs to the deck's plan. */
const ON_THEME = 0.5;
/**
 * Asked for a win condition, a deck gets finishers before "you win the game" cards it is not built
 * for: those are only offered when the deck's theme wants them, or when nothing else is left.
 */
const offPlanAltWin = (c: Candidate, role: Role): boolean => role === 'win-condition' && ALT_WIN.test(c.card.oracleText) && c.theme < ON_THEME;

const idsOf = (d: Deck): Set<string> => new Set([...d.commanders, ...d.main.map((e) => e.oracleId)]);
const lockedOf = (d: Deck): Set<string> => new Set(d.main.filter((e) => e.locked).map((e) => e.oracleId));

/**
 * Swap proposals for a deck. Without `opts.goals` this is the plain run (repairs, then the
 * hill-climb; see `improve.ts`). With goals:
 *
 * - `maxSwaps` is a hard cap on the list.
 * - `targetBracket` runs the whole thing toward that bracket: what a lower bracket does not allow is
 *   cut first; toward a higher one stronger cards come in while the deck plays under it.
 * - `emphasizeRoles` raises those roles' bands, `emphasizeAxes` those theme weights (`goalDeck`).
 *   Selection and the proposals' ratings both use the raised targets.
 *
 * Order: repairs, then the swaps the goals ask for (a few are made even where the rating alone
 * would not make them), then the ordinary hill-climb with what is left of the budget. Every
 * proposal is then checked against the deck's usual targets (the chosen bracket, no emphasis): one
 * that lowers that rating, or the run's own, comes back with `agrees: false` and an `objection`
 * that says why. Reasons name the goal a swap serves only when it does. Applying the list in order
 * is valid, locked cards are never cut, and nothing illegal is proposed.
 */
export function improveDeck(deck: Deck, ctx: EngineContext, opts: BuildOptions, max: number = MAX_PROPOSALS): SwapProposal[] {
  if (!opts.goals) return improvePlain(deck, ctx, opts, max);
  const g = cleanGoals(opts.goals, deck);
  const limit = g.maxSwaps ?? Math.max(0, Math.floor(Number.isFinite(max) ? max : MAX_PROPOSALS));
  const plain: BuildOptions = { ...opts, goals: null };
  if (!g.bracketChanged && g.roles.length === 0 && g.axes.length === 0) return improvePlain(deck, ctx, plain, limit);
  if (limit === 0) return [];

  const base: Deck = g.bracketChanged ? { ...deck, targetBracket: g.bracket } : deck;
  const work = goalDeck(deck, ctx, opts.goals);
  const proposals: SwapProposal[] = [];
  let current = work;

  const pool = buildPool(work, ctx, plain);
  const keep = lockedOf(work);
  const combo = comboPieces(work, ctx);
  const tried = new Set<string>();
  const brought = new Set<string>();
  const power = new Set<number>(); // proposals made to raise the deck toward its bracket
  const featuresOf = (id: string) => ctx.db.features(id);
  let tries = 0;

  /** One forced swap: the best card `want` allows for the weakest cuttable spell `spare` allows. */
  const force = (want: (c: Candidate) => boolean, spare: (x: Out) => boolean, why: (into: Candidate, score: number, out: Out) => string, needsLead: boolean): boolean => {
    tries++;
    const scorer = createScorer(current, ctx);
    const fits = planFilter(current, ctx, pool);
    const top = bestOf(pool.nonland, scorer, idsOf(current), 1, (c) => !tried.has(c.card.oracleId) && fits(c) && want(c))[0];
    // Never a card an earlier proposal of this run brought in.
    const out = cuttable(current, ctx, pool, keep, combo, scorer).find((x) => !x.land && !brought.has(x.id) && spare(x));
    if (!top || !out) return false;
    tried.add(top.c.card.oracleId);
    const shown = Math.round(top.score - top.c.jitter - top.c.adjust);
    if (needsLead && shown < out.score) return true; // not worth forcing; try the next card
    const next = swapOne(current, out.id, top.c.card.oracleId);
    const off = nextOffender(next, ctx, keep);
    if (off && off.violation.oracleIds.includes(top.c.card.oracleId)) return true; // would break a rule or the bracket
    brought.add(top.c.card.oracleId);
    proposals.push({
      out: out.id, in: top.c.card.oracleId, reason: why(top.c, shown, out),
      ratingBefore: shownRating(rateDeck(current, ctx)), ratingAfter: shownRating(rateDeck(next, ctx)),
    });
    current = next;
    return true;
  };

  // 1. What breaks a rule or the chosen bracket goes first.
  while (proposals.length < limit) {
    const off = nextOffender(current, ctx, keep);
    if (!off) break;
    const without = removeCard(current, off.id);
    const into = bestReplacement(without, ctx, pool, { card: ctx.db.get(off.id), f: featuresOf(off.id) });
    if (!into) break;
    const next = addCard(without, into.card.oracleId);
    brought.add(into.card.oracleId);
    proposals.push({
      out: off.id, in: into.card.oracleId, reason: off.violation.message,
      ratingBefore: shownRating(rateDeck(current, ctx)), ratingAfter: shownRating(rateDeck(next, ctx)),
    });
    current = next;
  }

  // 2. The roles asked for, one card per role in turn while the deck is short of the raised band.
  const done = new Map<Role, number>();
  const closed = new Set<Role>();
  tries = 0;
  while (proposals.length < limit && closed.size < g.roles.length && tries < FORCED_TRIES * Math.max(1, g.roles.length)) {
    for (const role of g.roles) {
      if (closed.has(role) || proposals.length >= limit) continue;
      const need = roleNeeds(current, ctx).find((x) => x.role === role);
      if (!need || need.short <= 0 || (done.get(role) ?? 0) >= FORCED_PER_GOAL) { closed.add(role); continue; }
      const one = ROLE_ONE[role] ?? role;
      const before = proposals.length;
      const ok = force(
        (c) => matches(c, { role }) && !offPlanAltWin(c, role),
        (x) => !(featuresOf(x.id)?.roles.includes(role)),
        (into, score, out) => `${sentence(need.label)}: ${need.count} held, this run asks for ${need.band.lo}. ${into.card.name} scores ${score} for this deck; ${out.name} (${Math.max(0, out.score)}) is the weakest card that is not ${one}.`,
        false,
      );
      if (!ok) closed.add(role);
      else if (proposals.length > before) done.set(role, (done.get(role) ?? 0) + 1);
    }
  }

  if (g.bracketChanged && g.bracket >= 3) {
    const start = proposals.length;
    tries = 0;
    while (proposals.length < limit && proposals.length - start < FORCED_POWER && tries < FORCED_TRIES) {
      const plays = analyzeBracket(current, ctx).playsLike;
      if (plays >= g.bracket) break;
      const before = proposals.length;
      const ok = force(
        (c) => c.f.powerTier >= 4,
        (x) => (featuresOf(x.id)?.powerTier ?? 1) <= 2,
        (into, score, out) => `The deck plays like Bracket ${plays}, under the Bracket ${g.bracket} it is aimed at. ${into.card.name} (power tier ${into.f.powerTier}${into.card.gameChanger ? ', a Game Changer' : ''}, scores ${score}) takes the place of ${out.name} (${Math.max(0, out.score)}), its weakest low-power card.`,
        false,
      );
      if (!ok) break;
      if (proposals.length > before) power.add(proposals.length - 1);
    }
  }

  for (const axis of g.axes) {
    if (proposals.some((p) => onAxis(featuresOf(p.in), axis) && !onAxis(featuresOf(p.out), axis))) continue;
    const start = proposals.length;
    tries = 0;
    while (proposals.length < limit && proposals.length - start < FORCED_THEME && tries < FORCED_TRIES) {
      const ok = force(
        (c) => matches(c, { axis }),
        (x) => !onAxis(featuresOf(x.id), axis),
        (into, score, out) => `${into.card.name} scores ${score} for this deck with ${axisName(axis)} weighted up; ${out.name} (${Math.max(0, out.score)}) is its weakest card off that theme.`,
        true,
      );
      if (!ok) break;
    }
  }

  // 3. The rest of the budget goes to the ordinary run, on the same raised targets.
  // Cards the goals just brought in are not offered as cuts again.
  if (proposals.length < limit) {
    const guarded: Deck = { ...current, main: current.main.map((e) => (brought.has(e.oracleId) ? { ...e, locked: true } : e)) };
    proposals.push(...improvePlain(guarded, ctx, plain, limit - proposals.length));
  }

  // Every proposal says which goal it serves, and is held against the deck's usual targets.
  let usual = base;
  let usualRating = shownRating(rateDeck(usual, ctx));
  return proposals.slice(0, limit).map((p, i) => {
    const inF = featuresOf(p.in);
    const outF = featuresOf(p.out);
    const tags: string[] = [];
    const served: Role[] = [];
    for (const role of g.roles) {
      if (inF?.roles.includes(role) && !outF?.roles.includes(role) && !(inF && isLandCard(inF))) {
        served.push(role);
        tags.push(`adds ${ROLE_ONE[role] ?? role} (goal: more ${ROLE_LABEL[role] ?? role})`);
      }
    }
    for (const axis of g.axes) {
      if (onAxis(inF, axis) && !onAxis(outF, axis)) tags.push(`on theme where the card it replaces is not (goal: lean into ${axisName(axis)})`);
    }
    if (g.bracketChanged) {
      const off = nextOffender(usual, ctx, keep);
      const rules = validateDeck(usual, ctx.db).some((v) => v.code !== 'size' && v.oracleIds.includes(p.out));
      if (off && off.id === p.out && !rules) tags.push(`cuts a card Bracket ${g.bracket} does not allow (goal: Bracket ${g.bracket})`);
      else if (power.has(i)) tags.push(`raises the deck's power (goal: Bracket ${g.bracket})`);
    }
    const next = applySwaps(usual, [p]);
    const nextRating = shownRating(rateDeck(next, ctx));
    const objections: string[] = [];
    if (nextRating < usualRating - DISSENT) {
      objections.push(`By the deck's usual targets this is not an improvement: without the goal the rating goes ${usualRating} to ${nextRating}.`);
      const needs = roleNeeds(usual, ctx);
      for (const role of served) {
        const need = needs.find((x) => x.role === role);
        if (need && need.count >= need.band.lo) objections.push(`The deck already holds ${need.count} ${need.label}; ${need.band.lo}-${need.band.hi} is the usual range at Bracket ${g.bracket}.`);
      }
    } else if (p.ratingAfter < p.ratingBefore - DISSENT) {
      objections.push(`Even with the goal counted, the rating goes ${p.ratingBefore} to ${p.ratingAfter}: ${ctx.db.get(p.out)?.name ?? 'the card cut'} was doing more for the deck than ${ctx.db.get(p.in)?.name ?? 'its replacement'} will.`);
    }
    usual = next;
    usualRating = nextRating;
    const out: SwapProposal = { ...p, reason: tags.length > 0 ? `${sentence(tags.join('; '))}. ${p.reason}` : p.reason, agrees: objections.length === 0 };
    if (objections.length > 0) out.objection = objections.join(' ');
    return out;
  });
}

const r1 = (n: number): string => String(Math.round(n * 10) / 10);

/** Land candidates for `addOne`: fixers, the pool's other lands and the deck's basics, each once. */
function landCandidates(pool: Pool, ctx: EngineContext): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const c of [...pool.fixers, ...pool.lands, ...basicCandidates(pool, ctx)]) {
    if (seen.has(c.card.oracleId)) continue;
    seen.add(c.card.oracleId);
    out.push(c);
  }
  return out;
}

/**
 * "Add one more of this": up to `count` ranked suggestions for bringing in a card of `role`
 * ('land' for a land), each paired with the card to cut for it: the deck's weakest card it can
 * give up that is not of that role, never a locked one. A deck under 100 cards gets plain adds
 * (`out` is ''). A land has to make the colour the deck is shortest of, when it is short of one,
 * and its reason names that colour. Ratings are for that one change on the deck as given.
 *
 * The engine never refuses: when it thinks the change is not an improvement (the role is already
 * at the top of its band, the deck holds more lands than its curve wants, the rating falls) the
 * suggestion still comes back, with `agrees: false` and an `objection` that says why in plain
 * words. Cards outside the colour identity, banned cards, extra copies, and cards the options
 * rule out (owned only, price) are never offered.
 */
export function addOne(deck: Deck, ctx: EngineContext, opts: BuildOptions, role: Role, count = 5): SwapProposal[] {
  const n = Math.min(10, Math.max(1, Math.floor(Number.isFinite(count) ? count : 5)));
  if (!ADD_ONE_ROLES.includes(role)) return [];
  const { db } = ctx;
  const pool = buildPool(deck, ctx, { ...opts, goals: null });
  const scorer = createScorer(deck, ctx);
  const have = idsOf(deck);
  const fits = planFilter(deck, ctx, pool);
  const open = deckCount(deck) < DECK_SIZE;
  const summary = summarizeDeck(deck, db);
  const full = targetsFor(deck, ctx, summary);
  const targets = open ? scaleTargets(full, summary.cardCount) : full;
  const needs = roleNeeds(deck, ctx, { summary, targets: full, scaled: open });
  const bracket = deck.targetBracket;
  const one = ROLE_ONE[role] ?? role;

  let ins: { c: Candidate; score: number }[];
  let colour: Color | null = null;
  const balance = role === 'land' ? colourBalance(deck, ctx) : null;
  if (role === 'land' && balance) {
    let gap = 0.5;
    for (const c of COLORS) {
      const short = balance[c].need - balance[c].have;
      if ((pool.identity.includes(c) || pool.splash.includes(c)) && short > gap) { gap = short; colour = c; }
    }
    const lands = landCandidates(pool, ctx);
    const makes = (x: Candidate, c: Color) => (x.f.sources[c] ?? 0) >= RELIABLE_SOURCE;
    ins = bestOf(lands, scorer, have, n, (x) => (colour ? makes(x, colour) : pool.identity.length === 0 || pool.identity.some((c) => makes(x, c))));
  } else {
    ins = bestOf(pool.nonland, scorer, have, n, (c) => fits(c) && matches(c, { role }) && !offPlanAltWin(c, role));
    if (ins.length < n) {
      const taken = new Set(ins.map((x) => x.c.card.oracleId));
      ins.push(...bestOf(pool.nonland, scorer, have, n - ins.length, (c) => !taken.has(c.card.oracleId) && fits(c) && matches(c, { role })));
    }
  }
  if (ins.length === 0) return [];

  let out: Out | null = null;
  if (!open) {
    const outs = cuttable(deck, ctx, pool, lockedOf(deck), comboPieces(deck, ctx), scorer);
    const hasRole = (x: Out) => (role === 'land' ? x.land : db.features(x.id)?.roles.includes(role) === true);
    out = outs.find((x) => !x.land && !hasRole(x)) ?? outs.find((x) => !hasRole(x)) ?? null;
    if (!out) return [];
  }

  // What the cut costs, in the rating's own counts: "one of your 9 ramp".
  let outNote = '';
  if (out) {
    const roles = db.features(out.id)?.roles ?? [];
    const held = needs.filter((x) => roles.includes(x.role)).sort((a, b) => (a.count - a.band.lo) - (b.count - b.band.lo))[0];
    if (held) outNote = ` (one of your ${held.count} ${held.label})`;
  }

  const before = shownRating(rateDeck(deck, ctx));
  const need = needs.find((x) => x.role === role);
  const landsOver = role === 'land' && summary.landsEffective >= targets.lands + 1;
  const proposals: SwapProposal[] = [];
  for (const { c, score } of ins) {
    const id = c.card.oracleId;
    const next = out ? swapOne(deck, out.id, id) : addCard(deck, id);
    const after = shownRating(rateDeck(next, ctx));
    const shown = Math.round(score - c.jitter - c.adjust);
    const objections: string[] = [];
    if (need && need.count >= need.band.hi) {
      objections.push(`you already have ${need.count} ${need.label}, and ${need.band.lo}-${need.band.hi} is plenty at Bracket ${bracket}`);
    }
    if (landsOver) objections.push(`the deck already holds ${r1(summary.landsEffective)} lands where its curve wants about ${targets.lands}`);
    if (after < before - DISSENT) {
      objections.push(out ? `this swap cuts ${out.name}${outNote} and drops the rating ${before} -> ${after}` : `adding it drops the rating ${before} -> ${after}`);
    }
    let lead: string;
    if (role === 'land' && balance) {
      const made = COLORS.filter((k) => (c.f.sources[k] ?? 0) >= RELIABLE_SOURCE).map((k) => COLOR_NAME[k]);
      lead = colour
        ? `${c.card.name} makes ${COLOR_NAME[colour]}, the colour the deck is shortest of: ${r1(balance[colour].have)} ${COLOR_NAME[colour]} sources where its spells want ${Math.ceil(balance[colour].need)}.`
        : `${c.card.name} makes ${made.length > 0 ? made.join(' and ') : 'colourless mana'}; every colour already has the sources its spells want.`;
    } else {
      lead = `${c.card.name} is ${one} that scores ${shown} for this deck.`;
    }
    const cut = out
      ? `${out.name} (${Math.max(0, out.score)}) is the weakest card the deck can give up that is not ${one}.`
      : 'The deck has open slots, so nothing is cut.';
    const p: SwapProposal = { out: out?.id ?? '', in: id, reason: `${lead} ${cut}`, ratingBefore: before, ratingAfter: after, agrees: objections.length === 0 };
    if (objections.length > 0) p.objection = `${sentence(objections.join('; '))}.`;
    proposals.push(p);
  }
  return proposals;
}

/**
 * Replacements for one chosen card in the deck: up to `count` swaps, ranked by the rating after.
 * Same-role cards come first (a land is replaced by lands); a few best-overall cards follow.
 * Swaps the engine thinks are worse still come back, with `agrees: false` and an objection.
 */
export function replaceCard(deck: Deck, ctx: EngineContext, opts: BuildOptions, outId: string, count = 6): SwapProposal[] {
  const n = Math.min(12, Math.max(1, Math.floor(Number.isFinite(count) ? count : 6)));
  const { db } = ctx;
  if (!deck.main.some((e) => e.oracleId === outId)) return [];
  const outCard = db.get(outId);
  const outF = db.features(outId);
  const pool = buildPool(deck, ctx, { ...opts, goals: null });
  const scorer = createScorer(deck, ctx);
  const have = idsOf(deck);
  const fits = planFilter(deck, ctx, pool);
  const wasLand = outF ? isLandCard(outF) : false;
  const roles: Role[] = (outF?.roles ?? []).filter((r) => r !== 'land' && r !== 'game-changer' && r !== 'mass-land-denial' && r !== 'extra-turn');

  const picked = new Map<string, Candidate>();
  const take = (list: { c: Candidate }[]) => { for (const x of list) if (!picked.has(x.c.card.oracleId)) picked.set(x.c.card.oracleId, x.c); };
  if (wasLand) {
    take(bestOf(landCandidates(pool, ctx), scorer, have, n, () => true));
  } else {
    if (roles.length > 0) take(bestOf(pool.nonland, scorer, have, n, (c) => fits(c) && c.f.roles.some((r) => roles.includes(r))));
    take(bestOf(pool.nonland, scorer, have, Math.max(2, n - picked.size), (c) => fits(c) && !picked.has(c.card.oracleId)));
  }
  if (picked.size === 0) return [];

  const before = shownRating(rateDeck(deck, ctx));
  const outScore = Math.max(0, Math.round(scorer.score(outCard ?? ({ oracleId: outId } as never)).score));
  const outName = outCard?.name ?? 'this card';
  const roleText = roles.length > 0 ? roles.map((r) => ROLE_LABEL[r] ?? r).join(' / ') : wasLand ? 'land' : null;
  const proposals: SwapProposal[] = [];
  for (const c of picked.values()) {
    const id = c.card.oracleId;
    const after = shownRating(rateDeck(swapOne(deck, outId, id), ctx));
    const score = Math.round(scorer.score(c.card).score);
    const same = wasLand ? (c.f && isLandCard(c.f)) : c.f.roles.some((r) => roles.includes(r));
    const lead = same && roleText
      ? `${c.card.name} (${score}) does the same job (${roleText}) as ${outName} (${outScore}).`
      : `${c.card.name} (${score}) is one of the strongest cards for this deck that is not in it; it does a different job than ${outName} (${outScore}).`;
    const p: SwapProposal = { out: outId, in: id, reason: lead, ratingBefore: before, ratingAfter: after, agrees: after >= before - DISSENT };
    if (!p.agrees) p.objection = `Swapping out ${outName} for ${c.card.name} drops the rating ${before} -> ${after}; the engine thinks ${outName} is the better fit here.`;
    proposals.push(p);
  }
  return proposals.sort((a, b) => b.ratingAfter - a.ratingAfter).slice(0, n);
}
