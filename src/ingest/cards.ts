import path from 'node:path';
import type { Card, CardFace, Color } from '@/engine/types';
import { DATA_DIR, writeSyncState, type Db } from '@/server/db';
import { downloadToFile, readJsonLines, resolveBulk } from './http';

/* Scryfall objects are external JSON; they are read defensively through `any`. */
/* eslint-disable @typescript-eslint/no-explicit-any */

const COLORS: readonly Color[] = ['W', 'U', 'B', 'R', 'G'];
const asColors = (v: unknown): Color[] =>
  Array.isArray(v) ? (v.filter((c) => COLORS.includes(c as Color)) as Color[]) : [];
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Layouts whose two faces are printed on opposite sides, each with its own image. */
const TWO_IMAGE_LAYOUTS = new Set(['transform', 'modal_dfc']);

/** Maps a Scryfall card object to a Card. Null unless Commander legality is `legal` or `banned`. */
export function toCard(scryfall: any): Card | null {
  const legality = scryfall?.legalities?.commander;
  if (legality !== 'legal' && legality !== 'banned') return null;
  if (typeof scryfall.oracle_id !== 'string' || typeof scryfall.name !== 'string') return null;

  const rawFaces: any[] = Array.isArray(scryfall.card_faces) && scryfall.card_faces.length > 0 ? scryfall.card_faces : [];
  const faces: CardFace[] = (rawFaces.length > 0 ? rawFaces : [scryfall]).map((f) => ({
    name: str(f.name),
    manaCost: str(f.mana_cost),
    typeLine: str(f.type_line),
    oracleText: str(f.oracle_text),
    power: strOrNull(f.power),
    colors: asColors(f.colors ?? scryfall.colors),
  }));
  const front = faces[0];

  const price = Number.parseFloat(
    scryfall.prices?.usd ?? scryfall.prices?.usd_foil ?? scryfall.prices?.usd_etched ?? '',
  );

  return {
    oracleId: scryfall.oracle_id,
    scryfallId: str(scryfall.id),
    name: scryfall.name,
    frontName: front.name || scryfall.name,
    layout: str(scryfall.layout),
    // Root cost is the combined one for split/adventure; DFCs have none at root.
    manaCost: typeof scryfall.mana_cost === 'string' ? scryfall.mana_cost : front.manaCost,
    cmc: typeof scryfall.cmc === 'number' ? scryfall.cmc : 0,
    typeLine: str(scryfall.type_line) || faces.map((f) => f.typeLine).join(' // '),
    frontTypeLine: front.typeLine || str(scryfall.type_line),
    oracleText:
      rawFaces.length > 0 ? faces.map((f) => f.oracleText).join('\n//\n') : str(scryfall.oracle_text),
    colors: Array.isArray(scryfall.colors) ? asColors(scryfall.colors) : front.colors,
    colorIdentity: asColors(scryfall.color_identity),
    keywords: Array.isArray(scryfall.keywords) ? scryfall.keywords.filter((k: unknown) => typeof k === 'string') : [],
    power: strOrNull(scryfall.power) ?? front.power,
    producedMana: Array.isArray(scryfall.produced_mana)
      ? scryfall.produced_mana.filter((k: unknown) => typeof k === 'string')
      : [],
    legality,
    gameChanger: scryfall.game_changer === true,
    edhrecRank: typeof scryfall.edhrec_rank === 'number' ? scryfall.edhrec_rank : null,
    priceUsd: Number.isFinite(price) ? price : null,
    faces,
    imageFaces: TWO_IMAGE_LAYOUTS.has(scryfall.layout) && rawFaces.length === 2 ? 2 : 1,
    isMeldResult: false,
  };
}

export interface ImageRef { face: 0 | 1; display: string; grid: string }

/** Image URLs per face, following `card.image_uris ?? card.card_faces[i].image_uris`. */
export function imageRefs(scryfall: any): ImageRef[] {
  const pick = (uris: any, face: 0 | 1): ImageRef | null =>
    uris && typeof uris.display === 'string' && typeof uris.grid === 'string'
      ? { face, display: uris.display, grid: uris.grid }
      : null;
  const root = pick(scryfall?.image_uris, 0);
  if (root) return [root];
  const faces: any[] = Array.isArray(scryfall?.card_faces) ? scryfall.card_faces : [];
  return faces
    .slice(0, 2)
    .map((f, i) => pick(f?.image_uris, i as 0 | 1))
    .filter((r): r is ImageRef => r !== null);
}

