import { landTarget } from './mana';
import { allowedIdentity, commanderCards } from './rules';
import { deckCards, isLandCard, summarizeDeck, unfocusedThemeWeights } from './summary';
import type { AxisId, Bracket, Card, CardFeatures, Deck, DeckSummary, EngineContext, PlanMove, Role, RoleBand, Targets } from './types';
import type { CorePackageId } from './types';

type PerBracket<T> = readonly [T, T, T, T, T];
type Band = readonly [number, number];

/** Role bands per bracket (deck-theory.md §2.3). Starting values, to be tuned in calibration. */
const ROLE_BANDS: Partial<Record<Role, PerBracket<Band>>> = {
  ramp: [[8, 12], [9, 12], [10, 13], [10, 14], [12, 16]],
  draw: [[8, 12], [9, 12], [10, 13], [9, 13], [7, 11]],
  wipe: [[2, 5], [2, 5], [2, 4], [1, 3], [0, 2]],
  protection: [[1, 4], [2, 4], [2, 5], [2, 5], [2, 4]],
  tutor: [[0, 2], [0, 3], [2, 6], [4, 10], [8, 14]],
  // Four to six ways to end the game below cEDH; a Bracket 5 deck is built around two to four compact lines.
  'win-condition': [[4, 7], [4, 8], [4, 6], [4, 6], [2, 4]],
  recursion: [[1, 4], [2, 4], [2, 4], [1, 3], [0, 3]],
  'graveyard-hate': [[0, 2], [1, 2], [2, 3], [2, 4], [2, 5]],
};
/**
 * §2.3 has one "targeted interaction" row (5-10 / 7-11 / 9-13 / 10-14 / 12-18, "mostly stack" at
 * B5). Roles keep spot removal and counterspells apart, so the row is split: a deck that cannot
 * run blue gets it all as spot removal (trimmed at B4-5, where no colour pair reaches those counts
 * without counterspells); a blue deck gets a counterspell band and a smaller spot-removal band.
 */
const SPOT_NO_BLUE: PerBracket<Band> = [[5, 10], [7, 11], [9, 13], [8, 13], [7, 13]];
const SPOT_BLUE: PerBracket<Band> = [[5, 10], [6, 10], [7, 11], [6, 10], [4, 9]];
const COUNTER_BLUE: PerBracket<Band> = [[0, 3], [0, 4], [1, 5], [3, 7], [7, 12]];

const AVG_MV: PerBracket<Band> = [[3.0, 3.6], [2.9, 3.5], [2.8, 3.4], [2.3, 3.1], [1.7, 2.3]];
/** Lower end of the §2.3 theme-piece band: the count a deck should reach. */
const THEME_CARDS: PerBracket<number> = [25, 25, 22, 18, 10];
/** Weighted tapland caps (§4.3). */
const TAPLAND_CAP: PerBracket<number> = [12, 10, 6, 3, 1];
/**
 * MDFC-weighted land bands (§2.3). Karsten's regression overshoots what Commander decks run
 * (§4.1: 41 for a deck that runs 35), so the computed target is held inside the bracket's band.
 */
const LAND_BAND: PerBracket<Band> = [[36, 40], [36, 39], [35, 38], [31, 36], [26, 30]];
const LAND_MIN = 24;
const LAND_MAX = 44;

/** `roles` moves a band, `hi` only raises its top (more of the role is welcome, none is owed). */
interface Delta { lands?: number; roles?: Partial<Record<Role, number>>; hi?: Partial<Record<Role, number>>; avgMvHi?: number }
/** Archetype deltas (deck-theory.md §3), keyed by theme axis. Ranges in the table use their midpoint. */
const ARCHETYPE: Record<AxisId, Delta> = {
  voltron: { lands: -1, roles: { wipe: -2 }, avgMvHi: 2.8 },
  tokens: { roles: { draw: 1, wipe: -2, protection: 2 } },
  spellslinger: { lands: -1, roles: { draw: 3, 'spot-removal': 2, protection: 1 } },
  landfall: { lands: 4 },
  sacrifice: { roles: { recursion: 2 } },
  typal: { roles: { wipe: -1, protection: 1 } },
  counters: { roles: { wipe: -1, protection: 2 } },
  graveyard: { roles: { recursion: 3 } },
  artifacts: { lands: -1, roles: { ramp: 3 } },
  'group-hug': { roles: { protection: 2 } },
  stax: { lands: -1, roles: { ramp: 2 } },
  // Not a §3 row: a deck built to make and spend a lot of mana runs more ramp than the §2.3 band.
  'big-mana': { roles: { ramp: 2 }, hi: { ramp: 4 } },
};
/**
 * A commander that is itself ramp in a big-mana deck (Kinnan, Selvala) turns every mana creature
 * and rock into a theme card: the ramp band's top rises by this much so they are not "over".
 */
