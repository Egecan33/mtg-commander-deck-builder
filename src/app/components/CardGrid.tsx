'use client';

import { Children, type ComponentProps, type ReactNode } from 'react';
import { CAPTION_PX, type TileSize } from './CardTile';
import { useSectionLimit } from './Section';
import { VirtualGrid } from './VirtualGrid';

/** Narrowest tile per size, in px; the grid stretches tiles to fill the row. */
export const TILE_MIN: Record<TileSize, number> = { S: 96, M: 120, L: 168 };
export const TILE_GAP: Record<TileSize, number> = { S: 8, M: 10, L: 12 };

/** An even grid of CardTiles of one size. Inside a capped Section it shows only the first cards. */
export function CardGrid({ size = 'M', children, testId, className = '' }: { size?: TileSize; children: ReactNode; testId?: string; className?: string }) {
  const tiles = Children.toArray(children);
  const limit = useSectionLimit(tiles.length);
  const items = limit === null ? children : tiles.slice(0, limit);
  return (
    <div
      className={`grid ${className}`}
      style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${TILE_MIN[size]}px, 1fr))`, gap: TILE_GAP[size] }}
      data-testid={testId}
    >
      {items}
    </div>
  );
}

/** The same grid for very long lists (the card browser): only the rows on screen are drawn. */
export function VirtualCardGrid<T>({ size = 'M', ...rest }: Omit<ComponentProps<typeof VirtualGrid<T>>, 'minTile' | 'gap' | 'extra'> & { size?: TileSize }) {
  return <VirtualGrid<T> {...rest} minTile={TILE_MIN[size]} gap={TILE_GAP[size]} extra={CAPTION_PX} />;
}
