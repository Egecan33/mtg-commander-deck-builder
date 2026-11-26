import { describe, expect, it } from 'vitest';
import { axisLabel } from '@/engine/features';
import {
  CORE_PACKAGES, FUNCTIONAL_PACKAGES, inPackage, isPackageId, packageDef, packageMembers, tagsOf, themePackage,
} from '@/engine/packages';
import type { PackageId } from '@/engine/packages';
import { bandRoles } from '@/engine/targets';
import type { Deck } from '@/engine/types';
import { card, fixtureDb } from '../helpers/fixture-db';

const db = fixtureDb();
const f = (n: string) => db.features(card(n).oracleId)!;
const t = (n: string) => tagsOf(db, card(n).oracleId);
const def = (id: string) => packageDef(id)!;
const has = (id: string, n: string, bracket = 3) => inPackage(def(id), card(n), f(n), t(n), bracket);
const ALL: PackageId[] = ['ramp', 'draw', 'removal', 'protection', 'fn:win-the-game', 'fn:pillow-fort', 'fn:max-hand-size'];

describe('package catalogue', () => {
  it('holds the four core packages and three functional ones', () => {
    expect(CORE_PACKAGES.map((p) => [p.id, p.name])).toEqual([['ramp', 'Ramp'], ['draw', 'Card draw'], ['removal', 'Removal'], ['protection', 'Protection']]);
    expect(FUNCTIONAL_PACKAGES.map((p) => [p.id, p.name])).toEqual([['fn:win-the-game', 'Win the game'], ['fn:pillow-fort', 'Pillow fort'], ['fn:max-hand-size', 'Max hand size']]);
    expect(def('removal').roles).toEqual(['spot-removal', 'counterspell', 'wipe']);
    expect(def('removal').tags).toEqual(['removal', 'sweeper', 'counterspell']);
    expect(def('fn:pillow-fort').tags).toEqual(['pillowfort', 'tax-attack', 'fog', 'pseudo-fog']);
    expect(def('fn:max-hand-size').tags).toEqual(['hand-size-increase', 'hand-size-matters']);
    expect(def('fn:win-the-game').roles).toEqual(['win-condition']);
  });

  it('membership is a role or a tag', () => {
    expect(has('ramp', 'Sol Ring')).toBe(true);
    for (const n of ['Lightning Bolt', 'Counterspell', 'Wrath of God']) expect(has('removal', n), n).toBe(true);
    for (const n of ['Ghostly Prison', 'Propaganda']) expect(has('fn:pillow-fort', n), n).toBe(true);
    expect(has('protection', 'Lightning Bolt')).toBe(false);
    const viaTag = db.all().find((c) => {
      const feat = db.features(c.oracleId)!;
      return feat.landWeight < 1 && tagsOf(db, c.oracleId).includes('card-advantage') && !feat.roles.includes('draw');
    });
    expect(viaTag).toBeTruthy();
    expect(inPackage(def('draw'), viaTag!, db.features(viaTag!.oracleId)!, tagsOf(db, viaTag!.oracleId), 3)).toBe(true);
  });

  it('a card counts in every package it belongs to', () => {
    const of = (n: string) => ALL.filter((id) => has(id, n));
    expect(of("Kozilek's Command")).toEqual(expect.arrayContaining(['ramp', 'draw', 'removal']));
    expect(of('The One Ring')).toEqual(expect.arrayContaining(['draw', 'protection', 'fn:pillow-fort']));
    expect(of("Jeska's Will")).toEqual(expect.arrayContaining(['ramp', 'draw', 'fn:max-hand-size']));
  });

  it('lands are in no package', () => {
    for (const n of ['Command Tower', 'Bojuka Bog', 'Strip Mine']) for (const id of ALL) expect(has(id, n), `${n} ${id}`).toBe(false);
    expect(f('Sea Gate Restoration').landWeight).toBeLessThan(1);
    expect(has('fn:max-hand-size', 'Sea Gate Restoration')).toBe(true);
  });

  it('packages hold every card the rating counts for their roles', () => {
    for (const bracket of [3, 5]) {
      for (const c of db.all()) {
        const feat = db.features(c.oracleId)!;
        if (feat.landWeight >= 1) continue;
        const roles = bandRoles(c, feat, bracket);
        const tags = tagsOf(db, c.oracleId);
        const inP = (id: string) => inPackage(def(id), c, feat, tags, bracket);
        if (roles.includes('ramp')) expect(inP('ramp'), c.name).toBe(true);
        if (roles.includes('draw')) expect(inP('draw'), c.name).toBe(true);
        if (roles.some((r) => r === 'spot-removal' || r === 'counterspell' || r === 'wipe')) expect(inP('removal'), c.name).toBe(true);
        if (roles.includes('protection')) expect(inP('protection'), c.name).toBe(true);
      }
    }
  });

  it('theme packages follow axis membership', () => {
    expect(themePackage('tokens').name).toBe(axisLabel('tokens'));
    expect(inPackage(themePackage('tokens'), card("Krenko's Command"), f("Krenko's Command"), t("Krenko's Command"), 3)).toBe(true);
    expect(inPackage(themePackage('typal:elf'), card('Elvish Archdruid'), f('Elvish Archdruid'), t('Elvish Archdruid'), 3)).toBe(true);
  });

  it('package ids parse', () => {
    for (const ok of ['ramp', 'theme:tokens', 'theme:typal:elf', 'fn:pillow-fort']) expect(isPackageId(ok), ok).toBe(true);
    for (const bad of ['fn:nope', 'theme:', 'theme:typal', 'theme:not-an-axis', 'land', 42]) expect(isPackageId(bad), String(bad)).toBe(false);
  });

  it('a database without tags falls back to roles', () => {
    const bare = { ...db, tagSlugs: undefined };
    expect(tagsOf(bare, card('Ghostly Prison').oracleId)).toEqual([]);
    expect(inPackage(def('fn:pillow-fort'), card('Ghostly Prison'), f('Ghostly Prison'), tagsOf(bare, card('Ghostly Prison').oracleId), 3)).toBe(false);
  });

  it('members count quantities and commanders, not the companion', () => {
    const deck: Deck = {
      id: null, name: 't', commanders: [card('Kinnan, Bonder Prodigy').oracleId], companion: card('Lutri, the Spellchaser').oracleId, chosenColor: null,
      main: [{ oracleId: card('Llanowar Elves').oracleId, qty: 1, locked: false }, { oracleId: card('Forest').oracleId, qty: 30, locked: false }],
      targetBracket: 3, themeWeights: null,
    };
    const m = packageMembers(deck, db, def('ramp'));
    expect(m.ids.sort()).toEqual([card('Kinnan, Bonder Prodigy').oracleId, card('Llanowar Elves').oracleId].sort());
    expect(m.count).toBe(2);
  });
});
