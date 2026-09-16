/**
 * A temp root a `Store` may be pointed at, and the teardown that waits for it.
 *
 * THE RACE THIS EXISTS TO END (`docs/DEVIATIONS.md` §185). `Store.save()` is
 * debounced by 250 ms, so a test that mutates a store and then removes the
 * directory underneath it is racing its own state file. The loser is reported
 * two different ways depending on who wins:
 *
 *   POSIX   the write lands after the directory is gone —
 *           `[store] error failed to write /tmp/deckhq-…/state.json … ENOENT`,
 *           which sets `store.writeError`, which the next assertion reads.
 *   Windows the write lands while `rm` is walking the directory —
 *           `ENOTEMPTY: directory not empty, rmdir …`, which fails the test
 *           outright from the teardown line.
 *
 * Both are the same bug, and it is the test's, not the store's: the daemon
 * calls `flush()` on shutdown precisely so a debounced write is never lost
 * (`src/core/store.mjs`), and a test that tears a root down without doing the
 * same is shutting down wrong. `Store` going on swallowing the failure and
 * counting it in `health` is the behaviour §183 asked for and is not touched
 * here.
 *
 * Why the stores are remembered here rather than passed to the teardown: the
 * tests that hit this make their root in one helper and their stores in ten
 * different test bodies, so the only thing every teardown site has in scope is
 * the directory. Hand each store to `onRoot` where it is made and the root
 * knows what it has to wait for.
 *
 * This module imports nothing from `src/` — the `Store` class comes in as a
 * value — so a test file can use it without disturbing the import order
 * `test/helpers/isolate.mjs` depends on.
 */
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** @type {Map<string, Set<{flush?: () => Promise<void>}>>} dir → stores on it */
const opened = new Map();

/**
 * A fresh temp directory and the state file path inside it.
 *
 * @param {string} [tag] names the directory, so a leaked one says who leaked it
 * @returns {Promise<{dir:string, file:string}>}
 */
export async function storeRoot(tag = 'root') {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `deckhq-${tag}-`));
  opened.set(dir, new Set());
  return { dir, file: path.join(dir, 'state.json') };
}

/**
 * Remember a store so `dropRoot` waits for its debounced write. Returns the
 * store, so it wraps the construction rather than following it.
 *
 * @template T
 * @param {string} dir  a directory from `storeRoot`
 * @param {T} store
 * @returns {T}
 */
export function onRoot(dir, store) {
  const set = opened.get(dir);
  if (set) set.add(/** @type {any} */ (store));
  return store;
}

/**
 * Flush every store opened on this root, then remove it. Safe to call twice,
 * and safe on a root nothing was ever opened on.
 *
 * @param {string} dir
 * @returns {Promise<void>}
 */
export async function dropRoot(dir) {
  for (const store of opened.get(dir) || []) {
    if (typeof store.flush === 'function') await store.flush();
  }
  opened.delete(dir);
  await fsp.rm(dir, { recursive: true, force: true });
}
