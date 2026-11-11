import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as api from '@/app/lib/api';
import type { AnalyzeResponse, CardsResponse, DeckResponse, ImportResponse, ScoredCard } from '@/app/lib/api';
import * as analyzeRoute from '@/app/api/analyze/route';
import * as buildRoute from '@/app/api/build/route';
import * as cardsRoute from '@/app/api/cards/route';
import * as collectionRoute from '@/app/api/collection/route';
import * as commandersRoute from '@/app/api/commanders/route';
import * as deckRoute from '@/app/api/decks/[id]/route';
import * as decksRoute from '@/app/api/decks/route';
import * as edhrecRoute from '@/app/api/edhrec/route';
import * as exportRoute from '@/app/api/export/route';
import * as imgRoute from '@/app/api/img/[size]/[file]/route';
import * as importRoute from '@/app/api/import/route';
import * as partnersRoute from '@/app/api/partners/route';
import * as settingsRoute from '@/app/api/settings/route';
import * as statusRoute from '@/app/api/status/route';
import * as syncRoute from '@/app/api/sync/route';
import { canPair, isBasicLand, isCommanderEligible, validateDeck } from '@/engine/rules';
import type { Deck } from '@/engine/types';
import { getAnalysis } from '@/server/context';
import type { Db } from '@/server/db';
import { getEdhrec, edhrecSlug, parseEdhrecPage } from '@/server/edhrec';
import { getCardDb } from '@/server/store';
import { startSync, syncState } from '@/server/sync-runner';
import { deckText } from '../helpers/fixture-db';
import { seedDb, useServerDb } from './server-db';

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Response | Promise<Response>;
type RouteModule = Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE', unknown>>;

const ROUTES: [RegExp, RouteModule][] = [
  [/^\/api\/status$/, statusRoute], [/^\/api\/sync$/, syncRoute], [/^\/api\/commanders$/, commandersRoute],
  [/^\/api\/partners$/, partnersRoute], [/^\/api\/decks$/, decksRoute], [/^\/api\/decks\/(?<id>[^/]+)$/, deckRoute],
  [/^\/api\/analyze$/, analyzeRoute], [/^\/api\/cards$/, cardsRoute], [/^\/api\/build$/, buildRoute],
  [/^\/api\/import$/, importRoute], [/^\/api\/export$/, exportRoute], [/^\/api\/collection$/, collectionRoute],
  [/^\/api\/settings$/, settingsRoute], [/^\/api\/edhrec$/, edhrecRoute],
  [/^\/api\/img\/(?<size>[^/]+)\/(?<file>[^/]+)$/, imgRoute],
];

/** Calls the route handler a real request to `url` would reach. */
async function request(method: string, url: string, body?: unknown): Promise<Response> {
  const u = new URL(url, 'http://localhost:3210');
  for (const [pattern, mod] of ROUTES) {
    const m = pattern.exec(u.pathname);
    if (!m) continue;
    const handler = mod[method as keyof RouteModule] as Handler | undefined;
    if (!handler) return new Response('method not allowed', { status: 405 });
    const params = Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)]));
    const init: RequestInit = { method };
    if (body !== undefined) {
      init.body = typeof body === 'string' ? body : JSON.stringify(body);
      init.headers = { 'Content-Type': 'application/json' };
    }
    return handler(new Request(u, init), { params: Promise.resolve(params) });
  }
  return new Response('not found', { status: 404 });
}
const call = async <T>(method: string, url: string, body?: unknown): Promise<T> => {
  const res = await request(method, url, body);
  expect(res.status, `${method} ${url}`).toBeLessThan(300);
  return (await res.json()) as T;
};