const MANA_COMMANDER_RAMP_HI = 12;
/** A theme axis counts as one of the deck's archetypes from this weight up. */
export const ARCHETYPE_WEIGHT = 0.6;
/** Deltas come from the deck's strongest archetypes only, so stacked themes cannot erase a band. */
export const MAX_ARCHETYPES = 2;

/** A wanted count set on the deck (`Deck.roleTargets`) makes the band [n, n + span]; n is held to 0..max. */
export const ROLE_TARGET_SPAN = 2;
export const ROLE_TARGET_MAX = 40;

const bracketIndex = (b: number): number => Math.min(5, Math.max(1, Math.round(Number.isFinite(b) ? b : 3))) - 1;
const archetypeOf = (axis: AxisId): AxisId => (axis.startsWith('typal:') ? 'typal' : axis);

/** The deck's archetypes with a delta row, strongest first, each once. */
export function deckArchetypes(weights: Record<AxisId, number>): AxisId[] {
  const best = new Map<AxisId, number>();
  for (const [axis, w] of Object.entries(weights)) {
    const key = archetypeOf(axis);
    if (!(w >= ARCHETYPE_WEIGHT) || !ARCHETYPE[key]) continue;
    best.set(key, Math.max(best.get(key) ?? 0, w));
  }
  return [...best.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MAX_ARCHETYPES).map(([k]) => k);
}

/**
 * What a deck of this bracket and theme should hold when complete: §2.3 bands, shifted by the §3
 * deltas of the theme axes weighted ≥ 0.6, and the land target of §4.1 from the deck's own curve.
 * Use `scaleTargets` for a deck that is not yet 100 cards.
 */
export function targetsFor(deck: Deck, ctx: EngineContext, summary: DeckSummary): Targets {
  return targetPlan(deck, ctx, summary).targets;
}

// ---- the deck's own plan (packages) ------------------------------------------------------------

/** Every package holds at least this many cards. */
export const PACKAGE_MIN = 8;
/** A package size the user sets is held to 8..40. */
export const PACKAGE_PIN_MAX = 40;
/** The land target from the deck's curve stays in this range. */
export const LAND_PLAN_MIN = 28;
export const LAND_PLAN_MAX = 40;
const LAND_PLAN_BASE = 33;
const LAND_PLAN_PER_MV = 1.0;
/** Lands added per bracket (negative: fewer): low brackets run the most lands, cEDH the fewest. */
const LAND_PLAN_BRACKET = [2, 2, 0, -1, -2] as const;
/** Band roles a core package counts for, and the role a pin of its size is written to. */
export const CORE_BAND_ROLES: Record<CorePackageId, readonly Role[]> = {
  ramp: ['ramp'], draw: ['draw'], removal: ['spot-removal', 'counterspell', 'wipe'], protection: ['protection'],
};
export const CORE_PIN_ROLE: Record<CorePackageId, Role> = { ramp: 'ramp', draw: 'draw', removal: 'spot-removal', protection: 'protection' };
export const WIPE_REASON = 'For when someone runs away with the game, or to clear blockers for your win.';

export interface TargetPlan {
  targets: Targets;
  moves: PlanMove[];
  lands: { target: number; reason: string; source: 'plan' | 'bracket' | 'pinned' };
  /** A stax plan: its wipe band is kept whole. */
  stax: boolean;
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));
const r1 = (n: number): number => Math.round(n * 10) / 10;
const shortOf = (card: Card): string => { const i = card.frontName.indexOf(', '); return i > 0 ? card.frontName.slice(0, i) : card.frontName; };
const COST_CHEAT = /\bcosts? \{(\d+|X)\} less|without paying (its|their|that card's|that spell's) mana costs?/i;

