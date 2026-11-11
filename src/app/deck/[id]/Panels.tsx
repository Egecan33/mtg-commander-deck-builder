'use client';

import { useRef, useState, type ReactNode } from 'react';
import type { Bracket, Deck, Fix, FoundCombo, SwapProposal } from '@/engine/types';
import { CardImage, ColorPip, Gauge } from '../../components/card';
import type { AnalyzeResponse, CardLookup } from '../../lib/api';
import { AXIS_IDS, BAND_VAR, BRACKETS, ROLE_LABEL, axisLabel, bandOf, bracketName, brokenRules } from '../../lib/ui';

export type PanelId = 'rating' | 'bracket' | 'themes' | 'improve';

function Thumb({ id, lookup, onOpen, width = 54, dim = false, label }: { id: string; lookup: CardLookup; onOpen: (id: string) => void; width?: number; dim?: boolean; label?: string }) {
  const card = lookup[id];
  const name = card?.name ?? 'Unknown card';
  return (
    <button type="button" className="relative shrink-0 cursor-zoom-in" style={{ width }} onClick={() => onOpen(id)} title={label ? `${name} (${label})` : name} data-testid="thumb">
      <span className={`card block ${dim ? 'opacity-45 outline-dashed outline-1 outline-smoke' : ''}`}>
        <CardImage id={id} name={name} known={!!card} />
      </span>
      {label && <span className="absolute inset-x-0 -bottom-1 mx-auto w-fit rounded bg-soot px-1 text-[0.65rem] leading-4 text-band-mid">{label}</span>}
    </button>
  );
}

