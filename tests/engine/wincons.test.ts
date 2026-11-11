import { describe, expect, it } from 'vitest';
import { autoBuild } from '@/engine/builder';
import { rateDeck } from '@/engine/rating';
import { summarizeDeck } from '@/engine/summary';
import { targetsFor } from '@/engine/targets';
import type { Bracket, Deck, EngineContext } from '@/engine/types';
import { card, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const shell = (name: string, target: Bracket): Deck => ({
  id: null, name, commanders: [card(name).oracleId], companion: null, chosenColor: null, main: [], targetBracket: target, themeWeights: null,
});
const band = (d: Deck) => targetsFor(d, ctx, summarizeDeck(d, db)).roles['win-condition'];
const winCount = (d: Deck) => d.main.reduce((n, e) => n + (db.features(e.oracleId)?.roles.includes('win-condition') ? e.qty : 0), 0);

describe('win-condition targets', () => {
  it('asks for 4-6 at Brackets 1-4 and stays compact at Bracket 5', () => {
    for (const b of [1, 2, 3, 4] as Bracket[]) {
      const w = band(shell('Krenko, Mob Boss', b));
      expect(w?.lo, `B${b}`).toBe(4);
      expect(w?.hi, `B${b}`).toBeGreaterThanOrEqual(6);
      expect(w?.hi, `B${b}`).toBeLessThanOrEqual(8);
    }
    expect(band(shell('Krenko, Mob Boss', 3))).toEqual({ lo: 4, hi: 6 });
    expect(band(shell('Krenko, Mob Boss', 5))).toEqual({ lo: 2, hi: 4 });
  });

  it('a wanted count set on the deck replaces the band for every reader of the targets', () => {
    const d = { ...shell('Krenko, Mob Boss', 3), roleTargets: { 'win-condition': 7, land: 33 } };
    const t = targetsFor(d, ctx, summarizeDeck(d, db));
    expect(t.roles['win-condition']).toEqual({ lo: 7, hi: 9 });
    expect(t.lands).toBe(33);
  });

  for (const name of ['Lathril, Blade of the Elves', "Atraxa, Praetors' Voice"]) {
    it(`an auto-build for ${name} at Bracket 3 holds at least 4 win conditions`, () => {
      const deck = autoBuild(shell(name, 3), ctx, { ownedOnly: false, owned: null, maxPriceUsd: null, seed: 1 });
      expect(winCount(deck)).toBeGreaterThanOrEqual(4);
    });
  }

  it('roleTargets changes the builder count and the rating fix text', () => {
    const base = shell('Lathril, Blade of the Elves', 3);
    const built = autoBuild(base, ctx, { ownedOnly: false, owned: null, maxPriceUsd: null, seed: 1 });
    const wanted = autoBuild({ ...base, roleTargets: { 'win-condition': 6 } }, ctx, { ownedOnly: false, owned: null, maxPriceUsd: null, seed: 1 });
    expect(winCount(wanted)).toBeGreaterThanOrEqual(6);
    expect(winCount(wanted)).toBeGreaterThan(Math.min(5, winCount(built)));
    // The same built deck, asked for 9: the rating now says it is short, with the new numbers.
    const r = rateDeck({ ...built, roleTargets: { 'win-condition': 9 } }, ctx);
    const fix = r.subscores.find((s) => s.key === 'wincons')?.fixes.find((f) => /short on win conditions/.test(f.text));
    expect(fix?.text).toMatch(/want 9-11/);
    expect(rateDeck(built, ctx).subscores.find((s) => s.key === 'wincons')?.fixes.some((f) => /short on win conditions/.test(f.text))).toBe(false);
  });

  it('classifies finishers: overruns, extra combats and drain engines, but not ordinary value cards', () => {
    const roles = (n: string) => db.features(card(n).oracleId)?.roles ?? [];
    for (const n of ['Craterhoof Behemoth', 'Overwhelming Stampede', 'Triumph of the Hordes', 'Torment of Hailfire', 'Exsanguinate', "Thassa's Oracle",
      'Aggravated Assault', 'Relentless Assault', 'Beastmaster Ascension']) {
      expect(roles(n), n).toContain('win-condition');
    }
    // One creature attacking again, and a drain that needs a board to matter, are not finishers by themselves.
    for (const n of ['Sol Ring', 'Elvish Archdruid', 'Time Warp', 'Wrath of God', 'Seize the Day', 'Gray Merchant of Asphodel']) expect(roles(n), n).not.toContain('win-condition');
  });
});
