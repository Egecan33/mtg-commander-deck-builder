import Database from 'better-sqlite3';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BuildDeckResponse, BuildProposalsResponse, DiscoverState } from '@/app/lib/api';
import type { Deck } from '@/engine/types';
import { addBox, linkBox } from '@/server/boxes';
import { browseCards } from '@/server/browse';
import { runBuild } from '@/server/build';
import { setCollectionCards } from '@/server/collection';
import { analyzeResponse } from '@/server/context';
import type { Db } from '@/server/db';
import { sanitizeDeck, saveDeck } from '@/server/decks';
import { discoverState, discoverTiers, startDiscover } from '@/server/discover';
import { getCardDb } from '@/server/store';
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
afterAll(() => useServerDb(null));

const id = (name: string) => oracleIdByName(db, name);
const deckOf = (name: string, commander: string, main: [string, number][], extra: Record<string, unknown> = {}): Deck =>
  sanitizeDeck({ name, commanders: [id(commander)], targetBracket: 3, main: main.map(([n, qty]) => ({ oracleId: id(n), qty })), ...extra });
/** A deck that is really assembled and holds the one Sol Ring of the collection. */
const builtElves = (): Deck => saveDeck(deckOf('Elves', 'Lathril, Blade of the Elves', [['Sol Ring', 1]], { built: true }))!.deck;

function fresh(): void {
  db = new Database(seeded);
  useServerDb(db);
}

describe('conflicts in analyze, browse and builds', () => {
  let elves: Deck;
  beforeEach(() => {
    fresh();
    // Physical: one copy of every legal fixture card in Krenko's colours (Sol Ring, Arcane Signet and Command Tower among them).
    const cards = new Map<string, number>();
    for (const c of getCardDb().all()) if (c.legality === 'legal' && c.colorIdentity.every((x) => x === 'R')) cards.set(c.oracleId, 1);
    for (const n of ['Sol Ring', 'Arcane Signet', 'Command Tower']) expect(cards.get(id(n))).toBe(1);
    setCollectionCards('physical', cards);
    elves = builtElves();
  });

  const krenko = (main: [string, number][] = []) => deckOf('New Krenko', 'Krenko, Mob Boss', main);

  it('analyze reports the built deck holding Sol Ring', () => {
    const deck = krenko([['Sol Ring', 1], ['Arcane Signet', 1]]);
    const r = analyzeResponse(deck);
    expect(r.conflicts.cards).toEqual({ [id('Sol Ring')]: ['Elves (built)'] });
    expect(r.conflicts.byHolder).toEqual([{ holderId: `deck:${elves.id}`, kind: 'deck', name: 'Elves (built)', oracleIds: [id('Sol Ring')] }]);
    expect(r.boxMatch).toBeNull();
    // A built deck never conflicts with itself.
    expect(analyzeResponse(elves).conflicts).toEqual({ cards: {}, byHolder: [] });
    // Worked out per request, not kept with the cached analysis: unbuilding Elves frees the Sol Ring.
    saveDeck({ ...elves, built: false }, elves.id!);
    expect(analyzeResponse(deck).conflicts).toEqual({ cards: {}, byHolder: [] });
  });

  it('browse marks Sol Ring held for a new deck but not for the built deck itself', () => {
    const r = browseCards(krenko(), { q: 'sol ring' });
    expect(r.cards.some((c) => c.oracleId === id('Sol Ring'))).toBe(true);
    expect(r.heldBy).toEqual({ [id('Sol Ring')]: ['Elves (built)'] });
    expect(browseCards(elves, { q: 'sol ring' }).heldBy).toEqual({});
    expect(browseCards(krenko(), { q: 'arcane signet' }).heldBy).toEqual({});
  });

  it('no "!" on a singleton card the deck already holds while it still has a free copy', () => {
    // Two Sol Rings: the built Elves deck holds one, the other is free and this deck already has it.
    const cards = new Map<string, number>([[id('Sol Ring'), 2], [id('Arcane Signet'), 1]]);
    setCollectionCards('physical', cards);
    const deck = krenko([['Sol Ring', 1]]);
    expect(analyzeResponse(deck).conflicts.cards).toEqual({});
    // The browser and the commander pages ask about the card as it stands in the deck: a singleton card cannot take a second copy.
    expect(browseCards(deck, { q: 'sol ring' }).heldBy).toEqual({});
    // A deck without it still sees the free copy, so no "!" either.
    expect(browseCards(krenko(), { q: 'sol ring' }).heldBy).toEqual({});
  });

  it('an owned-only free-only build never picks Sol Ring', () => {
    const r = runBuild(krenko(), 'auto', { ownedOnly: true, freeOnly: true, seed: 3 }) as BuildDeckResponse;
    const ids = r.deck.main.map((e) => e.oracleId);
    expect(ids).not.toContain(id('Sol Ring'));
    expect(ids).toContain(id('Arcane Signet'));
    expect(r.heldBy).toEqual({});
    // Suggestions for that deck stay off the held copy too.
    const add = runBuild(r.deck, 'add', { ownedOnly: true, freeOnly: true, role: 'ramp', count: 10 }) as BuildProposalsResponse;
    expect(add.proposals.map((p) => p.in)).not.toContain(id('Sol Ring'));
    expect(add.heldBy).toEqual({});
  });

  it('an owned-only build without freeOnly may pick it and marks it in heldBy', () => {
    const r = runBuild(krenko(), 'auto', { ownedOnly: true, seed: 3 }) as BuildDeckResponse;
    expect(r.deck.main.map((e) => e.oracleId)).toContain(id('Sol Ring'));
    expect(r.heldBy).toEqual({ [id('Sol Ring')]: ['Elves (built)'] });
    // A suggestion that brings in the held copy carries the mark.
    const free = runBuild(krenko(), 'auto', { ownedOnly: true, freeOnly: true, seed: 3 }) as BuildDeckResponse;
    const add = runBuild(free.deck, 'add', { ownedOnly: true, role: 'ramp', count: 10 }) as BuildProposalsResponse;
    expect(add.proposals.map((p) => p.in)).toContain(id('Sol Ring'));
    expect(add.heldBy).toEqual({ [id('Sol Ring')]: ['Elves (built)'] });
  });

  it('freeOnly without ownedOnly changes nothing', () => {
    const plain = runBuild(krenko(), 'auto', { seed: 5 }) as BuildDeckResponse;
    const flagged = runBuild(krenko(), 'auto', { freeOnly: true, seed: 5 }) as BuildDeckResponse;
    expect(flagged.deck.main).toEqual(plain.deck.main);
  });

  it('boxMatch offers the box whose product the deck is', () => {
    const older = addBox('LandingParty_TRC');
    db.prepare("UPDATE collection_boxes SET added_at = '2026-01-01T00:00:00.000Z' WHERE id = ?").run(older.id);
    const box = addBox('LandingParty_TRC');
    // Krenko, Sol Ring, Arcane Signet and Command Tower: 4 of the product's 5 non-basic cards.
    const precon = deckOf('Landing Party', 'Krenko, Mob Boss', [['Sol Ring', 1], ['Arcane Signet', 1], ['Command Tower', 1], ['Forest', 4]]);
    expect(analyzeResponse(precon).boxMatch).toEqual({ boxId: box.id, name: 'Landing Party' });
    // 3 of 5 is not enough, and another commander is not this product.
    expect(analyzeResponse(krenko([['Sol Ring', 1], ['Arcane Signet', 1]])).boxMatch).toBeNull();
    const other = deckOf('Elfish', 'Lathril, Blade of the Elves', [['Sol Ring', 1], ['Arcane Signet', 1], ['Command Tower', 1], ['Cultivate', 1]]);
    expect(analyzeResponse(other).boxMatch).toBeNull();

    // Linked boxes are not offered again; a link to a deck that is gone counts as no link.
    const saved = saveDeck(precon)!.deck;
    linkBox(box.id, saved.id!);
    linkBox(older.id, saved.id!);
    expect(analyzeResponse(saved).boxMatch).toBeNull();
    db.prepare('DELETE FROM decks WHERE id = ?').run(saved.id);
    expect(analyzeResponse(precon).boxMatch).toEqual({ boxId: box.id, name: 'Landing Party' });

    // A box with nothing sealed left is not offered.
    db.prepare('UPDATE collection_box_cards SET qty = 0 WHERE box_id = ?').run(box.id);
    expect(analyzeResponse(precon).boxMatch).toEqual({ boxId: older.id, name: 'Landing Party' });
  });
});

