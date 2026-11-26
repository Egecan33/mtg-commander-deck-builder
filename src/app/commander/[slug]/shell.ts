import type { Bracket, Deck } from '@/engine/types';

/** A deck of just the commanders, the way the server scores a commander page. */
export const shellDeck = (commanders: string[], bracket: Bracket, name = ''): Deck => ({
  id: null, name, commanders, companion: null, chosenColor: null, main: [], targetBracket: bracket, themeWeights: null,
});

/** Front names joined with " and ". */
export const joinNames = (cards: { frontName: string }[]): string => cards.map((c) => c.frontName).join(' and ');
