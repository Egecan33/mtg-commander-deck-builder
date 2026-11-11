import type { Db } from './db';

/**
 * Process-wide server state. It hangs off `globalThis` because Next may bundle route handlers
 * separately: a plain module variable could then exist once per route, and the 32k-card CardDb
 * and the scored pools would be loaded several times.
 */
export interface ServerState {
  db: Db | null;
  /** Bumped whenever cached data must be dropped (new database, sync finished). */
  generation: number;
  /** Named caches; each server module owns its keys. Cleared by `resetServerState`. */
  caches: Map<string, unknown>;
}

const KEY = '__commanderForgeState';
const holder = globalThis as unknown as Record<string, ServerState | undefined>;

export function serverState(): ServerState {
  return (holder[KEY] ??= { db: null, generation: 0, caches: new Map() });
}

/** A cache slot that lives until the next `resetServerState` / `dropCaches`. */
export function cacheSlot<T>(name: string, make: () => T): T {
  const s = serverState();
  if (!s.caches.has(name)) s.caches.set(name, make());
  return s.caches.get(name) as T;
}

/** Drops every in-memory cache (CardDb, scored pools, settings, collection). The database stays open. */
export function dropCaches(): void {
  const s = serverState();
  s.caches.clear();
  s.generation++;
}

/** Tests: use this database handle (or none) and forget everything cached. */
export function resetServerState(db: Db | null = null): void {
  const s = serverState();
  s.db = db;
  dropCaches();
}
