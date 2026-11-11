import { analyzeBracket } from '../brackets';
import { karstenSources } from '../mana';
import { rateDeck } from '../rating';
import { companionViolation, copyLimit, deckCounts, isBasicLand, validateDeck } from '../rules';
import { createScorer } from '../scoring';
import { deckCards, isLandCard, summarizeDeck } from '../summary';
import { targetsFor } from '../targets';
import type { BuildOptions, Card, CardFeatures, Color, Deck, EngineContext, Role, Targets } from '../types';
import { bestReplacement, climb, fineRating, nextOffender } from './improve';
import { COLORS, RELIABLE_SOURCE, addCard, buildPool, deckCount, isCore, isStaple, packWanted, qtyOf, removeCard, sharedTypeFor } from './pool';
import type { Candidate, Pool } from './pool';
import { planBonus, tallyDeck } from './plan';

const DECK_SIZE = 100;
/** Roles the fill keeps at or under the top of their band. */
const CAPPED_ROLES: readonly Role[] = [
  'ramp', 'draw', 'wipe', 'tutor', 'counterspell', 'spot-removal', 'graveyard-hate', 'protection', 'recursion',
];
/** Roles the fill brings up to the bottom of their band before anything else when slots run short. */
const QUOTA_ROLES: readonly Role[] = [...CAPPED_ROLES, 'win-condition'];
/** The fill rescans the whole pool on every Nth pick and only the leaders of that scan in between. */
const RESCORE_EVERY = 3;
const LEADERS = 40;
/** Cards past the top of a role band a spellslinger deck may take when they are instants or sorceries. */
const SPELL_ROLE_SLACK = 5;
/** Most nonbasic lands by number of colours (0..5); the rest are basics. */
const NONBASIC_CAP = [26, 8, 16, 22, 27, 31];
/** Most lands that make fewer than two of the deck's colours (utility lands), by number of colours. */
const UTILITY_CAP = [26, 8, 4, 3, 2, 2];
/** Most lands that make none of the deck's colours, by number of colours. */
const OFF_COLOUR_LANDS = [99, 4, 3, 2, 1, 1];
/** A land that makes fewer than two of the deck's colours must beat a basic by this much. */
const UTILITY_MARGIN = 2;
/** Nonland slots left open until the land target has been recomputed from the cards chosen. */
const SECOND_PASS = 5;
/** Rating evaluations the build's own hill-climb may spend, and swaps it may make. */
const CLIMB_EVALS = 45;
const CLIMB_SWAPS = 6;
/** Swaps the power pass may make to bring "plays like" to the target bracket. */
const POWER_SWAPS = 26;
/** ...and at Brackets 1-2, where a pile of popular cards has further to come down. */
const LOW_POWER_SWAPS = 26;
const REPAIR_ROUNDS = 12;
/** Floor of a colour's weight when basics are split by shortfall × pip share (see `addBasics`). */
const PIP_BASE = 1;
/** Rating points a build may give up to play at its target bracket instead of above or below it. */
const ON_TARGET_SLACK = 2;
/** Basics of an off-identity colour (see `Pool.splash`): this many times the colour's share of the deck's pips. */
const SPLASH_SHARE = 2.5;

const finite = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** Targets of the finished deck: the deck padded to 100 with basics, so nothing is scaled. */
function finalTargets(deck: Deck, ctx: EngineContext, pool: Pool): Targets {
  const pad = DECK_SIZE - deckCount(deck);
  const basic = Object.values(pool.basics)[0];
  const padded = pad > 0 && basic ? addCard(deck, basic.oracleId, pad) : deck;
  return targetsFor(padded, ctx, summarizeDeck(padded, ctx.db));
}

/** Land slots still to fill: the finished deck's land target minus the lands (MDFC-weighted) it has. */
function landSlots(deck: Deck, ctx: EngineContext, pool: Pool): number {
  const free = DECK_SIZE - deckCount(deck);
  if (free <= 0) return 0;
  const have = summarizeDeck(deck, ctx.db).landsEffective;
  return Math.min(free, Math.max(0, Math.round(finalTargets(deck, ctx, pool).lands - have)));
}

/**
 * Greedy nonland fill (spec §12 step 2): each pick is the best-scoring card for the deck as it
 * stands, so theme pieces and missing roles rise on their own. Two rules sit on top of the score:
 * a role at the top of its band takes no more cards, and when the open slots are no more than the
 * cards still owed to role minimums, only cards for those roles are taken.
 */
