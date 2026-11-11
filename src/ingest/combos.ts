import { statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import parser from 'stream-json';
import { pick } from 'stream-json/filters/pick.js';
import { streamArray } from 'stream-json/streamers/stream-array.js';
import type { Combo } from '@/engine/types';
import { DATA_DIR, writeSyncState, type Db } from '@/server/db';
import type { Log } from './cards';
import { downloadToFile, openMaybeGzip } from './http';

/* eslint-disable @typescript-eslint/no-explicit-any */

export const VARIANTS_URL = 'https://json.commanderspellbook.com/variants.json.gz';
const TAGS = new Set(['R', 'S', 'P', 'O', 'C', 'E']);

/**
 * Maps a Spellbook variant to a Combo. Null unless it is status OK, Commander-legal, not tagged
 * Banned, and every used card has an oracle id.
 */
export function toCombo(v: any): Combo | null {
  if (v?.status !== 'OK' || v.legalities?.commander !== true) return null;
  if (typeof v.id !== 'string' || !TAGS.has(v.bracketTag)) return null;
  if (!Array.isArray(v.uses) || v.uses.length === 0) return null;
  const cards: Combo['cards'] = [];
  for (const use of v.uses) {
    const oracleId = use?.card?.oracleId;
    if (typeof oracleId !== 'string' || oracleId === '') return null;
    cards.push({ oracleId, mustBeCommander: use.mustBeCommander === true });
  }
  const requires: any[] = Array.isArray(v.requires) ? v.requires : [];
  return {
    id: v.id,
    cards,
    requiresCount: requires.reduce((n, r) => n + (typeof r?.quantity === 'number' && r.quantity > 0 ? r.quantity : 1), 0),
    bracketTag: v.bracketTag,
    manaValueNeeded: typeof v.manaValueNeeded === 'number' ? v.manaValueNeeded : 0,
    produces: (Array.isArray(v.produces) ? v.produces : [])
      .map((p: any) => p?.feature?.name)
      .filter((n: unknown): n is string => typeof n === 'string'),
    popularity: typeof v.popularity === 'number' ? v.popularity : 0,
  };
}

/** Streams the elements of the top-level `variants` array without ever holding the whole document. */
export function streamVariants(input: Readable): AsyncIterable<{ key: number; value: any }> {
  const out = input
    .pipe(parser())
    .pipe(pick.asStream({ filter: 'variants' }))
    .pipe(streamArray.asStream());
  input.on('error', (err) => out.destroy(err));
  return out as AsyncIterable<{ key: number; value: any }>;
}

export async function syncCombos(db: Db, log: Log, opts: { keepRaw?: boolean } = {}): Promise<void> {
  const file = path.join(DATA_DIR, 'raw', 'spellbook-variants.json');
  log(`combos downloading ${VARIANTS_URL}`);
  const bytes = await downloadToFile(VARIANTS_URL, file);
  log(`combos downloaded ${bytes} bytes`);

  const known = new Set(
    (db.prepare('SELECT oracle_id FROM cards').all() as { oracle_id: string }[]).map((r) => r.oracle_id),
  );
  const input = await openMaybeGzip(file);
  let read = 0;
  input.on('data', (chunk: Buffer) => (read += chunk.length));
  const fileSize = statSync(file).size;
  const gz = read === 0 && fileSize < 200_000_000; // gunzipped bytes outgrow the file; only used for the estimate
  const expectedBytes = gz ? fileSize * 22.7 : fileSize;

  let seen = 0;
  let kept = 0;
  let links = 0;
  let withUnknownCard = 0;
  const byTag: Record<string, number> = {};
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM combo_cards; DELETE FROM combos;');
    const insCombo = db.prepare('INSERT OR REPLACE INTO combos(id, json) VALUES (?, ?)');
    const insLink = db.prepare('INSERT OR IGNORE INTO combo_cards(combo_id, oracle_id) VALUES (?, ?)');
    for await (const { value } of streamVariants(input)) {
      seen++;
      const combo = toCombo(value);
      if (combo) {
        insCombo.run(combo.id, JSON.stringify(combo));
        for (const c of combo.cards) links += insLink.run(combo.id, c.oracleId).changes;
        if (combo.cards.some((c) => !known.has(c.oracleId))) withUnknownCard++;
        byTag[combo.bracketTag] = (byTag[combo.bracketTag] ?? 0) + 1;
        kept++;
      }
      if (seen % 10_000 === 0) {
        const estimate = Math.max(seen, Math.round(seen / Math.min(1, read / expectedBytes)));
        log(`combos ${seen}/${estimate}`);
      }
    }
    if (kept < 10_000) throw new Error(`combos: only ${kept} of ${seen} variants kept; refusing to replace the table`);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  log(`combos ${seen}/${seen}`);

  if (!opts.keepRaw) await rm(file, { force: true });
  const info = { variants: seen, combos: kept, comboCards: links, withUnknownCard, byTag };
  writeSyncState(db, 'combos', info);
  log(`combos finished ${JSON.stringify(info)}`);
}
