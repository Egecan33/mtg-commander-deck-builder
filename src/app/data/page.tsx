'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Role } from '@/engine/types';
import { CardImage } from '../components/card';
import { useNotify, useStatus } from '../components/Shell';
import { analyzeDeck, browseCards, getSync, startSync, updateSettings, type ClientCard, type Settings, type SyncState, type SyncStep } from '../lib/api';
import { emptyDeck, fmtDate, fmtInt } from '../lib/ui';

const STEPS: { id: SyncStep; name: string; what: string }[] = [
  { id: 'cards', name: 'Cards', what: 'Every Commander-legal and banned card, with prices and the Game Changers list, from Scryfall’s bulk file.' },
  { id: 'tags', name: 'Tags', what: 'Scryfall’s community tags (ramp, removal, card draw and thousands more), used to understand what a card does.' },
  { id: 'combos', name: 'Combos', what: 'Known combos from Commander Spellbook, used for bracket checks and win conditions.' },
  { id: 'features', name: 'Card features', what: 'Worked out on this machine from the three above: roles, themes, mana sources. No download.' },
  { id: 'images', name: 'Card images', what: 'Two sizes of every card face, saved to disk so the app works offline. The long one: tens of thousands of files.' },
];

type OverrideKey = 'mldOverrides' | 'extraTurnOverrides';
const OVERRIDES: { key: OverrideKey; role: Role; title: string; what: string }[] = [
  {
    key: 'mldOverrides',
    role: 'mass-land-denial',
    title: 'Mass land denial',
    what: 'Cards that destroy, lock down or bounce most lands. Brackets 1 to 3 do not allow them. The list is read from card text, so it can be wrong in both directions: correct it here.',
  },
  {
    key: 'extraTurnOverrides',
    role: 'extra-turn',
    title: 'Extra turns',
    what: 'Cards that give extra turns. Brackets 1 and 2 do not allow them, and chaining them is out at Bracket 3.',
  },
];