function fillNonland(start: Deck, ctx: EngineContext, pool: Pool, slots: number): Deck {
  let deck = start;
  const used = new Set(deckCounts(deck).keys());
  // One Shadowborn Apostle does nothing: many-copy cards come in as a pack (`seedPacks`) or not at all.
  let cands = pool.nonland.filter((c) => !used.has(c.card.oracleId) && !(copyLimit(c.card) > 1));
  let ranked: Candidate[] = [];

  for (let i = 0; i < slots && cands.length > 0; i++) {
    const scorer = createScorer(deck, ctx);
    const summary = summarizeDeck(deck, ctx.db);
    const targets = finalTargets(deck, ctx, pool);
    const under = new Set<Role>();
    const full = new Set<Role>();
    const overfull = new Set<Role>(); // spellslinger decks let instants and sorceries run past a band
    let owed = 0;
    for (const role of QUOTA_ROLES) {
      const band = targets.roles[role];
      if (!band) continue;
      const n = finite(summary.roleCounts[role]);
      if (n < band.lo) { owed += band.lo - n; under.add(role); }
      if (n >= band.hi && CAPPED_ROLES.includes(role)) full.add(role);
      if (n >= band.hi + SPELL_ROLE_SLACK && CAPPED_ROLES.includes(role)) overfull.add(role);
    }
    const mustFill = under.size > 0 && owed >= slots - i;
    const tally = tallyDeck(deck, ctx, pool.plan);
    const spellRoom = tally.spells < pool.plan.spellTarget;

    // Every card is rescored on every third pick; in between only the leaders of the last full pass are.
    const fullPass = i % RESCORE_EVERY === 0 || ranked.length === 0;
    const scan = fullPass ? cands : ranked;
    const scored: { c: Candidate; v: number }[] = [];
    const pick = (strictness: 0 | 1 | 2): Candidate | null => {
      let best: Candidate | null = null;
      let bestScore = -Infinity;
      for (const c of scan) {
        if (strictness === 2 && mustFill && !c.f.roles.some((r) => under.has(r))) continue;
        if (strictness >= 1 && c.f.roles.some((r) => (c.kind.spell && spellRoom ? overfull.has(r) : full.has(r)))) continue;
        const bonus = planBonus(c.kind, tally, pool.plan);
        if (bonus === null) continue;
        const s = scorer.score(c.card);
        if (s.gate) continue;
        const v = s.score + c.jitter + c.adjust + bonus;
        if (fullPass && strictness === 2) scored.push({ c, v });
        if (v > bestScore) { bestScore = v; best = c; }
      }
      return best;
    };
    let chosen = pick(2);
    if (fullPass) {
      scored.sort((x, y) => y.v - x.v);
      ranked = scored.slice(0, LEADERS).map((x) => x.c);
    }
    chosen ??= pick(1) ?? pick(0);
    if (!chosen && !fullPass) { ranked = []; i--; continue; } // leaders exhausted: force a full pass
    if (!chosen) break;
    const taken = chosen;
    deck = addCard(deck, taken.card.oracleId);
    cands = cands.filter((c) => c !== taken);
    ranked = ranked.filter((c) => c !== taken);
  }
  return deck;
}

/** Score a core staple must reach for this deck to be seeded (Arcane Signet makes no mana for a colourless commander). */
const CORE_MIN_SCORE = 50;

/**
 * The format's two core mana rocks (`isCore`) go in first when the deck can use them: a theme deck
 * whose ramp slots fill with on-theme mana creatures would otherwise leave Sol Ring out.
 */
function seedCore(start: Deck, ctx: EngineContext, pool: Pool, slots: number): Deck {
  let deck = start;
  let left = slots;
  const have = deckCounts(deck);
  for (const c of pool.nonland) {
    if (left <= 0) break;
    if (!isCore(c.card) || have.has(c.card.oracleId)) continue;
    const s = createScorer(deck, ctx).score(c.card);
    if (s.gate || s.score < CORE_MIN_SCORE) continue;
    deck = addCard(deck, c.card.oracleId);
    left--;
  }
  return deck;
}

/** Share of the open nonland slots a pack of one card may take. */
const PACK_SHARE = 0.4;

/**
 * Cards a deck may hold many copies of (CR 903.5b: Relentless Rats, Shadowborn Apostle, Seven
 * Dwarves, Nazgûl) go in as a pack when the theme wants them (`packWanted`): one copy of such a
 * card does nothing. A card with a stated limit goes in at its limit; of the cards with no limit
 * the best one goes in at the plan's pack size. Returns the deck unchanged when no such card fits.
 */
