import type { CardDb, Deck, EngineContext } from '@/engine/types';
import { card } from './fixture-db';

export const ctxOf = (db: CardDb): EngineContext => ({ db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} });

/** A mono-red Standard Brawl deck of `size` cards around Krenko: the pool's red and colourless cards, then Mountains. */
export function redDeck(db: CardDb, size = 60): Deck {
  const krenko = card('Krenko, Mob Boss');
  const picks = db.all().filter((c) =>
    c.oracleId !== krenko.oracleId && c.colorIdentity.every((x) => x === 'R') && !/\bLand\b/.test(c.typeLine)).slice(0, size - 1 - 20);
  const mountain = card('Mountain');
  const main = picks.map((c) => ({ oracleId: c.oracleId, qty: 1, locked: false }));
  const filled = main.reduce((n, e) => n + e.qty, 0) + 1;
  main.push({ oracleId: mountain.oracleId, qty: size - filled, locked: false });
  return { id: null, name: 't', commanders: [krenko.oracleId], companion: null, chosenColor: null, main, targetBracket: 3, themeWeights: null };
}
