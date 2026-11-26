import { describe, expect, it } from 'vitest';
import { deckSizeFor, deckSizeOf, formatCardDb, formatOf, packageMinimum } from '@/engine/format';
import { canLead, validateDeck } from '@/engine/rules';
import type { Card, Deck } from '@/engine/types';
import { brawlFixtureDb, card, fixtureDb, standardBrawlFixtureDb } from '../helpers/fixture-db';
import { ctxOf, redDeck } from '../helpers/standard-brawl';

describe('Standard Brawl view of the card database', () => {
  const std = standardBrawlFixtureDb();

  it('says its format and a 60-card size; Commander and Brawl stay 100', () => {
    expect(formatOf(std)).toBe('standardbrawl');
    expect(deckSizeFor(std)).toBe(60);
    expect(deckSizeFor(fixtureDb())).toBe(100);
    expect(deckSizeFor(brawlFixtureDb())).toBe(100);
    expect(deckSizeOf('standardbrawl')).toBe(60);
  });

  it('pools only cards on Arena and legal in Standard Brawl', () => {
    const pool = std.all();
    expect(pool.length).toBeGreaterThan(50);
    expect(pool.some((c) => (c.arenaRarity ?? null) === null || c.standardBrawlLegality !== 'legal')).toBe(false);
    expect(std.byName('Sol Ring')?.legality).toBe('banned');
  });

  it('lets a planeswalker or legendary creature lead, as in Brawl', () => {
    expect(canLead(card('Krenko, Mob Boss'), 'standardbrawl')).toBe(true);
    expect(canLead(card('Lightning Bolt'), 'standardbrawl')).toBe(false);
  });

  it('packages need 5 cards in a 59-card deck and 8 in 99', () => {
    expect(packageMinimum('standardbrawl')).toBe(5);
    expect(packageMinimum('brawl')).toBe(8);
    expect(packageMinimum('commander')).toBe(8);
  });
});

describe('Standard Brawl deck rules', () => {
  const std = standardBrawlFixtureDb();
  const codes = (deck: Deck) => validateDeck(deck, std).map((v) => v.code);

  it('passes a legal 60-card deck', () => {
    const deck = redDeck(std);
    expect(validateDeck(deck, std)).toEqual([]);
  });

  it('fails 61 cards with the size reason', () => {
    const v = validateDeck(redDeck(std, 61), std).find((x) => x.code === 'size');
    expect(v?.message).toBe('The deck has 61 cards; it needs exactly 60 including the commander.');
  });

  it('fails 59 cards', () => {
    expect(codes(redDeck(std, 59))).toContain('size');
  });

  it('is not legal as a 100-card deck', () => {
    expect(codes(redDeck(std, 100))).toContain('size');
  });

  it('fails a duplicate of a non-basic card', () => {
    const deck = redDeck(std);
    deck.main[0] = { ...deck.main[0], qty: 2 };
    deck.main[deck.main.length - 1].qty -= 1;
    expect(codes(deck)).toContain('copies');
  });

  it('fails a card outside the commander colours', () => {
    const deck = redDeck(std);
    const green = std.all().find((c) => c.colorIdentity.includes('G'))!;
    deck.main[0] = { oracleId: green.oracleId, qty: 1, locked: false };
    const v = validateDeck(deck, std).find((x) => x.code === 'identity');
    expect(v?.oracleIds).toEqual([green.oracleId]);
  });

  it('fails a card that is not legal in Standard Brawl, naming the format', () => {
    const deck = redDeck(std);
    const bolt: Card = brawlFixtureDb().byName('Lightning Bolt')!;
    expect(std.byName('Lightning Bolt')?.standardBrawlLegality).not.toBe('legal');
    deck.main[0] = { oracleId: bolt.oracleId, qty: 1, locked: false };
    const v = validateDeck(deck, std).find((x) => x.oracleIds.includes(bolt.oracleId));
    expect(v?.message).toMatch(/Standard Brawl|not on MTG Arena/);
  });

  it('fails a companion and a second commander', () => {
    const deck = redDeck(std);
    const pair: Deck = { ...deck, commanders: [...deck.commanders, card('Rok-Tahk, Budding Scientist').oracleId] };
    expect(validateDeck(pair, std).find((x) => x.code === 'bad-pair')?.message).toBe('A Standard Brawl deck has one commander.');
  });

  it('is still the same deck under Commander rules: a Brawl view is not needed to build one', () => {
    expect(formatCardDb(fixtureDb(), [], 'commander')).toBe(fixtureDb());
    expect(ctxOf(std).db).toBe(std);
  });
});
