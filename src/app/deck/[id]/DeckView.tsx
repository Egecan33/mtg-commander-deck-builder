'use client';

import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CardScore, Deck, DeckEntry, FoundCombo, PlannedPackage } from '@/engine/types';
import { CardGrid } from '../../components/CardGrid';
import { ComboRow } from '../../components/ComboRow';
import { CardTile, LockIcon, unknownCard, type TileMark } from '../../components/CardTile';
import { EmptyState } from '../../components/EmptyState';
import { FilterBar, pickOption, type FilterOption } from '../../components/FilterBar';
import { JumpRail, JumpScope } from '../../components/JumpRail';
import { Section } from '../../components/Section';
import { Mana, ScoreBadge } from '../../components/card';
import { HeldMark } from '../../components/held';
import type { CardLookup, ClientCard, HeldBy } from '../../lib/api';
import { findCards } from '../../lib/api';
import { useFilters } from '../../lib/filters';
import { ROLE_GROUPS, TYPE_GROUPS, packageNote, roleGroup, typeGroup } from '../../lib/ui';

export type Grouping = 'role' | 'type';

const GROUPS: FilterOption[] = [
  { id: 'role', label: 'By role', title: 'Group the cards by what they do: ramp, card draw, removal' },
  { id: 'type', label: 'By type', title: 'Group the cards by card type: creatures, instants, lands' },
];

interface Row { entry: DeckEntry; card: ClientCard | undefined; zone: 'commander' | 'companion' | 'main' }

/** The combos the deck has and the ones a card short, as returned by the analysis. */
export interface DeckCombos { included: FoundCombo[]; oneAway: FoundCombo[] }
const COMBO_CAP = 5;

