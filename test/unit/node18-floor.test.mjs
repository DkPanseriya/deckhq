/**
 * The floor is Node 18 (`package.json` `engines`), and four files stopped
 * respecting it without anyone deciding to raise the floor.
 *
 * CI run 33842703295 failed every Node 18 job — `test/unit/packs.test.mjs`,
 * `test/unit/pack-cli.test.mjs`, `test/unit/replay.test.mjs` and
 * `test/integration/pack-acceptance.test.mjs` — with:
 *
 * ```
 * TypeError [ERR_INVALID_ARG_TYPE]: The "paths[0]" argument must be of type
 * string. Received undefined
 * ```
 *
 * All four computed their own repo root with `import.meta.dirname`, added in
 * Node 20.11. On Node 18 it is `undefined`, so `path.resolve(undefined, ...)`
 * throws before a single test in the file runs — the whole file, not one
 * assertion. Node 20 and 22 (the CI matrix's other two legs) never saw it,
 * which is how it shipped. `docs/DEVIATIONS.md` §130.
 *
 * The fix is the form the rest of the tree already uses — grep for
 * `fileURLToPath` and every hit but these four did it this way already —
 * `path.dirname(fileURLToPath(import.meta.url))`, which has worked since
 * Node 12. This suite is the version of `panel-invariant.test.mjs` and
 * `settings-keys.test.mjs` for that class of defect: it reads the source
 * rather than trusting that the next person who needs a repo root, a sorted
 * copy of an array, or a grouped object reaches for the Node-18-safe spelling
 * on their own. Alongside `import.meta.dirname`/`import.meta.filename`, it
 * bans four more APIs the pack and replay work could plausibly have reached
 * for and that are newer than this package's floor: `Object.groupBy` and
 * `Promise.withResolvers` (Node 21+), `Array.prototype.toSorted` (Node 20+),
 * and `fs.globSync` (Node 22+). None of the four were found — this is a gate
 * against the next one, not a report of a second defect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE_FILE = fileURLToPath(import.meta.url);
const HERE = path.dirname(HERE_FILE);
const ROOT = path.resolve(HERE, '../..');

/** Every source file under `dir`, recursively, skipping VCS and dependency clutter. */
function sourceFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(mjs|js|cjs|ts)$/.test(name)) out.push(full);
  }
  return out;
}

// This file names every banned API in prose above, so it is excluded from
// its own scan rather than taught to tell a mention from a use.
const CODE = ['src', 'scripts', 'packs', 'plugin', 'test']
  .map((dir) => path.join(ROOT, dir))
  .filter((dir) => fs.existsSync(dir))
  .flatMap((dir) => sourceFiles(dir))
  .filter((file) => file !== HERE_FILE);

const BANNED = [
  { name: 'import.meta.dirname', re: /\bimport\.meta\.dirname\b/ },
  { name: 'import.meta.filename', re: /\bimport\.meta\.filename\b/ },
  { name: 'Object.groupBy(', re: /\bObject\.groupBy\s*\(/ },
  { name: 'Promise.withResolvers(', re: /\bPromise\.withResolvers\s*\(/ },
  { name: '.toSorted(', re: /\.toSorted\s*\(/ },
  { name: 'globSync(', re: /\bglobSync\s*\(/ },
];

test(`no file under src/, scripts/, packs/, plugin/ or test/ uses an API newer than Node ${
  JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines.node
}`, () => {
  const offenders = [];
  for (const file of CODE) {
    const src = fs.readFileSync(file, 'utf8');
    for (const { name, re } of BANNED) {
      if (re.test(src)) {
        offenders.push(`${path.relative(ROOT, file).replace(/\\/g, '/')}: ${name}`);
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `these files use an API newer than this package's Node 18 floor:\n${offenders.join('\n')}\n` +
      'import.meta.dirname / import.meta.filename need Node 20.11 — use ' +
      'path.dirname(fileURLToPath(import.meta.url)) instead, per docs/DEVIATIONS.md §130.',
  );
});
