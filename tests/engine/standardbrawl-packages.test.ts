import { describe, expect, it } from 'vitest';
import { completePackage } from '@/engine/builder';
import { deckNetwork } from '@/engine/network';
import { packagePlan, pinPackage } from '@/engine/packages';
import { rateDeck } from '@/engine/rating';
import { deckSize, validateDeck } from '@/engine/rules';
import { summarizeDeck } from '@/engine/summary';
import { roleNeeds, targetPlan, targetsFor } from '@/engine/targets';
import type { BuildOptions, Deck, Wildcards } from '@/engine/types';
import { overBudget, wildcardsNeeded } from '@/engine/wildcards';
import { brawlFixtureDb, standardBrawlFixtureDb } from '../helpers/fixture-db';
import { ctxOf, redDeck } from '../helpers/standard-brawl';

const std = standardBrawlFixtureDb();
const brawl = brawlFixtureDb();
const deck: Deck = { ...redDeck(std), themeWeights: {} };
const opts = (extra: Partial<BuildOptions> = {}): BuildOptions => ({ ownedOnly: false, owned: new Set(), maxPriceUsd: null, seed: 7, ...extra });

describe('Standard Brawl packages and network', () => {
  it('holds every package to 5 cards, Brawl to 8', () => {
    const p = targetPlan(deck, ctxOf(std), summarizeDeck(deck, std));
    expect(p.packageMin).toBe(5);
    for (const id of ['ramp', 'draw', 'removal', 'protection'] as const) expect(p.targets.packages![id].lo).toBeGreaterThanOrEqual(5);
    expect(targetPlan(deck, ctxOf(brawl), summarizeDeck(deck, brawl)).packageMin).toBe(8);
  });

  it('keeps its own wipes (0-1, not owed) and land formula', () => {
    const t = targetsFor(deck, ctxOf(std), { ...summarizeDeck(deck, std), avgMv: 3 });
    expect(t.packages!.wipes).toEqual({ lo: 0, hi: 1 });
    expect(t.lands).toBe(24);
    const wipe = roleNeeds(deck, ctxOf(std)).find((n) => n.role === 'wipe')!;
    expect(wipe.owed).toBe(false);
  });

  it('plans against 60 cards: package minimum 5 in the plan, no 8 in its reasons', () => {
    const plan = packagePlan(deck, ctxOf(std));
    expect(plan.packageMin).toBe(5);
    expect(plan.packages.slice(0, 4).map((p) => p.id)).toEqual(['ramp', 'draw', 'removal', 'protection']);
    for (const p of plan.packages) {
      expect(p.target).toBeGreaterThanOrEqual(5);
      expect(p.reason).not.toMatch(/\b8\b/);
      expect(p.reason).not.toMatch(/Bracket/);
    }
    // the theme share comes from the 59 cards, not 99
    const used = plan.lands.target + plan.packages.reduce((n, p) => n + p.target, 0);
    expect(used).toBeLessThanOrEqual(59 + 4 * 4);
  });

  it('pins a package down to 5 in Standard Brawl and 8 in Brawl', () => {
    const t = targetsFor(deck, ctxOf(std), summarizeDeck(deck, std));
    const pinned = pinPackage(deck, packagePlan(deck, ctxOf(std)), t, 'fn:pillow-fort', 3);
    expect(pinned.packageTargets).toEqual({ 'fn:pillow-fort': 5 });
    const tb = targetsFor(deck, ctxOf(brawl), summarizeDeck(deck, brawl));
    expect(pinPackage(deck, packagePlan(deck, ctxOf(brawl)), tb, 'fn:pillow-fort', 3).packageTargets).toEqual({ 'fn:pillow-fort': 8 });
  });

  it('completes a package on a full 60-card deck without growing it or leaving Standard Brawl', () => {
    const r = completePackage(deck, ctxOf(std), opts(), 'protection');
    expect(deckSize(r.deck)).toBe(60);
    expect(validateDeck(r.deck, std)).toEqual([]);
    const ids = [...r.deck.commanders, ...r.deck.main.map((e) => e.oracleId)];
    expect(ids.every((id) => std.get(id)?.standardBrawlLegality === 'legal')).toBe(true);
  });

  it('keeps Complete package inside the wildcards left, across all the cards it adds', () => {
    // a 25-card deck short of card draw, every card in it owned, one wildcard of each rarity: the
    // pool allows any one unowned card, so only counting what each add spends keeps the deck in budget
    const small: Deck = { ...redDeck(std, 25), themeWeights: {} };
    const one: Wildcards = { common: 1, uncommon: 1, rare: 1, mythic: 1 };
    const owned = new Set([...small.commanders, ...small.main.map((e) => e.oracleId)]);
    const r = completePackage(small, ctxOf(std), opts({ owned, wildcards: one }), 'draw');
    expect(r.changes.some((c) => c.in !== '')).toBe(true);
    expect(overBudget(wildcardsNeeded(r.deck, std, owned), one)).toEqual([]);
    // without the cap the same call adds more than one wildcard's worth of some rarity
    const free = completePackage(small, ctxOf(std), opts({ owned }), 'draw');
    expect(overBudget(wildcardsNeeded(free.deck, std, owned), one)).not.toEqual([]);
  });

  it('builds a network and a rating for a 60-card deck', () => {
    const net = deckNetwork(deck, ctxOf(std));
    expect(net.nodes.length).toBeGreaterThan(0);
    expect(net.cohesion).toBeGreaterThanOrEqual(0);
    expect(net.cohesion).toBeLessThanOrEqual(100);
    const r = rateDeck(deck, ctxOf(std));
    expect(r.complete).toBe(true);
    expect(r.subscores.reduce((n, s) => n + s.weight, 0)).toBe(100);
    expect(r.subscores.some((s) => s.key === 'bracket')).toBe(false);
  });
});
