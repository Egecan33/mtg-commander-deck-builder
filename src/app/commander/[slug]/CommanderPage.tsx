'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { Color } from '@/engine/types';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { EmptyState } from '@/app/components/EmptyState';
import { FilterBar } from '@/app/components/FilterBar';
import { useFreeOnly } from '@/app/components/held';
import { useNotify } from '@/app/components/Shell';
import {
  ApiError, buildDeck, createDeck, getCommanderPage, getCommanderRecs, getPartners, loadEdhrec,
  type CommanderCard, type CommanderPageResponse, type CommanderRecsResponse, type RecsQuery,
} from '@/app/lib/api';
import { budgetMax } from '@/app/lib/budget';
import { setFilters, useFilters } from '@/app/lib/filters';
import { isAbort } from '@/app/lib/ui';
import { Banner } from './Banner';
import { AverageDeckTab } from './AverageDeckTab';
import { ChartsTab } from './ChartsTab';
import { CombosTab } from './CombosTab';
import { DecksTab } from './DecksTab';
import { REC_GROUPS, REC_SORTS, RecsTab } from './RecsTab';
import { SimilarTab } from './SimilarTab';
import { joinNames, shellDeck } from './shell';
import { useAverageDeck } from './useAverageDeck';

export const TABS = [
  { id: 'recs', label: 'Card recs' }, { id: 'deck', label: 'Average deck' }, { id: 'charts', label: 'Charts' },
  { id: 'combos', label: 'Combos' }, { id: 'similar', label: 'Similar commanders' }, { id: 'decks', label: 'Your decks' },
] as const;
export type TabId = (typeof TABS)[number]['id'];

