import { describe, expect, it } from 'vitest';
import { packagePlan, pinPackage } from '@/engine/packages';
import { resolveThemeWeights, summarizeDeck } from '@/engine/summary';
import { WIPE_REASON, roleNeeds, targetPlan, targetsFor } from '@/engine/targets';
import type { Bracket, Deck, EngineContext } from '@/engine/types';
import { card, fixtureDb } from '../helpers/fixture-db';
import { fixtureDeck } from '../helpers/network';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const precon = fixtureDeck('precon', 2);
const upgraded = fixtureDeck('upgraded', 3);
const cedh = fixtureDeck('cedh', 5);
const lands = (d: Deck) => targetsFor(d, ctx, summarizeDeck(d, db)).lands;
const plan = (d: Deck) => packagePlan(d, ctx);
const alone = (name: string, bracket: Bracket = 3): Deck => ({ id: null, name, commanders: [card(name).oracleId], companion: null, chosenColor: null, main: [], targetBracket: bracket, themeWeights: null });
const EMPTY: Deck = { ...alone('Kinnan, Bonder Prodigy'), commanders: [] };
const tp = (d: Deck) => targetPlan(d, ctx, summarizeDeck(d, db));

describe('the land target', () => {
  it("follows the plan's curve and ramp", () => {
    // Calibrated on the 19 saved decks of the scratch data and the fixtures (fix-wave report, C1):
    // 30 + 2.4 × average mana value, −1 per 4 cheap ramp pieces past 6, −1 per 4 cheap cantrips,
    // +4 for a landfall plan, +1 for a 6-mana commander, Brackets 1-2 +1, 4 −1, 5 −7, held to 28-40.
    expect(lands(precon)).toBe(40);
    expect(lands(upgraded)).toBe(36);
    expect(lands(cedh)).toBe(28);
    expect(lands(fixtureDeck('precon', 5))).toBe(33);
    expect(tp(cedh).lands.source).toBe('plan');
    expect(tp(cedh).lands.reason).toMatch(/28 cheap ramp pieces/);
    expect(tp(cedh).lands.reason).toMatch(/Bracket 5 \(−7\)/);
    expect(tp(cedh).lands.reason).toMatch(/held to 28–40/);
    expect(tp(precon).lands.reason).toMatch(/Bracket 2 \(\+1\)/);
  });
  it('landfall adds four lands when it is one of the two archetypes', () => {
    expect(lands({ ...upgraded, themeWeights: { ...resolveThemeWeights(upgraded, ctx), landfall: 1 } })).toBe(40);
    // a fourth archetype does not stack its lands on the two strongest (deck-theory.md §3)
    expect(lands({ ...upgraded, themeWeights: { 'typal:elf': 1, tokens: 1, landfall: 0.9 } })).toBe(36);
  });
  it('a Bracket 5 deck is not lifted above its old bracket band by the formula', () => {
    // Review C1: Bre at Bracket 5 (average mana value 2.8, 34 lands) gained 7 points when 33 replaced the 26-30 band.
    for (const d of [precon, upgraded, cedh]) expect(lands({ ...d, targetBracket: 5 }), d.name).toBeLessThanOrEqual(33);
    expect(lands({ ...upgraded, targetBracket: 5 })).toBeLessThanOrEqual(30);
  });
  it('an empty or commander-only deck keeps the bracket default', () => {
    expect(tp({ ...EMPTY, targetBracket: 3 }).lands.source).toBe('bracket');
    expect(lands({ ...EMPTY, targetBracket: 3 })).toBeGreaterThanOrEqual(35);
    expect(lands({ ...EMPTY, targetBracket: 3 })).toBeLessThanOrEqual(40);
    expect(tp(alone('Kinnan, Bonder Prodigy', 5)).lands.source).toBe('bracket');
  });
  it('stays in 28-40 on the plan path, and a count the user set wins', () => {
    for (const d of [precon, upgraded, cedh]) for (const b of [1, 2, 3, 4, 5] as Bracket[]) {
      const p = tp({ ...d, targetBracket: b });
      if (p.lands.source === 'plan') { expect(p.lands.target).toBeGreaterThanOrEqual(28); expect(p.lands.target).toBeLessThanOrEqual(40); }
    }
    const pinned = tp({ ...upgraded, roleTargets: { land: 33 } });
    expect(pinned.lands).toMatchObject({ target: 33, source: 'pinned', reason: 'You set 33 lands.' });
  });
});

