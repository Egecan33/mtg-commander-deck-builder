import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export const USER_AGENT = 'CommanderForge/0.1';
const HEADERS = { 'User-Agent': USER_AGENT, Accept: '*/*' };

export interface HttpOptions {
  /** Wait after a 429 before retrying. Scryfall blocks for 30 s; the plan asks for 60 s. */
  retryWaitMs?: number;
  maxAttempts?: number;
  fetchImpl?: typeof fetch;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** GET with the required headers. Waits and retries on 429; other statuses are returned as-is. */
export async function httpGet(url: string, opts: HttpOptions = {}): Promise<Response> {
  const { retryWaitMs = 60_000, maxAttempts = 5, fetchImpl = fetch } = opts;
  for (let attempt = 1; ; attempt++) {
    const res = await fetchImpl(url, { headers: HEADERS, redirect: 'follow' });
    if (res.status !== 429 || attempt >= maxAttempts) return res;
    await res.body?.cancel().catch(() => undefined);
    console.log(`http 429 from ${new URL(url).host}; waiting ${Math.round(retryWaitMs / 1000)} s (attempt ${attempt})`);
    await sleep(retryWaitMs);
  }
}

export async function getJson<T = unknown>(url: string, opts?: HttpOptions): Promise<T> {
  const res = await httpGet(url, opts);
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Streams a URL to `dest` through `dest.part`, renaming only when the body completed.
 * Returns the number of bytes written.
 */
export async function downloadToFile(url: string, dest: string, opts?: HttpOptions): Promise<number> {
  const res = await httpGet(url, opts);
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`GET ${url} -> HTTP ${res.status}`);
  }
  await mkdir(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const out = createWriteStream(part);
  try {
    await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream<Uint8Array>), out);
  } catch (err) {
    await rm(part, { force: true });
    throw err;
  }
  await rename(part, dest);
  return out.bytesWritten;
}

/** Opens a downloaded file as a byte stream, gunzipping when it starts with the gzip magic bytes. */
export async function openMaybeGzip(file: string): Promise<Readable> {
  const { open } = await import('node:fs/promises');
  const { createReadStream } = await import('node:fs');
  const { createGunzip } = await import('node:zlib');
  const fh = await open(file, 'r');
  const head = Buffer.alloc(2);
  await fh.read(head, 0, 2, 0);
  await fh.close();
  const raw = createReadStream(file);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return raw;
  const gunzip = createGunzip();
  raw.on('error', (err) => gunzip.destroy(err));
  return raw.pipe(gunzip);
}

/** Yields the parsed JSON object on each non-empty line of a (possibly gzipped) JSONL file. */
export async function* readJsonLines<T = unknown>(file: string): AsyncGenerator<T> {
  const { createInterface } = await import('node:readline');
  const rl = createInterface({ input: await openMaybeGzip(file), crlfDelay: Infinity });
  for await (const line of rl) {
    if (line.trim()) yield JSON.parse(line) as T;
  }
}

interface BulkEntry { type: string; jsonl_download_uri?: string; download_uri?: string; updated_at?: string }

/** Resolves a Scryfall bulk file URL by type; the URLs carry a timestamp and change daily. */
export async function resolveBulk(type: string, opts?: HttpOptions): Promise<{ url: string; updatedAt: string | null }> {
  const list = await getJson<{ data: BulkEntry[] }>('https://api.scryfall.com/bulk-data', opts);
  const entry = list.data.find((b) => b.type === type);
  const url = entry?.jsonl_download_uri ?? entry?.download_uri;
  if (!url) throw new Error(`Scryfall bulk-data has no "${type}" entry`);
  return { url, updatedAt: entry?.updated_at ?? null };
}
