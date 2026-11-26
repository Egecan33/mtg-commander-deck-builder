import { describe, expect, it } from 'vitest';
import { formatOf } from '@/engine/format';
import { canLead, validateDeck } from '@/engine/rules';
import { createScorer } from '@/engine/scoring';
import type { CardDb, Deck, EngineContext } from '@/engine/types';
import { brawlFixtureDb, card, fixtureDb } from '../helpers/fixture-db';

const deckOf = (commander: string, main: string[] = []): Deck => ({
  id: null, name: 't', commanders: [card(commander).oracleId], companion: null, chosenColor: null,
  main: main.map((n) => ({ oracleId: card(n).oracleId, qty: 1, locked: false })), targetBracket: 3, themeWeights: null,
});
const ctxOf = (db: CardDb): EngineContext => ({ db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} });
const codesFor = (deck: Deck, db: CardDb, name: string) =>
  validateDeck(deck, db).filter((v) => v.oracleIds.includes(card(name).oracleId)).map((v) => v.code);

describe('Brawl view of the card database', () => {
  const brawl = brawlFixtureDb();

  it('says its format; the plain database is Commander', () => {
    expect(formatOf(brawl)).toBe('brawl');
    expect(formatOf(fixtureDb())).toBe('commander');
  });

  it('pools only cards on Arena and legal in Brawl, Commander-banned ones included', () => {
    const pool = brawl.all();
    expect(pool.length).toBeGreaterThan(500);
    expect(pool.some((c) => (c.arenaRarity ?? null) === null)).toBe(false);
    expect(pool.some((c) => c.brawlLegality !== 'legal')).toBe(false);
    const ids = new Set(pool.map((c) => c.oracleId));
    expect(ids.has(card('Sol Ring').oracleId)).toBe(false);
    expect(ids.has(card('Ancient Tomb').oracleId)).toBe(false);
    expect(ids.has(card('Primeval Titan').oracleId)).toBe(true);
    expect(brawl.get(card('Primeval Titan').oracleId)?.legality).toBe('legal');
    expect(brawl.byName('Sol Ring')?.legality).toBe('banned');
  });
});

describe('Brawl deck rules', () => {
  const brawl = brawlFixtureDb();
  const commander = fixtureDb();

  it('lets a planeswalker lead a Brawl deck, not a Commander deck', () => {
    expect(canLead(card('Tyvar Kell'), 'brawl')).toBe(true);
    expect(canLead(card('Tyvar Kell'), 'commander')).toBe(false);
    expect(codesFor(deckOf('Tyvar Kell'), brawl, 'Tyvar Kell')).toEqual([]);
    expect(codesFor(deckOf('Tyvar Kell'), commander, 'Tyvar Kell')).toContain('bad-commander');
    expect(canLead(card('Lightning Bolt'), 'brawl')).toBe(false);
  });

  it('makes a Brawl deck illegal for a card that is not on Arena', () => {
    const deck = deckOf('Lathril, Blade of the Elves', ['Sol Ring']);
    expect(codesFor(deck, brawl, 'Sol Ring')).toEqual(['not-on-arena']);
    expect(validateDeck(deck, brawl).find((v) => v.code === 'not-on-arena')?.message).toBe('Sol Ring is not on MTG Arena.');
    expect(codesFor(deck, commander, 'Sol Ring')).toEqual([]);
  });

  it('makes a Brawl deck illegal for a Brawl-banned card that Commander allows', () => {
    const deck = deckOf('Lathril, Blade of the Elves', ['Ancient Tomb']);
    expect(codesFor(deck, brawl, 'Ancient Tomb')).toEqual(['banned']);
    expect(validateDeck(deck, brawl).find((v) => v.code === 'banned')?.message).toBe('Ancient Tomb is banned in Brawl.');
    expect(codesFor(deck, commander, 'Ancient Tomb')).toEqual([]);
  });

  it('allows a Commander-banned card that is legal in Brawl', () => {
    const deck = deckOf('Lathril, Blade of the Elves', ['Primeval Titan']);
    expect(codesFor(deck, brawl, 'Primeval Titan')).toEqual([]);
    expect(codesFor(deck, commander, 'Primeval Titan')).toEqual(['banned']);
  });

  it('reports a commander that is not on Arena', () => {
    const notOnArena = fixtureDb().all().find((c) => canLead(c, 'commander') && (c.arenaRarity ?? null) === null);
    expect(notOnArena).toBeDefined();
    const deck: Deck = { ...deckOf('Lathril, Blade of the Elves'), commanders: [notOnArena!.oracleId] };
    expect(codesFor(deck, brawl, notOnArena!.name)).toContain('not-on-arena');
  });

  it('gates a card that is not on Arena in the Brawl scorer, even handed the Commander card object', () => {
    const deck = deckOf('Lathril, Blade of the Elves');
    const score = createScorer(deck, ctxOf(brawl)).score(card('Sol Ring'));
    expect(score.score).toBe(0);
    expect(score.gate?.code).toBe('not-on-arena');
    expect(createScorer(deck, ctxOf(commander)).score(card('Sol Ring')).gate).toBeNull();
  });
});
