import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Card, Combo } from '@/engine/types';
import { card, deckText, fixtureDb } from '../helpers/fixture-db';

const raw = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/cards.json', import.meta.url)), 'utf8')) as {
  cards: Card[];
  tags: Record<string, string[]>;
};
const combos = JSON.parse(readFileSync(fileURLToPath(new URL('../fixtures/combos.json', import.meta.url)), 'utf8')) as Combo[];

/** Minimal reader for the fixture format: a `Commander` header, its card, then `Deck` and quantity lines. */
function readDeck(text: string): { commander: string[]; main: { qty: number; name: string }[] } {
  const out = { commander: [] as string[], main: [] as { qty: number; name: string }[] };
  let section = '';
  for (const line of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
    const m = /^(\d+) (.+)$/.exec(line);
    if (!m) {
      section = line;
      continue;
    }
    if (section === 'Commander') out.commander.push(m[2]);
    else out.main.push({ qty: Number(m[1]), name: m[2] });
  }
  return out;
}

describe('fixture cards', () => {
  const db = fixtureDb();

  it('has between 600 and 1000 real cards, each with a tag list', () => {
    expect(raw.cards.length).toBeGreaterThanOrEqual(600);
    expect(raw.cards.length).toBeLessThanOrEqual(1000);
    for (const c of raw.cards) expect(Array.isArray(raw.tags[c.oracleId]), c.name).toBe(true);
    expect(db.tagSlugs(card('Sol Ring').oracleId)).toContain('mana-rock');
    expect(db.tagSlugs(card('Cultivate').oracleId)).toContain('ramp'); // rolled up from land-ramp
  });

  it('contains all 53 Game Changers, the basics and the banned examples', () => {
    expect(raw.cards.filter((c) => c.gameChanger)).toHaveLength(53);
    for (const n of ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes', 'Snow-Covered Forest']) {
      expect(card(n).frontTypeLine).toContain('Basic');
    }
    expect(card('Black Lotus').legality).toBe('banned');
    expect(db.all().some((c) => c.legality !== 'legal' || c.isMeldResult)).toBe(false);
    expect(card('Brisela, Voice of Nightmares').isMeldResult).toBe(true);
  });

  it('contains every commander the plan tests against', () => {
    for (const n of [
      "Atraxa, Praetors' Voice", 'Kinnan, Bonder Prodigy', 'Lathril, Blade of the Elves', 'Krenko, Mob Boss',
      'Meren of Clan Nel Toth', 'Talrand, Sky Summoner', 'Karn, Legacy Reforged', 'Kenrith, the Returned King',
      'Thrasios, Triton Hero', 'Tymna the Weaver', 'Wilson, Refined Grizzly', 'Raised by Giants', 'The Tenth Doctor',
      'Rose Tyler', 'Kozilek, the Great Distortion', 'The Prismatic Piper', 'Grist, the Hunger Tide', 'Lutri, the Spellchaser',
    ]) {
      expect(card(n).name).toBe(n);
    }
  });

  it('gives multi-face cards text, names and image counts on every face', () => {
    const multi = raw.cards.filter((c) => c.faces.length > 1);
    expect(multi.length).toBeGreaterThan(10);
    for (const c of multi) {
      expect(c.oracleText, c.name).toContain('\n//\n');
      expect(c.oracleText).not.toContain('undefined');
      for (const f of c.faces) {
        expect(typeof f.oracleText).toBe('string');
        expect(f.name.length).toBeGreaterThan(0);
        expect(f.typeLine.length).toBeGreaterThan(0);
      }
      expect(c.imageFaces).toBe(c.layout === 'transform' || c.layout === 'modal_dfc' ? 2 : 1);
    }
    const tergrid = card('tergrid, god of fright');
    expect(tergrid.name).toBe("Tergrid, God of Fright // Tergrid's Lantern");
    expect(tergrid.imageFaces).toBe(2);
    expect(card('Malakir Rebirth').frontTypeLine).toBe('Instant');
    expect(card('Malakir Rebirth').typeLine).toContain('Land');
    expect(card('fire // ice').imageFaces).toBe(1);
    expect(card("lim-dul's vault").name).toBe("Lim-Dûl's Vault");
    expect(card('nazgul').name).toBe('Nazgûl');
  });

  it('keeps only combos whose cards are all in the fixture', () => {
    expect(combos.length).toBeGreaterThan(20);
    for (const combo of combos) {
      for (const c of combo.cards) expect(db.get(c.oracleId), combo.id).toBeDefined();
      expect(['R', 'S', 'P', 'O', 'C', 'E']).toContain(combo.bracketTag);
    }
    expect(db.combosFor(card("Thassa's Oracle").oracleId).length).toBeGreaterThan(0);
  });
});

describe.each(['precon', 'upgraded', 'cedh'] as const)('reference deck %s', (name) => {
  const db = fixtureDb();
  const deck = readDeck(deckText(name));

  it('starts with a Commander header and one legendary commander', () => {
    const lines = deckText(name).split('\n');
    expect(lines[0]).toBe('Commander');
    expect(lines[1]).toBe(`1 ${deck.commander[0]}`);
    expect(deck.commander).toHaveLength(1);
    expect(card(deck.commander[0]).frontTypeLine).toMatch(/Legendary.*Creature/);
  });

  it('is exactly 100 known, legal cards inside the commander identity', () => {
    expect(1 + deck.main.reduce((n, e) => n + e.qty, 0)).toBe(100);
    const identity = new Set(card(deck.commander[0]).colorIdentity);
    for (const e of deck.main) {
      const c = db.byName(e.name);
      expect(c, e.name).toBeDefined();
      expect(c!.legality, e.name).toBe('legal');
      expect(c!.colorIdentity.every((col) => identity.has(col)), e.name).toBe(true);
      if (e.qty > 1) expect(c!.frontTypeLine, e.name).toContain('Basic');
    }
    expect(new Set(deck.main.map((e) => db.byName(e.name)!.oracleId)).size).toBe(deck.main.length);
  });
});
