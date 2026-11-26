'use client';

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { DataAttrs } from './CardTile';
import { useJumpTarget } from './JumpRail';

interface Limit {
  /** How many tiles each CardGrid shows; null for all. */
  limit: number | null;
  /** A CardGrid reports how many tiles it has (null when it unmounts). */
  report: (grid: string, tiles: number | null) => void;
}
const LimitContext = createContext<Limit | null>(null);

/**
 * For a CardGrid: how many of its `tiles` to show (null for all). Inside a capped, closed Section it
 * shows the first `cap` tiles and tells the Section how many it has, so "Show all N" counts tiles.
 */
export function useSectionLimit(tiles: number): number | null {
  const ctx = useContext(LimitContext);
  const grid = useId();
  const report = ctx?.report;
  useEffect(() => {
    if (!report) return;
    report(grid, tiles);
    return () => report(grid, null);
  }, [report, grid, tiles]);
  return ctx?.limit ?? null;
}

/**
 * A titled group of cards: the title in the display serif with its count beside it, optional
 * actions on the right, then the content. With `cap`, the CardGrid inside shows its first `cap`
 * tiles, and when it has more a "Show all N" button (N = its tiles) opens the rest. Inside a
 * JumpScope the section lists itself in the JumpRail.
 */
export function Section({
  id, title, count, actions, cap, children, testId, data, className = '',
}: {
  id: string;
  title: string;
  /** The number beside the title (copies, so ×4 counts four). */
  count?: number;
  actions?: ReactNode;
  /** Tiles shown before "Show all". */
  cap?: number;
  children: ReactNode;
  testId?: string;
  data?: DataAttrs;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [grids, setGrids] = useState<Readonly<Record<string, number>>>({});
  useJumpTarget(id, title, count, ref);
  const report = useCallback((grid: string, tiles: number | null) => {
    setGrids((g) => {
      if (tiles === null) {
        if (!(grid in g)) return g;
        const next = { ...g };
        delete next[grid];
        return next;
      }
      return g[grid] === tiles ? g : { ...g, [grid]: tiles };
    });
  }, []);
  const tiles = Object.values(grids).reduce((s, n) => s + n, 0);
  const limit = cap !== undefined && !open ? cap : null;
  const hidden = limit !== null && tiles > limit;
  return (
    <section ref={ref} id={id} tabIndex={-1} aria-labelledby={`${id}-title`} className={`mb-5 ${className}`} data-testid={testId} {...data}>
      <header className="sticky top-0 z-10 flex items-baseline gap-2 bg-soot/95 pb-2 pt-2.5">
        <h3 id={`${id}-title`} className="text-[18px] leading-tight">{title}</h3>
        {count !== undefined && <span className="text-[13px] text-smoke" data-testid="section-count">{count}</span>}
        {actions && <div className="ml-auto flex items-center gap-1.5 self-center">{actions}</div>}
      </header>
      <LimitContext.Provider value={cap === undefined ? null : { limit, report }}>{children}</LimitContext.Provider>
      {hidden && (
        <button type="button" className="btn btn-sm btn-quiet mt-2" onClick={() => setOpen(true)} data-testid="section-show-all">
          Show all {tiles}
        </button>
      )}
    </section>
  );
}
