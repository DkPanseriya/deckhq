/**
 * The daemon's clock, in one place, with one override.
 *
 * WHY THIS EXISTS. The goldens (`docs/DEVIATIONS.md` §87) photograph a demo
 * floor whose every value is supposed to be a pure function of the population
 * name. Every value except one: the ages. "2d 7h", "oldest 4d 10h", the
 * waiting badges and the idle list's "last active" are all computed against
 * the real clock from timestamps seeded against the real clock, so a committed
 * PNG matched only on the day it was captured. A `goldens:check` on any later
 * day failed on clock-derived TEXT — which is noise that hides the signal the
 * gate exists for (§144 recorded exactly that: seven populations failing
 * identically before and after a package that touched none of the canvas).
 *
 * So the clock becomes injectable. `DECKHQ_NOW=<ISO instant>` pins it, exactly
 * the way `DECKHQ_STATE_DIR` moves the state directory: an environment
 * override with no flag, no setting and no effect at all when it is absent.
 *
 * WHAT IT IS FOR. A test or a demo — the goldens harness sets it, and
 * `scripts/demo-floor.mjs` seeds its fixture against it. It is deliberately
 * NOT documented as a user-facing feature: pinning a daemon's clock makes
 * every age on a real floor a lie, and there is no reason anybody would want
 * that outside a capture.
 *
 * WHAT IT PINS, AND WHAT IT MUST NOT. Only *model* time reads this: the
 * instants that are written into the snapshot, and the comparisons that turn
 * one of those into a state or an age. Elapsed-time machinery keeps
 * `Date.now()` — throttles, cache TTLs, request deadlines, retry backoff,
 * temp and backup filenames, and above all the `signedAt` on a ledger export
 * or a pack signature, which is an attestation about the real world and must
 * never be forgeable by an environment variable.
 *
 * WHY THE ENVIRONMENT IS RE-READ RATHER THAN RESOLVED ONCE. `paths.mjs`
 * resolves `DECKHQ_STATE_DIR` at module load, which is right for a path: it is
 * read once and handed to a hundred `path.join`s. A clock is read continuously
 * and a test has to be able to move it between two calls in one process —
 * which is the whole of `test/unit/clock.test.mjs` and half of the proof in
 * `test/integration/demo-clock.test.mjs`. So the raw string is compared on
 * every call and re-parsed only when it changes, which is one environment
 * lookup and one string comparison per call.
 */

import process from 'node:process';

/** The environment variable, named once. */
export const CLOCK_ENV = 'DECKHQ_NOW';

/**
 * Parse an instant the way the override accepts it: anything `Date.parse`
 * understands, which in practice means an ISO 8601 string. Returns `null` for
 * absent, blank and unparseable, so every caller has one shape to test.
 *
 * @param {string|undefined|null} raw
 * @returns {number|null} ms epoch, or null
 */
export function parseInstant(raw) {
  if (raw === undefined || raw === null) return null;
  const text = String(raw).trim();
  if (!text) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

let cachedRaw = process.env[CLOCK_ENV];
let cachedFixed = parseInstant(cachedRaw);
/** Raw values already complained about, so a bad one is reported once. */
const complained = new Set();

/**
 * A value that was set and could not be read is the failure worth a line: it
 * looks like it worked, and every age is then silently the real clock's.
 * @param {string|undefined} raw
 */
function complainOnce(raw) {
  if (raw === undefined || !String(raw).trim() || complained.has(raw)) return;
  complained.add(raw);
  try {
    process.stderr.write(
      `[deckhq] ${CLOCK_ENV}="${raw}" is not an instant Date.parse() understands; ` +
        'using the real clock.\n',
    );
  } catch {
    /* a daemon with no stderr is not going to be helped by trying harder */
  }
}

// The value this process started with gets the same complaint the first
// changed one would, and gets it before anything has read a time.
if (cachedFixed === null) complainOnce(cachedRaw);

/** @returns {number|null} the pinned instant, or null when the clock is the machine's */
function resolve() {
  const raw = process.env[CLOCK_ENV];
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedFixed = parseInstant(raw);
    if (cachedFixed === null) complainOnce(raw);
  }
  return cachedFixed;
}

/**
 * Now, as far as the model is concerned.
 *
 * `Date.now()` on any machine that has not been told otherwise — so the
 * override being absent is not a code path, it is the same number the call
 * this replaced returned.
 *
 * @returns {number} ms epoch
 */
export function now() {
  const fixed = resolve();
  return fixed === null ? Date.now() : fixed;
}

/**
 * The pinned instant, or null. Separate from `now()` because the snapshot has
 * to tell the browser WHICH it is holding: a live `now` is a sample that goes
 * stale between pushes and the client must keep ticking past it, and a pinned
 * one is a value the client must stop on. See `public/clock.js`.
 *
 * @returns {number|null}
 */
export function fixedNow() {
  return resolve();
}

/** @returns {boolean} true when `DECKHQ_NOW` named a readable instant */
export function isFixed() {
  return resolve() !== null;
}
