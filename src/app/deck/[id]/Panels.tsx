'use client';

import { useRef, useState, type ReactNode } from 'react';
import type { Bracket, Deck, Fix, FoundCombo, Role, SwapProposal } from '@/engine/types';
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

/** "Add one" buttons: the kinds of card a click asks the engine to suggest one more of. */
export const ADD_ONE: { role: Role; label: string; noun: string }[] = [
  { role: 'win-condition', label: 'Add a win condition', noun: 'a win condition' },
  { role: 'land', label: 'Add a land', noun: 'a land' },
  { role: 'spot-removal', label: 'Add removal', noun: 'a removal spell' },
  { role: 'draw', label: 'Add card draw', noun: 'card draw' },
  { role: 'ramp', label: 'Add ramp', noun: 'ramp' },
];
/** Which add-one buttons sit under which part of the rating. */
const ADD_ONE_FOR: Record<string, Role[]> = { mana: ['land'], roles: ['ramp', 'draw'], interaction: ['spot-removal'], wincons: ['win-condition'] };

/** Counts the user can set for this deck. `Removal` is targeted removal; counterspells keep their own band. */
const WANTED: { role: Role; label: string }[] = [
  { role: 'win-condition', label: 'Win conditions' },
  { role: 'land', label: 'Lands' },
  { role: 'ramp', label: 'Ramp' },
  { role: 'draw', label: 'Card draw' },
  { role: 'spot-removal', label: 'Removal' },
  { role: 'wipe', label: 'Board wipes' },
];

