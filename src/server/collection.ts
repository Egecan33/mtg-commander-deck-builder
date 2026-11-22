import type { CollectionInfo } from '@/app/lib/api';
import { parseCollection } from '@/engine/text';
import type { UnresolvedLine } from '@/engine/text';
import { PHYSICAL_COLLECTION } from './db';
import { HttpError } from './http';
import { findPrinting } from './printings';
import { cacheSlot, serverState } from './state';
import { getCardDb, getDb } from './store';

const ACTIVE_KEY = 'activeCollection';

/** Forgets everything that depends on which cards are owned. */
function forgetOwned(): void {
  const caches = serverState().caches;
  for (const name of ['collection', 'collection-set', 'collection-active', 'deck-tiles']) caches.delete(name);
}

/** Id of the collection that "owned" means everywhere: builds, scores, green dots, the Collection page. */
export function activeCollectionId(): string {
  return cacheSlot('collection-active', () => {
    const db = getDb();
    const row = db.prepare('SELECT json FROM settings WHERE key = ?').get(ACTIVE_KEY) as { json: string } | undefined;
    let id: unknown = null;
    try {
      id = row ? JSON.parse(row.json) : null;
    } catch {
      // a damaged row falls back to Physical
    }
    return typeof id === 'string' && db.prepare('SELECT 1 FROM collections WHERE id = ?').get(id) ? id : PHYSICAL_COLLECTION;
  });
}

/** Makes another collection the active one. */
export function setActiveCollection(id: string): void {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM collections WHERE id = ?').get(id)) throw new HttpError(400, `There is no collection "${id}".`);
  db.prepare('INSERT INTO settings(key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run(ACTIVE_KEY, JSON.stringify(id));
  forgetOwned();
}

/** Every collection in display order, with its size. */
export function listCollections(): CollectionInfo[] {
  const active = activeCollectionId();
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.name, c.kind, c.synced_at AS syncedAt, count(k.oracle_id) AS count, coalesce(sum(k.qty), 0) AS totalQty
       FROM collections c LEFT JOIN collection_cards k ON k.collection_id = c.id AND k.qty >= 1
       GROUP BY c.id ORDER BY c.position, c.name`,
    )
    .all() as { id: string; name: string; kind: string; syncedAt: string | null; count: number; totalQty: number }[];
  return rows.map((r) => ({
    id: r.id, name: r.name, kind: r.kind === 'arena' ? 'arena' : 'manual', count: r.count, totalQty: r.totalQty, active: r.id === active, syncedAt: r.syncedAt,
  }));
}

function quantitiesOf(id: string): Map<string, number> {
  const map = new Map<string, number>();
  const rows = getDb().prepare('SELECT oracle_id AS oracleId, qty FROM collection_cards WHERE collection_id = ?').all(id) as { oracleId: string; qty: number }[];
  for (const r of rows) if (r.qty >= 1) map.set(r.oracleId, r.qty);
  return map;
}

/** oracleId -> owned quantity in the active collection. Cached until it changes or another becomes active. */
export function ownedQuantities(): ReadonlyMap<string, number> {
  return cacheSlot('collection', () => quantitiesOf(activeCollectionId()));
}

/** The owned oracle ids, as `BuildOptions.owned` wants them. Same Set until the active collection changes. */
export function ownedSet(): Set<string> {
  return cacheSlot('collection-set', () => new Set(ownedQuantities().keys()));
}

function totals(): { count: number; totalQty: number } {
  let totalQty = 0;
  for (const q of ownedQuantities().values()) totalQty += q;
  return { count: ownedQuantities().size, totalQty };
}

/**
 * Replaces every card of one collection (not necessarily the active one) with `cards`; quantities
 * below one are dropped. `syncedAt` records when an automatic source was last read.
 */
export function setCollectionCards(id: string, cards: ReadonlyMap<string, number>, syncedAt?: string): void {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM collections WHERE id = ?').get(id)) throw new HttpError(400, `There is no collection "${id}".`);
  db.transaction(() => {
    db.prepare('DELETE FROM collection_cards WHERE collection_id = ?').run(id);
    const ins = db.prepare('INSERT INTO collection_cards(collection_id, oracle_id, qty) VALUES (?, ?, ?)');
    for (const [oracleId, qty] of cards) if (Number.isFinite(qty) && qty >= 1) ins.run(id, oracleId, Math.min(9999, Math.floor(qty)));
    if (syncedAt !== undefined) db.prepare('UPDATE collections SET synced_at = ? WHERE id = ?').run(syncedAt, id);
  })();
  forgetOwned();
}

/** Replaces the whole active collection with the cards named in a CSV or plain-text list. */
export function replaceCollection(text: string): { count: number; totalQty: number; unresolved: UnresolvedLine[] } {
  const parsed = parseCollection(text, getCardDb(), findPrinting);
  const cards = new Map<string, number>();
  for (const o of parsed.owned) cards.set(o.oracleId, (cards.get(o.oracleId) ?? 0) + o.qty);
  setCollectionCards(activeCollectionId(), cards);
  return { ...totals(), unresolved: parsed.unresolved };
}

/** Adds `delta` copies of one card to the active collection (negative takes copies away; the row goes at zero). Returns the card's new quantity. */
export function adjustCollection(oracleId: string, delta: number): { count: number; totalQty: number; qty: number } {
  const db = getDb();
  const id = activeCollectionId();
  const row = db.prepare('SELECT qty FROM collection_cards WHERE collection_id = ? AND oracle_id = ?').get(id, oracleId) as { qty: number } | undefined;
  const qty = Math.min(9999, Math.max(0, (row?.qty ?? 0) + Math.trunc(delta)));
  if (qty === 0) db.prepare('DELETE FROM collection_cards WHERE collection_id = ? AND oracle_id = ?').run(id, oracleId);
  else {
    db.prepare(
      'INSERT INTO collection_cards(collection_id, oracle_id, qty) VALUES (?, ?, ?) ON CONFLICT(collection_id, oracle_id) DO UPDATE SET qty = excluded.qty',
    ).run(id, oracleId, qty);
  }
  forgetOwned();
  return { ...totals(), qty };
}

const csvCell = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** One collection as a "Name,Quantity" CSV, sorted by name. `replaceCollection` reads it back unchanged. */
export function collectionCsv(id: string = activeCollectionId()): string {
  const db = getCardDb();
  const lines: [string, number][] = [];
  for (const [oracleId, qty] of quantitiesOf(id)) {
    const card = db.get(oracleId);
    if (card) lines.push([card.name, qty]);
  }
  lines.sort((a, b) => a[0].localeCompare(b[0]));
  return ['Name,Quantity', ...lines.map(([name, qty]) => `${csvCell(name)},${qty}`)].join('\n') + '\n';
}
