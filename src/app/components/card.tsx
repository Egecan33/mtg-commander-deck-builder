'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { CardScore } from '@/engine/types';
import { imageUrl, type ImageSize } from '../lib/api';
import { BAND_VAR, bandOf } from '../lib/ui';

/** The server's stand-in for a file that is not on disk is an SVG exactly this wide. */
const SERVER_PLACEHOLDER_WIDTH = 252;

/**
 * A card picture from the local image route. When the file is missing (or the card is not in the
 * database at all) it draws a tile with the card's name instead, so a deck never shows a hole.
 */
export function CardImage({
  id, name, size = 'grid', face = 0, known = true,
}: { id: string; name: string; size?: ImageSize; face?: 0 | 1; known?: boolean }) {
  const [missing, setMissing] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  const src = imageUrl(id, size, face);

  useEffect(() => {
    setMissing(false);
    const img = ref.current;
    // An image that finished before React attached its handlers.
    if (img && img.complete && (img.naturalWidth === 0 || img.naturalWidth === SERVER_PLACEHOLDER_WIDTH)) setMissing(true);
  }, [src]);

  if (!known || missing) {
    return (
      <div className="card-missing" data-testid="card-placeholder" style={{ fontSize: size === 'display' ? '1.4rem' : 'clamp(0.38rem, 10cqw, 1rem)' }}>
        <span>{name}</span>
        <small>{known ? 'Image not downloaded' : 'Not in the card database'}</small>
      </div>
    );
  }
  return (
    <img
      ref={ref}
      src={src}
      alt={name}
      draggable={false}
      decoding="async"
      onError={() => setMissing(true)}
      onLoad={(e) => {
        if (e.currentTarget.naturalWidth === SERVER_PLACEHOLDER_WIDTH) setMissing(true);
      }}
    />
  );
}

/** Score 0-100 as a tempered plate: green 80+, brass 60-79, copper 40-59, red below, grey when gated. */
export function ScoreBadge({ score, className = '', large = false }: { score: CardScore | undefined | null; className?: string; large?: boolean }) {
  if (!score) return null;
  const band = bandOf(score.score, !!score.gate);
  return (
    <span
      data-testid="score-badge"
      data-band={band}
      title={score.gate ? score.gate.message : `Score ${score.score} of 100 for this deck`}
      className={`display inline-flex items-center justify-center rounded-[5px] font-bold leading-none text-[#15110a] shadow-[0_1px_3px_rgb(0_0_0/0.7)] ${
        large ? 'h-12 min-w-14 px-2 text-[1.9rem]' : 'h-[1.35rem] min-w-[1.7rem] px-1 text-[0.9rem]'
      } ${className}`}
      style={{ background: BAND_VAR[band] }}
    >
      {score.gate ? '–' : score.score}
    </span>
  );
}

const PIP: Record<string, { bg: string; fg: string }> = {
  W: { bg: '#f1e9c6', fg: '#3a3214' },
  U: { bg: '#8cc3ea', fg: '#0d2a40' },
  B: { bg: '#a99d98', fg: '#17110f' },
  R: { bg: '#ee9a7c', fg: '#42140a' },
  G: { bg: '#8fcf9f', fg: '#0e3219' },
  C: { bg: '#cbc4b7', fg: '#2a261f' },
};
const pipOf = (sym: string) => PIP[sym] ?? PIP.C!;

/** "{2}{G}{G/U}" as coloured pips. Hybrid symbols are split diagonally between their two halves. */
export function Mana({ cost, size = '1.05em' }: { cost: string; size?: string }) {
  const symbols = [...cost.matchAll(/\{([^}]+)\}|(\/\/)/g)];
  if (!symbols.length) return null;
  return (
    <span className="inline-flex items-center gap-[2px] align-middle" aria-label={`Mana cost ${cost}`}>
      {symbols.map((m, i) => {
        if (m[2]) return <span key={i} className="px-0.5 text-smoke">/</span>;
        const sym = m[1]!;
        const halves = sym.split('/').filter((h) => h !== 'P');
        const a = pipOf(halves[0]!);
        const b = halves[1] ? pipOf(halves[1]) : null;
        const label = halves.length === 1 ? (/^[WUBRG]$/.test(sym) ? sym : sym.replace('/P', '')) : halves.join('');
        return (
          <span
            key={i}
            className="inline-flex items-center justify-center rounded-full font-bold leading-none"
            style={{
              width: size,
              height: size,
              fontSize: `calc(${size} * ${label.length > 1 ? 0.5 : 0.62})`,
              color: a.fg,
              background: b ? `linear-gradient(135deg, ${a.bg} 50%, ${b.bg} 50%)` : a.bg,
              boxShadow: sym.includes('/P') ? 'inset 0 0 0 1.5px #5b1f1a' : undefined,
            }}
          >
            {label}
          </span>
        );
      })}
    </span>
  );
}

/** A single colour pip, used by colour filters and the colour-source chart. */
export function ColorPip({ color, size = '1.1em', dim = false }: { color: string; size?: string; dim?: boolean }) {
  const p = pipOf(color);
  return (
    <span
      className="inline-flex items-center justify-center rounded-full font-bold leading-none"
      style={{ width: size, height: size, fontSize: `calc(${size} * 0.6)`, color: p.fg, background: p.bg, opacity: dim ? 0.3 : 1 }}
    >
      {color}
    </span>
  );
}

/** Deck rating as a half-dial. `partial` adds the "so far" label for decks that are not complete. */
export function Gauge({ value, partial, size = 132, legal = true }: { value: number; partial: boolean; size?: number; legal?: boolean }) {
  const v = Math.max(0, Math.min(100, value));
  const r = 44;
  const half = Math.PI * r;
  const color = !legal ? BAND_VAR.low : BAND_VAR[bandOf(v)];
  return (
    <div className="relative shrink-0" style={{ width: size, height: size * 0.62 }} data-testid="rating-gauge">
      <svg viewBox="0 0 100 58" width={size} height={size * 0.58} aria-hidden>
        <path d="M6 52 A44 44 0 0 1 94 52" fill="none" stroke="var(--color-slag)" strokeWidth="7" strokeLinecap="round" />
        {v > 0 && (
          <path
            d="M6 52 A44 44 0 0 1 94 52"
            fill="none"
            stroke={color}
            strokeWidth="7"
            strokeLinecap="round"
            strokeDasharray={`${(v / 100) * half} ${half * 2}`}
            style={{ transition: 'stroke-dasharray 0.35s ease-out' }}
          />
        )}
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center leading-none">
        <span className="display font-bold" style={{ fontSize: size * 0.3 }} data-testid="rating-value" aria-label={`Deck rating ${Math.round(v)} of 100`}>
          {Math.round(v)}
        </span>
        <span className="mt-0.5 text-ash" style={{ fontSize: Math.max(10, size * 0.085) }}>
          {partial ? 'rating so far' : 'rating'}
        </span>
      </div>
    </div>
  );
}

/** Modal layer. Esc and a click on the backdrop close it. */
export function Overlay({ onClose, children, label, wide = false }: { onClose: () => void; children: ReactNode; label: string; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-[rgb(8_6_4/0.82)] p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      data-testid="overlay"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className={`max-h-full overflow-auto rounded-lg border border-slag bg-anvil shadow-2xl ${wide ? 'w-[60rem]' : 'w-[40rem]'} max-w-full`}
      >
        {children}
      </div>
    </div>
  );
}
