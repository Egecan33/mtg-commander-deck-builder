import { isBasicLand } from '@/engine/rules';
import type { Holder } from '@/engine/collection/conflicts';
import type { Deck } from '@/engine/types';
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
  const holders: Holder[] = [];

  const boxes = db.prepare('SELECT id, name FROM collection_boxes WHERE collection_id = ? ORDER BY added_at, id').all(collectionId) as { id: string; name: string }[];
  const rows = db.prepare('SELECT oracle_id AS oracleId, qty FROM collection_box_cards WHERE box_id = ? AND qty >= 1');
  for (const b of boxes) {
    const map = new Map<string, number>();
    const sealed = rows.all(b.id) as { oracleId: string; qty: number }[];
    for (const r of sealed) {
      const c = cards.get(r.oracleId);
      if (c && isBasicLand(c)) continue;
      map.set(r.oracleId, r.qty);
    }
    if (sealed.length > 0) holders.push({ id: `box:${b.id}`, kind: 'box', name: `${b.name} box`, cards: map });
  }

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
    holders.push({ id: `deck:${d.id}`, kind: 'deck', name: `${d.name} (built)`, cards: map });
  }
  return holders;
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
