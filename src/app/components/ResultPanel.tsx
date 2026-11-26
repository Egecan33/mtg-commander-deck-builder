'use client';

import { useMemo, useState } from 'react';
import type { CardLookup, HeldBy } from '../lib/api';
import { CardImage } from './card';
import { HeldMark } from './held';

export interface Change { out: string; in: string; reason: string }

const STRIP = 24;

/** "88 → 91", with one decimal when whole numbers would hide the change. */
function ratingText(before: number, after: number): string {
  const fine = Math.round(before) === Math.round(after) && before !== after;
  const f = (n: number) => (fine ? n.toFixed(1) : String(Math.round(n)));
  return `Rating ${f(before)} → ${f(after)}`;
}

const kindOf = (c: Change) => (c.out === '' ? 'add' : c.in === '' ? 'cut' : 'swap');
const cards = (n: number) => `${n} ${n === 1 ? 'card' : 'cards'}`;
function groupHeading(items: Change[]): string {
  const kinds = new Set(items.map(kindOf));
  const n = items.length;
  if (kinds.size > 1) return `${n} changes`;
  const kind = [...kinds][0];
  return kind === 'add' ? `Added ${cards(n)}` : kind === 'cut' ? `Cut ${cards(n)}` : `Swapped ${cards(n)}`;
}

function Thumb({ id, lookup, held }: { id: string; lookup: CardLookup; held?: readonly string[] }) {
  const name = lookup[id]?.name ?? 'Unknown card';
  return (
    <div className="grid w-[46px] shrink-0 justify-items-center gap-1" title={name}>
      <div className="card w-full">
        <CardImage id={id} name={name} known={!!lookup[id]} />
      </div>
      {held && held.length > 0 && <HeldMark names={held} small />}
    </div>
  );
}

/**
 * What an action changed: the title with the rating before → after, the changes grouped by their
 * reason (out → in), and Undo / Dismiss. Test ids derive from `testId`: "fix-panel" gives
 * "fix-undo" and "fix-dismiss".
 */
export function ResultPanel({
  title, before, after, changes, lookup, heldBy, note, onUndo, onDismiss, testId = 'result-panel',
}: {
  title: string;
  before?: number;
  after?: number;
  changes: Change[];
  lookup: CardLookup;
  heldBy?: HeldBy;
  note?: string | null;
  onUndo?: () => void;
  onDismiss: () => void;
  testId?: string;
}) {
  const base = testId.replace(/-panel$/, '');
  const groups = useMemo(() => {
    const by = new Map<string, Change[]>();
    for (const c of changes) by.set(c.reason, [...(by.get(c.reason) ?? []), c]);
    return [...by.entries()].map(([reason, items]) => ({ reason, items }));
  }, [changes]);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const nameOf = (id: string) => lookup[id]?.name ?? 'Unknown card';

  return (
    <section className="result-in rounded-[6px] border border-slag bg-anvil px-3.5 py-3" aria-label={title} data-testid={testId}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-[18px] leading-tight" data-testid={`${base}-title`}>{title}</h2>
          {before !== undefined && after !== undefined && (
            <p className="mt-0.5 text-[13px] text-ash" data-testid={`${base}-rating`}>{ratingText(before, after)}</p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {onUndo && (
            <button type="button" className="btn btn-sm" onClick={onUndo} title="Put the deck back exactly as it was" data-testid={`${base}-undo`}>
              Undo
            </button>
          )}
          <button type="button" className="btn btn-sm btn-quiet" onClick={onDismiss} data-testid={`${base}-dismiss`}>
            Dismiss
          </button>
        </div>
      </div>
      {note && <p className="mt-2 max-w-[70ch] text-[13px] text-bone" data-testid={`${base}-note`}>{note}</p>}

      {groups.length > 0 && (
        <ul className="mt-2.5 grid gap-3" data-testid={`${base}-changes`}>
          {groups.map(({ reason, items }) => {
            if (items.length === 1) {
              const c = items[0]!;
              const held = c.in ? heldBy?.[c.in] : undefined;
              return (
                <li key={reason} className="flex items-start gap-2.5" data-testid={`${base}-change`}>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {c.out && <Thumb id={c.out} lookup={lookup} />}
                    {c.out && c.in && <span className="text-smoke" aria-hidden>→</span>}
                    {c.in && <Thumb id={c.in} lookup={lookup} />}
                  </div>
                  <div className="min-w-0 text-[13px] leading-snug">
                    <p className="text-bone">
                      {c.out && c.in ? `${nameOf(c.out)} → ${nameOf(c.in)}` : c.in ? `Added ${nameOf(c.in)}` : `Cut ${nameOf(c.out)}`}
                    </p>
                    <p className="text-ash">{reason}</p>
                    {held && held.length > 0 && (
                      <p className="mt-0.5 flex items-center gap-1.5 text-ash">
                        <HeldMark names={held} small />
                        Held by {held.join(', ')}
                      </p>
                    )}
                  </div>
                </li>
              );
            }
            const kinds = new Set(items.map(kindOf));
            const strip = kinds.size === 1 && !kinds.has('swap');
            const open = openGroups.has(reason);
            const shown = open ? items : items.slice(0, STRIP);
            return (
              <li key={reason} data-testid={`${base}-group`}>
                <p className="text-[13px]">
                  <span className="text-bone">{groupHeading(items)}</span> <span className="text-ash">{reason}</span>
                </p>
                {strip ? (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {shown.map((c, i) => {
                      const id = c.in || c.out;
                      return <Thumb key={`${id}-${i}`} id={id} lookup={lookup} held={c.in ? heldBy?.[c.in] : undefined} />;
                    })}
                  </div>
                ) : (
                  <ul className="mt-1.5 grid gap-1.5">
                    {shown.map((c, i) => (
                      <li key={`${c.out}-${c.in}-${i}`} className="flex items-center gap-1.5 text-[13px]">
                        {c.out && <Thumb id={c.out} lookup={lookup} />}
                        {c.out && c.in && <span className="text-smoke" aria-hidden>→</span>}
                        {c.in && <Thumb id={c.in} lookup={lookup} />}
                        <span className="ml-1 text-bone">{c.out && c.in ? `${nameOf(c.out)} → ${nameOf(c.in)}` : nameOf(c.in || c.out)}</span>
                        {c.in && <HeldMark names={heldBy?.[c.in]} small />}
                      </li>
                    ))}
                  </ul>
                )}
                {items.length > shown.length && (
                  <button
                    type="button"
                    className="btn btn-sm btn-quiet mt-1"
                    onClick={() => setOpenGroups((s) => new Set(s).add(reason))}
                  >
                    Show all {items.length}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
