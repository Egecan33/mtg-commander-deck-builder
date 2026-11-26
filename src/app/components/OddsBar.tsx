import { odds } from '@/engine/odds';

const pct = (p: number) => `${Math.round(p * 100)}%`;

/**
 * The chance of seeing at least one of `hits` cards: in the opening hand (7 cards) and by the seventh
 * draw (14 cards), from a `deckSize`-card library (99 in Commander).
 */
export function OddsBar({ hits, deckSize = 99, label, testId = 'odds-bar' }: { hits: number; deckSize?: number; label?: string; testId?: string }) {
  const rows = [
    { text: 'Opening hand', p: odds(deckSize, hits, 7) },
    { text: 'By draw 7', p: odds(deckSize, hits, 14) },
  ];
  return (
    <div className="grid gap-1 text-[13px]" data-testid={testId} aria-label={label ? `Odds of drawing ${label}` : undefined}>
      {label && <p className="text-ash">{label}</p>}
      {rows.map((r) => (
        <div key={r.text} className="grid grid-cols-[6.5rem_minmax(0,1fr)_2.75rem] items-center gap-2" title={`${pct(r.p)} chance to see at least one of ${hits} in ${r.text === 'Opening hand' ? 'the opening hand' : 'the first 14 cards'}`}>
          <span className="text-ash">{r.text}</span>
          <span className="h-1.5 overflow-hidden rounded-full bg-iron" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(r.p * 100)} aria-label={r.text}>
            <span className="block h-full rounded-full bg-ash" style={{ width: pct(r.p) }} />
          </span>
          <span className="text-right text-bone" data-testid="odds-value">{pct(r.p)}</span>
        </div>
      ))}
    </div>
  );
}
