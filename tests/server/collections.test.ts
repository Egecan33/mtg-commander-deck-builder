import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  adjustCollection, collectionCsv, listCollections, ownedQuantities, ownedSet, replaceCollection,
  setActiveCollection, setCollectionCards,
} from '@/server/collection';
import { openDb, type Db } from '@/server/db';
import { getCardDb } from '@/server/store';
import { seedDb, useServerDb } from './server-db';

const tmp = mkdtempSync(path.join(tmpdir(), 'cf-collections-'));
afterAll(() => {
  useServerDb(null);
  rmSync(tmp, { recursive: true, force: true });
});

const rows = (db: Db, id: string) =>
  db.prepare('SELECT oracle_id AS oracleId, qty FROM collection_cards WHERE collection_id = ? ORDER BY oracle_id').all(id) as { oracleId: string; qty: number }[];

describe('migration from the single collection', () => {
  it('moves the old collection into "Physical", keeps every quantity and leaves decks alone', () => {
    const file = path.join(tmp, 'legacy.db');
    const legacy = new Database(file);
    legacy.exec(`
      CREATE TABLE collection (oracle_id TEXT PRIMARY KEY, qty INTEGER NOT NULL);
      CREATE TABLE decks (id TEXT PRIMARY KEY, name TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
      INSERT INTO collection VALUES ('aaa', 1), ('bbb', 4), ('ccc', 17);
      INSERT INTO decks VALUES ('d1', 'My deck', '{"cards":[]}', '2026-11-01T00:00:00.000Z');
    `);
    legacy.close();

    const db = openDb(file);
    expect(rows(db, 'physical')).toEqual([{ oracleId: 'aaa', qty: 1 }, { oracleId: 'bbb', qty: 4 }, { oracleId: 'ccc', qty: 17 }]);
    expect(rows(db, 'arena')).toEqual([]);
    expect(db.prepare('SELECT id, name, kind FROM collections ORDER BY position').all()).toEqual([
      { id: 'physical', name: 'Physical', kind: 'manual' },
      { id: 'arena', name: 'MTG Arena', kind: 'arena' },
    ]);
    expect(db.prepare('SELECT * FROM decks').all()).toEqual([{ id: 'd1', name: 'My deck', json: '{"cards":[]}', updated_at: '2026-11-01T00:00:00.000Z' }]);
    db.close();
  });

  it('runs once: later changes to Physical are not overwritten by the old table on the next start', () => {
    const file = path.join(tmp, 'legacy-twice.db');
    const legacy = new Database(file);
    legacy.exec(`CREATE TABLE collection (oracle_id TEXT PRIMARY KEY, qty INTEGER NOT NULL); INSERT INTO collection VALUES ('aaa', 2);`);
    legacy.close();

    let db = openDb(file);
    db.prepare("UPDATE collection_cards SET qty = 9 WHERE collection_id = 'physical' AND oracle_id = 'aaa'").run();
    db.prepare("INSERT INTO collection_cards(collection_id, oracle_id, qty) VALUES ('arena', 'zzz', 3)").run();
    db.close();
    db = openDb(file);
    expect(rows(db, 'physical')).toEqual([{ oracleId: 'aaa', qty: 9 }]);
    expect(rows(db, 'arena')).toEqual([{ oracleId: 'zzz', qty: 3 }]);
    db.close();
  });

  it('gives a new database both collections, empty, with Physical active', () => {
    useServerDb(openDb(':memory:'));
    expect(listCollections()).toEqual([
      { id: 'physical', name: 'Physical', kind: 'manual', count: 0, totalQty: 0, active: true, syncedAt: null, holders: 0 },
      { id: 'arena', name: 'MTG Arena', kind: 'arena', count: 0, totalQty: 0, active: false, syncedAt: null, holders: 0 },
    ]);
  });
});

