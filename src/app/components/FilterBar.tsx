'use client';

import type { Bracket } from '@/engine/types';
import { BUDGETS, setFilters, useFilters, type FilterKey, type FilterValues, type TileSize, type ViewMode } from '../lib/filters';
import { BRACKETS } from '../lib/ui';
import { useFreeOnly } from './held';

export interface FilterOption { id: string; label: string; title?: string }

const SIZES: { id: TileSize; label: string }[] = [
  { id: 'S', label: 'Small' },
  { id: 'M', label: 'Medium' },
  { id: 'L', label: 'Large' },
];
const VIEWS: { id: ViewMode; label: string; title: string }[] = [
  { id: 'grid', label: 'Images', title: 'Show the cards as images' },
  { id: 'list', label: 'List', title: 'Show the cards as a compact list' },
];

/** `value` when it is one of `options`, else the first option (a value stored by another page). */
export const pickOption = (value: string, options: readonly FilterOption[]): string =>
  options.some((o) => o.id === value) ? value : (options[0]?.id ?? '');

/**
 * The shared filters and view controls, any subset of them, in the order given. Values come from
 * the shared store (they carry to every page) unless the page owns one: a deck page passes its own
 * bracket in `own` and gets the change through `onOwn`.
 */
export function FilterBar({
  show, own, onOwn, groups = [], sorts = [], collectionName, testId = 'filter-bar', className = '',
}: {
  show: readonly FilterKey[];
  own?: Partial<FilterValues>;
  onOwn?: (patch: Partial<FilterValues>) => void;
  groups?: readonly FilterOption[];
  sorts?: readonly FilterOption[];
  /** "Only my Physical collection". */
  collectionName?: string | null;
  testId?: string;
  className?: string;
}) {
  const store = useFilters();
  const [freeOnly, setFreeOnly] = useFreeOnly();
  const value = <K extends FilterKey>(k: K): FilterValues[K] => (own && k in own ? (own[k] as FilterValues[K]) : store[k]);
  const change = (patch: Partial<FilterValues>) => {
    const k = Object.keys(patch)[0] as FilterKey;
    if (own && k in own) onOwn?.(patch);
    else if (k === 'freeOnly') setFreeOnly(!!patch.freeOnly);
    else setFilters(patch);
  };
  const ownedOnly = value('ownedOnly');
  const free = own && 'freeOnly' in own ? !!own.freeOnly : (freeOnly ?? false);

  const control = (k: FilterKey) => {
    switch (k) {
      case 'bracket':
        return (
          <div key={k} className="flex items-center gap-1.5">
            <span className="text-ash">Bracket</span>
            <div className="seg" role="group" aria-label="Bracket">
              {BRACKETS.map((b) => (
                <button key={b.n} type="button" aria-pressed={value('bracket') === b.n} title={`${b.name}. ${b.blurb}`} onClick={() => change({ bracket: b.n as Bracket })} data-testid={`filter-bracket-${b.n}`}>
                  {b.n}
                </button>
              ))}
            </div>
          </div>
        );
      case 'budget':
        return (
          <div key={k} className="seg" role="group" aria-label="Budget per card">
            {BUDGETS.map((b) => (
              <button key={b.id} type="button" aria-pressed={value('budget') === b.id} onClick={() => change({ budget: b.id })} data-testid={`filter-budget-${b.id}`}>
                {b.label}
              </button>
            ))}
          </div>
        );
      case 'ownedOnly':
        return (
          <label key={k} className="flex cursor-pointer items-center gap-1.5 text-ash" title="Builds and suggestions use only cards from the collection picked in the top bar. Basic lands are always allowed.">
            <input type="checkbox" checked={ownedOnly} onChange={(e) => change({ ownedOnly: e.target.checked })} data-testid="filter-owned-only" />
            <span>Only my {collectionName ? `${collectionName} ` : ''}collection</span>
          </label>
        );
      case 'freeOnly':
        return (
          <label
            key={k}
            className={`flex items-center gap-1.5 ${ownedOnly ? 'cursor-pointer text-ash' : 'text-smoke'}`}
            title={ownedOnly ? 'Leave out copies sealed in a box or in another built deck' : 'Tick “Only my collection” first'}
          >
            <input type="checkbox" checked={free} disabled={!ownedOnly} onChange={(e) => change({ freeOnly: e.target.checked })} data-testid="filter-free-only" />
            <span>Use free copies only</span>
          </label>
        );
      case 'size':
        return (
          <div key={k} className="seg" role="group" aria-label="Card size">
            {SIZES.map((s) => (
              <button key={s.id} type="button" aria-pressed={value('size') === s.id} onClick={() => change({ size: s.id })} data-testid={`size-${s.id}`}>
                {s.label}
              </button>
            ))}
          </div>
        );
      case 'view':
        return (
          <div key={k} className="seg" role="group" aria-label="Show the cards as">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" aria-pressed={value('view') === v.id} title={v.title} onClick={() => change({ view: v.id })} data-testid={`layout-${v.id}`}>
                {v.label}
              </button>
            ))}
          </div>
        );
      case 'groupBy': {
        if (groups.length === 0) return null;
        const g = pickOption(value('groupBy'), groups);
        return (
          <div key={k} className="seg" role="group" aria-label="Group cards by">
            {groups.map((o) => (
              <button key={o.id} type="button" aria-pressed={g === o.id} title={o.title} onClick={() => change({ groupBy: o.id })} data-testid={`group-${o.id}`}>
                {o.label}
              </button>
            ))}
          </div>
        );
      }
      case 'sort': {
        if (sorts.length === 0) return null;
        return (
          <select key={k} className="field h-7 text-[13px]" value={pickOption(value('sort'), sorts)} onChange={(e) => change({ sort: e.target.value })} aria-label="Sort cards" data-testid="filter-sort">
            {sorts.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        );
      }
    }
  };

  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px] ${className}`} data-testid={testId}>
      {show.map(control)}
    </div>
  );
}
