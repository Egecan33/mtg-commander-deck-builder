import { describe, expect, it } from 'vitest';
import { parseDecklist } from '@/engine/text';
import { card, standardBrawlFixtureDb } from '../helpers/fixture-db';
import { redDeck } from '../helpers/standard-brawl';

const db = standardBrawlFixtureDb();
const krenko = card('Krenko, Mob Boss');
const deck = redDeck(db);
const mainLines = deck.main.map((e) => `${e.qty} ${db.get(e.oracleId)!.name}`);

describe('parseDecklist with a 60-card size', () => {
  it('finds the commander of an MTGO-style 59 + 1 export under Sideboard', () => {
    const p = parseDecklist([...mainLines, '', 'Sideboard', `1 ${krenko.name}`].join('\n'), db, { size: 60 });
    expect(p.commanders).toEqual([krenko.oracleId]);
    expect(p.ignored).toEqual([]);
  });

  it('finds the commander of a bare 60-card list without headers (set apart in a last block)', () => {
    const p = parseDecklist([...mainLines, '', `1 ${krenko.name}`].join('\n'), db, { size: 60 });
    expect(p.commanders).toEqual([krenko.oracleId]);
    expect(p.main.reduce((n, e) => n + e.qty, 0)).toBe(59);
  });

  it('keeps the 100-card default: a 60-card list gets no guessed commander', () => {
    const p = parseDecklist([...mainLines, '', 'Sideboard', `1 ${krenko.name}`].join('\n'), db);
    expect(p.commanders).toEqual([]);
  });
});
