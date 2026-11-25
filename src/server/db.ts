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
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, position INTEGER NOT NULL, synced_at TEXT
);
CREATE TABLE IF NOT EXISTS collection_cards (
  collection_id TEXT NOT NULL, oracle_id TEXT NOT NULL, qty INTEGER NOT NULL,
  PRIMARY KEY (collection_id, oracle_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS decks (id TEXT PRIMARY KEY, name TEXT NOT NULL, json TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS proxy_list (oracle_id TEXT PRIMARY KEY, qty INTEGER NOT NULL, added_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS printings (
  set_code TEXT NOT NULL, collector_number TEXT NOT NULL COLLATE NOCASE, oracle_id TEXT NOT NULL,
  PRIMARY KEY (set_code, collector_number)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, set_code TEXT NOT NULL, type TEXT NOT NULL, release_date TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS product_cards (
  product_id TEXT NOT NULL, oracle_id TEXT NOT NULL, qty INTEGER NOT NULL, commander INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, oracle_id)
) WITHOUT ROWID;
CREATE TABLE IF NOT EXISTS sync_state (step TEXT PRIMARY KEY, finished_at TEXT NOT NULL, info TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS collection_boxes (
  id TEXT PRIMARY KEY, collection_id TEXT NOT NULL, product_id TEXT NOT NULL, name TEXT NOT NULL, added_at TEXT NOT NULL, deck_id TEXT
);
CREATE INDEX IF NOT EXISTS collection_boxes_collection ON collection_boxes(collection_id);
-- qty: copies still sealed in the box; total: copies it came with; commander: copied from the
-- product so the box outlives a resync that drops or renames the product.
CREATE TABLE IF NOT EXISTS collection_box_cards (
  box_id TEXT NOT NULL, oracle_id TEXT NOT NULL, qty INTEGER NOT NULL, commander INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL,
  PRIMARY KEY (box_id, oracle_id)
) WITHOUT ROWID;
`;

/** Opens (and creates if needed) the SQLite database. Pass ':memory:' for tests. */
export function openDb(dbPath: string = process.env.COMMANDER_FORGE_DB ?? DEFAULT_DB_PATH): Db {
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(SCHEMA);
  migrateCollections(db);
  return db;
}

/** The collection that holds what was the app's only collection before there were several. */
export const PHYSICAL_COLLECTION = 'physical';
export const ARENA_COLLECTION = 'arena';

/**
 * Creates the built-in collections once. A database from before there were several collections has
 * its cards in the `collection` table: they are copied into "Physical". The old table is left as it
 * was and is not read again, so a later start never overwrites what the user changed since.
 */
function migrateCollections(db: Db): void {
  if (db.prepare('SELECT 1 FROM collections WHERE id = ?').get(PHYSICAL_COLLECTION)) return;
  db.transaction(() => {
    const add = db.prepare('INSERT OR IGNORE INTO collections(id, name, kind, position) VALUES (?, ?, ?, ?)');
    add.run(PHYSICAL_COLLECTION, 'Physical', 'manual', 0);
    add.run(ARENA_COLLECTION, 'MTG Arena', 'arena', 1);
    db.prepare('INSERT OR IGNORE INTO collection_cards(collection_id, oracle_id, qty) SELECT ?, oracle_id, qty FROM collection WHERE qty >= 1').run(PHYSICAL_COLLECTION);
  })();
}

export function writeSyncState(db: Db, step: string, info: Record<string, unknown>): void {
  db.prepare(
    'INSERT INTO sync_state(step, finished_at, info) VALUES (?, ?, ?) ' +
      'ON CONFLICT(step) DO UPDATE SET finished_at = excluded.finished_at, info = excluded.info',
  ).run(step, new Date().toISOString(), JSON.stringify(info));
}
