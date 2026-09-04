/**
 * The tripwire under the suite's fake home.
 *
 * `scripts/test.mjs` plants an empty home in a temp directory, points every
 * variable the product derives a path from at it, and preloads this file into
 * every process in the run — the runner, the process `node --test` gives each
 * test file, and every child those tests spawn, because `NODE_OPTIONS` is
 * inherited. From then on, a test that reads the "home directory" reads the
 * canary rather than the developer's, and this file writes down that it did.
 *
 * That makes the property in `docs/DEVIATIONS.md` §121.4 checkable rather than
 * asserted: the run fails if any file under the canary home was touched, and
 * the log names the function, the path and the frame that did it. A read of a
 * path that does not exist counts — an attempt is the defect, not a hit.
 *
 * CommonJS on purpose. `--require` is the one preload mechanism available on
 * every Node this project supports (`--import` landed in 18.18), and patching
 * the properties of `require('node:fs')` reaches ESM importers too: `import fs
 * from 'node:fs'` and `require('fs')` are the same object.
 *
 * It is inert unless `DECKHQ_CANARY_HOME` and `DECKHQ_CANARY_LOG` are both
 * set, so preloading it into an unrelated process costs a few microseconds and
 * changes nothing.
 */
'use strict';

const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const path = require('node:path');
const url = require('node:url');

const HOME = process.env.DECKHQ_CANARY_HOME;
const LOG = process.env.DECKHQ_CANARY_LOG;

if (HOME && LOG && !fs.__deckhqCanaryInstalled) install();

function install() {
  // Captured before anything is patched: the recorder must not go through a
  // wrapper, or a write to the log would be a read to be recorded.
  const appendFileSync = fs.appendFileSync;

  const win = process.platform === 'win32';
  const root = win ? path.resolve(HOME).toLowerCase() : path.resolve(HOME);
  const rootWithSep = root + path.sep;

  /**
   * Is this argument a path inside the canary home? Accepts everything `fs`
   * accepts as a path — string, Buffer, file URL — and answers false for a
   * file descriptor, which is a number and was opened through a call that was
   * already recorded.
   */
  function inside(p) {
    let s = p;
    if (Buffer.isBuffer(s)) s = s.toString('utf8');
    else if (s instanceof URL || (s && typeof s === 'object' && typeof s.href === 'string')) {
      try {
        s = url.fileURLToPath(s);
      } catch {
        return false;
      }
    }
    if (typeof s !== 'string' || s === '') return false;
    let resolved;
    try {
      resolved = path.resolve(s);
    } catch {
      return false;
    }
    if (win) resolved = resolved.toLowerCase();
    return resolved === root || resolved.startsWith(rootWithSep);
  }

  /** The first frame that is not this file and not node internals. */
  function blame() {
    const lines = String(new Error('canary').stack || '').split('\n');
    for (const line of lines.slice(1)) {
      if (line.includes('canary.cjs')) continue;
      if (line.includes('node:internal')) continue;
      return line.trim();
    }
    return '(no frame)';
  }

  function record(fn, p) {
    try {
      appendFileSync(
        LOG,
        JSON.stringify({
          fn,
          path: String(p),
          pid: process.pid,
          argv: process.argv.slice(1),
          frame: blame(),
        }) + '\n',
        'utf8',
      );
    } catch {
      // A recorder that throws would turn a reporting problem into a test
      // failure somewhere unrelated. The run's own audit catches an empty log
      // only if nothing was read, which is the outcome we want anyway.
    }
  }

  /**
   * Every `fs` entry point whose first argument is a path. Both halves are
   * here — reading the canary is the defect this hunts, and writing into it is
   * the same defect with a worse blast radius.
   */
  const NAMES = [
    'access',
    'appendFile',
    'chmod',
    'copyFile',
    'cp',
    'lstat',
    'mkdir',
    'open',
    'opendir',
    'readFile',
    'readdir',
    'readlink',
    'realpath',
    'rename',
    'rm',
    'rmdir',
    'stat',
    'statfs',
    'symlink',
    'truncate',
    'unlink',
    'utimes',
    'writeFile',
  ];

  /** @param {object} obj @param {string} name */
  function wrap(obj, name, label) {
    const original = obj?.[name];
    if (typeof original !== 'function') return;
    /** @this {any} */
    function wrapped(...args) {
      if (inside(args[0])) record(label, args[0]);
      return original.apply(this, args);
    }
    Object.defineProperty(wrapped, 'name', { value: name });
    // `fs.realpath.native` and friends hang off the function itself.
    for (const key of Object.keys(original)) wrapped[key] = original[key];
    try {
      obj[name] = wrapped;
    } catch {
      // A non-writable property is one we cannot cover; nothing else breaks.
    }
  }

  for (const name of NAMES) {
    wrap(fs, name, `fs.${name}`);
    wrap(fs, `${name}Sync`, `fs.${name}Sync`);
    wrap(fs.promises, name, `fsp.${name}`);
    if (fsPromises !== fs.promises) wrap(fsPromises, name, `fsp.${name}`);
  }
  for (const name of [
    'existsSync',
    'createReadStream',
    'createWriteStream',
    'watch',
    'watchFile',
  ]) {
    wrap(fs, name, `fs.${name}`);
  }

  Object.defineProperty(fs, '__deckhqCanaryInstalled', { value: true, enumerable: false });
}