let db: Db;
let tmp: string;
const envBefore = { db: process.env.COMMANDER_FORGE_DB, data: process.env.COMMANDER_FORGE_DATA };

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'commander-forge-api-'));
  process.env.COMMANDER_FORGE_DATA = tmp;
  db = seedDb(path.join(tmp, 'forge.db'));
  useServerDb(db);
});
afterAll(() => {
  useServerDb(null);
  db.close();
  rmSync(tmp, { recursive: true, force: true });
  if (envBefore.db === undefined) delete process.env.COMMANDER_FORGE_DB;
  else process.env.COMMANDER_FORGE_DB = envBefore.db;
  if (envBefore.data === undefined) delete process.env.COMMANDER_FORGE_DATA;
  else process.env.COMMANDER_FORGE_DATA = envBefore.data;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const id = (name: string): string => {
  const c = getCardDb().byName(name);
  if (!c) throw new Error(`fixture card not found: ${name}`);
  return c.oracleId;
};
const shell = (commanders: string[], over: Partial<Deck> = {}): Deck => ({
  id: null, name: 'Test', commanders: commanders.map(id), companion: null, chosenColor: null, main: [], targetBracket: 3,
  themeWeights: null, ...over,
});
const imported = async (name: 'precon' | 'upgraded' | 'cedh', targetBracket = 2): Promise<Deck> =>
  (await call<ImportResponse>('POST', '/api/import', { text: deckText(name), targetBracket })).deck;
const size = (d: Deck) => d.commanders.length + d.main.reduce((n, e) => n + e.qty, 0);
const scoresDescending = (cards: ScoredCard[]) => cards.every((c, i) => i === 0 || cards[i - 1].score.score >= c.score.score);
/** Every gated card sits after every card that is not gated. */
const gatedLast = (cards: ScoredCard[]) => {
  const firstGated = cards.findIndex((c) => c.score.gate !== null);
  return firstGated === -1 || cards.slice(firstGated).every((c) => c.score.gate !== null);
};

describe('GET /api/status', () => {
  it('reports the seeded database', async () => {
    const s = await call<api.StatusResponse>('GET', '/api/status');
    expect(s.error).toBeNull();
    expect(s.ready).toBe(true);
    expect(s.counts.cards).toBeGreaterThan(500);
    expect(s.counts.legal + s.counts.banned).toBe(s.counts.cards);
    expect(s.counts.features).toBe(s.counts.cards);
    expect(s.counts.gameChangers).toBeGreaterThan(0);
    expect(s.steps.cards?.finishedAt).toMatch(/^\d{4}-/);
    expect(s.steps.images).toBeNull();
    expect(s.stale).toBe(false);
    expect(s.settings.edhrecEnabled).toBe(false);
    expect(s.sync.running).toBe(false);
  });

  it('works on a first run, when there is no database file yet', async () => {
    process.env.COMMANDER_FORGE_DB = path.join(tmp, 'first-run', 'nested', 'forge.db');
    useServerDb(null);
    try {
      const res = await request('GET', '/api/status');
      expect(res.status).toBe(200);
      const s = (await res.json()) as api.StatusResponse;
      expect(s.error).toBeNull();
      expect(s.ready).toBe(false);
      expect(s.stale).toBe(true);
      expect(s.cardsSyncedAt).toBeNull();
      expect(s.counts).toMatchObject({ cards: 0, legal: 0, banned: 0, gameChangers: 0, features: 0, combos: 0, decks: 0, collection: 0 });
      expect(Object.values(s.steps).every((v) => v === null)).toBe(true);
      // The other endpoints answer on an empty database too.
      expect((await call<api.CommandersResponse>('GET', '/api/commanders')).total).toBe(0);
      expect((await call<api.DecksResponse>('GET', '/api/decks')).decks).toEqual([]);
      const empty: Deck = { id: null, name: 'x', commanders: [], companion: null, chosenColor: null, main: [], targetBracket: 3, themeWeights: null };
      const a = await call<AnalyzeResponse>('POST', '/api/analyze', { deck: empty });
      expect(a.rating.rating).toBeGreaterThanOrEqual(0);
      expect((await call<CardsResponse>('POST', '/api/cards', { deck: empty })).total).toBe(0);
    } finally {
      const { serverState } = await import('@/server/state');
      serverState().db?.close();
      delete process.env.COMMANDER_FORGE_DB;
      useServerDb(db);
    }
  });

  it('reports a database that cannot be opened instead of throwing', async () => {
    const dir = path.join(tmp, 'not-a-file.db');
    mkdirSync(dir);
    process.env.COMMANDER_FORGE_DB = dir;
    useServerDb(null);
    try {
      const res = await request('GET', '/api/status');
      expect(res.status).toBe(200);
      const s = (await res.json()) as api.StatusResponse;
      expect(s.ready).toBe(false);
      expect(typeof s.error).toBe('string');
      expect(s.counts.cards).toBe(0);
    } finally {
      delete process.env.COMMANDER_FORGE_DB;
      useServerDb(db);
    }
  });
});

describe('POST /api/analyze', () => {
  it('rates the precon and scores every card in it', async () => {
    const deck = await imported('precon');
    const a = await call<AnalyzeResponse>('POST', '/api/analyze', { deck });
    expect(size(deck)).toBe(100);
    expect(a.summary.cardCount).toBe(100);
    expect(a.rating.rating).toBeGreaterThanOrEqual(0);
    expect(a.rating.rating).toBeLessThanOrEqual(100);
    expect(a.rating.subscores).toHaveLength(8);
    expect(a.rating.legal).toBe(true);
    expect([1, 2, 3, 4]).toContain(a.bracket.floor);
    expect(a.targets.lands).toBeGreaterThan(20);
    expect(Object.keys(a.themeWeights).length).toBeGreaterThan(0);
    const ids = [...deck.commanders, ...deck.main.map((e) => e.oracleId)];
    expect(Object.keys(a.deckScores).sort()).toEqual([...new Set(ids)].sort());
    for (const s of Object.values(a.deckScores)) {
      expect(Number.isInteger(s.score)).toBe(true);
      expect(s.score).toBeGreaterThanOrEqual(0);
      expect(s.score).toBeLessThanOrEqual(100);
    }
    for (const cid of ids) expect(a.cards[cid]?.name, cid).toBeTruthy();
    for (const found of [...a.bracket.combos.included, ...a.bracket.combos.oneAway]) {
      for (const c of found.combo.cards) expect(a.cards[c.oracleId]).toBeDefined();
    }
    expect(a.unknown).toEqual([]);
    expect(a.edhrec).toBe('off');
  });

  it('handles an empty deck, a short deck and unknown cards without throwing', async () => {
    const none = await call<AnalyzeResponse>('POST', '/api/analyze', { deck: { ...shell([]), commanders: [] } });
    expect(none.rating.complete).toBe(false);
    expect(none.deckScores).toEqual({});
    const ghost = '00000000-0000-4000-8000-000000000000';
    const short = shell(["Atraxa, Praetors' Voice"], { main: [{ oracleId: id('Sol Ring'), qty: 1, locked: false }, { oracleId: ghost, qty: 1, locked: false }] });
    const a = await call<AnalyzeResponse>('POST', '/api/analyze', { deck: short });
    expect(a.unknown).toEqual([ghost]);
    expect(a.cards[ghost]).toBeUndefined();
    expect(a.rating.violations.some((v) => v.code === 'unknown-card')).toBe(true);
    expect(a.deckScores[id('Sol Ring')].score).toBeGreaterThan(0);
  });

  it('rejects bodies that are not a deck with 400 and repairs small faults', async () => {
    expect((await request('POST', '/api/analyze', 'not json')).status).toBe(400);
    expect((await request('POST', '/api/analyze', {})).status).toBe(400);
    expect((await request('POST', '/api/analyze', { deck: { commanders: 'x' } })).status).toBe(400);
    expect((await request('POST', '/api/analyze', { deck: { commanders: ['a', 'b', 'c'] } })).status).toBe(400);
    expect((await request('POST', '/api/analyze', { deck: { targetBracket: 9 } })).status).toBe(400);
    const res = await request('POST', '/api/analyze', { deck: { main: [{ qty: 1 }] } });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/oracleId/);
    // Duplicate entries merge, fractional and non-positive quantities are repaired.
    const sol = id('Sol Ring');
    const messy = { commanders: [id('Krenko, Mob Boss')], main: [{ oracleId: id('Mountain'), qty: 2.9 }, { oracleId: id('Mountain'), qty: 3 }, { oracleId: sol, qty: 0 }, { oracleId: sol, qty: -4 }] };
    const a = await call<AnalyzeResponse>('POST', '/api/analyze', { deck: messy });
    expect(a.summary.cardCount).toBe(6);
    expect(a.deckScores[sol]).toBeUndefined();
  });
});

describe('POST /api/cards', () => {
  it('returns only ramp cards, sorted by score, gated last', async () => {
    const deck = await imported('precon');
    const r = await call<CardsResponse>('POST', '/api/cards', { deck, filters: { role: 'ramp' }, pageSize: 200 });
    expect(r.total).toBeGreaterThan(20);
    expect(r.cards.length).toBe(Math.min(200, r.total));
    expect(r.cards.every((c) => c.roles.includes('ramp'))).toBe(true);
    expect(gatedLast(r.cards)).toBe(true);
    const open = r.cards.filter((c) => c.score.gate === null);
    expect(open.length).toBeGreaterThan(5);
    expect(scoresDescending(open)).toBe(true);
    expect(r.cards.filter((c) => c.score.gate).every((c) => c.score.score === 0)).toBe(true);
    expect(Object.keys(r.cards[0]).sort()).toEqual(
      ['cmc', 'colorIdentity', 'frontName', 'gameChanger', 'imageFaces', 'manaCost', 'name', 'oracleId', 'owned', 'priceUsd', 'roles', 'score', 'typeLine'].sort(),
    );
  });

  it('pages the whole pool consistently and reuses the scored pool for the same deck', async () => {
    const deck = await imported('precon');
    const legalPool = getCardDb().all().length;
    const first = await call<CardsResponse>('POST', '/api/cards', { deck, page: 1, pageSize: 50 });
    const pool = getAnalysis(deck).pool();
    const second = await call<CardsResponse>('POST', '/api/cards', { deck, page: 2, pageSize: 50 });
    const both = await call<CardsResponse>('POST', '/api/cards', { deck, page: 1, pageSize: 100 });
    expect(first.total).toBe(legalPool);
    expect(second.total).toBe(legalPool);
    expect([...first.cards, ...second.cards].map((c) => c.oracleId)).toEqual(both.cards.map((c) => c.oracleId));
    expect(new Set(both.cards.map((c) => c.oracleId)).size).toBe(100);
    // Same deck (a renamed copy, locks changed): the scored pool is the cached one.
    const renamed: Deck = { ...deck, name: 'Other name', main: deck.main.map((e) => ({ ...e, locked: true })) };
    expect(getAnalysis(renamed).pool()).toBe(pool);
    // A changed deck is scored afresh.
    expect(getAnalysis({ ...deck, main: deck.main.slice(1) }).pool()).not.toBe(pool);
    const last = await call<CardsResponse>('POST', '/api/cards', { deck, page: 99999, pageSize: 50 });
    expect(last.cards).toEqual([]);
    const all = await call<CardsResponse>('POST', '/api/cards', { deck, pageSize: 200, page: Math.ceil(legalPool / 200) });
    expect(gatedLast(all.cards)).toBe(true);
    expect(all.cards.at(-1)?.score.gate).not.toBeNull();
  });

  it('applies every filter', async () => {
    const deck = await imported('precon');
    const q = (body: object) => call<CardsResponse>('POST', '/api/cards', { deck, pageSize: 200, ...body });
    const cdb = getCardDb();

    const legal = await q({ filters: { legalAtBracket: true } });
    expect(legal.cards.every((c) => c.score.gate === null)).toBe(true);
    expect(legal.total).toBeLessThan(cdb.all().length);

    const mv = await q({ filters: { mvMin: 2, mvMax: 3 } });
    expect(mv.total).toBeGreaterThan(0);
    expect(mv.cards.every((c) => c.cmc >= 2 && c.cmc <= 3)).toBe(true);

    const creatures = await q({ filters: { type: 'Creature' } });
    expect(creatures.cards.every((c) => /creature/i.test(c.typeLine))).toBe(true);

    const cheap = await q({ filters: { maxPrice: 1 } });
    expect(cheap.cards.every((c) => c.priceUsd !== null && c.priceUsd <= 1)).toBe(true);

    const green = await q({ filters: { colors: ['G'] } });
    expect(green.cards.every((c) => c.colorIdentity.includes('G'))).toBe(true);
    const monoGreen = await q({ filters: { colors: ['G'], colorMode: 'exact' } });
    expect(monoGreen.cards.every((c) => c.colorIdentity.join('') === 'G')).toBe(true);
    const colourless = await q({ filters: { colors: ['C'] } });
    expect(colourless.total).toBeGreaterThan(0);
    expect(colourless.cards.every((c) => c.colorIdentity.length === 0)).toBe(true);
    const within = await q({ filters: { colors: ['G', 'U'], colorMode: 'within' } });
    expect(within.cards.every((c) => c.colorIdentity.every((x) => x === 'G' || x === 'U'))).toBe(true);

    const axis = await q({ filters: { axis: 'tokens' } });
    expect(axis.total).toBeGreaterThan(0);
    expect(axis.cards.every((c) => {
      const a = cdb.features(c.oracleId)?.axes.tokens;
      return a !== undefined && Math.max(a.e, a.p) >= 0.5;
    })).toBe(true);

    const inDeck = await q({ filters: { inDeck: true } });
    expect(inDeck.total).toBe(new Set([...deck.commanders, ...deck.main.map((e) => e.oracleId)]).size);
    const notInDeck = await q({ filters: { inDeck: false } });
    expect(inDeck.total + notInDeck.total).toBe(cdb.all().length);

    expect((await request('POST', '/api/cards', { deck, filters: { role: 'nonsense' } })).status).toBe(400);
  });

  it('searches name, type and text, name matches first, and sorts by other keys', async () => {
    const deck = await imported('precon');
    const q = (body: object) => call<CardsResponse>('POST', '/api/cards', { deck, pageSize: 200, ...body });
    const sol = await q({ q: 'sol ring' });
    expect(sol.cards[0].name).toBe('Sol Ring');
    const curly = await q({ q: 'ATRAXA, praetors’ voice' });
    expect(curly.cards[0].name).toBe("Atraxa, Praetors' Voice");
    const text = await q({ q: 'destroy target' });
    expect(text.total).toBeGreaterThan(3);
    expect(text.cards.every((c) => /destroy/i.test(getCardDb().get(c.oracleId)?.oracleText ?? ''))).toBe(true);
    expect((await q({ q: 'zzzz no such card' })).total).toBe(0);

    const byName = await q({ sort: 'name', filters: { legalAtBracket: true } });
    const names = byName.cards.map((c) => c.name.toLowerCase());
    expect(names.length).toBeGreaterThan(10);
    expect(names.every((n, i) => i === 0 || names[i - 1].localeCompare(n) <= 0 || names[i - 1] <= n)).toBe(true);
    const byMv = await q({ sort: 'mv', dir: 'desc', filters: { legalAtBracket: true } });
    expect(byMv.cards.every((c, i) => i === 0 || byMv.cards[i - 1].cmc >= c.cmc)).toBe(true);
    const byPrice = await q({ sort: 'price', filters: { legalAtBracket: true, maxPrice: 1000 } });
    expect(byPrice.cards.every((c, i) => i === 0 || (byPrice.cards[i - 1].priceUsd ?? 0) <= (c.priceUsd ?? 0))).toBe(true);
    const asc = await q({ sort: 'score', dir: 'asc', filters: { legalAtBracket: true } });
    expect(asc.cards.every((c, i) => i === 0 || asc.cards[i - 1].score.score <= c.score.score)).toBe(true);
  });
});

describe('collection', () => {
  it('replaces the collection, reports unresolved lines and marks owned cards everywhere', async () => {
    const text = 'Name,Quantity\nSol Ring,2\nArcane Signet,1\nNot A Real Card,3\n"Atraxa, Praetors\' Voice",1\n';
    const res = await call<api.CollectionImportResponse>('POST', '/api/collection', { text });
    expect(res.count).toBe(3);
    expect(res.totalQty).toBe(4);
    expect(res.unresolved.map((u) => u.text).join('\n')).toContain('Not A Real Card');
    const got = await call<api.CollectionResponse>('GET', '/api/collection');
    expect(got.count).toBe(3);
    expect(got.cards.map((c) => c.name)).toEqual(['Arcane Signet', "Atraxa, Praetors' Voice", 'Sol Ring']);
    expect(got.cards.find((c) => c.name === 'Sol Ring')?.qty).toBe(2);
    expect(got.cards.every((c) => c.owned)).toBe(true);

    const deck = shell(['Krenko, Mob Boss']);
    const owned = await call<CardsResponse>('POST', '/api/cards', { deck, filters: { owned: true }, pageSize: 200 });
    expect(owned.cards.map((c) => c.name).sort()).toEqual(['Arcane Signet', "Atraxa, Praetors' Voice", 'Sol Ring']);
    expect(owned.cards.every((c) => c.owned)).toBe(true);
    const everything = await call<CardsResponse>('POST', '/api/cards', { deck, q: 'sol ring' });
    expect(everything.cards[0].owned).toBe(true);
    const commanders = await call<api.CommandersResponse>('GET', '/api/commanders?q=atraxa');
    expect(commanders.commanders[0].owned).toBe(true);

    // Owned-only builds draw non-basic cards from the collection alone.
    const built = await call<api.BuildDeckResponse>('POST', '/api/build', { deck, mode: 'auto', options: { ownedOnly: true, seed: 3 } });
    const cdb = getCardDb();
    const ownedIds = new Set(got.cards.map((c) => c.oracleId));
    for (const e of built.deck.main) {
      const card = cdb.get(e.oracleId);
      expect(card && (isBasicLand(card) || ownedIds.has(e.oracleId)), card?.name).toBe(true);
    }

    // A second import replaces, an empty one clears.
    expect((await call<api.CollectionImportResponse>('POST', '/api/collection', { text: '1 Sol Ring' })).count).toBe(1);
    expect((await call<api.CollectionImportResponse>('POST', '/api/collection', { text: '' })).count).toBe(0);
    expect((await call<CardsResponse>('POST', '/api/cards', { deck, filters: { owned: true } })).total).toBe(0);
    expect((await request('POST', '/api/collection', {})).status).toBe(400);
  });
});

describe('POST /api/build', () => {
  it('auto-builds a legal 100-card deck and keeps the name and id', async () => {
    const deck = shell(['Lathril, Blade of the Elves'], { name: 'Elves', id: 'abc' });
    const r = await call<api.BuildDeckResponse>('POST', '/api/build', { deck, mode: 'auto', options: { seed: 7 } });
    expect(size(r.deck)).toBe(100);
    expect(validateDeck(r.deck, getCardDb())).toEqual([]);
    expect(r.deck.name).toBe('Elves');
    expect(r.deck.id).toBe('abc');
    expect(r.deck.commanders).toEqual(deck.commanders);
    expect(r.seed).toBe(7);
    for (const e of r.deck.main) expect(r.cards[e.oracleId]).toBeDefined();
    const again = await call<api.BuildDeckResponse>('POST', '/api/build', { deck, mode: 'auto', options: { seed: 7 } });
    expect(again.deck.main).toEqual(r.deck.main);
    const a = await call<AnalyzeResponse>('POST', '/api/analyze', { deck: r.deck });
    expect(a.rating.legal).toBe(true);
    expect(a.rating.complete).toBe(true);
  });

  it('fills a partial deck, keeping what is there, and respects a price cap', async () => {
    const full = await imported('upgraded', 3);
    const cut: Deck = { ...full, main: full.main.slice(0, 60) };
    const r = await call<api.BuildDeckResponse>('POST', '/api/build', { deck: cut, mode: 'fill', options: { seed: 1 } });
    expect(size(r.deck)).toBe(100);
    const after = new Map(r.deck.main.map((e) => [e.oracleId, e.qty]));
    for (const e of cut.main) expect(after.get(e.oracleId) ?? 0).toBeGreaterThanOrEqual(e.qty);

    const cdb = getCardDb();
    const capped = await call<api.BuildDeckResponse>('POST', '/api/build', { deck: shell(['Krenko, Mob Boss']), mode: 'auto', options: { seed: 1, maxPriceUsd: 2 } });
    for (const e of capped.deck.main) {
      const card = cdb.get(e.oracleId);
      expect(card && (isBasicLand(card) || (card.priceUsd !== null && card.priceUsd <= 2)), card?.name).toBe(true);
    }
  });

  it('proposes swaps and improvements that name cards in and out of the deck', async () => {
    const deck = await imported('precon');
    const inDeck = new Set(deck.main.map((e) => e.oracleId));
    for (const mode of ['swaps', 'improve'] as const) {
      const r = await call<api.BuildProposalsResponse>('POST', '/api/build', { deck, mode, options: { seed: 1, count: 4 } });
      expect(Array.isArray(r.proposals)).toBe(true);
      expect(r.proposals.length).toBeLessThanOrEqual(4);
      for (const p of r.proposals) {
        expect(r.cards[p.out]).toBeDefined();
        expect(r.cards[p.in]).toBeDefined();
        expect(p.ratingAfter).toBeGreaterThanOrEqual(p.ratingBefore);
        expect(typeof p.reason).toBe('string');
      }
      if (r.proposals.length > 0) expect(inDeck.has(r.proposals[0].out)).toBe(true);
    }
  });

  it('answers 400 for a bad mode, bad options or no commander', async () => {
    const deck = shell(['Krenko, Mob Boss']);
    expect((await request('POST', '/api/build', { deck, mode: 'explode' })).status).toBe(400);
    expect((await request('POST', '/api/build', { deck, mode: 'auto', options: { maxPriceUsd: 'cheap' } })).status).toBe(400);
    expect((await request('POST', '/api/build', { deck: { ...deck, commanders: [] }, mode: 'auto' })).status).toBe(400);
  });
});

describe('import, export and saved decks', () => {
  it('imports messy text and reports every line it could not resolve', async () => {
    const text = 'Commander\n1 Lathril, Blade of the Elves\n\nDeck\n1x Sol Ring (C21) 263 *F*\n1 arcane signet\n3 Forest\n1 Definitely Not A Card\nSol Rnig\n\nSideboard\n1 Counterspell\n';
    const r = await call<ImportResponse>('POST', '/api/import', { text, targetBracket: 2 });
    const cdb = getCardDb();
    expect(r.deck.commanders).toEqual([id('Lathril, Blade of the Elves')]);
    expect(r.deck.main.map((e) => [cdb.get(e.oracleId)?.name, e.qty])).toEqual([['Sol Ring', 1], ['Arcane Signet', 1], ['Forest', 3]]);
    expect(r.unresolved).toEqual([{ line: 8, text: '1 Definitely Not A Card' }, { line: 9, text: 'Sol Rnig' }]);
    expect(r.ignored.map((l) => l.text)).toEqual(['1 Counterspell']);
    expect(r.deck.targetBracket).toBe(2);
    expect(r.deck.id).toBeNull();
    expect(r.deck.name).toBe('Lathril, Blade of the Elves');
    expect(r.cards[id('Sol Ring')].name).toBe('Sol Ring');
    expect((await request('POST', '/api/import', {})).status).toBe(400);
    expect((await request('POST', '/api/import', { text: 'x', targetBracket: 7 })).status).toBe(400);
  });

  it('finds the commander of a list without headers through the real eligibility rule', async () => {
    const cdb = getCardDb();
    const precon = await imported('precon');
    const commander = cdb.get(precon.commanders[0])!;
    const lines = precon.main.map((e) => `${e.qty} ${cdb.get(e.oracleId)!.name}`);
    // The commander goes in just ahead of the first other eligible card, somewhere inside the list.
    const firstEligible = precon.main.map((e) => cdb.get(e.oracleId)!).find(isCommanderEligible);
    const at = firstEligible ? lines.indexOf(`1 ${firstEligible.name}`) : lines.length;
    const text = [...lines.slice(0, at), `1 ${commander.name}`, ...lines.slice(at)].join('\n');
    const r = await call<ImportResponse>('POST', '/api/import', { text });
    expect(r.unresolved).toEqual([]);
    expect(r.deck.commanders).toEqual([commander.oracleId]);
    expect(isCommanderEligible(cdb.get(r.deck.commanders[0])!)).toBe(true);
    expect(size(r.deck)).toBe(100);
    // The first card of the list is not eligible, so "first card" alone would have been wrong.
    expect(isCommanderEligible(cdb.byName(lines[0].replace(/^\d+ /, ''))!)).toBe(false);
  });

  it('round-trips import -> save -> load -> export, then updates and deletes', async () => {
    const deck = await imported('cedh', 5);
    expect((await call<api.DecksResponse>('GET', '/api/decks')).decks).toEqual([]);
    const createdRes = await request('POST', '/api/decks', { deck });
    expect(createdRes.status).toBe(201);
    const created = (await createdRes.json()) as DeckResponse;
    expect(created.deck.id).toMatch(/^[0-9a-f-]{36}$/);
    const deckId = created.deck.id as string;
    const loaded = await call<DeckResponse>('GET', `/api/decks/${deckId}`);
    expect(loaded.deck).toEqual({ ...deck, id: deckId });
    expect(loaded.updatedAt).toBe(created.updatedAt);
    expect(Object.keys(loaded.cards).length).toBe(new Set([...deck.commanders, ...deck.main.map((e) => e.oracleId)]).size);

    const { text } = await call<api.ExportResponse>('POST', '/api/export', { deck: loaded.deck });
    const again = await call<ImportResponse>('POST', '/api/import', { text, targetBracket: 5 });
    expect(again.unresolved).toEqual([]);
    expect(again.deck.commanders).toEqual(deck.commanders);
    expect([...again.deck.main].sort((a, b) => a.oracleId.localeCompare(b.oracleId))).toEqual([...deck.main].sort((a, b) => a.oracleId.localeCompare(b.oracleId)));

    const tiles = (await call<api.DecksResponse>('GET', '/api/decks')).decks;
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ id: deckId, name: deck.name, targetBracket: 5, cardCount: 100, legal: true });
    expect(tiles[0].commanders.map((c) => c.oracleId)).toEqual(deck.commanders);
    expect(tiles[0].rating).toBeGreaterThan(0);
    expect([1, 2, 3, 4, 5]).toContain(tiles[0].playsLike);

    const edited: Deck = { ...loaded.deck, name: 'Renamed', main: loaded.deck.main.slice(0, 50).map((e, i) => ({ ...e, locked: i === 0 })) };
    const put = await call<DeckResponse>('PUT', `/api/decks/${deckId}`, { deck: { ...edited, id: 'something-else' } });
    expect(put.deck).toEqual({ ...edited, id: deckId });
    const reloaded = await call<DeckResponse>('GET', `/api/decks/${deckId}`);
    expect(reloaded.deck.name).toBe('Renamed');
    expect(reloaded.deck.main[0].locked).toBe(true);
    expect((await call<api.DecksResponse>('GET', '/api/decks')).decks[0].cardCount).toBe(size(edited));

    // A second save is a second deck (duplicate), with its own id.
    const copy = await call<DeckResponse>('POST', '/api/decks', { deck: reloaded.deck });
    expect(copy.deck.id).not.toBe(deckId);
    expect((await call<api.DecksResponse>('GET', '/api/decks')).decks).toHaveLength(2);

    expect(await call<{ ok: boolean }>('DELETE', `/api/decks/${deckId}`)).toEqual({ ok: true });
    expect((await request('GET', `/api/decks/${deckId}`)).status).toBe(404);
    expect((await request('PUT', `/api/decks/${deckId}`, { deck })).status).toBe(404);
    expect((await request('DELETE', `/api/decks/${deckId}`)).status).toBe(404);
    await call('DELETE', `/api/decks/${copy.deck.id}`);
    expect((await request('POST', '/api/decks', { deck: 5 })).status).toBe(400);
  });
});

