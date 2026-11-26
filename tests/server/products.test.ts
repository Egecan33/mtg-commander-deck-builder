import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { setCollectionCards } from '@/server/collection';
import { listProducts, productDetail, searchProducts } from '@/server/products';
import type { ParsedProduct } from '@/ingest/products';
import { type Db } from '@/server/db';
import { oracleIdByName, storeTestProducts } from './products-fixture';
import { seedDb, useServerDb } from './server-db';

let db: Db;
beforeEach(() => {
  db = seedDb();
  useServerDb(db);
  storeTestProducts(db);
});
afterAll(() => useServerDb(null));

describe('listProducts', () => {
  it('hides digital products', () => {
    const ids = listProducts('', 200).map((p) => p.id);
    expect(ids).not.toContain('Filler_0');
    expect(ids).not.toContain('Filler_1');
    expect(ids).toContain('Filler_2');
  });

  it('finds by name and by set code', () => {
    expect(listProducts('landing').map((p) => p.id)).toEqual(['LandingParty_TRC']);
    expect(listProducts('trc').map((p) => p.id)).toEqual(['LandingParty_TRC']);
    expect(listProducts('tr')).toEqual([]);
  });

  it('puts the newest release first and sums quantities', () => {
    const all = listProducts('', 5);
    expect(all[0]).toEqual({ id: 'LandingParty_TRC', name: 'Landing Party', setCode: 'TRC', type: 'Commander Deck', releaseDate: '2026-11-13', cardCount: 9 });
    expect(all[1].releaseDate).toBe('2000-01-01');
  });

  it('clamps the limit', () => {
    expect(listProducts('', 5)).toHaveLength(5);
    expect(listProducts('', 9999).length).toBeLessThanOrEqual(200);
    expect(listProducts('')).toHaveLength(50);
  });
});

describe('productDetail', () => {
  it('is null for an unknown id', () => {
    expect(productDetail('nope')).toBeNull();
  });

  it('lists the cards with commander flags and a lookup', () => {
    const d = productDetail('LandingParty_TRC')!;
    expect(d.product.cardCount).toBe(9);
    const krenko = oracleIdByName(db, 'Krenko, Mob Boss');
    expect(d.cards.find((c) => c.oracleId === krenko)).toMatchObject({ qty: 1, commander: true, ownedQty: 0 });
    expect(d.cards).toHaveLength(6);
    expect(d.lookup[krenko].name).toBe('Krenko, Mob Boss');
  });

  it('reports owned quantities from the active collection', () => {
    const sol = oracleIdByName(db, 'Sol Ring');
    setCollectionCards('physical', new Map([[sol, 2]]));
    const d = productDetail('LandingParty_TRC')!;
    expect(d.cards.find((c) => c.oracleId === sol)!.ownedQty).toBe(2);
  });
});

describe('smart product search', () => {
  const decks = ['Aang Tutorial', 'Zuko Tutorial', 'Firebending', 'Waterbending'];
  const family = (db0: Db): ParsedProduct[] => [
    ...decks.map((d) => ({
      id: `BeginnerBox${d.replace(/ /g, '')}_TLA`, name: `Beginner Box - ${d}`, setCode: 'TLA', type: 'Box Set', releaseDate: '2025-11-21',
      cards: [{ oracleId: oracleIdByName(db0, 'Sol Ring'), qty: 1, commander: false }], unknownCards: 0,
    })),
    {
      id: 'TheBlackSunInvasion_TLA', name: 'The Black Sun Invasion', setCode: 'TLA', type: 'Box Set', releaseDate: '2025-11-21',
      cards: [{ oracleId: oracleIdByName(db0, 'Sol Ring'), qty: 1, commander: false }], unknownCards: 0,
    },
  ];
  beforeEach(() => {
    storeTestProducts(db, family(db));
    db.prepare('INSERT INTO sets(code, name, set_type, released_at) VALUES (?, ?, ?, ?)').run('tla', 'Avatar: The Last Airbender', 'expansion', '2025-11-21');
  });

  it('finds the Beginner Box family through the set name, with a typo, in any word order', () => {
    for (const q of ['avatar begginer box', 'avatar beginner box', 'beginner box avatar', 'AVATAR: beginner-box']) {
      const found = listProducts(q);
      expect(found.map((p) => p.id).sort(), q).toEqual(decks.map((d) => `BeginnerBox${d.replace(/ /g, '')}_TLA`).sort());
    }
    expect(listProducts('avatar begginer box').slice(0, 4).every((p) => p.name.startsWith('Beginner Box - '))).toBe(true);
  });

  it('lists a set by its set name and keeps set codes whole', () => {
    expect(listProducts('avatar').map((p) => p.setCode)).toEqual(Array(5).fill('TLA'));
    expect(listProducts('tla')).toHaveLength(5);
    expect(listProducts('tl')).toEqual([]);
  });

  it('groups decks sharing a "Prefix - Suffix" name in one set, with every deck of the group', () => {
    const { groups, sets } = searchProducts('aang');
    expect(sets).toEqual({ TLA: 'Avatar: The Last Airbender' });
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ key: 'tla|beginner box', setCode: 'TLA', prefix: 'Beginner Box', label: 'Avatar: The Last Airbender \u2014 Beginner Box', cardCount: 4 });
    expect(groups[0].products.map((p) => p.name)).toEqual(decks.map((d) => `Beginner Box - ${d}`).sort());
    expect(searchProducts('landing').groups).toEqual([]);
  });

  it('falls back to the set code when the sets table is empty', () => {
    db.exec('DELETE FROM sets');
    expect(searchProducts('begginer').groups[0]).toMatchObject({ setName: 'TLA', label: 'TLA \u2014 Beginner Box' });
    expect(listProducts('avatar')).toEqual([]);
  });
});
