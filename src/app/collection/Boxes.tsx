'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CardImage } from '../components/card';
import { useNotify } from '../components/Shell';
import {
  ApiError, addBox, adjustCollection, getBox, getBoxes, getDeck, getProduct, linkBox, openBoxAsDeck, removeBox, searchProducts, takeFromBox,
  previewBox, type BoxCard, type BoxDetailResponse, type BoxInfo, type BoxPreviewCard, type ProductDetailResponse, type ProductGroup, type ProductInfo, type ProductsResponse,
} from '../lib/api';
import { fmtInt, isAbort } from '../lib/ui';

const day = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/** One line of "recently added": a single box, or every deck of a group added in one go. */
interface Added { id: string; label: string; parts: { box: BoxInfo; counted: { oracleId: string; qty: number }[] }[]; undone?: boolean }

/** The same card in several decks of a group: one checklist line (copies add up, the free copies are the same pool). */
function mergeOverlap(lists: BoxPreviewCard[][]): BoxPreviewCard[] {
  const by = new Map<string, BoxPreviewCard>();
  for (const list of lists) {
    for (const c of list) {
      const have = by.get(c.oracleId);
      by.set(c.oracleId, have ? { ...have, boxQty: have.boxQty + c.boxQty, free: Math.max(have.free, c.free), onlyHere: have.onlyHere && c.onlyHere } : c);
    }
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** "Add a box": search a sealed product, see what you already own of it, add it. */
export function AddBox({ onChanged }: { onChanged: () => Promise<void> | void }) {
  const notify = useNotify();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<ProductsResponse | null>(null);
  const [picked, setPicked] = useState<ProductDetailResponse | null>(null);
  // A box sold as one but listed as several decks: opened in the results, or picked to add them all.
  const [open, setOpen] = useState<string | null>(null);
  const [pickedAll, setPickedAll] = useState<ProductGroup | null>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<Added[]>([]);
  // Cards of the picked box the collection already holds free copies of; `checked` ones count as the box's.
  const [overlap, setOverlap] = useState<BoxPreviewCard[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    const text = q.trim();
    if (!text) return setResults(null);
    const ctrl = new AbortController();
    const t = setTimeout(() => searchProducts(text, ctrl.signal).then(setResults, () => {}), 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  // One row per product, except that the decks of a group share one row where the first of them is.
  const rows = useMemo(() => {
    if (!results) return [];
    const groupOf = new Map<string, ProductGroup>();
    for (const g of results.groups) for (const p of g.products) groupOf.set(p.id, g);
    const out: ({ group: ProductGroup } | { product: ProductInfo })[] = [];
    const seen = new Set<string>();
    for (const p of results.products) {
      const g = groupOf.get(p.id);
      if (!g) out.push({ product: p });
      else if (!seen.has(g.key)) {
        seen.add(g.key);
        out.push({ group: g });
      }
    }
    return out;
  }, [results]);
  const setLabel = (p: ProductInfo) => results?.sets[p.setCode.toUpperCase()] ?? p.setCode.toUpperCase();

  const pick = async (p: ProductInfo) => {
    try {
      const detail = await getProduct(p.id);
      const pre = await previewBox(p.id).then((r) => r.cards, () => [] as BoxPreviewCard[]);
      setOverlap(pre);
      setChecked(new Set());
      setPickedAll(null);
      setPicked(detail);
    } catch (e) {
      notify.error(e);
    }
  };
  const pickAll = async (g: ProductGroup) => {
    try {
      const lists = await Promise.all(g.products.map((p) => previewBox(p.id).then((r) => r.cards, () => [] as BoxPreviewCard[])));
      setOverlap(mergeOverlap(lists));
      setChecked(new Set());
      setPicked(null);
      setPickedAll(g);
    } catch (e) {
      notify.error(e);
    }
  };
  const finish = async () => {
    setPicked(null);
    setPickedAll(null);
    setOpen(null);
    setQ('');
    setResults(null);
    await onChanged();
  };
  const confirm = async () => {
    if (!picked) return;
    setBusy(true);
    try {
      const ids = overlap.filter((c) => checked.has(c.oracleId));
      const { box } = await addBox(picked.product.id, ids.map((c) => c.oracleId));
      const counted = ids.map((c) => ({ oracleId: c.oracleId, qty: Math.min(c.free, c.boxQty) }));
      setAdded((a) => [{ id: box.id, label: box.name, parts: [{ box, counted }] }, ...a.filter((x) => !x.undone)].slice(0, 5));
      await finish();
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };
  // Every deck of the group as its own box, one after the other. A card ticked in the checklist
  // counts for each deck that holds it as long as free copies last, so each deck is previewed anew.
  const confirmAll = async () => {
    if (!pickedAll) return;
    setBusy(true);
    const parts: Added['parts'] = [];
    const record = () => {
      if (parts.length > 0) setAdded((a) => [{ id: parts[0]!.box.id, label: pickedAll.label, parts }, ...a.filter((x) => !x.undone)].slice(0, 5));
    };
    try {
      for (const p of pickedAll.products) {
        const pre = checked.size > 0 ? await previewBox(p.id).then((r) => r.cards.filter((c) => checked.has(c.oracleId)), () => [] as BoxPreviewCard[]) : [];
        const { box } = await addBox(p.id, pre.map((c) => c.oracleId));
        parts.push({ box, counted: pre.map((c) => ({ oracleId: c.oracleId, qty: Math.min(c.free, c.boxQty) })) });
      }
      record();
      await finish();
    } catch (e) {
      record();
      notify.error(e);
      await onChanged();
    } finally {
      setBusy(false);
    }
  };
  // Undo of an added box is the same as selling it: its cards leave again. One at a time, and the
  // row stays in place (without its button) until the pointer leaves the list, so a second click
  // cannot reach the next row's Undo. A group goes out as a whole.
  const undoRun = useRef(false);
  const [undoing, setUndoing] = useState<string | null>(null);
  const undo = async (entry: Added) => {
    if (undoRun.current) return;
    undoRun.current = true;
    setUndoing(entry.id);
    let gone = 0;
    try {
      for (const { box, counted } of [...entry.parts].reverse()) {
        try {
          await removeBox(box.id, 'sold');
          // Copies that already were yours go back to being loose copies.
          for (const c of counted) await adjustCollection(c.oracleId, c.qty);
        } catch (e) {
          if (e instanceof ApiError && e.status === 404) gone++;
          else throw e;
        }
      }
      setAdded((a) => a.map((x) => (x.id === entry.id ? { ...x, undone: true } : x)));
      if (gone > 0) notify.info(`${gone === entry.parts.length ? entry.label : `${gone} of ${entry.label}`} was no longer in your boxes, so there was nothing to undo for it`);
      await onChanged();
    } catch (e) {
      notify.error(e);
      await onChanged();
    } finally {
      undoRun.current = false;
      setUndoing(null);
    }
  };

  const ownedDistinct = picked ? picked.cards.filter((c) => c.ownedQty > 0).length : 0;

  const overlapList = overlap.length > 0 && (
    <fieldset className="mt-2 rounded-md border border-slag p-2" data-testid="box-overlap">
      <legend className="px-1 text-[0.88rem] text-ash">
        You already have {fmtInt(overlap.reduce((n, c) => n + Math.min(c.free, c.boxQty), 0))} of this box&apos;s cards outside boxes
      </legend>
      <p className="text-[0.8rem] text-smoke">
        Singles are usually extra copies, so the box is added on top. Tick a card to count it as this box's card instead of adding it again.
      </p>
      <button
        type="button"
        className="btn btn-sm btn-quiet mt-1"
        onClick={() => setChecked(checked.size === overlap.length ? new Set() : new Set(overlap.map((c) => c.oracleId)))}
        data-testid="box-check-all"
      >
        {checked.size === overlap.length ? 'Uncheck all' : 'Check all'}
      </button>
      <ul className="mt-1 grid max-h-56 gap-0.5 overflow-y-auto">
        {overlap.map((c) => (
          <li key={c.oracleId}>
            <label className="flex items-start gap-2 text-[0.88rem]">
              <input
                type="checkbox"
                className="mt-1"
                checked={checked.has(c.oracleId)}
                onChange={() => setChecked((cur) => { const n = new Set(cur); if (!n.delete(c.oracleId)) n.add(c.oracleId); return n; })}
                data-testid="box-overlap-card"
                data-name={c.name}
              />
              <span className="min-w-0 flex-1">
                {c.name}
                <span className="block text-[0.78rem] text-smoke">{c.onlyHere ? 'only in this box' : 'also printed in other sets'}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
  const nothingPicked = !picked && !pickedAll;

  return (
    <div data-testid="box-add">
      <h2 className="text-[1.1rem]">Add a box</h2>
      <p className="mt-1 text-[0.88rem] text-ash">
        Bought a sealed product? Search it by name, set or set code, in any word order. Every card in it is added to this collection and remembered as sealed, so selling the box later takes exactly those cards out.
      </p>
      <input
        className="field mt-2 w-full"
        value={q}
        onChange={(e) => { setQ(e.target.value); setPicked(null); setPickedAll(null); }}
        placeholder="Product, set name or set code"
        spellCheck={false}
        autoComplete="off"
        aria-label="Search sealed products"
        data-testid="box-search"
      />
      {results && nothingPicked && (
        rows.length === 0 ? (
          <p className="mt-2 text-[0.88rem] text-ash">No product matches that.</p>
        ) : (
          <ul className="mt-2 max-h-64 overflow-y-auto rounded-md border border-slag" data-testid="box-results">
            {rows.map((row) =>
              'group' in row ? (
                <li key={row.group.key} className="border-b border-slag last:border-b-0" data-testid="box-group" data-key={row.group.key}>
                  <button
                    type="button"
                    className="block w-full px-3 py-2 text-left hover:bg-soot"
                    aria-expanded={open === row.group.key}
                    onClick={() => setOpen(open === row.group.key ? null : row.group.key)}
                    data-testid="box-group-toggle"
                  >
                    <span className="block font-medium">{row.group.label} &middot; {row.group.products.length} decks</span>
                    <span className="block text-[0.8rem] text-smoke">{row.group.products[0]?.type} &middot; {row.group.setCode.toUpperCase()} &middot; {row.group.products[0]?.releaseDate} &middot; {fmtInt(row.group.cardCount)} cards in all</span>
                  </button>
                  {open === row.group.key && (
                    <div className="border-t border-slag bg-soot px-3 py-2" data-testid="box-group-decks">
                      <button type="button" className="btn btn-sm" onClick={() => void pickAll(row.group)} data-testid="box-add-all">
                        Add all {row.group.products.length}
                      </button>
                      <ul className="mt-1 grid gap-0.5">
                        {row.group.products.map((p) => (
                          <li key={p.id}>
                            <button type="button" className="block w-full rounded px-2 py-1 text-left text-[0.88rem] hover:bg-iron" onClick={() => void pick(p)} data-testid="box-result">
                              {p.name} <span className="text-smoke">&middot; {fmtInt(p.cardCount)} cards</span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </li>
              ) : (
                <li key={row.product.id} className="border-b border-slag last:border-b-0">
                  <button type="button" className="block w-full px-3 py-2 text-left hover:bg-soot" onClick={() => void pick(row.product)} data-testid="box-result">
                    <span className="block font-medium">{row.product.name}</span>
                    <span className="block text-[0.8rem] text-smoke">{row.product.type} &middot; {setLabel(row.product)} &middot; {row.product.setCode.toUpperCase()} &middot; {row.product.releaseDate} &middot; {fmtInt(row.product.cardCount)} cards</span>
                  </button>
                </li>
              ),
            )}
          </ul>
        )
      )}
      {pickedAll && (
        <div className="mt-2 rounded-md border border-slag bg-soot p-3" data-testid="box-picked-all">
          <div className="font-medium">{pickedAll.label}</div>
          <div className="text-[0.8rem] text-smoke">{pickedAll.products.length} decks &middot; {pickedAll.setCode.toUpperCase()} &middot; {fmtInt(pickedAll.cardCount)} cards in all</div>
          <ul className="mt-1 text-[0.84rem] text-ash">
            {pickedAll.products.map((p) => <li key={p.id}>{p.name}</li>)}
          </ul>
          {overlapList}
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void confirmAll()} data-testid="box-add-all-confirm">
              {busy ? 'Adding' : `Add ${pickedAll.products.length} decks to Physical`}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setPickedAll(null)}>Pick another</button>
          </div>
        </div>
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
          {overlapList}
          <div className="mt-2 flex gap-2">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void confirm()} data-testid="box-add-confirm">
              {busy ? 'Adding' : 'Add to Physical'}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setPicked(null)}>Pick another</button>
          </div>
        </div>
      )}
      {added.length > 0 && (
        <ul className="mt-3 grid gap-1 text-[0.84rem]" data-testid="box-recent" onPointerLeave={() => setAdded((a) => (a.some((x) => x.undone) ? a.filter((x) => !x.undone) : a))}>
          {added.map((entry) => {
            const total = entry.parts.reduce((n, p) => n + p.box.total, 0);
            const counted = entry.parts.reduce((n, p) => n + p.counted.reduce((m, c) => m + c.qty, 0), 0);
            return (
              <li key={entry.id} className={`flex items-center gap-2 ${entry.undone ? 'text-smoke line-through' : ''}`}>
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-smoke">Added</span> {entry.label}: {entry.parts.length > 1 ? `${entry.parts.length} decks, ` : ''}{fmtInt(total)} cards{counted > 0 ? `, ${fmtInt(counted)} you already had now count as the box's` : ''}
                </span>
                {entry.undone ? (
                  <span className="text-smoke no-underline">Undone</span>
                ) : (
                  <button
                    type="button"
                    className="text-brass hover:underline disabled:text-smoke disabled:no-underline"
                    title={entry.parts.length > 1 ? 'Takes all the boxes and their cards out again, as if sold' : 'Takes the box and its cards out again, as if sold'}
                    disabled={undoing !== null}
                    onClick={() => void undo(entry)}
                    data-testid="box-undo"
                  >
                    {undoing === entry.id ? 'Undoing' : 'Undo'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type Action = 'keep' | 'deck' | 'sold';

/** A card whose last sealed copy was just taken out of box `boxId`; it keeps its cell for a moment. */
interface TakenCard { boxId: string; card: BoxCard; name: string; known: boolean }

/** The box's cards with the ones just taken out back in their cells (commander slots first, then by oracle id, like the server). */
function withTaken(cards: BoxCard[], taken: TakenCard[]): { card: BoxCard; gone?: TakenCard }[] {
  const out: { card: BoxCard; gone?: TakenCard }[] = cards.map((card) => ({ card }));
  const before = (a: BoxCard, b: BoxCard) => (a.commander !== b.commander ? a.commander : a.oracleId < b.oracleId);
  for (const t of taken) {
    if (cards.some((c) => c.oracleId === t.card.oracleId)) continue;
    const i = out.findIndex((x) => before(t.card, x.card));
    out.splice(i < 0 ? out.length : i, 0, { card: t.card, gone: t });
  }
  return out;
}

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
  // One take-out at a time, held until the collection has reloaded. A card whose last sealed copy
  // came out keeps its cell ("Taken out") until the pointer leaves the card list, so the next card
  // cannot slide under a second click.
  const takeRun = useRef(false);
  const [taking, setTaking] = useState<string | null>(null);
  const [taken, setTaken] = useState<TakenCard[]>([]);
  const takeOut = async (box: BoxInfo, card: BoxCard, name: string, known: boolean) => {
    if (takeRun.current) return;
    takeRun.current = true;
    setTaking(card.oracleId);
    try {
      const next = await takeFromBox(box.id, card.oracleId, 1);
      if (!next.cards.some((c) => c.oracleId === card.oracleId)) {
        setTaken((t) => [...t.filter((x) => !(x.boxId === box.id && x.card.oracleId === card.oracleId)), { boxId: box.id, card: { ...card, qty: 0 }, name, known }]);
      }
      setDetail(next);
      await onChanged();
    } catch (e) {
      notify.error(e);
    } finally {
      takeRun.current = false;
      setTaking(null);
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
                ) : detail.cards.length === 0 && !taken.some((t) => t.boxId === b.id) ? (
                  <p className="text-[0.88rem] text-ash">Nothing is left sealed in this box.</p>
                ) : (
                  <ul className="grid grid-cols-3 gap-2" onPointerLeave={() => setTaken((t) => (t.length ? [] : t))} data-testid="box-card-list">
                    {withTaken(detail.cards, taken.filter((t) => t.boxId === b.id)).map(({ card: c, gone }) => {
                      const known = detail.lookup[c.oracleId];
                      const name = gone?.name ?? known?.name ?? 'Unknown card';
                      const isKnown = gone ? gone.known : !!known;
                      return (
                        <li key={c.oracleId} className="text-[0.78rem]" data-testid="box-card" data-name={name} data-gone={gone ? true : undefined}>
                          <div className="card"><CardImage id={c.oracleId} name={gone?.name ?? known?.frontName ?? name} known={isKnown} />
                            {c.qty > 1 && <span className="absolute right-[5%] top-[3.5%] rounded bg-soot/90 px-1 text-[0.8rem] font-semibold leading-[1.35rem]">&times;{c.qty}</span>}
                            {gone && <div className="absolute inset-0 rounded-[inherit] bg-soot/75" />}
                          </div>
                          <button
                            type="button"
                            className="btn btn-sm mt-1 w-full"
                            title={gone ? 'Out of the box, still in your collection' : 'Keeps the card in your collection but not as part of the box'}
                            aria-label={gone ? `${name} is out of the box` : `Take ${name} out of the box`}
                            disabled={!!gone || taking !== null}
                            onClick={() => void takeOut(b, c, name, isKnown)}
                            data-testid="box-take"
                          >
                            {gone ? 'Taken out' : taking === c.oracleId ? 'Taking it out' : 'Take out'}
                          </button>
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
