'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { ColorChips } from '../components/ColorChips';
import { CommanderTileView } from '../components/CommanderTileView';
import { EmptyState } from '../components/EmptyState';
import { useFreeOnly } from '../components/held';
import { useBuildFormat, useNotify } from '../components/Shell';
import { VirtualGrid, usePaged } from '../components/VirtualGrid';
import { getCommanders, getThemes, type ColorLetter, type ColorMode, type CommanderSort, type CommanderTile, type ThemeInfo } from '../lib/api';
import { setFilters, useFilters } from '../lib/filters';
import { axisLabel, fmtInt } from '../lib/ui';

const PAGE = 120;
const SORTS: { id: CommanderSort; label: string }[] = [
  { id: 'popularity', label: 'Most played' }, { id: 'name', label: 'Name' }, { id: 'price', label: 'Price' }, { id: 'best', label: 'Best deck from my collection' },
];

export default function CommandersPage() {
  const notify = useNotify();
  const { bracket, ownedOnly } = useFilters();
  const buildFormat = useBuildFormat();
  const [freeOnly] = useFreeOnly();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [colors, setColors] = useState<ColorLetter[]>([]);
  const [mode, setMode] = useState<ColorMode>('includes');
  const [axis, setAxis] = useState('');
  const [sort, setSort] = useState<CommanderSort>('popularity');
  const [themes, setThemes] = useState<ThemeInfo[]>([]);
  const [bestReady, setBestReady] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    getThemes().then((r) => setThemes(r.themes), notify.error);
  }, [notify.error]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === '/' && !(el && /INPUT|TEXTAREA|SELECT/.test(el.tagName))) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // The grid cannot be sorted by best deck until Best from collection has run: do not keep that choice selected.
  useEffect(() => {
    if (!bestReady) setSort((s) => (s === 'best' ? 'popularity' : s));
  }, [bestReady]);

  const free = freeOnly === true;
  const key = JSON.stringify([query, colors, mode, axis, ownedOnly, sort, bracket, free, buildFormat]);
  const paged = usePaged<CommanderTile>(
    key,
    PAGE,
    async (page, signal) => {
      const res = await getCommanders(
        { q: query || undefined, colors: colors.length ? colors : undefined, mode, page, pageSize: PAGE, axis: axis || undefined, ownedOnly, sort, bracket, freeOnly: free, arenaFormat: buildFormat ?? undefined },
        signal,
      );
      setBestReady(res.bestReady);
      return { total: res.total, items: res.commanders };
    },
    notify.error,
  );
  const clear = () => { setQ(''); setQuery(''); setColors([]); setMode('includes'); setAxis(''); setFilters({ ownedOnly: false }); setSort('popularity'); };

  return (
    <div className="flex h-full flex-col">
      <div className="px-6 pb-3 pt-6">
        <div className="flex items-end gap-4">
          <div>
            <h1 className="text-[2rem] leading-none">Commanders</h1>
            <p className="mt-2 text-ash" data-testid="commanders-total">
              {paged.total === null ? 'Loading commanders' : paged.total === 1 ? '1 commander matches.' : `${fmtInt(paged.total)} commanders.`}
            </p>
          </div>
          <Link href="/themes" className="btn ml-auto" data-testid="browse-themes">Browse by theme</Link>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <input
            ref={search}
            className="field w-[20rem]"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name   ( / )"
            aria-label="Search commanders by name"
            data-testid="commanders-search"
          />
          <ColorChips colors={colors} mode={mode} onColors={setColors} onMode={setMode} />
          <select className="field" value={axis} onChange={(e) => setAxis(e.target.value)} aria-label="Theme" data-testid="commanders-theme">
            <option value="">Any theme</option>
            {themes.filter((t) => t.commanders > 0).map((t) => <option key={t.axis} value={t.axis}>{t.label} · {t.commanders}</option>)}
          </select>
          <label className="flex items-center gap-1.5 text-ash">
            <input type="checkbox" checked={ownedOnly} onChange={(e) => setFilters({ ownedOnly: e.target.checked })} data-testid="commanders-owned" />
            In my collection
          </label>
          <label className="flex items-center gap-1.5 text-ash">
            Sort
            <select className="field" value={sort} onChange={(e) => setSort(e.target.value as CommanderSort)} data-testid="commanders-sort">
              {SORTS.map((s) => (
                <option key={s.id} value={s.id} disabled={s.id === 'best' && !bestReady} title={s.id === 'best' && !bestReady ? 'Run Best from collection first' : undefined}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>
      <div className="min-h-0 flex-1 px-3">
        <VirtualGrid
          count={paged.total ?? 60}
          itemAt={paged.itemAt}
          ensure={paged.ensure}
          keyOf={(c) => c.oracleId}
          minTile={190}
          gap={14}
          extra={24}
          resetKey={key}
          testId="commanders-grid"
          render={(c) => (
            <CommanderTileView
              commander={c}
              fill
              caption={sort === 'best' && c.best !== undefined ? `Best deck ${c.best}` : `${c.lead[0] ? axisLabel(c.lead[0]) : 'No named theme'}${c.rank ? ` · #${fmtInt(c.rank)}` : ''}`}
              captionTitle="Forge: its strongest theme. Scryfall: popularity rank"
            />
          )}
          empty={<EmptyState className="m-3" title="No commander matches." message="Nothing fits these filters." action={<button type="button" className="btn btn-sm" onClick={clear}>Clear the filters</button>} />}
        />
      </div>
    </div>
  );
}
