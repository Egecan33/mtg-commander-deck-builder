'use client';

import { Fragment } from 'react';
import type { FoundCombo } from '@/engine/types';
import type { CardLookup } from '../lib/api';
import { comboBracket, comboResults, spellbookUrl } from '../lib/combo-text';
import { CardTile, unknownCard } from './CardTile';

/**
 * One combo: its cards as small tiles joined by "+", then what it produces in plain English and a line
 * of facts (mana, two cards, early, the bracket it needs) with a plain link to Commander Spellbook.
 * A card the deck does not have yet gets a dashed outline; `onPutIn` adds "Put it in" for it, which
 * should open that card's detail (it lists what the card could replace).
 */
export function ComboRow({
  found, lookup, heldBy, onOpen, onPutIn,
}: {
  found: FoundCombo;
  lookup: CardLookup;
  /** Boxes and built decks holding each card's copies, by oracle id ("!" and their names). */
  heldBy?: Readonly<Record<string, readonly string[]>>;
  onOpen: (oracleId: string) => void;
  /** Called with the missing card's id. Without it the row has no Put it in. */
  onPutIn?: (oracleId: string) => void;
}) {
  const missing = new Set(found.missing);
  const bracket = comboBracket(found);
  const facts = [
    found.twoCard ? 'two cards' : `${found.combo.cards.length} cards`,
    found.combo.manaValueNeeded > 0 ? `needs ${found.combo.manaValueNeeded} mana` : null,
    found.early ? 'can come down early' : null,
    bracket ? `Bracket ${bracket} and up` : null,
    found.relevant ? null : 'does not win on its own',
  ].filter((f): f is string => f !== null);
  return (
    <li className="rounded-md border border-slag bg-anvil p-2.5" data-testid="combo" data-combo={found.combo.id} data-missing={missing.size || undefined}>
      <div className="flex flex-wrap items-start gap-x-1.5 gap-y-2">
        {found.combo.cards.map((c, i) => {
          const card = lookup[c.oracleId];
          const gone = missing.has(c.oracleId);
          return (
            <Fragment key={c.oracleId}>
              {i > 0 && <span className="mt-[2.6rem] w-3 text-center text-ash" aria-hidden>+</span>}
              <div className="w-24 shrink-0">
                <CardTile
                  card={card ?? unknownCard(c.oracleId)}
                  known={!!card}
                  size="S"
                  marks={gone ? ['missing'] : []}
                  heldBy={gone ? heldBy?.[c.oracleId] : undefined}
                  onOpen={() => onOpen(c.oracleId)}
                  testId="combo-card"
                  data={{ 'data-id': c.oracleId, 'data-missing': gone || undefined }}
                />
              </div>
            </Fragment>
          );
        })}
      </div>
      <p className="mt-2 text-[15px]" data-testid="combo-result"><span className="text-ash" aria-hidden>&rarr; </span>{comboResults(found.combo.produces)}</p>
      <p className="mt-0.5 text-[13px] text-ash">{facts.join(' · ')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        {onPutIn && found.missing.length === 1 && (
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => onPutIn(found.missing[0])}
            aria-label={`Put ${lookup[found.missing[0]]?.name ?? 'the missing card'} in`}
            title="Open the card and pick what it takes the place of"
            data-testid="combo-put-in"
          >
            Put it in
          </button>
        )}
        <a className="text-[13px] text-brass hover:underline" href={spellbookUrl(found.combo.id)} target="_blank" rel="noopener noreferrer" data-testid="combo-link">
          View on Commander Spellbook
        </a>
      </div>
    </li>
  );
}
