import { axisLabel } from '../features';
import { mulberry32 } from '../random';
import type { AxisId, CardDb, NetworkCluster, NetworkEdge, NetworkNode } from '../types';
import { ONE_AWAY_EDGE, round3, shortName } from './edges';

const MAX_ROUNDS = 20;
/**
 * The weakest edge that can pull two cards into one cluster: the one-away combo edge. Feeds edges
 * below it only say two cards touch the same axis, and with 12 of them per card they chain every
 * card of a big axis into one blob.
 */
export const CLUSTER_MIN_EDGE = ONE_AWAY_EDGE;

function labelOf(edge: NetworkEdge): string {
  return edge.kind === 'combo' ? `combo:${edge.comboId ?? ''}` : (edge.axis ?? `${edge.kind}:${edge.a}|${edge.b}`);
}

/**
 * Groups of cards that work together: weighted label propagation over the combo, feeds and typal
 * edges of at least CLUSTER_MIN_EDGE between non-commander cards (never a commander spoke). The same seed gives the same groups.
 */
export function clusterNetwork(nodes: NetworkNode[], edges: NetworkEdge[], db: CardDb, seed: number): NetworkCluster[] {
  const commanders = new Set(nodes.filter((n) => n.commander).map((n) => n.oracleId));
  const real = nodes.filter((n) => !n.commander).map((n) => n.oracleId).sort();
  const inner: NetworkEdge[] = [];
  for (const e of edges) {
    // theme edges only: never a commander spoke, never a functional package's `package` edge
    if (e.kind === 'commander' || e.kind === 'package' || e.weight < CLUSTER_MIN_EDGE) continue;
    if (commanders.has(e.a) || commanders.has(e.b)) continue;
    inner.push(e);
  }
  const adj = new Map<string, { id: string; weight: number }[]>();
  const strongest = new Map<string, NetworkEdge>();
  const link = (x: string, y: string, e: NetworkEdge) => {
    (adj.get(x) ?? adj.set(x, []).get(x)!).push({ id: y, weight: e.weight });
    const prev = strongest.get(x);
    if (!prev || e.weight > prev.weight || (e.weight === prev.weight && labelOf(e) < labelOf(prev))) strongest.set(x, e);
  };
  for (const e of inner) { link(e.a, e.b, e); link(e.b, e.a, e); }

  const label = new Map<string, string>();
  for (const id of real) {
    const s = strongest.get(id);
    if (s) label.set(id, labelOf(s));
  }
  const rng = mulberry32(seed);
  const order = [...real];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let changed = false;
    for (const id of order) {
      const sums = new Map<string, number>();
      for (const nb of adj.get(id) ?? []) {
        const l = label.get(nb.id);
        if (l !== undefined) sums.set(l, (sums.get(l) ?? 0) + nb.weight);
      }
      if (sums.size === 0) continue;
      const own = label.get(id);
      let top = -1;
      for (const w of sums.values()) if (w > top) top = w;
      let pick: string | undefined;
      if (own !== undefined && sums.get(own) === top) pick = own;
      else for (const [l, w] of sums) if (w === top && (pick === undefined || l < pick)) pick = l;
      if (pick !== undefined && pick !== own) { label.set(id, pick); changed = true; }
    }
    if (!changed) break;
  }

  const groups = new Map<string, string[]>();
  for (const id of real) {
    const l = label.get(id);
    if (l !== undefined) (groups.get(l) ?? groups.set(l, []).get(l)!).push(id);
  }
  const weightOf = (key: string, ids: string[]): number => {
    const set = new Set(ids);
    let w = 0;
    for (const e of inner) if (set.has(e.a) && set.has(e.b)) w += e.weight;
    return round3(w);
  };
  const live = [...groups.entries()].filter(([, ids]) => ids.length >= 2).map(([key, ids]) => ({ key, ids, weight: weightOf(key, ids) }));
  live.sort((p, q) => q.ids.length - p.ids.length || q.weight - p.weight || p.key.localeCompare(q.key));
  return live.map(({ key, ids, weight }, id) => ({ id, key, name: clusterName(key, ids, db), cards: ids, weight }));
}

function clusterName(key: string, ids: string[], db: CardDb): string {
  if (!key.startsWith('combo:')) return axisLabel(key as AxisId);
  const comboId = key.slice(6);
  let best: { rank: number; name: string } | null = null;
  for (const id of ids) {
    const card = db.get(id);
    if (!card || !db.combosFor(id).some((c) => c.id === comboId)) continue;
    const rank = card.edhrecRank !== null && card.edhrecRank >= 1 ? card.edhrecRank : Number.POSITIVE_INFINITY;
    if (!best || rank < best.rank) best = { rank, name: shortName(card) };
  }
  return `${best?.name ?? 'Unnamed'} combo`;
}
