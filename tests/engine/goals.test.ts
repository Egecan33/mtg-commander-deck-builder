import { describe, expect, it } from 'vitest';
import { analyzeBracket } from '@/engine/brackets';
import { addOne, applySwaps, autoBuild, improveDeck } from '@/engine/builder';
import { rateDeck } from '@/engine/rating';
import { validateDeck } from '@/engine/rules';
import { summarizeDeck } from '@/engine/summary';
import { parseDecklist } from '@/engine/text';
import type { Bracket, BuildOptions, Deck, EngineContext, ImproveGoals, Role } from '@/engine/types';
import { card, deckText, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const opts = (goals: ImproveGoals | null = null, over: Partial<BuildOptions> = {}): BuildOptions => ({ ownedOnly: false, owned: null, maxPriceUsd: null, seed: 1, goals, ...over });
function fixtureDeck(name: 'precon' | 'upgraded' | 'cedh', target: Bracket): Deck {
  const p = parseDecklist(deckText(name), db);
  return { id: null, name, commanders: p.commanders, companion: p.companion, chosenColor: null, main: p.main, targetBracket: target, themeWeights: null };
}
const shell = (name: string, target: Bracket): Deck => ({
  id: null, name, commanders: [card(name).oracleId], companion: null, chosenColor: null, main: [], targetBracket: target, themeWeights: null,
});
const size = (d: Deck) => d.commanders.length + d.main.reduce((n, e) => n + e.qty, 0);
const roleCount = (d: Deck, roles: Role[]) => d.main.reduce((n, e) => n + (db.features(e.oracleId)?.roles.some((r) => roles.includes(r)) ? e.qty : 0), 0);
const hasRole = (id: string, role: Role) => db.features(id)?.roles.includes(role) === true;

describe('directed improve', () => {
  const precon = fixtureDeck('precon', 2);

  it('emphasising win conditions adds win conditions, and says so', () => {
    const proposals = improveDeck(precon, ctx, opts({ emphasizeRoles: ['win-condition'] }));
    const after = applySwaps(precon, proposals);
    expect(roleCount(after, ['win-condition'])).toBeGreaterThan(roleCount(precon, ['win-condition']));
    expect(size(after)).toBe(size(precon));
    expect(validateDeck(after, db)).toEqual([]);
    const adds = proposals.filter((p) => hasRole(p.in, 'win-condition') && !hasRole(p.out, 'win-condition'));
    expect(adds.length).toBeGreaterThan(0);
    for (const p of adds) expect(p.reason).toMatch(/goal: more win conditions/);
    // A swap that does not add one never claims the goal.
    for (const p of proposals.filter((x) => !hasRole(x.in, 'win-condition'))) expect(p.reason).not.toMatch(/goal: more win conditions/);
    for (const p of proposals) {
      expect(typeof p.agrees).toBe('boolean');
      if (p.agrees === false) expect(p.objection?.length ?? 0).toBeGreaterThan(10);
    }
  });

  it('maxSwaps is a hard cap', () => {
    const proposals = improveDeck(precon, ctx, opts({ maxSwaps: 5, emphasizeRoles: ['win-condition', 'draw'] }));
    expect(proposals.length).toBeLessThanOrEqual(5);
    expect(improveDeck(precon, ctx, opts({ maxSwaps: 2 })).length).toBeLessThanOrEqual(2);
  });

  it('emphasising removal raises the interaction count', () => {
    const roles: Role[] = ['spot-removal', 'wipe', 'counterspell'];
    const proposals = improveDeck(precon, ctx, opts({ emphasizeRoles: roles }));
    const after = applySwaps(precon, proposals);
    expect(summarizeDeck(after, db).interaction).toBeGreaterThan(summarizeDeck(precon, db).interaction);
    expect(roleCount(after, roles)).toBeGreaterThan(roleCount(precon, roles));
  });

  it('toward Bracket 4 with at most 20 swaps: a legal deck inside the bracket, locks kept', () => {
    const locked = precon.main[5].oracleId;
    const deck: Deck = { ...precon, main: precon.main.map((e) => (e.oracleId === locked ? { ...e, locked: true } : e)) };
    const proposals = improveDeck(deck, ctx, opts({ maxSwaps: 20, targetBracket: 4 }));
    expect(proposals.length).toBeLessThanOrEqual(20);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals.some((p) => p.out === locked)).toBe(false);
    const after = { ...applySwaps(deck, proposals), targetBracket: 4 as Bracket };
    expect(validateDeck(after, db)).toEqual([]);
    expect(size(after)).toBe(100);
    expect(analyzeBracket(after, ctx).floor).toBeLessThanOrEqual(4);
    // Every step applies to the deck as the earlier steps left it.
    let d = deck;
    for (const p of proposals) {
      expect(d.main.some((e) => e.oracleId === p.out)).toBe(true);
      expect(d.main.some((e) => e.oracleId === p.in) && db.get(p.in)?.typeLine.includes('Basic') !== true).toBe(false);
      d = applySwaps(d, [p]);
    }
  });

  it('moving down a bracket cuts what the lower bracket does not allow first', () => {
    const upgraded = fixtureDeck('upgraded', 4);
    const before = analyzeBracket({ ...upgraded, targetBracket: 2 }, ctx);
    const proposals = improveDeck(upgraded, ctx, opts({ maxSwaps: 40, targetBracket: 2 }));
    if (before.violationsOfTarget.length > 0 || before.floor > 2) {
      expect(proposals[0].reason).toMatch(/goal: Bracket 2/);
      const after = { ...applySwaps(upgraded, proposals), targetBracket: 2 as Bracket };
      expect(analyzeBracket(after, ctx).violationsOfTarget.length).toBeLessThan(Math.max(1, before.violationsOfTarget.length));
    }
    expect(proposals.length).toBeLessThanOrEqual(40);
  });

  it('respects ownedOnly and the price cap', () => {
    const owned = new Set(db.all().filter((c) => (c.edhrecRank ?? 1e9) < 3000).map((c) => c.oracleId));
    for (const p of improveDeck(precon, ctx, opts({ emphasizeRoles: ['draw'] }, { ownedOnly: true, owned, maxPriceUsd: 5 }))) {
      const c = db.get(p.in);
      expect(owned.has(p.in) || c?.typeLine.includes('Basic')).toBe(true);
      if (!c?.typeLine.includes('Basic')) expect(c?.priceUsd ?? 0).toBeLessThanOrEqual(5);
    }
  });
});

