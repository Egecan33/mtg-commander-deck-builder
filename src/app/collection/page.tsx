'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CardImage } from '../components/card';
import { useNotify, useStatus } from '../components/Shell';
import { VirtualGrid } from '../components/VirtualGrid';
import { adjustCollection, getCollection, lookupPrinting, replaceCollection, type ClientCard, type CollectionResponse, type PrintingResponse, type TextLine } from '../lib/api';
import { fmtInt } from '../lib/ui';

type Owned = CollectionResponse['cards'][number];

export default function CollectionPage() {
  const notify = useNotify();
  const { status } = useStatus();
  const [collection, setCollection] = useState<CollectionResponse | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [unresolved, setUnresolved] = useState<TextLine[] | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      setCollection(await getCollection());
    } catch (e) {
      notify.error(e);
    }
  }, [notify]);
  useEffect(() => {
    if (status?.ready) void load();
  }, [status?.ready, load]);

  const save = async (body: string) => {
    setBusy(true);
    try {
      const res = await replaceCollection(body);
      setUnresolved(body.trim() ? res.unresolved : null);
      notify.info(body.trim() ? `Collection saved: ${fmtInt(res.count)} different cards` : 'Collection cleared');
      if (body.trim() && res.unresolved.length === 0) setText('');
      await load();
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
  const [recent, setRecent] = useState<{ key: number; card: ClientCard; qty: number }[]>([]);
  const quickRef = useRef<HTMLInputElement>(null);
  const recentKey = useRef(1);
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
  const quickAdd = async (card: ClientCard | null | undefined, qty: number) => {
    if (!card) return;
    try {
      await adjustCollection(card.oracleId, qty);
      setRecent((r) => [{ key: recentKey.current++, card, qty }, ...r].slice(0, 8));
      setQuick('');
      setFound(null);
      quickRef.current?.focus();
      await load();
    } catch (e) {
      notify.error(e);
    }
  };
  const undo = async (item: { key: number; card: ClientCard; qty: number }) => {
    try {
      await adjustCollection(item.card.oracleId, -item.qty);
      setRecent((r) => r.filter((x) => x.key !== item.key));
      await load();
    } catch (e) {
      notify.error(e);
    }
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const cards = collection?.cards ?? [];
    return needle ? cards.filter((c) => c.name.toLowerCase().includes(needle)) : cards;
  }, [collection, q]);

  return (
    <div className="flex h-full" data-testid="collection-page">
      <aside className="flex w-[27rem] shrink-0 flex-col gap-4 overflow-y-auto border-r border-slag bg-anvil p-6">
        <div>
          <h1 className="text-[2rem] leading-none">Collection</h1>
          <p className="mt-2 text-ash">
            Tell the app which cards you own. They get a green dot everywhere, and the builder can be told to use only them.
          </p>
        </div>

        <div className="rounded-md border border-slag bg-soot px-4 py-3" data-testid="collection-count">
          <div className="display text-[1.9rem] font-bold leading-none">{collection ? fmtInt(collection.count) : '–'}</div>
          <div className="mt-1 text-ash">
            different cards{collection && collection.totalQty !== collection.count ? `, ${fmtInt(collection.totalQty)} copies in all` : ''}
          </div>
        </div>

        <div data-testid="quick-add">
          <h2 className="text-[1.1rem]">Add cards one by one</h2>
          <p className="mt-1 text-[0.88rem] text-ash">
            Type the set code and number printed at the bottom of the card (“TDM 123”, “123 tdm”) or its name. Enter adds one; Shift+Enter adds four; “3 tdm 123” adds three.
          </p>
          <input
            ref={quickRef}
            className="field mt-2 w-full"
            value={quick}
            onChange={(e) => setQuick(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || !found?.card) return;
              e.preventDefault();
              void quickAdd(found.card, e.shiftKey ? Math.max(4, found.qty) : found.qty);
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
            <ul className="mt-3 grid gap-1 text-[0.84rem]" data-testid="quick-recent">
              {recent.map((r) => (
                <li key={r.key} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate"><span className="text-smoke">+{r.qty}</span> {r.card.name}</span>
                  <button type="button" className="text-brass hover:underline" onClick={() => void undo(r)} data-testid="quick-undo">Undo</button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="text-[1.1rem]">Replace the collection</h2>
          <p className="mt-1 text-[0.88rem] text-ash">
            Paste a CSV export from Moxfield, Archidekt or ManaBox (the name and quantity columns are found automatically), or plain lines like
            “2 Sol Ring” or “3 tdm 123”. This replaces what is saved now.
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
            <span className="ml-auto" />
            {confirmClear ? (
              <>
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
          <input className="field ml-auto w-[18rem]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find by name" aria-label="Find an owned card by name" />
        </div>
        <div className="min-h-0 flex-1 px-3">
          {collection && collection.count === 0 ? (
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
              render={(c) => (
                <div className="card" title={c.name} data-testid="owned-card" data-name={c.name}>
                  <CardImage id={c.oracleId} name={c.name} />
                  {c.qty > 1 && <span className="absolute right-[5%] top-[3.5%] rounded bg-soot/90 px-1 text-[0.8rem] font-semibold leading-[1.35rem]">&times;{c.qty}</span>}
                </div>
              )}
            />
          )}
        </div>
      </section>
    </div>
  );
}
