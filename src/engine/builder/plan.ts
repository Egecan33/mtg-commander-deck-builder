import { hasType, isEveryCreatureType } from '../rules';
import { AXIS_MEMBER, deckCards, resolveThemeWeights } from '../summary';
import type { Bracket, Card, CardFeatures, Deck, EngineContext } from '../types';

type PerBracket = readonly [number, number, number, number, number];

/** Theme weight from which a `typal:<type>` axis makes the deck a typal deck of that type. */
const TRIBE_WEIGHT = 0.8;
/** Creatures of the deck's own type a typal deck wants, by bracket. */
const TRIBE_TARGET: PerBracket = [30, 30, 28, 24, 16];
/** Most any-type typal cards (Herald's Horn, Coat of Arms) a typal deck takes; other decks take none. */
const GENERIC_TYPAL_CAP: PerBracket = [6, 6, 6, 5, 3];
/** Theme weight from which the deck counts as spellslinger, and the instants and sorceries it wants. */
const SPELL_WEIGHT = 0.8;
const SPELL_TARGET: PerBracket = [28, 28, 30, 32, 34];
/** Score bonus for a card of a kind the plan is still short of: this much at the start, falling to the floor. */
const TRIBE_BONUS = 26;
const TRIBE_BONUS_FLOOR = 10;
const SPELL_BONUS = 16;
const SPELL_BONUS_FLOOR = 8;
/** Creatures a deck that is neither typal nor spellslinger wants, by bracket. */
const CREATURE_TARGET: PerBracket = [24, 24, 22, 18, 12];
const CREATURE_BONUS = 7;
const CREATURE_BONUS_FLOOR = 2;

/**
 * Fast-mana pieces a deck wants, by bracket: at Brackets 4-5 the ramp band "includes fast mana"
 * (deck-theory.md §2.3), and a cEDH deck's ramp is mostly rocks and rituals that cost 0-1.
 */
const FAST_TARGET: PerBracket = [0, 0, 0, 3, 10];
const FAST_BONUS = 26;
const FAST_BONUS_FLOOR = 14;

/**
 * Most tutors a build takes at Brackets 1-2, under the role band's own top: precon-level decks
 * (brackets.md §3) find their cards by drawing them. No cap of the build's own from Bracket 3 up.
 */
const TUTOR_CAP: PerBracket = [1, 2, 99, 99, 99];
/**
 * Copies taken of a card the deck may hold any number of (Relentless Rats, Shadowborn Apostle),
 * when the theme wants it: enough for the card to do what it says, by bracket. None at Bracket 5.
 */
const PACK_SIZE: PerBracket = [18, 18, 18, 14, 0];

const CHOOSES_TYPE = /choose a creature type|of the chosen type|creature type of your choice|shares? (?:a|at least one) creature type/i;

/** What the deck's theme asks of the build beyond scores: counts of cards of a kind. */
export interface Plan {
  bracket: Bracket;
  tribe: string | null;
  tribeTarget: number;
  genericTypalCap: number;
  spellTarget: number;      // 0 unless spellslinger
  creatureTarget: number;   // 0 for typal and spellslinger decks
  fastTarget: number;       // 0 below Bracket 4
  tutorCap: number;         // the build's own cap on tutors (Brackets 1-2)
  packSize: number;         // copies of an any-number card the theme wants; 0 = none
}

export interface Kind { member: boolean; generic: boolean; spell: boolean; creature: boolean; fast: boolean; tutor?: boolean }
export interface Tally { tribe: number; generic: number; spells: number; creatures: number; fast: number; tutors: number }

