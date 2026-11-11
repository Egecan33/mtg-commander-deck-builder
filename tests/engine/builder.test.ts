import { describe, expect, it } from 'vitest';
import { analyzeBracket } from '@/engine/brackets';
import { applySwaps, autoBuild, autoBuildReport, fillRest, improveDeck, suggestSwaps } from '@/engine/builder';
import { isGraveyardHate, sideThemes } from '@/engine/builder/improve';
import { addCard, namesOnlyOtherColours, themeFit } from '@/engine/builder/pool';
import { copyLimit, hasType } from '@/engine/rules';
import { createScorer } from '@/engine/scoring';
import { resolveThemeWeights, summarizeDeck } from '@/engine/summary';
import { rateDeck } from '@/engine/rating';
import { isBasicLand, validateDeck } from '@/engine/rules';
import { parseDecklist } from '@/engine/text';
import type { Bracket, BuildOptions, Deck, EngineContext } from '@/engine/types';
import { card, deckText, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const opts = (over: Partial<BuildOptions> = {}): BuildOptions => ({ ownedOnly: false, owned: null, maxPriceUsd: null, seed: 1, ...over });

function shell(commanders: string[], target: Bracket): Deck {
  return {
    id: null, name: commanders.join(' + '), commanders: commanders.map((n) => card(n).oracleId), companion: null,
    chosenColor: null, main: [], targetBracket: target, themeWeights: null,
  };
}
function fixtureDeck(name: 'precon' | 'upgraded' | 'cedh', target: Bracket): Deck {
  const p = parseDecklist(deckText(name), db);
  return { id: null, name, commanders: p.commanders, companion: p.companion, chosenColor: null, main: p.main, targetBracket: target, themeWeights: null };
}
const size = (d: Deck) => d.commanders.length + d.main.reduce((n, e) => n + e.qty, 0);
const ids = (d: Deck) => d.main.flatMap((e) => Array<string>(e.qty).fill(e.oracleId)).sort();
const isLand = (id: string) => (db.features(id)?.landWeight ?? 0) >= 1;

const COMMANDERS: string[][] = [
  ['Lathril, Blade of the Elves'], ["Atraxa, Praetors' Voice"], ['Krenko, Mob Boss'], ['Talrand, Sky Summoner'],
  ['Kozilek, the Great Distortion'], ['Kenrith, the Returned King'], ['Thrasios, Triton Hero', 'Tymna the Weaver'],
];

describe('autoBuild', () => {
  for (const names of COMMANDERS) {
    for (const target of [1, 2, 3, 4, 5] as Bracket[]) {
      it(`${names.join(' + ')} at Bracket ${target}: 100 legal cards inside the bracket, built in time`, () => {
        const t0 = performance.now();
        const deck = autoBuild(shell(names, target), ctx, opts());
        const ms = performance.now() - t0;
        expect(validateDeck(deck, db)).toEqual([]);
        expect(size(deck)).toBe(100);
        const report = analyzeBracket(deck, ctx);
        expect(report.violationsOfTarget).toEqual([]);
        if (target <= 2) {
          expect(report.floor).toBeLessThanOrEqual(2);
          expect(deck.main.filter((e) => db.get(e.oracleId)?.gameChanger)).toEqual([]);
        } else {
          expect(report.floor).toBeLessThanOrEqual(target);
        }
        expect(rateDeck(deck, ctx).rating).toBeGreaterThanOrEqual(55);
        expect(ms).toBeLessThan(3000);
      });
    }
  }

  it('same seed gives the same deck, another seed a different one', () => {
    const a = autoBuild(shell(['Lathril, Blade of the Elves'], 3), ctx, opts({ seed: 7 }));
    const b = autoBuild(shell(['Lathril, Blade of the Elves'], 3), ctx, opts({ seed: 7 }));
    const c = autoBuild(shell(['Lathril, Blade of the Elves'], 3), ctx, opts({ seed: 8 }));
    expect(a.main).toEqual(b.main);
    expect(ids(c)).not.toEqual(ids(a));
    expect(size(c)).toBe(100);
  });

  it('keeps locked entries and drops the rest', () => {
    const start = shell(['Lathril, Blade of the Elves'], 3);
    const locked = ['Golgari Guildgate', 'Nightmare', 'Swamp'].map((n) => card(n).oracleId);
    start.main = [
      { oracleId: locked[0], qty: 1, locked: true },
      { oracleId: locked[1], qty: 1, locked: true },
      { oracleId: locked[2], qty: 30, locked: true },
      { oracleId: card('Biorhythm').oracleId, qty: 1, locked: false },
    ];
    const deck = autoBuild(start, ctx, opts());
    expect(size(deck)).toBe(100);
    expect(validateDeck(deck, db)).toEqual([]);
    for (const id of locked) expect(deck.main.find((e) => e.oracleId === id)?.locked).toBe(true);
    expect(deck.main.find((e) => e.oracleId === locked[2])?.qty).toBeGreaterThanOrEqual(30);
    expect(deck.main.some((e) => e.oracleId === card('Biorhythm').oracleId)).toBe(false);
  });

  it('ownedOnly uses only owned cards plus basics', () => {
    const precon = fixtureDeck('precon', 2);
    const owned = new Set(precon.main.slice(0, 45).map((e) => e.oracleId));
    const deck = autoBuild({ ...precon, main: [] }, ctx, opts({ ownedOnly: true, owned }));
    expect(size(deck)).toBe(100);
    expect(validateDeck(deck, db)).toEqual([]);
    for (const e of deck.main) {
      const c = db.get(e.oracleId)!;
      expect(owned.has(e.oracleId) || isBasicLand(c), c.name).toBe(true);
    }
  });

  it('maxPriceUsd keeps every card at or under the cap', () => {
    const deck = autoBuild(shell(["Atraxa, Praetors' Voice"], 3), ctx, opts({ maxPriceUsd: 1 }));
    expect(size(deck)).toBe(100);
    expect(validateDeck(deck, db)).toEqual([]);
    for (const e of deck.main) {
      const c = db.get(e.oracleId)!;
      if (c.priceUsd === null) expect(isBasicLand(c), c.name).toBe(true);
      else expect(c.priceUsd, c.name).toBeLessThanOrEqual(1);
    }
  });

  it('a typal commander gets a deck of its own creature type, not a pile of any-type support', () => {
    const deck = autoBuild(shell(['Lathril, Blade of the Elves'], 3), ctx, opts());
    const elves = deck.main.filter((e) => db.features(e.oracleId)?.creatureTypes.includes('elf')).length;
    expect(elves).toBeGreaterThanOrEqual(15);
    const anyType = deck.main.filter((e) => {
      const f = db.features(e.oracleId)!;
      return f.landWeight < 1 && (f.axes.typal?.p ?? 0) >= 0.5 && !f.creatureTypes.includes('elf') && !db.get(e.oracleId)!.keywords.includes('Changeling');
    }).length;
    expect(anyType).toBeLessThanOrEqual(6);
  });

  it('a colourless deck runs lands that make colourless mana, and Wastes', () => {
    const deck = autoBuild(shell(['Kozilek, the Great Distortion'], 3), ctx, opts());
    const wastes = card('Wastes').oracleId;
    expect(deck.main.find((e) => e.oracleId === wastes)?.qty ?? 0).toBeGreaterThan(0);
    for (const e of deck.main) {
      const f = db.features(e.oracleId)!;
      if (f.landWeight < 1 || e.oracleId === wastes) continue;
      expect((f.sources.C ?? 0) > 0, db.get(e.oracleId)!.name).toBe(true);
    }
  });

  it('a two-colour mana base has basics of both colours and lands that make both', () => {
    const deck = autoBuild(shell(['Lathril, Blade of the Elves'], 3), ctx, opts());
    for (const basic of ['Swamp', 'Forest']) expect(deck.main.find((e) => e.oracleId === card(basic).oracleId)?.qty ?? 0, basic).toBeGreaterThanOrEqual(4);
    const duals = deck.main.filter((e) => {
      const f = db.features(e.oracleId)!;
      return f.landWeight >= 1 && (f.sources.B ?? 0) > 0 && (f.sources.G ?? 0) > 0;
    }).length;
    expect(duals).toBeGreaterThanOrEqual(4);
    const lands = deck.main.reduce((n, e) => n + (isLand(e.oracleId) ? e.qty : 0), 0);
    expect(lands).toBeGreaterThanOrEqual(34);
    expect(lands).toBeLessThanOrEqual(40);
  });

  it('leaves out cards that only work with colours the deck lacks', () => {
    expect(namesOnlyOtherColours(card('Ruby Medallion'), ['U'])).toBe(true);
    expect(namesOnlyOtherColours(card('Ruby Medallion'), ['R'])).toBe(false);
    expect(namesOnlyOtherColours(card('Sol Ring'), ['U'])).toBe(false);
    const deck = autoBuild(shell(['Talrand, Sky Summoner'], 3), ctx, opts());
    for (const n of ['Ruby Medallion', 'Emerald Medallion', 'Jet Medallion']) expect(deck.main.some((e) => e.oracleId === card(n).oracleId), n).toBe(false);
  });

  it('builds for a deck with no commander or an unknown commander without throwing', () => {
    const none: Deck = { ...shell(['Krenko, Mob Boss'], 3), commanders: [] };
    expect(() => autoBuild(none, ctx, opts())).not.toThrow();
    const ghost: Deck = { ...shell(['Krenko, Mob Boss'], 3), commanders: ['no-such-card'] };
    expect(() => autoBuild(ghost, ctx, opts())).not.toThrow();
  });
});

describe('fillRest', () => {
  it('fills the precon minus 20 cards back to 100 legal cards and keeps the 80', () => {
    const precon = fixtureDeck('precon', 2);
    const cut = { ...precon, main: precon.main.slice(0, precon.main.length - 20) };
    const kept = size(cut);
    const deck = fillRest(cut, ctx, opts());
    expect(size(deck)).toBe(100);
    expect(validateDeck(deck, db)).toEqual([]);
    for (const e of cut.main) expect(deck.main.find((x) => x.oracleId === e.oracleId)?.qty ?? 0).toBeGreaterThanOrEqual(e.qty);
    expect(kept).toBeLessThan(100);
  });
});

describe('improveDeck', () => {
  function preconWithJunk(): { deck: Deck; junk: string[] } {
    const precon = fixtureDeck('precon', 2);
    const main = precon.main.map((e) => ({ ...e }));
    const have = new Set([...precon.commanders, ...main.map((e) => e.oracleId)]);
    const identity = new Set(precon.commanders.flatMap((id) => db.get(id)!.colorIdentity));
    const junk = db.all()
      .filter((c) => !have.has(c.oracleId) && !isLand(c.oracleId) && c.colorIdentity.every((k) => identity.has(k))
        && (c.edhrecRank ?? 99999) > 4000 && !c.gameChanger && c.cmc >= 4 && (db.features(c.oracleId)?.roles.length ?? 0) === 0
        && db.combosFor(c.oracleId).length === 0)
      .slice(0, 10).map((c) => c.oracleId);
    expect(junk.length).toBe(10);
    let removed = 0;
    for (let i = main.length - 1; i >= 0 && removed < 10; i--) {
      if (!isLand(main[i].oracleId)) continue;
      if (main[i].qty > 1) { main[i].qty--; i++; } else main.splice(i, 1);
      removed++;
    }
    expect(removed).toBe(10);
    for (const id of junk) main.push({ oracleId: id, qty: 1, locked: false });
    return { deck: { ...precon, main }, junk };
  }

  it('repairs a precon whose lands were swapped for junk', () => {
    const { deck } = preconWithJunk();
    expect(validateDeck(deck, db)).toEqual([]);
    const lockedId = deck.main[0].oracleId;
    deck.main[0] = { ...deck.main[0], locked: true };
    const before = rateDeck(deck, ctx).rating;
    const proposals = improveDeck(deck, ctx, opts());
    expect(proposals.length).toBeGreaterThanOrEqual(5);
    expect(proposals.length).toBeLessThanOrEqual(15);
    for (const p of proposals) {
      expect(p.ratingAfter, p.reason).toBeGreaterThan(p.ratingBefore);
      expect(p.out).not.toBe(lockedId);
      expect(p.reason.length).toBeGreaterThan(0);
    }
    const after = applySwaps(deck, proposals);
    expect(size(after)).toBe(100);
    expect(validateDeck(after, db)).toEqual([]);
    expect(rateDeck(after, ctx).rating).toBeGreaterThan(before);
    // Proposals report the unrounded rating to one decimal.
    expect(Math.abs(rateDeck(after, ctx).rating - proposals[proposals.length - 1].ratingAfter)).toBeLessThanOrEqual(0.5);
    for (let i = 1; i < proposals.length; i++) expect(proposals[i].ratingBefore).toBe(proposals[i - 1].ratingAfter);
  });

  it('proposes cutting an off-colour card first', () => {
    const precon = fixtureDeck('precon', 2);
    const bolt = card('Swords to Plowshares').oracleId;
    const main = precon.main.map((e) => ({ ...e }));
    const idx = main.findIndex((e) => !isLand(e.oracleId));
    main[idx] = { oracleId: bolt, qty: 1, locked: false };
    const deck = { ...precon, main };
    expect(validateDeck(deck, db).length).toBeGreaterThan(0);
    const proposals = improveDeck(deck, ctx, opts());
    expect(proposals[0].out).toBe(bolt);
    expect(validateDeck(applySwaps(deck, proposals), db)).toEqual([]);
  });

  it('does not throw on unknown cards, and proposes cutting them', () => {
    const precon = fixtureDeck('precon', 2);
    const main = precon.main.map((e) => ({ ...e }));
    main[3] = { oracleId: 'not-a-real-card', qty: 1, locked: false };
    const deck = { ...precon, main };
    let proposals: ReturnType<typeof improveDeck> = [];
    expect(() => { proposals = improveDeck(deck, ctx, opts()); }).not.toThrow();
    expect(proposals[0]?.out).toBe('not-a-real-card');
    expect(() => suggestSwaps(deck, ctx, opts())).not.toThrow();
    expect(() => fillRest(deck, ctx, opts())).not.toThrow();
  });

  it('returns nothing for max 0 and never throws on an empty deck', () => {
    expect(improveDeck(fixtureDeck('precon', 2), ctx, opts(), 0)).toEqual([]);
    const empty: Deck = { ...shell(['Krenko, Mob Boss'], 3), commanders: [] };
    expect(() => improveDeck(empty, ctx, opts())).not.toThrow();
    expect(() => suggestSwaps(empty, ctx, opts())).not.toThrow();
  });
});

describe('suggestSwaps and applySwaps', () => {
  it('suggests replacements for the weakest cards, never for locked ones', () => {
    const deck = fixtureDeck('upgraded', 3);
    deck.main = deck.main.map((e, i) => (i < 5 ? { ...e, locked: true } : e));
    const swaps = suggestSwaps(deck, ctx, opts(), 4);
    expect(swaps.length).toBeGreaterThan(0);
    expect(swaps.length).toBeLessThanOrEqual(4);
    const inDeck = new Set(deck.main.map((e) => e.oracleId));
    const lockedIds = new Set(deck.main.filter((e) => e.locked).map((e) => e.oracleId));
    for (const s of swaps) {
      expect(inDeck.has(s.out)).toBe(true);
      expect(lockedIds.has(s.out)).toBe(false);
      expect(inDeck.has(s.in)).toBe(false);
      expect(isLand(s.in)).toBe(isLand(s.out));
    }
    expect(new Set(swaps.map((s) => s.in)).size).toBe(swaps.length);
  });

  it('applySwaps swaps one copy, keeps the size and skips swaps whose card is gone', () => {
    const deck = fixtureDeck('precon', 2);
    const out = deck.main[0].oracleId;
    const into = card('Biorhythm').oracleId;
    const swap = { out, in: into, reason: '', ratingBefore: 0, ratingAfter: 0 };
    const after = applySwaps(deck, [swap, swap]);
    expect(size(after)).toBe(100);
    expect(after.main.find((e) => e.oracleId === into)?.qty).toBe(1);
    expect(after.main.some((e) => e.oracleId === out)).toBe(false);
    expect(deck.main[0].oracleId).toBe(out);
  });
});

// ---- Regressions from the Task 8 review (found on the real database) --------------------------

describe('autoBuild: commanders with special deck rules', () => {
  const special: [string[], Deck['chosenColor']][] = [
    [['Wilson, Refined Grizzly', 'Raised by Giants'], null],   // Background pair
    [['The Tenth Doctor', 'Rose Tyler'], null],                 // Doctor and companion
    [['The Prismatic Piper'], 'B'],                             // colour-choice commander
    [['Shorikai, Genesis Engine'], null],                       // Vehicle commander
    [['Seluma, Light of Aysen'], null],                         // Rulebreaker
    [['Tolabow, Loch Rascal'], 'R'],                            // Rulebreaker with a chosen colour
  ];
  for (const [names, chosen] of special) {
    for (const target of [2, 4] as Bracket[]) {
      it(`${names.join(' + ')} at Bracket ${target}: 100 legal cards`, () => {
        const deck = autoBuild({ ...shell(names, target), chosenColor: chosen }, ctx, opts());
        expect(validateDeck(deck, db)).toEqual([]);
        expect(size(deck)).toBe(100);
        expect(analyzeBracket(deck, ctx).violationsOfTarget).toEqual([]);
        expect(rateDeck(deck, ctx).rating).toBeGreaterThanOrEqual(55);
      });
    }
  }

  it("gives Tolabow's off-colour spells basics of their colour to be cast with", () => {
    const start: Deck = { ...shell(['Tolabow, Loch Rascal'], 3), chosenColor: 'R' };
    const red = ['Lightning Bolt', 'Chaos Warp'].map((n) => card(n).oracleId);
    start.main = red.map((oracleId) => ({ oracleId, qty: 1, locked: true }));
    const deck = autoBuild(start, ctx, opts());
    expect(validateDeck(deck, db)).toEqual([]);
    expect(size(deck)).toBe(100);
    const qty = (name: string) => deck.main.find((e) => e.oracleId === card(name).oracleId)?.qty ?? 0;
    expect(qty('Mountain')).toBeGreaterThanOrEqual(2);
    expect(qty('Island')).toBeGreaterThan(qty('Mountain'));
    // No red card, no Mountain.
    const plain = autoBuild({ ...shell(['Tolabow, Loch Rascal'], 3), chosenColor: null }, ctx, opts());
    expect(plain.main.some((e) => e.oracleId === card('Mountain').oracleId)).toBe(false);
  });

  it("builds inside a companion's condition and leaves the companion out of the deck", () => {
    const repeats = (cost: string) => { const s = cost.match(/\{[^}]+\}/g) ?? []; return new Set(s).size !== s.length; };
    const jegantha = card('Jegantha, the Wellspring').oracleId;
    const a = autoBuild({ ...shell(['Kenrith, the Returned King'], 3), companion: jegantha }, ctx, opts());
    expect(validateDeck(a, db)).toEqual([]);
    expect(size(a)).toBe(100);
    expect(a.companion).toBe(jegantha);
    expect(a.main.some((e) => e.oracleId === jegantha)).toBe(false);
    expect(a.main.map((e) => db.get(e.oracleId)!).filter((c) => repeats(c.faces[0]?.manaCost ?? c.manaCost)).map((c) => c.name)).toEqual([]);

    const keruga = card('Keruga, the Macrosage').oracleId;
    const b = autoBuild({ ...shell(['Kenrith, the Returned King'], 3), companion: keruga }, ctx, opts());
    expect(validateDeck(b, db)).toEqual([]);
    expect(size(b)).toBe(100);
    expect(b.main.map((e) => db.get(e.oracleId)!).filter((c) => !isLand(c.oracleId) && c.cmc < 3).map((c) => c.name)).toEqual([]);
    // Swap proposals stay inside the condition too.
    for (const p of [...improveDeck(b, ctx, opts()), ...suggestSwaps(b, ctx, opts())]) {
      const c = db.get(p.in)!;
      expect(isLand(c.oracleId) || c.cmc >= 3, c.name).toBe(true);
    }
  });

  it('a Bracket 5 deck runs fast mana, a Bracket 3 deck does not chase it', () => {
    const fast = (d: Deck) => d.main.filter((e) => db.features(e.oracleId)?.roles.includes('fast-mana') && !isLand(e.oracleId)).length;
    const names = ['Thrasios, Triton Hero', 'Tymna the Weaver'];
    const b5 = autoBuild(shell(names, 5), ctx, opts());
    const b3 = autoBuild(shell(names, 3), ctx, opts());
    expect(fast(b5)).toBeGreaterThanOrEqual(6);
    expect(fast(b5)).toBeGreaterThan(fast(b3));
  });
});

