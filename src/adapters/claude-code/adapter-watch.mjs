/**
 * Watching one transcript for new lines (WP-22 follow-up).
 *
 * Split out of `adapter.mjs` unchanged. WP-09's tail watch: a debounced
 * `fs.watch` with a poll behind it for the platforms where watching a file
 * is unreliable, reading only the last few kilobytes so a long conversation
 * costs the same as a short one.
 *
 * It reads a file and pushes a digest. That is the whole of it — a watch is
 * passive by construction.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { splitAgentId } from '../../core/model.mjs';
import { readTail, parseConversation } from './parse.mjs';
import { findSessionFile } from './adapter-send.mjs';

/**
 * How much of the tail one watch tick re-reads. Much smaller than
 * `TAIL_BYTES`: this runs on every write to a live transcript, and all it has
 * to answer is "has the conversation moved". 256 KB is several hundred turns
 * on the transcripts on this machine, and the panel re-fetches the full
 * bounded conversation through /api/conversation once told.
 */
export const WATCH_TAIL_BYTES = 256 * 1024;

/** Quiet period after a change before the tail is read. */
export const WATCH_DEBOUNCE_MS = 150;

/** How often the fallback poll stats the file when `fs.watch` is unusable. */
export const WATCH_POLL_MS = 1000;

/**
 * Watch one session's transcript and say when its CONVERSATION changed.
 *
 * WP-09's second half: a reply typed into a terminal should appear in the
 * open panel without the browser polling for it. The daemon already re-scans
 * every few seconds, but a scan is a whole-floor operation with a summary
 * cache behind it — it is not, and should not become, a per-keystroke feed
 * for one open card.
 *
 * Two things this deliberately does NOT do:
 *
 *  - It never sends the messages. It sends a digest, and the panel re-reads
 *    /api/conversation. A transcript is appended to for reasons that are not
 *    conversation — token accounting, `custom-title` records, tool results —
 *    and pushing parsed text on every one of those would put a second,
 *    divergent copy of the conversation on the wire beside the one the panel
 *    already fetches.
 *  - It touches no state at all. It is a read of a file (THE INVARIANT,
 *    docs/01-PRODUCT.md §2): nothing here can clear a review debt, and the
 *    events it emits reach only the client that asked for them.
 *
 * `fs.watch` is used where it works and a poll takes over where it does not:
 * it throws on some network and container filesystems, and on those it
 * throws at `watch()` time, which is where the fallback is installed.
 *
 * Never throws. A session with no transcript on disk is watched for one
 * appearing, so opening the panel on a session that has not written yet
 * still comes alive when it does.
 *
 * @param {string} id agent id, runtime-prefixed
 * @param {{onChange?:(digest:{at:number, count:number, lastRole:string|null})=>void,
 *          pollMs?:number, debounceMs?:number}} [opts] `onChange` is what a
 *   caller wants, but it is optional at runtime — the `= {}` default and the
 *   `typeof onChange === 'function'` guard both say so (WP-22).
 * @returns {Promise<() => void>} a stop function; calling it twice is safe.
 */
export async function watchConversation(id, { onChange, pollMs, debounceMs } = {}) {
  const { sessionId } = splitAgentId(id);
  const quiet = Number.isFinite(debounceMs) ? debounceMs : WATCH_DEBOUNCE_MS;
  const interval = Number.isFinite(pollMs) ? pollMs : WATCH_POLL_MS;

  let stopped = false;
  /** @type {import('node:fs').FSWatcher|null} */
  let watcher = null;
  let poll = null;
  let debounce = null;
  let reading = false;
  let again = false;
  /** null until the first read has taken the baseline. */
  let lastDigest = null;
  let file = await findSessionFile(sessionId);

  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (debounce) clearTimeout(debounce);
    if (poll) clearInterval(poll);
    try {
      watcher?.close();
    } catch {
      // already closed
    }
    watcher = null;
    poll = null;
    debounce = null;
  };

  async function read() {
    if (stopped || !file) return;
    if (reading) {
      again = true;
      return;
    }
    reading = true;
    try {
      const tail = await readTail(file, WATCH_TAIL_BYTES);
      const messages = parseConversation(tail, { maxMessages: 200 });
      const last = messages[messages.length - 1] || null;
      const digest = `${messages.length}:${last ? last.at : 0}:${last ? last.text.length : 0}`;
      if (digest !== lastDigest) {
        const baseline = lastDigest === null;
        lastDigest = digest;
        // The conversation as it already stands is not news: the panel just
        // fetched it. Only what happens NEXT is worth waking it for.
        if (!baseline && typeof onChange === 'function') {
          try {
            onChange({
              at: last ? last.at : 0,
              count: messages.length,
              lastRole: last ? last.role : null,
            });
          } catch {
            // A listener's failure is not the watcher's to propagate.
          }
        }
      }
    } catch {
      // An unreadable transcript is not an error here; the next tick retries.
    } finally {
      reading = false;
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
      read();
    }, quiet);
    if (typeof debounce.unref === 'function') debounce.unref();
  }

  function attach() {
    if (stopped || !file || watcher) return;
    try {
      watcher = fs.watch(file, { persistent: false }, () => schedule());
      watcher.on('error', () => {
        // The file was rotated or the platform gave up on the handle. The
        // poll below is still running and takes over from here.
        try {
          watcher?.close();
        } catch {
          // already closed
        }
        watcher = null;
      });
    } catch {
      watcher = null; // fs.watch is unusable here; the poll is the whole answer
    }
  }

  // The poll runs alongside `fs.watch` rather than instead of it. It is one
  // `stat` a second on one file, and it is what closes the two gaps the
  // watcher leaves: a filesystem that reports nothing, and a transcript that
  // does not exist yet when the panel opens.
  let lastStamp = '';
  poll = setInterval(async () => {
    if (stopped) return;
    if (!file) {
      file = await findSessionFile(sessionId);
      if (file) {
        attach();
        schedule();
      }
      return;
    }
    try {
      const info = await fsp.stat(file);
      const stamp = `${info.mtimeMs}:${info.size}`;
      if (stamp !== lastStamp) {
        lastStamp = stamp;
        schedule();
      }
    } catch {
      // Gone for now — a rotation, or a sync client mid-write. Look again.
      file = null;
      try {
        watcher?.close();
      } catch {
        // already closed
      }
      watcher = null;
    }
  }, interval);
  if (typeof poll.unref === 'function') poll.unref();

  attach();
  // One read up front so `lastDigest` is the conversation as it stands, and
  // the first event the caller sees is a real change rather than the file
  // simply existing.
  await read();
  // A session with nothing on disk yet still has a baseline: the empty
  // conversation. So the transcript APPEARING is a change and does wake the
  // panel, which is what opening the card on a session that has not written
  // yet has to do.
  if (lastDigest === null) lastDigest = '0:0:0';

  return stop;
}
