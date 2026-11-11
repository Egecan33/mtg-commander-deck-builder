import { analyzeBracket } from '../brackets';
import { axisLabel } from '../features';
import { karstenSources, pAtLeast } from '../mana';
import { commanderCards, deckSize, isBasicLand, rulebreakersOf, validateDeck } from '../rules';
import { AXIS_MEMBER, deckCards, isLandCard, resolveTheme, summarizeDeck } from '../summary';
import type { DeckCard } from '../summary';
import { roleNeeds, scaleTargets, targetsFor } from '../targets';
import type { RoleNeed } from '../targets';
import type {
  AxisId, Bracket, BracketReport, Color, Deck, DeckRating, DeckSummary, EngineContext, Fix, Role, SubScore, Targets, Violation,
} from '../types';

/** Sub-score weights (spec §11); they sum to 100. */
export const RATING_WEIGHTS = {
  mana: 18, roles: 16, synergy: 16, curve: 10, interaction: 10, wincons: 10, consistency: 10, bracket: 10,
} as const;
export type RatingKey = keyof typeof RATING_WEIGHTS;
/**
 * A deck that breaks a rule never rates above this. Being short of 100 cards is the one exception:
 * an unfinished deck is not capped, it is rated "so far" (see `rateDeck`).
 */
export const ILLEGAL_CAP = 40;
export const MAX_FIXES = 3;

const LABELS: Record<RatingKey, string> = {
  mana: 'Mana base', roles: 'Role coverage', synergy: 'Synergy', curve: 'Curve', interaction: 'Interaction',
  wincons: 'Win conditions', consistency: 'Consistency', bracket: 'Bracket fit',
};
const ORDER: readonly RatingKey[] = ['mana', 'roles', 'synergy', 'curve', 'interaction', 'wincons', 'consistency', 'bracket'];

type PerBracket<T> = readonly [T, T, T, T, T];
const COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G'];
const COLOR_NAME: Record<Color, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

/**
 * Role coverage weights (deck-theory.md §7). The counts and bands come from `roleNeeds`
 * (targets.ts), the same numbers the card scorer rewards filling. Win conditions have a sub-score
 * of their own.
 */
const COVERAGE: Partial<Record<Role, number>> = {
  ramp: 3, draw: 3, 'spot-removal': 3, counterspell: 1.5, wipe: 2, protection: 2, recursion: 1.5, 'graveyard-hate': 1.5, tutor: 1,
};
/** Total interaction (spot + counters + wipes) per bracket (§7). */
const INTERACTION_BAND: PerBracket<readonly [number, number]> = [[9, 16], [11, 17], [12, 18], [13, 18], [14, 20]];
/** Instant-speed share of interaction to aim for (§4.4; B1-2 value is ours). */
const INSTANT_SHARE: PerBracket<number> = [0.3, 0.3, 0.4, 0.6, 0.8];
/** Nonland cards of mana value ≤ 2 a full deck wants (§7). */
const EARLY_PLAYS: PerBracket<number> = [18, 18, 18, 25, 25];
/** Earliest turn a table of this bracket expects a win (§7), and the turn past which a deck is too slow for it. */
const WIN_TURN_FLOOR: PerBracket<number> = [9, 8, 6, 4, 0];
const WIN_TURN_LIMIT: PerBracket<number> = [12, 10.5, 9, 8, 6.5];
/** Tutors plus a third of the draw a full deck needs to find its plan reliably. */
const REDUNDANCY_NEED: PerBracket<number> = [3, 4, 5, 7, 10];
/** Karsten's optimal curves by commander mana value 2..6: cards at MV 1,2,3,4,5,6 (§2.4). */
const KARSTEN_CURVE: Record<number, number[]> = {
  2: [9, 0, 20, 14, 9, 4], 3: [8, 19, 0, 16, 10, 3], 4: [6, 12, 13, 0, 13, 8], 5: [6, 12, 10, 13, 0, 10], 6: [6, 12, 10, 14, 9, 0],
};
/** The roles no deck does without, the coverage below which one of them drags the whole sub-score, and how far (to this share at zero). */
const CORE_ROLES: readonly Role[] = ['ramp', 'draw', 'spot-removal'];
const CORE_ROLE_KNEE = 0.5;
const CORE_ROLE_FLOOR = 0.55;
/** Role coverage: the least a role scores for being over its band. */
const OVER_FLOOR = 0.5;
/** Three creatures this large count as one win condition, up to half the band's lower end (combat wins games, but a deck still needs finishers). */
const THREAT_POWER = 6;
const THREATS_PER_WINCON = 3;
/** Most the theme-density term earns when the theme was read off the deck, not the commander or the user. */
const INFERRED_THEME_CAP = 0.85;
/**
 * Share of Karsten's requirement from which a colour counts as fully supported: his numbers buy 90%
 * on-curve casting, and real lists run a source or two under them without trouble.
 */
