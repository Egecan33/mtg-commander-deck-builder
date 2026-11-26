'use client';

import { useEffect, useRef } from 'react';
import { EmptyState } from '@/app/components/EmptyState';
import { PackagesPanel } from '@/app/deck/[id]/PackagesPanel';
import type { AverageDeck } from './useAverageDeck';

/**
 * The average deck's package plan, read-only: the deck page's own Packages view without its actions.
 * Building it costs a deck build and an analysis, so it starts (`onWanted`) only when this section
 * scrolls close to the view or "Plan the packages" is used.
 */
export function CommanderPackages({ avg, wanted, onWanted }: { avg: AverageDeck; wanted: boolean; onWanted: () => void }) {
  const mark = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = mark.current;
    if (wanted || !el) return;
    if (typeof IntersectionObserver === 'undefined') { onWanted(); return; }
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) onWanted(); }, { rootMargin: '300px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [wanted, onWanted]);

  if (!wanted) {
    return (
      <div ref={mark} className="flex items-center gap-3 text-ash" data-testid="packages-idle">
        <span>The package plan loads when you reach it.</span>
        <button type="button" className="btn btn-sm" onClick={onWanted}>Plan the packages</button>
      </div>
    );
  }
  if (avg.error) return <EmptyState message={`Could not build the average deck: ${avg.error}`} />;
  if (avg.empty) return <EmptyState testId="packages-empty" message="None of your cards fits this commander, so there is no deck to plan packages for. Turn off Only my collection to see them." />;
  if (!avg.deck || !avg.analysis) return <p className="text-ash" data-testid="packages-loading">Planning the packages…</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-slag bg-anvil" data-testid="commander-packages">
      <PackagesPanel analysis={avg.analysis} deck={avg.deck} readOnly />
    </div>
  );
}
