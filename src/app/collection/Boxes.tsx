'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { CardImage } from '../components/card';
import { useNotify } from '../components/Shell';
import {
  ApiError, addBox, getBox, getBoxes, getDeck, getProduct, linkBox, openBoxAsDeck, removeBox, searchProducts, takeFromBox,
  type BoxDetailResponse, type BoxInfo, type ProductDetailResponse, type ProductInfo,
} from '../lib/api';
import { fmtInt, isAbort } from '../lib/ui';

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** "Add a box": search a sealed product, see what you already own of it, add it. */
export function AddBox({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const notify = useNotify();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProductInfo[] | null>(null);
  const [picked, setPicked] = useState<ProductDetailResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<{ box: BoxInfo }[]>([]);

  useEffect(() => {
    const text = q.trim();
    if (!text) return setResults(null);
    const ctrl = new AbortController();
    const t = setTimeout(() => searchProducts(text, ctrl.signal).then((r) => setResults(r.products), () => {}), 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const pick = async (p: ProductInfo) => {
    try {
      setPicked(await getProduct(p.id));
    } catch (e) {
      notify.error(e);
    }
  };
  const confirm = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      const { box } = await addBox(picked.product.id);
      setAdded((a) => [{ box }, ...a].slice(0, 5));
      setPicked(null);
      setQ('');
      setResults(null);
      await onChanged();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };
  // Undo of an added box is the same as selling it: its cards leave again.
  const undo = async (box: BoxInfo) => {
    try {
      await removeBox(box.id, 'sold');
      setAdded((a) => a.filter((x) => x.box.id !== box.id));
      await onChanged();
    } catch (e) {
      notify.error(e);
    }
  };

  const ownedDistinct = picked ? picked.cards.filter((c) => c.ownedQty > 0).length : 0;

  return (
    <div data-testid="box-add">
      <h2 className="text-[1.1rem]">Add a box</h2>
      <p className="mt-1 text-[0.88rem] text-ash">
        Bought a sealed product? Search it by name or set code. Every card in it is added to this collection and remembered as sealed, so selling the box later takes exactly those cards out.
      </p>
      <input
        className="field mt-2 w-full"
        value={q}
        onChange={(e) => { setQ(e.target.value); setPicked(null); }}
        placeholder="Product name or set code"
        spellCheck={false}
        autoComplete="off"
        aria-label="Search sealed products"
        data-testid="box-search"
      />
      {results && !picked && (
        results.length === 0 ? (
          <p className="mt-2 text-[0.88rem] text-ash">No product matches that.</p>
        ) : (
          <ul className="mt-2 max-h-64 overflow-y-auto rounded-md border border-slag" data-testid="box-results">
            {results.map((p) => (
              <li key={p.id} className="border-b border-slag last:border-b-0">
                <button type="button" className="block w-full px-3 py-2 text-left hover:bg-soot" onClick={() => void pick(p)} data-testid="box-result">
                  <span className="block font-medium">{p.name}</span>
                  <span className="block text-[0.8rem] text-smoke">{p.type} &middot; {p.setCode.toUpperCase()} &middot; {p.releaseDate} &middot; {fmtInt(p.cardCount)} cards</span>
                </button>
              </li>
            ))}
          </ul>
        )
      )}
      {picked && (
        <div className="mt-2 rounded-md border border-slag bg-soot p-3" data-testid="box-picked">
          <div className="font-medium">{picked.product.name}</div>
          <div className="text-[0.8rem] text-smoke">{picked.product.type} &middot; {picked.product.setCode.toUpperCase()} &middot; {picked.product.releaseDate}</div>
          <div className="mt-2 flex gap-2">
            {picked.cards.filter((c) => c.commander).slice(0, 3).map((c) => {
              const known = picked.lookup[c.oracleId];
              return (
                <div key={c.oracleId} className="card w-[5.5rem] shrink-0">
                  <CardImage id={c.oracleId} name={known?.frontName ?? 'Unknown card'} known={!!known} />
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[0.88rem] text-ash" data-testid="box-owned-note">
            You already own {fmtInt(ownedDistinct)} of its {fmtInt(picked.cards.length)} cards.
          </p>
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void confirm()} data-testid="box-add-confirm">
              {busy ? 'Adding' : 'Add to Physical'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setPicked(null)}>Pick another</button>
          </div>
        </div>
      )}
      {added.length > 0 && (
        <ul className="mt-3 grid gap-1 text-[0.84rem]" data-testid="box-recent">
          {added.map(({ box }) => (
            <li key={box.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate"><span className="text-smoke">Added</span> {box.name}</span>
              <button type="button" className="text-brass hover:underline" title="Takes the box and its cards out again, as if sold" onClick={() => void undo(box)} data-testid="box-undo">Undo</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Action = 'keep' | 'deck' | 'sold';

/** "Your boxes": the sealed products of this collection, each with what is left in it. */
export function YourBoxes({ version, onChanged, onCount }: { version: number; onChanged: () => Promise<void> | void; onCount?: (n: number) => void }) {
  const notify = useNotify();
  const router = useRouter();
  const [boxes, setBoxes] = useState<BoxInfo[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [detail, setDetail] = useState<BoxDetailResponse | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; action: Action } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await getBoxes();
      setBoxes(r.boxes);
      onCount?.(r.boxes.length);
    } catch (e) {
      notify.error(e);
    }
  }, [notify, onCount]);
  useEffect(() => { void load(); }, [load, version]);

  // Names of the decks the boxes are linked to ("This deck is my … box" on a deck page). A deck that is gone counts as no link.
  const [deckNames, setDeckNames] = useState<Record<string, string | null>>({});
  useEffect(() => {
    const ids = [...new Set((boxes ?? []).flatMap((b) => (b.deckId ? [b.deckId] : [])))];
    if (ids.length === 0) return;
    const ctrl = new AbortController();
    Promise.all(
      ids.map((id) =>
        getDeck(id, ctrl.signal).then(
          (r) => [id, r.deck.name] as const,
          (e) => [id, e instanceof ApiError && e.status === 404 ? null : undefined] as const,
        ),
      ),
    ).then((pairs) => {
      if (ctrl.signal.aborted) return;
      setDeckNames((cur) => {
        const next = { ...cur };
        for (const [id, name] of pairs) if (name !== undefined) next[id] = name;
        return next;
      });
    }, (e) => {
      if (!isAbort(e)) notify.error(e);
    });
    return () => ctrl.abort();
  }, [boxes, notify]);
  const unlink = async (box: BoxInfo, deckName: string) => {
    setBusy(true);
    try {
      await linkBox(box.id, null);
      notify.info(`${box.name} is no longer linked to ${deckName}. That deck shows a “!” for its cards again.`);
      await load();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };

  // The open box's cards, reloaded whenever the totals may have changed.
  useEffect(() => {
    if (!open) return setDetail(null);
    const ctrl = new AbortController();
    getBox(open, ctrl.signal).then(setDetail, () => {});
    return () => ctrl.abort();
  }, [open, version]);

  const run = async (box: BoxInfo, action: Action) => {
    setBusy(true);
    try {
      if (action === 'deck') {
        const { deckId, linked, chooseCommander } = await openBoxAsDeck(box.id);
        await onChanged();
        if (linked) notify.info(`${box.name} is now marked built. Its cards stay as they were in the deck.`);
        if (chooseCommander) notify.info(`${box.name} has more than two cards that can lead it, so all are in the deck. Choose the commander: open it and press “Make commander”.`);
        router.push(`/deck/${deckId}`);
        return;
      }
      await removeBox(box.id, action === 'sold' ? 'sold' : 'opened');
      notify.info(action === 'sold' ? `${box.name} sold, its cards were removed` : `${box.name} opened, the cards stay in your collection`);
      if (open === box.id) setOpen(null);
      await onChanged();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };
  const takeOut = async (box: BoxInfo, oracleId: string) => {
    try {
      setDetail(await takeFromBox(box.id, oracleId, 1));
      await onChanged();
    } catch (e) {
      notify.error(e);
    }
  };

  if (!boxes || boxes.length === 0) return null;
  const question: Record<Action, string> = {
    keep: 'Remove the box and keep all its cards?',
    deck: 'Make a deck from what is still sealed in it?',
    sold: 'Remove the box and the cards still in it?',
  };

  return (
    <div data-testid="box-list">
      <h2 className="text-[1.1rem]">Your boxes</h2>
      <ul className="mt-2 grid gap-2">
        {boxes.map((b) => (
          <li key={b.id} className="rounded-md border border-slag bg-soot px-3 py-2" data-testid="box-row" data-name={b.name}>
            <button type="button" className="block w-full text-left" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)} data-testid="box-toggle">
              <span className="block font-medium">{b.name}</span>
              <span className="block text-[0.8rem] text-smoke">Added {day(b.addedAt)}</span>
              <span className="block text-[0.84rem] text-ash" data-testid="box-sealed">{fmtInt(b.sealed)} of {fmtInt(b.total)} cards still in the box</span>
            </button>
            {b.deckId && deckNames[b.deckId] && (
              <div className="mt-1 flex items-center gap-2 text-[0.84rem]" data-testid="box-linked">
                <span className="min-w-0 flex-1 truncate text-ash">
                  Linked to <Link href={`/deck/${b.deckId}`} className="text-brass hover:underline">{deckNames[b.deckId]}</Link>
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-quiet shrink-0"
                  disabled={busy}
                  onClick={() => void unlink(b, deckNames[b.deckId!] ?? 'the deck')}
                  title="That deck shows a “!” for this box's cards again. The deck itself does not change."
                  data-testid="box-unlink"
                >
                  Unlink
                </button>
              </div>
            )}
            {confirm?.id === b.id ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.88rem]">
                <span className="w-full text-ash">
                  {confirm.action === 'deck' && b.deckId && deckNames[b.deckId]
                    ? `Mark ${deckNames[b.deckId]} as built and remove the box? The deck's cards do not change.`
                    : question[confirm.action]}
                </span>
                <button type="button" className={`btn btn-sm ${confirm.action === 'sold' ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={() => void run(b, confirm.action)} data-testid="box-confirm">Yes, do it</button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirm(null)}>Cancel</button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" className="btn btn-sm" title="The box is gone, every card stays in your collection" onClick={() => setConfirm({ id: b.id, action: 'keep' })} data-testid="box-keep">Opened, keep the cards</button>
                <button type="button" className="btn btn-sm" title={b.deckId && deckNames[b.deckId] ? `Marks ${deckNames[b.deckId]} as built and removes the box` : 'Saves a built deck from the cards still sealed in it'} onClick={() => setConfirm({ id: b.id, action: 'deck' })} data-testid="box-deck">Opened, make it a built deck</button>
                <button type="button" className="btn btn-sm" title="The cards still in the box leave your collection" onClick={() => setConfirm({ id: b.id, action: 'sold' })} data-testid="box-sold">Sold, remove the cards</button>
              </div>
            )}
            {open === b.id && (
              <div className="mt-3 border-t border-slag pt-3" data-testid="box-cards">
                {!detail || detail.box.id !== b.id ? (
                  <p className="text-[0.88rem] text-ash">Loading</p>
                ) : detail.cards.length === 0 ? (
                  <p className="text-[0.88rem] text-ash">Nothing is left sealed in this box.</p>
                ) : (
                  <ul className="grid grid-cols-3 gap-2">
                    {detail.cards.map((c) => {
                      const known = detail.lookup[c.oracleId];
                      const name = known?.name ?? 'Unknown card';
                      return (
                        <li key={c.oracleId} className="text-[0.78rem]" data-testid="box-card" data-name={name}>
                          <div className="card"><CardImage id={c.oracleId} name={known?.frontName ?? name} known={!!known} />
                            {c.qty > 1 && <span className="absolute right-[5%] top-[3.5%] rounded bg-soot/90 px-1 text-[0.8rem] font-semibold leading-[1.35rem]">&times;{c.qty}</span>}
                          </div>
                          <button type="button" className="btn btn-sm mt-1 w-full" title="Keeps the card in your collection but not as part of the box" onClick={() => void takeOut(b, c.oracleId)} data-testid="box-take">Take out</button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
