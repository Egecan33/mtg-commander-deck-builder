import type { Settings } from '@/app/lib/api';
import { HttpError, isObject } from './http';
import { cacheSlot, serverState } from './state';
import { getDb } from './store';

export type { Settings };

export const DEFAULT_SETTINGS: Readonly<Settings> = { edhrecEnabled: false, mldOverrides: {}, extraTurnOverrides: {} };

const KEYS = ['edhrecEnabled', 'mldOverrides', 'extraTurnOverrides'] as const;

function boolMap(value: unknown, key: string): Record<string, boolean> {
  if (!isObject(value)) throw new HttpError(400, `${key} must be an object of oracle id -> true/false.`);
  const out: Record<string, boolean> = {};
  for (const [id, v] of Object.entries(value)) {
    if (typeof v !== 'boolean') throw new HttpError(400, `${key}.${id} must be true or false.`);
    out[id] = v;
  }
  return out;
}

function check(key: (typeof KEYS)[number], value: unknown): Settings[typeof key] {
  if (key === 'edhrecEnabled') {
    if (typeof value !== 'boolean') throw new HttpError(400, 'edhrecEnabled must be true or false.');
    return value;
  }
  return boolMap(value, key);
}

/**
 * The saved settings over the defaults. The returned object and its override maps keep their
 * identity until `updateSettings`, so engine caches keyed on them stay valid.
 */
export function getSettings(): Settings {
  return cacheSlot('settings', () => {
    const out: Settings = { ...DEFAULT_SETTINGS, mldOverrides: {}, extraTurnOverrides: {} };
    const rows = getDb().prepare('SELECT key, json FROM settings').all() as { key: string; json: string }[];
    for (const row of rows) {
      const key = KEYS.find((k) => k === row.key);
      if (!key) continue;
      try {
        (out as unknown as Record<string, unknown>)[key] = check(key, JSON.parse(row.json));
      } catch {
        // a damaged row falls back to the default
      }
    }
    return out;
  });
}

/** Merges the given keys into the saved settings. Unknown keys and wrong types are a 400. */
export function updateSettings(patch: Record<string, unknown>): Settings {
  const next: Settings = { ...getSettings() };
  const changed: (typeof KEYS)[number][] = [];
  for (const [k, v] of Object.entries(patch)) {
    const key = KEYS.find((x) => x === k);
    if (!key) throw new HttpError(400, `Unknown setting "${k}".`);
    (next as unknown as Record<string, unknown>)[key] = check(key, v);
    changed.push(key);
  }
  const db = getDb();
  const put = db.prepare('INSERT INTO settings(key, json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json');
  db.transaction(() => {
    for (const key of changed) put.run(key, JSON.stringify(next[key]));
  })();
  serverState().caches.delete('settings');
  serverState().caches.delete('deck-tiles');
  return getSettings();
}