function seedPacks(start: Deck, ctx: EngineContext, pool: Pool, slots: number): Deck {
  if (pool.plan.packSize <= 0 || pool.plan.tribe === null) return start;
  let deck = start;
  const have = deckCounts(deck);
  const scorer = createScorer(deck, ctx);
  const wanted = pool.nonland
    .filter((c) => copyLimit(c.card) > 1 && packWanted(c, pool.plan.tribe) && !scorer.score(c.card).gate)
    .sort((a, b) => b.base + b.jitter - (a.base + a.jitter) || (a.card.oracleId < b.card.oracleId ? -1 : 1));
  let room = Math.floor(slots * PACK_SHARE);
  let unlimited = false;
  for (const c of wanted) {
    const limit = copyLimit(c.card);
    if (!Number.isFinite(limit) && unlimited) continue;
    const want = Number.isFinite(limit) ? limit : pool.plan.packSize;
    const n = Math.min(want, room) - (have.get(c.card.oracleId) ?? 0);
    if (n < 2) continue; // a pack of one is not a pack
    deck = addCard(deck, c.card.oracleId, n);
    room -= n;
    if (!Number.isFinite(limit)) unlimited = true;
  }
  return deck;
}

/** Sources of each colour the deck's most demanding spell needs (Karsten, deck-theory.md §4.2). */
function colourDemand(deck: Deck, ctx: EngineContext): { demand: Record<Color, number>; pips: Record<Color, number> } {
  const demand = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  const pips = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const { card, features, qty } of deckCards(deck, ctx.db).cards) {
    if (isLandCard(features)) continue;
    for (const c of COLORS) {
      const p = finite(features.pips[c]);
      if (p <= 0) continue;
      pips[c] += p * qty;
      demand[c] = Math.max(demand[c], karstenSources(p, card.cmc));
    }
  }
  return { demand, pips };
}

/** Splits `n` whole basics over colours in proportion to `weights` (largest remainder). */
function split(n: number, weights: Partial<Record<Color, number>>, colors: Color[]): Partial<Record<Color, number>> {
  const out: Partial<Record<Color, number>> = {};
  const total = colors.reduce((a, c) => a + Math.max(0, finite(weights[c])), 0);
  if (n <= 0 || colors.length === 0) return out;
  const shares = colors.map((c) => ({ c, exact: total > 0 ? (n * Math.max(0, finite(weights[c]))) / total : n / colors.length }));
  let left = n;
  for (const s of shares) { out[s.c] = Math.floor(s.exact); left -= Math.floor(s.exact); }
  shares.sort((a, b) => (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact)) || COLORS.indexOf(a.c) - COLORS.indexOf(b.c));
  for (let i = 0; i < left; i++) out[shares[i % shares.length].c] = (out[shares[i % shares.length].c] ?? 0) + 1;
  return out;
}

const makesMana = (c: Candidate): boolean => /\badd\b/i.test(c.card.oracleText);

/**
 * Mana base (spec §12 step 3). Two or more colours: first the lands that make at least two of the
 * deck's colours, most played first, inside the tapland cap. Then a few utility lands, by score,
 * while they are worth more than a basic. Then basics split so each colour reaches the sources its
 * most demanding spell needs; what is left over follows the deck's pip counts. Colourless decks
 * get colourless utility lands and Wastes. Always fills all `slots` when a basic land is available.
 */
