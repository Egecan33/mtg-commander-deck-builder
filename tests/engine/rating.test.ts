import { describe, expect, it } from 'vitest';
import { autoBuild, mulberry32 } from '@/engine/builder';
import { rateDeck, ratingCapped } from '@/engine/rating';
import { roleNeeds } from '@/engine/targets';
import { parseDecklist } from '@/engine/text';
import type { Bracket, Deck, DeckRating, EngineContext, Role } from '@/engine/types';
import { card, deckText, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };

function fixtureDeck(name: 'precon' | 'upgraded' | 'cedh', target: Bracket): Deck {
  const p = parseDecklist(deckText(name), db);
  return { id: null, name, commanders: p.commanders, companion: p.companion, chosenColor: null, main: p.main, targetBracket: target, themeWeights: null };
}
const sub = (r: DeckRating, key: string) => {
  const s = r.subscores.find((x) => x.key === key);
  if (!s) throw new Error(`no sub-score ${key}`);
  return s;
};
const allFixes = (r: DeckRating) => r.subscores.flatMap((s) => s.fixes);
const hasRole = (oracleId: string, role: Role) => db.features(oracleId)?.roles.includes(role) ?? false;
const isLand = (oracleId: string) => (db.features(oracleId)?.landWeight ?? 0) >= 1;

/** Every number in the rating is finite. */
function expectFinite(r: DeckRating) {
  expect(Number.isFinite(r.rating)).toBe(true);
  expect(r.rating).toBeGreaterThanOrEqual(0);
  expect(r.rating).toBeLessThanOrEqual(100);
  for (const s of r.subscores) {
    expect(Number.isFinite(s.value), s.key).toBe(true);
    expect(s.value, s.key).toBeGreaterThanOrEqual(0);
    expect(s.value, s.key).toBeLessThanOrEqual(1);
    for (const f of s.fixes) expect(f.text, s.key).not.toMatch(/NaN|undefined|Infinity/);
  }
}

const WEIGHTS: Record<string, number> = {
  mana: 18, roles: 16, synergy: 16, curve: 10, interaction: 10, wincons: 10, consistency: 10, bracket: 10,
};

