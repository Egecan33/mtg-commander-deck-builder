import type { Card, CardFeatures, Role } from '../types';
import { axesOf } from './axes';
import { creatureSubtypes } from './creature-types';
import { landWeightOf, pipsOf, sourcesOf, taplandWeightOf } from './mana-info';
import { isFreeInteraction, rolesOf } from './roles';
import { hasKw, makeCtx, type Ctx } from './text';

function instantSpeedOf(c: Ctx): boolean {
  if (hasKw(c, 'flash')) return true;
  const faces = c.card.faces.length > 0 ? c.card.faces : [{ typeLine: c.card.typeLine }];
  // The back of a transforming card cannot be cast; every other layout offers each face.
  const castable = c.card.layout === 'transform' ? faces.slice(0, 1) : faces;
  return castable.some((f) => /\bInstant\b/.test(f.typeLine ?? ''));
}

const FREE_INTERACTION_MAX_RANK = 6000;

function powerTierOf(c: Ctx, roles: readonly Role[]): CardFeatures['powerTier'] {
  const rank = c.card.edhrecRank;
  // Free interaction nobody plays (Mogg Salvage, Thunderclap) is not top-tier power: require some play.
  const played = rank !== null && rank !== undefined && rank <= FREE_INTERACTION_MAX_RANK;
  if (roles.includes('game-changer') || roles.includes('fast-mana') || (played && isFreeInteraction(c, roles))) return 5;
  if ((rank !== null && rank !== undefined && rank <= 100) || (roles.includes('tutor') && c.card.cmc <= 2)) return 4;
  if (rank !== null && rank !== undefined && rank <= 1500) return 3;
  if (rank !== null && rank !== undefined && rank <= 6000) return 2;
  return 1;
}

/**
 * Everything the engine needs to know about one card, computed once per sync. `tagSlugs` are the
 * card's rolled-up Scryfall Tagger slugs; with none, text rules still produce a usable (narrower) result.
 */
export function computeFeatures(card: Card, tagSlugs: string[]): CardFeatures {
  const c = makeCtx(card, tagSlugs ?? []);
  const landWeight = landWeightOf(c);
  const roles = rolesOf(c, landWeight);
  return {
    oracleId: card.oracleId,
    roles,
    axes: axesOf(c),
    instantSpeed: instantSpeedOf(c),
    landWeight,
    taplandWeight: taplandWeightOf(c),
    sources: sourcesOf(c, landWeight),
    pips: pipsOf(c),
    powerTier: powerTierOf(c, roles),
    creatureTypes: creatureSubtypes(card.faces),
  };
}
