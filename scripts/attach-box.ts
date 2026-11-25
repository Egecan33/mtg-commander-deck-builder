/*
 * One-off: records a sealed box for cards that are ALREADY counted in a collection, without changing
 * any total (for a product that was entered card by card before boxes existed).
 *
 *   pnpm tsx scripts/attach-box.ts <collectionId> <productId>
 *
 * Refuses to run unless data/backups/ (beside the database) holds a backup made in the last
 * 10 minutes:  sqlite3 data/forge.db ".backup data/backups/forge-<date>-attach-box.db"
 * Refuses (409, nothing written) when the collection does not hold enough copies outside boxes.
 */
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { attachBox } from '@/server/boxes';
import { openDb } from '@/server/db';
import { resetServerState } from '@/server/state';
import { dbPath } from '@/server/store';

const FRESH_MS = 10 * 60 * 1000;

/** A non-empty file in `dir` modified within the last 10 minutes, or null. */
function freshBackup(dir: string, now = Date.now()): string | null {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return null;
  }
  for (const name of names) {
    const file = path.join(dir, name);
    const stat = statSync(file);
    if (stat.isFile() && stat.size > 0 && now - stat.mtimeMs <= FRESH_MS) return file;
  }
  return null;
}

function main(): number {
  const [collectionId, productId] = process.argv.slice(2);
  if (!collectionId || !productId) {
    console.error('usage: pnpm tsx scripts/attach-box.ts <collectionId> <productId>');
    return 2;
  }
  const file = dbPath();
  const backups = path.join(path.dirname(file), 'backups');
  const backup = freshBackup(backups);
  if (!backup) {
    console.error(`No backup newer than 10 minutes in ${backups}. Back up first:\n  sqlite3 ${file} ".backup ${path.join(backups, 'forge-<date>-attach-box.db')}"`);
    return 1;
  }
  console.log(`Backup found: ${backup}`);
  const db = openDb(file);
  resetServerState(db);
  try {
    console.log(JSON.stringify(attachBox(collectionId, productId), null, 2));
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  } finally {
    resetServerState(null);
    db.close();
  }
}

process.exitCode = main();
