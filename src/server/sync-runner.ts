import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import type { SyncState, SyncStep } from '@/app/lib/api';
import { HttpError } from './http';
import { onCardDataChanged } from './store';

export const SYNC_STEPS: readonly SyncStep[] = ['cards', 'printings', 'tags', 'combos', 'features', 'images'];
/** Progress lines kept in memory; older ones are dropped, `lineCount` keeps counting. */
export const MAX_LINES = 2000;

interface Run {
  running: boolean; step: SyncStep | 'all' | null; startedAt: string | null; finishedAt: string | null;
  exitCode: number | null; dropped: number; lines: string[];
}

// On globalThis: a run must stay visible to every route bundle and survive cache resets.
const KEY = '__commanderForgeSync';
const holder = globalThis as unknown as Record<string, Run | undefined>;
const run = (): Run =>
  (holder[KEY] ??= { running: false, step: null, startedAt: null, finishedAt: null, exitCode: null, dropped: 0, lines: [] });

export type Spawner = (step: SyncStep | 'all') => Pick<ChildProcess, 'stdout' | 'stderr' | 'on'>;

/** Runs the ingest CLI (`pnpm sync <step>`) from the project root. */
const spawnCli: Spawner = (step) =>
  spawn(path.join(process.cwd(), 'node_modules', '.bin', 'tsx'), ['src/ingest/sync.ts', ...(step === 'all' ? [] : [step])], {
    cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
  });

/** Progress of the current or last run; `since` skips lines the caller already has. */
export function syncState(since = 0): SyncState {
  const r = run();
  const lineCount = r.dropped + r.lines.length;
  const from = Math.max(0, Math.min(r.lines.length, Math.floor(Number.isFinite(since) ? since : 0) - r.dropped));
  return {
    running: r.running, step: r.step, startedAt: r.startedAt, finishedAt: r.finishedAt, exitCode: r.exitCode,
    lineCount, lines: r.lines.slice(from),
  };
}

/** Starts a sync step as a child process. 400 for an unknown step, 409 while one is running. */
export function startSync(step: unknown, spawner: Spawner = spawnCli): SyncState {
  if (step !== 'all' && !SYNC_STEPS.includes(step as SyncStep)) {
    throw new HttpError(400, `step must be one of ${SYNC_STEPS.join(', ')} or all.`);
  }
  const wanted = step as SyncStep | 'all';
  const r = run();
  if (r.running) throw new HttpError(409, `A sync is already running (${r.step}).`);
  Object.assign(r, {
    running: true, step: wanted, startedAt: new Date().toISOString(), finishedAt: null, exitCode: null, dropped: 0, lines: [],
  } satisfies Partial<Run>);

  const push = (line: string) => {
    r.lines.push(line);
    if (r.lines.length > MAX_LINES) {
      r.dropped += r.lines.length - MAX_LINES;
      r.lines.splice(0, r.lines.length - MAX_LINES);
    }
  };
  const finish = (code: number | null) => {
    if (!r.running) return;
    r.running = false;
    r.exitCode = code;
    r.finishedAt = new Date().toISOString();
    onCardDataChanged();
  };

  let child: ReturnType<Spawner>;
  try {
    child = spawner(wanted);
  } catch (err) {
    push(`could not start: ${err instanceof Error ? err.message : String(err)}`);
    finish(1);
    return syncState();
  }
  for (const stream of [child.stdout, child.stderr]) {
    let rest = '';
    stream?.on('data', (chunk: Buffer | string) => {
      const parts = (rest + chunk.toString()).split(/\r?\n/);
      rest = parts.pop() ?? '';
      for (const line of parts) if (line.trim()) push(line);
    });
    stream?.on('end', () => {
      if (rest.trim()) push(rest);
      rest = '';
    });
  }
  child.on('error', (err: Error) => {
    push(`could not start: ${err.message}`);
    finish(1);
  });
  child.on('close', (code: number | null) => finish(code ?? 1));
  return syncState();
}
