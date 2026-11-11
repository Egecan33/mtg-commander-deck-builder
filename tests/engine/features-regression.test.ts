import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { commanderThemeWeights, computeFeatures } from '@/engine/features';
import type { Card, CardFeatures } from '@/engine/types';

/**
 * Regressions found by reviewing the classifier against the whole synced pool. The cards and their
 * Tagger slugs in tests/fixtures/features-regression.json are real data copied from the database.
 */
const data = JSON.parse(
  readFileSync(fileURLToPath(new URL('../fixtures/features-regression.json', import.meta.url)), 'utf8'),
) as { cards: Card[]; tags: Record<string, string[]> };
const byName = new Map(data.cards.map((c) => [c.frontName, c]));

function real(name: string): Card {
  const c = byName.get(name);
  if (!c) throw new Error(`regression fixture lacks ${name}`);
  return c;
}
const feat = (name: string): CardFeatures => computeFeatures(real(name), data.tags[real(name).oracleId] ?? []);
const roles = (name: string) => feat(name).roles;
const axis = (name: string, id: string) => feat(name).axes[id] ?? { e: 0, p: 0 };
const weights = (name: string) => commanderThemeWeights([real(name)]);

describe('double-faced cards', () => {
  it('gives no land weight to the land on the back of a transforming card', () => {
    for (const name of ['Path of Mettle', 'Growing Rites of Itlimoc']) {
      const f = feat(name);
      expect(f.landWeight, name).toBe(0);
      expect(f.sources, name).toEqual({});
      expect(f.roles, name).not.toContain('land');
      expect(f.roles, name).not.toContain('ramp');
    }
  });

  it('does not call an MDFC spell ramp because its back is a land', () => {
    const witch = feat('Witch Enchanter');
    expect(witch.landWeight).toBe(0.74);
    expect(witch.sources).toEqual({ W: 1 });
    expect(witch.roles).not.toContain('ramp');
    expect(roles('Boggart Trawler')).not.toContain('ramp');
    expect(feat('Malakir Rebirth').landWeight).toBe(0.38);
  });
});

describe('role regressions', () => {
  it('ramp: granted mana abilities, two-sentence land search, land untappers', () => {
    for (const name of ['Cryptolith Rite', 'Jaheira, Friend of the Forest', 'Sword of Hearth and Home', 'Earthcraft']) {
      expect(roles(name), name).toContain('ramp');
    }
  });

  it('ramp: standing cost reducers', () => {
    for (const name of ['Jet Medallion', 'Grand Arbiter Augustin IV']) expect(roles(name), name).toContain('ramp');
  });

  it('fast mana: only guaranteed mana counts for a ritual', () => {
    expect(roles('Rite of Flame')).toContain('fast-mana');
    expect(roles('Battle Hymn')).not.toContain('fast-mana');
    expect(roles('Songs of the Damned')).not.toContain('fast-mana');
    expect(feat('Battle Hymn').powerTier).toBeLessThan(5);
  });

  it('draw: card advantage that never says "draw"', () => {
    for (const name of ['Fact or Fiction', 'Dig Through Time', 'Ad Nauseam', 'Tireless Tracker', 'Mystic Forge', "Bolas's Citadel"]) {
      expect(roles(name), name).toContain('draw');
    }
  });

  it('draw: card-neutral rummaging and recursion to hand are not card advantage', () => {
    for (const name of ['Cathartic Reunion', 'Thrill of Possibility', 'Faithless Looting', 'Meren of Clan Nel Toth']) {
      expect(roles(name), name).not.toContain('draw');
    }
  });

  it('tutor: transmute, searchless tutors and any-land tutors; not basic-land fetchers', () => {
    for (const name of ['Muddle the Mixture', 'Demonic Consultation', 'Tainted Pact', 'Crop Rotation', 'Sylvan Scrying']) {
      expect(roles(name), name).toContain('tutor');
    }
    expect(roles('Evolving Wilds')).not.toContain('tutor');
    expect(roles('Rampant Growth')).not.toContain('tutor');
  });

  it('spot removal: a wipe with a targeted mode is both, channel lands count', () => {
    for (const name of ['Cyclonic Rift', 'Vandalblast']) {
      expect(roles(name), name).toEqual(expect.arrayContaining(['spot-removal', 'wipe']));
    }
    expect(roles('Wrath of God')).toContain('wipe');
    expect(roles('Wrath of God')).not.toContain('spot-removal');
    for (const name of ['Boseiju, Who Endures', 'Otawara, Soaring City', 'Tragic Slip', "Council's Judgment", 'Oubliette']) {
      expect(roles(name), name).toContain('spot-removal');
    }
    expect(roles('Boseiju, Who Endures')).toContain('land');
    expect(roles('Sink into Stupor')).toContain('spot-removal'); // bounces "target spell or nonland permanent"
  });

  it('counterspell: exiling a spell counts', () => {
    expect(roles('Mindbreak Trap')).toContain('counterspell');
  });

  it('protection: phasing your own creature, cheat-death and redirection; not removal by phasing or theft', () => {
    for (const name of ['Slip Out the Back', "Kaya's Ghostform", 'Malakir Rebirth', 'Spellskite']) {
      expect(roles(name), name).toContain('protection');
    }
    expect(roles('Oubliette')).not.toContain('protection');
    expect(roles('Abduction')).not.toContain('protection');
  });

  it('recursion: making a graveyard card castable', () => {
    expect(roles('Snapcaster Mage')).toContain('recursion');
    expect(roles('Mission Briefing')).toContain('recursion');
  });

  it('win condition: a planeswalker static line counts, an ultimate does not', () => {
    expect(roles('Jace, Wielder of Mysteries')).toContain('win-condition');
    expect(roles('Garruk, Cursed Huntsman')).not.toContain('win-condition');
  });

  it('stax: lock pieces with an escape clause, cast bans, planeswalker statics, upkeep taxes', () => {
    for (const name of ['Leonin Arbiter', 'Gaddock Teeg', 'Narset, Parter of Veils', 'Teferi, Time Raveler', 'Karn, the Great Creator', "Kataki, War's Wage", 'Meekstone']) {
      expect(roles(name), name).toContain('stax');
    }
    expect(roles('Rhystic Study')).not.toContain('stax');
    expect(roles('Grand Abolisher')).not.toContain('stax');
  });

  it('power tier 5 for free interaction that is played, not for uncastable or unplayed cards', () => {
    for (const name of ['Force of Will', 'Mental Misstep', 'Mindbreak Trap', 'Solitude']) expect(feat(name).powerTier, name).toBe(5);
    expect(feat('Living End').powerTier).toBeLessThan(5); // no mana cost: cannot be cast from hand
    expect(feat('Mogg Salvage').powerTier).toBeLessThan(5);
  });

  it('pips: hybrid halves round down, Phyrexian mana asks for nothing', () => {
    expect(feat('Boros Reckoner').pips).toEqual({ W: 1, R: 1 });
    expect(feat('Kitchen Finks').pips).toEqual({ W: 1, G: 1 });
    expect(feat('Dismember').pips).toEqual({});
  });
});

