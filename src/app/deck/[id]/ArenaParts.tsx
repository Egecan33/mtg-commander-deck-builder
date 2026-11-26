'use client';

import type { ArenaRarity, ArenaReport, CardLookup, CollectionInfo, Format } from '../../lib/api';

const ORDER: readonly ArenaRarity[] = ['common', 'uncommon', 'rare', 'mythic'];
export const RARITY_LETTER: Record<ArenaRarity, string> = { common: 'C', uncommon: 'U', rare: 'R', mythic: 'M' };

/** The tile stat a Brawl deck shows where a Commander deck shows a price: the card's Arena rarity. */
export function rarityStat(rarity: ArenaRarity | null): { label: string; value: string; title: string } {
  return rarity
    ? { label: '', value: RARITY_LETTER[rarity], title: `${rarity[0].toUpperCase()}${rarity.slice(1)} on MTG Arena` }
    : { label: '', value: '–', title: 'Not on MTG Arena' };
}

/**
 * "MTG Arena · Brawl" or "Physical · Commander", with the action that moves the deck to the other
 * collection. Moving changes only the collection; the deck is then checked under that collection's rules.
 */
export function FormatChip({
  format, collection, other, busy, onMove,
}: { format: Format; collection: CollectionInfo | null; other: CollectionInfo | null; busy: boolean; onMove: (to: CollectionInfo) => void }) {
  return (
    <>
      <span
        className={`chip ${format === 'brawl' ? 'border-brass text-bone' : ''}`}
        title={format === 'brawl' ? 'Built for MTG Arena: Brawl rules, Arena cards only, your wildcards as the budget' : 'Built for paper: Commander rules'}
        data-testid="deck-format"
      >
        {collection?.name ?? (format === 'brawl' ? 'MTG Arena' : 'Physical')} · {format === 'brawl' ? 'Brawl' : 'Commander'}
      </span>
      {other && (
        <button
          type="button"
          className="chip hover:text-bone"
          disabled={busy}
          onClick={() => onMove(other)}
          title={`Moves this deck to your ${other.name} collection. Its cards stay as they are; it is then checked under ${other.kind === 'arena' ? 'Brawl' : 'Commander'} rules.`}
          data-testid="deck-move"
        >
          {busy ? 'Moving' : `Move to ${other.name}`}
        </button>
      )}
    </>
  );
}

/**
 * "Wildcards needed: 3 uncommon, 2 rare, 1 mythic. You have 12, 1, 0." Rarities over budget are
 * marked. The cards to craft, with the printing Arena should craft, open below it.
 */
export function WildcardLine({ report, lookup, onOpen }: { report: ArenaReport; lookup: CardLookup; onOpen: (id: string) => void }) {
  if (report.noData) {
    return (
      <p className="mt-1 px-1 text-[0.8rem] text-band-mid" data-testid="wildcards-no-data">
        The card data has no MTG Arena information yet. Sync card data (Card data, Cards) to build for Arena.
      </p>
    );
  }
  const needed = ORDER.filter((r) => report.needed[r] > 0).map((rarity) => ({ rarity, n: report.needed[rarity] }));
  const over = new Set(report.over);
  if (needed.length === 0) {
    return (
      <p className="mt-1 px-1 text-[0.8rem] text-ash" data-testid="wildcards-line">
        No wildcards needed: you own every card of this deck.
      </p>
    );
  }
  return (
    <div className="mt-1 px-1 text-[0.8rem] text-ash" data-testid="wildcards-line">
      <span>Wildcards needed: </span>
      {needed.map(({ rarity, n }, i) => (
        <span
          key={rarity}
          className={over.has(rarity) ? 'font-semibold text-band-low' : 'text-bone'}
          title={over.has(rarity) ? `More ${rarity} wildcards than you have` : undefined}
          data-over={over.has(rarity) || undefined}
        >
          {n} {rarity}
          {i < needed.length - 1 ? ', ' : ''}
        </span>
      ))}
      <span>. You have </span>
      {needed.map(({ rarity }, i) => (
        <span key={rarity} className={over.has(rarity) ? 'font-semibold text-band-low' : 'text-bone'}>
          {report.have[rarity]}
          {i < needed.length - 1 ? ', ' : ''}
        </span>
      ))}
      <span>.</span>
      <details className="inline-block align-top">
        <summary className="ml-2 cursor-pointer text-brass hover:text-bone" data-testid="craft-toggle">
          Cards to craft ({report.toCraft.length})
        </summary>
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border border-slag bg-soot px-2 py-1.5 text-[0.8rem]" data-testid="craft-list">
          {ORDER.slice().reverse().flatMap((rarity) =>
            report.toCraft.filter((l) => l.rarity === rarity).map((l) => (
              <li key={l.oracleId} className="flex gap-2 py-0.5" data-testid="craft-line" data-rarity={rarity}>
                <button type="button" className="text-bone hover:text-brass" onClick={() => onOpen(l.oracleId)}>
                  {lookup[l.oracleId]?.name ?? 'Unknown card'}
                </button>
                <span className="text-ash">
                  {l.set && l.number ? `${l.set} ${l.number}, ` : ''}
                  {rarity}
                </span>
              </li>
            )),
          )}
        </ul>
      </details>
    </div>
  );
}
