import { existsSync, statSync } from 'node:fs';
import { mkdir, open, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import type { Card } from '@/engine/types';
import { DATA_DIR, writeSyncState, type Db } from '@/server/db';
import type { Log } from './cards';
import { downloadToFile, type HttpOptions } from './http';

export const IMAGE_SIZES = ['display', 'grid'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];
export const IMAGE_DIR = path.join(DATA_DIR, 'images');

export const imagePath = (size: ImageSize, oracleId: string, face: number, dir: string = IMAGE_DIR): string =>
  path.join(dir, size, `${oracleId}_${face}.webp`);

/** True when the file starts with a RIFF....WEBP container header. */
export async function isWebp(file: string): Promise<boolean> {
  const fh = await open(file, 'r');
  try {
    const head = Buffer.alloc(12);
    const { bytesRead } = await fh.read(head, 0, 12, 0);
    return bytesRead === 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP';
  } finally {
    await fh.close();
  }
}

const present = (file: string): boolean => existsSync(file) && statSync(file).size > 0;

export interface ImageOptions {
  limit?: number;          // number of cards, most popular first
  match?: string;          // only cards whose name contains this text (case-insensitive)
  concurrency?: number;
  dir?: string;
  http?: HttpOptions;
}

interface FaceJob { oracleId: string; name: string; face: number; urls: Record<ImageSize, string>; version: string | null; fetched: string | null }

export async function syncImages(db: Db, log: Log, opts: ImageOptions = {}): Promise<{ downloaded: number; skipped: number; failures: string[] }> {
  const dir = opts.dir ?? IMAGE_DIR;
  const concurrency = opts.concurrency ?? 6;
  for (const size of IMAGE_SIZES) await mkdir(path.join(dir, size), { recursive: true });

  const needle = opts.match?.toLowerCase();
  let cards = (db.prepare('SELECT json FROM cards').all() as { json: string }[])
    .map((r) => JSON.parse(r.json) as Card)
    .filter((c) => c.legality === 'legal' && !c.isMeldResult)
    .filter((c) => !needle || c.name.toLowerCase().includes(needle))
    .sort((a, b) => (a.edhrecRank ?? Infinity) - (b.edhrecRank ?? Infinity) || a.name.localeCompare(b.name));
  if (opts.limit !== undefined) cards = cards.slice(0, opts.limit);

  const imageRows = db.prepare(
    'SELECT face, display_url AS display, grid_url AS grid, image_updated_at AS version, fetched_updated_at AS fetched ' +
      'FROM card_images WHERE oracle_id = ? ORDER BY face',
  );
  const jobs: FaceJob[] = [];
  for (const c of cards) {
    const rows = imageRows.all(c.oracleId) as { face: number; display: string; grid: string; version: string | null; fetched: string | null }[];
    for (const r of rows) {
      jobs.push({ oracleId: c.oracleId, name: c.name, face: r.face, urls: { display: r.display, grid: r.grid }, version: r.version, fetched: r.fetched });
    }
  }

  const total = jobs.length * IMAGE_SIZES.length;
  const markFetched = db.prepare('UPDATE card_images SET fetched_updated_at = ? WHERE oracle_id = ? AND face = ?');
  const failures: string[] = [];
  let done = 0;
  let downloaded = 0;
  let skipped = 0;
  const tick = () => {
    if (++done % 500 === 0 || done === total) log(`images ${done}/${total}`);
  };

  const runJob = async (job: FaceJob) => {
    // A file from an older image version is re-fetched; an untracked existing file is trusted.
    const current = job.fetched === null || job.fetched === job.version;
    let ok = true;
    for (const size of IMAGE_SIZES) {
      const dest = imagePath(size, job.oracleId, job.face, dir);
      if (current && present(dest)) {
        skipped++;
        tick();
        continue;
      }
      const tmp = `${dest}.tmp`;
      try {
        await downloadToFile(job.urls[size], tmp, opts.http); // writes tmp.part, then tmp
        if (!(await isWebp(tmp))) throw new Error('not a WebP file');
        await rename(tmp, dest);
        downloaded++;
      } catch (err) {
        ok = false;
        await rm(tmp, { force: true });
        failures.push(`${job.name} [${size} face ${job.face}]: ${err instanceof Error ? err.message : String(err)}`);
      }
      tick();
    }
    if (ok) markFetched.run(job.version, job.oracleId, job.face);
  };

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
      while (next < jobs.length) await runJob(jobs[next++]);
    }),
  );

  const info = { cards: cards.length, files: total, downloaded, skipped, failed: failures.length, limit: opts.limit ?? null, match: opts.match ?? null };
  writeSyncState(db, 'images', info);
  for (const f of failures.slice(0, 50)) log(`images failed ${f}`);
  if (failures.length > 50) log(`images failed ... and ${failures.length - 50} more`);
  log(`images finished ${JSON.stringify(info)}`);
  return { downloaded, skipped, failures };
}
