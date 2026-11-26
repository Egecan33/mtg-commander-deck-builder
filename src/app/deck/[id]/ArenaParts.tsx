'use client';

import { CardGrid } from '../../components/CardGrid';
import { CardTile, unknownCard } from '../../components/CardTile';
import { Menu } from '../../components/Menu';
import { Section } from '../../components/Section';
import type { ArenaRarity, ArenaReport, CardLookup, CollectionInfo, Format } from '../../lib/api';

const ORDER: readonly ArenaRarity[] = ['common', 'uncommon', 'rare', 'mythic'];
export const RARITY_LETTER: Record<ArenaRarity, string> = { common: 'C', uncommon: 'U', rare: 'R', mythic: 'M' };
const cap = (s: string) => `${s[0].toUpperCase()}${s.slice(1)}`;

/** The tile stat a Brawl deck shows where a Commander deck shows a price: the card's Arena rarity. */
export function rarityStat(rarity: ArenaRarity | null): { label: string; value: string; title: string } {
  return rarity ? { label: '', value: RARITY_LETTER[rarity], title: `${cap(rarity)} on MTG Arena` } : { label: '', value: '–', title: 'Not on MTG Arena' };
}

/**
 * "MTG Arena · Brawl" or "Physical · Commander" as a quiet chip that opens a menu with the action
 * that moves the deck to the other collection. Moving changes only the collection; the deck is then
 * checked under that collection's rules.
 */
export function FormatChip({
  format, collection, other, busy, onMove,
}: { format: Format; collection: CollectionInfo | null; other: CollectionInfo | null; busy: boolean; onMove: (to: CollectionInfo) => void }) {
  const label = `${collection?.name ?? (format === 'brawl' ? 'MTG Arena' : 'Physical')} · ${format === 'brawl' ? 'Brawl' : 'Commander'}`;
  const title = format === 'brawl' ? 'Built for MTG Arena: Brawl rules, Arena cards only, your wildcards as the budget' : 'Built for paper: Commander rules';
  if (!other) return <span className="chip" title={title} data-testid="deck-format">{label}</span>;
  return (
    <Menu
      label={busy ? 'Moving' : label}
      className="chip hover:text-bone"
      testId="deck-format"
      title={title}
      items={[
        {
          label: `Move to ${other.name}`,
          description: `Its cards stay as they are; it is then checked under ${other.kind === 'arena' ? 'MTG Arena Brawl' : 'Commander'} rules.`,
          onSelect: () => onMove(other),
          disabled: busy,
          testId: 'deck-move',
        },
      ]}
    />
  );
}

/**
 * "Wildcards needed: 3 uncommon, 2 rare, 1 mythic. You have 12, 1, 0." Rarities over budget are
 * marked. "Cards to craft" opens `CraftSection` (the parent shows it above the deck).
 */
export function WildcardLine({ report, open, onToggle }: { report: ArenaReport; open: boolean; onToggle: () => void }) {
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
      <button type="button" className="ml-2 text-ash underline-offset-2 hover:text-bone hover:underline" aria-expanded={open} onClick={onToggle} data-testid="craft-toggle">
        {open ? 'Hide cards to craft' : `Cards to craft (${report.toCraft.length})`}
      </button>
    </div>
  );
}

/** The cards to craft, rarest first, as small tiles: rarity and the Arena printing to craft under each. */
export function CraftSection({ report, lookup, onOpen, onClose }: { report: ArenaReport; lookup: CardLookup; onOpen: (id: string) => void; onClose: () => void }) {
  const lines = ORDER.slice().reverse().flatMap((r) => report.toCraft.filter((l) => l.rarity === r));
  return (
    <Section
      id="cards-to-craft"
      title="Cards to craft"
      count={lines.length}
      testId="craft-list"
      actions={<button type="button" className="btn btn-sm btn-quiet" onClick={onClose}>Hide</button>}
    >
      <CardGrid size="S">
        {lines.map((l) => (
          <CardTile
            key={l.oracleId}
            card={lookup[l.oracleId] ?? unknownCard(l.oracleId)}
            known={!!lookup[l.oracleId]}
            size="S"
            stats={[
              ...(l.set && l.number ? [{ label: '', value: `${l.set} ${l.number}`, title: 'The Arena printing to craft' }] : []),
              rarityStat(l.rarity),
            ]}
            onOpen={() => onOpen(l.oracleId)}
            testId="craft-line"
            data={{ 'data-rarity': l.rarity }}
          />
        ))}
      </CardGrid>
    </Section>
  );
}