export function RatingPanel({
  analysis, deck, lookup, busy, onFix, onOpen, onAddOne, onWanted,
}: {
  analysis: AnalyzeResponse;
  deck: Deck;
  lookup: CardLookup;
  busy: string | null;
  onFix: (fix: Fix) => void;
  onOpen: (id: string) => void;
  onAddOne: (role: Role) => void;
  /** Sets the wanted count of a role on the deck; null puts it back to the bracket's default. */
  onWanted: (role: Role, n: number | null) => void;
}) {
  const { rating, summary, targets } = analysis;
  const defaults = analysis.defaultTargets ?? targets;
  const defaultOf = (role: Role): number => (role === 'land' ? defaults.lands : (defaults.roles[role]?.lo ?? 0));
  const anyWanted = Object.keys(deck.roleTargets ?? {}).length > 0;
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
                {ADD_ONE_FOR[s.key] && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {ADD_ONE.filter((a) => ADD_ONE_FOR[s.key].includes(a.role)).map((a) => (
                      <button key={a.role} type="button" className="btn btn-sm btn-quiet" disabled={!!busy || deck.commanders.length === 0} onClick={() => onAddOne(a.role)} title={`Suggest a few ways to bring in ${a.noun}, each with the card to cut for it`} data-testid={`rating-add-${a.role}`}>
                        + {a.label}
                      </button>
                    ))}
                  </div>
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

      <Section title="Wanted counts" aside={anyWanted ? 'set by you' : `defaults for Bracket ${deck.targetBracket}`}>
        <p className="mb-2.5 text-[0.84rem] text-ash">How many of each this deck should run. The rating, the card scores and the builder all aim for your number.</p>
        <ul className="grid gap-1.5" data-testid="wanted-counts">
          {WANTED.map(({ role, label }) => {
            const base = defaultOf(role);
            const set = deck.roleTargets?.[role];
            const value = set ?? base;
            return (
              <li key={role} className="flex items-center gap-1.5 text-[0.86rem]" data-testid="wanted-row" data-role={role}>
                <span className="min-w-0 flex-1 truncate">{label}</span>
                <button type="button" className="btn btn-sm px-2" disabled={value <= 0} onClick={() => onWanted(role, Math.max(0, value - 1))} aria-label={`Want one fewer: ${label}`} data-testid="wanted-less">−</button>
                <span className={`w-6 text-center ${set !== undefined ? 'font-semibold text-brass' : ''}`} data-testid="wanted-value">{value}</span>
                <button type="button" className="btn btn-sm px-2" disabled={value >= 40} onClick={() => onWanted(role, value + 1)} aria-label={`Want one more: ${label}`} data-testid="wanted-more">+</button>
                <span className="w-[4.6rem] text-right text-[0.75rem] text-smoke">default {base}</span>
                <button type="button" className={`text-[0.75rem] text-brass hover:underline ${set === undefined ? 'invisible' : ''}`} onClick={() => onWanted(role, null)} data-testid="wanted-reset">Reset</button>
              </li>
            );
          })}
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

/** Goal chips of a directed improve run, and the roles each one asks for more of. */
export type GoalChip = 'wincons' | 'removal' | 'draw' | 'ramp';
export const GOAL_CHIPS: { id: GoalChip; label: string; roles: Role[] }[] = [
  { id: 'wincons', label: 'More win conditions', roles: ['win-condition'] },
  { id: 'removal', label: 'More removal', roles: ['spot-removal', 'wipe', 'counterspell'] },
  { id: 'draw', label: 'More card draw', roles: ['draw'] },
  { id: 'ramp', label: 'More ramp', roles: ['ramp'] },
];

export interface ImproveOptions {
  bracket: Bracket | 'keep'; ownedOnly: boolean; maxPrice: string;
  /** "Change at most N cards", as typed. */
  maxSwaps: string;
  goals: GoalChip[];
  /** "Lean into theme" is on, and the axis it leans into ('' = the deck's strongest). */
  lean: boolean;
  leanAxis: string;
}
export interface ProposalSet {
  kind: 'improve' | 'swaps' | 'add';
  bracket: Bracket; items: SwapProposal[]; asked: boolean;
  /** kind 'add': what was asked for, e.g. "a win condition". */
  noun?: string;
}

const delta = (p: SwapProposal) => Math.round((p.ratingAfter - p.ratingBefore) * 10) / 10;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(1)}`;
const chipClass = (on: boolean) => `chip cursor-pointer ${on ? 'border-brass bg-iron text-bone' : 'hover:text-bone'}`;

export function ImprovePanel({
  deck, lookup, themeAxes, options, setOptions, proposals, busy, onRun, onAddOne, onAccept, onReject, onApplyAll, onProxy, onOpen,
}: {
  deck: Deck;
  lookup: CardLookup;
  /** The deck's current theme axes, strongest first. */
  themeAxes: string[];
  options: ImproveOptions;
  setOptions: (o: ImproveOptions) => void;
  proposals: ProposalSet | null;
  busy: string | null;
  onRun: (kind: 'improve' | 'swaps') => void;
  onAddOne: (role: Role) => void;
  onAccept: (p: SwapProposal) => void;
  onReject: (p: SwapProposal) => void;
  onApplyAll: () => void;
  /** Puts incoming cards on the proxy list. */
  onProxy: (ids: string[]) => void;
  onOpen: (id: string) => void;
}) {
  const items = proposals?.items ?? [];
  const locked = deck.main.filter((e) => e.locked).length;
  const first = items[0];
  const last = items[items.length - 1];
  const otherBracket = proposals && proposals.bracket !== deck.targetBracket;
  const dissent = items.filter((p) => p.agrees === false).length;
  const toggleGoal = (id: GoalChip) => setOptions({ ...options, goals: options.goals.includes(id) ? options.goals.filter((g) => g !== id) : [...options.goals, id] });
  const leanAxis = themeAxes.includes(options.leanAxis) ? options.leanAxis : (themeAxes[0] ?? '');

  return (
    <div data-testid="panel-improve">
      <Section title="Make this deck better">
        <p className="text-[0.86rem] text-ash">
          Say how far to go and what you want more of. Swaps come one at a time, weakest card out, and each says why. Locked cards are never cut
          {locked ? ` (${locked} locked now)` : ''}.
        </p>
        <div className="mt-3 grid gap-2">
          <label className="flex items-center gap-2">
            <span className="shrink-0">Change at most</span>
            <input
              className="field w-14 text-center"
              type="number"
              min={1}
              max={40}
              value={options.maxSwaps}
              onChange={(e) => setOptions({ ...options, maxSwaps: e.target.value })}
              aria-label="Most cards to change, 1 to 40"
              data-testid="improve-max"
            />
            <span>cards</span>
          </label>
          <label className="flex items-center gap-2">
            <span className="shrink-0">Aim for bracket</span>
            <select
              className="field w-0 min-w-0 flex-1"
              value={options.bracket}
              onChange={(e) => setOptions({ ...options, bracket: e.target.value === 'keep' ? 'keep' : (Number(e.target.value) as Bracket) })}
              data-testid="improve-bracket"
            >
              <option value="keep">{deck.targetBracket}, {bracketName(deck.targetBracket)} (the deck&rsquo;s)</option>
              {BRACKETS.filter((b) => b.n !== deck.targetBracket).map((b) => <option key={b.n} value={b.n}>{b.n}, {b.name}</option>)}
            </select>
          </label>
          <div>
            <div className="mb-1 text-[0.8rem] text-ash">Goals (pick any)</div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Goals for this run">
              {GOAL_CHIPS.map((g) => (
                <button key={g.id} type="button" className={chipClass(options.goals.includes(g.id))} aria-pressed={options.goals.includes(g.id)} onClick={() => toggleGoal(g.id)} data-testid={`goal-${g.id}`}>
                  {g.label}
                </button>
              ))}
              <button type="button" className={chipClass(options.lean)} aria-pressed={options.lean} disabled={themeAxes.length === 0} title={themeAxes.length === 0 ? 'The deck has no theme yet' : 'Cut off-theme cards first and bring in cards for this theme'} onClick={() => setOptions({ ...options, lean: !options.lean })} data-testid="goal-theme">
                Lean into theme
              </button>
            </div>
            {options.lean && themeAxes.length > 0 && (
              <select className="field mt-1.5 w-full" value={leanAxis} onChange={(e) => setOptions({ ...options, leanAxis: e.target.value })} aria-label="Theme to lean into" data-testid="goal-theme-axis">
                {themeAxes.map((a) => <option key={a} value={a}>{axisLabel(a)}</option>)}
              </select>
            )}
          </div>
          <label className="flex items-center gap-2">
            <span className="shrink-0 text-ash">Price cap</span>
            <input
              className="field w-20"
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

      <Section title="Add one card">
        <p className="text-[0.86rem] text-ash">A short list of the best cards of one kind to bring in, each with the card to cut for it.</p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {ADD_ONE.map((a) => (
            <button key={a.role} type="button" className="btn btn-sm" disabled={!!busy || deck.commanders.length === 0} onClick={() => onAddOne(a.role)} data-testid={`add-one-${a.role}`}>
              {busy === `add:${a.role}` ? 'Looking' : `+ ${a.label}`}
            </button>
          ))}
        </div>
      </Section>

      {proposals && (
        <Section
          title={proposals.kind === 'improve' ? 'Swaps, in order' : proposals.kind === 'add' ? `Ways to add ${proposals.noun ?? 'a card'}` : 'Suggested swaps'}
          aside={items.length ? `${items.length} left` : undefined}
        >
          {items.length === 0 ? (
            <p className="text-ash" data-testid="no-proposals">
              {proposals.asked
                ? 'Nothing left to review.'
                : proposals.kind === 'add'
                  ? 'No card of that kind fits this deck with these options, or every card that could be cut is locked.'
                  : 'No swap raises the rating with these options. The deck is already tight for them.'}
            </p>
          ) : (
            <>
              {otherBracket && (
                <p className="mb-2.5 rounded-md border border-band-good px-2.5 py-1.5 text-[0.86rem] text-band-good" data-testid="bracket-notice">
                  These swaps aim for Bracket {proposals.bracket} ({bracketName(proposals.bracket)}), not the deck&rsquo;s Bracket {deck.targetBracket}. Applying any of them sets the deck to Bracket {proposals.bracket}.
                </p>
              )}
              <div className="mb-2 flex items-center gap-2">
                <p className="min-w-0 flex-1 text-[0.86rem]">
                  {proposals.kind === 'improve' && first && last ? (
                    <>Taking all of them moves the rating from <b>{first.ratingBefore.toFixed(1)}</b> to <b className="text-band-top">{last.ratingAfter.toFixed(1)}</b>.</>
                  ) : proposals.kind === 'add' ? (
                    'Pick one. Each is the same change with a different card.'
                  ) : (
                    'Each swap stands on its own.'
                  )}
                  {dissent > 0 && <span className="block text-band-mid">The engine disagrees with {dissent === items.length ? (dissent === 1 ? 'it' : 'all of them') : `${dissent} of them`}; its reasons are on the {dissent === 1 ? 'card' : 'cards'}.</span>}
                </p>
                {proposals.kind !== 'add' && <button type="button" className="btn btn-sm btn-primary" onClick={onApplyAll} data-testid="apply-all">Apply all</button>}
              </div>
              <button type="button" className="btn btn-sm mb-3 w-full" onClick={() => onProxy([...new Set(items.map((p) => p.in))])} data-testid="proxy-incoming">
                Add incoming cards to proxy list ({new Set(items.map((p) => p.in)).size})
              </button>
              <ol className="grid gap-2.5">
                {items.map((p) => {
                  const d = delta(p);
                  return (
                    <li key={`${p.out}>${p.in}`} className={`rounded-md border bg-soot p-2.5 ${p.agrees === false ? 'border-dashed border-band-mid/70' : 'border-slag'}`} data-testid="proposal" data-out={lookup[p.out]?.name ?? ''} data-in={lookup[p.in]?.name} data-agrees={p.agrees === false ? 'no' : 'yes'}>
                      <div className="flex items-center gap-2">
                        {p.out ? (
                          <Thumb id={p.out} lookup={lookup} onOpen={onOpen} width={78} />
                        ) : (
                          <div className="flex shrink-0 items-center justify-center rounded-md border border-dashed border-smoke text-center text-[0.72rem] text-ash" style={{ width: 78, aspectRatio: '63 / 88' }}>open slot</div>
                        )}
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
                          {proposals.kind !== 'add' && <button type="button" className="btn btn-sm" onClick={() => onReject(p)} data-testid="proposal-reject">Reject</button>}
                          <button type="button" className="btn btn-sm btn-quiet" onClick={() => onProxy([p.in])} title={`Put ${lookup[p.in]?.name ?? 'the incoming card'} on the proxy list`} data-testid="proposal-proxy">Proxy</button>
                        </div>
                      </div>
                      <p className="mt-2 text-[0.84rem]">
                        {p.out ? <><span className="text-ash">{lookup[p.out]?.name ?? 'Unknown'}</span> out, </> : null}<span className="font-medium">{lookup[p.in]?.name ?? 'Unknown'}</span> in.
                      </p>
                      <p className="text-[0.84rem] text-ash" data-testid="proposal-reason">{p.reason}</p>
                      {p.agrees === false && p.objection && (
                        <p className="mt-1.5 border-l-2 border-band-mid pl-2 text-[0.82rem] text-band-mid" data-testid="proposal-objection">
                          <span className="font-semibold">The engine disagrees.</span> {p.objection}
                        </p>
                      )}
                      <p className="mt-1 text-[0.76rem] text-smoke">Rating {p.ratingBefore.toFixed(1)} to {p.ratingAfter.toFixed(1)}</p>
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