/** The board-wipe slot inside Removal: 1-2 unless the plan is stax, which keeps the band. */
export function wipeSlot(band: RoleBand | undefined, stax: boolean): { lo: number; hi: number } {
  if (!band) return { lo: 1, hi: 2 };
  if (stax) return { lo: band.lo, hi: band.hi };
  const lo = clamp(band.lo, 1, 2);
  return { lo, hi: clamp(band.hi, lo, 2) };
}

/** What the bands of a core package add up to at the bottom. */
export function coreBase(targets: Targets, id: CorePackageId, stax: boolean): number {
  let sum = 0;
  for (const role of CORE_BAND_ROLES[id]) {
    sum += role === 'wipe' ? wipeSlot(targets.roles.wipe, stax).lo : (targets.roles[role]?.lo ?? 0);
  }
  return sum;
}

/**
 * The deck's own plan: the bands, moved by the commander and the theme (each move with its reason),
 * and the land target from the deck's curve. `targetsFor` is `.targets`; the rating, the scorer, the
 * builder and the Packages tab all read this one set of numbers.
 */
export function targetPlan(deck: Deck, ctx: EngineContext, summary: DeckSummary): TargetPlan {
  const i = bracketIndex(deck.targetBracket);
  const bracket = (i + 1) as Bracket;
  const commanders = commanderCards(deck, ctx.db);
  const blue = commanders.length > 0 && allowedIdentity(deck, ctx.db).has('U');

  const roles: Partial<Record<Role, RoleBand>> = {};
  for (const [role, bands] of Object.entries(ROLE_BANDS) as [Role, PerBracket<Band>][]) {
    roles[role] = { lo: bands[i][0], hi: bands[i][1] };
  }
  const spot = (blue ? SPOT_BLUE : SPOT_NO_BLUE)[i];
  roles['spot-removal'] = { lo: spot[0], hi: spot[1] };
  if (blue) roles.counterspell = { lo: COUNTER_BLUE[i][0], hi: COUNTER_BLUE[i][1] };

  const avgMv: RoleBand = { lo: AVG_MV[i][0], hi: AVG_MV[i][1] };
  // Archetype deltas, the plan's moves and the land target read the weights before the focus, so
  // focusing a deck's themes never moves its numbers.
  const weights = unfocusedThemeWeights(deck, ctx);
  const cards = deckCards(deck, ctx.db).cards;
  const commanderIds = new Set(deck.commanders);

  // Land target from the curve so far; an empty deck uses the middle of the bracket's band.
  const nonlandCopies = cards.reduce((n, c) => n + (isLandCard(c.features) || commanderIds.has(c.card.oracleId) ? 0 : c.qty), 0);
  const nonland = summary.cardCount - summary.landCount;
  const mv = nonland > 0 && summary.avgMv > 0 ? summary.avgMv : (avgMv.lo + avgMv.hi) / 2;
  let cheap = 0;
  for (const { card, features, qty } of cards) {
    if (isLandCard(features) || !(card.cmc <= 2)) continue;
    if (features.roles.includes('ramp') || features.roles.includes('draw')) cheap += qty;
  }
  // Scale a partial deck's cheap-card count up to a full deck, or the discount lags the build.
  const filled = Math.min(1, Math.max(0, summary.cardCount) / 100);
  if (filled > 0 && filled < 1) cheap = Math.min(cheap / filled, 30);
  let lands = Math.min(LAND_BAND[i][1], Math.max(LAND_BAND[i][0], landTarget(mv, cheap, bracket)));
  const onPlan = nonlandCopies > 0;

  const archetypes = deckArchetypes(weights);
  for (const key of archetypes) {
    const d = ARCHETYPE[key];
    if (!onPlan) lands += d.lands ?? 0;
    for (const [role, shift] of Object.entries(d.roles ?? {}) as [Role, number][]) {
      const band = roles[role];
      if (!band) continue;
      band.lo += shift;
      band.hi += shift;
    }
    for (const [role, shift] of Object.entries(d.hi ?? {}) as [Role, number][]) {
      const band = roles[role];
      if (band) band.hi += shift;
    }
    if (d.avgMvHi !== undefined) avgMv.hi = Math.min(avgMv.hi, d.avgMvHi);
  }

  // Moves: what the commander and the plan change, each with its reason.
  const moves: PlanMove[] = [];
  const lower = (role: Role, by: number, reason: string) => {
    const band = roles[role];
    if (!band) return;
    const lo = Math.max(0, band.lo - by);
    if (lo === band.lo) return;
    moves.push({ role, delta: lo - band.lo, reason });
    band.lo = lo;
    band.hi = Math.max(band.hi, lo);
  };
  const raise = (role: Role, by: number, reason: string) => {
    const band = roles[role];
    if (!band) return;
    band.lo += by;
    band.hi += by;
    moves.push({ role, delta: by, reason });
  };
  const lead = commanders[0];
  const leadName = lead ? shortOf(lead) : '';
  const cmdRoles = new Set(commanders.flatMap((c) => ctx.db.features(c.oracleId)?.roles ?? []));
  const draw = roles.draw;
  if (cmdRoles.has('draw') && draw && draw.lo > 4) {
    const who = commanders.find((c) => ctx.db.features(c.oracleId)?.roles.includes('draw')) ?? lead;
    const lo = Math.max(4, draw.lo - 2);
    moves.push({ role: 'draw', delta: lo - draw.lo, reason: `${shortOf(who)} already draws cards` });
    draw.lo = lo;
  }
  if (commanders.length > 0 && roles.ramp && archetypes.includes('big-mana') && cmdRoles.has('ramp')) roles.ramp.hi += MANA_COMMANDER_RAMP_HI;
  const makesMana = commanders.find((c) => { const r = ctx.db.features(c.oracleId)?.roles ?? []; return r.includes('ramp') || r.includes('fast-mana'); });
  const cheats = commanders.find((c) => COST_CHEAT.test(c.oracleText ?? ''));
  if (makesMana) lower('ramp', 2, `${shortOf(makesMana)} makes mana`);
  else if (cheats) lower('ramp', 2, `${shortOf(cheats)} cheats on mana costs`);
  const selfGuard = commanders.find((c) => {
    const kw = c.keywords ?? [];
    if (kw.some((k) => /^(hexproof|shroud|indestructible)$/i.test(k))) return true;
    return kw.some((k) => /^ward$/i.test(k)) && (/ward (\{[2-9]\}|\{[1-9]\d+\})/i.test(c.oracleText ?? '') || /ward—/i.test(c.oracleText ?? ''));
  });
  if (selfGuard) lower('protection', 2, `${shortOf(selfGuard)} protects itself`);
  if (Math.max(0, ...['voltron', 'equipment', 'auras'].map((a) => weights[a] ?? 0)) >= 0.6) raise('protection', 3, 'A Voltron plan keeps one creature alive');
  const topMv = Math.max(0, ...commanders.map((c) => Math.max(0, Number.isFinite(c.cmc) ? c.cmc : 0)));
  if (topMv >= 6 && !archetypes.includes('big-mana')) raise('ramp', 2, `A ${topMv}-mana commander wants more ramp`);
  if (summary.avgMv <= 2.5 && nonlandCopies >= 20) lower('ramp', 2, `A low curve (average mana value ${r1(summary.avgMv)}) needs less ramp`);
  const stax = (weights.stax ?? 0) >= 0.6;
  if (stax) raise('spot-removal', 2, 'A stax plan answers more threats');

  for (const band of Object.values(roles)) {
    band.lo = Math.max(0, band.lo);
    band.hi = Math.max(1, band.lo, band.hi);
  }
  avgMv.lo = Math.min(avgMv.lo, Math.round((avgMv.hi - 0.4) * 10) / 10);

  // The land target from the plan's curve, ramp, cantrips, landfall and commander.
  let source: 'plan' | 'bracket' | 'pinned' = 'bracket';
  let reason = `${Math.round(lands)} lands, the Bracket ${bracket} default until the deck has spells.`;
  if (onPlan) {
    let ramp2 = 0;
    let cantrips = 0;
    for (const { card, features, qty } of cards) {
      if (isLandCard(features) || commanderIds.has(card.oracleId)) continue;
      if (card.cmc <= 2 && (features.roles.includes('ramp') || features.roles.includes('fast-mana'))) ramp2 += qty;
      if (isCantrip(card, features)) cantrips += qty;
    }
    if (filled > 0 && filled < 1) { ramp2 = Math.min(ramp2 / filled, 30); cantrips = Math.min(cantrips / filled, 30); }
    const rampTerm = Math.max(0, ramp2 - 6) / 3;
    const cantripTerm = cantrips / 4;
    const landfall = (weights.landfall ?? 0) >= 0.6 ? 3 : 0;
    const big = topMv >= 6 ? 1 : 0;
    const shift = LAND_PLAN_BRACKET[i];
    // Calibrated on the fixture lists so the precon (39 at Bracket 2) keeps the reference rating range (packages plan, R3).
    const raw = LAND_PLAN_BASE + LAND_PLAN_PER_MV * mv - rampTerm - cantripTerm + landfall + big + shift;
    lands = clamp(Math.round(raw), LAND_PLAN_MIN, LAND_PLAN_MAX);
    source = 'plan';
    reason = `${lands} lands for an average mana value of ${r1(mv)}`
      + (rampTerm > 0 ? `, ${Math.round(ramp2)} cheap ramp pieces (−${r1(rampTerm)})` : '')
      + (cantripTerm >= 0.05 ? `, ${Math.round(cantrips)} cheap cantrips (−${r1(cantripTerm)})` : '')
      + (landfall ? ', a landfall plan (+3)' : '')
      + (big ? `, a ${topMv}-mana commander (+1)` : '')
      + (shift ? `, Bracket ${bracket} (${shift > 0 ? '+' : '−'}${Math.abs(shift)})` : '')
      + (Math.round(raw) !== lands ? `, held to ${LAND_PLAN_MIN}–${LAND_PLAN_MAX}` : '') + '.';
  }

  // Counts the user asked for on this deck win over everything above.
  for (const [role, raw] of Object.entries(deck.roleTargets ?? {}) as [Role, unknown][]) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const n = Math.min(ROLE_TARGET_MAX, Math.max(0, Math.round(raw)));
    if (role === 'land') { lands = Math.min(LAND_MAX, Math.max(LAND_MIN, n)); source = 'pinned'; reason = `You set ${lands} lands.`; }
    else if (ROLE_LABEL[role] !== undefined && (roles[role] || role !== 'counterspell')) roles[role] = { lo: n, hi: n + ROLE_TARGET_SPAN };
  }

  const finalLands = Math.min(LAND_MAX, Math.max(LAND_MIN, Math.round(lands)));
  return {
    targets: { lands: finalLands, roles, avgMv, themeCards: THEME_CARDS[i], taplandCap: TAPLAND_CAP[i] },
    moves,
    lands: { target: finalLands, reason, source },
    stax,
  };
}