const SOURCE_FULL = 0.9;
/**
 * Credit a card earns for one of its colours at `ratio` = sources held / sources needed: full from
 * `SOURCE_FULL` up, and falling with the square below it, so every missing source costs something
 * and a colour with a third of its sources is worth almost nothing.
 */
const sourceCredit = (ratio: number): number => (ratio >= SOURCE_FULL ? 1 : clamp01(ratio / SOURCE_FULL) ** 2);
/**
 * How much of the mana sub-score survives a given castable share: mana = structure × share^this.
 * A five-colour deck on basics of one colour keeps under a fifth of its marks.
 */
const CASTABLE_POWER = 1.5;
/**
 * Cards the mana cannot cast fill no role, hit no curve and win no game: every sub-score except
 * mana and bracket fit is multiplied by 1 - this × (1 - castable share)². The castable share is
 * the lower of two readings: the coloured sources (above) and the land count (below).
 */
const UNCASTABLE_COST = 0.75;
/**
 * Lands away from the target at which a full deck stops working at all (20 lands where 36 are
 * wanted, or 60): the land-count reading of the castable share falls linearly to 0 there. The
 * first three lands either way are free; the mana sub-score already charges for those.
 */
const LAND_BREAK = 16;
const LAND_SLACK = 3;

/** The any-creature-type axis. */
const GENERIC_TYPAL = 'typal';

const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const finite = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
const r1 = (n: number): number => Math.round(n * 10) / 10;
const pct = (p: number): string => `${Math.round(clamp01(p) * 100)}%`;
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** 1 inside [lo, hi]; falls linearly to 0 at `below` under lo or `above` over hi. */
function band(x: number, lo: number, hi: number, below: number, above = below): number {
  if (!Number.isFinite(x)) return 0;
  if (x < lo) return below > 0 ? clamp01(1 - (lo - x) / below) : 0;
  if (x > hi) return above > 0 ? clamp01(1 - (x - hi) / above) : 0;
  return 1;
}

interface Issue extends Fix { loss: number }
interface Part { value: number; issues: Issue[] }

/** Everything the eight sub-scores read, gathered once per deck. */
interface Facts {
  deck: Deck; ctx: EngineContext;
  cards: DeckCard[];
  summary: DeckSummary;
  targets: Targets;       // scaled to the deck's size
  fullTargets: Targets;   // what the finished deck should hold
  needs: Map<Role, RoleNeed>; // role counts against the scaled bands (`roleNeeds`, shared with the scorer)
  castable: number;       // how much of the deck its mana can cast (0..1): the lower of colour sources and land count
  filled: number;         // cardCount / 100, at most 1
  bi: number;             // bracket index 0..4
  bracket: Bracket;
  report: BracketReport;
  commanderIds: Set<string>;
  /** Cards outside the commander's colours: the rule violation names them, the mana base is not asked to cast them. */
  offIdentity: Set<string>;
  count(pred: (c: DeckCard) => boolean): number;
}

const has = (c: DeckCard, role: Role): boolean => c.features.roles.includes(role);
const nonland = (c: DeckCard): boolean => !isLandCard(c.features);

/**
 * Coloured sources (§4.2): the share of coloured cards the mana can cast on curve, commander ×5,
 * mana value ≤ 2 ×2, with the worst shortfall per colour.
 */
function colourSources(
  cards: DeckCard[], s: DeckSummary, filled: number, commanderIds: Set<string>, offIdentity?: Set<string>,
): { share: number; weightSum: number; worst: Map<Color, { name: string; have: number; need: number; lost: number }> } {
  let weightSum = 0;
  let credit = 0;
  const worst = new Map<Color, { name: string; have: number; need: number; lost: number }>();
  for (const c of cards) {
    if (!nonland(c) || offIdentity?.has(c.card.oracleId)) continue;
    const w = (commanderIds.has(c.card.oracleId) ? 5 : c.card.cmc <= 2 ? 2 : 1) * c.qty;
    let cardCredit = 1;
    let coloured = false;
    for (const color of COLORS) {
      const pips = finite(c.features.pips[color]);
      if (pips <= 0) continue;
      coloured = true;
      const need = karstenSources(pips, c.card.cmc);
      const have = filled > 0 ? s.sources[color] / filled : 0; // a partial deck's sources, as a full deck would have them
      const got = need > 0 ? sourceCredit(have / need) : 1;
      cardCredit = Math.min(cardCredit, got);
      if (have < need) {
        const prev = worst.get(color);
        const entry = prev ?? { name: c.card.name, have: s.sources[color], need: Math.ceil(need * filled), lost: 0 };
        // The fix names the most demanding card of the colour.
        if (!prev || need * filled > entry.need) { entry.name = c.card.name; entry.need = Math.ceil(need * filled); }
        entry.lost += w * (1 - got);
        worst.set(color, entry);
      }
    }
    if (!coloured) continue;
    weightSum += w;
    credit += w * cardCredit;
  }
  return { share: weightSum > 0 ? credit / weightSum : 1, weightSum, worst };
}

