'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { Bracket, CardScore, Deck, Fix, FoundCombo, Role, SwapProposal } from '@/engine/types';
import { CardTile, unknownCard } from '../../components/CardTile';
import { EmptyState } from '../../components/EmptyState';
import { CardImage, ColorPip, Gauge } from '../../components/card';
import { HeldMark, heldText } from '../../components/held';
import type { AnalyzeResponse, CardLookup, ClientCard, ConflictReport, HeldBy, RatingKey } from '../../lib/api';
import { AXIS_IDS, BAND_VAR, BRACKETS, ROLE_LABEL, axisLabel, bandOf, bracketName, brokenRules, fmtPrice } from '../../lib/ui';

export type PanelId = 'rating' | 'bracket' | 'themes' | 'improve';

function Thumb({ id, lookup, onOpen, width = 54, dim = false, label, held }: { id: string; lookup: CardLookup; onOpen: (id: string) => void; width?: number; dim?: boolean; label?: string; held?: string[] }) {
  const card = lookup[id];
  const name = card?.name ?? 'Unknown card';
  return (
    <button type="button" className="relative shrink-0 cursor-zoom-in" style={{ width }} onClick={() => onOpen(id)} title={label ? `${name} (${label})` : held?.length ? `${name}: ${heldText(held)}` : name} data-testid="thumb">
      <span className={`card block ${dim ? 'opacity-45 outline-dashed outline-1 outline-smoke' : ''}`}>
        <CardImage id={id} name={name} known={!!card} />
      </span>
      <HeldMark names={held} small className="absolute right-[6%] top-[4%]" />
      {label && <span className="absolute inset-x-0 -bottom-1 mx-auto w-fit rounded bg-soot px-1 text-[0.65rem] leading-4 text-band-mid">{label}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------------------------
// Above the deck: what it takes from boxes and built decks

/**
 * One line per box or built deck the deck takes cards from ("Takes 3 cards from the Landing Party box"), each opening to the card names.
 * When this deck is built too, it does not take from another built deck, they share copies: "Shares 1 card with B (built)".
 * A box's cards each get "I took it out" (`onTakeOut`). Nothing when there are none.
 */
export function HeldSummary({
  conflicts, lookup, onOpen, onTakeOut, takingOut = null, built = false,
}: {
  conflicts: ConflictReport;
  lookup: CardLookup;
  onOpen: (id: string) => void;
  onTakeOut?: (holderId: string, oracleId: string) => void;
  /** `<holderId>|<oracleId>` of a take-out in progress; every take-out button waits for it. */
  takingOut?: string | null;
  /** The deck shown is built itself. */
  built?: boolean;
}) {
  const [open, setOpen] = useState<string[]>([]);
  if (conflicts.byHolder.length === 0) return null;
  return (
    <ul className="grid gap-1 rounded-md border border-ember/50 bg-[#2b1810] px-2.5 py-1.5 text-[0.85rem]" data-testid="held-summary">
      {conflicts.byHolder.map((h) => {
        const n = h.oracleIds.length;
        const isOpen = open.includes(h.holderId);
        return (
          <li key={h.holderId} data-testid="held-holder" data-kind={h.kind}>
            <button
              type="button"
              className="flex w-full items-center gap-2 text-left hover:text-bone"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? open.filter((x) => x !== h.holderId) : [...open, h.holderId])}
              title={h.kind === 'box' ? 'Copies still sealed in this box' : 'Copies in this assembled deck'}
            >
              <span aria-hidden className="display inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-ember text-[0.72rem] font-bold leading-none text-[#15110a]">!</span>
              <span className="min-w-0 flex-1" data-testid="held-holder-line">
                {built && h.kind === 'deck'
                  ? `Shares ${n} ${n === 1 ? 'card' : 'cards'} with ${h.name}: you do not own enough copies for both`
                  : `Takes ${n} ${n === 1 ? 'card' : 'cards'} from ${h.kind === 'box' ? 'the ' : ''}${h.name}`}
              </span>
              <span className="shrink-0 text-[0.75rem] text-smoke">{isOpen ? 'Hide' : 'Which cards'}</span>
            </button>
            {isOpen && (
              <ul className={`mb-0.5 ml-6 mt-0.5 ${h.kind === 'box' && onTakeOut ? 'grid gap-0.5' : 'flex flex-wrap gap-x-3 gap-y-0.5'}`} data-testid="held-holder-cards">
                {h.oracleIds.map((id) => {
                  const name = lookup[id]?.name ?? 'Unknown card';
                  return (
                    <li key={id} className="flex items-baseline gap-2">
                      <button type="button" className="min-w-0 truncate text-left text-ash hover:text-brass" onClick={() => onOpen(id)}>{name}</button>
                      {h.kind === 'box' && onTakeOut && (
                        <button
                          type="button"
                          className="shrink-0 text-[0.75rem] text-brass hover:underline disabled:text-smoke disabled:no-underline"
                          disabled={!!takingOut}
                          onClick={() => onTakeOut(h.holderId, id)}
                          title={`You took ${name} out of the ${h.name}: it stays in your collection as a free copy. Your total does not change.`}
                          data-testid="held-take-out"
                        >
                          {takingOut === `${h.holderId}|${id}` ? 'Taking it out' : 'I took it out'}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** "This deck is my Landing Party box": links the sealed box to this deck, so the deck stops counting that box against itself. */
export function BoxMatchOffer({ name, busy, onLink }: { name: string; busy: boolean; onLink: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-brass-deep bg-[#2a2212] px-2.5 py-1.5 text-[0.85rem]" data-testid="box-match-offer">
      <span className="min-w-0 flex-1 text-ash">This deck matches your sealed {name} box.</span>
      <button
        type="button"
        className="btn btn-sm btn-primary shrink-0"
        disabled={busy}
        onClick={onLink}
        title="Link the box to this deck: its sealed cards stop counting as taken here. The deck itself does not change."
        data-testid="box-match"
      >
        This deck is my {name} box
      </button>
    </div>
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
  analysis, deck, lookup, busy, onFix, onFixPart, onOpen, onAddOne, onWanted,
}: {
  analysis: AnalyzeResponse;
  deck: Deck;
  lookup: CardLookup;
  busy: string | null;
  onFix: (fix: Fix) => void;
  /** Fix deck for one part of the rating (shown beside a part that has fixes Fix deck can act on). */
  onFixPart: (key: RatingKey) => void;
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
                ? 'Nine things a deck needs, weighed together. Click a fix to see cards that solve it.'
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

      <Section title="The nine parts">
        <ul className="grid gap-3.5">
          {rating.subscores.map((s) => {
            const pct = Math.round(s.value * 100);
            const fixable = s.fixes.some((f) => f.actionable);
            const fixing = busy === `fix:${s.key}`;
            return (
              <li key={s.key} data-testid="subscore" data-key={s.key}>
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{s.label}</span>
                  <span className="text-[0.75rem] text-smoke">{s.weight <= 1 ? Math.round(s.weight * 100) : s.weight}% of the rating</span>
                  <span className="ml-auto flex items-baseline gap-2">
                    {fixable && (
                      <button
                        type="button"
                        className="btn btn-sm"
                        disabled={!!busy || deck.commanders.length === 0}
                        onClick={() => onFixPart(s.key as RatingKey)}
                        title={
                          deck.commanders.length === 0
                            ? 'Choose a commander first'
                            : `Fix ${s.label.toLowerCase()} alone: swaps that bring in what this part asks for, with the card options beside Fix deck. Undo puts the deck back.`
                        }
                        data-testid="fix-part"
                        data-part={s.key}
                      >
                        {fixing ? 'Fixing' : 'Fix'}
                      </button>
                    )}
                    <span className="display text-[1.05rem] font-bold" style={{ color: BAND_VAR[bandOf(pct)] }}>{pct}</span>
                  </span>
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
// Card detail: put a card in instead of a deck card

/** Why a card gets no "Put it in instead of" list: a short lead ("You do not own it.") and what would change it. */
export interface NotInReason { lead: string; hint?: string }

/**
 * Why the swap suggestions rule a card out, from what the page already knows: the card's gate for this
 * deck, the card options (only my collection, free copies only, price limit) and the boxes and built
 * decks holding its copies. null when none of them does. Basic lands pass every card option.
 */
export function whyNotIn(
  card: ClientCard,
  o: { gate: string | null; basic: boolean; ownedOnly: boolean; freeOnly: boolean; maxPriceUsd: number | null; held?: readonly string[] },
): NotInReason | null {
  if (o.gate) return { lead: 'Not legal in this deck.', hint: o.gate };
  if (o.basic) return null;
  if (o.ownedOnly && !card.owned) return { lead: 'You do not own it.', hint: 'Untick “Only my collection” to see the cards it could replace.' };
  if (o.ownedOnly && o.freeOnly && o.held && o.held.length > 0) {
    return { lead: `Held by ${o.held.join(', ')}.`, hint: 'No free copy is left for this deck. Untick “Use free copies only” to see the cards it could replace.' };
  }
  if (o.maxPriceUsd !== null && !(card.priceUsd !== null && card.priceUsd <= o.maxPriceUsd)) {
    return {
      lead: 'Over your price limit.',
      hint: `${card.priceUsd === null ? 'It has no price on record' : `It costs ${fmtPrice(card.priceUsd)}`}; the limit set under Improve is ${fmtPrice(o.maxPriceUsd)}.`,
    };
  }
  return null;
}
/** The reason when nothing above rules the card out and the deck still has no card to give up for it. */
const NO_ROOM: NotInReason = { lead: 'No card in the deck can make room for it.' };

/** "+1.4 · rating 77 → 79": the change with its sign, then the ratings (one decimal when whole numbers would hide it). */
function RatingChange({ p }: { p: SwapProposal }) {
  const d = Math.round((p.ratingAfter - p.ratingBefore) * 10) / 10;
  const fine = Math.round(p.ratingBefore) === Math.round(p.ratingAfter) && p.ratingBefore !== p.ratingAfter;
  const f = (n: number) => (fine ? n.toFixed(1) : String(Math.round(n)));
  return (
    <span className="tabular-nums" data-testid="swapin-delta" data-delta={d}>
      <span className={d > 0 ? 'text-bone' : 'text-ash'}>{d > 0 ? `+${d.toFixed(1)}` : d < 0 ? `−${Math.abs(d).toFixed(1)}` : '±0'}</span>
      <span className="text-smoke"> · rating {f(p.ratingBefore)} → {f(p.ratingAfter)}</span>
    </span>
  );
}

const SWAPIN_SHOWN = 5;

/**
 * "Put it in instead of" in the card detail of a card that is not in the deck (or one more basic land):
 * up to five deck cards it could replace, best rating after the swap first, each with its rating
 * change, the engine's objection when it disagrees (still allowed) and the "!" of the copy the new
 * card would take; each row's Swap applies it. Under 100 cards "Add without cutting" comes first; at
 * 100 the plain add stays as a quiet "Add it anyway". When the list is empty it says why.
 */
export function PutItIn({
  card, count, another, state, why, lookup, deckHeld, scoreOf, onSwap, add, reveal = false,
}: {
  card: ClientCard;
  /** Cards in the deck now. */
  count: number;
  /** A basic land already in the deck: the section offers one more copy. */
  another: boolean;
  /** The suggestions for this card; `list` is null while they load. */
  state: { list: SwapProposal[] | null; heldBy: HeldBy; error?: string } | null;
  /** Set when the card options or the card's gate rule it out (no request is made then). */
  why: NotInReason | null;
  lookup: CardLookup;
  /** The deck's own "!" (cards it takes from boxes and built decks). */
  deckHeld: HeldBy;
  scoreOf: (id: string) => CardScore | undefined;
  onSwap: (p: SwapProposal) => void;
  /** The plain add, for a card not in the deck yet. */
  add?: { onAdd: () => void; disabled: boolean };
  /** Scrolls the section into view once its list is there (opened from the card search's "+" on a full deck). */
  reveal?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);
  const list = why ? [] : (state?.list ?? null);
  const loading = list === null && !state?.error;
  const swaps = (list ?? []).filter((p) => p.out !== '' && p.out !== p.in).slice(0, SWAPIN_SHOWN);
  const plain = list?.find((p) => p.out === '');
  const open = count < 100;
  const inHeld = state?.heldBy[card.oracleId];
  const best = open ? -1 : swaps.findIndex((p) => p.agrees !== false);
  const reason = why ?? NO_ROOM;
  useEffect(() => {
    if (reveal && !loading) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [reveal, loading]);

  return (
    <section ref={ref} className="mt-5 border-t border-slag pt-4" aria-label={another ? 'Put another in instead of' : 'Put it in instead of'} data-testid="swapin" data-state={loading ? 'loading' : state?.error ? 'error' : swaps.length > 0 ? 'ready' : 'empty'}>
      <div className="flex items-baseline gap-2">
        <h3 className="display text-[18px] leading-tight">{another ? 'Put another in instead of' : 'Put it in instead of'}</h3>
        {swaps.length > 0 && <span className="text-[13px] tabular-nums text-smoke">{swaps.length}</span>}
      </div>
      {!why && (
        <p className="mt-0.5 text-[13px] text-ash">
          {open && add
            ? `The deck has ${count} cards, so it can go in without a cut, or in place of a deck card. Best rating after the swap first.`
            : open
              ? 'Or in place of a deck card. Best rating after the swap first.'
              : `The deck has ${count} cards: pick the card it replaces. Best rating after the swap first.`}
        </p>
      )}

      {add && open && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
          <button type="button" className="btn btn-sm btn-primary" disabled={add.disabled} onClick={add.onAdd} title={`Put ${card.name} in an open slot; nothing is cut`} data-testid="detail-add">
            Add without cutting
          </button>
          {plain && <RatingChange p={plain} />}
        </div>
      )}

      {loading && <p className="mt-3 text-[13px] text-ash" data-testid="swapin-loading">Looking for the deck cards it could replace</p>}
      {state?.error && !why && (
        <p className="mt-3 text-[13px] text-band-low" role="alert">The suggestions could not be worked out: {state.error}</p>
      )}
      {!loading && !state?.error && swaps.length === 0 && (
        <EmptyState
          className="mt-3"
          testId="swapin-empty"
          message={
            <>
              <span className="text-bone">{reason.lead}</span>
              {reason.hint && <> {reason.hint}</>}
            </>
          }
        />
      )}

      {swaps.length > 0 && (
        <ul className="mt-3 grid gap-2.5" data-testid="swapin-list">
          {swaps.map((p, i) => {
            const known = lookup[p.out];
            const out = known ?? unknownCard(p.out);
            const s = scoreOf(p.out);
            return (
              <li key={p.out} className="flex items-center gap-3" data-testid="swapin-row" data-out={p.out} data-name={out.name} data-agrees={p.agrees === false ? 'false' : 'true'}>
                <div className="w-[52px] shrink-0">
                  <CardTile card={out} size="S" known={!!known} score={s && !s.gate ? Math.round(s.score) : null} heldBy={deckHeld[p.out]} />
                </div>
                <div className="min-w-0 flex-1 text-[13px] leading-snug">
                  <p className="text-bone">Take out {out.name}</p>
                  <p className="flex flex-wrap items-center gap-x-2">
                    <RatingChange p={p} />
                    {inHeld && inHeld.length > 0 && (
                      <span className="inline-flex items-center gap-1 text-ash" data-testid="swapin-held">
                        <HeldMark names={inHeld} small />
                        Held by {inHeld.join(', ')}
                      </span>
                    )}
                  </p>
                  {p.agrees === false && p.objection && (
                    <p className="text-band-mid" data-testid="swapin-objection">Not recommended: {p.objection}</p>
                  )}
                </div>
                <button
                  type="button"
                  className={`btn btn-sm shrink-0 ${i === best ? 'btn-primary' : ''}`}
                  onClick={() => onSwap(p)}
                  title={`Take out ${out.name} and put in ${card.name}. Undo puts it back.`}
                  data-testid="swapin-apply"
                >
                  Swap
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {add && !open && (
        <button
          type="button"
          className="btn btn-sm btn-quiet mt-2"
          disabled={add.disabled}
          onClick={add.onAdd}
          title={`The deck goes to ${count + 1} cards and is not legal until one comes out`}
          data-testid="detail-add"
        >
          Add it anyway ({count + 1} cards)
        </button>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Bracket

export function BracketPanel({ analysis, deck, lookup, onOpen, onShowCombos }: { analysis: AnalyzeResponse; deck: Deck; lookup: CardLookup; onOpen: (id: string) => void; onShowCombos: () => void }) {
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

      <Section title="Combos">
        <p className="text-[0.86rem]" data-testid="combo-summary">
          {b.combos.included.length === 0 ? 'No combo in the deck' : `${b.combos.included.length} ${b.combos.included.length === 1 ? 'combo' : 'combos'} in the deck`}
          {b.combos.oneAway.length > 0 && `, ${b.combos.oneAway.length} one card away`}
          {'. '}
          <button type="button" className="text-brass hover:underline" onClick={onShowCombos} data-testid="combo-summary-link">Show them in the deck</button>
        </p>
      </Section>
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
  /** Incoming cards that would take a copy a box or another built deck holds. */
  heldBy: HeldBy;
}

const delta = (p: SwapProposal) => Math.round((p.ratingAfter - p.ratingBefore) * 10) / 10;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : '±'}${Math.abs(n).toFixed(1)}`;
const chipClass = (on: boolean) => `chip cursor-pointer ${on ? 'border-brass bg-iron text-bone' : 'hover:text-bone'}`;

export function ImprovePanel({
  deck, lookup, themeAxes, options, collectionName, showFreeOnly, freeOnly, setOptions, onFreeOnly, proposals, busy, onRun, onAddOne, onAccept, onReject, onApplyAll, onProxy, onOpen,
}: {
  deck: Deck;
  /** Name of the active collection, for the owned-only box. */
  collectionName: string | null;
  /** The active collection can have boxes and built decks, so "Use free copies only" applies. */
  showFreeOnly: boolean;
  /** "Use free copies only" (with owned-only: copies held by boxes and other built decks do not count). */
  freeOnly: boolean;
  /** Sets (and remembers) "Use free copies only". */
  onFreeOnly: (on: boolean) => void;
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
            <span>Only cards in my {collectionName ? `${collectionName} ` : ''}collection</span>
          </label>
          {showFreeOnly && (
            <label className={`flex items-center gap-2 pl-6 ${options.ownedOnly ? 'cursor-pointer' : 'text-smoke'}`} title="Leave out copies that are sealed in a box or in another built deck">
              <input type="checkbox" checked={freeOnly} disabled={!options.ownedOnly} onChange={(e) => onFreeOnly(e.target.checked)} data-testid="improve-free-only" />
              <span>Use free copies only</span>
            </label>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-primary" disabled={!!busy || deck.commanders.length === 0} onClick={() => onRun('improve')} data-testid="improve-run">
            {busy === 'improve' ? 'Working it out' : 'Find improvements'}
          </button>
          <button type="button" className="btn" disabled={!!busy || deck.commanders.length === 0} onClick={() => onRun('swaps')} title="A few stand-alone swaps for the weakest cards" data-testid="suggest-swaps">
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
                  const held = proposals.heldBy[p.in];
                  return (
                    <li key={`${p.out}>${p.in}`} className={`rounded-md border bg-soot p-2.5 ${p.agrees === false ? 'border-dashed border-band-mid/70' : 'border-slag'}`} data-testid="proposal" data-out={lookup[p.out]?.name ?? ''} data-in={lookup[p.in]?.name} data-agrees={p.agrees === false ? 'no' : 'yes'} data-held={held ? true : undefined}>
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
                        <Thumb id={p.in} lookup={lookup} onOpen={onOpen} width={78} held={held} />
                        <div className="ml-1 flex min-w-0 flex-1 flex-col gap-1.5">
                          <button type="button" className="btn btn-sm btn-primary" onClick={() => onAccept(p)} data-testid="proposal-accept">Accept</button>
                          {proposals.kind !== 'add' && <button type="button" className="btn btn-sm" onClick={() => onReject(p)} data-testid="proposal-reject">Reject</button>}
                          <button type="button" className="btn btn-sm btn-quiet" onClick={() => onProxy([p.in])} title={`Put ${lookup[p.in]?.name ?? 'the incoming card'} on the proxy list`} data-testid="proposal-proxy">Proxy</button>
                        </div>
                      </div>
                      <p className="mt-2 text-[0.84rem]">
                        {p.out ? <><span className="text-ash">{lookup[p.out]?.name ?? 'Unknown'}</span> out, </> : null}<span className="font-medium">{lookup[p.in]?.name ?? 'Unknown'}</span> in.
                      </p>
                      {held && <p className="text-[0.82rem] text-ember" data-testid="proposal-held">No free copy of {lookup[p.in]?.name ?? 'this card'}: {heldText(held).replace(/^In /, 'in ')}.</p>}
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
