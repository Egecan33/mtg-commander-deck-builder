import { describe, expect, it } from 'vitest';
import { karstenSources, landTarget, pAtLeast } from '@/engine/mana';

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
