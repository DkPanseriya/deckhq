/**
 * GET /api/diff — the unified diff for one file (WP-47).
 *
 * Real repositories in temp directories, real git, and the same five shapes
 * `changes.test.mjs` pins one level up: dirty, clean, no repository, no git,
 * and a directory that has gone — plus the two this route adds, a path that
 * resolves outside the repository and a diff past the cap.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_DIFF_BYTES,
  capDiff,
  collectFileDiff,
  createDiffCache,
  resolveInRepo,
} from '../../src/http/routes/diff.mjs';

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'DeckHQ Test',
  GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'DeckHQ Test',
  GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};

let gitAvailable = true;
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' });
} catch {
  gitAvailable = false;
}

/** @param {string} cwd @param {string[]} args */
const git = (cwd, args) => execFileSync('git', args, { cwd, env: GIT_ENV, stdio: 'pipe' });

async function tmp() {
  return fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-diff-'));
}

/** A repository on `main` with one commit and a file in a subdirectory. */
async function repo() {
  const dir = await tmp();
  git(dir, ['init', '-q', '-b', 'main']);
  await fs.mkdir(path.join(dir, 'src'), { recursive: true });
  await fs.writeFile(path.join(dir, 'src', 'a.txt'), 'one\ntwo\nthree\n');
  await fs.writeFile(path.join(dir, 'b.txt'), 'b\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

test('resolveInRepo confines a client path to the repository, and refuses rather than clamps', () => {
  const root = path.resolve(os.tmpdir(), 'deckhq-fake-repo');
  assert.equal(resolveInRepo(root, 'src/a.txt'), path.join(root, 'src', 'a.txt'));
  assert.equal(resolveInRepo(root, './src/../src/a.txt'), path.join(root, 'src', 'a.txt'));
  for (const bad of [
    '',
    '..',
    '../secret.txt',
    'src/../../secret.txt',
    path.resolve(os.tmpdir(), 'elsewhere', 'secret.txt'),
    'a\0.txt',
  ]) {
    assert.equal(resolveInRepo(root, bad), null, `${JSON.stringify(bad)} should be refused`);
  }
});

test('capDiff cuts on a line boundary and says so', () => {
  const small = 'diff --git a/x b/x\n+one\n';
  assert.deepEqual(capDiff(small), {
    text: small,
    truncated: false,
    bytes: Buffer.byteLength(small),
  });

  const line = '+' + 'x'.repeat(79) + '\n';
  const big = line.repeat(Math.ceil((MAX_DIFF_BYTES * 1.5) / line.length));
  const capped = capDiff(big);
  assert.equal(capped.truncated, true);
  assert.equal(capped.bytes, Buffer.byteLength(big));
  assert.ok(Buffer.byteLength(capped.text) <= MAX_DIFF_BYTES);
  assert.ok(capped.text.endsWith('\n'), 'the cut lands on a line boundary');
  // Every line that survived is whole.
  for (const l of capped.text.split('\n').filter(Boolean)) assert.equal(l.length, 80);
});

test(
  'a dirty repository: the unstaged and the staged diff for one file',
  { skip: !gitAvailable },
  async () => {
    const dir = await repo();
    try {
      await fs.writeFile(path.join(dir, 'src', 'a.txt'), 'one\nTWO\nthree\nfour\n');
      await fs.writeFile(path.join(dir, 'b.txt'), 'B\n');
      git(dir, ['add', 'b.txt']);

      const a = await collectFileDiff(dir, 'src/a.txt');
      assert.equal(a.status, 'ok');
      assert.equal(a.file, 'src/a.txt');
      assert.match(a.unstaged.text, /^diff --git a\/src\/a\.txt b\/src\/a\.txt$/m);
      assert.match(a.unstaged.text, /^-two$/m);
      assert.match(a.unstaged.text, /^\+TWO$/m);
      assert.match(a.unstaged.text, /^\+four$/m);
      assert.equal(a.unstaged.truncated, false);
      assert.equal(a.staged.text, '', 'a.txt has nothing staged');

      const b = await collectFileDiff(dir, 'b.txt');
      assert.equal(b.status, 'ok');
      assert.equal(b.unstaged.text, '', 'b.txt is entirely staged');
      assert.match(b.staged.text, /^\+B$/m);

      // One file's diff never leaks another's.
      assert.doesNotMatch(a.unstaged.text, /b\.txt/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);

test(
  'the cwd may be a subdirectory of the repository, and paths stay top-level relative',
  { skip: !gitAvailable },
  async () => {
    const dir = await repo();
    try {
      await fs.writeFile(path.join(dir, 'src', 'a.txt'), 'one\nTWO\nthree\n');
      // `git diff --numstat` reports `src/a.txt` even from inside `src`, so
      // that is the path the panel's rows carry and the path this route must
      // accept from any cwd inside the repository.
      const out = await collectFileDiff(path.join(dir, 'src'), 'src/a.txt');
      assert.equal(out.status, 'ok');
      assert.equal(out.file, 'src/a.txt');
      assert.match(out.unstaged.text, /^\+TWO$/m);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);

test('a clean repository answers "empty", not an error', { skip: !gitAvailable }, async () => {
  const dir = await repo();
  try {
    const out = await collectFileDiff(dir, 'b.txt');
    assert.equal(out.status, 'empty');
    assert.equal(out.unstaged.text, '');
    assert.equal(out.staged.text, '');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test(
  'a path outside the repository is refused, never clamped',
  { skip: !gitAvailable },
  async () => {
    const dir = await repo();
    const outside = await tmp();
    try {
      await fs.writeFile(path.join(outside, 'secret.txt'), 'do not diff me\n');
      for (const attempt of [
        '../secret.txt',
        'src/../../secret.txt',
        path.join(outside, 'secret.txt'),
      ]) {
        const out = await collectFileDiff(dir, attempt);
        assert.equal(out.status, 'outside', `${attempt} should be refused`);
        assert.equal(out.unstaged.text, '');
        assert.equal(out.staged.text, '');
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
      await fs.rm(outside, { recursive: true, force: true });
    }
  },
);

test('a directory that is not a repository, and one that is gone', async () => {
  const plain = await tmp();
  try {
    const out = await collectFileDiff(plain, 'a.txt');
    assert.equal(out.status, gitAvailable ? 'no-repo' : 'no-git');

    const gone = path.join(plain, 'never-existed');
    const missing = await collectFileDiff(gone, 'a.txt');
    assert.equal(missing.status, 'missing');
  } finally {
    await fs.rm(plain, { recursive: true, force: true });
  }
});

test('git missing from PATH is its own outcome, not a crash', async () => {
  const dir = await tmp();
  try {
    const out = await collectFileDiff(dir, 'a.txt', { git: 'definitely-not-git-deckhq' });
    assert.equal(out.status, 'no-git');
    assert.ok(out.error, 'the reason is reported');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a diff past the cap comes back truncated', { skip: !gitAvailable }, async () => {
  const dir = await repo();
  try {
    const big = Array.from({ length: 12000 }, (_, i) => `line ${i} ${'y'.repeat(40)}`).join('\n');
    await fs.writeFile(path.join(dir, 'src', 'a.txt'), big + '\n');
    const out = await collectFileDiff(dir, 'src/a.txt');
    assert.equal(out.status, 'ok');
    assert.equal(out.unstaged.truncated, true);
    assert.ok(Buffer.byteLength(out.unstaged.text) <= MAX_DIFF_BYTES);
    assert.ok(out.unstaged.bytes > MAX_DIFF_BYTES, 'the real size is still reported');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the cache answers per scan, per file', async () => {
  let calls = 0;
  const cache = createDiffCache(async (cwd, file) => {
    calls++;
    return { status: 'ok', cwd, file, unstaged: {}, staged: {} };
  });
  await cache.get('/p', 'a.txt', 1);
  await cache.get('/p', 'a.txt', 1);
  assert.equal(calls, 1, 'the same scan and the same file is one spawn');
  await cache.get('/p', 'b.txt', 1);
  assert.equal(calls, 2, 'a different file in the same scan is its own entry');
  await cache.get('/p', 'a.txt', 2);
  assert.equal(calls, 3, 'a new scan re-reads');
});

test('a failed read is not cached', async () => {
  let calls = 0;
  const cache = createDiffCache(async () => {
    calls++;
    throw new Error('boom');
  });
  await assert.rejects(() => cache.get('/p', 'a.txt', 1));
  await assert.rejects(() => cache.get('/p', 'a.txt', 1));
  assert.equal(calls, 2);
});
