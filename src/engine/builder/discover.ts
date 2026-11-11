import { rateDeck } from '../rating';
import { isBasicLand, isCommanderEligible } from '../rules';
import { createScorer } from '../scoring';
import { isLandCard } from '../summary';
import type { Bracket, BuildOptions, Card, CardDb, Color, Deck, EngineContext } from '../types';
import { autoBuild } from './auto';
import { improveDeck } from './goals';
import { applySwaps } from './improve';

/** Owned nonland cards whose scores make up a commander's pre-score. */
export const PRESCORE_TOP = 60;
/** Points per owned land that fits, and the most lands counted. */
const LAND_BONUS = 2;
const LAND_BONUS_MAX = 30;
/** Buy tiers computed for a commander; null is "no limit". */
export const BUY_TIERS: readonly number[] = [0, 5, 10, 15, 20];

const shell = (commander: string, bracket: Bracket): Deck => ({
  id: null, name: '', commanders: [commander], companion: null, chosenColor: null, main: [], targetBracket: bracket, themeWeights: null,
});
const opts = (owned: Set<string>, ownedOnly: boolean, extra: Partial<BuildOptions> = {}): BuildOptions => ({ ownedOnly, owned, maxPriceUsd: null, seed: 1, ...extra });

/** Commanders worth looking at: legal cards that can lead a deck alone. */
export function discoverCandidates(db: CardDb, owned: ReadonlySet<string>, ownedCommandersOnly: boolean): Card[] {
  return db.all().filter((c) => isCommanderEligible(c) && (!ownedCommandersOnly || owned.has(c.oracleId)));
}

/**
 * Cheap measure of how much of a good deck the collection already holds for a commander: the sum
 * of the best `PRESCORE_TOP` card scores among owned nonland cards the commander can run, plus a
 * little for each owned land that fits. No deck is built.
 */
export function preScore(commander: Card, ownedCards: readonly Card[], ctx: EngineContext, bracket: Bracket): number {
  const scorer = createScorer(shell(commander.oracleId, bracket), ctx);
  const identity = new Set<Color>(commander.colorIdentity);
  const scores: number[] = [];
  let lands = 0;
  for (const card of ownedCards) {
    if (card.oracleId === commander.oracleId || isBasicLand(card)) continue;
    // Cheap colour check first; the scorer's own gate covers everything else.
    if (card.colorIdentity.some((c) => !identity.has(c))) continue;
    const s = scorer.score(card);
    if (s.gate) continue;
    const f = ctx.db.features(card.oracleId);
    if (f && isLandCard(f)) lands++;
    else scores.push(s.score);
  }
  scores.sort((a, b) => b - a);
  let sum = 0;
  for (let i = 0; i < Math.min(PRESCORE_TOP, scores.length); i++) sum += scores[i];
  return sum + LAND_BONUS * Math.min(LAND_BONUS_MAX, lands);
}

/** The cards of a deck that would have to be bought: not owned and not a basic land (commander included). */
export function buysOf(deck: Deck, owned: ReadonlySet<string>, db: CardDb): string[] {
  const out: string[] = [];
  for (const id of [...deck.commanders, ...deck.main.map((e) => e.oracleId)]) {
    const card = db.get(id);
    if (!card || owned.has(id) || isBasicLand(card) || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

export interface TierDeck { /** Most cards to buy besides what is owned; null = no limit. */ cap: number | null; deck: Deck; rating: number; buys: string[] }

const tier = (cap: number | null, deck: Deck, ctx: EngineContext, owned: ReadonlySet<string>): TierDeck => ({
  cap, deck, rating: rateDeck(deck, ctx).rating, buys: buysOf(deck, owned, ctx.db),
});

/** The best deck from owned cards only (basic lands are free), and the best deck with no limit. */
export function eagerTiers(commander: string, ctx: EngineContext, owned: Set<string>, bracket: Bracket): { owned: TierDeck; unlimited: TierDeck } {
  const base = autoBuild(shell(commander, bracket), ctx, opts(owned, true));
  const free = autoBuild(shell(commander, bracket), ctx, opts(owned, false));
  return { owned: tier(0, base, ctx, owned), unlimited: tier(null, free, ctx, owned) };
}

/**
 * "With up to N buys": the owned-only deck improved with the whole pool open, taking the improve
 * run's swaps in order and skipping every swap whose incoming card would be buy number N + 1. A
 * commander that is not owned is itself one buy and comes off each budget.
 */
export function buyTiers(base: Deck, ctx: EngineContext, owned: Set<string>, caps: readonly number[] = BUY_TIERS): TierDeck[] {
  const { db } = ctx;
  const most = Math.max(0, ...caps);
  const swaps = most > 0 ? improveDeck(base, ctx, opts(owned, false, { goals: { maxSwaps: 40 } })) : [];
  const fixed = buysOf(base, owned, db).length; // an unowned commander
  return caps.map((cap) => {
    let deck = base;
    let bought = fixed;
    for (const s of swaps) {
      const card = db.get(s.in);
      const buy = !!card && !owned.has(s.in) && !isBasicLand(card);
      if (buy && bought >= cap) continue;
      const next = applySwaps(deck, [s]);
      if (next === deck) continue;
      deck = next;
      if (buy) bought++;
    }
    return tier(cap, deck, ctx, owned);
  });
}
