'use client';

import { useCallback, useEffect, useState } from 'react';
import { setFilters, useFilters } from '../lib/filters';
import { useCollections } from './Shell';

/*
 * The "!" on a card whose free copies do not cover what the deck needs: the copies it would take
 * sit in a sealed box or in another deck that is really assembled ("built").
 */

/** "In Landing Party box; in Krenko, Mob Boss (built)". */
export const heldText = (names: readonly string[]): string => names.map((n, i) => `${i === 0 ? 'In' : 'in'} ${n}`).join('; ');

/** The "!" itself. Its title names the boxes and built decks that hold the copies. Renders nothing without names. */
export function HeldMark({ names, small = false, className = '' }: { names: readonly string[] | undefined; small?: boolean; className?: string }) {
  if (!names || names.length === 0) return null;
  const text = heldText(names);
  return (
    <span
      data-testid="held-mark"
      title={text}
      aria-label={`Held: ${text}`}
      className={`display inline-flex shrink-0 items-center justify-center rounded-full bg-ember font-bold leading-none text-[#15110a] shadow-[0_1px_3px_rgb(0_0_0/0.7)] ${
        small ? 'h-4 w-4 text-[0.72rem]' : 'h-[1.35rem] w-[1.35rem] text-[0.95rem]'
      } ${className}`}
    >
      !
    </span>
  );
}

/**
 * "Use free copies only": the user's last choice (the shared filters, localStorage `cf-free-only`),
 * otherwise on when the active collection has boxes or built decks. `null` while that is not known
 * yet, so a page can wait instead of asking the server twice.
 */
export function useFreeOnly(): [boolean | null, (on: boolean) => void] {
  const { active } = useCollections();
  const filters = useFilters();
  // undefined: storage not read yet; null: nothing stored.
  const stored = filters.ready ? filters.freeOnly : undefined;
  const [gaveUp, setGaveUp] = useState(false);
  // The collections could not be read: fall back to off rather than wait for ever.
  useEffect(() => {
    if (active) return;
    const t = setTimeout(() => setGaveUp(true), 2500);
    return () => clearTimeout(t);
  }, [active]);
  const set = useCallback((on: boolean) => setFilters({ freeOnly: on }), []);
  // Wait for the active collection too: a page that sends the option only for some collections must not start twice.
  const value = stored === undefined || (!active && !gaveUp) ? null : stored !== null ? stored : !!active && active.holders > 0;
  return [value, set];
}
