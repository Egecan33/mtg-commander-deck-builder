import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { browseCards, browseCommanders, findCardIds } from '@/server/browse';
import { sanitizeDeck } from '@/server/decks';
import type { Db } from '@/server/db';
import { oracleIdByName } from './products-fixture';
import { seedDb, useServerDb } from './server-db';

let db: Db;
beforeEach(() => {
  db = seedDb();
  useServerDb(db);
});
afterAll(() => useServerDb(null));

const deck = () => sanitizeDeck({ name: 'Search', commanders: [], targetBracket: 3, main: [] });
const names = (q: string, extra: Record<string, unknown> = {}) => browseCards(deck(), { q, pageSize: 20, ...extra }).cards.map((c) => c.name);

describe('card search', () => {
  it('forgives a typo and finds names through punctuation and word order', () => {
    expect(names('thassas oracle')[0]).toBe("Thassa's Oracle");
    expect(names('thasa oracel')[0]).toBe("Thassa's Oracle");
    expect(names('mob boss krenko')[0]).toBe('Krenko, Mob Boss');
    expect(names('lim dul')[0]).toBe("Lim-Dûl's Vault");
    expect(names('krenco')).toContain('Krenko, Mob Boss');
    expect(names('qzxjvwq')).toEqual([]);
  });

  it('ranks a name hit above a text hit, and an exact name first', () => {
    const found = names('sol ring');
    expect(found[0]).toBe('Sol Ring');
    expect(browseCards(deck(), { q: 'sol ring' }).total).toBeGreaterThan(0);
  });

  it('still searches type and rules text', () => {
    const total = browseCards(deck(), { q: 'legendary creature goblin' }).total;
    expect(total).toBeGreaterThan(0);
    expect(names('legendary creature goblin')).toContain('Krenko, Mob Boss');
  });

  it('finds commanders with a typo', () => {
    const res = browseCommanders(new URLSearchParams({ q: 'krenco mob bos' }));
    expect(res.commanders.map((c) => c.name)).toContain('Krenko, Mob Boss');
  });

  it('finds cards among a list of ids for Find in deck', () => {
    const ids = ['Krenko, Mob Boss', 'Sol Ring', "Thassa's Oracle", 'Forest'].map((n) => oracleIdByName(db, n));
    expect(findCardIds(ids, 'thassas oracle')).toEqual([ids[2]]);
    expect(findCardIds(ids, 'goblin').includes(ids[0])).toBe(true);
    expect(findCardIds(ids, 'basic land')).toEqual([ids[3]]);
    expect(findCardIds(ids, '')).toEqual(ids);
    expect(findCardIds([...ids, 'unknown-id'], 'sol')).toEqual([ids[1]]);
  });
});
