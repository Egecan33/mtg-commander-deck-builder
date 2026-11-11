'use client';

import { useEffect, useMemo, useState, type RefObject } from 'react';
import type { Deck } from '@/engine/types';
import { CardImage, ColorPip, ScoreBadge } from '../../components/card';
import { useNotify } from '../../components/Shell';
import { VirtualGrid, usePaged } from '../../components/VirtualGrid';
import { browseCards, type CardSort, type ScoredCard } from '../../lib/api';
import {
  AXIS_IDS, COLOR_NAME, COLOR_ORDER, DEFAULT_QUERY, ROLES, ROLE_LABEL, activeFilterCount, axisLabel, entryOf, fmtInt, toFilters, type BrowserQuery,
} from '../../lib/ui';

const PAGE = 120;
const SORTS: { id: CardSort; label: string }[] = [
  { id: 'score', label: 'Best for this deck' },
  { id: 'popularity', label: 'Most played' },
  { id: 'name', label: 'Name' },
  { id: 'mv', label: 'Mana value' },
  { id: 'price', label: 'Price' },
];

/**
 * The whole legal card pool, scored for this deck, as a wall of card images. `settled` is the deck
 * as last sent for analysis (so scores match the rating); `deck` is the live one, used only to mark
 * what is already in.
 */
