import { pathToFileURL } from 'node:url';
import { invalidateCardDb } from '@/server/carddb';
import { openDb, type Db } from '@/server/db';
import { syncCards, type Log } from './cards';
import { syncCombos } from './combos';
import { syncImages } from './images';
import { syncPrintings } from './printings';
import { syncTags } from './tags';

export const STEPS = ['cards', 'printings', 'tags', 'combos', 'features', 'images'] as const;
export type Step = (typeof STEPS)[number];

interface Flags { limit?: number; match?: string; keepRaw: boolean }

async function runFeatures(db: Db, log: Log): Promise<void> {
  // src/ingest/features.ts arrives with the features engine (plan Task 4) and exports
  // `syncFeatures(db, log)`. Until it exists the step reports that and moves on.
  const spec = './features';
  let mod: { syncFeatures?: (db: Db, log: Log) => Promise<void> | void };
  try {
    mod = await import(spec);
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'MODULE_NOT_FOUND') throw err;
    log('features skipped: src/ingest/features.ts is not implemented yet');
    return;
  }
  if (typeof mod.syncFeatures !== 'function') throw new Error('src/ingest/features.ts must export syncFeatures(db, log)');
  await mod.syncFeatures(db, log);
}

export async function runStep(step: Step, db: Db, log: Log, flags: Flags = { keepRaw: false }): Promise<void> {
  switch (step) {
    case 'cards': await syncCards(db, log); break;
    case 'printings': await syncPrintings(db, log); break;
    case 'tags': await syncTags(db, log); break;
    case 'combos': await syncCombos(db, log, { keepRaw: flags.keepRaw }); break;
    case 'features': await runFeatures(db, log); break;
    case 'images': await syncImages(db, log, { limit: flags.limit, match: flags.match }); break;
  }
  invalidateCardDb();
}

export function parseArgs(argv: string[]): { steps: Step[]; flags: Flags } {
  const flags: Flags = { keepRaw: false };
  const steps: Step[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--limit') {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n < 0) throw new Error('--limit needs a non-negative integer');
      flags.limit = n;
    } else if (arg === '--match') {
      const text = argv[++i];
      if (!text) throw new Error('--match needs text');
      flags.match = text;
    } else if (arg === '--keep-raw') {
      flags.keepRaw = true;
    } else if (arg === 'all') {
      steps.push(...STEPS);
    } else if ((STEPS as readonly string[]).includes(arg)) {
      steps.push(arg as Step);
    } else {
      throw new Error(`unknown argument "${arg}". Usage: pnpm sync [${STEPS.join('|')}|all]... [--limit N] [--match TEXT] [--keep-raw]`);
    }
  }
  if (steps.length === 0) steps.push(...STEPS);
  // Run in dependency order whatever order was typed, each step once.
  return { steps: STEPS.filter((s) => steps.includes(s)), flags };
}

async function main(): Promise<void> {
  const { steps, flags } = parseArgs(process.argv.slice(2));
  const db = openDb();
  const log: Log = (line) => console.log(line);
  try {
    for (const step of steps) {
      const started = Date.now();
      await runStep(step, db, log, flags);
      log(`${step} took ${((Date.now() - started) / 1000).toFixed(1)} s`);
    }
  } finally {
    db.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
