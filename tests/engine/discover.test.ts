import { describe, expect, it } from 'vitest';
import { buyTiers, buysOf, eagerTiers, preScore } from '@/engine/builder';
import { isBasicLand, validateDeck } from '@/engine/rules';
import type { Card, Deck, EngineContext } from '@/engine/types';
import { card, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const size = (d: Deck) => d.commanders.length + d.main.reduce((n, e) => n + e.qty, 0);

describe('best from collection', () => {
  it('pre-score puts a commander whose colours the collection holds above one it does not', () => {
    // A green-black collection: everything Lathril can run among the more played cards.
    const lathril = card('Lathril, Blade of the Elves');
    const owned: Card[] = db.all().filter((c) => c.colorIdentity.length > 0 && c.colorIdentity.every((k) => k === 'B' || k === 'G')).slice(0, 150);
    expect(owned.length).toBeGreaterThan(60);
    expect(preScore(lathril, owned, ctx, 3)).toBeGreaterThan(preScore(card('Talrand, Sky Summoner'), owned, ctx, 3) + 500);
    expect(preScore(lathril, owned, ctx, 3)).toBeGreaterThan(preScore(card('Krenko, Mob Boss'), owned, ctx, 3) + 500);
  });

  it('tier decks are legal 100-card decks and tier N buys at most N cards', () => {
    const lathril = card('Lathril, Blade of the Elves').oracleId;
    const owned = new Set([lathril, ...db.all().filter((c) => c.colorIdentity.every((k) => k === 'B' || k === 'G')).filter((_, i) => i % 3 !== 0).map((c) => c.oracleId)]);
    const eager = eagerTiers(lathril, ctx, owned, 3);
    expect(eager.owned.buys).toEqual([]);
    const tiers = buyTiers(eager.owned.deck, ctx, owned, [0, 5, 10]);
    for (const t of [eager.owned, eager.unlimited, ...tiers]) {
      expect(validateDeck(t.deck, db)).toEqual([]);
      expect(size(t.deck)).toBe(100);
      const notOwned = t.deck.main.filter((e) => !owned.has(e.oracleId) && !isBasicLand(db.get(e.oracleId)!)).length;
      expect(notOwned).toBe(t.buys.length);
      if (t.cap !== null) expect(notOwned).toBeLessThanOrEqual(t.cap);
      expect(buysOf(t.deck, owned, db)).toEqual(t.buys);
    }
    expect(tiers[2].rating).toBeGreaterThanOrEqual(tiers[0].rating);
  });
});
