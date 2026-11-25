import Database from 'better-sqlite3';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BoxDetailResponse, BoxInfo, BoxesResponse, CollectionAdjustResponse, CollectionResponse, CollectionsResponse } from '@/app/lib/api';
import { storeProducts } from '@/ingest/products';
import {
  addBox, attachBox, boxCards, boxedQuantities, linkBox, listBoxes, openBoxAsDeck, removeBox, takeFromBox,
} from '@/server/boxes';
import { adjustCollection, listCollections, ownedQuantities, replaceCollection, setActiveCollection, setCollectionCards } from '@/server/collection';
import type { Db } from '@/server/db';
import { getDeck, sanitizeDeck, saveDeck } from '@/server/decks';
import { HttpError } from '@/server/http';
import { fillerProducts, oracleIdByName, storeTestProducts } from './products-fixture';
import { seedDb, useServerDb } from './server-db';

const PRODUCT = 'LandingParty_TRC';

let db: Db;
let krenko: string;
let solRing: string;
let arcaneSignet: string;
let commandTower: string;
let cultivate: string;
let forest: string;

/** Per collection and card: copies sealed in boxes never exceed the total, and box rows stay sane. */
function invariant(database: Db, collectionId: string): void {
  const rows = database
    .prepare(
      `SELECT x.oracle_id AS oracleId, sum(x.qty) AS boxed,
         coalesce((SELECT k.qty FROM collection_cards k WHERE k.collection_id = b.collection_id AND k.oracle_id = x.oracle_id), 0) AS total
       FROM collection_box_cards x JOIN collection_boxes b ON b.id = x.box_id
       WHERE b.collection_id = ? GROUP BY x.oracle_id`,
    )
    .all(collectionId) as { oracleId: string; boxed: number; total: number }[];
  for (const r of rows) expect(r.boxed, `${collectionId} ${r.oracleId}: boxed ${r.boxed} > total ${r.total}`).toBeLessThanOrEqual(r.total);
  const bad = database.prepare('SELECT count(*) AS n FROM collection_box_cards WHERE qty < 0 OR qty > total').get() as { n: number };
  expect(bad.n, 'box rows with a negative quantity or more than the box came with').toBe(0);
  const orphans = database.prepare('SELECT count(*) AS n FROM collection_box_cards WHERE box_id NOT IN (SELECT id FROM collection_boxes)').get() as { n: number };
  expect(orphans.n, 'box cards without a box').toBe(0);
  const zero = database.prepare('SELECT count(*) AS n FROM collection_cards WHERE qty < 1').get() as { n: number };
  expect(zero.n, 'collection rows at zero').toBe(0);
}

// Seeding (cards, features, products) takes ~0.4 s; do it once and give every test its own in-memory copy.
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
  krenko = oracleIdByName(db, 'Krenko, Mob Boss');
  solRing = oracleIdByName(db, 'Sol Ring');
  arcaneSignet = oracleIdByName(db, 'Arcane Signet');
  commandTower = oracleIdByName(db, 'Command Tower');
  cultivate = oracleIdByName(db, 'Cultivate');
  forest = oracleIdByName(db, 'Forest');
});
afterEach(() => {
  invariant(db, 'physical');
  invariant(db, 'arena');
});
afterAll(() => useServerDb(null));

const total = (oracleId: string): number => ownedQuantities().get(oracleId) ?? 0;
const sealedOf = (boxId: string, oracleId: string): number => boxCards(boxId).find((c) => c.oracleId === oracleId)?.qty ?? 0;
const sorted = (m: ReadonlyMap<string, number>) => [...m].sort((a, b) => a[0].localeCompare(b[0]));
/** The HTTP status a server call fails with (200 when it does not fail). */
const status = (fn: () => unknown): number => {
  try {
    fn();
  } catch (err) {
    if (err instanceof HttpError) return err.status;
    throw err;
  }
  return 200;
};
const backdate = (boxId: string, at: string) => db.prepare('UPDATE collection_boxes SET added_at = ? WHERE id = ?').run(at, boxId);

