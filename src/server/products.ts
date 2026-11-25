import type { ProductDetailResponse, ProductInfo } from '@/app/lib/api';
import { cardLookup } from './cards';
import { ownedQuantities } from './collection';
import { getDb } from './store';

/** MTGJSON product types that exist only online; nobody can own them on paper. */
export const DIGITAL_PRODUCT_TYPES: ReadonlySet<string> = new Set([
  'MTGO Redemption', 'MTGO Theme Deck', 'MTGO Commander Deck', 'MTGO Duel Deck',
  'Arena Starter Deck', 'Arena Starter Kit', 'Arena Promotional Deck',
  'Historic Brawl Precon Deck', 'Shandalar Enemy Deck', 'Duel Of The Planeswalkers Deck',
]);

export type { ProductDetailResponse, ProductInfo };

type ProductRow = ProductInfo;

const SELECT = `SELECT p.id, p.name, p.set_code AS setCode, p.type, p.release_date AS releaseDate,
  coalesce((SELECT sum(qty) FROM product_cards WHERE product_id = p.id), 0) AS cardCount
  FROM products p`;

const digitalTypes = (): string[] => [...DIGITAL_PRODUCT_TYPES];

/** Physical products matching `q` (name substring or exact set code), newest first. Limit defaults to 50, max 200. */
export function listProducts(q: string, limit = 50): ProductInfo[] {
  const cap = Math.min(200, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 50)));
  const types = digitalTypes();
  const text = q.trim().toLowerCase();
  const where = [`p.type NOT IN (${types.map(() => '?').join(',')})`];
  const args: (string | number)[] = [...types];
  if (text) {
    // instr is a plain case-insensitive substring test; LIKE would treat % and _ in the query as wildcards.
    where.push('(instr(lower(p.name), ?) > 0 OR lower(p.set_code) = ?)');
    args.push(text, text);
  }
  return getDb()
    .prepare(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY p.release_date DESC, p.name LIMIT ?`)
    .all(...args, cap) as ProductRow[];
}

/** One product with its cards and how many of each the active collection owns. Null when unknown. */
export function productDetail(id: string): ProductDetailResponse | null {
  const db = getDb();
  const product = db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as ProductRow | undefined;
  if (!product) return null;
  const owned = ownedQuantities();
  const rows = db
    .prepare('SELECT oracle_id AS oracleId, qty, commander FROM product_cards WHERE product_id = ? ORDER BY commander DESC, oracle_id')
    .all(id) as { oracleId: string; qty: number; commander: number }[];
  const cards = rows.map((r) => ({ oracleId: r.oracleId, qty: r.qty, commander: r.commander === 1, ownedQty: owned.get(r.oracleId) ?? 0 }));
  return { product, cards, lookup: cardLookup(cards.map((c) => c.oracleId)) };
}
