import type { Card, CardDb, Color, Deck, Violation } from '../types';
import { hasCreatureType, hasSubtype, hasType } from './commander';
import { commanderCards, isBasicLand } from './copies';

const ORDER: Color[] = ['W', 'U', 'B', 'R', 'G'];

export interface Rulebreaker {
  name: string;
  /** "…and any basic land cards". */
  anyBasic: boolean;
  /** Cards allowed whatever their colour identity. */
  allows?: (card: Card) => boolean;
  /** Tolabow: instants and sorceries may include `deck.chosenColor`. */
  extraSpellColor?: true;
  /** Whtz: no maximum deck size. */
  noMaxSize?: true;
}

/** The eight Rulebreaker commanders (CR 903.5e, rules.md §4.6), keyed by Scryfall oracle_id. */
export const RULEBREAKERS: Readonly<Record<string, Rulebreaker>> = {
  'dbbf6379-01b4-400d-a277-5887e6be1d0f': {
    name: 'Seluma, Light of Aysen', anyBasic: true, allows: (c) => hasCreatureType(c, 'Angel'),
  },
  '214f4e0a-eba7-4a08-86b2-d490d6ae1048': {
    name: 'Maular, the Next Evolution', anyBasic: true, allows: (c) => hasType(c, 'Creature') && c.cmc >= 7,
  },
  'b8354ac6-5285-43dd-9ba5-93064def2e96': {
    name: 'The Everforger', anyBasic: true,
    allows: (c) => (hasType(c, 'Artifact') && hasType(c, 'Creature')) || hasSubtype(c, 'Equipment'),
  },
  '8023d419-8fd2-4b92-b6ea-f25fd67e6410': {
    name: 'Valko Indorian', anyBasic: true, allows: (c) => hasCreatureType(c, 'Phyrexian'),
  },
  'c7ea2ce7-f684-44a2-94b2-d4aa7353f6fc': {
    name: 'The Unluckiest Planeswalker', anyBasic: true, allows: (c) => hasSubtype(c, 'Aura'),
  },
  '3f5db55a-8bae-4e97-86bd-f2a2dacf07a4': {
    name: 'Grizzlegom, Hurloon Hero', anyBasic: false, allows: (c) => hasType(c, 'Land'),
  },
  '56d71eda-4037-45fb-9e98-1725147af6fc': { name: 'Tolabow, Loch Rascal', anyBasic: true, extraSpellColor: true },
  '73ba7ed0-0f08-4ba4-9f51-42c48f1b62ea': { name: 'Whtz, the Bibliophile', anyBasic: false, noMaxSize: true },
};

/** Rulebreaker entries of the deck's commanders. The ability works only from the command zone slot. */
export function rulebreakersOf(deck: Deck): Rulebreaker[] {
  const out: Rulebreaker[] = [];
  for (const id of deck.commanders) {
    const r = RULEBREAKERS[id];
    if (r) out.push(r);
  }
  return out;
}

/** The Prismatic Piper, Faceless One, Clara Oswald (CR 903.4b): detected by their shared wording. */
const choosesOwnColor = (card: Card) => /is your commander, choose a color before the game begins/i.test(card.oracleText);

/**
 * True when a commander cannot be played without a chosen colour (CR 903.4b: Piper, Faceless One,
 * Clara). Tolabow is not one of them: its extra colour is optional ("can include one color of your
 * choice"), so a Tolabow deck with no colour chosen is legal as long as it stays blue.
 */
export function requiresColorChoice(commanders: Card[]): boolean {
  return commanders.some(choosesOwnColor);
}

/**
 * True when the deck editor should offer a colour picker: the colour-choice commanders (where the
 * choice is mandatory, see `requiresColorChoice`) and Tolabow (where it is optional).
 */
export function needsColorChoice(commanders: Card[]): boolean {
  return commanders.some((c) => choosesOwnColor(c) || RULEBREAKERS[c.oracleId]?.extraSpellColor === true);
}

/**
 * Union of the commanders' colour identities, plus the chosen colour when a colour-choice commander
 * is present. Tolabow's chosen colour is not part of this set: it only widens instants and
 * sorceries, which `cardFitsDeck` handles.
 */
export function allowedIdentity(deck: Deck, db: CardDb): Set<Color> {
  const commanders = commanderCards(deck, db);
  const set = new Set<Color>();
  for (const c of commanders) for (const color of c.colorIdentity) set.add(color);
  if (deck.chosenColor && commanders.some(choosesOwnColor)) set.add(deck.chosenColor);
  return new Set(ORDER.filter((c) => set.has(c)));
}

const showColors = (colors: Iterable<Color>) => {
  const list = ORDER.filter((c) => [...colors].includes(c));
  return list.length ? list.join('') : 'colourless';
};

/**
 * Whether one card may be in this deck: legality first, then colour identity with the Rulebreaker
 * overrides. Copy counts and deck size are `validateDeck`'s job. While the deck has no known
 * commander there is no identity to break, so only legality is checked.
 */
export function cardFitsDeck(card: Card, deck: Deck, db: CardDb): Violation | null {
  if (card.legality !== 'legal') {
    return { code: 'banned', message: `${card.name} is banned in Commander.`, oracleIds: [card.oracleId] };
  }
  if (card.isMeldResult) {
    return { code: 'banned', message: `${card.name} is a meld result and cannot be put in a deck.`, oracleIds: [card.oracleId] };
  }
  if (commanderCards(deck, db).length === 0) return null;

  const allowed = allowedIdentity(deck, db);
  const outside = card.colorIdentity.filter((c) => !allowed.has(c));
  if (outside.length === 0) return null;

  for (const r of rulebreakersOf(deck)) {
    if (r.anyBasic && isBasicLand(card)) return null;
    if (r.allows?.(card)) return null;
    if (
      r.extraSpellColor && deck.chosenColor
      && (hasType(card, 'Instant') || hasType(card, 'Sorcery'))
      && outside.every((c) => c === deck.chosenColor)
    ) return null;
  }
  return {
    code: 'identity',
    message: `${card.name} (${showColors(card.colorIdentity)}) is outside the commander's colour identity (${showColors(allowed)}).`,
    oracleIds: [card.oracleId],
  };
}
