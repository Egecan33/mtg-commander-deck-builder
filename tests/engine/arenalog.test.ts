import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseArenaLog } from '@/engine/text';

const LOG = readFileSync(fileURLToPath(new URL('../fixtures/arena/Player.log', import.meta.url)), 'utf8');
const sorted = (m: ReadonlyMap<number, number>) => [...m].sort((a, b) => a[0] - b[0]);

describe('parseArenaLog', () => {
  it('collects the cards of every deck and limited pool, by Arena card id', () => {
    const got = parseArenaLog(LOG);
    expect(got.detailedLogs).toBe(true);
    expect(got.decks).toBe(3);
    expect(got.pools).toBe(2);
    expect(sorted(got.cards)).toEqual([
      [60235, 1], // Sol Ring, deck 1
      [68766, 1], // draft pool
      [70464, 1],
      [70466, 2], // a deck saved in a request whose body is JSON inside a string
      [72401, 1], // command zone
      [77521, 5], // 4 main + 1 sideboard of the same deck
      [77584, 2],
      [79417, 1], // bot draft pick, ids as strings
      [80858, 2], // twice in one pool
      [93917, 1],
      [98688, 1],
    ]);
  });

  it('leaves out decks that are not the player\'s own: Arena\'s ready-made and event decks', () => {
    const cards = parseArenaLog(LOG).cards;
    for (const id of [55555, 66666, 66667, 77777]) expect(cards.has(id), String(id)).toBe(false);
  });

  it('reads the older deck keys too, and counts a deck whose name is unknown', () => {
    const old = '{"DeckSummariesV2":[{"DeckId":"a","Name":"Mine"},{"DeckId":"b","Name":"?=?Loc/Decks/Precon/X"}],"Decks":{"a":{"MainDeck":[{"cardId":1,"quantity":2}]},"b":{"MainDeck":[{"cardId":2,"quantity":2}]},"c":{"MainDeck":[{"cardId":3,"quantity":1}]}}}';
    expect(sorted(parseArenaLog(old).cards)).toEqual([[1, 2], [3, 1]]);
  });

  it('takes the largest count seen in one deck or pool, not the sum over decks', () => {
    const deck = (qty: number) => `<== StartHook(x)\n{"Decks":{"d${qty}":{"MainDeck":[{"cardId":60235,"quantity":${qty}}]}}}`;
    expect(sorted(parseArenaLog(['DETAILED LOGS: ENABLED', deck(1), deck(3), deck(2)].join('\n')).cards)).toEqual([[60235, 3]]);
  });

  it('reports detailed logging as off, and as unknown when the log does not say', () => {
    expect(parseArenaLog('DETAILED LOGS: DISABLED\nsomething').detailedLogs).toBe(false);
    const silent = parseArenaLog('nothing useful\n');
    expect(silent.detailedLogs).toBeNull();
    expect(silent.cards.size).toBe(0);
  });

  describe('wildcards', () => {
    // Shapes copied from a real Player.log (other inventory keys trimmed).
    const full = '{ "InventoryInfo": { "SeqId": 36, "Gems": 100, "TotalVaultProgress": 2, "WcTrackPosition": 1, "WildCardCommons": 12, "WildCardUnCommons": 12, "WildCardRares": 1, "WildCardMythics": 3, "CustomTokens": { "Token_JumpIn": 5 } } }';
    const noMythic = '{"Course":{"CourseId":"c0b6","InternalEventName":"X"},"InventoryInfo":{"SeqId":23,"Changes":[],"Gems":100,"TotalVaultProgress":2,"wcTrackPosition":1,"WildCardCommons":12,"WildCardUnCommons":13,"WildCardRares":1,"Boosters":[]}}';

    it('reads the four wildcard counts from InventoryInfo', () => {
      expect(parseArenaLog(full).wildcards).toEqual({ common: 12, uncommon: 12, rare: 1, mythic: 3 });
    });

    it('counts a missing key as 0 (no mythic key while the player has none)', () => {
      expect(parseArenaLog(noMythic).wildcards).toEqual({ common: 12, uncommon: 13, rare: 1, mythic: 0 });
    });

    it('keeps the last InventoryInfo of the log', () => {
      expect(parseArenaLog([full, 'other line', noMythic].join('\n')).wildcards).toEqual({ common: 12, uncommon: 13, rare: 1, mythic: 0 });
      expect(parseArenaLog([noMythic, full].join('\n')).wildcards?.mythic).toBe(3);
    });

    it('dates the inventory by the logger line Arena writes before it (local time), null when there is none it can read', () => {
      const stamped = (stamp: string) => [`[UnityCrossThreadLogger]${stamp}`, '<== StartHook(abc)', full].join('\n');
      expect(parseArenaLog(stamped('11/25/2026 9:22:02 PM')).wildcardsAt).toBe(new Date(2026, 10, 25, 21, 22, 2).getTime());
      expect(parseArenaLog(stamped('11/25/2026 12:05:09 AM')).wildcardsAt).toBe(new Date(2026, 10, 25, 0, 5, 9).getTime());
      // The last inventory's own header, not a later one.
      const later = [stamped('11/25/2026 9:22:02 PM'), '[UnityCrossThreadLogger]11/25/2026 11:00:00 PM', 'other'].join('\n');
      expect(parseArenaLog(later).wildcardsAt).toBe(new Date(2026, 10, 25, 21, 22, 2).getTime());
      expect(parseArenaLog(full).wildcardsAt).toBeNull();
      expect(parseArenaLog(stamped('25.11.2026 21:22:02')).wildcardsAt).toBeNull(); // a format it cannot be sure of
    });

    it('ignores an InventoryInfo that is not a full inventory, and is null without one', () => {
      expect(parseArenaLog([full, '{"InventoryInfo":{"SeqId":40,"Changes":[{"Source":"X"}]}}'].join('\n')).wildcards?.mythic).toBe(3);
      expect(parseArenaLog('{"InventoryInfo":{"SeqId":40}}').wildcards).toBeNull();
      expect(parseArenaLog('DETAILED LOGS: ENABLED\nno inventory here').wildcards).toBeNull();
    });

    it('finds the inventory in the fixture log, beside its decks', () => {
      expect(parseArenaLog(LOG).wildcards).toEqual({ common: 4, uncommon: 3, rare: 1, mythic: 0 });
    });
  });

  it('ignores card ids and quantities that are not positive whole numbers', () => {
    const text = '{"Decks":{"d":{"MainDeck":[{"cardId":0,"quantity":1},{"cardId":5,"quantity":-2},{"cardId":"x","quantity":1},{"cardId":7,"quantity":1.5},{"cardId":9,"quantity":1}]}},"CardPool":[0,-3,"abc",11]}';
    expect(sorted(parseArenaLog(text).cards)).toEqual([[9, 1], [11, 1]]);
  });
});
