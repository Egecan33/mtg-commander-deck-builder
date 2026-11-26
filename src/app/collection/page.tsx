'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CardImage } from '../components/card';
import { useCollections, useNotify, useStatus } from '../components/Shell';
import { VirtualGrid } from '../components/VirtualGrid';
import { adjustCollection, collectionExportUrl, getCollection, lookupPrinting, replaceCollection, type BoxTake, type ClientCard, type CollectionResponse, type PrintingResponse, type TextLine } from '../lib/api';
import { fmtDate, fmtInt } from '../lib/ui';
import { AddBox, YourBoxes } from './Boxes';
import { OwnedTile, type Owned } from './OwnedTile';

/**
 * One line of the quick-entry history. `qty` is negative for a removal; `fromBoxes` are the boxes a
 * removal took copies from. `undone`: kept in its place, without a button, until the pointer leaves the list.
 */
interface Recent { key: number; card: ClientCard; qty: number; fromBoxes: BoxTake[]; undone?: boolean }

/** A card whose last copy was removed from the grid, shown as "0 left" after the card `prev` (null: first). */
interface Ghost { card: Owned; prev: string | null }

/** `cards` with each ghost the server no longer lists put back after the card it followed. */
function withGhosts(cards: Owned[], ghosts: Ghost[]): Owned[] {
  if (ghosts.length === 0) return cards;
  const listed = new Set(cards.map((c) => c.oracleId));
  const live = ghosts.filter((g) => !listed.has(g.card.oracleId));
  if (live.length === 0) return cards;
  const after = new Map<string | null, Owned[]>();
  for (const g of live) after.set(g.prev, [...(after.get(g.prev) ?? []), g.card]);
  const out: Owned[] = [];
  const placed = new Set<string>();
  const follow = (key: string | null) => {
    for (const g of after.get(key) ?? []) {
      if (placed.has(g.oracleId)) continue;
      placed.add(g.oracleId);
      out.push(g);
      follow(g.oracleId);
    }
  };
  follow(null);
  for (const c of cards) {
    out.push(c);
    follow(c.oracleId);
  }
  // A ghost whose neighbour has gone as well: by name.
  for (const g of live) {
    if (placed.has(g.card.oracleId)) continue;
    const i = out.findIndex((c) => c.name.localeCompare(g.card.name) > 0);
    out.splice(i < 0 ? out.length : i, 0, g.card);
  }
  return out;
}

