import { describe, expect, it } from 'vitest';
import { chartData } from '@/app/commander/[slug]/charts-data';
import type { AnalyzeResponse, CardLookup } from '@/app/lib/api';
import type { Deck } from '@/engine/types';

const card = (id: string, typeLine: string, roles: string[] = [], colorIdentity: string[] = []) =>
  ({ oracleId: id, name: id, frontName: id, manaCost: '', cmc: 1, typeLine, colorIdentity, imageFaces: 1, gameChanger: false, priceUsd: 1, roles, owned: false }) as unknown as CardLookup[string];
const cards: CardLookup = {
  k: card('k', 'Legendary Creature', [], ['R']),
  a: card('a', 'Creature', ['draw']), b: card('b', 'Instant', ['spot-removal', 'wipe']), c: card('c', 'Artifact', ['ramp']), d: card('d', 'Basic Land', ['land']),
};
const deck = (commanders: string[]): Deck => ({
  id: null, name: '', commanders, companion: null, chosenColor: null, targetBracket: 3, themeWeights: null,
  main: [{ oracleId: 'a', qty: 3, locked: false }, { oracleId: 'b', qty: 2, locked: false }, { oracleId: 'c', qty: 1, locked: false }, { oracleId: 'd', qty: 4, locked: false }],
});
const analysis = (over: Record<string, unknown> = {}) => ({
  summary: { curve: [1, 2, 3, 4, 5, 6, 7, 8], avgMv: 2.5, roleCounts: { ramp: 1, draw: 3, 'spot-removal': 2 }, sources: { W: 1, U: 2, B: 3, R: 4.04, G: 5, C: 6 } },
  targets: { avgMv: { lo: 2, hi: 3 }, roles: { ramp: { lo: 8, hi: 10 }, draw: { lo: 2, hi: 4 } } },
  cards, ...over,
}) as unknown as Parameters<typeof chartData>[1];

describe('chartData', () => {
  it('card types add up to the main deck', () => {
    const d = chartData(deck(['k']), analysis());
    expect(d.types.reduce((n, t) => n + t.count, 0)).toBe(10);
    expect(d.types.map((t) => t.label)).toEqual(['Creatures', 'Instants', 'Artifacts', 'Lands']);
  });
  it('roles carry the targets\' bands', () => {
    const d = chartData(deck(['k']), analysis());
    expect(d.roles.map((r) => [r.role, r.count, r.band])).toEqual([['ramp', 1, { lo: 8, hi: 10 }], ['draw', 3, { lo: 2, hi: 4 }]]);
  });
  it('a card with two removal roles counts once', () => {
    expect(chartData(deck(['k']), analysis()).odds.find((o) => o.label === 'Removal')?.hits).toBe(2);
  });
  it('a colourless deck has only colourless sources', () => {
    const c = { ...cards, k: card('k', 'Legendary Creature') };
    expect(chartData(deck(['k']), analysis({ cards: c })).sources).toEqual([{ color: 'C', count: 6 }]);
    expect(chartData(deck(['k']), analysis()).sources).toEqual([{ color: 'R', count: 4 }]);
  });
  it('the curve has eight buckets ending in 7+', () => {
    const d = chartData(deck(['k']), analysis());
    expect(d.curve).toHaveLength(8);
    expect(d.curve[7].mv).toBe('7+');
    expect(d.curve[0].mv).toBe('0');
  });
});
