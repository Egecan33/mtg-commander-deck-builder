import { execFile } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';
import Database from 'better-sqlite3';
import type { ArenaProblem, ArenaStatus, ArenaSyncResult } from '@/app/lib/api';
import { createArenaLogReader, type ArenaLogData } from '@/engine/text';
import { resolveCardName } from '@/engine/text/decklist';
import { listCollections, setCollectionCards } from './collection';
import { HttpError } from './http';
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
function mapCards(cardDatabase: string, seen: ReadonlyMap<number, number>, printings: 'most' | 'sum' = 'most'): { owned: Map<string, number>; unmapped: number } {
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
      // Printings of one card. From decks: the most copies seen of any one printing (a deck slot is not a
      // copy). From a full card list: every printing is real copies, so they add up.
      if (printings === 'sum') owned.set(oracleId, (owned.get(oracleId) ?? 0) + qty);
      else if (qty > (owned.get(oracleId) ?? 0)) owned.set(oracleId, qty);
    }
    return { owned, unmapped };
  } finally {
    arena.close();
  }
}

/**
 * The optional memory reader. The whole collection exists only inside the running game, and the
 * mtga-reader package (GPL-3.0, not part of this app) reads it from there. The user installs it
 * into this folder; when it is missing the app just says so.
 */
function readerDir(): string {
  if (process.env.COMMANDER_FORGE_ARENA_READER) return process.env.COMMANDER_FORGE_ARENA_READER;
  const name = 'Commander Forge Arena Reader';
  if (process.platform === 'win32') return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), name);
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', name);
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'commander-forge-arena-reader');
}
const readerModule = (): string => path.join(readerDir(), 'node_modules', 'mtga-reader');

// Card ids and counts only: the reader's account call (which carries a login token) is never used.
const READER_CODE =
  "const r=require(process.argv[1]);r.readCollection('MTGA').then(c=>process.stdout.write(JSON.stringify(c||{})),e=>process.stdout.write(JSON.stringify({error:String(e&&e.message||e)})))";

const run = (file: string, args: string[]): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(file, args, { maxBuffer: 64 * 1024 * 1024, timeout: 180_000 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim()));
      else resolve(stdout);
    });
  });

/** Runs the reader with the rights the operating system wants for looking into another process. */
function runReader(): Promise<string> {
  const args = ['-e', READER_CODE, readerModule()];
  // A copy of Node allowed to do this (on macOS: signed with the debugger entitlement) needs no password.
  const allowed = path.join(readerDir(), process.platform === 'win32' ? 'node-arena.exe' : 'node-arena');
  if (existsSync(allowed)) return run(allowed, args);
  if (process.platform === 'darwin') {
    // Otherwise macOS asks for an administrator password in its own window; the app never sees it.
    const quote = (a: string) => `'${a.replace(/'/g, `'\\''`)}'`;
    const command = [process.execPath, ...args].map(quote).join(' ');
    const script = `do shell script "${command.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" with prompt "Commander Forge wants to read your card collection from MTG Arena." with administrator privileges`;
    return run('osascript', ['-e', script]);
  }
  return run(process.execPath, args);
}

/**
 * Reads the whole collection out of the running game and makes it the "MTG Arena" collection.
 * Arena must be open on its home screen. Never throws for anything about Arena or the reader.
 */
export async function readArenaMemory(): Promise<ArenaStatus> {
  const m = memory();
  const at = new Date().toISOString();
  const fail = (problem: ArenaProblem, message: string): ArenaStatus => {
    m.last = { ok: false, at, problem, message, cards: 0, totalQty: 0, unmapped: 0, sources: '' };
    return status();
  };
  if (!existsSync(readerModule())) {
    return fail('no-reader', `The memory reader is not set up. In a terminal run: mkdir -p "${readerDir()}" && cd "${readerDir()}" && npm install mtga-reader. Then try again.`);
  }
  try {
    const out = JSON.parse(await runReader()) as { error?: string; cards?: unknown };
    if (out.error || !Array.isArray(out.cards)) {
      return fail('unreadable', `Arena’s collection could not be read: ${out.error ?? 'the reader returned no cards'}. Open Arena, wait on the home screen (not in a match) and try again.`);
    }
    return importArenaCards(out.cards);
  } catch (err) {
    const text = err instanceof Error ? err.message : String(err);
    const cancelled = /User canceled|\(-128\)/i.test(text);
    return fail('unreadable', cancelled ? 'Reading was cancelled at the password window. Nothing was changed.' : `Arena’s collection could not be read (${text}). Nothing was changed.`);
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
    reader: existsSync(readerModule()),
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

/**
 * Replaces the "MTG Arena" collection with a full list of Arena card ids and counts, as a tracker
 * or a memory reader gives it (`[{ grpId, qty }]`). Unlike a log sync this is the whole collection,
 * so it replaces instead of adding. The ids are turned into cards with Arena's local card database.
 */
export function importArenaCards(cards: unknown): ArenaStatus {
  if (!Array.isArray(cards)) throw new HttpError(400, 'cards must be a list of { grpId, qty }.');
  const seen = new Map<number, number>();
  for (const c of cards as { grpId?: unknown; qty?: unknown }[]) {
    const grpId = c?.grpId;
    const qty = c?.qty;
    if (typeof grpId !== 'number' || !Number.isInteger(grpId) || grpId <= 0) throw new HttpError(400, 'Every entry needs a grpId that is a positive whole number.');
    if (typeof qty !== 'number' || !Number.isFinite(qty) || qty < 0) throw new HttpError(400, 'Every entry needs a qty of zero or more.');
    if (qty >= 1) seen.set(grpId, (seen.get(grpId) ?? 0) + Math.floor(qty));
  }
  const m = memory();
  const at = new Date().toISOString();
  const found = locate();
  if (!found.cardDatabase) {
    m.last = { ok: false, at, problem: 'no-card-database', cards: 0, totalQty: 0, unmapped: 0, sources: '', message: 'Arena’s card database was not found on this computer, so its card numbers cannot be turned into names. Install or start Arena once, then import again.' };
    return status(found);
  }
  const { owned, unmapped } = mapCards(found.cardDatabase, seen, 'sum');
  setCollectionCards(ARENA_COLLECTION, owned, at);
  let totalQty = 0;
  for (const q of owned.values()) totalQty += Math.min(9999, q);
  m.last = {
    ok: true, at, problem: null, cards: owned.size, totalQty, unmapped, sources: 'a full card list',
    message: `MTG Arena collection imported: ${plural(owned.size, 'card', 'different cards')}.` + (unmapped ? ` ${plural(unmapped, 'Arena-only card was', 'Arena-only cards were')} left out.` : ''),
  };
  return status(found);
}