function manaPart(f: Facts): Part {
  const { summary: s, targets: t, cards } = f;
  const issues: Issue[] = [];

  // Land count against the target for this deck's curve and bracket: full marks within one land.
  const tol = Math.max(1.5, 4 * f.filled);
  // No lands at all is never "on target", however small the deck.
  const landScore = s.landsEffective <= 0 && f.fullTargets.lands > 0 ? 0 : band(s.landsEffective, t.lands - 1, t.lands + 1, tol);
  const landGap = Math.round(t.lands - s.landsEffective);
  if (landScore < 1 && landGap > 0) {
    issues.push({
      text: `Add ${plural(landGap, 'land')}: the deck has ${r1(s.landsEffective)}, and its curve wants about ${t.lands} at Bracket ${f.bracket}.`,
      filter: { land: true }, loss: 0.6 * (1 - landScore),
    });
  } else if (landScore < 1 && landGap < 0) {
    issues.push({
      text: `Cut ${plural(-landGap, 'land')} for spells: the deck has ${r1(s.landsEffective)}, and its curve wants about ${t.lands} at Bracket ${f.bracket}.`,
      filter: null, loss: 0.6 * (1 - landScore),
    });
  }

  // Taplands (§4.3): free up to the cap, zero at twice the cap.
  const cap = Math.max(1, t.taplandCap);
  const tapScore = 1 - clamp01((s.taplands - cap) / cap);
  if (tapScore < 1) {
    issues.push({
      text: `${r1(s.taplands)} lands enter tapped; a Bracket ${f.bracket} deck wants at most ${cap}. Swap some for untapped lands.`,
      filter: { land: true }, loss: 0.25 * (1 - tapScore),
    });
  }

  // Utility lands: nonbasic lands that do something besides make mana.
  const isUtility = (c: DeckCard) =>
    isLandCard(c.features) && !isBasicLand(c.card)
    && (c.features.roles.some((r) => r !== 'land') || Object.values(c.features.axes).some((a) => finite(a?.e) >= AXIS_MEMBER || finite(a?.p) >= AXIS_MEMBER));
  const utilityWant = Math.max(1, Math.round(5 * f.filled));
  let utility = clamp01(f.count(isUtility) / utilityWant);
  const deckColors = COLORS.filter((c) => cards.some((x) => finite(x.features.pips[c]) > 0));
  const colourless = f.count((c) => isLandCard(c.features) && COLORS.every((k) => finite(c.features.sources[k]) <= 0));
  if (deckColors.length >= 3 && s.landCount > 0 && colourless / s.landCount > 0.15) {
    utility *= 0.5;
    issues.push({
      text: `${plural(colourless, 'land')} make only colourless mana, a lot for a ${deckColors.length}-colour deck. Swap some for lands that make your colours.`,
      filter: { land: true }, loss: 0.05,
    });
  }
  const structure = 0.6 * landScore + 0.25 * tapScore + 0.15 * utility;

  // Coloured sources multiply the rest: lands that cannot cast the deck's spells are not a mana base.
  const { share, weightSum, worst } = colourSources(cards, s, f.filled, f.commanderIds, f.offIdentity);
  const colourFactor = share ** CASTABLE_POWER;
  for (const [color, e] of worst) {
    const short = Math.ceil(e.need - e.have);
    if (short < 1) continue;
    const lost = weightSum > 0 ? e.lost / weightSum : 0;
    if (lost <= 0) continue; // within the slack every colour is allowed
    issues.push({
      text: `${short} short on ${COLOR_NAME[color]} sources for ${e.name}: have ${r1(e.have)}, need ${e.need}.`,
      filter: { color }, loss: structure * lost * CASTABLE_POWER + 0.001,
    });
  }

  return { value: structure * colourFactor, issues };
}

function rolesPart(f: Facts): Part {
  const issues: Issue[] = [];
  let weightSum = 0;
  let total = 0;
  let worstCore = 1;
  for (const [role, need] of f.needs) {
    const weight = COVERAGE[role];
    if (!weight) continue;
    const { count: n, band: b, label } = need;
    const owed = (f.fullTargets.roles[role]?.lo ?? 0) >= 1;
    // Short of the band costs quickly; over it costs slowly and never more than half the marks
    // (a deck drowning in ramp is still better off than one with none). A role the finished deck
    // owes cards to is never "met" by an empty slot, however small the deck is so far.
    const v = n > b.hi ? Math.max(OVER_FLOOR, band(n, b.lo, b.hi, 1, Math.max(4, 2 * b.hi)))
      : n === 0 && owed ? 0
        : band(n, b.lo, b.hi, Math.max(1, b.lo / 2));
    weightSum += weight;
    total += weight * v;
    if (CORE_ROLES.includes(role)) worstCore = Math.min(worstCore, v);
    const want = b.lo === b.hi ? `${b.lo}` : `${b.lo}-${b.hi}`;
    if (need.short > 0) {
      issues.push({ text: `${need.short} short on ${label}: have ${n}, want ${want}.`, filter: { role }, loss: weight * (1 - v) });
    } else if (need.over > 1) {
      issues.push({ text: `${need.over} over on ${label}: have ${n}, want ${want}. Some of those slots could go to the theme.`, filter: null, loss: weight * (1 - v) });
    }
  }
  // Ramp, card draw and removal are what every deck runs on: one of them (nearly) missing is not
  // averaged away by full marks for recursion and graveyard hate.
  const coreFactor = worstCore < CORE_ROLE_KNEE ? CORE_ROLE_FLOOR + (1 - CORE_ROLE_FLOOR) * (worstCore / CORE_ROLE_KNEE) : 1;
  return { value: (weightSum > 0 ? total / weightSum : 0) * coreFactor, issues };
}

