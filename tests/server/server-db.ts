import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Card, Combo } from '@/engine/types';
import { syncFeatures } from '@/ingest/features';
import { invalidateCardDb } from '@/server/carddb';
import { openDb, writeSyncState, type Db } from '@/server/db';
import { resetServerState } from '@/server/state';

const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));

/** A SQLite database filled from the committed fixtures the way `pnpm sync` fills the real one. */
export function seedDb(dbPath = ':memory:'): Db {
  const db = openDb(dbPath);
  const { cards, tags } = JSON.parse(readFileSync(FIXTURES + 'cards.json', 'utf8')) as { cards: Card[]; tags: Record<string, string[]> };
  const combos = JSON.parse(readFileSync(FIXTURES + 'combos.json', 'utf8')) as Combo[];
  db.transaction(() => {
    const insCard = db.prepare('INSERT INTO cards(oracle_id, name, front_name, json) VALUES (?, ?, ?, ?)');
    for (const c of cards) insCard.run(c.oracleId, c.name, c.frontName, JSON.stringify(c));
    const insTag = db.prepare('INSERT OR IGNORE INTO tags(id, slug, label) VALUES (?, ?, ?)');
    const insLink = db.prepare('INSERT OR IGNORE INTO card_tags(oracle_id, tag_id) VALUES (?, ?)');
    for (const [oracleId, slugs] of Object.entries(tags)) {
      for (const slug of slugs) {
        insTag.run(slug, slug, slug);
        insLink.run(oracleId, slug);
      }
    }
    const insCombo = db.prepare('INSERT INTO combos(id, json) VALUES (?, ?)');
    const insComboCard = db.prepare('INSERT OR IGNORE INTO combo_cards(combo_id, oracle_id) VALUES (?, ?)');
    for (const combo of combos) {
      insCombo.run(combo.id, JSON.stringify(combo));
      for (const c of combo.cards) insComboCard.run(combo.id, c.oracleId);
    }
  })();
  writeSyncState(db, 'cards', { cards: cards.length });
  syncFeatures(db, () => undefined);
  return db;
}

/** Points the server layer at `db` (or at nothing) and forgets every cache. */
export function useServerDb(db: Db | null): void {
  invalidateCardDb();
  resetServerState(db);
}
