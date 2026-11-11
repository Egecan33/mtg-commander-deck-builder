// Commander Forge portable launcher. Run by "Commander Forge.command" (macOS) and "Commander Forge.bat"
// (Windows) with the bundled Node. One script for both platforms so they behave the same.
//
// 1. Picks the per-user data folder and passes it on as COMMANDER_FORGE_DATA.
// 2. First run: downloads card data in this window, then images in the background (logged to the data folder).
// 3. Starts the app on 127.0.0.1, first free port of 3210-3219, and opens the browser once it answers.
// Ctrl+C stops everything.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(ROOT, 'app');
const SYNC = path.join(APP, 'dist', 'sync.mjs');
const NODE = process.execPath;

function defaultDataDir() {
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', 'Commander Forge');
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'Commander Forge');
  }
  return path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'commander-forge');
}

const DATA = process.env.COMMANDER_FORGE_DATA || defaultDataDir();
fs.mkdirSync(DATA, { recursive: true });
const env = { ...process.env, COMMANDER_FORGE_DATA: DATA, COMMANDER_FORGE_SYNC_CLI: SYNC, NODE_ENV: 'production' };
const IMAGES_PENDING = path.join(DATA, 'images-pending');
const IMAGES_LOG = path.join(DATA, 'images-sync.log');

const children = new Set();
function stopAll(code = 0) {
  for (const child of children) {
    try { child.kill(); } catch { /* already gone */ }
  }
  process.exit(code);
}
process.on('SIGINT', () => { console.log('\nStopping Commander Forge.'); stopAll(0); });
process.on('SIGTERM', () => stopAll(0));

function cardCount() {
  const dbFile = process.env.COMMANDER_FORGE_DB || path.join(DATA, 'forge.db');
  if (!fs.existsSync(dbFile)) return 0;
  try {
    const Database = createRequire(path.join(APP, 'package.json'))('better-sqlite3');
    const db = new Database(dbFile, { readonly: true, fileMustExist: true });
    try { return db.prepare('SELECT count(*) AS n FROM cards').get().n; } finally { db.close(); }
  } catch {
    return 0;
  }
}

function startImagesInBackground() {
  fs.writeFileSync(IMAGES_PENDING, new Date().toISOString());
  const log = fs.openSync(IMAGES_LOG, 'a');
  const child = spawn(NODE, [SYNC, 'images'], { cwd: APP, env, stdio: ['ignore', log, log] });
  children.add(child);
  child.on('exit', (code) => {
    children.delete(child);
    if (code === 0) {
      fs.rmSync(IMAGES_PENDING, { force: true });
      console.log('Card images finished downloading.');
    }
  });
  console.log(`Card images are downloading in the background (about 40 minutes). Progress: ${IMAGES_LOG}`);
}

function portFree(port) {
  return new Promise((resolve) => {
    // Something already answering on the port (any address family) means it is taken.
    const probe = net.connect({ host: '127.0.0.1', port });
    probe.once('connect', () => { probe.destroy(); resolve(false); });
    probe.once('error', () => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
    });
  });
}

async function waitForApp(url, server) {
  for (let i = 0; i < 240; i++) {
    if (server.exitCode !== null) return false;
    try {
      const res = await fetch(`${url}/api/status`);
      if (res.ok) return true;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function openBrowser(url) {
  if (process.env.COMMANDER_FORGE_NO_BROWSER) return;
  const [cmd, args] = process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url]]
      : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* user can open it by hand */ }
}

async function main() {
  console.log('Commander Forge');
  console.log(`Data folder: ${DATA}\n`);

  if (cardCount() === 0) {
    console.log('First run: downloading card data (about 3 minutes). Card images follow in the background.\n');
    const sync = spawnSync(NODE, [SYNC, 'cards', 'printings', 'tags', 'combos', 'features'], { cwd: APP, env, stdio: 'inherit' });
    if (sync.status !== 0) {
      console.error('\nCard data download failed. Check your internet connection and run Commander Forge again.');
      process.exit(1);
    }
    startImagesInBackground();
  } else if (fs.existsSync(IMAGES_PENDING)) {
    console.log('Resuming the card image download.');
    startImagesInBackground();
  }

  let port = 0;
  const first = Number(process.env.PORT) || 3210;
  for (let p = first; p < first + 10; p++) {
    if (await portFree(p)) { port = p; break; }
  }
  if (!port) {
    console.error(`Ports ${first}-${first + 9} are all in use. Close another Commander Forge window and try again.`);
    stopAll(1);
  }
  const url = `http://127.0.0.1:${port}`;
  const server = spawn(NODE, [path.join(APP, 'server.js')], {
    cwd: APP, env: { ...env, PORT: String(port), HOSTNAME: '127.0.0.1' }, stdio: ['ignore', 'inherit', 'inherit'],
  });
  children.add(server);
  server.on('exit', (code) => { children.delete(server); console.log(`The app stopped (exit code ${code}).`); stopAll(code ?? 1); });

  if (await waitForApp(url, server)) {
    console.log(`\nCommander Forge is running at ${url}`);
    console.log('Keep this window open while you use it. Press Ctrl+C to stop.\n');
    openBrowser(url);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  stopAll(1);
});