describe('boxes in a collection', () => {
  it('adding a box adds its cards and remembers them', () => {
    adjustCollection(solRing, 1);
    const box = addBox(PRODUCT);
    expect(box).toMatchObject({ productId: PRODUCT, name: 'Landing Party', deckId: null, sealed: 9, total: 9 });
    expect(typeof box.addedAt).toBe('string');
    expect(total(solRing)).toBe(2);
    expect(total(forest)).toBe(4);
    expect(total(krenko)).toBe(1);
    expect(listBoxes()).toEqual([box]);
    expect(listBoxes()[0].sealed).toBe(listBoxes()[0].total);
    expect(boxCards(box.id)).toContainEqual({ oracleId: krenko, qty: 1, commander: true });
    expect(boxCards(box.id)).toContainEqual({ oracleId: forest, qty: 4, commander: false });
    expect(boxCards(box.id)).toHaveLength(6);
    expect(boxedQuantities('physical').get(solRing)).toBe(1);
    expect(boxedQuantities('physical').get(forest)).toBe(4);
  });

  it('buying the same product twice makes two boxes', () => {
    const a = addBox(PRODUCT);
    const b = addBox(PRODUCT);
    expect(a.id).not.toBe(b.id);
    expect(listBoxes().map((x) => x.id).sort()).toEqual([a.id, b.id].sort());
    expect(total(forest)).toBe(8);
    expect(boxedQuantities('physical').get(forest)).toBe(8);
  });

  it('lists boxes newest first', () => {
    const a = addBox(PRODUCT);
    const b = addBox(PRODUCT);
    backdate(a.id, '2026-01-01T00:00:00.000Z');
    expect(listBoxes().map((x) => x.id)).toEqual([b.id, a.id]);
  });

  it('removing a copy takes loose copies first', () => {
    adjustCollection(solRing, 1);
    const box = addBox(PRODUCT);
    const r = adjustCollection(solRing, -1);
    expect(r.qty).toBe(1);
    expect(r.fromBoxes).toEqual([]);
    expect(sealedOf(box.id, solRing)).toBe(1);
  });

  it('removing into a box says which box', () => {
    adjustCollection(solRing, 1);
    const box = addBox(PRODUCT);
    adjustCollection(solRing, -1);
    invariant(db, 'physical');
    const r = adjustCollection(solRing, -1);
    expect(r).toMatchObject({ qty: 0, fromBoxes: [{ boxId: box.id, name: 'Landing Party', qty: 1 }] });
    expect(sealedOf(box.id, solRing)).toBe(0);
    expect(listBoxes()[0]).toMatchObject({ sealed: 8, total: 9 });
  });

  it('removing more copies than owned drains boxes and clamps at zero', () => {
    adjustCollection(solRing, 1);
    const box = addBox(PRODUCT);
    const r = adjustCollection(solRing, -5);
    expect(r).toMatchObject({ qty: 0, fromBoxes: [{ boxId: box.id, name: 'Landing Party', qty: 1 }] });
    expect(ownedQuantities().has(solRing)).toBe(false);
    expect(db.prepare("SELECT count(*) AS n FROM collection_cards WHERE collection_id = 'physical' AND oracle_id = ?").get(solRing)).toEqual({ n: 0 });
    expect(sealedOf(box.id, solRing)).toBe(0);
  });

  it('takes from the newest box first and reports every box it touched', () => {
    adjustCollection(forest, 1);
    const older = addBox(PRODUCT);
    const newer = addBox(PRODUCT);
    backdate(older.id, '2026-01-01T00:00:00.000Z');
    // 1 loose + 4 + 4 boxed; removing 7 leaves 2, so 6 come out of boxes: 4 from the newer, 2 from the older.
    const r = adjustCollection(forest, -7);
    expect(r.qty).toBe(2);
    expect(r.fromBoxes).toEqual([
      { boxId: newer.id, name: 'Landing Party', qty: 4 },
      { boxId: older.id, name: 'Landing Party', qty: 2 },
    ]);
    expect(sealedOf(newer.id, forest)).toBe(0);
    expect(sealedOf(older.id, forest)).toBe(2);
  });

  it('undo puts the copy back into the same box', () => {
    const box = addBox(PRODUCT);
    const removed = adjustCollection(solRing, -1);
    expect(removed.fromBoxes).toEqual([{ boxId: box.id, name: 'Landing Party', qty: 1 }]);
    const back = adjustCollection(solRing, 1, removed.fromBoxes);
    expect(back.qty).toBe(1);
    expect(back.fromBoxes).toEqual([]);
    expect(sealedOf(box.id, solRing)).toBe(1);
    expect(listBoxes()[0]).toMatchObject({ sealed: 9, total: 9 });
  });

  it('undo of a removal spread over two boxes restores both', () => {
    const older = addBox(PRODUCT);
    const newer = addBox(PRODUCT);
    backdate(older.id, '2026-01-01T00:00:00.000Z');
    const before = sorted(boxedQuantities('physical'));
    const removed = adjustCollection(forest, -6);
    expect(removed.fromBoxes.map((f) => [f.boxId, f.qty])).toEqual([[newer.id, 4], [older.id, 2]]);
    adjustCollection(forest, 6, removed.fromBoxes);
    expect(total(forest)).toBe(8);
    expect(sorted(boxedQuantities('physical'))).toEqual(before);
  });

  it('undo into a box that no longer exists adds the copy loose', () => {
    const box = addBox(PRODUCT);
    const removed = adjustCollection(solRing, -1);
    removeBox(box.id, 'sold');
    const back = adjustCollection(solRing, 1, removed.fromBoxes);
    expect(back.qty).toBe(1);
    expect(back.fromBoxes).toEqual([]);
    expect(boxedQuantities('physical').get(solRing) ?? 0).toBe(0);
  });

  it('never puts more copies back into a box than were added or than it came with', () => {
    const box = addBox(PRODUCT);
    // Adding one Sol Ring cannot seal three, and a full box takes no more.
    adjustCollection(solRing, 1, [{ boxId: box.id, qty: 3 }]);
    expect(total(solRing)).toBe(2);
    expect(sealedOf(box.id, solRing)).toBe(1);
    takeFromBox(box.id, forest, 2);
    adjustCollection(forest, 1, [{ boxId: box.id, qty: 1 }, { boxId: box.id, qty: 1 }]);
    expect(total(forest)).toBe(5);
    expect(sealedOf(box.id, forest)).toBe(3);
    // A card the box never held stays loose.
    adjustCollection(oracleIdByName(db, 'Lightning Bolt'), 1, [{ boxId: box.id, qty: 1 }]);
    expect(boxCards(box.id)).toHaveLength(6);
  });

  it('sold removes the box\'s sealed copies; opened keeps them loose', () => {
    adjustCollection(solRing, 1);
    const sold = addBox(PRODUCT);
    const opened = addBox(PRODUCT);
    takeFromBox(sold.id, forest, 1); // taken out and kept: stays when the box is sold
    removeBox(sold.id, 'sold');
    invariant(db, 'physical');
    expect(total(solRing)).toBe(2);
    expect(total(forest)).toBe(5);
    expect(total(krenko)).toBe(1);
    expect(listBoxes().map((b) => b.id)).toEqual([opened.id]);
    removeBox(opened.id, 'opened');
    expect(total(solRing)).toBe(2);
    expect(total(forest)).toBe(5);
    expect(total(krenko)).toBe(1);
    expect(listBoxes()).toEqual([]);
    expect(boxedQuantities('physical').size).toBe(0);
    expect(db.prepare('SELECT count(*) AS n FROM collection_box_cards').get()).toEqual({ n: 0 });
    expect(status(() => removeBox(opened.id, 'sold'))).toBe(404);
    expect(status(() => removeBox(addBox(PRODUCT).id, 'lost' as 'sold'))).toBe(400);
  });

  it('taking a card out of a box keeps the total', () => {
    const box = addBox(PRODUCT);
    takeFromBox(box.id, forest, 2);
    expect(total(forest)).toBe(4);
    expect(sealedOf(box.id, forest)).toBe(2);
    expect(listBoxes()[0]).toMatchObject({ sealed: 7, total: 9 });
    // The two taken out are loose now, so removing two Forests leaves the box alone.
    expect(adjustCollection(forest, -2).fromBoxes).toEqual([]);
    expect(sealedOf(box.id, forest)).toBe(2);
    expect(status(() => takeFromBox(box.id, forest, 3))).toBe(409);
    expect(status(() => takeFromBox(box.id, oracleIdByName(db, 'Lightning Bolt'), 1))).toBe(409);
    expect(status(() => takeFromBox(box.id, forest, 0))).toBe(400);
    expect(status(() => takeFromBox('nope', forest, 1))).toBe(404);
  });

  it('replacing or clearing the collection drops its boxes', () => {
    addBox(PRODUCT);
    replaceCollection('2 Sol Ring');
    expect(listBoxes()).toEqual([]);
    expect(total(solRing)).toBe(2);
    addBox(PRODUCT);
    replaceCollection('');
    expect(listBoxes()).toEqual([]);
    expect(db.prepare('SELECT count(*) AS n FROM collection_boxes').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT count(*) AS n FROM collection_box_cards').get()).toEqual({ n: 0 });
    // Rewriting another collection leaves this one's boxes alone.
    const kept = addBox(PRODUCT);
    setCollectionCards('arena', new Map([[solRing, 1]]));
    expect(listBoxes().map((b) => b.id)).toEqual([kept.id]);
  });

  it('a box outlives its product', () => {
    const box = addBox(PRODUCT);
    const extra = { ...fillerProducts(db)[2], id: 'Filler_extra', name: 'Filler extra' };
    storeProducts(db, [...fillerProducts(db), extra]);
    expect(db.prepare('SELECT count(*) AS n FROM products WHERE id = ?').get(PRODUCT)).toEqual({ n: 0 });
    expect(listBoxes()).toEqual([box]);
    // The deck comes from the box's own cards; the commander flag was copied into the box.
    const { deckId } = openBoxAsDeck(box.id);
    const deck = getDeck(deckId)!.deck;
    expect(deck.commanders).toEqual([krenko]);
    expect(new Map(deck.main.map((e) => [e.oracleId, e.qty]))).toEqual(
      new Map([[solRing, 1], [arcaneSignet, 1], [commandTower, 1], [cultivate, 1], [forest, 4]]),
    );
  });

  it('opening a box as a deck saves a built deck with the commander and leaves totals unchanged', () => {
    adjustCollection(solRing, 1);
    const box = addBox(PRODUCT);
    takeFromBox(box.id, forest, 1); // no longer in the box, so not in the deck
    const before = sorted(ownedQuantities());
    const { deckId } = openBoxAsDeck(box.id);
    const saved = getDeck(deckId)!;
    expect(saved.deck).toMatchObject({ id: deckId, name: 'Landing Party', commanders: [krenko], companion: null, built: true, targetBracket: 3 });
    expect(new Map(saved.deck.main.map((e) => [e.oracleId, e.qty]))).toEqual(
      new Map([[solRing, 1], [arcaneSignet, 1], [commandTower, 1], [cultivate, 1], [forest, 3]]),
    );
    expect(sorted(ownedQuantities())).toEqual(before);
    expect(listBoxes()).toEqual([]);
    expect(status(() => openBoxAsDeck(box.id))).toBe(404);
  });

  it('opening a box linked to a deck marks that deck built and makes no second deck', () => {
    const box = addBox(PRODUCT);
    const mine = saveDeck(sanitizeDeck({ name: 'Mine', commanders: [krenko], main: [{ oracleId: solRing, qty: 1 }, { oracleId: cultivate, qty: 1 }] }))!.deck;
    linkBox(box.id, mine.id!);
    const decks = () => (db.prepare('SELECT count(*) AS n FROM decks').get() as { n: number }).n;
    const before = { decks: decks(), totals: sorted(ownedQuantities()) };
    expect(openBoxAsDeck(box.id)).toEqual({ deckId: mine.id, linked: true, chooseCommander: false });
    expect(decks()).toBe(before.decks);
    // Only `built` changes; the deck's cards stay exactly as they were.
    expect(getDeck(mine.id!)!.deck).toEqual({ ...mine, built: true });
    expect(sorted(ownedQuantities())).toEqual(before.totals);
    expect(listBoxes()).toEqual([]);
  });

  it('opening a box linked to a deleted deck makes a new deck', () => {
    const box = addBox(PRODUCT);
    const gone = saveDeck(sanitizeDeck({ name: 'Gone', commanders: [krenko] }))!.deck;
    linkBox(box.id, gone.id!);
    db.prepare('DELETE FROM decks WHERE id = ?').run(gone.id);
    const res = openBoxAsDeck(box.id);
    expect(res).toMatchObject({ linked: false, chooseCommander: false });
    expect(res.deckId).not.toBe(gone.id);
    expect(getDeck(res.deckId)!.deck).toMatchObject({ name: 'Landing Party', commanders: [krenko], built: true });
  });

  it('a box with more than two commander cards opens with no commander and every card in main', () => {
    const line = (name: string, qty: number, commander = false) => ({ oracleId: oracleIdByName(db, name), qty, commander });
    storeTestProducts(db, [{
      id: 'Trio_TST', name: 'Trio', setCode: 'TST', type: 'Commander Deck', releaseDate: '2026-01-01', unknownCards: 0,
      cards: [line('Atraxa, Praetors\' Voice', 1, true), line('Atarka, World Render', 2, true), line('Krenko, Mob Boss', 1, true), line('Sol Ring', 1)],
    }]);
    const box = addBox('Trio_TST');
    const res = openBoxAsDeck(box.id);
    expect(res).toMatchObject({ linked: false, chooseCommander: true });
    const deck = getDeck(res.deckId)!.deck;
    expect(deck.commanders).toEqual([]);
    expect(deck.built).toBe(true);
    expect(new Map(deck.main.map((e) => [e.oracleId, e.qty]))).toEqual(new Map([
      [oracleIdByName(db, 'Atraxa, Praetors\' Voice'), 1], [oracleIdByName(db, 'Atarka, World Render'), 2], [krenko, 1], [solRing, 1],
    ]));
  });

  it('keeps built on a deck only when it is true', () => {
    expect(sanitizeDeck({ name: 'A', built: true }).built).toBe(true);
    expect('built' in sanitizeDeck({ name: 'B', built: 'yes' })).toBe(false);
    expect('built' in sanitizeDeck({ name: 'C', built: false })).toBe(false);
    const saved = saveDeck(sanitizeDeck({ name: 'D', built: true }))!;
    expect(getDeck(saved.deck.id!)!.deck.built).toBe(true);
  });

  it('linking a box to a deck changes neither the deck nor the totals', () => {
    const box = addBox(PRODUCT);
    const saved = saveDeck(sanitizeDeck({ name: 'Mine', commanders: [krenko], main: [{ oracleId: solRing, qty: 1 }] }))!;
    const deckJson = () => db.prepare('SELECT json FROM decks WHERE id = ?').get(saved.deck.id);
    const json = deckJson();
    const before = sorted(ownedQuantities());
    linkBox(box.id, saved.deck.id!);
    expect(listBoxes()[0].deckId).toBe(saved.deck.id);
    linkBox(box.id, null);
    expect(listBoxes()[0].deckId).toBeNull();
    expect(deckJson()).toEqual(json);
    expect(sorted(ownedQuantities())).toEqual(before);
    expect(status(() => linkBox(box.id, 'no-such-deck'))).toBe(404);
    expect(status(() => linkBox('nope', null))).toBe(404);
  });

  it('refuses boxes on the Arena collection', () => {
    setActiveCollection('arena');
    expect(status(() => addBox(PRODUCT))).toBe(400);
    expect(listBoxes()).toEqual([]);
    expect(status(() => attachBox('arena', PRODUCT))).toBe(400);
    expect(ownedQuantities().size).toBe(0);
    setActiveCollection('physical');
    expect(status(() => addBox('NoSuchProduct'))).toBe(404);
    expect(listBoxes()).toEqual([]);
  });

  it('attachBox records a box without changing totals', () => {
    replaceCollection('1 Krenko, Mob Boss\n1 Sol Ring\n1 Arcane Signet\n1 Command Tower\n1 Cultivate\n5 Forest');
    const before = sorted(ownedQuantities());
    setActiveCollection('arena'); // the script names its collection; the active one does not matter
    const box = attachBox('physical', PRODUCT);
    setActiveCollection('physical');
    expect(box).toMatchObject({ productId: PRODUCT, name: 'Landing Party', sealed: 9, total: 9, deckId: null });
    expect(sorted(ownedQuantities())).toEqual(before);
    expect(listBoxes()).toEqual([box]);
  });

  it('attachBox refuses with 409 when the totals are short', () => {
    replaceCollection('1 Krenko, Mob Boss\n1 Sol Ring\n1 Arcane Signet\n1 Command Tower\n1 Cultivate\n5 Forest');
    attachBox('physical', PRODUCT);
    // One Forest is free, the box needs four: nothing is written.
    expect(status(() => attachBox('physical', PRODUCT))).toBe(409);
    expect(listBoxes()).toHaveLength(1);
    replaceCollection('1 Sol Ring');
    expect(status(() => attachBox('physical', PRODUCT))).toBe(409);
    expect(listBoxes()).toEqual([]);
    expect(status(() => attachBox('physical', 'NoSuchProduct'))).toBe(404);
    expect(status(() => attachBox('nope', PRODUCT))).toBe(404);
  });

  it('counts the boxes that still hold cards as holders', () => {
    expect(listCollections().map((c) => [c.id, c.holders])).toEqual([['physical', 0], ['arena', 0]]);
    const box = addBox(PRODUCT);
    addBox(PRODUCT);
    expect(listCollections().map((c) => [c.id, c.holders])).toEqual([['physical', 2], ['arena', 0]]);
    for (const c of boxCards(box.id)) takeFromBox(box.id, c.oracleId, c.qty);
    expect(listBoxes().find((b) => b.id === box.id)).toMatchObject({ sealed: 0, total: 9 });
    expect(listCollections().map((c) => [c.id, c.holders])).toEqual([['physical', 1], ['arena', 0]]);
  });
});

describe('box routes', () => {
  type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Response | Promise<Response>;
  const send = async <T>(handler: Handler, method: string, url: string, body?: unknown, id = ''): Promise<{ status: number; data: T }> => {
    const res = await handler(
      new Request(`http://localhost:3210${url}`, {
        method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
      }),
      { params: Promise.resolve({ id }) },
    );
    return { status: res.status, data: (await res.json()) as T };
  };

  it('adds, lists, shows, takes from, links, opens and removes boxes', async () => {
    const boxes = await import('@/app/api/collection/boxes/route');
    const one = await import('@/app/api/collection/boxes/[id]/route');
    const asDeck = await import('@/app/api/collection/boxes/[id]/deck/route');

    expect((await send(boxes.POST, 'POST', '/api/collection/boxes', {})).status).toBe(400);
    expect((await send(boxes.POST, 'POST', '/api/collection/boxes', { productId: 'NoSuchProduct' })).status).toBe(404);
    const added = await send<{ box: BoxInfo }>(boxes.POST, 'POST', '/api/collection/boxes', { productId: PRODUCT });
    expect(added.status).toBe(201);
    const id = added.data.box.id;
    expect((await send<BoxesResponse>(boxes.GET, 'GET', '/api/collection/boxes')).data.boxes.map((b) => b.id)).toEqual([id]);

    const shown = await send<BoxDetailResponse>(one.GET, 'GET', `/api/collection/boxes/${id}`, undefined, id);
    expect(shown.data.box).toMatchObject({ id, sealed: 9, total: 9 });
    expect(shown.data.cards[0]).toEqual({ oracleId: krenko, qty: 1, commander: true });
    expect(shown.data.lookup[krenko].name).toBe('Krenko, Mob Boss');
    expect((await send(one.GET, 'GET', '/api/collection/boxes/nope', undefined, 'nope')).status).toBe(404);

    const taken = await send<BoxDetailResponse>(one.PATCH, 'PATCH', `/api/collection/boxes/${id}`, { oracleId: forest, take: 1 }, id);
    expect(taken.status).toBe(200);
    expect(taken.data.box.sealed).toBe(8);
    expect(total(forest)).toBe(4);
    expect((await send(one.PATCH, 'PATCH', `/api/collection/boxes/${id}`, { oracleId: forest, take: 0 }, id)).status).toBe(400);
    expect((await send(one.PATCH, 'PATCH', `/api/collection/boxes/${id}`, { take: 1 }, id)).status).toBe(400);
    expect((await send(one.PATCH, 'PATCH', `/api/collection/boxes/${id}`, { oracleId: forest, take: 9 }, id)).status).toBe(409);

    const deckId = saveDeck(sanitizeDeck({ name: 'Mine', commanders: [krenko] }))!.deck.id!;
    const linked = await send<{ box: BoxInfo }>(one.PUT, 'PUT', `/api/collection/boxes/${id}`, { deckId }, id);
    expect(linked.data.box.deckId).toBe(deckId);
    expect((await send<{ box: BoxInfo }>(one.PUT, 'PUT', `/api/collection/boxes/${id}`, { deckId: null }, id)).data.box.deckId).toBeNull();
    expect((await send(one.PUT, 'PUT', `/api/collection/boxes/${id}`, { deckId: 'nope' }, id)).status).toBe(404);
    expect((await send(one.PUT, 'PUT', `/api/collection/boxes/${id}`, {}, id)).status).toBe(400);

    expect((await send(one.DELETE, 'DELETE', `/api/collection/boxes/${id}?mode=lost`, undefined, id)).status).toBe(400);
    expect((await send(one.DELETE, 'DELETE', `/api/collection/boxes/${id}`, undefined, id)).status).toBe(400);
    const opened = await send<{ deckId: string }>(asDeck.POST, 'POST', `/api/collection/boxes/${id}/deck`, undefined, id);
    expect(opened.status).toBe(201);
    expect(getDeck(opened.data.deckId)!.deck.built).toBe(true);
    expect((await send(asDeck.POST, 'POST', `/api/collection/boxes/${id}/deck`, undefined, id)).status).toBe(404);

    const sold = (await send<{ box: BoxInfo }>(boxes.POST, 'POST', '/api/collection/boxes', { productId: PRODUCT })).data.box.id;
    expect((await send(one.DELETE, 'DELETE', `/api/collection/boxes/${sold}?mode=sold`, undefined, sold)).status).toBe(200);
    expect(total(forest)).toBe(4);
    expect((await send(one.DELETE, 'DELETE', `/api/collection/boxes/${sold}?mode=opened`, undefined, sold)).status).toBe(404);

    await send(boxes.POST, 'POST', '/api/collection/boxes', { productId: PRODUCT });
    setActiveCollection('arena');
    expect((await send(boxes.POST, 'POST', '/api/collection/boxes', { productId: PRODUCT })).status).toBe(400);
    expect((await send<BoxesResponse>(boxes.GET, 'GET', '/api/collection/boxes')).data.boxes).toEqual([]);
  });

  it('the collection reports boxed copies, and PATCH takes from and puts back into boxes', async () => {
    const collection = await import('@/app/api/collection/route');
    const collections = await import('@/app/api/collections/route');
    adjustCollection(solRing, 1);
    const box = addBox(PRODUCT);

    const got = await send<CollectionResponse>(collection.GET, 'GET', '/api/collection');
    expect(got.data.cards.find((c) => c.oracleId === solRing)).toMatchObject({ qty: 2, inBoxes: 1 });
    expect(got.data.cards.find((c) => c.oracleId === forest)).toMatchObject({ qty: 4, inBoxes: 4 });
    const physical = (await send<CollectionsResponse>(collections.GET, 'GET', '/api/collections')).data.collections.find((c) => c.id === 'physical');
    expect(physical?.holders).toBe(1);

    await send(collection.PATCH, 'PATCH', '/api/collection', { oracleId: solRing, delta: -1 });
    const out = await send<CollectionAdjustResponse>(collection.PATCH, 'PATCH', '/api/collection', { oracleId: solRing, delta: -1 });
    expect(out.data).toMatchObject({ qty: 0, fromBoxes: [{ boxId: box.id, name: 'Landing Party', qty: 1 }] });
    const back = await send<CollectionAdjustResponse>(collection.PATCH, 'PATCH', '/api/collection', { oracleId: solRing, delta: 1, toBoxes: out.data.fromBoxes });
    expect(back.status).toBe(200);
    expect(back.data).toMatchObject({ qty: 1, fromBoxes: [] });
    expect(sealedOf(box.id, solRing)).toBe(1);

    const bad = async (body: unknown) => (await send(collection.PATCH, 'PATCH', '/api/collection', body)).status;
    expect(await bad({ oracleId: solRing, delta: -1, toBoxes: [{ boxId: box.id, qty: 1 }] })).toBe(400);
    expect(await bad({ oracleId: solRing, delta: 1, toBoxes: 'box' })).toBe(400);
    expect(await bad({ oracleId: solRing, delta: 1, toBoxes: [{ boxId: box.id, qty: 0 }] })).toBe(400);
    expect(await bad({ oracleId: solRing, delta: 1, toBoxes: [{ qty: 1 }] })).toBe(400);
  });
});
