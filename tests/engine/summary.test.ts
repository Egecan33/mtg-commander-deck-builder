import { describe, expect, it } from 'vitest';
import { resolveThemeWeights, summarizeDeck } from '@/engine/summary';
import { scaleTargets, targetsFor } from '@/engine/targets';
import { parseDecklist } from '@/engine/text';
import type { Bracket, Deck, DeckEntry, EngineContext, Role } from '@/engine/types';
import { card, deckText, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const id = (name: string) => card(name).oracleId;
const e = (name: string, qty = 1): DeckEntry => ({ oracleId: id(name), qty, locked: false });

function deck(commanders: string[], main: DeckEntry[], extra: Partial<Deck> = {}): Deck {
  return {
    id: null, name: 'test', commanders: commanders.map(id), companion: null, chosenColor: null,
    main, targetBracket: 3, themeWeights: null, ...extra,
  };
}
function fixtureDeck(name: 'precon' | 'upgraded' | 'cedh', target: Bracket): Deck {
  const p = parseDecklist(deckText(name), db);
  return { id: null, name, commanders: p.commanders, companion: p.companion, chosenColor: null, main: p.main, targetBracket: target, themeWeights: null };
}
const EMPTY = deck([], []);

/** Every number in a nested value is finite. */
function allFinite(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(allFinite);
  if (v && typeof v === 'object') return Object.values(v).every(allFinite);
  return true;
}

describe('summarizeDeck', () => {
  it('reads the precon: 100 cards, 34-40 lands', () => {
    const s = summarizeDeck(fixtureDeck('precon', 2), db);
    expect(s.cardCount).toBe(100);
    expect(s.landCount).toBeGreaterThanOrEqual(34);
    expect(s.landCount).toBeLessThanOrEqual(40);
    expect(s.landsEffective).toBeGreaterThanOrEqual(s.landCount);
    expect(s.roleCounts.land).toBe(s.landCount);
    expect(s.curve).toHaveLength(8);
    expect(s.curve.reduce((a, b) => a + b, 0)).toBe(100 - s.landCount);
    expect(s.avgMv).toBeGreaterThan(2);
    expect(s.avgMv).toBeLessThan(5);
    expect(s.sources.G).toBeGreaterThan(10);
    expect(s.sources.W).toBeLessThan(s.sources.G); // only any-colour sources make white in a Temur deck
    expect(s.gameChangers).toEqual([]);
    expect(allFinite(s)).toBe(true);
  });

  it('counts quantities, not entries', () => {
    const s = summarizeDeck(deck(['Wilson, Refined Grizzly'], [e('Forest', 30), e('Sol Ring')]), db);
    expect(s.cardCount).toBe(32);
    expect(s.landCount).toBe(30);
    expect(s.sources.G).toBe(30);
    expect(s.roleCounts.ramp).toBe(1);
    expect(s.roleCounts['fast-mana']).toBe(1);
    expect(s.curve[1]).toBe(1); // Sol Ring
  });

  it('leaves one copy out with `exclude`', () => {
    const d = deck(['Wilson, Refined Grizzly'], [e('Forest', 30), e('Sol Ring')]);
    const noRing = summarizeDeck(d, db, id('Sol Ring'));
    expect(noRing.cardCount).toBe(31);
    expect(noRing.roleCounts.ramp).toBe(0);
    const oneForestLess = summarizeDeck(d, db, id('Forest'));
    expect(oneForestLess.landCount).toBe(29);
    expect(summarizeDeck(d, db, 'not-in-deck').cardCount).toBe(32);
  });

  it('lists Game Changers, the commander included, and counts interaction', () => {
    const s = summarizeDeck(deck(['Braids, Cabal Minion'], [e('Rhystic Study'), e('Counterspell'), e('Swords to Plowshares'), e('Wrath of God')]), db);
    expect(s.gameChangers.sort()).toEqual([id('Braids, Cabal Minion'), id('Rhystic Study')].sort());
    expect(s.interaction).toBe(3);
    expect(s.instantInteraction).toBe(2);
  });

  it('gives an MDFC land-spell a partial land weight and keeps it out of landCount', () => {
    const mdfc = db.all().find((c) => { const w = db.features(c.oracleId)?.landWeight ?? 0; return w > 0 && w < 1; });
    expect(mdfc).toBeDefined();
    const s = summarizeDeck(deck([], [{ oracleId: mdfc!.oracleId, qty: 1, locked: false }, e('Forest', 2)]), db);
    expect(s.landCount).toBe(2);
    expect(s.landsEffective).toBeCloseTo(2 + db.features(mdfc!.oracleId)!.landWeight, 5);
    expect(s.curve.reduce((a, b) => a + b, 0)).toBe(1);
  });

  it('never throws or yields NaN on an empty deck, unknown cards or junk quantities', () => {
    const empty = summarizeDeck(EMPTY, db);
    expect(empty.cardCount).toBe(0);
    expect(empty.avgMv).toBe(0);
    expect(allFinite(empty)).toBe(true);
    const junk: Deck = { ...deck([], [{ oracleId: 'nope', qty: 3, locked: false }, { oracleId: id('Forest'), qty: Number.NaN, locked: false }, e('Sol Ring')]), commanders: ['no-such-commander'] };
    const s = summarizeDeck(junk, db);
    expect(s.cardCount).toBe(5); // unknown cards still take deck slots
    expect(s.landCount).toBe(0);
    expect(allFinite(s)).toBe(true);
  });

  it('counts axis members at strength >= 0.5', () => {
    const s = summarizeDeck(fixtureDeck('upgraded', 3), db);
    expect(s.axisTotals['typal:elf']?.e ?? 0).toBeGreaterThanOrEqual(15);
  });
});

describe('resolveThemeWeights', () => {
  it('derives from the commander, and prefers explicit deck weights', () => {
    const lathril = deck(['Lathril, Blade of the Elves'], []);
    expect(resolveThemeWeights(lathril, ctx)['typal:elf']).toBe(1);
    expect(resolveThemeWeights({ ...lathril, themeWeights: { lifegain: 0.7 } }, ctx)).toEqual({ lifegain: 0.7 });
    expect(resolveThemeWeights(EMPTY, ctx)).toEqual({});
  });
});

describe('targetsFor', () => {
  const bands = (target: Bracket, d: Deck = fixtureDeck('precon', target)) => targetsFor(d, ctx, summarizeDeck(d, db));

  it('uses the bracket bands of deck-theory §2.3', () => {
    const t2 = targetsFor(EMPTY, ctx, summarizeDeck(EMPTY, db));
    const b2 = targetsFor({ ...EMPTY, targetBracket: 2 }, ctx, summarizeDeck(EMPTY, db));
    expect(b2.roles.ramp).toEqual({ lo: 9, hi: 12 });
    expect(b2.roles.draw).toEqual({ lo: 9, hi: 12 });
    expect(b2.roles.wipe).toEqual({ lo: 2, hi: 5 });
    expect(b2.roles.tutor).toEqual({ lo: 0, hi: 3 });
    expect(b2.avgMv).toEqual({ lo: 2.9, hi: 3.5 });
    expect(b2.taplandCap).toBe(10);
    expect(b2.themeCards).toBe(25);
    expect(t2.roles.ramp).toEqual({ lo: 10, hi: 13 }); // EMPTY targets bracket 3
    const b5 = targetsFor({ ...EMPTY, targetBracket: 5 }, ctx, summarizeDeck(EMPTY, db));
    expect(b5.roles.tutor).toEqual({ lo: 8, hi: 14 });
    expect(b5.taplandCap).toBe(1);
  });

  it('sets a land target inside the bracket range, lower for higher brackets', () => {
    const p2 = bands(2).lands;
    const p5 = bands(5).lands;
    expect(p2).toBeGreaterThanOrEqual(36);
    expect(p2).toBeLessThanOrEqual(39); // held inside the §2.3 band, whatever the regression says
    expect(p5).toBeLessThan(p2);
    const c5 = bands(5, fixtureDeck('cedh', 5)).lands;
    expect(c5).toBeGreaterThanOrEqual(26);
    expect(c5).toBeLessThanOrEqual(30);
    const empty = targetsFor(EMPTY, ctx, summarizeDeck(EMPTY, db)).lands;
    expect(empty).toBeGreaterThanOrEqual(35);
    expect(empty).toBeLessThanOrEqual(40);
  });

  it('only gives a counterspell band to decks that can run blue', () => {
    const green = deck(['Wilson, Refined Grizzly'], []);
    const blue = deck(['Talrand, Sky Summoner'], []);
    expect(targetsFor(green, ctx, summarizeDeck(green, db)).roles.counterspell).toBeUndefined();
    expect(targetsFor(blue, ctx, summarizeDeck(blue, db)).roles.counterspell).toBeDefined();
  });

  it('applies archetype deltas for axes weighted >= 0.6 and ignores weaker ones', () => {
    const base = deck(['Wilson, Refined Grizzly'], [], { themeWeights: {} });
    const plain = targetsFor(base, ctx, summarizeDeck(base, db));
    const withTheme = (themeWeights: Record<string, number>) => {
      const d = { ...base, themeWeights };
      return targetsFor(d, ctx, summarizeDeck(d, db));
    };
    const landfall = withTheme({ landfall: 1 });
    expect(landfall.lands).toBeGreaterThanOrEqual(plain.lands + 3);
    const tokens = withTheme({ tokens: 0.6 });
    expect(tokens.roles.wipe!.hi).toBe(plain.roles.wipe!.hi - 2);
    expect(tokens.roles.wipe!.lo).toBe(0);
    expect(tokens.roles.protection!.lo).toBe(plain.roles.protection!.lo + 2);
    expect(tokens.roles.draw!.lo).toBe(plain.roles.draw!.lo + 1);
    expect(withTheme({ tokens: 0.5, landfall: 0.59 })).toEqual(plain);
    const voltron = withTheme({ voltron: 1 });
    expect(voltron.avgMv.hi).toBeLessThanOrEqual(2.8);
    expect(voltron.avgMv.lo).toBeLessThanOrEqual(voltron.avgMv.hi);
    const typal = withTheme({ 'typal:elf': 1, typal: 1 });
    expect(typal.roles.wipe!.hi).toBe(plain.roles.wipe!.hi - 1); // one archetype, applied once
  });

  it('keeps every band ordered and non-negative for every bracket and stacked themes', () => {
    for (const b of [1, 2, 3, 4, 5] as Bracket[]) {
      const d = deck(['Talrand, Sky Summoner'], [], { targetBracket: b, themeWeights: { tokens: 1, voltron: 1, counters: 1, 'typal:elf': 1, landfall: 1 } });
      const t = targetsFor(d, ctx, summarizeDeck(d, db));
      expect(allFinite(t)).toBe(true);
      for (const [role, band] of Object.entries(t.roles) as [Role, { lo: number; hi: number }][]) {
        expect(band.lo, role).toBeGreaterThanOrEqual(0);
        expect(band.hi, role).toBeGreaterThanOrEqual(Math.max(1, band.lo));
      }
      expect(t.roles.land).toBeUndefined();
    }
  });
});

describe('scaleTargets', () => {
  const d = fixtureDeck('precon', 2);
  const full = targetsFor(d, ctx, summarizeDeck(d, db));

  it('is the identity at 100 cards and beyond', () => {
    expect(scaleTargets(full, 100)).toEqual(full);
    expect(scaleTargets(full, 120)).toEqual(full);
  });
  it('scales counts linearly and leaves average mana value alone', () => {
    const half = scaleTargets(full, 50);
    expect(Math.abs(half.lands - full.lands / 2)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(half.roles.ramp!.lo - full.roles.ramp!.lo / 2)).toBeLessThanOrEqual(0.5);
    expect(half.roles.ramp!.hi).toBeGreaterThanOrEqual(half.roles.ramp!.lo);
    expect(half.avgMv).toEqual(full.avgMv);
    expect(Math.abs(half.themeCards - full.themeCards / 2)).toBeLessThanOrEqual(0.5);
  });
  it('returns zeros, not NaN, for 0, negative or NaN card counts', () => {
    for (const n of [0, -5, Number.NaN]) {
      const t = scaleTargets(full, n);
      expect(allFinite(t)).toBe(true);
      expect(t.lands).toBe(0);
      expect(t.roles.ramp!.lo).toBe(0);
    }
  });
  it('does not mutate its input', () => {
    const copy = JSON.parse(JSON.stringify(full));
    scaleTargets(full, 37);
    expect(full).toEqual(copy);
  });
});
