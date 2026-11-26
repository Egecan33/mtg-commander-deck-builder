import { isBasicLand } from './rules';
import type { ArenaRarity, Card, CardDb, Deck, Wildcards } from './types';

/** Arena rarities, cheapest first. */
export const RARITIES: readonly ArenaRarity[] = ['common', 'uncommon', 'rare', 'mythic'];
export const ZERO_WILDCARDS: Readonly<Wildcards> = { common: 0, uncommon: 0, rare: 0, mythic: 0 };

/**
 * The wildcard rarity this card costs to put in a deck: its Arena rarity when it is not owned, is
 * on Arena and is not a basic land (basics are free on Arena); null when it costs nothing (or
 * cannot be crafted at all, which legality reports).
 */
export function wildcardFor(card: Card, owned: ReadonlySet<string>): ArenaRarity | null {
  if (owned.has(card.oracleId) || isBasicLand(card)) return null;
  return card.arenaRarity ?? null;
}

/**
 * Wildcards a deck needs: one per different card that is not owned (commanders and companion
 * included), by the rarity of its cheapest Arena printing. A card with more copies (Relentless
 * Rats) counts once.
 */
export function wildcardsNeeded(deck: Deck, db: CardDb, owned: ReadonlySet<string>): Wildcards {
  const need: Wildcards = { ...ZERO_WILDCARDS };
  for (const line of toCraft(deck, db, owned)) need[line.rarity]++;
  return need;
}

/** What is left of `have` after `need`, never below 0. */
export function wildcardsLeft(have: Wildcards, need: Wildcards): Wildcards {
  const out: Wildcards = { ...ZERO_WILDCARDS };
  for (const r of RARITIES) out[r] = Math.max(0, (have[r] ?? 0) - (need[r] ?? 0));
  return out;
}

/** The rarities a deck needs more wildcards of than the player has. */
export function overBudget(need: Wildcards, have: Wildcards): ArenaRarity[] {
  return RARITIES.filter((r) => need[r] > (have[r] ?? 0));
}

export interface CraftLine { oracleId: string; rarity: ArenaRarity; set: string | null; number: string | null }

/** The deck's cards to craft, in deck order (commanders first): each with its rarity and the Arena printing to craft. */
export function toCraft(deck: Deck, db: CardDb, owned: ReadonlySet<string>): CraftLine[] {
  const out: CraftLine[] = [];
  const seen = new Set<string>();
  for (const id of [...deck.commanders, deck.companion, ...deck.main.filter((e) => e.qty >= 1).map((e) => e.oracleId)]) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const card = db.get(id);
    const rarity = card ? wildcardFor(card, owned) : null;
    if (!card || !rarity) continue;
    out.push({ oracleId: id, rarity, set: card.arenaPrinting?.set ?? null, number: card.arenaPrinting?.number ?? null });
  }
  return out;
}
