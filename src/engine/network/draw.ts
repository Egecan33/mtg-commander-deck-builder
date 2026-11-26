import type { DeckNetwork, NetworkEdge, NetworkNode } from '../types';

/** Graphify's node and link shape: what the view draws and what "Export graph.json" writes. */
export interface GraphData {
  nodes: { id: string; name: string; group: number; val: number }[];
  links: { source: string; target: string; relation: string; weight: number; reason: string }[];
}

/** The network as Graphify's `{ nodes, links }`: group = cluster id (-1 for none), val = how connected. Every link, drawn or not. */
export function toGraphData(net: Pick<DeckNetwork, 'nodes' | 'edges'>, nameOf: (oracleId: string) => string): GraphData {
  return {
    nodes: net.nodes.map((n) => ({ id: n.oracleId, name: nameOf(n.oracleId), group: n.cluster ?? -1, val: Math.round((1 + n.degree) * 1000) / 1000 })),
    links: net.edges.map((e) => ({ source: e.a, target: e.b, relation: e.kind, weight: e.weight, reason: e.reasons[0] })),
  };
}

/**
 * What the network view draws, shared by the layout and both renderers. Plain code with no
 * d3-force-3d, so the deck page can import it without loading the layout (it is loaded on demand).
 */

/** Feeds links drawn per card: each card's strongest few (all of them still count in the numbers). */
export const DRAWN_FEEDS = 2;

/**
 * Indices of the edges the view draws: every combo, typal, commander and package link, and a feeds
 * link when it is among the `perNode` strongest feeds links of either of its cards. A dense deck
 * holds hundreds of feeds links; drawn all at once they make one white mass (controller finding U1).
 */
export function drawnEdges(edges: readonly NetworkEdge[], perNode = DRAWN_FEEDS): Set<number> {
  const out = new Set<number>();
  const feeds: number[] = [];
  edges.forEach((e, i) => (e.kind === 'feeds' ? feeds.push(i) : out.add(i)));
  feeds.sort((p, q) => edges[q].weight - edges[p].weight || p - q);
  const taken = new Map<string, number>();
  for (const i of feeds) {
    const e = edges[i];
    const ta = taken.get(e.a) ?? 0;
    const tb = taken.get(e.b) ?? 0;
    taken.set(e.a, ta + 1);
    taken.set(e.b, tb + 1);
    if (ta < perNode || tb < perNode) out.add(i);
  }
  return out;
}

/** The highest degree of a card that is not a commander. */
export const maxDegreeOf = (nodes: readonly NetworkNode[]): number => nodes.reduce((m, n) => (n.commander ? m : Math.max(m, n.degree)), 0);

/** Node radius in layout units: the commander is the biggest, cards that connect to nothing the smallest. */
export function layoutRadius(n: NetworkNode, maxDegree: number): number {
  if (n.commander) return 34;
  if (n.unconnected) return 8;
  return maxDegree > 0 ? 10 + 18 * Math.sqrt(Math.max(0, n.degree) / maxDegree) : 10;
}
