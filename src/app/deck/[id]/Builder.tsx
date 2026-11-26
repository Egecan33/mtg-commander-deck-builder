'use client';

import Link from 'next/link';
import { commanderHref } from '../../lib/links';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { packageMinimum } from '@/engine/format';
import { isPackageId, packageDef, pinPackage } from '@/engine/packages';
import type { Bracket, CardScore, Color, Deck, Fix, ImproveGoals, PackageId, Role, SwapProposal } from '@/engine/types';
import { CardDetail } from '../../components/CardDetail';
import { CardImage, ColorPip, Gauge, Overlay } from '../../components/card';
import { HeldMark, heldText, useFreeOnly } from '../../components/held';
import { Menu } from '../../components/Menu';
import { NetworkSummary } from '../../components/network/NetworkSummary';
import { NetworkView } from '../../components/network/NetworkView';
import { useNetwork } from '../../components/network/useNetwork';
import { ResultPanel, type Change } from '../../components/ResultPanel';
import { useCollections, useNotify, useProxies, useStatus } from '../../components/Shell';
import {
  ApiError, analyzeDeck, browseCards, buildDeck, exportDeck, getBoxes, getDeck, linkBox, loadEdhrec, moveDeck, takeFromBox, updateDeck,
  type AnalyzeResponse, type ArenaFormat, type BoxInfo, type CardLookup, type ClientCard, type CollectionInfo, type ConflictReport, type HeldBy, type RatingKey, type ScoredCard,
} from '../../lib/api';
import type { Format } from '@/engine/types';
import { setFilters, useFilters } from '../../lib/filters';
import {
  BRACKETS, COLOR_NAME, DEFAULT_QUERY, addCard, bracketName, brokenRules, deckCount, entryOf, errText, inDeck, isAbort, queryForFix, removeCard, swapCard, toggleLock,
  type BrowserQuery,
} from '../../lib/ui';
import { CraftSection, FormatChip, WildcardLine } from './ArenaParts';
import { Browser, type BrowserCard } from './Browser';
import { DeckView } from './DeckView';
import { PackagesPanel } from './PackagesPanel';
import {
  ADD_ONE, BoxMatchOffer, BracketPanel, GOAL_CHIPS, HeldSummary, ImprovePanel, PutItIn, RatingPanel, ThemesPanel, whyNotIn, type ImproveOptions, type PanelId, type ProposalSet,
} from './Panels';

const PANELS: { id: PanelId; label: string }[] = [
  { id: 'rating', label: 'Rating' },
  { id: 'packages', label: 'Packages' },
  { id: 'bracket', label: 'Bracket' },
  { id: 'themes', label: 'Themes' },
  { id: 'improve', label: 'Improve' },
  { id: 'network', label: 'Network' },
];
const WEAKEST = 5;
const NO_HELD: HeldBy = {};
const isBasicLand = (card: ClientCard): boolean => /\bBasic\b.*\bLand\b/.test(card.typeLine);

/**
 * What the panel above the deck shows after Fix deck, a per-part Fix or a "Put it in instead of" swap:
 * the deck before (for Undo) and the deck it applied (null: nothing changed).
 */
interface DeckResult {
  seq: number;
  kind: 'fix' | 'swap' | 'package';
  title: string;
  changes: Change[];
  ratingBefore: number;
  ratingAfter: number;
  note: string | null;
  heldBy: HeldBy;
  before: Deck;
  after: Deck | null;
  /** The message after Undo. */
  undone: string;
}

/** The deck's conflicts without one holder (a box just linked to this deck), matched by its id; cards it was the only holder of drop out. */
function withoutHolderId(report: ConflictReport, holderId: string): ConflictReport {
  const holder = report.byHolder.find((h) => h.holderId === holderId);
  if (!holder) return report;
  const cards = { ...report.cards };
  for (const oracleId of holder.oracleIds) {
    const names = [...(cards[oracleId] ?? [])];
    const i = names.indexOf(holder.name); // one entry per holder: a same-name box keeps its own
    if (i >= 0) names.splice(i, 1);
    if (names.length) cards[oracleId] = names;
    else delete cards[oracleId];
  }
  return { cards, byHolder: report.byHolder.filter((h) => h.holderId !== holderId) };
}

/** `map` without the holder `name` (a box just linked to this deck); cards it was the only holder of drop out. */
function withoutHolder(map: HeldBy, name: string): HeldBy {
  let changed = false;
  const next: HeldBy = {};
  for (const [oracleId, names] of Object.entries(map)) {
    const kept = names.filter((n) => n !== name);
    if (kept.length !== names.length) changed = true;
    if (kept.length) next[oracleId] = kept;
  }
  return changed ? next : map;
}

