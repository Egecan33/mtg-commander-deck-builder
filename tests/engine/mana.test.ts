import { describe, expect, it } from 'vitest';
import { cardSourceNeeds, karstenSources, landTarget, pAtLeast, sourcesNeeded } from '@/engine/mana';
import { card, fixtureDb } from '../helpers/fixture-db';

describe('sourcesNeeded: what a Commander deck needs to cast a card when it is usually cast', () => {
  const roomy = { lands: 99, colours: 1 }; // no cap in the way

  it('an early play is held to the on-curve table; anything else to the table two turns later', () => {
    expect(sourcesNeeded({ pips: 1, mv: 1, early: true, ...roomy })).toBe(19);
    expect(sourcesNeeded({ pips: 1, mv: 1, ...roomy })).toBe(18); // column 0 + 2
    expect(sourcesNeeded({ pips: 2, mv: 2, early: true, ...roomy })).toBe(30);
    expect(sourcesNeeded({ pips: 2, mv: 2, ...roomy })).toBe(26);
    expect(sourcesNeeded({ pips: 3, mv: 3, ...roomy })).toBe(30);
    expect(sourcesNeeded({ pips: 2, mv: 6, ...roomy })).toBe(20); // past the end of the row: its last column
    // Hybrid or X-heavy costs with more pips than mana value still move two columns.
    expect(sourcesNeeded({ pips: 2, mv: 1, ...roomy })).toBe(26);
  });

  it('{X} in the cost reads as 2 generic mana', () => {
    expect(sourcesNeeded({ pips: 3, mv: 3, x: true, early: true, ...roomy })).toBe(30); // {X}{U}{U}{U} on curve
    expect(sourcesNeeded({ pips: 3, mv: 3, x: true, ...roomy })).toBe(26);              // Whir of Invention
    expect(sourcesNeeded({ pips: 2, mv: 2, x: true, ...roomy })).toBe(22);              // Damnable Pact
  });

  it('no colour is asked for more than lands × its share of a deck of that many colours', () => {
    // Thassa's Oracle in a 37-land three-colour deck: 26 by the table, capped at 37 × 0.7.
    expect(sourcesNeeded({ pips: 2, mv: 2, lands: 37, colours: 3 })).toBeCloseTo(25.9, 10);
    expect(sourcesNeeded({ pips: 2, mv: 2, early: true, lands: 37, colours: 2 })).toBeCloseTo(30, 10); // 31.45 is no cap
    expect(sourcesNeeded({ pips: 2, mv: 2, early: true, lands: 37, colours: 4 })).toBeCloseTo(22.2, 10);
    expect(sourcesNeeded({ pips: 2, mv: 2, early: true, lands: 37, colours: 5 })).toBeCloseTo(20.35, 10);
    // A colourless or unknown identity reads as one colour; more than five as five.
    expect(sourcesNeeded({ pips: 3, mv: 3, early: true, lands: 30, colours: 0 })).toBe(30);
    expect(sourcesNeeded({ pips: 3, mv: 3, early: true, lands: 30, colours: 7 })).toBeCloseTo(16.5, 10);
    // No land count known: the table alone.
    expect(sourcesNeeded({ pips: 3, mv: 3, early: true, lands: Number.NaN, colours: 3 })).toBe(36);
    expect(sourcesNeeded({ pips: 0, mv: 3, lands: 37, colours: 3 })).toBe(0);
    // A card of a colour needs a source of it, however few lands the deck has.
    expect(sourcesNeeded({ pips: 1, mv: 1, lands: 0, colours: 1 })).toBe(1);
    expect(sourcesNeeded({ pips: 2, mv: 2, lands: 1, colours: 5 })).toBe(1);
  });

  it('a mono-colour deck is never short while its lands make the colour', () => {
    for (const lands of [16, 22, 28, 33, 37, 42]) {
      for (let pips = 1; pips <= 6; pips++) {
        for (let mv = 0; mv <= 10; mv++) {
          for (const early of [true, false]) {
            for (const x of [true, false]) {
              expect(sourcesNeeded({ pips, mv, early, x, lands, colours: 1 }), `${pips} pips, mv ${mv}`).toBeLessThanOrEqual(lands);
            }
          }
        }
      }
    }
    // Senator Peacock's 28 lands and Whir of Invention: 26, under the 28.25 blue sources it holds.
    expect(sourcesNeeded({ pips: 3, mv: 3, x: true, lands: 28, colours: 1 })).toBe(26);
  });

  it('Standard Brawl keeps its 0.73 of the 99-card table, after the delay and X columns, under the same cap', () => {
    expect(sourcesNeeded({ pips: 1, mv: 1, early: true, ...roomy, deckSize: 60 })).toBe(14);
    expect(sourcesNeeded({ pips: 1, mv: 1, ...roomy, deckSize: 60 })).toBe(13);         // round(18 × 0.73)
    expect(sourcesNeeded({ pips: 3, mv: 3, x: true, ...roomy, deckSize: 60 })).toBe(19); // round(26 × 0.73)
    expect(sourcesNeeded({ pips: 2, mv: 2, ...roomy, deckSize: 60 })).toBeLessThan(sourcesNeeded({ pips: 2, mv: 2, ...roomy }));
    expect(sourcesNeeded({ pips: 4, mv: 4, early: true, lands: 24, colours: 1, deckSize: 60 })).toBe(24);
    expect(sourcesNeeded({ pips: 2, mv: 2, early: true, lands: 24, colours: 2, deckSize: 60 })).toBeCloseTo(20.4, 10);
  });
});

