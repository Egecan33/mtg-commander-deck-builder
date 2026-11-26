import { describe, expect, it } from 'vitest';
import { AXES } from '@/engine/features/axes';
import { axisFromSlug, axisSlug, cardSlug, fullSlug } from '@/engine/text/slug';
import { edhrecSlug } from '@/server/edhrec';
import { card, fixtureDb } from '../helpers/fixture-db';

describe('cardSlug follows EDHREC\'s URL form', () => {
  it('handles punctuation, faces and diacritics', () => {
    expect(cardSlug({ frontName: "Atraxa, Praetors' Voice" })).toBe('atraxa-praetors-voice');
    expect(cardSlug({ frontName: 'Minsc & Boo, Timeless Heroes' })).toBe('minsc-boo-timeless-heroes');
    expect(cardSlug({ frontName: 'Tergrid, God of Fright' })).toBe('tergrid-god-of-fright');
    expect(fullSlug({ name: "Tergrid, God of Fright // Tergrid's Lantern" })).toBe('tergrid-god-of-fright-tergrids-lantern');
    expect(cardSlug({ frontName: 'Mr. Spock, Science Officer' })).toBe('mr-spock-science-officer');
    expect(cardSlug({ frontName: 'Éowyn, Fearless Knight' })).toBe('eowyn-fearless-knight');
  });
  it('is the slug edhrec uses', () => {
    for (const c of fixtureDb().all().slice(0, 200)) expect(edhrecSlug(c)).toBe(cardSlug(c));
    expect(edhrecSlug(card('Krenko, Mob Boss'))).toBe('krenko-mob-boss');
  });
});

describe('axis slugs', () => {
  it('round-trip', () => {
    for (const a of [...AXES.map((x) => x.id), 'typal:elf', 'typal:time lord']) expect(axisFromSlug(axisSlug(a))).toBe(a);
    expect(axisSlug('typal:elf')).toBe('typal-elf');
    expect(axisSlug('group-hug')).toBe('group-hug');
  });
});
