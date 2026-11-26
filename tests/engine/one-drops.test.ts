import { describe, expect, it } from 'vitest';
import { autoBuild, fixDeck } from '@/engine/builder';
import { deckNetwork } from '@/engine/network';
import { oneDropsOf, rateDeck } from '@/engine/rating';
import { ONE_DROP_CREATURES, ONE_DROP_EDGE, ONE_DROP_MAX, ONE_DROP_MIN, isOneDrop, isOneDropShape, oneDropWant } from '@/engine/targets';
import { parseDecklist } from '@/engine/text';
import type { Bracket, BuildOptions, Deck, EngineContext } from '@/engine/types';
import { card, deckText, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({ ownedOnly: false, owned: null, maxPriceUsd: null, seed: 1, ...over });
const feats = (name: string) => db.features(card(name).oracleId)!;
const tags = (name: string) => db.tagSlugs?.(card(name).oracleId) ?? [];

function fixtureDeck(name: 'precon' | 'upgraded' | 'cedh', target: Bracket = 3): Deck {
  const p = parseDecklist(deckText(name), db);
  return { id: null, name, commanders: p.commanders, companion: p.companion, chosenColor: null, main: p.main, targetBracket: target, themeWeights: null };
}
const size = (d: Deck) => d.commanders.length + d.main.reduce((n, e) => n + e.qty, 0);
/** The deck without the cards of these ids. */
const withoutIds = (d: Deck, ids: string[]): Deck => ({ ...d, main: d.main.filter((e) => !ids.includes(e.oracleId)) });
/** One more copy of each named card, in place of that many Forests, so the deck stays at 100. */
const withCards = (d: Deck, names: string[]): Deck => {
  const forest = card('Forest').oracleId;
  let n = names.length;
  const main = d.main.map((e) => (e.oracleId === forest && e.qty > n ? { ...e, qty: e.qty - n } : e));
  if (main.every((e, i) => e === d.main[i])) n = 0;
  return { ...d, main: [...main, ...names.map((x) => ({ oracleId: card(x).oracleId, qty: 1, locked: false }))] };
};
const curveFix = (d: Deck) => rateDeck(d, ctx).subscores.find((s) => s.key === 'curve')!.fixes.find((f) => f.filter?.creature === true);
const curveValue = (d: Deck) => rateDeck(d, ctx).subscores.find((s) => s.key === 'curve')!.value;

/** The upgraded Lathril deck with every one-drop that counts taken out: a creature deck with no turn-1 play. */
function bare(): Deck {
  const d = fixtureDeck('upgraded');
  const names = new Set(oneDropsOf(d, ctx).names);
  const cut = withoutIds(d, [...names].map((n) => card(n).oracleId));
  return { ...cut, main: [...cut.main, { oracleId: card('Forest').oracleId, qty: size(d) - size(cut), locked: false }] }; // full again
}

describe('one-drop definition', () => {
  it('needs a nonland creature of mana value 1 or less on its front face', () => {
    expect(isOneDropShape(card('Llanowar Elves'), feats('Llanowar Elves'))).toBe(true);
    expect(isOneDropShape(card('Walking Ballista'), feats('Walking Ballista'))).toBe(true); // mana value 0
    expect(isOneDropShape(card('Sol Ring'), feats('Sol Ring'))).toBe(false);               // not a creature
    expect(isOneDropShape(card("Eshki, Temur's Roar"), feats("Eshki, Temur's Roar"))).toBe(false); // three mana
  });

  it('does not count a vanilla, off-plan one-drop, but counts a mana dork', () => {
    expect(isOneDrop(card('Delver of Secrets'), feats('Delver of Secrets'), tags('Delver of Secrets'), 3, false)).toBe(false);
    expect(isOneDrop(card('Llanowar Elves'), feats('Llanowar Elves'), tags('Llanowar Elves'), 3, false)).toBe(true); // ramp: a core role
    // In a deck: Delver of Secrets connects to nothing in an elf deck, a mana dork counts.
    expect(oneDropsOf(withCards(bare(), ['Delver of Secrets']), ctx).names).not.toContain('Delver of Secrets // Insectile Aberration');
    expect(oneDropsOf(withCards(bare(), ['Llanowar Elves']), ctx).names).toContain('Llanowar Elves');
  });

  it("counts a typal one-drop of the commander's type through the network", () => {
    const d = withCards(bare(), ['Joraga Warcaller']);
    expect(oneDropsOf(d, ctx).names).toContain('Joraga Warcaller');
    // the same card, no role, with nothing connecting it, is not a one-drop
    expect(isOneDrop(card('Joraga Warcaller'), feats('Joraga Warcaller'), tags('Joraga Warcaller'), 3, false)).toBe(false);
  });
});

describe('one-drop edges', () => {
  const edgesOf = (d: Deck, name: string) => deckNetwork(d, ctx).edges.filter((e) => (e.a === card(name).oracleId || e.b === card(name).oracleId) && e.kind !== 'commander' && e.weight >= ONE_DROP_EDGE);

  it('counts Llanowar Elves (ramp, and typal in an elf deck) but not a one-drop with no role and no edge', () => {
    const elves = withCards(bare(), ['Llanowar Elves']);
    expect(edgesOf(elves, 'Llanowar Elves').length).toBeGreaterThan(0);
    expect(oneDropsOf(elves, ctx).names).toContain('Llanowar Elves');
    const delver = withCards(bare(), ['Delver of Secrets']);
    expect(edgesOf(delver, 'Delver of Secrets')).toHaveLength(0);
    expect(oneDropsOf(delver, ctx).names).toEqual([]);
  });

  it('does not count a commander spoke as a link', () => {
    // Ragavan has no edge but the commander spoke; it counts through its ramp role (Treasure), not through a link.
    const rag = withCards(bare(), ['Ragavan, Nimble Pilferer']);
    expect(edgesOf(rag, 'Ragavan, Nimble Pilferer')).toHaveLength(0);
    expect(isOneDrop(card('Ragavan, Nimble Pilferer'), feats('Ragavan, Nimble Pilferer'), tags('Ragavan, Nimble Pilferer'), 3, false)).toBe(true);
    expect(ONE_DROP_EDGE).toBe(0.3);
  });
});

describe('one-drop target', () => {
  it('is 2-4 from 12 nonland creatures, none below, and scales with the fill', () => {
    expect(oneDropWant(ONE_DROP_CREATURES, 1)).toEqual({ lo: ONE_DROP_MIN, hi: ONE_DROP_MAX });
    expect(oneDropWant(ONE_DROP_CREATURES - 1, 1)).toBeNull();
    expect(oneDropWant(0, 1)).toBeNull();
    expect(oneDropWant(6, 0.5)).toEqual({ lo: 1, hi: 2 });
    expect(oneDropWant(5, 0.5)).toBeNull();
    expect(oneDropWant(30, 0.1)).toBeNull(); // too empty to ask for a one-drop
  });

  it('asks a creature deck for one-drops and a deck under 12 creatures for none', () => {
    const d = bare();
    const have = oneDropsOf(d, ctx).creatures;
    expect(have).toBeGreaterThanOrEqual(ONE_DROP_CREATURES);
    expect(curveFix(d)).toBeDefined();
    // cut creatures down to 11: no target, no fix
    const creatureIds = d.main.filter((e) => /\bCreature\b/.test(db.get(e.oracleId)!.frontTypeLine) && !db.get(e.oracleId)!.typeLine.includes('Land')).map((e) => e.oracleId);
    const cut = creatureIds.slice(0, have - (ONE_DROP_CREATURES - 1));
    const cutDeck = withoutIds(d, cut);
    const few = { ...cutDeck, main: [...cutDeck.main, { oracleId: card('Forest').oracleId, qty: cut.length, locked: false }] };
    expect(size(few)).toBe(size(d));
    expect(oneDropsOf(few, ctx).creatures).toBe(ONE_DROP_CREATURES - 1);
    expect(curveFix(few)).toBeUndefined();
  });
});

describe('one-drop rating', () => {
  it('names the fix when short and drops it at two', () => {
    const d = bare();
    const none = curveFix(d)!;
    expect(none.text).toBe('No one-mana creature that helps the plan; 2–4 give the deck a turn-1 play.');
    expect(none.filter).toEqual({ creature: true, maxMv: 1 });
    expect(none.actionable).toBe(true);
    expect(curveFix(withCards(d, ['Llanowar Elves']))!.text).toBe('Only 1 one-mana creature that helps the plan; 2–4 give the deck a turn-1 play.');
    expect(curveFix(withCards(d, ['Llanowar Elves', 'Elvish Mystic']))).toBeUndefined();
  });

  it('costs a modest part of the Curve sub-score and nothing above the target', () => {
    const d = bare();
    const two = withCards(d, ['Llanowar Elves', 'Elvish Mystic']);
    const four = withCards(two, ['Fyndhorn Elves', 'Joraga Treespeaker']);
    expect(curveValue(two) - curveValue(d)).toBeGreaterThan(0);
    expect(curveValue(two) - curveValue(d)).toBeLessThanOrEqual(0.1);
    expect(curveValue(four)).toBeGreaterThanOrEqual(curveValue(two) - 0.02); // no upper penalty (the cheap cards move the curve a little)
  });
});

describe('one-drops in the builder and Fix deck', () => {
  it('an auto-build of a creature commander holds at least two one-drops', () => {
    const start: Deck = { ...fixtureDeck('upgraded'), main: [], name: 'Lathril build' };
    const built = autoBuild(start, ctx, opts());
    expect(size(built)).toBe(100);
    const r = oneDropsOf(built, ctx);
    expect(r.creatures).toBeGreaterThanOrEqual(ONE_DROP_CREATURES);
    expect(r.oneDrops).toBeGreaterThanOrEqual(ONE_DROP_MIN);
  });

  it('takes the pool\'s only plan one-drops over higher-scoring cards (the plan quota, not luck)', () => {
    const keep = ['Joraga Treespeaker', 'Joraga Warcaller'].map((n) => card(n).oracleId);
    const isShape = (id: string) => { const c = db.get(id)!; return c.cmc <= 1 && /\bCreature\b/.test(c.frontTypeLine.split('\u2014')[0]) && !c.typeLine.includes('Land'); };
    const owned = new Set(db.all().map((c) => c.oracleId).filter((id) => !isShape(id) || keep.includes(id)));
    const start: Deck = { ...fixtureDeck('upgraded'), main: [], name: 'Lathril owned' };
    const built = autoBuild(start, ctx, opts({ ownedOnly: true, owned }));
    expect(oneDropsOf(built, ctx).oneDrops).toBe(2);
  });

  it("Fix deck with only='curve' brings one-drops into a deck without any", () => {
    const d = bare();
    expect(oneDropsOf(d, ctx).oneDrops).toBe(0);
    const out = fixDeck(d, ctx, opts(), 'curve');
    expect(oneDropsOf(out.deck, ctx).oneDrops).toBeGreaterThanOrEqual(ONE_DROP_MIN);
    expect(out.ratingAfter).toBeGreaterThanOrEqual(out.ratingBefore);
  });
});
