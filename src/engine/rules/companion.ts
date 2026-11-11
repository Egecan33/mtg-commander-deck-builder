import type { Card, CardDb, Deck, Violation } from '../types';
import { frontTypes, hasCreatureType, hasType } from './commander';
import { deckCounts, deckSize, startingDeck } from './copies';
import { allowedIdentity } from './identity';

/** Banned as a companion only (rules.md §4.4); Scryfall has no field for it. */
const LUTRI_ORACLE_ID = '158a6225-a246-4fd6-aa57-0df8067b4383';

const MIN_DECK_SIZE = 100;
const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
const CARD_TYPES = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Instant', 'Kindred', 'Planeswalker', 'Sorcery', 'Tribal'];
const KAHEERA_TYPES = ['Cat', 'Elemental', 'Nightmare', 'Dinosaur', 'Beast'];
/** Keyword abilities that are activated abilities (their cost sits in reminder text or after the keyword). */
const ACTIVATED_KEYWORDS = new Set([
  'equip', 'cycling', 'typecycling', 'basic landcycling', 'landcycling', 'crew', 'unearth', 'ninjutsu',
  'commander ninjutsu', 'outlast', 'level up', 'fortify', 'reconfigure', 'transmute', 'embalm', 'eternalize',
  'scavenge', 'bloodrush', 'channel', 'forecast', 'reinforce', 'transfigure', 'aura swap', 'monstrosity',
  'adapt', 'boast', 'encore', 'station', 'saddle', 'craft', 'exhaust', 'power-up',
  'plainscycling', 'islandcycling', 'swampcycling', 'mountaincycling', 'forestcycling',
]);

const isLand = (c: Card) => hasType(c, 'Land');
const isPermanent = (c: Card) => !hasType(c, 'Instant') && !hasType(c, 'Sorcery');
const even = (c: Card) => c.cmc % 2 === 0;

/** Mana cost as the rules see it in the deck: both halves of a split card, otherwise the front face. */
function costSymbols(c: Card): string[] {
  const cost = c.layout === 'split' ? c.faces.map((f) => f.manaCost).join('') : (c.faces[0]?.manaCost ?? c.manaCost);
  return cost.match(/\{[^}]+\}/g) ?? [];
}

function repeatsManaSymbol(c: Card): boolean {
  const seen = new Set<string>();
  for (const s of costSymbols(c)) {
    if (seen.has(s)) return true;
    seen.add(s);
  }
  return false;
}

/**
 * Heuristic: a "cost: effect" line outside quotes and reminder text, an activated keyword, or the
 * intrinsic mana ability of a basic land type.
 */
function hasActivatedAbility(c: Card): boolean {
  if (frontTypes(c).subtypes.some((s) => BASIC_LAND_TYPES.includes(s))) return true;
  if (c.keywords.some((k) => ACTIVATED_KEYWORDS.has(k.toLowerCase()))) return true;
  const text = (c.faces[0]?.oracleText ?? c.oracleText).replace(/\([^)]*\)/g, '');
  return text.split('\n').some((line) => /^[^"“:]*:/.test(line));
}

interface Rule { describe: string; ok: (cards: { card: Card; qty: number }[], size: number) => boolean; each?: (c: Card) => boolean }
const each = (describe: string, test: (c: Card) => boolean): Rule => ({
  describe, each: test, ok: (cards) => cards.every((x) => test(x.card)),
});

/** The ten companion conditions (CR 702.139), keyed by front name. */
const RULES: Record<string, Rule> = {
  'Gyruda, Doom of Depths': each('only cards with even mana values', even),
  'Jegantha, the Wellspring': each('no card with a repeated mana symbol in its cost', (c) => !repeatsManaSymbol(c)),
  'Kaheera, the Orphanguard': each(
    'only Cat, Elemental, Nightmare, Dinosaur or Beast creature cards',
    (c) => !hasType(c, 'Creature') || KAHEERA_TYPES.some((t) => hasCreatureType(c, t)),
  ),
  'Keruga, the Macrosage': each('only lands and cards with mana value 3 or greater', (c) => isLand(c) || c.cmc >= 3),
  'Lurrus of the Dream-Den': each('only permanent cards with mana value 2 or less', (c) => !isPermanent(c) || c.cmc <= 2),
  'Lutri, the Spellchaser': {
    describe: 'no two nonland cards with the same name',
    ok: (cards) => cards.every((x) => isLand(x.card) || x.qty <= 1),
  },
  'Obosh, the Preypiercer': each('only lands and cards with odd mana values', (c) => isLand(c) || !even(c)),
  'Umori, the Collector': {
    describe: 'nonland cards that all share a card type',
    ok: (cards) => {
      const nonland = cards.filter((x) => !isLand(x.card));
      return nonland.length === 0 || CARD_TYPES.some((t) => nonland.every((x) => hasType(x.card, t)));
    },
  },
  'Yorion, Sky Nomad': {
    describe: `at least ${MIN_DECK_SIZE + 20} cards`,
    ok: (_cards, size) => size >= MIN_DECK_SIZE + 20,
  },
  'Zirda, the Dawnwaker': each('only permanent cards with an activated ability', (c) => !isPermanent(c) || hasActivatedAbility(c)),
};

/**
 * First problem with the deck's companion, or null when there is none (or no companion).
 * Codes: `unknown-card`, `banned` (not legal in the format), otherwise `companion`.
 */
export function companionViolation(deck: Deck, db: CardDb): Violation | null {
  const id = deck.companion;
  if (!id) return null;
  const card = db.get(id);
  if (!card) return { code: 'unknown-card', message: 'The companion is not in the card database.', oracleIds: [id] };
  const fail = (message: string, extra: string[] = []): Violation => ({ code: 'companion', message, oracleIds: [id, ...extra] });

  if (card.legality !== 'legal') return { code: 'banned', message: `${card.name} is banned in Commander.`, oracleIds: [id] };
  const rule = RULES[card.frontName];
  if (!card.keywords.includes('Companion') || !rule) return fail(`${card.name} does not have the companion ability.`);
  if (id === LUTRI_ORACLE_ID) return fail(`${card.name} is banned as a companion (it is legal in the deck itself).`);
  if (deckCounts(deck).has(id)) return fail(`${card.name} cannot be both the companion and a card in the deck.`);

  if (deck.commanders.some((c) => db.get(c))) {
    const allowed = allowedIdentity(deck, db);
    if (card.colorIdentity.some((c) => !allowed.has(c))) {
      return fail(`${card.name} is outside the commander's colour identity, so it cannot be the companion.`);
    }
  }

  const cards = startingDeck(deck, db);
  if (!rule.ok(cards, deckSize(deck))) {
    const test = rule.each;
    const offenders = test ? cards.filter((x) => !test(x.card)).map((x) => x.card) : [];
    const sample = offenders.slice(0, 3).map((c) => c.name).join(', ');
    const more = offenders.length > 3 ? ` and ${offenders.length - 3} more` : '';
    return fail(
      `${card.name} needs a starting deck with ${rule.describe}${sample ? `; breaking it: ${sample}${more}` : ''}.`,
      offenders.map((c) => c.oracleId),
    );
  }
  return null;
}
