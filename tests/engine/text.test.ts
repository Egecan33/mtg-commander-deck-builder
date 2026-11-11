import { describe, expect, it } from 'vitest';
import { exportDecklist, parseCollection, parseDecklist } from '@/engine/text';
import type { Deck } from '@/engine/types';
import { card, deckText, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const id = (name: string) => card(name).oracleId;
const qtyOf = (main: { oracleId: string; qty: number }[], name: string) => main.find((e) => e.oracleId === id(name))?.qty;

describe('parseDecklist: messy formats (Review Focus 1)', () => {
  const text = [
    'Commander',
    '1 Atraxa, Praetors’ Voice (2XM) 190 *F*', // curly apostrophe, set, number, foil
    '',
    'Deck',
    '1 Sol Ring (C21) 263',
    '1x Arcane Signet',
    '2x command tower [CMR] *F*',
    '// Lands',
    '1 Barkchannel Pathway',                      // front face only
    '1 Darkbore Pathway // Slitherbore Pathway',  // full name
    '1 Fire / Ice',                               // single slash
    '1 commit/memory',                            // no spaces, lower case
    '1 Bonecrusher Giant (ELD) 115',              // adventure by front name
    '1 LIM-DUL\'S VAULT',                         // case and diacritics
    'Birds of Paradise',                          // no quantity
    '',
    'Sideboard',
    '1 Lutri, the Spellchaser',
    '1 Chaos Warp',
  ].join('\r\n');
  const r = parseDecklist(text, db);

  it('resolves every line', () => {
    expect(r.unresolved).toEqual([]);
    expect(r.commanders).toEqual([id("Atraxa, Praetors' Voice")]);
    const names = ['Sol Ring', 'Arcane Signet', 'Command Tower', 'Barkchannel Pathway', 'Darkbore Pathway', 'Fire // Ice',
      'Commit // Memory', 'Bonecrusher Giant', "Lim-Dûl's Vault", 'Birds of Paradise'];
    expect(r.main.map((e) => e.oracleId)).toEqual(names.map(id));
    expect(qtyOf(r.main, 'Command Tower')).toBe(2);
    expect(r.main.every((e) => e.locked === false)).toBe(true);
  });

  it('takes a companion from the sideboard and reports the rest as ignored, not lost', () => {
    expect(r.companion).toBe(id('Lutri, the Spellchaser'));
    expect(r.ignored).toEqual([{ line: 19, text: '1 Chaos Warp' }]);
  });

  it('reads header variants', () => {
    const v = parseDecklist('// COMMANDER (1)\n1 Kinnan, Bonder Prodigy\n# Companion:\n1 Lutri, the Spellchaser\nMainboard (2):\n1 Sol Ring\nCreatures (1)\n1 Birds of Paradise\nMaybeboard\n1 Chaos Warp\n', db);
    expect(v.unresolved).toEqual([]);
    expect(v.commanders).toEqual([id('Kinnan, Bonder Prodigy')]);
    expect(v.companion).toBe(id('Lutri, the Spellchaser'));
    expect(v.main.map((e) => e.oracleId)).toEqual([id('Sol Ring'), id('Birds of Paradise')]);
  });

  it('reads Archidekt and Arena style lines', () => {
    const v = parseDecklist('About\nName Test deck\n\n1x Kinnan, Bonder Prodigy (iko) 192 *F* [Commander{top}]\n1x Sol Ring (c21) 263 [Ramp] ^Have,#37d67a^\nSB: 1 Chaos Warp\n', db);
    expect(v.unresolved).toEqual([]);
    expect(v.commanders).toEqual([id('Kinnan, Bonder Prodigy')]);
    expect(v.main).toEqual([{ oracleId: id('Sol Ring'), qty: 1, locked: false }]);
  });

  it('two commanders in the Commander section', () => {
    const v = parseDecklist('Commander\n1 Thrasios, Triton Hero\n1 Tymna the Weaver\n\nDeck\n1 Sol Ring', db);
    expect(v.commanders).toEqual([id('Thrasios, Triton Hero'), id('Tymna the Weaver')]);
  });
});

describe('parseDecklist: lists without section headers', () => {
  const precon = deckText('precon').split('\n').filter((l) => /^\d/.test(l));

  it('uses a *CMDR* tag', () => {
    const r = parseDecklist('1 Sol Ring\n1 Kinnan, Bonder Prodigy *CMDR*\n1 Birds of Paradise', db);
    expect(r.commanders).toEqual([id('Kinnan, Bonder Prodigy')]);
    expect(r.main.map((e) => e.oracleId)).toEqual([id('Sol Ring'), id('Birds of Paradise')]);
  });

  it('takes the first eligible legendary card of an exactly-100-card list', () => {
    expect(precon.reduce((n, l) => n + Number.parseInt(l, 10), 0)).toBe(100);
    const shuffled = [...precon.slice(1, 4), precon[0]!, ...precon.slice(4)]; // non-legendary cards first
    const r = parseDecklist(shuffled.join('\n'), db);
    expect(r.unresolved).toEqual([]);
    const first = shuffled.map((l) => card(l.replace(/^\d+ /, ''))).find((c) => /Legendary/.test(c.frontTypeLine) && /Creature/.test(c.frontTypeLine))!;
    expect(r.commanders).toEqual([first.oracleId]);
    expect(r.main.reduce((n, e) => n + e.qty, 0)).toBe(99);
    expect(r.main.some((e) => e.oracleId === first.oracleId)).toBe(false);
  });

  it('honours a custom eligibility predicate', () => {
    const r = parseDecklist(precon.join('\n'), db, { isCommanderEligible: (c) => c.name === 'Dragonlord Atarka' });
    expect(r.commanders).toEqual([id('Dragonlord Atarka')]);
    expect(parseDecklist(precon.join('\n'), db, { isCommanderEligible: () => false }).commanders).toEqual([]);
  });

  it('leaves commanders empty when the list is not 100 cards', () => {
    const r = parseDecklist(precon.filter((_, i) => i !== 5).join('\n'), db);
    expect(r.commanders).toEqual([]);
    expect(r.main.reduce((n, e) => n + e.qty, 0)).toBe(99);
    expect(parseDecklist('', db)).toEqual({ commanders: [], companion: null, main: [], unresolved: [], ignored: [] });
  });
});

describe('parseDecklist: duplicates and unresolved', () => {
  it('merges duplicate lines', () => {
    const r = parseDecklist('3 Forest\n1 Sol Ring\n2x forest (UNF) 239\n', db);
    expect(r.main).toEqual([
      { oracleId: id('Forest'), qty: 5, locked: false },
      { oracleId: id('Sol Ring'), qty: 1, locked: false },
    ]);
  });

  it('reports a typo with its line number and keeps the rest', () => {
    const r = parseDecklist('Deck\n1 Sol Ring\n\n1 Sol Rnig (C21) 263\n1 Arcane Signet\nNot A Real Card\n', db);
    expect(r.unresolved).toEqual([
      { line: 4, text: '1 Sol Rnig (C21) 263' },
      { line: 6, text: 'Not A Real Card' },
    ]);
    expect(r.main.map((e) => e.oracleId)).toEqual([id('Sol Ring'), id('Arcane Signet')]);
  });
});

describe('exportDecklist', () => {
  const deckOf = (commanders: string[], companion: string | null, main: [string, number][]): Deck => ({
    id: null, name: 't', commanders: commanders.map(id), companion: companion ? id(companion) : null, chosenColor: null,
    main: main.map(([n, qty]) => ({ oracleId: id(n), qty, locked: false })), targetBracket: 3, themeWeights: null,
  });

  it('writes Commander then Deck with full names', () => {
    const d = deckOf(['Kinnan, Bonder Prodigy'], null, [['Sol Ring', 1], ['Barkchannel Pathway', 1], ['Forest', 7]]);
    expect(exportDecklist(d, db)).toBe(
      'Commander\n1 Kinnan, Bonder Prodigy\n\nDeck\n1 Sol Ring\n1 Barkchannel Pathway // Tidechannel Pathway\n7 Forest\n',
    );
  });

  it('round-trips through parseDecklist', () => {
    const decks = [
      deckOf(['Thrasios, Triton Hero', 'Tymna the Weaver'], 'Lutri, the Spellchaser', [['Sol Ring', 1], ['Fire // Ice', 1], ["Lim-Dûl's Vault", 1], ['Island', 12]]),
      deckOf([], null, [['Sol Ring', 1], ['Bonecrusher Giant', 1]]),
      deckOf([], null, []),
    ];
    for (const d of decks) {
      const r = parseDecklist(exportDecklist(d, db), db);
      expect(r.unresolved).toEqual([]);
      expect(r.commanders).toEqual(d.commanders);
      expect(r.companion).toBe(d.companion);
      expect(r.main).toEqual(d.main);
    }
  });

  it('round-trips the three reference decks, including a commanderless 100-card export', () => {
    for (const name of ['precon', 'upgraded', 'cedh'] as const) {
      const p = parseDecklist(deckText(name), db);
      expect(p.unresolved).toEqual([]);
      expect(p.commanders).toHaveLength(1);
      expect(p.main.reduce((n, e) => n + e.qty, 0)).toBe(99);
      const d: Deck = { id: null, name, commanders: p.commanders, companion: p.companion, chosenColor: null, main: p.main, targetBracket: 3, themeWeights: null };
      const again = parseDecklist(exportDecklist(d, db), db);
      expect({ ...again }).toEqual({ ...p });
      // No commander chosen yet: the "Deck" header stops the first-legendary guess.
      const loose: Deck = { ...d, commanders: [], main: [{ oracleId: p.commanders[0]!, qty: 1, locked: false }, ...p.main] };
      const back = parseDecklist(exportDecklist(loose, db), db);
      expect(back.commanders).toEqual([]);
      expect(back.main).toEqual(loose.main);
    }
  });

  it('keeps an unknown card visible as a comment', () => {
    const d = deckOf(['Kinnan, Bonder Prodigy'], null, [['Sol Ring', 1]]);
    d.main.push({ oracleId: 'no-such-id', qty: 1, locked: false });
    const text = exportDecklist(d, db);
    expect(text).toContain('// unknown card no-such-id');
    const r = parseDecklist(text, db);
    expect(r.unresolved).toEqual([]);
    expect(r.main).toEqual([{ oracleId: id('Sol Ring'), qty: 1, locked: false }]);
  });
});

describe('parseCollection', () => {
  const sorted = (owned: { oracleId: string; qty: number }[]) => [...owned].sort((a, b) => a.oracleId.localeCompare(b.oracleId));
  const want = (pairs: [string, number][]) => sorted(pairs.map(([n, qty]) => ({ oracleId: id(n), qty })));

  it('Moxfield CSV: uses Count, not Tradelist Count; quoted names with commas', () => {
    const csv = [
      '"Count","Tradelist Count","Name","Edition","Condition","Language","Foil","Tags","Last Modified","Collector Number","Alter","Proxy","Purchase Price"',
      '"3","0","Sol Ring","c21","Near Mint","English","","","2025-01-01 00:00:00.000000","263","False","False",""',
      '"1","5","Kinnan, Bonder Prodigy","iko","Near Mint","English","foil","","2025-01-01 00:00:00.000000","192","False","False","12.50"',
      '"2","0","Fire // Ice","mh2","Near Mint","English","","","2025-01-01 00:00:00.000000","290","False","False",""',
    ].join('\r\n');
    const r = parseCollection(csv, db);
    expect(r.unresolved).toEqual([]);
    expect(sorted(r.owned)).toEqual(want([['Sol Ring', 3], ['Kinnan, Bonder Prodigy', 1], ['Fire // Ice', 2]]));
  });

  it('Archidekt CSV', () => {
    const csv = 'Quantity,Name,Finish,Condition,Date Added,Language,Purchase Price,Tags,Edition Name,Edition Code,Multiverse Id,Scryfall ID,Collector Number\n'
      + '2,Sol Ring,Normal,NM,2025-01-01,EN,,,Commander 2021,c21,0,x,263\n'
      + '1,"Atraxa, Praetors\' Voice",Foil,NM,2025-01-01,EN,,"a, b",Double Masters,2xm,0,x,190\n'
      + '1,Sol Ring,Foil,NM,2025-01-01,EN,,,Commander Legends,cmr,0,x,472\n';
    const r = parseCollection(csv, db);
    expect(r.unresolved).toEqual([]);
    expect(sorted(r.owned)).toEqual(want([['Sol Ring', 3], ["Atraxa, Praetors' Voice", 1]]));
  });

  it('ManaBox CSV: name first, quantity in a later column, front-face names', () => {
    const csv = 'Name,Set code,Set name,Collector number,Foil,Rarity,Quantity,ManaBox ID,Scryfall ID,Purchase price,Misprint,Altered,Condition,Language,Purchase price currency\n'
      + 'Sol Ring,C21,Commander 2021,263,normal,uncommon,4,1,x,1.0,false,false,near_mint,en,EUR\n'
      + 'Barkchannel Pathway,ZNR,Zendikar Rising,251,foil,rare,1,2,x,3.0,false,false,near_mint,en,EUR\n'
      + '"Kinnan, Bonder Prodigy",IKO,Ikoria,192,normal,mythic,2,3,x,9.0,false,false,near_mint,en,EUR\n';
    const r = parseCollection(csv, db);
    expect(r.unresolved).toEqual([]);
    expect(sorted(r.owned)).toEqual(want([['Sol Ring', 4], ['Barkchannel Pathway', 1], ['Kinnan, Bonder Prodigy', 2]]));
  });

  it('reports unknown CSV rows with the line they start on; other delimiters; no quantity column', () => {
    const r = parseCollection('Name;Qty\nSol Ring;2\n"Totally ""Fake"" Card";1\n\nArcane Signet;x\nForest;10\n', db);
    expect(r.unresolved).toEqual([
      { line: 3, text: '"Totally ""Fake"" Card";1' },
      { line: 5, text: 'Arcane Signet;x' },
    ]);
    expect(sorted(r.owned)).toEqual(want([['Sol Ring', 2], ['Forest', 10]]));
    expect(sorted(parseCollection('Set\tName\nC21\tSol Ring\nC21\tSol Ring\n', db).owned)).toEqual(want([['Sol Ring', 2]]));
  });

  it('plain list', () => {
    const r = parseCollection('4 Sol Ring\n1x Fire / Ice (MH2) 290 *F*\n\nSideboard:\nBirds of Paradise\n2 Sol Ring\n1 Nope Nope\n', db);
    expect(r.unresolved).toEqual([{ line: 7, text: '1 Nope Nope' }]);
    expect(sorted(r.owned)).toEqual(want([['Sol Ring', 6], ['Fire // Ice', 1], ['Birds of Paradise', 1]]));
    expect(parseCollection('', db)).toEqual({ owned: [], unresolved: [] });
  });
});

describe('review regressions: decklist', () => {
  const parse = (lines: string[]) => parseDecklist(lines.join('\n'), db);
  const names = (ids: string[]) => ids.map((x) => db.get(x)!.name);

  it('defaults to the rules engine for commander eligibility', () => {
    // Grist is a planeswalker and a legal commander; a lone Background is not one.
    const p = parse(['1 Raised by Giants', '1 Grist, the Hunger Tide', '1 Kenrith, the Returned King', '97 Forest']);
    expect(names(p.commanders)).toEqual(['Grist, the Hunger Tide']);
    expect(qtyOf(p.main, 'Raised by Giants')).toBe(1);
    expect(p.main.reduce((n, e) => n + e.qty, 0)).toBe(99);
  });

  it('never turns an unknown multi-part name into its first word', () => {
    const p = parse(['1 Sol Ring // Herd // Saw', '1 Fire // Ice', '1 Forest // a note']);
    expect(p.unresolved.map((u) => u.line)).toEqual([1, 3]);
    expect(names(p.main.map((e) => e.oracleId))).toEqual(['Fire // Ice']);
  });

  it('reads trailing quantities, bare printing suffixes and trailing notes', () => {
    const p = parse(['Sol Ring x2', '1 Arcane Signet C21 234', '1 Command Tower ELD 333', '3 Forest # basics', '1 FOREST BEAR']);
    expect(qtyOf(p.main, 'Sol Ring')).toBe(2);
    expect(qtyOf(p.main, 'Arcane Signet')).toBe(1);
    expect(qtyOf(p.main, 'Command Tower')).toBe(1);
    expect(qtyOf(p.main, 'Forest')).toBe(3); // the all-caps typo did not become a Forest
    expect(p.unresolved).toEqual([{ line: 5, text: '1 FOREST BEAR' }]);
  });

  it('rejects absurd quantities instead of storing them', () => {
    const p = parse(['100000000000000000000000 Island', '10000 Forest', '9999 Swamp']);
    expect(p.unresolved.map((u) => u.line)).toEqual([1, 2]);
    expect(p.main).toEqual([{ oracleId: id('Swamp'), qty: 9999, locked: false }]);
    expect(parseCollection('Name,Quantity\nIsland,100000000000000000000000\nForest,3', db)).toEqual({
      owned: [{ oracleId: id('Forest'), qty: 3 }],
      unresolved: [{ line: 2, text: 'Island,100000000000000000000000' }],
    });
  });

  it('Archidekt categories: maybeboard stays out, only an exact Commander category counts', () => {
    const p = parse([
      "1x Atraxa, Praetors' Voice (2x2) 190 [Commander{top}]",
      '1x Sol Ring (c21) 263 [Ramp]',
      '1x Llanowar Elves (m19) 314 [Maybeboard{noDeck}{noPrice}]',
      '1x Kenrith, the Returned King (eld) 303 [Commander Damage,Wincon]',
      '1x Lutri, the Spellchaser (iko) 227 [Sideboard{noDeck}{noPrice},Companion{noDeck}]',
      '1x Negate (m20) 69 [Sideboard{noDeck}]',
    ]);
    expect(names(p.commanders)).toEqual(["Atraxa, Praetors' Voice"]);
    expect(names(p.main.map((e) => e.oracleId))).toEqual(['Sol Ring', 'Kenrith, the Returned King']);
    expect(p.companion).toBe(id('Lutri, the Spellchaser'));
    expect(p.ignored.map((u) => u.line)).toEqual([3, 6]);
    expect(p.unresolved).toEqual([]);
  });

  it('a companion card in the maybeboard is not made the companion', () => {
    const p = parse(['Commander', '1 Kenrith, the Returned King', 'Deck', '1 Sol Ring', 'Maybeboard', '1 Zirda, the Dawnwaker']);
    expect(p.companion).toBeNull();
    expect(p.ignored.map((u) => u.line)).toEqual([6]);
  });

  it('a commander repeated in the deck section is one card', () => {
    const p = parse(['Commander', '1 Kenrith, the Returned King', '', 'Deck', '1 Kenrith, the Returned King', '1 Sol Ring', '98 Forest']);
    expect(names(p.commanders)).toEqual(['Kenrith, the Returned King']);
    expect(qtyOf(p.main, 'Kenrith, the Returned King')).toBeUndefined();
    expect(p.main.reduce((n, e) => n + e.qty, 0)).toBe(99);
    // An any-number commander keeps its extra copies.
    const cid = parse(['Commander', '1 Cid, Timeless Artificer', 'Deck', '5 Cid, Timeless Artificer']);
    expect(qtyOf(cid.main, 'Cid, Timeless Artificer')).toBe(5);
  });

  it('finds the commander of an MTGO-style export under Sideboard', () => {
    const one = parse(['1 Sol Ring', '98 Forest', '', 'SIDEBOARD:', '1 Kenrith, the Returned King']);
    expect(names(one.commanders)).toEqual(['Kenrith, the Returned King']);
    expect(one.ignored).toEqual([]);
    const two = parse(['98 Forest', '', 'Sideboard', '1 Thrasios, Triton Hero', '1 Tymna the Weaver']);
    expect(names(two.commanders)).toEqual(['Thrasios, Triton Hero', 'Tymna the Weaver']);
    // Not when the numbers do not add up to 100, or the cards cannot lead a deck.
    expect(parse(['90 Forest', 'Sideboard', '1 Kenrith, the Returned King']).commanders).toEqual([]);
    const no = parse(['99 Forest', 'Sideboard', '1 Negate']);
    expect(no.commanders).toEqual([]);
    expect(no.ignored.map((u) => u.line)).toEqual([3]);
  });

  it('prefers a commander set apart in a last block over the first legendary card', () => {
    const p = parse(['1 Kenrith, the Returned King', '1 Sol Ring', '96 Forest', '', '1 Thrasios, Triton Hero', '1 Tymna the Weaver']);
    expect(names(p.commanders)).toEqual(['Thrasios, Triton Hero', 'Tymna the Weaver']);
    expect(qtyOf(p.main, 'Kenrith, the Returned King')).toBe(1);
    expect(p.main.reduce((n, e) => n + e.qty, 0)).toBe(98);
  });

  it('reads "Commander: Name" on one line', () => {
    const p = parse(["Commander: Atraxa, Praetors' Voice", 'Companion: Jegantha, the Wellspring', '1 Sol Ring']);
    expect(names(p.commanders)).toEqual(["Atraxa, Praetors' Voice"]);
    expect(p.companion).toBe(id('Jegantha, the Wellspring'));
    expect(names(p.main.map((e) => e.oracleId))).toEqual(['Sol Ring']);
  });
});

describe('review regressions: collection', () => {
  it('skips an Excel "sep=" line and keeps line numbers', () => {
    const csv = 'sep=,\nFolder Name,Quantity,Trade Quantity,Card Name,Set Code\nBinder,2,0,Sol Ring,C21\nBinder,1,0,Nope,C21\n';
    expect(parseCollection(csv, db)).toEqual({
      owned: [{ oracleId: id('Sol Ring'), qty: 2 }],
      unresolved: [{ line: 4, text: 'Binder,1,0,Nope,C21' }],
    });
  });
});
