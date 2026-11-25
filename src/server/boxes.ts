import { randomUUID } from 'node:crypto';
import type { BoxCard, BoxDetailResponse, BoxInfo, OpenBoxResponse } from '@/app/lib/api';
import type { DeckEntry } from '@/engine/types';
import { cardLookup } from './cards';
import { activeCollectionId, forgetOwned } from './collection';
import type { Db } from './db';
import { getDeck, sanitizeDeck, saveDeck } from './decks';
import { HttpError } from './http';
import { getDb } from './store';

/*
 * Sealed products ("boxes") kept in a collection. `collection_cards.qty` stays the total (loose +
 * boxed); a box only remembers which of those copies are still sealed in it. Invariant, per
 * collection and card: copies sealed in boxes <= the total.
 */

export type { BoxCard, BoxDetailResponse, BoxInfo, OpenBoxResponse };

const SELECT_BOX = `SELECT b.id, b.product_id AS productId, b.name, b.added_at AS addedAt, b.deck_id AS deckId,
  coalesce(sum(x.qty), 0) AS sealed, coalesce(sum(x.total), 0) AS total
  FROM collection_boxes b LEFT JOIN collection_box_cards x ON x.box_id = b.id`;

/** Boxes of the active collection, newest first. */
export function listBoxes(): BoxInfo[] {
  return getDb().prepare(`${SELECT_BOX} WHERE b.collection_id = ? GROUP BY b.id ORDER BY b.added_at DESC, b.id`).all(activeCollectionId()) as BoxInfo[];
}

function boxInfo(db: Db, id: string): BoxInfo | null {
  return (db.prepare(`${SELECT_BOX} WHERE b.id = ? GROUP BY b.id`).get(id) as BoxInfo | undefined) ?? null;
}

function requireBox(db: Db, id: string): { id: string; collectionId: string; name: string; deckId: string | null } {
  const box = db.prepare('SELECT id, collection_id AS collectionId, name, deck_id AS deckId FROM collection_boxes WHERE id = ?').get(id) as
    | { id: string; collectionId: string; name: string; deckId: string | null }
    | undefined;
  if (!box) throw new HttpError(404, 'No such box.');
  return box;
}

/** Cards still sealed in a box, commander slots first. Empty for an unknown box. */
export function boxCards(boxId: string): BoxCard[] {
  const rows = getDb()
    .prepare('SELECT oracle_id AS oracleId, qty, commander FROM collection_box_cards WHERE box_id = ? AND qty >= 1 ORDER BY commander DESC, oracle_id')
    .all(boxId) as { oracleId: string; qty: number; commander: number }[];
  return rows.map((r) => ({ oracleId: r.oracleId, qty: r.qty, commander: r.commander === 1 }));
}

/** One box with its sealed cards and a CardLookup for them. Null when unknown. */
export function boxDetail(id: string): BoxDetailResponse | null {
  const box = boxInfo(getDb(), id);
  if (!box) return null;
  const cards = boxCards(id);
  return { box, cards, lookup: cardLookup(cards.map((c) => c.oracleId)) };
}

/** oracleId -> copies sealed in that collection's boxes (cards with none are left out). */
export function boxedQuantities(collectionId: string): Map<string, number> {
  const rows = getDb()
    .prepare(
      `SELECT x.oracle_id AS oracleId, sum(x.qty) AS qty FROM collection_box_cards x JOIN collection_boxes b ON b.id = x.box_id
       WHERE b.collection_id = ? GROUP BY x.oracle_id HAVING sum(x.qty) >= 1`,
    )
    .all(collectionId) as { oracleId: string; qty: number }[];
  return new Map(rows.map((r) => [r.oracleId, r.qty]));
}

/** Boxes exist only in collections kept by hand: 404 for an unknown collection, 400 for an Arena one. */
function requireManual(db: Db, collectionId: string): void {
  const row = db.prepare('SELECT name, kind FROM collections WHERE id = ?').get(collectionId) as { name: string; kind: string } | undefined;
  if (!row) throw new HttpError(404, `There is no collection "${collectionId}".`);
  if (row.kind !== 'manual') throw new HttpError(400, `Boxes can only be kept in a collection you keep by hand, not in "${row.name}".`);
}

