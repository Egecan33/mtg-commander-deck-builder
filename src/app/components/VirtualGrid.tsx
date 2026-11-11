'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Key, type ReactNode } from 'react';
import { isAbort } from '../lib/ui';

const CARD_RATIO = 88 / 63;

/**
 * A window onto a long list of card tiles. Only the rows on screen (plus two either side) are in
 * the DOM, so 32,000 cards scroll like 30. Items load through `ensure` as their rows come into view.
 */
export function VirtualGrid<T>({
  count, itemAt, ensure, render, keyOf, minTile = 128, gap = 10, resetKey, testId, empty,
}: {
  count: number;
  itemAt: (index: number) => T | undefined;
  ensure: (start: number, end: number) => void;
  render: (item: T, index: number) => ReactNode;
  keyOf: (item: T) => Key;
  minTile?: number;
  gap?: number;
  /** Scrolls back to the top when it changes (a new search, not a re-score). */
  resetKey?: string;
  testId?: string;
  empty?: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [viewH, setViewH] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const frame = useRef(0);

  useLayoutEffect(() => {
    const el = scroller.current;
    const box = inner.current;
    if (!el || !box) return;
    const measure = () => {
      setWidth(box.clientWidth);
      setViewH(el.clientHeight);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
    setScrollTop(0);
  }, [resetKey]);

  const cols = Math.max(1, Math.floor((width + gap) / (minTile + gap)));
  const tileW = width > 0 ? (width - gap * (cols - 1)) / cols : minTile;
  const rowH = tileW * CARD_RATIO + gap;
  const rows = Math.ceil(count / cols);
  const first = Math.max(0, Math.floor(scrollTop / rowH) - 2);
  const last = Math.min(rows - 1, Math.ceil((scrollTop + viewH) / rowH) + 2);
  const start = first * cols;
  const end = Math.min(count, (last + 1) * cols);

  useEffect(() => {
    // Always ask for at least the first item: a list that was empty under the last query must still load.
    if (width > 0) ensure(start, Math.max(end, start + 1));
  }, [ensure, start, end, width]);

  const onScroll = useCallback(() => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      if (scroller.current) setScrollTop(scroller.current.scrollTop);
    });
  }, []);

  const tiles: ReactNode[] = [];
  if (width > 0) {
    for (let i = start; i < end; i++) {
      const item = itemAt(i);
      const x = (i % cols) * (tileW + gap);
      const y = Math.floor(i / cols) * rowH;
      tiles.push(
        <div
          key={item !== undefined ? keyOf(item) : `empty-${i}`}
          className="absolute left-0 top-0"
          style={{ width: tileW, transform: `translate(${x}px, ${y}px)` }}
        >
          {item !== undefined ? render(item, i) : <div className="card skeleton" />}
        </div>,
      );
    }
  }

  return (
    <div className="relative h-full min-h-0">
      <div ref={scroller} onScroll={onScroll} className="absolute inset-0 overflow-y-auto overscroll-contain px-3 pb-3 pt-1" data-testid={testId}>
        <div ref={inner} className="relative" style={{ height: Math.max(0, rows * rowH - gap) }}>
          {tiles}
        </div>
        {count === 0 && empty}
      </div>
    </div>
  );
}

/**
 * Pages of a server-side list, fetched on demand. `key` names the query: when it changes the old
 * pages stay on screen until the first page of the new answer arrives, then they are dropped.
 */
export function usePaged<T>(
  key: string,
  pageSize: number,
  fetchPage: (page: number, signal: AbortSignal) => Promise<{ total: number; items: T[] }>,
  onError: (e: unknown) => void,
) {
  const store = useRef({
    pages: new Map<number, { key: string; items: T[] }>(),
    inflight: new Set<string>(),
    failed: new Set<string>(),
    ctrls: new Map<string, AbortController>(),
  });
  const latestKey = useRef(key);
  latestKey.current = key;
  const fetcher = useRef(fetchPage);
  fetcher.current = fetchPage;
  const report = useRef(onError);
  report.current = onError;
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [, setTick] = useState(0);

  useEffect(() => {
    const s = store.current;
    return () => {
      s.ctrls.get(key)?.abort();
      s.ctrls.delete(key);
    };
  }, [key]);

  const ensure = useCallback(
    (start: number, end: number) => {
      const s = store.current;
      const firstPage = Math.floor(start / pageSize);
      const lastPage = Math.floor(Math.max(start, end - 1) / pageSize);
      for (let page = firstPage; page <= lastPage; page++) {
        const tag = `${key}|${page}`;
        if (s.pages.get(page)?.key === key || s.inflight.has(tag) || s.failed.has(tag)) continue;
        let ctrl = s.ctrls.get(key);
        if (!ctrl) {
          ctrl = new AbortController();
          s.ctrls.set(key, ctrl);
        }
        s.inflight.add(tag);
        setLoading(true);
        fetcher.current(page + 1, ctrl.signal).then(
          (res) => {
            s.inflight.delete(tag);
            if (latestKey.current !== key) return;
            for (const [p, entry] of s.pages) if (entry.key !== key) s.pages.delete(p);
            s.pages.set(page, { key, items: res.items });
            setTotal(res.total);
            setLoading(s.inflight.size > 0);
            setTick((t) => t + 1);
          },
          (e) => {
            s.inflight.delete(tag);
            if (latestKey.current !== key) return;
            if (isAbort(e)) {
              // Aborted while still wanted (a remount): ask again on a fresh controller.
              setTimeout(() => ensureRef.current(page * pageSize, page * pageSize + 1), 0);
              return;
            }
            s.failed.add(tag);
            setLoading(s.inflight.size > 0);
            report.current(e);
          },
        );
      }
    },
    [key, pageSize],
  );

  const ensureRef = useRef(ensure);
  ensureRef.current = ensure;

  const itemAt = useCallback(
    (index: number): T | undefined => {
      const page = Math.floor(index / pageSize);
      return store.current.pages.get(page)?.items[index - page * pageSize];
    },
    [pageSize],
  );

  return { total, loading, ensure, itemAt };
}
