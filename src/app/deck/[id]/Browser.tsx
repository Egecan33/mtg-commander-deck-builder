'use client';

import { useEffect, useMemo, useState, type RefObject } from 'react';
import { CORE_PACKAGES, FUNCTIONAL_PACKAGES } from '@/engine/packages';
import type { Deck, PackageId } from '@/engine/types';
import { VirtualCardGrid } from '../../components/CardGrid';
import { CardTile } from '../../components/CardTile';
import { EmptyState } from '../../components/EmptyState';
import { ColorPip } from '../../components/card';
import { useNotify } from '../../components/Shell';
import { usePaged } from '../../components/VirtualGrid';
import { browseCards, type CardSort, type HeldBy, type ScoredCard } from '../../lib/api';
import {
  AXIS_IDS, COLOR_NAME, COLOR_ORDER, DEFAULT_QUERY, ROLES, ROLE_LABEL, activeFilterCount, axisLabel, deckCount, entryOf, fmtInt, toFilters, type BrowserQuery,
} from '../../lib/ui';

const PAGE = 120;
const SORTS: { id: CardSort; label: string }[] = [
  { id: 'score', label: 'Best for this deck' },
  { id: 'popularity', label: 'Most played' },
  { id: 'name', label: 'Name' },
  { id: 'mv', label: 'Mana value' },
  { id: 'price', label: 'Price' },
];

const tileStats = (c: BrowserCard, price: boolean) => {
  const out: { label: string; value: string; title?: string }[] = [];
  if (price && c.priceUsd !== null) out.push({ label: '', value: `$${c.priceUsd.toFixed(2)}`, title: 'Price' });
  if (c.also && c.also.length > 0) out.push({ label: 'also', value: c.also.join(', '), title: 'Also in these packages of the deck' });
  return out.length > 0 ? out : undefined;
};

/** A browser result. `held`: adding one more copy would take a copy a box or another built deck holds (their names). */
export type BrowserCard = ScoredCard & { held?: string[] };

/**
 * The whole legal card pool, scored for this deck, as a wall of card images. `settled` is the deck
 * as last sent for analysis (so scores match the rating); `deck` is the live one, used only to mark
 * what is already in.
 */
