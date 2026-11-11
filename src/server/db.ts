import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export type Db = Database.Database;

// turbopackIgnore: the bundler must not trace the 66k image files under data/ into the build.
export const DATA_DIR = process.env.COMMANDER_FORGE_DATA ?? path.join(/* turbopackIgnore: true */ process.cwd(), 'data');
export const DEFAULT_DB_PATH = path.join(DATA_DIR, 'forge.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS cards (
  oracle_id TEXT PRIMARY KEY, name TEXT NOT NULL, front_name TEXT NOT NULL, json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS cards_name ON cards(name);
CREATE TABLE IF NOT EXISTS card_images (
  oracle_id TEXT NOT NULL, face INTEGER NOT NULL,
  display_url TEXT NOT NULL, grid_url TEXT NOT NULL,
  image_updated_at TEXT, fetched_updated_at TEXT,
  PRIMARY KEY (oracle_id, face)
);
CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, slug TEXT NOT NULL, label TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS card_tags (
  oracle_id TEXT NOT NULL, tag_id TEXT NOT NULL, PRIMARY KEY (oracle_id, tag_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS card_tags_tag ON card_tags(tag_id);
CREATE TABLE IF NOT EXISTS combos (id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS combo_cards (
  combo_id TEXT NOT NULL, oracle_id TEXT NOT NULL, PRIMARY KEY (combo_id, oracle_id)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS combo_cards_card ON combo_cards(oracle_id);
CREATE TABLE IF NOT EXISTS card_features (oracle_id TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS edhrec_cache (key TEXT PRIMARY KEY, fetched_at TEXT NOT NULL, etag TEXT, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS collection (oracle_id TEXT PRIMARY KEY, qty INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS decks (id TEXT PRIMARY KEY, name TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS proxy_list (oracle_id TEXT PRIMARY KEY, qty INTEGER NOT NULL, added_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sync_state (step TEXT PRIMARY KEY, finished_at TEXT NOT NULL, info TEXT NOT NULL);
`;

/** Opens (and creates if needed) the SQLite database. Pass ':memory:' for tests. */
export function openDb(dbPath: string = process.env.COMMANDER_FORGE_DB ?? DEFAULT_DB_PATH): Db {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);
  return db;
}

export function writeSyncState(db: Db, step: string, info: Record<string, unknown>): void {
  db.prepare(
    'INSERT INTO sync_state(step, finished_at, info) VALUES (?, ?, ?) ' +
      'ON CONFLICT(step) DO UPDATE SET finished_at = excluded.finished_at, info = excluded.info',
  ).run(step, new Date().toISOString(), JSON.stringify(info));
}