interface ProductCards { id: string; name: string; cards: { oracleId: string; qty: number; commander: number }[] }

function requireProduct(db: Db, productId: string): ProductCards {
  const product = db.prepare('SELECT id, name FROM products WHERE id = ?').get(productId) as { id: string; name: string } | undefined;
  if (!product) throw new HttpError(404, 'No such product.');
  const cards = db.prepare('SELECT oracle_id AS oracleId, qty, commander FROM product_cards WHERE product_id = ? AND qty >= 1').all(productId) as ProductCards['cards'];
  return { ...product, cards };
}

/** Writes the box and its cards (all sealed). Call inside a transaction. */
function insertBox(db: Db, collectionId: string, product: ProductCards): string {
  const id = randomUUID();
  db.prepare('INSERT INTO collection_boxes(id, collection_id, product_id, name, added_at, deck_id) VALUES (?, ?, ?, ?, ?, NULL)')
    .run(id, collectionId, product.id, product.name, new Date().toISOString());
  const ins = db.prepare('INSERT INTO collection_box_cards(box_id, oracle_id, qty, commander, total) VALUES (?, ?, ?, ?, ?)');
  for (const c of product.cards) ins.run(id, c.oracleId, c.qty, c.commander ? 1 : 0, c.qty);
  return id;
}

/** Deletes a box and its card rows. Call inside a transaction. */
function deleteBox(db: Db, id: string): void {
  db.prepare('DELETE FROM collection_box_cards WHERE box_id = ?').run(id);
  db.prepare('DELETE FROM collection_boxes WHERE id = ?').run(id);
}

/** A sealed product bought: every card's total rises by the product's quantity, and the box remembers them. */
export function addBox(productId: string): BoxInfo {
  const db = getDb();
  const collectionId = activeCollectionId();
  requireManual(db, collectionId);
  const product = requireProduct(db, productId);
  const id = db.transaction(() => {
    const add = db.prepare(
      'INSERT INTO collection_cards(collection_id, oracle_id, qty) VALUES (?, ?, ?) ON CONFLICT(collection_id, oracle_id) DO UPDATE SET qty = qty + excluded.qty',
    );
    for (const c of product.cards) add.run(collectionId, c.oracleId, c.qty);
    return insertBox(db, collectionId, product);
  })();
  forgetOwned();
  return boxInfo(db, id)!;
}

/**
 * Records a box for cards that are already counted in a collection: totals do not change. 409 (and
 * nothing written) when any card's copies outside boxes are fewer than the product holds. For the
 * one-off `scripts/attach-box.ts`, not for the app.
 */
export function attachBox(collectionId: string, productId: string): BoxInfo {
  const db = getDb();
  requireManual(db, collectionId);
  const product = requireProduct(db, productId);
  const id = db.transaction(() => {
    const boxed = boxedQuantities(collectionId);
    const totalOf = db.prepare('SELECT qty FROM collection_cards WHERE collection_id = ? AND oracle_id = ?');
    const nameOf = db.prepare('SELECT name FROM cards WHERE oracle_id = ?');
    const short: string[] = [];
    for (const c of product.cards) {
      const total = (totalOf.get(collectionId, c.oracleId) as { qty: number } | undefined)?.qty ?? 0;
      const free = total - (boxed.get(c.oracleId) ?? 0);
      if (free < c.qty) short.push(`${(nameOf.get(c.oracleId) as { name: string } | undefined)?.name ?? c.oracleId} (needs ${c.qty}, ${free} outside boxes)`);
    }
    if (short.length > 0) throw new HttpError(409, `The collection is short of ${product.name}'s cards: ${short.join('; ')}.`);
    return insertBox(db, collectionId, product);
  })();
  forgetOwned();
  return boxInfo(db, id)!;
}

