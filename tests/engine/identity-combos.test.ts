import { describe, expect, it } from 'vitest';
import { COMBO_TAG, identityCombos } from '@/engine/brackets';
import type { Deck } from '@/engine/types';
import { card, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const shell = (...names: string[]): Deck => ({
  id: null, name: '', commanders: names.map((n) => card(n).oracleId), companion: null, chosenColor: null, main: [], targetBracket: 3, themeWeights: null,
});
const identity = (id: string) => db.get(id)?.colorIdentity ?? [];

describe('identityCombos', () => {
  it('fit the commander\'s identity and the commander\'s own come first', () => {
    const found = identityCombos(shell('Krenko, Mob Boss'), db);
    const krenko = card('Krenko, Mob Boss').oracleId;
    expect(found.length).toBeGreaterThan(0);
    for (const f of found) {
      expect(f.combo.requiresCount).toBe(0);
      for (const p of f.combo.cards) {
        expect(identity(p.oracleId).every((c) => c === 'R')).toBe(true);
        if (p.mustBeCommander) expect(p.oracleId).toBe(krenko);
      }
    }
    expect(found[0].combo.cards.some((p) => p.oracleId === krenko)).toBe(true);
    expect(found.some((f) => f.combo.id === '659-4050-4068')).toBe(true);
  });
  it('a colourless commander gets colourless combos only', () => {
    for (const f of identityCombos(shell('Kozilek, the Great Distortion'), db)) for (const p of f.combo.cards) expect(identity(p.oracleId)).toEqual([]);
  });
  it('partners: combos may use both identities', () => {
    for (const f of identityCombos(shell('Tymna the Weaver', 'Thrasios, Triton Hero'), db)) {
      for (const p of f.combo.cards) expect(identity(p.oracleId).every((c) => ['W', 'U', 'B', 'G'].includes(c))).toBe(true);
    }
  });
  it('has no combos without a commander', () => {
    expect(identityCombos(shell(), db)).toEqual([]);
  });
});

describe('COMBO_TAG', () => {
  it('maps every tag to a bracket', () => {
    expect(Object.fromEntries(Object.entries(COMBO_TAG).map(([k, v]) => [k, v.bracket]))).toEqual({ R: 4, S: 3, P: 3, O: 2, C: 2, E: 1 });
    expect(COMBO_TAG.R.label).toBe('Ruthless');
  });
});
