import type { CardScore } from '@/engine/types';
import type { CardLookup, RecCard, RecSection } from '@/app/lib/api';
import { ROLE_GROUPS, roleGroup } from '@/app/lib/ui';

export type GroupBy = 'category' | 'role' | 'none';
export type RecSort = 'score' | 'synergy' | 'price' | 'name';
/** A section as the page shows it: the server's, or one made by regrouping (`role-ramp`, `all`). */
export type ArrangedSection = Omit<RecSection, 'id'> & { id: string };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Regroups the recs for the page's "group by" and sorts each group. The sort is stable, so ties keep the server's order. */
export function arrangeRecs(
  sections: RecSection[], lookup: CardLookup, scores: Record<string, CardScore>, groupBy: GroupBy, sort: RecSort,
): ArrangedSection[] {
  const nameOf = (c: RecCard) => lookup[c.oracleId]?.name ?? '';
  const price = (c: RecCard) => lookup[c.oracleId]?.priceUsd ?? null;
  const sortCards = (cards: RecCard[]): RecCard[] => {
    const by: Record<RecSort, (a: RecCard, b: RecCard) => number> = {
      score: (a, b) => (scores[b.oracleId]?.score ?? 0) - (scores[a.oracleId]?.score ?? 0),
      synergy: (a, b) => b.synergy - a.synergy,
      price: (a, b) => {
        const x = price(a);
        const y = price(b);
        return x === null ? (y === null ? 0 : 1) : y === null ? -1 : x - y;
      },
      name: (a, b) => nameOf(a).localeCompare(nameOf(b)),
    };
    return [...cards].sort(by[sort]);
  };
  if (groupBy === 'category') return sections.map((s) => ({ ...s, cards: sortCards(s.cards) }));

  const seen = new Set<string>();
  const unique: RecCard[] = [];
  for (const s of sections) for (const c of s.cards) if (!seen.has(c.oracleId)) (seen.add(c.oracleId), unique.push(c));
  if (groupBy === 'none') return [{ id: 'all', title: 'All cards', total: unique.length, cards: sortCards(unique) }];

  const groups = new Map<string, RecCard[]>();
  for (const c of unique) {
    const card = lookup[c.oracleId];
    const g = card ? roleGroup(card) : 'Theme and everything else';
    groups.set(g, [...(groups.get(g) ?? []), c]);
  }
  return ROLE_GROUPS.filter((g) => groups.has(g)).map((g) => {
    const cards = groups.get(g) as RecCard[];
    return { id: `role-${slug(g)}`, title: g, total: cards.length, cards: sortCards(cards) };
  });
}
