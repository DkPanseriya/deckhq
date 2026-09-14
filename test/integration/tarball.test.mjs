/**
 * `npx deckhq app` on a cold machine — WP-75.
 *
 * THE FAILURE THIS EXISTS TO CATCH. Every other test in this suite runs the
 * source tree, where every file in the repository is present. What a stranger
 * gets is the tarball, which is `package.json`'s `files` list and nothing
 * else: `scripts/`, `docs/`, `test/`, `plugin/`, `vscode/`, `site/` and
 * `packs/` are all absent. A `src/` module that imports one of them works
 * perfectly here and throws `ERR_MODULE_NOT_FOUND` on the first machine that
 * runs `npx deckhq`. `docs/plan/RELEASE-CHECKLIST.md` step 5 has always asked
 * a human to read the file list; this asks the tarball to run.
 *
 * So: `npm pack` into a temp directory, extract it, and run **the bin the
 * registry would install**, twice —
 *
 *   `--version`        the smallest possible "does it load at all", and it
 *                      reads `package.json` through a URL relative to the bin,
 *                      which is exactly the resolution a flattened install
 *                      breaks.
 *   `app --dry-run`    the command the README now leads with, taken as far as
 *                      it goes without starting anything: it imports the
 *                      daemon-finding half, the adapter registry (for the hook
 *                      ports), `chrome.mjs` and `app-window.mjs`, prints what
 *                      it would start and what it would open, and starts and
 *                      opens neither.
 *
 * ISOLATION. The child processes get `HOME`, `USERPROFILE`, `APPDATA` and
 * `DECKHQ_STATE_DIR` inside this test's own temp root, so `npm` reads no
 * `.npmrc` of the developer's, writes no cache of theirs, and the CLI writes
 * no `~/.deckhq`. The canary (`scripts/test.mjs`) is therefore never touched,
 * and the test-isolation guard stays green.
 *
 * NOTHING IS PUBLISHED and nothing is installed globally: `npm pack` only ever
 * writes one `.tgz`. No process is killed; `--dry-run` starts none to kill.
 */
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

/**
 * How to run npm from here: this Node, running `npm-cli.js`.
 *
 * **Never the `npm` on the PATH.** On Windows that is `npm.cmd`, and from
 * Node 18.20 a batch file may only be spawned with `shell: true` — which puts
 * every argument, including a temp path, through `cmd.exe`'s quoting. This
 * test hands npm a directory to write into, so a shell is exactly what it must
 * not use (`docs/DEVIATIONS.md` §98 is the same lesson from the other side).
 *
 * Three places to look, in order of certainty: the npm that is running this
 * suite (`npm_execpath`, set whenever the suite was started by `npm test`),
 * then the copy shipped beside this Node on each of the two install layouts.
 * A machine with none of them skips the test rather than failing it.
 *
 * @returns {{command:string, args:string[]}|null}
 */
function npmRunner() {
  const candidates = [
    process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(
      path.dirname(path.dirname(process.execPath)),
      'lib',
      'node_modules',
      'npm',
      'bin',
      'npm-cli.js',
    ),
  ];
  for (const candidate of candidates) {
    if (!candidate || !/\.(c|m)?js$/i.test(candidate)) continue;
    try {
      if (fs.statSync(candidate).isFile()) {
        return { command: process.execPath, args: [candidate] };
      }
    } catch {
      // Not there; try the next layout.
    }
  }
  return null;
}

/** `tar` — bsdtar on Windows 10+, GNU or bsd everywhere else. */
function hasTar() {
  const probe = spawnSync('tar', ['--version'], { encoding: 'utf8', windowsHide: true });
  return !probe.error && probe.status === 0;
}

