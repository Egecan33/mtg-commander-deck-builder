import { describe, expect, it } from 'vitest';
import { AXES, commanderThemeWeights, computeFeatures } from '@/engine/features';
import type { CardFeatures } from '@/engine/types';
import { card, fixtureDb } from '../helpers/fixture-db';

function feat(name: string): CardFeatures {
  const db = fixtureDb();
  const c = card(name);
  return computeFeatures(c, db.tagSlugs(c.oracleId));
}
const axis = (f: CardFeatures, id: string) => f.axes[id] ?? { e: 0, p: 0 };

describe('roles', () => {
  it('mana producers', () => {
    const sol = feat('Sol Ring');
    expect(sol.roles).toEqual(expect.arrayContaining(['ramp', 'fast-mana']));
    expect(sol.sources).toEqual({ C: 0.75 });
    expect(sol.powerTier).toBe(5);
    const elves = feat('Llanowar Elves');
    expect(elves.roles).toContain('ramp');
    expect(elves.roles).not.toContain('fast-mana');
    expect(elves.sources).toEqual({ G: 0.5 });
    expect(elves.creatureTypes).toEqual(['elf', 'druid']);
    expect(feat('Black Lotus').roles).toContain('fast-mana');
    const cultivate = feat('Cultivate');
    expect(cultivate.roles).toContain('ramp');
    expect(cultivate.roles).not.toContain('tutor');
  });

  it('lands', () => {
    const tower = feat('Command Tower');
    expect(tower.roles).toEqual(['land']);
    expect(tower.landWeight).toBe(1);
    expect(tower.taplandWeight).toBe(0);
    expect(tower.sources.G).toBe(1);
    const gate = feat('Golgari Guildgate');
    expect(gate.taplandWeight).toBe(1);
    expect(gate.sources).toEqual({ B: 1, G: 1 });
    expect(feat('Bayou').taplandWeight).toBe(0);
    expect(feat('Wastes').sources).toEqual({ C: 1 });
  });

  it('MDFC land-spells count as partial lands and never have undefined text', () => {
    const rebirth = feat('Malakir Rebirth');
    expect(rebirth.landWeight).toBe(0.38);
    expect(rebirth.roles).not.toContain('land');
    expect(rebirth.sources).toEqual({ B: 0.8 });
    expect(rebirth.instantSpeed).toBe(true);
    const call = feat("Emeria's Call");
    expect(call.landWeight).toBe(0.74);
    expect(call.sources).toEqual({ W: 1 });
    expect(call.pips).toEqual({ W: 3 });
    const pathway = feat('Barkchannel Pathway');
    expect(pathway.landWeight).toBe(1);
    expect(pathway.roles).toContain('land');
    expect(pathway.sources).toEqual({ G: 1, U: 1 });
  });

  it('interaction', () => {
    const swords = feat('Swords to Plowshares');
    expect(swords.roles).toContain('spot-removal');
    expect(swords.instantSpeed).toBe(true);
    expect(swords.pips).toEqual({ W: 1 });
    expect(feat('Wrath of God').roles).toContain('wipe');
    expect(feat('Wrath of God').instantSpeed).toBe(false);
    const counter = feat('Counterspell');
    expect(counter.roles).toContain('counterspell');
    expect(counter.pips).toEqual({ U: 2 });
    expect(feat('Bojuka Bog').roles).toEqual(expect.arrayContaining(['land', 'graveyard-hate']));
    expect(feat('Bojuka Bog').taplandWeight).toBe(1);
  });

  it('bracket-relevant roles', () => {
    const tutor = feat('Demonic Tutor');
    expect(tutor.roles).toEqual(expect.arrayContaining(['tutor', 'game-changer']));
    expect(tutor.powerTier).toBe(5);
    const geddon = feat('Armageddon');
    expect(geddon.roles).toContain('mass-land-denial');
    expect(geddon.roles).not.toContain('wipe');
    expect(feat('Time Warp').roles).toContain('extra-turn');
    expect(feat('Rhystic Study').roles).toContain('draw');
    expect(feat('Rhystic Study').roles).not.toContain('stax');
    expect(feat('Reanimate').roles).toContain('recursion');
    expect(feat("Thassa's Oracle").roles).toContain('win-condition');
  });

  it('keeps fast mana narrow', () => {
    for (const name of ['Sol Ring', 'Mana Vault', 'Grim Monolith', 'Lotus Petal', 'Chrome Mox', 'Mox Diamond', 'Dark Ritual', 'Ancient Tomb']) {
      expect(feat(name).roles, name).toContain('fast-mana');
      expect(feat(name).powerTier, name).toBe(5);
    }
    for (const name of ['Llanowar Elves', 'Elvish Mystic', 'Birds of Paradise', 'Arcane Signet', 'Springleaf Drum', 'Wild Growth', 'Utopia Sprawl', 'Temple of the False God', 'Command Tower', 'Cultivate']) {
      expect(feat(name).roles, name).not.toContain('fast-mana');
    }
    // One-shot mana is not a lasting source or ramp.
    expect(feat('Lotus Petal').sources).toEqual({});
    expect(feat('Dark Ritual').roles).not.toContain('ramp');
  });

  it('keeps stax and win conditions narrow', () => {
    for (const name of ['Grand Arbiter Augustin IV', 'Drannith Magistrate']) expect(feat(name).roles, name).toContain('stax');
    for (const name of ['Rhystic Study', 'Smothering Tithe', 'Propaganda', 'Counterspell', 'Armageddon', 'Sol Ring']) {
      expect(feat(name).roles, name).not.toContain('stax');
    }
    for (const name of ['Craterhoof Behemoth', 'Exsanguinate', "Thassa's Oracle"]) expect(feat(name).roles, name).toContain('win-condition');
    for (const name of ['Sol Ring', 'Demonic Tutor', 'Wrath of God', 'Elvish Archdruid', 'Time Warp']) {
      expect(feat(name).roles, name).not.toContain('win-condition');
    }
  });

  it('narrows the broad tags with text', () => {
    // Land searches are ramp, not tutors; giving an opponent a land is neither.
    for (const name of ['Farseek', "Nature's Lore", 'Three Visits', 'Rampant Growth', 'Sakura-Tribe Elder']) {
      expect(feat(name).roles, name).toContain('ramp');
      expect(feat(name).roles, name).not.toContain('tutor');
    }
    expect(feat('Path to Exile').roles).toEqual(['spot-removal']);
    expect(feat('Path to Exile').sources).toEqual({});
    expect(feat('Chaos Warp').roles).toContain('spot-removal');
    expect(feat('Faithless Looting').roles).not.toContain('draw'); // looting is not card advantage
    expect(feat('Necropotence').roles).toContain('draw');
    expect(feat('Cyclonic Rift').roles).toContain('wipe');
    expect(feat('Vandalblast').roles).toContain('wipe');
    for (const name of ["Teferi's Protection", 'Heroic Intervention', 'Deflecting Swat']) expect(feat(name).roles, name).toContain('protection');
    expect(feat('Eternal Witness').roles).toContain('recursion');
  });

  it('rates free interaction at the top power tier', () => {
    for (const name of ['Force of Will', 'Fierce Guardianship', 'Pact of Negation', 'Deflecting Swat']) expect(feat(name).powerTier, name).toBe(5);
    expect(feat('Counterspell').powerTier).toBeLessThan(5);
  });

  it('mana sources and taplands', () => {
    expect(feat('Birds of Paradise').sources).toEqual({ W: 0.5, U: 0.5, B: 0.5, R: 0.5, G: 0.5 });
    expect(feat('Arcane Signet').sources.U).toBe(0.75);
    expect(feat('Polluted Delta').sources).toEqual({ U: 1, B: 1 });
    expect(feat('Evolving Wilds').sources.R).toBe(0.5);
    expect(feat('Evolving Wilds').taplandWeight).toBe(1);
    expect(feat('Watery Grave').taplandWeight).toBe(0.25);
    expect(feat('Rampant Growth').sources.W).toBe(0.5);
    expect(feat("Nature's Lore").sources).toEqual({ G: 0.5 });
    expect(feat('Fell the Profane').landWeight).toBe(0.74);
    expect(feat('Mental Misstep').pips).toEqual({}); // Phyrexian mana is paid with life
  });

  it('every fixture card gets well-formed features', () => {
    const db = fixtureDb();
    for (const c of db.all()) {
      const f = computeFeatures(c, db.tagSlugs(c.oracleId));
      expect(f.oracleId).toBe(c.oracleId);
      expect([0, 0.38, 0.74, 1]).toContain(f.landWeight);
      expect([0, 0.25, 1]).toContain(f.taplandWeight);
      expect([1, 2, 3, 4, 5]).toContain(f.powerTier);
      expect(new Set(f.roles).size).toBe(f.roles.length);
      for (const [id, v] of Object.entries(f.axes)) {
        expect(id).toMatch(/^[a-z-]+(:[a-z' -]+)?$/);
        expect(v.e).toBeGreaterThanOrEqual(0);
        expect(v.e).toBeLessThanOrEqual(1);
        expect(v.p).toBeGreaterThanOrEqual(0);
        expect(v.p).toBeLessThanOrEqual(1);
        expect(v.e + v.p).toBeGreaterThan(0);
      }
      for (const v of Object.values(f.sources)) expect(v).toBeGreaterThan(0);
      if (/\bLand\b/.test(c.frontTypeLine)) expect(f.roles).toContain('land');
    }
  });

  it('is wired into fixtureDb()', () => {
    const db = fixtureDb();
    const sol = card('Sol Ring');
    expect(db.features(sol.oracleId)?.roles).toContain('fast-mana');
  });
});

describe('theme axes', () => {
  it('has about 24 static axes with unique ids', () => {
    expect(AXES.length).toBeGreaterThanOrEqual(20);
    expect(AXES.length).toBeLessThanOrEqual(30); // + auras, equipment, defender (quality pass 3)
    expect(new Set(AXES.map((a) => a.id)).size).toBe(AXES.length);
  });

  it('separates enablers from payoffs', () => {
    expect(axis(feat('Anointed Procession'), 'tokens').p).toBeGreaterThanOrEqual(0.5);
    expect(axis(feat("Krenko's Command"), 'tokens').e).toBeGreaterThanOrEqual(0.5);
    expect(axis(feat("Krenko's Command"), 'tokens').p).toBe(0);
    expect(axis(feat('Elvish Archdruid'), 'typal:elf').p).toBeGreaterThanOrEqual(0.5);
    expect(axis(feat('Llanowar Elves'), 'typal:elf').e).toBeGreaterThanOrEqual(0.5);
    expect(axis(feat('Llanowar Elves'), 'typal:elf').p).toBe(0);
    expect(axis(feat('Counterspell'), 'spellslinger').e).toBeGreaterThanOrEqual(0.5);
    expect(axis(feat('Sol Ring'), 'artifacts').e).toBeGreaterThanOrEqual(0.5);
  });
});

describe('commanderThemeWeights', () => {
  const weights = (...names: string[]) => commanderThemeWeights(names.map(card));

  it('reads the commander text', () => {
    const lathril = weights('Lathril, Blade of the Elves');
    expect(lathril['typal:elf']).toBeGreaterThanOrEqual(0.9);
    expect(lathril.tokens).toBeGreaterThanOrEqual(0.5);
    const meren = weights('Meren of Clan Nel Toth');
    expect(meren.sacrifice).toBeGreaterThanOrEqual(0.6);
    expect(meren.graveyard).toBeGreaterThanOrEqual(0.6);
    expect(weights('Talrand, Sky Summoner').spellslinger).toBeGreaterThanOrEqual(0.9);
    expect(weights("Atraxa, Praetors' Voice").counters).toBeGreaterThanOrEqual(0.6);
    expect(weights('Krenko, Mob Boss')['typal:goblin']).toBeGreaterThanOrEqual(0.9);
  });

  it('keeps every weight in [0,1] and does not call every legend a legends deck', () => {
    for (const name of ['Kinnan, Bonder Prodigy', 'Kenrith, the Returned King', 'Kozilek, the Great Distortion', 'The Tenth Doctor']) {
      const w = weights(name);
      for (const v of Object.values(w)) {
        expect(v).toBeGreaterThan(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(w.legends ?? 0).toBeLessThan(0.6);
    }
  });

  it('recognises stax and big-mana commanders and ignores ability words', () => {
    expect(weights('Grand Arbiter Augustin IV').stax).toBe(1);
    expect(weights('Grand Arbiter Augustin IV').spellslinger ?? 0).toBeLessThan(0.6);
    expect(weights('Kinnan, Bonder Prodigy')['big-mana']).toBeGreaterThanOrEqual(0.6);
    expect(weights('Kozilek, the Great Distortion')['big-mana']).toBeGreaterThanOrEqual(0.6);
    // "Doctor's companion" on Rose Tyler is a keyword, not a creature type the text cares about.
    expect(weights('Rose Tyler')['typal:doctor'] ?? 0).toBe(0);
  });

  it('takes the union for two commanders and handles none', () => {
    expect(commanderThemeWeights([])).toEqual({});
    const pair = weights('Thrasios, Triton Hero', 'Tymna the Weaver');
    const tymna = weights('Tymna the Weaver');
    for (const [id, v] of Object.entries(tymna)) expect(pair[id]).toBeGreaterThanOrEqual(v);
  });

  it('blends EDHREC theme counts when given', () => {
    const base = weights('Kenrith, the Returned King');
    const blended = commanderThemeWeights([card('Kenrith, the Returned King')], { Politics: 900, 'Group Hug': 1800, Elves: 450 });
    expect(blended['group-hug']).toBeGreaterThanOrEqual(0.9);
    expect(blended['typal:elf']).toBeGreaterThan(base['typal:elf'] ?? 0);
    for (const v of Object.values(blended)) expect(v).toBeLessThanOrEqual(1);
  });
});