/** Theme weights to rate against: the deck's own, else what the deck itself is mostly made of. */
function themeOf(f: Facts): { weights: Record<AxisId, number>; primary: AxisId | null; inferred: boolean } {
  // The shared resolution (summary.ts) already reads a theme off the deck when the commander names none.
  const resolved = resolveTheme(f.deck, f.ctx);
  const given = resolved.weights;
  const members = (axis: AxisId) => finite(f.summary.axisTotals[axis]?.e) + finite(f.summary.axisTotals[axis]?.p);
  let weights: Record<AxisId, number> = {};
  for (const [axis, w] of Object.entries(given)) if (finite(w) > 0) weights[axis] = clamp01(w);
  const unnamed = !Object.values(weights).some((w) => w >= 0.5);
  const inferred = unnamed || resolved.source === 'deck';
  if (unnamed) {
    // No commander, or one whose text names no theme: rate against the deck's own largest axis.
    const top = Object.keys(f.summary.axisTotals).sort((a, b) => members(b) - members(a) || a.localeCompare(b)).slice(0, 1);
    weights = { ...weights };
    for (const axis of top) weights[axis] = 1;
  }
  let primary = Object.keys(weights).sort((a, b) => weights[b] - weights[a] || members(b) - members(a) || a.localeCompare(b))[0] ?? null;
  // 'typal' alone is the any-type bucket (Herald's Horn, changelings). When the deck also names a
  // creature type, that type is the theme: its creatures are the enablers the payoffs need.
  if (primary === GENERIC_TYPAL) {
    const named = Object.keys(weights)
      .filter((a) => a.startsWith('typal:') && weights[a] >= 0.5)
      .sort((a, b) => weights[b] - weights[a] || members(b) - members(a) || a.localeCompare(b))[0];
    if (named) primary = named;
  }
  return { weights, primary, inferred };
}

/** Synergy of one card with the theme (deck-theory.md §6.4, static part). */
function synergyOf(c: DeckCard, weights: Record<AxisId, number>): number {
  let best = 0;
  let second = false;
  let bestAxis: AxisId | null = null;
  for (const [axis, s] of Object.entries(c.features.axes)) {
    const v = finite(weights[axis]) * Math.max(finite(s?.e), finite(s?.p));
    if (v > best) { best = v; bestAxis = axis; }
  }
  for (const [axis, s] of Object.entries(c.features.axes)) {
    if (axis !== bestAxis && finite(weights[axis]) >= 0.5 && Math.max(finite(s?.e), finite(s?.p)) >= AXIS_MEMBER) second = true;
  }
  return Math.min(1, best + (second ? 0.15 : 0));
}

function synergyPart(f: Facts): Part {
  const issues: Issue[] = [];
  const { weights, primary, inferred } = themeOf(f);
  if (!primary) return { value: 0, issues };
  const label = axisLabel(primary);
  const want = f.targets.themeCards;
  const onTheme = f.count((c) => nonland(c) && synergyOf(c, weights) >= 0.5);
  let density = onTheme === 0 ? 0 : want > 0 ? clamp01(onTheme / want) : 1;
  if (inferred && density > INFERRED_THEME_CAP) {
    density = INFERRED_THEME_CAP;
    issues.push({
      text: `The commander names no theme this engine recognises, so the deck is rated against its own largest one (${axisLabel(primary)}). Set the theme weights to confirm it.`,
      filter: { axis: primary }, loss: 0.6 * (1 - INFERRED_THEME_CAP),
    });
  }
  if (onTheme < want) {
    issues.push({
      text: `Add ${want - onTheme} more on-theme cards (${label}): ${onTheme} of the deck's spells work with the commander, want ${want} or more.`,
      filter: { axis: primary }, loss: 0.6 * (1 - density),
    });
  }

  // A named creature type is paid off by any-type payoffs too; the any-type bucket on its own has
  // no enablers to count (every creature of the chosen type is one), so only its payoffs are read.
  const anyType = finite(f.summary.axisTotals[GENERIC_TYPAL]?.p);
  const p = finite(f.summary.axisTotals[primary]?.p) + (primary.startsWith('typal:') ? anyType : 0);
  const e = primary === GENERIC_TYPAL ? Math.max(p, finite(f.summary.axisTotals[primary]?.e)) : finite(f.summary.axisTotals[primary]?.e);
  const lo = Math.min(e, p);
  const hi = Math.max(e, p);
  const enough = Math.max(1, Math.round(8 * f.filled));
  const balance = hi > 0 ? Math.max(lo / hi, clamp01(lo / enough)) : 0;
  if (balance < 1 && hi > 0) {
    const scarce = e < p ? 'enablers' : 'payoffs';
    const plenty = e < p ? 'payoffs' : 'enablers';
    issues.push({
      text: `${label}: only ${plural(lo, scarce.slice(0, -1))} against ${hi} ${plenty}. Add ${enough - lo} more ${scarce}.`,
      filter: { axis: primary }, loss: 0.4 * (1 - balance),
    });
  }
  return { value: 0.6 * density + 0.4 * balance, issues };
}

