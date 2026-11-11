'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { CardImage } from '../components/card';
import { useNotify, useProxies, useStatus } from '../components/Shell';
import { getProxies, imageUrl, replaceProxies, type ProxyItem, type ProxyListResponse } from '../lib/api';
import { errText } from '../lib/ui';
import { zipStore } from './zip';

// A Magic card is 63 x 88 mm. Sheets hold 3 x 3 cards at that exact size.
const CARD_W = 63;
const CARD_H = 88;
const PER_SHEET = 9;
/** Room around the grid, inside the sheet, where the cut marks are drawn. */
const MARK_PAD = 5;
const MARK_LEN = 3.5;
const PAPER = {
  a4: { label: 'A4', w: 210, h: 297 },
  letter: { label: 'US Letter', w: 215.9, h: 279.4 },
} as const;
type PaperId = keyof typeof PAPER;

interface Options { paper: PaperId; gap: 0 | 1; cutMarks: boolean; backs: boolean; label: boolean }
const DEFAULTS: Options = { paper: 'a4', gap: 0, cutMarks: true, backs: true, label: true };
const STORE_KEY = 'commander-forge:proxy-options';

interface Face { key: string; oracleId: string; face: 0 | 1; name: string }

function loadOptions(): Options {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORE_KEY) ?? '{}') as Partial<Options>;
    return {
      paper: raw.paper === 'letter' ? 'letter' : 'a4',
      gap: raw.gap === 1 ? 1 : 0,
      cutMarks: raw.cutMarks !== false,
      backs: raw.backs !== false,
      label: raw.label !== false,
    };
  } catch {
    return DEFAULTS;
  }
}

const mm = (n: number) => `${Math.round(n * 1000) / 1000}mm`;

