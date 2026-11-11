import type { Card, CardDb, Deck } from '../types';
import { hasType } from './commander';

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20,
};

export const isBasicLand = (card: Card): boolean => hasType(card, 'Basic') && hasType(card, 'Land');

/** How many copies a deck may hold (CR 903.5b); parsed from the card, never from a list. */
export function copyLimit(card: Card): number {
  if (hasType(card, 'Basic')) return Infinity;
  if (/A deck can have any number of cards named/i.test(card.oracleText)) return Infinity;
  const capped = /A deck can have up to (\w+) cards named/i.exec(card.oracleText);
  if (capped) {
    const word = capped[1].toLowerCase();
    const n = NUMBER_WORDS[word] ?? Number.parseInt(word, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 1;
}

/** Entry quantity as a non-negative integer; junk counts as 0. */
export function qtyOf(qty: number): number {
  return Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 0;
}

/** Cards in the deck: commanders plus main quantities. The companion is outside the deck. */
export function deckSize(deck: Deck): number {
  return deck.commanders.length + deck.main.reduce((n, e) => n + qtyOf(e.qty), 0);
}

/** Quantity per oracleId over commanders and main, in first-seen order. */
export function deckCounts(deck: Deck): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of deck.commanders) counts.set(id, (counts.get(id) ?? 0) + 1);
  for (const e of deck.main) {
    const q = qtyOf(e.qty);
    if (q > 0) counts.set(e.oracleId, (counts.get(e.oracleId) ?? 0) + q);
  }
  return counts;
}

/** The commanders the database knows. */
export function commanderCards(deck: Deck, db: CardDb): Card[] {
  const out: Card[] = [];
  for (const id of deck.commanders) {
    const c = db.get(id);
    if (c) out.push(c);
  }
  return out;
}

/** Known cards of the starting deck (commanders + main) with quantities. */
export function startingDeck(deck: Deck, db: CardDb): { card: Card; qty: number }[] {
  const out: { card: Card; qty: number }[] = [];
  for (const [id, qty] of deckCounts(deck)) {
    const card = db.get(id);
    if (card) out.push({ card, qty });
  }
  return out;
}
