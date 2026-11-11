// Assembles a portable bundle from a finished `pnpm build && pnpm build:sync`, for the platform it runs on.
// Used by .github/workflows/release.yml and locally:  node packaging/assemble.mjs [--no-zip]
//
// release/CommanderForge-<version>-<os>-<arch>/
//   app/               Next standalone server + .next/static + public, plus dist/sync.mjs
//   node/              the official Node.js binary for this platform (same version as the build)
//   launcher.mjs, Commander Forge.command | Commander Forge.bat, READ ME FIRST.txt, LICENSE
// No card data or images go in the bundle.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PKG = path.join(ROOT, 'packaging');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = (process.env.RELEASE_VERSION || pkg.version).replace(/^v/, '');
const os = { darwin: 'macos', win32: 'windows', linux: 'linux' }[process.platform] ?? process.platform;
const arch = process.arch;
const win = process.platform === 'win32';
// Windows ships bsdtar, which reads and writes zip; Git's GNU tar may shadow it on PATH.
const TAR = win ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
const name = `CommanderForge-${version}-${os}-${arch}`;
const OUT = path.join(ROOT, 'release');
const DEST = path.join(OUT, name);
const APP = path.join(DEST, 'app');

const need = (p, hint) => { if (!fs.existsSync(p)) throw new Error(`missing ${path.relative(ROOT, p)}: ${hint}`); };
need(path.join(ROOT, '.next', 'standalone', 'server.js'), 'run pnpm build first');
need(path.join(ROOT, 'dist', 'sync.mjs'), 'run pnpm build:sync first');

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

// 1. The app. Symlinks (pnpm) are copied as real files so the zip works everywhere.
// (fs.cpSync's `dereference` only follows the top-level source, so walk the tree by hand.)
function copy(from, to) {
  const stat = fs.statSync(from); // follows symlinks
  if (stat.isDirectory()) {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from)) copy(path.join(from, entry), path.join(to, entry));
  } else {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
    fs.chmodSync(to, stat.mode & 0o777);
  }
}
const STANDALONE = path.join(ROOT, '.next', 'standalone');
for (const entry of fs.readdirSync(STANDALONE)) {
  if (entry !== 'node_modules') copy(path.join(STANDALONE, entry), path.join(APP, entry));
}
// pnpm's node_modules/.pnpm layout only resolves through symlinks, which zips and Windows do not keep.
// Flatten it into a plain hoisted node_modules: every package once, at the top level.
const SRC_NM = path.join(STANDALONE, 'node_modules');
const NM = path.join(APP, 'node_modules');
const packagesIn = (dir) => fs.readdirSync(dir).flatMap((n) =>
  n.startsWith('@') ? fs.readdirSync(path.join(dir, n)).map((s) => `${n}/${s}`) : n.startsWith('.') ? [] : [n]);
const placed = new Map();
const place = (name, from) => {
  const version = JSON.parse(fs.readFileSync(path.join(from, 'package.json'), 'utf8')).version;
  if (placed.has(name)) {
    if (placed.get(name) !== version) throw new Error(`two versions of ${name} (${placed.get(name)}, ${version}); cannot flatten`);
  }
  placed.set(name, version);
  copy(from, path.join(NM, name)); // the same version traced twice (peer variants) is merged file by file
};
for (const name of packagesIn(SRC_NM)) place(name, fs.realpathSync(path.join(SRC_NM, name)));
const store = path.join(SRC_NM, '.pnpm');
if (fs.existsSync(store)) {
  for (const entry of fs.readdirSync(store)) {
    const inner = path.join(store, entry, 'node_modules');
    if (entry === 'node_modules' || !fs.existsSync(inner)) continue;
    for (const name of packagesIn(inner)) {
      const full = path.join(inner, name);
      if (!fs.lstatSync(full).isSymbolicLink()) place(name, full); // symlinks are links to other store entries
    }
  }
}
copy(path.join(ROOT, '.next', 'static'), path.join(APP, '.next', 'static'));
if (fs.existsSync(path.join(ROOT, 'public'))) copy(path.join(ROOT, 'public'), path.join(APP, 'public'));
fs.rmSync(path.join(APP, 'data'), { recursive: true, force: true });
copy(path.join(ROOT, 'dist', 'sync.mjs'), path.join(APP, 'dist', 'sync.mjs'));

