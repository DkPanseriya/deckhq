/**
 * One path watched, debounced, with a poll behind it — WP-70.
 *
 * This is the transcript watcher's plumbing, lifted out of
 * `src/adapters/claude-code/adapter-watch.mjs` unchanged in behaviour and
 * given a second caller. WP-09 wrote it for one transcript; WP-70 needs the
 * same three things for `<project>/.deckhq/studio/handovers/`, and the honest
 * way to have them is to stand on the loop that already exists rather than
 * start a second one somewhere else in the tree.
 *
 * The three things, and why each is here:
 *
 *   1. **`fs.watch`, where it works.** It is the only part of this that is
 *      free. It also throws outright on some network and container
 *      filesystems, and it throws at `watch()` time, which is where the
 *      fallback is installed.
 *   2. **A debounce.** A writer writes a file in several `write()` calls and
 *      a watcher sees every one of them. The quiet period is what turns a
 *      burst into one tick.
 *   3. **A poll behind both.** One `stat` a second, comparing a caller's own
 *      stamp, which closes the two gaps the watcher leaves: a filesystem that
 *      reports nothing, and a target that DOES NOT EXIST YET when the watch
 *      starts. A handover directory is empty on every project until an agent
 *      writes into it, and a transcript does not exist until the session
 *      writes its first line.
 *
 * It reads and it calls back. That is the whole of it — a watch is passive by
 * construction (`docs/01-PRODUCT.md` §2): nothing here writes, and what a
 * caller does on a tick is the caller's business and is held by the caller's
 * own tests.
 */

import fs from 'node:fs';

/** Quiet period after a change before the tick is taken. */
export const WATCH_DEBOUNCE_MS = 150;

/** How often the fallback poll stats the target when `fs.watch` is unusable. */
export const WATCH_POLL_MS = 1000;

/**
 * Watch one file or one directory and call `tick` when it changes.
 *
 * `resolve` is asked for the target, and asked AGAIN by the poll whenever the
 * target is missing — a file that has not been written yet, a directory that
 * has not been made yet, a transcript that was rotated away. So a watch
 * started on nothing comes alive when the thing appears, which is what
 * opening a panel on a session that has not written has to do, and what a
 * project whose first handover is still to come has to do.
 *
 * `tick` is called once up front, with the target, before this resolves —
 * that is the caller's baseline. It is called again on every debounced change
 * and never concurrently with itself; a change that arrives while one is
 * running schedules exactly one more.
 *
 * Never throws, and never lets a caller's failure out: a listener that throws
 * is a listener's problem, and a watch that died of one would take a silent
 * feature with it.
 *
 * @param {{resolve:() => (string|null|Promise<string|null>),
 *          stamp:(target:string) => (string|Promise<string>),
 *          tick:(target:string) => (void|Promise<void>),
 *          pollMs?:number, debounceMs?:number}} opts
 * @returns {Promise<() => void>} a stop function; calling it twice is safe.
 */
export async function watchPath(opts) {
  const quiet = Number.isFinite(opts.debounceMs) ? Number(opts.debounceMs) : WATCH_DEBOUNCE_MS;
  const interval = Number.isFinite(opts.pollMs) ? Number(opts.pollMs) : WATCH_POLL_MS;

  let stopped = false;
  /** @type {import('node:fs').FSWatcher|null} */
  let watcher = null;
  /** @type {any} */
  let poll = null;
  /** @type {any} */
  let debounce = null;
  let running = false;
  let again = false;
  /** @type {string|null} */
  let target = await resolveTarget();

  async function resolveTarget() {
    try {
      const found = await opts.resolve();
      return found ? String(found) : null;
    } catch {
      return null;
    }
  }

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (debounce) clearTimeout(debounce);
    if (poll) clearInterval(poll);
    detach();
    poll = null;
    debounce = null;
  };

  function detach() {
    try {
      watcher?.close();
    } catch {
      // already closed
    }
    watcher = null;
  }

  async function run() {
    if (stopped || !target) return;
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      await opts.tick(target);
    } catch {
      // A tick's failure is not the watch's to propagate; the next one retries.
    } finally {
      running = false;
      if (again && !stopped) {
        again = false;
        schedule();
      }
    }
  }

  function schedule() {
    if (stopped) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = null;
      void run();
    }, quiet);
    if (typeof debounce.unref === 'function') debounce.unref();
  }

  function attach() {
    if (stopped || !target || watcher) return;
    try {
      watcher = fs.watch(target, { persistent: false }, () => schedule());
      watcher.on('error', () => {
        // Rotated away, or the platform gave up on the handle. The poll below
        // is still running and takes over from here.
        detach();
      });
    } catch {
      watcher = null; // `fs.watch` is unusable here; the poll is the whole answer
    }
  }

  let lastStamp = '';
  poll = setInterval(async () => {
    if (stopped) return;
    if (!target) {
      target = await resolveTarget();
      if (target) {
        attach();
        schedule();
      }
      return;
    }
    try {
      const stamp = String(await opts.stamp(target));
      if (stamp !== lastStamp) {
        lastStamp = stamp;
        schedule();
      }
    } catch {
      // Gone for now — a rotation, or a sync client mid-write. Look again.
      target = null;
      detach();
    }
  }, interval);
  if (typeof poll.unref === 'function') poll.unref();

  attach();
  // One tick up front, so the caller's first EVENT is a real change rather
  // than the target simply existing.
  await run();

  return stop;
}
