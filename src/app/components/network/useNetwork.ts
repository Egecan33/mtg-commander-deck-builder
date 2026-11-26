'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getNetwork } from '@/app/lib/api';
import type { NetworkResponse } from '@/app/lib/api';
import type { Deck } from '@/engine/types';

/**
 * The deck's network while `enabled`: fetched when the deck changes (400 ms after the last change),
 * the previous request aborted, a stale answer ignored. The last answer stays while the next loads.
 */
export function useNetwork(deck: Deck | null, enabled: boolean): { network: NetworkResponse | null; error: string | null; reload(): void } {
  const [network, setNetwork] = useState<NetworkResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  const key = deck ? JSON.stringify([deck.commanders, deck.companion, deck.chosenColor, deck.targetBracket, deck.themeWeights, deck.main.map((e) => [e.oracleId, e.qty])]) : '';
  const latest = useRef(deck);
  latest.current = deck;

  useEffect(() => {
    if (!enabled || !latest.current) return;
    const mine = ++seq.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      getNetwork(latest.current as Deck, controller.signal)
        .then((n) => { if (mine === seq.current) { setNetwork(n); setError(null); } })
        .catch((e: unknown) => {
          if (controller.signal.aborted || mine !== seq.current) return;
          setError(e instanceof Error ? e.message : 'The network could not be read.');
        });
    }, network ? 400 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `network` only decides the debounce
  }, [enabled, key, nonce]);

  const reload = useCallback(() => { setError(null); setNonce((n) => n + 1); }, []);
  return { network, error, reload };
}