describe('improveDeck on badly built decks', () => {
  const monotone = (proposals: ReturnType<typeof improveDeck>) => {
    for (let i = 0; i < proposals.length; i++) {
      expect(proposals[i].ratingAfter, proposals[i].reason).toBeGreaterThanOrEqual(proposals[i].ratingBefore);
      if (i > 0) expect(proposals[i].ratingBefore).toBe(proposals[i - 1].ratingAfter);
    }
  };

  it('cuts lands from a deck drowning in them', () => {
    const start = shell(['Krenko, Mob Boss'], 3);
    const mountain = card('Mountain').oracleId;
    const spells = db.all()
      .filter((c) => c.colorIdentity.join('') === 'R' && !isLand(c.oracleId) && c.oracleId !== start.commanders[0] && !c.gameChanger
        && !isBasicLand(c) && db.combosFor(c.oracleId).length === 0)
      .slice(0, 39).map((c) => ({ oracleId: c.oracleId, qty: 1, locked: false }));
    expect(spells.length).toBe(39);
    const deck: Deck = { ...start, main: [{ oracleId: mountain, qty: 60, locked: false }, ...spells] };
    expect(validateDeck(deck, db)).toEqual([]);
    const before = rateDeck(deck, ctx).rating;
    const proposals = improveDeck(deck, ctx, opts());
    monotone(proposals);
    expect(proposals.filter((p) => p.out === mountain).length).toBeGreaterThanOrEqual(5);
    const after = applySwaps(deck, proposals);
    expect(size(after)).toBe(100);
    expect(rateDeck(after, ctx).rating).toBeGreaterThan(before);
    // A suggestion never lowers the rating.
    for (const s of suggestSwaps(deck, ctx, opts(), 5)) expect(s.ratingAfter, s.reason).toBeGreaterThanOrEqual(s.ratingBefore);
  });

  it('fixes a five-colour mana base of one basic, where no single swap moves the rating', () => {
    const built = autoBuild(shell(['Kenrith, the Returned King'], 4), ctx, opts());
    const lands = built.main.filter((e) => isLand(e.oracleId)).reduce((n, e) => n + e.qty, 0);
    const plains = card('Plains').oracleId;
    const deck: Deck = { ...built, main: [...built.main.filter((e) => !isLand(e.oracleId)), { oracleId: plains, qty: lands, locked: false }] };
    expect(size(deck)).toBe(100);
    const before = rateDeck(deck, ctx).rating;
    const proposals = improveDeck(deck, ctx, opts());
    monotone(proposals);
    expect(proposals.filter((p) => p.out === plains && isLand(p.in)).length).toBeGreaterThanOrEqual(5);
    expect(proposals[proposals.length - 1].ratingAfter).toBeGreaterThan(proposals[0].ratingBefore);
    const after = applySwaps(deck, proposals);
    expect(validateDeck(after, db)).toEqual([]);
    expect(rateDeck(after, ctx).rating).toBeGreaterThanOrEqual(before);
    const colours = (d: Deck) => {
      const made = new Set<string>();
      for (const e of d.main) if (isLand(e.oracleId)) for (const [k, v] of Object.entries(db.features(e.oracleId)!.sources)) if ((v ?? 0) > 0 && k !== 'C') made.add(k);
      return made.size;
    };
    expect(colours(deck)).toBe(1);
    expect(colours(after)).toBe(5);
  });

  it('repairs several illegal cards in a row without a rating ever falling', () => {
    const precon = fixtureDeck('precon', 2);
    const offenders = ['Swords to Plowshares', 'Demonic Tutor', 'Rhystic Study'].map((n) => card(n).oracleId);
    const main = precon.main.map((e) => ({ ...e }));
    let k = 0;
    for (let i = 0; i < main.length && k < offenders.length; i++) {
      if (isLand(main[i].oracleId) || main[i].qty !== 1) continue;
      main[i] = { oracleId: offenders[k++], qty: 1, locked: false };
    }
    const deck = { ...precon, main };
    const proposals = improveDeck(deck, ctx, opts());
    monotone(proposals);
    expect(new Set(proposals.slice(0, 3).map((p) => p.out))).toEqual(new Set(offenders));
    const after = applySwaps(deck, proposals);
    expect(validateDeck(after, db)).toEqual([]);
    expect(analyzeBracket(after, ctx).violationsOfTarget).toEqual([]);
    expect(rateDeck(after, ctx).rating).toBeGreaterThan(40);
  });

  it('respects ownedOnly, maxPriceUsd and locks together', () => {
    const precon = fixtureDeck('precon', 2);
    const first = improveDeck(precon, ctx, opts());
    expect(first.length).toBeGreaterThan(0);
    const cut = new Set(first.map((p) => p.out));
    const locked = { ...precon, main: precon.main.map((e) => ({ ...e, locked: cut.has(e.oracleId) })) };
    const owned = new Set(db.all().filter((_, i) => i % 3 === 0).map((c) => c.oracleId));
    const proposals = improveDeck(locked, ctx, opts({ ownedOnly: true, owned, maxPriceUsd: 2 }));
    monotone(proposals);
    for (const p of [...proposals, ...suggestSwaps(locked, ctx, opts({ ownedOnly: true, owned, maxPriceUsd: 2 }))]) {
      expect(cut.has(p.out)).toBe(false);
      const c = db.get(p.in)!;
      if (isBasicLand(c)) continue;
      expect(owned.has(c.oracleId), c.name).toBe(true);
      expect(c.priceUsd, c.name).not.toBeNull();
      expect(c.priceUsd!, c.name).toBeLessThanOrEqual(2);
    }
  });

  it('stops at once on a deck its locked cards keep illegal', () => {
    const precon = fixtureDeck('precon', 2);
    const main = precon.main.map((e) => ({ ...e }));
    const idx = main.findIndex((e) => !isLand(e.oracleId));
    main[idx] = { oracleId: card('Swords to Plowshares').oracleId, qty: 1, locked: true };
    const t0 = performance.now();
    const proposals = improveDeck({ ...precon, main }, ctx, opts());
    expect(performance.now() - t0).toBeLessThan(3000);
    expect(proposals.every((p) => p.out !== main[idx].oracleId)).toBe(true);
  });
});

