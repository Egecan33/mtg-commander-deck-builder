import { bracketGate } from '../brackets';
import { isEarly, isRelevant, isTwoCard } from '../brackets/combos';
import { axisLabel } from '../features';
import { TYPE_MEMBER } from '../features/axes';
import { karstenSources } from '../mana';
import { allowedIdentity, cardFitsDeck, commanderCards, copyLimit, deckCounts, isBasicLand } from '../rules';
import { AXIS_MEMBER, isLandCard, resolveThemeWeights, summarizeDeck } from '../summary';
import { ROLE_LABEL, bandRoles, roleNeeds, targetsFor } from '../targets';
import type {
  AxisId, Bracket, Card, CardDb, CardFeatures, CardScore, Color, Combo, Deck, DeckSummary, EdhrecData, EngineContext, Role,
  ScorePart, Targets,
} from '../types';

type PartKey = ScorePart['key'];
type Weights = Record<PartKey, number>;
type Gate = { code: string; message: string };

/** Part weights with EDHREC co-play data (spec §10). */
export const WEIGHTS_EDHREC: Readonly<Weights> = { synergy: 35, coplay: 15, quality: 20, role: 15, cast: 10, bracket: 5 };
/** Without EDHREC the co-play weight moves to synergy (+8) and quality (+7). */
export const WEIGHTS_PLAIN: Readonly<Weights> = { synergy: 43, coplay: 0, quality: 27, role: 15, cast: 10, bracket: 5 };
/** A high-quality card with a core role never scores below this. */
export const STAPLE_FLOOR = 55;
/** Quality from which a core-role card counts as a staple (EDHREC rank about 500 or better). */
export const STAPLE_QUALITY = 0.8;
const CORE_ROLES: readonly Role[] = ['ramp', 'draw', 'spot-removal', 'land'];
/** At Brackets 4-5 fast mana, tutors and counterspells are core roles too. */
const CORE_ROLES_HIGH: readonly Role[] = [...CORE_ROLES, 'fast-mana', 'tutor', 'counterspell'];

const COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G'];
const COLOR_NAME: Record<Color, string> = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

const clamp01 = (n: number) => (n > 0 ? (n < 1 ? n : 1) : 0);
const finite = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);
const r1 = (n: number) => Math.round(n * 10) / 10;
const signed = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);

// ---- quality -------------------------------------------------------------------------------

/** EDHREC rank → quality, through log10(rank). Anchors follow deck-theory.md §6.4, smoothed. */
const RANK_CURVE: readonly (readonly [number, number])[] = [
  [0, 1], [1.7, 1], [2, 0.93], [2.7, 0.8], [3.18, 0.6], [3.6, 0.38], [4, 0.2], [4.5, 0.06],
];
const UNRANKED_QUALITY = 0.08;
const BASIC_LAND_QUALITY = 0.6;

