import { describe, expect, it } from 'vitest';
import { packageCohesion, packagePlan, pinPackage, withCohesion } from '@/engine/packages';
import { deckNetwork } from '@/engine/network';
import { targetPlan } from '@/engine/targets';
import { summarizeDeck } from '@/engine/summary';
import type { DeckNetwork, EngineContext, NetworkEdge, NetworkNode } from '@/engine/types';
import { fixtureDb } from '../helpers/fixture-db';
import { fixtureDeck } from '../helpers/network';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };

describe('package cohesion', () => {
  it('counts members linked to another member', () => {
    const node = (id: string, commander = false): NetworkNode => ({ oracleId: id, qty: 1, commander, staple: false, roles: [], axes: [], degree: 0, link: 0, cluster: null, unconnected: false });
    const edge = (a: string, b: string, kind: NetworkEdge['kind']): NetworkEdge => ({ a, b, kind, weight: 0.5, reasons: ['x', 'y'] });
    const net: DeckNetwork = {
      nodes: ['a', 'b', 'c', 'd', 'x'].map((id) => node(id)), clusters: [], cohesion: 0, cohesionParts: { connected: 0, clustered: 0 }, unconnected: [],
      edges: [edge('a', 'b', 'feeds'), edge('c', 'x', 'typal'), edge('d', 'cmd', 'commander')],
    };
    expect(packageCohesion(net, ['a', 'b', 'c', 'd', 'not-a-node'])).toEqual({ linked: 2, of: 4 });
  });

  it('withCohesion fills theme and functional packages only', () => {
    const deck = fixtureDeck('upgraded', 3);
    const base = packagePlan(deck, ctx);
    const t = targetPlan(deck, ctx, summarizeDeck(deck, db)).targets;
    const plan = withCohesion(packagePlan(pinPackage(deck, base, t, 'fn:pillow-fort', 8), ctx), deckNetwork(deck, ctx));
    for (const p of plan.packages.filter((x) => x.kind === 'core')) expect(p.cohesion).toBeNull();
    const elf = plan.packages.find((x) => x.id === 'theme:typal:elf')!;
    expect(elf.cohesion).not.toBeNull();
    expect(elf.cohesion!.linked).toBeGreaterThanOrEqual(1);
    expect(plan.packages.find((x) => x.id === 'fn:pillow-fort')!.cohesion).not.toBeNull();
  });
});
