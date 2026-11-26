import type { BoxTake, CollectionAdjustResponse, CollectionInfo } from '@/app/lib/api';
import { parseCollection } from '@/engine/text';
import type { UnresolvedLine } from '@/engine/text';
import type { Deck, Format } from '@/engine/types';
import { PHYSICAL_COLLECTION } from './db';
import { HttpError } from './http';
import { findPrinting } from './printings';
import { cacheSlot, serverState } from './state';
import { getCardDb, getDb } from './store';

const ACTIVE_KEY = 'activeCollection';

/** Forgets everything that depends on which cards are owned, or which of them sit in boxes. */
export function forgetOwned(): void {
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

/** A collection's kind ('manual' or 'arena'), or null when there is no such collection. */
export function collectionKind(id: string): 'manual' | 'arena' | null {
  const row = getDb().prepare('SELECT kind FROM collections WHERE id = ?').get(id) as { kind: string } | undefined;
  return row ? (row.kind === 'arena' ? 'arena' : 'manual') : null;
}

export type ArenaFormat = NonNullable<Deck['arenaFormat']>;

/** `arenaFormat` from a request or a stored deck: 'standardbrawl', else 'brawl' (what a missing one means). */
export const readArenaFormat = (value: unknown): ArenaFormat => (value === 'standardbrawl' ? 'standardbrawl' : 'brawl');

/**
 * The format a collection's decks are built in: for an Arena collection MTG Arena's Brawl, or
 * Standard Brawl when `arena` says so; else Commander.
 */
export const collectionFormat = (id: string, arena?: unknown): Format => (collectionKind(id) === 'arena' ? readArenaFormat(arena) : 'commander');

/** The format for what is built while the active collection is active: `arena` is the Brawl or Standard Brawl choice made in the app. */
export const activeFormat = (arena?: unknown): Format => collectionFormat(activeCollectionId(), arena);

/**
 * The collection a deck belongs to: its own `collectionId`, else the active collection (a deck
 * that was never saved, like the one on the New deck page, is built for what is active).
 */
export const deckCollection = (deck: Deck): string => deck.collectionId ?? activeCollectionId();

/**
 * The format a deck is checked and built in: for a deck of an Arena collection its `arenaFormat`
 * (Brawl when missing), else Commander.
 */
export const deckFormat = (deck: Deck): Format => collectionFormat(deckCollection(deck), deck.arenaFormat);

/** Makes another collection the active one. */
export function setActiveCollection(id: string): void {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM collections WHERE id = ?').get(id)) throw new HttpError(400, `There is no collection "${id}".`);
  db.prepare('INSERT INTO settings(key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json').run(ACTIVE_KEY, JSON.stringify(id));
  forgetOwned();
}

/**
 * Every collection in display order, with its size and its holders: boxes that still hold sealed
 * copies (a box linked to a built deck counts once, as that deck) and, for a collection kept by hand, built decks.
 */
export function listCollections(): CollectionInfo[] {
  const active = activeCollectionId();
  const rows = getDb()
    .prepare(
      `SELECT c.id, c.name, c.kind, c.synced_at AS syncedAt, count(k.oracle_id) AS count, coalesce(sum(k.qty), 0) AS totalQty,
         (SELECT count(*) FROM collection_boxes b WHERE b.collection_id = c.id
            AND EXISTS (SELECT 1 FROM collection_box_cards x WHERE x.box_id = b.id AND x.qty >= 1)
            AND NOT EXISTS (SELECT 1 FROM decks d WHERE d.id = b.deck_id AND json_extract(d.json, '$.built') = 1
              AND coalesce(json_extract(d.json, '$.collectionId'), '${PHYSICAL_COLLECTION}') = c.id))
          + CASE WHEN c.kind = 'manual' THEN (SELECT count(*) FROM decks WHERE json_extract(json, '$.built') = 1
              AND coalesce(json_extract(json, '$.collectionId'), '${PHYSICAL_COLLECTION}') = c.id) ELSE 0 END AS holders
       FROM collections c LEFT JOIN collection_cards k ON k.collection_id = c.id AND k.qty >= 1
       GROUP BY c.id ORDER BY c.position, c.name`,
    )
    .all() as { id: string; name: string; kind: string; syncedAt: string | null; count: number; totalQty: number; holders: number }[];
  return rows.map((r) => ({
    id: r.id, name: r.name, kind: r.kind === 'arena' ? 'arena' : 'manual', count: r.count, totalQty: r.totalQty, active: r.id === active, syncedAt: r.syncedAt,
    holders: r.holders,
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

/**
 * The owned oracle ids of one collection, active or not. An Arena deck's wildcards and "owned" count
 * against its own collection (`deckCollection`), whichever collection is active.
 */
export function ownedSetOf(id: string): Set<string> {
  return id === activeCollectionId() ? ownedSet() : new Set(quantitiesOf(id).keys());
}

function totals(): { count: number; totalQty: number } {
  let totalQty = 0;
  for (const q of ownedQuantities().values()) totalQty += q;
  return { count: ownedQuantities().size, totalQty };
}

/**
 * Replaces every card of one collection (not necessarily the active one) with `cards`; quantities
 * below one are dropped. `syncedAt` records when an automatic source was last read. The new totals
 * say nothing about boxes, so the collection's boxes are removed too.
 */
export function setCollectionCards(id: string, cards: ReadonlyMap<string, number>, syncedAt?: string): void {
  const db = getDb();
  if (!db.prepare('SELECT 1 FROM collections WHERE id = ?').get(id)) throw new HttpError(400, `There is no collection "${id}".`);
  db.transaction(() => {
    db.prepare('DELETE FROM collection_box_cards WHERE box_id IN (SELECT id FROM collection_boxes WHERE collection_id = ?)').run(id);
    db.prepare('DELETE FROM collection_boxes WHERE collection_id = ?').run(id);
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

/**
 * Adds `delta` copies of one card to the active collection (negative takes copies away; the row goes
 * at zero). Returns the card's new quantity.
 *
 * Boxes: a removal takes loose copies first. When the new total is below the copies sealed in the
 * collection's boxes, the difference comes out of boxes, newest box first (ties by id), and
 * `fromBoxes` lists every box touched. With a positive delta, `toBoxes` (an earlier removal's
 * `fromBoxes`) puts the added copies back into those boxes; a box that no longer exists in this
 * collection, or never held the card, is skipped and those copies stay loose. A box never gets more
 * than the copies added or than it came with, so sealed copies never exceed the total.
 */
export function adjustCollection(oracleId: string, delta: number, toBoxes: readonly { boxId: string; qty: number }[] = []): CollectionAdjustResponse {
  const db = getDb();
  const id = activeCollectionId();
  const fromBoxes: BoxTake[] = [];
  const qty = db.transaction(() => {
    const row = db.prepare('SELECT qty FROM collection_cards WHERE collection_id = ? AND oracle_id = ?').get(id, oracleId) as { qty: number } | undefined;
    const before = row?.qty ?? 0;
    const after = Math.min(9999, Math.max(0, before + Math.trunc(delta)));
    if (after === 0) db.prepare('DELETE FROM collection_cards WHERE collection_id = ? AND oracle_id = ?').run(id, oracleId);
    else {
      db.prepare(
        'INSERT INTO collection_cards(collection_id, oracle_id, qty) VALUES (?, ?, ?) ON CONFLICT(collection_id, oracle_id) DO UPDATE SET qty = excluded.qty',
      ).run(id, oracleId, after);
    }

    const cell = db.prepare(
      `SELECT x.qty, x.total FROM collection_box_cards x JOIN collection_boxes b ON b.id = x.box_id
       WHERE x.box_id = ? AND x.oracle_id = ? AND b.collection_id = ?`,
    );
    const setSealed = db.prepare('UPDATE collection_box_cards SET qty = ? WHERE box_id = ? AND oracle_id = ?');
    let room = after - before; // copies added: the most that may go back into boxes
    for (const t of toBoxes) {
      if (room <= 0) break;
      const c = cell.get(t.boxId, oracleId, id) as { qty: number; total: number } | undefined;
      if (!c) continue;
      const n = Math.min(room, Math.max(0, Math.trunc(t.qty)), c.total - c.qty);
      if (n <= 0) continue;
      setSealed.run(c.qty + n, t.boxId, oracleId);
      room -= n;
    }

    const held = db
      .prepare(
        `SELECT b.id AS boxId, b.name, x.qty FROM collection_box_cards x JOIN collection_boxes b ON b.id = x.box_id
         WHERE b.collection_id = ? AND x.oracle_id = ? AND x.qty >= 1 ORDER BY b.added_at DESC, b.id`,
      )
      .all(id, oracleId) as BoxTake[];
    let excess = held.reduce((s, h) => s + h.qty, 0) - after;
    for (const h of held) {
      if (excess <= 0) break;
      const n = Math.min(excess, h.qty);
      setSealed.run(h.qty - n, h.boxId, oracleId);
      fromBoxes.push({ boxId: h.boxId, name: h.name, qty: n });
      excess -= n;
    }
    return after;
  })();
  forgetOwned();
  return { ...totals(), qty, fromBoxes };
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
