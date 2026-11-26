import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as combosRoute from '@/app/api/commander/[slug]/combos/route';
import * as similarRoute from '@/app/api/commander/[slug]/similar/route';
import type { CommanderCombosResponse, SimilarResponse } from '@/app/lib/api';
import type { Card } from '@/engine/types';
import { replaceCollection } from '@/server/collection';
import { commanderIndex } from '@/server/commander-index';
import { rankSimilar, themeSimilarity } from '@/server/commander-similar';
import { getCardDb } from '@/server/store';
import { callRoute, seedDb, useServerDb } from './server-db';

beforeAll(() => useServerDb(seedDb()), 60_000);
afterAll(() => useServerDb(null));

const card = (name: string) => getCardDb().byName(name) as Card;
const similar = async (slug: string): Promise<SimilarResponse> => (await callRoute(similarRoute, `/api/commander/${slug}/similar`, { slug })).json() as Promise<SimilarResponse>;
const combos = async (slug: string, q = ''): Promise<CommanderCombosResponse> => (await callRoute(combosRoute, `/api/commander/${slug}/combos${q}`, { slug })).json() as Promise<CommanderCombosResponse>;

describe('the similarity formula', () => {
  it('compares theme weights', () => {
    expect(themeSimilarity({ tokens: 1, counters: 0.5 }, { tokens: 0.5, lifegain: 0.5 })).toBe(0.25);
    expect(themeSimilarity({ tokens: 1 }, { tokens: 1 })).toBe(1);
    expect(themeSimilarity({}, {})).toBe(0);
    expect(themeSimilarity({ typal: 1 }, { typal: 1 })).toBe(0);
  });
});

describe('similar commanders', () => {
  it('are within one colour and ranked by theme likeness', async () => {
    const r = await similar('lathril-blade-of-the-elves');
    expect(r.basis).toBe('themes');
    expect(r.commanders.length).toBeGreaterThan(0);
    let last = Infinity;
    for (const c of r.commanders) {
      const diff = ['B', 'G'].filter((x) => !c.colorIdentity.includes(x as 'B')).length + c.colorIdentity.filter((x) => !['B', 'G'].includes(x)).length;
      expect(diff).toBeLessThanOrEqual(1);
      expect(c.colorsOff).toBe(diff);
      expect(c.similarity).toBeGreaterThan(0);
      expect(c.similarity as number).toBeLessThanOrEqual(1);
      const rank = (c.similarity as number) * (c.colorsOff ? 0.85 : 1);
      expect(rank).toBeLessThanOrEqual(last + 1e-9);
      last = rank;
      expect(c.name).not.toContain('Lathril');
    }
    expect(r.commanders[0].lead).toContain('typal:elf');
  });

  it('of a colourless commander have at most one colour', async () => {
    for (const c of (await similar('kozilek-the-great-distortion')).commanders) expect(c.colorIdentity.length).toBeLessThanOrEqual(1);
  });

  it('fall back to the most played of its colours for a commander with no theme', () => {
    const base = card('Krenko, Mob Boss');
    const mk = (id: string, rank: number, ci: Card['colorIdentity']) => ({ card: { ...base, oracleId: id, name: id, edhrecRank: rank, colorIdentity: ci }, weights: { tokens: 1 } });
    const out = rankSimilar({ ids: ['x'], identity: ['R'], weights: {} }, [mk('b', 5, ['R']), mk('a', 2, ['R']), mk('c', 1, ['R', 'G']), mk('d', 3, ['U'])], 24);
    expect(out.basis).toBe('popularity');
    expect(out.ranked.map((r) => r.card.oracleId)).toEqual(['a', 'b']);
    expect(out.ranked.every((r) => r.similarity === null && r.colorsOff === 0)).toBe(true);
  });

  it('are indexed for every commander', () => {
    expect(commanderIndex().entries.some((e) => e.lead.includes('typal:elf'))).toBe(true);
  });
});

describe('the combos route', () => {
  it('filters by bracket and collection', async () => {
    const low = await combos('krenko-mob-boss', '?bracket=1');
    for (const f of low.combos) expect(f.combo.bracketTag).toBe('E');
    const high = await combos('krenko-mob-boss', '?bracket=4');
    expect(high.combos.some((f) => f.combo.id === '659-4050-4068')).toBe(true);
    expect(high.total).toBeGreaterThanOrEqual(high.combos.length);
    for (const f of high.combos) for (const p of f.combo.cards) expect(high.cards[p.oracleId]).toBeDefined();
    replaceCollection('1 Krenko, Mob Boss\n1 Sol Ring');
    const mine = await combos('krenko-mob-boss', '?bracket=4&owned=1');
    expect(mine.combos.some((f) => f.combo.id === '659-4050-4068')).toBe(false);
    replaceCollection('');
  });
});
