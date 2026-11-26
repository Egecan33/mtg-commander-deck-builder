import type { ArenaRarity } from '@/engine/types';

/* Scryfall objects are external JSON; they are read defensively through `any`. */
/* eslint-disable @typescript-eslint/no-explicit-any */

const ORDER: readonly ArenaRarity[] = ['common', 'uncommon', 'rare', 'mythic'];

/**
 * Scryfall's printing rarity as an Arena wildcard rarity. `special` (Time Spiral's timeshifted
 * cards, some Arena-only bonus sheets) and `bonus` have no wildcard of their own: they count as
 * mythic, so the budget never under-counts. Anything else is null.
 */
export function arenaRarityOf(rarity: unknown): ArenaRarity | null {
  if (rarity === 'special' || rarity === 'bonus') return 'mythic';
  return ORDER.includes(rarity as ArenaRarity) ? (rarity as ArenaRarity) : null;
}

/** Scryfall set codes Arena's deck import spells differently. */
const ARENA_SET_CODES: Readonly<Record<string, string>> = { dom: 'DAR' };

/** The set code Arena's deck import reads for a Scryfall set code. */
export function arenaSetCode(set: string): string {
  return ARENA_SET_CODES[set.toLowerCase()] ?? set.toUpperCase();
}

export interface ArenaInfo { rarity: ArenaRarity; printing: { set: string; number: string } }

/**
 * Collects, from Scryfall's default-cards printings, each card's cheapest printing on MTG Arena
 * (`arena` in `games`): the lowest rarity, the newest release among those on a tie. Arena wildcards
 * only craft their own rarity, so that printing is what the budget counts and what the export names.
 */
export function createArenaIndex(): { add(printing: any): void; get(oracleId: string): ArenaInfo | null } {
  const best = new Map<string, ArenaInfo & { released: string }>();
  return {
    add(p) {
      if (!Array.isArray(p?.games) || !p.games.includes('arena')) return;
      const oracleId = typeof p.oracle_id === 'string' ? p.oracle_id : p?.card_faces?.[0]?.oracle_id;
      const rarity = arenaRarityOf(p.rarity);
      if (typeof oracleId !== 'string' || !rarity || typeof p.set !== 'string' || typeof p.collector_number !== 'string') return;
      const released = typeof p.released_at === 'string' ? p.released_at : '';
      const prev = best.get(oracleId);
      const cheaper = !prev || ORDER.indexOf(rarity) < ORDER.indexOf(prev.rarity);
      const newer = !!prev && rarity === prev.rarity && released > prev.released;
      if (cheaper || newer) best.set(oracleId, { rarity, printing: { set: arenaSetCode(p.set), number: p.collector_number }, released });
    },
    get(oracleId) {
      const hit = best.get(oracleId);
      return hit ? { rarity: hit.rarity, printing: hit.printing } : null;
    },
  };
}
