'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CardDetail } from '../../components/CardDetail';
import { CardGrid } from '../../components/CardGrid';
import { CardTile } from '../../components/CardTile';
import { ColorChips } from '../../components/ColorChips';
import { CommanderTileView } from '../../components/CommanderTileView';
import { EmptyState } from '../../components/EmptyState';
import { FilterBar } from '../../components/FilterBar';
import { Section } from '../../components/Section';
import { useNotify } from '../../components/Shell';
import { ApiError, getTheme, type ColorLetter, type ThemeResponse } from '../../lib/api';
import { useFilters } from '../../lib/filters';
import { safeDecode } from '../../lib/links';
import { isAbort } from '../../lib/ui';

export default function ThemePage() {
  const { axis } = useParams<{ axis: string }>();
  const notify = useNotify();
  const { bracket, size, ready } = useFilters();
  const [colors, setColors] = useState<ColorLetter[]>([]);
  const [data, setData] = useState<ThemeResponse | null>(null);
  const [missing, setMissing] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    const ctrl = new AbortController();
    getTheme(safeDecode(axis), { colors: colors.length ? colors : undefined, bracket }, ctrl.signal).then(
      (r) => { setData(r); setMissing(null); },
      (e) => { if (isAbort(e)) return; if (e instanceof ApiError && e.status === 404) setMissing(e.message); else notify.error(e); },
    );
    return () => ctrl.abort();
  }, [ready, axis, colors, bracket, notify]);

  if (missing) {
    return (
      <div className="mx-auto max-w-[1100px] px-8 py-7">
        <EmptyState title={missing} message="That address does not match a theme." action={<Link href="/themes" className="btn btn-sm">See every theme</Link>} />
      </div>
    );
  }
  if (!data) return <div className="px-8 py-7 text-ash">Loading theme…</div>;
  const label = data.theme.label;
  return (
    <div className="mx-auto max-w-[1500px] px-8 py-7" data-testid="theme-page">
      <p className="text-ash"><Link href="/themes" className="hover:text-bone">Themes</Link></p>
      <h1 className="mt-1 text-[2rem] leading-none">{label}</h1>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ColorChips colors={colors} onColors={setColors} />
        <FilterBar show={['bracket', 'size']} />
      </div>
      <div className="mt-4">
        <Section id="theme-commanders" title="Commanders that lead it" count={data.commanders.length} cap={30}>
          {data.commanders.length === 0 ? (
            <EmptyState message="No commander leads this theme in these colours." />
          ) : (
            <CardGrid size="L">
              {data.commanders.map((c) => <CommanderTileView key={c.oracleId} commander={c} />)}
            </CardGrid>
          )}
        </Section>
        <Section id="theme-cards" title={`Top cards for ${label}`} count={data.top.length} cap={30}>
          {data.top.length === 0 ? (
            <EmptyState message="No card serves this theme in these colours." />
          ) : (
            <CardGrid size={size}>
              {data.top.map((id) => (
                <CardTile
                  key={id}
                  card={data.cards[id]}
                  size={size}
                  score={data.scores[id]?.score}
                  scoreTitle={`Forge: ${data.scores[id]?.score} of 100 in a ${label} deck at Bracket ${bracket}`}
                  onOpen={() => setDetail(id)}
                />
              ))}
            </CardGrid>
          )}
        </Section>
      </div>
      {detail && <CardDetail id={detail} card={data.cards[detail]} score={data.scores[detail]} bracket={bracket} onClose={() => setDetail(null)} />}
    </div>
  );
}