function curvePart(f: Facts): Part {
  const { summary: s, targets: t } = f;
  const issues: Issue[] = [];
  const spells = s.curve.reduce((a, b) => a + b, 0);
  if (spells === 0) return { value: 0, issues };

  const mvScore = band(s.avgMv, t.avgMv.lo, t.avgMv.hi, 1.2, 0.8);
  if (s.avgMv > t.avgMv.hi) {
    issues.push({
      text: `Average mana value is ${s.avgMv.toFixed(2)}; Bracket ${f.bracket} decks run ${t.avgMv.lo}-${t.avgMv.hi}. Swap expensive cards for cheaper ones.`,
      filter: { maxMv: 3 }, loss: 0.5 * (1 - mvScore),
    });
  } else if (mvScore < 1) {
    issues.push({
      text: `Average mana value is ${s.avgMv.toFixed(2)}, below the ${t.avgMv.lo}-${t.avgMv.hi} usual at Bracket ${f.bracket}: the deck may run out of things to do late.`,
      filter: null, loss: 0.5 * (1 - mvScore),
    });
  }

  const earlyWant = Math.max(1, Math.round(EARLY_PLAYS[f.bi] * f.filled));
  const early = s.curve[0] + s.curve[1] + s.curve[2];
  const earlyScore = clamp01(early / earlyWant);
  if (early < earlyWant) {
    issues.push({
      text: `Only ${plural(early, 'spell')} at mana value 2 or less; aim for ${earlyWant} so the first turns are not empty.`,
      filter: { maxMv: 2 }, loss: 0.2 * (1 - earlyScore),
    });
  }

  // Karsten's curve model is a casual goldfish (§2.4): it shapes B1-3 only.
  if (f.bracket >= 4) return { value: 0.7 * mvScore + 0.3 * earlyScore, issues };

  // Shape: distance to Karsten's curve for the commander's mana value, softened so that the
  // model's empty slot at the commander's own cost is a nudge, not a demand.
  const commanders = commanderCards(f.deck, f.ctx.db);
  const cmdMv = commanders.length > 0 ? Math.max(...commanders.map((c) => finite(c.cmc))) : 4;
  const row = KARSTEN_CURVE[Math.min(6, Math.max(2, Math.round(cmdMv)))];
  const mean = [0, 1, 2, 3, 4, 5].map((i) => Object.values(KARSTEN_CURVE).reduce((a, r) => a + r[i], 0) / 5);
  const ref = row.map((n, i) => n + mean[i]);
  const refSum = ref.reduce((a, b) => a + b, 0);
  const mine = [s.curve[0] + s.curve[1], s.curve[2], s.curve[3], s.curve[4], s.curve[5], s.curve[6] + s.curve[7]];
  let l1 = 0;
  let worstIdx = -1;
  let worstOver = 0;
  mine.forEach((n, i) => {
    const d = n / spells - ref[i] / refSum;
    l1 += Math.abs(d);
    if (d > worstOver) { worstOver = d; worstIdx = i; }
  });
  const shape = clamp01(1 - l1 / 2);
  if (worstOver >= 0.08 && worstIdx >= 3) {
    const at = worstIdx === 5 ? '6 or more' : `${worstIdx + 1}`;
    const clash = worstIdx < 5 && worstIdx + 1 === Math.round(cmdMv);
    issues.push({
      text: clash
        ? `${mine[worstIdx]} spells cost ${at}, the same as the commander, so they compete with it for that turn; move a few down the curve.`
        : `${mine[worstIdx]} spells at mana value ${at} is top-heavy for a ${Math.round(cmdMv)}-mana commander; move a few down the curve.`,
      filter: { maxMv: Math.max(2, worstIdx) }, loss: 0.3 * worstOver,
    });
  }
  return { value: 0.5 * mvScore + 0.3 * shape + 0.2 * earlyScore, issues };
}

/** What an interaction card can answer, read off its text. Rough: features carry no target types. */
function answers(c: DeckCard): { creature: boolean; artifact: boolean; enchantment: boolean; stack: boolean } {
  const text = c.card.oracleText.toLowerCase();
  const any = /\b(nonland |target |each |all |other )?permanents?\b/.test(text);
  const removal = has(c, 'spot-removal') || has(c, 'wipe');
  return {
    creature: removal && (any || /\bcreatures?\b|any target/.test(text)),
    artifact: removal && (any || /\bartifacts?\b/.test(text)),
    enchantment: removal && (any || /\benchantments?\b/.test(text)),
    stack: has(c, 'counterspell') || (removal && (any || /\bplaneswalkers?\b|any target/.test(text))),
  };
}