function fillLands(start: Deck, ctx: EngineContext, pool: Pool, slots: number): Deck {
  let deck = start;
  if (slots <= 0) return deck;
  const colors = pool.identity.filter((c) => pool.basics[c]);
  const nColors = pool.identity.length;
  const ci = Math.min(5, nColors);
  const used = new Set(deckCounts(deck).keys());
  const fixerIds = new Set(pool.fixers.map((c) => c.card.oracleId));
  let cands = pool.lands.filter((c) => !used.has(c.card.oracleId) && !fixerIds.has(c.card.oracleId));
  const basicCards: Card[] = nColors === 0 ? (pool.basics.C ? [pool.basics.C] : []) : colors.map((c) => pool.basics[c] as Card);
  // Every colour keeps at least a couple of basics, for the cards that fetch them.
  const reserve = basicCards.length === 0 ? 0 : nColors === 0 ? 4 : Math.min(slots, nColors >= 4 ? nColors : nColors * 2);
  const cap = basicCards.length === 0 ? slots : Math.min(NONBASIC_CAP[ci], slots - reserve);
  const makes = (c: Candidate) => pool.identity.filter((col) => finite(c.f.sources[col]) >= RELIABLE_SOURCE).length;
  const anyColours = (c: Candidate) => COLORS.filter((col) => finite(c.f.sources[col]) > 0).length;
  const tapCap = finalTargets(deck, ctx, pool).taplandCap;
  let taplands = finite(summarizeDeck(deck, ctx.db).taplands);
  let offColour = 0;
  let utility = 0;
  for (const { features, card } of deckCards(deck, ctx.db).cards) {
    if (!isLandCard(features) || isBasicLand(card) || nColors === 0) continue;
    const n = pool.identity.filter((col) => finite(features.sources[col]) > 0).length;
    if (n === 0) offColour++;
    if (n < 2) utility++;
  }
  let picked = 0;
  const take = (c: Candidate) => {
    deck = addCard(deck, c.card.oracleId);
    used.add(c.card.oracleId);
    cands = cands.filter((x) => x !== c);
    taplands += finite(c.f.taplandWeight);
    picked++;
  };

  // Fixers: lands that make two or more of the deck's colours.
  if (nColors >= 2) {
    const scorer = createScorer(deck, ctx);
    const room = cap - Math.max(0, UTILITY_CAP[ci] - utility);
    for (const c of pool.fixers) {
      if (picked >= room) break;
      if (used.has(c.card.oracleId)) continue;
      const tap = finite(c.f.taplandWeight);
      if (tap > 0 && taplands + tap > tapCap) continue;
      if (scorer.score(c.card).gate) continue;
      take(c);
    }
  }

  // Utility lands, by score, while one is worth more than a basic.
  while (picked < cap && utility < UTILITY_CAP[ci] && cands.length > 0) {
    const scorer = createScorer(deck, ctx);
    let basicScore = 0;
    for (const b of basicCards) basicScore = Math.max(basicScore, scorer.score(b).score);
    let best: Candidate | null = null;
    let bestScore = -Infinity;
    for (const c of cands) {
      const n = makes(c);
      if (nColors >= 2 && n >= 2) continue;
      if (!makesMana(c)) continue;
      if (nColors <= 1 && anyColours(c) >= 3) continue;        // an any-colour land fixes nothing here
      if (nColors === 0 ? !(finite(c.f.sources.C) > 0) : n === 0 && !(finite(c.f.sources.C) > 0)) continue;
      if (nColors > 0 && n === 0 && offColour >= OFF_COLOUR_LANDS[ci]) continue;
      const tap = finite(c.f.taplandWeight);
      if (tap > 0 && taplands + tap > tapCap) continue;
      const s = scorer.score(c.card);
      if (s.gate) continue;
      const v = s.score + c.jitter;
      if (basicCards.length > 0 && v < basicScore + UTILITY_MARGIN) continue;
      if (v > bestScore) { bestScore = v; best = c; }
    }
    if (!best) break;
    if (nColors > 0 && makes(best) === 0) offColour++;
    utility++;
    take(best);
  }

  return addBasics(deck, ctx, pool, slots - picked);
}

/**
 * Adds `left` basic lands, split so each colour reaches the sources its most demanding spell needs;
 * what is left over follows the deck's pip counts. Colourless decks get Wastes.
 */
