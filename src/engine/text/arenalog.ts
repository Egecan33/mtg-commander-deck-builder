/**
 * Reads card ownership out of MTG Arena's Player.log.
 *
 * Arena has not written the whole collection to its log since August 2021. With "Detailed Logs
 * (Plugin Support)" switched on it still writes, as JSON: every saved deck (when the game starts
 * and when a deck is saved) and the card pool of every draft and sealed event. Those are the cards
 * this reader finds. It is a lower bound of the collection: a card that sits in no deck and no
 * limited pool is not in the log at all.
 *
 * The deck list Arena sends is not only the player's: it also holds Arena's ready-made decks (event
 * loaners, championship lists, every precon), which the player can play without owning the cards.
 * Those are told apart by their name, which is a localisation key ("?=?Loc/Decks/Precon/...")
 * instead of text, and are left out.
 */
import type { Wildcards } from '../types';

export interface ArenaLogData {
  /** Arena's detailed-logging switch as the log states it; null when the log does not say. */
  detailedLogs: boolean | null;
  /** Arena card id (grpId) -> the most copies seen in any one deck or pool. */
  cards: Map<number, number>;
  /** Different deck lists and non-empty limited pools found. */
  decks: number;
  pools: number;
  /**
   * The player's wildcards from the last full `InventoryInfo` the log holds (a missing key is 0:
   * Arena leaves out a rarity the player has none of); null when the log has none.
   */
  wildcards: Wildcards | null;
  /**
   * When Arena wrote that inventory (ms since the epoch, local time), from the
   * `[UnityCrossThreadLogger]M/D/YYYY h:mm:ss AM` line before it; null when there is none it can read.
   */
  wildcardsAt: number | null;
}

export interface ArenaLogReader {
  /** Feed the log one line at a time (logs can be hundreds of megabytes). */
  line(text: string): void;
  result(): ArenaLogData;
}

const DECK_ZONES = ['MainDeck', 'Sideboard', 'CommandZone', 'Companions'] as const;
const POOL_KEYS = ['CardPool', 'PickedCards'] as const;
const MAX_DEPTH = 12;
/** Keys whose whole content is Arena's own decks, never the player's. */
const NOT_OWNED_KEYS = new Set(['PreconDecks']);
/** A deck's summary sits next to it under one of these pairs of keys. */
const SUMMARY_PAIRS: readonly (readonly [string, string])[] = [['Summary', 'Deck'], ['CourseDeckSummary', 'CourseDeck']];
/** Deck id -> deck maps, each with the list of summaries that names its decks. */
const DECK_MAPS: readonly (readonly [string, string])[] = [['DeckSummaries', 'DecksInternal'], ['DeckSummariesV2', 'Decks'], ['DeckSummaries', 'Decks']];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A ready-made deck: its name is a localisation key, not something a player typed. */
const readyMade = (summary: unknown): boolean => isObj(summary) && typeof summary.Name === 'string' && summary.Name.startsWith('?=?Loc/');

const wholeId = (v: unknown): number | null => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
};

const WILDCARD_KEYS: readonly (readonly [keyof Wildcards, string])[] = [
  ['common', 'WildCardCommons'], ['uncommon', 'WildCardUnCommons'], ['rare', 'WildCardRares'], ['mythic', 'WildCardMythics'],
];

/**
 * The wildcards of an `InventoryInfo` object. Only a full inventory counts: one with `Gems` or any
 * wildcard key (a change notice without them would otherwise read as no wildcards at all).
 */
function wildcardsOf(inventory: unknown): Wildcards | null {
  if (!isObj(inventory)) return null;
  if (!('Gems' in inventory) && !WILDCARD_KEYS.some(([, key]) => key in inventory)) return null;
  const count = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : 0);
  const out = { common: 0, uncommon: 0, rare: 0, mythic: 0 };
  for (const [rarity, key] of WILDCARD_KEYS) out[rarity] = count(inventory[key]);
  return out;
}

/** Arena's logger header in the US form it writes here: "[UnityCrossThreadLogger]11/25/2026 9:22:02 PM". */
const LOGGER_TIME = /^\[UnityCrossThreadLogger\](\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{1,2}):(\d{2}):(\d{2}) (AM|PM)\s*$/;

/**
 * The local time of a logger header, or null for anything else. Other locales write other forms
 * ("25.11.2026 21:22:02", day and month either way round); those are not guessed at.
 */
function loggerTime(text: string): number | null {
  const m = LOGGER_TIME.exec(text);
  if (!m) return null;
  const [month, day, year, hour12, minute, second] = m.slice(1, 7).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour12 < 1 || hour12 > 12 || minute > 59 || second > 59) return null;
  const hour = (hour12 % 12) + (m[7] === 'PM' ? 12 : 0);
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