describe('axis regressions', () => {
  it('reads "this creature" wording on aristocrat payoffs', () => {
    for (const name of ['Blood Artist', 'Zulaport Cutthroat', 'Cruel Celebrant']) {
      expect(axis(name, 'sacrifice').p, name).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('does not read restricted mana as a big-mana payoff', () => {
    expect(axis('Cavern of Souls', 'big-mana').p).toBe(0);
    expect(weights('Giada, Font of Hope')['big-mana']).toBeUndefined();
    expect(weights('Giada, Font of Hope').counters).toBeGreaterThanOrEqual(0.6);
  });

  it('finds typical payoffs and enablers on the right axis', () => {
    const payoffs: [string, string][] = [
      ['Steel Overseer', 'artifacts'], ['Chief of the Foundry', 'artifacts'], ['Wonder', 'graveyard'],
      ['The Gitrog Monster', 'landfall'], ['Sun Titan', 'blink'], ['Risen Reef', 'blink'],
      ['Impact Tremors', 'tokens'], ["Cathars' Crusade", 'tokens'],
    ];
    for (const [name, id] of payoffs) expect(axis(name, id).p, `${name} ${id}`).toBeGreaterThanOrEqual(0.5);
    const enablers: [string, string][] = [
      ['Faithless Looting', 'graveyard'], ['Careful Study', 'graveyard'], ['Whispersilk Cloak', 'voltron'],
      ['Eldrazi Conscription', 'voltron'], ['Maskwood Nexus', 'typal'], ['Enlightened Tutor', 'enchantments'],
      ['Enlightened Tutor', 'artifacts'],
    ];
    for (const [name, id] of enablers) expect(axis(name, id).e, `${name} ${id}`).toBeGreaterThanOrEqual(0.5);
  });
});

describe('tokens and lands made for an opponent', () => {
  it('are not token, typal or lands-matter enablers for you', () => {
    for (const name of ['Beast Within', 'Forbidden Orchard', 'Hunted Horror']) expect(axis(name, 'tokens').e, name).toBe(0);
    expect(axis('Beast Within', 'typal:beast').e).toBe(0);
    expect(axis('Path to Exile', 'landfall').e).toBe(0);
    expect(axis("Krenko's Command", 'tokens').e).toBeGreaterThanOrEqual(0.5);
    expect(axis("Krenko's Command", 'typal:goblin').e).toBeGreaterThanOrEqual(0.5);
    expect(axis('Bitterblossom', 'tokens').e).toBe(1);
  });
});

describe('commander theme regressions', () => {
  it('weights the archetype each commander is built around', () => {
    expect(weights('Breya, Etherium Shaper').artifacts).toBeGreaterThanOrEqual(0.9);
    expect(weights('Kess, Dissident Mage').spellslinger).toBeGreaterThanOrEqual(0.9);
    expect(weights('Niv-Mizzet, Parun').spellslinger).toBeGreaterThanOrEqual(0.9);
    expect(weights('Niv-Mizzet, Parun').wheels).toBeGreaterThanOrEqual(0.9);
    expect(weights('The Mimeoplasm').graveyard).toBeGreaterThanOrEqual(0.6);
    expect(weights('Marchesa, the Black Rose').sacrifice).toBeGreaterThanOrEqual(0.9);
    expect(weights('Jhoira, Weatherlight Captain').artifacts).toBeGreaterThanOrEqual(0.6);
    expect(weights('Zur the Enchanter').enchantments).toBeGreaterThanOrEqual(0.8);
  });
});