describe('commanders and partners', () => {
  it('lists eligible commanders, most popular first, with search, colours and paging', async () => {
    const cdb = getCardDb();
    const all = await call<api.CommandersResponse>('GET', '/api/commanders?pageSize=200');
    expect(all.total).toBe(cdb.all().filter(isCommanderEligible).length);
    expect(all.commanders.every((c) => isCommanderEligible(cdb.get(c.oracleId)!))).toBe(true);
    const ranks = all.commanders.map((c) => cdb.get(c.oracleId)?.edhrecRank ?? Infinity);
    expect(ranks.every((r, i) => i === 0 || ranks[i - 1] <= r)).toBe(true);

    const p1 = await call<api.CommandersResponse>('GET', '/api/commanders?pageSize=5&page=1');
    const p2 = await call<api.CommandersResponse>('GET', '/api/commanders?pageSize=5&page=2');
    expect([...p1.commanders, ...p2.commanders].map((c) => c.oracleId)).toEqual(all.commanders.slice(0, 10).map((c) => c.oracleId));

    const atraxa = await call<api.CommandersResponse>('GET', '/api/commanders?q=atraxa');
    expect(atraxa.commanders[0].name).toBe("Atraxa, Praetors' Voice");
    const wu = await call<api.CommandersResponse>('GET', '/api/commanders?colors=wu&mode=exact&pageSize=200');
    expect(wu.commanders.every((c) => [...c.colorIdentity].sort().join('') === 'UW')).toBe(true);
    const hasGreen = await call<api.CommandersResponse>('GET', '/api/commanders?colors=G&pageSize=200');
    expect(hasGreen.total).toBeGreaterThan(0);
    expect(hasGreen.commanders.every((c) => c.colorIdentity.includes('G'))).toBe(true);
    const thrasios = all.commanders.find((c) => c.name === 'Thrasios, Triton Hero');
    expect(thrasios?.partnerKinds).toEqual(['partner']);
    expect(thrasios?.needsColorChoice).toBe(false);
  });

  it('offers only legal partners', async () => {
    const cdb = getCardDb();
    const thrasios = cdb.get(id('Thrasios, Triton Hero'))!;
    const r = await call<api.PartnersResponse>('GET', `/api/partners?id=${thrasios.oracleId}`);
    expect(r.commander.name).toBe('Thrasios, Triton Hero');
    expect(r.partners.map((p) => p.name)).toContain('Tymna the Weaver');
    expect(r.partners.every((p) => canPair(thrasios, cdb.get(p.oracleId)!))).toBe(true);
    expect(r.partners.length).toBe(cdb.all().filter((c) => canPair(thrasios, c)).length);
    const none = await call<api.PartnersResponse>('GET', `/api/partners?id=${id('Krenko, Mob Boss')}`);
    expect(none.partners).toEqual([]);
    expect((await request('GET', '/api/partners')).status).toBe(400);
    expect((await request('GET', '/api/partners?id=nope')).status).toBe(404);
  });
});

