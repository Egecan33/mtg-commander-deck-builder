import { readdirSync } from 'node:fs';
import path from 'node:path';
import type { StatusResponse, SyncStep } from '@/app/lib/api';
import { DEFAULT_SETTINGS, getSettings } from './settings';
import { cacheSlot } from './state';
import { dbPath, getDb, imageDir } from './store';
import { SYNC_STEPS, syncState } from './sync-runner';

export const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Counts are re-read at most this often; a running sync changes them under us. */
const COUNT_TTL_MS = 5000;

function countImages(size: string): number {
  try {
    let n = 0;
    for (const name of readdirSync(path.join(imageDir(), size))) if (name.endsWith('.webp')) n++;
    return n;
  } catch {
    return 0; // no directory yet
  }
}

const emptyCounts = (): StatusResponse['counts'] => ({
  cards: 0, legal: 0, banned: 0, gameChangers: 0, features: 0, tags: 0, combos: 0,
  images: { display: 0, grid: 0 }, collection: 0, decks: 0,
});

function readCounts(): StatusResponse['counts'] {
  const slot = cacheSlot<{ at: number; counts: StatusResponse['counts'] | null }>('status-counts', () => ({ at: 0, counts: null }));
  if (slot.counts && Date.now() - slot.at < COUNT_TTL_MS) {
    // Decks and the collection change through this server, so they are always read fresh.
    return { ...slot.counts, ...smallCounts() };
  }
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const cards = db
    .prepare(
      "SELECT count(*) AS cards, " +
        "coalesce(sum(json_extract(json, '$.legality') = 'legal'), 0) AS legal, " +
        "coalesce(sum(json_extract(json, '$.legality') = 'banned'), 0) AS banned, " +
        "coalesce(sum(json_extract(json, '$.gameChanger') = 1), 0) AS gameChangers FROM cards",
    )
    .get() as { cards: number; legal: number; banned: number; gameChangers: number };
  slot.counts = {
    ...cards,
    features: one('SELECT count(*) AS n FROM card_features'),
    tags: one('SELECT count(*) AS n FROM tags'),
    combos: one('SELECT count(*) AS n FROM combos'),
    images: { display: countImages('display'), grid: countImages('grid') },
    ...smallCounts(),
  };
  slot.at = Date.now();
  return slot.counts;
}

function smallCounts(): { collection: number; decks: number } {
  const db = getDb();
  const one = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  return { collection: one('SELECT count(*) AS n FROM collection'), decks: one('SELECT count(*) AS n FROM decks') };
}

/** The Data page's facts. Never throws: a database that cannot be opened is reported in `error`. */
export function getStatus(): StatusResponse {
  const steps = Object.fromEntries(SYNC_STEPS.map((s) => [s, null])) as StatusResponse['steps'];
  const base: StatusResponse = {
    ready: false, error: null, dbPath: dbPath(), steps, counts: emptyCounts(), cardsSyncedAt: null, stale: true,
    settings: { ...DEFAULT_SETTINGS }, sync: syncState(),
  };
  try {
    const db = getDb();
    const rows = db.prepare('SELECT step, finished_at AS finishedAt, info FROM sync_state').all() as { step: string; finishedAt: string; info: string }[];
    for (const row of rows) {
      if (!SYNC_STEPS.includes(row.step as SyncStep)) continue;
      let info: Record<string, unknown> = {};
      try {
        const parsed: unknown = JSON.parse(row.info);
        if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) info = parsed as Record<string, unknown>;
      } catch {
        // unreadable info is shown as none
      }
      steps[row.step as SyncStep] = { finishedAt: row.finishedAt, info };
    }
    base.counts = readCounts();
    base.settings = getSettings();
    base.cardsSyncedAt = steps.cards?.finishedAt ?? null;
    const age = base.cardsSyncedAt ? Date.now() - Date.parse(base.cardsSyncedAt) : Number.POSITIVE_INFINITY;
    base.stale = !(age < STALE_AFTER_MS);
    base.ready = base.counts.legal > 0 && base.counts.features > 0;
  } catch (err) {
    base.error = err instanceof Error ? err.message : String(err);
  }
  return base;
}