// The bundled sync CLI and the launcher load better-sqlite3 by name from app/node_modules.
const sqliteTop = path.join(APP, 'node_modules', 'better-sqlite3');
if (!fs.existsSync(sqliteTop)) copy(fs.realpathSync(path.join(ROOT, 'node_modules', 'better-sqlite3')), sqliteTop);
const prebuilds = path.join(sqliteTop, 'prebuilds');
const nativeName = `${process.platform}-${arch}.node`;
const hasNative = fs.existsSync(path.join(prebuilds, nativeName)) || fs.existsSync(path.join(sqliteTop, 'build', 'Release', 'better_sqlite3.node'));
if (!hasNative) throw new Error(`better-sqlite3 has no native module for ${process.platform}-${arch}`);

// 2. Node.js: the official build of the version running this script, binary only, checksum verified.
const nodeVersion = process.version;
const nodePlat = { darwin: 'darwin', win32: 'win', linux: 'linux' }[process.platform];
const archive = `node-${nodeVersion}-${nodePlat}-${arch}${win ? '.zip' : '.tar.gz'}`;
const base = `https://nodejs.org/dist/${nodeVersion}`;
const cache = path.join(OUT, '.cache');
fs.mkdirSync(cache, { recursive: true });
const archivePath = path.join(cache, archive);
if (!fs.existsSync(archivePath)) {
  console.log(`downloading ${base}/${archive}`);
  const res = await fetch(`${base}/${archive}`);
  if (!res.ok) throw new Error(`download failed: ${res.status} ${base}/${archive}`);
  fs.writeFileSync(archivePath, Buffer.from(await res.arrayBuffer()));
}
const sums = await (await fetch(`${base}/SHASUMS256.txt`)).text();
const expected = sums.split('\n').find((l) => l.endsWith(`  ${archive}`))?.split(' ')[0];
const actual = createHash('sha256').update(fs.readFileSync(archivePath)).digest('hex');
if (!expected || expected !== actual) {
  fs.rmSync(archivePath);
  throw new Error(`checksum mismatch for ${archive}`);
}
const extract = path.join(cache, `node-${nodeVersion}-${nodePlat}-${arch}`);
if (!fs.existsSync(extract)) execFileSync(TAR, ['-xf', archivePath, '-C', cache], { stdio: 'inherit' });
const nodeBin = win ? path.join(extract, 'node.exe') : path.join(extract, 'bin', 'node');
const nodeDest = win ? path.join(DEST, 'node', 'node.exe') : path.join(DEST, 'node', 'bin', 'node');
fs.mkdirSync(path.dirname(nodeDest), { recursive: true });
fs.copyFileSync(nodeBin, nodeDest);
fs.chmodSync(nodeDest, 0o755);
copy(path.join(extract, 'LICENSE'), path.join(DEST, 'node', 'LICENSE'));

// 3. Launcher, notes, licence.
copy(path.join(PKG, 'launcher.mjs'), path.join(DEST, 'launcher.mjs'));
copy(path.join(PKG, 'READ ME FIRST.txt'), path.join(DEST, 'READ ME FIRST.txt'));
copy(path.join(ROOT, 'LICENSE'), path.join(DEST, 'LICENSE'));
if (win) {
  copy(path.join(PKG, 'Commander Forge.bat'), path.join(DEST, 'Commander Forge.bat'));
} else {
  const launcher = path.join(DEST, 'Commander Forge.command');
  copy(path.join(PKG, 'Commander Forge.command'), launcher);
  fs.chmodSync(launcher, 0o755);
}

// Windows Explorer cannot extract paths past 260 characters; leave room for the unzip location.
if (win) {
  const tooLong = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (path.relative(OUT, full).length > 180) tooLong.push(path.relative(OUT, full));
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(DEST);
  if (tooLong.length) throw new Error(`paths too long for Windows:\n${tooLong.slice(0, 10).join('\n')}`);
}

// 4. Zip.
if (!process.argv.includes('--no-zip')) {
  const zip = path.join(OUT, `${name}.zip`);
  fs.rmSync(zip, { force: true });
  if (process.platform === 'darwin') execFileSync('ditto', ['-c', '-k', '--keepParent', name, zip], { cwd: OUT, stdio: 'inherit' });
  else if (win) execFileSync(TAR, ['-a', '-c', '-f', zip, name], { cwd: OUT, stdio: 'inherit' });
  else execFileSync('zip', ['-qry', zip, name], { cwd: OUT, stdio: 'inherit' });
  console.log(`${zip} (${(fs.statSync(zip).size / 1e6).toFixed(1)} MB)`);
}
console.log(`assembled ${DEST}`);