const Section = ({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) => (
  <section className="border-t border-slag px-4 py-4 first:border-t-0">
    <div className="mb-2.5 flex items-baseline gap-2">
      <h3 className="text-[1.02rem] leading-tight">{title}</h3>
      {aside && <span className="ml-auto text-[0.8rem] text-smoke">{aside}</span>}
    </div>
    {children}
  </section>
);

// ---------------------------------------------------------------------------------------------
// Rating

export function RatingPanel({ analysis, lookup, onFix, onOpen }: { analysis: AnalyzeResponse; lookup: CardLookup; onFix: (fix: Fix) => void; onOpen: (id: string) => void }) {
  const { rating, summary, targets } = analysis;
  const broken = brokenRules(rating, summary.cardCount);
  const curveMax = Math.max(1, ...summary.curve);
  const sources = (['W', 'U', 'B', 'R', 'G', 'C'] as const).filter((c) => (summary.sources[c] ?? 0) > 0);
  const sourceMax = Math.max(1, ...sources.map((c) => summary.sources[c]));
  const roles = Object.entries(targets.roles) as [keyof typeof ROLE_LABEL, { lo: number; hi: number }][];

  return (
    <div data-testid="panel-rating">
      <Section title={rating.complete ? 'Deck rating' : 'Deck rating so far'} aside={`${summary.cardCount} of 100 cards`}>
        <div className="flex items-center gap-4">
          <Gauge value={rating.rating} partial={!rating.complete} legal={broken.length === 0} size={128} />
          <p className="text-[0.86rem] text-ash">
            {broken.length
              ? 'The deck breaks a rule, so the rating is capped at 40 until that is fixed.'
              : rating.complete
                ? 'Eight things a deck needs, weighed together. Click a fix to see cards that solve it.'
                : 'The deck is not full yet, so each part is judged against a deck of this size.'}
          </p>
        </div>
        {rating.violations.length > 0 && (
          <ul className="mt-3 grid gap-1.5" data-testid="violations">
            {rating.violations.map((v, i) => (
              <li key={i} className={`rounded-md border px-2.5 py-1.5 text-[0.86rem] ${broken.includes(v) ? 'border-band-low bg-[#3a1a16]' : 'border-slag bg-soot text-ash'}`}>
                {v.message}
                {v.oracleIds.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {v.oracleIds.slice(0, 6).map((id) => <Thumb key={id} id={id} lookup={lookup} onOpen={onOpen} width={40} />)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="The eight parts">
        <ul className="grid gap-3.5">
          {rating.subscores.map((s) => {
            const pct = Math.round(s.value * 100);
            return (
              <li key={s.key} data-testid="subscore" data-key={s.key}>
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-[0.75rem] text-smoke">{s.weight <= 1 ? Math.round(s.weight * 100) : s.weight}% of the rating</span>
                  <span className="display ml-auto text-[1.05rem] font-bold" style={{ color: BAND_VAR[bandOf(pct)] }}>{pct}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-iron">
                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: BAND_VAR[bandOf(pct)] }} />
                </div>
                {s.fixes.length > 0 && (
                  <ul className="mt-1.5 grid gap-1">
                    {s.fixes.map((f, i) =>
                      f.filter ? (
                        <li key={i}>
                          <button
                            type="button"
                            className="w-full rounded-md border border-slag bg-soot px-2.5 py-1.5 text-left text-[0.84rem] hover:border-brass"
                            onClick={() => onFix(f)}
                            data-testid="fix"
                          >
                            {f.text} <span className="whitespace-nowrap text-brass">Show cards</span>
                          </button>
                        </li>
                      ) : (
                        <li key={i} className="px-2.5 text-[0.84rem] text-ash" data-testid="fix-note">{f.text}</li>
                      ),
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Mana curve" aside={`average ${summary.avgMv.toFixed(2)}, aim ${targets.avgMv.lo.toFixed(1)}–${targets.avgMv.hi.toFixed(1)}`}>
        <div className="flex h-24 items-end gap-1.5" data-testid="curve-chart">
          {summary.curve.map((n, mv) => (
            <div key={mv} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${n} nonland cards at mana value ${mv}${mv === 7 ? ' or more' : ''}`}>
              <span className="text-[0.72rem] text-ash">{n || ''}</span>
              <div className="w-full rounded-t-sm bg-brass" style={{ height: `${(n / curveMax) * 70}%`, minHeight: n ? 2 : 0 }} />
              <span className="text-[0.72rem] text-smoke">{mv === 7 ? '7+' : mv}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Lands and colour sources" aside={`${summary.landCount} lands, aim ${targets.lands}`}>
        <ul className="grid gap-1.5" data-testid="sources-chart">
          {sources.map((c) => (
            <li key={c} className="flex items-center gap-2">
              <ColorPip color={c} size="1.15rem" />
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-iron">
                <div className="h-full rounded-full bg-ash" style={{ width: `${(summary.sources[c] / sourceMax) * 100}%` }} />
              </div>
              <span className="w-9 text-right">{Math.round(summary.sources[c] * 10) / 10}</span>
            </li>
          ))}
          {sources.length === 0 && <li className="text-ash">No mana sources yet.</li>}
        </ul>
      </Section>

      <Section title="Roles against the plan for this bracket">
        <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-[0.86rem]">
          {roles.map(([role, band]) => {
            const have = summary.roleCounts[role] ?? 0;
            const off = have < band.lo || have > band.hi;
            return (
              <li key={role} className="flex items-baseline gap-1.5">
                <span className="min-w-0 flex-1 truncate text-ash">{ROLE_LABEL[role] ?? role}</span>
                <span className={off ? 'text-band-mid' : ''}>{have}</span>
                <span className="w-10 text-right text-[0.75rem] text-smoke">{band.lo}&ndash;{band.hi}</span>
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Bracket

function ComboRow({ found, lookup, onOpen }: { found: FoundCombo; lookup: CardLookup; onOpen: (id: string) => void }) {
  const missing = new Set(found.missing);
  return (
    <li className="rounded-md border border-slag bg-soot p-2.5" data-testid="combo">
      <div className="flex flex-wrap gap-2 pb-1">
        {found.combo.cards.map((c) => (
          <Thumb key={c.oracleId} id={c.oracleId} lookup={lookup} onOpen={onOpen} width={58} dim={missing.has(c.oracleId)} label={missing.has(c.oracleId) ? 'missing' : c.mustBeCommander ? 'commander' : undefined} />
        ))}
      </div>
      <p className="mt-1.5 text-[0.84rem]">{found.combo.produces.slice(0, 3).join(', ') || 'Combo'}</p>
      <p className="text-[0.76rem] text-smoke">
        {[found.twoCard ? 'two cards' : `${found.combo.cards.length} cards`, found.early ? 'can come down early' : null, `needs ${found.combo.manaValueNeeded} mana`, found.relevant ? null : 'does not win on its own']
          .filter(Boolean)
          .join(', ')}
      </p>
    </li>
  );
}

function ComboList({ title, items, lookup, onOpen, none }: { title: string; items: FoundCombo[]; lookup: CardLookup; onOpen: (id: string) => void; none: string }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, 5);
  return (
    <Section title={title} aside={items.length ? String(items.length) : undefined}>
      {items.length === 0 ? <p className="text-ash">{none}</p> : (
        <>
          <ul className="grid gap-2">{shown.map((f) => <ComboRow key={f.combo.id} found={f} lookup={lookup} onOpen={onOpen} />)}</ul>
          {items.length > 5 && (
            <button type="button" className="btn btn-sm btn-quiet mt-2" onClick={() => setAll(!all)}>{all ? 'Show fewer' : `Show all ${items.length}`}</button>
          )}
        </>
      )}
    </Section>
  );
}

export function BracketPanel({ analysis, deck, lookup, onOpen }: { analysis: AnalyzeResponse; deck: Deck; lookup: CardLookup; onOpen: (id: string) => void }) {
  const b = analysis.bracket;
  const [allViolations, setAllViolations] = useState(false);
  const violations = allViolations ? b.violationsOfTarget : b.violationsOfTarget.slice(0, 6);
  return (
    <div data-testid="panel-bracket">
      <Section title={`Aiming for Bracket ${deck.targetBracket}, ${bracketName(deck.targetBracket)}`}>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-md border border-slag bg-soot px-3 py-2" data-testid="floor">
            <div className="display text-[1.7rem] font-bold leading-none">{b.floor}</div>
            <div className="mt-1 text-[0.8rem] text-ash">Minimum bracket the rules force</div>
          </div>
          <div className="rounded-md border border-slag bg-soot px-3 py-2" data-testid="plays-like">
            <div className="display text-[1.7rem] font-bold leading-none">{b.playsLike}</div>
            <div className="mt-1 text-[0.8rem] text-ash">What it plays like</div>
          </div>
        </div>
        {b.warnings.length > 0 && (
          <ul className="mt-3 grid gap-1 text-[0.86rem] text-band-good">
            {b.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}
      </Section>

      <Section title="Breaks the target bracket" aside={b.violationsOfTarget.length ? String(b.violationsOfTarget.length) : undefined}>
        {b.violationsOfTarget.length === 0 ? (
          <p className="text-ash">Nothing in the deck is over the line for Bracket {deck.targetBracket}.</p>
        ) : (
          <ul className="grid gap-2" data-testid="target-violations">
            {violations.map((v, i) => (
              <li key={i} className="rounded-md border border-band-low bg-[#3a1a16] p-2.5 text-[0.86rem]">
                {v.message}
                {v.oracleIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">{v.oracleIds.slice(0, 8).map((id) => <Thumb key={id} id={id} lookup={lookup} onOpen={onOpen} width={52} />)}</div>
                )}
              </li>
            ))}
            {b.violationsOfTarget.length > 6 && (
              <li>
                <button type="button" className="btn btn-sm btn-quiet" onClick={() => setAllViolations(!allViolations)}>
                  {allViolations ? 'Show fewer' : `Show all ${b.violationsOfTarget.length}`}
                </button>
              </li>
            )}
          </ul>
        )}
      </Section>

      <Section title="Why the minimum is what it is">
        {b.reasons.length === 0 ? (
          <p className="text-ash">No card or combo in the deck forces it above Bracket 1.</p>
        ) : (
          <ul className="grid gap-2" data-testid="floor-reasons">
            {b.reasons.map((r, i) => (
              <li key={i} className="rounded-md border border-slag bg-soot p-2.5 text-[0.86rem]">
                <span className="mr-2 rounded bg-slag px-1.5 py-0.5 text-[0.75rem]">at least {r.floor}</span>
                {r.text}
                {r.oracleIds.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">{r.oracleIds.slice(0, 10).map((id) => <Thumb key={id} id={id} lookup={lookup} onOpen={onOpen} width={52} />)}</div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <ComboList title="Combos in the deck" items={b.combos.included} lookup={lookup} onOpen={onOpen} none="No complete combo in the list." />
      <ComboList title="One card away" items={b.combos.oneAway} lookup={lookup} onOpen={onOpen} none="No combo is a single card short." />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Themes

export function ThemesPanel({
  analysis, deck, onChange, onReset, onShow,
}: {
  analysis: AnalyzeResponse;
  deck: Deck;
  onChange: (axis: string, weight: number) => void;
  onReset: () => void;
  onShow: (axis: string) => void;
}) {
  const live = deck.themeWeights;
  // The sliders show the live deck (the analysis lags a moment behind), in an order that does not
  // jump while one is being dragged: by weight when first seen, new themes at the end.
  const weightOf = (axis: string) => live?.[axis] ?? analysis.themeWeights[axis] ?? 0;
  const order = useRef<string[]>([]);
  const present = [...new Set([...Object.keys(analysis.themeWeights).filter((a) => (analysis.themeWeights[a] ?? 0) > 0), ...Object.keys(live ?? {})])];
  const fresh = present.filter((a) => !order.current.includes(a)).sort((a, b) => weightOf(b) - weightOf(a) || a.localeCompare(b));
  if (fresh.length) order.current = [...order.current, ...fresh];
  const ids = order.current.filter((a) => present.includes(a));
  const rest = AXIS_IDS.filter((a) => !ids.includes(a));

  return (
    <div data-testid="panel-themes">
      <Section title="What this deck is about" aside={deck.themeWeights ? 'set by you' : 'read from the commander'}>
        <p className="mb-3 text-[0.86rem] text-ash">
          Every card is scored on how well it serves these themes. Move a slider and the whole pool is scored again.
        </p>
        {ids.length === 0 && <p className="text-ash">No theme yet. Add one below, or pick a commander.</p>}
        <ul className="grid gap-3">
          {ids.map((axis) => {
            const w = weightOf(axis);
            const t = analysis.summary.axisTotals[axis];
            const n = t ? Math.round(t.e + t.p) : 0;
            return (
              <li key={axis} data-testid="theme-slider" data-axis={axis}>
                <div className="flex items-baseline gap-2">
                  <label htmlFor={`axis-${axis}`} className="min-w-0 flex-1 truncate font-medium">{axisLabel(axis)}</label>
                  <button type="button" className="text-[0.78rem] text-smoke hover:text-brass" onClick={() => onShow(axis)} title="Show these cards in the browser">
                    {n} in deck
                  </button>
                  <span className="w-8 text-right">{Math.round(w * 100)}</span>
                </div>
                <input
                  id={`axis-${axis}`}
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={w}
                  onChange={(e) => onChange(axis, Number(e.target.value))}
                  className="mt-1 block w-full"
                />
              </li>
            );
          })}
        </ul>
        <div className="mt-4 flex gap-2">
          <select
            className="field w-0 min-w-0 flex-1"
            value=""
            onChange={(e) => {
              if (!e.target.value) return;
              onChange(e.target.value, 0.5);
            }}
            aria-label="Add a theme"
            data-testid="theme-add"
          >
            <option value="">Add a theme</option>
            {rest.map((a) => <option key={a} value={a}>{axisLabel(a)}</option>)}
          </select>
          <button type="button" className="btn" disabled={!deck.themeWeights} onClick={() => { order.current = []; onReset(); }} data-testid="theme-reset">
            Reset to the commander
          </button>
        </div>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Improve

export interface ImproveOptions { bracket: Bracket | 'keep'; ownedOnly: boolean; maxPrice: string }
export interface ProposalSet { kind: 'improve' | 'swaps'; bracket: Bracket; items: SwapProposal[]; asked: boolean }

const delta = (p: SwapProposal) => Math.round((p.ratingAfter - p.ratingBefore) * 10) / 10;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(1)}`;

export function ImprovePanel({
  deck, lookup, options, setOptions, proposals, busy, onRun, onAccept, onReject, onApplyAll, onOpen,
}: {
  deck: Deck;
  lookup: CardLookup;
  options: ImproveOptions;
  setOptions: (o: ImproveOptions) => void;
  proposals: ProposalSet | null;
  busy: string | null;
  onRun: (kind: 'improve' | 'swaps') => void;
  onAccept: (p: SwapProposal) => void;
  onReject: (p: SwapProposal) => void;
  onApplyAll: () => void;
  onOpen: (id: string) => void;
}) {
  const items = proposals?.items ?? [];
  const locked = deck.main.filter((e) => e.locked).length;
  const first = items[0];
  const last = items[items.length - 1];
  const otherBracket = proposals && proposals.bracket !== deck.targetBracket;

  return (
    <div data-testid="panel-improve">
      <Section title="Make this deck better">
        <p className="text-[0.86rem] text-ash">
          The weakest card goes out and the best replacement comes in, one swap at a time, as long as the rating goes up. Locked cards are never cut
          {locked ? ` (${locked} locked now)` : ''}.
        </p>
        <div className="mt-3 grid gap-2">
          <label className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-ash">Aim for</span>
            <select
              className="field w-0 min-w-0 flex-1"
              value={options.bracket}
              onChange={(e) => setOptions({ ...options, bracket: e.target.value === 'keep' ? 'keep' : (Number(e.target.value) as Bracket) })}
              data-testid="improve-bracket"
            >
              <option value="keep">Same bracket ({deck.targetBracket}, {bracketName(deck.targetBracket)})</option>
              {BRACKETS.filter((b) => b.n !== deck.targetBracket).map((b) => <option key={b.n} value={b.n}>Bracket {b.n}, {b.name}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-24 shrink-0 text-ash">Price cap</span>
            <input
              className="field w-24"
              inputMode="decimal"
              value={options.maxPrice}
              onChange={(e) => setOptions({ ...options, maxPrice: e.target.value })}
              placeholder="no cap"
              aria-label="Highest price per card in dollars"
              data-testid="improve-price"
            />
            <span className="text-ash">dollars per card</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={options.ownedOnly} onChange={(e) => setOptions({ ...options, ownedOnly: e.target.checked })} data-testid="improve-owned" />
            <span>Only cards in my collection</span>
          </label>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-primary" disabled={!!busy || deck.commanders.length === 0} onClick={() => onRun('improve')} data-testid="improve-run">
            {busy === 'improve' ? 'Working it out' : 'Find improvements'}
          </button>
          <button type="button" className="btn" disabled={!!busy || deck.commanders.length === 0} onClick={() => onRun('swaps')} title="A few stand-alone swaps for the weakest cards" data-testid="swaps-run">
            {busy === 'swaps' ? 'Looking' : 'Suggest swaps'}
          </button>
        </div>
      </Section>

      {proposals && (
        <Section
          title={proposals.kind === 'improve' ? 'Swaps, in order' : 'Suggested swaps'}
          aside={items.length ? `${items.length} left` : undefined}
        >
          {items.length === 0 ? (
            <p className="text-ash" data-testid="no-proposals">
              {proposals.asked ? 'Nothing left to review.' : 'No swap raises the rating with these options. The deck is already tight for them.'}
            </p>
          ) : (
            <>
              <div className="mb-3 flex items-center gap-2">
                <p className="min-w-0 flex-1 text-[0.86rem]">
                  {proposals.kind === 'improve' && first && last ? (
                    <>Taking all of them moves the rating from <b>{first.ratingBefore.toFixed(1)}</b> to <b className="text-band-top">{last.ratingAfter.toFixed(1)}</b>.</>
                  ) : (
                    'Each swap stands on its own.'
                  )}
                  {otherBracket && <span className="block text-band-good">Accepting also sets the deck to Bracket {proposals.bracket}.</span>}
                </p>
                <button type="button" className="btn btn-sm btn-primary" onClick={onApplyAll} data-testid="apply-all">Apply all</button>
              </div>
              <ol className="grid gap-2.5">
                {items.map((p) => {
                  const d = delta(p);
                  return (
                    <li key={`${p.out}>${p.in}`} className="rounded-md border border-slag bg-soot p-2.5" data-testid="proposal" data-out={lookup[p.out]?.name} data-in={lookup[p.in]?.name}>
                      <div className="flex items-center gap-2">
                        <Thumb id={p.out} lookup={lookup} onOpen={onOpen} width={78} />
                        <div className="flex flex-col items-center px-0.5">
                          <svg viewBox="0 0 28 12" width="28" height="12" aria-label="replaced by" className="text-brass">
                            <path d="M1 6h24M20 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                          <span className="display mt-1 text-[1.05rem] font-bold" style={{ color: d > 0 ? BAND_VAR.top : d < 0 ? BAND_VAR.low : BAND_VAR.gated }} data-testid="proposal-delta">
                            {signed(d)}
                          </span>
                        </div>
                        <Thumb id={p.in} lookup={lookup} onOpen={onOpen} width={78} />
                        <div className="ml-1 flex min-w-0 flex-1 flex-col gap-1.5">
                          <button type="button" className="btn btn-sm btn-primary" onClick={() => onAccept(p)} data-testid="proposal-accept">Accept</button>
                          <button type="button" className="btn btn-sm" onClick={() => onReject(p)} data-testid="proposal-reject">Reject</button>
                        </div>
                      </div>
                      <p className="mt-2 text-[0.84rem]">
                        <span className="text-ash">{lookup[p.out]?.name ?? 'Unknown'}</span> out, <span className="font-medium">{lookup[p.in]?.name ?? 'Unknown'}</span> in.
                      </p>
                      <p className="text-[0.84rem] text-ash" data-testid="proposal-reason">{p.reason}</p>
                      <p className="text-[0.76rem] text-smoke">Rating {p.ratingBefore.toFixed(1)} to {p.ratingAfter.toFixed(1)}</p>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </Section>
      )}
    </div>
  );
}
