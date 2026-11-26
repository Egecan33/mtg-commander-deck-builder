'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import type { DeckTile } from '../lib/api';
import { commanderHref } from '../lib/links';
import { BAND_VAR, bandOf, bracketName, fmtDate } from '../lib/ui';
import { ArtCrop } from './ArtCrop';

/** A saved deck as a tile: its commanders' art, rating, bracket and chips. `footer` is the row of actions under it (the date when absent). */
export function DeckTileView({ deck: d, footer }: { deck: DeckTile; footer?: ReactNode }) {
  const router = useRouter();
  const broken = !d.legal && d.cardCount >= 100;
  const band = broken ? 'low' : bandOf(d.rating);
  return (
    <li className="group overflow-hidden rounded-lg border border-slag bg-anvil" data-testid="deck-tile">
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
                  <div
                    className="display absolute bottom-2 right-3 flex h-12 min-w-12 items-center justify-center rounded-md px-2 text-[1.6rem] font-bold text-[#15110a] shadow-lg"
                    style={{ background: BAND_VAR[band] }}
                    title={broken ? 'Not legal: the rating is capped' : d.cardCount < 100 ? 'Rating so far, out of 100' : 'Deck rating out of 100'}
                  >
                    {Math.round(d.rating)}
                  </div>
                </div>
                <div className="px-4 pt-2">
                  <h2 className="truncate text-[1.2rem] leading-snug">{d.name}</h2>
                </div>
              </button>
              <div className="px-4 pb-3">
                <p className="truncate text-ash" data-testid="deck-tile-commanders">
                  {d.commanders.length === 0
                    ? 'Choose a commander in the builder'
                    : d.commanders.map((c, i) => (
                        <span key={c.oracleId}>
                          {i > 0 && ' and '}
                          <Link href={d.commanders.length === 2 ? commanderHref(d.commanders[0], d.commanders[1], d.chosenColor) : commanderHref(c, undefined, d.chosenColor)} className="hover:text-bone hover:underline" title="Open the commander page" data-testid="deck-tile-commander">
                            {c.name}
                          </Link>
                        </span>
                      ))}
                </p>
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  <span className="chip text-bone">Bracket {d.targetBracket}, {bracketName(d.targetBracket)}</span>
                  <span className={`chip ${d.cardCount === 100 ? '' : 'border-band-mid text-band-mid'}`}>{d.cardCount} / 100</span>
                  {d.built && <span className="chip border-brass text-brass" title="The cards are really in this deck" data-testid="deck-built-chip">Built</span>}
                  {broken && <span className="chip border-band-low text-band-low">Not legal</span>}
                  {d.playsLike !== d.targetBracket && <span className="chip">plays like {d.playsLike}</span>}
                  {d.combos > 0 && <span className="chip" data-testid="tile-combos">{d.combos} {d.combos === 1 ? 'combo' : 'combos'}</span>}
                </div>
              </div>
      {footer ?? (
        <div className="flex items-center gap-1 border-t border-slag px-2.5 py-1.5">
          <span className="whitespace-nowrap px-1.5 text-[0.78rem] text-smoke">Edited {fmtDate(d.updatedAt)}</span>
        </div>
      )}
    </li>
  );
}
