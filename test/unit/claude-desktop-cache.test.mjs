/**
 * The desktop app's session store, seen through its per-file cache.
 *
 * `readDesktopSessions()` runs on every poll, forever, so its result is cached
 * per file and keyed by `(path, mtime, size)` — the same invalidation rule as
 * `src/core/summary-cache.mjs` (docs/DEVIATIONS.md §78).
 *
 * The two properties that matter, and the reason the cache is here rather than
 * folded into the summary cache: a cache hit is indistinguishable from a fresh
 * read, and an archive flip is seen on the very next call, because archiving
 * rewrites the file this cache is keyed on. `archived` drives `let_go`, so a
 * stale `true` re-fires an agent the user rehired, on every poll, forever
 * (§46, §68).
 *
 * `desktopSessionsDir()` reads the environment on every call, not at import
 * time, so unlike test/unit/claude-scan-cache.test.mjs these run in-process —
 * which is also what lets them count the reads that did and did not happen.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  readDesktopSessions,
  clearDesktopCache,
  desktopCacheStats,
  desktopCacheSize,
} from '../../src/adapters/claude-code/desktop.mjs';

const CLI_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLI_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/**
 * A throwaway store, laid out the way the app really lays one out:
 * `<root>/<install>/<profile>/local_<id>.json`.
 */
async function makeStore() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-desktop-'));
  const dir = path.join(root, 'install-1', 'profile-1');
  await fsp.mkdir(dir, { recursive: true });
  process.env.DECKHQ_DESKTOP_SESSIONS_DIR = root;
  clearDesktopCache();
  return { root, dir };
}

async function cleanup(store) {
  delete process.env.DECKHQ_DESKTOP_SESSIONS_DIR;
  clearDesktopCache();
  await fsp.rm(store.root, { recursive: true, force: true });
}

/**
 * @param {{dir:string}} store
 * @param {string} name
 * @param {object} record
 * @returns {string} the file written
 */
function write(store, name, record) {
  const file = path.join(store.dir, name);
  fs.writeFileSync(file, JSON.stringify(record), 'utf8');
  return file;
}

/** Pin a file's mtime, so (mtime, size) can be varied one at a time. */
function setMtime(file, seconds) {
  const when = new Date(seconds * 1000);
  fs.utimesSync(file, when, when);
}

/** Reads performed by the call `fn` makes. */
function readsDuring(fn) {
  const before = desktopCacheStats.reads;
  const value = fn();
  return { value, reads: desktopCacheStats.reads - before };
}

// --------------------------------------------------------------------------

test('every joinable file is read and keyed by cliSessionId', async () => {
  const store = await makeStore();
  try {
    write(store, 'local_a.json', {
      sessionId: 'local_a',
      cliSessionId: CLI_A,
      isArchived: true,
      title: 'Archived one',
    });
    write(store, 'local_b.json', { sessionId: 'local_b', cliSessionId: CLI_B, isArchived: false });

    const map = readDesktopSessions();
    assert.equal(map.size, 2);
    assert.deepEqual(map.get(CLI_A), { archived: true, title: 'Archived one' });
    assert.deepEqual(map.get(CLI_B), { archived: false, title: undefined });
  } finally {
    await cleanup(store);
  }
});

test('a second call with nothing changed opens no files at all', async () => {
  const store = await makeStore();
  try {
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: true });
    write(store, 'local_b.json', { cliSessionId: CLI_B, isArchived: false });

    const cold = readsDuring(readDesktopSessions);
    assert.equal(cold.reads, 2, 'the first call reads both');

    const warm = readsDuring(readDesktopSessions);
    assert.equal(warm.reads, 0, 'the second reads neither');
    assert.equal(desktopCacheStats.hits, 2);

    // And it is the same answer, not a cheaper one.
    assert.deepEqual([...warm.value.entries()], [...cold.value.entries()]);
  } finally {
    await cleanup(store);
  }
});

test('INVARIANT: archiving is seen on the very next call', async () => {
  const store = await makeStore();
  try {
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: false });
    assert.equal(readDesktopSessions().get(CLI_A).archived, false);

    // What the app does when the user archives: it rewrites this file. The
    // summary cache cannot see this happen — archiving never touches the
    // transcript — which is exactly why the flag is cached here instead.
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: true });
    const after = readsDuring(readDesktopSessions);
    assert.equal(after.reads, 1, 're-read, not served from the cache');
    assert.equal(after.value.get(CLI_A).archived, true);

    // And back again: a rehire is not stickier than a firing.
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: false });
    assert.equal(readDesktopSessions().get(CLI_A).archived, false);
  } finally {
    await cleanup(store);
  }
});

test('a file whose mtime moved but whose size did not is re-read', async () => {
  const store = await makeStore();
  try {
    // Same length, different content, so size alone cannot notice.
    const file = write(store, 'local_a.json', { cliSessionId: CLI_A, title: 'aaa' });
    setMtime(file, 1_700_000_000);
    assert.equal(readDesktopSessions().get(CLI_A).title, 'aaa');

    write(store, 'local_a.json', { cliSessionId: CLI_A, title: 'bbb' });
    setMtime(file, 1_700_000_060);
    assert.equal(
      fs.statSync(file).size,
      JSON.stringify({ cliSessionId: CLI_A, title: 'aaa' }).length,
    );

    const after = readsDuring(readDesktopSessions);
    assert.equal(after.reads, 1);
    assert.equal(after.value.get(CLI_A).title, 'bbb');
  } finally {
    await cleanup(store);
  }
});

