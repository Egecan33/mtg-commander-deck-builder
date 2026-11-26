import type { NetworkEdge, NetworkEdgeKind } from '@/engine/types';

/** Edge colours are the app's own tokens (ruling D19): ember stays reserved for "!". */
export const EDGE_COLOR: Record<NetworkEdgeKind, string> = {
  combo: '#d6ab52',
  feeds: '#efe7d7',
  typal: '#a79d8b',
  commander: '#7d7566',
  package: '#a79d8b',
};
export const EDGE_LABEL: Record<NetworkEdgeKind, string> = { combo: 'Combo', feeds: 'Feeds', typal: 'Typal', commander: 'Commander', package: 'Package' };
export const EDGE_KINDS: readonly NetworkEdgeKind[] = ['combo', 'feeds', 'typal', 'commander', 'package'];

/** 1, 2 or 3 px: commander spokes and package links stay thin, the rest by weight. */
export function edgeWidth(e: NetworkEdge): 1 | 2 | 3 {
  if (e.kind === 'commander' || e.kind === 'package') return 1;
  return e.weight < 0.34 ? 1 : e.weight < 0.67 ? 2 : 3;
}

export const edgeOpacity = (kind: NetworkEdgeKind): number => (kind === 'commander' ? 0.18 : kind === 'typal' || kind === 'package' ? 0.55 : 0.85);

/** Node radius in layout units: the layout's own (its collision force keeps these discs apart). */
export { layoutRadius as nodeRadius, maxDegreeOf } from '@/engine/network/draw';

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