export function CommanderPage({ slug }: { slug: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const notify = useNotify();
  const filters = useFilters();
  const [freeOnly] = useFreeOnly();
  const withSlug = params.get('with') ?? undefined;
  const colorParam = params.get('color');
  const color = (['W', 'U', 'B', 'R', 'G'].includes(colorParam ?? '') ? colorParam : null) as Color | null;
  const tab = (TABS.find((t) => t.id === params.get('tab'))?.id ?? 'recs') as TabId;
  const [page, setPage] = useState<CommanderPageResponse | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [recs, setRecs] = useState<CommanderRecsResponse | null>(null);
  const [partners, setPartners] = useState<CommanderCard[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const ready = filters.ready && freeOnly !== null;

  const q: RecsQuery = useMemo(
    () => ({ bracket: filters.bracket, budget: filters.budget, ownedOnly: filters.ownedOnly, freeOnly: filters.ownedOnly && freeOnly === true, color }),
    [filters.bracket, filters.budget, filters.ownedOnly, freeOnly, color],
  );

  // Arriving from Best from collection: tick Only my collection, then take the parameters out of the address.
  const arrived = useRef(false);
  useEffect(() => {
    if (arrived.current || !filters.ready || params.get('owned') !== '1') return;
    arrived.current = true;
    setFilters({ ownedOnly: true, ...(params.get('free') === '1' ? { freeOnly: true } : {}) });
    const next = new URLSearchParams(params.toString());
    next.delete('owned');
    next.delete('free');
    router.replace(`/commander/${slug}${next.size ? `?${next}` : ''}`);
  }, [filters.ready, params, router, slug]);

  const setColor = (c: Color) => {
    const next = new URLSearchParams(params.toString());
    next.set('color', c);
    router.replace(`/commander/${slug}?${next}`, { scroll: false });
  };
  const setTab = (id: TabId) => {
    const next = new URLSearchParams(params.toString());
    if (id === 'recs') next.delete('tab');
    else next.set('tab', id);
    router.replace(`/commander/${slug}${next.size ? `?${next}` : ''}`, { scroll: false });
  };

  // The header (cached data only).
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    getCommanderPage(slug, { with: withSlug, bracket: q.bracket, color }, ctrl.signal).then(
      (p) => { setPage(p); setMissing(null); },
      (e) => { if (!isAbort(e)) { if (e instanceof ApiError && e.status >= 400 && e.status < 500) setMissing(e.message); else notify.error(e); } },
    );
    return () => ctrl.abort();
  }, [ready, slug, withSlug, q.bracket, color, tick, notify]);

  // Opening a commander page counts as picking the commander: one EDHREC read per page open (a no-op while EDHREC is off).
  const asked = useRef('');
  const pageKey = page?.commanders.map((c) => c.oracleId).join('+') ?? '';
  useEffect(() => {
    if (!page || asked.current === pageKey) return;
    asked.current = pageKey;
    const was = page.edhrec;
    loadEdhrec(page.commanders.map((c) => c.oracleId), page.bracket).then(
      (r) => { if (r.status === 'ready' && was !== 'ready') setTick((n) => n + 1); },
      () => undefined,
    );
  }, [page, pageKey]);

  // The recs, only while their tab is open.
  useEffect(() => {
    if (!ready || tab !== 'recs') return;
    const ctrl = new AbortController();
    getCommanderRecs(slug, { ...q, with: withSlug }, ctrl.signal).then(setRecs, (e) => { if (!isAbort(e) && !(e instanceof ApiError && e.status === 404)) notify.error(e); });
    return () => ctrl.abort();
  }, [ready, tab, slug, withSlug, q, tick, notify]);

  // Partners for the menu.
  const firstId = page?.commanders[0]?.oracleId;
  const hasPartnerKind = page && page.commanders.length === 1 && page.commanders[0].partnerKinds.length > 0;
  useEffect(() => {
    setPartners([]);
    if (!firstId || !hasPartnerKind) return;
    getPartners(firstId).then((r) => setPartners(r.partners), () => undefined);
  }, [firstId, hasPartnerKind]);

  // Keep the section headers and the rail under the sticky bar.
  useLayoutEffect(() => {
    const el = bar.current;
    const rootEl = root.current;
    if (!el || !rootEl) return;
    const set = () => rootEl.style.setProperty('--cmd-bar', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, [page]);

  const name = page ? joinNames(page.commanders) : '';
  const commanderIds = useMemo(() => page?.commanders.map((c) => c.oracleId) ?? [], [page]);
  const avg = useAverageDeck(commanderIds, name, q, ready && !!page && (tab === 'deck' || tab === 'charts'), freeOnly === true);
  const create = useCallback(
    async (kind: 'build' | 'best' | 'empty') => {
      if (!page) return;
      const ids = page.commanders.map((c) => c.oracleId);
      const label = kind === 'best' ? `${name} (from my collection)` : name;
      setBusy(kind);
      try {
        let deck = shellDeck(ids, q.bracket, label, color);
        if (kind !== 'empty') {
          const owned = kind === 'best' ? true : q.ownedOnly;
          const free = kind === 'best' ? freeOnly === true : q.ownedOnly && freeOnly === true;
          const built = await buildDeck(deck, 'auto', { ownedOnly: owned, freeOnly: free || undefined, maxPriceUsd: budgetMax(q.budget), seed: 1 });
          deck = { ...built.deck, id: null, name: label };
        }
        const saved = await createDeck(deck);
        if (kind !== 'empty') notify.info(`Built a deck: ${label}`);
        router.push(`/deck/${saved.deck.id}`);
      } catch (e) {
        notify.error(e);
        setBusy(null);
      }
    },
    [page, name, q, color, freeOnly, notify, router],
  );

  if (missing) {
    return (
      <div className="mx-auto max-w-[1500px] px-8 py-7">
        <EmptyState title={missing} message="That address does not match a commander." action={<Link href="/commanders" className="btn btn-sm">See every commander</Link>} />
      </div>
    );
  }
  if (!page) return <div className="px-8 py-7 text-ash">Loading commander…</div>;

  return (
    <div ref={root}>
      <Banner page={page} partners={partners} busy={busy} onBuild={() => void create('build')} onBest={() => void create('best')} onOpenBuilder={() => void create('empty')} onDecks={() => setTab('decks')} color={color} onColor={setColor} />
      <div ref={bar} className="sticky top-0 z-20 border-b border-slag bg-soot/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center gap-x-6 gap-y-2 px-8 py-2">
          <div className="seg" role="tablist" aria-label="Commander page">
            {TABS.map((t) => (
              <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} aria-pressed={tab === t.id} onClick={() => setTab(t.id)} data-testid={`commander-tab-${t.id}`}>
                {t.label}
              </button>
            ))}
          </div>
          <FilterBar
            show={tab === 'recs' ? ['bracket', 'budget', 'ownedOnly', 'freeOnly', 'size', 'view', 'groupBy', 'sort'] : ['bracket', 'budget', 'ownedOnly', 'freeOnly']}
            groups={REC_GROUPS}
            sorts={REC_SORTS}
            className="!p-0"
          />
        </div>
      </div>
      <div className="mx-auto max-w-[1500px] px-8 py-5 [&_section>header]:!top-[var(--cmd-bar,0px)]">
        {tab === 'recs' && (recs ? <RecsTab data={recs} name={name} edhrecDecks={page.edhrecDecks} /> : <p className="text-ash">Loading card recs…</p>)}
        {tab === 'decks' && <DecksTab page={page} name={name} onBuild={() => void create('build')} />}
        {tab === 'deck' && <AverageDeckTab avg={avg} name={name} />}
        {tab === 'charts' && <ChartsTab avg={avg} name={name} bracket={q.bracket} />}
        {tab === 'combos' && <CombosTab slug={slug} withSlug={withSlug} q={q} name={name} tick={tick} />}
        {tab === 'similar' && <SimilarTab slug={slug} withSlug={withSlug} q={q} name={name} />}
      </div>
    </div>
  );
}
