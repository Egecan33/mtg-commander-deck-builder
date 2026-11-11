import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { streamVariants, toCombo } from '@/ingest/combos';
import { downloadToFile, httpGet, readJsonLines, USER_AGENT } from '@/ingest/http';
import { isWebp, syncImages } from '@/ingest/images';
import { parseArgs } from '@/ingest/sync';
import { rollUpTags } from '@/ingest/tags';
import { loadCardDb, invalidateCardDb } from '@/server/carddb';
import { openDb } from '@/server/db';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'cf-ingest-'));
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBP'), Buffer.from('VP8 ')]);

describe('http', () => {
  it('sends the required headers and retries after a 429', async () => {
    const seen: Record<string, string>[] = [];
    let calls = 0;
    const fetchImpl = (async (_url: string, init: { headers: Record<string, string> }) => {
      seen.push(init.headers);
      return ++calls === 1 ? new Response('slow down', { status: 429 }) : new Response('ok');
    }) as unknown as typeof fetch;
    const res = await httpGet('https://api.scryfall.com/bulk-data', { fetchImpl, retryWaitMs: 1 });
    expect(res.status).toBe(200);
    expect(calls).toBe(2);
    expect(seen[0]).toEqual({ 'User-Agent': USER_AGENT, Accept: '*/*' });
    expect(USER_AGENT).toBe('CommanderForge/0.1');
  });

  it('downloads through a .part file and fails on a non-200', async () => {
    const dir = tmp();
    const ok = (async () => new Response('hello')) as unknown as typeof fetch;
    expect(await downloadToFile('https://x.test/a', path.join(dir, 'a.txt'), { fetchImpl: ok })).toBe(5);
    expect(readFileSync(path.join(dir, 'a.txt'), 'utf8')).toBe('hello');
    const missing = (async () => new Response('no', { status: 404 })) as unknown as typeof fetch;
    await expect(downloadToFile('https://x.test/b', path.join(dir, 'b.txt'), { fetchImpl: missing })).rejects.toThrow('HTTP 404');
  });

  it('reads JSON lines from gzipped and plain files', async () => {
    const dir = tmp();
    const text = '{"a":1}\n\n{"a":2}\n';
    writeFileSync(path.join(dir, 'x.jsonl.gz'), gzipSync(text));
    writeFileSync(path.join(dir, 'x.jsonl'), text);
    for (const f of ['x.jsonl.gz', 'x.jsonl']) {
      const rows: unknown[] = [];
      for await (const row of readJsonLines(path.join(dir, f))) rows.push(row);
      expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
    }
  });
});

describe('rollUpTags', () => {
  it('rolls taggings up through child_ids and survives cycles and dangling ids', () => {
    const rolled = rollUpTags([
      { id: 'removal', slug: 'removal', label: 'Removal', child_ids: ['spot', 'sweeper', 'gone'] },
      { id: 'spot', slug: 'spot-removal', label: 'Spot', taggings: [{ oracle_id: 'a' }], child_ids: ['removal'] },
      { id: 'sweeper', slug: 'sweeper', label: 'Sweeper', taggings: [{ oracle_id: 'b' }], child_ids: ['one-sided'] },
      { id: 'one-sided', slug: 'sweeper-one-sided', label: 'One-sided', taggings: [{ oracle_id: 'c' }, { oracle_id: 'b' }] },
    ]);
    expect([...rolled.get('removal')!].sort()).toEqual(['a', 'b', 'c']);
    expect([...rolled.get('sweeper')!].sort()).toEqual(['b', 'c']);
    expect([...rolled.get('spot')!].sort()).toEqual(['a', 'b', 'c']); // the cycle makes them equal
    expect([...rolled.get('one-sided')!].sort()).toEqual(['b', 'c']);
  });
});

