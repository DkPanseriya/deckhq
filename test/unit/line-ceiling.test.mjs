/**
 * I-11, WP-22's 900-line ceiling — over EVERY file, and with a table saying
 * which ones are allowed over it, why, and what will bring them under.
 *
 * The gate this replaces walked eighteen prefix GROUPS — `public/render/plan*`,
 * `public/app*`, `src/core/state-machine*` — and so checked 129 of the 282
 * non-test modules. Every one of them passed, and every one of the eight files
 * actually over the ceiling was outside every group, so the honest statement was:
 * *the ceiling was enforced over the files that had already been split, and over
 * nothing else.* `public/render/themes.js` was not exempt at 1,430 lines; it was
 * simply never in a glob. `docs/plan/13-ARCHITECTURE-AUDIT.md` §1.4 and finding
 * A-02; `docs/DEVIATIONS.md` §180.
 *
 * So: a walk of every non-test `.js`/`.mjs`/`.cjs` file under the four roots
 * below, a dated exemption table, and the rule that **an exemption goes stale
 * loudly**. A file that has since dropped under the ceiling fails here until its
 * row is deleted, which is what stops the table becoming a place to hide.
 *
 * The ceiling is 900. It does not move.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** WP-22's number, quoted in `docs/02-ARCHITECTURE.md` and in every split since. */
const CEILING = 900;

/**
 * The roots walked. `src/` and `public/` are the product; `scripts/` and
 * `site/` are the tooling that gates and publishes it, and both hold files over
 * the ceiling, so leaving them out would be the same hole in a smaller shape.
 *
 * Not walked: `test/` (a test file's length is its fixtures), and `bin/`,
 * `plugin/` and `vscode/`, which are separate artifacts with their own release
 * channels — the largest file in all three is 352 lines, so this is a scope
 * decision rather than an exemption.
 */
const ROOTS = ['src', 'public', 'scripts', 'site'];

/**
 * THE EXEMPTION TABLE — opened 16 September 2026 (WP-92b).
 *
 * One row per file allowed over the ceiling. `at` is the length the day the row
 * was written, as a record rather than an assertion; `splitBy` names the package
 * that will bring the file under, or `'permanent'` when a rule that outranks the
 * ceiling keeps it large. A row with no reason a person can read is not an
 * exemption, it is a shrug.
 *
 * @type {Record<string, {at:number, dated:string, splitBy:string, reason:string}>}
 */
const EXEMPT = {
  'src/adapters/claude-code/parse.mjs': {
    at: 978,
    dated: '2026-09-16',
    splitBy: 'permanent',
    reason:
      "docs/02-ARCHITECTURE.md §2.1: all of one runtime's file-format knowledge lives in one " +
      'file per adapter, so that a format change has exactly one place to be wrong. That rule ' +
      'outranks the ceiling, and this is the one file on this table with a documented reason to ' +
      'be large.',
  },
  'src/adapters/codex/adapter.mjs': {
    at: 939,
    dated: '2026-09-16',
    splitBy: 'permanent',
    reason:
      'One adapter, the four methods docs/02-ARCHITECTURE.md §2 names, and the degrade-to-empty ' +
      'promise every one of them must keep on a machine with no Codex (§135, §136.1). The ' +
      'length is the I/O — directory walking, bounded reads, child processes — and splitting it ' +
      'would put half of one contract in another file. The format knowledge is already out, in ' +
      './parse.mjs.',
  },
  'public/render/clips.js': {
    at: 903,
    dated: '2026-09-16',
    splitBy: 'permanent',
    reason:
      'One coherent thing: every motion clip, as keyframe data over one Pose type ' +
      '(docs/03-VISUAL-SPEC.md §4 is its source of truth). It is a table, not a program — pure ' +
      'data and pure functions, no DOM — and a table split in two is two tables that can ' +
      'disagree.',
  },
  'scripts/goldens.mjs': {
    at: 1073,
    dated: '2026-09-16',
    splitBy: 'permanent',
    reason:
      'One coherent thing: the visual gate, end to end — Chrome, one demo daemon per capture, ' +
      'the deadlines that make a hang say where it hung, and the comparison. It is tooling, it ' +
      'ships in no package, and its testable half (the verdict) is already out in ' +
      'scripts/lib/goldens-gate.mjs and scripts/lib/png.mjs.',
  },
  'site/build.mjs': {
    at: 1324,
    dated: '2026-09-16',
    splitBy: 'permanent',
    reason:
      'One coherent thing: the whole site generator, written instead of a dependency (P-05). It ' +
      'ships in no package and runs once per release.',
  },
};

/**
 * Every non-test source file under `dir`, as repo-relative POSIX paths.
 * Written out rather than using `readdir`'s `recursive` option, which Node 18
 * only grew at 18.17 and CI runs 18, 20 and 22.
 * @param {string} dir absolute
 * @returns {Promise<string[]>}
 */
