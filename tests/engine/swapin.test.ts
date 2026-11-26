import { describe, expect, it } from 'vitest';
import { swapIn } from '@/engine/builder';
import { parseDecklist } from '@/engine/text';
import type { Deck, EngineContext } from '@/engine/types';
import { deckText, fixtureDb } from '../helpers/fixture-db';

describe('swapIn', () => {
  const db = fixtureDb();
  const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
  const p = parseDecklist(deckText('upgraded'), db);
  const full: Deck = { id: null, name: 't', commanders: p.commanders, companion: null, chosenColor: null, main: p.main, targetBracket: 3, themeWeights: null };
  const opts = { ownedOnly: false, owned: null, maxPriceUsd: null, seed: 1 };
  const have = new Set([...full.commanders, ...full.main.map((e) => e.oracleId)]);
  // A nonland card that is not in the deck, found by trying a few until one is proposable.
  const outside = [...db.all()].filter((c) => !have.has(c.oracleId) && !db.features(c.oracleId)?.roles.includes('land'));
  const pick = (d: Deck) => outside.find((c) => swapIn(d, ctx, opts, c.oracleId, 3).length > 0)!;

  it('proposes swaps for a card outside the deck, sorted by rating after, with objections', () => {
    const inCard = pick(full);
    expect(inCard).toBeDefined();
    const list = swapIn(full, ctx, opts, inCard.oracleId, 5);
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(5);
    for (const s of list) { expect(s.in).toBe(inCard.oracleId); expect(s.out).not.toBe(''); expect(s.reason.length).toBeGreaterThan(0); }
    for (let i = 1; i < list.length; i++) expect(list[i - 1].ratingAfter).toBeGreaterThanOrEqual(list[i].ratingAfter);
    for (const s of list.filter((x) => x.agrees === false)) expect(s.objection).toBeTruthy();
  });

  it('never proposes cutting a commander or a locked card', () => {
    const inCard = pick(full);
    const locked: Deck = { ...full, main: full.main.map((e) => ({ ...e, locked: true })) };
    expect(swapIn(locked, ctx, opts, inCard.oracleId, 10)).toEqual([]);
    const some = full.main.filter((e) => !db.features(e.oracleId)?.roles.includes('land')).slice(0, 30).map((e) => e.oracleId);
    const half: Deck = { ...full, main: full.main.map((e) => ({ ...e, locked: some.includes(e.oracleId) })) };
    for (const s of swapIn(half, ctx, opts, inCard.oracleId, 10)) {
      expect(some).not.toContain(s.out);
      expect(full.commanders).not.toContain(s.out);
    }
  });

  it('a deck under 100 gets a plain add first', () => {
    const inCard = pick(full);
    const short: Deck = { ...full, main: full.main.slice(0, 80) };
    const list = swapIn(short, ctx, opts, inCard.oracleId, 5);
    expect(list.length).toBeGreaterThan(1);
    expect(list[0].out).toBe('');
    expect(list.slice(1).every((s) => s.out !== '')).toBe(true);
  });

  it('an off-identity card gets no proposals, nor does a card already in the deck', () => {
    const offId = outside.find((c) => db.features(c.oracleId) && swapIn(full, ctx, opts, c.oracleId, 3).length === 0 && !c.colorIdentity.every((k) => (db.get(full.commanders[0])?.colorIdentity ?? []).includes(k)));
    expect(offId).toBeDefined();
    expect(swapIn(full, ctx, opts, offId!.oracleId, 5)).toEqual([]);
    expect(swapIn(full, ctx, opts, full.main[0].oracleId, 5)).toEqual([]);
    expect(swapIn(full, ctx, opts, 'not-a-card', 5)).toEqual([]);
  });

  it('times one call on a full deck', () => {
    const t = performance.now();
    swapIn(full, ctx, opts, pick(full).oracleId, 5);
    console.log(`swapIn ms: ${Math.round(performance.now() - t)}`);
  });
});
