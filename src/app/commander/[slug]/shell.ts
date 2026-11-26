import type { Bracket, Color, Deck } from '@/engine/types';

/** A deck of just the commanders, the way the server scores a commander page. */
export const shellDeck = (commanders: string[], bracket: Bracket, name = '', chosenColor: Color | null = null): Deck => ({
  id: null, name, commanders, companion: null, chosenColor, main: [], targetBracket: bracket, themeWeights: null,
});

/** Front names joined with " and ". */
export const joinNames = (cards: { frontName: string }[]): string => cards.map((c) => c.frontName).join(' and ');