test('a file whose size moved but whose mtime did not is re-read', async () => {
  const store = await makeStore();
  try {
    const file = write(store, 'local_a.json', { cliSessionId: CLI_A, title: 'aaa' });
    setMtime(file, 1_700_000_000);
    assert.equal(readDesktopSessions().get(CLI_A).title, 'aaa');

    // A longer title, then the mtime pinned back to where it was — the case a
    // coarse filesystem timestamp would otherwise hide.
    write(store, 'local_a.json', { cliSessionId: CLI_A, title: 'aaaa' });
    setMtime(file, 1_700_000_000);

    const after = readsDuring(readDesktopSessions);
    assert.equal(after.reads, 1);
    assert.equal(after.value.get(CLI_A).title, 'aaaa');
  } finally {
    await cleanup(store);
  }
});

test('INVARIANT: the caller is handed a copy, never the cached object', async () => {
  const store = await makeStore();
  try {
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: false });

    const first = readDesktopSessions();
    // A caller doing what the adapter is one edit away from doing. If this
    // reached the cache, the file would never be re-read to correct it — the
    // §68 copy-out bug, in the one place where the flag actually lives.
    first.get(CLI_A).archived = true;

    const second = readDesktopSessions();
    assert.equal(desktopCacheStats.hits, 1, 'served from the cache, so nothing re-read it');
    assert.equal(second.get(CLI_A).archived, false);
  } finally {
    await cleanup(store);
  }
});

test('a deleted file loses its entry, and the rest survive', async () => {
  const store = await makeStore();
  try {
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: true });
    const b = write(store, 'local_b.json', { cliSessionId: CLI_B, isArchived: false });
    assert.equal(readDesktopSessions().size, 2);
    assert.equal(desktopCacheSize(), 2);

    fs.rmSync(b);
    const after = readsDuring(readDesktopSessions);
    assert.equal(after.reads, 0, 'the survivor is still a hit');
    assert.equal(after.value.size, 1);
    assert.equal(after.value.has(CLI_B), false);
    assert.equal(desktopCacheSize(), 1, 'and the dead entry is gone, not accumulating');
  } finally {
    await cleanup(store);
  }
});

test('a store directory that reads as empty does not empty the cache', async () => {
  const store = await makeStore();
  try {
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: true });
    assert.equal(readDesktopSessions().size, 1);

    // An unreadable or momentarily missing store returns the same empty
    // listing as "the app deleted everything". Treating the two the same
    // would throw a good cache away and buy a re-read of 8 MB next poll.
    process.env.DECKHQ_DESKTOP_SESSIONS_DIR = path.join(store.root, 'not-here');
    assert.equal(readDesktopSessions().size, 0);
    assert.equal(desktopCacheSize(), 1);

    process.env.DECKHQ_DESKTOP_SESSIONS_DIR = store.root;
    const back = readsDuring(readDesktopSessions);
    assert.equal(back.reads, 0);
    assert.equal(back.value.get(CLI_A).archived, true);
  } finally {
    await cleanup(store);
  }
});

test('an unusable file yields no entry, does not condemn the rest, and is not re-read', async () => {
  const store = await makeStore();
  try {
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: true });
    fs.writeFileSync(path.join(store.dir, 'broken.json'), '{"cliSessionId": "aaa', 'utf8');
    // Well-formed JSON, but not this store's shape — the app is free to keep
    // other files in here, and free to change the format entirely.
    write(store, 'foreign.json', { somethingElse: true });

    const cold = readsDuring(readDesktopSessions);
    assert.equal(cold.value.size, 1);
    assert.equal(cold.value.get(CLI_A).archived, true);
    assert.equal(cold.reads, 3);

    // The failures are remembered too, so a store full of files this adapter
    // cannot use does not re-parse them all on every poll forever.
    const warm = readsDuring(readDesktopSessions);
    assert.equal(warm.reads, 0);
    assert.equal(warm.value.size, 1);
  } finally {
    await cleanup(store);
  }
});

test('a file repaired after a bad parse is picked up', async () => {
  const store = await makeStore();
  try {
    const file = path.join(store.dir, 'local_a.json');
    fs.writeFileSync(file, '{"cliSessionId": "aaa', 'utf8'); // caught mid-write
    assert.equal(readDesktopSessions().size, 0);

    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: true });
    const after = readsDuring(readDesktopSessions);
    assert.equal(after.reads, 1);
    assert.equal(after.value.get(CLI_A).archived, true);
  } finally {
    await cleanup(store);
  }
});

test('nested install/profile directories are still walked', async () => {
  const store = await makeStore();
  try {
    const deeper = path.join(store.root, 'install-2', 'profile-9');
    fs.mkdirSync(deeper, { recursive: true });
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: false });
    fs.writeFileSync(
      path.join(deeper, 'local_b.json'),
      JSON.stringify({ cliSessionId: CLI_B, isArchived: true }),
      'utf8',
    );

    const map = readDesktopSessions();
    assert.equal(map.size, 2);
    assert.equal(map.get(CLI_B).archived, true);
  } finally {
    await cleanup(store);
  }
});