describe('cardSourceNeeds: the per-colour needs of one card in one deck', () => {
  const db = fixtureDb();
  const needs = (name: string, commander = false, lands = 40, colours = 1) => {
    const c = card(name);
    return Object.fromEntries(cardSourceNeeds(c, db.features(c.oracleId)!, { commander, lands, colours }));
  };

  it('cheap ramp, removal and counterspells are cast on curve; other cards later', () => {
    expect(needs('Counterspell')).toEqual({ U: 30 });
    expect(needs('Swords to Plowshares')).toEqual({ W: 19 });
    expect(needs("Thassa's Oracle")).toEqual({ U: 26 });
    expect(needs('Cultivate')).toEqual({ G: 15 }); // ramp, but mana value 3
  });

  it('the commander is cast on curve', () => {
    expect(needs('Krenko, Mob Boss', true)).toEqual({ R: 26 });
    expect(needs('Krenko, Mob Boss')).toEqual({ R: 22 });
  });

  it('an {X} in the mana cost moves two columns, and colourless cards need nothing', () => {
    expect(needs('Chord of Calling')).toEqual({ G: 26 });
    expect(needs('Exsanguinate')).toEqual({ B: 22 });
    expect(needs('Sol Ring')).toEqual({});
  });

  it('caps each colour by the deck: lands × the share for the identity colour count', () => {
    expect(needs('Counterspell', false, 37, 3).U).toBeCloseTo(25.9, 10);
    expect(needs('Counterspell', false, 28, 1).U).toBe(28);
  });
});

describe('karstenSources', () => {
  it('matches the 99-card table', () => {
    expect(karstenSources(1, 1)).toBe(19);
    expect(karstenSources(2, 2)).toBe(30);
    expect(karstenSources(2, 4)).toBe(26);
    expect(karstenSources(3, 3)).toBe(36);
    expect(karstenSources(1, 6)).toBe(14);
    expect(karstenSources(4, 4)).toBe(39);
    expect(karstenSources(4, 5)).toBe(36);
  });
  it('returns 0 for no pips and clamps costs outside the table', () => {
    expect(karstenSources(0, 5)).toBe(0);
    expect(karstenSources(1, 12)).toBe(14);
    expect(karstenSources(6, 6)).toBe(39);
    expect(karstenSources(2, 1)).toBe(30); // more pips than mana value (hybrid, X): no generic
    expect(karstenSources(1, Number.NaN)).toBe(19);
  });
});

describe('landTarget', () => {
  it('follows the regression and bracket discounts', () => {
    expect(landTarget(3.0, 10, 2)).toBe(38);
    expect(landTarget(3.0, 10, 3)).toBe(37);
    expect(landTarget(3.0, 10, 4)).toBe(35);
  });
  it('respects floors and the cap', () => {
    expect(landTarget(1.5, 25, 1)).toBe(36);
    expect(landTarget(1.5, 25, 3)).toBe(35);
    expect(landTarget(1.5, 25, 4)).toBe(31);
    expect(landTarget(1.5, 25, 5)).toBe(26);
    expect(landTarget(6, 0, 1)).toBe(42);
    expect(landTarget(Number.NaN, Number.NaN, 2)).toBe(41);
  });
});

describe('pAtLeast', () => {
  it('gives the chance of two lands in an opening seven with 37 lands', () => {
    const p = pAtLeast(99, 37, 7, 2);
    expect(p).toBeGreaterThan(0.78);
    expect(p).toBeLessThan(0.84);
  });
  it('agrees with exact small cases', () => {
    expect(pAtLeast(10, 5, 1, 1)).toBeCloseTo(0.5, 10);
    expect(pAtLeast(4, 2, 2, 2)).toBeCloseTo(1 / 6, 10);
    expect(pAtLeast(4, 2, 2, 1)).toBeCloseTo(5 / 6, 10);
    expect(pAtLeast(5, 4, 3, 2)).toBeCloseTo(1, 10); // only one miss exists
  });
  it('never throws on degenerate input', () => {
    expect(pAtLeast(0, 0, 7, 1)).toBe(0);
    expect(pAtLeast(99, 37, 7, 0)).toBe(1);
    expect(pAtLeast(99, 37, 7, 8)).toBe(0);
    expect(pAtLeast(10, 20, 30, 10)).toBe(1);
    expect(pAtLeast(99, 0, 7, 1)).toBe(0);
  });

  it('returns a probability, not a false certainty, for NaN input', () => {
    expect(pAtLeast(NaN, 1, 1, 1)).toBe(0);
    expect(pAtLeast(99, NaN, 7, 1)).toBe(0);
    expect(pAtLeast(99, 37, NaN, 1)).toBe(0);
    expect(pAtLeast(99, 37, 7, NaN)).toBe(0);
    expect(pAtLeast(99, 37, 7, Infinity)).toBe(0);
    expect(pAtLeast(99, 37, 7, -Infinity)).toBe(1);
  });

  it('matches a direct sum when the lower tail is truncated (more draws than misses)', () => {
    // 10 cards, 8 hits, draw 5: at least 3 hits are forced. P(X >= 4) = (C(8,4)C(2,1) + C(8,5)) / C(10,5) = 196/252.
    expect(pAtLeast(10, 8, 5, 3)).toBeCloseTo(1, 12);
    expect(pAtLeast(10, 8, 5, 4)).toBeCloseTo(196 / 252, 12);
  });
});
