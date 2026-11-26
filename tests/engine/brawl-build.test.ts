import { beforeAll, describe, expect, it } from 'vitest';
import {
  addOne, autoBuild, buyTiers, fillRest, fixDeck, improveDeck, replaceCard, suggestSwaps, swapIn,
} from '@/engine/builder';
import { validateDeck, deckSize, isBasicLand } from '@/engine/rules';
import type { BuildOptions, Card, Deck, EngineContext, SwapProposal, Wildcards } from '@/engine/types';
import { toCraft, wildcardsNeeded } from '@/engine/wildcards';
import { brawlFixtureDb, card } from '../helpers/fixture-db';

/* Every build path, on the Brawl view of the fixture: Arena cards only, and inside the wildcards. */

const db = brawlFixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const COMMANDER = 'Lathril, Blade of the Elves';
const shell = (): Deck => ({
  id: null, name: 't', commanders: [card(COMMANDER).oracleId], companion: null, chosenColor: null, main: [], targetBracket: 3, themeWeights: null,
});
const inIdentity = (c: Card) => c.colorIdentity.every((k) => k === 'B' || k === 'G');
const pool = db.all().filter(inIdentity);
/** Owned: the commander and every common and uncommon of its colours, no rare or mythic. */
const ownedPlain = new Set<string>([card(COMMANDER).oracleId, ...pool.filter((c) => c.arenaRarity === 'common' || c.arenaRarity === 'uncommon').map((c) => c.oracleId)]);
const NO_MYTHIC: Wildcards = { common: 99, uncommon: 99, rare: 99, mythic: 0 };
const opts = (extra: Partial<BuildOptions> = {}): BuildOptions => ({ ownedOnly: false, owned: ownedPlain, maxPriceUsd: null, seed: 7, ...extra });

const ids = (deck: Deck) => [...deck.commanders, ...deck.main.map((e) => e.oracleId)];
const onArena = (id: string) => (db.get(id)?.arenaRarity ?? null) !== null;
const unownedMythic = (id: string, owned: ReadonlySet<string>) => {
  const c = db.get(id);
  return !!c && c.arenaRarity === 'mythic' && !owned.has(id) && !isBasicLand(c);
};
const ins = (ps: SwapProposal[]) => ps.map((p) => p.in).filter((id) => id !== '');

let full: Deck;
beforeAll(() => {
  full = autoBuild(shell(), ctx, opts({ seed: 1 }));
});

describe('Brawl builds use Arena cards only', () => {
  it('builds a legal 100-card Brawl deck with no card missing from Arena', () => {
    expect(deckSize(full)).toBe(100);
    expect(validateDeck(full, db)).toEqual([]);
    expect(ids(full).filter((id) => !onArena(id))).toEqual([]);
  });

  it('fills, swaps, improves, adds, replaces and swaps in only Arena cards', () => {
    const half: Deck = { ...full, main: full.main.slice(0, 40) };
    expect(ids(fillRest(half, ctx, opts())).filter((id) => !onArena(id))).toEqual([]);
    expect(ins(suggestSwaps(full, ctx, opts(), 5)).filter((id) => !onArena(id))).toEqual([]);
    expect(ins(improveDeck(full, ctx, opts(), 10)).filter((id) => !onArena(id))).toEqual([]);
    expect(ins(improveDeck(full, ctx, opts({ goals: { maxSwaps: 8, emphasizeRoles: ['draw'] } }), 8)).filter((id) => !onArena(id))).toEqual([]);
    expect(ins(addOne(full, ctx, opts(), 'ramp', 5)).filter((id) => !onArena(id))).toEqual([]);
    const out = full.main.find((e) => !isBasicLand(db.get(e.oracleId)!))!.oracleId;
    expect(ins(replaceCard(full, ctx, opts(), out, 6)).filter((id) => !onArena(id))).toEqual([]);
    expect(swapIn(full, ctx, opts(), card('Sol Ring').oracleId, 5)).toEqual([]);
  });

  it('fixes a non-Arena card out of a Brawl deck with an Arena card', () => {
    const out = full.main.find((e) => !isBasicLand(db.get(e.oracleId)!))!.oracleId;
    const broken: Deck = { ...full, main: [...full.main.filter((e) => e.oracleId !== out), { oracleId: card('Sol Ring').oracleId, qty: 1, locked: false }] };
    expect(validateDeck(broken, db).map((v) => v.code)).toContain('not-on-arena');
    const r = fixDeck(broken, ctx, opts());
    expect(ids(r.deck)).not.toContain(card('Sol Ring').oracleId);
    expect(ids(r.deck).filter((id) => !onArena(id))).toEqual([]);
    expect(validateDeck(r.deck, db)).toEqual([]);
  });

  it('keeps the Best from collection tiers on Arena cards', () => {
    const tiers = buyTiers(full, ctx, ownedPlain, [0, 5]);
    for (const t of tiers) expect(ids(t.deck).filter((id) => !onArena(id))).toEqual([]);
  });
});

