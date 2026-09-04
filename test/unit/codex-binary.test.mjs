/**
 * Which `codex` this machine means — WP-23a, `docs/DEVIATIONS.md` §136.1.
 *
 * The defect: the OpenAI Codex desktop app creates `~/.codex` and installs a
 * complete CLI at `%LOCALAPPDATA%\OpenAI\Codex\bin\<build-hash>\codex.exe`
 * that it does **not** put on `PATH`. `available()` answered "does `~/.codex`
 * exist", `send()` got past that guard, `spawn('codex', …)` came back `ENOENT`
 * and the user was told "Codex is not installed" — on a machine with Codex
 * installed twice over.
 *
 * Every dependency of the search is injected here, so both platforms' searches
 * run on one machine in one test run and neither depends on what happens to be
 * installed on the runner. Nothing in this file touches a real filesystem and
 * nothing in it starts a process.
 */
import '../helpers/isolate.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  bundleBinDirs,
  bundleRoots,
  describeMissingBinary,
  findBundledCodex,
  findOnPath,
  resolveCodexBinary,
} from '../../src/adapters/codex/binary.mjs';

// ---------------------------------------------------------------------------
// A machine, as data
// ---------------------------------------------------------------------------

const LOCAL = 'C:\\Users\\dev\\AppData\\Local';
const BUNDLE_BIN = `${LOCAL}\\OpenAI\\Codex\\bin`;
const OLD_BUILD = `${BUNDLE_BIN}\\aaaa000000000000\\codex.exe`;
const NEW_BUILD = `${BUNDLE_BIN}\\c03fa83159064b45\\codex.exe`;

/**
 * A Windows machine with the desktop app installed, `codex` off PATH, and two
 * hashed build directories — which is exactly the reference machine's shape.
 * @param {{files?: string[], path?: string, mtimes?: Record<string, number>}} [over]
 */
function windowsMachine(over = {}) {
  const files = new Set(over.files || [OLD_BUILD, NEW_BUILD]);
  return {
    platform: 'win32',
    env: { LOCALAPPDATA: LOCAL, PATH: over.path ?? 'C:\\Windows\\system32', PATHEXT: '.EXE;.CMD' },
    isFile: (p) => files.has(p),
    readdir: (dir) => {
      if (dir !== BUNDLE_BIN) throw new Error('ENOENT');
      return ['aaaa000000000000', 'c03fa83159064b45', 'rg-only'];
    },
    mtime: (p) => (over.mtimes ? (over.mtimes[p] ?? 0) : p === NEW_BUILD ? 200 : 100),
  };
}

// ---------------------------------------------------------------------------
// Where the search looks
// ---------------------------------------------------------------------------

test('the bundle search looks under %LOCALAPPDATA%\\OpenAI\\Codex on Windows', () => {
  assert.deepEqual(bundleRoots({ platform: 'win32', env: { LOCALAPPDATA: LOCAL } }), [
    `${LOCAL}\\OpenAI\\Codex`,
  ]);
  assert.deepEqual(bundleBinDirs({ platform: 'win32', env: { LOCALAPPDATA: LOCAL } }), [
    BUNDLE_BIN,
  ]);
});

test('a Windows machine with no LOCALAPPDATA has no bundle to look in, and does not throw', () => {
  assert.deepEqual(bundleRoots({ platform: 'win32', env: {} }), []);
  assert.deepEqual(bundleBinDirs({ platform: 'win32', env: {} }), []);
});

test('the macOS candidates are two, and are joined with POSIX separators', () => {
  const roots = bundleRoots({ platform: 'darwin', env: {}, homedir: '/Users/dev' });
  assert.deepEqual(roots, [
    '/Users/dev/Library/Application Support/OpenAI/Codex',
    '/Applications/Codex.app/Contents/Resources',
  ]);
  for (const dir of bundleBinDirs({ platform: 'darwin', env: {}, homedir: '/Users/dev' })) {
    assert.ok(dir.endsWith('/bin'), dir);
    assert.ok(!dir.includes('\\'), dir);
  }
});