const variant = (over: Record<string, unknown> = {}) => ({
  id: '1-2--3', status: 'OK', bracketTag: 'R', manaValueNeeded: 4, popularity: 1234,
  legalities: { commander: true },
  uses: [
    { card: { oracleId: 'o1', name: 'A', imageUriFrontPng: 'x' }, mustBeCommander: true, zoneLocations: ['C'] },
    { card: { oracleId: 'o2', name: 'B' }, mustBeCommander: false, zoneLocations: ['H'] },
  ],
  requires: [{ template: { id: 3 }, quantity: 2 }],
  produces: [{ feature: { name: 'Infinite mana' } }, { feature: { name: 'Win the game' } }],
  description: 'long prose',
  ...over,
});

describe('combos', () => {
  it('maps a variant to a Combo and drops prose and images', () => {
    expect(toCombo(variant())).toEqual({
      id: '1-2--3',
      cards: [{ oracleId: 'o1', mustBeCommander: true }, { oracleId: 'o2', mustBeCommander: false }],
      requiresCount: 2, bracketTag: 'R', manaValueNeeded: 4, produces: ['Infinite mana', 'Win the game'], popularity: 1234,
    });
    expect(toCombo(variant({ requires: [], popularity: null }))).toMatchObject({ requiresCount: 0, popularity: 0 });
  });

  it('rejects example, non-Commander, banned-tag and id-less variants', () => {
    expect(toCombo(variant({ status: 'E' }))).toBeNull();
    expect(toCombo(variant({ legalities: { commander: false } }))).toBeNull();
    expect(toCombo(variant({ bracketTag: 'B' }))).toBeNull();
    expect(toCombo(variant({ uses: [{ card: { name: 'no id' } }] }))).toBeNull();
  });

  it('streams the variants array out of the export document', async () => {
    const doc = JSON.stringify({ timestamp: 't', version: '1', variants: [variant(), variant({ id: '9', status: 'E' }), variant({ id: '7' })], aliases: [{ id: 'x', variant: null }] });
    const chunks = doc.match(/[\s\S]{1,37}/g)!; // arbitrary chunk boundaries
    const ids: string[] = [];
    for await (const { value } of streamVariants(Readable.from(chunks.map((c) => Buffer.from(c))))) ids.push(value.id);
    expect(ids).toEqual(['1-2--3', '9', '7']);
  });
});

describe('sync arguments', () => {
  it('orders steps, defaults to all, and reads flags', () => {
    expect(parseArgs(['combos', 'cards', 'tags']).steps).toEqual(['cards', 'tags', 'combos']);
    expect(parseArgs([]).steps).toEqual(['cards', 'tags', 'combos', 'features', 'images']);
    expect(parseArgs(['all']).steps).toHaveLength(5);
    expect(parseArgs(['images', '--limit', '20', '--match', 'tergrid'])).toEqual({ steps: ['images'], flags: { keepRaw: false, limit: 20, match: 'tergrid' } });
    expect(() => parseArgs(['bogus'])).toThrow(/unknown argument/);
    expect(() => parseArgs(['images', '--limit', 'x'])).toThrow(/--limit/);
  });
});