function interactionPart(f: Facts): Part {
  const { summary: s } = f;
  const issues: Issue[] = [];
  const [fullLo, fullHi] = INTERACTION_BAND[f.bi];
  const lo = Math.round(fullLo * f.filled);
  const hi = Math.max(lo, Math.ceil(fullHi * f.filled));
  const countScore = s.interaction === 0 && fullLo > 0 ? 0 : band(s.interaction, lo, hi, Math.max(1, 5 * f.filled), 10);
  if (s.interaction < lo) {
    issues.push({
      text: `${lo - s.interaction} short on interaction: ${s.interaction} removal spells, counterspells and wipes, want ${lo}-${hi}.`,
      filter: { role: 'spot-removal' }, loss: 0.5 * (1 - countScore),
    });
  }

  const share = s.interaction > 0 ? s.instantInteraction / s.interaction : 0;
  const shareWant = INSTANT_SHARE[f.bi];
  const shareScore = s.interaction > 0 ? clamp01(share / shareWant) : 0;
  if (s.interaction > 0 && share < shareWant) {
    issues.push({
      text: `Only ${pct(share)} of the interaction works at instant speed; Bracket ${f.bracket} decks want ${pct(shareWant)} or more.`,
      filter: { role: 'spot-removal' }, loss: 0.25 * (1 - shareScore),
    });
  }

  const need = f.filled >= 0.5 ? 2 : 1;
  const tally = { creature: 0, artifact: 0, enchantment: 0, stack: 0 };
  for (const c of f.cards) {
    const a = answers(c);
    for (const k of Object.keys(tally) as (keyof typeof tally)[]) if (a[k]) tally[k] += c.qty;
  }
  const kinds: { label: string; n: number; role: Role }[] = [
    { label: 'creatures', n: tally.creature, role: 'spot-removal' },
    { label: 'artifacts', n: tally.artifact, role: 'spot-removal' },
    { label: 'enchantments', n: tally.enchantment, role: 'spot-removal' },
    { label: 'graveyards', n: s.roleCounts['graveyard-hate'] ?? 0, role: 'graveyard-hate' },
    { label: 'spells on the stack or planeswalkers', n: tally.stack, role: 'spot-removal' },
  ];
  const covered = kinds.filter((k) => k.n >= need).length;
  for (const k of kinds) {
    if (k.n >= need) continue;
    issues.push({
      text: `${k.n === 0 ? 'No' : `Only ${k.n}`} ${k.n === 1 ? 'answer' : 'answers'} to ${k.label}; carry at least ${need}.`,
      filter: { role: k.role }, loss: 0.25 / kinds.length + (k.n === 0 ? 0.01 : 0),
    });
  }
  return { value: 0.5 * countScore + 0.25 * shareScore + 0.25 * (covered / kinds.length), issues };
}

/** Rough turn the deck threatens to win on, from curve, fast mana, tutors and combos. */
function winTurn(f: Facts): number {
  const s = f.summary;
  const fast = s.roleCounts['fast-mana'] ?? 0;
  const tutors = s.roleCounts.tutor ?? 0;
  const speedUp = Math.min(1.5, 0.25 * fast) + Math.min(1, 0.1 * tutors);
  let turn = 4 + 2.5 * (Math.max(1.5, s.avgMv || 3) - 1.5) - speedUp;
  const combos = f.report.combos.included;
  if (combos.length > 0) turn = Math.min(turn, 7 - speedUp);
  if (combos.some((c) => c.twoCard && c.early)) turn = Math.min(turn, 5 - speedUp);
  return Math.max(1, turn);
}

function winconsPart(f: Facts): Part {
  const issues: Issue[] = [];
  const need = f.needs.get('win-condition');
  const b = need?.band ?? { lo: 0, hi: 0 };
  const owed = (f.fullTargets.roles['win-condition']?.lo ?? 0) >= 1;
  const cards = need?.count ?? 0;
  const combos = f.report.combos.included.length;
  const threats = f.count((c) => /\bCreature\b/.test(c.card.frontTypeLine) && Number(c.card.power) >= THREAT_POWER);
  const n = cards + Math.min(3, combos) + Math.min(Math.floor(b.lo / 2), Math.floor(threats / THREATS_PER_WINCON));
  const want = b.lo === b.hi ? `${b.lo}` : `${b.lo}-${b.hi}`;
  if (n === 0 && owed) {
    issues.push({
      text: `No identifiable win condition. Add ${Math.max(1, b.lo)} or more ways to actually end the game.`,
      filter: { role: 'win-condition' }, loss: 1,
    });
    return { value: 0, issues };
  }
  const countScore = band(n, b.lo, b.hi, 2, 6);
  if (n < b.lo) {
    issues.push({
      text: `${b.lo - n} short on win conditions: have ${n}, want ${want}.`,
      filter: { role: 'win-condition' }, loss: 0.6 * (1 - countScore),
    });
  }

  const turn = winTurn(f);
  const floor = WIN_TURN_FLOOR[f.bi];
  const limit = WIN_TURN_LIMIT[f.bi];
  const speedFit = band(turn, floor, limit, 2);
  const about = Math.max(1, Math.round(turn));
  if (turn < floor) {
    issues.push({
      text: `Can threaten a win around turn ${about}; Bracket ${f.bracket} tables expect games to reach turn ${floor}. Slow it down or raise the target bracket.`,
      filter: null, loss: 0.4 * (1 - speedFit),
    });
  } else if (turn > limit) {
    issues.push({
      text: `Likely to close games around turn ${about}, slow for Bracket ${f.bracket}. Lower the curve or add faster finishers.`,
      filter: { role: 'win-condition' }, loss: 0.4 * (1 - speedFit),
    });
  }
  return { value: 0.6 * countScore + 0.4 * speedFit, issues };
}

