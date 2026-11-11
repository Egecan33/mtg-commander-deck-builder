import { allowedIdentity, cardFitsDeck, commanderCards, companionViolation, copyLimit, hasType, isBasicLand } from '../rules';
import { createScorer } from '../scoring';
import { AXIS_MEMBER, isLandCard, resolveThemeWeights } from '../summary';
import type { AxisId, BuildOptions, Card, CardDb, CardFeatures, Color, Deck, DeckEntry, EngineContext, Role } from '../types';
import { kindOf, makePlan } from './plan';
import type { Kind, Plan } from './plan';

export const COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G'];
const BASIC_NAME: Record<Color | 'C', string> = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest', C: 'Wastes' };

/** Score jitter of a build: each card's score moves by up to this much, fixed by the seed. */
export const JITTER = 3;
/** Nonland candidates kept after the first full-pool scoring, and extra ones per role. */
const TOP_NONLAND = 420;
const TOP_PER_ROLE = 36;
const TOP_LANDS = 140;
const TOP_TRIBE = 70;
const TOP_SPELLS = 70;
const TOP_FAST = 24;
const POOL_ROLES: readonly Role[] = [
  'ramp', 'draw', 'tutor', 'spot-removal', 'counterspell', 'wipe', 'protection', 'recursion', 'graveyard-hate', 'win-condition',
];

/** A fixing land less played than this EDHREC rank is left for a basic. */
const FIXER_MAX_RANK = 6000;
/** What entering tapped costs a fixing land's rank value, at Brackets 3-5 and 1-2. */
const TAP_COST_HIGH = 0.15;
const TAP_COST_LOW = 0.08;
/** What a land that only fetches another land gives up next to one that taps for mana itself. */
const FETCH_COST = 0.08;
/** In a deck of up to three colours a five-colour land (often painful or conditional) ranks under a land of its own colours. */
const ANY_COLOUR_COST = 0.08;
/** How much a land is played, 0..1: lands are compared by EDHREC rank, which follows what decks really run. */
const rankQuality = (rank: number | null): number => (rank !== null && rank >= 1 ? Math.min(1, Math.max(0, 1 - Math.log10(rank) / 6)) : 0);

