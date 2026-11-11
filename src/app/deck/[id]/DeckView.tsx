'use client';

import { useMemo, type ReactNode } from 'react';
import type { CardScore, Deck, DeckEntry } from '@/engine/types';
import { CardImage, Mana, ScoreBadge } from '../../components/card';
import type { CardLookup, ClientCard } from '../../lib/api';
import { ROLE_GROUPS, TYPE_GROUPS, roleGroup, typeGroup } from '../../lib/ui';

export type Grouping = 'role' | 'type';
export type Layout = 'grid' | 'list';

interface Row { entry: DeckEntry; card: ClientCard | undefined; zone: 'commander' | 'companion' | 'main' }

const LockIcon = ({ open = false }: { open?: boolean }) => (
  <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden fill="currentColor">
    <rect x="3" y="7" width="10" height="7" rx="1.5" />
    <path d={open ? 'M5 7V5a3 3 0 0 1 5.6-1.5' : 'M5 7V5a3 3 0 0 1 6 0v2'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

/** The deck as card images, grouped by what the cards do or by card type; or as a compact list. */
export function DeckView({
  deck, lookup, scoreOf, weakest, grouping, layout, setGrouping, setLayout, onRemove, onAdd, onLock, onOpen, tools,
}: {
  /** Extra actions for the whole deck, shown under the header. */
  tools?: ReactNode;
  deck: Deck;
  lookup: CardLookup;
  scoreOf: (id: string) => CardScore | undefined;
  weakest: Set<string>;
  grouping: Grouping;
  layout: Layout;
  setGrouping: (g: Grouping) => void;
  setLayout: (l: Layout) => void;
  onRemove: (id: string) => void;
  onAdd: (id: string) => void;
  onLock: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const groups = useMemo(() => {
    const by = new Map<string, Row[]>();
    const put = (label: string, row: Row) => by.set(label, [...(by.get(label) ?? []), row]);
    for (const entry of deck.main) {
      const card = lookup[entry.oracleId];
      put(!card ? 'Not in the card database' : grouping === 'role' ? roleGroup(card) : typeGroup(card.typeLine), { entry, card, zone: 'main' });
    }
    const order: readonly string[] = ['Not in the card database', ...(grouping === 'role' ? ROLE_GROUPS : TYPE_GROUPS)];
    const out: { label: string; rows: Row[] }[] = [];
    const zone = (ids: string[], label: string, z: Row['zone']) => {
      if (ids.length) out.push({ label, rows: ids.map((id) => ({ entry: { oracleId: id, qty: 1, locked: true }, card: lookup[id], zone: z })) });
    };
    zone(deck.commanders, deck.commanders.length > 1 ? 'Commanders' : 'Commander', 'commander');
    zone(deck.companion ? [deck.companion] : [], 'Companion (outside the 100)', 'companion');
    for (const label of order) {
      const rows = by.get(label);
      if (!rows) continue;
      rows.sort((a, b) => (a.card?.cmc ?? 0) - (b.card?.cmc ?? 0) || (a.card?.name ?? '').localeCompare(b.card?.name ?? ''));
      out.push({ label, rows });
    }
    return out;
  }, [deck, lookup, grouping]);

  const empty = deck.main.length === 0;

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col border-l border-slag" aria-label="Deck" data-testid="deck-view">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        <h2 className="mr-auto text-[1.15rem] leading-none">Deck</h2>
        <div className="seg" role="group" aria-label="Group cards by">
          <button type="button" aria-pressed={grouping === 'role'} onClick={() => setGrouping('role')} data-testid="group-role">By role</button>
          <button type="button" aria-pressed={grouping === 'type'} onClick={() => setGrouping('type')} data-testid="group-type">By type</button>
        </div>
        <div className="seg" role="group" aria-label="Show the deck as">
          <button type="button" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')} data-testid="layout-grid">Images</button>
          <button type="button" aria-pressed={layout === 'list'} onClick={() => setLayout('list')} data-testid="layout-list">List</button>
        </div>
      </div>

      {tools && <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">{tools}</div>}

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4" data-testid="deck-scroll">
        {empty && (
          <div className="mb-4 rounded-md border border-dashed border-slag p-4 text-ash" data-testid="deck-empty">
            <p className="display text-[1.05rem] text-bone">The 99 are empty</p>
            <p className="mt-1">
              Add cards from the browser on the left with the + on each card, or use “Auto-build” above for a full deck and “Fill the rest” to complete a
              start you made by hand.
            </p>
          </div>
        )}

        {groups.map((g) => {
          const n = g.rows.reduce((s, r) => s + r.entry.qty, 0);
          return (
            <div key={g.label} className="mb-4" data-testid="deck-group" data-group={g.label}>
              <h3 className="sticky top-0 z-10 flex items-baseline gap-2 bg-soot/95 py-1.5 text-[0.95rem]">
                <span>{g.label}</span>
                <span className="font-sans text-[0.8rem] font-normal text-smoke">{n}</span>
              </h3>

              {layout === 'grid' ? (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(98px,1fr))] gap-2">
                  {g.rows.map(({ entry, card, zone }) => {
                    const id = entry.oracleId;
                    const score = scoreOf(id);
                    const name = card?.name ?? 'Unknown card';
                    const weak = weakest.has(id);
                    const illegal = zone === 'main' && !!score?.gate;
                    return (
                      <div
                        key={id}
                        className={`card group ${illegal ? 'outline outline-2 outline-band-low' : weak ? 'outline outline-2 outline-band-mid' : ''}`}
                        data-testid="deck-card"
                        data-name={name}
                        data-id={id}
                        data-zone={zone}
                        data-weak={weak || undefined}
                        data-locked={(zone === 'main' && entry.locked) || undefined}
                        title={illegal ? `${name}: ${score?.gate?.message}` : weak ? `${name}: one of the weakest cards in the deck` : name}
                      >
                        <button type="button" className="block h-full w-full cursor-zoom-in" onClick={() => onOpen(id)} aria-label={`Details for ${name}`}>
                          <CardImage id={id} name={name} known={!!card} />
                        </button>
                        <div className="pointer-events-none absolute bottom-[3.5%] left-[5%] flex items-center gap-1">
                          <ScoreBadge score={score} />
                          {weak && !illegal && (
                            <span className="rounded bg-band-mid px-1 text-[0.68rem] font-semibold leading-[1.35rem] text-[#1a1407] group-hover:hidden">weakest</span>
                          )}
                        </div>
                        {entry.qty > 1 && (
                          <span className="pointer-events-none absolute right-[5%] top-[3.5%] rounded bg-soot/90 px-1 text-[0.78rem] font-semibold leading-[1.3rem]">&times;{entry.qty}</span>
                        )}
                        {zone === 'main' && (
                          <div className="absolute bottom-[4%] right-[5%] flex gap-1">
                            <button
                              type="button"
                              className={`tile-btn ${entry.locked ? 'tile-btn-on' : 'tile-hover'}`}
                              onClick={() => onLock(id)}
                              aria-pressed={entry.locked}
                              aria-label={entry.locked ? `Unlock ${name}` : `Lock ${name} so it is never cut`}
                              title={entry.locked ? 'Locked: auto-build and improve keep this card. Click to unlock.' : 'Lock: keep this card through auto-build and improve'}
                              data-testid="deck-lock"
                            >
                              <LockIcon open={!entry.locked} />
                            </button>
                            <button type="button" className="tile-btn tile-hover" onClick={() => onRemove(id)} aria-label={`Remove ${name} from the deck`} data-testid="deck-remove">
                              &minus;
                            </button>
                          </div>
                        )}
                        {zone === 'companion' && (
                          <div className="absolute bottom-[4%] right-[5%]">
                            <button type="button" className="tile-btn tile-hover" onClick={() => onRemove(id)} aria-label={`Remove ${name} as companion`}>&minus;</button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <ul className="divide-y divide-iron rounded-md border border-iron" data-testid="deck-list">
                  {g.rows.map(({ entry, card, zone }) => {
                    const id = entry.oracleId;
                    const score = scoreOf(id);
                    const name = card?.name ?? `Unknown card (${id.slice(0, 8)})`;
                    return (
                      <li key={id} className="group flex h-8 items-center gap-2 px-2 hover:bg-anvil" data-testid="deck-row" data-name={name}>
                        <span className="w-5 text-right text-smoke">{entry.qty}</span>
                        <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-brass" onClick={() => onOpen(id)}>
                          {name}
                          {weakest.has(id) && <span className="ml-2 text-[0.75rem] text-band-mid">weakest</span>}
                          {zone === 'main' && score?.gate && <span className="ml-2 text-[0.75rem] text-band-low">{score.gate.message}</span>}
                        </button>
                        {card?.manaCost && <Mana cost={card.manaCost} size="0.95rem" />}
                        <ScoreBadge score={score} />
                        {zone === 'main' ? (
                          <>
                            <button type="button" className={`tile-btn ${entry.locked ? 'tile-btn-on' : 'opacity-40 group-hover:opacity-100'}`} onClick={() => onLock(id)} aria-pressed={entry.locked} aria-label={entry.locked ? `Unlock ${name}` : `Lock ${name}`}>
                              <LockIcon open={!entry.locked} />
                            </button>
                            {card?.roles.includes('land') && (
                              <button type="button" className="tile-btn opacity-40 group-hover:opacity-100" onClick={() => onAdd(id)} aria-label={`Add another ${name}`}>+</button>
                            )}
                            <button type="button" className="tile-btn opacity-40 group-hover:opacity-100" onClick={() => onRemove(id)} aria-label={`Remove ${name} from the deck`} data-testid="deck-remove">&minus;</button>
                          </>
                        ) : (
                          <span className="w-[4.6rem] shrink-0 text-right text-[0.75rem] text-smoke">{zone}</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
