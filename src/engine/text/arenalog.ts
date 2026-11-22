/**
 * Reads card ownership out of MTG Arena's Player.log.
 *
 * Arena has not written the whole collection to its log since August 2021. With "Detailed Logs
 * (Plugin Support)" switched on it still writes, as JSON: every saved deck (when the game starts
 * and when a deck is saved) and the card pool of every draft and sealed event. Those are the cards
 * this reader finds. It is a lower bound of the collection: a card that sits in no deck and no
 * limited pool is not in the log at all.
 */
export interface ArenaLogData {
  /** Arena's detailed-logging switch as the log states it; null when the log does not say. */
  detailedLogs: boolean | null;
  /** Arena card id (grpId) -> the most copies seen in any one deck or pool. */
  cards: Map<number, number>;
  /** Different deck lists and non-empty limited pools found. */
  decks: number;
  pools: number;
}

export interface ArenaLogReader {
  /** Feed the log one line at a time (logs can be hundreds of megabytes). */
  line(text: string): void;
  result(): ArenaLogData;
}

const DECK_ZONES = ['MainDeck', 'Sideboard', 'CommandZone', 'Companions'] as const;
const POOL_KEYS = ['CardPool', 'PickedCards'] as const;
const MAX_DEPTH = 12;

const wholeId = (v: unknown): number | null => {
  const n = typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
};

export function createArenaLogReader(): ArenaLogReader {
  let detailedLogs: boolean | null = null;
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
      const at = text.indexOf('{');
      if (at < 0) return;
      // Cheap filter: only lines that can hold a deck or a pool are worth parsing.
      if (!text.includes('MainDeck') && !text.includes('CardPool') && !text.includes('PickedCards')) return;
      try {
        walk(JSON.parse(text.slice(at)), 0);
      } catch {
        // a cut-off or non-JSON line
      }
    },
    result: () => ({ detailedLogs, cards: new Map(cards), decks: deckSeen.size, pools: poolSeen.size }),
  };
}

/** `createArenaLogReader` over a whole log held in memory. */
export function parseArenaLog(text: string): ArenaLogData {
  const reader = createArenaLogReader();
  for (const line of text.split(/\r\n|\r|\n/)) reader.line(line);
  return reader.result();
}