describe('GET /api/img/[size]/[file]', () => {
  const oracle = '7e6b9b59-cd68-4edb-a497-2f5bd2bae8a7';

  it('serves a file from data/images with a one-year immutable cache header', async () => {
    const bytes = Buffer.concat([Buffer.from('RIFF\x10\x00\x00\x00WEBP', 'latin1'), Buffer.from('test-image-bytes')]);
    mkdirSync(path.join(tmp, 'images', 'grid'), { recursive: true });
    writeFileSync(path.join(tmp, 'images', 'grid', `${oracle}_1.webp`), bytes);
    const res = await request('GET', `/api/img/grid/${oracle}_1.webp`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/webp');
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(res.headers.get('content-length')).toBe(String(bytes.length));
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true);
  });

  it('answers a miss with an SVG placeholder that is not cached', async () => {
    for (const url of [`/api/img/grid/${oracle}_0.webp`, `/api/img/display/${oracle}_1.webp`]) {
      const res = await request('GET', url);
      expect(res.status).toBe(404);
      expect(res.headers.get('content-type')).toMatch(/^image\/svg\+xml/);
      expect(res.headers.get('cache-control')).toBe('no-store');
      const svg = await res.text();
      expect(svg.startsWith('<svg')).toBe(true);
      expect(svg).not.toMatch(/atraxa/i);
    }
  });

  it('rejects path traversal and every malformed name with 400', async () => {
    writeFileSync(path.join(tmp, 'images', 'secret.webp'), 'secret');
    const bad = [
      `/api/img/grid/..%2F${oracle}_0.webp`, '/api/img/grid/..%2Fsecret.webp', '/api/img/grid/..%2F..%2Fforge.db',
      '/api/img/grid/secret.webp', `/api/img/grid/${oracle}_2.webp`, `/api/img/grid/${oracle}_0.png`,
      `/api/img/grid/${oracle}.webp`, `/api/img/grid/${oracle.toUpperCase()}_0.webp`, `/api/img/grid/${oracle}_0.webp%00.png`,
      `/api/img/grid/${oracle}_0.webp%0A`, `/api/img/..%2Fgrid/${oracle}_1.webp`, `/api/img/raw/${oracle}_1.webp`,
    ];
    for (const url of bad) {
      const res = await request('GET', url);
      expect(res.status, url).toBe(400);
      expect(await res.text()).not.toContain('secret');
    }
  });
});