function consistencyPart(f: Facts): Part {
  const { summary: s } = f;
  const issues: Issue[] = [];
  const library = Math.max(0, s.cardCount - f.deck.commanders.length);
  if (library === 0) return { value: 0, issues };
  const libraryCards = f.cards.filter((c) => !f.commanderIds.has(c.card.oracleId));
  const sum = (pred: (c: DeckCard) => boolean) => libraryCards.reduce((n, c) => n + (pred(c) ? c.qty : 0), 0);

  // Fast decks keep hands on cheap mana as well as lands, so a mana rock or dork counts as half a land.
  const fastDeck = f.bracket >= 4;
  const cheapMana = sum((c) => nonland(c) && c.card.cmc <= 2 && (has(c, 'ramp') || has(c, 'fast-mana')));
  const landish = Math.round(libraryCards.reduce((n, c) => n + finite(c.features.landWeight) * c.qty, 0) + (fastDeck ? 0.5 * cheapMana : 0));
  const hand = Math.min(7, library);

  const once = pAtLeast(library, landish, hand, 2) - pAtLeast(library, landish, hand, 5);
  const keepable = clamp01(1 - (1 - once) ** 2); // one free mulligan
  const full = s.cardCount >= 60;
  const wantLands = fastDeck ? 3 : 4;
  const seen = Math.min(library, 7 + wantLands); // a draw every turn, the first player included
  const drops = pAtLeast(library, landish, seen, wantLands);
  const dropScore = clamp01(drops / 0.65);
  const tooMany = landish / library > 0.45;
  if (keepable < 0.9) {
    issues.push({
      text: `Opening hands hold 2-4 ${fastDeck ? 'mana sources' : 'lands'} only ${pct(keepable)} of the time, even with the free mulligan.`,
      filter: tooMany ? null : { land: true }, loss: 0.35 * (1 - keepable),
    });
  }
  if (full && drops < 0.55) {
    issues.push({
      text: `${pct(drops)} chance of ${wantLands} ${fastDeck ? 'mana sources' : 'lands'} by turn ${wantLands}; more lands or cheap ramp would steady it.`,
      filter: { land: true }, loss: 0.25 * (1 - dropScore),
    });
  }

  const starters = sum((c) => nonland(c) && c.card.cmc <= 3 && (has(c, 'ramp') || has(c, 'draw') || has(c, 'fast-mana')));
  const early = pAtLeast(library, starters, Math.min(library, 10), 1);
  if (early < 0.85) {
    issues.push({
      text: `Only ${pct(early)} of games have ramp or card draw by turn 3 (${plural(starters, 'cheap piece')}).`,
      filter: { role: 'ramp', maxMv: 3 }, loss: 0.25 * (1 - early),
    });
  }

  const need = Math.max(1, REDUNDANCY_NEED[f.bi] * f.filled);
  const tutors = f.needs.get('tutor')?.count ?? s.roleCounts.tutor ?? 0;
  const draw = f.needs.get('draw')?.count ?? s.roleCounts.draw ?? 0;
  const redundancy = clamp01((tutors + draw / 3) / need);
  if (redundancy < 1) {
    issues.push({
      text: `Little redundancy: ${plural(tutors, 'tutor')} and ${draw} card-draw pieces to find the key cards.`,
      filter: { role: f.bracket >= 3 ? 'tutor' : 'draw' }, loss: 0.15 * (1 - redundancy),
    });
  }
  return { value: 0.35 * keepable + 0.25 * dropScore + 0.25 * early + 0.15 * redundancy, issues };
}

