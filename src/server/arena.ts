import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import Database from 'better-sqlite3';
import type { ArenaProblem, ArenaStatus, ArenaSyncResult } from '@/app/lib/api';
import { createArenaLogReader, type ArenaLogData } from '@/engine/text';
import { resolveCardName } from '@/engine/text/decklist';
import { listCollections, setCollectionCards } from './collection';
import { ARENA_COLLECTION } from './db';
import { findPrinting } from './printings';
import { getCardDb, getDb } from './store';

/**
 * MTG Arena sync. Everything here reads files that Arena itself leaves on this computer: its
 * Player.log and its card database. Nothing is sent anywhere, no Wizards server is contacted and
 * the Arena process is not touched.
 *
 * What the log holds is described in `engine/text/arenalog.ts`: decks and limited pools, not the
 * whole collection. Arena starts a new log on every start, so each sync adds to what earlier ones
 * found (the most copies ever seen of a card) and never takes cards away.
 */

const LOGS = ['Player.log', 'Player-prev.log'];

/** Folders where Arena keeps its log and its downloaded data ("Raw"), per platform. Pure, for tests. */
export function arenaCandidates(platform: NodeJS.Platform, home: string, env: Record<string, string | undefined>): { logDirs: string[]; rawDirs: string[] } {
  if (platform === 'darwin') {
    const p = path.posix;
    return {
      logDirs: [p.join(home, 'Library/Logs/Wizards Of The Coast/MTGA')],
      rawDirs: [
        p.join(home, 'Library/Application Support/Steam/steamapps/common/MTGA/MTGA_Data/Downloads/Raw'),
        p.join(home, 'Library/Application Support/com.wizards.mtga/Downloads/Raw'),
        '/Users/Shared/Epic Games/MagicTheGathering/MTGA.app/Contents/Resources/Data/Downloads/Raw',
        '/Applications/MTGA.app/Contents/Resources/Data/Downloads/Raw',
        p.join(home, 'Applications/MTGA.app/Contents/Resources/Data/Downloads/Raw'),
      ],
    };
  }
  if (platform === 'win32') {
    const p = path.win32;
    const pf = env.ProgramFiles ?? 'C:\\Program Files';
    const pf86 = env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const raw = (root: string) => p.join(root, 'MTGA_Data', 'Downloads', 'Raw');
    return {
      logDirs: [p.join(home, 'AppData', 'LocalLow', 'Wizards Of The Coast', 'MTGA')],
      rawDirs: [
        raw(p.join(pf, 'Wizards of the Coast', 'MTGA')),
        raw(p.join(pf86, 'Wizards of the Coast', 'MTGA')),
        raw(p.join(pf86, 'Steam', 'steamapps', 'common', 'MTGA')),
        raw(p.join(pf, 'Steam', 'steamapps', 'common', 'MTGA')),
        raw(p.join(pf, 'Epic Games', 'MagicTheGathering')),
      ],
    };
  }
  return { logDirs: [], rawDirs: [] };
}

interface Found { logDir: string | null; logs: string[]; rawDir: string | null; cardDatabase: string | null }

/** What of Arena is on this computer. COMMANDER_FORGE_ARENA_LOG_DIR / _RAW_DIR replace the usual places (tests, odd installs). */
function locate(): Found {
  const usual = arenaCandidates(process.platform, os.homedir(), process.env);
  const logDirs = process.env.COMMANDER_FORGE_ARENA_LOG_DIR ? [process.env.COMMANDER_FORGE_ARENA_LOG_DIR] : usual.logDirs;
  const rawDirs = process.env.COMMANDER_FORGE_ARENA_RAW_DIR ? [process.env.COMMANDER_FORGE_ARENA_RAW_DIR] : usual.rawDirs;
  const isDir = (dir: string) => {
    try {
      return statSync(dir).isDirectory();
    } catch {
      return false;
    }
  };
  const logDir = logDirs.find(isDir) ?? null;
  const logs = logDir ? LOGS.map((f) => path.join(logDir, f)).filter((f) => existsSync(f)) : [];
  let rawDir: string | null = null;
  let cardDatabase: string | null = null;
  for (const dir of rawDirs.filter(isDir)) {
    rawDir ??= dir;
    // The file name carries a content hash; after an update there can briefly be two, so take the newest.
    const files = readdirSync(dir)
      .filter((f) => /^Raw_CardDatabase_.*\.mtga$/i.test(f))
      .map((f) => path.join(dir, f))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
    if (files[0]) {
      rawDir = dir;
      cardDatabase = files[0];
      break;
    }
  }
  return { logDir, logs, rawDir, cardDatabase };
}