describe('best from collection with free copies only', () => {
  async function finished(freeOnly: boolean): Promise<DiscoverState> {
    startDiscover(3, 'owned', freeOnly);
    for (;;) {
      const s = discoverState(3, 'owned', freeOnly);
      if (s.status !== 'running') return s;
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  const tier0 = (s: DiscoverState) => s.entries[0].tiers[0].deck.main.map((e) => e.oracleId);

  let all: DiscoverState;
  let free: DiscoverState;
  beforeAll(async () => {
    fresh();
    setCollectionCards('physical', new Map(['Krenko, Mob Boss', 'Sol Ring', 'Arcane Signet', 'Lightning Bolt', 'Command Tower'].map((n) => [id(n), 1])));
    builtElves();
    all = await finished(false);
    free = await finished(true);
  }, 240_000);

  it('leaves copies held by a built deck out of the owned-cards deck', () => {
    expect(all.status).toBe('done');
    expect(free.status).toBe('done');
    expect(all.freeOnly).toBe(false);
    expect(free.freeOnly).toBe(true);
    expect(free.entries.map((e) => e.commander.name)).toEqual(['Krenko, Mob Boss']);
    expect(tier0(all)).toContain(id('Sol Ring'));
    expect(tier0(free)).not.toContain(id('Sol Ring'));
    expect(tier0(free)).toContain(id('Arcane Signet'));
  });

  it('GET reads freeOnly=1 and the tiers follow the same result', async () => {
    const route = await import('@/app/api/discover/route');
    const res = await route.GET(new Request('http://localhost:3210/api/discover?bracket=3&freeOnly=1'));
    const s = (await res.json()) as DiscoverState;
    expect(s.freeOnly).toBe(true);
    expect(s.status).toBe('done');
    expect(tier0(s)).toEqual(tier0(free));
    const { tiers } = discoverTiers(3, id('Krenko, Mob Boss'), 'owned', true);
    expect(tiers.map((t) => t.cap)).toEqual([5, 10, 15, 20]);
  }, 120_000);
});
