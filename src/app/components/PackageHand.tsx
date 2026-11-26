'use client';

import type { ClientCard, HeldBy } from '../lib/api';
import { CardImage } from './card';
import { HeldMark } from './held';

const SPREAD_DEG = 12;
const LIFT_PX = 6;

/**
 * A package as a hand of cards: overlapping images fanned about ±12°, spreading into a row while
 * the pointer is over the hand or the focus is inside it (no transition under reduced motion).
 * Every card is a button that opens its detail. One caption line below names the holders of any
 * held card (the "!"), never over the cards.
 */
export function PackageHand({
  cards, heldBy, onOpen, testId = 'package-hand',
}: {
  cards: ClientCard[];
  heldBy?: HeldBy;
  onOpen: (oracleId: string) => void;
  testId?: string;
}) {
  const n = cards.length;
  const held = cards.filter((c) => (heldBy?.[c.oracleId]?.length ?? 0) > 0);
  const holders = [...new Set(held.flatMap((c) => heldBy?.[c.oracleId] ?? []))];
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="group flex items-end pb-3 pt-3" role="group" aria-label="The best cards of this package. Hover or tab into the hand to spread it." data-testid="package-hand-cards">
        {cards.map((c, i) => {
          const t = n > 1 ? (i / (n - 1)) * 2 - 1 : 0; // -1 .. 1 across the hand
          return (
            <button
              key={c.oracleId}
              type="button"
              className="card relative w-[104px] shrink-0 cursor-zoom-in transition-[margin,transform] duration-200 ease-out focus-visible:z-10 motion-reduce:transition-none [transform:translateY(var(--lift))_rotate(var(--rot))] group-focus-within:!ml-1.5 group-focus-within:[transform:none] group-hover:!ml-1.5 group-hover:[transform:none] hover:z-10"
              style={{
                marginLeft: i === 0 ? 0 : -46,
                zIndex: i,
                ['--rot' as string]: `${(t * SPREAD_DEG).toFixed(1)}deg`,
                ['--lift' as string]: `${(t * t * LIFT_PX).toFixed(1)}px`,
              }}
              onClick={() => onOpen(c.oracleId)}
              aria-label={`Details for ${c.name}`}
              title={c.name}
              data-testid="package-hand-card"
              data-id={c.oracleId}
            >
              <CardImage id={c.oracleId} name={c.frontName} known />
            </button>
          );
        })}
      </div>
      <p className="flex min-h-5 items-center gap-1.5 text-[13px] text-ash" data-testid="package-hand-caption">
        {held.length > 0 ? (
          <>
            <HeldMark names={holders} small />
            <span className="text-ember">{held.length === 1 ? `${held[0]!.frontName} is` : `${held.length} cards are`} held by {holders.join(', ')}</span>
          </>
        ) : null}
      </p>
    </div>
  );
}