test('Linux has no Codex desktop app, so the search is PATH and nothing else', () => {
  assert.deepEqual(bundleRoots({ platform: 'linux', env: {}, homedir: '/home/dev' }), []);
});

// ---------------------------------------------------------------------------
// PATH
// ---------------------------------------------------------------------------

test('findOnPath tries the spawnable extensions on Windows and the bare name on POSIX', () => {
  const win = findOnPath('codex', {
    platform: 'win32',
    env: { PATH: 'C:\\a;C:\\b' },
    isFile: (p) => p === 'C:\\b\\codex.exe',
  });
  assert.equal(win, 'C:\\b\\codex.exe');

  const posix = findOnPath('codex', {
    platform: 'linux',
    env: { PATH: '/usr/bin:/usr/local/bin' },
    isFile: (p) => p === '/usr/local/bin/codex',
  });
  assert.equal(posix, '/usr/local/bin/codex');

  assert.equal(findOnPath('codex', { platform: 'linux', env: {}, isFile: () => true }), null);
});

test('a codex.cmd on PATH is NOT chosen — Node cannot start a batch shim without a shell', () => {
  // MEASURED: `npm i -g @openai/codex` installs `codex`, `codex.ps1` and
  // `codex.cmd` and no `.exe`, so `codex` IS on PATH on the reference machine
  // — as a shim. `spawn()` throws EINVAL on it (CVE-2024-27980), and this
  // adapter cannot answer that with `cmd.exe` the way `core/editor.mjs` does:
  // a session id and a turn of user text reach `send()` from a request body.
  const NPM = 'C:\\Users\\dev\\AppData\\Roaming\\npm';
  const shim = `${NPM}\\codex.cmd`;
  const machine = { ...windowsMachine(), env: { ...windowsMachine().env, PATH: NPM } };
  const withShim = { ...machine, isFile: (p) => p === shim || p === NEW_BUILD || p === OLD_BUILD };

  assert.equal(findOnPath('codex', withShim), null, 'a .cmd must not be chosen');

  const bin = resolveCodexBinary(withShim);
  assert.equal(bin.command, NEW_BUILD, 'the bundled .exe is used instead');
  assert.equal(bin.source, 'bundled');
  // Carried out rather than dropped, so the report can say why the app's copy
  // beat the one the user installed themselves.
  assert.equal(bin.shimOnPath, shim);
});

test('a shim is only ever reported on Windows — POSIX has no such thing', () => {
  const bin = resolveCodexBinary({
    platform: 'linux',
    env: { PATH: '/usr/bin' },
    homedir: '/home/dev',
    isFile: (p) => p === '/usr/bin/codex',
  });
  assert.equal(bin.command, '/usr/bin/codex');
  assert.equal(bin.shimOnPath, null);
});

// ---------------------------------------------------------------------------
// The bundled copy
// ---------------------------------------------------------------------------

test('the bundled copy is found under bin/<hash>/, and the NEWEST build wins', () => {
  // The hash directory changes when the app updates and the previous one is
  // left behind, so "whichever readdir returned first" would pin DeckHQ to the
  // old build — a bug that only appears after an update.
  assert.equal(findBundledCodex(windowsMachine()), NEW_BUILD);
  assert.equal(
    findBundledCodex(windowsMachine({ mtimes: { [OLD_BUILD]: 900, [NEW_BUILD]: 1 } })),
    OLD_BUILD,
  );
});

test('a hash directory holding something else (rg.exe) contributes nothing', () => {
  assert.equal(findBundledCodex(windowsMachine({ files: [] })), null);
});

test('an unreadable or absent bundle directory is not an error', () => {
  assert.equal(
    findBundledCodex({
      platform: 'win32',
      env: { LOCALAPPDATA: LOCAL },
      isFile: () => false,
      readdir: () => {
        throw new Error('EPERM');
      },
    }),
    null,
  );
});

// ---------------------------------------------------------------------------
// The order
// ---------------------------------------------------------------------------