export function createArenaLogReader(): ArenaLogReader {
  let detailedLogs: boolean | null = null;
  let wildcards: Wildcards | null = null;
  let wildcardsAt: number | null = null;
  // The time of the last logger header: the time of the messages that follow it.
  let headerAt: number | null = null;
  const cards = new Map<number, number>();
  const deckSeen = new Set<string>();
  const poolSeen = new Set<string>();

  /** Folds one deck or pool in: each card keeps the largest count any single list had. */
  const fold = (list: Map<number, number>, seen: Set<string>) => {
    if (list.size === 0) return;
    seen.add(JSON.stringify([...list].sort((a, b) => a[0] - b[0])));
    for (const [id, qty] of list) if (qty > (cards.get(id) ?? 0)) cards.set(id, qty);
  };

  const walk = (value: unknown, depth: number): void => {
    if (depth > MAX_DEPTH) return;
    if (typeof value === 'string') {
      // Requests and some responses carry their body as JSON inside a string.
      const t = value.trimStart();
      if (t.startsWith('{') || t.startsWith('[')) {
        try {
          walk(JSON.parse(t), depth + 1);
        } catch {
          // not JSON after all
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) walk(v, depth + 1);
      return;
    }
    if (typeof value !== 'object' || value === null) return;
    const obj = value as Record<string, unknown>;
    const skip = new Set<string>(['InventoryInfo']);
    const inventory = wildcardsOf(obj.InventoryInfo);
    if (inventory) {
      wildcards = inventory;
      wildcardsAt = headerAt;
    }

    // A deck with its summary beside it: skip the deck when the summary says it is ready-made.
    for (const [summaryKey, deckKey] of SUMMARY_PAIRS) {
      if (readyMade(obj[summaryKey]) && isObj(obj[deckKey])) skip.add(deckKey);
    }
    // A map of decks by id with their summaries in a list beside it.
    for (const [summariesKey, decksKey] of DECK_MAPS) {
      const summaries = obj[summariesKey];
      const decks = obj[decksKey];
      if (!Array.isArray(summaries) || !isObj(decks) || skip.has(decksKey)) continue;
      const notOwned = new Set<string>();
      for (const sum of summaries) {
        if (!readyMade(sum)) continue;
        const id = (sum as Record<string, unknown>).DeckIdInternal ?? (sum as Record<string, unknown>).DeckId;
        if (typeof id === 'string') notOwned.add(id);
      }
      skip.add(decksKey);
      for (const [id, deck] of Object.entries(decks)) if (!notOwned.has(id)) walk(deck, depth + 1);
    }

    if (Array.isArray(obj.MainDeck)) {
      const list = new Map<number, number>();
      for (const zone of DECK_ZONES) {
        const entries = obj[zone];
        if (!Array.isArray(entries)) continue;
        for (const e of entries) {
          if (typeof e !== 'object' || e === null) continue;
          const id = wholeId((e as Record<string, unknown>).cardId);
          const qty = wholeId((e as Record<string, unknown>).quantity);
          if (id !== null && qty !== null) list.set(id, (list.get(id) ?? 0) + qty);
        }
      }
      fold(list, deckSeen);
    }
    for (const key of POOL_KEYS) {
      const pool = obj[key];
      if (!Array.isArray(pool)) continue;
      const list = new Map<number, number>();
      for (const v of pool) {
        const id = wholeId(v);
        if (id !== null) list.set(id, (list.get(id) ?? 0) + 1);
      }
      fold(list, poolSeen);
    }
    for (const [key, v] of Object.entries(obj)) {
      if (skip.has(key) || NOT_OWNED_KEYS.has(key)) continue;
      if ((DECK_ZONES as readonly string[]).includes(key) || (POOL_KEYS as readonly string[]).includes(key)) continue;
      if (typeof v === 'object' || typeof v === 'string') walk(v, depth + 1);
    }
  };

  return {
    line(text) {
      if (detailedLogs === null || text.startsWith('DETAILED LOGS:')) {
        const m = /^DETAILED LOGS: (ENABLED|DISABLED)/.exec(text);
        if (m) detailedLogs = m[1] === 'ENABLED';
      }
      // A logger header dates the lines after it; one whose time cannot be read leaves them undated.
      if (text.startsWith('[UnityCrossThreadLogger]')) headerAt = loggerTime(text);
      const at = text.indexOf('{');
      if (at < 0) return;
      // Cheap filter: only lines that can hold a deck, a pool or the inventory are worth parsing.
      if (!text.includes('MainDeck') && !text.includes('CardPool') && !text.includes('PickedCards') && !text.includes('"InventoryInfo"')) return;
      try {
        walk(JSON.parse(text.slice(at)), 0);
      } catch {
        // a cut-off or non-JSON line
      }
    },
    result: () => ({
      detailedLogs, cards: new Map(cards), decks: deckSeen.size, pools: poolSeen.size, wildcards: wildcards ? { ...wildcards } : null, wildcardsAt,
    }),
  };
}

/** `createArenaLogReader` over a whole log held in memory. */
export function parseArenaLog(text: string): ArenaLogData {
  const reader = createArenaLogReader();
  for (const line of text.split(/\r\n|\r|\n/)) reader.line(line);
  return reader.result();
}
