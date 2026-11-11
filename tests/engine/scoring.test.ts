import { describe, expect, it } from 'vitest';
import { createCardDb } from '@/engine/carddb';
import { cardFitsDeck } from '@/engine/rules';
import { STAPLE_FLOOR, createScorer } from '@/engine/scoring';
import { parseDecklist } from '@/engine/text';
import type { Bracket, Card, CardFeatures, CardScore, Deck, DeckEntry, EdhrecData, EngineContext } from '@/engine/types';
import { card, deckText, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const id = (name: string) => card(name).oracleId;
const e = (name: string, qty = 1): DeckEntry => ({ oracleId: id(name), qty, locked: false });

function deck(commanders: string[], main: DeckEntry[], extra: Partial<Deck> = {}): Deck {
  return {
    id: null, name: 'test', commanders: commanders.map(id), companion: null, chosenColor: null,
    main, targetBracket: 3, themeWeights: null, ...extra,
  };
}
const LATHRIL = 'Lathril, Blade of the Elves';
/** A small Lathril shell: a few lands, elves and staples. */
const lathrilMain = (): DeckEntry[] => [
  e('Forest', 8), e('Swamp', 6), e('Command Tower'), e('Llanowar Elves'), e('Sol Ring'), e('Eternal Witness'),
  e('Beast Within'), e('Blood Artist'),
];
const lathril = (extra: Partial<Deck> = {}, main = lathrilMain()) => deck([LATHRIL], main, extra);

const part = (s: CardScore, key: string) => s.parts.find((p) => p.key === key)!;
const partSum = (s: CardScore) => s.parts.reduce((n, p) => n + p.points, 0);

function allFinite(v: unknown): boolean {
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every(allFinite);
  if (v && typeof v === 'object') return Object.values(v).every(allFinite);
  return true;
}

describe('createScorer: gates', () => {
  it('gates a card outside the colour identity with score 0', () => {
    const s = createScorer(lathril(), ctx).score(card('Lightning Bolt'));
    expect(s.gate?.code).toBe('identity');
    expect(s.score).toBe(0);
    expect(s.reasons.length).toBeGreaterThanOrEqual(1);
  });

  it('gates a banned card', () => {
    const s = createScorer(lathril(), ctx).score(card('Black Lotus'));
    expect(s.gate?.code).toBe('banned');
    expect(s.score).toBe(0);
  });

  it('gates Rhystic Study at target 2 and not at target 4', () => {
    const talrand = (target: Bracket) => deck(['Talrand, Sky Summoner'], [e('Island', 20)], { targetBracket: target });
    const low = createScorer(talrand(2), ctx).score(card('Rhystic Study'));
    expect(low.gate?.code).toBe('game-changer');
    expect(low.score).toBe(0);
    const high = createScorer(talrand(4), ctx).score(card('Rhystic Study'));
    expect(high.gate).toBeNull();
    expect(high.score).toBeGreaterThan(50);
  });

  it('gates a second copy of a singleton card but not another basic land', () => {
    const d = lathril({}, [...lathrilMain(), e('Cultivate', 2)]);
    const scorer = createScorer(d, ctx);
    expect(scorer.score(card('Cultivate')).gate?.code).toBe('copy-limit');
    expect(scorer.score(card('Sol Ring')).gate).toBeNull(); // one copy, scored leave-one-out
    expect(scorer.score(card('Forest')).gate).toBeNull();
  });
});

describe('createScorer: scores', () => {
  it('ranks an elf lord well above an off-theme creature of similar popularity', () => {
    const scorer = createScorer(lathril(), ctx);
    const lord = scorer.score(card('Elvish Archdruid'));
    const generic = scorer.score(card('Steel Hellkite'));
    expect(generic.gate).toBeNull();
    expect(lord.score - generic.score).toBeGreaterThanOrEqual(15);
    expect(part(lord, 'synergy').points).toBeGreaterThan(part(generic, 'synergy').points);
    expect(lord.reasons.join(' ')).toMatch(/elf/i);
  });

  it('keeps Sol Ring at or above the staple floor in every deck that allows it', () => {
    expect(STAPLE_FLOOR).toBe(55);
    const full = parseDecklist(deckText('precon'), db);
    const decks: Deck[] = [
      lathril(),
      lathril({ targetBracket: 1 }),
      lathril({ targetBracket: 5 }),
      deck(['Kozilek, the Great Distortion'], []),
      deck(['Kenrith, the Returned King'], []),
      deck([], []),
      // a finished deck with plenty of ramp
      { id: null, name: 'precon', commanders: full.commanders, companion: null, chosenColor: null, main: full.main, targetBracket: 2, themeWeights: null },
    ];
    for (const d of decks) {
      const s = createScorer(d, ctx).score(card('Sol Ring'));
      expect(s.gate).toBeNull();
      expect(s.score).toBeGreaterThanOrEqual(55);
    }
  });

  it('scores Cultivate higher when the deck has no ramp than when it has 14', () => {
    const none = lathril({}, [e('Forest', 8), e('Swamp', 6)]);
    const rampPool = db.all().filter((c) => {
      const f = db.features(c.oracleId)!;
      return c.name !== 'Cultivate' && !c.gameChanger && f.landWeight === 0 && f.roles.includes('ramp') && cardFitsDeck(c, none, db) === null;
    });
    const rampCards = rampPool.slice(0, 14);
    expect(rampCards).toHaveLength(14);
    const plenty = lathril({}, [...none.main, ...rampCards.map((c) => ({ oracleId: c.oracleId, qty: 1, locked: false }))]);
    const a = createScorer(none, ctx).score(card('Cultivate'));
    const b = createScorer(plenty, ctx).score(card('Cultivate'));
    expect(a.score).toBeGreaterThan(b.score);
    expect(part(a, 'role').points).toBeGreaterThan(part(b, 'role').points);
    expect(a.reasons.join(' ')).toMatch(/ramp/i);
    // A full role still has room for a card stronger than what fills it, and none for a weaker one.
    const rank = (c: Card) => c.edhrecRank ?? Infinity;
    const worst = [...rampPool].filter((c) => !rampCards.includes(c)).sort((x, y) => rank(y) - rank(x))[0];
    expect(rank(worst)).toBeGreaterThan(Math.max(...rampCards.map(rank)));
    expect(part(createScorer(plenty, ctx).score(worst), 'role').points).toBe(0);
  });

  it('scores a card in the deck as if it were absent (leave-one-out)', () => {
    for (const name of ['Cultivate', 'Elvish Archdruid', 'Command Tower', 'Swamp', 'Beast Within']) {
      const without = lathril({}, lathrilMain().filter((x) => x.oracleId !== id(name)));
      const withCard = lathril({}, [...without.main.map((x) => ({ ...x })), e(name)]);
      const inDeck = createScorer(withCard, ctx).score(card(name));
      const absent = createScorer(without, ctx).score(card(name));
      expect(inDeck).toEqual(absent);
    }
  });

  it('keeps parts that sum to the score and gives at least one reason', () => {
    for (const d of [lathril(), lathril({ targetBracket: 5 }), deck(['Kenrith, the Returned King'], [e('Sol Ring')], { targetBracket: 1 })]) {
      const all = createScorer(d, ctx).scoreAll();
      for (const s of all) {
        expect(s.reasons.length).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(s.score)).toBe(true);
        expect(s.score).toBeGreaterThanOrEqual(0);
        expect(s.score).toBeLessThanOrEqual(100);
        if (s.gate) { expect(s.score).toBe(0); continue; }
        expect(s.parts.map((p) => p.key).sort()).toEqual(['bracket', 'cast', 'coplay', 'quality', 'role', 'synergy']);
        expect(Math.abs(partSum(s) - s.score)).toBeLessThanOrEqual(1);
        for (const p of s.parts) expect(p.points).toBeLessThanOrEqual(p.max + 1e-9);
      }
      expect(allFinite(all)).toBe(true);
    }
  });

  it('uses the weights 43/0/27/15/10/5 without EDHREC and 35/15/20/15/10/5 with it', () => {
    const maxes = (s: CardScore) => Object.fromEntries(s.parts.map((p) => [p.key, p.max]));
    expect(maxes(createScorer(lathril(), ctx).score(card('Cultivate')))).toEqual({ synergy: 43, coplay: 0, quality: 27, role: 15, cast: 10, bracket: 5 });
    const edhrec: EdhrecData = { commanderDecks: 1000, cards: {}, themes: {} };
    expect(maxes(createScorer(lathril(), { ...ctx, edhrec }).score(card('Cultivate')))).toEqual({ synergy: 35, coplay: 15, quality: 20, role: 15, cast: 10, bracket: 5 });
  });

  it('gives a card with high EDHREC inclusion and lift at least 12 of 15 co-play points', () => {
    const cards: EdhrecData['cards'] = {
      [id('Elvish Archdruid')]: { numDecks: 9000, potentialDecks: 10000, lift: 9 },
      [id('Llanowar Elves')]: { numDecks: 6000, potentialDecks: 10000, lift: 2 },
      [id('Sol Ring')]: { numDecks: 8000, potentialDecks: 10000, lift: 0.1 },
      [id('Eternal Witness')]: { numDecks: 500, potentialDecks: 10000, lift: 0.5 },
    };
    const scorer = createScorer(lathril(), { ...ctx, edhrec: { commanderDecks: 10000, cards, themes: {} } });
    const top = scorer.score(card('Elvish Archdruid'));
    expect(part(top, 'coplay').max).toBe(15);
    expect(part(top, 'coplay').points).toBeGreaterThanOrEqual(12);
    const low = scorer.score(card('Eternal Witness'));
    expect(part(low, 'coplay').points).toBeLessThan(part(top, 'coplay').points);
    const absent = scorer.score(card('Steel Hellkite'));
    expect(part(absent, 'coplay').points).toBeLessThan(6);
    expect(Math.abs(partSum(top) - top.score)).toBeLessThanOrEqual(1);
  });

  it('shrinks co-play data from a tiny sample', () => {
    const one = (n: number): EdhrecData => ({
      commanderDecks: n, themes: {},
      cards: { [id('Steel Hellkite')]: { numDecks: n, potentialDecks: n, lift: 5 } },
    });
    const big = createScorer(lathril(), { ...ctx, edhrec: one(5000) }).score(card('Steel Hellkite'));
    const tiny = createScorer(lathril(), { ...ctx, edhrec: one(4) }).score(card('Steel Hellkite'));
    expect(part(tiny, 'coplay').points).toBeLessThan(part(big, 'coplay').points);
  });
});

