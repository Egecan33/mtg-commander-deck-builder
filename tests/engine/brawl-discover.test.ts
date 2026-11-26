import { describe, expect, it } from 'vitest';
import { discoverCandidates, wildcardTiers } from '@/engine/builder';
import { isBasicLand } from '@/engine/rules';
import type { Deck, EngineContext, Wildcards } from '@/engine/types';
import { wildcardsNeeded } from '@/engine/wildcards';
import { brawlFixtureDb, card, fixtureDb } from '../helpers/fixture-db';

const db = brawlFixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const COMMANDER = 'Lathril, Blade of the Elves';
const bg = db.all().filter((c) => c.colorIdentity.every((k) => k === 'B' || k === 'G'));
const owned = new Set([card(COMMANDER).oracleId, ...bg.filter((c) => c.arenaRarity === 'common' || c.arenaRarity === 'uncommon').map((c) => c.oracleId)]);
const have: Wildcards = { common: 10, uncommon: 6, rare: 3, mythic: 0 };
const ids = (deck: Deck) => [...deck.commanders, ...deck.main.map((e) => e.oracleId)];

describe('Best from collection on the Arena collection', () => {
  it('ranks Brawl commanders: planeswalkers in, cards missing from Arena out', () => {
    const brawl = discoverCandidates(db, owned, false).map((c) => c.name);
    expect(brawl).toContain('Tyvar Kell');
    expect(brawl).toContain(COMMANDER);
    expect(brawl.every((n) => (card(n).arenaRarity ?? null) !== null)).toBe(true);
    expect(discoverCandidates(fixtureDb(), owned, false).map((c) => c.name)).not.toContain('Tyvar Kell');
  });

  it('gives an owned-only tier, a tier within the wildcards and the whole Arena pool with the wildcards it needs', () => {
    const t = wildcardTiers(card(COMMANDER).oracleId, ctx, owned, 3, have);
    expect(t.owned.kind).toBe('owned');
    expect(t.owned.buys).toEqual([]);
    expect(t.crafted.kind).toBe('crafted');
    expect(t.unlimited.kind).toBe('unlimited');
    for (const tier of [t.owned, t.crafted, t.unlimited]) {
      expect(ids(tier.deck).every((id) => (db.get(id)?.arenaRarity ?? null) !== null)).toBe(true);
      expect(tier.wildcards).toEqual(wildcardsNeeded(tier.deck, db, owned));
      expect(tier.buys.length).toBe(Object.values(tier.wildcards!).reduce((a, b) => a + b, 0));
    }
    for (const r of ['common', 'uncommon', 'rare', 'mythic'] as const) expect(t.crafted.wildcards![r], r).toBeLessThanOrEqual(have[r]);
    // More room never rates lower: owned only <= within the wildcards <= the whole Arena pool.
    expect(t.crafted.rating).toBeGreaterThanOrEqual(t.owned.rating);
    expect(t.unlimited.rating).toBeGreaterThanOrEqual(t.crafted.rating);
    expect(t.crafted.buys.every((id) => !isBasicLand(db.get(id)!))).toBe(true);
    expect(t.unlimited.wildcards!.mythic).toBeGreaterThan(0);
  });

  it('never rates a looser tier below a tighter one, for any commander or budget', () => {
    const tight: Wildcards = { common: 2, uncommon: 1, rare: 1, mythic: 0 };
    const names = ['Tyvar Kell', 'Kutzil, Malamet Exemplar', 'Azusa, Lost but Seeking', 'Gyruda, Doom of Depths', 'Obosh, the Preypiercer', COMMANDER];
    for (const name of names) {
      const c = card(name);
      const mine = new Set([c.oracleId, ...db.all().filter((x) => x.colorIdentity.every((k) => c.colorIdentity.includes(k)) && x.arenaRarity === 'common').map((x) => x.oracleId)]);
      for (const budget of [tight, have]) {
        const t = wildcardTiers(c.oracleId, ctx, mine, 3, budget);
        expect(t.crafted.rating, `${name} crafted`).toBeGreaterThanOrEqual(t.owned.rating);
        expect(t.unlimited.rating, `${name} unlimited`).toBeGreaterThanOrEqual(t.crafted.rating);
        // A tie spends nothing: the looser tier is then the tighter tier's deck.
        if (t.crafted.rating === t.owned.rating) expect(t.crafted.buys, `${name} crafted tie`).toEqual(t.owned.buys);
        if (t.unlimited.rating === t.crafted.rating) expect(t.unlimited.buys, `${name} unlimited tie`).toEqual(t.crafted.buys);
      }
    }
  }, 120_000);
});
