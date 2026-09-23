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
 *
 * **WP-70 moved the loop and left the meaning.** The debounce, the `fs.watch`
 * and the poll behind it are `src/core/watch-path.mjs` now, because WP-70's
 * handover watch needs the same three things over a DIRECTORY and a second
 * copy of them would have been a second set of timing bugs. What stayed here
 * is the only part that was ever about a transcript: finding the session's
 * file, reading its tail, and deciding whether the CONVERSATION moved.
 */

import fsp from 'node:fs/promises';
import { splitAgentId } from '../../core/model.mjs';
import { watchPath, WATCH_DEBOUNCE_MS, WATCH_POLL_MS } from '../../core/watch-path.mjs';
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

export { WATCH_DEBOUNCE_MS, WATCH_POLL_MS };

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
 * `fs.watch` is used where it works and a poll takes over where it does not;
 * `watchPath` is where both of those live, and a session with no transcript
 * on disk is watched for one appearing, so opening the panel on a session
 * that has not written yet still comes alive when it does.
 *
 * Never throws.
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

  /** null until the first read has taken the baseline. */
  let lastDigest = null;

  const stop = await watchPath({
    resolve: () => findSessionFile(sessionId),
    stamp: async (file) => {
      const info = await fsp.stat(file);
      return `${info.mtimeMs}:${info.size}`;
    },
    tick: async (file) => {
      const tail = await readTail(file, WATCH_TAIL_BYTES);
      const messages = parseConversation(tail, { maxMessages: 200 });
      const last = messages[messages.length - 1] || null;
      const digest = `${messages.length}:${last ? last.at : 0}:${last ? last.text.length : 0}`;
      if (digest === lastDigest) return;
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
    },
    pollMs,
    debounceMs,
  });

  // A session with nothing on disk yet still has a baseline: the empty
  // conversation. So the transcript APPEARING is a change and does wake the
  // panel, which is what opening the card on a session that has not written
  // yet has to do.
  if (lastDigest === null) lastDigest = '0:0:0';

  return stop;
}
