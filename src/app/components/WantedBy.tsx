'use client';

import { useEffect, useState } from 'react';
import type { Bracket } from '@/engine/types';
import { getWantedBy, type WantedByResponse } from '../lib/api';
import { useFilters } from '../lib/filters';
import { useBuildFormat } from './Shell';
import { isAbort } from '../lib/ui';
import { CommanderTileView } from './CommanderTileView';

/** "Commanders that want this card": a row of commander tiles scored for it, fetched shortly after the drawer opens. */
export function WantedBy({ oracleId, bracket }: { oracleId: string; bracket?: Bracket }) {
  const shared = useFilters().bracket;
  const b = bracket ?? shared;
  const format = useBuildFormat();
  const [data, setData] = useState<WantedByResponse | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setData(null);
    setFailed(false);
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      getWantedBy(oracleId, b, ctrl.signal, format).then(setData, (e) => { if (!isAbort(e)) setFailed(true); });
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [oracleId, b, format]);

  return (
    <section className="mt-5 border-t border-slag pt-4" data-testid="wanted-by">
      <h3 className="text-[18px] leading-tight">Commanders that want this card</h3>
      {failed ? (
        <p className="mt-2 text-ash">Could not load commanders.</p>
      ) : data === null ? (
        <p className="mt-2 text-ash">Finding commanders…</p>
      ) : (
        <>
          {data.note && <p className="mt-2 text-ash">{data.note}</p>}
          {data.commanders.length > 0 && (
            <div className="mt-2 grid grid-flow-col auto-cols-[7.5rem] gap-2 overflow-x-auto pb-1">
              {data.commanders.map((w) => (
                <CommanderTileView
                  key={w.commander.oracleId}
                  commander={w.commander}
                  size="S"
                  caption={w.score}
                  captionTitle={`Forge: this card's score in a ${w.commander.frontName} deck at Bracket ${b}`}
                />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
