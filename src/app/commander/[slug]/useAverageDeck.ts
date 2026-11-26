'use client';

import { useEffect, useRef, useState } from 'react';
import { analyzeDeck, buildDeck, type AnalyzeResponse, type RecsQuery } from '@/app/lib/api';
import { budgetMax } from '@/app/lib/budget';
import { isAbort } from '@/app/lib/ui';
import type { Deck } from '@/engine/types';
import { shellDeck } from './shell';

export interface AverageDeck { deck: Deck | null; analysis: AnalyzeResponse | null; error: string | null; empty: boolean }
const NONE: AverageDeck = { deck: null, analysis: null, error: null, empty: false };

/**
 * The deck Build a deck would make for these commanders and filters (the same options and seed, so
 * the same deck), with its analysis. Built once per filter set per visit, and only while `enabled`.
 */
export function useAverageDeck(commanders: string[], name: string, q: RecsQuery, enabled: boolean, free: boolean): AverageDeck {
  const memo = useRef(new Map<string, AverageDeck>());
  const [, bump] = useState(0);
  const key = JSON.stringify([commanders, name, q, free]);
  useEffect(() => {
    if (!enabled || commanders.length === 0 || memo.current.has(key)) return;
    const ctrl = new AbortController();
    (async () => {
      try {
        const built = await buildDeck(shellDeck(commanders, q.bracket, name), 'auto', {
          ownedOnly: q.ownedOnly, freeOnly: (q.ownedOnly && free) || undefined, maxPriceUsd: budgetMax(q.budget), seed: 1,
        }, ctrl.signal);
        const deck: Deck = { ...built.deck, id: null, name };
        const analysis = await analyzeDeck(deck, ctrl.signal);
        const nonland = deck.main.some((e) => {
          const c = analysis.cards[e.oracleId];
          return c && !/\bLand\b/.test(c.typeLine);
        });
        memo.current.set(key, { deck, analysis, error: null, empty: q.ownedOnly && !nonland });
      } catch (e) {
        if (isAbort(e)) return;
        memo.current.set(key, { ...NONE, error: e instanceof Error ? e.message : String(e) });
      }
      bump((n) => n + 1);
    })();
    return () => ctrl.abort();
  }, [enabled, key, commanders, name, q, free]);
  return memo.current.get(key) ?? NONE;
}