describe('quality pass 2: brackets 1-2 play like precons, bracket 3 like 3', () => {
  const builds = COMMANDERS.flatMap((names) => ([1, 2, 3, 4, 5] as Bracket[]).map((target) => ({ names, target, deck: autoBuild(shell(names, target), ctx, opts()) })));

  it('at least 80% of Bracket 1-2 builds read "plays like" 2 or lower, with few tutors and no fast mana past the staples', () => {
    const low = builds.filter((b) => b.target <= 2);
    const ok = low.filter((b) => analyzeBracket(b.deck, ctx).playsLike <= 2);
    expect(ok.length / low.length, low.map((b) => `${b.names[0]} B${b.target}: ${analyzeBracket(b.deck, ctx).playsLike}`).join(', ')).toBeGreaterThanOrEqual(0.8);
    for (const b of low) {
      const tutors = b.deck.main.filter((e) => !isLand(e.oracleId) && db.features(e.oracleId)!.roles.includes('tutor')).length;
      expect(tutors, `${b.names[0]} B${b.target} tutors`).toBeLessThanOrEqual(b.target === 1 ? 1 : 2);
      for (const e of b.deck.main) {
        const f = db.features(e.oracleId)!;
        const c = db.get(e.oracleId)!;
        if (isLand(e.oracleId) || !f.roles.includes('fast-mana')) continue;
        expect(c.edhrecRank !== null && c.edhrecRank <= 25, `${c.name} in ${b.names[0]} B${b.target}`).toBe(true); // Sol Ring level
      }
    }
  });

  it('Bracket 1-2 builds are made of humbler cards than the Bracket 3 build of the same commander', () => {
    const meanTier = (d: Deck) => {
      const spells = d.main.filter((e) => !isLand(e.oracleId));
      return spells.reduce((n, e) => n + db.features(e.oracleId)!.powerTier * e.qty, 0) / spells.reduce((n, e) => n + e.qty, 0);
    };
    let lower = 0;
    for (const names of COMMANDERS) {
      const of = (t: Bracket) => builds.find((b) => b.names === names && b.target === t)!.deck;
      if (meanTier(of(2)) < meanTier(of(3))) lower++;
      expect(meanTier(of(1)), names[0]).toBeLessThanOrEqual(meanTier(of(3)) + 0.02);
    }
    expect(lower).toBeGreaterThanOrEqual(COMMANDERS.length - 1);
  });

  it('Bracket 3 builds read 3, Bracket 4 builds 4, Bracket 5 builds 5 (one bracket of slack on the small fixture pool)', () => {
    for (const b of builds.filter((x) => x.target >= 3)) {
      const plays = analyzeBracket(b.deck, ctx).playsLike;
      expect(Math.abs(plays - b.target), `${b.names[0]} B${b.target} plays like ${plays}`).toBeLessThanOrEqual(1);
    }
    const three = builds.filter((x) => x.target === 3);
    expect(three.filter((b) => analyzeBracket(b.deck, ctx).playsLike === 3).length).toBeGreaterThanOrEqual(three.length - 1);
  });
});

