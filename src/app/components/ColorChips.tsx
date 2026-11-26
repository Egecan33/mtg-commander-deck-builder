'use client';

import type { ColorLetter, ColorMode } from '../lib/api';
import { COLOR_NAME, COLOR_ORDER } from '../lib/ui';
import { ColorPip } from './card';

export const COLOR_MODES: { id: ColorMode; label: string; hint: string }[] = [
  { id: 'includes', label: 'Has', hint: 'Identity has every chosen colour' },
  { id: 'exact', label: 'Exactly', hint: 'Identity is exactly the chosen colours' },
  { id: 'within', label: 'At most', hint: 'Identity stays inside the chosen colours' },
];

/** The five colours and colourless as toggles, and (with `onMode`) how they are matched. */
export function ColorChips({
  colors, mode, onColors, onMode,
}: {
  colors: ColorLetter[];
  mode?: ColorMode;
  onColors: (colors: ColorLetter[]) => void;
  onMode?: (mode: ColorMode) => void;
}) {
  return (
    <>
      <div className="flex items-center gap-1.5" role="group" aria-label="Colour identity">
        {COLOR_ORDER.map((c) => {
          const on = colors.includes(c);
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              title={COLOR_NAME[c]}
              className={`rounded-full p-0.5 ${on ? 'outline outline-2 outline-brass' : ''}`}
              onClick={() => onColors(c === 'C' ? (on ? [] : ['C']) : on ? colors.filter((x) => x !== c) : [...colors.filter((x) => x !== 'C'), c])}
              data-testid={`color-${c}`}
            >
              <ColorPip color={c} size="1.5rem" dim={!on && colors.length > 0} />
            </button>
          );
        })}
      </div>
      {onMode && (
        <div className="seg" role="group" aria-label="How colours are matched">
          {COLOR_MODES.map((m) => (
            <button key={m.id} type="button" aria-pressed={mode === m.id} title={m.hint} onClick={() => onMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
