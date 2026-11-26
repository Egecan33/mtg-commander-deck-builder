'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import type { ClientCard, CommanderTile } from '../lib/api';
import { commanderHref } from '../lib/links';
import { ArtCrop } from './ArtCrop';
import { ColorPip } from './card';
import { CAPTION_PX } from './CardTile';

/**
 * A commander as a tile that opens its page: art crop, name in the display serif, colour pips
 * (C when colourless), an owned dot and one caption row. `fill` makes it as tall as a card tile
 * with a caption (for VirtualGrid rows).
 */
export function CommanderTileView({
  commander, caption, captionTitle, size = 'M', href, fill = false,
}: {
  commander: CommanderTile | (ClientCard & { slug?: string });
  caption?: ReactNode;
  captionTitle?: string;
  size?: 'S' | 'M';
  href?: string;
  fill?: boolean;
}) {
  const small = size === 'S';
  const body = (
    <Link
      href={href ?? commanderHref(commander)}
      className="group flex h-full w-full flex-col overflow-hidden rounded-lg border border-slag bg-anvil transition-transform hover:-translate-y-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brass"
      data-testid="commander-tile-link"
      title={commander.name}
    >
      <ArtCrop card={commander} className="w-full shrink-0" />
      <div className={`flex min-w-0 flex-1 flex-col ${small ? 'gap-0.5 px-2 py-1.5' : 'gap-1 px-3 py-2'}`}>
        <span className={`display truncate leading-tight ${small ? 'text-[13px]' : 'text-[15px]'}`} data-testid="commander-tile-name">{commander.frontName}</span>
        <span className="flex items-center gap-1">
          {(commander.colorIdentity.length ? commander.colorIdentity : ['C']).map((c) => <ColorPip key={c} color={c} size={small ? '0.95rem' : '1.05rem'} />)}
          {commander.owned && <span className="ml-1 h-[7px] w-[7px] shrink-0 rounded-full bg-ash" title="In your collection" role="img" aria-label="In your collection" data-testid="owned-dot" />}
        </span>
        {caption && <span className="mt-auto truncate text-[13px] text-ash" title={captionTitle} data-testid="commander-tile-caption">{caption}</span>}
      </div>
    </Link>
  );
  if (!fill) return body;
  return (
    <div style={{ containerType: 'inline-size' }}>
      <div style={{ height: `calc(100cqw * 1.3968 + ${CAPTION_PX}px)` }}>{body}</div>
    </div>
  );
}
