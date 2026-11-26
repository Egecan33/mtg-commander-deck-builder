import { mulberry32 } from '@/engine/random';
import { canPair, cardFitsDeck, copyLimit, isCommanderEligible } from '@/engine/rules';
import { parseDecklist } from '@/engine/text';
import type { Bracket, Card, Deck } from '@/engine/types';
import { card, deckText, fixtureDb } from './fixture-db';

const db = fixtureDb();

export function fixtureDeck(name: 'precon' | 'upgraded' | 'cedh', bracket: Bracket): Deck {
  const p = parseDecklist(deckText(name), db);
  return { id: null, name, commanders: p.commanders, companion: p.companion, chosenColor: null, main: p.main, targetBracket: bracket, themeWeights: null };
}

const isLand = (id: string) => (db.features(id)?.landWeight ?? 0) >= 1;

/** The deck with ten nonland, non-commander cards swapped for ten legal, on-colour fixture cards that were not in it. */
export function withTenRandom(deck: Deck): Deck {
  const inDeck = new Set([...deck.commanders, ...deck.main.map((e) => e.oracleId)]);
  const out = deck.main.map((e) => ({ ...e }));
  const removable = out.filter((e) => !isLand(e.oracleId) && !deck.commanders.includes(e.oracleId));
  const r1 = mulberry32(1);
  const picked = new Set<string>();
  while (picked.size < 10) picked.add(removable[Math.floor(r1() * removable.length)].oracleId);
  const pool = db.all().filter((c) => !inDeck.has(c.oracleId) && !isLand(c.oracleId) && copyLimit(c) === 1 && cardFitsDeck(c, deck, db) === null);
  const r2 = mulberry32(2);
  const adds = new Set<string>();
  while (adds.size < 10) adds.add(pool[Math.floor(r2() * pool.length)].oracleId);
  const addList = [...adds];
  const main = out.filter((e) => !picked.has(e.oracleId));
  for (const id of addList) { main.push({ oracleId: id, qty: 1, locked: false }); }
  return { ...deck, main };
}

/** Two commanders that pair, a companion, 30 copies of one card, and an id the database lacks. */
export function oddDeck(): Deck {
  const eligible = db.all().filter((c) => isCommanderEligible(c) && db.features(c.oracleId));
  let pair: [Card, Card] | null = null;
  for (const a of eligible) {
    for (const b of eligible) if (a.oracleId < b.oracleId && canPair(a, b)) { pair = [a, b]; break; }
    if (pair) break;
  }
  if (!pair) throw new Error('no partner pair in the fixture');
  const many = db.all().find((c) => !isLand(c.oracleId) && copyLimit(c) > 30 && c.legality === 'legal');
  if (!many) throw new Error('no unlimited-copies card in the fixture');
  const companion = card('Jegantha, the Wellspring');
  return {
    id: null, name: 'odd', commanders: [pair[0].oracleId, pair[1].oracleId], companion: companion.oracleId, chosenColor: null,
    main: [{ oracleId: many.oracleId, qty: 30, locked: false }, { oracleId: 'not-a-card', qty: 1, locked: false }],
    targetBracket: 3, themeWeights: null,
  };
}