describe('commander moves', () => {
  it('carry their reasons', () => {
    const moves = tp(cedh).moves;
    expect(moves).toContainEqual({ role: 'ramp', delta: -2, reason: 'Kinnan makes mana' });
    expect(moves.some((m) => m.role === 'draw' && m.reason === 'Kinnan already draws cards' && m.delta < 0)).toBe(true);
    expect(tp(alone('Wilson, Refined Grizzly')).moves).toContainEqual({ role: 'protection', delta: -2, reason: 'Wilson protects itself' });
    const base = (w: Record<string, number>) => tp({ ...upgraded, themeWeights: w }).targets.roles;
    expect(base({ voltron: 1 }).protection!.lo).toBe(base({}).protection!.lo + 3);
    const stax = base({ stax: 1 });
    expect(stax['spot-removal']!.lo).toBe(base({ lifegain: 1 })['spot-removal']!.lo + 2);
    expect(tp({ ...upgraded, themeWeights: { stax: 1 } }).moves.some((m) => m.reason === 'A stax plan answers more threats')).toBe(true);
    const kozilek = tp(alone('Kozilek, the Great Distortion'));
    expect(kozilek.moves.some((m) => /mana commander/.test(m.reason))).toBe(false);
    expect(kozilek.targets.roles.ramp).toEqual({ lo: 12, hi: 19 });
  });
});

