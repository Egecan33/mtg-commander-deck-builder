import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { addBox, linkBox } from '@/server/boxes';
import { listCollections, setActiveCollection } from '@/server/collection';
import type { Db } from '@/server/db';
import { getDeck, listDecks, sanitizeDeck, saveDeck } from '@/server/decks';
import { holdersFor, selfHolders } from '@/server/holders';
import { oracleIdByName, storeTestProducts } from './products-fixture';
import { seedDb, useServerDb } from './server-db';

let db: Db;
let seeded: Buffer;
beforeAll(() => {
  const first = seedDb();
  storeTestProducts(first);
  seeded = first.serialize();
  first.close();
});
beforeEach(() => {
  db = new Database(seeded);
  useServerDb(db);
});
afterAll(() => useServerDb(null));

function builtDeck(name: string, cards: [string, number][]) {
  const krenko = oracleIdByName(db, 'Krenko, Mob Boss');
  const deck = sanitizeDeck({
    name, commanders: [krenko], built: true, targetBracket: 3,
    main: cards.map(([n, qty]) => ({ oracleId: oracleIdByName(db, n), qty })),
  });
  return saveDeck(deck)!.deck;
}

describe('holders', () => {
  it('holdersFor lists boxes with sealed copies and built decks', () => {
    const box = addBox('LandingParty_TRC');
    const deck = builtDeck('Mine', [['Sol Ring', 1], ['Forest', 30]]);
    const holders = holdersFor('physical');
    expect(holders.map((h) => h.id).sort()).toEqual([`box:${box.id}`, `deck:${deck.id}`].sort());
    const b = holders.find((h) => h.kind === 'box')!;
    expect(b.name).toBe('Landing Party box');
    expect(b.cards.get(oracleIdByName(db, 'Sol Ring'))).toBe(1);
    const d = holders.find((h) => h.kind === 'deck')!;
    expect(d.name).toBe('Mine (built)');
    expect(d.cards.get(oracleIdByName(db, 'Sol Ring'))).toBe(1);
    expect(d.cards.has(oracleIdByName(db, 'Forest'))).toBe(false);
    expect(listCollections().find((c) => c.id === 'physical')!.holders).toBe(2);
  });

  it('holdersFor arena is empty', () => {
    addBox('LandingParty_TRC');
    builtDeck('Mine', [['Sol Ring', 1]]);
    expect(holdersFor('arena')).toEqual([]);
    expect(listCollections().find((c) => c.id === 'arena')!.holders).toBe(0);
  });

  it('selfHolders is the deck and its linked boxes, ignoring a deleted deck link', () => {
    const box = addBox('LandingParty_TRC');
    const deck = builtDeck('Mine', []);
    linkBox(box.id, deck.id!);
    expect([...selfHolders(deck)].sort()).toEqual([`box:${box.id}`, `deck:${deck.id}`].sort());
    db.prepare('DELETE FROM decks WHERE id = ?').run(deck.id);
    expect(holdersFor('physical').map((h) => h.id)).toEqual([`box:${box.id}`]);
  });

  it('a box linked to a built deck is held once, by the deck', () => {
    const box = addBox('LandingParty_TRC');
    const deck = builtDeck('Landing Party', [['Sol Ring', 1], ['Arcane Signet', 1]]);
    linkBox(box.id, deck.id!);
    expect(holdersFor('physical').map((h) => h.id)).toEqual([`deck:${deck.id}`]);
    expect(listCollections().find((c) => c.id === 'physical')!.holders).toBe(1);
    // Not built any more: the sealed box holds its cards again.
    saveDeck(sanitizeDeck({ ...deck, built: false }), deck.id!);
    expect(holdersFor('physical').map((h) => h.id)).toEqual([`box:${box.id}`]);
    expect(listCollections().find((c) => c.id === 'physical')!.holders).toBe(1);
    // A box linked to a deck that is gone counts as a box again.
    saveDeck(sanitizeDeck({ ...deck, built: true }), deck.id!);
    db.prepare('DELETE FROM decks WHERE id = ?').run(deck.id);
    expect(holdersFor('physical').map((h) => h.id)).toEqual([`box:${box.id}`]);
    expect(listCollections().find((c) => c.id === 'physical')!.holders).toBe(1);
  });

  it('listDecks reports built', () => {
    const built = builtDeck('B', []);
    const plain = saveDeck(sanitizeDeck({ name: 'P', commanders: [oracleIdByName(db, 'Krenko, Mob Boss')], main: [] }))!.deck;
    const tiles = listDecks();
    expect(tiles.find((t) => t.id === built.id)!.built).toBe(true);
    expect(tiles.find((t) => t.id === plain.id)!.built).toBe(false);
  });

  it('marking a deck built never changes its cards', () => {
    const deck = builtDeck('B', [['Sol Ring', 1], ['Cultivate', 1]]);
    const before = getDeck(deck.id!)!.deck.main;
    saveDeck({ ...deck, built: true }, deck.id!);
    expect(getDeck(deck.id!)!.deck.main).toEqual(before);
    expect(getDeck(deck.id!)!.deck.built).toBe(true);
  });
});
