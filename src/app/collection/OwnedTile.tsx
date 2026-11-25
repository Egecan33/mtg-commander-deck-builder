'use client';

import { CardImage } from '../components/card';
import type { CollectionResponse } from '../lib/api';

export type Owned = CollectionResponse['cards'][number];

/** One owned card in the grid: its picture, the copy count, a "in a box" badge, and − / + on hover. */
export function OwnedTile({ card, onAdjust }: { card: Owned; onAdjust: (card: Owned, delta: number) => void }) {
  return (
    <div className="card group" title={card.name} data-testid="owned-card" data-name={card.name}>
      <CardImage id={card.oracleId} name={card.name} />
      {card.qty > 1 && <span className="absolute right-[5%] top-[3.5%] rounded bg-soot/90 px-1 text-[0.8rem] font-semibold leading-[1.35rem]">&times;{card.qty}</span>}
      {card.inBoxes > 0 && (
        <span className="absolute left-[5%] top-[3.5%] rounded bg-soot/90 px-1.5 text-[0.72rem] leading-[1.35rem] text-brass" data-testid="owned-boxed">
          {card.inBoxes} in a box
        </span>
      )}
      <div className="absolute inset-x-0 bottom-[4%] flex justify-center gap-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button type="button" className="btn btn-sm" aria-label={`Remove one ${card.name}`} title="Remove one copy" data-testid="owned-minus" onClick={() => onAdjust(card, -1)}>&minus;</button>
        <button type="button" className="btn btn-sm" aria-label={`Add one ${card.name}`} title="Add one copy" data-testid="owned-plus" onClick={() => onAdjust(card, 1)}>+</button>
      </div>
    </div>
  );
}