function bracketPart(f: Facts): Part {
  const { report } = f;
  if (report.violationsOfTarget.length > 0) {
    return { value: 0, issues: report.violationsOfTarget.map((v, i) => ({ text: v.message, filter: null, loss: 1 - i * 0.01 })) };
  }
  const gap = report.playsLike - f.bracket;
  const value = clamp01(1 - Math.abs(gap) / 2);
  const issues: Issue[] = [];
  if (gap !== 0) {
    issues.push({
      text: gap > 0
        ? `Plays like Bracket ${report.playsLike}, above the Bracket ${f.bracket} target: it will outpace the table. Raise the target or swap the strongest cards.`
        : `Plays like Bracket ${report.playsLike}, below the Bracket ${f.bracket} target: it will struggle to keep up. Add stronger cards or lower the target.`,
      filter: null, loss: 1 - value,
    });
  }
  report.warnings.forEach((text, i) => issues.push({ text, filter: null, loss: 0.1 - i * 0.01 }));
  return { value, issues };
}

const PARTS: Record<RatingKey, (f: Facts) => Part> = {
  mana: manaPart, roles: rolesPart, synergy: synergyPart, curve: curvePart,
  interaction: interactionPart, wincons: winconsPart, consistency: consistencyPart, bracket: bracketPart,
};

/** Sub-scores that count cards: what the mana cannot cast is discounted from them (see `UNCASTABLE_COST`). */
const CAST_DEPENDENT: ReadonlySet<RatingKey> = new Set(['roles', 'synergy', 'curve', 'interaction', 'wincons', 'consistency']);

/**
 * True when the deck's violations cap its rating at `ILLEGAL_CAP`: any rule broken other than
 * being short of 100 cards. A deck over 100 cards is capped like any other illegal deck.
 */
export function ratingCapped(deck: Deck, violations: readonly Violation[]): boolean {
  return violations.some((v) => v.code !== 'size' || deckSize(deck) > 100);
}

/**
 * Rates a deck 0-100 against its target bracket (spec §11, deck-theory.md §7): eight weighted
 * sub-scores, each with its three largest shortfalls as fixes.
 *
 * A deck short of 100 cards is rated "so far": every sub-score is judged against targets scaled to
 * the cards so far (so fixes read "2 short on ramp", not "add 30 lands") and then multiplied by the
 * share of the deck that is built. A commander alone therefore rates near 0 and a sensible deck
 * rises steadily to its full rating as it is filled in; an empty category never counts as met.
 * Being short of cards is not capped. Any other violation (over 100 cards included) caps the
 * rating at 40. Never throws.
 */
export function rateDeck(deck: Deck, ctx: EngineContext): DeckRating {
  const { db } = ctx;
  const violations = validateDeck(deck, db);
  const summary = summarizeDeck(deck, db);
  const { cards } = deckCards(deck, db);
  const bracket = Math.min(5, Math.max(1, Math.round(Number(deck.targetBracket) || 3))) as Bracket;
  const fullTargets = targetsFor(deck, ctx, summary);
  const filled = Math.min(1, Math.max(0, summary.cardCount) / 100);
  const commanderIds = new Set(deck.commanders);
  const offIdentity = new Set(violations.filter((v) => v.code === 'identity').flatMap((v) => v.oracleIds));
  const facts: Facts = {
    deck, ctx, cards, summary, bracket, fullTargets, filled, commanderIds, offIdentity,
    bi: bracket - 1,
    targets: scaleTargets(fullTargets, summary.cardCount),
    needs: new Map(roleNeeds(deck, ctx, { summary, targets: fullTargets, scaled: true }).map((n) => [n.role, n])),
    castable: Math.min(
      colourSources(cards, summary, filled, commanderIds, offIdentity).share,
      band(summary.landsEffective, Math.round(fullTargets.lands * filled) - LAND_SLACK, Math.round(fullTargets.lands * filled) + LAND_SLACK, Math.max(4, LAND_BREAK * filled)),
    ),
    report: analyzeBracket(deck, ctx),
    count: (pred) => cards.reduce((n, c) => n + (pred(c) ? c.qty : 0), 0),
  };
  const uncastable = 1 - UNCASTABLE_COST * (1 - clamp01(facts.castable)) ** 2;

  const subscores: SubScore[] = ORDER.map((key) => {
    // An empty deck has nothing to rate: every band scaled to zero would otherwise read as met.
    const part = summary.cardCount > 0 ? PARTS[key](facts) : { value: 0, issues: [] };
    const fixes = part.issues
      .filter((i) => i.loss > 0)
      .sort((a, b) => b.loss - a.loss)
      .slice(0, MAX_FIXES)
      .map(({ text, filter }) => ({ text, filter }));
    const value = clamp01(part.value) * (CAST_DEPENDENT.has(key) ? uncastable : 1) * filled;
    return { key, label: LABELS[key], weight: RATING_WEIGHTS[key], value: Math.round(clamp01(value) * 1000) / 1000, fixes };
  });

  const legal = violations.length === 0;
  const raw = Math.round(subscores.reduce((a, s) => a + s.weight * s.value, 0));
  const noMaxSize = rulebreakersOf(deck).some((r) => r.noMaxSize);
  return {
    rating: ratingCapped(deck, violations) ? Math.min(ILLEGAL_CAP, raw) : raw,
    legal,
    complete: noMaxSize ? summary.cardCount >= 100 : summary.cardCount === 100,
    subscores, violations,
  };
}