export function Builder({ id }: { id: string }) {
  const notify = useNotify();
  const { active: activeCollection, refresh: refreshCollections, collections, switchTo } = useCollections();
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
  const net = useNetwork(deck, panel === 'network');
  const [networkFocus, setNetworkFocus] = useState<number | null>(null);
  const networkNow = net.network;
  useEffect(() => setNetworkFocus(null), [networkNow]);
  const [query, setQuery] = useState<BrowserQuery>(DEFAULT_QUERY);
  /** The package the Packages page pointed at (`?panel=packages&package=<id>`). */
  const [highlight, setHighlight] = useState<PackageId | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('panel') === 'packages') setPanel('packages');
    const wanted = params.get('package');
    if (wanted && isPackageId(wanted)) setHighlight(wanted);
  }, []);
  const themePackages = useMemo(
    () => (analysis?.packages.packages ?? []).filter((p) => p.kind === 'theme').map((p) => ({ id: p.id, name: p.name })),
    [analysis],
  );
  const [detail, setDetail] = useState<string | null>(null);
  const [exported, setExported] = useState<{ text: string; copied: boolean; format: 'text' | 'arena'; notOnArena?: string[] | null } | null>(null);
  const [options, setOptions] = useState<ImproveOptions>({ bracket: 'keep', maxPrice: '', maxSwaps: '15', goals: [], lean: false, leanAxis: '' });
  const [proposals, setProposals] = useState<ProposalSet | null>(null);
  const [replacing, setReplacing] = useState<{ out: string; list: SwapProposal[] | null; error?: string; heldBy?: HeldBy } | null>(null);
  // The last Fix deck, per-part Fix or swap from the card detail, shown above the deck with one Undo.
  const [fixed, setFixed] = useState<DeckResult | null>(null);
  const fixSeq = useRef(0);
  // When a fix run ends, the focus goes back to the button that started it (it was disabled while the
  // run worked): the part's key, or 'deck' for Fix deck.
  const fixButton = useRef<HTMLButtonElement>(null);
  const refocusFix = useRef<string | null>(null);
  // "Put it in instead of" for the card in the detail: the deck cards it could replace (list null while loading).
  const [swapin, setSwapin] = useState<{ id: string; list: SwapProposal[] | null; heldBy: HeldBy; error?: string } | null>(null);
  // The card opened by the card search's "+" on a full deck: its detail scrolls to the suggestions.
  const [revealFor, setRevealFor] = useState<string | null>(null);
  const [freeOnlyPref, setFreeOnly] = useFreeOnly();
  const freeOnly = freeOnlyPref ?? false;
  // "!" of cards outside the deck, from where they were last seen (a browser result, a proposal).
  const [heldHints, setHeldHints] = useState<HeldBy>({});
  // Is a box of the active collection already linked to this deck (then no second box is offered).
  const [boxLinked, setBoxLinked] = useState<boolean | null>(null);
  // The active collection's boxes as last read (two boxes of one product share a holder name).
  const boxes = useRef<BoxInfo[]>([]);
  const [linking, setLinking] = useState(false);
  // `<holderId>|<oracleId>` while "I took it out" runs, until the analysis after it arrives.
  const [takingOut, setTakingOut] = useState<string | null>(null);
  const dirty = useRef(false);
  const saveSeq = useRef(0);
  // `built` as last saved: when a save changes it, the collections are read again.
  const savedBuilt = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // The deck's collection decides its format: an MTG Arena deck is a Brawl deck (Arena cards, wildcards).
  const deckCollection = collections.find((c) => c.id === (deck?.collectionId ?? activeCollection?.id)) ?? null;
  const otherCollection = collections.find((c) => c.id !== deckCollection?.id && c.kind !== deckCollection?.kind) ?? null;
  // The deck's own settings, not the last analysis: after a switch the old analysis still carries the old format.
  const format: Format = deckCollection ? (deckCollection.kind === 'arena' ? (deck?.arenaFormat ?? 'brawl') : 'commander') : analysis ? analysis.format : 'commander';
  const brawl = format !== 'commander';
  const std = format === 'standardbrawl';
  // Cards in a full deck: 60 in Standard Brawl, 100 otherwise.
  const DECK_SIZE = std ? 60 : 100;
  useEffect(() => {
    if (std) setPanel((p) => (p === 'bracket' ? 'rating' : p));
  }, [std]);
  const { craftOnly } = useFilters();
  const [moving, setMoving] = useState(false);
  // "Cards to craft" of a Brawl deck, shown above the deck sections.
  const [craftOpen, setCraftOpen] = useState(false);

  const learn = useCallback((cards: CardLookup | ClientCard[]) => {
    setLookup((cur) => {
      const next = { ...cur };
      for (const c of Array.isArray(cards) ? cards : Object.values(cards)) next[c.oracleId] = c;
      return next;
    });
  }, []);
  const networkCards = net.network?.cards;
  useEffect(() => { if (networkCards) learn(networkCards); }, [networkCards, learn]);

  // ---- load
  useEffect(() => {
    const ctrl = new AbortController();
    getDeck(id, ctrl.signal).then(
      (res) => {
        learn(res.cards);
        savedBuilt.current = res.deck.built === true;
        setDeck(res.deck);
        setSettled(res.deck);
        // Optional per-commander play data; answers 'off' at once unless switched on under Card data.
        if (res.deck.commanders.length && res.format !== 'standardbrawl') {
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

  // A deck of the other collection: that collection becomes the active one ("owned" follows the deck), once.
  const switched = useRef(false);
  const deckCollectionId = deck?.collectionId ?? null;
  useEffect(() => {
    if (switched.current || !deckCollectionId || !activeCollection || deckCollectionId === activeCollection.id) return;
    const target = collections.find((c) => c.id === deckCollectionId);
    if (!target) return;
    switched.current = true;
    void switchTo(target.id, `Switched to your ${target.name} collection: this deck belongs to it.`);
  }, [deckCollectionId, activeCollection, collections, switchTo]);

  // A deck that already is a box's deck gets no "This deck is my … box" offer.
  useEffect(() => {
    const ctrl = new AbortController();
    getBoxes(ctrl.signal).then(
      (res) => {
        boxes.current = res.boxes;
        setBoxLinked(res.boxes.some((b) => b.deckId === id));
      },
      (e) => {
        if (!isAbort(e)) setBoxLinked(false);
      },
    );
    return () => ctrl.abort();
  }, [id]);

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
        setTakingOut(null);
      },
      (e) => {
        if (isAbort(e)) return;
        setAnalysing(false);
        setTakingOut(null);
        notify.error(`Could not analyse the deck: ${errText(e)}`);
      },
    );
    return () => ctrl.abort();
  }, [settled, rev, learn, notify]);

  useEffect(() => {
    if (!settled || !dirty.current) return;
    const seq = ++saveSeq.current;
    setSaveState('saving');
    const builtChanged = (settled.built === true) !== savedBuilt.current;
    updateDeck(id, settled).then(
      () => {
        if (seq === saveSeq.current) setSaveState('saved');
        if (builtChanged) {
          savedBuilt.current = settled.built === true;
          // The collections' holder counts changed, and with them the "Use free copies only" default.
          void refreshCollections();
        }
      },
      (e) => {
        if (seq !== saveSeq.current) return;
        setSaveState('failed');
        notify.error(`The deck was not saved: ${errText(e)}`);
      },
    );
  }, [settled, id, notify, refreshCollections]);

  const mutate = useCallback((fn: (d: Deck) => Deck) => {
    dirty.current = true;
    setDeck((d) => (d ? fn(d) : d));
  }, []);
  // The deck as last rendered, for an action that must not apply over changes made while it ran.
  const deckRef = useRef<Deck | null>(null);
  useEffect(() => {
    deckRef.current = deck;
  }, [deck]);

  // ---- the card search column, shown or hidden (remembered for every deck). "Only my collection" is a
  // choice about the player, not about one deck: it is one of the shared filters, and both of its boxes
  // (the header's and the Improve tab's) read and write it there.
  const { ownedOnly, browser: browserShown } = useFilters();
  const setOwnedOnly = useCallback((on: boolean) => setFilters({ ownedOnly: on }), []);
  // "/" on a hidden card search shows it, then the search box takes the focus.
  const focusSearch = useRef(false);
  const showBrowser = useCallback(() => setFilters({ browser: true }), []);
  useEffect(() => {
    if (!browserShown || !focusSearch.current || !searchRef.current) return;
    focusSearch.current = false;
    searchRef.current.focus();
  }, [browserShown]);

  // ---- keyboard: "/" goes to search. Esc is handled by whichever overlay is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !(el && /INPUT|TEXTAREA|SELECT/.test(el.tagName))) {
        e.preventDefault();
        if (!searchRef.current) {
          focusSearch.current = true;
          showBrowser();
          return;
        }
        searchRef.current.focus();
        searchRef.current.select();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showBrowser]);

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
    (card: BrowserCard | string) => {
      setRevealFor(null);
      if (typeof card !== 'string') {
        learn([card]);
        setHints((h) => ({ ...h, [card.oracleId]: card.score }));
        setHeldHints((h) => {
          if (!card.held && !h[card.oracleId]) return h;
          const next = { ...h };
          if (card.held) next[card.oracleId] = card.held;
          else delete next[card.oracleId];
          return next;
        });
        setDetail(card.oracleId);
      } else setDetail(card);
    },
    [learn],
  );
  /** Remembers the "!" of proposed incoming cards, for the card detail. */
  const learnHeld = useCallback((ids: string[], heldBy: HeldBy) => {
    setHeldHints((h) => {
      const next = { ...h };
      for (const oracleId of ids) {
        if (heldBy[oracleId]) next[oracleId] = heldBy[oracleId];
        else delete next[oracleId];
      }
      return next;
    });
  }, []);

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
  // The card options every build mode gets: only my collection, free copies only, the price limit.
  const cardOpts = useMemo(() => {
    const price = Number(options.maxPrice);
    return {
      ownedOnly: ownedOnly || undefined,
      freeOnly: (ownedOnly && freeOnly) || undefined,
      // A Brawl deck's budget is its wildcards ("Only what I can craft"), not dollars.
      maxPriceUsd: !brawl && options.maxPrice.trim() && Number.isFinite(price) && price > 0 ? price : null,
      craftableOnly: brawl ? craftOnly : undefined,
    };
  }, [ownedOnly, options.maxPrice, freeOnly, brawl, craftOnly]);
  const buildOpts = () => cardOpts;

  // ---- "Put it in instead of" for the card in the detail: a card not in the deck, or one more basic land
  const swapWhy = detail && detailCard
    ? whyNotIn(detailCard, {
        gate: detailScore?.gate?.message ?? null,
        basic: isBasicLand(detailCard),
        ownedOnly: !!cardOpts.ownedOnly,
        freeOnly: !!cardOpts.freeOnly,
        maxPriceUsd: cardOpts.maxPriceUsd,
        held: heldHints[detail],
      })
    : null;
  // The card to ask about; null when the card options already rule it out (the detail says why) or it does not apply.
  const swapinId =
    detail && detailCard && settled && settled.commanders.length > 0 && !settled.commanders.includes(detail) && settled.companion !== detail &&
    (!entryOf(settled, detail) || isBasicLand(detailCard)) && !swapWhy
      ? detail
      : null;
  useEffect(() => {
    if (!swapinId || !settled) {
      setSwapin(null);
      return;
    }
    const ctrl = new AbortController();
    setSwapin({ id: swapinId, list: null, heldBy: {} });
    // Under a full deck the plain add comes first, so one more is asked for to keep five swaps.
    buildDeck(settled, 'swapin', { ...cardOpts, in: swapinId, count: deckCount(settled) < DECK_SIZE ? 6 : 5 }, ctrl.signal).then(
      (res) => {
        learn(res.cards);
        if (res.proposals.length > 0) learnHeld([swapinId], res.heldBy);
        setSwapin({ id: swapinId, list: res.proposals, heldBy: res.heldBy });
      },
      (e) => {
        if (!isAbort(e)) setSwapin({ id: swapinId, list: [], heldBy: {}, error: errText(e) });
      },
    );
    return () => ctrl.abort();
  }, [swapinId, settled, cardOpts, learn, learnHeld]);

  // The card search's "+": on a full deck it opens the card with the deck cards it could replace instead of adding a 101st card.
  const addFromBrowser = useCallback(
    (card: BrowserCard) => {
      const d = deckRef.current;
      if (d && deckCount(d) >= DECK_SIZE) {
        openCard(card);
        setRevealFor(card.oracleId);
        return;
      }
      add(card);
    },
    [add, openCard],
  );
  const closeDetail = useCallback(() => {
    setDetail(null);
    setRevealFor(null);
  }, []);
  const rebuild = async (mode: 'auto' | 'fill', label: string, seed?: number) => {
    if (!deck) return;
    const before = deck;
    setBusy(label);
    try {
      const res = await buildDeck(before, mode, { ...buildOpts(), seed });
      learn(res.cards);
      if (deckRef.current !== before) {
        notify.info(`The deck changed while ${label.toLowerCase()} was working, so nothing was applied. Try again.`);
        return;
      }
      setProposals(null);
      mutate((d) => {
        // A rebuild changes the cards, never whether the deck is built.
        const next: Deck = { ...res.deck, id: d.id, name: d.name };
        if (d.built) next.built = true;
        else delete next.built;
        return next;
      });
      notify.info(mode === 'fill' ? `Filled the deck to ${DECK_SIZE} cards` : `Built a new ${DECK_SIZE}-card deck. Locked cards were kept.`);
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(null);
    }
  };
  /**
   * Fix deck (or, with `only`, one part of the rating): the engine makes the deck legal and complete and
   * works on what the rating lists, with the same card options as Improve. The result goes through the
   * normal save, and the panel above the deck lists every change with one Undo.
   */
  const runFix = async (only?: RatingKey) => {
    if (!deck) return;
    const before = deck;
    // "card quality" in "Fixed card quality: 3 changes".
    const part = only ? (analysis?.rating.subscores.find((s) => s.key === only)?.label ?? only).toLowerCase() : null;
    setBusy(only ? `fix:${only}` : 'fix');
    try {
      const res = await buildDeck(before, 'fix', { ...buildOpts(), ...(only ? { only } : {}) });
      learn(res.cards);
      if (deckRef.current !== before) {
        notify.info(`The deck changed while ${part ? 'the fix' : 'Fix deck'} was working, so nothing was applied. Press ${part ? 'Fix' : 'Fix deck'} again.`);
        return;
      }
      let after: Deck | null = null;
      if (res.changes.length > 0) {
        // Fix deck changes the cards, never the deck's name or whether it is built.
        const next: Deck = { ...res.deck, id: before.id, name: before.name };
        if (before.built) next.built = true;
        else delete next.built;
        after = next;
        mutate(() => next);
        setProposals(null);
      }
      const n = res.changes.length;
      setFixed({
        seq: ++fixSeq.current,
        kind: 'fix',
        title: after ? `Fixed${part ? ` ${part}` : ''}: ${n} ${n === 1 ? 'change' : 'changes'}` : part ? `Fixing ${part} changed nothing` : 'Fix deck changed nothing',
        changes: res.changes,
        ratingBefore: res.ratingBefore,
        ratingAfter: res.ratingAfter,
        note: res.note,
        heldBy: res.heldBy,
        before,
        after,
        undone: part ? 'Undone. The deck is back as it was before the fix.' : 'Undone. The deck is back as it was before Fix deck.',
      });
    } catch (e) {
      notify.error(e);
    } finally {
      refocusFix.current = only ?? 'deck';
      setBusy(null);
    }
  };
  useEffect(() => {
    if (busy || !refocusFix.current) return;
    const part = refocusFix.current;
    refocusFix.current = null;
    const target = (part === 'deck' ? null : document.querySelector<HTMLButtonElement>(`[data-testid="fix-part"][data-part="${part}"]`)) ?? fixButton.current;
    // Only when the run left the focus nowhere (its button was disabled while it worked): never take it
    // from where the user has moved on to.
    const el = document.activeElement;
    if (el && el !== document.body && el !== target) return;
    target?.focus({ preventScroll: true });
  }, [busy]);
  /**
   * Complete package (and Add a package, which first pins the package at its minimum, 8 or 5 in Standard Brawl): the same panel and Undo as
   * Fix deck. The deck before is what Undo restores, so an added package's pin goes with it.
   */
  const runPackage = async (id: PackageId, add: boolean) => {
    if (!deck || !analysis) return;
    const before = deck;
    const name = analysis.packages.packages.find((p) => p.id === id)?.name ?? analysis.packages.offers.find((o) => o.id === id)?.name ?? packageDef(id)?.name ?? 'the package';
    const start = add ? pinPackage(before, analysis.packages, analysis.targets, id, packageMinimum(format)) : before;
    setBusy(`package:${id}`);
    try {
      const res = await buildDeck(start, 'package', { ...buildOpts(), package: id });
      learn(res.cards);
      if (deckRef.current !== before) {
        notify.info('The deck changed while the package was being completed, so nothing was applied. Try again.');
        return;
      }
      const n = res.changes.filter((c) => c.in !== '').length;
      let after: Deck | null = null;
      if (res.changes.length > 0 || add) {
        const next: Deck = { ...res.deck, id: before.id, name: before.name };
        if (before.built) next.built = true;
        else delete next.built;
        after = next;
        mutate(() => next);
        setProposals(null);
      }
      setFixed({
        seq: ++fixSeq.current,
        kind: 'package',
        title: n > 0 ? `Completed ${name}: added ${n}` : `${name}: nothing added`,
        changes: res.changes,
        ratingBefore: res.ratingBefore,
        ratingAfter: res.ratingAfter,
        note: res.note,
        heldBy: res.heldBy,
        before,
        after,
        undone: 'Undone. The deck is back as it was before Complete package.',
      });
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(null);
    }
  };
  /** Puts back the deck exactly as it was before the fix or swap; offered only while the deck it made is unchanged. */
  const undoResult = () => {
    if (!fixed?.after || deck !== fixed.after) return;
    const before = fixed.before;
    mutate(() => before);
    setFixed(null);
    if (fixed.kind === 'fix') fixButton.current?.focus({ preventScroll: true });
    notify.info(fixed.undone);
  };
  /**
   * "Put it in instead of": takes the proposal's card out and puts the detail's card in through the
   * normal save, closes the detail and shows "Put in X, took out Y" with Undo above the deck. The
   * plain-add proposal (`out` '', "Add without cutting") only puts it in: "Put in X".
   */
  const putIn = (p: SwapProposal) => {
    const before = deckRef.current;
    if (!before) return;
    const inName = lookup[p.in]?.name ?? 'the card';
    const outName = lookup[p.out]?.name ?? 'the card';
    if (p.out !== '' && !entryOf(before, p.out)) {
      notify.info(`${outName} is no longer in the deck, so nothing was swapped.`);
      return;
    }
    const after = p.out === '' ? addCard(before, p.in) : swapCard(before, p.out, p.in);
    mutate(() => after);
    setDetail(null);
    setRevealFor(null);
    setFixed({
      seq: ++fixSeq.current,
      kind: 'swap',
      title: p.out === '' ? `Put in ${inName}` : `Put in ${inName}, took out ${outName}`,
      changes: [{ out: p.out, in: p.in, reason: p.reason }],
      ratingBefore: p.ratingBefore,
      ratingAfter: p.ratingAfter,
      note: p.agrees === false && p.objection ? `The engine advised against it: ${p.objection}` : null,
      heldBy: swapin?.id === p.in ? swapin.heldBy : {},
      before,
      after,
      undone: p.out === '' ? `Undone. ${inName} is out again.` : `Undone. ${outName} is back in place of ${inName}.`,
    });
  };
  // A new result panel scrolls into view at the top of the deck.
  const revealResult = useCallback((el: HTMLDivElement | null) => {
    el?.scrollIntoView({ block: 'nearest' });
  }, []);
  const propose = async (kind: 'improve' | 'swaps') => {
    if (!deck) return;
    setBusy(kind);
    setPanel('improve');
    // Standard Brawl has no brackets: a power setting left over from an earlier Brawl deck must not steer it.
    const bracket = std || options.bracket === 'keep' ? deck.targetBracket : options.bracket;
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
      learnHeld(res.proposals.map((p) => p.in), res.heldBy);
      setProposals({ kind, bracket, items: res.proposals, asked: false, heldBy: res.heldBy });
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
      learnHeld(res.proposals.map((p) => p.in), res.heldBy);
      setProposals({ kind: 'add', bracket: deck.targetBracket, items: res.proposals, asked: false, noun: ADD_ONE.find((a) => a.role === role)?.noun, heldBy: res.heldBy });
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(null);
    }
  };
  const suggestFor = async (out: string) => {
    if (!deck) return;
    setDetail(null);
    setReplacing({ out, list: null });
    try {
      const res = await buildDeck(deck, 'replace', { ...buildOpts(), out, seed: 1 });
      learn(res.cards);
      learnHeld(res.proposals.map((p) => p.in), res.heldBy);
      setReplacing({ out, list: res.proposals, heldBy: res.heldBy });
    } catch (e) {
      setReplacing({ out, list: [], error: errText(e) });
    }
  };
  const proxyCards = (ids: string[], what?: string) => void proxies.add(ids.map((oracleId) => ({ oracleId, qty: 1 })), what);
  /** The deck's cards for the proxy list: the ones not in the collection, or all of them. Basic lands are left out. */
  const proxyDeck = (all: boolean) => {
    if (!deck) return;
    const wanted = [...deck.commanders.map((oracleId) => ({ oracleId, qty: 1 })), ...deck.main.map((e) => ({ oracleId: e.oracleId, qty: e.qty }))].filter((i) => {
      const card = lookup[i.oracleId];
      return card && !isBasicLand(card) && (all || !card.owned);
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
  // "Move to MTG Arena / Physical": only the deck's collection changes, then that collection becomes the active one.
  const moveTo = async (to: CollectionInfo) => {
    if (!deck) return;
    setMoving(true);
    try {
      await moveDeck(id, deck, to.id);
      dirty.current = false;
      switched.current = true;
      await switchTo(to.id, `Moved to your ${to.name} collection: it is now checked as a ${to.kind === 'arena' ? (deck.arenaFormat === 'standardbrawl' ? 'Standard Brawl' : 'Brawl') : 'Commander'} deck.`);
    } catch (e) {
      notify.error(e);
    } finally {
      setMoving(false);
    }
  };

  // "Switch to Brawl / Standard Brawl": only the deck's arenaFormat changes; it is then checked again under the other rules.
  const switchFormat = (to: ArenaFormat) => {
    if (!deck || to === (deck.arenaFormat ?? 'brawl')) return;
    const full = to === 'standardbrawl' ? 60 : 100;
    const total = deckCount(deck);
    // What was suggested or fixed under the old rules may not be legal under the new ones.
    setProposals(null);
    setReplacing(null);
    setFixed(null);
    mutate((d) => {
      const { arenaFormat: _drop, ...rest } = d;
      void _drop;
      return to === 'standardbrawl' ? { ...rest, arenaFormat: 'standardbrawl' } : rest;
    });
    const where = to === 'standardbrawl' ? 'Standard Brawl' : 'Brawl';
    notify.info(
      total > full
        ? `Switched to ${where}: ${total - full} cards over the limit; Fix deck can cut them.`
        : total < full
          ? `Switched to ${where}: ${full - total} cards short; Build can fill them.`
          : `Switched to ${where}: the deck is checked under its rules.`,
    );
  };

  // Built: the cards are really in this deck, so other decks see them as taken. Never changes the cards.
  const toggleBuilt = () => {
    if (!deck) return;
    const on = !deck.built;
    mutate((d) => {
      const next = { ...d };
      if (on) next.built = true;
      else delete next.built;
      return next;
    });
    notify.info(on ? 'Marked as built. Other decks now show a “!” on the cards this deck holds.' : 'No longer built. Its cards count as free copies again.');
  };
  const linkMatch = async () => {
    const match = analysis?.boxMatch;
    if (!match || linking) return;
    setLinking(true);
    try {
      await linkBox(match.boxId, id);
      setBoxLinked(true);
      boxes.current = boxes.current.map((b) => (b.id === match.boxId ? { ...b, deckId: id } : b));
      // That box no longer counts against this deck: drop it from the "!" already on screen, then analyse again.
      // The summary knows holders by id. The "!" of other cards only carry names, and another box of
      // the same product still counts here, so its name stays until those cards are seen again.
      setAnalysis((a) => (a ? { ...a, conflicts: withoutHolderId(a.conflicts, `box:${match.boxId}`) } : a));
      const gone = `${match.name} box`;
      const twin = boxes.current.some((b) => b.id !== match.boxId && `${b.name} box` === gone && b.sealed > 0 && b.deckId !== id);
      if (!twin) {
        setHeldHints((h) => withoutHolder(h, gone));
        setProposals((p) => (p ? { ...p, heldBy: withoutHolder(p.heldBy, gone) } : p));
        setReplacing((r) => (r?.heldBy ? { ...r, heldBy: withoutHolder(r.heldBy, gone) } : r));
      }
      setRev((n) => n + 1);
      notify.info(`This deck is now your ${match.name} box. Cards still sealed in it no longer count as taken here.`, { label: 'Undo', run: () => void unlinkMatch(match) });
    } catch (e) {
      notify.error(e);
    } finally {
      setLinking(false);
    }
  };
  const unlinkMatch = async (match: { boxId: string; name: string }) => {
    try {
      await linkBox(match.boxId, null);
      setBoxLinked(false);
      setRev((n) => n + 1);
      notify.info(`Unlinked. This deck shows a “!” for the ${match.name} box again.`);
    } catch (e) {
      notify.error(e);
    }
  };
  // "I took it out": one copy leaves the box and stays in the collection, so it is free for this deck.
  const takeOut = async (holderId: string, oracleId: string) => {
    const holder = analysis?.conflicts.byHolder.find((h) => h.holderId === holderId);
    if (!holder || holder.kind !== 'box' || takingOut) return;
    setTakingOut(`${holderId}|${oracleId}`);
    try {
      await takeFromBox(holderId.slice('box:'.length), oracleId, 1);
      // `takingOut` is cleared when the analysis after this arrives, so a second click cannot take another copy meanwhile.
      setRev((n) => n + 1);
      notify.info(`Took ${lookup[oracleId]?.name ?? 'the card'} out of the ${holder.name}. That copy is free now.`);
    } catch (e) {
      setTakingOut(null);
      notify.error(e);
    }
  };

  const doExport = async (format: 'text' | 'arena' = 'text') => {
    if (!deck) return;
    setBusy('export');
    try {
      const { text, notOnArena } = await exportDeck(deck, format);
      let copied = false;
      try {
        await navigator.clipboard.writeText(text);
        copied = true;
      } catch {
        // clipboard permission denied: the text is shown for a manual copy
      }
      setExported({ text, copied, format, notOnArena });
    } catch (e) {
      notify.error(e);
    } finally {
      setBusy(null);
    }
  };
  const applyFix = (fix: Fix) => {
    const next = queryForFix(fix);
    if (!next) return;
    setQuery(next);
    showBrowser();
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
  const broken = rating ? brokenRules(rating, count, DECK_SIZE) : [];
  const needsColor = rating?.violations.some((v) => v.code === 'needs-color') || deck.chosenColor !== null;
  const detailEntry = detail ? entryOf(deck, detail) : undefined;
  const detailIsCommander = !!detail && deck.commanders.includes(detail);
  const held = analysis?.conflicts.cards ?? NO_HELD;
  const showCombos = () =>
    document.getElementById('deck-combos')?.scrollIntoView({ block: 'start', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  // In the deck: the deck's own conflicts. Outside it: what the browser or a proposal said about adding it.
  const detailHeld = detail ? (inDeck(deck, detail) ? held[detail] : heldHints[detail]) : undefined;
  // Boxes holding the copy this deck card needs: "I took it out of the … box".
  const detailBoxes = detail && inDeck(deck, detail) ? (analysis?.conflicts.byHolder ?? []).filter((h) => h.kind === 'box' && h.oracleIds.includes(detail)) : [];
  const manual = activeCollection?.kind === 'manual';
  const offer = analysis?.boxMatch && boxLinked === false ? analysis.boxMatch : null;
  const takes = analysis && analysis.conflicts.byHolder.length > 0;
  const crafts = craftOpen && analysis?.arena && analysis.arena.toCraft.length > 0 ? analysis.arena : null;
  const notice = takes || offer || crafts ? (
    <>
      {crafts && <CraftSection report={crafts} lookup={lookup} onOpen={openCard} onClose={() => setCraftOpen(false)} />}
      {takes && (
        <HeldSummary
          conflicts={analysis.conflicts}
          lookup={lookup}
          onOpen={openCard}
          takingOut={takingOut}
          onTakeOut={(holderId, oracleId) => void takeOut(holderId, oracleId)}
          built={!!deck.built}
        />
      )}
      {offer && <BoxMatchOffer name={offer.name} busy={linking} onLink={() => void linkMatch()} />}
    </>
  ) : null;
  const canCommand = !!detailCard && /Legendary|can be your commander/i.test(detailCard.typeLine) && deck.commanders.length < 2 && !detailIsCommander;
  const noCommander = deck.commanders.length === 0;
  // Fix deck's number: the rating's fixes Fix deck can act on (not advice such as "Plays like Bracket 2"),
  // plus every rule the deck breaks.
  const problems = rating ? rating.subscores.reduce((n, s) => n + s.fixes.filter((f) => f.actionable).length, 0) + rating.violations.length : 0;
  const fixTitle = !rating
    ? 'Reading the deck'
    : noCommander
      ? 'Choose a commander first'
      : problems === 0
        ? 'Nothing to fix'
        : `Make the deck legal and ${DECK_SIZE} cards, then work on the ${problems} ${problems === 1 ? 'problem' : 'problems'} from the rating that Fix deck can act on. Uses Only my collection, Use free copies only and the price cap set under Improve; Undo puts the deck back.`;
  const fixResult = fixed ? (
    <div key={fixed.seq} ref={revealResult} className="mb-3 mt-2">
      <ResultPanel
        title={fixed.title}
        before={fixed.after ? fixed.ratingBefore : undefined}
        after={fixed.after ? fixed.ratingAfter : undefined}
        changes={fixed.changes}
        lookup={lookup}
        heldBy={fixed.heldBy}
        note={
          [fixed.note, fixed.after && deck !== fixed.after ? `The deck changed after ${fixed.kind === 'package' ? 'Complete package' : `the ${fixed.kind}`}, so it can no longer be undone in one step.` : null].filter(Boolean).join(' ') || null
        }
        onUndo={fixed.after && deck === fixed.after ? undoResult : undefined}
        onDismiss={() => {
          setFixed(null);
          if (fixed.kind === 'fix') fixButton.current?.focus({ preventScroll: true });
        }}
        testId={fixed.kind === 'swap' ? 'swap-panel' : 'fix-panel'}
      />
    </div>
  ) : null;
  // The detail offers "Put it in instead of" for a card not in the deck (or one more basic land) once the deck has a commander.
  const swapHere = !!detail && !!detailCard && !detailIsCommander && deck.commanders.length > 0 && deck.companion !== detail && (!detailEntry || isBasicLand(detailCard));

  return (
    <div className="flex h-full flex-col" data-testid="builder">
      <header className="flex shrink-0 items-center gap-4 border-b border-slag bg-anvil px-4 py-2.5">
        <div className="flex shrink-0 gap-1.5">
          {deck.commanders.length === 0 && (
            <div className="flex h-[5.4rem] w-[9rem] items-center rounded-md border border-dashed border-smoke px-2 text-[0.8rem] text-ash">
              No commander. Open a legendary creature and choose “Make commander”.
            </div>
          )}
          {deck.commanders.map((c) => {
            const first = lookup[deck.commanders[0]];
            const second = deck.commanders.length === 2 ? lookup[deck.commanders[1]] : undefined;
            const self = lookup[c];
            const href = self ? first && second ? commanderHref(first, second, deck.chosenColor) : commanderHref(self, undefined, deck.chosenColor) : null;
            const image = <CardImage id={c} name={self?.name ?? 'Commander'} known={!!self} />;
            return href ? (
              <Link key={c} href={href} className="card block w-[3.9rem]" title="Open the commander page" aria-label={`Open the commander page for ${self?.name ?? 'the commander'}`} data-testid="commander-thumb">
                {image}
              </Link>
            ) : (
              <button key={c} type="button" className="card w-[3.9rem] cursor-zoom-in" onClick={() => setDetail(c)} aria-label="Details for commander" data-testid="commander-thumb">{image}</button>
            );
          })}
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
            <span className={`chip ${count === DECK_SIZE ? 'text-bone' : 'border-band-mid text-band-mid'}`} data-testid="deck-count">{count} / {DECK_SIZE}</span>
            <FormatChip format={format} collection={deckCollection} other={otherCollection} busy={moving || !!busy} onMove={(to) => void moveTo(to)} onSwitch={switchFormat} standardBrawlCards={status?.counts.standardBrawl} />
            {manual && (
              <button
                type="button"
                className={`chip ${deck.built ? 'border-brass text-bone' : 'hover:text-bone'}`}
                aria-pressed={!!deck.built}
                title="The cards are really in this deck"
                onClick={toggleBuilt}
                data-testid="deck-built"
              >
                <span aria-hidden className={`h-2.5 w-2.5 rounded-[2px] border ${deck.built ? 'border-brass bg-brass' : 'border-smoke'}`} />
                Built
              </button>
            )}
            {rating && (
              <button
                type="button"
                className={`chip ${rating.legal ? 'border-band-top text-band-top' : broken.length ? 'border-band-low text-band-low' : ''}`}
                title={rating.legal ? `Follows every ${std ? 'MTG Arena Standard Brawl' : brawl ? 'MTG Arena Brawl' : 'Commander'} deck-building rule` : rating.violations.map((v) => v.message).join('\n')}
                onClick={() => setPanel('rating')}
                data-testid="legality"
              >
                {rating.legal ? 'Legal' : broken.length ? `Not legal (${broken.length})` : 'Not finished'}
              </button>
            )}
            {analysis && (
              <>
                {!std && (
                  <button type="button" className="chip hover:text-bone" onClick={() => setPanel('bracket')} title="The lowest bracket the hard rules allow for this list" data-testid="chip-floor">
                    Minimum bracket {analysis.bracket.floor}
                  </button>
                )}
                {!std && (
                  <button type="button" className={`chip hover:text-bone ${analysis.bracket.playsLike !== deck.targetBracket ? 'border-band-good text-band-good' : ''}`} onClick={() => setPanel('bracket')} data-testid="chip-plays-like">
                    Plays like {analysis.bracket.playsLike}
                  </button>
                )}
                {!std && analysis.bracket.violationsOfTarget.length > 0 && (
                  <button type="button" className="chip border-band-low text-band-low" onClick={() => setPanel('bracket')} title="Cards or combos in the deck that the target bracket does not allow" data-testid="chip-over-bracket">
                    Over Bracket {deck.targetBracket} ({analysis.bracket.violationsOfTarget.length})
                  </button>
                )}
                {analysis.unknown.length > 0 && <span className="chip border-band-low text-band-low">{analysis.unknown.length} unknown</span>}
                {analysis.edhrec !== 'ready' && (
                  <span className="text-[0.75rem] text-smoke" title={std ? 'EDHREC has no data for Standard Brawl.' : 'EDHREC play data is off or not available. It can be switched on under Card data.'}>Scored from card text and tags</span>
                )}
              </>
            )}
            <span className="ml-1 text-[0.75rem] text-smoke" data-testid="save-state" aria-live="polite">
              {saveState === 'saving' || deck !== settled ? 'Saving' : saveState === 'failed' ? 'Not saved' : dirty.current ? 'Saved' : ''}
            </span>
          </div>
          {analysis?.arena && <WildcardLine report={analysis.arena} open={craftOpen} onToggle={() => setCraftOpen((o) => !o)} />}
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

        {!std && (
        <div className="shrink-0">
          <div className="mb-1 text-[0.75rem] text-ash" title={brawl ? 'MTG Arena has no brackets; the builder uses them as its power setting' : undefined} data-testid="bracket-label">
            {brawl ? `Power level, Commander brackets; Arena ignores this: ${bracketName(deck.targetBracket)}` : `Target bracket: ${bracketName(deck.targetBracket)}`}
          </div>
          <div className="seg" role="group" aria-label="Target bracket">
            {BRACKETS.map((b) => (
              <button key={b.n} type="button" aria-pressed={deck.targetBracket === b.n} title={`${b.name}. ${b.blurb}`} onClick={() => mutate((d) => ({ ...d, targetBracket: b.n as Bracket }))} data-testid={`target-${b.n}`}>
                {b.n}
              </button>
            ))}
          </div>
        </div>
        )}

        <button type="button" className={`shrink-0 rounded-md px-1 ${analysing ? 'opacity-70' : ''}`} onClick={() => setPanel('rating')} title="Open the rating" data-testid="header-gauge">
          {rating ? <Gauge value={rating.rating} partial={!rating.complete} legal={broken.length === 0} size={112} /> : <div className="skeleton h-[4.3rem] w-28 rounded-md" />}
        </button>

        <div className="grid shrink-0 gap-2" data-testid="deck-actions">
          <div className="flex items-center gap-1.5">
            <button
              ref={fixButton}
              type="button"
              className="btn btn-sm btn-primary"
              disabled={!!busy || !rating || problems === 0 || noCommander}
              onClick={() => void runFix()}
              title={fixTitle}
              data-testid="fix-deck"
              data-problems={rating ? problems : undefined}
            >
              {busy === 'fix' ? 'Fixing' : problems > 0 ? `Fix deck · ${problems}` : 'Fix deck'}
            </button>
            <Menu
              label={busy === 'auto' ? 'Building' : busy === 'fill' ? 'Filling' : busy === 'reroll' ? 'Rolling' : 'Build'}
              testId="menu-build"
              title="Build the deck: a new auto-build, fill the empty slots, or reroll"
              items={[
                {
                  label: 'Auto-build',
                  description: `A new ${DECK_SIZE}-card deck around the commander. Locked cards stay.`,
                  onSelect: () => void rebuild('auto', 'auto', 1),
                  disabled: !!busy || noCommander,
                  title: noCommander ? 'Choose a commander first' : undefined,
                  testId: 'auto-build',
                },
                {
                  label: 'Fill the rest',
                  description: 'Keeps every card and adds the best ones for the empty slots.',
                  onSelect: () => void rebuild('fill', 'fill'),
                  disabled: !!busy || noCommander || count >= DECK_SIZE,
                  title: noCommander ? 'Choose a commander first' : count >= DECK_SIZE ? `The deck already has ${DECK_SIZE} cards` : undefined,
                  testId: 'fill',
                },
                {
                  label: 'Reroll',
                  description: 'Builds again with other picks among near-equal cards. Locked cards stay.',
                  onSelect: () => void rebuild('auto', 'reroll', 2 + Math.floor(Math.random() * 1_000_000)),
                  disabled: !!busy || noCommander,
                  title: noCommander ? 'Choose a commander first' : undefined,
                  testId: 'reroll',
                },
              ]}
            />
            <button type="button" className="btn btn-sm" onClick={() => setPanel('improve')} title="Open the Improve tab: find improvements, suggest swaps, add one card" data-testid="improve">
              Improve
            </button>
            <Menu
              label="Export"
              testId="menu-export"
              align="right"
              title="Copy the deck list for a deck site or for MTG Arena"
              items={[
                {
                  label: 'Copy deck list',
                  description: 'Plain text for Moxfield, Archidekt and most deck sites.',
                  onSelect: () => void doExport('text'),
                  disabled: !!busy,
                  testId: 'export',
                },
                {
                  label: 'Copy for Arena',
                  description: 'In the form MTG Arena imports: in Arena open Decks, Import.',
                  onSelect: () => void doExport('arena'),
                  disabled: !!busy,
                  testId: 'export-arena',
                },
              ]}
            />
          </div>
          <div className="flex min-w-0 items-center gap-3 text-[13px] leading-tight text-ash">
            <label
              className="flex min-w-0 cursor-pointer items-center gap-1.5"
              title="Fix deck, Build, Improve, Suggest swaps, add-one and replace-a-card then only use cards from the collection picked in the top bar. Basic lands are always allowed."
            >
              <input type="checkbox" checked={ownedOnly} onChange={(e) => setOwnedOnly(e.target.checked)} data-testid="owned-only" />
              <span className="max-w-[15rem] truncate">Only my {activeCollection ? `${activeCollection.name} ` : ''}collection{activeCollection ? ` (${activeCollection.count.toLocaleString('en-US')})` : ''}</span>
            </label>
            {brawl && (
              <label
                className={`flex items-center gap-1.5 ${ownedOnly ? 'text-smoke' : 'cursor-pointer'}`}
                title="Builds and suggestions keep the cards you do not own within your MTG Arena wildcards, per rarity (set them on the Collection page). Off: the whole Arena pool."
              >
                <input type="checkbox" checked={craftOnly} disabled={ownedOnly} onChange={(e) => setFilters({ craftOnly: e.target.checked })} data-testid="craft-only" />
                <span className="truncate">Only what I can craft</span>
              </label>
            )}
            {manual && (
              <label
                className={`flex shrink-0 items-center gap-1.5 ${ownedOnly ? 'cursor-pointer' : 'text-smoke'}`}
                title={ownedOnly ? 'Fix deck, builds and suggestions leave out copies sealed in a box or in another built deck' : 'Tick “Only my collection” first'}
              >
                <input type="checkbox" checked={freeOnly} disabled={!ownedOnly} onChange={(e) => setFreeOnly(e.target.checked)} data-testid="free-only" />
                <span>Use free copies only</span>
              </label>
            )}
          </div>
        </div>
      </header>

      <div
        className={`grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)] ${browserShown && panel !== 'network' ? 'grid-cols-[27rem_minmax(0,1fr)_22.5rem]' : 'grid-cols-[minmax(0,1fr)_22.5rem]'}`}
        data-browser={browserShown ? 'shown' : 'hidden'}
      >
        {browserShown && panel !== 'network' && (
          <Browser
            deck={deck}
            settled={settled}
            rev={rev}
            query={query}
            setQuery={setQuery}
            extraAxes={analysis ? Object.keys(analysis.themeWeights) : []}
            themePackages={themePackages}
            held={held}
            onAdd={addFromBrowser}
            onRemove={remove}
            onOpen={openCard}
            searchRef={searchRef}
            onHide={() => setFilters({ browser: false })}
            brawl={brawl}
            size={DECK_SIZE}
          />
        )}
        {panel === 'network' && (
          <div className="min-h-0 min-w-0 overflow-y-auto p-4" data-testid="network-area">
            {fixResult}
            <NetworkView
              network={net.network}
              error={net.error}
              focusCluster={networkFocus}
              onOpen={openCard}
              onRetry={net.reload}
              onEmpty={() => setPanel('rating')}
            />
          </div>
        )}
        {panel !== 'network' && <DeckView
          lead={
            browserShown ? undefined : (
              <button type="button" className="btn btn-sm" onClick={showBrowser} title="Show the card search beside the deck (or press /)" data-testid="browser-show">
                Show card search
              </button>
            )
          }
          deck={deck}
          lookup={lookup}
          scoreOf={scoreOf}
          weakest={weakest}
          held={held}
          notice={notice}
          result={fixResult}
          combos={analysis?.bracket.combos ?? null}
          packages={analysis?.packages.packages ?? null}
          comboHeld={heldHints}
          onPutIn={openCard}
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
        />}
        <aside className="flex min-h-0 flex-col border-l border-slag bg-anvil" aria-label="Deck analysis">
          <div className="flex shrink-0 flex-wrap border-b border-slag" role="tablist">
            {PANELS.filter((p) => !(std && p.id === 'bracket')).map((p) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={panel === p.id}
                className={`display flex-auto whitespace-nowrap border-b-2 px-1 py-2.5 text-[0.82rem] ${panel === p.id ? 'border-brass text-bone' : 'border-transparent text-ash hover:text-bone'}`}
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
                onFixPart={(key) => void runFix(key)}
                onOpen={openCard}
                onAddOne={(role) => void addOne(role)}
                onWanted={(role, n) => mutate((d) => {
                  // Ramp, Card draw and Removal are core packages: pinned exactly as the Packages tab pins them.
                  const core = role === 'ramp' ? 'ramp' : role === 'draw' ? 'draw' : role === 'spot-removal' ? 'removal' : null;
                  if (core) return pinPackage(d, analysis.packages, analysis.targets, core, n);
                  const next = { ...(d.roleTargets ?? {}) };
                  if (n === null) delete next[role];
                  else next[role] = n;
                  return { ...d, roleTargets: Object.keys(next).length > 0 ? next : null };
                })}
              />
            ) : panel === 'packages' ? (
              <PackagesPanel
                analysis={analysis}
                deck={deck}
                busy={busy}
                highlight={highlight}
                onComplete={(id) => void runPackage(id, false)}
                onAdd={(id) => void runPackage(id, true)}
                onPin={(id, n) => mutate((d) => pinPackage(d, analysis.packages, analysis.targets, id, n))}
                onShow={(id) => {
                  setQuery({ ...DEFAULT_QUERY, package: id, hideInDeck: true, fromFix: null });
                  showBrowser();
                }}
              />
            ) : panel === 'bracket' && !std ? (
              <BracketPanel analysis={analysis} deck={deck} lookup={lookup} onOpen={openCard} onShowCombos={showCombos} />
            ) : panel === 'network' ? (
              net.network ? (
                <NetworkSummary
                  network={net.network}
                  focus={networkFocus}
                  onFocus={setNetworkFocus}
                  onOpen={openCard}
                  onSwap={() => void runFix('synergy')}
                  busy={busy !== null}
                />
              ) : <p className="p-4 text-ash" data-testid="panel-network">Reading how the cards connect</p>
            ) : panel === 'themes' ? (
              <ThemesPanel
                analysis={analysis}
                deck={deck}
                onChange={(axis, w) => mutate((d) => ({ ...d, themeWeights: { ...(d.themeWeights ?? analysis.themeWeights), [axis]: w } }))}
                onReset={() => mutate((d) => ({ ...d, themeWeights: null }))}
                onFocus={() => mutate((d) => ({ ...d, themeWeights: analysis.themeFocus.weights }))}
                onShow={(axis) => {
                  setQuery({ ...DEFAULT_QUERY, axis, fromFix: null });
                  showBrowser();
                }}
              />
            ) : (
              <ImprovePanel
                deck={deck}
                lookup={lookup}
                themeAxes={themeAxes}
                options={options}
                collectionName={activeCollection?.name ?? null}
                ownedOnly={ownedOnly}
                onOwnedOnly={setOwnedOnly}
                showFreeOnly={manual}
                showPrice={!brawl}
                showBracket={!std}
                freeOnly={freeOnly}
                onFreeOnly={setFreeOnly}
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
          held={detailHeld}
          bracket={deck.targetBracket}
          heldActions={
            detail && detailBoxes.length > 0
              ? detailBoxes.map((h) => (
                  <button
                    key={h.holderId}
                    type="button"
                    className="btn btn-sm"
                    disabled={!!takingOut}
                    onClick={() => void takeOut(h.holderId, detail)}
                    title="One copy leaves the box and stays in your collection, free for this deck. Your total does not change."
                    data-testid="detail-take-out"
                    data-box={h.holderId}
                  >
                    {takingOut === `${h.holderId}|${detail}` ? 'Taking it out' : `I took it out of the ${h.name}`}
                  </button>
                ))
              : undefined
          }
          onClose={closeDetail}
          note={detailEntry?.locked ? 'Locked: auto-build and improve keep this card.' : undefined}
          actions={
            <>
              {detailIsCommander ? (
                <button type="button" className="btn" onClick={() => { mutate((d) => ({ ...d, commanders: d.commanders.filter((c) => c !== detail) })); setDetail(null); }} data-testid="detail-uncommand">
                  Take out of the command zone
                </button>
              ) : detailEntry ? (
                <>
                  <button type="button" className="btn btn-primary" onClick={() => void suggestFor(detail)} data-testid="detail-replace">Suggest swaps for this card</button>
                  <button type="button" className="btn btn-danger" onClick={() => remove(detail)} data-testid="detail-remove">Remove from the deck</button>
                  <button type="button" className="btn" onClick={() => lock(detail)} data-testid="detail-lock">{detailEntry.locked ? 'Unlock' : 'Lock in the deck'}</button>
                  {detailCard?.roles.includes('land') && <button type="button" className="btn" onClick={() => add(detail)}>Add another copy ({detailEntry.qty} now)</button>}
                </>
              ) : swapHere ? null : (
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
        >
          {swapHere && detailCard && (
            <PutItIn
              card={detailCard}
              count={count}
              size={DECK_SIZE}
              another={!!detailEntry}
              state={swapin?.id === detail ? swapin : null}
              why={swapWhy}
              lookup={lookup}
              deckHeld={held}
              scoreOf={scoreOf}
              onSwap={putIn}
              add={detailEntry ? undefined : { onAdd: () => add(detail), disabled: !!detailScore?.gate }}
              reveal={revealFor === detail}
            />
          )}
        </CardDetail>
      )}

      {replacing && deck && (
        <Overlay onClose={() => setReplacing(null)} label="Swaps for one card" wide>
          <div className="p-6" data-testid="replace-panel">
            <h2 className="text-[1.4rem]">Swaps for {lookup[replacing.out]?.name ?? 'this card'}</h2>
            <p className="mt-1 text-ash">Best replacements first, by the deck rating after the swap. Ones the engine disagrees with still show, with the reason.</p>
            {replacing.list === null && <p className="mt-4 text-ash">Looking for replacements...</p>}
            {replacing.error && <p className="mt-4 text-[var(--bad,#e57373)]">{replacing.error}</p>}
            {replacing.list && replacing.list.length === 0 && !replacing.error && <p className="mt-4 text-ash">No legal replacement found for this card.</p>}
            <div className="mt-4 flex flex-col gap-3">
              {(replacing.list ?? []).map((p) => {
                const inHeld = replacing.heldBy?.[p.in];
                return (
                <div key={p.in} className="flex items-center gap-4 rounded border border-white/10 p-3" data-testid="replace-row" data-held={inHeld ? true : undefined}>
                  <div className="w-24 shrink-0 card"><CardImage id={p.out} name={lookup[p.out]?.frontName ?? ''} size="grid" known={!!lookup[p.out]} /></div>
                  <span className="text-ash">→</span>
                  <button type="button" className="w-24 shrink-0 card" onClick={() => setDetail(p.in)} title="Open card">
                    <CardImage id={p.in} name={lookup[p.in]?.frontName ?? ''} size="grid" known={!!lookup[p.in]} />
                    <HeldMark names={inHeld} className="absolute right-[5%] top-[3.5%]" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p>{p.reason}</p>
                    {inHeld && <p className="mt-1 text-[0.92rem] text-ember">No free copy of {lookup[p.in]?.name ?? 'this card'}: {heldText(inHeld).replace(/^In /, 'in ')}.</p>}
                    {p.agrees === false && p.objection && <p className="mt-1 text-[0.92rem] text-[#d9b56a]">Not recommended: {p.objection}</p>}
                    <p className="mt-1 text-ash">Rating {Math.round(p.ratingBefore)} → {Math.round(p.ratingAfter)}</p>
                  </div>
                  <div className="flex shrink-0 flex-col gap-2">
                    <button type="button" className={p.agrees === false ? 'btn' : 'btn btn-primary'} onClick={() => { mutate((d) => swapCard(d, p.out, p.in)); setReplacing(null); }} data-testid="replace-accept">Swap</button>
                    <button type="button" className="btn" onClick={() => proxyCards([p.in], `Added ${lookup[p.in]?.name ?? 'the card'} to the proxy list.`)}>Proxy</button>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        </Overlay>
      )}

      {exported && (
        <Overlay onClose={() => setExported(null)} label="Exported decklist">
          <div className="p-6" data-testid="export-dialog">
            <div className="flex items-start">
              <div>
                <h2 className="text-[1.4rem]">{exported.format === 'arena' ? 'Decklist for MTG Arena' : 'Decklist'}</h2>
                <p className="mt-1 text-ash" data-testid="export-status">
                  {!exported.copied
                    ? 'Select the text and copy it. The browser did not allow copying for you.'
                    : exported.format === 'arena'
                      ? 'Copied to the clipboard. In Arena open Decks and press Import.'
                      : 'Copied to the clipboard. It pastes into Moxfield, Archidekt and most other deck sites.'}
                </p>
                {exported.format === 'arena' && brawl && (
                  <p className="mt-2 max-w-[44rem] text-[0.88rem] text-ash" data-testid="export-printings">
                    Cards you do not own carry the set and number of their cheapest Arena printing, so Arena crafts that one with the wildcard counted above.
                  </p>
                )}
                {exported.format === 'arena' && exported.notOnArena && exported.notOnArena.length > 0 && (
                  <p className="mt-2 max-w-[44rem] text-[0.88rem] text-band-mid" data-testid="export-not-on-arena">
                    {exported.notOnArena.length} {exported.notOnArena.length === 1 ? 'card is' : 'cards are'} not on Arena and will not import: {exported.notOnArena.join(', ')}.
                  </p>
                )}
                {exported.format === 'arena' && exported.notOnArena && exported.notOnArena.length === 0 && (
                  <p className="mt-2 text-[0.88rem] text-ash" data-testid="export-all-on-arena">Every card of this deck exists on Arena.</p>
                )}
                {exported.format === 'arena' && exported.notOnArena === null && (
                  <p className="mt-2 text-[0.88rem] text-smoke">Arena is not installed on this computer, so the app cannot check which cards Arena has.</p>
                )}
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
