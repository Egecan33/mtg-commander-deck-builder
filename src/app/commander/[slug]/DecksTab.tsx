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
  // A single commander's list also holds the decks that pair it with a partner.
  const withPartner = page.commanders.length === 1 && page.decks.some((d) => d.commanders.length > 1);
  return (
    <>
      {withPartner && <p className="mb-3 text-ash" data-testid="decks-partner-note">Includes decks where {name} is paired with a partner.</p>}
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-5" data-testid="commander-decks">
        {page.decks.map((d) => <DeckTileView key={d.id} deck={d} />)}
      </ul>
    </>
  );
}