export function makePlan(deck: Deck, ctx: EngineContext): Plan {
  const bracket = Math.min(5, Math.max(1, Math.round(Number(deck.targetBracket) || 3))) as Bracket;
  const weights = resolveThemeWeights(deck, ctx) ?? {};
  let tribe: string | null = null;
  let top = 0;
  for (const [axis, w] of Object.entries(weights)) {
    if (!axis.startsWith('typal:') || !(w >= TRIBE_WEIGHT) || w <= top) continue;
    top = w;
    tribe = axis.slice('typal:'.length);
  }
  const spellslinger = (weights.spellslinger ?? 0) >= SPELL_WEIGHT;
  return {
    bracket, tribe,
    tribeTarget: tribe ? TRIBE_TARGET[bracket - 1] : 0,
    genericTypalCap: tribe ? GENERIC_TYPAL_CAP[bracket - 1] : 0,
    spellTarget: spellslinger ? SPELL_TARGET[bracket - 1] : 0,
    creatureTarget: tribe || spellslinger ? 0 : CREATURE_TARGET[bracket - 1],
    fastTarget: FAST_TARGET[bracket - 1],
    tutorCap: TUTOR_CAP[bracket - 1],
    packSize: PACK_SIZE[bracket - 1],
  };
}

/** Which of the plan's kinds a card is. */
export function kindOf(card: Card, f: CardFeatures, plan: Plan): Kind {
  const creature = hasType(card, 'Creature');
  const member = plan.tribe !== null && creature && (f.creatureTypes.includes(plan.tribe) || isEveryCreatureType(card));
  const any = f.axes.typal;
  const generic = !member && ((any !== undefined && Math.max(any.e, any.p) >= AXIS_MEMBER) || CHOOSES_TYPE.test(card.oracleText));
  const fast = f.roles.includes('fast-mana') && !f.roles.includes('land');
  return { member, generic, spell: hasType(card, 'Instant') || hasType(card, 'Sorcery'), creature, fast, tutor: f.roles.includes('tutor') && !f.roles.includes('land') };
}

export function tallyDeck(deck: Deck, ctx: EngineContext, plan: Plan): Tally {
  const t: Tally = { tribe: 0, generic: 0, spells: 0, creatures: 0, fast: 0, tutors: 0 };
  const commanders = new Set(deck.commanders);
  for (const { card, features, qty } of deckCards(deck, ctx.db).cards) {
    if (commanders.has(card.oracleId)) continue;
    const k = kindOf(card, features, plan);
    if (k.member) t.tribe += qty;
    if (k.generic) t.generic += qty;
    if (k.spell) t.spells += qty;
    if (k.creature) t.creatures += qty;
    if (k.fast) t.fast += qty;
    if (k.tutor) t.tutors += qty;
  }
  return t;
}

/** Points added to a card's score for the plan, or null when the plan rules the card out. */
export function planBonus(k: Kind, t: Tally, plan: Plan): number | null {
  if (k.generic && t.generic >= plan.genericTypalCap) return null;
  if (k.tutor && t.tutors >= plan.tutorCap) return null;
  let bonus = 0;
  if (k.member && t.tribe < plan.tribeTarget) {
    bonus += TRIBE_BONUS_FLOOR + (TRIBE_BONUS - TRIBE_BONUS_FLOOR) * ((plan.tribeTarget - t.tribe) / plan.tribeTarget);
  }
  if (k.spell && t.spells < plan.spellTarget) {
    bonus += SPELL_BONUS_FLOOR + (SPELL_BONUS - SPELL_BONUS_FLOOR) * ((plan.spellTarget - t.spells) / plan.spellTarget);
  }
  if (k.creature && t.creatures < plan.creatureTarget) {
    bonus += CREATURE_BONUS_FLOOR + (CREATURE_BONUS - CREATURE_BONUS_FLOOR) * ((plan.creatureTarget - t.creatures) / plan.creatureTarget);
  }
  if (k.fast && t.fast < plan.fastTarget) {
    bonus += FAST_BONUS_FLOOR + (FAST_BONUS - FAST_BONUS_FLOOR) * ((plan.fastTarget - t.fast) / plan.fastTarget);
  }
  return bonus;
}
