import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { parseMtgjsonDeck, storeProducts, type ParsedProduct } from '@/ingest/products';
import { readTar } from '@/ingest/tar';
import { openDb } from '@/server/db';

const fixture = JSON.parse(readFileSync('tests/fixtures/mtgjson/LandingParty_TRC.json', 'utf8'));
const SPOCK = '60644afe-9645-45a1-9eac-70f327daa6a7';

function tarEntry(name: string, body: string): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write('0000644\0', 100);
  header.write(`${Buffer.byteLength(body).toString(8).padStart(11, '0')}\0`, 124);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('        ', 148);
  let sum = 0;
  for (const b of header) sum += b;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const data = Buffer.from(body);
  return Buffer.concat([header, data, Buffer.alloc((512 - (data.length % 512)) % 512)]);
}

const synthetic = (prefix: string, n: number): ParsedProduct[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`, name: `${prefix} ${i}`, setCode: 'TST', type: 'Commander Deck', releaseDate: '2026-01-01',
    cards: [{ oracleId: `o${i}`, qty: 1, commander: i % 2 === 0 }, { oracleId: `shared`, qty: 2, commander: false }], unknownCards: 0,
  }));

describe('readTar', () => {
  it("yields each file's name and bytes", async () => {
    const archive = Buffer.concat([tarEntry('a/x.json', '{"a":1}'), tarEntry('a/y.json', '{"b":2}'), Buffer.alloc(1024)]);
    const files: { name: string; data: string }[] = [];
    // Small chunks so entries straddle chunk boundaries.
    const chunks = Array.from({ length: Math.ceil(archive.length / 100) }, (_, i) => archive.subarray(i * 100, i * 100 + 100));
    for await (const f of readTar(Readable.from(chunks))) files.push({ name: f.name, data: f.data.toString() });
    expect(files).toEqual([{ name: 'a/x.json', data: '{"a":1}' }, { name: 'a/y.json', data: '{"b":2}' }]);
  });
});

describe('parseMtgjsonDeck', () => {
  const total = (fixture.data.commander as { count: number }[]).concat(fixture.data.mainBoard).reduce((n, c) => n + c.count, 0);

  it('reads the Landing Party fixture', () => {
    const p = parseMtgjsonDeck('LandingParty_TRC.json', fixture, () => true)!;
    expect(p).toMatchObject({ id: 'LandingParty_TRC', name: 'Landing Party', setCode: 'TRC', type: 'Commander Deck', releaseDate: '2026-11-13', unknownCards: 0 });
    expect(p.cards.find((c) => c.oracleId === SPOCK)).toEqual({ oracleId: SPOCK, qty: 1, commander: true });
    const kirk = fixture.data.mainBoard[0].identifiers.scryfallOracleId;
    expect(p.cards.filter((c) => c.oracleId === kirk)).toEqual([{ oracleId: kirk, qty: 2, commander: false }]);
    expect(p.cards.reduce((n, c) => n + c.qty, 0)).toBe(total);
  });

  it('counts cards it does not know', () => {
    const missing = fixture.data.mainBoard[1].identifiers.scryfallOracleId;
    const p = parseMtgjsonDeck('LandingParty_TRC.json', fixture, (id) => id !== missing)!;
    expect(p.cards.some((c) => c.oracleId === missing)).toBe(false);
    expect(p.unknownCards).toBe(1);
  });

  it('returns null without data or cards', () => {
    expect(parseMtgjsonDeck('x.json', {}, () => true)).toBeNull();
    expect(parseMtgjsonDeck('x.json', { data: { name: 'X', code: 'X', type: 'T', releaseDate: '2026-01-01', mainBoard: [] } }, () => true)).toBeNull();
  });
});

describe('storeProducts', () => {
  it('refuses a short list', () => {
    const db = openDb(':memory:');
    storeProducts(db, synthetic('keep', 1000));
    expect(() => storeProducts(db, synthetic('new', 3))).toThrow(/refus/i);
    expect((db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n).toBe(1000);
  });

  it('replaces the whole catalogue', () => {
    const db = openDb(':memory:');
    storeProducts(db, synthetic('old', 1000));
    storeProducts(db, synthetic('new', 1000));
    expect(db.prepare("SELECT COUNT(*) AS n FROM products WHERE id LIKE 'old%'").get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM products').get()).toEqual({ n: 1000 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM product_cards').get()).toEqual({ n: 2000 });
    expect(db.prepare("SELECT commander FROM product_cards WHERE product_id = 'new0' AND oracle_id = 'o0'").get()).toEqual({ commander: 1 });
  });
});