export function Browser({
  deck, settled, rev, query, setQuery, extraAxes, onAdd, onRemove, onOpen, searchRef,
}: {
  deck: Deck;
  settled: Deck;
  rev: number;
  query: BrowserQuery;
  setQuery: (next: BrowserQuery | ((q: BrowserQuery) => BrowserQuery)) => void;
  extraAxes: string[];
  onAdd: (card: ScoredCard) => void;
  onRemove: (id: string) => void;
  onOpen: (card: ScoredCard) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const notify = useNotify();
  const [text, setText] = useState(query.q);
  const [showFilters, setShowFilters] = useState(true);

  // Typing is debounced into the query; a query set from outside (a fix) resets the box.
  useEffect(() => setText(query.q), [query.q]);
  useEffect(() => {
    if (text === query.q) return;
    const t = setTimeout(() => setQuery((q) => ({ ...q, q: text })), 200);
    return () => clearTimeout(t);
  }, [text, query.q, setQuery]);

  const filters = useMemo(() => toFilters(query), [query]);
  const queryKey = JSON.stringify([query.q.trim(), filters, query.sort]);
  const paged = usePaged<ScoredCard>(
    `${queryKey}|${rev}`,
    PAGE,
    async (page, signal) => {
      const res = await browseCards({ deck: settled, q: query.q.trim() || undefined, filters, sort: query.sort, page, pageSize: PAGE }, signal);
      return { total: res.total, items: res.cards };
    },
    notify.error,
  );

  const set = <K extends keyof BrowserQuery>(k: K, v: BrowserQuery[K]) => setQuery((q) => ({ ...q, [k]: v, fromFix: k === 'q' ? q.fromFix : null }));
  const axes = useMemo(() => [...new Set([...extraAxes, ...AXIS_IDS])], [extraAxes]);
  const active = activeFilterCount(query);

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label="Card browser" data-testid="browser">
      <div className="grid gap-2 px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <h2 className="mr-1 text-[1.15rem] leading-none">Cards</h2>
          <input
            ref={searchRef}
            className="field min-w-0 flex-1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Name, type or rules text   ( / )"
            aria-label="Search cards"
            data-testid="card-search"
          />
          <select className="field w-[10.5rem]" value={query.sort} onChange={(e) => set('sort', e.target.value as CardSort)} aria-label="Sort cards" data-testid="sort">
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button type="button" className="btn btn-sm" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)}>
            Filters{active ? ` (${active})` : ''}
          </button>
        </div>

        {showFilters && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5" data-testid="filters">
            <select className="field h-7 w-[9.5rem] text-[0.8125rem]" value={query.role} onChange={(e) => set('role', e.target.value as BrowserQuery['role'])} aria-label="Role" data-testid="filter-role">
              <option value="">Any role</option>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
            <select className="field h-7 w-[9.5rem] text-[0.8125rem]" value={query.axis} onChange={(e) => set('axis', e.target.value)} aria-label="Theme" data-testid="filter-axis">
              <option value="">Any theme</option>
              {axes.map((a) => <option key={a} value={a}>{axisLabel(a)}</option>)}
            </select>
            <div className="flex items-center gap-1" role="group" aria-label="Colour">
              {COLOR_ORDER.map((c) => {
                const on = query.colors.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={on}
                    title={COLOR_NAME[c]}
                    className={`rounded-full ${on ? 'outline outline-2 outline-offset-1 outline-brass' : ''}`}
                    onClick={() =>
                      set('colors', c === 'C' ? (on ? [] : ['C']) : on ? query.colors.filter((x) => x !== c) : [...query.colors.filter((x) => x !== 'C'), c])
                    }
                  >
                    <ColorPip color={c} size="1.25rem" dim={!on && query.colors.length > 0} />
                  </button>
                );
              })}
            </div>
            <label className="flex items-center gap-1 text-ash">
              <span>Mana value</span>
              <input className="field h-7 w-10 px-1 text-center text-[0.8125rem]" inputMode="numeric" value={query.mvMin} onChange={(e) => set('mvMin', e.target.value)} placeholder="0" aria-label="Lowest mana value" />
              <span>to</span>
              <input className="field h-7 w-10 px-1 text-center text-[0.8125rem]" inputMode="numeric" value={query.mvMax} onChange={(e) => set('mvMax', e.target.value)} placeholder="16" aria-label="Highest mana value" data-testid="filter-mvmax" />
            </label>
            <input className="field h-7 w-[6.5rem] text-[0.8125rem]" value={query.type} onChange={(e) => set('type', e.target.value)} placeholder="Type, e.g. elf" aria-label="Card type or subtype" />
            <label className="flex items-center gap-1 text-ash">
              <span>Up to $</span>
              <input className="field h-7 w-12 px-1 text-center text-[0.8125rem]" inputMode="decimal" value={query.maxPrice} onChange={(e) => set('maxPrice', e.target.value)} placeholder="any" aria-label="Highest price in dollars" />
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-ash">
              <input type="checkbox" checked={query.owned} onChange={(e) => set('owned', e.target.checked)} /> Owned
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-ash" title="Hide cards that are off-colour, banned, over the copy limit or break the target bracket">
              <input type="checkbox" checked={query.legalOnly} onChange={(e) => set('legalOnly', e.target.checked)} data-testid="filter-legal" /> Legal at this bracket
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 text-ash">
              <input type="checkbox" checked={query.hideInDeck} onChange={(e) => set('hideInDeck', e.target.checked)} /> Not in deck
            </label>
            {(active > 0 || query.q) && (
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => setQuery({ ...DEFAULT_QUERY, legalOnly: query.legalOnly, hideInDeck: query.hideInDeck, sort: query.sort })} data-testid="clear-filters">
                Clear
              </button>
            )}
          </div>
        )}

        {query.fromFix && (
          <div className="flex items-start gap-2 rounded-md border border-brass-deep bg-[#2a2212] px-2.5 py-1.5 text-[0.85rem]" data-testid="fix-banner">
            <span className="min-w-0 flex-1"><span className="text-brass">Showing cards for:</span> {query.fromFix}</span>
            <button type="button" className="shrink-0 text-ash hover:text-bone" onClick={() => setQuery({ ...DEFAULT_QUERY })}>Back to all cards</button>
          </div>
        )}

        <div className="flex items-baseline text-[0.8rem] text-smoke" aria-live="polite">
          <span data-testid="browser-total">{paged.total === null ? 'Scoring the card pool' : `${fmtInt(paged.total)} cards`}</span>
          {paged.loading && paged.total !== null && <span className="ml-2">updating scores</span>}
        </div>
      </div>

      <div className="min-h-0 flex-1">
        <VirtualGrid
          count={paged.total ?? 40}
          itemAt={paged.itemAt}
          ensure={paged.ensure}
          keyOf={(c) => c.oracleId}
          minTile={116}
          gap={9}
          resetKey={queryKey}
          testId="browser-grid"
          empty={<p className="px-2 py-6 text-ash">No card matches. Loosen a filter, or untick “Legal at this bracket” to see what is being held back.</p>}
          render={(c) => {
            const entry = entryOf(deck, c.oracleId);
            const commander = deck.commanders.includes(c.oracleId);
            const isIn = !!entry || commander;
            const gate = isIn ? null : c.score.gate;
            return (
              <div
                className={`card group ${gate ? 'gated' : ''} ${isIn ? 'outline outline-2 outline-brass' : ''}`}
                data-testid="browser-card"
                data-name={c.name}
                data-id={c.oracleId}
                data-score={c.score.score}
                data-gated={gate ? gate.code : undefined}
                data-in-deck={isIn || undefined}
                title={gate ? `${c.name}: ${gate.message}` : c.name}
              >
                <button type="button" className="block h-full w-full cursor-zoom-in" onClick={() => onOpen(c)} aria-label={`Details for ${c.name}`}>
                  <CardImage id={c.oracleId} name={c.name} />
                </button>
                <div className="pointer-events-none absolute bottom-[3.5%] left-[5%] flex items-center gap-1">
                  <ScoreBadge score={c.score} />
                  {isIn && (
                    <span className="rounded bg-brass px-1 text-[0.7rem] font-semibold leading-[1.35rem] text-[#1a1407]">
                      {commander ? 'Commander' : entry && entry.qty > 1 ? `In deck \u00d7${entry.qty}` : 'In deck'}
                    </span>
                  )}
                </div>
                {c.owned && <span className="pointer-events-none absolute left-[3%] top-[2%] h-2.5 w-2.5 rounded-full bg-band-top ring-2 ring-soot" title="In your collection" data-testid="owned-dot" />}
                {gate && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden bg-[rgb(19_16_12/0.94)] p-2 text-[0.75rem] leading-snug text-bone group-hover:block" style={{ paddingBottom: '22%' }} data-testid="gate-reason">
                    {gate.message}
                  </div>
                )}
                {!gate && !commander && (
                  <div className="absolute bottom-[4%] right-[5%] flex gap-1 opacity-70 group-hover:opacity-100">
                    {entry && (
                      <button type="button" className="tile-btn" onClick={() => onRemove(c.oracleId)} aria-label={`Remove ${c.name} from the deck`} data-testid="browser-remove">
                        &minus;
                      </button>
                    )}
                    {(!entry || c.roles.includes('land')) && (
                      <button type="button" className="tile-btn tile-btn-add" onClick={() => onAdd(c)} aria-label={`Add ${c.name} to the deck`} data-testid="browser-add">
                        +
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          }}
        />
      </div>
    </section>
  );
}
