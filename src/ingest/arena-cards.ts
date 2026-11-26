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
 * (`arena` in `games`). Printings Arena has an id for (`arena_id`) and that are not promos rank
 * above rarity: Scryfall tags a few printings `arena` that Arena's crafting never offers (Stoneforge
 * Mystic's Worldwake rare has no id; Flusterstorm's Buy-a-Box and Arena's own promo printings cannot
 * be crafted), and counting those would make a card look cheaper than any wildcard crafts it. Among
 * those printings: the lowest rarity, then the newest release. Only a card with no such printing
 * falls back to its other Arena printings, by the same order. Arena wildcards only craft their own
 * rarity, so that printing is what the budget counts and what the export names.
 */
export function createArenaIndex(): { add(printing: any): void; get(oracleId: string): ArenaInfo | null } {
  type Best = ArenaInfo & { released: string };
  const craftable = new Map<string, Best>();
  const other = new Map<string, Best>();
  return {
    add(p) {
      if (!Array.isArray(p?.games) || !p.games.includes('arena')) return;
      const oracleId = typeof p.oracle_id === 'string' ? p.oracle_id : p?.card_faces?.[0]?.oracle_id;
      const rarity = arenaRarityOf(p.rarity);
      if (typeof oracleId !== 'string' || !rarity || typeof p.set !== 'string' || typeof p.collector_number !== 'string') return;
      const released = typeof p.released_at === 'string' ? p.released_at : '';
      const promo = p.promo === true || p.set_type === 'promo';
      const map = typeof p.arena_id === 'number' && !promo ? craftable : other;
      const prev = map.get(oracleId);
      const cheaper = !prev || ORDER.indexOf(rarity) < ORDER.indexOf(prev.rarity);
      const newer = !!prev && rarity === prev.rarity && released > prev.released;
      if (cheaper || newer) map.set(oracleId, { rarity, printing: { set: arenaSetCode(p.set), number: p.collector_number }, released });
    },
    get(oracleId) {
      const hit = craftable.get(oracleId) ?? other.get(oracleId);
      return hit ? { rarity: hit.rarity, printing: hit.printing } : null;
    },
  };
}