function addBasics(start: Deck, ctx: EngineContext, pool: Pool, slots: number): Deck {
  let deck = start;
  let left = slots;
  if (left <= 0) return deck;
  const colors = pool.identity.filter((c) => pool.basics[c]);
  const nColors = pool.identity.length;
  const basicCards: Card[] = nColors === 0 ? (pool.basics.C ? [pool.basics.C] : []) : colors.map((c) => pool.basics[c] as Card);

  const { demand, pips } = colourDemand(deck, ctx);
  const have = summarizeDeck(deck, ctx.db).sources;
  // Off-colour cards a Rulebreaker commander lets in (Tolabow's red spells, Seluma's Angels) can
  // only be paid for by basics of their colour: each such colour gets a share of the basics that
  // follows its pips, at least two, and never more than its most demanding card needs.
  const splash = pool.splash.filter((c) => pips[c] > 0);
  if (splash.length > 0) {
    const totalPips = COLORS.reduce((a, c) => a + pips[c], 0);
    const room = basicCards.length > 0 ? left - Math.min(left, nColors) : left; // the deck's own colours keep a basic each
    let given = 0;
    for (const c of splash) {
      const short = Math.ceil(Math.max(0, demand[c] - finite(have[c])));
      const n = Math.min(room - given, short, Math.max(2, Math.round((left * SPLASH_SHARE * pips[c]) / totalPips)));
      if (n <= 0) continue;
      deck = addCard(deck, (pool.basics[c] as Card).oracleId, n);
      given += n;
    }
    left -= given;
  }
  if (left <= 0 || basicCards.length === 0) return deck;
  if (nColors === 0) return addCard(deck, basicCards[0].oracleId, left);

  const need: Partial<Record<Color, number>> = {};
  let needSum = 0;
  for (const c of colors) {
    need[c] = Math.max(0, demand[c] - finite(have[c]));
    needSum += need[c] as number;
  }
  // Not enough basics for every colour's most demanding spell: each colour's shortfall is weighed
  // by its share of the deck's pips, so one triple-black card does not hand an Elf deck more
  // Swamps than Forests.
  const pipSum = colors.reduce((a, c) => a + pips[c], 0);
  const weighed: Partial<Record<Color, number>> = {};
  for (const c of colors) weighed[c] = (need[c] as number) * (PIP_BASE + (pipSum > 0 ? pips[c] / pipSum : 1 / colors.length));
  const counts: Partial<Record<Color, number>> = needSum >= left ? split(left, weighed, colors) : {};
  if (needSum < left) {
    // Every colour gets what it is short of; the surplus follows the pips.
    const whole: Partial<Record<Color, number>> = {};
    let given = 0;
    for (const c of colors) { whole[c] = Math.floor(need[c] as number); given += whole[c] as number; }
    const anyPips = colors.some((c) => pips[c] > 0);
    const extra = split(left - given, anyPips ? pips : Object.fromEntries(colors.map((c) => [c, 1])), colors);
    for (const c of colors) counts[c] = (whole[c] ?? 0) + (extra[c] ?? 0);
  }
  for (const c of colors) {
    const n = counts[c] ?? 0;
    if (n > 0) deck = addCard(deck, (pool.basics[c] as Card).oracleId, n);
  }
  return deck;
}

/** Fills every open slot: spells up to the land target, then the mana base. */
function fillOpen(start: Deck, ctx: EngineContext, pool: Pool): Deck {
  let deck = start;
  const free = () => DECK_SIZE - deckCount(deck);
  if (free() <= 0) return deck;
  deck = seedCore(deck, ctx, pool, Math.max(0, free() - landSlots(deck, ctx, pool)));
  deck = seedPacks(deck, ctx, pool, Math.max(0, free() - landSlots(deck, ctx, pool)));
  deck = fillNonland(deck, ctx, pool, Math.max(0, free() - landSlots(deck, ctx, pool) - SECOND_PASS));
  deck = fillNonland(deck, ctx, pool, Math.max(0, free() - landSlots(deck, ctx, pool)));
  deck = fillLands(deck, ctx, pool, free());
  // A thin pool (owned cards only) can leave slots open after the lands: more spells, then basics.
  if (free() > 0) deck = fillNonland(deck, ctx, pool, free());
  return deck;
}

/**
 * Repair (spec §12 step 4): every rule or target-bracket violation loses its offender to the best
 * legal card in the same role, and the deck is brought back to exactly 100. Cards in `keep` stay.
 */
function repair(start: Deck, ctx: EngineContext, pool: Pool, keep: Set<string>): Deck {
  let deck = start;
  for (let round = 0; round < REPAIR_ROUNDS; round++) {
    const off = nextOffender(deck, ctx, keep);
    if (!off) break;
    const without = removeCard(deck, off.id);
    const into = bestReplacement(without, ctx, pool, { card: ctx.db.get(off.id), f: ctx.db.features(off.id) });
    deck = into ? addCard(without, into.card.oracleId) : without;
  }
  if (deckCount(deck) < DECK_SIZE) deck = fillOpen(deck, ctx, pool);
  // Over 100 (too many locked or kept cards plus fills): the weakest free cards go.
  while (deckCount(deck) > DECK_SIZE) {
    const scorer = createScorer(deck, ctx);
    let worst: string | null = null;
    let worstScore = Infinity;
    for (const e of deck.main) {
      if (e.locked || keep.has(e.oracleId) || qtyOf(e) < 1) continue;
      const card = ctx.db.get(e.oracleId);
      const s = card ? scorer.score(card).score : -1;
      if (s < worstScore) { worstScore = s; worst = e.oracleId; }
    }
    if (!worst) break;
    deck = removeCard(deck, worst);
  }
  return deck;
}

