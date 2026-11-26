import { describe, expect, it } from 'vitest';
import { readPrinting } from '@/ingest/printings';

const raw = { oracle_id: 'o1', set: 'TDM', collector_number: '12', set_name: 'Tarkir: Dragonstorm', set_type: 'expansion', released_at: '2025-04-11', games: ['paper', 'mtgo'] };

describe('readPrinting', () => {
  it('keeps paper printings and their sets', () => {
    expect(readPrinting(raw)).toEqual({
      row: ['tdm', '12', 'o1'],
      set: { code: 'tdm', name: 'Tarkir: Dragonstorm', type: 'expansion', releasedAt: '2025-04-11' },
    });
  });
  it('drops digital and non-paper printings', () => {
    expect(readPrinting({ ...raw, digital: true })).toBeNull();
    expect(readPrinting({ ...raw, games: ['arena'] })).toBeNull();
  });
  it('keeps the printing without a set when the set data is missing', () => {
    expect(readPrinting({ ...raw, set_type: undefined })?.set).toBeNull();
  });
});
