import { forceCollide, forceLink, forceManyBody, forceRadial, forceSimulation, forceZ } from 'd3-force-3d';
import type { Force } from 'd3-force-3d';
import { mulberry32 } from '../random';
import type { DeckNetwork, NetworkEdge, NetworkNode } from '../types';
import { drawnEdges, layoutRadius, maxDegreeOf } from './draw';

export type Vec3 = [number, number, number];
export type LayoutSource = Pick<DeckNetwork, 'nodes' | 'edges' | 'clusters'>;

// Graphify's shape lives with the drawing rules (no d3 there), so the view can export without the layout.
export { toGraphData } from './draw';
export type { GraphData } from './draw';

/** A node as the force simulation (d3-force-3d, also inside 3d-force-graph) sees it. */
export interface LayoutNode {
  id: string; x: number; y: number; z: number;
  fx?: number; fy?: number; fz?: number;
  vx?: number; vy?: number; vz?: number;
  info: NetworkNode;
}
/** A drawn edge as a link; `edgeIndex` is its place in `DeckNetwork.edges`. */
export interface LayoutLink { source: string; target: string; weight: number; kind: NetworkEdge['kind']; edgeIndex: number }

/** Ring radii: staple cards sit on a loose ring, cards that connect to nothing farther out (cards keep apart, so the rings are wide). */
export const STAPLE_RING = 130;
export const UNCONNECTED_RING = 360;
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

/**
 * The drawn edges as links (`drawnEdges`: each card's strongest few feeds links, every other link);
 * commander spokes are kept (the view draws them) but pull very little.
 */
export function layoutLinks(net: LayoutSource): LayoutLink[] {
  const drawn = drawnEdges(net.edges);
  return net.edges.flatMap((e, edgeIndex) => (drawn.has(edgeIndex) ? [{ source: e.a, target: e.b, weight: e.weight, kind: e.kind, edgeIndex }] : []));
}

/** Room around each card's disc that the collision force keeps clear, in layout units. */
export const NODE_GAP = 6;

/** What `configureForces` needs of a simulation: read a named force, or set one. */
export interface ForceHost {
  get(name: string): Force | undefined;
  set(name: string, force: unknown): void;
}

/**
 * Sets the forces on a d3-force-3d simulation, or on 3d-force-graph's own (which already has its
 * link and charge forces: those are tuned in place): links pulled by edge weight, charge for
 * repulsion, rings for staples and unconnected cards, a pull toward each cluster's centre, a light
 * flattening of z.
 */
export function configureForces(host: ForceHost, nodes: LayoutNode[], links: LayoutLink[]): void {
  const set = host.set;
  // Each card's links share its pull (as d3's own default does), so a card with many links is not
  // dragged into the middle; weak links are longer than strong ones.
  const count = new Map<string, number>();
  const end = (x: unknown): string => (typeof x === 'string' ? x : (x as LayoutNode).id);
  for (const l of links) if (l.kind !== 'commander') for (const id of [end(l.source), end(l.target)]) count.set(id, (count.get(id) ?? 0) + 1);
  const link = host.get('link') ?? forceLink(links);
  link
    .id((d) => (d as LayoutNode).id)
    .distance((l) => { const k = l as LayoutLink; return k.kind === 'commander' ? 170 : 70 + 60 * (1 - k.weight); })
    .strength((l) => {
      const k = l as LayoutLink;
      if (k.kind === 'commander') return 0.006 * k.weight;
      const shared = Math.min(count.get(end(k.source)) ?? 1, count.get(end(k.target)) ?? 1);
      return (0.2 + 0.6 * k.weight) / Math.max(1, Math.sqrt(shared));
    });
  if (!host.get('link')) set('link', link);
  const charge = host.get('charge') ?? forceManyBody();
  charge.strength(-110).distanceMax(600);
  if (!host.get('charge')) set('charge', charge);
  // Cards never overlap: each keeps its own disc plus a gap clear (controller finding U1).
  const maxDegree = maxDegreeOf(nodes.map((n) => n.info));
  set('collide', forceCollide((d) => layoutRadius((d as LayoutNode).info, maxDegree) + NODE_GAP).strength(0.9).iterations(2));
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
  configureForces({ get: (name) => sim.force(name) as Force | undefined, set: (name, f) => void sim.force(name, f) }, nodes, links);
  sim.tick(ticks);
  const out = new Map<string, Vec3>();
  for (const n of nodes) out.set(n.id, [n.x, n.y, n.z]);
  return out;
}
