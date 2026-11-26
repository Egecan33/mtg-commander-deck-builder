import { describe, expect, it } from 'vitest';
import { autoBuild } from '@/engine/builder';
import { commanderThemeWeights } from '@/engine/features';
import { focusThemeWeights, resolveThemeWeights, themeFocus } from '@/engine/summary';
import type { Bracket, Deck, EngineContext } from '@/engine/types';
import { card, fixtureDb } from '../helpers/fixture-db';
import { fixtureDeck } from '../helpers/network';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const alone = (name: string, bracket: Bracket = 3): Deck => ({
  id: null, name, commanders: [card(name).oracleId], companion: null, chosenColor: null, main: [], targetBracket: bracket, themeWeights: null,
});
const raw = (name: string) => commanderThemeWeights([card(name)]);
const resolved = (name: string) => resolveThemeWeights(alone(name), ctx);

describe('theme focus', () => {
  it("keeps the commander's top two axes and its named type, and scales the rest by 0.25", () => {
    const r = raw('Lathril, Blade of the Elves');
    const w = resolved('Lathril, Blade of the Elves');
    expect(w['typal:elf']).toBe(1);
    expect(w.tokens).toBe(0.8);
    expect(w.typal).toBe(0.8);
    for (const [axis, v] of Object.entries(r)) {
      if (['typal:elf', 'tokens', 'typal'].includes(axis)) continue;
      expect(w[axis], axis).toBeCloseTo(v * 0.25, 6);
    }
    expect(w.lifegain).toBeCloseTo(0.1, 6);
    expect(w.attack).toBeCloseTo(0.075, 6);
    expect(w.evasion).toBeCloseTo(0.075, 6);
    expect(w['typal:noble']).toBeCloseTo(0.075, 6);
    expect(themeFocus(r).axes).toEqual(['tokens', 'typal', 'typal:elf']);
  });

  it('ties at the cut are all kept', () => {
    const w = resolved('Leonardo, the Balance');
    expect(w.tokens).toBe(1);
    expect(w.counters).toBe(0.8);
    expect(w.evasion).toBe(0.8);
    expect(w.attack).toBeCloseTo(0.1, 6);
    expect(w.lifegain).toBeCloseTo(0.075, 6);
  });

  it('a commander that names several creature types keeps all of them', () => {
    const r = raw('Kaheera, the Orphanguard');
    const w = resolved('Kaheera, the Orphanguard');
    const types = Object.keys(r).filter((a) => a.startsWith('typal:'));
    expect(types).toHaveLength(5);
    for (const a of types) expect(w[a]).toBe(1);
    expect(w.typal).toBe(0.8);
  });

  it('the inferred dragon theme is kept', () => {
    const w = resolveThemeWeights(fixtureDeck('precon', 2), ctx);
    expect(w['typal:dragon']).toBe(1);
    expect(w.typal).toBe(0.8);
  });

  it("a deck's own weights come back untouched", () => {
    const own = { tokens: 1, counters: 0.9, lifegain: 0.8, attack: 0.7 };
    const deck = { ...alone('Lathril, Blade of the Elves'), themeWeights: own };
    expect(resolveThemeWeights(deck, ctx)).toEqual(own);
    expect(themeFocus(own).focused).toBe(false);
  });

  it('focusing twice changes nothing', () => {
    const own = { tokens: 1, counters: 0.9, lifegain: 0.8, attack: 0.7 };
    for (const w of [raw('Lathril, Blade of the Elves'), raw('Leonardo, the Balance'), raw('Grizzlegom, Hurloon Hero'), own]) {
      const once = focusThemeWeights(w);
      expect(focusThemeWeights(once)).toEqual(once);
      expect(themeFocus(once).focused).toBe(true);
    }
  });

  it('a commander with five weak axes builds a deck whose top two axes hold most of its theme cards', () => {
    const name = 'Grizzlegom, Hurloon Hero';
    const rawWeights = raw(name);
    const opts = { ownedOnly: false, owned: null, maxPriceUsd: null, seed: 1 };
    const share = (deck: Deck) => {
      let theme = 0;
      let top = 0;
      for (const e of deck.main) {
        const f = db.features(e.oracleId);
        if (!f) continue;
        const on = (axis: string) => Math.max(f.axes[axis]?.e ?? 0, f.axes[axis]?.p ?? 0) >= 0.5;
        const axes = Object.keys(rawWeights).filter((a) => a !== 'typal' && !a.startsWith('typal:') && on(a));
        if (f.landWeight >= 1 || axes.length === 0) continue;
        theme += e.qty;
        if (on('tokens') || on('big-mana')) top += e.qty;
      }
      return top / Math.max(1, theme);
    };
    const focused = autoBuild(alone(name), ctx, opts);
    const unfocused = autoBuild({ ...alone(name), themeWeights: rawWeights }, ctx, opts);
    expect(share(focused)).toBeGreaterThan(0.5);
    expect(share(focused)).toBeGreaterThanOrEqual(share(unfocused));
  });
});