/**
 * Power pass. While the deck plays above its target bracket, its sharpest free card gives way to
 * the best card of a lower power tier in the same role that is itself no tutor, fast mana or Game
 * Changer: first tier 5, fast mana and tutors; at Brackets 1-2 then the format's hundred most
 * played cards, and after those the merely popular ones. Staples every precon carries (Sol Ring)
 * stay. Bracket 1 is asked to play like 2 at most: nothing built from real cards reads lower.
 * While the deck plays below its target, its weakest low-tier card gives way to the best tier 4-5
 * card. The pass is kept only when the rating ends up higher.
 */
function tunePower(start: Deck, ctx: EngineContext, pool: Pool, keep: Set<string>): Deck {
  const { db } = ctx;
  const target = pool.plan.bracket;
  const gapOf = (d: Deck): number => {
    const plays = analyzeBracket(d, ctx).playsLike;
    return plays > target ? plays - Math.max(2, target) : plays - target;
  };
  const startGap = gapOf(start);
  if (startGap === 0) return start;
  let deck = start;
  const gone = new Set<string>();
  const isSharp = (card: Card, f: CardFeatures) => f.roles.includes('fast-mana') || f.roles.includes('tutor') || card.gameChanger;
  for (let n = 0; n < (target <= 2 ? LOW_POWER_SWAPS : POWER_SWAPS); n++) {
    const gap = n === 0 ? startGap : gapOf(deck);
    if (gap === 0 || Math.sign(gap) !== Math.sign(startGap)) break;
    const scorer = createScorer(deck, ctx);
    let out: { id: string; card: Card; f: CardFeatures } | null = null;
    let outKey = -Infinity;
    for (const e of deck.main) {
      if (e.locked || keep.has(e.oracleId) || qtyOf(e) < 1) continue;
      const card = db.get(e.oracleId);
      const f = card ? db.features(e.oracleId) : undefined;
      if (!card || !f || isLandCard(f)) continue;
      const sharp = isSharp(card, f);
      // Brackets 1-2 keep the staples every precon carries. Above that a deck that still plays over
      // its target after the other sharp cards went trades its staple tutors and fast mana too
      // (Kaalia at Bracket 4 came out as a Bracket 5 pile), all but Sol Ring and Arcane Signet.
      const staple = isStaple(card);
      if (gap > 0 ? (staple && (target <= 2 || isCore(card))) || !(f.powerTier >= 5 || sharp || (target <= 2 && f.powerTier >= 3)) : f.powerTier > 2) continue;
      const score = scorer.score(card).score;
      const key = gap > 0 ? Math.max(f.powerTier, sharp ? 4.5 : 0) * 1000 - score - (staple ? 10000 : 0) : -score;
      if (key > outKey) { outKey = key; out = { id: e.oracleId, card, f }; }
    }
    if (!out) break;
    const gave = out;
    gone.add(gave.id);
    const without = removeCard(deck, gave.id);
    const into = bestReplacement(without, ctx, pool, gave, (c) => !gone.has(c.card.oracleId) && (gap > 0
      ? c.f.powerTier <= Math.min(3, Math.max(2, gave.f.powerTier - 1)) && !isSharp(c.card, c.f)
      : c.f.powerTier >= 4));
    if (!into) break;
    deck = addCard(without, into.card.oracleId);
  }
  // A deck that now plays at its target is what was asked for: it is kept unless it rates clearly
  // worse (the later climb repairs what the trades cost). Otherwise the better-rated deck stays.
  const after = fineRating(rateDeck(deck, ctx));
  const before = fineRating(rateDeck(start, ctx));
  return after > before || (gapOf(deck) === 0 && after >= before - ON_TARGET_SLACK) ? deck : start;
}

/** A build and what the builder had to change about the request to make it legal. */
export interface BuildReport { deck: Deck; notes: string[] }

/**
 * Companions the deck cannot honour are dropped before the build, with a note: one that asks for
 * more than 100 cards (Yorion), or for one card type shared by all nonland cards (Umori) when the
 * commanders or the locked cards do not share one. Umori's type, when there is one, is enforced by
 * the pool (`sharedTypeFor`).
 */
