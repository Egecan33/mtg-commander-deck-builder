import { describe, expect, it } from 'vitest';
import { arrangeRecs } from '@/app/commander/[slug]/arrange';
import type { CardLookup, RecSection } from '@/app/lib/api';
import { ROLE_GROUPS } from '@/app/lib/ui';
import type { CardScore } from '@/engine/types';

const mk = (id: string, name: string, roles: string[], priceUsd: number | null) =>
  ({ oracleId: id, name, frontName: name, manaCost: '', cmc: 1, typeLine: 'Artifact', colorIdentity: [], imageFaces: 1, gameChanger: false, priceUsd, roles, owned: false }) as unknown as CardLookup[string];
const lookup: CardLookup = {
  a: mk('a', 'Cultivate', ['ramp'], 1), b: mk('b', 'Brainstorm', ['draw'], null), c: mk('c', 'Wrath', ['wipe'], 5), d: mk('d', 'Zebra', [], 0.5), e: mk('e', 'Forest', ['land'], 0.1),
};
const sc = (n: number) => ({ score: n }) as CardScore;
const scores = { a: sc(70), b: sc(90), c: sc(50), d: sc(50), e: sc(10) };
const rc = (id: string, synergy = 0) => ({ oracleId: id, synergy, quality: 0 });
const sections: RecSection[] = [
  { id: 'top', title: 'Top cards', total: 3, cards: [rc('a', 10), rc('b', 30), rc('c', 20)] },
  { id: 'synergy', title: 'High synergy', total: 2, cards: [rc('b', 30), rc('d', 5)] },
  { id: 'lands', title: 'Lands', total: 0, cards: [], empty: 'No card fits here.' },
  { id: 'creatures', title: 'Creatures', total: 1, cards: [rc('e')] },
];
const ids = (s: { cards: { oracleId: string }[] }) => s.cards.map((c) => c.oracleId);

describe('arrangeRecs', () => {
  it('none gives every card once', () => {
    const [all] = arrangeRecs(sections, lookup, scores, 'none', 'score');
    expect(all.id).toBe('all');
    expect(ids(all)).toEqual(['b', 'a', 'c', 'd', 'e']);
    expect(all.total).toBe(5);
  });
  it('role groups follow ROLE_GROUPS and hold each card once', () => {
    const out = arrangeRecs(sections, lookup, scores, 'role', 'name');
    const titles = out.map((s) => s.title);
    expect(titles).toEqual(ROLE_GROUPS.filter((g) => titles.includes(g)));
    expect(out.flatMap(ids).sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(out[0].id).toBe('role-ramp');
  });
  it('price sort puts unpriced cards last', () => {
    const [all] = arrangeRecs(sections, lookup, scores, 'none', 'price');
    expect(ids(all)).toEqual(['e', 'd', 'a', 'c', 'b']);
  });
  it('name sort is alphabetical', () => {
    expect(ids(arrangeRecs(sections, lookup, scores, 'none', 'name')[0])).toEqual(['b', 'a', 'e', 'c', 'd']);
  });
  it('category keeps the server sections and their empty sentences', () => {
    const out = arrangeRecs(sections, lookup, scores, 'category', 'synergy');
    expect(out.map((s) => s.id)).toEqual(['top', 'synergy', 'lands', 'creatures']);
    expect(out[2].empty).toBe('No card fits here.');
    expect(ids(out[0])).toEqual(['b', 'c', 'a']);
  });
});
