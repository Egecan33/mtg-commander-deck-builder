'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { DeckTileView } from './components/DeckTileView';
import { ImportDialog } from './components/ImportDialog';
import { useNotify, useStatus } from './components/Shell';
import { createDeck, deleteDeck, getDeck, listDecks, type DeckTile } from './lib/api';
import { fmtDate } from './lib/ui';

export default function DecksPage() {
  const router = useRouter();
  const notify = useNotify();
  const { status } = useStatus();
  const [decks, setDecks] = useState<DeckTile[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDecks((await listDecks()).decks);
      setFailed(null);
    } catch (e) {
      setFailed(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => {
    if (status?.ready) void load();
  }, [status?.ready, load]);

  const duplicate = async (tile: DeckTile) => {
    try {
      const { deck } = await getDeck(tile.id);
      // A copy is a new list, not the assembled cards: it is never built.
      await createDeck({ ...deck, id: null, name: `${deck.name} (copy)`, built: false });
      notify.info(`Duplicated ${deck.name}`);
      await load();
    } catch (e) {
      notify.error(e);
    }
  };
  const remove = async (tile: DeckTile) => {
    setConfirming(null);
    setDecks((d) => d?.filter((x) => x.id !== tile.id) ?? null);
    try {
      await deleteDeck(tile.id);
      notify.info(`Deleted ${tile.name}`);
    } catch (e) {
      notify.error(e);
      await load();
    }
  };

  return (
    <div className="mx-auto max-w-[1500px] px-8 py-7">
      <div className="flex items-end gap-3">
        <div>
          <h1 className="text-[2rem] leading-none">Your decks</h1>
          <p className="mt-2 text-ash">
            {decks === null ? 'Loading decks' : decks.length === 0 ? 'Nothing here yet.' : `${decks.length} saved ${decks.length === 1 ? 'deck' : 'decks'}, newest first.`}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          <button type="button" className="btn" onClick={() => setImporting(true)} data-testid="import-open">Import a decklist</button>
          <Link href="/new" className="btn btn-primary" data-testid="new-deck">New deck</Link>
        </div>
      </div>

      {failed && (
        <div role="alert" className="mt-6 flex items-center gap-3 rounded-md border border-band-low bg-[#3a1a16] px-4 py-3">
          <span>Could not load your decks: {failed}</span>
          <button type="button" className="btn btn-sm ml-auto" onClick={() => void load()}>Try again</button>
        </div>
      )}

      {decks?.length === 0 && !failed && (
        <div className="mt-10 grid max-w-[46rem] gap-4 rounded-lg border border-slag bg-anvil p-8">
          <h2 className="text-[1.35rem]">Start with a commander, or bring a deck you already play</h2>
          <p className="text-ash">
            Pick a commander and a bracket and Commander Forge builds a legal 100-card deck you can then change card by card. Or paste a list you already
            have: it is rated, and you get an ordered set of swaps that make it better.
          </p>
          <div className="flex gap-2">
            <Link href="/new" className="btn btn-primary">Pick a commander</Link>
            <button type="button" className="btn" onClick={() => setImporting(true)}>Import a decklist</button>
          </div>
        </div>
      )}

      <ul className="mt-7 grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-5">
        {decks?.map((d) => (
          <DeckTileView
            key={d.id}
            deck={d}
            footer={(
              <div className="flex items-center gap-1 border-t border-slag px-2.5 py-1.5">
                <span className="whitespace-nowrap px-1.5 text-[0.78rem] text-smoke">Edited {fmtDate(d.updatedAt)}</span>
                <span className="ml-auto" />
                {confirming === d.id ? (
                  <>
                    <span className="text-[0.8rem] text-ash">Delete for good?</span>
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => void remove(d)} data-testid="deck-delete-confirm">Delete</button>
                    <button type="button" className="btn btn-sm btn-quiet" onClick={() => setConfirming(null)}>Keep</button>
                  </>
                ) : (
                  <>
                    <button type="button" className="btn btn-sm btn-quiet" onClick={() => void duplicate(d)} data-testid="deck-duplicate">Duplicate</button>
                    <button type="button" className="btn btn-sm btn-quiet" onClick={() => setConfirming(d.id)} data-testid="deck-delete">Delete</button>
                  </>
                )}
              </div>
            )}
          />
        ))}
      </ul>

      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}
