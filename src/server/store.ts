import path from 'node:path';
import { invalidateCardDb, loadCardDb, type ServerCardDb } from './carddb';
import { DATA_DIR, DEFAULT_DB_PATH, openDb, type Db } from './db';
import { dropCaches, serverState } from './state';

/** Path of the SQLite file, read from the environment on every call (tests point it elsewhere). */
export const dbPath = (): string => process.env.COMMANDER_FORGE_DB ?? DEFAULT_DB_PATH;

/** Directory that holds `images/`; follows COMMANDER_FORGE_DATA when it is set after start-up. */
export const dataDir = (): string => process.env.COMMANDER_FORGE_DATA ?? DATA_DIR;

export const imageDir = (): string => path.join(/* turbopackIgnore: true */ dataDir(), 'images');

/** The one open database handle of this process. Creates an empty database on first run. */
export function getDb(): Db {
  const s = serverState();
  return (s.db ??= openDb(dbPath()));
}

/** The in-memory card database (about 2 s to load for the full pool, then cached). */
export function getCardDb(): ServerCardDb {
  return loadCardDb(getDb());
}

/** Call after card data changed on disk (a sync step finished): everything derived is rebuilt on demand. */
export function onCardDataChanged(): void {
  invalidateCardDb();
  dropCaches();
}