export default function CollectionPage() {
  const notify = useNotify();
  const { status } = useStatus();
  const { collections, active, switchTo, refresh: refreshCollections, arena, arenaBusy, syncArena, readArenaFull } = useCollections();
  const [collection, setCollection] = useState<CollectionResponse | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [unresolved, setUnresolved] = useState<TextLine[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [q, setQ] = useState('');
  const [boxVersion, setBoxVersion] = useState(0);
  const [boxCountRaw, setBoxCount] = useState(0);

  const boxCount = active?.kind === 'manual' ? boxCountRaw : 0;

  const load = useCallback(async () => {
    try {
      setCollection(await getCollection());
      void refreshCollections();
    } catch (e) {
      notify.error(e);
    }
  }, [notify, refreshCollections]);
  useEffect(() => {
    if (status?.ready) void load();
  }, [status?.ready, load]);

  // Anything that can change what is in a box: reload the grid and the box list.
  const changed = useCallback(async () => {
    setBoxVersion((v) => v + 1);
    await load();
  }, [load]);

  const save = async (body: string) => {
    setBusy(true);
    try {
      const res = await replaceCollection(body);
      setUnresolved(body.trim() ? res.unresolved : null);
      notify.info(body.trim() ? `Collection saved: ${fmtInt(res.count)} different cards` : 'Collection cleared');
      if (body.trim() && res.unresolved.length === 0) setText('');
      await changed();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
      setConfirmClear(false);
    }
  };

  // ---- quick add: the code printed at the bottom of a card, or a name
  const [quick, setQuick] = useState('');
  const [found, setFound] = useState<PrintingResponse | null>(null);
  const [mode, setMode] = useState<'add' | 'remove'>('add');
  const [recent, setRecent] = useState<Recent[]>([]);
  const quickRef = useRef<HTMLInputElement>(null);
  const recentKey = useRef(1);
  const quickBusy = useRef(false); // one quick entry at a time, so a second Enter cannot reuse stale counts
  useEffect(() => {
    const text = quick.trim();
    if (!text) return setFound(null);
    const ctrl = new AbortController();
    const t = setTimeout(() => lookupPrinting(text, ctrl.signal).then(setFound, () => {}), 120);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [quick]);
  const quickAdd = async (card: ClientCard | null | undefined, qty: number, ownedQty?: number) => {
    if (!card || quickBusy.current) return;
    quickBusy.current = true;
    try {
      if (mode === 'remove') {
        const have = ownedQty ?? (await lookupPrinting(card.name)).ownedQty;
        const taken = Math.min(qty, have);
        if (taken <= 0) return notify.info(`You do not own ${card.name}`);
        const res = await adjustCollection(card.oracleId, -taken);
        setRecent((r) => [{ key: recentKey.current++, card, qty: -taken, fromBoxes: res.fromBoxes }, ...r.filter((x) => !x.undone)].slice(0, 8));
      } else {
        await adjustCollection(card.oracleId, qty);
        setRecent((r) => [{ key: recentKey.current++, card, qty, fromBoxes: [] }, ...r.filter((x) => !x.undone)].slice(0, 8));
      }
      setQuick('');
      setFound(null);
      quickRef.current?.focus();
      await changed();
    } catch (e) {
      notify.error(e);
    } finally {
      quickBusy.current = false;
    }
  };
  const [undoing, setUndoing] = useState<number | null>(null);
  const undo = async (item: Recent) => {
    // Shares the quick-entry lock, so a double click cannot undo twice.
    if (item.undone || quickBusy.current) return;
    quickBusy.current = true;
    setUndoing(item.key);
    try {
      // Undoing a removal puts the copies back into the boxes they came from.
      await adjustCollection(item.card.oracleId, -item.qty, item.qty < 0 ? item.fromBoxes : undefined);
      // The row stays in place, without its button, until the pointer leaves the list: the next row's Undo must not slide under a second click.
      setRecent((r) => r.map((x) => (x.key === item.key ? { ...x, undone: true } : x)));
      await changed();
    } catch (e) {
      notify.error(e);
    } finally {
      quickBusy.current = false;
      setUndoing(null);
    }
  };
  const dropUndone = () => setRecent((r) => (r.some((x) => x.undone) ? r.filter((x) => !x.undone) : r));
  // ---- the owned grid. One change at a time, held until the grid has reloaded, so a second click
  // cannot act on stale counts. A card whose last copy goes keeps its cell as "0 left" (a ghost)
  // until the pointer leaves the grid, so the next card never slides under a second click.
  const tileRun = useRef<Promise<void> | null>(null);
  const [tileBusy, setTileBusy] = useState(false);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  /** Runs `fn` unless another grid change is running; then a click is dropped, and an Undo (`queue`) waits its turn. */
  const exclusive = async (fn: () => Promise<void>, queue = false) => {
    while (tileRun.current) {
      if (!queue) return;
      await tileRun.current;
    }
    const run = (async () => {
      setTileBusy(true);
      try {
        await fn();
      } catch (e) {
        notify.error(e);
      } finally {
        tileRun.current = null;
        setTileBusy(false);
      }
    })();
    tileRun.current = run;
    await run;
  };
  const tileAdjust = (c: Owned, delta: number) =>
    exclusive(async () => {
      const prev = all[all.findIndex((x) => x.oracleId === c.oracleId) - 1]?.oracleId ?? null;
      const res = await adjustCollection(c.oracleId, delta);
      if (res.qty === 0) setGhosts((g) => [...g.filter((x) => x.card.oracleId !== c.oracleId), { card: { ...c, qty: 0, inBoxes: 0 }, prev }]);
      if (delta < 0) {
        // The tile's + is a plain add; Undo is what puts a copy back into the box it came out of.
        const from = res.fromBoxes.length > 0 ? `, from ${res.fromBoxes.map((b) => b.name).join(', ')}` : '';
        notify.info(`−${-delta} ${c.name}${from} (${res.qty} left)`, { label: 'Undo', run: () => void tileUndo(c, -delta, res.fromBoxes) });
      }
      await changed();
    });
  const tileUndo = (c: Owned, qty: number, fromBoxes: BoxTake[]) =>
    exclusive(async () => {
      await adjustCollection(c.oracleId, qty, fromBoxes);
      await changed();
    }, true);

  // Every owned card with the ghosts in their old cells (after the card that came before them).
  const all = useMemo(() => withGhosts(collection?.cards ?? [], ghosts), [collection, ghosts]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? all.filter((c) => c.name.toLowerCase().includes(needle)) : all;
  }, [all, q]);

  return (
    <div className="flex h-full" data-testid="collection-page">
      <aside className="flex w-[27rem] shrink-0 flex-col gap-4 overflow-y-auto border-r border-slag bg-anvil p-6">
        <div>
          <h1 className="text-[2rem] leading-none">Collection</h1>
          <p className="mt-2 text-ash">
            Tell the app which cards you own. They get a green dot everywhere, and the builder can be told to use only them.
          </p>
        </div>

        {collections.length > 1 && (
          <div data-testid="collection-tabs">
            <div className="flex gap-1.5" role="tablist" aria-label="Collections">
              {collections.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="tab"
                  aria-selected={c.active}
                  data-testid={`collection-tab-${c.id}`}
                  className={`btn flex-1 justify-between ${c.active ? 'btn-primary' : ''}`}
                  onClick={() => { if (!c.active) void switchTo(c.id); }}
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="text-[0.8rem] opacity-80">{fmtInt(c.count)}</span>
                </button>
              ))}
            </div>
            <p className="mt-1.5 text-[0.82rem] text-smoke">
              The selected collection is the one “owned” means everywhere. Switching never changes a deck or the other collection.
            </p>
          </div>
        )}

        {active?.kind === 'arena' && (
          <div className="rounded-md border border-slag bg-soot px-4 py-3" data-testid="arena-panel">
            <div className="flex items-center gap-3">
              <h2 className="text-[1.1rem]">MTG Arena sync</h2>
              <button type="button" className="btn btn-sm ml-auto" disabled={arenaBusy} onClick={() => void syncArena().then(load)} data-testid="arena-sync">
                {arenaBusy ? 'Reading Arena' : 'Sync Arena'}
              </button>
            </div>
            <p className="mt-1 text-[0.88rem] text-ash" data-testid="arena-synced">
              {active.syncedAt ? `Last synced ${fmtDate(active.syncedAt)}.` : 'Never synced.'}{' '}
              {arena ? (arena.installed ? 'Arena was found on this computer.' : 'Arena is not installed on this computer.') : ''}
            </p>
            {arena?.last && !arena.last.ok && (
              <p className="mt-1.5 text-[0.88rem] text-band-mid" role="status" data-testid="arena-problem">{arena.last.message}</p>
            )}
            {arena?.last?.ok && (
              <p className="mt-1.5 text-[0.88rem] text-ash" data-testid="arena-result">{arena.last.message}</p>
            )}
            <div className="mt-3 border-t border-slag pt-3">
              <button type="button" className="btn btn-primary w-full" disabled={arenaBusy} onClick={() => void readArenaFull()} data-testid="arena-read-full">
                {arenaBusy ? 'Reading Arena' : 'Read my whole Arena collection'}
              </button>
              <p className="mt-1.5 text-[0.82rem] text-smoke">
                Reads every card you own straight from the running game and replaces this collection with it. Keep Arena open on its home screen.
                {arena && !arena.reader ? ' Needs the optional reader set up once; pressing the button says how.' : arena?.readerNeedsPassword ? ' Your computer will ask for your password: reading another app needs it.' : ''}
              </p>
            </div>
            <details className="mt-2 text-[0.82rem] text-smoke">
              <summary className="cursor-pointer text-ash">What the sync can and cannot see</summary>
              <p className="mt-1">
                It reads only files Arena leaves on this computer (its log and its card database). Nothing is sent anywhere and your Wizards account is never used.
                Arena stopped writing the whole collection to its log in 2021. With “Detailed Logs (Plugin Support)” on, the log holds your decks and your draft and sealed pools,
                so those are the cards found: a card you own that is in no deck is missed. Each sync adds to the earlier ones. Arena-only (Alchemy) cards are left out.
                To fill the gaps, add cards here by hand, or paste a full export from a tracker below.
              </p>
            </details>
          </div>
        )}

        <div className="rounded-md border border-slag bg-soot px-4 py-3" data-testid="collection-count">
          <div className="display text-[1.9rem] font-bold leading-none">{collection ? fmtInt(collection.count) : '–'}</div>
          <div className="mt-1 text-ash">
            different cards{collection && collection.totalQty !== collection.count ? `, ${fmtInt(collection.totalQty)} copies in all` : ''}
          </div>
        </div>

        {active?.kind === 'manual' && (
          <>
            <AddBox onChanged={changed} />
            <YourBoxes version={boxVersion} onChanged={changed} onCount={setBoxCount} />
          </>
        )}

        <div data-testid="quick-add">
          <h2 className="text-[1.1rem]">{mode === 'add' ? 'Add cards one by one' : 'Remove cards one by one'}</h2>
          <div className="mt-2 flex gap-1.5" role="group" aria-label="Quick entry mode" data-testid="quick-mode">
            <button type="button" className={`btn btn-sm ${mode === 'add' ? 'btn-primary' : ''}`} aria-pressed={mode === 'add'} onClick={() => setMode('add')} data-testid="quick-mode-add">Add</button>
            <button type="button" className={`btn btn-sm ${mode === 'remove' ? 'btn-primary' : ''}`} aria-pressed={mode === 'remove'} onClick={() => setMode('remove')} data-testid="quick-mode-remove">Remove</button>
          </div>
          <p className="mt-2 text-[0.88rem] text-ash">
            Type the set code and number printed at the bottom of the card (“TDM 123”, “123 tdm”) or its name. Enter {mode === 'add' ? 'adds' : 'removes'} one; Shift+Enter {mode === 'add' ? 'adds' : 'removes'} four; “3 tdm 123” {mode === 'add' ? 'adds' : 'removes'} three.
            {mode === 'remove' ? ' Copies that are not in a box go first, then the newest box loses its copies.' : ''}
          </p>
          <input
            ref={quickRef}
            className="field mt-2 w-full"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !found?.card) return;
              e.preventDefault();
              void quickAdd(found.card, e.shiftKey ? Math.max(4, found.qty) : found.qty, found.ownedQty);
            }}
            placeholder="TDM 123, or a card name"
            spellCheck={false}
            autoComplete="off"
            aria-label="Set code and collector number, or a card name"
            data-testid="quick-input"
          />
          {found && found.printings === 0 && (
            <p className="mt-1.5 text-[0.8rem] text-band-mid" data-testid="quick-hint">Set codes are not loaded yet, so only names work. Run <code>pnpm sync printings</code> once (or sync “Printings” under Card data).</p>
          )}
          {found && quick.trim() && (
            found.card ? (
              <div className="mt-2 flex gap-3" data-testid="quick-match" data-name={found.card.name}>
                <div className="card w-[7.5rem] shrink-0"><CardImage id={found.card.oracleId} name={found.card.frontName} /></div>
                <div className="min-w-0 flex-1 text-[0.88rem]">
                  <div className="font-medium">{found.card.name}</div>
                  <div className="text-ash">{found.via === 'code' ? 'Matched by set and number' : 'Matched by name'}{found.ownedQty ? `, you have ${found.ownedQty}` : ''}</div>
                  <div className="mt-1 text-smoke">Enter adds {found.qty}</div>
                  {found.via === 'name' && found.suggestions.length > 1 && (
                    <ul className="mt-1.5 grid gap-0.5" data-testid="quick-suggestions">
                      {found.suggestions.filter((s) => s.oracleId !== found.card?.oracleId).slice(0, 5).map((s) => (
                        <li key={s.oracleId}>
                          <button type="button" className="truncate text-left text-brass hover:underline" onClick={() => void quickAdd(s, found.qty)}>{s.name}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-[0.88rem] text-ash" data-testid="quick-none">No card matches that yet.</p>
            )
          )}
          {recent.length > 0 && (
            <ul className="mt-3 grid gap-1 text-[0.84rem]" data-testid="quick-recent" onPointerLeave={dropUndone}>
              {recent.map((r) => (
                <li key={r.key} className={`flex items-center gap-2 ${r.undone ? 'text-smoke line-through' : ''}`} data-undone={r.undone || undefined}>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="text-smoke">{r.qty > 0 ? `+${r.qty}` : `\u2212${-r.qty}`}</span> {r.card.name}
                    {r.fromBoxes.length > 0 && <span className="text-smoke" data-testid="quick-from-box"> from {r.fromBoxes.map((b) => b.name).join(', ')}</span>}
                  </span>
                  {r.undone ? (
                    <span className="text-smoke no-underline" data-testid="quick-undone">Undone</span>
                  ) : (
                    <button type="button" className="text-brass hover:underline disabled:text-smoke disabled:no-underline" disabled={undoing !== null} onClick={() => void undo(r)} data-testid="quick-undo">
                      {undoing === r.key ? 'Undoing' : 'Undo'}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="text-[1.1rem]">Replace {active ? `the ${active.name} collection` : 'the collection'}</h2>
          <p className="mt-1 text-[0.88rem] text-ash">
            Paste a CSV export from Moxfield, Archidekt or ManaBox (the name and quantity columns are found automatically), or plain lines like
            “2 Sol Ring” or “3 tdm 123”. This replaces what is saved now.{boxCount > 0 ? ` Its ${boxCount} ${boxCount === 1 ? 'box is' : 'boxes are'} removed too.` : ''}
          </p>
          <textarea
            className="field mt-2 h-56 w-full"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={'Name,Quantity\nSol Ring,1\nCommand Tower,2'}
            spellCheck={false}
            aria-label="Collection text or CSV"
            data-testid="collection-text"
          />
          <div className="mt-2 flex items-center gap-2">
            <button type="button" className="btn btn-primary" disabled={busy || !text.trim()} onClick={() => void save(text)} data-testid="collection-save">
              {busy ? 'Saving' : 'Save collection'}
            </button>
            <label className="btn cursor-pointer">
              <input
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) setText(await file.text());
                  e.target.value = '';
                }}
              />
              Choose a file
            </label>
            <a className="btn" href={collectionExportUrl(active?.id)} download data-testid="collection-export" title="Download this collection as a CSV you can import again. Boxes are not part of the CSV.">
              Export
            </a>
            <span className="ml-auto" />
            {confirmClear ? (
              <>
                {boxCount > 0 && <span className="text-[0.8rem] text-smoke" data-testid="clear-boxes-note">Its {boxCount} {boxCount === 1 ? 'box is' : 'boxes are'} removed too.</span>}
                <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void save('')} data-testid="collection-clear-confirm">Clear it</button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirmClear(false)}>Keep</button>
              </>
            ) : (
              <button type="button" className="btn btn-quiet btn-sm" disabled={busy || !collection?.count} onClick={() => setConfirmClear(true)} data-testid="collection-clear">
                Clear
              </button>
            )}
          </div>
        </div>

        {unresolved && unresolved.length > 0 && (
          <div className="rounded-md border border-band-mid bg-[#2e2013] p-3" data-testid="collection-unresolved">
            <div>
              {unresolved.length} {unresolved.length === 1 ? 'line was' : 'lines were'} not recognised and left out. Fix the names above and save again.
            </div>
            <ul className="mt-1.5 max-h-40 overflow-auto text-[0.82rem]">
              {unresolved.map((l) => (
                <li key={l.line} className="flex gap-2">
                  <span className="w-14 shrink-0 text-smoke">line {l.line}</span>
                  <span className="break-all">{l.text}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 px-6 pb-3 pt-6">
          <h2 className="text-[1.35rem]">Cards you own</h2>
          <input className="field ml-auto w-[18rem]" value={q} onChange={(e) => { setQ(e.target.value); setGhosts([]); }} placeholder="Find by name" aria-label="Find an owned card by name" />
        </div>
        <div className="min-h-0 flex-1 px-3" onPointerLeave={() => setGhosts((g) => (g.length ? [] : g))}>
          {collection && collection.count === 0 && all.length === 0 ? (
            <div className="mx-3 max-w-[40rem] rounded-md border border-dashed border-slag p-6 text-ash" data-testid="collection-empty">
              <p className="display text-[1.1rem] text-bone">No cards saved yet</p>
              <p className="mt-1">Paste an export on the left. Until then, “Owned” filters and “only cards in my collection” find nothing.</p>
            </div>
          ) : (
            <VirtualGrid<Owned>
              count={shown.length}
              itemAt={(i) => shown[i]}
              ensure={() => {}}
              keyOf={(c) => c.oracleId}
              minTile={132}
              gap={10}
              resetKey={q}
              testId="collection-grid"
              empty={collection ? <p className="p-4 text-ash">No owned card has that name.</p> : null}
              render={(c) => <OwnedTile card={c} busy={tileBusy} onAdjust={(card, d) => void tileAdjust(card, d)} />}
            />
          )}
        </div>
      </section>
    </div>
  );
}
