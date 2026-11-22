import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { arenaCandidates, arenaStatus, importArenaCards, readArenaMemory, syncArenaCollection } from '@/server/arena';
import { listCollections, ownedQuantities, replaceCollection, setActiveCollection } from '@/server/collection';
import { getCardDb } from '@/server/store';
import { seedDb, useServerDb } from './server-db';

const FIXTURE_LOG = fileURLToPath(new URL('../fixtures/arena/Player.log', import.meta.url));
const tmp = mkdtempSync(path.join(tmpdir(), 'cf-arena-'));
const logDir = path.join(tmp, 'logs');
const rawDir = path.join(tmp, 'install', 'MTGA_Data', 'Downloads', 'Raw');

/** An excerpt of Arena's Raw_CardDatabase: same tables and columns, the rows the fixture log names. */
function writeCardDatabase(): void {
  mkdirSync(rawDir, { recursive: true });
  const db = new Database(path.join(rawDir, 'Raw_CardDatabase_0123456789abcdef.mtga'));
  db.exec(`
    CREATE TABLE Cards(GrpId INT UNIQUE PRIMARY KEY NOT NULL, TitleId INT NOT NULL, ExpansionCode TEXT, CollectorNumber TEXT NOT NULL,
      IsToken BOOLEAN NOT NULL, IsPrimaryCard BOOLEAN NOT NULL, IsDigitalOnly BOOLEAN NOT NULL, IsRebalanced BOOLEAN NOT NULL);
    CREATE TABLE Localizations_enUS(LocId INT NOT NULL, Formatted INT NOT NULL, Loc TEXT, PRIMARY KEY (LocId, Formatted));
  `);
  const cards: [number, string, string, string, number, number][] = [
    [60235, 'Sol Ring', 'VMA', '283', 0, 0],
    [98688, 'Sol Ring', 'TLE', '316', 0, 0],
    [70464, 'Arcane Signet', 'ELD', '331', 0, 0],
    [70466, 'Command Tower', 'ELD', '333', 0, 0],
    [79417, 'Command Tower', 'ANB', '118', 0, 0],
    [72401, 'Krenko, Mob Boss', 'JMP', '339', 0, 0],
    [93917, 'Krenko, Mob Boss', 'FDN', '204', 0, 0],
    [77521, 'Lightning Bolt', 'STA', '42', 0, 0],
    [77584, 'Lightning Bolt', 'STA', '105', 0, 0],
    [68766, 'Blinding Radiance', 'ANA', '0', 1, 0], // digital-only, not a Commander-pool card
    [80858, 'A-Counterspell', 'ZNR', '232', 1, 1], // a rebalanced (Alchemy) version counts as the card itself
  ];
  const insCard = db.prepare('INSERT INTO Cards VALUES (?, ?, ?, ?, 0, 1, ?, ?)');
  const insLoc = db.prepare('INSERT OR IGNORE INTO Localizations_enUS VALUES (?, ?, ?)');
  const titles = new Map<string, number>();
  for (const [grpId, name, set, number, digital, rebalanced] of cards) {
    if (!titles.has(name)) titles.set(name, titles.size + 1);
    const titleId = titles.get(name)!;
    insCard.run(grpId, titleId, set, number, digital, rebalanced);
    // As in the real file: the display form (1) can carry markup, the plain form (0) is not always there.
    insLoc.run(titleId, 1, name === 'Krenko, Mob Boss' ? '<nobr>Krenko,</nobr> Mob Boss' : name);
  }
  db.close();
}

const names = () => {
  const db = getCardDb();
  return [...ownedQuantities()].map(([id, qty]) => `${qty} ${db.get(id)?.name}`).sort();
};
const useLog = (text: string | null) => {
  rmSync(logDir, { recursive: true, force: true });
  if (text === null) return;
  mkdirSync(logDir, { recursive: true });
  writeFileSync(path.join(logDir, 'Player.log'), text);
};

beforeEach(() => {
  rmSync(tmp, { recursive: true, force: true });
  writeCardDatabase();
  mkdirSync(logDir, { recursive: true });
  copyFileSync(FIXTURE_LOG, path.join(logDir, 'Player.log'));
  process.env.COMMANDER_FORGE_ARENA_LOG_DIR = logDir;
  process.env.COMMANDER_FORGE_ARENA_RAW_DIR = rawDir;
  useServerDb(seedDb());
});
afterAll(() => {
  delete process.env.COMMANDER_FORGE_ARENA_LOG_DIR;
  delete process.env.COMMANDER_FORGE_ARENA_RAW_DIR;
  useServerDb(null);
  rmSync(tmp, { recursive: true, force: true });
});

