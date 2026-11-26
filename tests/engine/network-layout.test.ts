import { describe, expect, it } from 'vitest';
import { deckNetwork } from '@/engine/network';
import { DRAWN_FEEDS, drawnEdges, layoutRadius, maxDegreeOf } from '@/engine/network/draw';
import { STAPLE_RING, settle, toGraphData } from '@/engine/network/layout';
import type { DeckNetwork, EngineContext, NetworkEdge } from '@/engine/types';
import { fixtureDb } from '../helpers/fixture-db';
import { fixtureDeck, oddDeck, withFiveUnconnected } from '../helpers/network';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const upgraded = deckNetwork(fixtureDeck('upgraded', 3), ctx);
const cedh = deckNetwork(fixtureDeck('cedh', 5), ctx);
const radius = (p: [number, number, number]) => Math.hypot(p[0], p[1]);
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);

describe('network layout (d3-force-3d, shared with 3d-force-graph)', () => {
  it('the same seed gives the same layout', () => {
    const a = settle(upgraded, 3);
    const b = settle(upgraded, 3);
    expect([...a.entries()]).toEqual([...b.entries()]);
  });

  it('the commander stays where it is pinned', () => {
    expect(settle(upgraded).get(upgraded.nodes.find((n) => n.commander)!.oracleId)).toEqual([0, 0, 0]);
    const odd = deckNetwork(oddDeck(), ctx);
    const [c1, c2] = odd.nodes.filter((n) => n.commander).map((n) => settle(odd).get(n.oracleId));
    expect(c1).toEqual([0, 0, 0]);
    expect(c2).toEqual([36, 0, 0]);
  });

  it('unconnected cards settle farther out than the rest', () => {
    // (Ten random cards are mostly package cards, staples, since the core packages count tags; five chosen unconnected stand in.)
    const net = deckNetwork(withFiveUnconnected(fixtureDeck('precon', 2), ctx).deck, ctx);
    const pos = settle(net);
    const out = net.nodes.filter((n) => n.unconnected);
    expect(out.length).toBeGreaterThanOrEqual(3);
    const rest = net.nodes.filter((n) => !n.unconnected && !n.staple && !n.commander);
    expect(mean(out.map((n) => radius(pos.get(n.oracleId)!)))).toBeGreaterThan(1.3 * mean(rest.map((n) => radius(pos.get(n.oracleId)!))));
  });

  it('staples sit on a loose ring', () => {
    const pos = settle(upgraded);
    const r = upgraded.nodes.filter((n) => n.staple).map((n) => radius(pos.get(n.oracleId)!)).sort((a, b) => a - b);
    const median = r[Math.floor(r.length / 2)];
    expect(median).toBeGreaterThan(0.6 * STAPLE_RING);
    expect(median).toBeLessThan(1.6 * STAPLE_RING);
  });

  it('clusters settle into their own regions', () => {
    const pos = settle(cedh); // the only fixture deck with two clusters
    const dist = (a: string, b: string) => Math.hypot(...pos.get(a)!.map((v, i) => v - pos.get(b)![i]) as [number, number, number]);
    const [c0, c1] = cedh.clusters;
    const within = (ids: string[]) => mean(ids.flatMap((a, i) => ids.slice(i + 1).map((b) => dist(a, b))));
    const between = mean(c0.cards.flatMap((a) => c1.cards.map((b) => dist(a, b))));
    expect(within(c0.cards)).toBeLessThan(between);
    expect(within(c1.cards)).toBeLessThan(between);
  });

  it('settles with finite coordinates for any network', () => {
    const empty: DeckNetwork = { nodes: [], edges: [], clusters: [], cohesion: 0, cohesionParts: { connected: 0, clustered: 0 }, unconnected: [] };
    const one = deckNetwork({ ...fixtureDeck('precon', 2), main: [] }, ctx);
    const noEdges: DeckNetwork = { ...upgraded, edges: [], clusters: [] };
    for (const net of [empty, one, noEdges, cedh]) {
      for (const p of settle(net).values()) for (const v of p) expect(Number.isFinite(v)).toBe(true);
    }
  });

  // Controller finding U1: about fifty nodes overlapped at the centre under 350-500 feeds edges.
  it('nodes keep apart: no two cards overlap', () => {
    for (const net of [upgraded, cedh, deckNetwork(fixtureDeck('precon', 2), ctx)]) {
      const pos = settle(net);
      const maxDegree = maxDegreeOf(net.nodes);
      const cards = net.nodes.filter((n) => !n.commander);
      let pairs = 0;
      let overlapping = 0;
      for (let i = 0; i < cards.length; i++) {
        for (let j = i + 1; j < cards.length; j++) {
          const [a, b] = [pos.get(cards[i].oracleId)!, pos.get(cards[j].oracleId)!];
          pairs++;
          if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 0.8 * (layoutRadius(cards[i], maxDegree) + layoutRadius(cards[j], maxDegree))) overlapping++;
        }
      }
      expect(overlapping / pairs).toBeLessThan(0.01);
    }
  });

  it("draws every link that is not feeds, and each card's three strongest feeds links", () => {
    // twelve cards that all feed each other (66 feeds links), plus the deck's own links
    const ids = Array.from({ length: 12 }, (_, i) => `c${String(i).padStart(2, '0')}`);
    const dense: NetworkEdge[] = [...upgraded.edges];
    ids.forEach((a, i) => ids.slice(i + 1).forEach((b, j) => dense.push({ a, b, kind: 'feeds', weight: ((i * 7 + j * 3) % 10) / 10 + 0.05, reasons: ['x', 'y'] })));
    const drawn = drawnEdges(dense);
    const feeds = dense.map((e, i) => ({ e, i })).filter((x) => x.e.kind === 'feeds');
    for (const [i, e] of dense.entries()) if (e.kind !== 'feeds') expect(drawn.has(i)).toBe(true);
    const top = (id: string) => feeds.filter((x) => x.e.a === id || x.e.b === id).sort((p, q) => q.e.weight - p.e.weight || p.i - q.i).slice(0, DRAWN_FEEDS).map((x) => x.i);
    for (const { e, i } of feeds) expect(drawn.has(i)).toBe(top(e.a).includes(i) || top(e.b).includes(i));
    expect(feeds.filter((x) => drawn.has(x.i)).length).toBeLessThan(feeds.length);
  });

  it("toGraphData is Graphify's node and link shape", () => {
    const g = toGraphData(upgraded, (id) => db.get(id)!.name);
    expect(g.nodes).toHaveLength(upgraded.nodes.length);
    expect(g.links).toHaveLength(upgraded.edges.length);
    expect(Object.keys(g.nodes[0]).sort()).toEqual(['group', 'id', 'name', 'val']);
    expect(Object.keys(g.links[0]).sort()).toEqual(['reason', 'relation', 'source', 'target', 'weight']);
    expect(g.links.every((l) => l.reason.length > 0)).toBe(true);
  });
});
