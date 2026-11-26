import { useSyncExternalStore } from 'react';
import type { Bracket } from '@/engine/types';

/*
 * The shared filters: one store for every page, kept in localStorage so a choice made on one page
 * carries to the next (and to the next visit). `cf-owned-only` and `cf-free-only` predate this
 * store; their stored values are read as they are, never reset.
 */

export type Budget = 'any' | 'under-5' | 'under-1';
export type TileSize = 'S' | 'M' | 'L';
export type ViewMode = 'grid' | 'list';

export interface Filters {
  bracket: Bracket;
  budget: Budget;
  /** Only my collection. */
  ownedOnly: boolean;
  /** Use free copies only. `null`: never chosen, so the page uses its own default (on when the collection has boxes or built decks). */
  freeOnly: boolean | null;
  size: TileSize;
  view: ViewMode;
  /** A page's grouping id ("role", "type", ...). Pages check it against their own options. */
  groupBy: string;
  /** A page's sort id. Pages check it against their own options. */
  sort: string;
  /** False until the browser's storage has been read (the server render and the first hydration pass). */
  ready: boolean;
}
export type FilterValues = Omit<Filters, 'ready'>;
export type FilterKey = keyof FilterValues;

export const FILTER_STORAGE_KEYS: Record<FilterKey, string> = {
  bracket: 'cf-bracket',
  budget: 'cf-budget',
  ownedOnly: 'cf-owned-only',
  freeOnly: 'cf-free-only',
  size: 'cf-view-size',
  view: 'cf-view-mode',
  groupBy: 'cf-view-group',
  sort: 'cf-view-sort',
};

export const DEFAULT_FILTERS: Filters = {
  bracket: 3, budget: 'any', ownedOnly: false, freeOnly: null, size: 'M', view: 'grid', groupBy: '', sort: '', ready: false,
};

export const BUDGETS: { id: Budget; label: string; maxUsd: number | null }[] = [
  { id: 'any', label: 'Any price', maxUsd: null },
  { id: 'under-5', label: 'Under $5', maxUsd: 5 },
  { id: 'under-1', label: 'Under $1', maxUsd: 1 },
];
/** Highest price per card the budget allows, or null for any price. */
export const budgetMax = (b: Budget): number | null => BUDGETS.find((x) => x.id === b)?.maxUsd ?? null;

const flag = (v: string | null): boolean | null => (v === '1' ? true : v === '0' ? false : null);

/** The filters as stored. Unknown or missing values fall back to the defaults. */
export function readFilters(storage: Pick<Storage, 'getItem'> | null): Filters {
  const get = (k: FilterKey): string | null => {
    try {
      return storage?.getItem(FILTER_STORAGE_KEYS[k]) ?? null;
    } catch {
      return null;
    }
  };
  const bracket = Number(get('bracket'));
  const budget = get('budget');
  const size = get('size');
  const view = get('view');
  return {
    bracket: Number.isInteger(bracket) && bracket >= 1 && bracket <= 5 ? (bracket as Bracket) : DEFAULT_FILTERS.bracket,
    budget: BUDGETS.some((b) => b.id === budget) ? (budget as Budget) : DEFAULT_FILTERS.budget,
    ownedOnly: flag(get('ownedOnly')) ?? DEFAULT_FILTERS.ownedOnly,
    freeOnly: flag(get('freeOnly')),
    size: size === 'S' || size === 'M' || size === 'L' ? size : DEFAULT_FILTERS.size,
    view: view === 'grid' || view === 'list' ? view : DEFAULT_FILTERS.view,
    groupBy: get('groupBy') ?? DEFAULT_FILTERS.groupBy,
    sort: get('sort') ?? DEFAULT_FILTERS.sort,
    ready: true,
  };
}

const encode = (k: FilterKey, v: FilterValues[FilterKey]): string | null => {
  if (typeof v === 'boolean') return v ? '1' : '0';
  if (v === null) return null;
  return k === 'bracket' ? String(v) : (v as string);
};

// ---- the store

let current: Filters | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function snapshot(): Filters {
  if (!current) current = readFilters(storage());
  return current;
}

/** Another tab changed a filter. */
function onStorage(e: StorageEvent): void {
  if (e.key === null || Object.values(FILTER_STORAGE_KEYS).includes(e.key)) {
    current = null;
    notify();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

/** Changes some filters for every page. A `freeOnly` of null forgets the choice. */
export function setFilters(patch: Partial<FilterValues>): void {
  const store = storage();
  for (const [k, v] of Object.entries(patch) as [FilterKey, FilterValues[FilterKey]][]) {
    const value = encode(k, v);
    try {
      if (value === null) store?.removeItem(FILTER_STORAGE_KEYS[k]);
      else store?.setItem(FILTER_STORAGE_KEYS[k], value);
    } catch {
      // storage is off: the choice holds until the page is closed
    }
  }
  current = { ...snapshot(), ...patch, ready: true };
  notify();
}

/** The shared filters and `set` to change them. */
export function useFilters(): Filters & { set: typeof setFilters } {
  const f = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_FILTERS);
  return { ...f, set: setFilters };
}