/** sold: the copies still in the box leave the collection, then the box goes. opened: only the box goes; its cards stay loose. */
export function removeBox(id: string, mode: 'sold' | 'opened'): void {
  if (mode !== 'sold' && mode !== 'opened') throw new HttpError(400, "mode must be 'sold' or 'opened'.");
  const db = getDb();
  const box = requireBox(db, id);
  db.transaction(() => {
    if (mode === 'sold') {
      const take = db.prepare('UPDATE collection_cards SET qty = qty - ? WHERE collection_id = ? AND oracle_id = ?');
      for (const c of boxCards(id)) take.run(c.qty, box.collectionId, c.oracleId);
      db.prepare('DELETE FROM collection_cards WHERE collection_id = ? AND qty < 1').run(box.collectionId);
    }
    deleteBox(db, id);
  })();
  forgetOwned();
}

/**
 * "Opened, make it a built deck". A box linked to a deck that exists: that deck is marked built (its
 * cards are not touched) and the box is removed, so no second deck appears. Otherwise: saves a new
 * deck from the cards still sealed in the box, marked built, then removes the box. Commander slots
 * become the commanders when there are at most two; with more, the owner chooses (`chooseCommander`)
 * and every card goes to main. The copies move from the box to the deck, so totals do not change.
 */
export function openBoxAsDeck(id: string): OpenBoxResponse {
  const db = getDb();
  const res = db.transaction((): OpenBoxResponse => {
    const box = requireBox(db, id);
    const linked = box.deckId !== null ? getDeck(box.deckId) : null;
    if (box.deckId !== null && linked) {
      if (!saveDeck(sanitizeDeck({ ...linked.deck, built: true }), box.deckId)) throw new HttpError(500, 'The deck could not be saved.');
      deleteBox(db, id);
      return { deckId: box.deckId, linked: true, chooseCommander: false };
    }
    const cards = boxCards(id);
    const chooseCommander = cards.filter((c) => c.commander).length > 2;
    const commanders: string[] = [];
    const main: DeckEntry[] = [];
    for (const c of cards) {
      let qty = c.qty;
      if (c.commander && !chooseCommander) {
        commanders.push(c.oracleId);
        qty -= 1;
      }
      if (qty > 0) main.push({ oracleId: c.oracleId, qty, locked: false });
    }
    const saved = saveDeck(sanitizeDeck({ name: box.name, commanders, main, targetBracket: 3, built: true }));
    if (!saved?.deck.id) throw new HttpError(500, 'The deck could not be saved.');
    deleteBox(db, id);
    return { deckId: saved.deck.id, linked: false, chooseCommander };
  })();
  forgetOwned();
  return res;
}

/** Moves `qty` copies of one card out of the box; they stay in the collection as loose copies. */
export function takeFromBox(id: string, oracleId: string, qty: number): void {
  if (!Number.isInteger(qty) || qty < 1) throw new HttpError(400, 'Take at least one copy.');
  const db = getDb();
  requireBox(db, id);
  const res = db.prepare('UPDATE collection_box_cards SET qty = qty - ? WHERE box_id = ? AND oracle_id = ? AND qty >= ?').run(qty, id, oracleId, qty);
  if (res.changes === 0) {
    const held = (db.prepare('SELECT qty FROM collection_box_cards WHERE box_id = ? AND oracle_id = ?').get(id, oracleId) as { qty: number } | undefined)?.qty ?? 0;
    throw new HttpError(409, `The box holds ${held} ${held === 1 ? 'copy' : 'copies'} of that card.`);
  }
  forgetOwned();
}

/** Links the box to the deck that is this box (null unlinks). The deck is not changed. */
export function linkBox(id: string, deckId: string | null): void {
  const db = getDb();
  requireBox(db, id);
  if (deckId !== null && !db.prepare('SELECT 1 FROM decks WHERE id = ?').get(deckId)) throw new HttpError(404, 'No such deck.');
  db.prepare('UPDATE collection_boxes SET deck_id = ? WHERE id = ?').run(deckId, id);
  forgetOwned();
}

/** One box as BoxInfo, or a 404. */
export function getBoxInfo(id: string): BoxInfo {
  const box = boxInfo(getDb(), id);
  if (!box) throw new HttpError(404, 'No such box.');
  return box;
}
