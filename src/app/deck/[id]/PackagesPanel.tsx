'use client';

import { useEffect, useState } from 'react';
import { deckSizeOf } from '@/engine/format';
import { LOOSE_SHARE, looseText, packageDef } from '@/engine/packages';
import { PACKAGE_MIN, PACKAGE_PIN_MAX } from '@/engine/targets';
import type { Deck, PackageId, PackageOffer, PlannedPackage } from '@/engine/types';
import { EmptyState } from '../../components/EmptyState';
import { OddsBar } from '../../components/OddsBar';
import type { AnalyzeResponse } from '../../lib/api';
import { Section } from './Panels';

const r1 = (n: number): string => String(Math.round(n * 10) / 10);
/** The 8x8 picture's eight packages: fewer is normal, the rest is room for the owner's own spice. */
const PACKAGE_SLOTS = 8;

/**
 * The deck's own plan: the lands, the four core packages, the theme and functional packages the
 * deck has, and the ones it could add. Every number is the engine's (`AnalyzeResponse.packages`).
 */
export function PackagesPanel({
  analysis, deck, busy, highlight, onComplete, onAdd, onPin, onShow,
}: {
  analysis: AnalyzeResponse;
  deck: Deck;
  busy: string | null;
  /** A package to point at (from the Packages page): scrolled into view with a brass outline. */
  highlight: PackageId | null;
  onComplete: (id: PackageId) => void;
  onAdd: (id: PackageId) => void;
  onPin: (id: PackageId, n: number | null) => void;
  onShow: (id: PackageId) => void;
}) {
  const plan = analysis.packages;
  // The library the odds draw from: the format's deck (100, or 60 in Standard Brawl) without the commanders.
  const librarySize = deckSizeOf(analysis.format) - deck.commanders.length;
  // A package's fewest cards in this format: 8, or 5 in Standard Brawl.
  const min = plan.packageMin ?? PACKAGE_MIN;
  const planned = new Set<string>(plan.packages.map((p) => p.id));
  const offered = plan.offers.find((o) => o.id === highlight);
  // A package that is neither planned nor offered, named from the catalogue.
  const extra: PackageOffer | null = highlight && !planned.has(highlight) && !offered && packageDef(highlight)
    ? { id: highlight, name: packageDef(highlight)!.name, kind: packageDef(highlight)!.kind, why: 'From your Packages page', count: -1 }
    : null;
  const offers = [...(extra ? [extra] : []), ...plan.offers];
  const open = Math.max(0, PACKAGE_SLOTS - plan.packages.length);

  useEffect(() => {
    if (!highlight) return;
    const el = document.querySelector<HTMLElement>(`[data-testid="panel-packages"] [data-package="${CSS.escape(highlight)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [highlight, plan.packages.length, plan.offers.length]);

  return (
    <div data-testid="panel-packages">
      <Section title="Lands" aside="the deck's own number">
        <p className="text-[0.86rem]" data-testid="package-lands">
          <span className="text-bone">{r1(plan.lands.count)} of {plan.lands.target}</span>
          <span className="ml-2 text-ash">{plan.lands.reason}</span>
        </p>
      </Section>

      {plan.packages.map((p) => (
        <PackageRow key={p.id} p={p} min={min} librarySize={librarySize} highlighted={highlight === p.id} busy={busy} onComplete={onComplete} onPin={onPin} onShow={onShow} />
      ))}

      {open > 0 && (
        <p className="border-t border-slag px-4 py-3 text-[0.86rem] text-smoke" data-testid="package-open-slots">
          {open} open {open === 1 ? 'slot' : 'slots'}: room for your own spice.
        </p>
      )}

      <Section title="Add a package" aside={offers.length > 0 ? `${offers.length}` : undefined}>
        <div data-testid="package-offers">
          {offers.length === 0 ? (
            <EmptyState message="Every package this commander supports is in the plan." />
          ) : (
            <ul className="grid gap-2.5">
              {offers.map((o) => (
                <li key={o.id} className={`flex items-start gap-2 rounded-[6px] px-2 py-1.5 ${highlight === o.id ? 'outline outline-2 outline-offset-1 outline-brass' : ''}`} data-testid="package-offer" data-package={o.id}>
                  <div className="min-w-0 flex-1 text-[0.86rem]">
                    <p className="text-bone">{o.name}{o.count >= 0 && <span className="ml-2 text-ash">{o.count} in the deck</span>}</p>
                    {o.why && <p className="text-smoke">{o.why}</p>}
                  </div>
                  <button
                    type="button"
                    className="btn btn-sm shrink-0"
                    disabled={busy !== null}
                    onClick={() => onAdd(o.id)}
                    title={`Sets ${o.name} to ${min} cards and adds the best ones for this deck`}
                    data-testid="package-add"
                  >
                    {busy === `package:${o.id}` ? 'Adding' : 'Add'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Section>
    </div>
  );
}

function PackageRow({
  p, min, librarySize, highlighted, busy, onComplete, onPin, onShow,
}: {
  p: PlannedPackage;
  /** The fewest cards a package holds in the deck's format. */
  min: number;
  librarySize: number;
  highlighted: boolean;
  busy: string | null;
  onComplete: (id: PackageId) => void;
  onPin: (id: PackageId, n: number | null) => void;
  onShow: (id: PackageId) => void;
}) {
  const done = p.count >= p.target;
  // The stepper shows its own clicks at once; the plan catches up after the deck is read again.
  const [local, setLocal] = useState<number | null>(null);
  useEffect(() => setLocal(null), [p.target, p.pinned]);
  const size = local ?? p.target;
  const step = (n: number) => {
    const next = Math.min(PACKAGE_PIN_MAX, Math.max(min, n));
    setLocal(next);
    onPin(p.id, next);
  };
  const loose = p.cohesion && p.cohesion.of >= 4 && p.cohesion.linked / p.cohesion.of < LOOSE_SHARE ? p.cohesion : null;
  return (
    <section
      className={`border-t border-slag px-4 py-4 ${highlighted ? 'outline outline-2 -outline-offset-2 outline-brass' : ''}`}
      data-testid="package-row"
      data-package={p.id}
      aria-label={p.name}
    >
      <div className="mb-1.5 flex items-baseline gap-2">
        <h3 className="text-[1.02rem] leading-tight">{p.name}</h3>
        <span className={`ml-auto tabular-nums ${done ? 'text-band-good' : 'text-bone'}`} data-testid="package-count">{p.count} of {p.target}</span>
      </div>
      <p className="mb-2.5 text-[0.86rem] text-ash">{p.reason}</p>
      {/* odds are drawn from the library (99, or 59): the commanders in the package are not in it */}
      <OddsBar hits={p.library ?? p.count} deckSize={librarySize} label={p.name} testId="package-odds" />
      {p.wipes && (
        <p className="mt-2.5 text-[0.86rem]" data-testid="package-wipes">
          <span className="text-bone">Board wipes · {p.wipes.lo}&ndash;{p.wipes.hi}: {p.wipes.count}</span>
          <span className="ml-2 text-ash">{p.wipes.reason}</span>
        </p>
      )}
      {loose && <p className="mt-2.5 text-[0.86rem] text-ash" data-testid="package-cohesion-hint">{looseText(loose.linked, loose.of)}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className="btn btn-sm"
          disabled={busy !== null || done}
          onClick={() => onComplete(p.id)}
          title={done ? 'Already at its target' : `Adds the ${p.target - p.count} best ${p.name} cards for this deck; on a full deck each one replaces the weakest card outside your packages. Undo puts the deck back.`}
          data-testid="package-complete"
        >
          {busy === `package:${p.id}` ? 'Completing' : 'Complete package'}
        </button>
        <button type="button" className="btn btn-sm btn-quiet" onClick={() => onShow(p.id)} title={`Open the card search on ${p.name} cards that are not in the deck`} data-testid="package-show">
          Show cards
        </button>
        <span className="ml-auto flex items-center gap-1.5 text-[0.86rem]" role="group" aria-label={`${p.name} size`}>
          <button type="button" className="btn btn-sm px-2" disabled={size <= min} onClick={() => step(size - 1)} aria-label={`Want one fewer: ${p.name}`} data-testid="package-pin-less">&minus;</button>
          {/* brass is for the one primary action: a size you set reads bold, Reset is a quiet link */}
          <span className={`w-6 text-center tabular-nums ${p.pinned || local !== null ? 'font-semibold text-bone' : ''}`} data-testid="package-pin-value">{size}</span>
          <button type="button" className="btn btn-sm px-2" disabled={size >= PACKAGE_PIN_MAX} onClick={() => step(size + 1)} aria-label={`Want one more: ${p.name}`} data-testid="package-pin-more">+</button>
          <button type="button" className={`text-[0.75rem] text-ash underline-offset-2 hover:text-bone hover:underline ${p.pinned || local !== null ? '' : 'invisible'}`} onClick={() => { setLocal(null); onPin(p.id, null); }} data-testid="package-pin-reset">Reset</button>
        </span>
      </div>
    </section>
  );
}
