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

  it('ignores card ids and quantities that are not positive whole numbers', () => {
    const text = '{"Decks":{"d":{"MainDeck":[{"cardId":0,"quantity":1},{"cardId":5,"quantity":-2},{"cardId":"x","quantity":1},{"cardId":7,"quantity":1.5},{"cardId":9,"quantity":1}]}},"CardPool":[0,-3,"abc",11]}';
    expect(sorted(parseArenaLog(text).cards)).toEqual([[9, 1], [11, 1]]);
  });
});