/**
 * Targets for a deck of `cardCount` cards: counts shrink linearly with cardCount / 100, never
 * grow past the full-deck values, and average mana value stays as it is.
 */
export function scaleTargets(t: Targets, cardCount: number): Targets {
  const f = Number.isFinite(cardCount) ? Math.min(1, Math.max(0, cardCount) / 100) : 0;
  const roles: Partial<Record<Role, RoleBand>> = {};
  for (const [role, band] of Object.entries(t.roles) as [Role, RoleBand][]) {
    const lo = Math.round(band.lo * f);
    roles[role] = { lo, hi: Math.max(lo, Math.ceil(band.hi * f)) };
  }
  return {
    lands: Math.round(t.lands * f),
    roles,
    avgMv: { ...t.avgMv },
    themeCards: Math.round(t.themeCards * f),
    taplandCap: Math.ceil(t.taplandCap * f),
  };
}

// ---- role needs: the one count-against-band computation the scorer and the rating share --------

/** Plain names for the roles that have a band. */
export const ROLE_LABEL: Partial<Record<Role, string>> = {
  ramp: 'ramp', draw: 'card draw', 'spot-removal': 'removal', counterspell: 'counterspells', wipe: 'board wipes',
  protection: 'protection', recursion: 'recursion', tutor: 'tutors', 'win-condition': 'win conditions',
  'graveyard-hate': 'graveyard hate',
};