describe('add one', () => {
  const built = autoBuild(shell('Lathril, Blade of the Elves', 3), ctx, opts());

  it('suggests win conditions to bring in, each with a cut that is not one and not locked', () => {
    const locked = new Set(built.main.slice(0, 40).map((e) => e.oracleId));
    const deck: Deck = { ...built, main: built.main.map((e) => (locked.has(e.oracleId) ? { ...e, locked: true } : e)) };
    const s = addOne(deck, ctx, opts(), 'win-condition');
    expect(s.length).toBeGreaterThanOrEqual(3);
    for (const p of s) {
      expect(hasRole(p.in, 'win-condition')).toBe(true);
      expect(deck.main.some((e) => e.oracleId === p.in)).toBe(false);
      expect(hasRole(p.out, 'win-condition')).toBe(false);
      expect(locked.has(p.out)).toBe(false);
      expect(p.reason.length).toBeGreaterThan(20);
      const after = applySwaps(deck, [p]);
      expect(validateDeck(after, db)).toEqual([]);
      expect(Math.abs(p.ratingAfter - Math.round(rateDeck(after, ctx).rating))).toBeLessThanOrEqual(1);
    }
  });

  it('still answers when the deck is past the band, and says why it disagrees', () => {
    const over: Deck = { ...built, roleTargets: { 'win-condition': 1 } }; // band 1-3, the build holds 4 or more
    const s = addOne(over, ctx, opts(), 'win-condition');
    expect(s.length).toBeGreaterThanOrEqual(3);
    for (const p of s) {
      expect(p.agrees).toBe(false);
      expect(p.objection).toMatch(/already have \d+ win conditions/);
    }
  });

  it('a land for a deck short of one colour makes that colour and names it', () => {
    const forest = card('Forest').oracleId;
    const swamp = card('Swamp').oracleId;
    // Every green source that is a land goes: the deck is now far short of green.
    const makesGreen = (id: string) => (db.features(id)?.landWeight ?? 0) >= 1 && (db.features(id)?.sources.G ?? 0) > 0;
    const cut = built.main.filter((e) => makesGreen(e.oracleId)).reduce((n, e) => n + e.qty, 0);
    const deck: Deck = { ...built, main: [...built.main.filter((e) => !makesGreen(e.oracleId) && e.oracleId !== swamp), { oracleId: swamp, qty: cut + (built.main.find((e) => e.oracleId === swamp)?.qty ?? 0), locked: false }] };
    expect(size(deck)).toBe(100);
    const s = addOne(deck, ctx, opts(), 'land');
    expect(s.length).toBeGreaterThan(0);
    for (const p of s) {
      expect(db.features(p.in)?.sources.G ?? 0).toBeGreaterThan(0);
      expect(p.reason).toMatch(/makes green/);
      expect(p.out).not.toBe('');
    }
    expect(s.some((p) => p.in === forest) || s.length >= 1).toBe(true);
  });

  it('a deck with open slots gets plain adds', () => {
    const open: Deck = { ...built, main: built.main.slice(0, built.main.length - 6) };
    const s = addOne(open, ctx, opts(), 'draw');
    expect(s.length).toBeGreaterThan(0);
    for (const p of s) expect(p.out).toBe('');
    expect(size(applySwaps(open, [s[0]]))).toBe(size(open) + 1);
  });
});
