'use client';

import { EmptyState } from '@/app/components/EmptyState';
import { OddsBar } from '@/app/components/OddsBar';
import { Section } from '@/app/components/Section';
import { ColorPip } from '@/app/components/card';
import { deckSizeOf } from '@/engine/format';
import { setFilters } from '@/app/lib/filters';
import { BAND_VAR } from '@/app/lib/ui';
import { chartData } from './charts-data';
import type { AverageDeck } from './useAverageDeck';

/** Horizontal bar over a shaded aim band; the fill colour says low, in band or over, and the label says it too. */
function RoleBar({ label, count, lo, hi, max }: { label: string; count: number; lo: number; hi: number; max: number }) {
  const state = count < lo ? 'low' : count > hi ? 'mid' : 'good';
  const word = count < lo ? 'below' : count > hi ? 'above' : 'in';
  const pct = (n: number) => `${(Math.min(n, max) / max) * 100}%`;
  return (
    <div className="grid grid-cols-[11rem_minmax(0,1fr)_9rem] items-center gap-3" data-testid="role-bar" title={`Forge: ${count}, aim ${lo}–${hi}`}>
      <span className="text-ash">{label}</span>
      <svg viewBox="0 0 100 10" preserveAspectRatio="none" className="h-3 w-full" role="img" aria-label={`${label}: ${count}, aim ${lo} to ${hi}`}>
        <rect x="0" y="0" width="100" height="10" fill="var(--color-iron)" />
        <rect x={parseFloat(pct(lo))} y="0" width={parseFloat(pct(hi)) - parseFloat(pct(lo))} height="10" fill="var(--color-slag)" />
        <rect x="0" y="2.5" width={parseFloat(pct(count))} height="5" fill={BAND_VAR[state]} />
      </svg>
      <span className="tabular-nums text-bone">{count} <span className="text-smoke">{word} {lo}–{hi}</span></span>
    </div>
  );
}

export function ChartsTab({ avg, name, bracket }: { avg: AverageDeck; name: string; bracket: number | null }) {
  if (avg.error) return <EmptyState message={`Could not build the average deck: ${avg.error}`} />;
  if (avg.empty) {
    return (
      <EmptyState
        message={`None of your cards fits ${name}, so there is no deck to chart. Turn off Only my collection to chart the best deck from every card.`}
        action={<button type="button" className="btn btn-sm" onClick={() => setFilters({ ownedOnly: false })}>Turn off Only my collection</button>}
      />
    );
  }
  if (!avg.deck || !avg.analysis) return <p className="text-ash">Building the average deck…</p>;
  const d = chartData(avg.deck, avg.analysis);
  const librarySize = deckSizeOf(avg.analysis.format) - avg.deck.commanders.length;
  const maxCurve = Math.max(1, ...d.curve.map((c) => c.count));
  const maxType = Math.max(1, ...d.types.map((t) => t.count));
  const maxRole = Math.max(1, ...d.roles.map((r) => Math.max(r.count, r.band.hi)));
  const maxSource = Math.max(1, ...d.sources.map((s) => s.count));
  return (
    <div data-testid="charts" className="grid max-w-[60rem] gap-2">
      <Section id="chart-curve" title="Mana curve" testId="chart-curve">
        <svg viewBox="0 0 320 130" className="w-full max-w-[32rem]" role="img" aria-label={`Mana curve, average ${d.avgMv.toFixed(2)}, aim ${d.avgBand.lo}–${d.avgBand.hi}`}>
          {d.curve.map((c, i) => {
            const h = (c.count / maxCurve) * 90;
            return (
              <g key={c.mv}>
                <rect x={i * 40 + 6} y={100 - h} width="28" height={h} fill="var(--color-ash)"><title>{`Forge: ${c.count} cards at mana value ${c.mv}`}</title></rect>
                <text x={i * 40 + 20} y={96 - h} textAnchor="middle" fontSize="11" fill="var(--color-bone)" className="tabular-nums">{c.count}</text>
                <text x={i * 40 + 20} y="116" textAnchor="middle" fontSize="12" fill="var(--color-ash)">{c.mv}</text>
              </g>
            );
          })}
        </svg>
        <p className="text-ash tabular-nums" title="Forge: average mana value of the nonland cards">Average {d.avgMv.toFixed(2)}, aim {d.avgBand.lo}–{d.avgBand.hi}</p>
      </Section>
      <Section id="chart-types" title="Card types" testId="chart-types">
        <div className="grid gap-1">
          {d.types.map((t) => (
            <div key={t.label} className="grid grid-cols-[11rem_minmax(0,1fr)_3rem] items-center gap-3" title={`Forge: ${t.count} ${t.label.toLowerCase()}`}>
              <span className="text-ash">{t.label}</span>
              <span className="h-2 overflow-hidden rounded-full bg-iron"><span className="block h-full rounded-full bg-ash" style={{ width: `${(t.count / maxType) * 100}%` }} /></span>
              <span className="text-right tabular-nums">{t.count}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section id="chart-roles" title={bracket === null ? "Roles against the deck's bands" : `Roles against Bracket ${bracket}'s bands`} testId="chart-roles">
        <div className="grid gap-1">
          {d.roles.map((r) => <RoleBar key={r.role} label={r.label} count={r.count} lo={r.band.lo} hi={r.band.hi} max={maxRole} />)}
        </div>
      </Section>
      <Section id="chart-sources" title="Colour sources" testId="chart-sources">
        <div className="grid gap-1">
          {d.sources.map((s) => (
            <div key={s.color} className="grid grid-cols-[2rem_minmax(0,1fr)_3rem] items-center gap-3" data-testid="source-row" title={`Forge: ${s.count} sources of ${s.color}`}>
              <ColorPip color={s.color} size="1.2rem" />
              <span className="h-2 overflow-hidden rounded-full bg-iron"><span className="block h-full rounded-full bg-ash" style={{ width: `${(s.count / maxSource) * 100}%` }} /></span>
              <span className="text-right tabular-nums">{s.count}</span>
            </div>
          ))}
        </div>
      </Section>
      <Section id="chart-odds" title="Odds to draw each kind of card" testId="chart-odds">
        <div className="grid gap-4 sm:grid-cols-2">
          {d.odds.map((o) => <OddsBar key={o.label} hits={o.hits} deckSize={librarySize} label={`${o.label} (${o.hits})`} />)}
        </div>
      </Section>
    </div>
  );
}
