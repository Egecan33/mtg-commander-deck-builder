import { describe, expect, it } from 'vitest';
import { karstenSources } from '@/engine/mana';
import { deckCards, summarizeDeck } from '@/engine/summary';
import { roleNeeds, scaleTargets, targetsFor } from '@/engine/targets';
import { brawlFixtureDb, standardBrawlFixtureDb } from '../helpers/fixture-db';
import { ctxOf, redDeck } from '../helpers/standard-brawl';

describe('Standard Brawl targets', () => {
  const std = standardBrawlFixtureDb();
  const deck = { ...redDeck(std), themeWeights: {} };
  const summary = summarizeDeck(deck, std);
  const at = (avgMv: number) => targetsFor(deck, ctxOf(std), { ...summary, avgMv });

  // The fixture deck's cheap ramp and draw, taken out for the plain curve formula.
  const cheapIds = new Set(deckCards(deck, std).cards
    .filter((c) => c.card.cmc <= 2 && (c.features.roles.includes('ramp') || c.features.roles.includes('draw'))).map((c) => c.card.oracleId));
  const bare = { ...deck, main: deck.main.filter((e) => !cheapIds.has(e.oracleId)) };
  const bareAt = (avgMv: number) => targetsFor(bare, ctxOf(std), { ...summarizeDeck(bare, std), avgMv });

  it('lands = round(22 + 0.8 x average mana value), 22 to 26: 24 / 24 / 25 for curves 2 / 3 / 4', () => {
    expect(bareAt(2).lands).toBe(24);
    expect(bareAt(3).lands).toBe(24);
    expect(bareAt(4).lands).toBe(25);
    expect(bareAt(0.5).lands).toBe(22);
    expect(bareAt(9).lands).toBe(26);
  });

  it('takes 0.28 x 59/99 lands off per cheap ramp or draw card, still held to 22 to 26', () => {
    expect(cheapIds.size).toBeGreaterThan(0);
    expect(at(2).lands).toBeLessThan(bareAt(2).lands);
    expect(at(2).lands).toBeGreaterThanOrEqual(22);
    expect(at(0.5).lands).toBe(22);
  });

  it('says why in a note the UI shows', () => {
    expect(at(3).notes).toContain('60-card Brawl decks have no fast mana and need to hit land drops on a 1v1 clock.');
  });

  it('scales each Brawl role band by 59/99, with removal x1.2, wipes 0-1 and protection x0.8', () => {
    const brawl = brawlFixtureDb();
    const base = targetsFor({ ...deck, targetBracket: 3 }, ctxOf(brawl), summarizeDeck(deck, brawl));
    const t = at(3);
    const f = 59 / 99;
    const by = (x: number, k = 1) => Math.round(x * f * k);
    expect(t.roles.ramp).toEqual({ lo: by(base.roles.ramp!.lo), hi: by(base.roles.ramp!.hi) });
    expect(t.roles.draw).toEqual({ lo: by(base.roles.draw!.lo), hi: by(base.roles.draw!.hi) });
    expect(t.roles['spot-removal']).toEqual({ lo: by(base.roles['spot-removal']!.lo, 1.2), hi: by(base.roles['spot-removal']!.hi, 1.2) });
    expect(t.roles.protection).toEqual({ lo: by(base.roles.protection!.lo, 0.8), hi: by(base.roles.protection!.hi, 0.8) });
    expect(t.roles.wipe).toEqual({ lo: 0, hi: 1 });
    expect(t.themeCards).toBe(by(base.themeCards));
  });

  it('ignores the deck bracket: no bracket tuning in Standard Brawl', () => {
    const b5 = targetsFor({ ...deck, targetBracket: 5 }, ctxOf(std), summary);
    const b1 = targetsFor({ ...deck, targetBracket: 1 }, ctxOf(std), summary);
    expect(b5).toEqual(b1);
  });

  it('scales a partial deck against 60, not 100', () => {
    const full = at(3);
    const half = scaleTargets(full, 30, 60);
    expect(half.lands).toBe(Math.round(full.lands / 2));
    const need = roleNeeds({ ...deck, main: deck.main.slice(0, 1) }, ctxOf(std), { scaled: true });
    expect(need.find((n) => n.role === 'ramp')!.band.hi).toBeLessThanOrEqual(full.roles.ramp!.hi);
  });

  it('needs fewer coloured sources in 60 cards than in 99', () => {
    expect(karstenSources(1, 2, 60)).toBeLessThan(karstenSources(1, 2));
    expect(karstenSources(2, 4, 60)).toBeLessThan(karstenSources(2, 4));
    expect(karstenSources(1, 2, 100)).toBe(karstenSources(1, 2));
    expect(karstenSources(0, 2, 60)).toBe(0);
  });
});