/** Small seeded generator (mulberry32): the same seed gives the same stream on every machine. */
export function mulberry32(seed: number): () => number {
  let a = (Number.isFinite(seed) ? Math.floor(seed) : 0) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** EDHREC rank up to which a card is a format staple no bracket minds (Sol Ring, Arcane Signet, Command Tower). */
const STAPLE_RANK = 25;
export const isStaple = (card: Card): boolean => card.edhrecRank !== null && card.edhrecRank >= 1 && card.edhrecRank <= STAPLE_RANK;
/**
 * EDHREC rank up to which a nonland card goes into every build that can use it, whatever the theme
 * crowds out: by play rate that is Sol Ring and Arcane Signet, the two rocks no list leaves at home.
 */
const CORE_RANK = 5;
export const isCore = (card: Card): boolean => card.edhrecRank !== null && card.edhrecRank >= 1 && card.edhrecRank <= CORE_RANK;

/** Source weight from which a land counts as making a colour for the mana base (Nykthos and Gemstone Caverns, at 0.25, do not). */
export const RELIABLE_SOURCE = 0.5;
/** Text of cards whose combos need a library with no basic lands. */
const NEEDS_NO_BASICS = /until you reveal a basic land card/i;
/** Tainted Pact stops at the second copy of any name: a tutor only in a deck with no repeated basics. */
const NEEDS_NO_REPEATS = /same name as (?:another|any other) card exiled this way/i;

const COLOR_WORD: Record<string, Color> = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const COLOR_REFERENCE = /\b(white|blue|black|red|green) (?:(?:creature|instant|sorcery|artifact|enchantment|planeswalker) )?(?:spells?|creatures?|permanents?|cards?|sources?)\b|\bif it's (white|blue|black|red|green)\b/gi;

/**
 * True when the card's text only works with colours the deck does not have: Oketra's Monument
 * ("white creature spells") in a mono-blue deck, a Medallion of another colour, Pyroblast
 * ("if it's blue") as a main-deck card. A card that also names one of the deck's colours stays.
 */
export function namesOnlyOtherColours(card: Card, identity: readonly Color[]): boolean {
  let other = false;
  for (const m of card.oracleText.matchAll(COLOR_REFERENCE)) {
    if (identity.includes(COLOR_WORD[(m[1] ?? m[2]).toLowerCase()])) return false;
    other = true;
  }
  return other;
}

export interface Candidate {
  card: Card; f: CardFeatures; land: boolean; jitter: number; base: number; kind: Kind;
  /**
   * Points the build adds to the card's score for the target bracket (0 or less): at Brackets 1-2
   * the most played cards and tutors give way to humbler ones (see `LOW_BRACKET_TIER_COST`).
   */
  adjust: number;
  /** How well the card fits the deck's theme, 0..1 (the rating's on-theme test: 0.5 and up is on theme). */
  theme: number;
}

/**
 * Brackets 1-2 are precon level (brackets.md §3): a deck of the format's hundred most played cards
 * plays like Bracket 3 whatever its rules floor says. A card that is not one of the staples every
 * precon carries (`isStaple`) loses these points by power tier (index = tier) when the build picks.
 */
const LOW_BRACKET_TIER_COST: Record<1 | 2, readonly number[]> = {
  1: [0, 0, 0, 6, 16, 16],
  2: [0, 0, 0, 3, 10, 10],
};
/** ...and a tutor loses this much more: precon-level decks find their cards by drawing them. */
const LOW_BRACKET_TUTOR_COST = 6;

/**
 * Bracket 5 is won on efficiency (deck-theory.md §2.3: average mana value 1.7-2.3): a card loses
 * these points by mana value (index = mana value, the last entry for 6 and up) when the build
 * picks, so the theme's seven-drops give way to the one- and two-mana cards a cEDH list is made of.
 */
const CEDH_MV_COST: readonly number[] = [0, 0, 0, 2, 6, 11, 15];

/** The build's own preference for or against a card at this bracket, in score points. */
export function bracketAdjust(card: Card, f: CardFeatures, bracket: number): number {
  if (isLandCard(f)) return 0;
  if (bracket >= 5) return -CEDH_MV_COST[Math.min(CEDH_MV_COST.length - 1, Math.max(0, Math.floor(card.cmc || 0)))];
  if (bracket > 2 || isStaple(card)) return 0;
  const costs = LOW_BRACKET_TIER_COST[bracket <= 1 ? 1 : 2];
  return -(costs[f.powerTier] ?? 0) - (f.roles.includes('tutor') ? LOW_BRACKET_TUTOR_COST : 0);
}

/** Theme fit of a card under the deck's theme weights (same reading as the rating's synergy sub-score). */
export function themeFit(f: CardFeatures, weights: Record<AxisId, number>): number {
  let best = 0;
  for (const axis in f.axes) {
    const w = weights[axis];
    if (!(w > 0)) continue;
    const a = f.axes[axis];
    const v = Math.min(1, w) * Math.max(a.e, a.p);
    if (v > best) best = v;
  }
  return Math.min(1, best);
}

const CARD_TYPES = ['Creature', 'Artifact', 'Enchantment', 'Instant', 'Sorcery', 'Planeswalker', 'Battle'] as const;
/** Companions whose condition is on the whole deck, by front name (the rules engine holds the conditions themselves). */
const ONE_TYPE_COMPANION = 'Umori, the Collector';

/**
 * The card type every nonland card must have when the companion asks for one shared type (Umori):
 * a type the commanders and the cards already in the deck all have, creatures first. Null when the
 * companion asks no such thing, or when no single type can work.
 */
export function sharedTypeFor(deck: Deck, db: CardDb): { needed: boolean; type: string | null } {
  const companion = deck.companion ? db.get(deck.companion) : undefined;
  if (!companion || companion.frontName !== ONE_TYPE_COMPANION) return { needed: false, type: null };
  const held: Card[] = [];
  for (const id of [...deck.commanders, ...deck.main.filter((e) => qtyOf(e) >= 1).map((e) => e.oracleId)]) {
    const c = db.get(id);
    if (c && !hasType(c, 'Land')) held.push(c);
  }
  const type = CARD_TYPES.find((t) => held.every((c) => hasType(c, t))) ?? null;
  return { needed: true, type };
}

/** The cards a build may draw from: legal for the deck, inside the options, best first. */
export interface Pool {
  plan: Plan;
  nonland: Candidate[];
  lands: Candidate[];                         // nonbasic lands
  /** Lands that make two or more of the deck's colours, best first (empty for mono and colourless decks). */
  fixers: Candidate[];
  basics: Partial<Record<Color | 'C', Card>>;
  identity: Color[];
  /**
   * Colours outside the identity whose basic lands the commander still lets in (Tolabow, Seluma and
   * the other "any basic land cards" commanders): the only lands that can pay for the off-colour
   * cards those commanders allow.
   */
  splash: Color[];
  /** True when the options (owned only, price cap) and the rules let this card into the deck. */
  allowed(card: Card): boolean;
  /** The deck's theme weights (`resolveThemeWeights`) the candidates' `theme` was read under. */
  weights: Record<AxisId, number>;
  /** A candidate for a card outside the pool's lists (a card already in the deck), or null. */
  candidateOf(oracleId: string): Candidate | null;
  jitterOf(oracleId: string): number;
}

export const qtyOf = (e: DeckEntry): number => (Number.isFinite(e.qty) && e.qty >= 1 ? Math.floor(e.qty) : 0);
export const mainCount = (deck: Deck): number => deck.main.reduce((n, e) => n + qtyOf(e), 0);
export const deckCount = (deck: Deck): number => deck.commanders.length + mainCount(deck);

/**
 * The deck with one more copy of a card. Copies join an unlocked entry: a locked entry is what the
 * user pinned ("3 Mountain"), so added copies go into a second, unlocked entry for the same card
 * beside it and the locked count stays what it was.
 */
export function addCard(deck: Deck, oracleId: string, qty = 1): Deck {
  let found = false;
  const main = deck.main.map((e) => {
    if (found || e.oracleId !== oracleId || e.locked) return e;
    found = true;
    return { ...e, qty: qtyOf(e) + qty };
  });
  if (!found) main.push({ oracleId, qty, locked: false });
  return { ...deck, main };
}

/** The deck with one copy of a card taken out (an unlocked entry first). */
export function removeCard(deck: Deck, oracleId: string): Deck {
  let idx = deck.main.findIndex((e) => e.oracleId === oracleId && !e.locked && qtyOf(e) >= 1);
  if (idx < 0) idx = deck.main.findIndex((e) => e.oracleId === oracleId);
  if (idx < 0) return deck;
  const main = deck.main.slice();
  const left = qtyOf(main[idx]) - 1;
  if (left >= 1) main[idx] = { ...main[idx], qty: left };
  else main.splice(idx, 1);
  return { ...deck, main };
}

/**
 * Scores the whole pool once against the commanders alone and keeps the best few hundred cards the
 * options allow, plus the best of every role, so the build loop rescans hundreds of cards, not 32,000.
 */
export function buildPool(deck: Deck, ctx: EngineContext, opts: BuildOptions): Pool {
  const { db } = ctx;
  const rng = mulberry32(opts.seed);
  const owned = opts.ownedOnly ? (opts.owned ?? new Set<string>()) : null;
  const maxPrice = typeof opts.maxPriceUsd === 'number' && Number.isFinite(opts.maxPriceUsd) ? opts.maxPriceUsd : null;
  const fitCache = new Map<string, boolean>();

  // A companion's condition is checked card by card: the card alone in the deck, beside the
  // commanders. The companion itself may not be in the deck. (Umori and Yorion put no condition
  // on single cards and are left to `validateDeck`.)
  const companionOk = (card: Card): boolean => {
    if (!deck.companion) return true;
    if (card.oracleId === deck.companion) return false;
    const v = companionViolation({ ...deck, main: [{ oracleId: card.oracleId, qty: 1, locked: false }] }, db);
    return !(v !== null && v.code === 'companion' && v.oracleIds.includes(card.oracleId));
  };
  const shared = sharedTypeFor(deck, db).type;
  const typeOk = (card: Card): boolean => shared === null || hasType(card, 'Land') || hasType(card, shared);
  const fits = (card: Card): boolean => cardFitsDeck(card, deck, db) === null && companionOk(card) && typeOk(card);

  const allowed = (card: Card): boolean => {
    if (isBasicLand(card)) {
      let ok = fitCache.get(card.oracleId);
      if (ok === undefined) fitCache.set(card.oracleId, (ok = card.legality === 'legal' && fits(card)));
      return ok;
    }
    if (owned && !owned.has(card.oracleId)) return false;
    if (maxPrice !== null && !(typeof card.priceUsd === 'number' && card.priceUsd <= maxPrice)) return false;
    let ok = fitCache.get(card.oracleId);
    if (ok === undefined) fitCache.set(card.oracleId, (ok = card.legality === 'legal' && !card.isMeldResult && fits(card)));
    return ok;
  };

  const plan = makePlan(deck, ctx);
  const weights = resolveThemeWeights(deck, ctx) ?? {};
  const candidate = (card: Card, f: CardFeatures, j: number, base: number): Candidate => ({
    card, f, land: isLandCard(f), jitter: j, base, kind: kindOf(card, f, plan),
    adjust: bracketAdjust(card, f, plan.bracket), theme: themeFit(f, weights),
  });
  const allowedColors = allowedIdentity(deck, db);
  // Without a known commander there is no identity yet: every colour is open.
  const hasCommander = commanderCards(deck, db).length > 0;
  const identity = hasCommander ? COLORS.filter((c) => allowedColors.has(c)) : [...COLORS];
  const bare: Deck = { ...deck, main: [] };
  const scorer = createScorer(bare, ctx);
  const commanders = new Set(deck.commanders);
  const jitter = new Map<string, number>();
  const nonland: Candidate[] = [];
  const lands: Candidate[] = [];
  for (const card of db.all()) {
    const j = (rng() * 2 - 1) * JITTER; // drawn for every card, so filters do not shift the stream
    jitter.set(card.oracleId, j);
    if (commanders.has(card.oracleId) || isBasicLand(card) || !allowed(card)) continue;
    const f = db.features(card.oracleId);
    if (!f) continue;
    const s = scorer.score(card);
    if (s.gate) continue;
    const cand = candidate(card, f, j, s.score);
    const { land, kind } = cand;
    // Any-type typal cards belong in typal decks only.
    if (kind.generic && plan.genericTypalCap === 0) continue;
    // Brackets 1-2: no top-tier cards or fast mana beyond the staples every precon carries.
    if (!land && namesOnlyOtherColours(card, identity)) continue;
    if (plan.bracket <= 2 && !land && !isStaple(card) && (f.powerTier >= 5 || f.roles.includes('fast-mana'))) continue;
    // A card that digs for a basic land (Hermit Druid) is a combo piece only in a deck with none; builds always run basics.
    if (!land && (NEEDS_NO_BASICS.test(card.oracleText) || NEEDS_NO_REPEATS.test(card.oracleText))) continue;
    (land ? lands : nonland).push(cand);
  }
  const byBase = (a: Candidate, b: Candidate) => b.base + b.jitter + b.adjust - (a.base + a.jitter + a.adjust) || (a.card.oracleId < b.card.oracleId ? -1 : 1);
  nonland.sort(byBase);
  lands.sort(byBase);

  const keep = new Set<Candidate>(nonland.slice(0, TOP_NONLAND));
  for (const role of POOL_ROLES) {
    let n = 0;
    for (const c of nonland) {
      if (!c.f.roles.includes(role)) continue;
      keep.add(c);
      if (++n >= TOP_PER_ROLE) break;
    }
  }
  // The plan's own kinds: creatures of the deck's type, instants and sorceries for spellslinger.
  const extra = (n: number, pred: (c: Candidate) => boolean) => {
    let k = 0;
    for (const c of nonland) {
      if (!pred(c)) continue;
      keep.add(c);
      if (++k >= n) break;
    }
  };
  if (plan.tribe) extra(TOP_TRIBE, (c) => c.kind.member);
  if (plan.spellTarget > 0) extra(TOP_SPELLS, (c) => c.kind.spell);
  if (plan.fastTarget > 0) extra(TOP_FAST, (c) => c.kind.fast);
  extra(CORE_RANK, (c) => isCore(c.card));
  // Cards a deck may hold many copies of (Relentless Rats, Seven Dwarves) when the theme wants them.
  extra(8, (c) => copyLimit(c.card) > 1 && packWanted(c, plan.tribe));
  // Cheap plays, so a curve that came out too high can always be repaired.
  let cheap = 0;
  for (const c of nonland) {
    if (c.card.cmc > 2) continue;
    keep.add(c);
    if (++cheap >= 80) break;
  }

  const basics: Pool['basics'] = {};
  for (const k of [...COLORS, 'C'] as (Color | 'C')[]) {
    const c = db.byName(BASIC_NAME[k]);
    if (c && isBasicLand(c) && allowed(c)) basics[k] = c;
  }
  const makes = (c: Candidate) => identity.filter((k) => (c.f.sources[k] ?? 0) >= RELIABLE_SOURCE).length;
  const tapCost = plan.bracket >= 3 ? TAP_COST_HIGH : TAP_COST_LOW;
  const fixerValue = (c: Candidate): number => {
    const any = COLORS.filter((k) => (c.f.sources[k] ?? 0) > 0).length;
    return rankQuality(c.card.edhrecRank) + 0.1 * (makes(c) / identity.length)
      - tapCost * Math.min(1, Math.max(0, c.f.taplandWeight || 0))
      - (/\badd\b/i.test(c.card.oracleText) ? 0 : FETCH_COST)
      - (identity.length <= 3 && any > identity.length ? ANY_COLOUR_COST : 0)
      + c.jitter / 100;
  };
  const fixers = identity.length < 2 ? [] : lands
    .filter((c) => makes(c) >= 2 && (c.card.edhrecRank ?? Infinity) <= FIXER_MAX_RANK)
    .map((c) => ({ c, v: fixerValue(c) }))
    .sort((a, b) => b.v - a.v || (a.c.card.oracleId < b.c.card.oracleId ? -1 : 1))
    .map((x) => x.c);

  return {
    plan,
    nonland: nonland.filter((c) => keep.has(c)),
    lands: lands.slice(0, TOP_LANDS),
    fixers,
    basics,
    identity,
    splash: COLORS.filter((c) => !identity.includes(c) && basics[c] !== undefined),
    allowed,
    jitterOf: (id) => jitter.get(id) ?? 0,
    weights,
    candidateOf: (id) => {
      const card = db.get(id);
      const f = card ? db.features(id) : undefined;
      return card && f ? candidate(card, f, jitter.get(id) ?? 0, 0) : null;
    },
  };
}

/** Typal payoff strength from which a card is "about" a creature type (Shadowborn Apostle: Demons). */
const PACK_PAYOFF = 0.9;

/**
 * True when a card with a copy limit above one belongs in this deck in numbers: it is a creature
 * of the deck's own type (Relentless Rats and Rat Colony in a Rat deck, Seven Dwarves with Dwarves,
 * Persistent Petitioners with Advisors) and is not about some other type, or it is a creature that
 * pays off the deck's type (Shadowborn Apostle in a Demon deck). Spells with the same rule
 * (Dragon's Approach, Slime Against Humanity) are whole archetypes of their own and are left to the user.
 */
export function packWanted(c: Candidate, tribe: string | null): boolean {
  if (tribe === null || c.land || !c.kind.creature) return false;
  const own = c.f.axes[`typal:${tribe}`];
  let elsewhere = false;
  for (const axis in c.f.axes) {
    if (axis.startsWith('typal:') && axis !== `typal:${tribe}` && c.f.axes[axis].p >= PACK_PAYOFF) elsewhere = true;
  }
  if (own !== undefined && own.p >= PACK_PAYOFF) return true;
  return c.kind.member && !elsewhere && (own?.e ?? 0) >= AXIS_MEMBER;
}
