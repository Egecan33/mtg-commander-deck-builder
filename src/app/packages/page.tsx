'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import type { Color } from '@/engine/types';
import { CardDetail } from '../components/CardDetail';
import { ColorPip } from '../components/card';
import { EmptyState } from '../components/EmptyState';
import { FilterBar } from '../components/FilterBar';
import { useFreeOnly } from '../components/held';
import { JumpRail, JumpScope } from '../components/JumpRail';
import { Menu, type MenuItem } from '../components/Menu';
import { OddsBar } from '../components/OddsBar';
import { PackageHand } from '../components/PackageHand';
import { Section } from '../components/Section';
import { useCollections, useNotify } from '../components/Shell';
import { getPackages, listDecks, type ClientCard, type ColorLetter, type DeckTile, type PackagesResponse } from '../lib/api';
import { COLOR_NAME, COLOR_ORDER, isAbort } from '../lib/ui';

const STORAGE_KEY = 'cf-package-colors';
const HAND = 8;

function readColors(): ColorLetter[] {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown;
    return Array.isArray(raw) ? COLOR_ORDER.filter((c) => raw.includes(c)) : [];
  } catch {
    return [];
  }
}

/** "blue and black", "white, blue and black", "colourless". */
function colourWords(colors: readonly ColorLetter[]): string {
  const names = colors.map((c) => COLOR_NAME[c].toLowerCase());
  return names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const deckColors = (d: DeckTile): Set<string> => new Set(d.commanders.flatMap((c) => c.colorIdentity));

export default function PackagesPage() {
  const notify = useNotify();
  const router = useRouter();
  const { active } = useCollections();
  const [freeOnlyPref] = useFreeOnly();
  const freeOnly = !!freeOnlyPref;
  const [colors, setColors] = useState<ColorLetter[]>([]);
  const [data, setData] = useState<PackagesResponse | null>(null);
  const [decks, setDecks] = useState<DeckTile[]>([]);
  const [detail, setDetail] = useState<string | null>(null);

  useEffect(() => setColors(readColors()), []);
  const toggle = (c: ColorLetter) => {
    const on = colors.includes(c);
    const next = c === 'C' ? (on ? [] : ['C' as ColorLetter]) : COLOR_ORDER.filter((x) => x !== 'C' && (x === c ? !on : colors.includes(x)));
    setColors(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* the choice just is not remembered */
    }
  };

  const key = colors.join('');
  const collectionId = active?.id ?? null;
  useEffect(() => {
    if (colors.length === 0) {
      setData(null);
      return;
    }
    const ctl = new AbortController();
    setData((d) => (d && d.colors.join('') === key ? d : null));
    getPackages(colors, freeOnly, ctl.signal).then(setData, (e) => {
      if (!isAbort(e)) notify.error(e);
    });
    return () => ctl.abort();
    // `colors` is represented by `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, freeOnly, collectionId, notify]);

  useEffect(() => {
    const ctl = new AbortController();
    listDecks(ctl.signal).then((r) => setDecks(r.decks), (e) => {
      if (!isAbort(e)) notify.error(e);
    });
    return () => ctl.abort();
  }, [notify]);

  const lookup = useMemo(() => {
    const m: Record<string, ClientCard> = {};
    for (const p of data?.packages ?? []) for (const c of p.cards) m[c.oracleId] = c;
    return m;
  }, [data]);

  const chosen = colors.filter((c): c is Color => c !== 'C');
  const eligible = decks.filter((d) => {
    const have = deckColors(d);
    return chosen.every((c) => have.has(c));
  });
  const addMenu = (pkgId: string): MenuItem[] =>
    eligible.length === 0
      ? [{ label: 'No deck of these colours yet', disabled: true, onSelect: () => undefined }]
      : eligible.map((d) => ({
          label: d.name,
          description: `Bracket ${d.targetBracket} · rating ${Math.round(d.rating)}`,
          onSelect: () => router.push(`/deck/${d.id}?panel=packages&package=${encodeURIComponent(pkgId)}`),
          testId: 'package-add-to-deck-item',
        }));

  const words = colourWords(colors);
  const core = data?.packages.filter((p) => p.kind === 'core') ?? [];
  const themes = data?.packages.filter((p) => p.kind === 'theme') ?? [];
  const functional = data?.packages.filter((p) => p.kind === 'functional') ?? [];
  const group = (heading: string, list: PackagesResponse['packages']) =>
    list.length === 0 ? null : (
      <div key={heading}>
        <h2 className="mb-1 mt-2 text-[24px] leading-tight">{heading}</h2>
        {list.map((p) => {
          const shown = Math.min(HAND, p.total);
          return (
            <Section
              key={p.id}
              id={p.id}
              title={p.name}
              count={p.total}
              actions={<Menu label="Add to a deck…" items={addMenu(p.id)} testId="package-add-to-deck" align="right" title={`Open one of your decks on its Packages tab with ${p.name} pointed out`} />}
              testId="package-section"
              data={{ 'data-package': p.id }}
            >
              <p className="mb-1 text-[13px] text-ash" data-testid="package-total">{shown} of {p.total} owned</p>
              {p.kind === 'core' && p.total < HAND && (
                <EmptyState className="mb-2" message={`Your collection has only ${p.total} ${p.name.toLowerCase()} ${p.total === 1 ? 'card' : 'cards'} in ${words}.`} />
              )}
              <div className="grid grid-cols-[minmax(0,1fr)_17rem] items-end gap-6">
                <PackageHand cards={p.cards} heldBy={data?.heldBy} onOpen={setDetail} />
                <div className="pb-8"><OddsBar hits={shown} label={`${shown} of ${p.name}`} testId="package-odds" /></div>
              </div>
            </Section>
          );
        })}
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="packages-page">
      <header className="sticky top-0 z-20 shrink-0 border-b border-slag bg-soot px-6 py-3">
        <div className="flex items-baseline gap-4">
          <h1 className="text-[32px] leading-none">Packages</h1>
          <p className="text-[13px] text-ash" data-testid="packages-facts">From your {active ? `${active.name} ` : ''}collection</p>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex items-center gap-1.5" role="group" aria-label="Colours">
            {COLOR_ORDER.map((c) => {
              const on = colors.includes(c);
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  title={COLOR_NAME[c]}
                  className={`rounded-full ${on ? 'outline outline-2 outline-offset-1 outline-brass' : ''}`}
                  onClick={() => toggle(c)}
                  data-testid="color-chip"
                  data-color={c}
                >
                  <ColorPip color={c} size="1.75rem" dim={!on && colors.length > 0} />
                </button>
              );
            })}
          </div>
          <FilterBar show={['freeOnly']} own={{ ownedOnly: true }} collectionName={active?.name ?? null} />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {colors.length === 0 ? (
          <div className="px-6 py-6"><EmptyState message="Pick a colour to see your packages." testId="packages-empty" /></div>
        ) : !data ? (
          <p className="px-6 py-6 text-ash">Looking through your collection</p>
        ) : (
          <JumpScope>
            <div className="flex gap-6 px-6 py-4">
              <JumpRail className="sticky top-4 w-44 shrink-0 self-start" />
              <div className="min-w-0 flex-1">
                {group('Core packages', core)}
                {group(`Themes for ${words}`, themes)}
                {group('Functional', functional)}
              </div>
            </div>
          </JumpScope>
        )}
      </div>

      {detail && (
        <CardDetail id={detail} card={lookup[detail]} held={data?.heldBy[detail]} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}
