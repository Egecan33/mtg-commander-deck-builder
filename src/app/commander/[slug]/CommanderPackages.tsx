'use client';

import { EmptyState } from '@/app/components/EmptyState';
import { PackagesPanel } from '@/app/deck/[id]/PackagesPanel';
import type { AverageDeck } from './useAverageDeck';

/** The average deck's package plan, read-only: the deck page's own Packages view without its actions. */
export function CommanderPackages({ avg }: { avg: AverageDeck }) {
  if (avg.error) return <EmptyState message={`Could not build the average deck: ${avg.error}`} />;
  if (avg.empty) return <EmptyState testId="packages-empty" message="None of your cards fits this commander, so there is no deck to plan packages for. Turn off Only my collection to see them." />;
  if (!avg.deck || !avg.analysis) return <p className="text-ash" data-testid="packages-loading">Planning the packages…</p>;
  return (
    <div className="overflow-hidden rounded-lg border border-slag bg-anvil" data-testid="commander-packages">
      <PackagesPanel analysis={avg.analysis} deck={avg.deck} readOnly />
    </div>
  );
}
