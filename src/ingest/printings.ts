import path from 'node:path';
import { DATA_DIR, writeSyncState, type Db } from '@/server/db';
import type { Log } from './cards';
import { downloadToFile, readJsonLines, resolveBulk } from './http';

/* Scryfall objects are external JSON; they are read defensively through `any`. */
/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Fills `printings(set_code, collector_number, oracle_id)` from Scryfall's `default_cards` bulk
 * file: one row per paper printing, set code lower-cased, collector number as printed ("123",
 * "123a", "45★"). It is what lets a card be added to the collection by the code at its bottom.
 */
export async function syncPrintings(db: Db, log: Log): Promise<void> {
  const { url, updatedAt } = await resolveBulk('default_cards');
  const file = path.join(DATA_DIR, 'raw', 'default-cards.jsonl.gz');
  log(`printings downloading ${url}`);
  const bytes = await downloadToFile(url, file);
  log(`printings downloaded ${bytes} bytes`);

  const rows: [string, string, string][] = [];
  let lines = 0;
  for await (const raw of readJsonLines<any>(file)) {
    lines++;
    if (lines % 20000 === 0) log(`printings read ${lines}`);
    if (raw?.digital === true || (Array.isArray(raw?.games) && !raw.games.includes('paper'))) continue;
    const oracleId = typeof raw?.oracle_id === 'string' ? raw.oracle_id : raw?.card_faces?.[0]?.oracle_id;
    if (typeof oracleId !== 'string' || typeof raw.set !== 'string' || typeof raw.collector_number !== 'string') continue;
    rows.push([raw.set.toLowerCase(), raw.collector_number, oracleId]);
  }
  if (rows.length < 50_000) throw new Error(`printings: only ${rows.length} paper printings in ${lines} lines; refusing to replace the table`);

  db.transaction(() => {
    db.exec('DELETE FROM printings');
    const ins = db.prepare('INSERT OR IGNORE INTO printings(set_code, collector_number, oracle_id) VALUES (?, ?, ?)');
    for (const r of rows) ins.run(...r);
  })();
  const stored = (db.prepare('SELECT COUNT(*) AS n FROM printings').get() as { n: number }).n;
  const info = { sourceUpdatedAt: updatedAt, lines, printings: stored };
  writeSyncState(db, 'printings', info);
  log(`printings finished ${JSON.stringify(info)}`);
}
