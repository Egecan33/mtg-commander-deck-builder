import { createScorer } from '../scoring';
import type { Scorer } from '../scoring';
import { AXIS_MEMBER, deckCards, isLandCard, namedTypes, resolveThemeWeights } from '../summary';
import type { AxisId, Deck, DeckNetwork, EngineContext, NetworkCluster, NetworkEdge, NetworkNode } from '../types';
import { clusterNetwork } from './clusters';
import {
  MAX_EDGES_PER_NODE, UNCONNECTED_EDGE, UNCONNECTED_LINK, comboEdges, isRingCard, linkIndex, pairEdges, round3, shortName,
} from './edges';
import type { LinkCard } from './edges';

export * from './edges';
export { clusterNetwork } from './clusters';

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

const pct = (n: number): string => `${Math.round(n * 100)}%`;

/** How the deck's cards work together: nodes, reasoned edges, clusters and cohesion. */
export function deckNetwork(deck: Deck, ctx: EngineContext, opts: { scorer?: Scorer; seed?: number } = {}): DeckNetwork {
  const { db } = ctx;
  const weights = resolveThemeWeights(deck, ctx);
  const scorer = opts.scorer ?? createScorer(deck, ctx);
  const named = namedTypes(weights);
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
  // keep an edge when it is among the strongest of either end; combo edges always stay
  const byNode = new Map<string, NetworkEdge[]>();
  for (const e of all) for (const id of [e.a, e.b]) (byNode.get(id) ?? byNode.set(id, []).get(id)!).push(e);
  const rank = (p: NetworkEdge, q: NetworkEdge) => q.weight - p.weight || p.kind.localeCompare(q.kind) || (p.a + p.b).localeCompare(q.a + q.b);
  const kept = new Set<NetworkEdge>();
  for (const list of byNode.values()) for (const e of [...list].sort(rank).slice(0, MAX_EDGES_PER_NODE)) kept.add(e);
  const edges = all.filter((e) => e.kind === 'combo' || kept.has(e));

  // nodes
  const degree = new Map<string, number>();
  for (const e of edges) for (const id of [e.a, e.b]) degree.set(id, (degree.get(id) ?? 0) + e.weight);
  const index = linkIndex(deck, db, weights);
  const nodes: NetworkNode[] = links.map(({ card, f, commander }) => {
    const link = commander ? 1 : round3(scorer.commanderLink(card) ?? 0);
    const staple = isRingCard(f);
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

  // commander spokes
  const first = deck.commanders.length > 0 ? db.get(deck.commanders[0]) : undefined;
  const byId = new Map(links.map((l) => [l.card.oracleId, l.card]));
  if (first && byId.has(first.oracleId)) {
    for (const n of nodes) {
      if (n.oracleId === first.oracleId) continue;
      const card = byId.get(n.oracleId)!;
      const [a, b] = first.oracleId < n.oracleId ? [first, card] : [card, first];
      if (n.commander) {
        edges.push({ a: a.oracleId, b: b.oracleId, kind: 'commander', weight: 1, reasons: [`Commands the deck with ${shortName(b)}`, `Commands the deck with ${shortName(a)}`] });
        continue;
      }
      if (n.link <= 0) continue;
      const lifted = Number.isFinite(ctx.edhrec?.cards?.[n.oracleId]?.lift ?? NaN);
      const cardSide = `${pct(n.link)} synergy with ${shortName(first)}${lifted ? ', played with it on EDHREC' : ''}`;
      const cmdSide = `${pct(n.link)} synergy with ${shortName(card)}`;
      edges.push({
        a: a.oracleId, b: b.oracleId, kind: 'commander', weight: n.link,
        reasons: a.oracleId === first.oracleId ? [cmdSide, cardSide] : [cardSide, cmdSide],
      });
    }
  }
  edges.sort((p, q) => p.kind.localeCompare(q.kind) || (p.a + p.b).localeCompare(q.a + q.b));

  const clusters = clusterNetwork(nodes, edges, db, opts.seed ?? 1);
  for (const c of clusters) for (const id of c.cards) { const n = nodes.find((x) => x.oracleId === id); if (n) n.cluster = c.id; }
  const { cohesion, parts } = cohesionOf(nodes, edges, clusters);
  const names = new Map(links.map((l) => [l.card.oracleId, l.card.name]));
  const unconnected = nodes.filter((n) => n.unconnected)
    .sort((p, q) => p.link - q.link || (names.get(p.oracleId) ?? '').localeCompare(names.get(q.oracleId) ?? ''))
    .map((n) => n.oracleId);
  return { nodes, edges, clusters, cohesion, cohesionParts: parts, unconnected };
}
