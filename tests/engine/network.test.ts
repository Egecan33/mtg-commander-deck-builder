import { describe, expect, it } from 'vitest';
import { findCombos } from '@/engine/brackets';
import { axisLabel } from '@/engine/features';
import { CLUSTER_MIN_EDGE, cohesionOf, deckNetwork, linkIndex } from '@/engine/network';
import { createScorer } from '@/engine/scoring';
import { deckCards, resolveThemeWeights } from '@/engine/summary';
import type { DeckNetwork, EngineContext, NetworkCluster, NetworkEdge, NetworkNode } from '@/engine/types';
import { card, fixtureDb } from '../helpers/fixture-db';
import { fixtureDeck, oddDeck, withTenRandom } from '../helpers/network';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const precon = fixtureDeck('precon', 2);
const upgraded = fixtureDeck('upgraded', 3);
const cedh = fixtureDeck('cedh', 5);
const decks = { precon, upgraded, cedh };
const nets = {
  precon: deckNetwork(precon, ctx), upgraded: deckNetwork(upgraded, ctx), cedh: deckNetwork(cedh, ctx),
};
const r3 = (n: number) => Math.round(n * 1000) / 1000;
const THEME = new Set(['combo', 'feeds', 'typal']);

describe('deckNetwork', () => {
  it('nodes are the nonland cards and the commanders', () => {
    for (const name of ['precon', 'upgraded', 'cedh'] as const) {
      const deck = decks[name];
      const want = new Set(deck.commanders);
      for (const { card: c, features } of deckCards(deck, db).cards) if (features.landWeight < 1) want.add(c.oracleId);
      const net = nets[name];
      expect(new Set(net.nodes.map((n) => n.oracleId))).toEqual(want);
      expect(new Set(net.nodes.filter((n) => n.commander).map((n) => n.oracleId))).toEqual(new Set(deck.commanders));
    }
  });

  it('combo edges join the pieces of a combo the deck holds', () => {
    const found = findCombos(cedh, db).included;
    expect(found.length).toBeGreaterThan(0);
    let checked = 0;
    for (const { combo } of found) {
      const ids = combo.cards.map((p) => p.oracleId).filter((id) => nets.cedh.nodes.some((n) => n.oracleId === id));
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        const e = nets.cedh.edges.find((x) => x.a === a && x.b === b && x.kind === 'combo');
        expect(e, `${a} ${b}`).toBeTruthy();
        expect(e!.weight).toBe(1);
        expect(e!.reasons[0]).toMatch(/^Combo with /);
        expect(e!.reasons[1]).toMatch(/^Combo with /);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('one card away is a half-weight combo edge', () => {
    const away = findCombos(cedh, db).oneAway;
    let half = 0;
    for (const { combo } of away) {
      const ids = combo.cards.map((p) => p.oracleId).filter((id) => nets.cedh.nodes.some((n) => n.oracleId === id));
      if (ids.length < 2) continue;
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        const e = nets.cedh.edges.find((x) => x.a === a && x.b === b && x.kind === 'combo');
        expect(e, `${a} ${b}`).toBeTruthy();
        expect([0.5, 1]).toContain(e!.weight);
        if (e!.weight === 0.5) { half++; expect(e!.reasons[0]).toMatch(/^One card away from a combo with .+: needs /); }
      }
    }
    expect(half).toBeGreaterThan(0);
  });

  it("feeds edges are enabler x payoff x the deck's weight", () => {
    const w = resolveThemeWeights(upgraded, ctx);
    const feeds = nets.upgraded.edges.filter((e) => e.kind === 'feeds');
    expect(feeds.some((e) => e.axis === 'tokens')).toBe(true);
    for (const e of feeds) {
      const fa = db.features(e.a)!;
      const fb = db.features(e.b)!;
      const ax = e.axis!;
      const ab = (fa.axes[ax]?.e ?? 0) * (fb.axes[ax]?.p ?? 0) * w[ax];
      const ba = (fb.axes[ax]?.e ?? 0) * (fa.axes[ax]?.p ?? 0) * w[ax];
      expect(Math.abs(e.weight - Math.max(ab, ba))).toBeLessThan(0.001);
      const [enabler, payoff, from, to] = ab >= ba ? [e.a, e.b, e.reasons[0], e.reasons[1]] : [e.b, e.a, e.reasons[1], e.reasons[0]];
      const short = (id: string) => db.get(id)!.frontName.split(', ')[0];
      expect(from).toBe(`Feeds ${short(payoff)}'s ${axisLabel(ax).toLowerCase()}`);
      expect(to).toBe(`Fed by ${short(enabler)} (${axisLabel(ax)})`);
    }
  });

  it('an Elf and an Elf payoff share a typal edge', () => {
    const m = card('Elvish Mystic').oracleId;
    const d = card('Elvish Archdruid').oracleId;
    const e = nets.upgraded.edges.find((x) => x.kind === 'typal' && [x.a, x.b].sort().join() === [m, d].sort().join());
    expect(e).toBeTruthy();
    expect(e!.weight).toBe(0.6);
    expect(e!.axis).toBe('typal:elf');
    const side = (id: string) => (e!.a === id ? e!.reasons[0] : e!.reasons[1]);
    expect(side(m)).toBe('An Elf for Elvish Archdruid');
    expect(side(d)).toBe('Pays off Elvish Mystic, an Elf');
  });

  it("spokes carry the scorer's commander link", () => {
    for (const name of ['precon', 'upgraded', 'cedh'] as const) {
      const deck = decks[name];
      const scorer = createScorer(deck, ctx);
      const cmd = deck.commanders[0];
      for (const n of nets[name].nodes) {
        if (n.commander) continue;
        const spokes = nets[name].edges.filter((e) => e.kind === 'commander' && (e.a === n.oracleId || e.b === n.oracleId));
        if (n.link > 0) {
          expect(spokes).toHaveLength(1);
          expect([spokes[0].a, spokes[0].b].sort()).toEqual([cmd, n.oracleId].sort());
          expect(spokes[0].weight).toBe(n.link);
          expect(n.link).toBe(r3(scorer.commanderLink(db.get(n.oracleId)!) ?? 0));
        } else expect(spokes).toHaveLength(0);
      }
    }
  });

  it('EDHREC lift raises the commander link', () => {
    const cards = nets.upgraded.nodes.filter((n) => !n.commander && n.link > 0.05 && n.link < 0.7).map((n) => n.oracleId);
    const [x, y] = cards;
    const base = createScorer(upgraded, ctx);
    const edhrec = {
      commanderDecks: 1000, themes: {},
      cards: { [x]: { numDecks: 600, potentialDecks: 1000, lift: 9 }, [y]: { numDecks: 10, potentialDecks: 1000, lift: 0.5 } },
    };
    const lifted = createScorer(upgraded, { ...ctx, edhrec });
    const rise = lifted.commanderLink(db.get(x)!)! - base.commanderLink(db.get(x)!)!;
    expect(rise).toBeGreaterThan(0);
    expect(rise).toBeLessThanOrEqual(0.25 + 1e-9);
    const other = cards[2];
    expect(lifted.commanderLink(db.get(other)!)).toBe(base.commanderLink(db.get(other)!));
  });

  it('every edge reads from both sides', () => {
    for (const net of Object.values(nets)) {
      const seen = new Set<string>();
      for (const e of net.edges) {
        expect(e.a < e.b).toBe(true);
        for (const r of e.reasons) { expect(r.length).toBeGreaterThan(0); expect(r).not.toMatch(/NaN|undefined/); }
        const key = `${e.a}|${e.b}|${e.kind}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
        expect(e.weight).toBeGreaterThan(0);
        expect(e.weight).toBeLessThanOrEqual(1);
        if (THEME.has(e.kind)) expect(e.weight).toBeGreaterThanOrEqual(0.15);
      }
    }
  });

  it('each node keeps at most twelve theme edges', () => {
    for (const net of Object.values(nets)) {
      const theme = net.edges.filter((e) => THEME.has(e.kind));
      const topOf = (id: string) => theme.filter((e) => e.a === id || e.b === id).sort((p, q) => q.weight - p.weight).slice(0, 12);
      for (const e of theme) {
        if (e.kind === 'combo') continue;
        const ok = topOf(e.a).some((x) => x.weight <= e.weight + 1e-9 && x.weight >= e.weight - 1e-9) || topOf(e.b).some((x) => x.weight === e.weight);
        expect(ok).toBe(true);
      }
    }
    expect(nets.upgraded.edges.length).toBeLessThanOrEqual(900);
  });

  it('the link index and the network agree', () => {
    for (const name of ['precon', 'upgraded', 'cedh'] as const) {
      const deck = decks[name];
      const idx = linkIndex(deck, db, resolveThemeWeights(deck, ctx));
      for (const n of nets[name].nodes) {
        if (n.commander) continue;
        const raw = idx.strongest(db.get(n.oracleId)!)?.weight ?? 0;
        const mine = nets[name].edges.filter((e) => THEME.has(e.kind) && (e.a === n.oracleId || e.b === n.oracleId));
        expect(raw >= 0.15, db.get(n.oracleId)!.name).toBe(mine.length > 0);
        if (mine.length) expect(Math.abs(raw - Math.max(...mine.map((e) => e.weight)))).toBeLessThan(0.001);
      }
    }
  });

  it('unconnected cards are never staples, lands or commanders', () => {
    for (const net of Object.values(nets)) {
      const un = new Set(net.unconnected);
      for (const n of net.nodes) {
        const none = !net.edges.some((e) => THEME.has(e.kind) && (e.a === n.oracleId || e.b === n.oracleId));
        if (n.unconnected) {
          expect(n.staple).toBe(false);
          expect(none).toBe(true);
          expect(n.link).toBeLessThan(0.3);
        }
        if (!n.commander && !n.staple && none && n.link < 0.3) expect(un.has(n.oracleId)).toBe(true);
        expect(un.has(n.oracleId)).toBe(n.unconnected);
      }
    }
  });

  it('clusters are stable for a fixed seed', () => {
    const a = deckNetwork(upgraded, ctx, { seed: 7 });
    const b = deckNetwork(upgraded, ctx, { seed: 7 });
    expect(a.clusters).toEqual(b.clusters);
    expect(a.nodes.map((n) => n.cluster)).toEqual(b.nodes.map((n) => n.cluster));
    for (const c of a.clusters) { expect(c.cards.length).toBeGreaterThanOrEqual(2); expect(c.name.length).toBeGreaterThan(0); }
    expect(a.clusters[0].cards.length).toBe(Math.max(...a.clusters.map((c) => c.cards.length)));
    expect(a.clusters.some((c) => c.name === 'Elf typal')).toBe(true);
  });

  it('a two-theme deck splits into at least two clusters, and none holds most of the non-staple cards', () => {
    const nonStaple = (net: DeckNetwork) => net.nodes.filter((n) => !n.commander && !n.staple).length;
    const staple = (net: DeckNetwork) => new Set(net.nodes.filter((n) => n.staple).map((n) => n.oracleId));
    /** The most non-staple cards any one cluster holds. */
    const biggest = (net: DeckNetwork) => Math.max(...net.clusters.map((c) => c.cards.filter((id) => !staple(net).has(id)).length));
    // the cEDH list has several themes
    expect(nets.cedh.clusters.length).toBeGreaterThanOrEqual(2);
    // an Elf deck that also holds the precon's Dragons: two clear themes
    const have = new Set(upgraded.main.map((e) => e.oracleId));
    const dragons = precon.main.filter((e) => !have.has(e.oracleId) && (db.features(e.oracleId)?.axes['typal:dragon']?.e ?? 0) >= 0.5 && (db.features(e.oracleId)?.landWeight ?? 0) < 1);
    expect(dragons.length).toBeGreaterThanOrEqual(20);
    const net = deckNetwork({ ...upgraded, main: [...upgraded.main, ...dragons] }, ctx);
    expect(net.clusters.length).toBeGreaterThanOrEqual(2);
    expect(net.clusters.map((c) => c.name)).toEqual(expect.arrayContaining(['Elf typal', 'Dragon typal']));
    expect(biggest(net)).toBeLessThan(nonStaple(net) / 2);
  });

  it('clusters use only theme edges of at least the minimum weight, never a commander spoke', () => {
    for (const net of [nets.precon, nets.upgraded, nets.cedh]) {
      const cluster = new Map<string, number>();
      for (const c of net.clusters) for (const id of c.cards) cluster.set(id, c.id);
      const isCommander = new Set(net.nodes.filter((n) => n.commander).map((n) => n.oracleId));
      expect(net.clusters.every((c) => c.cards.every((id) => !isCommander.has(id)))).toBe(true);
      // every clustered card has a theme edge of at least the minimum weight to another card of its cluster
      const ok = new Set<string>();
      for (const e of net.edges) {
        if (e.kind === 'commander' || e.weight < CLUSTER_MIN_EDGE) continue;
        if (cluster.has(e.a) && cluster.get(e.a) === cluster.get(e.b)) { ok.add(e.a); ok.add(e.b); }
      }
      for (const id of cluster.keys()) expect(ok.has(id), id).toBe(true);
    }
  });

  it('cohesion follows its formula', () => {
    const node = (id: string, unconnected = false): NetworkNode => ({
      oracleId: id, qty: 1, commander: false, staple: false, roles: [], axes: [], degree: 0, link: 0, cluster: null, unconnected,
    });
    const edge = (a: string, b: string, weight: number): NetworkEdge => ({ a, b, kind: 'feeds', weight, reasons: ['x', 'y'] });
    const cl = (id: number, cards: string[]): NetworkCluster => ({ id, key: `k${id}`, name: `c${id}`, cards, weight: 0 });
    const r = cohesionOf(
      ['a', 'b', 'c', 'd', 'e'].map((id) => node(id, id === 'e')),
      [edge('a', 'b', 1), edge('c', 'd', 0.5), edge('b', 'c', 0.5)],
      [cl(0, ['a', 'b']), cl(1, ['c', 'd'])],
    );
    expect(r.parts).toEqual({ connected: 0.8, clustered: 0.75 });
    expect(r.cohesion).toBe(78);
    expect(cohesionOf([], [], [])).toEqual({ cohesion: 0, parts: { connected: 0, clustered: 0 } });
  });

  it('a tight deck is more cohesive than the same deck with ten random cards', () => {
    for (const name of ['precon', 'upgraded'] as const) {
      const mixed = deckNetwork(withTenRandom(decks[name]), ctx);
      expect(mixed.cohesion, name).toBeLessThan(nets[name].cohesion);
    }
  });

  it('empty, commander-only, partial and commanderless decks give a finite network', () => {
    const empty = deckNetwork({ ...precon, commanders: [], main: [] }, ctx);
    expect(empty.nodes).toHaveLength(0);
    expect(empty.cohesion).toBe(0);
    const only = deckNetwork({ ...precon, main: [] }, ctx);
    expect(only.nodes).toHaveLength(1);
    expect(only.cohesion).toBe(0);
    for (const d of [{ ...precon, main: precon.main.slice(0, 40) }, { ...precon, commanders: [] }]) {
      const net = deckNetwork(d, ctx);
      expect(Number.isInteger(net.cohesion)).toBe(true);
      expect(net.cohesion).toBeGreaterThanOrEqual(0);
      expect(net.cohesion).toBeLessThanOrEqual(100);
      expect(JSON.stringify(net)).not.toMatch(/NaN|undefined/);
    }
  });

  it('partners, a companion, many copies and unknown ids', () => {
    const odd = oddDeck();
    const net: DeckNetwork = deckNetwork(odd, ctx);
    for (const id of odd.commanders) expect(net.nodes.find((n) => n.oracleId === id)?.commander).toBe(true);
    expect(net.nodes.some((n) => n.oracleId === odd.companion)).toBe(false);
    expect(net.nodes.some((n) => n.oracleId === 'not-a-card')).toBe(false);
    const many = odd.main[0].oracleId;
    expect(net.nodes.filter((n) => n.oracleId === many)).toHaveLength(1);
    expect(net.nodes.find((n) => n.oracleId === many)?.qty).toBe(30);
  });
});
