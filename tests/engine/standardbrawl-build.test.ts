import { beforeAll, describe, expect, it } from 'vitest';
import { addOne, autoBuild, fillRest, fixDeck, improveDeck, suggestSwaps } from '@/engine/builder';
import { deckSize, validateDeck } from '@/engine/rules';
import { rateDeck } from '@/engine/rating';
import type { BuildOptions, Deck } from '@/engine/types';
import { card, standardBrawlFixtureDb } from '../helpers/fixture-db';
import { ctxOf, redDeck } from '../helpers/standard-brawl';

const db = standardBrawlFixtureDb();
const ctx = ctxOf(db);
const shell = (name = 'Krenko, Mob Boss'): Deck => ({
  id: null, name: 't', commanders: [card(name).oracleId], companion: null, chosenColor: null, main: [], targetBracket: 3, themeWeights: null,
});
const opts = (extra: Partial<BuildOptions> = {}): BuildOptions => ({ ownedOnly: false, owned: new Set(), maxPriceUsd: null, seed: 7, ...extra });
const landsOf = (d: Deck) => d.main.reduce((n, e) => n + (/\bLand\b/.test(db.get(e.oracleId)?.typeLine ?? '') ? e.qty : 0), 0);

let built: Deck;
beforeAll(() => {
  built = autoBuild(shell(), ctx, opts());
});

describe('Standard Brawl builds', () => {
  it('builds a legal 60-card deck from the fixture pool, Standard Brawl cards only', () => {
    expect(deckSize(built)).toBe(60);
    expect(validateDeck(built, db)).toEqual([]);
    const ids = [...built.commanders, ...built.main.map((e) => e.oracleId)];
    expect(ids.every((id) => db.get(id)?.standardBrawlLegality === 'legal')).toBe(true);
  });

  it('plays about 22-26 lands, not a 100-card deck land count', () => {
    expect(landsOf(built)).toBeGreaterThanOrEqual(20);
    expect(landsOf(built)).toBeLessThanOrEqual(28);
  });

  it('builds a different, still legal deck for another commander', () => {
    const rok = autoBuild(shell('Rok-Tahk, Budding Scientist'), ctx, opts({ seed: 3 }));
    expect(deckSize(rok)).toBe(60);
    expect(validateDeck(rok, db)).toEqual([]);
  });

  it('fills a half-built deck to 60', () => {
    const half: Deck = { ...built, main: built.main.slice(0, 20) };
    const filled = fillRest(half, ctx, opts());
    expect(deckSize(filled)).toBe(60);
    expect(validateDeck(filled, db)).toEqual([]);
  });

  it('suggests, improves and adds only legal cards without growing the deck past 60', () => {
    const legal = (id: string) => db.get(id)?.standardBrawlLegality === 'legal';
    for (const p of [...suggestSwaps(built, ctx, opts(), 5), ...improveDeck(built, ctx, opts(), 6), ...addOne(built, ctx, opts(), 'ramp', 4)]) {
      if (p.in) expect(legal(p.in)).toBe(true);
    }
    expect(addOne(built, ctx, opts(), 'ramp', 4).every((p) => p.out !== '')).toBe(true);
  });
});

describe('Fix deck in Standard Brawl', () => {
  it('cuts an over-sized deck down to 60 and says so', () => {
    const big = redDeck(db, 75);
    expect(validateDeck(big, db).map((v) => v.code)).toContain('size');
    const r = fixDeck(big, ctx, opts());
    expect(deckSize(r.deck)).toBe(60);
    expect(validateDeck(r.deck, db)).toEqual([]);
    const cuts = r.changes.filter((c) => /down to 60/.test(c.reason));
    expect(cuts.length).toBe(15);
    expect(cuts.every((c) => c.in === '' && c.summary === 'Cuts the deck down to 60')).toBe(true);
  });

  it('fills an under-sized deck to 60', () => {
    const small = redDeck(db, 40);
    const r = fixDeck(small, ctx, opts());
    expect(deckSize(r.deck)).toBe(60);
    expect(r.changes.some((c) => /Fills the deck to 60/.test(c.reason))).toBe(true);
    expect(rateDeck(r.deck, ctx).complete).toBe(true);
  });

  it('does not touch a legal 60-card deck for size', () => {
    const ok = redDeck(db);
    const r = fixDeck(ok, ctx, opts());
    expect(deckSize(r.deck)).toBe(60);
    expect(r.changes.every((c) => !/to 60/.test(c.reason))).toBe(true);
  });
});
