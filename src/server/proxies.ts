import type { ProxyItem, ProxyListResponse } from '@/app/lib/api';
import { cardLookup } from './cards';
import { HttpError, isObject } from './http';
import { getCardDb, getDb } from './store';

export const MAX_PROXY_ITEMS = 500;
export const MAX_PROXY_QTY = 99;

/** Request data as proxy items: known cards only, quantities 1..99, one entry per card (later entries add up). */
export function sanitizeProxyItems(input: unknown): ProxyItem[] {
  if (!Array.isArray(input)) throw new HttpError(400, 'items must be a list of { oracleId, qty }.');
  if (input.length > MAX_PROXY_ITEMS * 4) throw new HttpError(400, `items can hold at most ${MAX_PROXY_ITEMS} cards.`);
  const db = getCardDb();
  const merged = new Map<string, number>();
  for (const raw of input) {
    if (!isObject(raw) || typeof raw.oracleId !== 'string' || !raw.oracleId) throw new HttpError(400, 'items entries need an oracleId.');
    const qty = Math.floor(Number(raw.qty ?? 1));
    if (!Number.isFinite(qty) || qty < 1) continue;
    if (!db.get(raw.oracleId)) throw new HttpError(400, `Unknown card ${raw.oracleId}.`);
    merged.set(raw.oracleId, Math.min(MAX_PROXY_QTY, (merged.get(raw.oracleId) ?? 0) + qty));
  }
  if (merged.size > MAX_PROXY_ITEMS) throw new HttpError(400, `The proxy list can hold at most ${MAX_PROXY_ITEMS} different cards.`);
  return [...merged].map(([oracleId, qty]) => ({ oracleId, qty }));
}

/** The saved proxy list, in the order cards were first added. */
export function getProxies(): ProxyListResponse {
  const rows = getDb().prepare('SELECT oracle_id AS oracleId, qty FROM proxy_list ORDER BY added_at, rowid').all() as ProxyItem[];
  const items = rows.filter((r) => r.qty >= 1);
  return { items, total: items.reduce((n, i) => n + i.qty, 0), cards: cardLookup(items.map((i) => i.oracleId)) };
}

/** Replaces the list. Cards that stay keep their place in it. */
export function replaceProxies(items: ProxyItem[]): ProxyListResponse {
  const db = getDb();
  const now = new Date().toISOString();
  db.transaction(() => {
    const keep = new Set(items.map((i) => i.oracleId));
    for (const row of db.prepare('SELECT oracle_id AS id FROM proxy_list').all() as { id: string }[]) {
      if (!keep.has(row.id)) db.prepare('DELETE FROM proxy_list WHERE oracle_id = ?').run(row.id);
    }
    const put = db.prepare('INSERT INTO proxy_list(oracle_id, qty, added_at) VALUES (?, ?, ?) ON CONFLICT(oracle_id) DO UPDATE SET qty = excluded.qty');
    for (const i of items) put.run(i.oracleId, i.qty, now);
  })();
  return getProxies();
}

/** Adds cards to the list; a card already on it gets the quantities added (up to 99). */
export function addProxies(items: ProxyItem[]): ProxyListResponse {
  const db = getDb();
  const now = new Date().toISOString();
  const count = (db.prepare('SELECT COUNT(*) AS n FROM proxy_list').get() as { n: number }).n;
  const fresh = items.filter((i) => !db.prepare('SELECT 1 FROM proxy_list WHERE oracle_id = ?').get(i.oracleId)).length;
  if (count + fresh > MAX_PROXY_ITEMS) throw new HttpError(400, `The proxy list can hold at most ${MAX_PROXY_ITEMS} different cards.`);
  db.transaction(() => {
    const put = db.prepare(
      `INSERT INTO proxy_list(oracle_id, qty, added_at) VALUES (?, ?, ?) ON CONFLICT(oracle_id) DO UPDATE SET qty = MIN(${MAX_PROXY_QTY}, qty + excluded.qty)`,
    );
    for (const i of items) put.run(i.oracleId, i.qty, now);
  })();
  return getProxies();
}