export function Browser({
  deck, settled, rev, query, setQuery, extraAxes, themePackages, held, onAdd, onRemove, onOpen, searchRef, onHide,
}: {
  /** Hides the card search column (the deck gets its width). */
  onHide: () => void;
  deck: Deck;
  settled: Deck;
  rev: number;
  query: BrowserQuery;
  setQuery: (next: BrowserQuery | ((q: BrowserQuery) => BrowserQuery)) => void;
  extraAxes: string[];
  /** The deck's planned theme packages, offered next to the core and functional ones in the role menu. */
  themePackages: { id: PackageId; name: string }[];
  /** The deck's own conflicts: a card already in the deck shows its "!" from these. */
  held: HeldBy;
  /** "+" on a card. The deck page opens the card with what it could replace when the deck is full. */
  onAdd: (card: BrowserCard) => void;
  onRemove: (id: string) => void;
  onOpen: (card: BrowserCard) => void;
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
  const paged = usePaged<BrowserCard>(
    `${queryKey}|${rev}`,
    PAGE,
    async (page, signal) => {
      const res = await browseCards({ deck: settled, q: query.q.trim() || undefined, filters, sort: query.sort, page, pageSize: PAGE }, signal);
      // The page's "!" travels with its cards, so it is replaced together with them.
      return { total: res.total, items: res.cards.map((c) => (res.heldBy[c.oracleId] ? { ...c, held: res.heldBy[c.oracleId] } : c)) };
    },
    notify.error,
  );

  const set = <K extends keyof BrowserQuery>(k: K, v: BrowserQuery[K]) => setQuery((q) => ({ ...q, [k]: v, fromFix: k === 'q' ? q.fromFix : null }));
  // The role menu also picks a package: choosing one clears the role and the other way round.
  const pickRole = (v: string) =>
    setQuery((q) => ({ ...q, role: v.startsWith('package:') ? '' : (v as BrowserQuery['role']), package: v.startsWith('package:') ? (v.slice(8) as PackageId) : '', fromFix: null }));
  const packageChoices = useMemo(() => [
    ...CORE_PACKAGES.map((p) => ({ id: p.id, name: p.name })),
    ...FUNCTIONAL_PACKAGES.map((p) => ({ id: p.id, name: p.name })),
    ...themePackages,
  ], [themePackages]);
  const axes = useMemo(() => [...new Set([...extraAxes, ...AXIS_IDS])], [extraAxes]);
  const active = activeFilterCount(query);
  const clearFilters = () => setQuery({ ...DEFAULT_QUERY, legalOnly: query.legalOnly, hideInDeck: query.hideInDeck, sort: query.sort });
  // A full deck: "+" opens the card with the deck cards it could replace.
  const full = deckCount(deck) >= 100;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col" aria-label="Card browser" data-testid="browser">
      <div className="grid gap-2 px-3 pb-2 pt-3">
        <div className="flex items-center gap-2">
          <h2 className="mr-1 text-[18px] leading-none">Cards</h2>
          <input
            ref={searchRef}
            className="field min-w-0 flex-1"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Name, type or rules text   ( / )"
            aria-label="Search cards"
            data-testid="card-search"
          />
          <button type="button" className="btn btn-sm btn-quiet shrink-0" onClick={onHide} title="Hide the card search and give the deck the room. Show it again above the deck, or press /." data-testid="browser-hide">
            Hide card search
          </button>
        </div>

        <div className="flex items-center gap-2">
          <select className="field h-7 w-[10.5rem] text-[0.8125rem]" value={query.sort} onChange={(e) => set('sort', e.target.value as CardSort)} aria-label="Sort cards" title="Order of the cards" data-testid="sort">
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
          <button type="button" className="btn btn-sm" aria-expanded={showFilters} onClick={() => setShowFilters((s) => !s)} title={showFilters ? 'Hide the filters' : 'Show the filters'}>
            Filters{active ? ` (${active})` : ''}
          </button>
          <span className="ml-auto text-[0.8rem] text-smoke" aria-live="polite">
            <span data-testid="browser-total">{paged.total === null ? 'Scoring the card pool' : `${fmtInt(paged.total)} cards`}</span>
            {paged.loading && paged.total !== null && <span className="ml-2">updating scores</span>}
          </span>
        </div>

        {showFilters && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5" data-testid="filters">
            <select className="field h-7 w-[9.5rem] text-[0.8125rem]" value={query.role || (query.package ? `package:${query.package}` : '')} onChange={(e) => pickRole(e.target.value)} aria-label="Role" data-testid="filter-role">
              <option value="">Any role</option>
              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              <optgroup label="Packages">
                {packageChoices.map((p) => <option key={p.id} value={`package:${p.id}`}>{p.name}</option>)}
              </optgroup>
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
              <button type="button" className="btn btn-sm btn-quiet" onClick={clearFilters} data-testid="clear-filters">
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
      </div>

      <div className="min-h-0 flex-1">
        <VirtualCardGrid<BrowserCard>
          size="M"
          count={paged.total ?? 40}
          itemAt={paged.itemAt}
          ensure={paged.ensure}
          keyOf={(c) => c.oracleId}
          resetKey={queryKey}
          testId="browser-grid"
          empty={
            active > 0 || query.q ? (
              <EmptyState
                className="mx-1 mt-2"
                message="No card matches this search and these filters."
                action={<button type="button" className="btn btn-sm" onClick={clearFilters} data-testid="empty-clear">Clear the search and filters</button>}
              />
            ) : (
              <EmptyState
                className="mx-1 mt-2"
                message="No card here is legal for this deck at its bracket."
                action={<button type="button" className="btn btn-sm" onClick={() => set('legalOnly', false)}>Show cards that are not legal here</button>}
              />
            )
          }
          render={(c) => {
            const entry = entryOf(deck, c.oracleId);
            const commander = deck.commanders.includes(c.oracleId);
            const isIn = !!entry || commander;
            const gate = isIn ? null : c.score.gate;
            // In the deck: does the deck take a held copy. Not in it: would adding it take one.
            const holders = isIn || deck.companion === c.oracleId ? held[c.oracleId] : c.held;
            return (
              <CardTile
                card={c}
                size="M"
                score={c.score.gate ? null : c.score.score}
                gate={c.score.gate?.message ?? null}
                heldBy={gate ? undefined : holders}
                marks={isIn ? ['in-deck'] : []}
                status={commander ? 'Commander' : undefined}
                qty={entry?.qty}
                dim={!!gate}
                stats={tileStats(c, query.sort === 'price')}
                onOpen={() => onOpen(c)}
                testId="browser-card"
                data={{
                  'data-name': c.name,
                  'data-id': c.oracleId,
                  'data-score': c.score.score,
                  'data-gated': gate ? gate.code : undefined,
                  'data-in-deck': isIn || undefined,
                  'data-held': holders ? true : undefined,
                }}
                actions={
                  !gate && !commander ? (
                    <div className="flex gap-1 opacity-70 group-focus-within:opacity-100 group-hover:opacity-100">
                      {entry && (
                        <button type="button" className="tile-btn" onClick={() => onRemove(c.oracleId)} aria-label={`Remove ${c.name} from the deck`} title="Remove one copy from the deck" data-testid="browser-remove">
                          &minus;
                        </button>
                      )}
                      {(!entry || c.roles.includes('land')) && (
                        <button
                          type="button"
                          className="tile-btn tile-btn-add"
                          onClick={() => onAdd(c)}
                          aria-label={full ? `Put ${c.name} in instead of a deck card` : `Add ${c.name} to the deck`}
                          title={full ? 'The deck has 100 cards: opens the card with the deck cards it could replace' : 'Add to the deck'}
                          data-testid="browser-add"
                          data-full={full || undefined}
                        >
                          +
                        </button>
                      )}
                    </div>
                  ) : undefined
                }
              />
            );
          }}
        />
      </div>
    </section>
  );
}
