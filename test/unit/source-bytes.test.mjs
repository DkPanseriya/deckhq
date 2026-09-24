/**
 * No source file carries a raw NUL byte.
 *
 * `public/floor-rule.js` once used a literal U+0000 as a map-key separator, and
 * so did three modules under `src/core/`. It worked, and it made `grep` call
 * each of those files "Binary file ... matches" — a file that content search and
 * a reviewer's tools quietly skip. The separator is written `'\u0000'` now, which
 * is the same string at run time and plain text on disk.
 *
 * The walk covers every text file the repository ships or runs — sources, tests,
 * scripts, docs and config — and skips only what is not ours or not text.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Text a person or a tool reads as source. Images, icons and fonts are not. */
const TEXT = /\.(?:m?js|cjs|ts|json|md|css|html|svg|ya?ml|txt|sh|ps1)$/i;

/** Not ours (dependencies), not in the public tree (`internal/`), or not source. */
const SKIP_DIRS = new Set(['node_modules', '.git', '.claude', 'internal', 'coverage', 'dist']);

/**
 * @param {string} dir
 * @returns {AsyncGenerator<string>}
 */
async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) yield* walk(full);
    } else if (e.isFile() && TEXT.test(e.name)) {
      yield full;
    }
  }
}

test('no text file in the repository contains a raw NUL byte', async () => {
  /** @type {string[]} */
  const offenders = [];
  let seen = 0;
  for await (const file of walk(REPO)) {
    seen++;
    const bytes = await readFile(file);
    if (bytes.includes(0)) offenders.push(path.relative(REPO, file).split(path.sep).join('/'));
  }
  assert.ok(seen > 100, `the walk found only ${seen} files; it is looking in the wrong place`);
  assert.deepEqual(offenders, [], 'write a NUL separator as the escape \\u0000, not the byte');
});
