import { describe, expect, it } from 'vitest';
import { comboBracket, comboResult, comboResults, spellbookUrl } from '@/app/lib/combo-text';

describe('combo text', () => {
  it('turns known results into plain English', () => {
    expect(comboResult('Each opponent loses the game')).toBe('Win the game');
    expect(comboResult('Infinite colored mana')).toBe('Infinite mana');
    expect(comboResult('Near-infinite colored mana')).toBe('Near-infinite mana');
    expect(comboResult('Infinite creature ETB')).toBe('Infinite creature enter-the-battlefield triggers');
    expect(comboResult('Infinite creature LTB')).toBe('Infinite creature leave-the-battlefield triggers');
    expect(comboResult('Lock')).toBe('Lock opponents out');
  });

  it('leaves unknown results as they are', () => {
    expect(comboResult('Infinite lifegain')).toBe('Infinite lifegain');
    expect(comboResult('Something new')).toBe('Something new');
  });

  it('lists the first three results', () => {
    expect(comboResults(['Infinite colored mana', 'Infinite lifegain', 'Lock', 'Infinite turns'])).toBe('Infinite mana, Infinite lifegain, Lock opponents out');
    expect(comboResults([])).toBe('Combo');
  });

  it('gives the bracket a combo implies like the bracket report does', () => {
    expect(comboBracket({ twoCard: true, early: true, relevant: true })).toBe(4);
    expect(comboBracket({ twoCard: true, early: false, relevant: true })).toBe(3);
    expect(comboBracket({ twoCard: false, early: true, relevant: true })).toBeNull();
    expect(comboBracket({ twoCard: true, early: true, relevant: false })).toBeNull();
  });

  it('links to the combo page', () => {
    expect(spellbookUrl('1050-7299')).toBe('https://commanderspellbook.com/combo/1050-7299/');
  });
});
