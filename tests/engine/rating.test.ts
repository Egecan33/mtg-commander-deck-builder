import { describe, expect, it } from 'vitest';
import { autoBuild, mulberry32 } from '@/engine/builder';
import { deckNetwork } from '@/engine/network';
import { QUALITY_EXPECTED, rateDeck, ratingCapped } from '@/engine/rating';
import { createScorer } from '@/engine/scoring';
import { summarizeDeck } from '@/engine/summary';
import { roleNeeds, targetsFor } from '@/engine/targets';
import { parseDecklist } from '@/engine/text';
import type { Bracket, Card, Deck, DeckRating, EngineContext, Role } from '@/engine/types';
import { card, deckText, fixtureDb } from '../helpers/fixture-db';
import { withFiveUnconnected, withTenRandom } from '../helpers/network';

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
  mana: 16, roles: 14, synergy: 14, curve: 9, interaction: 9, wincons: 9, consistency: 9, bracket: 8, quality: 12,
};

describe('rateDeck shape', () => {
  const r = rateDeck(fixtureDeck('precon', 2), ctx);

  it('returns the nine sub-scores with the plan weights', () => {
    expect(Object.fromEntries(r.subscores.map((s) => [s.key, s.weight]))).toEqual(WEIGHTS);
    expect(Object.values(WEIGHTS).reduce((a, b) => a + b, 0)).toBe(100);
    expect(r.subscores.map((s) => s.key)).toEqual(['mana', 'roles', 'synergy', 'quality', 'curve', 'interaction', 'wincons', 'consistency', 'bracket']);
    expect(sub(r, 'quality').label).toBe('Card quality');
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
  it('precon at target 2 rates 55-82 and is legal and complete', () => {
    const r = rateDeck(fixtureDeck('precon', 2), ctx);
    expect(r.legal).toBe(true);
    expect(r.complete).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.rating).toBeGreaterThanOrEqual(55);
    expect(r.rating).toBeLessThanOrEqual(82);
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
    // (The over-ramp note is still made; the three larger package shortfalls show first.)
    expect(roleNeeds(d, ctx).find((n) => n.role === 'ramp')!.over).toBeGreaterThan(10);
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
        // "want" is the count at which the fix goes away (90% of the requirement), no longer Karsten's whole number.
        const m = /^(\d+) short on (blue|black|red|green) sources for .+: have ([\d.]+), want (\d+)\.$/.exec(f.text);
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

  it("the land count is free within two of the plan's target, and one of a target the user set", () => {
    const full = fixtureDeck('upgraded', 3);
    const spells = full.main.filter((e) => !isLand(e.oracleId)).sort((a, b) => db.get(a.oracleId)!.oracleId.localeCompare(db.get(b.oracleId)!.oracleId));
    const n = spells.reduce((a, e) => a + e.qty, 0);
    const landFix = (d: Deck) => sub(rateDeck(d, ctx), 'mana').fixes.some((f) => /^(Add|Cut) \d+ lands?/.test(f.text));
    let checked = 0;
    for (let lands = 31; lands <= 46; lands++) {
      const d: Deck = { ...full, main: [...spells.slice(0, Math.min(n, 99 - lands)), { oracleId: card('Forest').oracleId, qty: lands, locked: false }] };
      const s = summarizeDeck(d, db);
      if (s.cardCount !== 100) continue;
      const gap = Math.abs(s.landsEffective - targetsFor(d, ctx, s).lands);
      if (gap <= 2) expect(landFix(d), `${lands} lands, gap ${gap}`).toBe(false);
      if (gap >= 3) expect(landFix(d), `${lands} lands, gap ${gap}`).toBe(true);
      checked++;
    }
    expect(checked).toBeGreaterThan(8);
    const pinned: Deck = { ...full, roleTargets: { land: Math.round(summarizeDeck(full, db).landsEffective) + 2 } };
    expect(landFix(pinned)).toBe(true);
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

    it('counterspells count inside the Removal package in a blue deck, as in the scorer and the Packages tab', () => {
      const d = fixtureDeck('cedh', 5);
      const needs = roleNeeds(d, ctx, { scaled: true });
      expect(needs.some((n) => n.role === 'counterspell')).toBe(false);
      const counters = d.main.filter((e) => hasRole(e.oracleId, 'counterspell')).reduce((n, e) => n + e.qty, 0);
      expect(counters).toBeGreaterThan(0);
      expect(needs.find((n) => n.role === 'spot-removal')!.count).toBeGreaterThanOrEqual(counters);
      const all = allFixes(rateDeck(d, ctx)).map((f) => f.text).join('\n');
      expect(all).not.toMatch(/targeted interaction/);
    });
  });
});

describe('rateDeck: which fixes Fix deck acts on', () => {
  it('every fix on the reference decks says whether Fix deck can act on it', () => {
    let n = 0;
    for (const name of ['precon', 'upgraded', 'cedh'] as const) {
      for (const target of [1, 2, 3, 4, 5] as Bracket[]) {
        for (const f of allFixes(rateDeck(fixtureDeck(name, target), ctx))) {
          expect(typeof f.actionable, `${name} B${target}: ${f.text}`).toBe('boolean');
          n++;
        }
      }
    }
    expect(n).toBeGreaterThan(20);
  });

  it('shortfalls Fix deck works on are actionable; advice it does not act on is not', () => {
    const all = (['precon', 'upgraded', 'cedh'] as const).flatMap((name) => ([1, 2, 3, 4, 5] as Bracket[]).flatMap((t) => allFixes(rateDeck(fixtureDeck(name, t), ctx))));
    // The bracket's own rules (Game Changers at Bracket 2): the bracket step of Fix deck cuts them.
    const overBracket = sub(rateDeck(fixtureDeck('cedh', 2), ctx), 'bracket').fixes;
    expect(overBracket.length).toBeGreaterThan(0);
    for (const f of overBracket) expect(f.actionable, f.text).toBe(true);
    // A role short of its band: Fix deck asks Improve for that role.
    const short = all.filter((f) => /^\d+ short on /.test(f.text));
    expect(short.length).toBeGreaterThan(0);
    for (const f of short) expect(f.actionable, f.text).toBe(true);
    // "Plays like Bracket N" and "N over on …" are advice: nothing in Fix deck acts on them.
    const advice = all.filter((f) => /^Plays like Bracket|^\d+ over on /.test(f.text));
    expect(advice.length).toBeGreaterThan(0);
    for (const f of advice) expect(f.actionable, f.text).toBe(false);
  });
});

describe('rateDeck: card quality (the scorer\'s own quality part)', () => {
  /** The scorer's quality part for a card, points / max; null for a gated card (no parts). */
  const qualityOf = (scorer: ReturnType<typeof createScorer>, c: Card): number | null => {
    const part = scorer.score(c).parts.find((p) => p.key === 'quality');
    return part && part.max > 0 ? part.points / part.max : null;
  };
  const lathril = (): Deck => ({ id: null, name: '', commanders: [card('Lathril, Blade of the Elves').oracleId], companion: null, chosenColor: null, main: [], targetBracket: 2, themeWeights: null });

  it('weak cards lower card quality and the rating', () => {
    const before = fixtureDeck('precon', 2);
    const scorer = createScorer(before, ctx);
    const q = (c: Card) => qualityOf(scorer, c) ?? -1;
    const inDeck = new Set([...before.commanders, ...before.main.map((e) => e.oracleId)]);
    // The precon's 15 strongest spells, each swapped for the weakest fixture card that shares a role with it.
    const strongest = before.main.filter((e) => !isLand(e.oracleId)).map((e) => db.get(e.oracleId)!).sort((a, b) => q(b) - q(a) || a.name.localeCompare(b.name)).slice(0, 15);
    const pool = db.all().filter((c) => !inDeck.has(c.oracleId) && !isLand(c.oracleId) && db.features(c.oracleId) && scorer.score(c).gate === null);
    const swaps = new Map<string, string>();
    const taken = new Set<string>();
    for (const c of strongest) {
      const roles = db.features(c.oracleId)!.roles;
      const same = pool.filter((x) => !taken.has(x.oracleId) && (roles.length === 0 ? db.features(x.oracleId)!.roles.length === 0 : roles.some((r) => hasRole(x.oracleId, r))));
      const weakest = same.sort((a, b) => q(a) - q(b) || a.name.localeCompare(b.name))[0];
      expect(weakest, c.name).toBeDefined();
      expect(q(weakest)).toBeLessThan(q(c));
      taken.add(weakest.oracleId);
      swaps.set(c.oracleId, weakest.oracleId);
    }
    const weak: Deck = { ...before, main: before.main.map((e) => (swaps.has(e.oracleId) ? { ...e, oracleId: swaps.get(e.oracleId)! } : e)) };

    const rBefore = rateDeck(before, ctx);
    const rWeak = rateDeck(weak, ctx);
    expect(rWeak.legal).toBe(true);
    expect(sub(rWeak, 'quality').value).toBeLessThan(sub(rBefore, 'quality').value - 0.15);
    expect(rWeak.rating).toBeLessThan(rBefore.rating);

    // One fix: how many cards are well under the bracket's expectation, the three weakest by name, and what to do.
    const fixes = sub(rWeak, 'quality').fixes;
    expect(fixes).toHaveLength(1);
    expect(fixes[0].text).toMatch(/^\d+ of the deck's \d+ spells are weak for Bracket 2\. The weakest are .+\. Swap them for stronger cards\.$/);
    const weakScorer = createScorer(weak, ctx);
    const spells = weak.main.map((e) => db.get(e.oracleId)!).filter((c) => !isLand(c.oracleId));
    const bottom = spells.map((c) => ({ c, v: qualityOf(weakScorer, c) ?? 2 })).sort((a, b) => a.v - b.v || a.c.name.localeCompare(b.c.name)).slice(0, 3);
    for (const { c } of bottom) expect(fixes[0].text).toContain(c.name);
  });

  it('rating quality agrees with the scorer', () => {
    // One spell and 98 Forests: the deck's card quality is that spell's, from the scorer, against Bracket 2's expectation.
    const solo = (c: Card): Deck => ({ ...lathril(), main: [{ oracleId: card('Forest').oracleId, qty: 98, locked: false }, { oracleId: c.oracleId, qty: 1, locked: false }] });
    const scorer = createScorer(solo(card('Sol Ring')), ctx);
    const candidates = db.all().filter((c) => !isLand(c.oracleId) && db.features(c.oracleId) && scorer.score(c).gate === null);
    const byQuality = candidates.map((c) => ({ c, v: qualityOf(scorer, c)! })).sort((a, b) => a.v - b.v || a.c.name.localeCompare(b.c.name));
    const weakest = byQuality[0].c;
    for (const c of [weakest, card('Sol Ring')]) {
      const d = solo(c);
      const r = rateDeck(d, ctx);
      expect(r.legal, c.name).toBe(true);
      const want = Math.min(1, qualityOf(createScorer(d, ctx), c)! / QUALITY_EXPECTED[1]);
      expect(sub(r, 'quality').value, c.name).toBeCloseTo(want, 3);
    }
    expect(sub(rateDeck(solo(weakest), ctx), 'quality').value).toBeLessThan(0.5);
    expect(sub(rateDeck(solo(card('Sol Ring')), ctx), 'quality').value).toBe(1); // clamped
  });

  it('the card-quality fix points the browser at a role when most weak cards share it', () => {
    const scorer = createScorer(lathril(), ctx);
    const ramp = db.all()
      .filter((c) => !isLand(c.oracleId) && hasRole(c.oracleId, 'ramp') && scorer.score(c).gate === null)
      .sort((a, b) => (qualityOf(scorer, a) ?? 2) - (qualityOf(scorer, b) ?? 2) || a.name.localeCompare(b.name))
      .slice(0, 6);
    const d: Deck = { ...lathril(), main: [{ oracleId: card('Forest').oracleId, qty: 93, locked: false }, ...ramp.map((c) => ({ oracleId: c.oracleId, qty: 1, locked: false }))] };
    const q = sub(rateDeck(d, ctx), 'quality');
    expect(q.value).toBeLessThan(0.85);
    expect(q.fixes).toHaveLength(1);
    expect(q.fixes[0].filter).toEqual({ role: 'ramp' });
    expect(q.fixes[0].text).toMatch(/^6 of the deck's 6 spells are weak for Bracket 2\./);
  });

  /** A Lathril deck of Forests and `spells`, one copy each, at Bracket 2. */
  const withSpells = (spells: Card[]): Deck => ({
    ...lathril(),
    main: [{ oracleId: card('Forest').oracleId, qty: 99 - spells.length, locked: false }, ...spells.map((c) => ({ oracleId: c.oracleId, qty: 1, locked: false }))],
  });
  /** Ungated nonland fixture cards with their quality for a Lathril deck, weakest first. */
  const rankedSpells = () => {
    const scorer = createScorer(lathril(), ctx);
    return db.all()
      .filter((c) => c.oracleId !== card('Lathril, Blade of the Elves').oracleId && !isLand(c.oracleId) && db.features(c.oracleId) && scorer.score(c).gate === null)
      .map((c) => ({ c, v: qualityOf(scorer, c)! }))
      .sort((a, b) => a.v - b.v || a.c.name.localeCompare(b.c.name));
  };

  it('the card-quality fix counts only cards well under the expectation, names the three weakest and says what to do', () => {
    const expected = QUALITY_EXPECTED[1];
    const bar = 0.7 * expected;
    const ranked = rankedSpells();
    // Four cards well under Bracket 2's expectation and four just under it.
    const well = ranked.filter((x) => x.v < bar).slice(0, 4).map((x) => x.c);
    const near = ranked.filter((x) => x.v >= bar && x.v < expected).slice(-4).map((x) => x.c);
    expect(well).toHaveLength(4);
    expect(near).toHaveLength(4);
    const d = withSpells([...well, ...near]);
    const scorer = createScorer(d, ctx);
    const inDeck = [...well, ...near].map((c) => ({ c, v: qualityOf(scorer, c)! })).sort((a, b) => a.v - b.v || a.c.name.localeCompare(b.c.name));
    const counted = inDeck.filter((x) => x.v < bar);
    expect(counted.length).toBeGreaterThanOrEqual(3);
    expect(counted.length).toBeLessThan(inDeck.length);

    const q = sub(rateDeck(d, ctx), 'quality');
    expect(q.value).toBeLessThan(0.85);
    expect(q.fixes).toHaveLength(1);
    const text = q.fixes[0].text;
    expect(text).toMatch(new RegExp(`^${counted.length} of the deck's 8 spells are weak for Bracket 2\\. The weakest are `));
    for (const { c } of counted.slice(0, 3)) expect(text).toContain(c.name);
    for (const { c } of inDeck.filter((x) => x.v >= bar)) expect(text).not.toContain(c.name);
    expect(text.endsWith('Swap them for stronger cards.')).toBe(true);
  });

  it('a deck only a little under the expectation still gets a fix naming its weakest cards', () => {
    const expected = QUALITY_EXPECTED[1];
    // Six cards between 0.7 and 0.8 of Bracket 2's expectation: none well under it, the mean low enough for a fix.
    const mild = rankedSpells().filter((x) => x.v >= 0.7 * expected && x.v < 0.8 * expected).slice(0, 6).map((x) => x.c);
    expect(mild).toHaveLength(6);
    const d = withSpells(mild);
    const scorer = createScorer(d, ctx);
    expect(mild.every((c) => qualityOf(scorer, c)! >= 0.7 * expected)).toBe(true);
    const q = sub(rateDeck(d, ctx), 'quality');
    expect(q.value).toBeLessThan(0.85);
    expect(q.fixes).toHaveLength(1);
    expect(q.fixes[0].text).toMatch(/^The deck's spells are a little weak for Bracket 2\. The weakest are .+\. Swap them for stronger cards\.$/);
    const weakest = mild.map((c) => ({ c, v: qualityOf(scorer, c)! })).sort((a, b) => a.v - b.v || a.c.name.localeCompare(b.c.name)).slice(0, 3);
    for (const { c } of weakest) expect(q.fixes[0].text).toContain(c.name);
  });

  it('no NaN on empty, commander-only and partial decks', () => {
    const empty: Deck = { ...lathril(), commanders: [] };
    const partial = { ...fixtureDeck('precon', 2), main: fixtureDeck('precon', 2).main.slice(0, 39) };
    const landsOnly = { ...lathril(), main: [{ oracleId: card('Forest').oracleId, qty: 10, locked: false }] };
    for (const [name, d] of [['empty', empty], ['commander only', lathril()], ['partial', partial], ['lands only', landsOnly]] as const) {
      for (const target of [1, 2, 3, 4, 5] as Bracket[]) {
        const r = rateDeck({ ...d, targetBracket: target }, ctx);
        expectFinite(r);
        const qs = sub(r, 'quality');
        expect(Number.isFinite(qs.value), `${name} B${target}`).toBe(true);
        if (name !== 'partial') expect(qs.value, `${name} B${target}`).toBe(0);
        else expect(qs.value, `${name} B${target}`).toBeGreaterThan(0);
        // A quality of 0 still says why (AGENTS rule 4); there is nothing to swap yet, so it is advice.
        if (name === 'commander only') {
          expect(qs.fixes, `${name} B${target}`).toEqual([
            { text: "No spells yet: card quality is rated on the deck's nonland cards.", filter: null, actionable: false },
          ]);
        }
        // Every part that reads 0 says why (AGENTS rule 4).
        for (const part of r.subscores) {
          if (part.value === 0) expect(part.fixes.length, `${name} B${target} ${part.key}`).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('rateDeck: cohesion', () => {
  it('Synergy is 70% theme and 30% cohesion', () => {
    for (const [name, bracket] of [['precon', 2], ['upgraded', 3], ['cedh', 5]] as const) {
      const deck = fixtureDeck(name, bracket);
      const cohesion = deckNetwork(deck, ctx).cohesion;
      const value = sub(rateDeck(deck, ctx), 'synergy').value;
      expect(value, name).toBeLessThanOrEqual(0.7 + (0.3 * cohesion) / 100 + 0.001);
      expect(value, name).toBeGreaterThanOrEqual((0.3 * cohesion) / 100 - 0.02);
    }
  });

  it('ten random cards lower Synergy', () => {
    const deck = fixtureDeck('precon', 2);
    expect(sub(rateDeck(withTenRandom(deck), ctx), 'synergy').value).toBeLessThan(sub(rateDeck(deck, ctx), 'synergy').value);
  });

  it("the unconnected fix names the cards and points at the deck's theme", () => {
    const { deck, added } = withFiveUnconnected(fixtureDeck('upgraded', 3), ctx);
    const fix = sub(rateDeck(deck, ctx), 'synergy').fixes.find((f) => /^5 cards connect to nothing in this deck: /.test(f.text));
    expect(fix).toBeTruthy();
    for (const id of added) expect(fix!.text).toContain(card(db.get(id)!.name).name);
    expect(fix!.filter?.axis).toBe('typal:elf');
  });

  // Review I5: the clustered share cost Synergy points with no reason (Six lost 0.25 with an empty fix list).
  it('a low clustered share gets a reason that names the groups', () => {
    const deck = fixtureDeck('cedh', 5);
    const net = deckNetwork(deck, ctx);
    expect(net.cohesionParts.clustered).toBeLessThan(0.9);
    const synergy = rateDeck(deck, ctx).subscores.find((s) => s.key === 'synergy')!;
    const line = synergy.fixes.find((i) => /^Links split across \d+ groups: /.test(i.text));
    expect(line, JSON.stringify(synergy.fixes.map((i) => i.text))).toBeTruthy();
    expect(line!.text).toContain(net.clusters[0].name);
    expect(synergy.value).toBeLessThan(1);
  });
});
