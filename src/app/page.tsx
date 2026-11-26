'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ImportDialog } from './components/ImportDialog';
import { useCollections, useNotify, useStatus } from './components/Shell';
import { createDeck, deleteDeck, getDeck, imageUrl, listDecks, type ClientCard, type DeckTile } from './lib/api';
import { BAND_VAR, bandOf, bracketName, fmtDate } from './lib/ui';

/** The art box of a card image (roughly 7.5-92.5% across, 11-55% down), used as a deck's face. */
function ArtCrop({ card }: { card: ClientCard }) {
  const [gone, setGone] = useState(false);
  return (
    <div className="relative min-w-0 flex-1 overflow-hidden bg-iron" style={{ aspectRatio: '1.36' }}>
      {gone ? (
        <div className="display flex h-full items-center justify-center px-3 text-center text-ash">{card.name}</div>
      ) : (
        <img
          src={imageUrl(card.oracleId, 'display')}
          alt={card.name}
          className="absolute max-w-none"
          style={{ width: '118%', left: '-9%', top: 0, marginTop: '-20%' }}
          onError={() => setGone(true)}
          onLoad={(e) => {
            if (e.currentTarget.naturalWidth === 252) setGone(true);
          }}
        />
      )}
    </div>
  );
}

export default function DecksPage() {
  const router = useRouter();
  const notify = useNotify();
  const { status } = useStatus();
  // The list shows the active collection's decks (each deck belongs to one collection).
  const { active, collections } = useCollections();
  const other = collections.find((c) => c.id !== active?.id) ?? null;
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
          <h1 className="text-[2rem] leading-none" data-testid="decks-heading">{active ? `Your ${active.name} decks` : 'Your decks'}</h1>
          <p className="mt-2 text-ash">
            {decks === null ? 'Loading decks' : decks.length === 0 ? 'Nothing here yet.' : `${decks.length} saved ${decks.length === 1 ? 'deck' : 'decks'}, newest first.`}
            {active?.kind === 'arena' ? ' Built for MTG Arena Brawl, from cards on Arena. ' : ' '}
            {other && <span className="text-smoke">Your {other.name} decks show when you switch the collection in the top bar.</span>}
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
            Pick a commander and Commander Forge builds a legal deck (100 cards, or 60 in Standard Brawl) you can then change card by card. Or paste a list you already
            have: it is rated, and you get an ordered set of swaps that make it better.
          </p>
          <div className="flex gap-2">
            <Link href="/new" className="btn btn-primary">Pick a commander</Link>
            <button type="button" className="btn" onClick={() => setImporting(true)}>Import a decklist</button>
          </div>
        </div>
      )}

      <ul className="mt-7 grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-5">
        {decks?.map((d) => {
          const size = d.format === 'standardbrawl' ? 60 : 100;
          const broken = !d.legal && d.cardCount >= size;
          const band = broken ? 'low' : bandOf(d.rating);
          return (
            <li key={d.id} className="group overflow-hidden rounded-lg border border-slag bg-anvil" data-testid="deck-tile">
              <button
                type="button"
                className="block w-full text-left"
                onClick={() => router.push(`/deck/${d.id}`)}
                aria-label={`Open ${d.name}`}
              >
                <div className="relative flex">
                  {d.commanders.length ? d.commanders.slice(0, 2).map((c) => <ArtCrop key={c.oracleId} card={c} />) : (
                    <div className="display flex w-full items-center justify-center bg-iron text-ash" style={{ aspectRatio: '1.36' }}>No commander yet</div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-anvil to-transparent" />
                  <div className="absolute bottom-2 right-3 flex items-end gap-2">
                    <div
                      className="display flex h-12 min-w-12 items-center justify-center rounded-md px-2 text-[1.6rem] font-bold text-[#15110a] shadow-lg"
                      style={{ background: BAND_VAR[band] }}
                      title={broken ? 'Not legal: the rating is capped' : d.cardCount < size ? 'Rating so far, out of 100' : 'Deck rating out of 100'}
                    >
                      {Math.round(d.rating)}
                    </div>
                  </div>
                </div>
                <div className="px-4 pb-3 pt-2">
                  <h2 className="truncate text-[1.2rem] leading-snug">{d.name}</h2>
                  <p className="truncate text-ash">{d.commanders.map((c) => c.name).join(' and ') || 'Choose a commander in the builder'}</p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {d.format === 'standardbrawl' ? (
                      <span className="chip text-bone" data-testid="tile-format">Standard Brawl</span>
                    ) : (
                      <span className="chip text-bone">Bracket {d.targetBracket}, {bracketName(d.targetBracket)}</span>
                    )}
                    <span className={`chip ${d.cardCount === size ? '' : 'border-band-mid text-band-mid'}`}>{d.cardCount} / {size}</span>
                    {/* in the caption row, not over the art (app map) */}
                    <span className="chip tabular-nums" title="How well the cards work together, out of 100" data-testid="deck-cohesion">Cohesion {d.cohesion}</span>
                    {d.built && <span className="chip border-brass text-brass" title="The cards are really in this deck" data-testid="deck-built-chip">Built</span>}
                    {broken && <span className="chip border-band-low text-band-low">Not legal</span>}
                    {d.format !== 'standardbrawl' && d.playsLike !== d.targetBracket && <span className="chip">plays like {d.playsLike}</span>}
                    {d.combos > 0 && <span className="chip" data-testid="tile-combos">{d.combos} {d.combos === 1 ? 'combo' : 'combos'}</span>}
                  </div>
                </div>
              </button>
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
            </li>
          );
        })}
      </ul>

      {importing && <ImportDialog onClose={() => setImporting(false)} />}
    </div>
  );
}
