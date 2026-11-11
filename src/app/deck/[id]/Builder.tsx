'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Bracket, CardScore, Color, Deck, Fix, ImproveGoals, Role, SwapProposal } from '@/engine/types';
import { CardDetail } from '../../components/CardDetail';
import { CardImage, ColorPip, Gauge, Overlay } from '../../components/card';
import { useNotify, useProxies, useStatus } from '../../components/Shell';
import {
  ApiError, analyzeDeck, browseCards, buildDeck, exportDeck, getDeck, loadEdhrec, updateDeck,
  type AnalyzeResponse, type CardLookup, type ClientCard, type ScoredCard,
} from '../../lib/api';
import {
  BRACKETS, COLOR_NAME, DEFAULT_QUERY, addCard, bracketName, brokenRules, deckCount, entryOf, errText, inDeck, isAbort, queryForFix, removeCard, swapCard, toggleLock,
  type BrowserQuery,
} from '../../lib/ui';
import { Browser } from './Browser';
import { DeckView, type Grouping, type Layout } from './DeckView';
import { ADD_ONE, BracketPanel, GOAL_CHIPS, ImprovePanel, RatingPanel, ThemesPanel, type ImproveOptions, type PanelId, type ProposalSet } from './Panels';

const PANELS: { id: PanelId; label: string }[] = [
  { id: 'rating', label: 'Rating' },
  { id: 'bracket', label: 'Bracket' },
  { id: 'themes', label: 'Themes' },
  { id: 'improve', label: 'Improve' },
];
const WEAKEST = 5;