test('the reference machine: nothing on PATH, so the bundled CLI is what runs', () => {
  const bin = resolveCodexBinary(windowsMachine());
  assert.equal(bin.command, NEW_BUILD);
  assert.equal(bin.source, 'bundled');
  assert.equal(bin.pinProblem, null);
});

test('a codex on PATH beats the copy hidden inside the app', () => {
  const machine = windowsMachine();
  const onPath = 'C:\\Users\\dev\\AppData\\Roaming\\npm\\codex.exe';
  const bin = resolveCodexBinary({
    ...machine,
    env: { ...machine.env, PATH: 'C:\\Users\\dev\\AppData\\Roaming\\npm' },
    isFile: (p) => p === onPath || p === NEW_BUILD || p === OLD_BUILD,
  });
  assert.equal(bin.command, onPath);
  assert.equal(bin.source, 'path');
});

test('a pinned codexBin beats both', () => {
  const machine = windowsMachine();
  const pinned = 'D:\\tools\\codex.exe';
  const bin = resolveCodexBinary({
    ...machine,
    pinned,
    isFile: (p) => p === pinned || p === NEW_BUILD,
  });
  assert.equal(bin.command, pinned);
  assert.equal(bin.source, 'pinned');
});

test('a pin that is no longer a file is reported, not silently replaced', () => {
  // `resolveEditor` refuses rather than opening a different program when the
  // user named one; the same rule, one step softer — the search continues so
  // the product still works, but the pin is carried out for the message.
  const bin = resolveCodexBinary({ ...windowsMachine(), pinned: 'D:\\gone\\codex.exe' });
  assert.equal(bin.pinProblem, 'D:\\gone\\codex.exe');
  assert.equal(bin.command, NEW_BUILD);
  assert.equal(bin.source, 'bundled');
});

test('a machine with no Codex anywhere resolves nothing, and says where it looked', () => {
  const bin = resolveCodexBinary({
    platform: 'win32',
    env: { LOCALAPPDATA: LOCAL, PATH: 'C:\\Windows' },
    isFile: () => false,
    readdir: () => [],
  });
  assert.equal(bin.command, null);
  assert.equal(bin.source, null);
  assert.deepEqual(bin.bundleDirs, [BUNDLE_BIN]);
});

// ---------------------------------------------------------------------------
// The message that used to be a lie
// ---------------------------------------------------------------------------

test('the failure names the bundle directory and never claims Codex is not installed', () => {
  const bin = resolveCodexBinary({
    platform: 'win32',
    env: { LOCALAPPDATA: LOCAL, PATH: 'C:\\Windows' },
    isFile: () => false,
    readdir: () => [],
  });
  const message = describeMissingBinary(bin);
  assert.match(message, /codex binary not found/);
  assert.match(message, /the app's bundled copy was looked for at/);
  assert.ok(message.includes(BUNDLE_BIN), message);
  // The whole point of §136.1: this sentence must not be the old one.
  assert.ok(!/not installed/i.test(message), message);
});

test('the failure says when the only codex on PATH is a shim it refused to run', () => {
  const NPM = 'C:\\Users\\dev\\AppData\\Roaming\\npm';
  const shim = `${NPM}\\codex.cmd`;
  const bin = resolveCodexBinary({
    platform: 'win32',
    env: { LOCALAPPDATA: LOCAL, PATH: NPM },
    isFile: (p) => p === shim,
    readdir: () => [],
  });
  assert.equal(bin.command, null);
  const message = describeMissingBinary(bin);
  assert.match(message, /the only codex on your PATH is .*codex\.cmd, a batch shim/);
  assert.ok(!/codex is not on your PATH/.test(message), message);
});

test('a broken pin is named in the failure too', () => {
  const bin = resolveCodexBinary({
    platform: 'linux',
    env: { PATH: '/usr/bin' },
    homedir: '/home/dev',
    pinned: '/opt/gone/codex',
    isFile: () => false,
  });
  const message = describeMissingBinary(bin);
  assert.match(message, /codexBin setting points at \/opt\/gone\/codex, which is not a file/);
  // Linux has no bundle, so the message does not invent one to have looked in.
  assert.ok(!message.includes('bundled copy'), message);
});