const CANTRIP_MAX_MV = 2;
const CANTRIP_TEXT = /\bdraws? (a|two|three) cards?\b|put (one of them|one of those cards|that card|it) into your hand/i;
/**
 * A cheap card that replaces itself: an instant or sorcery of mana value 2 or less (or a 0-1 mana
 * artifact) that draws or picks a card and does nothing else a role covers (Ponder, Preordain,
 * Gitaxian Probe, Mishra's Bauble). Not card advantage, but what a Bracket 4-5 deck runs in its
 * card-flow slots (deck-theory.md §2.3: "engines + cantrips").
 */
export function isCantrip(card: Card, f: CardFeatures): boolean {
  if (isLandCard(f) || !(card.cmc <= CANTRIP_MAX_MV)) return false;
  const type = card.frontTypeLine ?? card.typeLine ?? '';
  const spell = /\b(Instant|Sorcery)\b/.test(type);
  const bauble = /\bArtifact\b/.test(type) && !/\bCreature\b/.test(type) && card.cmc <= 1 && /\bsacrifice\b/i.test(card.oracleText ?? '');
  if (!spell && !bauble) return false;
  if (f.roles.some((r) => r !== 'game-changer')) return false;
  return CANTRIP_TEXT.test(card.oracleText ?? '');
}

