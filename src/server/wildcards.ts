import type { WildcardsInfo } from '@/app/lib/api';
import type { Wildcards } from '@/engine/types';
import { RARITIES, ZERO_WILDCARDS } from '@/engine/wildcards';
import { ARENA_COLLECTION } from './db';
import { HttpError, isObject } from './http';
import { getDb } from './store';

/** Most wildcards of one rarity a hand edit accepts. */
export const MAX_WILDCARDS = 9999;

const key = (collectionId: string) => `wildcards:${collectionId}`;

/** The wildcards stored on a collection (the MTG Arena one unless named); all 0 until read or typed in. */
export function getWildcards(collectionId: string = ARENA_COLLECTION): WildcardsInfo {
  const row = getDb().prepare('SELECT json FROM settings WHERE key = ?').get(key(collectionId)) as { json: string } | undefined;
  if (row) {
    try {
      const v = JSON.parse(row.json) as Partial<WildcardsInfo>;
      const wildcards = { ...ZERO_WILDCARDS };
      for (const r of RARITIES) {
        const n = v.wildcards?.[r];
        if (typeof n === 'number' && Number.isInteger(n) && n >= 0) wildcards[r] = Math.min(MAX_WILDCARDS, n);
      }
      return {
        wildcards,
        readAt: typeof v.readAt === 'string' ? v.readAt : null,
        source: v.source === 'log' || v.source === 'hand' ? v.source : null,
      };
    } catch {
      // a damaged row reads as none
    }
  }
  return { wildcards: { ...ZERO_WILDCARDS }, readAt: null, source: null };
}

/** Stores a collection's wildcards with when and where they came from ('log': Arena's Player.log, 'hand': typed in). */
export function setWildcards(
  wildcards: Wildcards, source: 'log' | 'hand', at: string = new Date().toISOString(), collectionId: string = ARENA_COLLECTION,
): WildcardsInfo {
  const info: WildcardsInfo = { wildcards: { ...wildcards }, readAt: at, source };
  getDb()
    .prepare('INSERT INTO settings(key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json')
    .run(key(collectionId), JSON.stringify(info));
  return info;
}

/** The four counts of a PUT body: each a whole number from 0 to 9999, or a 400. */
export function readWildcardsBody(body: unknown): Wildcards {
  if (!isObject(body)) throw new HttpError(400, 'The body must be { common, uncommon, rare, mythic }.');
  const out = { ...ZERO_WILDCARDS };
  for (const r of RARITIES) {
    const n = body[r];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > MAX_WILDCARDS) {
      throw new HttpError(400, `${r} must be a whole number from 0 to ${MAX_WILDCARDS}.`);
    }
    out[r] = n;
  }
  return out;
}