describe('settings and EDHREC', () => {
  const page = (numDecks: number, cards: { name: string; num_decks: number; potential_decks: number; lift?: number }[]) => ({
    tag_counts: [{ slug: 'elves', count: 900, value: 'Elves' }, { slug: 'tokens', count: 300, value: 'Tokens' }],
    container: { json_dict: { card: { name: 'x', num_decks: numDecks }, cardlists: [{ header: 'Top Cards', tag: 'topcards', cardviews: cards }] } },
  });
  const jsonRes = (body: unknown, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status: 200, headers });

  it('reads and merges settings, rejecting unknown keys and wrong types', async () => {
    expect(await call<api.Settings>('GET', '/api/settings')).toEqual({ edhrecEnabled: false, mldOverrides: {}, extraTurnOverrides: {} });
    const sol = id('Sol Ring');
    const next = await call<api.Settings>('PUT', '/api/settings', { mldOverrides: { [sol]: true } });
    expect(next).toEqual({ edhrecEnabled: false, mldOverrides: { [sol]: true }, extraTurnOverrides: {} });
    expect(await call<api.Settings>('GET', '/api/settings')).toEqual(next);
    expect((await request('PUT', '/api/settings', { edhrecEnabled: 'yes' })).status).toBe(400);
    expect((await request('PUT', '/api/settings', { nope: 1 })).status).toBe(400);
    expect((await request('PUT', '/api/settings', { mldOverrides: { a: 'x' } })).status).toBe(400);
    await call('PUT', '/api/settings', { mldOverrides: {} });
  });

  it('makes no network call while EDHREC is disabled', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network must not be used');
    });
    vi.stubGlobal('fetch', fetchSpy);
    const deck = shell(['Lathril, Blade of the Elves']);
    expect(await getEdhrec(deck.commanders, 3)).toBeNull();
    expect(await getEdhrec(deck.commanders, 3, { fetchImpl: fetchSpy as unknown as typeof fetch })).toBeNull();
    expect(await call<api.EdhrecResponse>('POST', '/api/edhrec', { commanders: deck.commanders, bracket: 3 })).toEqual({ status: 'off', commanderDecks: 0, cards: 0 });
    expect((await call<AnalyzeResponse>('POST', '/api/analyze', { deck })).edhrec).toBe('off');
    await call<CardsResponse>('POST', '/api/cards', { deck });
    await call<api.BuildDeckResponse>('POST', '/api/build', { deck, mode: 'auto', options: { seed: 1 } });
    await call<api.DecksResponse>('GET', '/api/decks');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('when enabled: serial polite requests, cache, bracket fallback, and analyze never fetches', async () => {
    await call('PUT', '/api/settings', { edhrecEnabled: true });
    try {
      const deck = shell(['Lathril, Blade of the Elves']);
      const globalFetch = vi.fn(() => {
        throw new Error('analyze must not fetch');
      });
      vi.stubGlobal('fetch', globalFetch);
      expect((await call<AnalyzeResponse>('POST', '/api/analyze', { deck })).edhrec).toBe('none');
      expect(globalFetch).not.toHaveBeenCalled();

      const urls: string[] = [];
      const headers: Record<string, string>[] = [];
      const sleeps: number[] = [];
      let clock = 1_000_000;
      const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        urls.push(String(url));
        headers.push(init?.headers as Record<string, string>);
        if (String(url).endsWith('/commanders/lathril-blade-of-the-elves.json')) {
          return jsonRes(page(5000, [
            { name: 'Sol Ring', num_decks: 4500, potential_decks: 5000, lift: 1.01 },
            { name: 'Elvish Mystic', num_decks: 4000, potential_decks: 5000, lift: 1.6 },
            { name: 'A Card Printed Tomorrow', num_decks: 10, potential_decks: 20 },
          ]), { etag: '"abc"' });
        }
        // The bracket page rests on too few decks and must be ignored.
        return jsonRes(page(120, [{ name: 'Sol Ring', num_decks: 100, potential_decks: 120, lift: 1 }]));
      }) as unknown as typeof fetch;
      const deps = { fetchImpl, now: () => clock, sleep: async (ms: number) => { sleeps.push(ms); clock += ms; } };

      const data = await getEdhrec(deck.commanders, 3, deps);
      expect(urls).toEqual([
        'https://json.edhrec.com/pages/commanders/lathril-blade-of-the-elves.json',
        'https://json.edhrec.com/pages/commanders/lathril-blade-of-the-elves/upgraded.json',
      ]);
      expect(headers[0]).toEqual({ 'User-Agent': 'CommanderForge/0.1', Accept: 'application/json' });
      expect(sleeps).toEqual([1500]); // the second request waited out the gap
      expect(data?.commanderDecks).toBe(5000);
      expect(data?.cards[id('Sol Ring')]).toEqual({ numDecks: 4500, potentialDecks: 5000, lift: 1.01 });
      expect(Object.keys(data?.cards ?? {})).toHaveLength(2);
      expect(data?.themes).toEqual({ elves: 900, tokens: 300 });

      // Cached: no further request, the same object, and analyze now uses it.
      expect(await getEdhrec(deck.commanders, 3, deps)).toBe(data);
      expect(urls).toHaveLength(2);
      const a = await call<AnalyzeResponse>('POST', '/api/analyze', { deck });
      expect(a.edhrec).toBe('ready');
      expect(a.deckScores[deck.commanders[0]]).toBeDefined();
      expect(getAnalysis(deck).ctx.edhrec).toBe(data);
      expect(globalFetch).not.toHaveBeenCalled();

      // After 7 days the pages are revalidated with If-None-Match; 304 keeps the cached copy.
      clock += 8 * 24 * 60 * 60 * 1000;
      const { serverState } = await import('@/server/state');
      serverState().caches.delete('edhrec');
      const revalidate = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        headers.push(init?.headers as Record<string, string>);
        return new Response(null, { status: 304 });
      }) as unknown as typeof fetch;
      const fresh = await getEdhrec(deck.commanders, 3, { ...deps, fetchImpl: revalidate });
      expect(fresh?.commanderDecks).toBe(5000);
      expect(headers.at(-2)?.['If-None-Match']).toBe('"abc"');
    } finally {
      await call('PUT', '/api/settings', { edhrecEnabled: false });
    }
  });

  it('treats 403 as no page, follows one redirect and gives up on a schema surprise', async () => {
    await call('PUT', '/api/settings', { edhrecEnabled: true });
    try {
      let clock = 50_000_000;
      const mk = (answer: (url: string) => Response) => ({
        fetchImpl: vi.fn(async (url: string | URL | Request) => answer(String(url))) as unknown as typeof fetch,
        now: () => clock,
        sleep: async (ms: number) => { clock += ms; },
      });

      const missing = mk(() => new Response('<Error>AccessDenied</Error>', { status: 403 }));
      expect(await getEdhrec([id('Krenko, Mob Boss')], 2, missing)).toBeNull();
      expect(missing.fetchImpl).toHaveBeenCalledTimes(1);
      expect(await getEdhrec([id('Krenko, Mob Boss')], 2, missing)).toBeNull();
      expect(missing.fetchImpl).toHaveBeenCalledTimes(1); // "no page" is cached too

      const seen: string[] = [];
      const redirect = mk((url) => {
        seen.push(url);
        if (url.endsWith('/commanders/talrand-sky-summoner.json')) return jsonRes({ redirect: '/commanders/talrand-canonical' });
        if (url.endsWith('/commanders/talrand-canonical.json')) return jsonRes(page(900, [{ name: 'Counterspell', num_decks: 800, potential_decks: 900, lift: 1.2 }]));
        return new Response('', { status: 403 });
      });
      const data = await getEdhrec([id('Talrand, Sky Summoner')], 4, redirect);
      expect(data?.cards[id('Counterspell')]?.numDecks).toBe(800);
      expect(seen.filter((u) => u.includes('talrand-canonical.json'))).toHaveLength(1);

      const odd = mk(() => jsonRes({ container: { json_dict: { card: { num_decks: 'many' }, cardlists: 'none' } } }));
      expect(await getEdhrec([id("Atraxa, Praetors' Voice")], 3, odd)).toBeNull();
      const broken = mk(() => new Response('oops', { status: 500 }));
      expect(await getEdhrec([id('Kinnan, Bonder Prodigy')], 3, broken)).toBeNull();
      const evil = mk(() => jsonRes({ redirect: 'https://example.com/elsewhere' }));
      expect(await getEdhrec([id('Tymna the Weaver')], 3, evil)).toBeNull();
      expect(evil.fetchImpl).toHaveBeenCalledTimes(1);

      // Two commanders: one page for the pair, asked for under both slug orders at most.
      const pairUrls: string[] = [];
      const pair = mk((url) => {
        pairUrls.push(url);
        return new Response('', { status: 403 });
      });
      expect(await getEdhrec([id('Tymna the Weaver'), id('Thrasios, Triton Hero')], 5, pair)).toBeNull();
      expect(pairUrls).toEqual([
        'https://json.edhrec.com/pages/commanders/thrasios-triton-hero-tymna-the-weaver.json',
        'https://json.edhrec.com/pages/commanders/tymna-the-weaver-thrasios-triton-hero.json',
      ]);
    } finally {
      await call('PUT', '/api/settings', { edhrecEnabled: false });
    }
  });

  it('builds EDHREC slugs and validates pages', () => {
    expect(edhrecSlug({ frontName: "Atraxa, Praetors' Voice" })).toBe('atraxa-praetors-voice');
    expect(edhrecSlug({ frontName: 'Lim-Dûl the Necromancer' })).toBe('lim-dul-the-necromancer');
    expect(() => parseEdhrecPage(null)).toThrow();
    expect(() => parseEdhrecPage({ container: {} })).toThrow();
    expect(parseEdhrecPage({ redirect: '/commanders/x' })).toEqual({ redirect: '/commanders/x' });
  });
});

