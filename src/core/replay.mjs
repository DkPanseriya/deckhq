/**
 * Floor replay — "watch yesterday". WP-45, and free.
 *
 * ============================================================================
 * WHY THIS IS IN THE FREE CORE AND NOT IN THE SUPPORTER PACK
 *
 * `docs/plan/08-PLAN-V2-100X.md` §5 and `docs/plan/03-BUSINESS-MODEL.md` §5
 * both list floor replay among the Supporter pack's contents. This package
 * puts it in the free core instead, and records the disagreement rather than
 * quietly doing one and writing the other.
 *
 * The reason is rule 2 in `08` §1.1: *paid features are services you opt into,
 * never gates.* A replay is not a service and it is not an asset. It is a
 * READING OF THE USER'S OWN LEDGER — a directory of text files in their own
 * home directory, written by their own machine, describing their own work.
 * Charging for the ability to look at it would be a gate on data the user
 * already owns, which is exactly the shape `08` §14 refuses ("any paywall on
 * capture, the queue or an action") one step removed. The same argument makes
 * `deckhq stats`, the postcard and Wrapped free, and all three read the same
 * files this does.
 *
 * What the pack sells is therefore what an asset pack can honestly sell: more
 * themes and more avatar sets. The rate-card editor moved for the same
 * reason — see `src/http/routes/rates.mjs`.
 * ============================================================================
 *
 * ## What a replay is
 *
 * `reconstructQueue(records, t)` already answers "what needed you at `t`",
 * exactly as the machine recorded it (WP-17's acceptance criterion). A replay
 * is that question asked repeatedly across one day and handed to the page,
 * which draws the floor from it at 60x — one real second per ledger minute,
 * so a working day is about twenty minutes and a scrub across it is instant.
 *
 * ## Frames land on changes, not on a clock
 *
 * The queue only moves when a record says it moved, so a frame is emitted at
 * each timestamp that changes the answer and nowhere else. A quiet hour is
 * one frame, not sixty. That makes the response small (a busy day is tens of
 * frames), makes the scrub exact rather than sampled, and means the client
 * needs no copy of the fold — which matters, because `public/` may never
 * import from `src/`.
 *
 * ## Read-only, and named as such
 *
 * Nothing in this file writes. Nothing in it touches `ackState`, the store,
 * or the registry. It reads a directory of text files and returns numbers.
 * `test/unit/replay.test.mjs` carries the `INVARIANT:` test that says so:
 * a full replay of a day, driven to the end, leaves every acknowledgement
 * exactly where it was. Watching what happened cannot change what happened.
 */
import { dayKey, dayStart, listDays, readAll, reconstructQueue } from './ledger.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How fast a replay runs: one real second per this many ledger milliseconds.
 * 60x is the number `08` §9 names. A working day is ~20 minutes at this rate,
 * and the client can scrub, so nobody has to sit through it.
 */
export const REPLAY_SPEED = 60;

/**
 * Most frames one day may return.
 *
 * A frame is one change in the needs-you queue. A day with more changes than
 * this is a day nobody can watch anyway, so the frames are thinned evenly and
 * the response says it was — a truncated replay that did not admit it would
 * be a replay you could not trust.
 */
export const MAX_FRAMES = 720;

/**
 * The queue at `t`, with the fields the floor needs to draw a person.
 * @typedef {object} ReplayFrame
 * @property {number} t
 * @property {Array<{sessionId:string, projectKey:string, activityState:string, since:number}>} queue
 */

/**
 * Build one day's replay from a set of ledger records.
 *
 * `records` is deliberately EVERY record the ledger holds, not just the day's
 * own file: a session that entered `for_review` on Tuesday is still in
 * Wednesday's queue, and a replay built from Wednesday's file alone would
 * lose it. `reconstructQueue` folds from the beginning and answers at `t`,
 * which is the only definition of the queue this product has.
 *
 * @param {any[]} records
 * @param {{day:string, now?:number}} opts
 * @returns {{day:string, from:number, to:number, speed:number, frames:ReplayFrame[],
 *            thinned:boolean, sessions:number, projects:string[]}}
 */
export function buildReplay(records, opts) {
  const day = String(opts?.day || '');
  const from = dayStart(day);
  if (!Number.isFinite(from)) throw new Error(`"${day}" is not a YYYY-MM-DD day`);
  const now = opts?.now ?? Date.now();
  // A day that has not finished replays up to now, not up to midnight: a
  // scrub bar that ran three hours past the last thing that happened would
  // read as three hours of an empty office.
  const to = Math.min(from + DAY_MS, Math.max(from, now));

  const list = Array.isArray(records) ? records : [];

  // Every moment the day could change at: each record inside the window, plus
  // the window's own start so the replay opens with the queue as it was
  // inherited from yesterday.
  /** @type {number[]} */
  const marks = [from];
  for (const rec of list) {
    const t = Number(rec?.t);
    if (!Number.isFinite(t) || t < from || t > to) continue;
    if (marks[marks.length - 1] !== t) marks.push(t);
  }
  marks.sort((a, b) => a - b);
  /** @type {number[]} */
  const unique = [];
  for (const t of marks) if (unique[unique.length - 1] !== t) unique.push(t);

  let thinned = false;
  /** @type {number[]} */
  let sampled = unique;
  if (unique.length > MAX_FRAMES) {
    thinned = true;
    sampled = [];
    const stride = (unique.length - 1) / (MAX_FRAMES - 1);
    for (let i = 0; i < MAX_FRAMES; i++) sampled.push(unique[Math.round(i * stride)]);
  }

  /** @type {ReplayFrame[]} */
  const frames = [];
  /** @type {string} */
  let lastShape = '';
  const sessions = new Set();
  const projects = new Set();
  for (const t of sampled) {
    const queue = reconstructQueue(list, t);
    // A record that changed something the queue does not show — a token count,
    // a send — must not become a frame that draws the identical floor again.
    const shape = queue.map((q) => `${q.sessionId}:${q.activityState}:${q.since}`).join('|');
    if (frames.length && shape === lastShape) continue;
    lastShape = shape;
    for (const q of queue) {
      sessions.add(q.sessionId);
      projects.add(q.projectKey);
    }
    frames.push({ t, queue });
  }

  return {
    day,
    from,
    to,
    speed: REPLAY_SPEED,
    frames,
    thinned,
    sessions: sessions.size,
    projects: [...projects].sort(),
  };
}

/**
 * The days a replay can be asked for: every day the ledger has a file for,
 * newest first, each with how many records it holds.
 *
 * @param {string} dir
 * @param {{now?:number}} [opts]
 * @returns {Promise<Array<{day:string, from:number, label:string}>>}
 */
export async function replayDays(dir, opts = {}) {
  const now = opts.now ?? Date.now();
  const today = dayKey(now);
  const yesterday = dayKey(now - DAY_MS);
  const days = await listDays(dir);
  return days
    .slice()
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))
    .map((day) => ({
      day,
      from: dayStart(day),
      // "Yesterday" is the name the feature has in the palette, so it is the
      // name the row has in the list. Everything older is its own date; a
      // relative label like "6 days ago" would be a second clock to be wrong
      // about at a day boundary.
      label: day === today ? 'today' : day === yesterday ? 'yesterday' : day,
    }));
}

/**
 * One day's replay, read from a ledger directory. The route's whole body.
 *
 * @param {string} dir
 * @param {{day:string, now?:number}} opts
 */
export async function readReplay(dir, opts) {
  const records = await readAll(dir);
  return buildReplay(records, opts);
}