describe('createScorer: odd decks', () => {
  it('does not throw on an empty deck with a commander, and ranks on-theme cards first', () => {
    const scorer = createScorer(deck([LATHRIL], []), ctx);
    const all = scorer.scoreAll();
    expect(allFinite(all)).toBe(true);
    // Lands share the scale and a deck with no lands wants them first, so look at the spells.
    const spells = all.filter((s) => db.features(s.oracleId)!.landWeight < 1);
    const top = spells.sort((a, b) => b.score - a.score).slice(0, 10).map((s) => db.get(s.oracleId)!.name);
    expect(top).toContain('Elvish Archdruid');
  });

  it('handles no commander, 37 cards, 104 cards, unknown cards and junk quantities', () => {
    const decks: Deck[] = [
      deck([], []),
      deck([], [e('Forest', 37)]),
      lathril({}, [e('Forest', 60), e('Swamp', 43)]),
      lathril({}, [{ oracleId: 'not-a-card', qty: 3, locked: false }, { oracleId: id('Sol Ring'), qty: Number.NaN, locked: false }, e('Forest', -2)]),
      deck(['Thrasios, Triton Hero', 'Tymna the Weaver'], [], { targetBracket: 5 }),
      deck(['Kozilek, the Great Distortion'], [e('Wastes', 30)]),
      lathril({ themeWeights: {} }),
      lathril({ targetBracket: 9 as Bracket }),
    ];
    for (const d of decks) {
      const all = createScorer(d, ctx).scoreAll();
      expect(all).toHaveLength(db.all().length);
      expect(allFinite(all)).toBe(true);
    }
  });

  it('scores a card that has no features without throwing', () => {
    const bare = createCardDb([card(LATHRIL), card('Cultivate')], [], []);
    const s = createScorer(deck([LATHRIL], []), { ...ctx, db: bare }).score(card('Cultivate'));
    expect(s.gate).toBeNull();
    expect(Number.isFinite(s.score)).toBe(true);
    expect(s.reasons.length).toBeGreaterThanOrEqual(1);
  });

  it('scoreAll returns one entry per card, in database order, and honours the filter', () => {
    const scorer = createScorer(lathril(), ctx);
    const all = scorer.scoreAll();
    expect(all.map((s) => s.oracleId)).toEqual(db.all().map((c) => c.oracleId));
    const lands = scorer.scoreAll((c) => c.typeLine.includes('Land'));
    expect(lands.length).toBeGreaterThan(10);
    expect(lands.length).toBeLessThan(all.length);
    expect(scorer.score(card('Cultivate'))).toEqual(all.find((s) => s.oracleId === id('Cultivate')));
  });

  it('counts theme pieces as a need until the deck has its share', () => {
    const empty = createScorer(deck([LATHRIL], []), ctx).score(card('Imperious Perfect'));
    expect(part(empty, 'role').points).toBeGreaterThan(8);
    expect(empty.reasons.join(' ')).toMatch(/theme cards/);
    const elves = db.all().filter((c) => c.name !== 'Imperious Perfect' && c.typeLine.includes('Elf') && cardFitsDeck(c, deck([LATHRIL], []), db) === null).slice(0, 30);
    expect(elves.length).toBeGreaterThanOrEqual(22);
    const full = deck([LATHRIL], elves.map((c) => ({ oracleId: c.oracleId, qty: 1, locked: false })));
    const later = createScorer(full, ctx).score(card('Imperious Perfect'));
    expect(part(later, 'role').points).toBeLessThan(part(empty, 'role').points);
  });

  it('rates lands by the colours they make and wants fewer once the deck has its lands', () => {
    const scorer = createScorer(deck([LATHRIL], []), ctx);
    const tower = scorer.score(card('Command Tower'));
    const swamp = scorer.score(card('Swamp'));
    const wastes = scorer.score(card('Wastes'));
    expect(tower.score).toBeGreaterThan(swamp.score);
    expect(swamp.score).toBeGreaterThan(wastes.score);
    expect(tower.reasons.join(' ')).toMatch(/colours/);
    const landed = createScorer(deck([LATHRIL], [e('Forest', 20), e('Swamp', 20)]), ctx).score(card('Command Tower'));
    expect(landed.score).toBeLessThan(tower.score);
    expect(landed.reasons.join(' ')).not.toMatch(/short on lands/);
    expect(landed.score).toBe(STAPLE_FLOOR); // only the staple floor holds it up
    expect(landed.reasons.join(' ')).toMatch(/staple/);
  });

  it('marks six-mana spells down at Bracket 5 and says so', () => {
    const big = card('Craterhoof Behemoth');
    const b5 = createScorer(lathril({ targetBracket: 5 }), ctx).score(big);
    const b3 = createScorer(lathril({ targetBracket: 3 }), ctx).score(big);
    expect(part(b5, 'bracket').points).toBeLessThan(0);
    expect(b5.score).toBeLessThan(b3.score);
    expect(b5.reasons.join(' ')).toMatch(/Bracket 5/);
    expect(Math.abs(partSum(b5) - b5.score)).toBeLessThanOrEqual(1);
  });

  it('follows user theme weights over the commander', () => {
    const scorer = createScorer(lathril({ themeWeights: { artifacts: 1 } }), ctx);
    const lord = scorer.score(card('Elvish Archdruid'));
    const base = createScorer(lathril(), ctx).score(card('Elvish Archdruid'));
    expect(part(lord, 'synergy').points).toBeLessThan(part(base, 'synergy').points);
  });
});

