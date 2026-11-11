import { describe, expect, it } from 'vitest';
import { analyzeBracket, bracketGate, comboMana, findCombos } from '@/engine/brackets';
import { powerEstimate } from '@/engine/brackets/analyze';
import { deckCards } from '@/engine/summary';
import { parseDecklist } from '@/engine/text';
import type { Bracket, CardDb, Combo, Deck, DeckEntry, EngineContext } from '@/engine/types';
import { card, deckText, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const ctx: EngineContext = { db, edhrec: null, mldOverrides: {}, extraTurnOverrides: {} };
const id = (name: string) => card(name).oracleId;
const e = (name: string, qty = 1): DeckEntry => ({ oracleId: id(name), qty, locked: false });

function deck(commanders: string[], names: string[], target: Bracket = 3, extra: Partial<Deck> = {}): Deck {
  return {
    id: null, name: 'test', commanders: commanders.map(id), companion: null, chosenColor: null,
    main: names.map((n) => e(n)), targetBracket: target, themeWeights: null, ...extra,
  };
}
function fixtureDeck(name: 'precon' | 'upgraded' | 'cedh', target: Bracket): Deck {
  const p = parseDecklist(deckText(name), db);
  return { id: null, name, commanders: p.commanders, companion: p.companion, chosenColor: null, main: p.main, targetBracket: target, themeWeights: null };
}
const KENRITH = 'Kenrith, the Returned King';
const PLAIN = ['Forest', 'Island', 'Sol Ring', 'Counterspell', 'Llanowar Elves'];
const GCS = ['Rhystic Study', 'Cyclonic Rift', 'Force of Will', 'Fierce Guardianship'];
const comboIds = (list: { combo: { id: string } }[]) => list.map((f) => f.combo.id);
const ORACLE_COMBO = '742-1295';
const KRENKO_COMBO = '659-4050-4068';

describe('analyzeBracket floor', () => {
  it('is 1 with no flagged cards', () => {
    const r = analyzeBracket(deck([KENRITH], PLAIN), ctx);
    expect(r.floor).toBe(1);
    expect(r.reasons).toEqual([]);
    expect(r.violationsOfTarget).toEqual([]);
  });

  it("is 4 with Thassa's Oracle + Demonic Consultation, with a combo reason", () => {
    const r = analyzeBracket(deck([KENRITH], [...PLAIN, "Thassa's Oracle", 'Demonic Consultation'], 4), ctx);
    expect(r.floor).toBe(4);
    const reason = r.reasons.find((x) => /combo/i.test(x.text) && x.floor === 4);
    expect(reason).toBeDefined();
    expect(reason!.oracleIds.sort()).toEqual([id("Thassa's Oracle"), id('Demonic Consultation')].sort());
    expect(reason!.text).toContain("Thassa's Oracle");
    expect(comboIds(r.combos.included)).toContain(ORACLE_COMBO);
  });

  it('is 3 with three Game Changers and 4 with four', () => {
    const three = analyzeBracket(deck([KENRITH], [...PLAIN, ...GCS.slice(0, 3)]), ctx);
    expect(three.floor).toBe(3);
    expect(three.reasons).toHaveLength(1);
    expect(three.reasons[0].oracleIds).toHaveLength(3);
    expect(analyzeBracket(deck([KENRITH], [...PLAIN, GCS[0]]), ctx).floor).toBe(3);
    const four = analyzeBracket(deck([KENRITH], [...PLAIN, ...GCS]), ctx);
    expect(four.floor).toBe(4);
    expect(four.reasons[0].floor).toBe(4);
  });

  it('counts a Game Changer commander', () => {
    const r = analyzeBracket(deck(['Braids, Cabal Minion'], ['Swamp']), ctx);
    expect(r.floor).toBe(3);
    expect(r.reasons[0].oracleIds).toEqual([id('Braids, Cabal Minion')]);
  });

  it('is 4 with Armageddon, unless the user overrides it', () => {
    const d = deck([KENRITH], [...PLAIN, 'Armageddon']);
    const r = analyzeBracket(d, ctx);
    expect(r.floor).toBe(4);
    expect(r.reasons[0].oracleIds).toEqual([id('Armageddon')]);
    expect(r.violationsOfTarget.map((v) => v.code)).toEqual(['mass-land-denial']);
    const off = analyzeBracket(d, { ...ctx, mldOverrides: { [id('Armageddon')]: false } });
    expect(off.floor).toBe(1);
    expect(off.reasons).toEqual([]);
    expect(off.violationsOfTarget).toEqual([]);
  });

  it('lets the user mark a card as mass land denial', () => {
    const r = analyzeBracket(deck([KENRITH], PLAIN), { ...ctx, mldOverrides: { [id('Sol Ring')]: true } });
    expect(r.floor).toBe(4);
    expect(r.reasons[0].oracleIds).toEqual([id('Sol Ring')]);
  });

  it('is 2 with one Time Warp, and warns about chaining at three extra-turn cards', () => {
    const one = analyzeBracket(deck([KENRITH], [...PLAIN, 'Time Warp']), ctx);
    expect(one.floor).toBe(2);
    expect(one.reasons[0].oracleIds).toEqual([id('Time Warp')]);
    expect(one.warnings.join(' ')).not.toMatch(/chaining/i);
    expect(one.violationsOfTarget).toEqual([]);
    const marked = { ...ctx, extraTurnOverrides: { [id('Sol Ring')]: true, [id('Counterspell')]: true } };
    const three = analyzeBracket(deck([KENRITH], [...PLAIN, 'Time Warp']), marked);
    expect(three.floor).toBe(2);
    expect(three.warnings.join(' ')).toMatch(/chaining likely, plays like 4/i);
    const off = analyzeBracket(deck([KENRITH], [...PLAIN, 'Time Warp']), { ...ctx, extraTurnOverrides: { [id('Time Warp')]: false } });
    expect(off.floor).toBe(1);
  });

  it('takes the highest floor and keeps every reason', () => {
    const r = analyzeBracket(deck([KENRITH], [...PLAIN, 'Time Warp', 'Rhystic Study', 'Armageddon']), ctx);
    expect(r.floor).toBe(4);
    expect(r.reasons.map((x) => x.floor).sort()).toEqual([2, 3, 4]);
  });

  it('does not throw on an empty deck, unknown cards or junk quantities', () => {
    const empty = analyzeBracket(deck([], []), ctx);
    expect(empty.floor).toBe(1);
    expect(empty.playsLike).toBe(1);
    expect(empty.combos).toEqual({ included: [], oneAway: [] });
    const junk: Deck = {
      ...deck(['Kenrith, the Returned King'], ['Rhystic Study']),
      commanders: ['missing-commander'],
      main: [{ oracleId: 'nope', qty: 2, locked: false }, { oracleId: id('Rhystic Study'), qty: Number.NaN, locked: false }, e('Armageddon', 0)],
    };
    const r = analyzeBracket(junk, ctx);
    expect(r.floor).toBe(1); // NaN and zero quantities are not in the deck
    expect([1, 2, 3, 4, 5]).toContain(r.playsLike);
    expect(r.warnings.join(' ')).toMatch(/3 cards are not in the database/);
  });
});

describe('violationsOfTarget', () => {
  it('names Rhystic Study at target 2 and allows it at target 3', () => {
    const at2 = analyzeBracket(deck([KENRITH], [...PLAIN, 'Rhystic Study'], 2), ctx);
    expect(at2.violationsOfTarget).toHaveLength(1);
    expect(at2.violationsOfTarget[0].code).toBe('game-changer');
    expect(at2.violationsOfTarget[0].oracleIds).toEqual([id('Rhystic Study')]);
    expect(at2.violationsOfTarget[0].message).toContain('Rhystic Study');
    expect(analyzeBracket(deck([KENRITH], [...PLAIN, 'Rhystic Study'], 3), ctx).violationsOfTarget).toEqual([]);
  });

  it('flags a fourth Game Changer at target 3 and nothing at target 4', () => {
    const at3 = analyzeBracket(deck([KENRITH], GCS, 3), ctx);
    expect(at3.violationsOfTarget.map((v) => v.code)).toEqual(['game-changer-limit']);
    expect(at3.violationsOfTarget[0].oracleIds).toHaveLength(4);
    expect(analyzeBracket(deck([KENRITH], [...GCS, 'Armageddon', 'Time Warp', "Thassa's Oracle", 'Demonic Consultation'], 4), ctx).violationsOfTarget).toEqual([]);
  });

  it('forbids any extra-turn card only at target 1', () => {
    expect(analyzeBracket(deck([KENRITH], ['Time Warp'], 1), ctx).violationsOfTarget.map((v) => v.code)).toEqual(['extra-turn']);
    expect(analyzeBracket(deck([KENRITH], ['Time Warp'], 2), ctx).violationsOfTarget).toEqual([]);
  });

  it('flags the two-card combo at targets 1-3', () => {
    for (const t of [1, 2, 3] as Bracket[]) {
      const v = analyzeBracket(deck([KENRITH], ["Thassa's Oracle", 'Demonic Consultation'], t), ctx).violationsOfTarget;
      const combo = v.find((x) => x.code === 'two-card-combo' || x.code === 'early-combo');
      expect(combo, `target ${t}`).toBeDefined();
      expect(combo!.oracleIds.sort()).toEqual([id("Thassa's Oracle"), id('Demonic Consultation')].sort());
    }
  });
});

describe('bracketGate', () => {
  const rhystic = card('Rhystic Study');
  it('gates a Game Changer at target 2', () => {
    const g = bracketGate(rhystic, deck([KENRITH], PLAIN, 2), ctx);
    expect(g).not.toBeNull();
    expect(g!.code).toBe('game-changer');
    expect(g!.message).toMatch(/Bracket 2/);
    expect(bracketGate(rhystic, deck([KENRITH], PLAIN, 1), ctx)).not.toBeNull();
  });
  it('gates the fourth Game Changer at target 3 but not the third', () => {
    const three = ['Cyclonic Rift', 'Force of Will', 'Fierce Guardianship'];
    expect(bracketGate(rhystic, deck([KENRITH], three, 3), ctx)).not.toBeNull();
    expect(bracketGate(rhystic, deck([KENRITH], three.slice(0, 2), 3), ctx)).toBeNull();
  });
  it('does not count the card itself when it is already in the deck', () => {
    expect(bracketGate(rhystic, deck([KENRITH], ['Rhystic Study', 'Cyclonic Rift', 'Force of Will'], 3), ctx)).toBeNull();
    expect(bracketGate(rhystic, deck([KENRITH], GCS, 3), ctx)).not.toBeNull();
  });
  it('never gates at targets 4 and 5', () => {
    for (const t of [4, 5] as Bracket[]) {
      const d = deck([KENRITH], [...GCS, "Thassa's Oracle"], t);
      for (const n of ['Rhystic Study', 'Armageddon', 'Time Warp', 'Demonic Consultation', 'Mana Vault']) {
        expect(bracketGate(card(n), d, ctx), `${n} at ${t}`).toBeNull();
      }
    }
  });
  it('gates mass land denial at targets 1-3 and honours the override', () => {
    const d = deck([KENRITH], PLAIN, 3);
    expect(bracketGate(card('Armageddon'), d, ctx)?.code).toBe('mass-land-denial');
    expect(bracketGate(card('Armageddon'), d, { ...ctx, mldOverrides: { [id('Armageddon')]: false } })).toBeNull();
  });
  it('gates extra turns only at target 1', () => {
    expect(bracketGate(card('Time Warp'), deck([KENRITH], PLAIN, 1), ctx)?.code).toBe('extra-turn');
    expect(bracketGate(card('Time Warp'), deck([KENRITH], PLAIN, 2), ctx)).toBeNull();
  });
  it('gates the card that would complete a two-card combo', () => {
    const withOracle = deck([KENRITH], [...PLAIN, "Thassa's Oracle"], 3);
    const g = bracketGate(card('Demonic Consultation'), withOracle, ctx);
    expect(g).not.toBeNull();
    expect(g!.message).toContain("Thassa's Oracle");
    expect(bracketGate(card('Demonic Consultation'), deck([KENRITH], PLAIN, 3), ctx)).toBeNull();
    expect(bracketGate(card('Demonic Consultation'), { ...withOracle, targetBracket: 4 }, ctx)).toBeNull();
    // already in the deck: still gated, both pieces are there
    expect(bracketGate(card('Demonic Consultation'), deck([KENRITH], ["Thassa's Oracle", 'Demonic Consultation'], 2), ctx)).not.toBeNull();
  });
  it('lets ordinary cards through, in any deck state', () => {
    for (const t of [1, 2, 3, 4, 5] as Bracket[]) {
      expect(bracketGate(card('Llanowar Elves'), deck([KENRITH], PLAIN, t), ctx)).toBeNull();
      expect(bracketGate(card('Llanowar Elves'), deck([], [], t), ctx)).toBeNull();
    }
  });
  it('sees a deck edited in place between calls', () => {
    const d = deck([KENRITH], ['Cyclonic Rift', 'Force of Will'], 3);
    expect(bracketGate(rhystic, d, ctx)).toBeNull();
    d.main.push(e('Fierce Guardianship'));
    expect(bracketGate(rhystic, d, ctx)).not.toBeNull();
    d.main[2] = e('Forest');
    expect(bracketGate(rhystic, d, ctx)).toBeNull();
    d.targetBracket = 2;
    expect(bracketGate(rhystic, d, ctx)).not.toBeNull();
  });
});

describe('findCombos', () => {
  it('lists a combo whose pieces are all in the deck', () => {
    const f = findCombos(deck([KENRITH], ["Thassa's Oracle", 'Demonic Consultation']), db);
    const hit = f.included.find((x) => x.combo.id === ORACLE_COMBO)!;
    expect(hit).toMatchObject({ missing: [], twoCard: true, early: true, relevant: true });
    expect(comboIds(f.oneAway)).not.toContain(ORACLE_COMBO);
  });

  it('honours mustBeCommander', () => {
    const inMain = findCombos(deck([KENRITH], ['Krenko, Mob Boss', 'Phyrexian Altar', 'Anger']), db);
    expect(comboIds(inMain.included)).not.toContain(KRENKO_COMBO);
    expect(comboIds(inMain.oneAway)).not.toContain(KRENKO_COMBO);
    const asCommander = findCombos(deck(['Krenko, Mob Boss'], ['Phyrexian Altar', 'Anger']), db);
    const hit = asCommander.included.find((x) => x.combo.id === KRENKO_COMBO)!;
    expect(hit).toMatchObject({ twoCard: false, relevant: true });
  });

  it('lists a combo one card away when the missing piece fits the identity', () => {
    const f = findCombos(deck([KENRITH], ["Thassa's Oracle"]), db);
    const hit = f.oneAway.find((x) => x.combo.id === ORACLE_COMBO)!;
    expect(hit.missing).toEqual([id('Demonic Consultation')]);
    expect(comboIds(f.included)).not.toContain(ORACLE_COMBO);
    // Krenko as commander, one piece short
    const k = findCombos(deck(['Krenko, Mob Boss'], ['Anger']), db);
    expect(k.oneAway.find((x) => x.combo.id === KRENKO_COMBO)?.missing).toEqual([id('Phyrexian Altar')]);
  });

  it('leaves out a one-away combo whose missing piece is off-identity or must be the commander', () => {
    const blue = findCombos(deck(['Talrand, Sky Summoner'], ["Thassa's Oracle"]), db);
    expect(comboIds(blue.oneAway)).not.toContain(ORACLE_COMBO);
    const noKrenko = findCombos(deck([KENRITH], ['Phyrexian Altar', 'Anger']), db);
    expect(comboIds(noKrenko.oneAway)).not.toContain(KRENKO_COMBO);
  });

  it('needs two missing pieces to be neither', () => {
    const f = findCombos(deck(['Krenko, Mob Boss'], ['Forest']), db);
    expect(comboIds([...f.included, ...f.oneAway])).not.toContain(KRENKO_COMBO);
  });

  it('never reports a combo twice, and every included combo is fully present', () => {
    const d = fixtureDeck('cedh', 5);
    const f = findCombos(d, db);
    const inDeck = new Set([...d.commanders, ...d.main.map((x) => x.oracleId)]);
    expect(f.included.length).toBeGreaterThan(0);
    expect(new Set(comboIds(f.included)).size).toBe(f.included.length);
    expect(new Set(comboIds(f.oneAway)).size).toBe(f.oneAway.length);
    for (const x of f.included) {
      expect(x.missing).toEqual([]);
      expect(x.combo.requiresCount).toBe(0);
      for (const c of x.combo.cards) expect(inDeck.has(c.oracleId)).toBe(true);
    }
    for (const x of f.oneAway) {
      expect(x.missing).toHaveLength(1);
      expect(inDeck.has(x.missing[0])).toBe(false);
    }
  });

  it('returns nothing for an empty deck', () => {
    expect(findCombos(deck([], []), db)).toEqual({ included: [], oneAway: [] });
  });
});

describe('playsLike', () => {
  it('reads the precon as 2', () => {
    expect(analyzeBracket(fixtureDeck('precon', 2), ctx).playsLike).toBe(2);
  });
  it('reads the cEDH list as 4 or 5', () => {
    expect(analyzeBracket(fixtureDeck('cedh', 5), ctx).playsLike).toBeGreaterThanOrEqual(4);
  });
  it('reads the upgraded list as 3, as its author tagged it', () => {
    expect(analyzeBracket(fixtureDeck('upgraded', 3), ctx).playsLike).toBe(3);
  });
  it('rises as fast mana, tutors and Game Changers replace basics', () => {
    const basics = deck([KENRITH], [], 4, { main: [e('Forest', 60)] });
    const tuned = deck([KENRITH], ['Sol Ring', 'Mana Vault', 'Chrome Mox', 'Mox Diamond', 'Demonic Tutor', 'Mystical Tutor', 'Force of Will', 'Fierce Guardianship', "Thassa's Oracle", 'Demonic Consultation'], 4);
    expect(analyzeBracket(tuned, ctx).playsLike).toBeGreaterThan(analyzeBracket(basics, ctx).playsLike);
  });
  it('does not depend on the target bracket', () => {
    expect(analyzeBracket(fixtureDeck('precon', 5), ctx).playsLike).toBe(2);
  });
  it('the precon has floor 1 or 2 and no violations at target 2', () => {
    const r = analyzeBracket(fixtureDeck('precon', 2), ctx);
    expect(r.floor).toBeLessThanOrEqual(2);
    expect(r.violationsOfTarget).toEqual([]);
  });
});

describe('early and late two-card combos (review fixes)', () => {
  // Scourge of the Throne (6) + Helm of the Host (4): Spellbook tags it Spicy and gives mana needed 0,
  // because both permanents are assumed to be on the battlefield. Ten mana is not an early combo.
  const LATE = ['Scourge of the Throne', 'Helm of the Host'];

  it('counts the pieces as well as the execution cost', () => {
    const find = (a: string, b: string) =>
      db.combosFor(id(a)).find((c) => c.cards.length === 2 && c.requiresCount === 0 && c.cards.some((p) => p.oracleId === id(b)))!;
    const late = find(LATE[0], LATE[1]);
    expect(late.manaValueNeeded).toBe(0);
    expect(comboMana(late, db)).toBe(10);
    // Spellbook's figure for a combo cast from hand already includes the cards: not counted twice.
    expect(comboMana(find('Demonic Consultation', "Thassa's Oracle"), db)).toBe(3);
    // unknown pieces count as free, junk figures as zero
    expect(comboMana({ ...late, cards: [{ oracleId: 'nope', mustBeCommander: false }], manaValueNeeded: NaN }, db)).toBe(0);
  });

  it('a ten-mana two-card combo gives floor 3, not 4, and is allowed at target 3', () => {
    const r = analyzeBracket(deck([KENRITH], [...PLAIN, ...LATE], 3), ctx);
    expect(r.floor).toBe(3);
    const hit = r.combos.included.find((c) => c.twoCard && c.combo.cards.some((p) => p.oracleId === id(LATE[0])))!;
    expect(hit).toMatchObject({ twoCard: true, relevant: true, early: false });
    expect(r.violationsOfTarget).toEqual([]);
    expect(analyzeBracket(deck([KENRITH], [...PLAIN, ...LATE], 2), ctx).violationsOfTarget.map((v) => v.code)).toContain('two-card-combo');
  });

  it('bracketGate lets the late combo through at target 3 and stops it at target 2', () => {
    const withScourge = (t: Bracket) => deck([KENRITH], [...PLAIN, LATE[0]], t);
    expect(bracketGate(card(LATE[1]), withScourge(3), ctx)).toBeNull();
    expect(bracketGate(card(LATE[1]), withScourge(2), ctx)?.code).toBe('two-card-combo');
    expect(bracketGate(card(LATE[1]), withScourge(1), ctx)?.code).toBe('two-card-combo');
  });

  it('a Ruthless-tagged combo stays early whatever it costs', () => {
    // Grim Monolith (2) + Nyxbloom Ancient (7): nine mana, tagged R by Spellbook.
    const r = analyzeBracket(deck([KENRITH], [...PLAIN, 'Grim Monolith', 'Nyxbloom Ancient'], 3), ctx);
    expect(r.floor).toBe(4);
    expect(r.violationsOfTarget.map((v) => v.code)).toContain('early-combo');
  });

  it('bracketGate honours mustBeCommander in a two-card combo', () => {
    const combo: Combo = {
      id: 'test-must-be-commander',
      cards: [{ oracleId: id('Krenko, Mob Boss'), mustBeCommander: true }, { oracleId: id('Phyrexian Altar'), mustBeCommander: false }],
      requiresCount: 0, bracketTag: 'R', manaValueNeeded: 0, produces: ['Infinite creature tokens'], popularity: 1,
    };
    const withCombo: CardDb = {
      ...db,
      combosFor: (oracleId) => (combo.cards.some((p) => p.oracleId === oracleId) ? [...db.combosFor(oracleId), combo] : db.combosFor(oracleId)),
    };
    const c2: EngineContext = { ...ctx, db: withCombo };
    // Krenko in the 99: the combo needs him in the command zone, so the Altar is fine.
    expect(bracketGate(card('Phyrexian Altar'), deck([KENRITH], ['Krenko, Mob Boss'], 3), c2)).toBeNull();
    expect(findCombos(deck([KENRITH], ['Krenko, Mob Boss', 'Phyrexian Altar'], 3), withCombo).included.map((f) => f.combo.id)).not.toContain(combo.id);
    // Krenko as the commander: the Altar completes it.
    expect(bracketGate(card('Phyrexian Altar'), deck(['Krenko, Mob Boss'], ['Mountain'], 3), c2)?.code).toBe('early-combo');
    expect(analyzeBracket(deck(['Krenko, Mob Boss'], ['Mountain', 'Phyrexian Altar'], 3), c2).floor).toBe(4);
  });
});

describe('powerEstimate: slow combos are a nudge, fast ones a signal (quality pass 2)', () => {
  const cards = deckCards(fixtureDeck('precon', 2), db).cards;
  const found = (over: Partial<{ twoCard: boolean; early: boolean; relevant: boolean }>) =>
    [{ combo: { id: 'x', cards: [], requiresCount: 0, bracketTag: 'S', manaValueNeeded: 9, produces: ['Infinite mana'], popularity: 1 } as Combo, missing: [], twoCard: false, early: false, relevant: true, ...over }];

  it('a late three-card combo adds a few points, not a bracket', () => {
    const none = powerEstimate(cards, []);
    const slow = powerEstimate(cards, found({}));
    expect(slow.parts.combo).toBeGreaterThan(0);
    expect(slow.parts.combo).toBeLessThanOrEqual(3);
    expect(slow.score - none.score).toBeLessThanOrEqual(3);
  });

  it('an early two-card combo is worth four times that, and irrelevant combos nothing', () => {
    expect(powerEstimate(cards, found({ twoCard: true, early: true })).parts.combo).toBe(12);
    expect(powerEstimate(cards, found({ twoCard: true })).parts.combo).toBe(9);
    expect(powerEstimate(cards, found({ relevant: false })).parts.combo).toBe(0);
  });
});
