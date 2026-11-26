import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AnalyzeResponse, CardsResponse, CommandersResponse, DeckResponse, DecksResponse, PartnersResponse } from '@/app/lib/api';
import * as analyzeRoute from '@/app/api/analyze/route';
import * as cardsRoute from '@/app/api/cards/route';
import * as commandersRoute from '@/app/api/commanders/route';
import * as deckRoute from '@/app/api/decks/[id]/route';
import * as partnersRoute from '@/app/api/partners/route';
import * as decksRoute from '@/app/api/decks/route';
import type { Deck } from '@/engine/types';
import { listCollections, setActiveCollection } from '@/server/collection';
import { holdersFor } from '@/server/holders';
import type { Db } from '@/server/db';
import { deckFormat, getDeck, listDecks } from '@/server/decks';
import { getCardDb } from '@/server/store';
import { seedDb, useServerDb } from './server-db';

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
const send = async (handler: unknown, method: string, url: string, body?: unknown, params: Record<string, string> = {}): Promise<Response> => {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return (handler as Handler)(new Request(new URL(url, 'http://localhost:3213'), init), { params: Promise.resolve(params) });
};
const ok = async <T>(res: Promise<Response>): Promise<T> => {
  const r = await res;
  expect(r.status).toBeLessThan(300);
  return (await r.json()) as T;
};

let db: Db;
let tmp: string;
const id = (name: string) => getCardDb().byName(name)!.oracleId;
const deckOf = (name: string, commander: string, main: string[]): Deck => ({
  id: null, name, commanders: [id(commander)], companion: null, chosenColor: null,
  main: main.map((n) => ({ oracleId: id(n), qty: 1, locked: false })), targetBracket: 3, themeWeights: null,
});

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'cf-deck-collections-'));
  db = seedDb(path.join(tmp, 'forge.db'));
  useServerDb(db);
});
afterAll(() => {
  useServerDb(null);
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});
beforeEach(() => {
  db.exec('DELETE FROM decks');
  setActiveCollection('physical');
});