function OverrideSection({
  spec, settings, onChange,
}: { spec: (typeof OVERRIDES)[number]; settings: Settings; onChange: (key: OverrideKey, next: Record<string, boolean>) => Promise<void> }) {
  const notify = useNotify();
  const overrides = settings[spec.key];
  const [open, setOpen] = useState(false);
  const [detected, setDetected] = useState<ClientCard[] | null>(null);
  const [named, setNamed] = useState<Record<string, ClientCard>>({});
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<ClientCard[]>([]);
  const overrideIds = Object.keys(overrides);
  const idsKey = overrideIds.join(',');

  useEffect(() => {
    if (!open) return;
    const ctrl = new AbortController();
    browseCards({ deck: emptyDeck(), filters: { role: spec.role }, sort: 'name', pageSize: 200 }, ctrl.signal).then(
      (r) => setDetected(r.cards),
      (e) => notify.error(e),
    );
    return () => ctrl.abort();
  }, [open, spec.role, idsKey, notify]);

  // Names and images for overridden cards: the analysis of a list holding just those ids returns them.
  useEffect(() => {
    if (!idsKey) return;
    const ctrl = new AbortController();
    analyzeDeck({ ...emptyDeck(), main: idsKey.split(',').map((oracleId) => ({ oracleId, qty: 1, locked: false })) }, ctrl.signal).then(
      (r) => setNamed(r.cards),
      () => {},
    );
    return () => ctrl.abort();
  }, [idsKey]);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      browseCards({ deck: emptyDeck(), q: q.trim(), sort: 'name', pageSize: 8 }, ctrl.signal).then((r) => setHits(r.cards), () => {});
    }, 200);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  const set = (id: string, value: boolean | null) => {
    const next = { ...overrides };
    if (value === null) delete next[id];
    else next[id] = value;
    void onChange(spec.key, next);
  };
  const cardOf = (id: string) => named[id] ?? detected?.find((c) => c.oracleId === id);

  return (
    <div className="rounded-lg border border-slag bg-anvil p-5" data-testid={`override-${spec.role}`}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-[1.1rem]">{spec.title}</h3>
          <p className="mt-1 max-w-[72ch] text-ash">{spec.what}</p>
        </div>
        <button type="button" className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Hide the list' : 'Show the list'}
        </button>
      </div>

      {overrideIds.length > 0 && (
        <ul className="mt-4 grid gap-1.5" data-testid="override-list">
          {overrideIds.map((id) => (
            <li key={id} className="flex items-center gap-3 rounded-md border border-iron bg-soot px-3 py-1.5">
              <span className="min-w-0 flex-1 truncate">{cardOf(id)?.name ?? id}</span>
              <span className={overrides[id] ? 'text-band-good' : 'text-ash'}>{overrides[id] ? 'You say it counts' : 'You say it does not count'}</span>
              <button type="button" className="btn btn-sm btn-quiet" onClick={() => set(id, null)}>Undo</button>
            </li>
          ))}
        </ul>
      )}

      {open && (
        <div className="mt-4">
          <div className="flex items-center gap-3">
            <input className="field w-[20rem]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add a card the list misses" aria-label={`Find a card to count as ${spec.title}`} />
            {hits.map((c) => (
              <button key={c.oracleId} type="button" className="btn btn-sm" onClick={() => { set(c.oracleId, true); setQ(''); }} title={`Count ${c.name} as ${spec.title.toLowerCase()}`}>
                {c.name}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[0.82rem] text-smoke">{detected ? `${detected.length} cards are counted now. Click one to stop counting it.` : 'Loading the list'}</p>
          <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-2">
            {detected?.map((c) => (
              <button key={c.oracleId} type="button" className="card cursor-pointer" onClick={() => set(c.oracleId, false)} title={`${c.name}: click if this should not count`}>
                <CardImage id={c.oracleId} name={c.name} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export default function DataPage() {
  const notify = useNotify();
  const { status, refresh } = useStatus();
  const [sync, setSync] = useState<SyncState | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const log = useRef<HTMLPreElement>(null);
  const since = useRef(0);

  useEffect(() => {
    if (status && !settings) setSettings(status.settings);
  }, [status, settings]);

  // Follow a running sync: new progress lines every second, fresh counts when it ends.
  const running = sync?.running ?? status?.sync.running ?? false;
  useEffect(() => {
    if (!running) return;
    let stop = false;
    let ticks = 0;
    const poll = async () => {
      try {
        const s = await getSync(since.current);
        if (stop) return;
        since.current = s.lineCount;
        if (s.lines.length) setLines((cur) => [...cur, ...s.lines].slice(-400));
        setSync(s);
        if (!s.running || ++ticks % 5 === 0) void refresh();
      } catch (e) {
        notify.error(e);
      }
    };
    void poll();
    const t = setInterval(poll, 1000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [running, refresh, notify]);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [lines]);

  const run = async (step: SyncStep | 'all') => {
    try {
      since.current = 0;
      setLines([]);
      setSync(await startSync(step));
    } catch (e) {
      notify.error(e);
    }
  };

  const saveSettings = useCallback(
    async (patch: Partial<Settings>) => {
      // Shown at once; put back if the save fails.
      let before: Settings | null = null;
      setSettings((cur) => {
        before = cur;
        return cur ? { ...cur, ...patch } : cur;
      });
      try {
        setSettings(await updateSettings(patch));
        void refresh();
      } catch (e) {
        setSettings(before);
        notify.error(e);
      }
    },
    [notify, refresh],
  );

  const progress = useMemo(() => {
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = /^(\w+) (\d+)\/(\d+)/.exec(lines[i]!);
      if (m) return { step: m[1]!, done: Number(m[2]), total: Number(m[3]) };
    }
    return null;
  }, [lines]);

  if (!status) return <div className="p-8 text-ash">Reading the card database</div>;
  const c = status.counts;
  const last = sync ?? status.sync;
  const imageInfo = status.steps.images?.info as { files?: number; failed?: number } | undefined;
  const imagesOnDisk = c.images.display + c.images.grid;
  const countOf: Record<SyncStep, string> = {
    cards: `${fmtInt(c.legal)} legal, ${fmtInt(c.banned)} banned`,
    tags: `${fmtInt(c.tags)} tags`,
    combos: `${fmtInt(c.combos)} combos`,
    features: `${fmtInt(c.features)} cards understood`,
    images: `${fmtInt(c.images.grid)} small, ${fmtInt(c.images.display)} large`,
  };

  return (
    <div className="mx-auto max-w-[1100px] px-8 py-7" data-testid="data-page">
      <h1 className="text-[2rem] leading-none">Card data</h1>

      {!status.ready ? (
        <div className="mt-5 rounded-lg border border-brass-deep bg-[#2a2212] p-6" data-testid="first-run">
          <h2 className="text-[1.35rem]">First, download the cards</h2>
          <p className="mt-2 max-w-[70ch]">
            Commander Forge keeps every card, combo and card image on this computer, so it works offline and nothing about your decks leaves it. Nothing
            has been downloaded yet. The data takes a few minutes; the images take longer (about 66,000 files) and you can start building while they arrive.
          </p>
          <button type="button" className="btn btn-primary mt-4 h-10 px-5" disabled={running} onClick={() => void run('all')} data-testid="sync-all">
            {running ? 'Downloading' : 'Download everything'}
          </button>
        </div>
      ) : (
        <p className="mt-2 max-w-[75ch] text-ash">
          Everything is stored on this computer under <code className="text-bone">{status.dbPath}</code>. Sync again after Wizards changes the ban list or
          the Game Changers, or when a new set comes out.
        </p>
      )}

      <section className="mt-7">
        <div className="flex items-end gap-3">
          <h2 className="text-[1.35rem]">What is synced</h2>
          {status.ready && (
            <>
              <p className="text-ash" data-testid="game-changers">
                Game Changers: {c.gameChangers} cards, as of {fmtDate(status.cardsSyncedAt)}
              </p>
              <button type="button" className="btn btn-primary ml-auto" disabled={running} onClick={() => void run('all')} data-testid="sync-everything">
                Sync everything
              </button>
            </>
          )}
        </div>
        <ul className="mt-3 divide-y divide-slag rounded-lg border border-slag bg-anvil">
          {STEPS.map((s) => {
            const done = status.steps[s.id];
            const active = running && (last.step === s.id || (last.step === 'all' && progress?.step === s.id));
            return (
              <li key={s.id} className="grid grid-cols-[10rem_1fr_15rem_6rem] items-center gap-5 px-5 py-3.5" data-testid="sync-step" data-step={s.id}>
                <div>
                  <div className="display text-[1.08rem]">{s.name}</div>
                  <div className={`text-[0.8rem] ${done ? 'text-smoke' : 'text-band-mid'}`}>{done ? fmtDate(done.finishedAt) : 'never synced'}</div>
                </div>
                <p className="text-[0.88rem] text-ash">{s.what}</p>
                <div className="text-right">
                  <div>{countOf[s.id]}</div>
                  {s.id === 'images' && imageInfo?.files ? (
                    <div className="mt-1.5" title={`${fmtInt(imagesOnDisk)} of ${fmtInt(imageInfo.files)} files on disk`}>
                      <div className="ml-auto h-1.5 w-full overflow-hidden rounded-full bg-iron">
                        <div className="h-full rounded-full bg-band-top" style={{ width: `${Math.min(100, (imagesOnDisk / imageInfo.files) * 100)}%` }} />
                      </div>
                      <div className="mt-1 text-[0.78rem] text-smoke">
                        {fmtInt(imagesOnDisk)} of {fmtInt(imageInfo.files)} files{imageInfo.failed ? `, ${imageInfo.failed} failed` : ''}
                      </div>
                    </div>
                  ) : null}
                </div>
                <button type="button" className="btn btn-sm" disabled={running} onClick={() => void run(s.id)} data-testid={`sync-${s.id}`}>
                  {active ? 'Running' : 'Sync'}
                </button>
              </li>
            );
          })}
        </ul>

        {(running || lines.length > 0 || last.exitCode !== null) && (
          <div className="mt-3 rounded-lg border border-slag bg-anvil p-4" data-testid="sync-progress">
            <div className="flex items-baseline gap-3">
              <span className="display text-[1.05rem]">
                {running ? `Syncing ${last.step === 'all' ? 'everything' : last.step}` : last.exitCode === 0 ? 'Last sync finished' : last.exitCode === null ? 'Sync' : `Last sync stopped with an error (exit code ${last.exitCode})`}
              </span>
              {progress && running && (
                <span className="text-ash">{progress.step}: {fmtInt(progress.done)} of {fmtInt(progress.total)}</span>
              )}
            </div>
            {progress && running && (
              <div className="mt-2 h-2 overflow-hidden rounded-full bg-iron">
                <div className="h-full rounded-full bg-brass" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
              </div>
            )}
            {lines.length > 0 && (
              <pre ref={log} className="mt-3 max-h-48 overflow-auto rounded bg-soot p-3 text-[0.78rem] leading-relaxed text-ash">{lines.join('\n')}</pre>
            )}
          </div>
        )}
      </section>

      {settings && (
        <>
          <section className="mt-9">
            <h2 className="text-[1.35rem]">EDHREC play data</h2>
            <div className="mt-3 rounded-lg border border-slag bg-anvil p-5">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4"
                  checked={settings.edhrecEnabled}
                  onChange={(e) => void saveSettings({ edhrecEnabled: e.target.checked })}
                  data-testid="edhrec-toggle"
                />
                <span>
                  <span className="display text-[1.08rem]">Use EDHREC data for the commanders I pick</span>
                  <span className="mt-1 block text-ash" data-testid="edhrec-state">
                    {settings.edhrecEnabled ? 'On. Scores use what real decks with your commander play.' : 'Off. Scores are based on card text and tags only.'}
                  </span>
                </span>
              </label>
              <div className="mt-4 grid max-w-[78ch] gap-2 text-[0.9rem] text-ash">
                <p>
                  <span className="text-bone">What you get.</span> Noticeably better per-commander scores, because the app learns which cards real decks
                  with that commander run instead of guessing from card text.
                </p>
                <p>
                  <span className="text-bone">What it costs.</span> EDHREC has no official API and its terms do not permit automated access. With this on,
                  the app fetches two pages when you pick a commander (the commander’s page and the one for your bracket), one after the other, at least
                  1.5 seconds apart, and keeps them on disk for 7 days. Nothing about you or your decks is sent, and the data never leaves this computer.
                </p>
                <p>
                  <span className="text-bone">The choice is yours.</span> It ships off so that accepting that risk is something you do knowingly. The app
                  is fully usable without it.
                </p>
              </div>
            </div>
          </section>

          <section className="mt-9 pb-10">
            <h2 className="text-[1.35rem]">Bracket card lists you can correct</h2>
            <div className="mt-3 grid gap-4">
              {status.ready ? (
                OVERRIDES.map((o) => (
                  <OverrideSection key={o.key} spec={o} settings={settings} onChange={(key, next) => saveSettings({ [key]: next } as Partial<Settings>)} />
                ))
              ) : (
                <p className="text-ash">Available once the cards are downloaded.</p>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