describe('packagePlan', () => {
  const decks: [string, Deck][] = [['empty', EMPTY], ['kinnan', alone('Kinnan, Bonder Prodigy')], ['partial', { ...precon, main: precon.main.slice(0, 40) }], ['precon', precon], ['upgraded', upgraded], ['cedh', cedh]];
  it('the four core packages are in every deck and hold at least 8', () => {
    for (const [name, d] of decks) for (const b of [1, 3, 5] as Bracket[]) {
      const p = plan({ ...d, targetBracket: b });
      expect(p.packages.slice(0, 4).map((x) => x.id), name).toEqual(['ramp', 'draw', 'removal', 'protection']);
      for (const x of p.packages.slice(0, 4)) { expect(x.kind).toBe('core'); expect(x.target).toBeGreaterThanOrEqual(8); }
    }
  });
  it("core targets come from the rating's own bands", () => {
    const t = tp(upgraded).targets;
    const p = plan(upgraded);
    const get = (id: string) => p.packages.find((x) => x.id === id)!;
    expect(get('ramp').target).toBe(Math.max(8, t.roles.ramp!.lo));
    expect(get('removal').target).toBe(Math.max(8, t.roles['spot-removal']!.lo + (t.roles.counterspell?.lo ?? 0) + get('removal').wipes!.lo));
    expect(roleNeeds(upgraded, ctx).find((n) => n.role === 'ramp')!.band).toEqual(t.roles.ramp);
  });
  it('board wipes are a 1-2 slot inside Removal', () => {
    for (const d of [precon, upgraded, cedh]) for (const b of [1, 2, 3, 4, 5] as Bracket[]) {
      const p = plan({ ...d, targetBracket: b });
      const w = p.packages.find((x) => x.id === 'removal')!.wipes!;
      expect(w.lo).toBeGreaterThanOrEqual(1); expect(w.lo).toBeLessThanOrEqual(2);
      expect(w.hi).toBeGreaterThanOrEqual(w.lo); expect(w.hi).toBeLessThanOrEqual(2);
      expect(w.reason).toBe(WIPE_REASON);
      expect(p.packages.filter((x) => x.wipes !== null)).toHaveLength(1);
    }
    const stax = plan({ ...upgraded, themeWeights: { stax: 1 } }).packages.find((x) => x.id === 'removal')!.wipes!;
    const band = tp({ ...upgraded, themeWeights: { stax: 1 } }).targets.roles.wipe!;
    expect({ lo: stax.lo, hi: stax.hi }).toEqual(band);
  });
  it('overlap counts in every package', () => {
    const base = plan(upgraded);
    const inCore = new Set(base.packages.slice(0, 4).flatMap((x) => x.cards));
    const spare = upgraded.main.filter((e) => e.qty === 1 && db.features(e.oracleId)!.landWeight < 1 && !inCore.has(e.oracleId) && !upgraded.commanders.includes(e.oracleId)).slice(0, 2);
    expect(spare).toHaveLength(2);
    const ids = [card('The One Ring').oracleId, card("Kozilek's Command").oracleId];
    const main = upgraded.main.map((e) => (e.oracleId === spare[0].oracleId ? { ...e, oracleId: ids[0] } : e.oracleId === spare[1].oracleId ? { ...e, oracleId: ids[1] } : e));
    const after = plan({ ...upgraded, main });
    const count = (p: typeof base, id: string) => p.packages.find((x) => x.id === id)!.count;
    expect(count(after, 'draw') - count(base, 'draw')).toBe(2);
    expect(count(after, 'ramp') - count(base, 'ramp')).toBe(1);
    expect(count(after, 'removal') - count(base, 'removal')).toBe(1);
    expect(count(after, 'protection') - count(base, 'protection')).toBe(1);
    expect(after.packages.find((x) => x.id === 'draw')!.cards).toEqual(expect.arrayContaining(ids));
  });
  it('theme packages are the focused themes with at least 8 slots', () => {
    const p = plan(upgraded);
    const themes = p.packages.filter((x) => x.kind === 'theme');
    expect(themes.map((x) => x.id)).toContain('theme:typal:elf');
    expect(themes.some((x) => x.id === 'theme:typal')).toBe(false);
    for (const x of themes) expect(x.target).toBeGreaterThanOrEqual(8);
    const slots = 99 - p.lands.target - p.packages.filter((x) => x.kind === 'core').reduce((n, x) => n + x.target, 0);
    expect(themes.reduce((n, x) => n + x.target, 0)).toBe(slots);
    const pre = plan(precon);
    expect(pre.packages.filter((x) => x.kind === 'theme').map((x) => x.id)).toEqual(['theme:typal:dragon']);
    expect(pre.packages.find((x) => x.id === 'theme:typal:dragon')!.target).toBe(99 - pre.lands.target - pre.packages.slice(0, 4).reduce((n, x) => n + x.target, 0));
  });
  it('a theme under 8 slots is dropped, not padded', () => {
    const p = plan({ ...upgraded, roleTargets: { land: 40, ramp: 20, draw: 20, protection: 16 } });
    expect(p.packages.some((x) => x.kind === 'theme')).toBe(false);
    const d = p.dropped.find((x) => x.id === 'theme:typal:elf');
    expect(d).toBeTruthy();
    expect(d!.slots).toBeLessThan(8);
  });
  it('pins win and the floor holds', () => {
    const ramp14 = plan({ ...upgraded, roleTargets: { ramp: 14 } }).packages[0];
    expect(ramp14).toMatchObject({ target: 14, pinned: true });
    expect(tp({ ...upgraded, roleTargets: { ramp: 14 } }).targets.roles.ramp).toEqual({ lo: 14, hi: 16 });
    const ramp5 = plan({ ...upgraded, roleTargets: { ramp: 5 } }).packages[0];
    expect(tp({ ...upgraded, roleTargets: { ramp: 5 } }).targets.roles.ramp).toEqual({ lo: 5, hi: 7 });
    expect(ramp5.target).toBe(8);
    expect(ramp5.reason.endsWith('; every package holds at least 8.')).toBe(true);
    const p = plan(upgraded);
    const t = tp(upgraded).targets;
    expect(plan(pinPackage(upgraded, p, t, 'removal', 12)).packages.find((x) => x.id === 'removal')!.target).toBe(12);
    const frozen = JSON.stringify(upgraded);
    const fort = pinPackage(upgraded, p, t, 'fn:pillow-fort', 9);
    expect(JSON.stringify(upgraded)).toBe(frozen);
    expect(fort.packageTargets).toEqual({ 'fn:pillow-fort': 9 });
    expect(plan(fort).packages.find((x) => x.id === 'fn:pillow-fort')).toMatchObject({ target: 9, pinned: true, kind: 'functional' });
    expect(pinPackage(upgraded, p, t, 'fn:pillow-fort', 3).packageTargets).toEqual({ 'fn:pillow-fort': 8 });
    expect(pinPackage(upgraded, p, t, 'fn:pillow-fort', 70).packageTargets).toEqual({ 'fn:pillow-fort': 40 });
    expect(pinPackage(fort, p, t, 'fn:pillow-fort', null).packageTargets).toBeNull();
  });
  it('Add a package offers what the commander points at first', () => {
    const p = plan(alone('Loran of the Third Path'));
    expect(p.offers[0]).toMatchObject({ id: 'fn:max-hand-size' });
    expect(p.offers.map((o) => o.id)).toEqual(expect.arrayContaining(['fn:win-the-game', 'fn:pillow-fort', 'fn:max-hand-size']));
    const have = new Set(p.packages.map((x) => x.id));
    for (const o of p.offers) expect(have.has(o.id)).toBe(false);
  });
  it('never throws and never NaN', () => {
    const odd: Deck = { ...precon, main: [...precon.main.slice(0, 5), { oracleId: 'not-a-card', qty: 1, locked: false }] };
    for (const d of [EMPTY, alone('Kinnan, Bonder Prodigy'), { ...precon, main: precon.main.slice(0, 40) }, { ...precon, commanders: [] }, odd]) {
      expect(JSON.stringify(plan(d))).not.toMatch(/NaN|undefined|null,"target"/);
      for (const x of plan(d).packages) { expect(Number.isFinite(x.target)).toBe(true); expect(Number.isFinite(x.count)).toBe(true); }
    }
  });
});
