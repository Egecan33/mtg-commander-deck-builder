import { forceLink, forceManyBody, forceRadial, forceSimulation, forceZ } from 'd3-force-3d';
import { mulberry32 } from '../random';
import type { DeckNetwork, NetworkEdge, NetworkNode } from '../types';

export type Vec3 = [number, number, number];
export type LayoutSource = Pick<DeckNetwork, 'nodes' | 'edges' | 'clusters'>;

/** Graphify's node and link shape: what the view draws and what "Export graph.json" writes. */
export interface GraphData {
  nodes: { id: string; name: string; group: number; val: number }[];
  links: { source: string; target: string; relation: string; weight: number; reason: string }[];
}

/** The network as Graphify's `{ nodes, links }`: group = cluster id (-1 for none), val = how connected. */
export function toGraphData(net: Pick<DeckNetwork, 'nodes' | 'edges'>, nameOf: (oracleId: string) => string): GraphData {
  return {
    nodes: net.nodes.map((n) => ({ id: n.oracleId, name: nameOf(n.oracleId), group: n.cluster ?? -1, val: Math.round((1 + n.degree) * 1000) / 1000 })),
    links: net.edges.map((e) => ({ source: e.a, target: e.b, relation: e.kind, weight: e.weight, reason: e.reasons[0] })),
  };
}

/** A node as the force simulation (d3-force-3d, also inside 3d-force-graph) sees it. */
export interface LayoutNode {
  id: string; x: number; y: number; z: number;
  fx?: number; fy?: number; fz?: number;
  vx?: number; vy?: number; vz?: number;
  info: NetworkNode;
}
export interface LayoutLink { source: string; target: string; weight: number; kind: NetworkEdge['kind'] }

/** Ring radii: staple cards sit on a loose ring, cards that connect to nothing farther out. */
export const STAPLE_RING = 70;
export const UNCONNECTED_RING = 240;
export const COMMANDER_GAP = 36;

/** Nodes with seeded starting positions (clusters apart, rings at their radius); commanders pinned. */
export function layoutNodes(net: LayoutSource, seed = 1): LayoutNode[] {
  const rnd = mulberry32(seed);
  const at = (r: number, jitter = 0): Vec3 => {
    const t = rnd() * Math.PI * 2;
    const rr = r + (rnd() - 0.5) * 2 * jitter;
    return [Math.cos(t) * rr, Math.sin(t) * rr, (rnd() - 0.5) * 40];
  };
  const clusters = net.clusters.length;
  let commanders = 0;
  return net.nodes.map((n) => {
    let p: Vec3;
    let pin: Vec3 | null = null;
    if (n.commander) {
      pin = [commanders === 0 ? 0 : COMMANDER_GAP, 0, 0];
      commanders++;
      p = pin;
    } else if (n.cluster !== null && clusters > 0) {
      const a = (2 * Math.PI * n.cluster) / clusters;
      p = [Math.cos(a) * 140 + (rnd() - 0.5) * 50, Math.sin(a) * 140 + (rnd() - 0.5) * 50, (rnd() - 0.5) * 40];
    } else if (n.unconnected) p = at(UNCONNECTED_RING, 10);
    else if (n.staple) p = at(STAPLE_RING, 10);
    else p = [(rnd() - 0.5) * 120, (rnd() - 0.5) * 120, (rnd() - 0.5) * 40];
    const node: LayoutNode = { id: n.oracleId, x: p[0], y: p[1], z: p[2], info: n };
    if (pin) { node.fx = pin[0]; node.fy = pin[1]; node.fz = pin[2]; }
    return node;
  });
}

/** Every edge as a link; commander spokes are kept (the view draws them) but pull very little. */
export function layoutLinks(net: LayoutSource): LayoutLink[] {
  return net.edges.map((e) => ({ source: e.a, target: e.b, weight: e.weight, kind: e.kind }));
}

/**
 * Sets the forces on a d3-force-3d simulation, or on 3d-force-graph's own (`set` is `sim.force` or
 * `graph.d3Force`): links pulled by edge weight, charge for repulsion, rings for staples and
 * unconnected cards, a pull toward each cluster's centre, a light flattening of z.
 */
export function configureForces(set: (name: string, force: unknown) => void, nodes: LayoutNode[], links: LayoutLink[]): void {
  set('link', forceLink(links)
    .id((d) => (d as LayoutNode).id)
    .distance((l) => { const w = (l as LayoutLink).weight; return (l as LayoutLink).kind === 'commander' ? 120 : 34 * (1.6 - 0.6 * w); })
    .strength((l) => { const k = l as LayoutLink; return k.kind === 'commander' ? 0.008 * k.weight : 0.1 + 0.4 * k.weight; }));
  set('charge', forceManyBody().strength(-26).distanceMax(320));
  set('radial', forceRadial((d) => { const n = (d as LayoutNode).info; return n.unconnected ? UNCONNECTED_RING : n.staple ? STAPLE_RING : 0; }, 0, 0, 0)
    .strength((d) => { const n = (d as LayoutNode).info; return n.unconnected || n.staple ? 0.05 : 0.012; }));
  set('flatten', forceZ(0).strength(0.02));
  let members: LayoutNode[] = nodes;
  const pull = Object.assign(
    (alpha: number) => {
      const sums = new Map<number, [number, number, number, number]>();
      for (const n of members) {
        const c = n.info.cluster;
        if (c === null) continue;
        const s = sums.get(c) ?? [0, 0, 0, 0];
        s[0] += n.x; s[1] += n.y; s[2] += n.z; s[3]++;
        sums.set(c, s);
      }
      for (const n of members) {
        const s = n.info.cluster === null ? undefined : sums.get(n.info.cluster);
        if (!s || n.fx !== undefined) continue;
        n.vx = (n.vx ?? 0) + (s[0] / s[3] - n.x) * 0.03 * alpha;
        n.vy = (n.vy ?? 0) + (s[1] / s[3] - n.y) * 0.03 * alpha;
        n.vz = (n.vz ?? 0) + (s[2] / s[3] - n.z) * 0.03 * alpha;
      }
    },
    { initialize: (ns: LayoutNode[]) => { members = ns; } },
  );
  set('clusters', pull);
}

/** Ticks a settled layout takes; the SVG fallback and reduced motion run exactly this many synchronously. */
export const SETTLE_TICKS = 300;

/** The settled layout without a screen: the same forces, run synchronously. Deterministic for a seed. */
export function settle(net: LayoutSource, seed = 1, ticks = SETTLE_TICKS): Map<string, Vec3> {
  const nodes = layoutNodes(net, seed);
  const links = layoutLinks(net);
  const sim = forceSimulation(nodes, 3);
  sim.stop();
  configureForces((name, f) => sim.force(name, f), nodes, links);
  sim.tick(ticks);
  const out = new Map<string, Vec3>();
  for (const n of nodes) out.set(n.id, [n.x, n.y, n.z]);
  return out;
}
