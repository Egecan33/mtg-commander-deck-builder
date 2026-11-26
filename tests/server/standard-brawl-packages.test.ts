import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AnalyzeResponse, CardsResponse, DeckResponse, NetworkResponse, PackagesResponse } from '@/app/lib/api';
import * as analyzeRoute from '@/app/api/analyze/route';
import * as cardsRoute from '@/app/api/cards/route';
import * as decksRoute from '@/app/api/decks/route';
import * as networkRoute from '@/app/api/network/route';
import * as packagesRoute from '@/app/api/packages/route';
import { standardBrawlPlayable } from '@/engine/format';
import type { Deck } from '@/engine/types';
import { setActiveCollection } from '@/server/collection';
import type { Db } from '@/server/db';
import { getCardDb } from '@/server/store';
import { seedDb, useServerDb } from './server-db';

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response;
const send = async (handler: unknown, method: string, url: string, body?: unknown): Promise<Response> => {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return (handler as Handler)(new Request(new URL(url, 'http://localhost:3213'), init), { params: Promise.resolve({}) });
};
const ok = async <T>(res: Promise<Response>): Promise<T> => {
  const r = await res;
  expect(r.status).toBeLessThan(300);
  return (await r.json()) as T;
};

let db: Db;
let tmp: string;
const id = (name: string) => getCardDb().byName(name)!.oracleId;
/** Krenko with the Standard Brawl pool's red cards and Mountains: 60 cards, an MTG Arena deck. */
function stdDeck(): Deck {
  const view = getCardDb('standardbrawl');
  const krenko = id('Krenko, Mob Boss');
  const spells = view.all().filter((c) => c.oracleId !== krenko && c.colorIdentity.every((x) => x === 'R') && !/\bLand\b/.test(c.typeLine)).slice(0, 35);
  const main = spells.map((c) => ({ oracleId: c.oracleId, qty: 1, locked: false }));
  main.push({ oracleId: id('Mountain'), qty: 59 - spells.length, locked: false });
  return { id: null, name: 'Std', commanders: [krenko], companion: null, chosenColor: null, main, targetBracket: 3, themeWeights: null, collectionId: 'arena', arenaFormat: 'standardbrawl' };
}

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'cf-stdpackages-'));
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

describe('Standard Brawl packages over the API', () => {
  it('plans packages of at least 5 and keeps its 0-1 wipes, with EDHREC off', async () => {
    const r = await ok<AnalyzeResponse>(send(analyzeRoute.POST, 'POST', '/api/analyze', { deck: stdDeck() }));
    expect(r.format).toBe('standardbrawl');
    expect(r.edhrec).toBe('off');
    expect(r.packages.packageMin).toBe(5);
    for (const p of r.packages.packages) expect(p.target).toBeGreaterThanOrEqual(5);
    expect(r.targets.packages!.wipes).toEqual({ lo: 0, hi: 1 });
    expect(r.packages.packages.find((p) => p.id === 'removal')!.wipes).toMatchObject({ lo: 0, hi: 1 });
  });

  it('draws the network of a 60-card deck', async () => {
    const net = await ok<NetworkResponse>(send(networkRoute.POST, 'POST', '/api/network', { deck: stdDeck() }));
    expect(net.nodes.length).toBeGreaterThan(0);
    expect(net.cohesion).toBeGreaterThanOrEqual(0);
  });

  it('filters the card search by package inside the Standard Brawl pool', async () => {
    const view = getCardDb('standardbrawl');
    const r = await ok<CardsResponse>(send(cardsRoute.POST, 'POST', '/api/cards', { deck: stdDeck(), filters: { package: 'ramp' }, pageSize: 200 }));
    expect(r.total).toBeGreaterThan(0);
    for (const c of r.cards) expect(standardBrawlPlayable(view.get(c.oracleId)!)).toBe(true);
  });

  it('keeps a Standard Brawl deck\'s 5-card package pin; a Commander deck\'s goes back to 8', async () => {
    setActiveCollection('arena');
    const std = await ok<DeckResponse>(send(decksRoute.POST, 'POST', '/api/decks', { deck: { ...stdDeck(), packageTargets: { 'fn:pillow-fort': 5 } } }));
    expect(std.deck.packageTargets).toEqual({ 'fn:pillow-fort': 5 });
    setActiveCollection('physical');
    const { arenaFormat: _a, collectionId: _c, ...plain } = stdDeck();
    void _a; void _c;
    const cmd = await ok<DeckResponse>(send(decksRoute.POST, 'POST', '/api/decks', { deck: { ...plain, packageTargets: { 'fn:pillow-fort': 5 } } }));
    expect(cmd.deck.packageTargets).toEqual({ 'fn:pillow-fort': 8 });
  });

  it('reads the Packages page in the active collection\'s format', async () => {
    const physical = await ok<PackagesResponse>(send(packagesRoute.GET, 'GET', '/api/packages?colors=R'));
    expect(physical.format).toBe('commander');
    expect(physical.packageMin).toBe(8);
    setActiveCollection('arena');
    const brawl = await ok<PackagesResponse>(send(packagesRoute.GET, 'GET', '/api/packages?colors=R'));
    expect(brawl.format).toBe('brawl');
    expect(brawl.packageMin).toBe(8);
    const std = await ok<PackagesResponse>(send(packagesRoute.GET, 'GET', '/api/packages?colors=R&arenaFormat=standardbrawl'));
    expect(std.format).toBe('standardbrawl');
    expect(std.packageMin).toBe(5);
    for (const p of std.packages) expect(p.cards.length).toBeLessThanOrEqual(5);
  });
});