describe('quality pass 2: core staples', () => {
  it('every build runs Sol Ring, and Arcane Signet wherever it makes mana', () => {
    const sol = card('Sol Ring').oracleId;
    const signet = card('Arcane Signet').oracleId;
    for (const names of COMMANDERS) {
      for (const target of [1, 3, 5] as Bracket[]) {
        const have = new Set(autoBuild(shell(names, target), ctx, opts()).main.map((e) => e.oracleId));
        expect(have.has(sol), `Sol Ring, ${names[0]} B${target}`).toBe(true);
        // A colourless commander's identity gives Arcane Signet nothing to make.
        expect(have.has(signet), `Arcane Signet, ${names[0]} B${target}`).toBe(names[0] !== 'Kozilek, the Great Distortion');
      }
    }
  });
});

describe('quality pass 2: win lines at Brackets 4-5', () => {
  const lines = (d: Deck) => analyzeBracket(d, ctx).combos.included.filter((c) => c.relevant && c.combo.cards.length <= 3);

  it('Thrasios + Tymna at Bracket 5 holds Thassa\'s Oracle with a way to empty the library', () => {
    const deck = autoBuild(shell(['Thrasios, Triton Hero', 'Tymna the Weaver'], 5), ctx, opts());
    const have = new Set(deck.main.map((e) => e.oracleId));
    expect(have.has(card("Thassa's Oracle").oracleId)).toBe(true);
    expect(have.has(card('Demonic Consultation').oracleId) || have.has(card('Tainted Pact').oracleId)).toBe(true);
    expect(lines(deck).some((c) => c.twoCard && c.combo.cards.some((p) => p.oracleId === card("Thassa's Oracle").oracleId))).toBe(true);
  });

  it('a Bracket 5 Kinnan build looks like cEDH: fast mana, free interaction, tutors, a low curve, a win line', () => {
    const deck = autoBuild(shell(['Kinnan, Bonder Prodigy'], 5), ctx, opts());
    expect(validateDeck(deck, db)).toEqual([]);
    const s = summarizeDeck(deck, db);
    const nonlandFast = deck.main.filter((e) => !isLand(e.oracleId) && db.features(e.oracleId)!.roles.includes('fast-mana')).length;
    expect(nonlandFast).toBeGreaterThanOrEqual(6);
    const free = deck.main.filter((e) => {
      const f = db.features(e.oracleId)!;
      return f.powerTier === 5 && f.roles.includes('counterspell');
    }).length;
    expect(free).toBeGreaterThanOrEqual(2);
    expect(s.roleCounts.tutor).toBeGreaterThanOrEqual(4);
    expect(s.avgMv).toBeLessThanOrEqual(2.6);
    expect(s.landCount).toBeLessThanOrEqual(31);
    expect(lines(deck).length).toBeGreaterThanOrEqual(1);
    expect(analyzeBracket(deck, ctx).playsLike).toBeGreaterThanOrEqual(4);
    // Cheap cards: at most a handful of spells cost five or more (flip targets and finishers), most cost two or less.
    const spells = deck.main.filter((e) => !isLand(e.oracleId));
    expect(spells.filter((e) => db.get(e.oracleId)!.cmc >= 5).length).toBeLessThanOrEqual(6);
    expect(spells.filter((e) => db.get(e.oracleId)!.cmc <= 2).length).toBeGreaterThanOrEqual(spells.length * 0.55);
  });

  it('Bracket 4 builds hold a compact win line when the fixture pool has one for their colours', () => {
    for (const names of [['Thrasios, Triton Hero', 'Tymna the Weaver'], ["Atraxa, Praetors' Voice"], ['Kenrith, the Returned King']]) {
      expect(lines(autoBuild(shell(names, 4), ctx, opts())).length, names[0]).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('quality pass 2: locked basics, many-copy cards, deck-wide companions', () => {
  it('a locked basic keeps its count: added basics go into an unlocked entry beside it', () => {
    const start = shell(['Krenko, Mob Boss'], 3);
    const mountain = card('Mountain').oracleId;
    start.main = [{ oracleId: mountain, qty: 3, locked: true }];
    const deck = autoBuild(start, ctx, opts());
    expect(validateDeck(deck, db)).toEqual([]);
    const entries = deck.main.filter((e) => e.oracleId === mountain);
    expect(entries.filter((e) => e.locked)).toEqual([{ oracleId: mountain, qty: 3, locked: true }]);
    const free = entries.filter((e) => !e.locked);
    expect(free.length).toBe(1);
    expect(free[0].qty).toBeGreaterThan(10);
    // addCard itself: never into the locked entry.
    const one = addCard(start, mountain, 2);
    expect(one.main).toEqual([{ oracleId: mountain, qty: 3, locked: true }, { oracleId: mountain, qty: 2, locked: false }]);
    expect(addCard(one, mountain).main[1].qty).toBe(3);
    // fillRest and improveDeck keep it too.
    const filled = fillRest({ ...start, main: [...start.main, { oracleId: card('Sol Ring').oracleId, qty: 1, locked: false }] }, ctx, opts());
    expect(filled.main.find((e) => e.oracleId === mountain && e.locked)?.qty).toBe(3);
    expect(size(filled)).toBe(100);
  });

  it('Relentless Rats and friends go in as a pack when the deck is about their type', () => {
    const rats = autoBuild({ ...shell(['Lathril, Blade of the Elves'], 3), themeWeights: { 'typal:rat': 1, typal: 0.8 } }, ctx, opts());
    expect(validateDeck(rats, db)).toEqual([]);
    expect(size(rats)).toBe(100);
    const packs = rats.main.filter((e) => e.qty > 1 && !isBasicLand(db.get(e.oracleId)!));
    expect(packs.length).toBeGreaterThanOrEqual(1);
    for (const p of packs) {
      expect(['Relentless Rats', 'Rat Colony']).toContain(db.get(p.oracleId)!.name);
      expect(p.qty).toBeGreaterThanOrEqual(10);
      expect(p.qty).toBeLessThanOrEqual(copyLimit(db.get(p.oracleId)!));
    }
    // One any-number pack, not two.
    expect(packs.filter((p) => !Number.isFinite(copyLimit(db.get(p.oracleId)!))).length).toBe(1);
  });

  it('a card with a stated limit goes in at its limit (Seven Dwarves: seven)', () => {
    const dwarves = autoBuild({ ...shell(['Krenko, Mob Boss'], 2), themeWeights: { 'typal:dwarf': 1, typal: 0.8 } }, ctx, opts());
    expect(validateDeck(dwarves, db)).toEqual([]);
    expect(dwarves.main.find((e) => e.oracleId === card('Seven Dwarves').oracleId)?.qty).toBe(7);
  });

  it('many-copy cards stay single in a deck that is not about them', () => {
    for (const d of [autoBuild(shell(['Lathril, Blade of the Elves'], 3), ctx, opts()), autoBuild(shell(['Krenko, Mob Boss'], 3), ctx, opts())]) {
      for (const e of d.main) if (!isBasicLand(db.get(e.oracleId)!)) expect(e.qty, db.get(e.oracleId)!.name).toBe(1);
    }
    // Shadowborn Apostle is a Human Cleric about Demons: not a pack for a Human deck.
    const humans = autoBuild({ ...shell(['Tymna the Weaver'], 3), themeWeights: { 'typal:human': 1, typal: 0.8 } }, ctx, opts());
    expect(humans.main.find((e) => e.oracleId === card('Shadowborn Apostle').oracleId)?.qty ?? 0).toBeLessThanOrEqual(1);
  });

  it('Umori as companion: every nonland card shares a card type and the deck is legal', () => {
    const start = { ...shell(['Lathril, Blade of the Elves'], 3), companion: card('Umori, the Collector').oracleId };
    const { deck, notes } = autoBuildReport(start, ctx, opts());
    expect(validateDeck(deck, db)).toEqual([]);
    expect(deck.companion).toBe(card('Umori, the Collector').oracleId);
    expect(size(deck)).toBe(100);
    for (const e of deck.main) if (!hasType(db.get(e.oracleId)!, 'Land')) expect(hasType(db.get(e.oracleId)!, 'Creature'), db.get(e.oracleId)!.name).toBe(true);
    expect(notes.join(' ')).toMatch(/Umori.*every nonland card is a Creature/);
    // improveDeck keeps the condition.
    const worse = { ...deck, main: deck.main.map((e, i) => (i === 0 && !isLand(e.oracleId) ? e : e)) };
    for (const p of improveDeck(worse, ctx, opts(), 5)) {
      const c = db.get(p.in)!;
      expect(hasType(c, 'Land') || hasType(c, 'Creature'), c.name).toBe(true);
    }
  });

  it('Umori with a locked card of another type, and Yorion always: the companion is dropped with a note and the deck is legal', () => {
    const umori = { ...shell(['Lathril, Blade of the Elves'], 3), companion: card('Umori, the Collector').oracleId };
    umori.main = [{ oracleId: card('Sol Ring').oracleId, qty: 1, locked: true }];
    const a = autoBuildReport(umori, ctx, opts());
    expect(a.deck.companion).toBeNull();
    expect(validateDeck(a.deck, db)).toEqual([]);
    expect(a.notes.join(' ')).toMatch(/Umori, the Collector was dropped as companion/);

    const yorion = { ...shell(["Atraxa, Praetors' Voice"], 3), companion: card('Yorion, Sky Nomad').oracleId };
    const b = autoBuildReport(yorion, ctx, opts());
    expect(b.deck.companion).toBeNull();
    expect(validateDeck(b.deck, db)).toEqual([]);
    expect(size(b.deck)).toBe(100);
    expect(b.notes.join(' ')).toMatch(/Yorion, Sky Nomad was dropped as companion.*120 cards/);
    // A companion outside the commander's colours is dropped before anything is built around it.
    const urza = { ...shell(['Talrand, Sky Summoner'], 3), companion: card('Umori, the Collector').oracleId };
    const c = autoBuildReport(urza, ctx, opts());
    expect(c.deck.companion).toBeNull();
    expect(validateDeck(c.deck, db)).toEqual([]);
    expect(c.notes).toHaveLength(1);
    expect(c.notes[0]).toMatch(/dropped as companion.*colour identity/);
    // autoBuild returns the same deck, without the notes.
    expect(autoBuild(yorion, ctx, opts()).main).toEqual(b.deck.main);
    // A build with nothing to report has no notes.
    expect(autoBuildReport(shell(['Krenko, Mob Boss'], 3), ctx, opts()).notes).toEqual([]);
  });
});

describe('quality pass 2: proposals that make sense on their own', () => {
  /** Every proposal of an improve run with the deck it was made on. */
  function walk(deck: Deck, max?: number) {
    const proposals = improveDeck(deck, ctx, opts(), max);
    let current = deck;
    return proposals.map((p) => {
      const before = current;
      current = applySwaps(current, [p]);
      return { p, before };
    });
  }
  const scoreOn = (d: Deck, id: string) => createScorer(d, ctx).score(db.get(id)!).score;

  for (const [name, target] of [['precon', 2], ['upgraded', 3], ['cedh', 5]] as const) {
    it(`${name}: every swap is justified by the cards themselves, with a reason that states true numbers`, () => {
      const deck = fixtureDeck(name, target);
      const steps = walk(deck);
      expect(steps.length).toBeGreaterThanOrEqual(3);
      for (const { p, before } of steps) {
        expect(p.ratingAfter, p.reason).toBeGreaterThan(p.ratingBefore);
        const inLand = isLand(p.in);
        const outLand = isLand(p.out);
        const s = summarizeDeck(before, db);
        if (!inLand && !outLand) {
          // A spell for a spell: the one coming in scores higher for this deck, and the reason says by how much.
          const a = scoreOn(before, p.in);
          const b = scoreOn(before, p.out);
          expect(a, p.reason).toBeGreaterThan(b);
          const m = /scores (\d+) for this deck(?:,| against) (?:.+ )?(\d+)/.exec(p.reason);
          expect(m, p.reason).not.toBeNull();
          expect(Math.abs(Number(m![1]) - a)).toBeLessThanOrEqual(1);
          expect(Math.abs(Number(m![2]) - Math.max(0, b))).toBeLessThanOrEqual(1);
        } else if (inLand && !outLand) {
          // A land for a spell only in a deck short of lands; the reason says so.
          expect(p.reason).toMatch(/^Add \d+ lands?/);
          const m = /has ([\d.]+), and its curve wants about (\d+)/.exec(p.reason);
          expect(Number(m![1])).toBeCloseTo(s.landsEffective, 1);
          expect(Number(m![2])).toBeGreaterThan(s.landsEffective);
        } else if (!inLand && outLand) {
          expect(p.reason).toMatch(/more lands than its curve wants/);
        }
      }
    });
  }

  it('the dragon precon keeps its strong dragons: an on-theme card is cut only for a full rating point', () => {
    const deck = fixtureDeck('precon', 2);
    const weights = resolveThemeWeights(deck, ctx);
    expect(weights['typal:dragon']).toBe(1); // read off the deck
    const steps = walk(deck);
    for (const { p, before } of steps) {
      const f = db.features(p.out)!;
      if (isLand(p.out) || themeFit(f, weights) < 0.5) continue;
      const score = scoreOn(before, p.out);
      if (score >= 45) expect(p.ratingAfter - p.ratingBefore, `${db.get(p.out)!.name} (${score})`).toBeGreaterThanOrEqual(1);
    }
    const cut = new Set(steps.map((x) => db.get(x.p.out)!.name));
    for (const strong of ['Glorybringer', 'Stormbreath Dragon', 'Skarrgan Hellkite']) expect(cut.has(strong), strong).toBe(false);
  });

  it('never adds an off-plan card and then cuts theme cards for lands to cast it', () => {
    const deck = fixtureDeck('upgraded', 3); // Lathril: its land count is on target
    const weights = resolveThemeWeights(deck, ctx);
    for (const { p, before } of walk(deck)) {
      if (!isLand(p.in) || isLand(p.out)) continue;
      // A land came in for a spell: only when lands were short, and never for a strong Elf.
      expect(p.reason).toMatch(/^Add \d+ lands?/);
      const f = db.features(p.out)!;
      expect(themeFit(f, weights) >= 0.5 && scoreOn(before, p.out) >= 45, db.get(p.out)!.name).toBe(false);
    }
  });

  it('the cEDH list keeps its own plans: combo pieces and side themes are not offered as cuts', () => {
    const deck = fixtureDeck('cedh', 5);
    const side = sideThemes(deck, ctx);
    expect(side.size).toBeGreaterThanOrEqual(1);
    const guarded = (id: string) => {
      const f = db.features(id)!;
      return [...side].some((axis) => Math.max(f.axes[axis]?.e ?? 0, f.axes[axis]?.p ?? 0) >= 0.6);
    };
    const cuts = [...improveDeck(deck, ctx, opts()), ...suggestSwaps(deck, ctx, opts(), 8)];
    expect(cuts.length).toBeGreaterThan(0);
    for (const p of cuts) if (!isLand(p.out)) expect(guarded(p.out), db.get(p.out)!.name).toBe(false);
  });

  it('graveyard hate means hate: a card that exiles one creature card to copy it is not it', () => {
    // Dino DNA (real oracle text): carries the role in the features, is no answer to a graveyard deck.
    expect(isGraveyardHate('Imprint — {1}, {T}: Exile target creature card from a graveyard. Activate only as a sorcery.\n{6}: Create a token that\'s a copy of a creature card exiled with Dino DNA, except it\'s a 6/6 green Dinosaur creature with trample. Activate only as a sorcery.')).toBe(false);
    for (const name of ['Bojuka Bog', 'Soul-Guide Lantern', 'Rest in Peace', "Tormod's Crypt", 'Relic of Progenitus', 'Scavenging Ooze', 'Leyline of the Void']) {
      const c = db.byName(name);
      if (c) expect(isGraveyardHate(c.oracleText), name).toBe(true);
    }
    // No improve run brings in a card for "graveyard hate" that is not.
    for (const [name, target] of [['precon', 2], ['upgraded', 3], ['cedh', 5]] as const) {
      for (const p of improveDeck(fixtureDeck(name, target), ctx, opts())) {
        if (/graveyard hate|answers? to graveyards/.test(p.reason)) expect(isGraveyardHate(db.get(p.in)!.oracleText), db.get(p.in)!.name).toBe(true);
      }
    }
  });

  it('improves an unfinished deck without tripping on the size violation', () => {
    const full = fixtureDeck('upgraded', 3);
    const short = { ...full, main: full.main.slice(0, 80) };
    const proposals = improveDeck(short, ctx, opts(), 6);
    expect(proposals.length).toBeGreaterThan(0);
    for (const p of proposals) expect(p.ratingAfter).toBeGreaterThanOrEqual(p.ratingBefore);
    expect(size(applySwaps(short, proposals))).toBe(size(short));
    expect(rateDeck(applySwaps(short, proposals), ctx).rating).toBeGreaterThanOrEqual(rateDeck(short, ctx).rating);
  });
});
