import { describe, expect, it } from 'vitest';
import { availableCopies, conflicts, type Holder } from '@/engine/collection/conflicts';
import type { Deck } from '@/engine/types';
import { card, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const id = (name: string) => card(name).oracleId;

function deck(over: Omit<Partial<Deck>, 'main'> & { main?: { name: string; qty: number }[] } = {}): Deck {
  const { main = [], ...rest } = over;
  return {
    id: 'd1', name: 'Test', commanders: [id('Krenko, Mob Boss')], companion: null, chosenColor: null,
    main: main.map((m) => ({ oracleId: id(m.name), qty: m.qty, locked: false })),
    targetBracket: 3, themeWeights: null, ...rest,
  };
}
const holder = (hid: string, kind: 'box' | 'deck', name: string, cards: [string, number][]): Holder => ({
  id: hid, kind, name, cards: new Map(cards.map(([n, q]) => [id(n), q])),
});
const none: ReadonlySet<string> = new Set();

describe('conflicts', () => {
  it('no conflict when a free copy covers the need', () => {
    const totals = new Map([[id('Sol Ring'), 2]]);
    const holders = [holder('box:1', 'box', 'Landing Party box', [['Sol Ring', 1]])];
    const report = conflicts(deck({ main: [{ name: 'Sol Ring', qty: 1 }] }), totals, holders, none, db);
    expect(report.cards).toEqual({});
    expect(report.byHolder).toEqual([]);
    expect(availableCopies(totals, holders, none).get(id('Sol Ring'))).toBe(1);
  });

  it('conflict names the box and the built deck that hold the card', () => {
    const totals = new Map([[id('Sol Ring'), 2]]);
    const holders = [
      holder('box:1', 'box', 'Landing Party box', [['Sol Ring', 1]]),
      holder('deck:b', 'deck', 'Krenko, Mob Boss (built)', [['Sol Ring', 1]]),
    ];
    const report = conflicts(deck({ main: [{ name: 'Sol Ring', qty: 1 }] }), totals, holders, none, db);
    expect(report.cards).toEqual({ [id('Sol Ring')]: ['Landing Party box', 'Krenko, Mob Boss (built)'] });
    expect(report.byHolder.map((h) => h.holderId).sort()).toEqual(['box:1', 'deck:b']);
    expect(report.byHolder[0]).toMatchObject({ oracleIds: [id('Sol Ring')] });
  });

  it('a deck never conflicts with itself or its linked box', () => {
    const totals = new Map([[id('Sol Ring'), 1]]);
    const holders = [
      holder('box:1', 'box', 'Landing Party box', [['Sol Ring', 1]]),
      holder('deck:d1', 'deck', 'Test (built)', [['Sol Ring', 1]]),
    ];
    const self = new Set(['deck:d1', 'box:1']);
    const report = conflicts(deck({ main: [{ name: 'Sol Ring', qty: 1 }] }), totals, holders, self, db);
    expect(report.cards).toEqual({});
  });

  it('over-committed built decks both show the card', () => {
    const totals = new Map([[id('Sol Ring'), 1]]);
    const a = holder('deck:a', 'deck', 'A (built)', [['Sol Ring', 1]]);
    const b = holder('deck:b', 'deck', 'B (built)', [['Sol Ring', 1]]);
    const d = (self: string) => ({ deck: deck({ id: self, main: [{ name: 'Sol Ring', qty: 1 }] }), self: new Set([`deck:${self}`]) });
    const ra = conflicts(d('a').deck, totals, [a, b], d('a').self, db);
    const rb = conflicts(d('b').deck, totals, [a, b], d('b').self, db);
    expect(ra.cards[id('Sol Ring')]).toEqual(['B (built)']);
    expect(rb.cards[id('Sol Ring')]).toEqual(['A (built)']);
    expect(availableCopies(totals, [a, b], none).get(id('Sol Ring'))).toBe(-1);
  });

  it('basic lands never conflict', () => {
    const totals = new Map([[id('Forest'), 30]]);
    const holders = [holder('box:1', 'box', 'Landing Party box', [['Forest', 30]])];
    expect(conflicts(deck({ main: [{ name: 'Forest', qty: 30 }] }), totals, holders, none, db).cards).toEqual({});
  });

  it('copy-limit cards count every copy', () => {
    const totals = new Map([[id('Relentless Rats'), 20]]);
    const holders = [holder('box:1', 'box', 'X box', [['Relentless Rats', 5]])];
    const report = conflicts(deck({ main: [{ name: 'Relentless Rats', qty: 20 }] }), totals, holders, none, db);
    expect(report.cards[id('Relentless Rats')]).toEqual(['X box']);
  });

  it('unowned cards are not conflicts', () => {
    const totals = new Map<string, number>();
    const holders = [holder('box:1', 'box', 'X box', [['Sol Ring', 1]])];
    expect(conflicts(deck({ main: [{ name: 'Sol Ring', qty: 1 }] }), totals, holders, none, db).cards).toEqual({});
  });
});
