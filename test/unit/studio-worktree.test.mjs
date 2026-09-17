/**
 * The worktree launcher — WP-68, `docs/07-STUDIO-DESIGN.md` §4, §8 and §10.
 *
 * Acceptance criterion (2) lives here: **`git worktree` takes an argv array,
 * and a role name with a space, a quote or a `;` is refused rather than
 * escaped.** Both halves are asserted directly — the argv as an array, element
 * by element, and each refusal by its own named reason, because "invalid role
 * name" is not something a user can act on.
 *
 * Criterion (4) — *firing leaves the worktree and the process alone, and says
 * so* — is `describeFire()`, which is a pure function and is asserted as one.
 *
 * Every git call here runs against a REAL repository in a temp directory made
 * by this file, never the developer's own. One test uses a recording stand-in
 * instead, so the argv can be read even on a machine with no git at all.
 */
import { scratchDir } from '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const {
  addWorktreeArgv,
  branchFor,
  checkRoleName,
  describeFire,
  ensureWorktree,
  projectSlug,
  runGit,
  worktreePathFor,
  worktreesDirFor,
} = await import('../../src/studio/worktree.mjs');

/** A real repository with one commit, in a temp directory. */
async function repo(prefix = 'studio-wt-') {
  const dir = scratchDir(prefix);
  const root = path.join(dir, 'orbital');
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'README.md'), '# orbital\n', 'utf8');
  const run = async (argv) => {
    const out = await runGit(argv, { cwd: root });
    assert.equal(out.code, 0, `git ${argv.join(' ')}: ${out.stderr}`);
  };
  await run(['init', '-q']);
  await run(['config', 'user.email', 'test@example.invalid']);
  await run(['config', 'user.name', 'Test']);
  await run(['add', 'README.md']);
  await run(['commit', '-qm', 'first']);
  return { dir, root, dataDir: path.join(dir, 'state') };
}

/** A git that records instead of running, for the argv assertions. */
function recorder(answers = {}) {
  /** @type {string[][]} */
  const calls = [];
  const git = async (argv) => {
    calls.push([...argv]);
    const key = argv.slice(0, 2).join(' ');
    if (key in answers) return answers[key];
    return { code: 0, stdout: '', stderr: '' };
  };
  return { git, calls };
}

// ---------------------------------------------------------------------------
// The refusal
// ---------------------------------------------------------------------------

test('ACCEPTANCE: a role name with a space, a quote or a ";" is refused, each by its own reason', () => {
  const cases = [
    ['Backend engineer', 'role-space', /carries a space/],
    ['back"end', 'role-quote', /carries a quote/],
    ["back'end", 'role-quote', /carries a quote/],
    ['backend;whoami', 'role-semicolon', /carries a ";"/],
    ['--force', 'role-leading-dash', /git would read as an option/],
    ['back/end', 'role-separator', /path separator/],
    ['back\\end', 'role-separator', /path separator/],
    ['..', 'role-dots', /carries ".."/],
    ['backend', 'role-control', /control character/],
    ['', 'role-empty', /a role needs a name/],
    ['a'.repeat(65), 'role-length', /longer than 64/],
    ['back$end', 'role-charset', /outside letters, digits/],
  ];
  for (const [name, reason, message] of cases) {
    const result = checkRoleName(name);
    assert.ok('error' in result, `"${name}" was accepted`);
    assert.equal(result.reason, reason, name);
    assert.match(result.error, message, name);
    // Refused, not escaped: the message says to rename, and nothing in it
    // offers a quoted form of what was typed.
    assert.match(result.error, /Rename the role/);
  }
});

test('an ordinary role name is accepted, unchanged', () => {
  for (const name of ['backend', 'api-2', 'Reviewer', 'front_end', 'v1.2']) {
    assert.deepEqual(checkRoleName(name), { name });
  }
});

// ---------------------------------------------------------------------------
// The argv
// ---------------------------------------------------------------------------

