'use client';

import type { CommanderPageResponse } from '@/app/lib/api';
import { DeckTileView } from '@/app/components/DeckTileView';
import { EmptyState } from '@/app/components/EmptyState';

export function DecksTab({ page, name, onBuild }: { page: CommanderPageResponse; name: string; onBuild: () => void }) {
  if (page.decks.length === 0) {
    return (
      <EmptyState
        testId="decks-empty"
        message={`You have no deck with ${name} yet.`}
        action={<button type="button" className="btn btn-sm" onClick={onBuild}>Build a deck</button>}
      />
    );
  }
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-5" data-testid="commander-decks">
      {page.decks.map((d) => <DeckTileView key={d.id} deck={d} />)}
    </ul>
  );
}
