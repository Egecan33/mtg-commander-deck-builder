'use client';

import { createContext, useContext, useRef, useState, type ReactNode } from 'react';
import type { DataAttrs } from './CardTile';
import { useJumpTarget } from './JumpRail';

const LimitContext = createContext<number | null>(null);
/** How many tiles a CardGrid inside a capped, closed Section shows; null for all. */
export const useSectionLimit = () => useContext(LimitContext);

/**
 * A titled group of cards: the title in the display serif with its count beside it, optional
 * actions on the right, then the content. With `cap`, a CardGrid inside shows the first `cap` cards
 * and a "Show all N" button opens the rest. Inside a JumpScope the section lists itself in the JumpRail.
 */
export function Section({
  id, title, count, actions, cap, children, testId, data, className = '',
}: {
  id: string;
  title: string;
  count?: number;
  actions?: ReactNode;
  cap?: number;
  children: ReactNode;
  testId?: string;
  data?: DataAttrs;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  useJumpTarget(id, title, count, ref);
  const capped = cap !== undefined && !open && count !== undefined && count > cap;
  return (
    <section ref={ref} id={id} tabIndex={-1} aria-labelledby={`${id}-title`} className={`mb-5 ${className}`} data-testid={testId} {...data}>
      <header className="sticky top-0 z-10 flex items-baseline gap-2 bg-soot/95 pb-2 pt-2.5">
        <h3 id={`${id}-title`} className="text-[18px] leading-tight">{title}</h3>
        {count !== undefined && <span className="text-[13px] text-smoke" data-testid="section-count">{count}</span>}
        {actions && <div className="ml-auto flex items-center gap-1.5 self-center">{actions}</div>}
      </header>
      <LimitContext.Provider value={capped ? cap : null}>{children}</LimitContext.Provider>
      {capped && (
        <button type="button" className="btn btn-sm btn-quiet mt-2" onClick={() => setOpen(true)} data-testid="section-show-all">
          Show all {count}
        </button>
      )}
    </section>
  );
}
