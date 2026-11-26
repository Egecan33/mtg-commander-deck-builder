import type { NetworkEdge, NetworkEdgeKind, NetworkNode } from '@/engine/types';

/** Edge colours are the app's own tokens (ruling D19): ember stays reserved for "!". */
export const EDGE_COLOR: Record<NetworkEdgeKind, string> = {
  combo: '#d6ab52',
  feeds: '#efe7d7',
  typal: '#a79d8b',
  commander: '#7d7566',
};
export const EDGE_LABEL: Record<NetworkEdgeKind, string> = { combo: 'Combo', feeds: 'Feeds', typal: 'Typal', commander: 'Commander' };
export const EDGE_KINDS: readonly NetworkEdgeKind[] = ['combo', 'feeds', 'typal', 'commander'];

/** 1, 2 or 3 px: commander spokes stay thin, the rest by weight. */
export function edgeWidth(e: NetworkEdge): 1 | 2 | 3 {
  if (e.kind === 'commander') return 1;
  return e.weight < 0.34 ? 1 : e.weight < 0.67 ? 2 : 3;
}

export const edgeOpacity = (kind: NetworkEdgeKind): number => (kind === 'commander' ? 0.18 : kind === 'typal' ? 0.55 : 0.85);

/** Node radius in layout units: the commander is the biggest, cards that connect to nothing the smallest. */
export function nodeRadius(n: NetworkNode, maxDegree: number): number {
  if (n.commander) return 34;
  if (n.unconnected) return 8;
  return maxDegree > 0 ? 10 + 18 * Math.sqrt(Math.max(0, n.degree) / maxDegree) : 10;
}

/** The square at the centre of the art box the deck tiles crop, in texture coordinates. */
export const ART_BOX = { u: 0.194, v: 0.45, w: 0.613, h: 0.44 };

/** The three strongest reasons touching a card, read from its own side. */
export function nodeReasons(id: string, edges: NetworkEdge[]): string[] {
  return edges
    .filter((e) => e.a === id || e.b === id)
    .sort((p, q) => q.weight - p.weight || (p.kind < q.kind ? -1 : 1))
    .slice(0, 3)
    .map((e) => (e.a === id ? e.reasons[0] : e.reasons[1]));
}

export const maxDegreeOf = (nodes: NetworkNode[]): number => nodes.reduce((m, n) => (n.commander ? m : Math.max(m, n.degree)), 0);
