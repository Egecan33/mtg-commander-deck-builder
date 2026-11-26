import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { arenaRarityOf, arenaSetCode, createArenaIndex } from '@/ingest/arena-cards';
import { toCard } from '@/ingest/cards';
import { fetchBulk } from '@/ingest/http';

/* Scryfall objects are external JSON shapes. */
/* eslint-disable @typescript-eslint/no-explicit-any */

const oracle = (extra: Record<string, unknown> = {}): any => ({
  object: 'card', oracle_id: 'o-1', id: 's-1', name: 'Infernal Grasp', layout: 'normal', mana_cost: '{1}{B}', cmc: 2,
  type_line: 'Instant', oracle_text: 'Destroy target creature. You lose 2 life.', colors: ['B'], color_identity: ['B'],
  keywords: [], legalities: { commander: 'legal', brawl: 'legal' }, ...extra,
});

const printing = (set: string, number: string, rarity: string, games: string[], released: string, extra: Record<string, unknown> = {}): any => ({
  oracle_id: 'o-1', set, collector_number: number, rarity, games, released_at: released, ...extra,
});

describe('toCard Brawl legality', () => {
  it('reads legalities.brawl; anything but legal or banned is not_legal', () => {
    expect(toCard(oracle())?.brawlLegality).toBe('legal');
    expect(toCard(oracle({ legalities: { commander: 'legal', brawl: 'banned' } }))?.brawlLegality).toBe('banned');
    expect(toCard(oracle({ legalities: { commander: 'legal', brawl: 'not_legal' } }))?.brawlLegality).toBe('not_legal');
    expect(toCard(oracle({ legalities: { commander: 'banned' } }))?.brawlLegality).toBe('not_legal');
  });

  it('starts with no Arena data until the default-cards pass fills it', () => {
    const c = toCard(oracle());
    expect(c?.arenaRarity).toBeNull();
    expect(c?.arenaPrinting).toBeNull();
  });
});

describe('Arena rarity and printing', () => {
  it('maps Scryfall rarities, special and bonus as mythic', () => {
    expect(arenaRarityOf('common')).toBe('common');
    expect(arenaRarityOf('uncommon')).toBe('uncommon');
    expect(arenaRarityOf('rare')).toBe('rare');
    expect(arenaRarityOf('mythic')).toBe('mythic');
    expect(arenaRarityOf('special')).toBe('mythic');
    expect(arenaRarityOf('bonus')).toBe('mythic');
    expect(arenaRarityOf(undefined)).toBeNull();
  });

  it('writes Arena set codes upper-case, Dominaria as DAR', () => {
    expect(arenaSetCode('mid')).toBe('MID');
    expect(arenaSetCode('dom')).toBe('DAR');
  });

  it('takes the lowest rarity among printings on Arena (Infernal Grasp: MID uncommon, MAR mythic)', () => {
    const index = createArenaIndex();
    index.add(printing('mar', '27', 'mythic', ['arena'], '2023-07-01'));
    index.add(printing('mid', '107', 'uncommon', ['paper', 'mtgo', 'arena'], '2021-09-24'));
    index.add(printing('2x2', '81', 'common', ['paper'], '2022-07-08')); // paper only: not counted
    expect(index.get('o-1')).toEqual({ rarity: 'uncommon', printing: { set: 'MID', number: '107' } });
  });

  it('gives null to a card with no Arena printing', () => {
    const index = createArenaIndex();
    index.add(printing('lea', '270', 'uncommon', ['paper'], '1993-08-05'));
    expect(index.get('o-1')).toBeNull();
    expect(index.get('unknown')).toBeNull();
  });

  it('picks the newest printing among those at the lowest rarity', () => {
    const index = createArenaIndex();
    index.add(printing('m21', '100', 'rare', ['paper', 'arena'], '2020-07-03'));
    index.add(printing('fdn', '200', 'rare', ['paper', 'arena'], '2024-11-15'));
    index.add(printing('m20', '50', 'rare', ['paper', 'arena'], '2019-07-12'));
    expect(index.get('o-1')?.printing).toEqual({ set: 'FDN', number: '200' });
  });

  it('counts an Arena-only printing with special rarity as mythic, below which a real rarity wins', () => {
    const index = createArenaIndex();
    index.add(printing('sta', '10', 'special', ['arena'], '2021-04-23'));
    expect(index.get('o-1')?.rarity).toBe('mythic');
    index.add(printing('stx', '60', 'rare', ['paper', 'arena'], '2021-04-23'));
    expect(index.get('o-1')).toEqual({ rarity: 'rare', printing: { set: 'STX', number: '60' } });
  });

  it('reads a reversible card by its first face oracle id', () => {
    const index = createArenaIndex();
    index.add({ set: 'one', collector_number: '9', rarity: 'rare', games: ['arena'], released_at: '2023-02-03', card_faces: [{ oracle_id: 'o-rev' }, { oracle_id: 'o-rev' }] });
    expect(index.get('o-rev')?.rarity).toBe('rare');
  });
});

describe('fetchBulk', () => {
  it('downloads a bulk file once per Scryfall update', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'cf-bulk-'));
    const file = path.join(dir, 'default-cards.jsonl.gz');
    let updated = '2026-11-26T09:00:00Z';
    let downloads = 0;
    const fetchImpl = (async (url: string) => {
      if (url.endsWith('/bulk-data')) {
        return new Response(JSON.stringify({ data: [{ type: 'default_cards', download_uri: 'https://x.test/default.json', updated_at: updated }] }));
      }
      downloads++;
      return new Response('{"a":1}\n');
    }) as unknown as typeof fetch;
    const log = () => undefined;
    expect(await fetchBulk('default_cards', file, log, { fetchImpl })).toBe(updated);
    expect(await fetchBulk('default_cards', file, log, { fetchImpl })).toBe(updated);
    expect(downloads).toBe(1);
    updated = '2026-11-27T09:00:00Z';
    await fetchBulk('default_cards', file, log, { fetchImpl });
    expect(downloads).toBe(2);
    expect(readFileSync(file, 'utf8')).toBe('{"a":1}\n');
  });
});
