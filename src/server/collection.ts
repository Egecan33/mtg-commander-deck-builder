import { parseCollection } from '@/engine/text';
import type { UnresolvedLine } from '@/engine/text';
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
  const parsed = parseCollection(text, getCardDb());
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
