'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CardDetail } from '@/app/components/CardDetail';
import { EmptyState } from '@/app/components/EmptyState';
import { NetworkSummary } from '@/app/components/network/NetworkSummary';
import { NetworkView } from '@/app/components/network/NetworkView';
import { useNetwork } from '@/app/components/network/useNetwork';
import { useNotify } from '@/app/components/Shell';
import { createDeck } from '@/app/lib/api';
import { setFilters } from '@/app/lib/filters';
import { BAND_VAR, bandOf } from '@/app/lib/ui';
import { DeckView } from '@/app/deck/[id]/DeckView';
import { CommanderPackages } from './CommanderPackages';
import type { AverageDeck } from './useAverageDeck';

const NO_HELD = {};
const NO_WEAK = new Set<string>();

export function AverageDeckTab({ avg, name }: { avg: AverageDeck; name: string }) {
  const router = useRouter();
  const notify = useNotify();
  const [detail, setDetail] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<'cards' | 'network' | 'packages'>('cards');
  const [focus, setFocus] = useState<number | null>(null);
  const net = useNetwork(avg.deck ?? null, view === 'network');
  const networkNow = net.network;
  useEffect(() => setFocus(null), [networkNow]);
  if (avg.error) return <EmptyState message={`Could not build the average deck: ${avg.error}`} />;
  if (avg.empty) {
    return (
      <EmptyState
        testId="average-empty"
        message={`None of your cards fits ${name}. Turn off Only my collection to see the best deck from every card.`}
        action={<button type="button" className="btn btn-sm" onClick={() => setFilters({ ownedOnly: false })}>Turn off Only my collection</button>}
      />
    );
  }
  if (!avg.deck || !avg.analysis) return <p className="text-ash" data-testid="average-loading">Building the average deck…</p>;
  const { deck, analysis } = avg;
  const rating = analysis.rating;
  const band = bandOf(rating.rating);
  const open = async () => {
    setBusy(true);
    try {
      const saved = await createDeck({ ...deck, name });
      router.push(`/deck/${saved.deck.id}`);
    } catch (e) {
      notify.error(e);
      setBusy(false);
    }
  };
  return (
    <div data-testid="average-deck">
      <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="flex h-11 min-w-11 items-center justify-center rounded-md px-2 text-[1.5rem] font-bold text-[#15110a]" style={{ background: BAND_VAR[band] }} title="Forge: deck rating out of 100" data-testid="average-rating">
          {Math.round(rating.rating)}
        </span>
        <span data-testid="average-legal" className={rating.legal ? 'text-bone' : 'text-band-low'}>
          {rating.legal ? 'Legal' : `Not legal: ${rating.violations[0]?.message ?? 'this deck breaks a rule'}`}
        </span>
        {analysis.format !== 'standardbrawl' && <span className="text-ash" title="Forge: the lowest bracket the deck's cards fit">Plays like Bracket {analysis.bracket.playsLike}</span>}
        <button type="button" className="btn ml-auto" onClick={() => void open()} disabled={busy} data-testid="average-open">Open as a deck</button>
      </div>
      <div className="seg mb-3" role="group" aria-label="Show the deck as">
        <button type="button" aria-pressed={view === 'cards'} onClick={() => setView('cards')} data-testid="average-view-cards">Cards</button>
        <button type="button" aria-pressed={view === 'network'} onClick={() => setView('network')} data-testid="average-view-network">Network</button>
        <button type="button" aria-pressed={view === 'packages'} onClick={() => setView('packages')} data-testid="average-view-packages">Packages</button>
      </div>
      {view === 'network' && (
        <div className="grid grid-cols-[minmax(0,1fr)_26rem] gap-4" data-testid="average-network">
          <div className="min-w-0">
            <NetworkView
              network={net.network}
              error={net.error}
              focusCluster={focus}
              onOpen={setDetail}
              onRetry={net.reload}
              onEmpty={() => setView('cards')}
            />
          </div>
          <div className="min-w-0 rounded-lg border border-slag bg-anvil">
            {net.network
              ? <NetworkSummary network={net.network} focus={focus} onFocus={setFocus} onOpen={setDetail} />
              : <p className="p-4 text-ash" data-testid="panel-network">Reading how the cards connect</p>}
          </div>
        </div>
      )}
      {view === 'packages' && <CommanderPackages avg={avg} />}
      {view === 'cards' && <DeckView
        deck={deck}
        lookup={analysis.cards}
        scoreOf={(id) => analysis.deckScores[id]}
        weakest={NO_WEAK}
        held={analysis.conflicts.cards ?? NO_HELD}
        onOpen={setDetail}
      />}
      {detail && <CardDetail id={detail} card={analysis.cards[detail]} score={analysis.deckScores[detail]} held={analysis.conflicts.cards?.[detail]} bracket={deck.targetBracket} onClose={() => setDetail(null)} />}
    </div>
  );
}
