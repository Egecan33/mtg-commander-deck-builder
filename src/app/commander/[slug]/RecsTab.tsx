'use client';

import Link from 'next/link';
import { Fragment, useMemo, useState } from 'react';
import { CardDetail } from '@/app/components/CardDetail';
import { CardGrid } from '@/app/components/CardGrid';
import { CardTile, type TileStat } from '@/app/components/CardTile';
import { EmptyState } from '@/app/components/EmptyState';
import { Mana } from '@/app/components/card';
import { pickOption, type FilterOption } from '@/app/components/FilterBar';
import { HeldMark } from '@/app/components/held';
import { JumpRail, JumpScope } from '@/app/components/JumpRail';
import { Section, useSectionLimit } from '@/app/components/Section';
import type { CommanderRecsResponse, RecCard } from '@/app/lib/api';
import { setFilters, useFilters } from '@/app/lib/filters';
import { fmtPrice } from '@/app/lib/ui';
import { arrangeRecs, type ArrangedSection, type GroupBy, type RecSort } from './arrange';

export const REC_GROUPS: FilterOption[] = [
  { id: 'category', label: 'By section' }, { id: 'role', label: 'By role' }, { id: 'none', label: 'No groups' },
];
export const REC_SORTS: FilterOption[] = [
  { id: 'score', label: 'Score' }, { id: 'synergy', label: 'Synergy' }, { id: 'price', label: 'Price' }, { id: 'name', label: 'Name' },
];

/** The rows of a list section: the first ones until "Show all" opens the rest. */
function RecList({ cards, children }: { cards: RecCard[]; children: (cards: RecCard[]) => React.ReactNode }) {
  const limit = useSectionLimit(cards.length);
  return <ul className="grid gap-px overflow-hidden rounded-md border border-slag bg-slag">{children(limit === null ? cards : cards.slice(0, limit))}</ul>;
}

function EmptyAction({ text }: { text: string }) {
  if (/Only my collection/.test(text)) return <button type="button" className="btn btn-sm" onClick={() => setFilters({ ownedOnly: false })}>Turn off Only my collection</button>;
  if (/Any price/.test(text)) return <button type="button" className="btn btn-sm" onClick={() => setFilters({ budget: 'any' })}>Any price</button>;
  if (/Sync printings/.test(text)) return <Link href="/data" className="btn btn-sm">Card data</Link>;
  if (/Collection/.test(text)) return <Link href="/collection" className="btn btn-sm">Collection</Link>;
  return null;
}

export function RecsTab({ data, name, edhrecDecks }: { data: CommanderRecsResponse; name: string; edhrecDecks?: number }) {
  const f = useFilters();
  const [detail, setDetail] = useState<string | null>(null);
  const groupBy = pickOption(f.groupBy, REC_GROUPS) as GroupBy;
  const sort = pickOption(f.sort, REC_SORTS) as RecSort;
  const sections = useMemo(() => arrangeRecs(data.sections, data.cards, data.scores, groupBy, sort), [data, groupBy, sort]);
  const bracket = data.query.bracket;

  const stats = (c: RecCard): TileStat[] => {
    const out: TileStat[] = [{ label: 'syn', value: `${c.synergy}%`, title: `Forge: synergy with ${name}` }];
    if (c.edhrec) {
      out.push({ label: 'in', value: `${c.edhrec.inclusion}%`, title: `EDHREC: in ${c.edhrec.decks} of ${edhrecDecks ?? 'its'} ${name} decks` });
      if (c.edhrec.lift !== null) out.push({ label: 'lift', value: c.edhrec.lift.toFixed(1), title: 'EDHREC: lift, how much more often than in other decks of these colours' });
    }
    const price = data.cards[c.oracleId]?.priceUsd ?? null;
    out.push({ label: '', value: fmtPrice(price), title: 'Scryfall price' });
    return out;
  };

  const body = (s: ArrangedSection) => {
    if (s.cards.length === 0) {
      return <EmptyState message={s.empty ?? 'Nothing here.'} action={s.empty ? <EmptyAction text={s.empty} /> : undefined} testId="rec-empty" />;
    }
    if (f.view === 'list') {
      return (
        <RecList cards={s.cards}>
          {(shown) => shown.map((c) => {
            const card = data.cards[c.oracleId];
            if (!card) return null;
            return (
              <li key={c.oracleId} className="grid grid-cols-[minmax(0,1fr)_7rem_3rem_3.5rem_8rem_4.5rem_1.5rem] items-center gap-3 bg-anvil px-3 py-1.5" data-testid="rec-row">
                <button type="button" className="truncate text-left hover:text-brass" onClick={() => setDetail(c.oracleId)}>{card.name}</button>
                <span className="text-ash"><Mana cost={card.manaCost} /></span>
                <span title={`Forge: ${data.scores[c.oracleId]?.score} of 100 in a ${name} deck at Bracket ${bracket}`}>{data.scores[c.oracleId]?.score}</span>
                <span className="text-ash" title={`Forge: synergy with ${name}`}>{c.synergy}%</span>
                <span className="text-ash">{c.edhrec ? <span title={`EDHREC: in ${c.edhrec.decks} decks`}>{c.edhrec.inclusion}%{c.edhrec.lift !== null ? ` · lift ${c.edhrec.lift.toFixed(1)}` : ''}</span> : ''}</span>
                <span className="text-right text-ash" title="Scryfall price">{fmtPrice(card.priceUsd)}</span>
                <span>
                  {card.owned && <span className="inline-block h-[7px] w-[7px] rounded-full bg-ash" title="In your collection" role="img" aria-label="In your collection" />}
                  {data.heldBy[c.oracleId] && <HeldMark names={data.heldBy[c.oracleId]} small />}
                </span>
              </li>
            );
          })}
        </RecList>
      );
    }
    return (
      <CardGrid size={f.size}>
        {s.cards.map((c) => {
          const card = data.cards[c.oracleId];
          if (!card) return null;
          return (
            <CardTile
              key={c.oracleId}
              card={card}
              size={f.size}
              score={data.scores[c.oracleId]?.score}
              scoreTitle={`Forge: ${data.scores[c.oracleId]?.score} of 100 in a ${name} deck at Bracket ${bracket}`}
              stats={stats(c)}
              heldBy={data.heldBy[c.oracleId]}
              onOpen={() => setDetail(c.oracleId)}
            />
          );
        })}
      </CardGrid>
    );
  };

  return (
    <JumpScope>
      <div className="grid grid-cols-[11rem_minmax(0,1fr)] gap-6" data-testid="recs">
        <JumpRail className="sticky top-[var(--cmd-bar,6rem)] self-start" />
        <div className="min-w-0">
          {sections.map((s) => (
            <Fragment key={s.id}>
              <Section id={`rec-${s.id}`} title={s.title} count={s.total} cap={30} data={{ 'data-section': s.id }}>
                {s.note && <p className="mb-2 text-[13px] text-ash">{s.note}</p>}
                {body(s)}
              </Section>
            {groupBy === 'category' && s.id === 'owned' && (
            <Section id="rec-packages" title="Packages" data={{ 'data-section': 'packages' }}>
              <EmptyState testId="rec-packages-pending" message="Packages of cards that work together arrive with the packages work." />
            </Section>
          )}
            </Fragment>
          ))}
        </div>
      </div>
      {detail && (
        <CardDetail
          id={detail}
          card={data.cards[detail]}
          score={data.scores[detail]}
          held={data.heldBy[detail]}
          bracket={bracket}
          onClose={() => setDetail(null)}
        />
      )}
    </JumpScope>
  );
}
