'use client';

import { useEffect, useState } from 'react';
import { CardGrid } from '@/app/components/CardGrid';
import { CommanderTileView } from '@/app/components/CommanderTileView';
import { EmptyState } from '@/app/components/EmptyState';
import { useNotify } from '@/app/components/Shell';
import { ApiError, getSimilarCommanders, type RecsQuery, type SimilarResponse } from '@/app/lib/api';
import { setFilters } from '@/app/lib/filters';
import { isAbort } from '@/app/lib/ui';

export function SimilarTab({ slug, withSlug, q, name }: { slug: string; withSlug?: string; q: RecsQuery; name: string }) {
  const notify = useNotify();
  const [data, setData] = useState<SimilarResponse | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    getSimilarCommanders(slug, withSlug, { budget: q.budget, ownedOnly: q.ownedOnly, arenaFormat: q.arenaFormat }, ctrl.signal).then(setData, (e) => { if (!isAbort(e) && !(e instanceof ApiError && e.status === 404)) notify.error(e); });
    return () => ctrl.abort();
  }, [slug, withSlug, q.budget, q.ownedOnly, q.arenaFormat, notify]);
  if (!data) return <p className="text-ash">Loading similar commanders…</p>;
  const shown = data.commanders;
  return (
    <div data-testid="similar">
      {data.basis === 'popularity' && <p className="mb-3 text-ash">{name} names no theme, so these are the most played commanders in its colours.</p>}
      {q.ownedOnly && shown.length > 0 && <p className="mb-3 text-ash">Commanders you own</p>}
      {shown.length === 0 ? (
        <EmptyState
          message={q.ownedOnly ? 'You own none of these commanders.' : 'No commander fits these filters.'}
          action={q.ownedOnly ? <button type="button" className="btn btn-sm" onClick={() => setFilters({ ownedOnly: false })}>Turn off Only my collection</button> : undefined}
        />
      ) : (
        <CardGrid size="L">
          {shown.map((c) => (
            <CommanderTileView
              key={c.oracleId}
              commander={c}
              caption={c.similarity === null ? undefined : `${Math.round(c.similarity * 100)}% alike${c.colorsOff ? ' · one colour off' : ''}`}
              captionTitle="Forge: theme weights compared"
            />
          ))}
        </CardGrid>
      )}
    </div>
  );
}
