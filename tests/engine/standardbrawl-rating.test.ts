import { describe, expect, it } from 'vitest';
import { spreadWeights } from '@/engine/format';
import { RATING_WEIGHTS, rateDeck, ratingWeights } from '@/engine/rating';
import { createScorer } from '@/engine/scoring';
import { brawlFixtureDb, standardBrawlFixtureDb } from '../helpers/fixture-db';
import { ctxOf, redDeck } from '../helpers/standard-brawl';

const sum = (w: Record<string, number>) => Object.values(w).reduce((a, b) => a + b, 0);

describe('Standard Brawl rating', () => {
  const std = standardBrawlFixtureDb();

  it('drops the bracket part and spreads its weight: weights still add up to 100', () => {
    const w = ratingWeights('standardbrawl');
    expect(w.bracket).toBe(0);
    expect(sum(w)).toBe(100);
    expect(sum(RATING_WEIGHTS)).toBe(100);
    expect(ratingWeights('brawl')).toEqual(RATING_WEIGHTS);
    for (const k of Object.keys(w) as (keyof typeof w)[]) if (k !== 'bracket') expect(w[k]).toBeGreaterThanOrEqual(RATING_WEIGHTS[k]);
  });

  it('spreads proportionally and keeps the total', () => {
    expect(spreadWeights<'a' | 'b' | 'c'>({ a: 50, b: 30, c: 20 }, 'a')).toEqual({ a: 0, b: 60, c: 40 });
    expect(sum(spreadWeights<'a' | 'b' | 'c' | 'd'>({ a: 8, b: 16, c: 14, d: 62 }, 'a'))).toBe(100);
  });

  it('rates a legal 60-card deck as complete, without a bracket sub-score, and says so', () => {
    const r = rateDeck(redDeck(std), ctxOf(std));
    expect(r.legal).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.subscores.some((s) => s.key === 'bracket')).toBe(false);
    expect(sum(Object.fromEntries(r.subscores.map((s) => [s.key, s.weight])))).toBe(100);
    expect(r.notes?.[0]).toMatch(/Bracket fit does not apply to Standard Brawl/);
    expect(r.rating).toBeGreaterThan(0);
    for (const s of r.subscores) for (const f of s.fixes) expect(f.text).not.toMatch(/Bracket \d/);
  });

  it('is short, not capped, at 40 cards; over 60 is capped as illegal', () => {
    const short = rateDeck(redDeck(std, 40), ctxOf(std));
    expect(short.complete).toBe(false);
    expect(short.violations.map((v) => v.code)).toEqual(['size']);
    const over = rateDeck(redDeck(std, 61), ctxOf(std));
    expect(over.rating).toBeLessThanOrEqual(40);
  });

  it('keeps the Commander and Brawl rating as it was: a 60-card deck is short there', () => {
    const brawl = brawlFixtureDb();
    const r = rateDeck(redDeck(std), ctxOf(brawl));
    expect(r.complete).toBe(false);
    expect(r.subscores.some((s) => s.key === 'bracket')).toBe(true);
    expect(r.notes).toBeUndefined();
  });

  it('scores cards with no bracket part and every score has reasons', () => {
    const scorer = createScorer(redDeck(std), ctxOf(std));
    const scores = scorer.scoreAll().slice(0, 40);
    for (const s of scores) {
      const part = s.parts.find((p) => p.key === 'bracket');
      expect(part?.max ?? 0).toBe(0);
      expect(s.reasons.length).toBeGreaterThan(0);
      expect(s.reasons.join(' ')).not.toMatch(/bracket:/);
    }
  });
});
