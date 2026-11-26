import { COLOR_ORDER, ROLE_LABEL, TYPE_GROUPS, typeGroup } from '@/app/lib/ui';
import type { AnalyzeResponse } from '@/app/lib/api';
import type { ColorLetter } from '@/app/lib/api';
import type { Deck, Role, RoleBand } from '@/engine/types';

export interface ChartData {
  curve: { mv: string; count: number }[];
  avgMv: number;
  avgBand: RoleBand;
  types: { label: string; count: number }[];
  roles: { role: Role; label: string; count: number; band: RoleBand }[];
  sources: { color: ColorLetter; count: number }[];
  odds: { label: string; hits: number }[];
}

const ODDS: { label: string; roles: Role[] }[] = [
  { label: 'Ramp', roles: ['ramp', 'fast-mana'] },
  { label: 'Card draw', roles: ['draw'] },
  { label: 'Removal', roles: ['spot-removal', 'wipe', 'counterspell'] },
  { label: 'Protection', roles: ['protection'] },
];

/** The numbers the Charts tab draws, from a deck and its analysis (the scorer's own summary and targets). */
export function chartData(deck: Deck, a: Pick<AnalyzeResponse, 'summary' | 'targets' | 'cards'>): ChartData {
  const curve = a.summary.curve.map((count, i) => ({ mv: i >= 7 ? '7+' : String(i), count }));
  const typeCounts = new Map<string, number>();
  for (const e of deck.main) {
    const card = a.cards[e.oracleId];
    if (card) typeCounts.set(typeGroup(card.typeLine), (typeCounts.get(typeGroup(card.typeLine)) ?? 0) + e.qty);
  }
  const types = TYPE_GROUPS.filter((g) => (typeCounts.get(g) ?? 0) > 0).map((label) => ({ label, count: typeCounts.get(label) as number }));
  const roles = (Object.entries(a.targets.roles) as [Role, RoleBand][]).map(([role, band]) => ({
    role, label: ROLE_LABEL[role] ?? role, count: a.summary.roleCounts[role] ?? 0, band,
  }));
  const identity = new Set<string>();
  for (const id of deck.commanders) for (const c of a.cards[id]?.colorIdentity ?? []) identity.add(c);
  const colors = COLOR_ORDER.filter((c) => c !== 'C' && identity.has(c));
  const sources = (colors.length ? colors : (['C'] as ColorLetter[])).map((color) => ({
    color, count: Math.round((a.summary.sources[color as keyof typeof a.summary.sources] ?? 0) * 10) / 10,
  }));
  const odds = ODDS.map(({ label, roles: wanted }) => {
    let hits = 0;
    for (const e of deck.main) {
      const card = a.cards[e.oracleId];
      if (card && card.roles.some((r) => wanted.includes(r))) hits += e.qty;
    }
    return { label, hits };
  });
  return { curve, avgMv: a.summary.avgMv, avgBand: a.targets.avgMv, types, roles, sources, odds };
}