describe('database, loadCardDb and images', () => {
  const card = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    oracleId: id, scryfallId: `p-${id}`, name, frontName: name.split(' // ')[0], layout: 'normal', manaCost: '', cmc: 0,
    typeLine: 'Artifact', frontTypeLine: 'Artifact', oracleText: '', colors: [], colorIdentity: [], keywords: [], power: null,
    producedMana: [], legality: 'legal', gameChanger: false, edhrecRank: 1, priceUsd: null,
    faces: [], imageFaces: 1, isMeldResult: false, ...extra,
  });

  function seeded() {
    const db = openDb(':memory:');
    const ins = db.prepare('INSERT INTO cards(oracle_id, name, front_name, json) VALUES (?, ?, ?, ?)');
    const rows = [
      card('a', 'Alpha'),
      card('b', 'Beta // Gamma', { imageFaces: 2, edhrecRank: 2 }),
      card('x', 'Banned Thing', { legality: 'banned' }),
      card('m', 'Melded', { isMeldResult: true }),
    ];
    for (const c of rows) ins.run(c.oracleId, c.name, c.frontName, JSON.stringify(c));
    const img = db.prepare('INSERT INTO card_images(oracle_id, face, display_url, grid_url, image_updated_at) VALUES (?, ?, ?, ?, ?)');
    img.run('a', 0, 'https://img.test/display/a0', 'https://img.test/grid/a0', 'v1');
    img.run('b', 0, 'https://img.test/display/b0', 'https://img.test/grid/b0', 'v1');
    img.run('b', 1, 'https://img.test/display/b1', 'https://img.test/grid/BROKEN', 'v1');
    img.run('x', 0, 'https://img.test/display/x0', 'https://img.test/grid/x0', 'v1');
    img.run('m', 0, 'https://img.test/display/m0', 'https://img.test/grid/m0', 'v1');
    return db;
  }

  it('creates every table and loads a CardDb with tag slugs', () => {
    const db = seeded();
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((t) => t.name);
    for (const t of ['cards', 'tags', 'card_tags', 'combos', 'combo_cards', 'card_features', 'edhrec_cache', 'collection', 'decks', 'settings', 'sync_state', 'card_images']) {
      expect(tables).toContain(t);
    }
    db.prepare('INSERT INTO tags(id, slug, label) VALUES (?, ?, ?)').run('t1', 'ramp', 'Ramp');
    db.prepare('INSERT INTO card_tags(oracle_id, tag_id) VALUES (?, ?)').run('a', 't1');
    db.prepare('INSERT INTO combos(id, json) VALUES (?, ?)').run('c1', JSON.stringify({ id: 'c1', cards: [{ oracleId: 'a', mustBeCommander: false }], requiresCount: 0, bracketTag: 'E', manaValueNeeded: 0, produces: [], popularity: 0 }));
    invalidateCardDb();
    const cdb = loadCardDb(db);
    expect(cdb.all().map((c) => c.oracleId).sort()).toEqual(['a', 'b']);
    expect(cdb.byName('beta')?.oracleId).toBe('b');
    expect(cdb.get('x')?.legality).toBe('banned');
    expect(cdb.tagSlugs('a')).toEqual(['ramp']);
    expect(cdb.tagSlugs('b')).toEqual([]);
    expect(cdb.combosFor('a')).toHaveLength(1);
    expect(loadCardDb(db)).toBe(cdb);
    invalidateCardDb();
    expect(loadCardDb(db)).not.toBe(cdb);
    invalidateCardDb();
  });

  it('downloads both sizes per face, skips existing files, and reports failures without throwing', async () => {
    const db = seeded();
    const dir = tmp();
    const requested: string[] = [];
    const fetchImpl = (async (url: string) => {
      requested.push(url);
      return url.endsWith('BROKEN') ? new Response('<html>nope</html>') : new Response(WEBP);
    }) as unknown as typeof fetch;
    const lines: string[] = [];
    const first = await syncImages(db, (l) => lines.push(l), { dir, http: { fetchImpl } });
    expect(first.downloaded).toBe(5);
    expect(first.failures).toHaveLength(1);
    expect(first.failures[0]).toContain('Beta // Gamma [grid face 1]');
    expect(requested.some((u) => u.includes('/x0') || u.includes('/m0'))).toBe(false); // banned and meld results are skipped
    for (const f of ['display/a_0.webp', 'grid/a_0.webp', 'display/b_0.webp', 'grid/b_0.webp', 'display/b_1.webp']) {
      expect(await isWebp(path.join(dir, f))).toBe(true);
    }
    expect(lines).toContain('images 6/6');

    requested.length = 0;
    const second = await syncImages(db, () => undefined, { dir, http: { fetchImpl } });
    expect(second.skipped).toBe(5);
    expect(requested).toEqual(['https://img.test/grid/BROKEN']);

    // A newer image version on Scryfall forces a re-download of that face only.
    db.prepare("UPDATE card_images SET image_updated_at = 'v2' WHERE oracle_id = 'a'").run();
    requested.length = 0;
    const third = await syncImages(db, () => undefined, { dir, limit: 1, http: { fetchImpl } });
    expect(third.downloaded).toBe(2);
    expect(requested.sort()).toEqual(['https://img.test/display/a0', 'https://img.test/grid/a0']);
  });
});
