'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Bracket } from '@/engine/types';
import { CardImage } from '../components/card';
import { useFreeOnly } from '../components/held';
import { useCollections, useNotify, useProxies, useStatus } from '../components/Shell';
import { createDeck, getDiscover, getDiscoverTiers, startDiscover, type CardLookup, type DiscoverEntry, type DiscoverScope, type DiscoverState, type DiscoverTier } from '../lib/api';
import { commanderHref } from '../lib/links';
import { BAND_VAR, BRACKETS, bandOf, bracketName, fmtPrice } from '../lib/ui';

const tierLabel = (t: DiscoverTier) => (t.cap === null ? 'Unlimited' : t.cap === 0 ? 'Owned only' : `Up to ${t.cap} buys`);
const priceText = (t: DiscoverTier) => (t.buys.length === 0 ? 'nothing to buy' : `$${t.price.toFixed(t.price < 100 ? 2 : 0)}${t.unpriced ? ` + ${t.unpriced} unpriced (?)` : ''}`);
const tierKey = (t: DiscoverTier) => String(t.cap);

export default function DiscoverPage() {
  const notify = useNotify();
  const router = useRouter();
  const proxies = useProxies();
  const { status } = useStatus();
  const { active } = useCollections();
  const [freeOnlyPref, setFreeOnly] = useFreeOnly();
  // Boxes and built decks only exist in a collection kept by hand. null until known, so the search starts once.
  const manual = active?.kind === 'manual';
  const freeOnly = freeOnlyPref === null ? null : manual && freeOnlyPref;
  const [bracket, setBracket] = useState<Bracket>(3);
  const [scope, setScope] = useState<DiscoverScope>('owned');
  const [state, setState] = useState<DiscoverState | null>(null);
  const [lookup, setLookup] = useState<CardLookup>({});
  const [open, setOpen] = useState<string | null>(null);
  const [lazy, setLazy] = useState<Record<string, DiscoverTier[] | 'loading'>>({});
  const [picked, setPicked] = useState<string>('0');
  const [creating, setCreating] = useState(false);
  const run = useRef(0);

  const ready = status?.ready === true;
  useEffect(() => {
    if (!ready || freeOnly === null) return;
    const mine = ++run.current;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let restarted = false;
    const take = (s: DiscoverState) => {
      if (mine !== run.current) return;
      // The job finished on EDHREC data that has changed since (GET answers 'idle' for a stale
      // result): start it again, once, instead of showing an empty page.
      if (s.status === 'idle' && !restarted) {
        restarted = true;
        startDiscover(bracket, scope, freeOnly).then(take, (e) => notify.error(e));
        return;
      }
      setState(s);
      setLookup((cur) => ({ ...cur, ...s.cards }));
      if (s.status === 'running') timer = setTimeout(() => getDiscover(bracket, scope, freeOnly).then(take, (e) => notify.error(e)), 700);
    };
    setState(null);
    setOpen(null);
    setLazy({});
    startDiscover(bracket, scope, freeOnly).then(take, (e) => notify.error(e));
    return () => {
      run.current++;
      if (timer) clearTimeout(timer);
    };
  }, [ready, bracket, scope, freeOnly, notify]);

  const lazyKey = (id: string) => `${bracket}:${scope}:${freeOnly ? 'free' : 'all'}:${id}`;
  const expand = (entry: DiscoverEntry) => {
    const id = entry.commander.oracleId;
    if (open === id) return setOpen(null);
    setOpen(id);
    setPicked('0');
    const key = lazyKey(id);
    if (lazy[key] || state?.status !== 'done') return;
    setLazy((l) => ({ ...l, [key]: 'loading' }));
    getDiscoverTiers(bracket, id, scope, !!freeOnly).then(
      (res) => {
        setLookup((cur) => ({ ...cur, ...res.cards }));
        setLazy((l) => ({ ...l, [key]: res.tiers }));
      },
      (e) => {
        notify.error(e);
        setLazy((l) => {
          const next = { ...l };
          delete next[key];
          return next;
        });
      },
    );
  };

  const create = async (entry: DiscoverEntry, t: DiscoverTier) => {
    setCreating(true);
    try {
      const name = `${entry.commander.frontName} (${t.cap === null ? 'best build' : t.cap === 0 ? 'from my collection' : `${t.buys.length} buys`})`;
      const saved = await createDeck({ ...t.deck, id: null, name });
      router.push(`/deck/${saved.deck.id}`);
    } catch (e) {
      notify.error(e);
      setCreating(false);
    }
  };
  const copy = async (t: DiscoverTier) => {
    const text = t.buys.map((id) => `1 ${lookup[id]?.name ?? id}`).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      notify.info(`Copied ${t.buys.length} card names`);
    } catch {
      notify.error('The browser did not allow copying. Open the deck and use Export instead.');
    }
  };

  const running = state?.status === 'running';
  return (
    <div className="mx-auto max-w-[72rem] px-6 py-6" data-testid="discover-page">
      <div className="flex items-end gap-6">
        <div className="min-w-0 flex-1">
          <h1 className="text-[1.7rem] leading-tight">Best from your collection</h1>
          <p className="mt-1 max-w-[46rem] text-ash">
            {scope === 'owned'
              ? 'Which commanders you own make the best deck out of cards you already have, and how much better each gets with a few purchases.'
              : 'Which commanders you do not have would work best with the cards you already own. The commander is the one card to get; open a row to see what a few more would add.'}{' '}
            Basic lands count as owned. Only single commanders are looked at, not partner pairs.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-4">
            <div className="seg" role="group" aria-label="Whose commanders">
              <button type="button" aria-pressed={scope === 'owned'} onClick={() => setScope('owned')} data-testid="discover-scope-owned">Commanders I own</button>
              <button type="button" aria-pressed={scope === 'unowned'} onClick={() => setScope('unowned')} data-testid="discover-scope-unowned">Commanders I don’t own</button>
            </div>
            {manual && (
              <label className="flex cursor-pointer items-center gap-1.5 text-[0.86rem] text-ash" title="Leave out copies sealed in a box or in a built deck, so the decks only use cards that are free">
                <input type="checkbox" checked={!!freeOnly} disabled={freeOnly === null} onChange={(e) => setFreeOnly(e.target.checked)} data-testid="free-only" />
                Use free copies only
              </label>
            )}
          </div>
        </div>
        <div className="shrink-0">
          <div className="mb-1 text-[0.75rem] text-ash">Bracket: {bracketName(bracket)}</div>
          <div className="seg" role="group" aria-label="Bracket">
            {BRACKETS.map((b) => (
              <button key={b.n} type="button" aria-pressed={bracket === b.n} title={`${b.name}. ${b.blurb}`} onClick={() => setBracket(b.n)} data-testid={`discover-bracket-${b.n}`}>{b.n}</button>
            ))}
          </div>
        </div>
      </div>

      {state?.status === 'empty' && (
        <div className="mt-8 max-w-[40rem] rounded-md border border-dashed border-slag p-5" data-testid="discover-empty">
          <p className="display text-[1.1rem]">Import your collection first</p>
          <p className="mt-1 text-ash">This page ranks the commanders you own by the deck your own cards can build. It needs to know what you own.</p>
          <Link href="/collection" className="btn btn-primary mt-4">Go to Collection</Link>
        </div>
      )}
      {state?.status === 'error' && <p className="mt-6 text-band-low" role="alert">The search failed: {state.error}</p>}
      {(running || !state) && (
        <div className="mt-6" data-testid="discover-progress">
          <div className="flex items-baseline gap-2 text-[0.9rem]">
            <span>{state?.stage || 'Starting'}</span>
            <span className="text-smoke">{state && state.total ? `${state.done} of ${state.total}` : ''}</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-iron">
            <div className="h-full rounded-full bg-brass transition-[width]" style={{ width: `${state && state.total ? (state.done / state.total) * 100 : 3}%` }} />
          </div>
        </div>
      )}
      {state?.status === 'done' && (
        <p className="mt-5 text-[0.86rem] text-smoke" data-testid="discover-summary">
          {state.considered === 0
            ? scope === 'owned' ? 'No card in your collection can be a commander.' : 'There is no commander you do not own.'
            : state.built < state.considered
              ? `Showing the best ${state.built} of ${state.considered} commanders you ${scope === 'owned' ? 'own' : 'do not own'}, in ${(state.ms / 1000).toFixed(0)} s.`
              : `All ${state.considered} commanders you ${scope === 'owned' ? 'own' : 'do not own'}, best deck first.`}
        </p>
      )}

      <ol className="mt-3 grid gap-2.5">
        {(state?.entries ?? []).map((entry, i) => {
          const id = entry.commander.oracleId;
          const extra = lazy[lazyKey(id)];
          const tiers = [entry.tiers[0], ...(Array.isArray(extra) ? extra : []), entry.tiers[1]];
          const isOpen = open === id;
          const shown = tiers.find((t) => tierKey(t) === picked) ?? tiers[0];
          // Free copies only: a commander you own whose every copy is held counts as one to get.
          const heldCommander = scope === 'unowned' && !!freeOnly && entry.commander.owned;
          return (
            <li key={id} className="rounded-md border border-slag bg-anvil" data-testid="discover-entry" data-name={entry.commander.name}>
              <button type="button" className="flex w-full items-center gap-4 p-3 text-left" onClick={() => expand(entry)} aria-expanded={isOpen}>
                <span className="w-6 text-right text-smoke">{i + 1}</span>
                <span className="card w-[4.2rem] shrink-0">
                  <CardImage id={id} name={entry.commander.name} known />
                  {heldCommander && <span className="pointer-events-none absolute left-[3%] top-[2%] h-2.5 w-2.5 rounded-full bg-band-top ring-2 ring-soot" title="In your collection" data-testid="owned-dot" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="display block truncate text-[1.15rem]">{entry.commander.name}</span>
                  {heldCommander && <span className="block text-[0.8rem] text-ember" data-testid="discover-held-note">Owned, but held by a box or a built deck</span>}
                  <span className="text-[0.8rem] text-smoke">{isOpen ? 'Pick a tier to see what to buy' : 'Click for the 5, 10, 15 and 20-buy tiers'}</span>
                </span>
                {[entry.tiers[0], entry.tiers[1]].map((t) => (
                  <span key={tierKey(t)} className="w-[10.5rem] shrink-0 rounded-md border border-slag bg-soot px-3 py-1.5">
                    <span className="block text-[0.75rem] text-ash">{tierLabel(t)}</span>
                    <span className="display text-[1.35rem] font-bold leading-none" style={{ color: BAND_VAR[bandOf(t.rating)] }}>{t.rating}</span>
                    <span className="ml-2 text-[0.75rem] text-smoke">{t.buys.length ? `${t.buys.length} to buy` : 'no buys'}</span>
                    <span className="mt-0.5 block text-[0.7rem] text-smoke" data-testid="discover-basis">{entry.basis === 'edhrec' ? 'Scored with EDHREC data' : 'Scored from card text'}</span>
                  </span>
                ))}
              </button>
              <div className="pb-2 pl-[7.3rem]">
                <Link
                  href={`${commanderHref(entry.commander)}?owned=1${freeOnly ? '&free=1' : ''}`}
                  className="text-[0.8rem] text-ash hover:text-bone hover:underline"
                  data-testid="discover-commander-link"
                >
                  Commander page
                </Link>
              </div>

              {isOpen && (
                <div className="border-t border-slag p-3" data-testid="discover-detail">
                  <div className="flex flex-wrap gap-2" role="group" aria-label="Buy tiers">
                    {tiers.map((t) => (
                      <button key={tierKey(t)} type="button" aria-pressed={shown === t} onClick={() => setPicked(tierKey(t))} className={`rounded-md border px-3 py-1.5 text-left ${shown === t ? 'border-brass bg-iron' : 'border-slag bg-soot hover:border-smoke'}`} data-testid="discover-tier" data-cap={tierKey(t)}>
                        <span className="block text-[0.75rem] text-ash">{tierLabel(t)}</span>
                        <span className="display text-[1.15rem] font-bold" style={{ color: BAND_VAR[bandOf(t.rating)] }}>{t.rating}</span>
                        <span className="ml-2 text-[0.75rem] text-smoke">{t.buys.length} to buy, {priceText(t)}</span>
                      </button>
                    ))}
                    {extra === 'loading' && <span className="self-center text-[0.86rem] text-ash">Working out the 5 to 20-buy tiers</span>}
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button type="button" className="btn btn-primary btn-sm" disabled={creating} onClick={() => void create(entry, shown)} data-testid="discover-create">Create this deck</button>
                    <button type="button" className="btn btn-sm" disabled={shown.buys.length === 0} onClick={() => void proxies.add(shown.buys.map((oracleId) => ({ oracleId, qty: 1 })))} data-testid="discover-proxy">Add buys to proxy list</button>
                    <button type="button" className="btn btn-sm" disabled={shown.buys.length === 0} onClick={() => void copy(shown)} data-testid="discover-copy">Copy buy list</button>
                    <span className="text-[0.84rem] text-ash">{tierLabel(shown)}: rating {shown.rating}, {shown.buys.length} to buy, {priceText(shown)}</span>
                  </div>
                  {shown.buys.length > 0 && (
                    <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2.5" data-testid="discover-buys">
                      {shown.buys.map((b) => (
                        <li key={b}>
                          <div className="card" title={lookup[b]?.name}><CardImage id={b} name={lookup[b]?.frontName ?? 'Card'} known={!!lookup[b]} /></div>
                          <div className="mt-1 truncate text-center text-[0.75rem] text-ash">{lookup[b] ? (lookup[b].priceUsd === null ? '?' : fmtPrice(lookup[b].priceUsd)) : '?'}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
