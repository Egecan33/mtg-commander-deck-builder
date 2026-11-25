import type { Readable } from 'node:stream';

const BLOCK = 512;

const cString = (buf: Buffer, start: number, length: number): string => {
  const slice = buf.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end < 0 ? slice.length : end).toString('utf8');
};

/**
 * Reads a ustar archive (already gunzipped) from a byte stream and yields every regular file with
 * its bytes. Directories, links and extended headers are skipped. Only one file is held in memory
 * at a time.
 */
export async function* readTar(stream: Readable): AsyncGenerator<{ name: string; data: Buffer }> {
  let buf = Buffer.alloc(0);
  const it = stream[Symbol.asyncIterator]();
  /** Resolves with exactly `n` bytes, or null when the stream ends before that many arrive. */
  const take = async (n: number): Promise<Buffer | null> => {
    while (buf.length < n) {
      const next = await it.next();
      if (next.done) return null;
      buf = Buffer.concat([buf, next.value as Buffer]);
    }
    const out = buf.subarray(0, n);
    buf = buf.subarray(n);
    return out;
  };

  for (;;) {
    const header = await take(BLOCK);
    if (!header || header.every((b) => b === 0)) return;
    const size = parseInt(cString(header, 124, 12).trim() || '0', 8);
    if (!Number.isFinite(size)) throw new Error('tar: unreadable file size in header');
    const padded = Math.ceil(size / BLOCK) * BLOCK;
    const body = await take(padded);
    if (!body) throw new Error('tar: archive ends inside a file');
    const type = cString(header, 156, 1);
    if (type !== '0' && type !== '') continue;
    const prefix = cString(header, 345, 155);
    const name = cString(header, 0, 100);
    yield { name: prefix ? `${prefix}/${name}` : name, data: Buffer.from(body.subarray(0, size)) };
  }
}
