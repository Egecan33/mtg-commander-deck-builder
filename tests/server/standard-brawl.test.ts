import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AnalyzeResponse, CommandersResponse, DeckResponse, ImportResponse } from '@/app/lib/api';
import * as analyzeRoute from '@/app/api/analyze/route';
import * as commandersRoute from '@/app/api/commanders/route';
import * as deckRoute from '@/app/api/decks/[id]/route';
import * as decksRoute from '@/app/api/decks/route';
import * as edhrecRoute from '@/app/api/edhrec/route';
import * as importRoute from '@/app/api/import/route';
import * as buildRoute from '@/app/api/build/route';
import type { Deck } from '@/engine/types';
import { setActiveCollection } from '@/server/collection';
import type { Db } from '@/server/db';
import { deckFormat, getDeck } from '@/server/decks';
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
const deckOf = (commander: string, main: string[] = [], extra: Partial<Deck> = {}): Deck => ({
  id: null, name: 'Std', commanders: [id(commander)], companion: null, chosenColor: null,
  main: main.map((n) => ({ oracleId: id(n), qty: 1, locked: false })), targetBracket: 3, themeWeights: null, ...extra,
});

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'cf-stdbrawl-'));
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

describe('deck format', () => {
  it('is Commander for a Physical deck, whatever arenaFormat says', () => {
    const deck = deckOf('Krenko, Mob Boss');
    expect(deckFormat({ ...deck, collectionId: 'physical' })).toBe('commander');
    expect(deckFormat({ ...deck, collectionId: 'physical', arenaFormat: 'standardbrawl' })).toBe('commander');
  });
  it('is Brawl for an Arena deck without arenaFormat, Standard Brawl with it', () => {
    const deck = deckOf('Krenko, Mob Boss');
    expect(deckFormat({ ...deck, collectionId: 'arena' })).toBe('brawl');
    expect(deckFormat({ ...deck, collectionId: 'arena', arenaFormat: 'brawl' })).toBe('brawl');
    expect(deckFormat({ ...deck, collectionId: 'arena', arenaFormat: 'standardbrawl' })).toBe('standardbrawl');
  });
});

describe('Standard Brawl decks', () => {
  it('stores arenaFormat only when it is standardbrawl, so existing Arena decks stay as they are', async () => {
    setActiveCollection('arena');
    const plain = await ok<DeckResponse>(send(decksRoute.POST, 'POST', '/api/decks', { deck: deckOf('Krenko, Mob Boss') }));
    expect(plain.deck.arenaFormat).toBeUndefined();
    expect(plain.format).toBe('brawl');
    const std = await ok<DeckResponse>(send(decksRoute.POST, 'POST', '/api/decks', { deck: deckOf('Krenko, Mob Boss', [], { arenaFormat: 'standardbrawl' }) }));
    expect(std.deck.arenaFormat).toBe('standardbrawl');
    expect(std.format).toBe('standardbrawl');
    expect(getDeck(std.deck.id!)!.deck.arenaFormat).toBe('standardbrawl');
  });

  it('switches format by saving the deck again, and the deck is then checked under the other rules', async () => {
    setActiveCollection('arena');
    const saved = await ok<DeckResponse>(send(decksRoute.POST, 'POST', '/api/decks', { deck: deckOf('Krenko, Mob Boss', ['Mountain'], { arenaFormat: 'standardbrawl' }) }));
    const asStd = await ok<AnalyzeResponse>(send(analyzeRoute.POST, 'POST', '/api/analyze', { deck: saved.deck }));
    expect(asStd.format).toBe('standardbrawl');
    expect(asStd.rating.violations.find((v) => v.code === 'size')?.message).toMatch(/exactly 60/);
    expect(asStd.rating.subscores.some((s) => s.key === 'bracket')).toBe(false);
    expect(asStd.edhrec).toBe('off');
    const { arenaFormat: _drop, ...rest } = saved.deck;
    void _drop;
    const back = await ok<DeckResponse>(send(deckRoute.PUT, 'PUT', `/api/decks/${saved.deck.id}`, { deck: rest }, { id: saved.deck.id! }));
    expect(back.format).toBe('brawl');
    const asBrawl = await ok<AnalyzeResponse>(send(analyzeRoute.POST, 'POST', '/api/analyze', { deck: back.deck }));
    expect(asBrawl.rating.violations.find((v) => v.code === 'size')?.message).toMatch(/exactly 100/);
    expect(asBrawl.rating.subscores.some((s) => s.key === 'bracket')).toBe(true);
  });

  it('refuses a card that is not Standard Brawl legal, with the format named', async () => {
    const deck = { ...deckOf('Krenko, Mob Boss', ['Primeval Titan'], { arenaFormat: 'standardbrawl' }), collectionId: 'arena' };
    const r = await ok<AnalyzeResponse>(send(analyzeRoute.POST, 'POST', '/api/analyze', { deck }));
    const v = r.rating.violations.find((x) => x.oracleIds.includes(id('Primeval Titan')));
    expect(v?.message).toMatch(/not legal in Standard Brawl|banned in Standard Brawl|not on MTG Arena/);
  });

  it('builds a 60-card deck and never asks EDHREC', async () => {
    const deck = { ...deckOf('Krenko, Mob Boss', [], { arenaFormat: 'standardbrawl' }), collectionId: 'arena' };
    const built = await ok<{ deck: Deck }>(send(buildRoute.POST, 'POST', '/api/build', { deck, mode: 'auto', options: { seed: 5, craftableOnly: false } }));
    const total = built.deck.commanders.length + built.deck.main.reduce((n, e) => n + e.qty, 0);
    expect(total).toBe(60);
    const e = await ok<{ status: string }>(send(edhrecRoute.POST, 'POST', '/api/edhrec', { commanders: [id('Krenko, Mob Boss')], bracket: 3, format: 'standardbrawl' }));
    expect(e.status).toBe('off');
  });

  it('lists Standard Brawl commanders only for the Standard Brawl choice', async () => {
    setActiveCollection('arena');
    const std = await ok<CommandersResponse>(send(commandersRoute.GET, 'GET', '/api/commanders?pageSize=200&arenaFormat=standardbrawl'));
    const brawl = await ok<CommandersResponse>(send(commandersRoute.GET, 'GET', '/api/commanders?pageSize=200'));
    expect(std.total).toBeGreaterThan(0);
    expect(std.total).toBeLessThan(brawl.total);
    const names = brawl.commanders.map((c) => c.name);
    expect(names.length).toBeGreaterThan(0);
    const stdNames = new Set(std.commanders.map((c) => c.name));
    const view = getCardDb('standardbrawl');
    for (const n of stdNames) expect(view.byName(n)?.standardBrawlLegality).toBe('legal');
  });

  it('reads a list without sections for a Standard Brawl commander and tags the deck', async () => {
    setActiveCollection('arena');
    const text = 'Deck\n1 Mountain\n\nCommander\n1 Krenko, Mob Boss\n';
    const r = await ok<ImportResponse>(send(importRoute.POST, 'POST', '/api/import', { text, arenaFormat: 'standardbrawl' }));
    expect(r.deck.arenaFormat).toBe('standardbrawl');
    const plain = await ok<ImportResponse>(send(importRoute.POST, 'POST', '/api/import', { text }));
    expect(plain.deck.arenaFormat).toBeUndefined();
  });
});
