'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bracket, Color, Deck } from '@/engine/types';
import { CardImage, ColorPip } from '../components/card';
import { ImportDialog } from '../components/ImportDialog';
import { useNotify } from '../components/Shell';
import { VirtualGrid, usePaged } from '../components/VirtualGrid';
import { buildDeck, createDeck, getCommanders, getPartners, loadEdhrec, type ColorLetter, type ColorMode, type CommanderCard } from '../lib/api';
import { BRACKETS, COLOR_NAME, COLOR_ORDER, fmtInt } from '../lib/ui';

const PAGE = 120;
const MODES: { id: ColorMode; label: string; hint: string }[] = [
  { id: 'includes', label: 'Has', hint: 'Identity has every chosen colour' },
  { id: 'exact', label: 'Exactly', hint: 'Identity is exactly the chosen colours' },
  { id: 'within', label: 'At most', hint: 'Identity stays inside the chosen colours' },
];

export default function NewDeckPage() {
  const router = useRouter();
  const notify = useNotify();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [colors, setColors] = useState<ColorLetter[]>([]);
  const [mode, setMode] = useState<ColorMode>('includes');
  const [commander, setCommander] = useState<CommanderCard | null>(null);
  const [partner, setPartner] = useState<CommanderCard | null>(null);
  const [partners, setPartners] = useState<CommanderCard[] | null>(null);
  const [pickingPartner, setPickingPartner] = useState(false);
  const [chosenColor, setChosenColor] = useState<Color | null>(null);
  const [bracket, setBracket] = useState<Bracket>(3);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === '/' && !(el && /INPUT|TEXTAREA|SELECT/.test(el.tagName))) {
        e.preventDefault();
        search.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const key = JSON.stringify([query, colors, mode]);
  const paged = usePaged<CommanderCard>(
    key,
    PAGE,
    async (page, signal) => {
      const res = await getCommanders({ q: query || undefined, colors: colors.length ? colors : undefined, mode, page, pageSize: PAGE }, signal);
      return { total: res.total, items: res.commanders };
    },
    notify.error,
  );

  const pick = useCallback(
    async (c: CommanderCard) => {
      setCommander(c);
      setPartner(null);
      setPartners(null);
      setPickingPartner(false);
      setChosenColor(null);
      if (c.partnerKinds.length) {
        try {
          setPartners((await getPartners(c.oracleId)).partners);
        } catch (e) {
          notify.error(e);
        }
      }
    },
    [notify],
  );

  const partnerList = useMemo(() => {
    const needle = query.toLowerCase();
    return (partners ?? []).filter((p) => !needle || p.name.toLowerCase().includes(needle));
  }, [partners, query]);

  const needsColor = !!commander && (commander.needsColorChoice || !!partner?.needsColorChoice);
  const requiresColor = !!commander && (commander.requiresColorChoice || !!partner?.requiresColorChoice);
  const deckName = name.trim() || (commander ? [commander.frontName, partner?.frontName].filter(Boolean).join(' and ') : 'New deck');

  const base = (): Deck => ({
    id: null,
    name: deckName,
    commanders: [commander!.oracleId, ...(partner ? [partner.oracleId] : [])],
    companion: null,
    chosenColor,
    main: [],
    targetBracket: bracket,
    themeWeights: null,
  });

  const start = async (how: 'auto' | 'empty') => {
    if (!commander) return;
    setBusy(how);
    try {
      let deck = base();
      if (how === 'auto') {
        // Optional play data for this commander; a no-op unless it was switched on under Card data.
        await loadEdhrec(deck.commanders, bracket).catch(() => null);
        deck = { ...(await buildDeck(deck, 'auto', { seed: 1 })).deck, id: null, name: deckName };
      }
      const saved = await createDeck(deck);
      router.push(`/deck/${saved.deck.id}`);
    } catch (e) {
      notify.error(e);
      setBusy(null);
    }
  };

  const tile = (c: CommanderCard, onPick: (c: CommanderCard) => void, selected: boolean) => (
    <button
      type="button"
      className={`card block w-full cursor-pointer transition-transform hover:-translate-y-0.5 ${selected ? 'outline outline-2 outline-offset-2 outline-brass' : ''}`}
      onClick={() => onPick(c)}
      title={c.name}
      data-testid="commander-tile"
      data-name={c.name}
    >
      <CardImage id={c.oracleId} name={c.name} />
    </button>
  );

  return (
    <div className="flex h-full">
      <section className="flex min-w-0 flex-1 flex-col">
        <div className="px-6 pb-3 pt-6">
          <div className="flex items-end gap-4">
            <div>
              <h1 className="text-[2rem] leading-none">{pickingPartner ? 'Pick a second commander' : 'Pick your commander'}</h1>
              <p className="mt-2 text-ash">
                {pickingPartner
                  ? `${partnerList.length} cards can share the command zone with ${commander?.name}.`
                  : paged.total === null
                    ? 'Loading commanders'
                    : paged.total === 1 ? '1 commander matches.' : `${fmtInt(paged.total)} legal commanders, most played first.`}
              </p>
            </div>
            <button type="button" className="btn ml-auto" onClick={() => setImporting(true)} data-testid="import-open">
              Import a decklist instead
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              ref={search}
              className="field w-[22rem]"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name   ( / )"
              aria-label="Search commanders by name"
              data-testid="commander-search"
            />
            {!pickingPartner && (
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
                        onClick={() =>
                          setColors((cur) => (c === 'C' ? (on ? [] : ['C']) : on ? cur.filter((x) => x !== c) : [...cur.filter((x) => x !== 'C'), c]))
                        }
                        data-testid={`color-${c}`}
                      >
                        <ColorPip color={c} size="1.5rem" dim={!on && colors.length > 0} />
                      </button>
                    );
                  })}
                </div>
                <div className="seg" role="group" aria-label="How colours are matched">
                  {MODES.map((m) => (
                    <button key={m.id} type="button" aria-pressed={mode === m.id} title={m.hint} onClick={() => setMode(m.id)}>
                      {m.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            {pickingPartner && (
              <button type="button" className="btn" onClick={() => setPickingPartner(false)}>Back to all commanders</button>
            )}
          </div>
        </div>

        <div className="min-h-0 flex-1 px-3">
          {pickingPartner ? (
            <VirtualGrid
              count={partnerList.length}
              itemAt={(i) => partnerList[i]}
              ensure={() => {}}
              keyOf={(c) => c.oracleId}
              minTile={170}
              gap={14}
              resetKey={`partner|${query}`}
              testId="partner-grid"
              render={(c) => tile(c, (p) => { setPartner(p); setPickingPartner(false); }, partner?.oracleId === c.oracleId)}
              empty={<p className="p-6 text-ash">No legal second commander matches that name.</p>}
            />
          ) : (
            <VirtualGrid
              count={paged.total ?? 60}
              itemAt={paged.itemAt}
              ensure={paged.ensure}
              keyOf={(c) => c.oracleId}
              minTile={170}
              gap={14}
              resetKey={key}
              testId="commander-grid"
              render={(c) => tile(c, pick, commander?.oracleId === c.oracleId)}
              empty={<p className="p-6 text-ash">No commander matches. Clear the search or the colour filter.</p>}
            />
          )}
        </div>
      </section>

      <aside className="flex w-[25rem] shrink-0 flex-col gap-5 overflow-y-auto border-l border-slag bg-anvil p-6" data-testid="new-deck-panel">
        {!commander ? (
          <div className="text-ash">
            <h2 className="text-[1.3rem] text-bone">Nothing chosen yet</h2>
            <p className="mt-2">Click a card on the left. You then choose a bracket, and either have the deck built for you or start from an empty list.</p>
          </div>
        ) : (
          <>
            <div>
              <div className="flex gap-3">
                <div className="card w-1/2"><CardImage id={commander.oracleId} name={commander.name} size="display" /></div>
                {partner ? (
                  <div className="card w-1/2"><CardImage id={partner.oracleId} name={partner.name} size="display" /></div>
                ) : (
                  <div className="flex w-1/2 flex-col justify-end">
                    <h2 className="text-[1.3rem] leading-tight" data-testid="chosen-commander">{commander.frontName}</h2>
                    <p className="mt-1 text-ash">{commander.typeLine}</p>
                    <div className="mt-2 flex gap-1">
                      {(commander.colorIdentity.length ? commander.colorIdentity : ['C']).map((c) => <ColorPip key={c} color={c} size="1.2rem" />)}
                    </div>
                  </div>
                )}
              </div>
              {partner && (
                <p className="display mt-3 text-[1.15rem] leading-tight" data-testid="chosen-commander">
                  {commander.frontName} and {partner.frontName}
                </p>
              )}
            </div>

            {partners && partners.length > 0 && (
              <div className="rounded-md border border-slag bg-soot p-3">
                <p>
                  {partner ? `Sharing the command zone with ${partner.frontName}.` : `${commander.frontName} can have a second commander. ${partners.length} cards are legal with it.`}
                </p>
                <div className="mt-2 flex gap-2">
                  <button type="button" className="btn btn-sm" onClick={() => { setQ(''); setPickingPartner(true); }} data-testid="pick-partner">
                    {partner ? 'Change the second commander' : 'Choose a second commander'}
                  </button>
                  {partner && <button type="button" className="btn btn-sm btn-quiet" onClick={() => setPartner(null)}>Play it alone</button>}
                </div>
              </div>
            )}

            {needsColor && (
              <div data-testid="color-choice">
                <h3 className="text-[1.05rem]">Chosen colour</h3>
                <p className="mt-0.5 text-ash">
                  This commander has you choose a colour before the game. {requiresColor ? 'The deck is not legal until you do.' : 'It is optional.'}
                </p>
                <div className="mt-2 flex gap-2">
                  {(['W', 'U', 'B', 'R', 'G'] as Color[]).map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={chosenColor === c}
                      title={COLOR_NAME[c]}
                      className={`rounded-full p-0.5 ${chosenColor === c ? 'outline outline-2 outline-brass' : ''}`}
                      onClick={() => setChosenColor(chosenColor === c ? null : c)}
                    >
                      <ColorPip color={c} size="1.7rem" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h3 className="text-[1.05rem]">Bracket</h3>
              <div className="mt-2 grid gap-1.5" role="radiogroup" aria-label="Target bracket">
                {BRACKETS.map((b) => (
                  <button
                    key={b.n}
                    type="button"
                    role="radio"
                    aria-checked={bracket === b.n}
                    onClick={() => setBracket(b.n)}
                    data-testid={`bracket-${b.n}`}
                    className={`flex items-baseline gap-3 rounded-md border px-3 py-2 text-left ${
                      bracket === b.n ? 'border-brass bg-iron' : 'border-slag bg-soot hover:border-smoke'
                    }`}
                  >
                    <span className={`display w-4 text-[1.25rem] leading-none ${bracket === b.n ? 'text-brass' : 'text-ash'}`}>{b.n}</span>
                    <span className="min-w-0">
                      <span className="font-medium">{b.name}</span>
                      <span className="block text-[0.82rem] text-ash">{b.blurb}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <label className="grid gap-1">
              <span className="text-ash">Deck name</span>
              <input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder={deckName} />
            </label>

            <div className="mt-auto grid gap-2">
              {requiresColor && !chosenColor && <p className="text-band-mid">Choose a colour above first.</p>}
              <button
                type="button"
                className="btn btn-primary h-10 text-[0.95rem]"
                disabled={!!busy || (requiresColor && !chosenColor)}
                onClick={() => void start('auto')}
                data-testid="auto-build"
              >
                {busy === 'auto' ? 'Building 100 cards' : 'Auto-build the deck'}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" className="btn" disabled={!!busy} onClick={() => void start('empty')} data-testid="start-empty">
                  {busy === 'empty' ? 'Creating' : 'Start empty'}
                </button>
                <button type="button" className="btn" disabled={!!busy} onClick={() => setImporting(true)}>Import a list</button>
              </div>
            </div>
          </>
        )}
      </aside>

      {importing && <ImportDialog onClose={() => setImporting(false)} defaultBracket={bracket} />}
    </div>
  );
}
