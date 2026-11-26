import { describe, expect, it } from 'vitest';
import { completePackage, overlapKey, rankPackage } from '@/engine/builder';
import { packageDef, packageMembers, packagePlan } from '@/engine/packages';
import { deckCount } from '@/engine/builder/pool';
import { validateDeck } from '@/engine/rules';
import type { BuildOptions, Deck, EngineContext } from '@/engine/types';
import { card, fixtureDb } from '../helpers/fixture-db';
import { fixtureDeck } from '../helpers/network';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({ ownedOnly: false, owned: null, maxPriceUsd: null, seed: 1, ...over });
const upgraded = fixtureDeck('upgraded', 3);
const ids = (d: Deck) => new Set([...d.commanders, ...d.main.map((e) => e.oracleId)]);
const without = (d: Deck, drop: (id: string) => boolean): Deck => ({ ...d, main: d.main.filter((e) => !drop(e.oracleId)) });
const members = (d: Deck, id: 'protection' | 'ramp' | 'draw' | 'removal') => packageMembers(d, db, packageDef(id)!).count;

describe('completePackage', () => {
  it('adds the best missing cards to a deck under 100', () => {
    const protection = new Set(packagePlan(upgraded, ctx).packages.find((p) => p.id === 'protection')!.cards);
    const noProtection = without(upgraded, (id) => protection.has(id));
    const short: Deck = { ...noProtection, main: noProtection.main.map((e) => (db.get(e.oracleId)!.frontName === 'Forest' ? { ...e, qty: e.qty - 8 } : e)) };
    expect(deckCount(short)).toBeLessThan(100 - 7);
    const plan = packagePlan(short, ctx);
    const missing = plan.packages.find((p) => p.id === 'protection')!.target - 0;
    const picks = rankPackage(short, ctx, opts(), 'protection', { plan });
    const r = completePackage(short, ctx, opts(), 'protection');
    expect(r.changes.length).toBe(Math.min(missing, picks.length));
    r.changes.forEach((c, i) => {
      expect(c.out).toBe('');
      expect(c.in).toBe(picks[i].oracleId);
      expect(c.reason).toMatch(/^Completes Protection/);
      expect(c.summary).toMatch(new RegExp(`^Protection ${i} → ${i + 1} of ${missing}`));
    });
    expect(validateDeck(r.deck, db).filter((v) => v.code !== 'size')).toEqual([]);
  });

  it('dual-purpose cards rank first and say so', () => {
    let sawOutranking = false;
    for (const id of ['ramp', 'draw', 'removal', 'protection'] as const) {
      const picks = rankPackage(upgraded, ctx, opts(), id);
      for (let i = 1; i < picks.length; i++) expect(picks[i - 1].key).toBeGreaterThanOrEqual(picks[i].key);
      for (const p of picks) expect(p.key).toBe(overlapKey(p.score, p.also.length));
      for (let i = 0; i < picks.length; i++) {
        if (picks[i].also.length > 0 && picks.slice(i + 1).some((p) => p.also.length === 0 && p.score > picks[i].score)) sawOutranking = true;
      }
    }
    expect(sawOutranking).toBe(true);
  });

  it('on a full deck each add cuts the weakest card outside every package', () => {
    const r = completePackage(upgraded, ctx, opts(), 'protection');
    expect(r.changes.length).toBeGreaterThan(0);
    const tracked = new Set(packagePlan(upgraded, ctx).packages.flatMap((p) => p.cards));
    const outs = r.changes.map((c) => c.out);
    for (const out of outs) {
      expect(out).not.toBe('');
      expect(tracked.has(out)).toBe(false);
      expect(upgraded.commanders).not.toContain(out);
    }
    expect(new Set(outs).size).toBe(outs.length);
    expect(deckCount(r.deck)).toBe(100);
    expect(validateDeck(r.deck, db)).toEqual([]);
  });

  it('a card in three packages counts in each and is never cut', () => {
    const base = packagePlan(upgraded, ctx);
    const inCore = new Set(base.packages.slice(0, 4).flatMap((p) => p.cards));
    const spare = upgraded.main.filter((e) => e.qty === 1 && db.features(e.oracleId)!.landWeight < 1 && !inCore.has(e.oracleId)).slice(0, 2);
    const two = [card('The One Ring').oracleId, card("Kozilek's Command").oracleId];
    const deck: Deck = { ...upgraded, main: upgraded.main.map((e) => (e.oracleId === spare[0].oracleId ? { ...e, oracleId: two[0] } : e.oracleId === spare[1].oracleId ? { ...e, oracleId: two[1] } : e)) };
    const r = completePackage(deck, ctx, opts(), 'protection');
    for (const c of r.changes) expect(two).not.toContain(c.out);
    for (const id of ['draw', 'ramp', 'removal'] as const) expect(members(r.deck, id)).toBeGreaterThanOrEqual(members(deck, id));
  });

  it('a complete package changes nothing', () => {
    const r = completePackage(upgraded, ctx, opts(), 'ramp');
    expect(r.changes).toEqual([]);
    expect(r.deck).toEqual(upgraded);
    expect(r.note).toMatch(/^Ramp already has \d+ of /);
  });

  it('completes up to a pinned target', () => {
    const deck: Deck = { ...without(upgraded, (id) => db.get(id)!.frontName === 'Forest'), roleTargets: { ramp: 30 } };
    const before = members(deck, 'ramp');
    const picks = rankPackage(deck, ctx, opts(), 'ramp').length;
    const r = completePackage(deck, ctx, opts(), 'ramp');
    expect(members(r.deck, 'ramp')).toBe(Math.min(30, before + picks));
  });

  it('free copies only with every candidate held changes nothing', () => {
    const r = completePackage(upgraded, ctx, opts({ ownedOnly: true, owned: ids(upgraded) }), 'protection');
    expect(r.changes).toEqual([]);
    expect(r.deck).toEqual(upgraded);
    expect(r.note).toMatch(/^No Protection card the options allow is left to add from the cards allowed/);
  });

  it('never cuts locked cards, and does not mutate the deck', () => {
    const frozen = JSON.stringify(upgraded);
    const locked: Deck = { ...upgraded, main: upgraded.main.map((e) => ({ ...e, locked: true })) };
    const r = completePackage(locked, ctx, opts(), 'protection');
    expect(r.changes).toEqual([]);
    expect(r.note).toMatch(/nothing more was cut/);
    completePackage(upgraded, ctx, opts(), 'draw');
    expect(JSON.stringify(upgraded)).toBe(frozen);
  });

  it('Removal fills the board-wipe slot first, one-sided wipes before others', () => {
    const wipeIds = new Set(packageMembers(upgraded, db, packageDef('removal')!).ids.filter((id) => (db.features(id)?.roles ?? []).includes('wipe')));
    const deck = without(upgraded, (id) => wipeIds.has(id));
    const r = completePackage(deck, ctx, opts(), 'removal');
    expect(r.changes.length).toBeGreaterThan(0);
    expect(db.features(r.changes[0].in)!.roles).toContain('wipe');
  });
});
