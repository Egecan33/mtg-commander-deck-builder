import { describe, expect, it } from 'vitest';
import { replaceCard } from '@/engine/builder';
import { parseDecklist } from '@/engine/text';
import type { Deck, EngineContext } from '@/engine/types';
import { deckText, fixtureDb } from '../helpers/fixture-db';

describe('replaceCard', () => {
  const db = fixtureDb();
  const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
  const p = parseDecklist(deckText('upgraded'), db);
  const deck: Deck = { id: null, name: 't', commanders: p.commanders, companion: null, chosenColor: null, main: p.main, targetBracket: 3, themeWeights: null };
  const opts = { ownedOnly: false, owned: null, maxPriceUsd: null, seed: 1 };

  it('returns swaps for a chosen card, ranked by rating after, never already in the deck', () => {
    const out = deck.main.find((e) => !db.features(e.oracleId)?.roles.includes('land'))!.oracleId;
    const list = replaceCard(deck, ctx, opts, out, 5);
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(5);
    const have = new Set(deck.main.map((e) => e.oracleId));
    for (const s of list) { expect(s.out).toBe(out); expect(have.has(s.in)).toBe(false); expect(s.reason.length).toBeGreaterThan(0); }
    for (let i = 1; i < list.length; i++) expect(list[i - 1].ratingAfter).toBeGreaterThanOrEqual(list[i].ratingAfter);
    for (const s of list.filter((x) => x.agrees === false)) expect(s.objection).toBeTruthy();
  });

  it('replaces a land with lands, and returns nothing for a card not in the deck', () => {
    const land = deck.main.find((e) => db.features(e.oracleId)?.roles.includes('land'))!.oracleId;
    for (const s of replaceCard(deck, ctx, opts, land, 4)) expect(db.features(s.in)?.roles.includes('land')).toBe(true);
    expect(replaceCard(deck, ctx, opts, 'not-a-card', 4)).toEqual([]);
  });
});
