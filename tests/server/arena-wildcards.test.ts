import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  AnalyzeResponse, BuildDeckResponse, BuildProposalsResponse, DiscoverState, ExportResponse, StatusResponse, WildcardsInfo, WildcardsReadResponse,
} from '@/app/lib/api';
import * as analyzeRoute from '@/app/api/analyze/route';
import * as wildcardsRoute from '@/app/api/arena/wildcards/route';
import * as buildRoute from '@/app/api/build/route';
import * as exportRoute from '@/app/api/export/route';
import * as statusRoute from '@/app/api/status/route';
import { isBasicLand } from '@/engine/rules';
import type { Card, Deck } from '@/engine/types';
import { arenaStatus, syncArenaCollection } from '@/server/arena';
import { ownedSet, replaceCollection, setActiveCollection } from '@/server/collection';
import type { Db } from '@/server/db';
import { discoverState, discoverTiers, startDiscover } from '@/server/discover';
import { getCardDb } from '@/server/store';
import { setWildcards } from '@/server/wildcards';
import { seedDb, useServerDb } from './server-db';

type Handler = (req: Request) => Promise<Response> | Response;
const send = async (handler: unknown, method: string, url: string, body?: unknown): Promise<Response> => {
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
    init.headers = { 'Content-Type': 'application/json' };
  }
  return (handler as Handler)(new Request(new URL(url, 'http://localhost:3213'), init));
};
const ok = async <T>(res: Promise<Response>): Promise<T> => {
  const r = await res;
  expect(r.status, await r.clone().text()).toBeLessThan(300);
  return (await r.json()) as T;
};

let db: Db;
let tmp: string;
const logDir = () => path.join(tmp, 'logs');
const envBefore = { log: process.env.COMMANDER_FORGE_ARENA_LOG_DIR, raw: process.env.COMMANDER_FORGE_ARENA_RAW_DIR };
const INVENTORY = '{ "InventoryInfo": { "SeqId": 36, "Gems": 100, "WildCardCommons": 12, "WildCardUnCommons": 12, "WildCardRares": 1, "CustomTokens": {} } }';

const brawl = () => getCardDb('brawl');
const LATHRIL = 'Lathril, Blade of the Elves';
const bg = (): Card[] => brawl().all().filter((c) => c.colorIdentity.every((k) => k === 'B' || k === 'G'));
const shell = (): Deck => ({
  id: null, name: 'Elves', commanders: [brawl().byName(LATHRIL)!.oracleId], companion: null, chosenColor: null, main: [], targetBracket: 3, themeWeights: null,
  collectionId: 'arena',
});
const ids = (deck: Deck) => [...deck.commanders, ...deck.main.map((e) => e.oracleId)];

