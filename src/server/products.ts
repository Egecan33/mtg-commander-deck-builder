import type { ProductDetailResponse, ProductGroup, ProductInfo, ProductsResponse } from '@/app/lib/api';
import { prepareFields, searchItems } from '@/engine/text/search';
import { cardLookup } from './cards';
import { ownedQuantities } from './collection';
import { getDb } from './store';

/** MTGJSON product types that exist only online; nobody can own them on paper. */
export const DIGITAL_PRODUCT_TYPES: ReadonlySet<string> = new Set([
  'MTGO Redemption', 'MTGO Theme Deck', 'MTGO Commander Deck', 'MTGO Duel Deck',
  'Arena Starter Deck', 'Arena Starter Kit', 'Arena Promotional Deck',
  'Historic Brawl Precon Deck', 'Shandalar Enemy Deck', 'Duel Of The Planeswalkers Deck',
]);

export type { ProductDetailResponse, ProductGroup, ProductInfo };

type ProductRow = ProductInfo;

const SELECT = `SELECT p.id, p.name, p.set_code AS setCode, p.type, p.release_date AS releaseDate,
  coalesce((SELECT sum(qty) FROM product_cards WHERE product_id = p.id), 0) AS cardCount
  FROM products p`;

const digitalTypes = (): string[] => [...DIGITAL_PRODUCT_TYPES];

/** A group needs at least this many decks; two sharing a prefix are more likely just siblings. */
const MIN_GROUP = 3;

const groupKey = (p: ProductInfo): { key: string; prefix: string } | null => {
  const at = p.name.indexOf(' - ');
  if (at < 1) return null;
  const prefix = p.name.slice(0, at).trim();
  return prefix ? { key: `${p.setCode.toLowerCase()}|${prefix.toLowerCase()}`, prefix } : null;
};

/** Name of every known set, by lower-case code. Empty until the printings sync has run. */
function setNames(): Map<string, string> {
  const rows = getDb().prepare('SELECT code, name FROM sets').all() as { code: string; name: string }[];
  return new Map(rows.map((r) => [r.code.toLowerCase(), r.name]));
}

export type ProductSearch = ProductsResponse;

/**
 * Physical products matching `q`, best match first (newest first among equals; newest first when
 * `q` is empty), with the groups the matches belong to. Every word of `q` must match the product's
 * name, set name, type or set code (set codes whole), in any order, with typos forgiven. Limit
 * defaults to 50, max 200.
 */
export function searchProducts(q: string, limit = 50): ProductSearch {
  const cap = Math.min(200, Math.max(1, Math.floor(Number.isFinite(limit) ? limit : 50)));
  const types = digitalTypes();
  const all = getDb()
    .prepare(`${SELECT} WHERE p.type NOT IN (${types.map(() => '?').join(',')}) ORDER BY p.release_date DESC, p.name`)
    .all(...types) as ProductRow[];
  const names = setNames();
  const setNameOf = (p: ProductInfo) => names.get(p.setCode.toLowerCase()) ?? '';
  const matched = searchItems(all, q, (p) => prepareFields([p.name, setNameOf(p), p.type, { text: p.setCode, exact: true }]), { typoFields: 3 }).slice(0, cap);

  const members = new Map<string, ProductInfo[]>();
  const prefixes = new Map<string, string>();
  for (const p of all) {
    const g = groupKey(p);
    if (!g) continue;
    prefixes.set(g.key, g.prefix);
    members.set(g.key, [...(members.get(g.key) ?? []), p]);
  }
  const groups: ProductGroup[] = [];
  const seen = new Set<string>();
  const sets: Record<string, string> = {};
  for (const p of matched) {
    const name = setNameOf(p);
    if (name) sets[p.setCode.toUpperCase()] = name;
    const g = groupKey(p);
    if (!g || seen.has(g.key)) continue;
    const decks = members.get(g.key) ?? [];
    if (decks.length < MIN_GROUP) continue;
    seen.add(g.key);
    const setName = name || p.setCode.toUpperCase();
    groups.push({
      key: g.key, setCode: p.setCode, setName, prefix: prefixes.get(g.key) ?? g.prefix, label: `${setName} \u2014 ${prefixes.get(g.key) ?? g.prefix}`,
      products: [...decks].sort((a, b) => a.name.localeCompare(b.name)), cardCount: decks.reduce((n, d) => n + d.cardCount, 0),
    });
  }
  return { products: matched, groups, sets };
}

/** Physical products matching `q` (see `searchProducts`), best match first. */
export const listProducts = (q: string, limit = 50): ProductInfo[] => searchProducts(q, limit).products;

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
