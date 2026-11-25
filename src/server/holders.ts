import type { HeldBy } from '@/app/lib/api';
import { isBasicLand } from '@/engine/rules';
import { availableCopies, conflicts, type ConflictReport, type Holder } from '@/engine/collection/conflicts';
import type { Deck } from '@/engine/types';
import { activeCollectionId, ownedQuantities, ownedSet } from './collection';
import { sanitizeDeck } from './decks';
import { getCardDb, getDb } from './store';

/*
 * What keeps copies of a collection out of reach: boxes with sealed copies and decks that are
 * really assembled. Until decks belong to collections, every built deck counts for a collection
 * kept by hand and none for an Arena one.
 */

export type { Holder };

/** Boxes with sealed copies and built decks of the collection (basic lands left out). */
export function holdersFor(collectionId: string): Holder[] {
  const db = getDb();
  const kind = (db.prepare('SELECT kind FROM collections WHERE id = ?').get(collectionId) as { kind: string } | undefined)?.kind;
  if (kind !== 'manual') return [];
  const cards = getCardDb();

  const builtDecks: Holder[] = [];
  const decks = db.prepare("SELECT id, name, json FROM decks WHERE json_extract(json, '$.built') = 1 ORDER BY updated_at, id").all() as { id: string; name: string; json: string }[];
  for (const d of decks) {
    let deck: Deck;
    try {
      deck = sanitizeDeck(JSON.parse(d.json));
    } catch {
      continue;
    }
    const map = new Map<string, number>();
    const add = (oracleId: string, qty: number) => {
      const c = cards.get(oracleId);
      if (c && isBasicLand(c)) return;
      map.set(oracleId, (map.get(oracleId) ?? 0) + qty);
    };
    for (const c of deck.commanders) add(c, 1);
    if (deck.companion) add(deck.companion, 1);
    for (const e of deck.main) add(e.oracleId, e.qty);
    builtDecks.push({ id: `deck:${d.id}`, kind: 'deck', name: `${d.name} (built)`, cards: map });
  }

  // A box linked to a built deck is that deck: the deck already holds those copies, so the box does not count again.
  const builtIds = new Set(builtDecks.map((h) => h.id.slice('deck:'.length)));
  const boxes = db.prepare('SELECT id, name, deck_id AS deckId FROM collection_boxes WHERE collection_id = ? ORDER BY added_at, id').all(collectionId) as {
    id: string; name: string; deckId: string | null;
  }[];
  const rows = db.prepare('SELECT oracle_id AS oracleId, qty FROM collection_box_cards WHERE box_id = ? AND qty >= 1');
  const holders: Holder[] = [];
  for (const b of boxes) {
    if (b.deckId !== null && builtIds.has(b.deckId)) continue;
    const map = new Map<string, number>();
    const sealed = rows.all(b.id) as { oracleId: string; qty: number }[];
    for (const r of sealed) {
      const c = cards.get(r.oracleId);
      if (c && isBasicLand(c)) continue;
      map.set(r.oracleId, r.qty);
    }
    if (sealed.length > 0) holders.push({ id: `box:${b.id}`, kind: 'box', name: `${b.name} box`, cards: map });
  }
  return [...holders, ...builtDecks];
}

/** The holders that are this deck itself: `deck:<id>` and the boxes linked to it. A deleted link matches nothing. */
export function selfHolders(deck: Deck): Set<string> {
  const self = new Set<string>();
  if (deck.id === null) return self;
  self.add(`deck:${deck.id}`);
  const boxes = getDb().prepare('SELECT id FROM collection_boxes WHERE deck_id = ?').all(deck.id) as { id: string }[];
  for (const b of boxes) self.add(`box:${b.id}`);
  return self;
}

/*
 * The "!" in responses. Worked out per request from the active collection (a handful of queries),
 * never stored with a cached analysis: boxes and built decks change without the deck changing.
 */