function settleCompanion(deck: Deck, ctx: EngineContext, notes: string[]): Deck {
  if (!deck.companion) return deck;
  const card = ctx.db.get(deck.companion);
  const name = card?.name ?? 'The companion';
  const drop = (why: string): Deck => {
    notes.push(`${name} was dropped as companion: ${why}`);
    return { ...deck, companion: null };
  };
  // What is already fixed (commanders, locked or kept cards) may rule the companion out by itself:
  // outside the colour identity, not a companion at all, a kept card that breaks its condition.
  const fixed = companionViolation(deck, ctx.db);
  if (fixed) return drop(fixed.message);
  const shared = sharedTypeFor(deck, ctx.db);
  if (shared.needed && shared.type === null) return drop('the commanders and locked cards share no card type, so no deck around them can meet its condition.');
  if (shared.needed) notes.push(`${name} is the companion, so every nonland card is ${/^[AEIOU]/.test(shared.type ?? '') ? 'an' : 'a'} ${shared.type}.`);
  return deck;
}

function build(start0: Deck, keep: Set<string>, ctx: EngineContext, opts: BuildOptions, notes: string[] = []): Deck {
  const start = settleCompanion(start0, ctx, notes);
  let deck = buildOnce(start, keep, ctx, opts);
  // A companion condition the finished deck still breaks (Yorion wants 120 cards; a condition the
  // pool could not meet): the companion goes, and the deck is built again without it.
  if (deck.companion && validateDeck(deck, ctx.db).some((v) => v.code === 'companion')) {
    const v = validateDeck(deck, ctx.db).find((x) => x.code === 'companion');
    notes.push(`${ctx.db.get(deck.companion)?.name ?? 'The companion'} was dropped as companion: ${v?.message ?? 'its condition cannot be met.'}`);
    deck = buildOnce({ ...start, companion: null }, keep, ctx, opts);
  }
  return deck;
}

/**
 * The spells changed after the lands were chosen (repairs, the power pass, the climb), so the
 * basics are split again for the colours the finished deck needs. Kept only when the rating does
 * not fall. Locked basics and basics the caller asked to keep stay as they are.
 */
function rebalanceBasics(start: Deck, ctx: EngineContext, pool: Pool, keep: Set<string>): Deck {
  let stripped = 0;
  const main = start.main.filter((e) => {
    const card = ctx.db.get(e.oracleId);
    if (e.locked || keep.has(e.oracleId) || !card || !isBasicLand(card)) return true;
    stripped += qtyOf(e);
    return false;
  });
  if (stripped < 2 || pool.identity.length < 2) return start;
  const deck = addBasics({ ...start, main }, ctx, pool, stripped);
  if (deckCount(deck) !== deckCount(start)) return start;
  return fineRating(rateDeck(deck, ctx)) >= fineRating(rateDeck(start, ctx)) ? deck : start;
}

/** Score under which a finisher is not forced into a deck just to make the count. */
const WINCON_MIN_SCORE = 20;
/** Cards that win on a condition of their own: brought in for the count only when on theme, or when nothing else is left. */
const ALT_WIN = /\byou win the game\b/i;

/**
 * The later passes trade cards by score and can leave the deck under its win-condition band (the
 * fill only insists on role minimums when slots run short). While the deck holds fewer finishers
 * than the band's bottom, its lowest-scoring free spell that is not one gives way to the best
 * finisher the pool has for it. Stops when the pool has none worth playing.
 */