describe('several collections', () => {
  let solRing: string;
  let arcaneSignet: string;
  let commandTower: string;
  beforeEach(() => {
    useServerDb(seedDb());
    const id = (name: string) => getCardDb().byName(name)!.oracleId;
    solRing = id('Sol Ring');
    arcaneSignet = id('Arcane Signet');
    commandTower = id('Command Tower');
  });

  it('keeps each collection apart: imports and edits go to the active one only', () => {
    replaceCollection('2 Sol Ring\n1 Arcane Signet');
    setActiveCollection('arena');
    expect(ownedSet().size).toBe(0);
    replaceCollection('4 Command Tower');
    adjustCollection(solRing, 1);
    expect([...ownedQuantities()].sort()).toEqual([[commandTower, 4], [solRing, 1]].sort());

    setActiveCollection('physical');
    expect([...ownedQuantities()].sort()).toEqual([[solRing, 2], [arcaneSignet, 1]].sort());
    expect(listCollections().map((c) => [c.id, c.count, c.totalQty, c.active])).toEqual([
      ['physical', 2, 3, true],
      ['arena', 2, 5, false],
    ]);
  });

  it('remembers the active collection across restarts', () => {
    const file = path.join(tmp, 'active.db');
    useServerDb(openDb(file));
    setActiveCollection('arena');
    useServerDb(openDb(file));
    expect(listCollections().find((c) => c.active)?.id).toBe('arena');
  });

  it('refuses to switch to a collection that does not exist', () => {
    expect(() => setActiveCollection('nope')).toThrow(/no collection/i);
    expect(listCollections().find((c) => c.active)?.id).toBe('physical');
  });

  it('replaces one collection from a sync without touching the active one', () => {
    replaceCollection('2 Sol Ring');
    setCollectionCards('arena', new Map([[commandTower, 4], [arcaneSignet, 0]]), '2026-11-22T10:00:00.000Z');
    expect([...ownedQuantities()]).toEqual([[solRing, 2]]);
    const arena = listCollections().find((c) => c.id === 'arena')!;
    expect(arena).toMatchObject({ count: 1, totalQty: 4, syncedAt: '2026-11-22T10:00:00.000Z' });
  });

  it('exports a collection as a CSV that imports back to the same cards and quantities', () => {
    replaceCollection('3 Sol Ring\n1 Arcane Signet\n1 Fire // Ice');
    const before = [...ownedQuantities()].sort();
    const csv = collectionCsv('physical');
    expect(csv.split('\n')[0]).toBe('Name,Quantity');
    replaceCollection('');
    expect(ownedSet().size).toBe(0);
    expect(replaceCollection(csv).unresolved).toEqual([]);
    expect([...ownedQuantities()].sort()).toEqual(before);
  });
});

