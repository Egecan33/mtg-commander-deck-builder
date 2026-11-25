import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { setCollectionCards } from '@/server/collection';
import { listProducts, productDetail } from '@/server/products';
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
