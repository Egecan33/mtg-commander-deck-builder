'use client';

import { useState } from 'react';
import { imageUrl, type ClientCard } from '../lib/api';

/** The art box of a card image (roughly 7.5-92.5% across, 11-55% down), used as a deck's or commander's face. */
export function ArtCrop({ card, className = 'min-w-0 flex-1' }: { card: Pick<ClientCard, 'oracleId' | 'name'>; className?: string }) {
  const [gone, setGone] = useState(false);
  return (
    <div className={`relative overflow-hidden bg-iron ${className}`} style={{ aspectRatio: '1.36' }}>
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
