import { describe, expect, it } from 'vitest';
import { odds } from '@/engine/odds';

describe('odds: chance of at least one hit in the first cards seen', () => {
  it('8 hits in 99 cards: 45.6% in the opening hand', () => {
    expect(Math.abs(odds(99, 8, 7) - 0.456)).toBeLessThanOrEqual(0.001);
  });

  it('8 hits in 99 cards: 71.9% by the seventh draw (14 cards seen)', () => {
    expect(Math.abs(odds(99, 8, 14) - 0.719)).toBeLessThanOrEqual(0.001);
  });

  it('no hits is never found', () => {
    expect(odds(99, 0, 7)).toBe(0);
  });

  it('a deck of only hits is found on the first card', () => {
    expect(odds(99, 99, 1)).toBe(1);
  });

  it('seeing no cards finds nothing', () => {
    expect(odds(99, 8, 0)).toBe(0);
  });

  it('seeing the whole deck finds any hit', () => {
    expect(odds(99, 1, 99)).toBe(1);
    expect(odds(99, 1, 120)).toBe(1);
  });

  it('more hits or more cards seen never lowers the chance', () => {
    for (let hits = 0; hits < 20; hits++) {
      for (let seen = 0; seen < 20; seen++) {
        const p = odds(99, hits, seen);
        expect(p).toBeGreaterThanOrEqual(0);
        expect(p).toBeLessThanOrEqual(1);
        expect(odds(99, hits + 1, seen)).toBeGreaterThanOrEqual(p);
        expect(odds(99, hits, seen + 1)).toBeGreaterThanOrEqual(p);
      }
    }
  });

  it('nonsense input gives 0, not NaN', () => {
    expect(odds(0, 0, 7)).toBe(0);
    expect(odds(99, -3, 7)).toBe(0);
    expect(odds(99, 8, -1)).toBe(0);
    expect(odds(Number.NaN, 8, 7)).toBe(0);
  });
});