function ensureWinConditions(start: Deck, ctx: EngineContext, pool: Pool, keep: Set<string>): Deck {
  let deck = start;
  const isWin = (id: string) => ctx.db.features(id)?.roles.includes('win-condition') === true;
  for (let n = 0; n < 8; n++) {
    const summary = summarizeDeck(deck, ctx.db);
    const band = targetsFor(deck, ctx, summary).roles['win-condition'];
    if (!band || finite(summary.roleCounts['win-condition']) >= band.lo) break;
    const scorer = createScorer(deck, ctx);
    const have = new Set(deckCounts(deck).keys());
    const ins: { c: Candidate; key: number }[] = [];
    const tally = tallyDeck(deck, ctx, pool.plan);
    for (const c of pool.nonland) {
      if (have.has(c.card.oracleId) || !c.f.roles.includes('win-condition') || copyLimit(c.card) > 1) continue;
      if (planBonus(c.kind, tally, pool.plan) === null) continue;
      const s = scorer.score(c.card);
      if (s.gate || s.score < WINCON_MIN_SCORE) continue;
      ins.push({ c, key: s.score + c.jitter + c.adjust - (ALT_WIN.test(c.card.oracleText) && c.theme < 0.5 ? 25 : 0) });
    }
    ins.sort((x, y) => y.key - x.key || (x.c.card.oracleId < y.c.card.oracleId ? -1 : 1));
    let out: string | null = null;
    let outScore = Infinity;
    for (const e of deck.main) {
      if (e.locked || keep.has(e.oracleId) || qtyOf(e) < 1 || isWin(e.oracleId)) continue;
      const card = ctx.db.get(e.oracleId);
      const f = card ? ctx.db.features(e.oracleId) : undefined;
      if (!card || !f || isLandCard(f)) continue;
      const score = scorer.score(card).score;
      if (score < outScore) { outScore = score; out = e.oracleId; }
    }
    if (!out) break;
    // Never at the price of legality or of the bracket the deck plays at.
    const plays = analyzeBracket(deck, ctx).playsLike;
    let next: Deck | null = null;
    for (const { c } of ins.slice(0, 4)) {
      const trial = addCard(removeCard(deck, out), c.card.oracleId);
      if (nextOffender(trial, ctx, keep)) continue;
      if (analyzeBracket(trial, ctx).playsLike > Math.max(plays, pool.plan.bracket)) continue;
      next = trial;
      break;
    }
    if (!next) break;
    deck = next;
  }
  return deck;
}

function buildOnce(start: Deck, keep: Set<string>, ctx: EngineContext, opts: BuildOptions): Deck {
  const pool = buildPool(start, ctx, opts);
  let deck = fillOpen(start, ctx, pool);
  // A pack of one card (Relentless Rats, Seven Dwarves) stays whole through the later passes, and
  // the core rocks stay in.
  const kept = new Set(keep);
  for (const e of deck.main) {
    const card = ctx.db.get(e.oracleId);
    if (card && ((qtyOf(e) > 1 && !isBasicLand(card)) || (isCore(card) && !isLandCard(ctx.db.features(e.oracleId) ?? { landWeight: 1 } as CardFeatures)))) kept.add(e.oracleId);
  }
  keep = kept;
  deck = repair(deck, ctx, pool, keep);
  deck = tunePower(deck, ctx, pool, keep);
  deck = rebalanceBasics(deck, ctx, pool, keep);
  const climbed = climb(deck, ctx, pool, keep, { maxSwaps: CLIMB_SWAPS, evalBudget: CLIMB_EVALS });
  if (climbed.swaps.length > 0) deck = repair(climbed.deck, ctx, pool, keep);
  return ensureWinConditions(deck, ctx, pool, keep);
}

/**
 * Builds a full deck around the commanders (spec §12): keeps the commanders and the locked
 * entries, replaces everything else. The result has 100 cards, no rule violations and a bracket
 * floor within the target whenever the locked cards and the options allow it. The same seed gives
 * the same deck; another seed shifts every card's score by up to ±3, so builds differ.
 *
 * A locked entry keeps its count: copies the build adds of the same card (basics) sit in a second,
 * unlocked entry. A companion whose condition cannot be met is dropped (`autoBuildReport` says so).
 */
export function autoBuild(deck: Deck, ctx: EngineContext, opts: BuildOptions): Deck {
  return autoBuildReport(deck, ctx, opts).deck;
}

/** `autoBuild` with notes on what had to give (a dropped companion, a companion's deck-wide condition). */
export function autoBuildReport(deck: Deck, ctx: EngineContext, opts: BuildOptions): BuildReport {
  const main = deck.main.filter((e) => e.locked && qtyOf(e) >= 1).map((e) => ({ ...e, qty: qtyOf(e) }));
  const notes: string[] = [];
  const built = build({ ...deck, main }, new Set(main.map((e) => e.oracleId)), ctx, opts, notes);
  return { deck: built, notes };
}

/** Fills the open slots of a deck with the same algorithm, keeping every card already in it. */
export function fillRest(deck: Deck, ctx: EngineContext, opts: BuildOptions): Deck {
  return fillRestReport(deck, ctx, opts).deck;
}

/** `fillRest` with the same notes as `autoBuildReport`. */
export function fillRestReport(deck: Deck, ctx: EngineContext, opts: BuildOptions): BuildReport {
  const notes: string[] = [];
  const built = build(deck, new Set(deck.main.map((e) => e.oracleId)), ctx, opts, notes);
  return { deck: built, notes };
}
