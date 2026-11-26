import { describe, expect, it } from 'vitest';
import { editDistance, matchScore, normalizeText, prepareFields, queryWords, searchItems } from '@/engine/text/search';

const score = (query: string, ...fields: string[]): number => matchScore(queryWords(query), prepareFields(fields), { typo: true });
const exactScore = (query: string, ...fields: string[]): number => matchScore(queryWords(query), prepareFields(fields));

describe('normalizeText', () => {
  it('folds diacritics, case and punctuation', () => {
    expect(normalizeText("Thassa's Oracle")).toBe('thassa s oracle');
    expect(normalizeText('Lim-Dûl the Necromancer')).toBe('lim dul the necromancer');
    expect(normalizeText('Fire // Ice: a.b, c/d')).toBe('fire ice a b c d');
  });
});

describe('queryWords', () => {
  it('drops "the", "of" and "a" when other words exist', () => {
    expect(queryWords('The Lord of the Rings')).toEqual(['lord', 'rings']);
    expect(queryWords('the')).toEqual(['the']);
  });
});

describe('editDistance', () => {
  it('counts swaps, inserts and substitutions', () => {
    expect(editDistance('begginer', 'beginner', 2)).toBe(2);
    expect(editDistance('teh', 'the', 2)).toBe(1);
    expect(editDistance('abcdef', 'uvwxyz', 2)).toBe(3);
  });
});

describe('matchScore', () => {
  it('finds typos', () => {
    expect(score('begginer', 'Beginner Box - Aang Tutorial')).toBeGreaterThan(0);
    expect(exactScore('begginer', 'Beginner Box - Aang Tutorial')).toBe(0);
  });
  it('matches a product through its set name, in any word order', () => {
    const fields = ['Beginner Box - Zuko Tutorial', 'Avatar: The Last Airbender', 'TLA', 'Box Set'];
    expect(score('avatar beginner box', ...fields)).toBeGreaterThan(0);
    expect(score('box beginner avatar', ...fields)).toBeGreaterThan(0);
    expect(score('avatar begginer box', ...fields)).toBeGreaterThan(0);
  });
  it('ignores word order and punctuation in names', () => {
    expect(score('mob boss krenko', 'Krenko, Mob Boss')).toBeGreaterThan(0);
    expect(score('thassas oracle', "Thassa's Oracle")).toBeGreaterThan(0);
    expect(score('lim dul', 'Lim-Dûl the Necromancer')).toBeGreaterThan(0);
    expect(exactScore('lim dul', 'Lim-Dûl')).toBeGreaterThan(0);
  });
  it('matches nothing for a nonsense word', () => {
    expect(score('qzxjvw', 'Krenko, Mob Boss', 'Legendary Creature')).toBe(0);
    expect(score('krenko qzxjvw', 'Krenko, Mob Boss')).toBe(0);
  });
  it('substring needs 3 letters, shorter words only match as prefixes', () => {
    expect(exactScore('ren', 'Krenko')).toBeGreaterThan(0);
    expect(exactScore('re', 'Krenko')).toBe(0);
    expect(exactScore('kr', 'Krenko')).toBeGreaterThan(0);
  });
  it('allows one typo in 4-7 letters and two in 8+, none below 4', () => {
    expect(score('krenco', 'Krenko')).toBeGreaterThan(0);
    expect(score('krnko', 'Krenko')).toBeGreaterThan(0);
    expect(score('krnco', 'Krenko')).toBe(0);
    expect(score('beginnnnner', 'Beginner')).toBe(0);
    expect(score('beginnnner', 'Beginner')).toBeGreaterThan(0);
    expect(score('sol', 'Sal')).toBe(0);
  });
  it('ranks exact above prefix above substring above typo, and the first field above the rest', () => {
    const q = queryWords('bolt');
    const s = (...f: string[]) => matchScore(q, prepareFields(f), { typo: true });
    expect(s('Bolt')).toBeGreaterThan(s('Bolter'));
    expect(s('Bolter')).toBeGreaterThan(s('Firebolt'));
    expect(s('Firebolt')).toBeGreaterThan(s('Bolr'));
    expect(s('Other', 'Bolt')).toBeLessThan(s('Firebolt', 'x'));
  });
  it('can limit typos to the first fields', () => {
    const rec = prepareFields(['Sol Ring', 'Artifact', 'Add two colorless mana']);
    expect(matchScore(queryWords('colorles'), rec, { typo: true, typoFields: 2 })).toBeGreaterThan(0); // prefix, no typo needed
    expect(matchScore(queryWords('colourless'), rec, { typo: true, typoFields: 2 })).toBe(0);
    expect(matchScore(queryWords('colourless'), rec, { typo: true })).toBeGreaterThan(0);
  });
  it('only matches whole words in an exact field', () => {
    const rec = prepareFields(['Landing Party', { text: 'TRC', exact: true }]);
    expect(matchScore(queryWords('trc'), rec)).toBeGreaterThan(0);
    expect(matchScore(queryWords('tr'), rec)).toBe(0);
  });
});

describe('searchItems', () => {
  const names = ['Krenko, Mob Boss', 'Krenko, Tin Street Kingpin', "Thassa's Oracle", 'Beginner Box'];
  const prep = (n: string) => prepareFields([n]);
  it('returns everything for an empty query', () => {
    expect(searchItems(names, '  ', prep)).toEqual(names);
  });
  it('tries typos only when few items match', () => {
    expect(searchItems(names, 'krenco', prep)).toEqual(names.slice(0, 2));
    expect(searchItems(names, 'begginer', prep)).toEqual(['Beginner Box']);
  });
  it('keeps typo matches after real ones', () => {
    expect(searchItems(['Bolr', 'Bolt'], 'bolt', prep)).toEqual(['Bolt', 'Bolr']);
  });
});