beforeAll(() => {
  tmp = mkdtempSync(path.join(tmpdir(), 'cf-wildcards-'));
  process.env.COMMANDER_FORGE_ARENA_LOG_DIR = logDir();
  process.env.COMMANDER_FORGE_ARENA_RAW_DIR = path.join(tmp, 'raw');
  db = seedDb(path.join(tmp, 'forge.db'));
  useServerDb(db);
});
afterAll(() => {
  useServerDb(null);
  db.close();
  rmSync(tmp, { recursive: true, force: true });
  for (const [k, v] of [['COMMANDER_FORGE_ARENA_LOG_DIR', envBefore.log], ['COMMANDER_FORGE_ARENA_RAW_DIR', envBefore.raw]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});
beforeEach(() => {
  db.exec("DELETE FROM settings WHERE key LIKE 'wildcards:%'");
  rmSync(logDir(), { recursive: true, force: true });
  setActiveCollection('physical');
});

describe('wildcards of the MTG Arena collection', () => {
  it('are all 0 until read or typed in, and keep what is typed in', async () => {
    expect(await ok<WildcardsInfo>(send(wildcardsRoute.GET, 'GET', '/api/arena/wildcards'))).toEqual({
      wildcards: { common: 0, uncommon: 0, rare: 0, mythic: 0 }, readAt: null, source: null,
    });
    const put = await ok<WildcardsInfo>(send(wildcardsRoute.PUT, 'PUT', '/api/arena/wildcards', { common: 12, uncommon: 12, rare: 1, mythic: 0 }));
    expect(put).toMatchObject({ wildcards: { common: 12, uncommon: 12, rare: 1, mythic: 0 }, source: 'hand' });
    expect(put.readAt).toMatch(/^\d{4}-/);
    expect(await ok<WildcardsInfo>(send(wildcardsRoute.GET, 'GET', '/api/arena/wildcards'))).toEqual(put);
  });

  it('refuses counts that are not whole numbers from 0 to 9999', async () => {
    for (const body of [{ common: -1, uncommon: 0, rare: 0, mythic: 0 }, { common: 1.5, uncommon: 0, rare: 0, mythic: 0 }, { common: 1, uncommon: 0, rare: 0 }, { common: '3', uncommon: 0, rare: 0, mythic: 0 }, []]) {
      expect((await send(wildcardsRoute.PUT, 'PUT', '/api/arena/wildcards', body)).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('reads them from Player.log ("Read from Arena"), a missing rarity as 0, and keeps them when the log has none', async () => {
    mkdirSync(logDir(), { recursive: true });
    writeFileSync(path.join(logDir(), 'Player.log'), `DETAILED LOGS: ENABLED\n${INVENTORY}\n`);
    const read = await ok<WildcardsReadResponse>(send(wildcardsRoute.POST, 'POST', '/api/arena/wildcards'));
    expect(read).toMatchObject({ ok: true, source: 'log', wildcards: { common: 12, uncommon: 12, rare: 1, mythic: 0 } });
    writeFileSync(path.join(logDir(), 'Player.log'), 'DETAILED LOGS: ENABLED\nnothing\n');
    const none = await ok<WildcardsReadResponse>(send(wildcardsRoute.POST, 'POST', '/api/arena/wildcards'));
    expect(none.ok).toBe(false);
    expect(none.message).toMatch(/wildcards/i);
    expect(none.wildcards).toEqual({ common: 12, uncommon: 12, rare: 1, mythic: 0 });
  });

  it('keep what was typed in unless the inventory line itself is newer, however recently the log was written', async () => {
    mkdirSync(logDir(), { recursive: true });
    const log = path.join(logDir(), 'Player.log');
    const inventory = INVENTORY.replace('"WildCardRares": 1', '"WildCardRares": 7');
    // A live Player.log: the file was just written (mtime now), but its inventory line is from 9:22 PM.
    const write = (header: string | null) =>
      writeFileSync(log, ['DETAILED LOGS: ENABLED', ...(header ? [`[UnityCrossThreadLogger]${header}`, '<== StartHook(abc)'] : []), inventory, '[UnityCrossThreadLogger]11/25/2026 11:59:59 PM', 'later lines'].join('\n'));
    const typed = { common: 1, uncommon: 2, rare: 3, mythic: 4 };
    setWildcards(typed, 'hand', new Date(2026, 10, 25, 22, 0, 0).toISOString());
    write('11/25/2026 9:22:02 PM');
    expect((await syncArenaCollection()).wildcards).toMatchObject({ source: 'hand', wildcards: typed });
    // An inventory line with no time it can read never replaces typed counts on a sync.
    write(null);
    expect((await syncArenaCollection()).wildcards).toMatchObject({ source: 'hand', wildcards: typed });
    // "Read from Arena" always reads.
    expect((await ok<WildcardsReadResponse>(send(wildcardsRoute.POST, 'POST', '/api/arena/wildcards'))).wildcards.rare).toBe(7);
    // An inventory line dated after the counts were typed wins.
    setWildcards(typed, 'hand', new Date(2026, 10, 25, 22, 0, 0).toISOString());
    write('11/25/2026 10:30:00 PM');
    expect((await syncArenaCollection()).wildcards).toMatchObject({ source: 'log', wildcards: { rare: 7 } });
  });

  it('are read by every Arena sync, even one that finds no cards, and shown in the Arena status', async () => {
    mkdirSync(logDir(), { recursive: true });
    writeFileSync(path.join(logDir(), 'Player.log'), `DETAILED LOGS: ENABLED\n${INVENTORY.replace('"WildCardRares": 1', '"WildCardRares": 4')}\n`);
    const status = await syncArenaCollection();
    expect(status.last?.ok).toBe(false); // no decks in that log
    expect(status.wildcards.wildcards).toEqual({ common: 12, uncommon: 12, rare: 4, mythic: 0 });
    expect(arenaStatus().wildcards.source).toBe('log');
  });
});

describe('Arena decks on the server', () => {
  // The MTG Arena collection: the commander and every common and uncommon of its colours, no rare or mythic.
  const useArena = () => {
    setActiveCollection('arena');
    const cards = [brawl().byName(LATHRIL)!, ...bg().filter((c) => c.arenaRarity === 'common' || c.arenaRarity === 'uncommon')];
    replaceCollection(cards.map((c) => `1 ${c.name}`).join('\n'));
  };
  const unownedMythics = (deck: Deck) => {
    const owned = ownedSet();
    return ids(deck).filter((id) => {
      const c = brawl().get(id)!;
      return c.arenaRarity === 'mythic' && !owned.has(id) && !isBasicLand(c);
    });
  };

  it('builds only what the wildcards can craft by default, and the whole Arena pool when asked', async () => {
    useArena();
    setWildcards({ common: 99, uncommon: 99, rare: 99, mythic: 0 }, 'hand');
    const capped = await ok<BuildDeckResponse>(send(buildRoute.POST, 'POST', '/api/build', { deck: shell(), mode: 'auto', options: { seed: 3 } }));
    expect(ids(capped.deck).every((id) => (brawl().get(id)?.arenaRarity ?? null) !== null)).toBe(true);
    expect(unownedMythics(capped.deck)).toEqual([]);
    expect(Object.values(capped.cards).every((c) => c.arenaRarity !== null)).toBe(true);
    const open = await ok<BuildDeckResponse>(send(buildRoute.POST, 'POST', '/api/build', { deck: shell(), mode: 'auto', options: { seed: 3, craftableOnly: false } }));
    expect(unownedMythics(open.deck).length).toBeGreaterThan(0);
    const swaps = await ok<BuildProposalsResponse>(send(buildRoute.POST, 'POST', '/api/build', { deck: capped.deck, mode: 'improve', options: { seed: 3 } }));
    expect(swaps.proposals.filter((p) => unownedMythics({ ...shell(), commanders: [], main: [{ oracleId: p.in, qty: 1, locked: false }] }).length > 0)).toEqual([]);
  }, 60_000);

  it('counts what the Arena collection owns for an Arena deck, whichever collection is active', async () => {
    useArena();
    setWildcards({ common: 99, uncommon: 99, rare: 99, mythic: 0 }, 'hand');
    const arenaOwned = new Set(ownedSet());
    // Physical holds every mythic of the deck's colours; the Arena collection holds none.
    setActiveCollection('physical');
    const mythics = bg().filter((c) => c.arenaRarity === 'mythic');
    replaceCollection(mythics.map((c) => `1 ${c.name}`).join('\n'));
    const physicalOnly = (deck: Deck) => ids(deck).filter((id) => mythics.some((m) => m.oracleId === id) && !arenaOwned.has(id));
    const built = await ok<BuildDeckResponse>(send(buildRoute.POST, 'POST', '/api/build', { deck: shell(), mode: 'auto', options: { seed: 3 } }));
    expect(physicalOnly(built.deck)).toEqual([]);
    const owned = await ok<BuildDeckResponse>(send(buildRoute.POST, 'POST', '/api/build', { deck: shell(), mode: 'auto', options: { seed: 3, ownedOnly: true } }));
    expect(physicalOnly(owned.deck)).toEqual([]);
    const withMythic: Deck = { ...shell(), main: [{ oracleId: mythics[0].oracleId, qty: 1, locked: false }] };
    const r = await ok<AnalyzeResponse>(send(analyzeRoute.POST, 'POST', '/api/analyze', { deck: withMythic }));
    expect(r.arena!.needed.mythic).toBe(1);
    const out = await ok<ExportResponse>(send(exportRoute.POST, 'POST', '/api/export', { deck: withMythic, format: 'arena' }));
    expect(out.text).toContain(`(${mythics[0].arenaPrinting!.set}) ${mythics[0].arenaPrinting!.number}`);
    replaceCollection('');
  }, 60_000);

  it('says how many wildcards an Arena deck needs, against the ones there are, with the printing to craft', async () => {
    useArena();
    setWildcards({ common: 12, uncommon: 12, rare: 1, mythic: 0 }, 'log');
    const rares = bg().filter((c) => c.arenaRarity === 'rare' && !isBasicLand(c)).slice(0, 2);
    const mythic = bg().find((c) => c.arenaRarity === 'mythic')!;
    const deck: Deck = { ...shell(), main: [...rares, mythic].map((c) => ({ oracleId: c.oracleId, qty: 1, locked: false })) };
    const r = await ok<AnalyzeResponse>(send(analyzeRoute.POST, 'POST', '/api/analyze', { deck }));
    expect(r.format).toBe('brawl');
    expect(r.arena).toMatchObject({ needed: { common: 0, uncommon: 0, rare: 2, mythic: 1 }, have: { common: 12, uncommon: 12, rare: 1, mythic: 0 }, over: ['rare', 'mythic'], noData: false });
    expect(r.arena!.toCraft.map((l) => l.oracleId)).toEqual([...rares, mythic].map((c) => c.oracleId));
    expect(r.arena!.toCraft[2]).toMatchObject({ rarity: 'mythic', set: mythic.arenaPrinting!.set, number: mythic.arenaPrinting!.number });
    const paper = await ok<AnalyzeResponse>(send(analyzeRoute.POST, 'POST', '/api/analyze', { deck: { ...deck, collectionId: 'physical' } }));
    expect(paper.arena).toBeNull();
  });

  it('copies an Arena deck for Arena with the printing to craft for every card not owned', async () => {
    useArena();
    const rare = bg().find((c) => c.arenaRarity === 'rare' && !isBasicLand(c))!;
    const common = bg().find((c) => c.arenaRarity === 'common' && !isBasicLand(c))!;
    const deck: Deck = { ...shell(), main: [{ oracleId: rare.oracleId, qty: 1, locked: false }, { oracleId: common.oracleId, qty: 1, locked: false }] };
    const out = await ok<ExportResponse>(send(exportRoute.POST, 'POST', '/api/export', { deck, format: 'arena' }));
    expect(out.text).toContain(`1 ${rare.frontName} (${rare.arenaPrinting!.set}) ${rare.arenaPrinting!.number}\n`);
    expect(out.text).toContain(`1 ${common.layout === 'split' ? common.name : common.frontName}\n`);
    const paper = await ok<ExportResponse>(send(exportRoute.POST, 'POST', '/api/export', { deck: { ...deck, collectionId: 'physical' }, format: 'arena' }));
    expect(paper.text).not.toContain(`(${rare.arenaPrinting!.set})`);
  });

  it('counts the Brawl pool in the status', async () => {
    const s = await ok<StatusResponse>(send(statusRoute.GET, 'GET', '/api/status'));
    expect(s.counts.brawl).toBe(brawl().all().length);
    expect(s.counts.brawl).toBeGreaterThan(500);
  });

  it('runs Best from collection on the Arena collection with Brawl commanders and wildcard tiers', async () => {
    useArena();
    replaceCollection([LATHRIL, 'Tyvar Kell', ...bg().filter((c) => c.arenaRarity === 'common').map((c) => c.name)].map((n) => `1 ${n}`).join('\n'));
    setWildcards({ common: 5, uncommon: 4, rare: 2, mythic: 0 }, 'hand');
    startDiscover(3, 'owned');
    let s: DiscoverState;
    for (;;) {
      s = discoverState(3, 'owned');
      if (s.status !== 'running') break;
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(s.status).toBe('done');
    expect(s.entries.map((e) => e.commander.name).sort()).toEqual([LATHRIL, 'Tyvar Kell'].sort());
    for (const e of s.entries) {
      expect(e.tiers.map((t) => t.kind)).toEqual(['owned', 'crafted', 'unlimited']);
      const crafted = e.tiers[1];
      for (const r of ['common', 'uncommon', 'rare', 'mythic'] as const) expect(crafted.wildcards![r]).toBeLessThanOrEqual({ common: 5, uncommon: 4, rare: 2, mythic: 0 }[r]);
      for (const t of e.tiers) expect(ids(t.deck).every((id) => (brawl().get(id)?.arenaRarity ?? null) !== null)).toBe(true);
    }
    expect(discoverTiers(3, s.entries[0].commander.oracleId, 'owned').tiers).toEqual([]);
  }, 240_000);
});