describe('rateDeck shape', () => {
  const r = rateDeck(fixtureDeck('precon', 2), ctx);

  it('returns the eight sub-scores with the plan weights', () => {
    expect(Object.fromEntries(r.subscores.map((s) => [s.key, s.weight]))).toEqual(WEIGHTS);
    for (const s of r.subscores) expect(s.label.length).toBeGreaterThan(0);
  });

  it('rating is the rounded weighted sum for a legal deck', () => {
    const sum = r.subscores.reduce((a, s) => a + s.weight * s.value, 0);
    expect(r.rating).toBe(Math.round(sum));
  });

  it('every sub-score has at most three fixes, for all fixture decks and brackets', () => {
    for (const name of ['precon', 'upgraded', 'cedh'] as const) {
      for (const b of [1, 2, 3, 4, 5] as Bracket[]) {
        const rating = rateDeck(fixtureDeck(name, b), ctx);
        expectFinite(rating);
        for (const s of rating.subscores) expect(s.fixes.length, `${name} B${b} ${s.key}`).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('rateDeck on the reference decks', () => {
  it('precon at target 2 rates 55-80 and is legal and complete', () => {
    const r = rateDeck(fixtureDeck('precon', 2), ctx);
    expect(r.legal).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.rating).toBeGreaterThanOrEqual(55);
    expect(r.rating).toBeLessThanOrEqual(80);
  });

  it('cEDH at target 5 rates at least 60 and is not punished for its land count', () => {
    const r = rateDeck(fixtureDeck('cedh', 5), ctx);
    expect(r.rating).toBeGreaterThanOrEqual(60);
    expect(sub(r, 'mana').value).toBeGreaterThanOrEqual(0.6);
  });

  it('cEDH at target 2 has bracket fit 0 and names the violations', () => {
    const r = rateDeck(fixtureDeck('cedh', 2), ctx);
    const b = sub(r, 'bracket');
    expect(b.value).toBe(0);
    expect(b.fixes.length).toBeGreaterThan(0);
    expect(b.fixes[0].text).toMatch(/Game Changer|combo/i);
  });

  it('upgraded deck at target 3 is legal and rates at least 55', () => {
    const r = rateDeck(fixtureDeck('upgraded', 3), ctx);
    expect(r.legal).toBe(true);
    expect(r.rating).toBeGreaterThanOrEqual(55);
  });
});

describe('rateDeck shortfalls become fixes', () => {
  it('removing 10 lands from the precon lowers mana and adds a land fix', () => {
    const full = fixtureDeck('precon', 2);
    const cut = { ...full, main: [...full.main] };
    let removed = 0;
    cut.main = cut.main.flatMap((e) => {
      if (removed >= 10 || !isLand(e.oracleId)) return [e];
      const take = Math.min(e.qty, 10 - removed);
      removed += take;
      return e.qty - take > 0 ? [{ ...e, qty: e.qty - take }] : [];
    });
    expect(removed).toBe(10);
    const before = rateDeck(full, ctx);
    const after = rateDeck(cut, ctx);
    expect(sub(after, 'mana').value).toBeLessThan(sub(before, 'mana').value);
    const fix = sub(after, 'mana').fixes.find((f) => f.filter?.land === true);
    expect(fix).toBeDefined();
    expect(fix!.text).toMatch(/land/i);
  });

  it('removing all ramp adds a ramp fix and lowers role coverage', () => {
    const full = fixtureDeck('precon', 2);
    const cut = { ...full, main: full.main.filter((e) => !hasRole(e.oracleId, 'ramp')) };
    expect(cut.main.length).toBeLessThan(full.main.length);
    const before = rateDeck(full, ctx);
    const after = rateDeck(cut, ctx);
    expect(allFixes(after).some((f) => f.filter?.role === 'ramp')).toBe(true);
    expect(sub(after, 'roles').fixes.some((f) => f.filter?.role === 'ramp')).toBe(true);
    expect(sub(after, 'roles').value).toBeLessThan(sub(before, 'roles').value);
  });

  const bigThreat = (oracleId: string) => Number(db.get(oracleId)?.power) >= 6;

  it('a deck with no win conditions and no heavy hitters scores 0 there and says so', () => {
    const full = fixtureDeck('precon', 2);
    const cut = { ...full, main: full.main.filter((e) => !hasRole(e.oracleId, 'win-condition') && !bigThreat(e.oracleId)) };
    const w = sub(rateDeck(cut, ctx), 'wincons');
    expect(w.value).toBe(0);
    expect(w.fixes[0].filter?.role).toBe('win-condition');
    expect(w.fixes[0].text).toMatch(/win condition/i);
  });

  it('heavy hitters count as a way to win: the dragon precon is not scored 0 on win conditions', () => {
    const full = fixtureDeck('precon', 2);
    expect(full.main.filter((e) => bigThreat(e.oracleId)).length).toBeGreaterThanOrEqual(6);
    expect(sub(rateDeck(full, ctx), 'wincons').value).toBeGreaterThan(0.3);
  });

  it('far too much ramp costs less than having none', () => {
    // Kinnan's list is mana dorks and rocks. Under Kinnan's own big-mana theme they are the deck and the
    // ramp band has room for them; with the theme set elsewhere they are 30-odd ramp cards against 12-16.
    const d = { ...fixtureDeck('cedh', 5), themeWeights: { lifegain: 1 } };
    const kept = d.main.filter((e) => !hasRole(e.oracleId, 'ramp'));
    const cut = d.main.length - kept.length;
    // Same size, the ramp swapped for basics, so the targets do not move.
    const none = { ...d, main: [...kept, { oracleId: card('Island').oracleId, qty: cut, locked: false }] };
    const over = sub(rateDeck(d, ctx), 'roles');
    const short = sub(rateDeck(none, ctx), 'roles');
    expect(over.fixes.some((f) => /over on ramp/.test(f.text))).toBe(true);
    expect(short.fixes.some((f) => f.filter?.role === 'ramp')).toBe(true);
    expect(over.value).toBeGreaterThan(short.value);
  });

  it('a theme read off the deck instead of the commander is flagged and not given full marks', () => {
    const r = sub(rateDeck(fixtureDeck('precon', 2), ctx), 'synergy'); // Eshki names no axis; the deck is Dragons
    expect(r.value).toBeLessThan(1);
    expect(r.fixes.some((f) => f.filter?.axis === 'typal:dragon' && /commander/i.test(f.text))).toBe(true);
    const own = sub(rateDeck({ ...fixtureDeck('precon', 2), themeWeights: { 'typal:dragon': 1 } }, ctx), 'synergy');
    expect(own.value).toBeGreaterThan(r.value);
  });

  it('colour-source fixes only name colours the deck plays', () => {
    const r = rateDeck(fixtureDeck('precon', 2), ctx); // Temur: no W or B
    for (const f of allFixes(r)) if (f.filter?.color) expect(['U', 'R', 'G']).toContain(f.filter.color);
  });
});

describe('rateDeck legality and incomplete decks', () => {
  it('an illegal deck rates at most 40 and lists its violations', () => {
    const d = fixtureDeck('precon', 2);
    d.main = [...d.main, { oracleId: card('Swords to Plowshares').oracleId, qty: 1, locked: false }];
    const r = rateDeck(d, ctx);
    expect(r.legal).toBe(false);
    expect(r.rating).toBeLessThanOrEqual(40);
    expect(r.violations.map((v) => v.code)).toEqual(expect.arrayContaining(['identity', 'size']));
  });

  it('a 40-card partial deck returns a rating, complete false, and no NaN', () => {
    const d = fixtureDeck('precon', 2);
    d.main = d.main.slice(0, 39);
    const r = rateDeck(d, ctx);
    expect(r.complete).toBe(false);
    expectFinite(r);
    expect(r.rating).toBeLessThanOrEqual(40); // 40 cards of a hundred
    expect(r.legal).toBe(false);
  });

  it('targets scale with a partial deck: half the precon is not told to add 20 lands', () => {
    const d = fixtureDeck('precon', 2);
    d.main = d.main.filter((_, i) => i % 2 === 0);
    const r = rateDeck(d, ctx);
    expectFinite(r);
    for (const f of allFixes(r)) {
      const m = /add (\d+)/i.exec(f.text);
      if (m && f.filter?.land) expect(Number(m[1])).toBeLessThan(8);
    }
    // The half deck's role coverage is good for its size; as a share of a finished deck it is about half of that.
    expect(sub(r, 'roles').value).toBeGreaterThan(0.25);
    expect(sub(r, 'roles').value).toBeLessThanOrEqual(0.5);
  });

  it('an empty deck rates 0-40 and does not throw', () => {
    const empty: Deck = { id: null, name: '', commanders: [], companion: null, chosenColor: null, main: [], targetBracket: 3, themeWeights: null };
    const r = rateDeck(empty, ctx);
    expectFinite(r);
    expect(r.rating).toBeLessThanOrEqual(40);
    expect(r.complete).toBe(false);
    expect(r.legal).toBe(false);
  });

  it('a commander alone does not throw', () => {
    const d: Deck = { id: null, name: '', commanders: [card('Lathril, Blade of the Elves').oracleId], companion: null, chosenColor: null, main: [], targetBracket: 3, themeWeights: null };
    expectFinite(rateDeck(d, ctx));
  });

  it('unknown cards and junk quantities do not throw or produce NaN', () => {
    const d = fixtureDeck('precon', 2);
    d.main = [
      ...d.main.slice(0, 60),
      { oracleId: 'not-a-card', qty: 3, locked: false },
      { oracleId: card('Forest').oracleId, qty: Number.NaN, locked: false },
      { oracleId: card('Island').oracleId, qty: -2, locked: false },
    ];
    const r = rateDeck({ ...d, targetBracket: 9 as Bracket }, ctx);
    expectFinite(r);
    expect(r.violations.some((v) => v.code === 'unknown-card')).toBe(true);
  });

  it('a colourless commander deck gets no coloured-source fixes', () => {
    const d: Deck = {
      id: null, name: '', commanders: [card('Kozilek, the Great Distortion').oracleId], companion: null, chosenColor: null,
      main: [{ oracleId: card('Wastes').oracleId, qty: 36, locked: false }, { oracleId: card('Sol Ring').oracleId, qty: 1, locked: false }],
      targetBracket: 2, themeWeights: null,
    };
    const r = rateDeck(d, ctx);
    expectFinite(r);
    expect(allFixes(r).every((f) => !f.filter?.color)).toBe(true);
  });

  it('does not mutate the deck', () => {
    const d = fixtureDeck('upgraded', 3);
    const snapshot = JSON.stringify(d);
    rateDeck(d, ctx);
    expect(JSON.stringify(d)).toBe(snapshot);
  });
});

describe('rateDeck: review fixes', () => {
  it('rates a typal deck on its named creature type, not on the any-type bucket', () => {
    // With the any-type axis weighted highest the deck used to be told "Typal (any type): only N
    // enablers against M payoffs", although every Elf in it is an enabler for those payoffs.
    const elves = { ...fixtureDeck('upgraded', 3), themeWeights: { typal: 1, 'typal:elf': 0.9, tokens: 0.8 } };
    const r = sub(rateDeck(elves, ctx), 'synergy');
    for (const f of r.fixes) {
      expect(f.text).not.toMatch(/any type/i);
      expect(f.filter?.axis).not.toBe('typal');
    }
    const natural = sub(rateDeck(fixtureDeck('upgraded', 3), ctx), 'synergy');
    expect(r.value).toBeGreaterThanOrEqual(natural.value - 0.05);
  });

  it('a deck that names only "any type" is not asked for enablers of it', () => {
    const anyType = { ...fixtureDeck('upgraded', 3), themeWeights: { typal: 1 } };
    const r = sub(rateDeck(anyType, ctx), 'synergy');
    expect(r.fixes.some((f) => /enablers/.test(f.text))).toBe(false);
    expectFinite(rateDeck(anyType, ctx));
  });
});

describe('rateDeck: decks that are not 100 cards or have no commander (review focus 3)', () => {
  const up = () => fixtureDeck('upgraded', 3);
  const cases: [string, () => Deck][] = [
    ['37 cards', () => ({ ...up(), main: up().main.slice(0, 36) })],
    ['104 cards', () => ({ ...up(), main: [...up().main, ...['Sol Ring', 'Counterspell', 'Lightning Bolt', 'Time Warp'].map((n) => ({ oracleId: card(n).oracleId, qty: 1, locked: false }))] })],
    ['99 cards, no commander', () => ({ ...up(), commanders: [] })],
    ['no commander, no cards', () => ({ ...up(), commanders: [], main: [] })],
    ['three commanders', () => ({ ...up(), commanders: [...up().commanders, card('Krenko, Mob Boss').oracleId, card('Talrand, Sky Summoner').oracleId] })],
  ];
  for (const [name, make] of cases) {
    it(`${name}: finite, at most 40, never complete`, () => {
      for (const target of [1, 2, 3, 4, 5] as Bracket[]) {
        const r = rateDeck({ ...make(), targetBracket: target }, ctx);
        expectFinite(r);
        expect(r.legal).toBe(false);
        expect(r.complete).toBe(false);
        expect(r.rating).toBeLessThanOrEqual(40);
        expect(r.subscores.reduce((n, s) => n + s.weight, 0)).toBe(100);
        for (const s of r.subscores) expect(s.fixes.length).toBeLessThanOrEqual(3);
      }
    });
  }
});

describe('rateDeck: quality pass 2', () => {
  const lathril = (): Deck => ({ id: null, name: '', commanders: [card('Lathril, Blade of the Elves').oracleId], companion: null, chosenColor: null, main: [], targetBracket: 3, themeWeights: null });
  /** The deck's first `n` main-deck cards in a fixed shuffled order. */
  function partial(full: Deck, n: number, seed = 7): Deck {
    const flat = full.main.flatMap((e) => Array<string>(e.qty).fill(e.oracleId));
    const rng = mulberry32(seed);
    for (let i = flat.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [flat[i], flat[j]] = [flat[j], flat[i]];
    }
    const counts = new Map<string, number>();
    for (const id of flat.slice(0, n)) counts.set(id, (counts.get(id) ?? 0) + 1);
    return { ...full, main: [...counts].map(([oracleId, qty]) => ({ oracleId, qty, locked: false })) };
  }

  describe('a deck short of 100 cards is rated so far, not capped', () => {
    it('99 good cards rate close to the full deck, well above the illegal cap', () => {
      const full = fixtureDeck('upgraded', 3);
      const r = rateDeck(partial(full, 98), ctx);
      expect(r.legal).toBe(false);
      expect(r.complete).toBe(false);
      expect(r.violations.map((v) => v.code)).toEqual(['size']);
      expect(r.rating).toBeGreaterThan(60);
      expect(Math.abs(r.rating - rateDeck(full, ctx).rating)).toBeLessThanOrEqual(4);
      expect(r.rating).toBe(Math.round(r.subscores.reduce((a, s) => a + s.weight * s.value, 0)));
    });

    it('a commander alone rates under 20, at every bracket', () => {
      for (const name of ['Lathril, Blade of the Elves', 'Kenrith, the Returned King', 'Kozilek, the Great Distortion', 'Krenko, Mob Boss']) {
        for (const target of [1, 2, 3, 4, 5] as Bracket[]) {
          const r = rateDeck({ ...lathril(), commanders: [card(name).oracleId], targetBracket: target }, ctx);
          expectFinite(r);
          expect(r.rating, `${name} B${target}`).toBeLessThan(20);
        }
      }
      const pair = rateDeck({ ...lathril(), commanders: [card('Thrasios, Triton Hero').oracleId, card('Tymna the Weaver').oracleId] }, ctx);
      expect(pair.rating).toBeLessThan(20);
    });

    for (const [name, target] of [['precon', 2], ['upgraded', 3], ['cedh', 5]] as const) {
      it(`${name}: the rating rises as the deck is filled in and ends at the full rating`, () => {
        const full = fixtureDeck(name, target);
        for (const seed of [7, 8]) {
          const ratings = [0, 24, 49, 74, 99].map((n) => rateDeck(partial(full, n, seed), ctx).rating);
          for (let i = 1; i < ratings.length; i++) expect(ratings[i], `${ratings.join(' ')}`).toBeGreaterThanOrEqual(ratings[i - 1] - 2);
          expect(ratings[0]).toBeLessThan(20);
          expect(ratings[2]).toBeGreaterThan(ratings[0] + 15);
          expect(ratings[4]).toBe(rateDeck(full, ctx).rating);
        }
      });
    }

    it('empty categories do not count as met', () => {
      // Ten lands and a commander: no ramp, no draw, no interaction, no win condition.
      const d = { ...lathril(), main: [{ oracleId: card('Forest').oracleId, qty: 5, locked: false }, { oracleId: card('Swamp').oracleId, qty: 5, locked: false }] };
      const r = rateDeck(d, ctx);
      expect(sub(r, 'roles').value).toBeLessThan(0.03); // the commander herself is all there is
      expect(sub(r, 'interaction').value).toBeLessThan(0.03);
      expect(sub(r, 'wincons').value).toBe(0);
      // Scaled quality would read 1.0 for every band that rounds to zero; nothing here is near it.
      for (const s of r.subscores) expect(s.value, s.key).toBeLessThan(0.15);
      // The same with only lands missing: mana is not "on target" with no land at all.
      const noLand = { ...lathril(), main: [{ oracleId: card('Sol Ring').oracleId, qty: 1, locked: false }] };
      expect(sub(rateDeck(noLand, ctx), 'mana').value).toBe(0);
    });

    it('over 100 cards and every other violation still cap at 40', () => {
      const full = fixtureDeck('upgraded', 3);
      expect(rateDeck(full, ctx).rating).toBeGreaterThan(60);
      const over = { ...full, main: [...full.main, { oracleId: card('Sol Ring').oracleId, qty: 1, locked: false }] };
      const rOver = rateDeck(over, ctx);
      expect(ratingCapped(over, rOver.violations)).toBe(true);
      expect(rOver.rating).toBeLessThanOrEqual(40);
      // 99 cards, one of them outside the colour identity: short AND illegal, so capped.
      const offColour = partial(full, 97);
      offColour.main.push({ oracleId: card('Lightning Bolt').oracleId, qty: 1, locked: false });
      const rOff = rateDeck(offColour, ctx);
      expect(rOff.violations.map((v) => v.code).sort()).toEqual(['identity', 'size']);
      expect(ratingCapped(offColour, rOff.violations)).toBe(true);
      expect(rOff.rating).toBeLessThanOrEqual(40);
      // The same 99 cards without the offender are only short: not capped.
      const short = partial(full, 97);
      expect(ratingCapped(short, rateDeck(short, ctx).violations)).toBe(false);
      // No commander is a violation of its own.
      expect(rateDeck({ ...full, commanders: [] }, ctx).rating).toBeLessThanOrEqual(40);
    });
  });

  describe('a mana base that cannot cast the deck', () => {
    const built = autoBuild({ ...lathril(), commanders: [card('Kenrith, the Returned King').oracleId], targetBracket: 3 }, ctx, { ownedOnly: false, owned: null, maxPriceUsd: null, seed: 1 });
    /** The deck with `n` of its non-Plains lands (all of them when n is Infinity) turned into Plains. */
    function onPlains(n: number): Deck {
      let left = n;
      let moved = 0;
      const main = built.main.flatMap((e) => {
        if (left <= 0 || !isLand(e.oracleId) || e.oracleId === card('Plains').oracleId) return [e];
        const take = Math.min(left, e.qty);
        left -= take;
        moved += take;
        return e.qty - take > 0 ? [{ ...e, qty: e.qty - take }] : [];
      });
      return { ...built, main: [...main, { oracleId: card('Plains').oracleId, qty: moved, locked: false }] };
    }

    it('a five-colour deck on Plains: mana under 0.2, rating under 60, fixes name the colours and the shortfall', () => {
      const good = rateDeck(built, ctx);
      expect(good.legal).toBe(true);
      expect(sub(good, 'mana').value).toBeGreaterThan(0.75);
      const r = rateDeck(onPlains(Infinity), ctx);
      expect(r.legal).toBe(true);
      expect(sub(r, 'mana').value).toBeLessThan(0.2);
      expect(r.rating).toBeLessThan(60);
      const fixes = sub(r, 'mana').fixes.filter((f) => f.filter?.color);
      expect(fixes.length).toBeGreaterThanOrEqual(2);
      for (const f of fixes) {
        const m = /^(\d+) short on (blue|black|red|green) sources for .+: have ([\d.]+), need (\d+)\.$/.exec(f.text);
        expect(m, f.text).not.toBeNull();
        expect(Number(m![1])).toBeGreaterThanOrEqual(10);
        expect(Number(m![1])).toBe(Math.ceil(Number(m![4]) - Number(m![3])));
        expect({ blue: 'U', black: 'B', red: 'R', green: 'G' }[m![2]]).toBe(f.filter!.color);
      }
    });

    it('every few lands lost to the wrong colour cost more: the mana score falls continuously, with no flat stretch', () => {
      const values = [0, 4, 8, 12, 16, 24].map((n) => sub(rateDeck(onPlains(n), ctx), 'mana').value);
      const ratings = [0, 4, 8, 12, 16, 24].map((n) => rateDeck(onPlains(n), ctx).rating);
      for (let i = 1; i < values.length; i++) {
        expect(values[i], values.join(' ')).toBeLessThan(values[i - 1]);
        expect(ratings[i], ratings.join(' ')).toBeLessThanOrEqual(ratings[i - 1]);
      }
      expect(values[2]).toBeLessThan(values[0] - 0.08); // eight lands in, already a clear loss
      expect(ratings[5]).toBeLessThan(ratings[0] - 20);
    });

    it('cards the mana cannot cast count for less everywhere else too', () => {
      const good = rateDeck(built, ctx);
      const bad = rateDeck(onPlains(Infinity), ctx);
      for (const key of ['roles', 'synergy', 'curve', 'interaction', 'consistency']) {
        expect(sub(bad, key).value, key).toBeLessThan(sub(good, key).value * 0.8);
      }
      expect(sub(bad, 'bracket').value).toBe(sub(good, 'bracket').value);
    });
  });

  it('a deck drowning in lands, or starved of them, is not rated as a working deck', () => {
    const full = fixtureDeck('upgraded', 3);
    const spells = full.main.filter((e) => !isLand(e.oracleId));
    const withLands = (keep: number, lands: number): Deck => ({ ...full, main: [...spells.slice(0, keep), { oracleId: card('Forest').oracleId, qty: lands, locked: false }] });
    const n = spells.reduce((a, e) => a + e.qty, 0);
    const good = rateDeck(full, ctx);
    const flooded = rateDeck(withLands(39, 60), ctx);
    expect(flooded.legal).toBe(true);
    expect(sub(flooded, 'mana').value).toBeLessThan(0.4);
    expect(flooded.rating).toBeLessThan(45);
    expect(sub(flooded, 'mana').fixes.some((f) => /^Cut \d+ lands/.test(f.text))).toBe(true);
    // A few lands off costs a little, not the deck.
    const light = rateDeck(withLands(n, 99 - n), ctx);
    expect(light.rating).toBeGreaterThan(good.rating - 12);
    const starved = rateDeck({ ...full, main: [...spells, { oracleId: card('Forest').oracleId, qty: 14, locked: false }, { oracleId: card('Sol Ring').oracleId, qty: 99 - n - 14, locked: false }] }, ctx);
    expect(sub(starved, 'mana').value).toBeLessThan(0.45);
  });

  describe('role numbers are the shared ones (targets.roleNeeds)', () => {
    const decks: [string, Deck][] = [
      ['precon B2', fixtureDeck('precon', 2)], ['upgraded B3', fixtureDeck('upgraded', 3)], ['cedh B5', fixtureDeck('cedh', 5)],
      ['cedh B2', fixtureDeck('cedh', 2)], ['half the upgraded deck', partial(fixtureDeck('upgraded', 3), 50)],
    ];
    for (const [name, d] of decks) {
      it(`${name}: every role fix quotes roleNeeds' count, band and shortfall`, () => {
        const needs = roleNeeds(d, ctx, { scaled: true });
        const byLabel = new Map(needs.map((n) => [n.label, n]));
        const fixes = sub(rateDeck(d, ctx), 'roles').fixes;
        for (const f of fixes) {
          const m = /^(\d+) (short|over) on ([a-z ]+): have (\d+), want (\d+)(?:-(\d+))?\./.exec(f.text);
          expect(m, f.text).not.toBeNull();
          const need = byLabel.get(m![3]);
          expect(need, f.text).toBeDefined();
          expect(Number(m![4])).toBe(need!.count);
          expect(Number(m![5])).toBe(need!.band.lo);
          expect(Number(m![6] ?? m![5])).toBe(need!.band.hi);
          expect(Number(m![1])).toBe(m![2] === 'short' ? need!.short : need!.over);
          if (m![2] === 'short') expect(f.filter?.role).toBe(need!.role);
        }
        // The three largest shortfalls are reported: a role roleNeeds calls short by 3 or more is never left out silently.
        const big = needs.filter((n) => n.short >= 3 && ['ramp', 'draw', 'spot-removal'].includes(n.role));
        if (big.length > 0 && big.length <= 3) for (const n of big) expect(fixes.some((f) => f.filter?.role === n.role), n.role).toBe(true);
      });
    }

    it('counterspells are a band of their own in a blue deck, as in the scorer', () => {
      const d = fixtureDeck('cedh', 5);
      const needs = roleNeeds(d, ctx, { scaled: true });
      expect(needs.some((n) => n.role === 'counterspell')).toBe(true);
      const all = allFixes(rateDeck(d, ctx)).map((f) => f.text).join('\n');
      expect(all).not.toMatch(/targeted interaction/);
    });
  });
});