describe('sync', () => {
  it('validates the step, reports progress lines and refuses a second run', async () => {
    expect((await request('POST', '/api/sync', { step: 'everything' })).status).toBe(400);
    expect((await request('POST', '/api/sync', {})).status).toBe(400);
    const { EventEmitter } = await import('node:events');
    const child = Object.assign(new EventEmitter(), { stdout: new EventEmitter(), stderr: new EventEmitter() });
    const started = startSync('features', () => child as never);
    expect(started).toMatchObject({ running: true, step: 'features', exitCode: null, lineCount: 0 });
    expect((await request('POST', '/api/sync', { step: 'cards' })).status).toBe(409);
    child.stdout.emit('data', Buffer.from('features 10 cards stored\npartial'));
    child.stdout.emit('data', Buffer.from(' line\n'));
    child.stderr.emit('data', 'a warning\n');
    const mid = await call<api.SyncState>('GET', '/api/sync');
    expect(mid.lines).toEqual(['features 10 cards stored', 'partial line', 'a warning']);
    expect(mid.lineCount).toBe(3);
    expect((await call<api.SyncState>('GET', '/api/sync?since=2')).lines).toEqual(['a warning']);
    const before = getCardDb();
    child.emit('close', 0);
    const done = syncState();
    expect(done).toMatchObject({ running: false, exitCode: 0, step: 'features' });
    expect(done.finishedAt).not.toBeNull();
    // Card data may have changed: the in-memory database is rebuilt on next use.
    expect(getCardDb()).not.toBe(before);
    const failing = startSync('all', () => {
      throw new Error('spawn ENOENT');
    });
    expect(failing).toMatchObject({ running: false, exitCode: 1 });
    expect(failing.lines[0]).toContain('ENOENT');
  });
});

