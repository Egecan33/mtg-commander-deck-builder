import { bracketOf } from '../format';
import { commanderThemeWeights } from '../features';
import { createScorer } from '../scoring';
import type { Scorer } from '../scoring';
import { AXIS_MEMBER, deckCards, isLandCard, namedTypes, resolveThemeWeights } from '../summary';
import type { AxisId, Deck, DeckNetwork, EngineContext, NetworkCluster, NetworkEdge, NetworkNode } from '../types';
import { clusterNetwork } from './clusters';
import {
  MAX_EDGES_PER_NODE, PACKAGE_EDGE, UNCONNECTED_EDGE, UNCONNECTED_LINK, comboEdges, functionalPackages, isRingCard, linkIndex, pairEdges, round3, shortName,
} from './edges';
import type { LinkCard } from './edges';

export * from './edges';
export { CLUSTER_MIN_EDGE, clusterNetwork } from './clusters';

const THEME_KINDS = new Set(['combo', 'feeds', 'typal']);

/**
 * Cohesion: 60% the share of non-staple cards that connect to something, 40% the share of link
 * weight between cards that sits inside the two biggest clusters.
 */
export function cohesionOf(
  nodes: NetworkNode[], edges: NetworkEdge[], clusters: NetworkCluster[],
): { cohesion: number; parts: { connected: number; clustered: number } } {
  const cards = nodes.filter((n) => !n.commander);
  if (cards.length === 0) return { cohesion: 0, parts: { connected: 0, clustered: 0 } };
  const nonStaple = cards.filter((n) => !n.staple);
  const connected = nonStaple.length === 0 ? 1 : (nonStaple.length - nonStaple.filter((n) => n.unconnected).length) / nonStaple.length;
  const isCommander = new Set(nodes.filter((n) => n.commander).map((n) => n.oracleId));
  const top = new Map<string, number>();
  for (const c of clusters) if (c.id <= 1) for (const id of c.cards) top.set(id, c.id);
  let total = 0;
  let inside = 0;
  for (const e of edges) {
    if (!THEME_KINDS.has(e.kind) || isCommander.has(e.a) || isCommander.has(e.b)) continue;
    total += e.weight;
    const ca = top.get(e.a);
    if (ca !== undefined && ca === top.get(e.b)) inside += e.weight;
  }
  const clustered = total === 0 ? 0 : inside / total;
  return {
    cohesion: Math.round(100 * (0.6 * connected + 0.4 * clustered)),
    parts: { connected: round3(connected), clustered: round3(clustered) },
  };
}

const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);
const byKey = (p: NetworkEdge, q: NetworkEdge): number => cmp(p.a, q.a) || cmp(p.b, q.b) || cmp(p.kind, q.kind);
const pct = (n: number): string => `${Math.round(n * 100)}%`;