describe('createScorer: performance', () => {
  it('scores a 32,000-card pool in under 400 ms once the scorer exists', () => {
    const cards: Card[] = [];
    const features: CardFeatures[] = [];
    const real = db.all();
    for (const c of real) { cards.push(c); features.push(db.features(c.oracleId)!); }
    for (let i = 0; cards.length < 32000; i++) {
      const src = real[i % real.length];
      const oracleId = `clone-${i}`;
      cards.push({ ...src, oracleId, name: `${src.name} #${i}`, frontName: `${src.frontName} #${i}` });
      features.push({ ...db.features(src.oracleId)!, oracleId });
    }
    const big = createCardDb(cards, features, []);
    const bigCtx: EngineContext = { ...ctx, db: big };
    const d = lathril();
    createScorer(d, bigCtx).scoreAll(); // warm-up, fills the per-database cache
    const scorer = createScorer(lathril({}, [...lathrilMain(), e('Cultivate')]), bigCtx);
    const t0 = performance.now();
    const all = scorer.scoreAll();
    const ms = performance.now() - t0;
    expect(all).toHaveLength(32000);
    expect(ms).toBeLessThan(400);
  });
});

describe('createScorer: review fixes', () => {
  it('scores the commander itself instead of gating it as a second copy', () => {
    const scorer = createScorer(lathril(), ctx);
    const s = scorer.score(card(LATHRIL));
    expect(s.gate).toBeNull();
    expect(s.score).toBeGreaterThan(40);
    expect(Math.abs(partSum(s) - s.score)).toBeLessThanOrEqual(1);
    // no penalty for sharing the commander's mana value with itself
    expect(s.reasons.join(' ')).not.toMatch(/same mana value as the commander/);
    // a real second copy in the 99 is still gated
    const doubled = createScorer(lathril({}, [...lathrilMain(), e(LATHRIL)]), ctx).score(card(LATHRIL));
    expect(doubled.gate?.code).toBe('copy-limit');
  });

  it('knows that Command Tower and Arcane Signet make no mana for a colourless commander', () => {
    const KOZILEK = 'Kozilek, the Great Distortion';
    const scorer = createScorer(deck([KOZILEK], [e('Wastes', 10)]), ctx);
    for (const name of ['Command Tower', 'Arcane Signet', "Commander's Sphere", 'Path of Ancestry']) {
      const s = scorer.score(card(name));
      expect(s.gate, name).toBeNull();
      expect(s.score, name).toBeLessThan(30);
      expect(s.reasons.join(' '), name).toMatch(/makes no mana/);
    }
    // real mana sources are untouched, and a land that makes any colour still pays generic costs
    expect(scorer.score(card('Sol Ring')).score).toBeGreaterThanOrEqual(70);
    expect(scorer.score(card('Mind Stone')).score).toBeGreaterThanOrEqual(60);
    expect(scorer.score(card('City of Brass')).score).toBeGreaterThan(scorer.score(card('Command Tower')).score + 30);
    // with a coloured commander the same cards are staples
    const coloured = createScorer(lathril(), ctx);
    expect(coloured.score(card('Command Tower')).score).toBeGreaterThanOrEqual(STAPLE_FLOOR);
    expect(coloured.score(card('Arcane Signet')).score).toBeGreaterThanOrEqual(STAPLE_FLOOR);
  });

  it("puts the format's best utility cards near the top of a themed deck's list", () => {
    const scorer = createScorer(deck([LATHRIL], []), ctx);
    const spells = scorer.scoreAll().filter((s) => !s.gate && db.features(s.oracleId)!.landWeight < 1).sort((a, b) => b.score - a.score);
    const rank = (name: string) => spells.findIndex((s) => s.oracleId === id(name)) + 1;
    for (const name of ['Sol Ring', 'Arcane Signet', 'Beast Within']) {
      expect(scorer.score(card(name)).score, name).toBeGreaterThanOrEqual(80);
      expect(rank(name), name).toBeLessThanOrEqual(40);
    }
    // the best theme cards still come first
    expect(rank('Elvish Archdruid')).toBeLessThan(rank('Sol Ring'));
  });

  it('pays the staple share while the deck wants the role, and to the best cards of a full role', () => {
    const rocks = ['Arcane Signet', 'Mind Stone', 'Fellwar Stone', 'Thought Vessel', 'Cultivate', "Kodama's Reach", 'Rampant Growth', 'Farseek',
      "Nature's Lore", 'Three Visits', 'Elvish Mystic', 'Birds of Paradise', "Commander's Sphere"];
    const hungry = createScorer(lathril(), ctx).score(card('Sol Ring'));
    const fullDeck = lathril({}, [...lathrilMain(), ...rocks.map((n) => e(n))]);
    const full = createScorer(fullDeck, ctx).score(card('Sol Ring'));
    expect(hungry.reasons.join(' ')).toMatch(/format staple/);
    // Sol Ring is stronger than every ramp card in the full deck: it is still the first one to run.
    expect(full.reasons.join(' ')).toMatch(/format staple/);
    expect(full.reasons.join(' ')).toMatch(/role: stronger than all \d+ ramp cards beside it/);
    expect(full.score).toBeGreaterThanOrEqual(hungry.score - 3);
    // The weakest ramp card of the full deck is the surplus one: no role need, no staple share.
    const ramp = fullDeck.main.map((x) => db.get(x.oracleId)!).filter((c) => db.features(c.oracleId)!.roles.includes('ramp') && db.features(c.oracleId)!.landWeight === 0);
    // (Not an Elf: a mana elf is a theme piece for Lathril whatever the ramp count.)
    const weakest = [...ramp].filter((c) => !/Elf/.test(c.typeLine)).sort((x, y) => (y.edhrecRank ?? Infinity) - (x.edhrecRank ?? Infinity))[0];
    const last = createScorer(fullDeck, ctx).score(weakest);
    expect(last.reasons.join(' ')).not.toMatch(/format staple/);
    expect(last.score).toBeLessThan(full.score);
    expect(full.score).toBeGreaterThanOrEqual(STAPLE_FLOOR);
  });

  it('does not call a fetchland a mana source in a colourless deck', () => {
    const scorer = createScorer(deck(['Kozilek, the Great Distortion'], []), ctx);
    const fetch = scorer.score(card('Misty Rainforest'));
    expect(fetch.reasons.join(' ')).not.toMatch(/makes mana/);
    expect(scorer.score(card('City of Brass')).score).toBeGreaterThan(fetch.score);
  });
});
