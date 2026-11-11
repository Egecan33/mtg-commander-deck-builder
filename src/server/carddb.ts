import { createCardDb } from '@/engine/carddb';
import type { Card, CardDb, CardFeatures, Combo } from '@/engine/types';
import type { Db } from './db';

export type ServerCardDb = CardDb & { tagSlugs(oracleId: string): string[] };

// On globalThis so that separately bundled route handlers share one copy (see state.ts).
const KEY = '__commanderForgeCardDb';
const holder = globalThis as unknown as Record<string, { db: Db; value: ServerCardDb } | null | undefined>;

/** Builds the in-memory CardDb from SQLite. Cached per database handle until `invalidateCardDb()`. */
export function loadCardDb(db: Db): ServerCardDb {
  const cache = holder[KEY];
  if (cache && cache.db === db) return cache.value;

  const cards = (db.prepare('SELECT json FROM cards').all() as { json: string }[]).map(
    (r) => JSON.parse(r.json) as Card,
  );
  const features = (db.prepare('SELECT json FROM card_features').all() as { json: string }[]).map(
    (r) => JSON.parse(r.json) as CardFeatures,
  );
  const combos = (db.prepare('SELECT json FROM combos').all() as { json: string }[]).map(
    (r) => JSON.parse(r.json) as Combo,
  );

  const slugs = new Map<string, string[]>();
  const rows = db
    .prepare('SELECT ct.oracle_id AS oracleId, t.slug AS slug FROM card_tags ct JOIN tags t ON t.id = ct.tag_id')
    .iterate() as IterableIterator<{ oracleId: string; slug: string }>;
  for (const row of rows) {
    const list = slugs.get(row.oracleId);
    if (list) list.push(row.slug);
    else slugs.set(row.oracleId, [row.slug]);
  }

  const value: ServerCardDb = {
    ...createCardDb(cards, features, combos),
    tagSlugs: (oracleId) => slugs.get(oracleId) ?? [],
  };
  holder[KEY] = { db, value };
  return value;
}

export function invalidateCardDb(): void {
  holder[KEY] = null;
}
