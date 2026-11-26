import { describe, expect, it } from 'vitest';
import { commanderHref, safeDecode } from '@/app/lib/links';

const a = { frontName: 'Krenko, Mob Boss', slug: 'krenko-mob-boss' };
const b = { frontName: 'Tymna the Weaver' };

describe('commanderHref', () => {
  it('links one commander, a pair, and carries the chosen colour', () => {
    expect(commanderHref(a)).toBe('/commander/krenko-mob-boss');
    expect(commanderHref(a, b)).toBe('/commander/krenko-mob-boss?with=tymna-the-weaver');
    expect(commanderHref(a, undefined, 'G')).toBe('/commander/krenko-mob-boss?color=G');
    expect(commanderHref(a, b, 'G')).toBe('/commander/krenko-mob-boss?with=tymna-the-weaver&color=G');
    expect(commanderHref(a, b, null)).toBe('/commander/krenko-mob-boss?with=tymna-the-weaver');
  });
  it('uses the server slug over the name slug', () => {
    expect(commanderHref({ frontName: 'Foo Bar', slug: 'foo-bar-bbbbbbbb' })).toBe('/commander/foo-bar-bbbbbbbb');
  });
});

describe('safeDecode', () => {
  it('decodes, and does not throw on a bad percent sequence', () => {
    expect(safeDecode('a%20b')).toBe('a b');
    expect(safeDecode('100%')).toBe('100%');
  });
});