test('ACCEPTANCE: the worktree argv is an array, element by element, with no shell anywhere', async () => {
  const dataDir = path.join(scratchDir('studio-wt-argv-'), 'state');
  const root = path.join(dataDir, '..', 'orbital');
  fs.mkdirSync(root, { recursive: true });
  const { git, calls } = recorder({
    // No branch yet, so `-b` is what the add carries.
    'show-ref --verify': { code: 1, stdout: '', stderr: '' },
  });

  const made = await ensureWorktree(root, 'backend', { dataDir, git });
  const expected = path.join(dataDir, 'worktrees', 'orbital-backend');
  assert.equal(made.path, expected);
  assert.equal(made.branch, 'studio/backend');
  assert.equal(made.created, true);
  assert.equal(made.newBranch, true);

  assert.deepEqual(made.argv, ['worktree', 'add', expected, '-b', 'studio/backend']);
  assert.deepEqual(calls.at(-1), ['worktree', 'add', expected, '-b', 'studio/backend']);
  for (const element of /** @type {string[]} */ (made.argv)) {
    assert.equal(typeof element, 'string');
    assert.equal(/[|&;><`$]/.test(element), false, element);
  }

  // And the questions it asked first, in order, each one also an array.
  assert.deepEqual(calls[0], ['rev-parse', '--git-dir']);
  assert.deepEqual(calls[1], ['worktree', 'list', '--porcelain']);
  assert.deepEqual(calls[2], ['show-ref', '--verify', '--quiet', 'refs/heads/studio/backend']);
});

test('a branch that already exists is checked out rather than re-created', () => {
  const p = path.join('x', 'orbital-backend');
  assert.deepEqual(addWorktreeArgv(p, 'studio/backend', { newBranch: false }), [
    'worktree',
    'add',
    p,
    'studio/backend',
  ]);
});

test('the path and the branch are pure functions of the project and the role', () => {
  assert.equal(projectSlug('/tmp/Orbital API'), 'orbital-api');
  assert.equal(projectSlug('/'), 'project');
  assert.equal(branchFor('backend'), 'studio/backend');
  assert.equal(
    worktreePathFor('/state', '/tmp/orbital', 'backend'),
    path.join(path.resolve('/state'), 'worktrees', 'orbital-backend'),
  );
  assert.equal(worktreesDirFor('/state'), path.join(path.resolve('/state'), 'worktrees'));
});

// ---------------------------------------------------------------------------
// Against a real git
// ---------------------------------------------------------------------------

test('a real worktree is created, and hiring the same role again reuses it', async () => {
  const { root, dataDir } = await repo();

  const first = await ensureWorktree(root, 'backend', { dataDir });
  assert.equal(first.created, true);
  assert.equal(first.reused, false);
  assert.equal(fs.existsSync(path.join(first.path, 'README.md')), true);

  const branches = await runGit(['branch', '--list', 'studio/backend'], { cwd: root });
  assert.match(branches.stdout, /studio\/backend/);

  // Idempotent, and it says which it was.
  const again = await ensureWorktree(root, 'backend', { dataDir });
  assert.equal(again.path, first.path);
  assert.equal(again.created, false);
  assert.equal(again.reused, true);
  assert.equal(again.argv, null);

  // One worktree, not two.
  const list = await runGit(['worktree', 'list', '--porcelain'], { cwd: root });
  const paths = list.stdout.split('\n').filter((l) => l.startsWith('worktree '));
  assert.equal(paths.length, 2, list.stdout); // the repository itself, and ours
});

test('three roles get three worktrees and three branches', async () => {
  const { root, dataDir } = await repo();
  for (const role of ['backend', 'frontend', 'reviewer']) {
    const made = await ensureWorktree(root, role, { dataDir });
    assert.equal(made.created, true);
    assert.equal(made.branch, `studio/${role}`);
  }
  const made = fs.readdirSync(path.join(dataDir, 'worktrees')).sort();
  assert.deepEqual(made, ['orbital-backend', 'orbital-frontend', 'orbital-reviewer']);
});

test('a directory that is not our worktree is never written into', async () => {
  const { root, dataDir } = await repo();
  const squatter = worktreePathFor(dataDir, root, 'backend');
  fs.mkdirSync(squatter, { recursive: true });
  fs.writeFileSync(path.join(squatter, 'mine.txt'), 'not yours\n', 'utf8');

  await assert.rejects(
    () => ensureWorktree(root, 'backend', { dataDir }),
    (err) => {
      assert.equal(err.reason, 'occupied');
      assert.match(err.message, /will not write into a directory it did not make/);
      return true;
    },
  );
  assert.equal(fs.readFileSync(path.join(squatter, 'mine.txt'), 'utf8'), 'not yours\n');
});

test('a directory that is not a repository is refused by name', async () => {
  const dir = scratchDir('studio-wt-norepo-');
  const root = path.join(dir, 'plain');
  fs.mkdirSync(root, { recursive: true });
  await assert.rejects(
    () => ensureWorktree(root, 'backend', { dataDir: path.join(dir, 'state') }),
    (err) => {
      assert.equal(err.reason, 'not-a-repo');
      assert.match(err.message, /is not a git repository/);
      return true;
    },
  );
});

test('a refused role name never reaches git', async () => {
  const { git, calls } = recorder();
  await assert.rejects(
    () => ensureWorktree('/tmp/orbital', 'back end', { dataDir: '/state', git }),
    (err) => {
      assert.equal(err.reason, 'role-space');
      return true;
    },
  );
  assert.deepEqual(calls, []);
});

// ---------------------------------------------------------------------------
// Fire
// ---------------------------------------------------------------------------

test('ACCEPTANCE: firing leaves the worktree and the process alone, and says so', async () => {
  const { root, dataDir } = await repo();
  const made = await ensureWorktree(root, 'backend', { dataDir });
  fs.writeFileSync(path.join(made.path, 'work.txt'), 'an agent wrote this\n', 'utf8');

  const told = describeFire({ role: 'backend', worktree: made.path, branch: made.branch });
  assert.equal(told.removedWorktree, false);
  assert.equal(told.removedBranch, false);
  assert.equal(told.stoppedProcess, false);
  assert.equal(told.worktree, made.path);
  assert.match(told.note, /untouched/);
  assert.match(told.note, /does not signal a process it did not start/);
  // Named, never run.
  assert.deepEqual(told.youCouldRun, ['git', 'worktree', 'remove', made.path]);

  // And the disk agrees: the directory, the file in it and the branch are all
  // still there after the description.
  assert.equal(fs.readFileSync(path.join(made.path, 'work.txt'), 'utf8'), 'an agent wrote this\n');
  const branches = await runGit(['branch', '--list', 'studio/backend'], { cwd: root });
  assert.match(branches.stdout, /studio\/backend/);
});