/**
 * The band roles a card fills at a bracket. Its feature roles, plus two bracket rules from
 * deck-theory.md §2.3: at Brackets 4-5 nonland fast mana (rituals, Lotus Petal, Spirit Guides)
 * counts as ramp, and cheap cantrips count as card draw. A land keeps the roles it has (Boseiju
 * is removal) but is never ramp: fast lands are counted with the lands.
 */
export function bandRoles(card: Card, f: CardFeatures, bracket: number): Role[] {
  const roles = f.roles.filter((r) => ROLE_LABEL[r] !== undefined);
  if (bracket >= 4 && !isLandCard(f)) {
    if (!roles.includes('ramp') && f.roles.includes('fast-mana')) roles.push('ramp');
    if (!roles.includes('draw') && isCantrip(card, f)) roles.push('draw');
  }
  return roles;
}

export interface RoleNeed {
  role: Role;
  label: string;
  /** Cards in the deck (commanders included) that fill the role, by `bandRoles`. */
  count: number;
  /** The band the count is held against (scaled to the deck's size when asked for). */
  band: RoleBand;
  /** Cards short of the band's bottom, 0 when it is met. */
  short: number;
  /** Cards past the band's top, 0 when inside it. */
  over: number;
}

export interface RoleNeedOptions {
  /** The deck's summary, when the caller already has it. */
  summary?: DeckSummary;
  /** The deck's unscaled targets (`targetsFor`), when the caller already has them. */
  targets?: Targets;
  /**
   * true: hold the counts against bands scaled to the deck's size so far (the rating's "so far").
   * false (default): against the finished deck's bands (the scorer: what the deck still needs).
   */
  scaled?: boolean;
}

/**
 * Role counts against their bands: THE numbers behind "3 short on ramp" (spec §11). The card
 * score's role part and the rating's role coverage both read this, so a shortfall the rating
 * reports is the one the scorer rewards filling. One entry per role that has a band for this
 * deck, in the order of `ROLE_LABEL`.
 */
export function roleNeeds(deck: Deck, ctx: EngineContext, opts: RoleNeedOptions = {}): RoleNeed[] {
  const bracket = bracketIndex(deck.targetBracket) + 1;
  const summary = opts.summary ?? summarizeDeck(deck, ctx.db);
  const full = opts.targets ?? targetsFor(deck, ctx, summary);
  const targets = opts.scaled ? scaleTargets(full, summary.cardCount) : full;
  const counts: Partial<Record<Role, number>> = {};
  for (const { card, features, qty } of deckCards(deck, ctx.db).cards) {
    for (const role of bandRoles(card, features, bracket)) counts[role] = (counts[role] ?? 0) + qty;
  }
  const out: RoleNeed[] = [];
  for (const role of Object.keys(ROLE_LABEL) as Role[]) {
    const band = targets.roles[role];
    if (!band) continue;
    const count = counts[role] ?? 0;
    out.push({
      role, label: ROLE_LABEL[role] ?? role, count,
      band: { lo: band.lo, hi: band.hi },
      short: Math.max(0, band.lo - count),
      over: Math.max(0, count - band.hi),
    });
  }
  return out;
}