/** Names that appear as `meld_result` in any card's `all_parts`. */
export function meldResultNames(scryfallCards: Iterable<any>): Set<string> {
  const names = new Set<string>();
  for (const c of scryfallCards) {
    if (!Array.isArray(c?.all_parts)) continue;
    for (const part of c.all_parts) {
      if (part?.component === 'meld_result' && typeof part.name === 'string') names.add(part.name);
    }
  }
  return names;
}

export type Log = (line: string) => void;

export async function syncCards(db: Db, log: Log): Promise<void> {
  const { url, updatedAt } = await resolveBulk('oracle_cards');
  const file = path.join(DATA_DIR, 'raw', 'oracle-cards.jsonl.gz');
  log(`cards downloading ${url}`);
  const bytes = await downloadToFile(url, file);
  log(`cards downloaded ${bytes} bytes`);

  const kept: { card: Card; images: ImageRef[]; imageUpdatedAt: string | null }[] = [];
  const meldNames = new Set<string>();
  let lines = 0;
  for await (const raw of readJsonLines<any>(file)) {
    lines++;
    for (const n of meldResultNames([raw])) meldNames.add(n);
    const card = toCard(raw);
    if (card) kept.push({ card, images: imageRefs(raw), imageUpdatedAt: strOrNull(raw.image_updated_at) });
    if (lines % 5000 === 0) log(`cards read ${lines}`);
  }
  if (kept.length < 20_000) throw new Error(`cards: only ${kept.length} Commander cards in ${lines} lines; refusing to replace the table`);

  let meld = 0;
  for (const k of kept) {
    if (k.card.layout === 'meld' && meldNames.has(k.card.name)) {
      k.card.isMeldResult = true;
      meld++;
    }
  }

  const upsertCard = db.prepare(
    'INSERT INTO cards(oracle_id, name, front_name, json) VALUES (?, ?, ?, ?) ' +
      'ON CONFLICT(oracle_id) DO UPDATE SET name = excluded.name, front_name = excluded.front_name, json = excluded.json',
  );
  const upsertImage = db.prepare(
    'INSERT INTO card_images(oracle_id, face, display_url, grid_url, image_updated_at) VALUES (?, ?, ?, ?, ?) ' +
      'ON CONFLICT(oracle_id, face) DO UPDATE SET display_url = excluded.display_url, grid_url = excluded.grid_url, ' +
      'image_updated_at = excluded.image_updated_at',
  );
  const total = kept.length;
  db.transaction(() => {
    db.exec('CREATE TEMP TABLE IF NOT EXISTS seen_cards(oracle_id TEXT PRIMARY KEY); DELETE FROM seen_cards;');
    const seen = db.prepare('INSERT OR IGNORE INTO seen_cards(oracle_id) VALUES (?)');
    let done = 0;
    for (const { card, images, imageUpdatedAt } of kept) {
      upsertCard.run(card.oracleId, card.name, card.frontName, JSON.stringify(card));
      seen.run(card.oracleId);
      for (const img of images) upsertImage.run(card.oracleId, img.face, img.display, img.grid, imageUpdatedAt);
      if (++done % 5000 === 0 || done === total) log(`cards ${done}/${total}`);
    }
    db.exec(
      'DELETE FROM cards WHERE oracle_id NOT IN (SELECT oracle_id FROM seen_cards);' +
        'DELETE FROM card_images WHERE oracle_id NOT IN (SELECT oracle_id FROM seen_cards);' +
        'DROP TABLE seen_cards;',
    );
  })();

  const legal = kept.filter((k) => k.card.legality === 'legal').length;
  const info = {
    sourceUpdatedAt: updatedAt,
    lines,
    cards: total,
    legal,
    banned: total - legal,
    meldResults: meld,
    gameChangers: kept.filter((k) => k.card.gameChanger).length,
    withoutImages: kept.filter((k) => k.images.length === 0).length,
  };
  writeSyncState(db, 'cards', info);
  log(`cards finished ${JSON.stringify(info)}`);
}
