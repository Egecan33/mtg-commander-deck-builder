'use client';

import { useEffect, useState } from 'react';
import { useNotify } from '../components/Shell';
import { getWildcards, readArenaWildcards, setWildcards, type ArenaRarity, type Wildcards as Counts, type WildcardsInfo } from '../lib/api';
import { errText, fmtDate } from '../lib/ui';

const RARITIES: { id: ArenaRarity; label: string }[] = [
  { id: 'common', label: 'Common' },
  { id: 'uncommon', label: 'Uncommon' },
  { id: 'rare', label: 'Rare' },
  { id: 'mythic', label: 'Mythic' },
];

const text = (w: Counts): Record<ArenaRarity, string> => ({ common: String(w.common), uncommon: String(w.uncommon), rare: String(w.rare), mythic: String(w.mythic) });

/**
 * The MTG Arena collection's wildcards, per rarity: the budget of "Only what I can craft". Every
 * Arena sync reads them from the log; "Read from Arena" reads them alone; they can be typed in.
 * `version` changes when an Arena sync ran, so the numbers are read again.
 */
export function ArenaWildcards({ version }: { version: unknown }) {
  const notify = useNotify();
  const [info, setInfo] = useState<WildcardsInfo | null>(null);
  const [draft, setDraft] = useState<Record<ArenaRarity, string> | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    getWildcards(ctrl.signal).then(
      (res) => {
        setInfo(res);
        setDraft(text(res.wildcards));
      },
      () => {},
    );
    return () => ctrl.abort();
  }, [version]);

  const parsed = (d: Record<ArenaRarity, string>): Counts | null => {
    const out = { common: 0, uncommon: 0, rare: 0, mythic: 0 };
    for (const { id } of RARITIES) {
      const n = Number(d[id].trim() === '' ? '0' : d[id]);
      if (!Number.isInteger(n) || n < 0 || n > 9999) return null;
      out[id] = n;
    }
    return out;
  };
  const value = draft ? parsed(draft) : null;
  const changed = !!info && !!value && RARITIES.some(({ id }) => value[id] !== info.wildcards[id]);

  const save = async () => {
    if (!value) return;
    setBusy(true);
    try {
      const res = await setWildcards(value);
      setInfo(res);
      setDraft(text(res.wildcards));
      notify.info('Wildcards saved. Arena decks now build within them.');
    } catch (e) {
      notify.error(`The wildcards were not saved: ${errText(e)}`);
    } finally {
      setBusy(false);
    }
  };
  const read = async () => {
    setBusy(true);
    try {
      const res = await readArenaWildcards();
      setInfo(res);
      setDraft(text(res.wildcards));
      if (res.ok) notify.info(res.message);
      else notify.error(res.message);
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-slag pt-3" data-testid="arena-wildcards">
      <div className="flex items-center gap-3">
        <h3 className="text-[1rem]">Wildcards</h3>
        <button type="button" className="btn btn-sm ml-auto" disabled={busy} onClick={() => void read()} data-testid="wildcards-read">
          {busy ? 'Reading' : 'Read from Arena'}
        </button>
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {RARITIES.map(({ id, label }) => (
          <label key={id} className="flex flex-col gap-1 text-[0.8rem] text-ash">
            {label}
            <input
              className="field h-8 w-full text-center tabular-nums"
              inputMode="numeric"
              value={draft?.[id] ?? ''}
              disabled={!draft || busy}
              onChange={(e) => setDraft((d) => (d ? { ...d, [id]: e.target.value } : d))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && changed) void save();
              }}
              aria-label={`${label} wildcards`}
              data-testid={`wildcards-${id}`}
            />
          </label>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2 text-[0.82rem] text-smoke">
        <span data-testid="wildcards-source">
          {!info
            ? ''
            : info.source === 'log'
              ? `Read from Arena ${fmtDate(info.readAt)}.`
              : info.source === 'hand'
                ? `Typed in ${fmtDate(info.readAt)}.`
                : 'Not read yet: read them from Arena or type them in.'}
        </span>
        {draft && !value && <span className="text-band-low">Use whole numbers from 0 to 9999.</span>}
        {changed && (
          <button type="button" className="btn btn-sm ml-auto" disabled={busy} onClick={() => void save()} data-testid="wildcards-save">
            Save wildcards
          </button>
        )}
      </div>
      <p className="mt-1 text-[0.82rem] text-smoke">
        “Only what I can craft” keeps the cards an Arena deck needs, and you do not own, within these. Each sync reads them again.
      </p>
    </div>
  );
}
