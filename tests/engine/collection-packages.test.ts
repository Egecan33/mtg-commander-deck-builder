import { describe, expect, it } from 'vitest';
import { CORE_PACKAGES, GOOD_QUALITY, HAND_SIZE, collectionPackages } from '@/engine/packages';
import { baseQuality, rankQuality } from '@/engine/scoring';
import type { Color } from '@/engine/types';
import { card, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const everything = new Set(db.all().map((c) => c.oracleId));
const coreIds = CORE_PACKAGES.map((p) => p.id);
const c = (name: string) => card(name);

describe('baseQuality', () => {
  it("is the scorer's deck-free quality", () => {
    const solRing = c('Sol Ring');
    expect(baseQuality(solRing, db.features(solRing.oracleId)).quality).toBe(1);
    const cultivate = c('Cultivate');
    const cq = baseQuality(cultivate, db.features(cultivate.oracleId));
    expect(cq.quality).toBeCloseTo(rankQuality(cultivate.edhrecRank) - 0.05, 10);
    expect(cq.text).toMatch(/costs more than most cards doing this job/);
    const bolt = c('Lightning Bolt');
    const bq = baseQuality(bolt, db.features(bolt.oracleId));
    expect(bq.quality).toBeCloseTo(Math.min(1, rankQuality(bolt.edhrecRank) + 0.05), 10);
    expect(bq.text).toMatch(/instant speed/);
  });
});

describe('collectionPackages', () => {
  const identities: Color[][] = [[], ['W'], ['U', 'B']];

  it('the core four always come first, even empty', () => {
    for (const identity of identities) {
      expect(collectionPackages(db, everything, identity).slice(0, 4).map((p) => p.id)).toEqual(coreIds);
    }
    expect(collectionPackages(db, new Set(), ['U']).slice(0, 4).map((p) => [p.id, p.total, p.cards.length])).toEqual(coreIds.map((id) => [id, 0, 0]));
  });

  it('identity fits inside the chosen colours', () => {
    for (const p of collectionPackages(db, everything, ['U', 'B'])) {
      for (const id of p.cards) expect(db.get(id)!.colorIdentity.every((k) => k === 'U' || k === 'B'), `${p.id} ${db.get(id)!.name}`).toBe(true);
    }
    for (const p of collectionPackages(db, everything, [])) for (const id of p.cards) expect(db.get(id)!.colorIdentity).toEqual([]);
  });

  it('functional packages need at least 8 cards', () => {
    const ids = (colors: Color[]) => new Map(collectionPackages(db, everything, colors).map((p) => [p.id, p]));
    const urg = ids(['U', 'R', 'G']);
    expect(urg.get('fn:max-hand-size')?.total).toBe(8);
    expect(ids(['U', 'R']).has('fn:max-hand-size')).toBe(false);
    expect(ids(['W']).has('fn:max-hand-size')).toBe(false);
    expect(ids(['W']).has('fn:pillow-fort')).toBe(false);
    expect(ids(['G']).get('fn:win-the-game')?.total).toBeGreaterThanOrEqual(8);
    for (const colors of identities) for (const p of collectionPackages(db, everything, colors)) if (p.kind === 'functional') expect(p.total).toBeGreaterThanOrEqual(8);
  });

  it('at most four theme packages, each with at least 8 good cards', () => {
    const themes = collectionPackages(db, everything, ['B', 'G']).filter((p) => p.kind === 'theme');
    expect(themes.length).toBeLessThanOrEqual(4);
    for (const t of themes) {
      expect(t.id).not.toBe('theme:typal');
      expect(t.id.startsWith('theme:typal')).toBe(false);
      expect(t.total).toBeGreaterThanOrEqual(8);
    }
    const all = collectionPackages(db, everything, ['W', 'U', 'B', 'R', 'G']).filter((p) => p.kind === 'theme');
    expect(all.length).toBeGreaterThan(0);
    expect(all.length).toBeLessThanOrEqual(4);
    expect(GOOD_QUALITY).toBe(0.5);
  });

  it('the best eight, held last', () => {
    const pkgs = collectionPackages(db, everything, ['G']);
    for (const p of pkgs) {
      expect(p.cards.length).toBeLessThanOrEqual(HAND_SIZE);
      expect(p.total).toBeGreaterThanOrEqual(p.cards.length);
    }
    const ramp = pkgs.find((p) => p.id === 'ramp')!;
    const keys = ramp.cards.map((id) => baseQuality(db.get(id)!, db.features(id)).quality);
    for (let i = 1; i < keys.length; i++) expect(keys[i]).toBeLessThanOrEqual(keys[i - 1]);
    const first = ramp.cards[0];
    const heldRamp = collectionPackages(db, everything, ['G'], { held: new Set([first]) }).find((p) => p.id === 'ramp')!;
    const at = heldRamp.cards.indexOf(first);
    expect(at === -1 || at === heldRamp.cards.length - 1).toBe(true);
    expect(heldRamp.cards[0]).not.toBe(first);
  });

  it('only owned cards', () => {
    const owned = new Set([c('Sol Ring').oracleId, c('Arcane Signet').oracleId]);
    const pkgs = collectionPackages(db, owned, []);
    const ramp = pkgs.find((p) => p.id === 'ramp')!;
    expect(ramp.total).toBe(2);
    expect([...ramp.cards].sort()).toEqual([...owned].sort());
    expect(pkgs.find((p) => p.id === 'draw')!.total).toBe(0);
  });
});