const sectionId = (label: string) => `deck-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;

/** The deck as card images in titled sections (by what the cards do, or by card type) with a jump rail; or as a compact list. */
export function DeckView({
  deck, lookup, scoreOf, weakest, held, onRemove, onAdd, onLock, onOpen, tools, notice, result, lead, combos, comboHeld, onPutIn, packages,
}: {
  /** The deck's planned packages: a role heading whose package counts a different number says so ("Ramp 6 · 8 in the package"). */
  packages?: readonly PlannedPackage[] | null;
  /** The deck's combos (null while the analysis loads: no Combos section yet). */
  combos?: DeckCombos | null;
  /** Boxes and built decks holding the cards a combo is missing. */
  comboHeld?: HeldBy;
  /** Put it in, on a combo one card away: opens that card's detail. */
  onPutIn?: (id: string) => void;
  /** Shown before the deck's heading (Show card search, when it is hidden). */
  lead?: ReactNode;
  /** Extra actions for the whole deck, shown under the header. */
  tools?: ReactNode;
  /** Shown above the cards (what the deck takes from boxes and built decks, the box offer). */
  notice?: ReactNode;
  /** What the last action changed (the Fix deck panel), at the top of the scrolling deck. */
  result?: ReactNode;
  deck: Deck;
  lookup: CardLookup;
  scoreOf: (id: string) => CardScore | undefined;
  weakest: Set<string>;
  /** Deck cards whose free copies do not cover the deck, with the boxes and built decks holding them. */
  held: HeldBy;
  /** Without all three the deck is read-only: tiles carry no actions. */
  onRemove?: (id: string) => void;
  onAdd?: (id: string) => void;
  onLock?: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const filters = useFilters();
  const editable = !!(onRemove && onAdd && onLock);
  const grouping = pickOption(filters.groupBy, GROUPS) as Grouping;
  const layout = filters.view;

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
    zone(deck.companion ? [deck.companion] : [], 'Companion (outside the deck)', 'companion');
    for (const label of order) {
      const rows = by.get(label);
      if (!rows) continue;
      rows.sort((a, b) => (a.card?.cmc ?? 0) - (b.card?.cmc ?? 0) || (a.card?.name ?? '').localeCompare(b.card?.name ?? ''));
      out.push({ label, rows });
    }
    return out;
  }, [deck, lookup, grouping]);

  // ---- Find in deck: the deck's own cards filtered by the shared matcher (name, type, rules text) on the server.
  const [find, setFind] = useState('');
  const [found, setFound] = useState<ReadonlySet<string> | null>(null);
  const findRef = useRef<HTMLInputElement>(null);
  const allIds = useMemo(() => [...new Set([...deck.commanders, ...(deck.companion ? [deck.companion] : []), ...deck.main.map((e) => e.oracleId)])], [deck]);
  const finding = find.trim() !== '';
  useEffect(() => {
    if (!finding) {
      setFound(null);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      findCards(allIds, find, ctrl.signal).then((r) => setFound(new Set(r.ids)), () => {});
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [find, finding, allIds]);
  // "f" goes to the field when no field has the focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key !== 'f' || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if (el && (/INPUT|TEXTAREA|SELECT/.test(el.tagName) || el.isContentEditable)) return;
      e.preventDefault();
      findRef.current?.focus();
      findRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const filtering = finding && found !== null;
  const shown = useMemo(
    () => (filtering ? groups.map((g) => ({ ...g, rows: g.rows.filter((r) => found!.has(r.entry.oracleId)) })).filter((g) => g.rows.length > 0) : groups),
    [groups, filtering, found],
  );
  const mainCopies = (gs: { rows: Row[] }[]) => gs.reduce((n, g) => n + g.rows.reduce((m, r) => (r.zone === 'main' ? m + r.entry.qty : m), 0), 0);

  const empty = deck.main.length === 0;
  const [allAway, setAllAway] = useState(false);
  const leadZones = shown.filter((g) => g.rows[0]?.zone !== 'main').length;
  const comboSection = combos && !filtering ? (
    <Section key="combos" id="deck-combos" title="Combos" count={combos.included.length} testId="deck-combos" data={{ 'data-complete': combos.included.length, 'data-one-away': combos.oneAway.length }}>
      {combos.included.length === 0 ? (
        <p className="text-ash" data-testid="combos-none">No combo in this deck yet.</p>
      ) : (
        <ul className="grid gap-2" data-testid="combos-complete">
          {combos.included.map((f) => <ComboRow key={f.combo.id} found={f} lookup={lookup} onOpen={onOpen} />)}
        </ul>
      )}
      {combos.oneAway.length > 0 && (
        <div className="mt-4" data-testid="combos-one-away">
          <h4 className="mb-2 text-[15px] font-semibold">
            One card away <span className="ml-1 font-normal text-ash [font-variant-numeric:tabular-nums]">{combos.oneAway.length}</span>
          </h4>
          <ul className="grid gap-2">
            {(allAway ? combos.oneAway : combos.oneAway.slice(0, COMBO_CAP)).map((f) => (
              <ComboRow key={f.combo.id} found={f} lookup={lookup} heldBy={comboHeld} onOpen={onOpen} onPutIn={onPutIn} />
            ))}
          </ul>
          {combos.oneAway.length > COMBO_CAP && (
            <button type="button" className="btn btn-sm btn-quiet mt-2" onClick={() => setAllAway(!allAway)}>
              {allAway ? 'Show fewer' : `Show all ${combos.oneAway.length}`}
            </button>
          )}
        </div>
      )}
    </Section>
  ) : null;

  const tile = ({ entry, card, zone }: Row) => {
    const id = entry.oracleId;
    const score = scoreOf(id);
    const c = card ?? unknownCard(id);
    const name = c.name;
    const weak = weakest.has(id);
    const illegal = zone === 'main' && !!score?.gate;
    const holders = held[id];
    const locked = zone === 'main' && entry.locked;
    const marks: TileMark[] = [];
    if (illegal) marks.push('illegal');
    else if (weak) marks.push('weakest');
    if (locked) marks.push('locked');
    return (
      <CardTile
        key={id}
        card={c}
        known={!!card}
        size="S"
        score={score && !score.gate ? score.score : null}
        gate={score?.gate?.message ?? null}
        heldBy={holders}
        marks={marks}
        qty={entry.qty}
        onOpen={() => onOpen(id)}
        testId="deck-card"
        data={{
          'data-name': name,
          'data-id': id,
          'data-zone': zone,
          'data-weak': weak || undefined,
          'data-locked': locked || undefined,
          'data-held': holders ? true : undefined,
        }}
        actions={
          !editable ? undefined : zone === 'main' ? (
            <>
              <button
                type="button"
                className={`tile-btn tile-hover ${entry.locked ? 'tile-btn-on' : ''}`}
                onClick={() => onLock?.(id)}
                aria-pressed={entry.locked}
                aria-label={entry.locked ? `Unlock ${name}` : `Lock ${name} so it is never cut`}
                title={entry.locked ? 'Locked: auto-build and improve keep this card. Click to unlock.' : 'Lock: keep this card through auto-build and improve'}
                data-testid="deck-lock"
              >
                <LockIcon open={!entry.locked} />
              </button>
              <button type="button" className="tile-btn tile-hover" onClick={() => onRemove?.(id)} aria-label={`Remove ${name} from the deck`} title="Remove one copy from the deck" data-testid="deck-remove">
                &minus;
              </button>
            </>
          ) : zone === 'companion' ? (
            <button type="button" className="tile-btn tile-hover" onClick={() => onRemove?.(id)} aria-label={`Remove ${name} as companion`} title="Remove the companion">
              &minus;
            </button>
          ) : undefined
        }
      />
    );
  };

  const row = ({ entry, card, zone }: Row) => {
    const id = entry.oracleId;
    const score = scoreOf(id);
    const name = card?.name ?? `Unknown card (${id.slice(0, 8)})`;
    return (
      <li key={id} className="group flex h-8 items-center gap-2 px-2 hover:bg-anvil" data-testid="deck-row" data-name={name} data-held={held[id] ? true : undefined}>
        <span className="w-5 text-right text-smoke">{entry.qty}</span>
        <button type="button" className="min-w-0 flex-1 truncate text-left hover:text-brass" onClick={() => onOpen(id)}>
          {name}
          {weakest.has(id) && <span className="ml-2 text-[0.75rem] text-band-mid">weakest</span>}
          {zone === 'main' && score?.gate && <span className="ml-2 text-[0.75rem] text-band-low">{score.gate.message}</span>}
        </button>
        <HeldMark names={held[id]} small />
        {card?.manaCost && <Mana cost={card.manaCost} size="0.95rem" />}
        <ScoreBadge score={score} />
        {!editable ? null : zone === 'main' ? (
          <>
            <button type="button" className={`tile-btn ${entry.locked ? 'tile-btn-on' : 'opacity-40 group-hover:opacity-100'}`} onClick={() => onLock?.(id)} aria-pressed={entry.locked} aria-label={entry.locked ? `Unlock ${name}` : `Lock ${name}`}>
              <LockIcon open={!entry.locked} />
            </button>
            {card?.roles.includes('land') && (
              <button type="button" className="tile-btn opacity-40 group-hover:opacity-100" onClick={() => onAdd?.(id)} aria-label={`Add another ${name}`}>+</button>
            )}
            <button type="button" className="tile-btn opacity-40 group-hover:opacity-100" onClick={() => onRemove?.(id)} aria-label={`Remove ${name} from the deck`} data-testid="deck-remove">&minus;</button>
          </>
        ) : (
          <span className="w-[4.6rem] shrink-0 text-right text-[0.75rem] text-smoke">{zone}</span>
        )}
      </li>
    );
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 flex-col border-l border-slag" aria-label="Deck" data-testid="deck-view">
      <div className="flex items-center gap-2 px-3 pb-2 pt-3">
        {lead}
        <h2 className="mr-auto text-[18px] leading-none">Deck</h2>
        <FilterBar show={['groupBy', 'view']} groups={GROUPS} testId="deck-view-controls" />
      </div>

      <div className="flex items-center gap-2 px-3 pb-2" data-testid="deck-find">
        <input
          ref={findRef}
          type="search"
          className="field h-7 min-w-0 flex-1 text-[0.8125rem]"
          value={find}
          onChange={(e) => setFind(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setFind('');
              e.currentTarget.blur();
            }
          }}
          placeholder="Find in deck   ( f )"
          aria-label="Find in deck"
          spellCheck={false}
          autoComplete="off"
          data-testid="deck-find-input"
        />
        {finding && (
          <span className="shrink-0 text-[0.8125rem] text-ash [font-variant-numeric:tabular-nums]" aria-live="polite" data-testid="deck-find-count">
            {filtering ? `${mainCopies(shown)} of ${mainCopies(groups)} match` : 'Searching'}
          </span>
        )}
      </div>

      {tools && <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2">{tools}</div>}
      {notice && <div className="grid gap-1.5 px-3 pb-2">{notice}</div>}

      <JumpScope>
        <div className="flex min-h-0 flex-1">
          <JumpRail label="Deck sections" className="w-[8.5rem] shrink-0 overflow-y-auto overscroll-contain pb-4 pl-2 pr-1 pt-2" />
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain pb-4 pl-2 pr-3" data-testid="deck-scroll">
            {result}
            {empty && (
              <EmptyState
                className="mb-4 mt-2"
                title="The main deck is empty"
                message="Add cards from the card search on the left with the + on each card, or use Build, Auto-build above for a full deck."
                testId="deck-empty"
              />
            )}

            {filtering && shown.length === 0 && (
              <EmptyState className="mb-4 mt-2" title="Nothing in the deck matches" message={`No card here matches “${find.trim()}” in its name, type or rules text.`} testId="deck-find-none" />
            )}
            {shown.map((g, i) => (
              <Fragment key={g.label}>
              {i === leadZones && comboSection}
              <Section
                id={sectionId(g.label)}
                title={g.label}
                count={g.rows.reduce((s, r) => s + r.entry.qty, 0)}
                note={filtering ? undefined : packageNote(g.label, g.rows.reduce((s, r) => s + r.entry.qty, 0), grouping === 'role' ? packages : null)}
                testId="deck-group"
                data={{ 'data-group': g.label }}
              >
                {layout === 'grid' ? (
                  <CardGrid size="S">{g.rows.map(tile)}</CardGrid>
                ) : (
                  <ul className="divide-y divide-iron rounded-md border border-iron" data-testid="deck-list">
                    {g.rows.map(row)}
                  </ul>
                )}
              </Section>
              </Fragment>
            ))}
            {leadZones >= shown.length && comboSection}
          </div>
        </div>
      </JumpScope>
    </section>
  );
}
