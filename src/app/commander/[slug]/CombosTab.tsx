'use client';

import { useEffect, useState } from 'react';
import { CardDetail } from '@/app/components/CardDetail';
import { ComboRow } from '@/app/components/ComboRow';
import { EmptyState } from '@/app/components/EmptyState';
import { Section } from '@/app/components/Section';
import { useNotify } from '@/app/components/Shell';
import { ApiError, getCommanderCombos, type CommanderCombosResponse, type RecsQuery } from '@/app/lib/api';
import { setFilters } from '@/app/lib/filters';
import { isAbort } from '@/app/lib/ui';
import { COMBO_TAG } from '@/engine/brackets';
import type { FoundCombo } from '@/engine/types';

export function CombosTab({ slug, withSlug, q, name, tick, std = false }: { slug: string; withSlug?: string; q: RecsQuery; name: string; tick: number; std?: boolean }) {
  const notify = useNotify();
  const [data, setData] = useState<CommanderCombosResponse | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  useEffect(() => {
    const ctrl = new AbortController();
    getCommanderCombos(slug, { ...q, with: withSlug }, ctrl.signal).then(setData, (e) => { if (!isAbort(e) && !(e instanceof ApiError && e.status === 404)) notify.error(e); });
    return () => ctrl.abort();
  }, [slug, withSlug, q, tick, notify]);
  if (!data) return <p className="text-ash">Loading combos…</p>;
  if (data.total === 0) {
    return (
      <EmptyState
        testId="combos"
        message="No combo fits these filters."
        action={q.ownedOnly ? <button type="button" className="btn btn-sm" onClick={() => setFilters({ ownedOnly: false })}>Turn off Only my collection</button> : undefined}
      />
    );
  }
  const own = data.combos.slice(0, Math.min(data.withCommander, data.combos.length));
  const other = data.combos.slice(own.length);
  const row = (f: FoundCombo) => (
    <div key={f.combo.id} className="mb-3" data-testid="combo-item">
      <span className="chip mb-1" title={std ? 'Commander Spellbook' : `Commander Spellbook: fits Bracket ${COMBO_TAG[f.combo.bracketTag].bracket} and up`}>{COMBO_TAG[f.combo.bracketTag].label}</span>
      <ComboRow found={f} lookup={data.cards} heldBy={data.heldBy} onOpen={setDetail} />
    </div>
  );
  return (
    <div data-testid="combos">
      <p className="mb-3 text-ash tabular-nums" data-testid="combos-line">
        {data.total} {data.total === 1 ? 'combo fits' : 'combos fit'} {name}{std ? '' : ` at Bracket ${q.bracket}`}{data.combos.length < data.total ? `, showing the first ${data.combos.length}` : ''}
      </p>
      {own.length > 0 && <Section id="combos-with" title={`With ${name}`} count={data.withCommander}>{own.map(row)}</Section>}
      {other.length > 0 && <Section id="combos-other" title="Other combos in these colours" count={data.total - data.withCommander}>{other.map(row)}</Section>}
      {detail && <CardDetail id={detail} card={data.cards[detail]} bracket={q.bracket} onClose={() => setDetail(null)} />}
    </div>
  );
}