/** The deck's cards whose free copies do not cover what it needs (see `conflicts`). */
export function deckConflicts(deck: Deck): ConflictReport {
  const holders = holdersFor(activeCollectionId());
  if (holders.length === 0) return { cards: {}, byHolder: [] };
  return conflicts(deck, ownedQuantities(), holders, selfHolders(deck), getCardDb());
}

/**
 * For each of `ids`: the holders whose copies one more copy of the card in this deck would take
 * (owned in that quantity, but not free). Cards with a free copy, or not owned enough, are left out.
 */
export function heldByFor(deck: Deck, ids: Iterable<string>): HeldBy {
  const holders = holdersFor(activeCollectionId());
  const out: HeldBy = {};
  if (holders.length === 0) return out;
  const totals = ownedQuantities();
  const self = selfHolders(deck);
  const available = availableCopies(totals, holders, self);
  const copies = new Map<string, number>();
  const count = (id: string, qty: number) => copies.set(id, (copies.get(id) ?? 0) + qty);
  for (const c of deck.commanders) count(c, 1);
  if (deck.companion) count(deck.companion, 1);
  for (const e of deck.main) count(e.oracleId, e.qty);
  for (const id of ids) {
    if (out[id]) continue;
    const free = available.get(id);
    if (free === undefined) continue;
    const need = (copies.get(id) ?? 0) + 1;
    if ((totals.get(id) ?? 0) < need || free >= need) continue;
    const names = holders.filter((h) => !self.has(h.id) && (h.cards.get(id) ?? 0) >= 1).map((h) => h.name);
    if (names.length > 0) out[id] = names;
  }
  return out;
}

/** Owned cards with at least one copy free for a deck whose own holders are `self` (cards no one holds keep their total). */
export function freeOwnedSet(self: ReadonlySet<string>): Set<string> {
  const holders = holdersFor(activeCollectionId());
  if (holders.length === 0) return ownedSet();
  const totals = ownedQuantities();
  const available = availableCopies(totals, holders, self);
  const out = new Set<string>();
  for (const id of totals.keys()) if ((available.get(id) ?? 1) >= 1) out.add(id);
  return out;
}

/**
 * The first box (newest first) of the active collection that this deck looks like: not linked to a
 * deck that exists, still holding sealed copies, with a commander slot that is one of the deck's
 * commanders, and at least 80% of its non-basic cards in the deck.
 */
export function boxMatchFor(deck: Deck): { boxId: string; name: string } | null {
  if (deck.commanders.length === 0) return null;
  const db = getDb();
  const cards = getCardDb();
  const boxes = db
    .prepare(
      `SELECT b.id, b.name FROM collection_boxes b
       WHERE b.collection_id = ?
         AND (b.deck_id IS NULL OR NOT EXISTS (SELECT 1 FROM decks d WHERE d.id = b.deck_id))
         AND EXISTS (SELECT 1 FROM collection_box_cards x WHERE x.box_id = b.id AND x.qty >= 1)
       ORDER BY b.added_at DESC, b.id`,
    )
    .all(activeCollectionId()) as { id: string; name: string }[];
  if (boxes.length === 0) return null;
  const inDeck = new Set<string>([...deck.commanders, ...deck.main.map((e) => e.oracleId)]);
  if (deck.companion) inDeck.add(deck.companion);
  const rows = db.prepare('SELECT oracle_id AS oracleId, commander FROM collection_box_cards WHERE box_id = ?');
  for (const b of boxes) {
    const list = rows.all(b.id) as { oracleId: string; commander: number }[];
    if (!list.some((r) => r.commander === 1 && deck.commanders.includes(r.oracleId))) continue;
    let nonBasic = 0;
    let present = 0;
    for (const r of list) {
      const c = cards.get(r.oracleId);
      if (c && isBasicLand(c)) continue;
      nonBasic++;
      if (inDeck.has(r.oracleId)) present++;
    }
    if (nonBasic > 0 && present * 5 >= nonBasic * 4) return { boxId: b.id, name: b.name };
  }
  return null;
}