function rankQuality(rank: number | null | undefined): number {
  if (rank === null || rank === undefined || !(rank >= 1)) return UNRANKED_QUALITY;
  const x = Math.log10(rank);
  for (let i = 1; i < RANK_CURVE.length; i++) {
    const [x1, y1] = RANK_CURVE[i];
    if (x <= x1) {
      const [x0, y0] = RANK_CURVE[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return RANK_CURVE[RANK_CURVE.length - 1][1];
}

/** Mana value a role's cards normally cost; each mana above it costs quality. */
const ROLE_BASELINE: Partial<Record<Role, number>> = { ramp: 2, 'spot-removal': 2, counterspell: 2, draw: 3, tutor: 3, wipe: 5 };
const OVERCOST_STEP = 0.05;
const OVERCOST_MAX = 0.15;
const INSTANT_BONUS = 0.05;
/**
 * Power, not popularity, at Brackets 4-5: a card's quality there is at least what its power tier
 * earns ([Bracket 4, Bracket 5]). Mana Vault and Demonic Consultation are in few decks overall,
 * and in every deck that can run them at these brackets.
 */
const TIER_QUALITY: Partial<Record<number, readonly [number, number]>> = { 5: [1, 1], 4: [0.88, 0.9] };
/** ...less this much for a card nobody plays, so the tier's best-known cards lead it. */
const TIER_RANK_SPREAD = 0.2;

// ---- role need -----------------------------------------------------------------------------

/** How much filling a role is worth next to the core roles. */
const ROLE_VALUE: Partial<Record<Role, number>> = {
  ramp: 1, draw: 1, 'spot-removal': 1, counterspell: 0.9, wipe: 0.9,
  protection: 0.7, recursion: 0.7, tutor: 0.7, 'win-condition': 0.7, 'graveyard-hate': 0.6,
};
/** Tutors and counterspells are worth as much as ramp from Bracket 4 up; wipes are worth less. */
const ROLE_VALUE_HIGH: Partial<Record<Role, number>> = { ...ROLE_VALUE, tutor: 1, counterspell: 1, wipe: 0.6 };
const roleValue = (role: Role, bracket: number): number | undefined => (bracket >= 4 ? ROLE_VALUE_HIGH : ROLE_VALUE)[role];
/** Lands short of the target at which a land is worth the full role part. */
const LAND_SHORT_FULL = 6;

// ---- bracket fit ---------------------------------------------------------------------------

const IDEAL_TIER = [2, 2.5, 3.5, 4.5, 5];
const TAPLAND_PENALTY = [0, 0, 0, 8, 10]; // points per tapland weight
const BIG_SPELL_PENALTY_B5 = 12;          // nonland cards of mana value 6+
/** Bracket 5: ramp that costs three or more, and two-mana land-search spells, are too slow. */
const SLOW_RAMP_PENALTY_B5 = 8;
const SPELL_RAMP_PENALTY_B5 = 5;
/** Bracket 4: ramp at four or more mana. */
const SLOW_RAMP_PENALTY_B4 = 4;
/**
 * Brackets 1-2: top-tier power (fast mana, free interaction) that precons do not carry is out of
 * place. Cards every precon runs (EDHREC rank 100 or better: Sol Ring) are exempt.
 */
const OVERPOWERED_PENALTY = [10, 6, 0, 0, 0];
const PRECON_STAPLE_RANK = 100;

// ---- combos --------------------------------------------------------------------------------

/** Synergy strength of completing an allowed combo, by bracket. Bracket 1 decks do not combo. */
const COMBO_COMPLETE = [0, 0.3, 0.8, 1, 1];
/** ...and of a card whose combo still needs exactly one more card the deck could run. */
const COMBO_PARTIAL = [0, 0, 0.4, 0.7, 0.8];
/** A completed combo is also a way to win: this share of the role part, by bracket. */
const COMBO_ROLE = [0, 0, 0.5, 0.9, 1];
/** Combos larger than this are too loose to plan around. */
const COMBO_MAX_CARDS = 4;
/**
 * Spellbook popularity (decks) at which a combo counts in full, on a log scale: Thassa's Oracle +
 * Demonic Consultation is far past it, a combo in 300 decks weighs about half.
 */
const COMBO_POPULAR = 50000;
/** Share of the credit an unpopular but complete combo still gets. */
const COMBO_OBSCURE_SHARE = 0.75;
/** Half of a two-card combo (partner not in the deck yet) only counts for combos this well known (weight 0..1). */
const COMBO_HALF_MIN_WEIGHT = 0.8;
// ---- castability and curve -----------------------------------------------------------------

/** Share of nonland cards per mana-value bucket (0..7+) a finished deck of each bracket aims at. */
const CURVE_SHAPE: readonly (readonly number[])[] = [
  [0.02, 0.13, 0.23, 0.24, 0.18, 0.11, 0.06, 0.03],
  [0.02, 0.14, 0.24, 0.24, 0.17, 0.10, 0.06, 0.03],
  [0.03, 0.16, 0.26, 0.23, 0.16, 0.09, 0.05, 0.02],
  [0.05, 0.22, 0.28, 0.21, 0.12, 0.07, 0.03, 0.02],
  [0.10, 0.32, 0.28, 0.15, 0.08, 0.04, 0.02, 0.01],
];
/** Share of a finished deck's lands expected to make any one colour, by number of colours. */
const SOURCE_SHARE = [1, 1, 0.75, 0.6, 0.52, 0.48];
const COMMANDER_MV_PENALTY = 0.15;
/** Quality left to a mana source that makes no mana for this commander. */
const NO_MANA_QUALITY = 0.1;

/**
 * True when every mana ability of the card adds mana "of any color in your commander's color
 * identity" (Command Tower, Arcane Signet, Commander's Sphere, Path of Ancestry). With a colourless
 * commander there is no such colour, so the card makes no mana at all.
 */
function onlyIdentityMana(card: Card): boolean {
  let any = false;
  for (const sentence of card.oracleText.split(/[.\n]/)) {
    if (!/\badd\b/i.test(sentence)) continue;
    if (!/commander['’]s color identity/i.test(sentence)) return false;
    any = true;
  }
  return any;
}
const LAND_LIGHT_PENALTY = 0.2;

// ---- synergy -------------------------------------------------------------------------------

const THEME_SHARPEN = 1.5;
const SECOND_AXIS_BONUS = 0.15;
const SECOND_AXIS_WEIGHT = 0.5;
const SCARCE_SIDE_BOOST = 1.15;
/** Axis members needed before one side can be called scarce. */
const SCARCE_MIN_CARDS = 4;
/**
 * A good utility card belongs in any deck: a card with a deck-building role gets at least this
 * share of the synergy part, times its quality. Without it an off-theme staple could not score
 * above the staple floor and all staples would tie there.
 */
const UTILITY_SYNERGY = 0.45;
/**
 * The format's best utility cards (Sol Ring, Swords to Plowshares, Cultivate) belong near the top
 * of every deck's list, not under two hundred theme cards: their share rises with the cube of
 * quality, which overtakes the linear share from staple quality (0.8) up and reaches this at 1.
 * The part above the linear share is only paid while the deck still wants the card's role: full
 * while a role is under its band, fading to nothing at the band's top, so the fifteenth mana rock
 * is not rated like the first.
 */
const ELITE_UTILITY_SYNERGY = 0.65;
/**
 * At Brackets 4-5 the top power tier (fast mana, free interaction, Game Changers) takes a larger
 * share than a merely popular staple: Mana Vault belongs above Rampant Growth there.
 */
const POWER_UTILITY_SYNERGY = 0.8;
/** Role need (0..1) from which the elite share is paid in full. */
const ELITE_FULL_NEED = 0.35;
/**
 * Theme synergy is scaled by 0.65 + 0.35 × quality: a theme card nobody plays is a weaker fit
 * than its rules text alone suggests, and should not outrank the format's staples.
 */
const SYNERGY_QUALITY_FLOOR = 0.65;
/**
 * Global popularity understates a card that only a few decks can use: Ingenious Infiltrator is in
 * few decks because few decks are Ninja decks, not because it is weak in one. A theme piece's
 * quality is lifted toward 1 by this share of the gap, times how well it matches the theme, so
 * order by popularity is kept and the deck's own cards are not buried under generic staples.
 */
const THEME_QUALITY_LIFT = 0.45;
/** A land's theme synergy counts for this much; the rest of its synergy part is colour fixing. */
const LAND_THEME_SHARE = 0.5;
/** Theme strength (commander weight × card strength) from which a card counts as a theme piece. */
const THEME_MEMBER = 0.5;
/** Worth of filling the deck's theme-piece count: as much as a core role, since the theme is the deck. */
const THEME_NEED_VALUE = 1;

// ---- co-play -------------------------------------------------------------------------------

/** Decks at which EDHREC numbers are trusted half-way. */
const COPLAY_SHRINK = 30;
/** Share of the global-rank quality used as the prior for cards the commander's page lacks. */
const COPLAY_PRIOR = 0.35;

// ---- per-card data that does not depend on the deck's 99 ----------------------------------

interface Stat {
  card: Card;
  f: CardFeatures | undefined;
  gate: Gate | null;          // banned or outside the colour identity
  checkBracket: boolean;      // bracketGate can only fire for these
  land: boolean;
  syn: number;                // 0..1 before the scarce-side boost
  elite: number;              // extra synergy share of a top utility card, paid while its role is wanted
  synAxis: AxisId | null;
  synSide: 'e' | 'p';
  synText: string;
  fix: number;                // lands: how well it fixes this deck's colours, else 0
  fixText: string;
  coplay: number;             // points
  coplayText: string;
  quality: number;            // 0..1
  qualityPts: number;
  qualityText: string;
  fitPts: number;             // bracket-fit points, penalties included (may be negative)
  fitText: string;
  fitBase: number;            // bracket-fit points before any penalty
  fitSpeed: boolean;          // the penalty in fitPts is for being too slow or expensive
  roles: Role[];              // roles with a need value
  pipReq: [Color, number][];  // sources needed per colour to cast it on curve
  bucket: number;             // mana-value bucket 0..7
  atCommanderMv: boolean;
  tapland: number;
  noMana: boolean;            // a mana source that makes nothing for a colourless commander
  staple: boolean;
  themeMember: boolean;       // nonland card that is a piece of the deck's theme
}

interface StaticCache {
  key: string;
  edhrec: EdhrecData | null;
  all: readonly Card[];
  stats: Map<string, Stat>;
  lifts: number[] | null;     // sorted lifts of the commander's page
}
const CACHE_PER_DB = 6;
const caches = new WeakMap<CardDb, StaticCache[]>();

interface Setup {
  deck: Deck; ctx: EngineContext; bracket: Bracket; weights: Weights;
  theme: Record<AxisId, number>;
  /** Theme weights sharpened (w × (w / strongest)^0.5) so the deck's main theme outranks its side themes. */
  pull: Record<AxisId, number>;
  identity: Set<Color>; hasCommander: boolean; commanderMvs: Set<number>;
}

function staticCache(s: Setup): StaticCache {
  const { deck, ctx } = s;
  const theme = Object.entries(s.theme).filter(([, w]) => Number.isFinite(w) && w > 0).sort((a, b) => a[0].localeCompare(b[0]));
  const key = JSON.stringify([deck.commanders, deck.chosenColor, s.bracket, theme]);
  const all = ctx.db.all();
  let list = caches.get(ctx.db);
  if (!list) caches.set(ctx.db, (list = []));
  const hit = list.find((c) => c.key === key && c.edhrec === ctx.edhrec && c.all === all);
  if (hit) return hit;
  let lifts: number[] | null = null;
  if (ctx.edhrec) {
    lifts = [];
    for (const c of Object.values(ctx.edhrec.cards ?? {})) if (c && typeof c.lift === 'number' && Number.isFinite(c.lift)) lifts.push(c.lift);
    lifts.sort((a, b) => a - b);
  }
  const fresh: StaticCache = { key, edhrec: ctx.edhrec, all, stats: new Map(), lifts };
  list.unshift(fresh);
  if (list.length > CACHE_PER_DB) list.length = CACHE_PER_DB;
  return fresh;
}

/** Share of `sorted` strictly below `value`. */
function percentile(sorted: number[], value: number): number {
  if (sorted.length <= 1) return 0.5;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < value) lo = mid + 1;
    else hi = mid;
  }
  return clamp01(lo / (sorted.length - 1));
}

const CREATURE = /\bCreature\b/;
const SPELL = /\b(Instant|Sorcery)\b/;
const typalFamily = (axis: AxisId) => (axis === 'typal' || axis.startsWith('typal:') ? 'typal' : axis);

function buildStat(card: Card, s: Setup, cache: StaticCache): Stat {
  const { deck, ctx, weights, bracket } = s;
  const { db } = ctx;
  const f = db.features(card.oracleId);
  const land = f ? isLandCard(f) : false;
  const mv = Math.max(0, finite(card.cmc));

  // Gate: legality and colour identity. The common case is decided here; anything else goes
  // through cardFitsDeck, which knows the Rulebreaker commanders.
  let gate: Gate | null = null;
  let fits = card.legality === 'legal' && !card.isMeldResult;
  if (fits && s.hasCommander) for (const c of card.colorIdentity) if (!s.identity.has(c)) { fits = false; break; }
  if (!fits) {
    const v = cardFitsDeck(card, deck, db);
    if (v) gate = { code: v.code, message: v.message };
  }

  const roles = f?.roles ?? [];
  const tier = f?.powerTier ?? 2;
  const colourless = s.hasCommander && s.identity.size === 0;
  const noMana = colourless && onlyIdentityMana(card);
  const checkBracket = card.gameChanger || db.combosFor(card.oracleId).length > 0
    || roles.includes('mass-land-denial') || roles.includes('extra-turn') || roles.includes('game-changer');

  // Synergy: best axis by commander weight × card strength, plus a bonus for a second strong axis.
  let syn = 0;
  let synAxis: AxisId | null = null;
  let synSide: 'e' | 'p' = 'e';
  let second = false;
  if (f) {
    for (const axis in f.axes) {
      const w = s.pull[axis];
      if (w === undefined) continue;
      const a = f.axes[axis];
      const e = finite(a?.e);
      const p = finite(a?.p);
      const v = w * clamp01(Math.max(e, p));
      if (v > syn) { syn = v; synAxis = axis; synSide = p > e ? 'p' : 'e'; }
    }
    // A changeling is every creature type: a member of whichever type the deck is built on.
    if (CREATURE.test(card.frontTypeLine ?? card.typeLine ?? '') && finite(f.axes.typal?.e) >= AXIS_MEMBER) {
      for (const axis in s.pull) {
        if (!axis.startsWith('typal:')) continue;
        const v = s.pull[axis] * TYPE_MEMBER;
        if (v > syn) { syn = v; synAxis = axis; synSide = 'e'; }
      }
    }
    if (synAxis) {
      const family = typalFamily(synAxis);
      for (const axis in f.axes) {
        if (axis === synAxis || typalFamily(axis) === family) continue;
        const a = f.axes[axis];
        if (finite(s.theme[axis]) >= SECOND_AXIS_WEIGHT && Math.max(finite(a?.e), finite(a?.p)) >= AXIS_MEMBER) { second = true; break; }
      }
    }
  }
  if (second) syn = Math.min(1, syn + SECOND_AXIS_BONUS);

  // Lands: how many of the deck's colours it makes.
  let fix = 0;
  let fixText = '';
  const tapland = clamp01(finite(f?.taplandWeight));
  if (f && land) {
    const colors = s.hasCommander ? COLORS.filter((c) => s.identity.has(c)) : COLORS;
    const made = colors.filter((c) => finite(f.sources[c]) > 0);
    if (noMana) {
      fix = 0;
      fixText = 'makes no mana with a colourless commander';
    } else if (colors.length === 0 || (!s.hasCommander && made.length === 0)) {
      // A colourless deck pays generic costs with any mana, so a land that makes a colour counts too.
      // (A fetchland counts as a source of its colours but finds nothing in such a deck.)
      const makes = finite(f.sources.C) > 0 || (/\badd\b/i.test(card.oracleText) && COLORS.some((c) => finite(f.sources[c]) > 0));
      fix = makes ? 0.5 : 0.15;
      fixText = finite(f.sources.C) > 0 ? 'makes colourless mana' : makes ? 'makes mana' : 'utility land';
    } else if (made.length === 0) {
      fix = 0.08;
      fixText = "makes none of the deck's colours";
    } else {
      let sum = 0;
      for (const c of made) sum += Math.min(1, finite(f.sources[c]));
      fix = 0.1 + 0.4 * (sum / colors.length);
      fixText = made.length === colors.length && colors.length > 1 ? "makes all of the deck's colours" : `makes ${made.map((c) => COLOR_NAME[c]).join(' and ')} mana`;
    }
    fix *= 1 - 0.25 * tapland;
  }

  // Quality: global popularity, a little for instant-speed interaction, less for costing too much.
  const basic = isBasicLand(card);
  const rankQ = basic ? BASIC_LAND_QUALITY : rankQuality(card.edhrecRank);
  let quality = rankQ;
  let qualityText = basic ? 'basic land' : card.edhrecRank ? `EDHREC rank ${card.edhrecRank}` : 'no popularity data';
  if (f && !land) {
    const interaction = roles.includes('spot-removal') || roles.includes('counterspell') || roles.includes('wipe');
    if (interaction && f.instantSpeed) { quality += INSTANT_BONUS; qualityText += ', instant speed'; }
    let over = Infinity;
    for (const role of roles) {
      const base = ROLE_BASELINE[role];
      if (base !== undefined) over = Math.min(over, mv - base);
    }
    // A creature or planeswalker brings a body with the effect; only plain spells are held to the role's price.
    if (over !== Infinity && over >= 1 && !/\b(Creature|Planeswalker)\b/.test(card.frontTypeLine ?? card.typeLine ?? '')) {
      quality -= Math.min(OVERCOST_MAX, OVERCOST_STEP * Math.floor(over));
      qualityText += ', costs more than most cards doing this job';
    }
  }
  const tierTop = bracket >= 4 ? TIER_QUALITY[f?.powerTier ?? 0]?.[bracket - 4] : undefined;
  const tierQuality = tierTop === undefined ? undefined : tierTop - TIER_RANK_SPREAD * (1 - rankQ);
  if (tierQuality !== undefined && tierQuality > quality) {
    quality = tierQuality;
    qualityText = `${basic || !card.edhrecRank ? '' : `EDHREC rank ${card.edhrecRank}, `}top-tier power at Bracket ${bracket}`;
  }
  if (f && !land && syn > 0) {
    const lifted = quality + (1 - quality) * THEME_QUALITY_LIFT * Math.min(1, syn);
    if (lifted - quality >= 0.05) qualityText += ', a theme piece (popularity counts for less)';
    quality = lifted;
  }
  if (noMana) {
    quality = Math.min(quality, NO_MANA_QUALITY);
    qualityText = 'makes no mana with a colourless commander';
  }
  quality = clamp01(quality);

  const needRoles = f ? bandRoles(card, f, bracket).filter((r) => roleValue(r, bracket) !== undefined && !(noMana && r === 'ramp')) : [];
  let synText = synAxis ? `${axisLabel(synAxis)} ${synSide === 'p' ? 'payoff' : 'piece'}${second ? ', fits a second theme' : ''}` : '';
  const themeMember = !land && syn >= THEME_MEMBER;
  if (land) syn *= LAND_THEME_SHARE;
  else syn *= SYNERGY_QUALITY_FLOOR + (1 - SYNERGY_QUALITY_FLOOR) * quality;
  let elite = 0;
  const topPower = bracket >= 4 && tier >= 5;
  if (!land && (needRoles.length > 0 || topPower)) {
    if (UTILITY_SYNERGY * quality > syn) {
      syn = UTILITY_SYNERGY * quality;
      synAxis = null;
      synText = needRoles.length > 0 ? `good ${ROLE_LABEL[needRoles[0]]} for any deck` : `top-tier power at Bracket ${bracket}`;
    }
    if (needRoles.length > 0) elite = Math.max(0, (topPower ? POWER_UTILITY_SYNERGY : ELITE_UTILITY_SYNERGY) * quality ** 3 - syn);
  }

  // Co-play: EDHREC inclusion and lift on this commander's page, shrunk toward a global prior.
  let coplay = 0;
  let coplayText = '';
  if (ctx.edhrec && weights.coplay > 0) {
    const prior = COPLAY_PRIOR * rankQ;
    const entry = ctx.edhrec.cards?.[card.oracleId];
    let d = prior;
    if (entry && finite(entry.numDecks) > 0) {
      const sample = finite(entry.potentialDecks) > 0 ? finite(entry.potentialDecks) : finite(ctx.edhrec.commanderDecks);
      const inclusion = clamp01(finite(entry.numDecks) / Math.max(1, sample));
      const incPart = Math.sqrt(inclusion);
      const hasLift = typeof entry.lift === 'number' && Number.isFinite(entry.lift);
      const raw = hasLift ? 0.5 * incPart + 0.5 * percentile(cache.lifts ?? [], entry.lift as number) : incPart;
      const trust = sample / (sample + COPLAY_SHRINK);
      d = trust * raw + (1 - trust) * prior;
      coplayText = `in ${Math.round(inclusion * 100)}% of this commander's decks on EDHREC`;
    } else {
      coplayText = "not on this commander's EDHREC page";
    }
    coplay = r1(weights.coplay * clamp01(d));
  }

  // Bracket fit: distance from the bracket's ideal power tier, and what the bracket punishes.
  // A card every precon carries (Sol Ring) is at home at any table, whatever its tier.
  const everywhere = bracket <= 3 && card.edhrecRank !== null && card.edhrecRank >= 1 && card.edhrecRank <= PRECON_STAPLE_RANK;
  const fitBase = weights.bracket * (everywhere ? 1 : 1 - Math.abs(tier - IDEAL_TIER[bracket - 1]) / 4);
  let fitPts = fitBase;
  let fitText = '';
  let fitSpeed = false; // the penalty is for being slow or expensive, which a combo piece is forgiven
  if (land && tapland > 0 && TAPLAND_PENALTY[bracket - 1] > 0) {
    fitPts -= TAPLAND_PENALTY[bracket - 1] * tapland;
    fitText = `enters tapped, too slow for Bracket ${bracket}`;
  } else if (!land && bracket === 5 && mv >= 6) {
    fitPts -= BIG_SPELL_PENALTY_B5;
    fitText = `${mv} mana is too much for Bracket 5`;
    fitSpeed = true;
  } else if (!land && bracket >= 4 && roles.includes('ramp') && !roles.includes('fast-mana') && !(finite(f?.axes['big-mana']?.e) >= 0.6)) {
    // Ramp that makes one mana a turn has to come down early at these brackets.
    const spell = SPELL.test(card.frontTypeLine ?? card.typeLine ?? '');
    if (bracket === 5 && mv >= 3) {
      fitPts -= SLOW_RAMP_PENALTY_B5;
      fitText = `${mv}-mana ramp is too slow for Bracket 5`;
    } else if (bracket === 5 && spell && mv >= 2) {
      fitPts -= SPELL_RAMP_PENALTY_B5;
      fitText = 'land-search ramp is slow for Bracket 5; mana creatures and rocks come first';
    } else if (bracket === 4 && mv >= 4) {
      fitPts -= SLOW_RAMP_PENALTY_B4;
      fitText = `${mv}-mana ramp is slow for Bracket 4`;
    }
  } else if (!land && OVERPOWERED_PENALTY[bracket - 1] > 0 && tier >= 5 && !(card.edhrecRank !== null && card.edhrecRank <= PRECON_STAPLE_RANK)) {
    fitPts -= OVERPOWERED_PENALTY[bracket - 1];
    fitText = `stronger than Bracket ${bracket} tables expect`;
  }

  const pipReq: [Color, number][] = [];
  if (f && !land) {
    for (const c of COLORS) {
      const pips = finite(f.pips[c]);
      if (pips > 0) pipReq.push([c, karstenSources(pips, mv)]);
    }
  }
  const coreRoles = bracket >= 4 ? CORE_ROLES_HIGH : CORE_ROLES;
  const core = !noMana && (land || roles.some((r) => coreRoles.includes(r)));

  return {
    card, f, gate, checkBracket, land,
    syn, elite, synAxis, synSide, synText, fix, fixText,
    coplay, coplayText,
    quality, qualityPts: r1(weights.quality * quality), qualityText,
    fitPts: r1(fitPts), fitText, fitBase: r1(fitBase), fitSpeed,
    roles: needRoles, pipReq,
    bucket: Math.min(7, Math.floor(mv)),
    atCommanderMv: !land && s.commanderMvs.has(mv),
    tapland, noMana,
    staple: core && quality >= STAPLE_QUALITY,
    themeMember,
  };
}

// ---- what the score reads off the deck -----------------------------------------------------

interface State {
  counts: Map<string, number>;
  roleNeed: Partial<Record<Role, number>>;   // 0..1, already scaled by ROLE_VALUE
  roleText: Partial<Record<Role, string>>;
  roleBand: Partial<Record<Role, { count: number; lo: number; hi: number; label: string }>>;
  landNeed: number;
  landText: string;
  themeNeed: number;                         // 0..1, already scaled by THEME_NEED_VALUE
  themeText: string;
  sources: Record<Color, number>;            // projected to the finished deck
  curveFit: number[];
  scarce: Map<AxisId, 'e' | 'p'>;
  taplandsOver: boolean;
  landLight: boolean;
}

function bandNeed(count: number, lo: number, hi: number): number {
  if (count >= hi) return 0;
  if (count < lo) return 0.5 + (0.5 * (lo - count)) / Math.max(1, lo);
  return (0.5 * (hi - count)) / Math.max(1, hi - lo);
}

function buildState(deck: Deck, s: Setup, themeCount: number): State {
  const { ctx, bracket } = s;
  const summary: DeckSummary = summarizeDeck(deck, ctx.db);
  const targets: Targets = targetsFor(deck, ctx, summary);

  const roleNeed: State['roleNeed'] = {};
  const roleText: State['roleText'] = {};
  const roleBand: State['roleBand'] = {};
  // The same counts and bands the rating reports (targets.ts `roleNeeds`), against the finished deck.
  for (const n of roleNeeds(deck, ctx, { summary, targets })) {
    roleBand[n.role] = { count: n.count, lo: n.band.lo, hi: n.band.hi, label: n.label };
    const need = clamp01(bandNeed(n.count, n.band.lo, n.band.hi)) * (roleValue(n.role, bracket) ?? 0);
    if (need <= 0) continue;
    roleNeed[n.role] = need;
    roleText[n.role] = n.short > 0
      ? `deck is ${n.short} short on ${n.label}`
      : `deck has room for more ${n.label} (${n.count} of up to ${n.band.hi})`;
  }

  const landsShort = targets.lands - finite(summary.landsEffective);
  const landNeed = clamp01(landsShort / LAND_SHORT_FULL);
  const landText = landsShort >= 1 ? `deck is ${Math.round(landsShort)} short on lands` : '';

  const themeNeed = targets.themeCards > 0 ? clamp01((targets.themeCards - themeCount) / targets.themeCards) * THEME_NEED_VALUE : 0;
  const themeText = `deck has ${themeCount} of about ${targets.themeCards} theme cards`;

  // Sources: what the deck has, plus what the lands still to come should add.
  const landsLeft = clamp01(1 - finite(summary.landsEffective) / Math.max(1, targets.lands));
  const nColors = s.hasCommander ? s.identity.size : 1;
  const prior = targets.lands * SOURCE_SHARE[Math.min(5, nColors)] * landsLeft;
  const sources = {} as Record<Color, number>;
  for (const c of COLORS) sources[c] = finite(summary.sources[c]) + (s.hasCommander && !s.identity.has(c) ? 0 : prior);

  const slots = Math.max(1, 100 - targets.lands);
  const curveFit = CURVE_SHAPE[bracket - 1].map((share, i) => {
    const ratio = finite(summary.curve[i]) / Math.max(0.5, share * slots);
    return ratio <= 0.8 ? 1 : ratio >= 1.3 ? 0.2 : 1 - ((ratio - 0.8) / 0.5) * 0.8;
  });

  const scarce = new Map<AxisId, 'e' | 'p'>();
  for (const [axis, t] of Object.entries(summary.axisTotals)) {
    if (!(finite(s.theme[axis]) > 0) || t.e + t.p < SCARCE_MIN_CARDS) continue;
    if (t.e < 0.6 * t.p) scarce.set(axis, 'e');
    else if (t.p < 0.6 * t.e) scarce.set(axis, 'p');
  }

  return {
    counts: deckCounts(deck),
    roleNeed, roleText, roleBand, landNeed, landText, themeNeed, themeText, sources, curveFit, scarce,
    taplandsOver: finite(summary.taplands) >= targets.taplandCap,
    landLight: summary.cardCount >= 60 && finite(summary.landsEffective) < targets.lands * (summary.cardCount / 100) - 3,
  };
}

/** The deck with one copy of a main-deck card taken out. */
function withoutOne(deck: Deck, oracleId: string): Deck {
  let taken = false;
  const main = [];
  for (const entry of deck.main) {
    if (!taken && entry.oracleId === oracleId && Number.isFinite(entry.qty) && entry.qty >= 1) {
      taken = true;
      if (Math.floor(entry.qty) > 1) main.push({ ...entry, qty: Math.floor(entry.qty) - 1 });
      continue;
    }
    main.push(entry);
  }
  return { ...deck, main };
}

interface ComboInfo { combo: Combo; twoCard: boolean; early: boolean; weight: number }
const comboLists = new WeakMap<CardDb, Map<string, ComboInfo[]>>();
/**
 * The card's combos worth planning around, cached per database: bracket-relevant (infinite,
 * game-winning or a lock), needing nothing beyond the listed cards, and at most four cards.
 */
function combosOf(db: CardDb, oracleId: string): ComboInfo[] {
  let perDb = comboLists.get(db);
  if (!perDb) comboLists.set(db, (perDb = new Map()));
  let list = perDb.get(oracleId);
  if (!list) {
    list = [];
    for (const combo of db.combosFor(oracleId)) {
      if (combo.requiresCount !== 0 || combo.cards.length < 2 || combo.cards.length > COMBO_MAX_CARDS || !isRelevant(combo)) continue;
      const known = clamp01(Math.log10(1 + Math.max(0, finite(combo.popularity))) / Math.log10(1 + COMBO_POPULAR));
      list.push({ combo, twoCard: isTwoCard(combo), early: isEarly(combo, db), weight: known });
    }
    perDb.set(oracleId, list);
  }
  return list;
}
interface ComboCredit { strength: number; complete: boolean; text: string }

interface Ranked { id: string; q: number; rank: number }
const NO_RANKS: Ranked[] = [];
const FLOOR_ORDER: readonly PartKey[] = ['quality', 'role', 'synergy', 'cast', 'bracket', 'coplay'];

/**
 * Scores cards for one deck (spec §10): how much each belongs in this deck right now, 0–100, with
 * the six parts and plain-language reasons. A card already in the main deck is scored against the
 * deck without one copy of it, so cards in and out of the deck share one scale. Gated cards
 * (banned, off-colour, over the copy limit, breaking the target bracket) score 0 and say why.
 *
 * Parts that do not depend on the 99 are cached per database, commanders, bracket, theme weights
 * and EDHREC data, so a new scorer after a deck edit only redoes the deck-dependent parts.
 * The scorer is a snapshot: build a new one after the deck changes.
 */
export function createScorer(deck: Deck, ctx: EngineContext): {
  score(card: Card): CardScore;
  scoreAll(filter?: (c: Card) => boolean): CardScore[];
} {
  const { db } = ctx;
  const bracket = (Math.min(5, Math.max(1, Math.round(Number(deck.targetBracket) || 3)))) as Bracket;
  const theme = resolveThemeWeights(deck, ctx) ?? {};
  const commanders = commanderCards(deck, db);
  const weights: Weights = ctx.edhrec ? { ...WEIGHTS_EDHREC } : { ...WEIGHTS_PLAIN };
  // Theme weights are resolved once and pinned, so every leave-one-out deck reads the same ones.
  const pinned: Deck = { ...deck, targetBracket: bracket, themeWeights: theme };
  const pull: Record<AxisId, number> = {};
  let topWeight = 0;
  for (const w of Object.values(theme)) if (Number.isFinite(w) && w > topWeight) topWeight = Math.min(1, w);
  for (const [axis, w] of Object.entries(theme)) {
    if (Number.isFinite(w) && w > 0) pull[axis] = clamp01(w) * (clamp01(w) / topWeight) ** (THEME_SHARPEN - 1);
  }
  const setup: Setup = {
    deck: pinned, ctx, bracket, weights, theme, pull,
    identity: allowedIdentity(deck, db),
    hasCommander: commanders.length > 0,
    commanderMvs: new Set(commanders.map((c) => Math.max(0, finite(c.cmc)))),
  };
  const cache = staticCache(setup);
  const statOf = (card: Card): Stat => {
    let stat = cache.stats.get(card.oracleId);
    if (!stat || stat.card !== card) {
      stat = buildStat(card, setup, cache);
      cache.stats.set(card.oracleId, stat);
    }
    return stat;
  };
  const commanderSlots = new Map<string, number>();
  for (const cid of deck.commanders) commanderSlots.set(cid, (commanderSlots.get(cid) ?? 0) + 1);
  const mainIds = new Set<string>();
  let themeCount = 0;
  for (const entry of deck.main) {
    if (!Number.isFinite(entry.qty) || entry.qty < 1) continue;
    mainIds.add(entry.oracleId);
    const card = db.get(entry.oracleId);
    if (card && statOf(card).themeMember) themeCount += Math.floor(entry.qty);
  }
  const base = buildState(pinned, setup, themeCount);

  /**
   * The deck's own cards per role, strongest first. A role is filled by its best cards: the
   * thirteenth mana rock is the surplus one, not Sol Ring. So a card's role need is read as if
   * the deck held only the role's cards that are stronger than it (see `rankedNeed`).
   */
  let roleRanks: Map<Role, Ranked[]> | null = null;
  const playRank = (c: Card) => (c.edhrecRank !== null && c.edhrecRank >= 1 ? c.edhrecRank : Infinity);
  // Equal quality (both at the cap): the more played card is the stronger one.
  const stronger = (a: Ranked, b: Stat) => a.q > b.quality || (a.q === b.quality && (a.rank < playRank(b.card) || (a.rank === playRank(b.card) && a.id < b.card.oracleId)));
  function ranksOf(role: Role): Ranked[] {
    if (!roleRanks) {
      roleRanks = new Map();
      for (const entry of deck.main) {
        if (!Number.isFinite(entry.qty) || entry.qty < 1) continue;
        const card = db.get(entry.oracleId);
        if (!card) continue;
        const stat = statOf(card);
        for (const r of stat.roles) {
          let list = roleRanks.get(r);
          if (!list) roleRanks.set(r, (list = []));
          for (let k = 0; k < Math.floor(entry.qty); k++) list.push({ id: entry.oracleId, q: stat.quality, rank: playRank(card) });
        }
      }
    }
    return roleRanks.get(role) ?? NO_RANKS;
  }
  /**
   * Role need of a card that is stronger than some of the deck's cards in that role: the need the
   * role would have with only the stronger ones in it. Null when the card is the weakest of them
   * (the plain count applies) or the role has no band.
   */
  function rankedNeed(role: Role, stat: Stat, st: State): { need: number; text: string } | null {
    const b = st.roleBand[role];
    if (!b || b.count <= 0) return null;
    let above = 0;
    let others = 0;
    for (const x of ranksOf(role)) {
      if (x.id === stat.card.oracleId) continue;
      others++;
      if (stronger(x, stat)) above++;
    }
    // Commanders count toward the band but are not ranked: they stay ahead of every card.
    const count = Math.max(0, b.count - others) + above;
    if (count >= b.count) return null;
    const need = clamp01(bandNeed(count, b.lo, b.hi)) * (roleValue(role, bracket) ?? 0);
    if (need <= 0) return null;
    const beaten = b.count - count;
    return { need, text: `stronger than ${beaten === b.count ? (beaten === 1 ? 'the' : `all ${beaten}`) : `${beaten} of the ${b.count}`} ${b.label} ${b.count === 1 ? 'card' : 'cards'} ${mainIds.has(stat.card.oracleId) ? 'beside it' : 'in the deck'} (it wants ${b.lo}-${b.hi})` };
  }

  const leaveOneOut = new Map<string, State>();
  const overrides = Object.keys(ctx.mldOverrides ?? {}).length + Object.keys(ctx.extraTurnOverrides ?? {}).length > 0;

  const stateFor = (oracleId: string): State => {
    if (!mainIds.has(oracleId)) return base;
    let st = leaveOneOut.get(oracleId);
    if (!st) {
      const card = db.get(oracleId);
      const member = card !== undefined && statOf(card).themeMember;
      leaveOneOut.set(oracleId, (st = buildState(withoutOne(pinned, oracleId), setup, themeCount - (member ? 1 : 0))));
    }
    return st;
  };

  /**
   * Credit for a combo the card completes, or is one card short of, with the commander or with
   * cards already in the deck. Never for a combo the target bracket forbids: no combos at Bracket
   * 1, no two-card combos at Bracket 2, no early two-card combos at Bracket 3.
   *
   * Built once per scorer from the combos of the cards in the deck, so scoring the pool does not
   * walk every combo in the database. A card in the deck reads the same table: its entry is what
   * it would add if it were taken out and put back.
   */
  interface Found { info: ComboInfo; missing: string | null; strength: number }
  let comboTable: Map<string, Found> | null = null;
  const allowedCombo = (info: ComboInfo): boolean => !(info.twoCard && (bracket <= 2 || (bracket === 3 && info.early)));
  const couldJoin = (oracleId: string): boolean => {
    const c = db.get(oracleId);
    if (!c || c.legality !== 'legal' || c.isMeldResult) return false;
    return !(setup.hasCommander && c.colorIdentity.some((col) => !setup.identity.has(col)));
  };
  const completeStrength = (info: ComboInfo) => COMBO_COMPLETE[bracket - 1] * (COMBO_OBSCURE_SHARE + (1 - COMBO_OBSCURE_SHARE) * info.weight);
  const partialStrength = (info: ComboInfo) => COMBO_PARTIAL[bracket - 1] * info.weight ** 2;

  function buildComboTable(): Map<string, Found> {
    const table = new Map<string, Found>();
    if (COMBO_COMPLETE[bracket - 1] <= 0) return table;
    const offer = (id: string, found: Found) => {
      const prev = table.get(id);
      if (!prev || found.strength > prev.strength || (found.strength === prev.strength && found.info.combo.popularity > prev.info.combo.popularity)) table.set(id, found);
    };
    const inDeck = base.counts;
    const seen = new Set<string>();
    for (const id of inDeck.keys()) {
      for (const info of combosOf(db, id)) {
        if (seen.has(info.combo.id)) continue;
        seen.add(info.combo.id);
        if (!allowedCombo(info)) continue;
        const missing: string[] = [];
        let ok = true;
        for (const piece of info.combo.cards) {
          if (piece.mustBeCommander && !commanderSlots.has(piece.oracleId)) { ok = false; break; }
          if (inDeck.has(piece.oracleId)) continue;
          if (!missing.includes(piece.oracleId)) missing.push(piece.oracleId);
          if (missing.length > 2) { ok = false; break; }
        }
        if (!ok) continue;
        const present = info.combo.cards.map((p) => p.oracleId).filter((pid) => inDeck.has(pid));
        if (missing.length === 0) {
          for (const pid of present) offer(pid, { info, missing: null, strength: completeStrength(info) });
        } else if (missing.length === 1) {
          offer(missing[0], { info, missing: null, strength: completeStrength(info) });
          // Taken out, a card of this combo would leave it two short: one piece short when put back.
          if (partialStrength(info) > 0 && couldJoin(missing[0]) && (present.length >= 2 || info.weight >= COMBO_HALF_MIN_WEIGHT)) {
            for (const pid of present) offer(pid, { info, missing: missing[0], strength: partialStrength(info) });
          }
        } else if (partialStrength(info) > 0) {
          if (couldJoin(missing[1])) offer(missing[0], { info, missing: missing[1], strength: partialStrength(info) });
          if (couldJoin(missing[0])) offer(missing[1], { info, missing: missing[0], strength: partialStrength(info) });
        }
      }
    }
    return table;
  }

  function comboCredit(card: Card): ComboCredit | null {
    if (COMBO_COMPLETE[bracket - 1] <= 0) return null;
    comboTable ??= buildComboTable();
    let best = comboTable.get(card.oracleId) ?? null;
    // Half of a famous two-card combo whose partner is not in the deck yet (Thassa's Oracle before Consultation).
    if (!best && COMBO_PARTIAL[bracket - 1] > 0) {
      for (const info of combosOf(db, card.oracleId)) {
        if (!info.twoCard || info.weight < COMBO_HALF_MIN_WEIGHT || !allowedCombo(info)) continue;
        const partner = info.combo.cards.find((p) => p.oracleId !== card.oracleId);
        if (!partner || partner.mustBeCommander || base.counts.has(partner.oracleId)) continue;
        if (info.combo.cards.some((p) => p.oracleId === card.oracleId && p.mustBeCommander && !commanderSlots.has(p.oracleId))) continue;
        const strength = partialStrength(info);
        if (strength > (best?.strength ?? 0) && couldJoin(partner.oracleId)) best = { info, missing: partner.oracleId, strength };
      }
    }
    if (!best || best.strength <= 0) return null;
    const { info, missing, strength } = best;
    const name = (id: string) => db.get(id)?.name ?? 'an unknown card';
    const others = [...new Set(info.combo.cards.map((p) => p.oracleId))].filter((id) => id !== card.oracleId && id !== missing);
    const made = info.combo.produces;
    const headline = made.find((r) => /win the game|loses? the game/i.test(r)) ?? made.find((r) => /^(near-)?infinite/i.test(r)) ?? made[0];
    const result = headline ? ` (${headline})` : '';
    const text = missing === null
      ? `completes a combo with ${others.map(name).join(' + ')}${result}`
      : others.length > 0
        ? `combo piece with ${others.map(name).join(' + ')}${result}; still needs ${name(missing)}`
        : `half of a combo with ${name(missing)}${result}`;
    return { strength: Math.min(1, strength), complete: missing === null, text };
  }

  const gated = (card: Card, gate: Gate): CardScore => ({
    oracleId: card.oracleId, score: 0, parts: [], reasons: [gate.message], gate,
  });

  function score(card: Card): CardScore {
    const stat = statOf(card);
    if (stat.gate) return gated(card, stat.gate);
    const st = stateFor(card.oracleId);

    // A commander is in the deck by definition: its own command-zone slot is not a second copy.
    // A copy of it in the 99 is scored leave-one-out like any main-deck card, and is one too many.
    const own = mainIds.has(card.oracleId) ? 0 : (commanderSlots.get(card.oracleId) ?? 0);
    const others = (st.counts.get(card.oracleId) ?? 0) - own;
    if (others > 0) {
      const limit = copyLimit(card);
      if (others >= limit) {
        const message = limit === 1
          ? `${card.name} is already in the deck; only one copy is allowed.`
          : `${card.name} is limited to ${limit} copies and the deck already has ${others}.`;
        return gated(card, { code: 'copy-limit', message });
      }
    }
    if (bracket <= 3 && (stat.checkBracket || overrides)) {
      const g = bracketGate(card, deck, ctx);
      if (g) return gated(card, g);
    }

    const reasons: string[] = [];
    const combo = comboCredit(card);

    // How much the deck wants any of the card's roles (0..1); also the role part further down.
    let roleNeed = 0;
    let roleNeedText = '';
    for (const role of stat.roles) {
      const n = st.roleNeed[role];
      if (n !== undefined && n > roleNeed) { roleNeed = n; roleNeedText = st.roleText[role] ?? ''; }
      const ranked = rankedNeed(role, stat, st);
      if (ranked && ranked.need > roleNeed) { roleNeed = ranked.need; roleNeedText = ranked.text; }
    }

    // Synergy
    let syn = stat.syn;
    let synText = stat.synText;
    if (stat.synAxis && st.scarce.get(stat.synAxis) === stat.synSide) {
      syn = Math.min(1, syn * SCARCE_SIDE_BOOST);
      synText += stat.synSide === 'p' ? ', deck is short on payoffs' : ', deck is short on enablers';
    }
    if (stat.elite > 0 && roleNeed > 0) {
      const extra = stat.elite * Math.min(1, roleNeed / ELITE_FULL_NEED);
      if (weights.synergy * extra >= 1) synText += synText ? ', a format staple' : 'a format staple';
      syn = Math.min(1, syn + extra);
    }
    if (stat.land) {
      // A land's synergy part is mostly its colour fixing, worth less once the deck has its lands.
      syn = Math.min(1, syn + stat.fix * (0.5 + 0.5 * st.landNeed));
      synText = synText ? `${stat.fixText}; ${synText}` : stat.fixText;
    }
    if (combo) {
      // A combo with the commander or with cards already in the deck is the strongest synergy there is.
      if (combo.strength > syn) { syn = combo.strength; synText = combo.text; }
      else synText = synText ? `${synText}; ${combo.text}` : combo.text;
    }
    const synPts = r1(weights.synergy * syn);
    if (synPts >= 0.5) reasons.push(`+${Math.round(synPts)} ${stat.land ? 'mana' : 'synergy'}: ${synText}`);

    if (weights.coplay > 0) reasons.push(`+${Math.round(stat.coplay)} co-play: ${stat.coplayText}`);
    reasons.push(`+${Math.round(stat.qualityPts)} quality: ${stat.qualityText}`);

    // Role need
    let need = 0;
    let needText = '';
    if (stat.land) {
      need = stat.noMana ? 0 : st.landNeed;
      needText = st.landText;
    } else {
      need = roleNeed;
      needText = roleNeedText;
      if (stat.themeMember && st.themeNeed > need) { need = st.themeNeed; needText = st.themeText; }
    }
    if (combo?.complete) {
      const win = COMBO_ROLE[bracket - 1] * (combo.strength / Math.max(0.01, COMBO_COMPLETE[bracket - 1]));
      if (win >= need) { need = clamp01(win); needText = 'the combo is a way to win the game'; }
    }
    const rolePts = r1(weights.role * need);
    if (rolePts >= 0.5 && needText) reasons.push(`+${Math.round(rolePts)} role: ${needText}`);

    // Castability and curve
    let castable = 1;
    let shortColor: Color | null = null;
    for (const [color, req] of stat.pipReq) {
      const c = req > 0 ? st.sources[color] / req : 1;
      if (c < castable) { castable = c; shortColor = color; }
    }
    let fit: number;
    let castText = '';
    if (stat.land) {
      fit = 1 - stat.tapland * (st.taplandsOver ? 1 : 0.4);
      if (stat.tapland > 0 && st.taplandsOver) castText = 'deck already has its share of tapped lands';
    } else {
      fit = st.curveFit[stat.bucket];
      if (fit < 0.75) castText = `deck already has plenty at ${stat.bucket}${stat.bucket === 7 ? '+' : ''} mana`;
      if (stat.atCommanderMv && !commanderSlots.has(card.oracleId)) {
        fit -= COMMANDER_MV_PENALTY;
        castText ||= 'same mana value as the commander';
      }
      if (st.landLight && stat.bucket >= 6) {
        fit -= LAND_LIGHT_PENALTY;
        castText ||= 'expensive for a deck this light on lands';
      }
    }
    if (castable < 0.85 && shortColor) castText = `deck is light on ${COLOR_NAME[shortColor]} sources for its cost`;
    const castPts = r1(weights.cast * (0.6 * clamp01(castable) + 0.4 * clamp01(fit)));
    if (castText) reasons.push(`${signed(Math.round(castPts - weights.cast))} cast: ${castText}`);

    // Bracket fit; its penalty may not push the total below zero.
    const before = synPts + stat.coplay + stat.qualityPts + rolePts + castPts;
    // A card that completes a combo is in the deck for the combo: its mana cost is not held against it.
    const forgiven = combo?.complete === true && stat.fitSpeed;
    const fitPts = forgiven ? stat.fitBase : Math.max(stat.fitPts, -r1(before - 0.05));
    if (stat.fitText && !forgiven) reasons.push(`${signed(Math.round(fitPts - weights.bracket))} bracket: ${stat.fitText}`);

    const points: Record<PartKey, number> = {
      synergy: synPts, coplay: stat.coplay, quality: stat.qualityPts, role: rolePts, cast: castPts, bracket: fitPts,
    };
    let total = before + fitPts;
    if (stat.staple && total < STAPLE_FLOOR) {
      // The lift goes into the parts, so they still add up to the score.
      let lift = STAPLE_FLOOR - total;
      for (const key of FLOOR_ORDER) {
        if (lift <= 0) break;
        const add = Math.min(lift, Math.max(0, weights[key] - points[key]));
        points[key] = r1(points[key] + add);
        lift -= add;
      }
      total = STAPLE_FLOOR;
      reasons.push(`staple: a top-rated ${stat.land ? 'land' : 'core-role card'} never scores below ${STAPLE_FLOOR}`);
    }

    const parts: ScorePart[] = [
      { key: 'synergy', points: points.synergy, max: weights.synergy },
      { key: 'coplay', points: points.coplay, max: weights.coplay },
      { key: 'quality', points: points.quality, max: weights.quality },
      { key: 'role', points: points.role, max: weights.role },
      { key: 'cast', points: points.cast, max: weights.cast },
      { key: 'bracket', points: points.bracket, max: weights.bracket },
    ];
    return {
      oracleId: card.oracleId,
      score: Math.min(100, Math.max(0, Math.round(total))),
      parts, reasons, gate: null,
    };
  }

  function scoreAll(filter?: (c: Card) => boolean): CardScore[] {
    const out: CardScore[] = [];
    for (const card of db.all()) {
      if (filter && !filter(card)) continue;
      out.push(score(card));
    }
    return out;
  }

  return { score, scoreAll };
}