interface Memory { last: ArenaSyncResult | null; detailedLogs: boolean | null; stamp: string | null }
// On globalThis like the rest of the server state, but kept when caches are dropped: it is not derived from the database.
const KEY = '__commanderForgeArena';
const holder = globalThis as unknown as Record<string, WeakMap<object, Memory> | undefined>;
function memory(): Memory {
  const perDb = (holder[KEY] ??= new WeakMap());
  const db = getDb();
  let m = perDb.get(db);
  if (!m) perDb.set(db, (m = { last: null, detailedLogs: null, stamp: null }));
  return m;
}

const stampOf = (found: Found): string =>
  JSON.stringify([found.cardDatabase, ...found.logs.map((f) => {
    const s = statSync(f);
    return [f, s.size, s.mtimeMs];
  })]);

async function readLogs(files: string[]): Promise<ArenaLogData> {
  const reader = createArenaLogReader();
  // Oldest first, so the newest log has the last word on the detailed-logging switch.
  for (const file of [...files].reverse()) {
    const lines = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of lines) reader.line(line);
  }
  return reader.result();
}

/** Arena card ids -> this app's cards, through Arena's own card database (name first, then set and number). */
function mapCards(cardDatabase: string, seen: ReadonlyMap<number, number>): { owned: Map<string, number>; unmapped: number } {
  const arena = new Database(cardDatabase, { readonly: true, fileMustExist: true });
  try {
    const row = arena.prepare(
      `SELECT c.ExpansionCode AS setCode, c.CollectorNumber AS number, c.IsToken AS token, c.IsRebalanced AS rebalanced,
         (SELECT l.Loc FROM Localizations_enUS l WHERE l.LocId = c.TitleId ORDER BY l.Formatted = 1 DESC LIMIT 1) AS name
       FROM Cards c WHERE c.GrpId = ?`,
    );
    const db = getCardDb();
    const owned = new Map<string, number>();
    let unmapped = 0;
    for (const [grpId, qty] of seen) {
      const r = row.get(grpId) as { setCode: string | null; number: string | null; token: number; rebalanced: number; name: string | null } | undefined;
      if (!r || r.token) {
        if (!r) unmapped++;
        continue;
      }
      let name = (r.name ?? '').replace(/<[^>]*>/g, '').trim();
      // Alchemy's rebalanced versions ("A-Name") are owned together with the card they change.
      if (r.rebalanced || /^A-/.test(name)) name = name.replace(/^A-/, '');
      const card = name ? resolveCardName(name, db) : undefined;
      const oracleId = card?.oracleId ?? (r.setCode && r.number ? findPrinting(r.setCode.toLowerCase(), r.number) : undefined);
      if (!oracleId) {
        unmapped++;
        continue;
      }
      // Printings of one card: the most copies seen of any one printing, not their sum.
      if (qty > (owned.get(oracleId) ?? 0)) owned.set(oracleId, qty);
    }
    return { owned, unmapped };
  } finally {
    arena.close();
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function status(found: Found = locate()): ArenaStatus {
  const m = memory();
  return {
    installed: found.logDir !== null || found.rawDir !== null,
    installPath: found.rawDir,
    logPath: found.logs[0] ?? null,
    cardDatabase: found.cardDatabase,
    detailedLogs: m.detailedLogs,
    last: m.last,
    syncedAt: listCollections().find((c) => c.id === ARENA_COLLECTION)?.syncedAt ?? null,
  };
}

/** Is Arena here, and what did the last sync of this app run do. Reads no log. */
export const arenaStatus = (): ArenaStatus => status();

/**
 * Reads the local Arena files into the "MTG Arena" collection. Never throws for anything about
 * Arena: the result says what is missing and what to do. `auto` (app start) returns the last
 * result unchanged when neither log nor card database changed since.
 */
export async function syncArenaCollection(options: { auto?: boolean } = {}): Promise<ArenaStatus> {
  const m = memory();
  const at = new Date().toISOString();
  const fail = (problem: ArenaProblem, message: string, found: Found): ArenaStatus => {
    m.last = { ok: false, at, problem, message, cards: 0, totalQty: 0, unmapped: 0, sources: '' };
    return status(found);
  };
  let found: Found = { logDir: null, logs: [], rawDir: null, cardDatabase: null };
  try {
    found = locate();
    if (!found.logDir && !found.rawDir) {
      return fail('not-installed', 'MTG Arena is not installed on this computer (no Arena log or game folder was found). You can still fill this collection by pasting or importing a list.', found);
    }
    if (found.logs.length === 0) {
      return fail('no-log', 'MTG Arena is installed but has not written a log yet. Start Arena once, then sync again.', found);
    }
    const stamp = stampOf(found);
    if (options.auto && m.last && m.stamp === stamp) return status(found);
    m.stamp = stamp;

    const log = await readLogs(found.logs);
    m.detailedLogs = log.detailedLogs;
    if (log.cards.size === 0) {
      if (log.detailedLogs === false) {
        return fail(
          'detailed-logs-off',
          'Arena is not writing card data to its log. In Arena open Options (the gear), Account, tick “Detailed Logs (Plugin Support)”, restart Arena and open your decks once. Then sync again.',
          found,
        );
      }
      return fail('no-card-data', 'The Arena log has no decks or draft pools in it yet. Start Arena, wait for the home screen, open your decks, then sync again.', found);
    }
    if (!found.cardDatabase) {
      return fail('no-card-database', 'The Arena log was read, but Arena’s card database was not found, so its card numbers cannot be turned into names. Start Arena once so it finishes downloading, then sync again.', found);
    }

    const { owned, unmapped } = mapCards(found.cardDatabase, log.cards);
    // Add to what is already there: each Arena start begins a new log, so one log never shows everything.
    const merged = new Map<string, number>();
    const before = getDb().prepare('SELECT oracle_id AS oracleId, qty FROM collection_cards WHERE collection_id = ?').all(ARENA_COLLECTION) as { oracleId: string; qty: number }[];
    for (const r of before) merged.set(r.oracleId, r.qty);
    for (const [id, qty] of owned) if (qty > (merged.get(id) ?? 0)) merged.set(id, qty);
    setCollectionCards(ARENA_COLLECTION, merged, at);

    let totalQty = 0;
    for (const q of merged.values()) totalQty += q;
    const sources = [log.decks ? plural(log.decks, 'deck', 'decks') : '', log.pools ? plural(log.pools, 'draft or sealed pool', 'draft or sealed pools') : ''].filter(Boolean).join(', ');
    m.last = {
      ok: true, at, problem: null, cards: merged.size, totalQty, unmapped, sources,
      message: `MTG Arena synced: ${plural(merged.size, 'card', 'different cards')} known from ${sources}.` +
        (unmapped ? ` ${plural(unmapped, 'Arena-only card was', 'Arena-only cards were')} left out.` : ''),
    };
    return status(found);
  } catch (err) {
    return fail('unreadable', `MTG Arena’s files could not be read (${err instanceof Error ? err.message : String(err)}). Nothing was changed.`, found);
  }
}
