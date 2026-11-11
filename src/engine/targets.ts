import { landTarget } from './mana';
import { allowedIdentity, commanderCards } from './rules';
import { deckCards, isLandCard, resolveThemeWeights, summarizeDeck } from './summary';
import type { AxisId, Bracket, Card, CardFeatures, Deck, DeckSummary, EngineContext, Role, RoleBand, Targets } from './types';

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
  voltron: { lands: -1, roles: { wipe: -2, protection: 4 }, avgMvHi: 2.8 },
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
/** A commander that draws cards is an engine the 99 need not supply: the draw band's bottom drops. */
const DRAW_COMMANDER_LO = -2;
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
  const i = bracketIndex(deck.targetBracket);
  const bracket = (i + 1) as Bracket;
  const blue = commanderCards(deck, ctx.db).length > 0 && allowedIdentity(deck, ctx.db).has('U');

  const roles: Partial<Record<Role, RoleBand>> = {};
  for (const [role, bands] of Object.entries(ROLE_BANDS) as [Role, PerBracket<Band>][]) {
    roles[role] = { lo: bands[i][0], hi: bands[i][1] };
  }
  const spot = (blue ? SPOT_BLUE : SPOT_NO_BLUE)[i];
  roles['spot-removal'] = { lo: spot[0], hi: spot[1] };
  if (blue) roles.counterspell = { lo: COUNTER_BLUE[i][0], hi: COUNTER_BLUE[i][1] };

  const avgMv: RoleBand = { lo: AVG_MV[i][0], hi: AVG_MV[i][1] };

  // Land target from the curve so far; an empty deck uses the middle of the bracket's band.
  const nonland = summary.cardCount - summary.landCount;
  const mv = nonland > 0 && summary.avgMv > 0 ? summary.avgMv : (avgMv.lo + avgMv.hi) / 2;
  let cheap = 0;
  for (const { card, features, qty } of deckCards(deck, ctx.db).cards) {
    if (isLandCard(features) || !(card.cmc <= 2)) continue;
    if (features.roles.includes('ramp') || features.roles.includes('draw')) cheap += qty;
  }
  // Scale a partial deck's cheap-card count up to a full deck, or the discount lags the build.
  const filled = Math.min(1, Math.max(0, summary.cardCount) / 100);
  if (filled > 0 && filled < 1) cheap = Math.min(cheap / filled, 30);
  let lands = Math.min(LAND_BAND[i][1], Math.max(LAND_BAND[i][0], landTarget(mv, cheap, bracket)));

  const archetypes = deckArchetypes(resolveThemeWeights(deck, ctx));
  for (const key of archetypes) {
    const d = ARCHETYPE[key];
    lands += d.lands ?? 0;
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
  const commanderRoles = new Set(commanderCards(deck, ctx.db).flatMap((c) => ctx.db.features(c.oracleId)?.roles ?? []));
  if (commanderRoles.has('ramp') && archetypes.includes('big-mana') && roles.ramp) roles.ramp.hi += MANA_COMMANDER_RAMP_HI;
  if (commanderRoles.has('draw') && roles.draw) roles.draw.lo += DRAW_COMMANDER_LO;
  for (const band of Object.values(roles)) {
    band.lo = Math.max(0, band.lo);
    band.hi = Math.max(1, band.lo, band.hi);
  }
  avgMv.lo = Math.min(avgMv.lo, Math.round((avgMv.hi - 0.4) * 10) / 10);

  // Counts the user asked for on this deck win over everything above.
  for (const [role, raw] of Object.entries(deck.roleTargets ?? {}) as [Role, unknown][]) {
    if (typeof raw !== 'number' || !Number.isFinite(raw)) continue;
    const n = Math.min(ROLE_TARGET_MAX, Math.max(0, Math.round(raw)));
    if (role === 'land') lands = Math.min(LAND_MAX, Math.max(LAND_MIN, n));
    else if (ROLE_LABEL[role] !== undefined && (roles[role] || role !== 'counterspell')) roles[role] = { lo: n, hi: n + ROLE_TARGET_SPAN };
  }

  return {
    lands: Math.min(LAND_MAX, Math.max(LAND_MIN, Math.round(lands))),
    roles, avgMv,
    themeCards: THEME_CARDS[i],
    taplandCap: TAPLAND_CAP[i],
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