describe('decks belong to a collection', () => {
  it('reads a deck saved before collections owned decks as Physical, without rewriting it', () => {
    const json = JSON.stringify({ name: 'Old', commanders: [id('Krenko, Mob Boss')], main: [{ oracleId: id('Sol Ring'), qty: 1 }], targetBracket: 3 });
    db.prepare('INSERT INTO decks(id, name, json, updated_at) VALUES (?, ?, ?, ?)').run('old', 'Old', json, '2026-11-01T00:00:00.000Z');
    expect(getDeck('old')!.deck.collectionId).toBe('physical');
    expect(listDecks().map((t) => [t.id, t.collectionId, t.format])).toEqual([['old', 'physical', 'commander']]);
    expect((db.prepare('SELECT json FROM decks WHERE id = ?').get('old') as { json: string }).json).toBe(json);
    setActiveCollection('arena');
    expect(listDecks()).toEqual([]);
  });

  it('gives a new deck the active collection and lists only the active collection\'s decks', async () => {
    const physical = await ok<DeckResponse>(send(decksRoute.POST, 'POST', '/api/decks', { deck: deckOf('Paper', 'Krenko, Mob Boss', []) }));
    expect(physical.deck.collectionId).toBe('physical');
    expect(physical.format).toBe('commander');
    setActiveCollection('arena');
    const arena = await ok<DeckResponse>(send(decksRoute.POST, 'POST', '/api/decks', { deck: deckOf('Brawl', 'Lathril, Blade of the Elves', []) }));
    expect(arena.deck.collectionId).toBe('arena');
    expect(arena.format).toBe('brawl');
    const listed = await ok<DecksResponse>(send(decksRoute.GET, 'GET', '/api/decks'));
    expect(listed.decks.map((t) => [t.name, t.collectionId, t.format])).toEqual([['Brawl', 'arena', 'brawl']]);
  });

  it('moves a deck between collections without touching its cards', async () => {
    const saved = await ok<DeckResponse>(send(decksRoute.POST, 'POST', '/api/decks', { deck: deckOf('Elves', 'Lathril, Blade of the Elves', ['Sol Ring', 'Llanowar Elves']) }));
    const deckId = saved.deck.id!;
    const moved = await ok<DeckResponse>(send(deckRoute.PUT, 'PUT', `/api/decks/${deckId}`, { deck: saved.deck, move: 'arena' }, { id: deckId }));
    expect(moved.deck.collectionId).toBe('arena');
    expect(moved.format).toBe('brawl');
    expect({ c: moved.deck.commanders, m: moved.deck.main, k: moved.deck.companion }).toEqual({ c: saved.deck.commanders, m: saved.deck.main, k: saved.deck.companion });
    const back = await ok<DeckResponse>(send(deckRoute.PUT, 'PUT', `/api/decks/${deckId}`, { deck: moved.deck, move: 'physical' }, { id: deckId }));
    expect(back.deck.collectionId).toBe('physical');
    expect(back.deck.main).toEqual(saved.deck.main);
    // A save that does not name a collection keeps the deck where it is.
    const { collectionId: _drop, ...rest } = back.deck;
    void _drop;
    setActiveCollection('arena');
    expect((await ok<DeckResponse>(send(deckRoute.PUT, 'PUT', `/api/decks/${deckId}`, { deck: rest }, { id: deckId }))).deck.collectionId).toBe('physical');
    const bad = await send(deckRoute.PUT, 'PUT', `/api/decks/${deckId}`, { deck: back.deck, move: 'nope' }, { id: deckId });
    expect(bad.status).toBe(400);
  });

  it('moves a deck only when asked: an ordinary save that carries another collection does not', async () => {
    const saved = await ok<DeckResponse>(send(decksRoute.POST, 'POST', '/api/decks', { deck: deckOf('Elves', 'Lathril, Blade of the Elves', []) }));
    const deckId = saved.deck.id!;
    await ok<DeckResponse>(send(deckRoute.PUT, 'PUT', `/api/decks/${deckId}`, { deck: saved.deck, move: 'arena' }, { id: deckId }));
    // An autosave from a page still holding the deck as it was before the move.
    const late = await ok<DeckResponse>(send(deckRoute.PUT, 'PUT', `/api/decks/${deckId}`, { deck: { ...saved.deck, name: 'Renamed', collectionId: 'physical' } }, { id: deckId }));
    expect(late.deck.collectionId).toBe('arena');
    expect(late.deck.name).toBe('Renamed');
    expect(getDeck(deckId)!.deck.collectionId).toBe('arena');
  });

  it('lets only a collection\'s own built decks hold its copies', async () => {
    const saved = await ok<DeckResponse>(send(decksRoute.POST, 'POST', '/api/decks', { deck: { ...deckOf('Built', 'Krenko, Mob Boss', ['Sol Ring']), built: true } }));
    expect(holdersFor('physical').map((h) => h.name)).toEqual(['Built (built)']);
    expect(listCollections().find((c) => c.id === 'physical')!.holders).toBe(1);
    const deckId = saved.deck.id!;
    await ok<DeckResponse>(send(deckRoute.PUT, 'PUT', `/api/decks/${deckId}`, { deck: saved.deck, move: 'arena' }, { id: deckId }));
    expect(holdersFor('physical')).toEqual([]);
    expect(listCollections().find((c) => c.id === 'physical')!.holders).toBe(0);
  });

  it('checks an Arena deck under Brawl rules and a Physical deck under Commander rules', async () => {
    const deck = deckOf('Elves', 'Lathril, Blade of the Elves', ['Sol Ring', 'Primeval Titan']);
    expect(deckFormat({ ...deck, collectionId: 'arena' })).toBe('brawl');
    expect(deckFormat({ ...deck, collectionId: 'physical' })).toBe('commander');
    const codes = (r: AnalyzeResponse) => r.rating.violations.filter((v) => v.code !== 'size').map((v) => v.code).sort();
    const arena = await ok<AnalyzeResponse>(send(analyzeRoute.POST, 'POST', '/api/analyze', { deck: { ...deck, collectionId: 'arena' } }));
    expect(codes(arena)).toEqual(['not-on-arena']);
    expect(arena.format).toBe('brawl');
    const paper = await ok<AnalyzeResponse>(send(analyzeRoute.POST, 'POST', '/api/analyze', { deck: { ...deck, collectionId: 'physical' } }));
    expect(codes(paper)).toEqual(['banned']); // Primeval Titan is banned in Commander, legal in Brawl
    expect(paper.format).toBe('commander');
  });

  it('browses only Arena cards for an Arena deck, and lists Brawl commanders while Arena is active', async () => {
    const deck = { ...deckOf('Elves', 'Lathril, Blade of the Elves', []), collectionId: 'arena' };
    const page = await ok<CardsResponse>(send(cardsRoute.POST, 'POST', '/api/cards', { deck, pageSize: 200, q: '' }));
    expect(page.total).toBeGreaterThan(100);
    expect(page.cards.every((c) => c.arenaRarity !== null)).toBe(true);
    setActiveCollection('arena');
    const commanders = await ok<CommandersResponse>(send(commandersRoute.GET, 'GET', '/api/commanders?q=Tyvar'));
    expect(commanders.commanders.map((c) => c.name)).toContain('Tyvar Kell');
    // Brawl has one commander: no partners while Arena is active.
    const thrasios = id('Thrasios, Triton Hero');
    expect((await ok<PartnersResponse>(send(partnersRoute.GET, 'GET', `/api/partners?id=${thrasios}`))).partners).toEqual([]);
    setActiveCollection('physical');
    expect((await ok<CommandersResponse>(send(commandersRoute.GET, 'GET', '/api/commanders?q=Tyvar'))).commanders).toEqual([]);
    expect((await ok<PartnersResponse>(send(partnersRoute.GET, 'GET', `/api/partners?id=${thrasios}`))).partners.length).toBeGreaterThan(0);
  });
});