describe('wildcard caps ("Only what I can craft")', () => {
  it('lets no unowned mythic into a build with 0 mythic wildcards', () => {
    for (const seed of [1, 2, 3]) {
      const deck = autoBuild(shell(), ctx, opts({ seed, wildcards: NO_MYTHIC }));
      expect(deckSize(deck)).toBe(100);
      expect(ids(deck).filter((id) => unownedMythic(id, ownedPlain))).toEqual([]);
    }
    // Without the cap the same pool does reach for mythics, so the test can fail.
    expect(ids(full).filter((id) => unownedMythic(id, ownedPlain)).length).toBeGreaterThan(0);
  });

  it('keeps every proposal mode free of unowned mythics with 0 mythic wildcards', () => {
    const o = opts({ wildcards: NO_MYTHIC });
    const base = autoBuild(shell(), ctx, opts({ seed: 4, wildcards: NO_MYTHIC }));
    const half: Deck = { ...base, main: base.main.slice(0, 30) };
    const all = [
      ...ids(fillRest(half, ctx, o)),
      ...ins(suggestSwaps(base, ctx, o, 5)),
      ...ins(improveDeck(base, ctx, o, 10)),
      ...ins(improveDeck(base, ctx, { ...o, goals: { maxSwaps: 8, emphasizeRoles: ['ramp'] } }, 8)),
      ...ins(addOne(base, ctx, o, 'draw', 5)),
      ...ids(fixDeck(base, ctx, o).deck),
    ];
    expect(all.filter((id) => unownedMythic(id, ownedPlain))).toEqual([]);
    const mythic = pool.find((c) => c.arenaRarity === 'mythic' && !ownedPlain.has(c.oracleId) && !ids(base).includes(c.oracleId))!;
    expect(swapIn(base, ctx, o, mythic.oracleId, 5)).toEqual([]);
  });

  it('stays within every rarity of a small budget, counting the cards it needs', () => {
    const have: Wildcards = { common: 5, uncommon: 3, rare: 2, mythic: 0 };
    const owned = new Set([card(COMMANDER).oracleId, ...pool.filter((c) => c.arenaRarity === 'common').map((c) => c.oracleId)]);
    const deck = autoBuild(shell(), ctx, opts({ owned, wildcards: have }));
    const need = wildcardsNeeded(deck, db, owned);
    for (const r of ['common', 'uncommon', 'rare', 'mythic'] as const) expect(need[r], r).toBeLessThanOrEqual(have[r]);
    expect(need.rare + need.uncommon).toBeGreaterThan(0); // the budget was used, not ignored
  });

  it('always allows owned cards, whatever the wildcards', () => {
    const mythics = pool.filter((c) => c.arenaRarity === 'mythic').map((c) => c.oracleId);
    const owned = new Set([...ownedPlain, ...mythics]);
    const deck = autoBuild(shell(), ctx, opts({ owned, wildcards: { common: 0, uncommon: 0, rare: 0, mythic: 0 } }));
    expect(deckSize(deck)).toBe(100);
    expect(wildcardsNeeded(deck, db, owned)).toEqual({ common: 0, uncommon: 0, rare: 0, mythic: 0 });
    expect(ids(deck).some((id) => mythics.includes(id))).toBe(true);
  });

  it('counts an unowned commander, ignores basics and lists the printing to craft', () => {
    const deck: Deck = { ...shell(), main: [{ oracleId: card('Forest').oracleId, qty: 10, locked: false }, { oracleId: card('Infernal Grasp').oracleId, qty: 1, locked: false }] };
    const need = wildcardsNeeded(deck, db, new Set());
    expect(need).toEqual({ common: 0, uncommon: 1, rare: 1, mythic: 0 }); // Lathril is rare, Infernal Grasp uncommon
    const crafts = toCraft(deck, db, new Set());
    expect(crafts.map((c) => c.oracleId)).toEqual([card(COMMANDER).oracleId, card('Infernal Grasp').oracleId]);
    expect(crafts[1]).toMatchObject({ rarity: 'uncommon', set: card('Infernal Grasp').arenaPrinting?.set, number: card('Infernal Grasp').arenaPrinting?.number });
  });
});
