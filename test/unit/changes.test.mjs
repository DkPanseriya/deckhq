/**
 * "What changed in <project>": the working-tree summary behind GET /api/changes.
 *
 * Real repositories in temp directories, real git. The four shapes the panel
 * has to draw are each pinned: dirty, clean, no repository, and a directory
 * that has gone. Plus git itself being absent, which is simulated by pointing
 * the collector at a binary that does not exist.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  collectChanges,
  createChangesCache,
  parseNumstat,
} from '../../src/http/routes/changes.mjs';

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
  return fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-changes-'));
}

/** A repository on `main` with one commit. */
async function repo() {
  const dir = await tmp();
  git(dir, ['init', '-q', '-b', 'main']);
  await fs.writeFile(path.join(dir, 'a.txt'), 'one\ntwo\nthree\n');
  await fs.writeFile(path.join(dir, 'b.txt'), 'b\n');
  git(dir, ['add', '.']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}

test('parseNumstat reads added/removed per file, binaries and renames', () => {
  const out = ['12\t3\tsrc/a.mjs', '-\t-\timg.png', '0\t0\told.txt\tnew.txt', '', 'garbage'].join(
    '\n',
  );
  assert.deepEqual(parseNumstat(out), [
    { path: 'src/a.mjs', added: 12, removed: 3, binary: false },
    { path: 'img.png', added: null, removed: null, binary: true },
    { path: 'new.txt', added: 0, removed: 0, binary: false },
  ]);
});

test(
  'a dirty repository: unstaged and staged files, totals, and commits ahead of main',
  {
    skip: !gitAvailable,
  },
  async () => {
    const dir = await repo();
    try {
      git(dir, ['checkout', '-q', '-b', 'feature']);
      await fs.writeFile(path.join(dir, 'c.txt'), 'new file\n');
      git(dir, ['add', 'c.txt']);
      git(dir, ['commit', '-q', '-m', 'one ahead']);
      await fs.writeFile(path.join(dir, 'a.txt'), 'one\nTWO\nthree\nfour\n'); // unstaged: +2 -1
      await fs.writeFile(path.join(dir, 'b.txt'), 'B\n'); // staged: +1 -1
      git(dir, ['add', 'b.txt']);

      const c = await collectChanges(dir);
      assert.equal(c.status, 'ok');
      assert.equal(c.branch, 'feature');
      assert.deepEqual(c.files, [{ path: 'a.txt', added: 2, removed: 1, binary: false }]);
      assert.deepEqual(c.staged, [{ path: 'b.txt', added: 1, removed: 1, binary: false }]);
      assert.deepEqual(c.totals, { files: 2, added: 3, removed: 2 });
      assert.deepEqual(c.ahead, { count: 1, base: 'main' });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);

test('a clean repository says so instead of vanishing', { skip: !gitAvailable }, async () => {
  const dir = await repo();
  try {
    const c = await collectChanges(dir);
    assert.equal(c.status, 'clean');
    assert.deepEqual(c.files, []);
    assert.deepEqual(c.staged, []);
    assert.deepEqual(c.totals, { files: 0, added: 0, removed: 0 });
    assert.deepEqual(c.ahead, { count: 0, base: 'main' }, 'on main itself: zero ahead of main');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a directory that is not a repository', { skip: !gitAvailable }, async () => {
  const dir = await tmp();
  try {
    await fs.writeFile(path.join(dir, 'notes.md'), 'hello');
    const c = await collectChanges(dir);
    assert.equal(c.status, 'no-repo');
    assert.deepEqual(c.files, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a directory that has been deleted', async () => {
  const dir = await tmp();
  await fs.rm(dir, { recursive: true, force: true });
  const c = await collectChanges(dir);
  assert.equal(c.status, 'missing');
  assert.deepEqual(c.files, []);
});

test('git not installed is reported, not thrown', async () => {
  const dir = await tmp();
  try {
    const c = await collectChanges(dir, { git: path.join(dir, 'no-such-git-binary') });
    assert.equal(c.status, 'no-git');
    assert.ok(c.error);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the cache answers from memory within one scan and recomputes on the next', async () => {
  let calls = 0;
  const cache = createChangesCache(async (cwd) => {
    calls++;
    return {
      status: 'clean',
      cwd,
      files: [],
      staged: [],
      totals: { files: 0, added: 0, removed: 0 },
      ahead: null,
      branch: null,
    };
  });
  const a1 = await cache.get('/p/a', 1000);
  const a2 = await cache.get('/p/a', 1000);
  assert.equal(a1, a2);
  assert.equal(calls, 1);
  await cache.get('/p/b', 1000);
  assert.equal(calls, 2, 'a different directory is its own entry');
  await cache.get('/p/a', 2000);
  assert.equal(calls, 3, 'a new scan invalidates');
  assert.equal(cache.size(), 2);
});

test('a failed collection is not cached', async () => {
  let calls = 0;
  const cache = createChangesCache(async () => {
    calls++;
    throw new Error('boom');
  });
  await assert.rejects(cache.get('/p/a', 1));
  await assert.rejects(cache.get('/p/a', 1));
  assert.equal(calls, 2);
});