describe('Arena sync', () => {
  it('fills the MTG Arena collection from the local log and card database, and leaves Physical alone', async () => {
    replaceCollection('3 Swords to Plowshares');
    const status = await syncArenaCollection();
    expect(status.installed).toBe(true);
    expect(status.detailedLogs).toBe(true);
    expect(status.last).toMatchObject({ ok: true, problem: null, cards: 6, totalQty: 12, unmapped: 1, sources: '3 decks, 2 draft or sealed pools' });
    expect(status.syncedAt).toBe(status.last!.at);
    expect(names()).toEqual(['3 Swords to Plowshares']);

    setActiveCollection('arena');
    // Printings of one card add up to the most copies seen of any one; "A-" versions count as the card.
    expect(names()).toEqual(['1 Arcane Signet', '1 Krenko, Mob Boss', '1 Sol Ring', '2 Command Tower', '2 Counterspell', '5 Lightning Bolt']);
    expect(listCollections().find((c) => c.id === 'arena')).toMatchObject({ count: 6, totalQty: 12, syncedAt: status.syncedAt });
  });

  it('adds to what earlier syncs found, because Arena starts a new log every time it starts', async () => {
    await syncArenaCollection();
    useLog('DETAILED LOGS: ENABLED\n<== StartHook(x)\n{"Decks":{"d":{"MainDeck":[{"cardId":70464,"quantity":3}]}}}\n');
    const status = await syncArenaCollection();
    expect(status.last).toMatchObject({ ok: true, cards: 6, totalQty: 14 });
    setActiveCollection('arena');
    expect(names()).toContain('3 Arcane Signet');
    expect(names()).toContain('5 Lightning Bolt');
  });

  it('also reads Player-prev.log, the log of the session before', async () => {
    useLog('DETAILED LOGS: ENABLED\n');
    copyFileSync(FIXTURE_LOG, path.join(logDir, 'Player-prev.log'));
    expect((await syncArenaCollection()).last).toMatchObject({ ok: true, cards: 6 });
  });

  it('says so, and changes nothing, when Arena is not installed', async () => {
    process.env.COMMANDER_FORGE_ARENA_LOG_DIR = path.join(tmp, 'missing-logs');
    process.env.COMMANDER_FORGE_ARENA_RAW_DIR = path.join(tmp, 'missing-raw');
    const status = await syncArenaCollection();
    expect(status.installed).toBe(false);
    expect(status.last).toMatchObject({ ok: false, problem: 'not-installed', cards: 0 });
    expect(status.last!.message).toMatch(/not installed/i);
    expect(status.syncedAt).toBeNull();
    expect(arenaStatus().installed).toBe(false);
  });

  it('explains how to switch detailed logs on when the log has them off', async () => {
    useLog('DETAILED LOGS: DISABLED\nnothing else\n');
    const status = await syncArenaCollection();
    expect(status.installed).toBe(true);
    expect(status.detailedLogs).toBe(false);
    expect(status.last).toMatchObject({ ok: false, problem: 'detailed-logs-off' });
    expect(status.last!.message).toMatch(/Detailed Logs/);
    expect(listCollections().find((c) => c.id === 'arena')).toMatchObject({ count: 0, syncedAt: null });
  });

  it('reports a log with detailed logging on but no deck or pool in it yet', async () => {
    useLog('DETAILED LOGS: ENABLED\n[UnityCrossThreadLogger]Client.SceneChange {"fromSceneName":"Store"}\n');
    expect((await syncArenaCollection()).last).toMatchObject({ ok: false, problem: 'no-card-data' });
  });

  it('reports a missing card database and a missing log separately', async () => {
    rmSync(rawDir, { recursive: true, force: true });
    expect((await syncArenaCollection()).last).toMatchObject({ ok: false, problem: 'no-card-database' });
    writeCardDatabase();
    useLog(null);
    expect((await syncArenaCollection()).last).toMatchObject({ ok: false, problem: 'no-log' });
  });

  it('does not fail on a card database it cannot read', async () => {
    writeFileSync(path.join(rawDir, 'Raw_CardDatabase_0123456789abcdef.mtga'), 'this is not sqlite');
    const status = await syncArenaCollection();
    expect(status.last).toMatchObject({ ok: false, problem: 'unreadable' });
    expect(listCollections().find((c) => c.id === 'arena')?.count).toBe(0);
  });

  it('skips an automatic sync when the log has not changed since the last one', async () => {
    const first = await syncArenaCollection({ auto: true });
    expect(first.last?.ok).toBe(true);
    const again = await syncArenaCollection({ auto: true });
    expect(again.last!.at).toBe(first.last!.at);
    const later = new Date(Date.now() + 60_000);
    utimesSync(path.join(logDir, 'Player.log'), later, later);
    const third = await syncArenaCollection({ auto: true });
    expect(third.last?.ok).toBe(true);
    expect(third.last).not.toBe(first.last);
  });
});