/** How the deck's cards work together: nodes, reasoned edges, clusters and cohesion. */
export function deckNetwork(deck: Deck, ctx: EngineContext, opts: { scorer?: Scorer; seed?: number } = {}): DeckNetwork {
  const { db } = ctx;
  const weights = resolveThemeWeights(deck, ctx);
  const scorer = opts.scorer ?? createScorer(deck, ctx);
  const named = namedTypes(weights);
  const bracket = Math.min(5, Math.max(1, Math.round(Number(bracketOf(deck, db)) || 3)));
  const commanderIds = new Set(deck.commanders);
  const links: LinkCard[] = [];
  const qty = new Map<string, number>();
  for (const { card, features, qty: q } of deckCards(deck, db).cards) {
    const commander = commanderIds.has(card.oracleId);
    if (!commander && isLandCard(features)) continue;
    links.push({ card, f: features, commander });
    qty.set(card.oracleId, commander ? 1 : q);
  }
  // commanders first, then by id: a stable order
  links.sort((x, y) => Number(y.commander) - Number(x.commander) || x.card.oracleId.localeCompare(y.card.oracleId));

  // theme edges
  const all: NetworkEdge[] = [...comboEdges(deck, db)];
  for (let i = 0; i < links.length; i++) {
    for (let j = i + 1; j < links.length; j++) {
      for (const e of pairEdges(links[i], links[j], weights, named)) all.push(e);
    }
  }
  // Keep an edge when it is among the strongest of either end; combo edges always stay. Edges are
  // visited strongest first, so an end's rank is the number of its edges visited before this one.
  all.sort((p, q) => q.weight - p.weight || byKey(p, q));
  const seen = new Map<string, number>();
  const edges: NetworkEdge[] = [];
  for (const e of all) {
    const ra = seen.get(e.a) ?? 0;
    const rb = seen.get(e.b) ?? 0;
    seen.set(e.a, ra + 1);
    seen.set(e.b, rb + 1);
    if (e.kind === 'combo' || ra < MAX_EDGES_PER_NODE || rb < MAX_EDGES_PER_NODE) edges.push(e);
  }

  // nodes
  const degree = new Map<string, number>();
  for (const e of edges) for (const id of [e.a, e.b]) degree.set(id, (degree.get(id) ?? 0) + e.weight);
  const index = linkIndex(deck, db, weights);
  const nodes: NetworkNode[] = links.map(({ card, f, commander }) => {
    const link = commander ? 1 : round3(scorer.commanderLink(card) ?? 0);
    const staple = isRingCard(f, card, bracket, db.tagSlugs?.(card.oracleId) ?? []);
    const strongest = commander ? 1 : index.strongest(card)?.weight ?? 0;
    const axes = Object.entries(f.axes)
      .map(([axis, s]) => ({ axis, v: Math.max(s?.e ?? 0, s?.p ?? 0) }))
      .filter((x) => x.v >= AXIS_MEMBER)
      .sort((p, q) => q.v * (weights[q.axis] ?? 0) - p.v * (weights[p.axis] ?? 0) || p.axis.localeCompare(q.axis))
      .slice(0, 3)
      .map((x) => x.axis as AxisId);
    return {
      oracleId: card.oracleId, qty: qty.get(card.oracleId) ?? 1, commander, staple, roles: [...f.roles], axes,
      degree: round3(degree.get(card.oracleId) ?? 0), link, cluster: null,
      unconnected: !commander && !staple && strongest < UNCONNECTED_EDGE && link < UNCONNECTED_LINK,
    };
  });

  // commander spokes: each card hangs off the commander it works with most (review M5): its strongest
  // theme edge with one of them, else how well it fits that commander's own themes; the first on a tie
  const byId = new Map(links.map((l) => [l.card.oracleId, l.card]));
  const cmds = deck.commanders.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => !!c && commanderIds.has(c.oracleId));
  const first = cmds[0];
  if (first) {
    const direct = new Map<string, number>(); // `${card}|${commander}` -> strongest theme edge
    for (const e of all) {
      for (const [x, y] of [[e.a, e.b], [e.b, e.a]] as const) {
        if (!commanderIds.has(y) || commanderIds.has(x)) continue;
        const key = `${x}|${y}`;
        direct.set(key, Math.max(direct.get(key) ?? 0, e.weight));
      }
    }
    const own = new Map(cmds.map((c) => [c.oracleId, commanderThemeWeights([c], ctx.edhrec?.themes)]));
    const fit = (f: (typeof links)[number]['f'], cmd: string): number => {
      const w = own.get(cmd) ?? {};
      let best = 0;
      for (const [axis, s] of Object.entries(f.axes)) best = Math.max(best, (w[axis] ?? 0) * Math.max(s?.e ?? 0, s?.p ?? 0));
      return best;
    };
    const featuresOf = new Map(links.map((l) => [l.card.oracleId, l.f]));
    for (const n of nodes) {
      if (n.oracleId === first.oracleId) continue;
      const card = byId.get(n.oracleId)!;
      if (n.commander) {
        const [a, b] = first.oracleId < n.oracleId ? [first, card] : [card, first];
        edges.push({ a: a.oracleId, b: b.oracleId, kind: 'commander', weight: 1, reasons: [`Commands the deck with ${shortName(b)}`, `Commands the deck with ${shortName(a)}`] });
        continue;
      }
      if (n.link <= 0) continue;
      let hub = first;
      if (cmds.length > 1) {
        const f = featuresOf.get(n.oracleId)!;
        const rank = (c: typeof first) => [direct.get(`${n.oracleId}|${c.oracleId}`) ?? 0, fit(f, c.oracleId)];
        for (const c of cmds.slice(1)) {
          const [d1, f1] = rank(hub);
          const [d2, f2] = rank(c);
          if (d2 > d1 + 1e-9 || (Math.abs(d2 - d1) <= 1e-9 && f2 > f1 + 1e-9)) hub = c;
        }
      }
      const [a, b] = hub.oracleId < n.oracleId ? [hub, card] : [card, hub];
      const lifted = Number.isFinite(ctx.edhrec?.cards?.[n.oracleId]?.lift ?? NaN);
      const cardSide = `${pct(n.link)} synergy with ${shortName(hub)}${lifted ? ', played with it on EDHREC' : ''}`;
      const cmdSide = `${pct(n.link)} synergy with ${shortName(card)}`;
      edges.push({
        a: a.oracleId, b: b.oracleId, kind: 'commander', weight: n.link,
        reasons: a.oracleId === hub.oracleId ? [cmdSide, cardSide] : [cardSide, cmdSide],
      });
    }
  }
  // package edges: the cards of a pinned functional package do the same job together (review I4);
  // they count for "connected" (`linkIndex` reads the same package link), never for clusters
  const nodeSet = new Set(nodes.filter((n) => !n.commander).map((n) => n.oracleId));
  const paired = new Set<string>();
  for (const { def, ids } of functionalPackages(deck, db)) {
    const members = ids.filter((id) => nodeSet.has(id)).sort();
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const [a, b] = [members[i], members[j]];
        if (paired.has(`${a}|${b}`)) continue;
        paired.add(`${a}|${b}`);
        const ca = byId.get(a)!;
        const cb = byId.get(b)!;
        edges.push({ a, b, kind: 'package', weight: PACKAGE_EDGE, reasons: [`${def.name} with ${shortName(cb)}`, `${def.name} with ${shortName(ca)}`], packageId: def.id });
      }
    }
  }
  edges.sort((p, q) => cmp(p.kind, q.kind) || byKey(p, q));

  const clusters = clusterNetwork(nodes, edges, db, opts.seed ?? 1);
  const byNodeId = new Map(nodes.map((n) => [n.oracleId, n]));
  for (const c of clusters) for (const id of c.cards) { const n = byNodeId.get(id); if (n) n.cluster = c.id; }
  const { cohesion, parts } = cohesionOf(nodes, edges, clusters);
  const names = new Map(links.map((l) => [l.card.oracleId, l.card.name]));
  const unconnected = nodes.filter((n) => n.unconnected)
    .sort((p, q) => p.link - q.link || (names.get(p.oracleId) ?? '').localeCompare(names.get(q.oracleId) ?? ''))
    .map((n) => n.oracleId);
  return { nodes, edges, clusters, cohesion, cohesionParts: parts, unconnected };
}
