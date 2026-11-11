import { describe, expect, it } from 'vitest';
import { parseCollection, parsePrintCode } from '@/engine/text';
import { card, fixtureDb } from '../helpers/fixture-db';

describe('parsePrintCode', () => {
  it('reads the code at the bottom of a card in the ways people type it', () => {
    const tdm = { qty: 1, set: 'tdm', number: '123' };
    for (const text of ['TDM 123', 'tdm-123', '123 TDM', '123/281 TDM', '0123 tdm', 'R 0123 TDM • EN', 'tdm 123 F', 'TDM 123 foil jp']) {
      expect(parsePrintCode(text), text).toEqual(tdm);
    }
    expect(parsePrintCode('3 tdm 123')).toEqual({ qty: 3, set: 'tdm', number: '123' });
    expect(parsePrintCode('3x TDM 045')).toEqual({ qty: 3, set: 'tdm', number: '45' });
    expect(parsePrintCode('m21 123a')).toEqual({ qty: 1, set: 'm21', number: '123a' });
    expect(parsePrintCode('40k 7')).toEqual({ qty: 1, set: '40k', number: '7' });
    expect(parsePrintCode('plst 45★')).toEqual({ qty: 1, set: 'plst', number: '45★' });
  });

  it('leaves card names alone', () => {
    for (const text of ['Sol Ring', '2 Sol Ring', 'Fire // Ice', 'Borrowing 100,000 Arrows', 'tdm', '123', 'Seven Dwarves 2 extra words here']) {
      expect(parsePrintCode(text), text).toBeNull();
    }
  });

  it('a collection list may mix names and codes', () => {
    const db = fixtureDb();
    const sol = card('Sol Ring').oracleId;
    const find = (set: string, n: string) => (set === 'tdm' && n === '123' ? sol : undefined);
    const r = parseCollection('2 Counterspell\n3 tdm 123\nTDM 0123\nxyz 999', db, find);
    expect(r.owned).toEqual([{ oracleId: card('Counterspell').oracleId, qty: 2 }, { oracleId: sol, qty: 4 }]);
    expect(r.unresolved).toEqual([{ line: 4, text: 'xyz 999' }]);
  });
});
