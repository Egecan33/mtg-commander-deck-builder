'use client';

import type { ReactNode } from 'react';
import type { ClientCard } from '../lib/api';
import type { TileSize } from '../lib/filters';
import { BAND_VAR, bandOf } from '../lib/ui';
import { CardImage } from './card';
import { HeldMark, heldText } from './held';

export type { TileSize } from '../lib/filters';
/** `in-deck`: a search result that is already in the open deck. */
export type TileMark = 'weakest' | 'locked' | 'illegal' | 'in-deck';
export interface TileStat { label: string; value: string; title?: string }
export type DataAttrs = { [k: `data-${string}`]: string | number | boolean | undefined };

/** Height in px the caption row adds under the image (4 px gap + 20 px row). Grids that place tiles themselves add it to each row. */
export const CAPTION_PX = 24;

/** A stand-in for a deck card the card database does not know, so it can still be shown and removed. */
export function unknownCard(oracleId: string): ClientCard {
  return {
    oracleId, name: 'Unknown card', frontName: 'Unknown card', manaCost: '', cmc: 0, typeLine: '', colorIdentity: [], imageFaces: 1,
    gameChanger: false, priceUsd: null, roles: [], owned: false, arenaRarity: null,
  };
}

export const LockIcon = ({ open = false, size = 11 }: { open?: boolean; size?: number }) => (
  <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden fill="currentColor">
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d={open ? 'M5 7V5a3 3 0 0 1 5.6-1.5' : 'M5 7V5a3 3 0 0 1 6 0v2'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

/** The score as a small plate in its band colour; "–" with the reason as its title when the card cannot go in. */
function ScoreChip({ score, gate }: { score: number | null | undefined; gate: string | null | undefined }) {
  if (score == null && !gate) return null;
  const band = bandOf(score ?? 0, !!gate);
  return (
    <span
      data-testid="score-badge"
      data-band={band}
      role="img"
      aria-label={gate ? `No score: ${gate}` : `Score ${score} of 100`}
      title={gate ? gate : `Score ${score} of 100 for this deck`}
      className="inline-flex h-[18px] min-w-[1.6rem] shrink-0 items-center justify-center rounded-[4px] px-1 text-[13px] font-bold leading-none text-[#15110a]"
      style={{ background: BAND_VAR[band] }}
    >
      {gate ? '–' : score}
    </span>
  );
}

const OUTLINE: Partial<Record<TileMark, string>> = {
  illegal: 'outline outline-2 outline-band-low',
  weakest: 'outline outline-2 outline-band-mid',
  'in-deck': 'outline outline-2 outline-ash',
};

/**
 * A card as an image with one caption row underneath: score, owned dot, "!" with its holders, marks
 * and stats. Nothing sits over the card's name or mana cost; `actions` (small round buttons) sit at
 * the bottom right of the image. With `onOpen` the image is a button, so the tile takes keyboard focus.
 */
export function CardTile({
  card, size = 'M', score, gate, stats, heldBy, marks = [], qty, status, onOpen, actions, known = true, dim = false, testId, data,
}: {
  card: ClientCard;
  size?: TileSize;
  /** 0-100 for this deck, or null when there is none. */
  score?: number | null;
  /** Why the card cannot go in this deck (off colour, banned, over the bracket). The chip shows "–". */
  gate?: string | null;
  stats?: TileStat[];
  /** Names of the boxes and built decks holding the copies this card would take. */
  heldBy?: readonly string[];
  marks?: readonly TileMark[];
  /** Copies in the deck: shown as ×N when more than one. */
  qty?: number;
  /** The word an `in-deck` tile shows instead of "In deck" ("Commander"). */
  status?: string;
  onOpen?: () => void;
  actions?: ReactNode;
  /** False for a card the database does not know: a named placeholder is drawn instead of the image. */
  known?: boolean;
  /** Greys the image (a search result that cannot go in); the reason shows on hover. */
  dim?: boolean;
  testId?: string;
  data?: DataAttrs;
}) {
  const name = card.name;
  const held = heldBy && heldBy.length > 0 ? heldBy : undefined;
  const has = (m: TileMark) => marks.includes(m);
  const outline = has('illegal') ? OUTLINE.illegal : has('weakest') ? OUTLINE.weakest : has('in-deck') ? OUTLINE['in-deck'] : '';
  const word = has('illegal')
    ? { text: 'Not legal', cls: 'text-band-low' }
    : has('weakest')
      ? { text: 'weakest', cls: 'text-band-mid' }
      : has('in-deck')
        ? { text: status ?? 'In deck', cls: 'text-bone' }
        : null;
  const title = gate && (has('illegal') || dim)
    ? `${name}: ${gate}`
    : has('weakest')
      ? `${name}: one of the weakest cards in the deck`
      : held
        ? `${name}: ${heldText(held)}`
        : name;
  const image = <CardImage id={card.oracleId} name={name} known={known} />;

  return (
    <div className="group min-w-0" title={title} data-testid={testId} data-size={size} {...data}>
      <div className={`card tile-frame ${dim ? 'gated' : ''} ${outline}`}>
        {onOpen ? (
          <button type="button" className="tile-open block h-full w-full cursor-zoom-in" onClick={onOpen} aria-label={`Details for ${name}`}>
            {image}
          </button>
        ) : (
          image
        )}
        {dim && gate && (
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 hidden max-h-[70%] overflow-hidden bg-[rgb(19_16_12/0.94)] p-2 text-[13px] leading-snug text-bone group-focus-within:block group-hover:block"
            data-testid="gate-reason"
          >
            {gate}
          </div>
        )}
        {actions && <div className="absolute bottom-[4%] right-[5%] flex gap-1">{actions}</div>}
      </div>

      <div className="mt-1 flex h-5 items-center gap-1.5 overflow-hidden text-[13px] leading-none" data-testid="tile-caption">
        <ScoreChip score={score} gate={gate} />
        {card.owned && <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-ash" title="In your collection" aria-label="In your collection" role="img" data-testid="owned-dot" />}
        {held && <HeldMark names={held} small />}
        {has('locked') && (
          <span className="shrink-0 text-ash" title="Locked: auto-build and improve keep this card" aria-label="Locked" role="img" data-testid="tile-locked">
            <LockIcon size={12} />
          </span>
        )}
        {word && <span className={`min-w-0 truncate ${word.cls}`}>{word.text}</span>}
        {((stats && stats.length > 0) || (qty ?? 1) > 1) && (
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            {stats?.map((s) => (
              <span key={s.label + s.value} className="text-ash" title={s.title ?? s.label} data-testid="tile-stat">
                {s.value}
                {size !== 'S' && s.label && <span className="ml-0.5 text-smoke">{s.label}</span>}
              </span>
            ))}
            {(qty ?? 1) > 1 && <span className="text-bone" title={`${qty} copies`} data-testid="tile-qty">&times;{qty}</span>}
          </span>
        )}
      </div>
    </div>
  );
}
