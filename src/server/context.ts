import { createHash } from 'node:crypto';
import type { AnalyzeResponse, EdhrecStatus } from '@/app/lib/api';
import { analyzeBracket } from '@/engine/brackets';
import { rateDeck } from '@/engine/rating';
import { createScorer } from '@/engine/scoring';
import { resolveThemeWeights, summarizeDeck } from '@/engine/summary';
import { targetsFor } from '@/engine/targets';
import type { BracketReport, Card, CardScore, Deck, DeckRating, DeckSummary, EngineContext, Targets } from '@/engine/types';
import { cardLookup, poolIndex } from './cards';
import { peekEdhrec } from './edhrec';
import { getSettings } from './settings';
import { cacheSlot } from './state';
import { getCardDb } from './store';

/** Scored pools kept in memory. Each holds a CardScore per legal card, so the number stays small. */
export const MAX_ANALYSES = 6;

/** Everything the engine needs for this deck. Never waits for the network. */
export function engineContext(deck: Deck): { ctx: EngineContext; edhrec: EdhrecStatus } {
  const settings = getSettings();
  const { data, status } = peekEdhrec(deck.commanders, deck.targetBracket);
  return {
    ctx: { db: getCardDb(), edhrec: data, mldOverrides: settings.mldOverrides, extraTurnOverrides: settings.extraTurnOverrides },
    edhrec: status,
  };
}

/**
 * Identity of a deck for scoring: everything the engine reads, nothing it does not (name, id and
 * locks do not change a score).
 */
export function deckKey(deck: Deck): string {
  const theme = deck.themeWeights ? Object.entries(deck.themeWeights).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : null;
  const wanted = deck.roleTargets ? Object.entries(deck.roleTargets).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)) : null;
  const shape = [deck.commanders, deck.companion, deck.chosenColor, deck.targetBracket, theme, deck.main.map((e) => [e.oracleId, e.qty]), wanted];
  return createHash('sha1').update(JSON.stringify(shape)).digest('hex');
}

export interface Report {
  rating: DeckRating; bracket: BracketReport; summary: DeckSummary; targets: Targets;
  /** The targets without the deck's own wanted counts (`Deck.roleTargets`). */
  defaultTargets: Targets;
  themeWeights: Record<string, number>;
  deckScores: Record<string, CardScore>;
  unknown: string[];
}

export interface ScoredPool {
  /** One score per card of `poolIndex().cards`, same order. */
  scores: CardScore[];
  /** Pool positions ordered for a sort key, gated cards last; computed on first use. */
  order(sort: string, compare: (a: number, b: number) => number): Int32Array;
}

export interface Analysis {
  key: string;
  deck: Deck;
  ctx: EngineContext;
  edhrec: EdhrecStatus;
  scorer: ReturnType<typeof createScorer>;
  report(): Report;
  pool(): ScoredPool;
}

function makeAnalysis(key: string, deck: Deck, ctx: EngineContext, edhrec: EdhrecStatus): Analysis {
  const scorer = createScorer(deck, ctx);
  let report: Report | null = null;
  let pool: ScoredPool | null = null;
  return {
    key, deck, ctx, edhrec, scorer,
    report() {
      if (report) return report;
      const { db } = ctx;
      const summary = summarizeDeck(deck, db);
      const deckScores: Record<string, CardScore> = {};
      const unknown: string[] = [];
      for (const id of [...deck.commanders, deck.companion, ...deck.main.map((e) => e.oracleId)]) {
        if (!id || deckScores[id]) continue;
        const card = db.get(id);
        if (card) deckScores[id] = scorer.score(card);
        else if (!unknown.includes(id)) unknown.push(id);
      }
      return (report = {
        rating: rateDeck(deck, ctx),
        bracket: analyzeBracket(deck, ctx),
        summary,
        targets: targetsFor(deck, ctx, summary),
        defaultTargets: deck.roleTargets ? targetsFor({ ...deck, roleTargets: null }, ctx, summary) : targetsFor(deck, ctx, summary),
        themeWeights: resolveThemeWeights(deck, ctx),
        deckScores, unknown,
      });
    },
    pool() {
      if (pool) return pool;
      const cards: readonly Card[] = poolIndex().cards;
      const scores = cards.map((c) => scorer.score(c));
      const orders = new Map<string, Int32Array>();
      return (pool = {
        scores,
        order(sort, compare) {
          let order = orders.get(sort);
          if (!order) {
            order = Int32Array.from(cards.keys());
            order.sort((a, b) => {
              const ga = scores[a].gate ? 1 : 0;
              const gb = scores[b].gate ? 1 : 0;
              return ga - gb || compare(a, b);
            });
            orders.set(sort, order);
          }
          return order;
        },
      });
    },
  };
}

/**
 * The scorer, report and scored pool of a deck, cached by deck hash: paging, filtering and sorting
 * the browser, and analysing the same deck again, reuse the work. A cached entry is only reused
 * while the card database, the EDHREC data and the settings it was built with are still current.
 */
export function getAnalysis(deck: Deck): Analysis {
  const cache = cacheSlot('analyses', () => new Map<string, Analysis>());
  const key = deckKey(deck);
  const { ctx, edhrec } = engineContext(deck);
  const hit = cache.get(key);
  if (
    hit && hit.ctx.db === ctx.db && hit.ctx.edhrec === ctx.edhrec &&
    hit.ctx.mldOverrides === ctx.mldOverrides && hit.ctx.extraTurnOverrides === ctx.extraTurnOverrides
  ) {
    cache.delete(key);
    cache.set(key, hit); // most recently used last
    hit.edhrec = edhrec;
    return hit;
  }
  const fresh = makeAnalysis(key, deck, ctx, edhrec);
  cache.delete(key);
  cache.set(key, fresh);
  while (cache.size > MAX_ANALYSES) cache.delete(cache.keys().next().value as string);
  return fresh;
}

/** The body of POST /api/analyze. */
export function analyzeResponse(deck: Deck): AnalyzeResponse {
  const analysis = getAnalysis(deck);
  const r = analysis.report();
  const ids = new Set<string>([...deck.commanders, ...deck.main.map((e) => e.oracleId)]);
  if (deck.companion) ids.add(deck.companion);
  for (const found of [...r.bracket.combos.included, ...r.bracket.combos.oneAway]) {
    for (const c of found.combo.cards) ids.add(c.oracleId);
  }
  for (const reason of r.bracket.reasons) for (const id of reason.oracleIds) ids.add(id);
  for (const v of [...r.rating.violations, ...r.bracket.violationsOfTarget]) for (const id of v.oracleIds) ids.add(id);
  return { ...r, cards: cardLookup(ids), edhrec: analysis.edhrec };
}
