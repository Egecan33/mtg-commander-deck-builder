import { createReadStream } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';
import { createGunzip } from 'node:zlib';
import { DATA_DIR, writeSyncState, type Db } from '@/server/db';
import type { Log } from './cards';
import { downloadToFile } from './http';
import { readTar } from './tar';

/* MTGJSON deck files are external JSON; they are read defensively through `any`. */
/* eslint-disable @typescript-eslint/no-explicit-any */

const DECKS_URL = 'https://mtgjson.com/api/v5/AllDeckFiles.tar.gz';
const MIN_PRODUCTS = 1000;

export interface ParsedProduct {
  id: string;
  name: string;
  setCode: string;
  type: string;
  releaseDate: string;
  cards: { oracleId: string; qty: number; commander: boolean }[];
  /** Entries whose oracle id is not in the cards table; counted, not stored. */
  unknownCards: number;
}

/** Boards that hold cards you own. Tokens, planes and schemes are not part of the collection. */
const BOARDS: { key: string; commander: boolean }[] = [
  { key: 'commander', commander: true },
  { key: 'displayCommander', commander: true },
  { key: 'mainBoard', commander: false },
  { key: 'sideBoard', commander: false },
];

/** Turns one MTGJSON deck file into a product. Null when the file has no data or no cards. */
export function parseMtgjsonDeck(fileName: string, json: unknown, known: (oracleId: string) => boolean): ParsedProduct | null {
  const data = (json as any)?.data;
  if (!data || typeof data !== 'object') return null;
  const qty = new Map<string, { qty: number; commander: boolean }>();
  const unknown = new Set<string>();
  for (const { key, commander } of BOARDS) {
    if (!Array.isArray(data[key])) continue;
    for (const entry of data[key]) {
      const id = entry?.identifiers?.scryfallOracleId;
      const count = Number(entry?.count);
      if (typeof id !== 'string' || !Number.isInteger(count) || count < 1) continue;
      if (!known(id)) { unknown.add(id); continue; }
      const row = qty.get(id) ?? { qty: 0, commander: false };
      row.qty += count;
      row.commander ||= commander;
      qty.set(id, row);
    }
  }
  if (qty.size === 0) return null;
  return {
    id: path.basename(fileName).replace(/\.json$/, ''),
    name: String(data.name ?? ''),
    setCode: String(data.code ?? ''),
    type: String(data.type ?? ''),
    releaseDate: String(data.releaseDate ?? ''),
    cards: [...qty].map(([oracleId, v]) => ({ oracleId, qty: v.qty, commander: v.commander })),
    unknownCards: unknown.size,
  };
}

/** Replaces the whole catalogue in one transaction. Throws, touching nothing, on a suspiciously short list. */
export function storeProducts(db: Db, products: ParsedProduct[]): void {
  if (products.length < MIN_PRODUCTS) {
    throw new Error(`products: only ${products.length} products; refusing to replace the catalogue`);
  }
  db.transaction(() => {
    db.exec('DELETE FROM product_cards; DELETE FROM products');
    const insProduct = db.prepare('INSERT OR REPLACE INTO products(id, name, set_code, type, release_date) VALUES (?, ?, ?, ?, ?)');
    const insCard = db.prepare('INSERT OR REPLACE INTO product_cards(product_id, oracle_id, qty, commander) VALUES (?, ?, ?, ?)');
    for (const p of products) {
      insProduct.run(p.id, p.name, p.setCode, p.type, p.releaseDate);
      for (const c of p.cards) insCard.run(p.id, c.oracleId, c.qty, c.commander ? 1 : 0);
    }
  })();
}

/** Every product in a downloaded AllDeckFiles.tar.gz, and the MTGJSON version it carries. */
export async function readProducts(file: string, known: (oracleId: string) => boolean, log: Log): Promise<{ products: ParsedProduct[]; version: string | null }> {
  const products: ParsedProduct[] = [];
  let version: string | null = null;
  let files = 0;
  // pipeline (not .pipe) carries a read error into gunzip, so the tar reader fails instead of waiting for ever.
  const gunzipped = createGunzip();
  pipeline(createReadStream(file), gunzipped, () => {});
  for await (const entry of readTar(gunzipped)) {
    if (!entry.name.endsWith('.json')) continue;
    files++;
    if (files % 500 === 0) log(`products read ${files}`);
    let json: unknown;
    try { json = JSON.parse(entry.data.toString('utf8')); } catch { continue; }
    version ??= typeof (json as any)?.meta?.version === 'string' ? (json as any).meta.version : null;
    const p = parseMtgjsonDeck(entry.name, json, known);
    if (p) products.push(p);
  }
  return { products, version };
}

/**
 * Fills `products` and `product_cards` from MTGJSON's AllDeckFiles archive: the card list of every
 * fixed-content product (Commander decks, Secret Lair drops, starter decks), so a whole box can be
 * added to the collection at once.
 */
export async function syncProducts(db: Db, log: Log): Promise<void> {
  const file = path.join(DATA_DIR, 'raw', 'mtgjson-decks.tar.gz');
  log(`products downloading ${DECKS_URL}`);
  const bytes = await downloadToFile(DECKS_URL, file);
  log(`products downloaded ${bytes} bytes`);

  const knownIds = new Set((db.prepare('SELECT oracle_id FROM cards').all() as { oracle_id: string }[]).map((r) => r.oracle_id));
  const { products, version } = await readProducts(file, (id) => knownIds.has(id), log);

  storeProducts(db, products);
  const byType: Record<string, number> = {};
  for (const p of products) byType[p.type] = (byType[p.type] ?? 0) + 1;
  const info = {
    version,
    products: products.length,
    cards: products.reduce((n, p) => n + p.cards.length, 0),
    withUnknownCard: products.filter((p) => p.unknownCards > 0).length,
    byType,
  };
  writeSyncState(db, 'products', info);
  log(`products finished ${JSON.stringify(info)}`);
}