export function Builder({ id }: { id: string }) {
  const notify = useNotify();
  const proxies = useProxies();
  const { status } = useStatus();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [settled, setSettled] = useState<Deck | null>(null);
  const [rev, setRev] = useState(0);
  const [analysis, setAnalysis] = useState<AnalyzeResponse | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [lookup, setLookup] = useState<CardLookup>({});
  const [hints, setHints] = useState<Record<string, CardScore>>({});
  const [loadError, setLoadError] = useState<{ text: string; missing: boolean } | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'failed'>('saved');
  const [busy, setBusy] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelId>('rating');
  const [query, setQuery] = useState<BrowserQuery>(DEFAULT_QUERY);
  const [grouping, setGrouping] = useState<Grouping>('role');
  const [layout, setLayout] = useState<Layout>('grid');
  const [detail, setDetail] = useState<string | null>(null);
  const [exported, setExported] = useState<{ text: string; copied: boolean } | null>(null);
  const [options, setOptions] = useState<ImproveOptions>({ bracket: 'keep', ownedOnly: false, maxPrice: '', maxSwaps: '15', goals: [], lean: false, leanAxis: '' });
  const [proposals, setProposals] = useState<ProposalSet | null>(null);
  const dirty = useRef(false);
  const saveSeq = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);

  const learn = useCallback((cards: CardLookup | ClientCard[]) => {
    setLookup((cur) => {
      const next = { ...cur };
      for (const c of Array.isArray(cards) ? cards : Object.values(cards)) next[c.oracleId] = c;
      return next;
    });
  }, []);

  // ---- load
  useEffect(() => {
    const ctrl = new AbortController();
    getDeck(id, ctrl.signal).then(
      (res) => {
        learn(res.cards);
        setDeck(res.deck);
        setSettled(res.deck);
        // Optional per-commander play data; answers 'off' at once unless switched on under Card data.
        if (res.deck.commanders.length) {
          loadEdhrec(res.deck.commanders, res.deck.targetBracket).then(
            (r) => {
              if (r.status === 'ready') setRev((n) => n + 1);
            },
            () => {},
          );
        }
      },
      (e) => {
        if (!isAbort(e)) setLoadError({ text: errText(e), missing: e instanceof ApiError && e.status === 404 });
      },
    );
    return () => ctrl.abort();
  }, [id, learn]);

  // ---- every change: wait 200 ms, then analyse and save
  useEffect(() => {
    if (!deck || deck === settled) return;
    const t = setTimeout(() => {
      setSettled(deck);
      setRev((n) => n + 1);
    }, 200);
    return () => clearTimeout(t);
  }, [deck, settled]);

  useEffect(() => {
    if (!settled) return;
    const ctrl = new AbortController();
    setAnalysing(true);
    analyzeDeck(settled, ctrl.signal).then(
      (res) => {
        learn(res.cards);
        setAnalysis(res);
        setAnalysing(false);
      },
      (e) => {
        if (isAbort(e)) return;
        setAnalysing(false);
        notify.error(`Could not analyse the deck: ${errText(e)}`);
      },
    );
    return () => ctrl.abort();
  }, [settled, rev, learn, notify]);

  useEffect(() => {
    if (!settled || !dirty.current) return;
    const seq = ++saveSeq.current;
    setSaveState('saving');
    updateDeck(id, settled).then(
      () => {
        if (seq === saveSeq.current) setSaveState('saved');
      },
      (e) => {
        if (seq !== saveSeq.current) return;
        setSaveState('failed');
        notify.error(`The deck was not saved: ${errText(e)}`);
      },
    );
  }, [settled, id, notify]);

  const mutate = useCallback((fn: (d: Deck) => Deck) => {
    dirty.current = true;
    setDeck((d) => (d ? fn(d) : d));
  }, []);

  // ---- keyboard: "/" goes to search. Esc is handled by whichever overlay is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !(el && /INPUT|TEXTAREA|SELECT/.test(el.tagName))) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ---- card actions
  const add = useCallback(
    (card: ScoredCard | string) => {
      if (typeof card !== 'string') {
        learn([card]);
        setHints((h) => ({ ...h, [card.oracleId]: card.score }));
      }
      const cardId = typeof card === 'string' ? card : card.oracleId;
      mutate((d) => addCard(d, cardId));
    },
    [learn, mutate],
  );
  const remove = useCallback((cardId: string) => mutate((d) => removeCard(d, cardId)), [mutate]);
  const lock = useCallback((cardId: string) => mutate((d) => toggleLock(d, cardId)), [mutate]);

  const openCard = useCallback(
    (card: ScoredCard | string) => {
      if (typeof card !== 'string') {
        learn([card]);
        setHints((h) => ({ ...h, [card.oracleId]: card.score }));
        setDetail(card.oracleId);
      } else setDetail(card);
    },
    [learn],
  );

  // A card opened from a panel (a combo piece, a proposal) has no score yet: ask the browser for it.
  const detailCard = detail ? lookup[detail] : undefined;
  const detailScore = detail ? ((deck && inDeck(deck, detail) ? analysis?.deckScores[detail] : undefined) ?? hints[detail] ?? analysis?.deckScores[detail]) : undefined;
  useEffect(() => {
    if (!detail || !settled || !detailCard || detailScore) return;
    const ctrl = new AbortController();
    browseCards({ deck: settled, q: detailCard.frontName, pageSize: 20 }, ctrl.signal).then(
      (res) => {
        const hit = res.cards.find((c) => c.oracleId === detail);
        if (hit) setHints((h) => ({ ...h, [detail]: hit.score }));
      },
      () => {},
    );
    return () => ctrl.abort();
  }, [detail, settled, detailCard, detailScore]);

  const scoreOf = useCallback((cardId: string) => analysis?.deckScores[cardId] ?? hints[cardId], [analysis, hints]);

  const weakest = useMemo(() => {
    if (!deck || !analysis || deck.main.length < 20) return new Set<string>();
    const scored = deck.main
      .filter((e) => !e.locked && !lookup[e.oracleId]?.roles.includes('land'))
      .map((e) => ({ id: e.oracleId, s: analysis.deckScores[e.oracleId] }))
      .filter((x): x is { id: string; s: CardScore } => !!x.s && !x.s.gate)
      .sort((a, b) => a.s.score - b.s.score);
    return new Set(scored.slice(0, WEAKEST).map((x) => x.id));
  }, [deck, analysis, lookup]);

  // The deck's themes, strongest first, for "Lean into theme".
  const themeAxes = useMemo(() => {
    const w = analysis?.themeWeights ?? {};
    return Object.keys(w).filter((a) => (w[a] ?? 0) > 0).sort((a, b) => (w[b] ?? 0) - (w[a] ?? 0) || a.localeCompare(b));
  }, [analysis]);

  // ---- build actions
  const buildOpts = () => {
    const price = Number(options.maxPrice);
    return { ownedOnly: options.ownedOnly || undefined, maxPriceUsd: options.maxPrice.trim() && Number.isFinite(price) && price > 0 ? price : null };
  };
  const rebuild = async (mode: 'auto' | 'fill', label: string, seed?: number) => {
    if (!deck) return;
    setBusy(label);
    try {
      const res = await buildDeck(deck, mode, { ...buildOpts(), seed });
      learn(res.cards);
      setProposals(null);
      mutate((d) => ({ ...res.deck, id: d.id, name: d.name }));
      notify.info(mode === 'fill' ? 'Filled the deck to 100 cards' : 'Built a new 100-card deck. Locked cards were kept.');
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(null);
    }
  };
  const propose = async (kind: 'improve' | 'swaps') => {
    if (!deck) return;
    setBusy(kind);
    setPanel('improve');
    const bracket = options.bracket === 'keep' ? deck.targetBracket : options.bracket;
    try {
      let res;
      if (kind === 'improve') {
        const typed = Math.floor(Number(options.maxSwaps));
        const goals: ImproveGoals = {
          maxSwaps: Number.isFinite(typed) && typed >= 1 ? Math.min(40, typed) : 15,
          targetBracket: bracket,
          emphasizeRoles: GOAL_CHIPS.filter((g) => options.goals.includes(g.id)).flatMap((g) => g.roles),
          emphasizeAxes: options.lean && themeAxes.length > 0 ? [themeAxes.includes(options.leanAxis) ? options.leanAxis : themeAxes[0]!] : [],
        };
        res = await buildDeck(deck, 'improve', { ...buildOpts(), goals });
      } else {
        res = await buildDeck({ ...deck, targetBracket: bracket }, 'swaps', { ...buildOpts(), count: 8 });
      }
      learn(res.cards);
      setProposals({ kind, bracket, items: res.proposals, asked: false });
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(null);
    }
  };
  const addOne = async (role: Role) => {
    if (!deck) return;
    setBusy(`add:${role}`);
    setPanel('improve');
    try {
      const res = await buildDeck(deck, 'add', { ...buildOpts(), role, count: 5 });
      learn(res.cards);
      setProposals({ kind: 'add', bracket: deck.targetBracket, items: res.proposals, asked: false, noun: ADD_ONE.find((a) => a.role === role)?.noun });
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(null);
    }
  };
  const proxyCards = (ids: string[], what?: string) => void proxies.add(ids.map((oracleId) => ({ oracleId, qty: 1 })), what);
  /** The deck's cards for the proxy list: the ones not in the collection, or all of them. Basic lands are left out. */
  const proxyDeck = (all: boolean) => {
    if (!deck) return;
    const wanted = [...deck.commanders.map((oracleId) => ({ oracleId, qty: 1 })), ...deck.main.map((e) => ({ oracleId: e.oracleId, qty: e.qty }))].filter((i) => {
      const card = lookup[i.oracleId];
      return card && !/\bBasic\b.*\bLand\b/.test(card.typeLine) && (all || !card.owned);
    });
    if (wanted.length === 0) {
      notify.info(all ? 'The deck has no cards to proxy besides basic lands.' : 'You own every card in this deck (basic lands are not counted).');
      return;
    }
    const n = wanted.reduce((sum, i) => sum + i.qty, 0);
    void proxies.add(wanted, `Added ${n} ${n === 1 ? 'card' : 'cards'} ${all ? 'from this deck' : 'you do not own'} to the proxy list. Basic lands were left out.`);
  };
  const accept = (list: SwapProposal[]) => {
    if (!proposals || !deck) return;
    const bracket = proposals.bracket;
    // A proposal with no card to cut is a plain add (the deck had open slots).
    const usable = list.filter((p) => p.out === '' || entryOf(deck, p.out));
    if (usable.length < list.length) notify.info('A swap was skipped because its card is no longer in the deck.');
    mutate((d) => ({ ...usable.reduce((acc, p) => (p.out === '' ? addCard(acc, p.in) : swapCard(acc, p.out, p.in)), d), targetBracket: bracket }));
    // "Add one" suggestions are alternatives: taking one settles the question.
    setProposals({ ...proposals, asked: true, items: proposals.kind === 'add' ? [] : proposals.items.filter((p) => !list.includes(p)) });
    if (usable.length) notify.info(usable.length === 1 ? `Swapped in ${lookup[usable[0]!.in]?.name ?? 'the new card'}` : `Applied ${usable.length} swaps`);
  };
  const doExport = async () => {
    if (!deck) return;
    setBusy('export');
    try {
      const { text } = await exportDeck(deck);
      let copied = false;
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        // clipboard permission denied: the text is shown for a manual copy
      }
      setExported({ text, copied });
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(null);
    }
  };
  const applyFix = (fix: Fix) => {
    const next = queryForFix(fix);
    if (next) setQuery(next);
  };

  // ---- render
  if (loadError) {
    return (
      <div className="mx-auto mt-16 max-w-[34rem] rounded-lg border border-slag bg-anvil p-8" role="alert" data-testid="deck-load-error">
        <h1 className="text-[1.5rem]">{loadError.missing ? 'This deck does not exist any more' : 'The deck could not be opened'}</h1>
        <p className="mt-2 text-ash">{loadError.missing ? 'It may have been deleted. Your other decks are still there.' : loadError.text}</p>
        <Link href="/" className="btn btn-primary mt-5">Back to your decks</Link>
      </div>
    );
  }
  if (!deck || !settled) return <div className="p-8 text-ash">Opening the deck</div>;

  const count = deckCount(deck);
  const rating = analysis?.rating;
  const noCollection = status?.counts.collection === 0;
  const broken = rating ? brokenRules(rating, count) : [];
  const needsColor = rating?.violations.some((v) => v.code === 'needs-color') || deck.chosenColor !== null;
  const detailEntry = detail ? entryOf(deck, detail) : undefined;
  const detailIsCommander = !!detail && deck.commanders.includes(detail);
  const canCommand = !!detailCard && /Legendary|can be your commander/i.test(detailCard.typeLine) && deck.commanders.length < 2 && !detailIsCommander;

  return (
    <div className="flex h-full flex-col" data-testid="builder">
      <header className="flex shrink-0 items-center gap-4 border-b border-slag bg-anvil px-4 py-2.5">
        <div className="flex shrink-0 gap-1.5">
          {deck.commanders.length === 0 && (
            <div className="flex h-[5.4rem] w-[9rem] items-center rounded-md border border-dashed border-smoke px-2 text-[0.8rem] text-ash">
              No commander. Open a legendary creature and choose “Make commander”.
            </div>
          )}
          {deck.commanders.map((c) => (
            <button key={c} type="button" className="card w-[3.9rem] cursor-zoom-in" onClick={() => setDetail(c)} aria-label={`Details for ${lookup[c]?.name ?? 'commander'}`} data-testid="commander-thumb">
              <CardImage id={c} name={lookup[c]?.name ?? 'Commander'} known={!!lookup[c]} />
            </button>
          ))}
        </div>

        <div className="min-w-0 flex-1">
          <input
            className="display w-full truncate rounded border border-transparent bg-transparent px-1 text-[1.45rem] leading-tight hover:border-slag focus:border-slag"
            value={deck.name}
            onChange={(e) => mutate((d) => ({ ...d, name: e.target.value }))}
            aria-label="Deck name"
            data-testid="deck-name"
          />
          <div className="mt-1 flex flex-wrap items-center gap-1.5 px-1">
            <span className={`chip ${count === 100 ? 'text-bone' : 'border-band-mid text-band-mid'}`} data-testid="deck-count">{count} / 100</span>
            {rating && (
              <button
                type="button"
                className={`chip ${rating.legal ? 'border-band-top text-band-top' : broken.length ? 'border-band-low text-band-low' : ''}`}
                title={rating.legal ? 'Follows every Commander deck-building rule' : rating.violations.map((v) => v.message).join('\n')}
                onClick={() => setPanel('rating')}
                data-testid="legality"
              >
                {rating.legal ? 'Legal' : broken.length ? `Not legal (${broken.length})` : 'Not finished'}
              </button>
            )}
            {analysis && (
              <>
                <button type="button" className="chip hover:text-bone" onClick={() => setPanel('bracket')} title="The lowest bracket the hard rules allow for this list" data-testid="chip-floor">
                  Minimum bracket {analysis.bracket.floor}
                </button>
                <button type="button" className={`chip hover:text-bone ${analysis.bracket.playsLike !== deck.targetBracket ? 'border-band-good text-band-good' : ''}`} onClick={() => setPanel('bracket')} data-testid="chip-plays-like">
                  Plays like {analysis.bracket.playsLike}
                </button>
                {analysis.bracket.violationsOfTarget.length > 0 && (
                  <button type="button" className="chip border-band-low text-band-low" onClick={() => setPanel('bracket')} title="Cards or combos in the deck that the target bracket does not allow" data-testid="chip-over-bracket">
                    Over Bracket {deck.targetBracket} ({analysis.bracket.violationsOfTarget.length})
                  </button>
                )}
                {analysis.unknown.length > 0 && <span className="chip border-band-low text-band-low">{analysis.unknown.length} unknown</span>}
                {analysis.edhrec !== 'ready' && (
                  <span className="text-[0.75rem] text-smoke" title="EDHREC play data is off or not available. It can be switched on under Card data.">Scored from card text and tags</span>
                )}
              </>
            )}
            <span className="ml-1 text-[0.75rem] text-smoke" data-testid="save-state" aria-live="polite">
              {saveState === 'saving' || deck !== settled ? 'Saving' : saveState === 'failed' ? 'Not saved' : dirty.current ? 'Saved' : ''}
            </span>
          </div>
          {needsColor && (
            <div className="mt-1 flex items-center gap-1.5 px-1 text-[0.8rem] text-ash" data-testid="chosen-color">
              <span>Chosen colour</span>
              {(['W', 'U', 'B', 'R', 'G'] as Color[]).map((c) => (
                <button key={c} type="button" title={COLOR_NAME[c]} aria-pressed={deck.chosenColor === c} className={`rounded-full ${deck.chosenColor === c ? 'outline outline-2 outline-offset-1 outline-brass' : ''}`} onClick={() => mutate((d) => ({ ...d, chosenColor: d.chosenColor === c ? null : c }))}>
                  <ColorPip color={c} size="1.1rem" dim={deck.chosenColor !== null && deck.chosenColor !== c} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="shrink-0">
          <div className="mb-1 text-[0.75rem] text-ash">Target bracket: {bracketName(deck.targetBracket)}</div>
          <div className="seg" role="group" aria-label="Target bracket">
            {BRACKETS.map((b) => (
              <button key={b.n} type="button" aria-pressed={deck.targetBracket === b.n} title={`${b.name}. ${b.blurb}`} onClick={() => mutate((d) => ({ ...d, targetBracket: b.n as Bracket }))} data-testid={`target-${b.n}`}>
                {b.n}
              </button>
            ))}
          </div>
        </div>

        <button type="button" className={`shrink-0 rounded-md px-1 ${analysing ? 'opacity-70' : ''}`} onClick={() => setPanel('rating')} title="Open the rating" data-testid="header-gauge">
          {rating ? <Gauge value={rating.rating} partial={!rating.complete} legal={broken.length === 0} size={112} /> : <div className="skeleton h-[4.3rem] w-28 rounded-md" />}
        </button>

        <div className="grid shrink-0 grid-cols-3 gap-1.5">
          <button type="button" className="btn btn-sm btn-primary" disabled={!!busy || deck.commanders.length === 0} onClick={() => void rebuild('auto', 'auto', 1)} title="Build a full 100-card deck around the commander. Locked cards stay." data-testid="auto-build">
            {busy === 'auto' ? 'Building' : 'Auto-build'}
          </button>
          <button type="button" className="btn btn-sm" disabled={!!busy || deck.commanders.length === 0 || count >= 100} onClick={() => void rebuild('fill', 'fill')} title="Keep every card in the deck and add the best cards for the empty slots" data-testid="fill">
            {busy === 'fill' ? 'Filling' : 'Fill the rest'}
          </button>
          <button type="button" className="btn btn-sm" disabled={!!busy || deck.commanders.length === 0} onClick={() => void rebuild('auto', 'reroll', 2 + Math.floor(Math.random() * 1_000_000))} title="Build again with different picks among near-equal cards. Locked cards stay." data-testid="reroll">
            {busy === 'reroll' ? 'Rolling' : 'Reroll'}
          </button>
          <button type="button" className="btn btn-sm" disabled={!!busy || deck.commanders.length === 0} onClick={() => void propose('swaps')} data-testid="suggest-swaps">
            {busy === 'swaps' ? 'Looking' : 'Suggest swaps'}
          </button>
          <button type="button" className="btn btn-sm" disabled={!!busy || deck.commanders.length === 0} onClick={() => void propose('improve')} data-testid="improve">
            {busy === 'improve' ? 'Working' : 'Improve'}
          </button>
          <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void doExport()} data-testid="export">
            Export
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_22.5rem] grid-rows-[minmax(0,1fr)]">
        <Browser
          deck={deck}
          settled={settled}
          rev={rev}
          query={query}
          setQuery={setQuery}
          extraAxes={analysis ? Object.keys(analysis.themeWeights) : []}
          onAdd={add}
          onRemove={remove}
          onOpen={openCard}
          searchRef={searchRef}
        />
        <DeckView
          deck={deck}
          lookup={lookup}
          scoreOf={scoreOf}
          weakest={weakest}
          grouping={grouping}
          layout={layout}
          setGrouping={setGrouping}
          setLayout={setLayout}
          onRemove={remove}
          onAdd={add}
          onLock={lock}
          onOpen={openCard}
          tools={
            <button
              type="button"
              className="btn btn-sm btn-quiet"
              disabled={deck.main.length === 0 && deck.commanders.length === 0}
              onClick={() => proxyDeck(noCollection)}
              title={noCollection ? 'Your collection is empty, so every card counts as not owned. Puts the whole deck on the proxy list (basic lands left out).' : 'Puts every card of this deck that is not in your collection on the proxy list (basic lands left out).'}
              data-testid="proxy-deck"
            >
              {noCollection ? 'Proxy whole deck' : 'Proxy cards I don’t own'}
            </button>
          }
        />
        <aside className="flex min-h-0 flex-col border-l border-slag bg-anvil" aria-label="Deck analysis">
          <div className="flex shrink-0 border-b border-slag" role="tablist">
            {PANELS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={panel === p.id}
                className={`display flex-1 border-b-2 py-2.5 text-[0.98rem] ${panel === p.id ? 'border-brass text-bone' : 'border-transparent text-ash hover:text-bone'}`}
                onClick={() => setPanel(p.id)}
                data-testid={`tab-${p.id}`}
              >
                {p.label}
                {p.id === 'bracket' && analysis && analysis.bracket.violationsOfTarget.length > 0 && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-band-low align-middle" />}
                {p.id === 'improve' && proposals && proposals.items.length > 0 && <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-brass align-middle" />}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain" role="tabpanel">
            {!analysis ? (
              <p className="p-4 text-ash">Reading the deck</p>
            ) : panel === 'rating' ? (
              <RatingPanel
                analysis={analysis}
                deck={deck}
                lookup={lookup}
                busy={busy}
                onFix={applyFix}
                onOpen={openCard}
                onAddOne={(role) => void addOne(role)}
                onWanted={(role, n) => mutate((d) => {
                  const next = { ...(d.roleTargets ?? {}) };
                  if (n === null) delete next[role];
                  else next[role] = n;
                  return { ...d, roleTargets: Object.keys(next).length > 0 ? next : null };
                })}
              />
            ) : panel === 'bracket' ? (
              <BracketPanel analysis={analysis} deck={deck} lookup={lookup} onOpen={openCard} />
            ) : panel === 'themes' ? (
              <ThemesPanel
                analysis={analysis}
                deck={deck}
                onChange={(axis, w) => mutate((d) => ({ ...d, themeWeights: { ...(d.themeWeights ?? analysis.themeWeights), [axis]: w } }))}
                onReset={() => mutate((d) => ({ ...d, themeWeights: null }))}
                onShow={(axis) => setQuery({ ...DEFAULT_QUERY, axis, fromFix: null })}
              />
            ) : (
              <ImprovePanel
                deck={deck}
                lookup={lookup}
                themeAxes={themeAxes}
                options={options}
                setOptions={setOptions}
                proposals={proposals}
                busy={busy}
                onRun={(kind) => void propose(kind)}
                onAddOne={(role) => void addOne(role)}
                onProxy={(ids) => proxyCards(ids)}
                onAccept={(p) => accept([p])}
                onReject={(p) => proposals && setProposals({ ...proposals, asked: true, items: proposals.items.filter((x) => x !== p) })}
                onApplyAll={() => proposals && accept(proposals.items)}
                onOpen={openCard}
              />
            )}
          </div>
        </aside>
      </div>

      {detail && (
        <CardDetail
          id={detail}
          card={detailCard}
          score={detailScore}
          onClose={() => setDetail(null)}
          note={detailEntry?.locked ? 'Locked: auto-build and improve keep this card.' : undefined}
          actions={
            <>
              {detailIsCommander ? (
                <button type="button" className="btn" onClick={() => { mutate((d) => ({ ...d, commanders: d.commanders.filter((c) => c !== detail) })); setDetail(null); }} data-testid="detail-uncommand">
                  Take out of the command zone
                </button>
              ) : detailEntry ? (
                <>
                  <button type="button" className="btn btn-danger" onClick={() => remove(detail)} data-testid="detail-remove">Remove from the deck</button>
                  <button type="button" className="btn" onClick={() => lock(detail)} data-testid="detail-lock">{detailEntry.locked ? 'Unlock' : 'Lock in the deck'}</button>
                  {detailCard?.roles.includes('land') && <button type="button" className="btn" onClick={() => add(detail)}>Add another copy ({detailEntry.qty} now)</button>}
                </>
              ) : (
                <button type="button" className="btn btn-primary" disabled={!detailCard || !!detailScore?.gate} onClick={() => add(detail)} data-testid="detail-add">
                  Add to the deck
                </button>
              )}
              {canCommand && (
                <button
                  type="button"
                  className="btn"
                  onClick={() => mutate((d) => ({ ...removeAll(d, detail), commanders: [...d.commanders, detail], themeWeights: d.commanders.length ? d.themeWeights : null }))}
                  data-testid="detail-command"
                >
                  Make commander
                </button>
              )}
            </>
          }
        />
      )}

      {exported && (
        <Overlay onClose={() => setExported(null)} label="Exported decklist">
          <div className="p-6" data-testid="export-dialog">
            <div className="flex items-start">
              <div>
                <h2 className="text-[1.4rem]">Decklist</h2>
                <p className="mt-1 text-ash" data-testid="export-status">
                  {exported.copied ? 'Copied to the clipboard. It pastes into Moxfield, Archidekt and most other deck sites.' : 'Select the text and copy it. The browser did not allow copying for you.'}
                </p>
              </div>
              <button type="button" className="btn btn-quiet btn-sm ml-auto" onClick={() => setExported(null)}>Close</button>
            </div>
            <textarea className="field mt-4 h-[26rem] w-full" readOnly value={exported.text} onFocus={(e) => e.currentTarget.select()} data-testid="export-text" />
          </div>
        </Overlay>
      )}
    </div>
  );
}

const removeAll = (deck: Deck, id: string): Deck => ({ ...deck, main: deck.main.filter((e) => e.oracleId !== id) });
