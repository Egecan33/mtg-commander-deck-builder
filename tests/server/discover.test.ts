import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DiscoverState } from '@/app/lib/api';
import { replaceCollection, ownedSet } from '@/server/collection';
import { discoverState, discoverTiers, startDiscover } from '@/server/discover';
import { seedDb, useServerDb } from './server-db';

async function finished(scope: 'owned' | 'unowned'): Promise<DiscoverState> {
  startDiscover(3, scope);
  for (;;) {
    const s = discoverState(3, scope);
    if (s.status !== 'running') return s;
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe('best from collection, by whose commander', () => {
  let owned: DiscoverState;
  let unowned: DiscoverState;
  beforeAll(async () => {
    useServerDb(seedDb());
    replaceCollection(['Krenko, Mob Boss', 'Sol Ring', 'Arcane Signet', 'Lightning Bolt', "Dragonlord's Servant", 'Dockside Extortionist', 'Command Tower', 'Counterspell', 'Swords to Plowshares'].map((n) => `1 ${n}`).join('\n'));
    owned = await finished('owned');
    unowned = await finished('unowned');
  }, 240_000);
  afterAll(() => useServerDb(null));

  it('ranks only commanders in the collection by default', () => {
    expect(owned.status).toBe('done');
    expect(owned.scope).toBe('owned');
    expect(owned.entries.map((e) => e.commander.name)).toEqual(['Krenko, Mob Boss']);
  });

  it('can rank commanders that are not in the collection instead', () => {
    expect(unowned.status).toBe('done');
    expect(unowned.scope).toBe('unowned');
    expect(unowned.entries.length).toBeGreaterThan(5);
    const mine = ownedSet();
    for (const e of unowned.entries) expect(mine.has(e.commander.oracleId), e.commander.name).toBe(false);
    expect(unowned.entries.some((e) => e.commander.name === 'Krenko, Mob Boss')).toBe(false);
  });

  it('counts the commander itself as the one card to get in the owned-cards deck', () => {
    for (const e of unowned.entries) expect(e.tiers[0].buys, e.commander.name).toEqual([e.commander.oracleId]);
  });

  it('lists the best-rated owned-cards deck first', () => {
    const ratings = unowned.entries.map((e) => e.tiers[0].rating);
    expect(ratings).toEqual([...ratings].sort((a, b) => b - a));
  });

  it('keeps the two searches apart and gives buy tiers for a commander that is not owned', () => {
    expect(discoverState(3, 'owned').entries.map((e) => e.commander.name)).toEqual(['Krenko, Mob Boss']);
    const first = unowned.entries[0].commander.oracleId;
    const { tiers } = discoverTiers(3, first, 'unowned');
    expect(tiers.map((t) => t.cap)).toEqual([5, 10, 15, 20]);
    for (const t of tiers) {
      expect(t.buys).toContain(first);
      expect(t.buys.length).toBeLessThanOrEqual(t.cap!);
    }
    expect(() => discoverTiers(3, first, 'owned')).toThrow(/not in the result/);
  });
});