/** One printed sheet: up to nine cards at true size, with cut marks in the band around them. */
function Sheet({ faces, options }: { faces: Face[]; options: Options }) {
  const { gap } = options;
  const gridW = 3 * CARD_W + 2 * gap;
  const gridH = 3 * CARD_H + 2 * gap;
  // Every line a blade follows: both edges of each column and row (they coincide when the gap is 0).
  const xs = [...new Set([0, 1, 2].flatMap((i) => [i * (CARD_W + gap), i * (CARD_W + gap) + CARD_W]))];
  const ys = [...new Set([0, 1, 2].flatMap((i) => [i * (CARD_H + gap), i * (CARD_H + gap) + CARD_H]))];
  const off = MARK_PAD - MARK_LEN - 0.5;
  return (
    <div className="proxy-sheet" style={{ width: mm(gridW + 2 * MARK_PAD), height: mm(gridH + 2 * MARK_PAD), padding: mm(MARK_PAD) }} data-testid="proxy-sheet">
      {options.cutMarks && (
        <>
          {xs.map((x) => (
            <span key={`x${x}`}>
              <i className="cut-mark cut-v" style={{ left: mm(MARK_PAD + x), top: mm(off), height: mm(MARK_LEN) }} />
              <i className="cut-mark cut-v" style={{ left: mm(MARK_PAD + x), bottom: mm(off), height: mm(MARK_LEN) }} />
            </span>
          ))}
          {ys.map((y) => (
            <span key={`y${y}`}>
              <i className="cut-mark cut-h" style={{ top: mm(MARK_PAD + y), left: mm(off), width: mm(MARK_LEN) }} />
              <i className="cut-mark cut-h" style={{ top: mm(MARK_PAD + y), right: mm(off), width: mm(MARK_LEN) }} />
            </span>
          ))}
        </>
      )}
      <div className="proxy-grid" style={{ gridTemplateColumns: `repeat(3, ${mm(CARD_W)})`, gridAutoRows: mm(CARD_H), gap: mm(gap) }}>
        {faces.map((f) => (
          <div key={f.key} className="proxy-card" data-testid="proxy-card" data-name={f.name}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl(f.oracleId, 'display', f.face)} alt={f.name} width={672} height={936} />
            {options.label && <span className="proxy-label">Playtest proxy — not for sale</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ProxiesPage() {
  const notify = useNotify();
  const { status } = useStatus();
  const shared = useProxies();
  const [list, setList] = useState<ProxyListResponse | null>(null);
  const [options, setOptions] = useState<Options>(DEFAULTS);
  const [confirmClear, setConfirmClear] = useState(false);
  const [zipping, setZipping] = useState(false);

  useEffect(() => setOptions(loadOptions()), []);
  const setOption = <K extends keyof Options>(key: K, value: Options[K]) => {
    const next = { ...options, [key]: value };
    setOptions(next);
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(next));
    } catch {
      // private mode: the options simply do not stick
    }
  };

  const ready = status?.ready === true;
  useEffect(() => {
    if (!ready) return;
    getProxies().then(
      (res) => {
        setList(res);
        shared.sync(res);
      },
      (e) => notify.error(e),
    );
    // `shared.sync` is a state setter; listing `shared` would refetch on every list change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, notify]);

  const save = useCallback(
    async (items: ProxyItem[]) => {
      // Shown at once; the server's answer then replaces it.
      setList((cur) => (cur ? { ...cur, items, total: items.reduce((n, i) => n + i.qty, 0) } : cur));
      try {
        const res = await replaceProxies(items);
        setList(res);
        shared.sync(res);
      } catch (e) {
        notify.error(`The proxy list was not saved: ${errText(e)}`);
      }
    },
    [notify, shared],
  );
  const setQty = (oracleId: string, qty: number) => {
    if (!list) return;
    void save(list.items.map((i) => (i.oracleId === oracleId ? { ...i, qty: Math.min(99, qty) } : i)).filter((i) => i.qty >= 1));
  };

  const faces = useMemo<Face[]>(() => {
    const out: Face[] = [];
    for (const item of list?.items ?? []) {
      const card = list?.cards[item.oracleId];
      const [front, back] = (card?.name ?? 'Unknown card').split(' // ');
      for (let n = 0; n < item.qty; n++) {
        out.push({ key: `${item.oracleId}:${n}:0`, oracleId: item.oracleId, face: 0, name: card?.frontName ?? front });
        if (options.backs && card?.imageFaces === 2) out.push({ key: `${item.oracleId}:${n}:1`, oracleId: item.oracleId, face: 1, name: back ?? `${front} (back)` });
      }
    }
    return out;
  }, [list, options.backs]);
  const sheets = useMemo(() => {
    const out: Face[][] = [];
    for (let i = 0; i < faces.length; i += PER_SHEET) out.push(faces.slice(i, i + PER_SHEET));
    return out;
  }, [faces]);

  // The printed page: the chosen paper, with the sheet (cards plus the band for cut marks) centred on it.
  const paper = PAPER[options.paper];
  const sheetW = 3 * CARD_W + 2 * options.gap + 2 * MARK_PAD;
  const sheetH = 3 * CARD_H + 2 * options.gap + 2 * MARK_PAD;
  const marginX = (paper.w - sheetW) / 2;
  const marginY = (paper.h - sheetH) / 2;
  // A little less at the bottom, so rounding can never push a sheet onto a page of its own.
  const pageCss = `@page { size: ${mm(paper.w)} ${mm(paper.h)}; margin: ${mm(marginY)} ${mm(marginX)} ${mm(Math.max(0, marginY - 1))}; }`;

  const downloadZip = async () => {
    setZipping(true);
    try {
      const seen = new Map<string, number>();
      const files: { name: string; data: Uint8Array }[] = [];
      for (const f of faces.filter((x) => x.key.split(':')[1] === '0')) {
        const res = await fetch(imageUrl(f.oracleId, 'display', f.face));
        if (!res.ok) continue; // not on disk: left out, and counted below
        const base = f.name.replace(/[\\/:*?"<>|]/g, '').trim() || 'card';
        const n = (seen.get(base) ?? 0) + 1;
        seen.set(base, n);
        files.push({ name: `${base}${n > 1 ? ` (${n})` : ''}.webp`, data: new Uint8Array(await res.arrayBuffer()) });
      }
      if (files.length === 0) throw new Error('None of the images are on disk. Sync the images under Card data first.');
      const url = URL.createObjectURL(new Blob([zipStore(files)], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'proxies.zip';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      notify.info(`Saved ${files.length} images as proxies.zip`);
    } catch (e) {
      notify.error(e);
    } finally {
      setZipping(false);
    }
  };

  const total = list?.total ?? 0;
  const dfc = (list?.items ?? []).filter((i) => list?.cards[i.oracleId]?.imageFaces === 2).length;

  return (
    <div className="proxy-layout flex h-full min-h-0" data-testid="proxies-page">
      <style>{pageCss}</style>

      <aside className="no-print flex w-[21rem] shrink-0 flex-col gap-5 overflow-y-auto border-r border-slag bg-anvil p-5">
        <div>
          <h1 className="text-[1.5rem] leading-tight">Proxy sheets</h1>
          <p className="mt-1.5 text-[0.86rem] text-ash">
            Print the cards you want to try before buying them. Each sheet holds nine cards at true size, 63 by 88 mm. Print at 100% scale (no “fit to page”).
          </p>
        </div>

        <div className="grid gap-3">
          <div>
            <div className="mb-1 text-[0.8rem] text-ash">Paper</div>
            <div className="seg" role="group" aria-label="Paper size">
              {(Object.keys(PAPER) as PaperId[]).map((id) => (
                <button key={id} type="button" aria-pressed={options.paper === id} onClick={() => setOption('paper', id)} data-testid={`paper-${id}`}>{PAPER[id].label}</button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[0.8rem] text-ash">Space between cards</div>
            <div className="seg" role="group" aria-label="Space between cards">
              <button type="button" aria-pressed={options.gap === 0} onClick={() => setOption('gap', 0)} data-testid="gap-0">None (one cut)</button>
              <button type="button" aria-pressed={options.gap === 1} onClick={() => setOption('gap', 1)} data-testid="gap-1">1 mm</button>
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={options.cutMarks} onChange={(e) => setOption('cutMarks', e.target.checked)} data-testid="opt-cut" />
            <span>Cut marks at the sheet edges</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={options.backs} onChange={(e) => setOption('backs', e.target.checked)} data-testid="opt-backs" />
            <span>Print the back face of two-faced cards{dfc ? ` (${dfc} on the list)` : ''}</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={options.label} onChange={(e) => setOption('label', e.target.checked)} data-testid="opt-label" />
            <span>Mark each card “Playtest proxy — not for sale”</span>
          </label>
        </div>

        <div className="grid gap-2">
          <button type="button" className="btn btn-primary" disabled={faces.length === 0} onClick={() => window.print()} data-testid="proxy-print">
            Print / Save as PDF
          </button>
          <button type="button" className="btn" disabled={faces.length === 0 || zipping} onClick={() => void downloadZip()} data-testid="proxy-zip">
            {zipping ? 'Packing the images' : 'Download images (.zip)'}
          </button>
          <p className="text-[0.8rem] text-smoke" data-testid="proxy-summary">
            {faces.length === 0 ? 'Nothing to print yet.' : `${faces.length} ${faces.length === 1 ? 'card' : 'cards'} on ${sheets.length} ${sheets.length === 1 ? 'sheet' : 'sheets'} of ${paper.label}.`}
          </p>
        </div>

        {total > 0 && (
          <div className="mt-auto">
            {confirmClear ? (
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 text-[0.86rem]">Take all {total} off the list?</span>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => { setConfirmClear(false); void save([]); }} data-testid="proxy-clear-yes">Clear</button>
                <button type="button" className="btn btn-sm" onClick={() => setConfirmClear(false)}>Keep</button>
              </div>
            ) : (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirmClear(true)} data-testid="proxy-clear">Clear the list</button>
            )}
          </div>
        )}
      </aside>

      <div className="proxy-main min-w-0 flex-1 overflow-y-auto">
        <section className="no-print border-b border-slag px-6 py-5">
          <div className="mb-3 flex items-baseline gap-2">
            <h2 className="text-[1.15rem] leading-none">On the list</h2>
            <span className="text-[0.8rem] text-smoke">{list ? `${list.items.length} different, ${total} in all` : ''}</span>
          </div>
          {!list ? (
            <p className="text-ash">Reading the list</p>
          ) : list.items.length === 0 ? (
            <div className="max-w-[40rem] rounded-md border border-dashed border-slag p-4 text-ash" data-testid="proxy-empty">
              <p className="display text-[1.05rem] text-bone">No cards to proxy yet</p>
              <p className="mt-1">
                Open any card and choose “Proxy”, use “Proxy cards I don’t own” above a deck, or add the cards an Improve run proposes. <Link href="/" className="text-brass underline-offset-2 hover:underline">Go to your decks</Link>
              </p>
            </div>
          ) : (
            <ul className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-3" data-testid="proxy-list">
              {list.items.map((item) => {
                const card = list.cards[item.oracleId];
                const name = card?.name ?? 'Unknown card';
                return (
                  <li key={item.oracleId} data-testid="proxy-item" data-name={name}>
                    <div className="card" title={name}>
                      <CardImage id={item.oracleId} name={card?.frontName ?? name} known={!!card} />
                    </div>
                    <div className="mt-1.5 flex items-center gap-1">
                      <button type="button" className="btn btn-sm px-2" onClick={() => setQty(item.oracleId, item.qty - 1)} aria-label={`One fewer ${name}`} data-testid="proxy-less">−</button>
                      <span className="min-w-[1.6rem] flex-1 text-center" data-testid="proxy-qty">{item.qty}</span>
                      <button type="button" className="btn btn-sm px-2" onClick={() => setQty(item.oracleId, item.qty + 1)} disabled={item.qty >= 99} aria-label={`One more ${name}`} data-testid="proxy-more">+</button>
                      <button type="button" className="btn btn-sm btn-quiet px-1.5" onClick={() => setQty(item.oracleId, 0)} aria-label={`Remove ${name} from the list`} title="Remove from the list" data-testid="proxy-remove">✕</button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {sheets.length > 0 && (
          <section className="proxy-sheets px-6 py-5" aria-label="Sheets as they print">
            <h2 className="no-print mb-3 text-[1.15rem] leading-none">Sheets as they print</h2>
            {sheets.map((s, i) => <Sheet key={i} faces={s} options={options} />)}
          </section>
        )}
      </div>
    </div>
  );
}
