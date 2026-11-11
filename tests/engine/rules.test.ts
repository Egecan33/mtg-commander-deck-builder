import { describe, expect, it } from 'vitest';
import {
  RULEBREAKERS, allowedIdentity, canPair, cardFitsDeck, companionViolation, copyLimit, deckSize, isCommanderEligible,
  hasCreatureType, isEveryCreatureType, needsColorChoice, partnerKind, requiresColorChoice, validateDeck,
} from '@/engine/rules';
import { createCardDb } from '@/engine/carddb';
import type { Color, Deck, DeckEntry } from '@/engine/types';
import { card, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const id = (name: string) => card(name).oracleId;
const e = (name: string, qty = 1): DeckEntry => ({ oracleId: id(name), qty, locked: false });

function deck(commanders: string[], main: DeckEntry[], extra: Partial<Deck> = {}): Deck {
  return {
    id: null, name: 'test', commanders: commanders.map(id), companion: null, chosenColor: null,
    main, targetBracket: 3, themeWeights: null, ...extra,
  };
}
const codes = (d: Deck) => validateDeck(d, db).map((v) => v.code);
const fits = (name: string, d: Deck) => cardFitsDeck(card(name), d, db)?.code ?? null;

/** Mono-green shell: Wilson + basics, padded to 100 around `others`. */
function wilson(others: DeckEntry[] = [], total = 100): Deck {
  const used = others.reduce((n, x) => n + x.qty, 0);
  return deck(['Wilson, Refined Grizzly'], [...others, e('Forest', total - 1 - used)]);
}
/** Mono-black shell on Syr Konrad. */
function konrad(others: DeckEntry[] = []): Deck {
  const used = others.reduce((n, x) => n + x.qty, 0);
  return deck(['Syr Konrad, the Grim'], [...others, e('Swamp', 99 - used)]);
}

describe('deck size', () => {
  it('accepts exactly 100 and flags 99', () => {
    expect(validateDeck(wilson(), db)).toEqual([]);
    expect(codes(wilson([], 99))).toEqual(['size']);
    expect(codes(wilson([], 101))).toEqual(['size']);
  });

  it('empty deck with no commander reports no-commander and size without throwing', () => {
    const c = codes(deck([], []));
    expect(c).toContain('no-commander');
    expect(c).toContain('size');
  });

  it('Whtz removes only the maximum', () => {
    const whtz = (n: number) => deck(['Whtz, the Bibliophile'], [e('Island', n - 1)]);
    expect(codes(whtz(140))).toEqual([]);
    expect(codes(whtz(100))).toEqual([]);
    expect(codes(whtz(99))).toEqual(['size']);
  });

  it('counts both commanders', () => {
    const d = deck(['Thrasios, Triton Hero', 'Tymna the Weaver'], [e('Forest', 98)]);
    expect(deckSize(d)).toBe(100);
    expect(codes(d)).toEqual([]);
  });
});

describe('copy limits', () => {
  it('parses limits from oracle text and the Basic supertype', () => {
    expect(copyLimit(card('Relentless Rats'))).toBe(Infinity);
    expect(copyLimit(card('Seven Dwarves'))).toBe(7);
    expect(copyLimit(card('Nazgûl'))).toBe(9);
    expect(copyLimit(card('Forest'))).toBe(Infinity);
    expect(copyLimit(card('Wastes'))).toBe(Infinity);
    expect(copyLimit(card('Sol Ring'))).toBe(1);
    expect(copyLimit(card('Bayou'))).toBe(1);
  });

  it('all 13 copy-limit cards and the basics, read from card text', () => {
    const anyNumber = [
      'Cid, Timeless Artificer', "Dragon's Approach", 'Hare Apparent', 'Persistent Petitioners', 'Rat Colony',
      'Relentless Rats', 'Shadowborn Apostle', 'Slime Against Humanity', "Sphinx's Approach", 'Tempest Hawk', 'Templar Knight',
    ];
    for (const n of anyNumber) expect(copyLimit(card(n)), n).toBe(Infinity);
    for (const n of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes']) expect(copyLimit(card(n)), n).toBe(Infinity);
    const special = db.all().filter((c) => copyLimit(c) !== 1 && !/\bBasic\b/.test(c.frontTypeLine)).map((c) => c.name).sort();
    expect(special).toEqual([...anyNumber, 'Nazgûl', 'Seven Dwarves'].sort());
  });

  it('Relentless Rats x30 ok', () => {
    expect(codes(konrad([e('Relentless Rats', 30)]))).toEqual([]);
  });

  it('Seven Dwarves x8 is a copies violation, x7 is fine', () => {
    const d = (n: number) => deck(['Krenko, Mob Boss'], [e('Seven Dwarves', n), e('Mountain', 99 - n)]);
    const v = validateDeck(d(8), db);
    expect(v.map((x) => x.code)).toEqual(['copies']);
    expect(v[0].oracleIds).toEqual([id('Seven Dwarves')]);
    expect(codes(d(7))).toEqual([]);
  });

  it('Nazgûl x9 ok, x10 not', () => {
    expect(codes(konrad([e('Nazgûl', 9)]))).toEqual([]);
    expect(codes(konrad([e('Nazgûl', 10)]))).toEqual(['copies']);
  });

  it('two Sol Rings, also when split over two entries', () => {
    expect(codes(wilson([e('Sol Ring', 2)]))).toEqual(['copies']);
    expect(codes(wilson([e('Sol Ring'), e('Sol Ring')]))).toEqual(['copies']);
  });

  it('basic Forest x30 ok', () => {
    expect(codes(wilson([e('Forest', 30)]))).toEqual([]);
  });

  it('a commander repeated in the main deck is a copies violation', () => {
    expect(codes(wilson([e('Wilson, Refined Grizzly')]))).toEqual(['copies']);
  });
});

describe('colour identity', () => {
  it('Bayou in a mono-green deck', () => {
    const v = validateDeck(wilson([e('Bayou')]), db);
    expect(v.map((x) => x.code)).toEqual(['identity']);
    expect(v[0].oracleIds).toEqual([id('Bayou')]);
    expect(v[0].message).toMatch(/Bayou/);
  });

  it('Kenrith accepts any colour', () => {
    const d = deck(['Kenrith, the Returned King'], []);
    expect([...allowedIdentity(d, db)].sort()).toEqual(['B', 'G', 'R', 'U', 'W']);
    for (const n of ['Bayou', 'Lightning Bolt', 'Fire // Ice', 'Atraxa, Praetors\' Voice', 'Sol Ring']) expect(fits(n, d)).toBeNull();
  });

  it('partner identity is the union', () => {
    const d = deck(['Thrasios, Triton Hero', 'Tymna the Weaver'], []);
    expect([...allowedIdentity(d, db)].sort()).toEqual(['B', 'G', 'U', 'W']);
    expect(fits('Bayou', d)).toBeNull();
    expect(fits('Lightning Bolt', d)).toBe('identity');
  });

  it('Kozilek (colourless) accepts Sol Ring and Wastes, rejects Forest', () => {
    const d = deck(['Kozilek, the Great Distortion'], [e('Sol Ring'), e('Wastes', 98)]);
    expect(allowedIdentity(d, db).size).toBe(0);
    expect(codes(d)).toEqual([]);
    expect(fits('Forest', d)).toBe('identity');
    const bad = deck(['Kozilek, the Great Distortion'], [e('Forest'), e('Wastes', 98)]);
    expect(codes(bad)).toEqual(['identity']);
  });

  it('both faces of a DFC count', () => {
    expect(fits('Civilized Scholar // Homicidal Brute', deck(['Talrand, Sky Summoner'], []))).toBe('identity');
  });

  it('a deck with no commander yet does not flag identity', () => {
    expect(fits('Bayou', deck([], []))).toBeNull();
  });
});

describe('colour-choice commanders', () => {
  it('The Prismatic Piper without chosenColor needs a colour; with R accepts Lightning Bolt', () => {
    const main = [e('Lightning Bolt'), e('Wastes', 98)];
    expect(needsColorChoice([card('The Prismatic Piper')])).toBe(true);
    const none = codes(deck(['The Prismatic Piper'], main));
    expect(none).toContain('needs-color');
    expect(none).toContain('identity');
    const red = deck(['The Prismatic Piper'], [e('Lightning Bolt'), e('Mountain', 98)], { chosenColor: 'R' });
    expect(codes(red)).toEqual([]);
    expect(fits('Bayou', red)).toBe('identity');
  });

  it('Faceless One and Clara Oswald need a colour; ordinary commanders do not', () => {
    expect(needsColorChoice([card('Faceless One')])).toBe(true);
    expect(needsColorChoice([card('Clara Oswald'), card('The Tenth Doctor')])).toBe(true);
    expect(needsColorChoice([card('Kenrith, the Returned King')])).toBe(false);
    expect(needsColorChoice([])).toBe(false);
  });

  it('chosenColor is ignored when no commander asks for one', () => {
    const d = { ...wilson(), chosenColor: 'B' as Color };
    expect([...allowedIdentity(d, db)]).toEqual(['G']);
    expect(fits('Bayou', d)).toBe('identity');
  });
});

describe('commander eligibility', () => {
  it('legendary creatures, Vehicles, Grist and "can be your commander" cards', () => {
    for (const n of [
      'Kenrith, the Returned King', 'Grist, the Hunger Tide', 'Parhelion II', 'Shorikai, Genesis Engine',
      'Tevesh Szat, Doom of Fools', "Ashaya's Enduring Bond", 'The Unluckiest Planeswalker', 'Faceless One',
    ]) expect(isCommanderEligible(card(n)), n).toBe(true);
  });

  it('non-legendary cards, Spacecraft without power, and lone Backgrounds are not', () => {
    for (const n of ['Sol Ring', 'Relentless Rats', 'Deep Space 9', 'The Eternity Elevator', 'Raised by Giants', 'Helm of the Host'])
      expect(isCommanderEligible(card(n)), n).toBe(false);
  });

  it('a Spacecraft needs a power/toughness box; a back-face Vehicle does not count', () => {
    const elevator = card('The Eternity Elevator');
    expect(elevator.frontTypeLine).toMatch(/Legendary.*Spacecraft/);
    expect(isCommanderEligible(elevator)).toBe(false);
    expect(isCommanderEligible({ ...elevator, power: '4' })).toBe(true);
    const aetherwing = card('Invasion of Kaladesh');
    expect(aetherwing.typeLine).toMatch(/Legendary Artifact — Vehicle/);
    expect(isCommanderEligible(aetherwing)).toBe(false);
    expect(isCommanderEligible({ ...card('Brisela, Voice of Nightmares') })).toBe(false); // meld result
  });

  it('Grist as commander validates', () => {
    expect(codes(deck(['Grist, the Hunger Tide'], [e('Bayou'), e('Forest', 98)]))).toEqual([]);
  });

  it('Raised by Giants alone is a bad commander', () => {
    expect(codes(deck(['Raised by Giants'], [e('Forest', 99)]))).toEqual(['bad-commander']);
  });

  it('Sol Ring as commander is a bad commander', () => {
    expect(codes(deck(['Sol Ring'], [e('Wastes', 99)]))).toEqual(['bad-commander']);
  });

  it('a banned commander is reported as banned', () => {
    expect(codes(deck(['Golos, Tireless Pilgrim'], [e('Forest', 99)]))).toEqual(['banned']);
  });
});

describe('two commanders', () => {
  const pair = (a: string, b: string) => canPair(card(a), card(b));

  it('classifies partner abilities', () => {
    const kinds = (n: string) => partnerKind(card(n)).map((k) => k.kind);
    expect(kinds('Thrasios, Triton Hero')).toEqual(['partner']);
    expect(kinds('Tevesh Szat, Doom of Fools')).toEqual(['partner']);
    expect(partnerKind(card('Rory Williams'))).toEqual([{ kind: 'partner-with', detail: 'Amy Pond' }]);
    expect(kinds('Amy Pond').sort()).toEqual(['doctors-companion', 'partner-with']);
    expect(partnerKind(card('Abby, Merciless Soldier'))).toEqual([{ kind: 'partner-variant', detail: 'Survivors' }]);
    expect(partnerKind(card("April O'Neil, Live on the Scene"))).toEqual([{ kind: 'partner-variant', detail: 'Character select' }]);
    expect(kinds('Wilson, Refined Grizzly')).toEqual(['background-chooser']);
    expect(kinds('Raised by Giants')).toEqual(['background']);
    expect(kinds('Faceless One').sort()).toEqual(['background', 'background-chooser']);
    expect(kinds('Rose Tyler')).toEqual(['doctors-companion']);
    expect(kinds('The Tenth Doctor')).toEqual(['doctor']);
    expect(kinds('Kenrith, the Returned King')).toEqual([]);
  });

  it('Wilson + Raised by Giants ok, in either order', () => {
    expect(pair('Wilson, Refined Grizzly', 'Raised by Giants')).toBe(true);
    expect(codes(deck(['Wilson, Refined Grizzly', 'Raised by Giants'], [e('Forest', 98)]))).toEqual([]);
    expect(codes(deck(['Raised by Giants', 'Wilson, Refined Grizzly'], [e('Forest', 98)]))).toEqual([]);
  });

  it('Thrasios + Tymna ok', () => {
    expect(pair('Thrasios, Triton Hero', 'Tymna the Weaver')).toBe(true);
  });

  it('Thrasios + Rose Tyler is a bad pair', () => {
    expect(pair('Thrasios, Triton Hero', 'Rose Tyler')).toBe(false);
    expect(codes(deck(['Thrasios, Triton Hero', 'Rose Tyler'], [e('Forest', 98)]))).toEqual(['bad-pair']);
  });

  it('The Tenth Doctor + Rose Tyler ok', () => {
    expect(pair('The Tenth Doctor', 'Rose Tyler')).toBe(true);
    expect(pair('Rose Tyler', 'The Tenth Doctor')).toBe(true);
    expect(codes(deck(['The Tenth Doctor', 'Rose Tyler'], [e('Island', 98)]))).toEqual([]);
  });

  it('partner with names the other card', () => {
    expect(pair('Amy Pond', 'Rory Williams')).toBe(true);
    expect(pair('Rowan Kenrith', 'Will Kenrith')).toBe(true);
    expect(pair('Amy Pond', 'Will Kenrith')).toBe(false);
    expect(pair('Amy Pond', 'The Tenth Doctor')).toBe(true);
    expect(pair('Rory Williams', 'The Tenth Doctor')).toBe(false);
  });

  it('partner variants pair only within the same variant and never with plain partner', () => {
    expect(pair('Abby, Merciless Soldier', 'Joel, Resolute Survivor')).toBe(true);
    expect(pair('Atreus, Impulsive Son', 'Kratos, Stoic Father')).toBe(true);
    expect(pair("April O'Neil, Live on the Scene", 'Donatello, the Brains')).toBe(true);
    expect(pair('Abby, Merciless Soldier', 'Kratos, Stoic Father')).toBe(false);
    expect(pair('Abby, Merciless Soldier', 'Thrasios, Triton Hero')).toBe(false);
    expect(pair('Rory Williams', 'Thrasios, Triton Hero')).toBe(false);
  });

  it('a card with two partner abilities may use either one (Amy Pond)', () => {
    expect(partnerKind(card('Amy Pond')).map((k) => k.kind).sort()).toEqual(['doctors-companion', 'partner-with']);
    expect(canPair(card('Amy Pond'), card('Rory Williams'))).toBe(true);
    expect(canPair(card('Amy Pond'), card('The Tenth Doctor'))).toBe(true);
    expect(canPair(card('Rory Williams'), card('The Tenth Doctor'))).toBe(false); // Rory has only "Partner with Amy Pond"
    expect(canPair(card('Amy Pond'), card('Thrasios, Triton Hero'))).toBe(false);
    expect(canPair(card('Amy Pond'), card('Rose Tyler'))).toBe(false); // two companions, no Doctor
    expect(canPair(card('Amy Pond'), card('Will Kenrith'))).toBe(false); // partner with someone else
  });

  it('Faceless One is a chooser and a Background at once', () => {
    expect(canPair(card('Faceless One'), card('Raised by Giants'))).toBe(true);
    expect(canPair(card('Wilson, Refined Grizzly'), card('Faceless One'))).toBe(true);
    expect(canPair(card('Faceless One'), card('Faceless One'))).toBe(false);
    expect(canPair(card('Faceless One'), card('Thrasios, Triton Hero'))).toBe(false);
  });

  it('other pairings fail', () => {
    expect(pair('Thrasios, Triton Hero', 'Thrasios, Triton Hero')).toBe(false);
    expect(pair('Kenrith, the Returned King', 'Thrasios, Triton Hero')).toBe(false);
    expect(pair('Raised by Giants', 'Rose Tyler')).toBe(false);
    expect(pair('Wilson, Refined Grizzly', 'Faceless One')).toBe(true);
    expect(pair('The Prismatic Piper', 'Thrasios, Triton Hero')).toBe(true);
  });

  it('three commanders is a bad pair', () => {
    const d = deck(['Thrasios, Triton Hero', 'Tymna the Weaver', 'Tevesh Szat, Doom of Fools'], [e('Forest', 97)]);
    expect(codes(d)).toContain('bad-pair');
  });
});

describe('banned and unknown cards', () => {
  it('Black Lotus is banned', () => {
    const v = validateDeck(wilson([e('Black Lotus')]), db);
    expect(v.map((x) => x.code)).toEqual(['banned']);
    expect(v[0].oracleIds).toEqual([id('Black Lotus')]);
    expect(fits('Black Lotus', wilson())).toBe('banned');
  });

  it('unknown oracleId is reported, counted, and does not throw', () => {
    const d = wilson();
    d.main[d.main.length - 1].qty -= 1;
    d.main.push({ oracleId: 'no-such-card', qty: 1, locked: false });
    const v = validateDeck(d, db);
    expect(v.map((x) => x.code)).toEqual(['unknown-card']);
    expect(v[0].oracleIds).toEqual(['no-such-card']);
  });

  it('unknown commander and companion ids are reported', () => {
    const d = { ...deck([], [e('Forest', 99)]), commanders: ['ghost'], companion: 'ghost-2' };
    const v = validateDeck(d, db);
    expect(v.filter((x) => x.code === 'unknown-card').flatMap((x) => x.oracleIds).sort()).toEqual(['ghost', 'ghost-2']);
    expect(v.map((x) => x.code)).not.toContain('no-commander');
  });

  it('zero and negative quantities are ignored', () => {
    const d = wilson();
    d.main.push({ oracleId: id('Black Lotus'), qty: 0, locked: false }, { oracleId: id('Bayou'), qty: -3, locked: false });
    expect(codes(d)).toEqual([]);
  });
});

describe('companions', () => {
  it('Lutri as companion is rejected; Lutri in the main deck is fine', () => {
    const shell = (extra: Partial<Deck>, main: DeckEntry[]) => deck(['The Tenth Doctor'], main, extra);
    const asCompanion = shell({ companion: id('Lutri, the Spellchaser') }, [e('Island', 99)]);
    const v = validateDeck(asCompanion, db);
    expect(v.map((x) => x.code)).toEqual(['companion']);
    expect(v[0].message).toMatch(/banned as a companion/);
    expect(codes(shell({}, [e('Lutri, the Spellchaser'), e('Island', 98)]))).toEqual([]);
  });

  it('the companion is a 101st card', () => {
    const d = deck(['Kenrith, the Returned King'], [e('Forest', 99)], { companion: id('Jegantha, the Wellspring') });
    expect(deckSize(d)).toBe(100);
    expect(codes(d)).toEqual([]);
  });

  it('a non-companion card, an off-identity companion, and a companion also in the deck are rejected', () => {
    expect(codes({ ...wilson(), companion: id('Sol Ring') })).toEqual(['companion']);
    expect(codes({ ...wilson(), companion: id('Gyruda, Doom of Depths') })).toEqual(['companion']);
    const dup = deck(['Kenrith, the Returned King'], [e('Jegantha, the Wellspring'), e('Forest', 98)], { companion: id('Jegantha, the Wellspring') });
    expect(codes(dup)).toEqual(['companion']);
  });

  const check = (companion: string, commander: string, main: string[]) =>
    companionViolation(deck([commander], main.map((n) => e(n)), { companion: id(companion) }), db)?.code ?? null;

  it('Gyruda: even mana values only', () => {
    expect(check('Gyruda, Doom of Depths', 'Kenrith, the Returned King', ['Forest'])).toBe('companion'); // Kenrith is MV 5
    expect(check('Gyruda, Doom of Depths', 'Thrasios, Triton Hero', ['Forest', 'Island'])).toBe('companion'); // identity: Gyruda is UB
    expect(check('Gyruda, Doom of Depths', "Atraxa, Praetors' Voice", ['Forest', 'Counterspell'])).toBeNull(); // MV 4, 0, 2
    expect(check('Gyruda, Doom of Depths', "Atraxa, Praetors' Voice", ['Sol Ring'])).toBe('companion');
  });

  it('Jegantha: no repeated mana symbol in a cost', () => {
    expect(check('Jegantha, the Wellspring', 'Kenrith, the Returned King', ['Lightning Bolt', 'Forest'])).toBeNull();
    expect(check('Jegantha, the Wellspring', 'Kenrith, the Returned King', ['Commit // Memory'])).toBe('companion');
  });

  it('Keruga: nonland cards have mana value 3 or more', () => {
    expect(check('Keruga, the Macrosage', 'Kenrith, the Returned King', ['Forest', 'Bayou'])).toBeNull();
    expect(check('Keruga, the Macrosage', 'Kenrith, the Returned King', ['Sol Ring'])).toBe('companion');
  });

  it('Lurrus: permanents have mana value 2 or less', () => {
    expect(check('Lurrus of the Dream-Den', 'Tymna the Weaver', ['Sol Ring', 'Swamp'])).toBe('companion'); // Tymna is MV 3
    expect(check('Lurrus of the Dream-Den', 'Kenrith, the Returned King', ['Sol Ring'])).toBe('companion');
  });

  it('Obosh: nonland cards have odd mana values', () => {
    expect(check('Obosh, the Preypiercer', 'Kenrith, the Returned King', ['Lightning Bolt', 'Sol Ring', 'Bayou'])).toBeNull();
    expect(check('Obosh, the Preypiercer', 'Kenrith, the Returned King', ['Thrasios, Triton Hero'])).toBe('companion');
  });

  it('Kaheera: creature cards are of the named types', () => {
    expect(check('Kaheera, the Orphanguard', 'Kenrith, the Returned King', ['Forest'])).toBe('companion'); // Kenrith is a Human Noble
    expect(check('Kaheera, the Orphanguard', 'Jegantha, the Wellspring', ['Forest', 'Sol Ring'])).toBeNull(); // Elemental Elk
  });

  it('Umori: nonland cards share a card type', () => {
    expect(check('Umori, the Collector', 'Kenrith, the Returned King', ['Thrasios, Triton Hero', 'Forest'])).toBeNull();
    expect(check('Umori, the Collector', 'Kenrith, the Returned King', ['Lightning Bolt'])).toBe('companion');
  });

  it('Yorion: needs 20 cards over the minimum', () => {
    const d = (n: number) => deck(['Whtz, the Bibliophile'], [e('Island', n - 1)], { companion: id('Yorion, Sky Nomad') });
    expect(codes(d(100))).toEqual(['companion']);
    expect(codes(d(120))).toEqual([]);
  });

  it('Lurrus: a deck of cheap permanents passes', () => {
    // No fixture commander is white-black with mana value 2 or less, so one is cloned from Rose Tyler.
    const rose = card('Rose Tyler');
    expect(rose.cmc).toBeLessThanOrEqual(2);
    const leader = { ...rose, oracleId: 'test-wb-leader', name: 'Test Leader', frontName: 'Test Leader', colorIdentity: ['W', 'B'] as Color[] };
    const small = createCardDb([leader, ...['Lurrus of the Dream-Den', 'Sol Ring', 'Wrath of God', 'Plains', 'Kenrith, the Returned King'].map(card)], [], []);
    const d = (extra: string) => ({
      ...deck([], [e('Sol Ring'), e(extra), e('Plains', 97)], { companion: id('Lurrus of the Dream-Den') }),
      commanders: [leader.oracleId],
    });
    expect(validateDeck(d('Wrath of God'), small)).toEqual([]); // MV 4, but not a permanent card
    expect(validateDeck(d('Kenrith, the Returned King'), small).map((v) => v.code)).toContain('companion'); // MV 5 permanent
  });

  it('Kaheera: a changeling creature is every type (regression)', () => {
    expect(check('Kaheera, the Orphanguard', 'Jegantha, the Wellspring', ['Realmwalker', 'Taurean Mauler'])).toBeNull();
    expect(check('Kaheera, the Orphanguard', 'Jegantha, the Wellspring', ['Llanowar Elves'])).toBe('companion');
  });

  it('Zirda: permanents have an activated ability', () => {
    expect(check('Zirda, the Dawnwaker', 'Kenrith, the Returned King', ['Sol Ring', 'Forest', 'Lightning Bolt', 'Skullclamp'])).toBeNull();
    expect(check('Zirda, the Dawnwaker', 'Kenrith, the Returned King', ['Relentless Rats'])).toBe('companion');
  });
});

describe('Rulebreaker commanders', () => {
  it('the override table matches the synced cards', () => {
    const entries = Object.entries(RULEBREAKERS);
    expect(entries).toHaveLength(8);
    for (const [oracleId, r] of entries) {
      expect(db.get(oracleId)?.name, r.name).toBe(r.name);
      expect(db.get(oracleId)?.keywords).toContain('Rulebreaker');
    }
  });

  it('Tolabow with chosenColor R accepts Lightning Bolt and rejects a green-identity sorcery', () => {
    const d = deck(['Tolabow, Loch Rascal'], [e('Lightning Bolt'), e('Island', 98)], { chosenColor: 'R' });
    expect(codes(d)).toEqual([]);
    expect(fits('Become the Avalanche', d)).toBe('identity');
    expect(fits('Fire // Ice', d)).toBeNull();
    expect(fits('Krenko, Mob Boss', d)).toBe('identity'); // the extra colour covers instants and sorceries only
    expect(fits('Forest', d)).toBeNull(); // any basic land
    expect(fits('Bayou', d)).toBe('identity');
    expect([...allowedIdentity(d, db)]).toEqual(['U']);
  });

  it('Tolabow without a colour rejects Lightning Bolt, but the choice is optional', () => {
    const d = deck(['Tolabow, Loch Rascal'], [e('Lightning Bolt'), e('Island', 98)]);
    expect(needsColorChoice([card('Tolabow, Loch Rascal')])).toBe(true); // the editor still offers a picker
    expect(requiresColorChoice([card('Tolabow, Loch Rascal')])).toBe(false);
    expect(requiresColorChoice([card('The Prismatic Piper')])).toBe(true);
    expect(codes(d)).toEqual(['identity']);
    // Regression: a mono-blue Tolabow deck with no colour picked is a legal deck.
    expect(codes(deck(['Tolabow, Loch Rascal'], [e('Counterspell'), e('Island', 98)]))).toEqual([]);
  });

  it('changelings are Angel and Phyrexian cards (regression)', () => {
    // Taurean Mauler (red) and Realmwalker (green) have changeling.
    expect(isEveryCreatureType(card('Taurean Mauler'))).toBe(true);
    expect(isEveryCreatureType(card('Sol Ring'))).toBe(false);
    expect(fits('Taurean Mauler', deck(['Seluma, Light of Aysen'], []))).toBeNull();
    expect(fits('Realmwalker', deck(['Valko Indorian'], []))).toBeNull();
    expect(fits('Taurean Mauler', deck(['Maular, the Next Evolution'], []))).toBe('identity'); // MV 3, not an override
    expect(fits('Taurean Mauler', deck(['The Unluckiest Planeswalker'], []))).toBeNull(); // red anyway
    expect(fits('Realmwalker', deck(['The Unluckiest Planeswalker'], []))).toBe('identity'); // changeling is not an Aura
    // Mistform Ultimus says it in its own words instead of the keyword.
    const ultimus = {
      ...card('Krenko, Mob Boss'), oracleId: 'test-mistform', name: 'Mistform Ultimus', keywords: [],
      colorIdentity: ['U' as Color], frontTypeLine: 'Legendary Creature — Illusion',
      oracleText: "Mistform Ultimus is every creature type (even if this card isn't on the battlefield).",
    };
    ultimus.faces = [{ ...ultimus.faces[0], oracleText: ultimus.oracleText, typeLine: ultimus.frontTypeLine }];
    expect(hasCreatureType(ultimus, 'Angel')).toBe(true);
    expect(cardFitsDeck(ultimus, deck(['Seluma, Light of Aysen'], []), db)).toBeNull();
    expect(cardFitsDeck(ultimus, deck(['Syr Konrad, the Grim'], []), db)?.code).toBe('identity');
  });

  it('Seluma takes Angels of any identity and any basic land, but not off-colour nonbasics', () => {
    const d = deck(['Seluma, Light of Aysen'], []);
    expect(fits("Atraxa, Praetors' Voice", d)).toBeNull();
    expect(fits('Forest', d)).toBeNull();
    expect(fits('Bayou', d)).toBe('identity');
    expect(fits('Lightning Bolt', d)).toBe('identity');
    expect(fits('Iona, Shield of Emeria', d)).toBe('banned'); // Rulebreakers cannot unban
  });

  it('Maular takes creatures with mana value 7+', () => {
    const d = deck(['Maular, the Next Evolution'], []);
    expect(fits('Grizzlegom, Hurloon Hero', d)).toBeNull(); // GR, MV 7
    expect(fits('Krenko, Mob Boss', d)).toBe('identity');
    expect(fits('Swamp', d)).toBeNull();
  });

  it('The Everforger takes artifact creatures and Equipment', () => {
    const d = deck(['The Everforger'], []);
    expect(fits('Phyrexian Metamorph', d)).toBeNull();
    expect(fits('Skullclamp', d)).toBeNull();
    expect(fits('Lightning Bolt', d)).toBe('identity');
    expect(fits('Forest', d)).toBeNull();
  });

  it('Valko takes Phyrexian cards', () => {
    const d = deck(['Valko Indorian'], []);
    expect(fits('Armored Scrapgorger', d)).toBeNull();
    expect(fits("Atraxa, Praetors' Voice", d)).toBeNull();
    expect(fits('Krenko, Mob Boss', d)).toBe('identity');
  });

  it('The Unluckiest Planeswalker takes Auras', () => {
    const d = deck(['The Unluckiest Planeswalker'], []);
    expect(fits('Wild Growth', d)).toBeNull();
    expect(fits('Animate Dead', d)).toBeNull();
    expect(fits('Sword of the Animist', d)).toBeNull(); // colourless anyway
    expect(fits('Relentless Rats', d)).toBe('identity');
  });

  it('Grizzlegom takes any land but no off-colour spells', () => {
    const d = deck(['Grizzlegom, Hurloon Hero'], []);
    expect(fits('Bayou', d)).toBeNull();
    expect(fits('Island', d)).toBeNull();
    expect(fits('Relentless Rats', d)).toBe('identity');
  });

  it('the override applies only while the card is the commander', () => {
    expect(fits("Atraxa, Praetors' Voice", deck(['Loran of the Third Path'], [e('Seluma, Light of Aysen')]))).toBe('identity');
  });
});
