import type { DeckNetwork, PackageCohesion, PackagePlan } from '../types';

/** A package with under this share of its cards linked to another member gets the hint to tighten it. */
export const LOOSE_SHARE = 0.5;

export const looseText = (linked: number, of: number): string =>
  `Only ${linked} of ${of} of these cards work with another card in the package. Swap the loose ones for cards that feed the rest.`;

/** Members that are network nodes (`of`) and those with a combo, feeds or typal edge to another member (`linked`). */
export function packageCohesion(net: DeckNetwork, cards: readonly string[]): PackageCohesion {
  const members = new Set(cards.filter((id) => net.nodes.some((n) => n.oracleId === id)));
  const linked = new Set<string>();
  for (const e of net.edges) {
    if (e.kind === 'commander' || !members.has(e.a) || !members.has(e.b)) continue;
    linked.add(e.a);
    linked.add(e.b);
  }
  return { linked: linked.size, of: members.size };
}

/** Theme and functional packages get their cohesion; core packages keep null (the network has no role edges). */
export function withCohesion(plan: PackagePlan, net: DeckNetwork): PackagePlan {
  return { ...plan, packages: plan.packages.map((p) => (p.kind === 'core' ? p : { ...p, cohesion: packageCohesion(net, p.cards) })) };
}
