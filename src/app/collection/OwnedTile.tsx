'use client';

import { CardImage } from '../components/card';
import type { CollectionResponse } from '../lib/api';

export type Owned = CollectionResponse['cards'][number];

/**
 * One owned card in the grid: its picture, the copy count, a "in a box" badge, and − / + on hover.
 * `qty` 0 is a card whose last copy was just removed: it keeps its cell ("0 left", + only), so the
 * next card does not slide under the pointer. `busy`: another grid change is still saving.
 */
export function OwnedTile({ card, busy, onAdjust }: { card: Owned; busy: boolean; onAdjust: (card: Owned, delta: number) => void }) {
  const gone = card.qty === 0;
  return (
    <div className="card group" title={card.name} data-testid="owned-card" data-name={card.name} data-gone={gone || undefined}>
      <CardImage id={card.oracleId} name={card.name} />
      {card.qty > 1 && <span className="absolute right-[5%] top-[3.5%] rounded bg-soot/90 px-1 text-[0.8rem] font-semibold leading-[1.35rem]">&times;{card.qty}</span>}
      {gone && (
        <div className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-soot/75" data-testid="owned-gone">
          <span className="rounded bg-soot px-1.5 text-[0.8rem] font-semibold leading-[1.35rem] text-ash">0 left</span>
        </div>
      )}
      {card.inBoxes > 0 && (
        <span className="absolute bottom-[3.5%] left-[5%] rounded bg-soot/90 px-1.5 text-[0.72rem] leading-[1.35rem] text-brass transition-opacity group-focus-within:opacity-0 group-hover:opacity-0" data-testid="owned-boxed">
          {card.inBoxes} in a box
        </span>
      )}
      <div className="absolute inset-x-0 bottom-[4%] flex justify-center gap-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          type="button"
          className="btn btn-sm"
          aria-label={`Remove one ${card.name}`}
          title={gone ? 'No copy left' : 'Remove one copy'}
          disabled={busy || gone}
          data-testid="owned-minus"
          onClick={() => onAdjust(card, -1)}
        >
          &minus;
        </button>
        <button type="button" className="btn btn-sm" aria-label={`Add one ${card.name}`} title="Add one copy" disabled={busy} data-testid="owned-plus" onClick={() => onAdjust(card, 1)}>+</button>
      </div>
    </div>
  );
}