describe('collection routes', () => {
  const send = async <T>(handler: (req: Request) => Response | Promise<Response>, method: string, url: string, body?: unknown): Promise<{ status: number; data: T; res: Response }> => {
    const res = await handler(new Request(`http://localhost:3210${url}`, {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    }));
    const text = await res.clone().text();
    let data: unknown = text;
    try { data = JSON.parse(text); } catch { /* a CSV */ }
    return { status: res.status, data: data as T, res };
  };

  beforeEach(() => useServerDb(seedDb()));

  it('switching the active collection changes what the owned filter and owned-only builds use', async () => {
    const collections = await import('@/app/api/collections/route');
    const collection = await import('@/app/api/collection/route');
    const cards = await import('@/app/api/cards/route');
    const build = await import('@/app/api/build/route');
    const { isBasicLand } = await import('@/engine/rules');
    const cdb = getCardDb();
    const deck = {
      id: null, name: 'Test', commanders: [cdb.byName('Krenko, Mob Boss')!.oracleId], companion: null, chosenColor: null, main: [], targetBracket: 3, themeWeights: null,
    };
    const ownedNames = async () =>
      (await send<{ cards: { name: string }[] }>(cards.POST, 'POST', '/api/cards', { deck, filters: { owned: true }, pageSize: 200 })).data.cards.map((c) => c.name).sort();
    const builtFrom = async () => {
      const r = await send<{ deck: { main: { oracleId: string }[] } }>(build.POST, 'POST', '/api/build', { deck, mode: 'auto', options: { ownedOnly: true, seed: 3 } });
      return r.data.deck.main.map((e) => cdb.get(e.oracleId)!).filter((c) => !isBasicLand(c)).map((c) => c.name).sort();
    };

    await send(collection.POST, 'POST', '/api/collection', { text: "1 Sol Ring\n1 Dragonlord's Servant" });
    expect((await send<{ collections: { id: string; active: boolean }[] }>(collections.PUT, 'PUT', '/api/collections', { active: 'arena' })).data.collections.find((c) => c.active)?.id).toBe('arena');
    await send(collection.POST, 'POST', '/api/collection', { text: '1 Arcane Signet\n1 Lightning Bolt' });
    expect(await ownedNames()).toEqual(['Arcane Signet', 'Lightning Bolt']);
    expect(await builtFrom()).toEqual(['Arcane Signet', 'Lightning Bolt']);

    await send(collections.PUT, 'PUT', '/api/collections', { active: 'physical' });
    expect(await ownedNames()).toEqual(["Dragonlord's Servant", 'Sol Ring']);
    expect(await builtFrom()).toEqual(["Dragonlord's Servant", 'Sol Ring']);

    expect((await send(collections.PUT, 'PUT', '/api/collections', { active: 'nope' })).status).toBe(400);
    expect((await send(collections.PUT, 'PUT', '/api/collections', {})).status).toBe(400);
  });

  it('keeps swap, improve, add-one and replace suggestions inside the active collection when asked to', async () => {
    const collections = await import('@/app/api/collections/route');
    const build = await import('@/app/api/build/route');
    const cdb = getCardDb();
    const lathril = cdb.byName('Lathril, Blade of the Elves')!.oracleId;
    const shell = { id: null, name: 'T', commanders: [lathril], companion: null, chosenColor: null, main: [], targetBracket: 3, themeWeights: null };
    const built = (await send<{ deck: { main: { oracleId: string }[] } }>(build.POST, 'POST', '/api/build', { deck: shell, mode: 'auto', options: { seed: 1 } })).data.deck;
    // The Arena collection: 40 green or black cards the deck does not run.
    const inDeck = new Set(built.main.map((e) => e.oracleId));
    const spare = cdb.all().filter((c) => c.legality === 'legal' && !inDeck.has(c.oracleId) && c.oracleId !== lathril && c.colorIdentity.every((x) => x === 'G' || x === 'B')).slice(0, 40);
    await send(collections.PUT, 'PUT', '/api/collections', { active: 'arena' });
    replaceCollection(spare.map((c) => `1 ${c.name}`).join('\n'));
    const owned = new Set(spare.map((c) => c.oracleId));

    const ins = async (mode: string, options: Record<string, unknown>) =>
      (await send<{ proposals: { in: string }[] }>(build.POST, 'POST', '/api/build', { deck: built, mode, options: { ownedOnly: true, ...options } })).data.proposals.map((p) => p.in);
    const out = built.main.find((e) => !cdb.get(e.oracleId)!.typeLine.includes('Land'))!.oracleId;
    for (const [mode, options] of [['swaps', { count: 8 }], ['improve', {}], ['add', { role: 'ramp' }], ['replace', { out }]] as const) {
      const got = await ins(mode, options);
      for (const id of got) expect(owned.has(id), `${mode}: ${cdb.get(id)?.name}`).toBe(true);
    }
    // Without the limit the same deck is offered cards from outside the collection.
    const free = (await send<{ proposals: { in: string }[] }>(build.POST, 'POST', '/api/build', { deck: built, mode: 'replace', options: { out } })).data.proposals.map((p) => p.in);
    expect(free.some((id) => !owned.has(id))).toBe(true);
  }, 60_000);

  it('downloads the active or a named collection as CSV', async () => {
    const route = await import('@/app/api/collection/export/route');
    replaceCollection('2 Sol Ring');
    const active = await send<string>(route.GET, 'GET', '/api/collection/export');
    expect(active.data).toBe('Name,Quantity\nSol Ring,2\n');
    expect(active.res.headers.get('Content-Disposition')).toMatch(/attachment; filename="commander-forge-physical-collection-\d{4}-\d\d-\d\d\.csv"/);
    expect((await send<string>(route.GET, 'GET', '/api/collection/export?id=arena')).data).toBe('Name,Quantity\n');
    expect((await send(route.GET, 'GET', '/api/collection/export?id=nope')).status).toBe(404);
  });
});
