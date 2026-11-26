import { isBasicLand } from '../rules';
import { isLandCard } from '../summary';
import type { Card, CardFeatures, Role } from '../types';

/** EDHREC rank → quality, through log10(rank). Anchors follow deck-theory.md §6.4, smoothed. */
const RANK_CURVE: readonly (readonly [number, number])[] = [
  [0, 1], [1.7, 1], [2, 0.93], [2.7, 0.8], [3.18, 0.6], [3.6, 0.38], [4, 0.2], [4.5, 0.06],
];
const UNRANKED_QUALITY = 0.08;
export const BASIC_LAND_QUALITY = 0.6;

export function rankQuality(rank: number | null | undefined): number {
  if (rank === null || rank === undefined || !(rank >= 1)) return UNRANKED_QUALITY;
  const x = Math.log10(rank);
  for (let i = 1; i < RANK_CURVE.length; i++) {
    const [x1, y1] = RANK_CURVE[i];
    if (x <= x1) {
      const [x0, y0] = RANK_CURVE[i - 1];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return RANK_CURVE[RANK_CURVE.length - 1][1];
}

/** Mana value a role's cards normally cost; each mana above it costs quality. */
const ROLE_BASELINE: Partial<Record<Role, number>> = { ramp: 2, 'spot-removal': 2, counterspell: 2, draw: 3, tutor: 3, wipe: 5 };
/** Commander mana value from which mana rocks that make two or more mana are not held to the two-mana baseline. */
const BIG_COMMANDER = [6];
const MULTI_MANA = /\{T\}[^.\n]*: Add (\{[WUBRGC]\}){2,}|: Add (two|three|four|five|X) mana/;
const OVERCOST_STEP = 0.05;
const OVERCOST_MAX = 0.15;
const INSTANT_BONUS = 0.05;

/**
 * A card's quality before the deck and the bracket's power tiers: its popularity, a little for
 * instant-speed interaction, less for costing more than its job does. Not clamped, so the scorer
 * can go on from it; `baseQuality` is the clamped form.
 */
export function rawQuality(card: Card, f: CardFeatures | undefined, commanderMvs: ReadonlySet<number> = new Set()): { quality: number; text: string } {
  const mv = Math.max(0, Number.isFinite(card.cmc) ? card.cmc : 0);
  const basic = isBasicLand(card);
  let quality = basic ? BASIC_LAND_QUALITY : rankQuality(card.edhrecRank);
  let text = basic ? 'basic land' : card.edhrecRank ? `EDHREC rank ${card.edhrecRank}` : 'no popularity data';
  if (f && !isLandCard(f)) {
    const roles = f.roles;
    const interaction = roles.includes('spot-removal') || roles.includes('counterspell') || roles.includes('wipe');
    if (interaction && f.instantSpeed) { quality += INSTANT_BONUS; text += ', instant speed'; }
    let over = Infinity;
    for (const role of roles) {
      const base = ROLE_BASELINE[role];
      if (base !== undefined) over = Math.min(over, mv - base);
    }
    // A creature or planeswalker brings a body with the effect; only plain spells are held to the role's price.
    // Nor is a rock that makes two or more mana overpriced for a commander that costs six or more
    // (Thran Dynamo and Gilded Lotus are how Kozilek gets cast).
    const bigRock = roles.includes('ramp') && BIG_COMMANDER.some((n) => commanderMvs.has(n) || [...commanderMvs].some((m) => m >= n)) && MULTI_MANA.test(card.oracleText);
    if (over !== Infinity && over >= 1 && !bigRock && !/\b(Creature|Planeswalker)\b/.test(card.frontTypeLine ?? card.typeLine ?? '')) {
      quality -= Math.min(OVERCOST_MAX, OVERCOST_STEP * Math.floor(over));
      text += ', costs more than most cards doing this job';
    }
  }
  return { quality, text };
}

/** The scorer's deck-free quality of a card, 0..1, with the reasons in words. */
export function baseQuality(card: Card, f: CardFeatures | undefined, commanderMvs?: ReadonlySet<number>): { quality: number; text: string } {
  const { quality, text } = rawQuality(card, f, commanderMvs);
  return { quality: quality > 0 ? (quality < 1 ? quality : 1) : 0, text };
}