async function walk(dir) {
  /** @type {string[]} */ const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // `.out` is the goldens harness's scratch directory; it is gitignored and
      // holds no source. Nothing else under these roots is hidden.
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      out.push(...(await walk(full)));
    } else if (/\.(m|c)?js$/.test(entry.name) && !/\.test\.(m|c)?js$/.test(entry.name)) {
      out.push(path.relative(REPO, full).split(path.sep).join('/'));
    }
  }
  return out;
}

/** Every file the ceiling applies to, walked once and shared by the tests below. */
const sources = (await Promise.all(ROOTS.map((r) => walk(path.join(REPO, r))))).flat().sort();

/**
 * Line count the way every WP-22 split has counted it: `split('\n').length`,
 * which is one more than the newline count for a file that ends in one.
 * @param {string} rel
 */
async function linesOf(rel) {
  return (await readFile(path.join(REPO, rel), 'utf8')).split('\n').length;
}

test('the walk reaches every source file under the four roots', async () => {
  // A walk that silently found nothing would make every assertion below vacuous.
  assert.ok(sources.length >= 260, `expected the whole tree, walked ${sources.length} files`);
  for (const rel of ['src/core/model.mjs', 'public/app.js', 'public/render/plan.js']) {
    assert.ok(sources.includes(rel), `${rel} is not in the walk`);
  }
  assert.ok(
    !sources.some((f) => f.includes('/.') || f.startsWith('test/')),
    'the walk reached something it should not have',
  );
});

test(`I-11: every file under ${ROOTS.join(', ')} is at or under ${CEILING} lines, or exempt`, async () => {
  /** @type {string[]} */ const over = [];
  for (const rel of sources) {
    if (rel in EXEMPT) continue;
    const lines = await linesOf(rel);
    if (lines > CEILING) over.push(`${rel} is ${lines} lines`);
  }
  assert.deepEqual(
    over,
    [],
    `over WP-22's ceiling of ${CEILING} with no row in EXEMPT:\n  ${over.join('\n  ')}`,
  );
});

test('every exemption names a file that exists, a date, a reason and what will split it', () => {
  for (const [rel, row] of Object.entries(EXEMPT)) {
    assert.ok(sources.includes(rel), `EXEMPT names ${rel}, which the walk does not reach`);
    assert.match(row.dated, /^\d{4}-\d{2}-\d{2}$/, `${rel} has no date`);
    assert.ok(row.reason.length > 60, `${rel}'s reason is too short to be a reason`);
    assert.ok(
      row.splitBy === 'permanent' || /^WP-\d+[a-z]?$/.test(row.splitBy),
      `${rel} must name the package that will split it, or say 'permanent'`,
    );
    assert.equal(typeof row.at, 'number');
  }
});

test('an exemption cannot outlive the file it exempts', async () => {
  // The rule that stops the table rotting: a file that has since come under the
  // ceiling fails here until its row is deleted. Without it, a row written once
  // would go on excusing a file that no longer needs excusing — which is how a
  // table becomes a place to hide rather than a record.
  for (const rel of Object.keys(EXEMPT)) {
    const lines = await linesOf(rel);
    assert.ok(
      lines > CEILING,
      `${rel} is ${lines} lines and no longer needs an exemption — delete its row from EXEMPT`,
    );
  }
});

test('WP-22: the modules that were split are still split', async () => {
  // The walk above proves nothing is over the ceiling; it cannot prove a split
  // HAPPENED. This is the other half, and it is the original gate's list:
  // [directory, filename prefix, how many modules that split produced].
  const root = path.join(REPO, 'public');
  const groups = [
    [path.join(root, 'render'), 'plan', 8],
    [root, 'app', 11],
    [root, 'panel', 14],
    [path.join(root, 'render'), 'scene', 9],
    [path.join(root, 'render'), 'rig', 7],
    [path.join(REPO, 'src', 'core'), 'ledger', 7],
    [path.join(root, 'render'), 'backdrop', 6],
    [path.join(root, 'render'), 'agents', 5],
    [path.join(root, 'render'), 'palette', 4],
    [path.join(root, 'render'), 'look', 4],
    [path.join(REPO, 'src', 'core'), 'packs', 4],
    [path.join(REPO, 'src', 'core'), 'terminals', 3],
    [path.join(REPO, 'src', 'cli'), 'doctor', 4],
    [path.join(REPO, 'src', 'adapters', 'claude-code'), 'adapter', 6],
    [path.join(REPO, 'src', 'adapters', 'claude-code'), 'hooks', 4],
    [path.join(REPO, 'src', 'core'), 'state-machine', 7],
    [root, 'settings-ui', 4],
    [path.join(REPO, 'scripts'), 'demo', 4],
  ];
  let checked = 0;
  for (const [dir, prefix, min] of groups) {
    const files = (await readdir(dir)).filter(
      (f) => f.startsWith(prefix) && /\.m?js$/.test(f) && !f.endsWith('.test.mjs'),
    );
    assert.ok(
      files.length >= min,
      `${dir}/${prefix}* did not split into the modules it should have`,
    );
    checked += files.length;
  }
  assert.ok(checked >= 110, `expected the whole split, saw ${checked} files`);
});
