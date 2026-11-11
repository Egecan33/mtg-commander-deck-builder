import { parseCollection } from '@/engine/text';
import type { UnresolvedLine } from '@/engine/text';
import { findPrinting } from './printings';
import { cacheSlot, serverState } from './state';
import { getCardDb, getDb } from './store';

/** oracleId -> owned quantity. Cached until the collection is replaced. */
export function ownedQuantities(): ReadonlyMap<string, number> {
  return cacheSlot('collection', () => {
    const map = new Map<string, number>();
    const rows = getDb().prepare('SELECT oracle_id AS oracleId, qty FROM collection').all() as { oracleId: string; qty: number }[];
    for (const r of rows) if (r.qty >= 1) map.set(r.oracleId, r.qty);
    return map;
  });
}

/** The owned oracle ids, as `BuildOptions.owned` wants them. Same Set until the collection changes. */
export function ownedSet(): Set<string> {
  return cacheSlot('collection-set', () => new Set(ownedQuantities().keys()));
}

/** Replaces the whole collection with the cards named in a CSV or plain-text list. */
export function replaceCollection(text: string): { count: number; totalQty: number; unresolved: UnresolvedLine[] } {
  const parsed = parseCollection(text, getCardDb(), findPrinting);
  const db = getDb();
  db.transaction(() => {
    db.exec('DELETE FROM collection');
    const ins = db.prepare('INSERT INTO collection(oracle_id, qty) VALUES (?, ?) ON CONFLICT(oracle_id) DO UPDATE SET qty = qty + excluded.qty');
    for (const o of parsed.owned) if (Number.isFinite(o.qty) && o.qty >= 1) ins.run(o.oracleId, Math.floor(o.qty));
  })();
  const caches = serverState().caches;
  caches.delete('collection');
  caches.delete('collection-set');
  let totalQty = 0;
  for (const q of ownedQuantities().values()) totalQty += q;
  return { count: ownedQuantities().size, totalQty, unresolved: parsed.unresolved };
}

/** Adds `delta` copies of one card (negative takes copies away; the row goes at zero). Returns the card's new quantity. */
export function adjustCollection(oracleId: string, delta: number): { count: number; totalQty: number; qty: number } {
  const db = getDb();
  const row = db.prepare('SELECT qty FROM collection WHERE oracle_id = ?').get(oracleId) as { qty: number } | undefined;
  const qty = Math.min(9999, Math.max(0, (row?.qty ?? 0) + Math.trunc(delta)));
  if (qty === 0) db.prepare('DELETE FROM collection WHERE oracle_id = ?').run(oracleId);
  else db.prepare('INSERT INTO collection(oracle_id, qty) VALUES (?, ?) ON CONFLICT(oracle_id) DO UPDATE SET qty = excluded.qty').run(oracleId, qty);
  const caches = serverState().caches;
  caches.delete('collection');
  caches.delete('collection-set');
  caches.delete('deck-tiles');
  let totalQty = 0;
  for (const q of ownedQuantities().values()) totalQty += q;
  return { count: ownedQuantities().size, totalQty, qty };
}