describe('importing a full Arena card list', () => {
  it('replaces the MTG Arena collection with a list of Arena card ids and counts', async () => {
    await syncArenaCollection();
    const status = importArenaCards([{ grpId: 60235, qty: 1 }, { grpId: 98688, qty: 3 }, { grpId: 77521, qty: 4 }, { grpId: 68766, qty: 2 }, { grpId: 70464, qty: 0 }]);
    expect(status.last).toMatchObject({ ok: true, cards: 2, totalQty: 8, unmapped: 1, sources: 'a full card list' });
    setActiveCollection('arena');
    // The same card in two printings adds up here: these are real copies, not deck slots.
    expect(names()).toEqual(['4 Lightning Bolt', '4 Sol Ring']);
  });

  it('refuses a list that is not card ids with counts, and says when the card database is missing', () => {
    expect(() => importArenaCards([{ grpId: 'x', qty: 1 }] as never)).toThrow(/grpId/);
    expect(() => importArenaCards('nope' as never)).toThrow(/list/);
    rmSync(rawDir, { recursive: true, force: true });
    expect(importArenaCards([{ grpId: 60235, qty: 1 }]).last).toMatchObject({ ok: false, problem: 'no-card-database' });
  });
});

describe('reading the full collection from the running game', () => {
  const readerDir = path.join(tmp, 'reader');
  /** A stand-in for the optional mtga-reader package, and for a copy of Node that may read the game. */
  const installReader = (body: string, withBinary = true) => {
    rmSync(readerDir, { recursive: true, force: true });
    mkdirSync(path.join(readerDir, 'node_modules', 'mtga-reader'), { recursive: true });
    writeFileSync(path.join(readerDir, 'node_modules', 'mtga-reader', 'index.js'), `exports.readCollection = async () => (${body});`);
    if (withBinary) symlinkSync(process.execPath, path.join(readerDir, 'node-arena'));
    process.env.COMMANDER_FORGE_ARENA_READER = readerDir;
  };
  afterAll(() => { delete process.env.COMMANDER_FORGE_ARENA_READER; });

  it('imports what the reader finds, as the whole collection', async () => {
    installReader('{ count: 3, cards: [{ grpId: 60235, qty: 2 }, { grpId: 77521, qty: 4 }, { grpId: 70464, qty: 0 }] }');
    const status = await readArenaMemory();
    expect(status.last).toMatchObject({ ok: true, cards: 2, totalQty: 6, sources: 'a full card list' });
    setActiveCollection('arena');
    expect(names()).toEqual(['2 Sol Ring', '4 Lightning Bolt']);
  });

  it('passes on the reader\'s own error and changes nothing', async () => {
    await syncArenaCollection();
    installReader("{ error: 'MTGA is in a match' }");
    const status = await readArenaMemory();
    expect(status.last).toMatchObject({ ok: false, problem: 'unreadable' });
    expect(status.last!.message).toMatch(/MTGA is in a match/);
    expect(listCollections().find((c) => c.id === 'arena')?.count).toBe(6);
  });

  it('says how to add the reader when it is not installed', async () => {
    process.env.COMMANDER_FORGE_ARENA_READER = path.join(tmp, 'no-reader-here');
    const status = await readArenaMemory();
    expect(status.last).toMatchObject({ ok: false, problem: 'no-reader' });
    expect(status.last!.message).toMatch(/mtga-reader/);
    expect(status.reader).toBe(false);
  });

  it('reports whether the reader is there', () => {
    installReader('{ count: 0, cards: [] }', false);
    expect(arenaStatus()).toMatchObject({ reader: true, readerNeedsPassword: process.platform === 'darwin' });
    symlinkSync(process.execPath, path.join(readerDir, 'node-arena'));
    expect(arenaStatus()).toMatchObject({ reader: true, readerNeedsPassword: false });
  });
});

describe('finding Arena', () => {
  it('knows the macOS log folder and the Steam, standalone and Epic installs', () => {
    const c = arenaCandidates('darwin', '/Users/me', {});
    expect(c.logDirs).toEqual(['/Users/me/Library/Logs/Wizards Of The Coast/MTGA']);
    expect(c.rawDirs).toContain('/Users/me/Library/Application Support/Steam/steamapps/common/MTGA/MTGA_Data/Downloads/Raw');
    expect(c.rawDirs).toContain('/Users/me/Library/Application Support/com.wizards.mtga/Downloads/Raw');
    expect(c.rawDirs).toContain('/Users/Shared/Epic Games/MagicTheGathering/MTGA.app/Contents/Resources/Data/Downloads/Raw');
  });

  it('knows the Windows log folder and installs, on whichever drive Program Files is', () => {
    const c = arenaCandidates('win32', 'C:\\Users\\me', { ProgramFiles: 'D:\\Program Files', 'ProgramFiles(x86)': 'D:\\Program Files (x86)' });
    expect(c.logDirs).toEqual(['C:\\Users\\me\\AppData\\LocalLow\\Wizards Of The Coast\\MTGA']);
    expect(c.rawDirs).toContain('D:\\Program Files\\Wizards of the Coast\\MTGA\\MTGA_Data\\Downloads\\Raw');
    expect(c.rawDirs).toContain('D:\\Program Files (x86)\\Steam\\steamapps\\common\\MTGA\\MTGA_Data\\Downloads\\Raw');
    expect(c.rawDirs).toContain('D:\\Program Files\\Epic Games\\MagicTheGathering\\MTGA_Data\\Downloads\\Raw');
  });

  it('looks nowhere on other systems', () => {
    expect(arenaCandidates('linux', '/home/me', {})).toEqual({ logDirs: [], rawDirs: [] });
  });
});
