'use client';

import type { ClientCard, NetworkResponse } from '@/app/lib/api';
import { CardGrid } from '../CardGrid';
import { CardTile } from '../CardTile';
import { EmptyState } from '../EmptyState';
import { Section } from '../Section';

const pct = (n: number): string => `${Math.round(n * 100)}%`;

/**
 * The side list of the Network tab: what the cohesion number is made of, the clusters (a click flies
 * the view there), and the cards that connect to nothing, with the one button that swaps them.
 * `onSwap` is left out where there is no deck to change.
 */
export function NetworkSummary({
  network, focus, onFocus, onOpen, onSwap, busy = false,
}: {
  network: NetworkResponse;
  focus: number | null;
  onFocus(cluster: number | null): void;
  onOpen(oracleId: string): void;
  onSwap?(): void;
  busy?: boolean;
}) {
  const { clusters, cohesionParts: parts } = network;
  const top = clusters.slice(0, 2).map((c) => c.name);
  const focused = parts.clustered > 0 || clusters.length > 0
    ? `Focused: ${pct(parts.clustered)} of the links between cards sit inside ${top.join(' and ')} (40% of the score).`
    : 'Focused: no group of cards works together yet (40% of the score).';
  const link = new Map(network.nodes.map((n) => [n.oracleId, n.link]));
  const cards = network.unconnected.map((id) => network.cards[id]).filter((c): c is ClientCard => c !== undefined);

  return (
    <div className="grid gap-5 p-4" data-testid="panel-network">
      <Section id="network-cohesion" title="Cohesion" count={network.cohesion} testId="network-cohesion">
        <ul className="grid gap-2 text-[0.88rem] text-ash">
          <li>Connected: {pct(parts.connected)} of the cards that are not staples work with another card or with the commander (60% of the score).</li>
          <li>{focused}</li>
        </ul>
      </Section>
      <Section id="network-clusters" title="Clusters" count={clusters.length}>
        {clusters.length === 0 ? (
          <EmptyState message="No group of two or more cards works together yet." />
        ) : (
          <ul className="grid gap-1.5">
            {clusters.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`flex w-full items-baseline gap-2 rounded-[6px] border px-3 py-1.5 text-left ${focus === c.id ? 'border-brass text-bone' : 'border-slag text-ash hover:text-bone'}`}
                  aria-pressed={focus === c.id}
                  onClick={() => onFocus(focus === c.id ? null : c.id)}
                  title={focus === c.id ? 'Show the whole network again' : `Fly the view to ${c.name}`}
                  data-testid="network-cluster"
                  data-cluster={c.id}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
                  <span className="text-[0.8rem] text-smoke tabular-nums">{c.cards.length} cards</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section
        id="network-unconnected"
        title="Not connected"
        count={cards.length}
        testId="network-unconnected"
      >
        {/* under the heading, not beside it: the side panel is too narrow for both on one line */}
        {onSwap && cards.length > 0 && (
          <button
            type="button"
            className="btn btn-sm mb-3"
            disabled={busy}
            onClick={onSwap}
            title="Runs Fix deck on synergy: cards that connect to nothing are swapped for cards that work with this deck"
            data-testid="swap-unconnected"
          >
            Swap the unconnected cards
          </button>
        )}
        {cards.length === 0 ? (
          <EmptyState message="Every card works with another card or with the commander." />
        ) : (
          <CardGrid size="S">
            {cards.map((c) => (
              <CardTile
                key={c.oracleId}
                card={c}
                size="S"
                stats={[{ label: 'synergy', value: pct(link.get(c.oracleId) ?? 0) }]}
                onOpen={() => onOpen(c.oracleId)}
              />
            ))}
          </CardGrid>
        )}
      </Section>
    </div>
  );
}
