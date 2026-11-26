import { describe, expect, it } from 'vitest';
import { autoBuild } from '@/engine/builder';
import { deckNetwork, isRingCard, linkIndex } from '@/engine/network';
import { rateDeck } from '@/engine/rating';
import { CONNECTION_LOSS, createScorer } from '@/engine/scoring/scorer';
import { deckCards, isLandCard } from '@/engine/summary';
import { cardFitsDeck, copyLimit } from '@/engine/rules';
import { ROLE_LABEL, bandRoles } from '@/engine/targets';
import type { Bracket, Card, Deck, EngineContext, Role } from '@/engine/types';
import { card, fixtureDb } from '../helpers/fixture-db';
import { fixtureDeck } from '../helpers/network';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const upgraded = fixtureDeck('upgraded', 3);
const REASON = /connects to nothing in this deck/;
const synergy = (s: { parts: { key: string; points: number }[] }) => s.parts.find((p) => p.key === 'synergy')!.points;

function sacrificeDecks(): { a: Deck; b: Deck; x: Card; y: Card } {
  const weights = { 'typal:elf': 1, typal: 0.8, sacrifice: 0.25 };
  const base: Deck = {
    ...upgraded, themeWeights: weights,
    main: upgraded.main.filter((e) => (db.features(e.oracleId)?.axes.sacrifice?.e ?? 0) < 0.6),
  };
  const pool = db.all().filter((c) => {
    const f = db.features(c.oracleId);
    return !!f && !isLandCard(f) && !isRingCard(f) && copyLimit(c) === 1 && cardFitsDeck(c, upgraded, db) === null && !base.main.some((e) => e.oracleId === c.oracleId);
  });
  const enablers = pool.filter((c) => (db.features(c.oracleId)!.axes.sacrifice?.e ?? 0) >= 0.9);
  const payoffs = pool.filter((c) => (db.features(c.oracleId)!.axes.sacrifice?.p ?? 0) >= 0.9);
  expect(enablers.length).toBeGreaterThan(0);
  expect(payoffs.length).toBeGreaterThan(0);
  for (const y of enablers) {
    const a: Deck = { ...base, main: [...base.main, { oracleId: y.oracleId, qty: 1, locked: false }] };
    for (const x of payoffs) {
      if (x.oracleId === y.oracleId) continue;
      const link = createScorer(a, ctx).commanderLink(x) ?? 1;
      const alone = linkIndex(base, db, weights).strongest(x)?.weight ?? 0;
      if (link < 0.3 && alone < 0.15) return { a, b: base, x, y };
    }
  }
  throw new Error('no sacrifice enabler and payoff pair in the fixture');
}

describe('the connection term', () => {
  it('a card with no partner loses synergy points, at most 15', () => {
    const { a, b, x } = sacrificeDecks();
    const inA = createScorer(a, ctx).score(x);
    const inB = createScorer(b, ctx).score(x);
    expect(inB.reasons.some((r) => REASON.test(r))).toBe(true);
    expect(inA.reasons.some((r) => REASON.test(r))).toBe(false);
    const drop = synergy(inA) - synergy(inB);
    expect(drop).toBeGreaterThan(0);
    expect(drop).toBeLessThanOrEqual(CONNECTION_LOSS + 1e-9);
  });

  it('ring cards, lands and commanders never lose points for connection', () => {
    for (const name of ['precon', 'upgraded', 'cedh'] as const) {
      const deck = fixtureDeck(name, name === 'precon' ? 2 : name === 'upgraded' ? 3 : 5);
      const scorer = createScorer(deck, ctx);
      for (const { card: c, features } of deckCards(deck, db).cards) {
        if (!isRingCard(features) && !isLandCard(features) && !deck.commanders.includes(c.oracleId)) continue;
        expect(scorer.score(c).reasons.some((r) => REASON.test(r)), c.name).toBe(false);
      }
    }
  });

  it('the scorer and the network agree on who connects to nothing', () => {
    for (const name of ['precon', 'upgraded', 'cedh'] as const) {
      const deck = fixtureDeck(name, name === 'precon' ? 2 : name === 'upgraded' ? 3 : 5);
      const scorer = createScorer(deck, ctx);
      const flagged = deckCards(deck, db).cards
        .filter(({ card: c }) => scorer.score(c).reasons.some((r) => REASON.test(r)))
        .map(({ card: c }) => c.oracleId);
      expect(new Set(flagged)).toEqual(new Set(deckNetwork(deck, ctx).unconnected));
    }
  });

  it('an auto-build has no unconnected cards when the pool allows', () => {
    const shell: Deck = {
      id: null, name: 'Lathril', commanders: [card('Lathril, Blade of the Elves').oracleId], companion: null, chosenColor: null,
      main: [], targetBracket: 3, themeWeights: null,
    };
    const built = autoBuild(shell, ctx, { ownedOnly: false, owned: null, maxPriceUsd: null, seed: 1 });
    expect(deckNetwork(built, ctx).unconnected).toEqual([]);
    expect(rateDeck(built, ctx).rating).toBeGreaterThan(0);
  });

  it('every role the rating holds against a band is a ring role', () => {
    for (const role of Object.keys(ROLE_LABEL) as Role[]) {
      const f = { ...db.features(card('Island').oracleId)!, landWeight: 0, roles: [role] };
      expect(isRingCard(f), role).toBe(true);
    }
  });

  // Review C2: Grafdigger's Cage, Soul-Guide Lantern and Darksteel Reactor were "connects to nothing" in auto-builds.
  it('auto-builds of the fixture commanders have no role card in unconnected', () => {
    const builds: [string, Bracket][] = [
      ['Loran of the Third Path', 2], ['Wilson, Refined Grizzly', 3], ['Kozilek, the Great Distortion', 3],
      ['Kinnan, Bonder Prodigy', 3], ['Krenko, Mob Boss', 3], ['Talrand, Sky Summoner', 2],
    ];
    for (const [name, bracket] of builds) {
      const shell: Deck = { id: null, name, commanders: [card(name).oracleId], companion: null, chosenColor: null, main: [], targetBracket: bracket, themeWeights: null };
      const built = autoBuild(shell, ctx, { ownedOnly: false, owned: null, maxPriceUsd: null, seed: 1 });
      const roleCards = deckNetwork(built, ctx).unconnected
        .filter((id) => bandRoles(db.get(id)!, db.features(id)!, bracket).length > 0)
        .map((id) => db.get(id)!.name);
      expect(roleCards, name).toEqual([]);
    }
  });
});