describe('typed client (src/app/lib/api.ts)', () => {
  it('reaches every endpoint with the method and body the routes expect', async () => {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => request(init?.method ?? 'GET', url, init?.body as string | undefined));
    const status = await api.getStatus();
    expect(status.ready).toBe(true);
    expect((await api.getSync()).running).toBe(false);
    await expect(api.startSync('nope' as never)).rejects.toMatchObject({ name: 'ApiError', status: 400 });

    const commanders = await api.getCommanders({ q: 'thrasios', colors: ['G', 'U'], mode: 'exact', pageSize: 5 });
    expect(commanders.commanders[0].name).toBe('Thrasios, Triton Hero');
    const partners = await api.getPartners(commanders.commanders[0].oracleId);
    expect(partners.partners.length).toBeGreaterThan(0);

    const parsed = await api.importDeck({ text: deckText('precon'), targetBracket: 2, name: 'Precon' });
    expect(parsed.deck.name).toBe('Precon');
    const analysis = await api.analyzeDeck(parsed.deck);
    expect(analysis.summary.cardCount).toBe(100);
    const browse = await api.browseCards({ deck: parsed.deck, filters: { role: 'draw' }, pageSize: 10 });
    expect(browse.cards).toHaveLength(10);
    const built = await api.buildDeck({ ...parsed.deck, main: [] }, 'auto', { seed: 2 });
    expect(size(built.deck)).toBe(100);
    const swaps = await api.buildDeck(parsed.deck, 'swaps', { seed: 2, count: 2 });
    expect(swaps.proposals.length).toBeLessThanOrEqual(2);
    expect((await api.exportDeck(parsed.deck)).text).toContain('Sol Ring');

    const saved = await api.createDeck(parsed.deck);
    const savedId = saved.deck.id as string;
    expect((await api.getDeck(savedId)).deck.name).toBe('Precon');
    expect((await api.updateDeck(savedId, { ...saved.deck, name: 'Precon 2' })).deck.name).toBe('Precon 2');
    expect((await api.listDecks()).decks.map((d) => d.name)).toEqual(['Precon 2']);
    expect(await api.deleteDeck(savedId)).toEqual({ ok: true });
    await expect(api.getDeck(savedId)).rejects.toMatchObject({ status: 404, message: 'No such deck.' });

    expect((await api.replaceCollection('2 Sol Ring')).totalQty).toBe(2);
    expect((await api.getCollection()).cards[0].name).toBe('Sol Ring');
    await api.replaceCollection('');
    expect((await api.updateSettings({ extraTurnOverrides: {} })).edhrecEnabled).toBe(false);
    expect((await api.getSettings()).edhrecEnabled).toBe(false);
    expect((await api.loadEdhrec(parsed.deck.commanders, 2)).status).toBe('off');

    const url = api.imageUrl(parsed.deck.commanders[0], 'display', 0);
    expect(url).toBe(`/api/img/display/${parsed.deck.commanders[0]}_0.webp`);
    expect((await request('GET', url)).status).toBe(404); // well-formed, just not on disk
  });
});