test('`npx deckhq app` works from the tarball, cold', { timeout: 300_000 }, (t) => {
  const npm = npmRunner();
  if (!npm) {
    t.skip('no npm on this machine');
    return;
  }
  if (!hasTar()) {
    t.skip('no tar on this machine');
    return;
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-pack-'));
  const home = path.join(tmp, 'home');
  const stateDir = path.join(home, '.deckhq');
  fs.mkdirSync(stateDir, { recursive: true });

  // A machine of its own for every child: npm's home, the CLI's state
  // directory, and the cache npm would otherwise put in the real one.
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    DECKHQ_STATE_DIR: stateDir,
    npm_config_cache: path.join(tmp, 'npm-cache'),
    npm_config_update_notifier: 'false',
    npm_config_fund: 'false',
    npm_config_audit: 'false',
  };
  delete env.CLAUDE_CONFIG_DIR;
  delete env.DECKHQ_PORT;

  t.after(() => {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      // A temp directory npm still has a handle on. The OS gets it back.
    }
  });

  // 1. Pack.
  const packed = spawnSync(
    npm.command,
    [...npm.args, 'pack', '--pack-destination', tmp, '--loglevel', 'error'],
    { cwd: ROOT, encoding: 'utf8', env, windowsHide: true },
  );
  assert.equal(packed.status, 0, `npm pack failed:\n${packed.stderr}`);

  const tarballs = fs.readdirSync(tmp).filter((n) => n.endsWith('.tgz'));
  assert.equal(tarballs.length, 1, `expected one tarball, got ${tarballs.join(', ') || 'none'}`);
  assert.equal(tarballs[0], `deckhq-${pkg.version}.tgz`);

  // 2. Extract. npm tarballs put everything under `package/`.
  //
  // Relative paths, with the working directory doing the work: the `tar` on a
  // Windows PATH is as likely to be GNU tar from Git for Windows as it is to
  // be the bsdtar in System32, and GNU tar reads `C:\…` as *host* `C`, path
  // `\…` — "Cannot connect to C: resolve failed". A bare filename cannot be
  // mistaken for a host by either of them.
  const extracted = path.join(tmp, 'out');
  fs.mkdirSync(extracted, { recursive: true });
  const untarred = spawnSync('tar', ['-xf', tarballs[0], '-C', 'out'], {
    cwd: tmp,
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(untarred.status, 0, `tar failed:\n${untarred.stderr}`);

  const installed = path.join(extracted, 'package');
  const bin = path.join(installed, pkg.bin.deckhq);
  assert.ok(fs.existsSync(bin), `the tarball has no ${pkg.bin.deckhq}`);

  // The two assets the shortcut installer wraps its icon from are inside the
  // package or `deckhq shortcut --install` degrades to a node.exe icon on
  // every machine that installed from the registry.
  for (const asset of ['public/icon-512.png', 'public/icon-192.png', 'src/core/shortcut.ps1']) {
    assert.ok(fs.existsSync(path.join(installed, asset)), `the tarball has no ${asset}`);
  }

  /** @param {string[]} argv */
  const run = (argv) =>
    spawnSync(process.execPath, [bin, ...argv], {
      cwd: tmp,
      encoding: 'utf8',
      env,
      windowsHide: true,
      timeout: 60_000,
    });

  // 3. `--version`: it loads, and it can still find its own package.json.
  const version = run(['--version']);
  assert.equal(version.status, 0, `--version failed:\n${version.stderr}`);
  assert.equal(version.stdout.trim(), pkg.version);

  // 4. `app --dry-run`: the whole command's import graph, and no side effect.
  const dry = run(['app', '--dry-run']);
  assert.equal(dry.status, 0, `app --dry-run failed:\n${dry.stderr}${dry.stdout}`);
  assert.equal(dry.stderr.trim(), '', `app --dry-run wrote to stderr:\n${dry.stderr}`);
  assert.match(dry.stdout, /--dry-run: nothing below was started, opened or written\./);
  assert.match(dry.stdout, /Daemon:/);
  assert.match(dry.stdout, /Window:/);

  // And it means it: no browser profile, no shortcut record, no daemon file.
  const wrote = fs.existsSync(stateDir) ? fs.readdirSync(stateDir) : [];
  assert.deepEqual(wrote, [], `app --dry-run wrote ${wrote.join(', ')} into the state directory`);

  // 5. `--dry-run` is documented where a reader will look for it.
  const help = run(['app', '--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--dry-run/);
  assert.match(help.stdout, /--no-pin/);
});
