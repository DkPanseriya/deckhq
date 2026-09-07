/**
 * The one clock every surface that draws a time reads.
 *
 * Before this, thirteen files called `Date.now()` directly to turn a
 * `reviewSince` or a `lastActivityAt` into "2d 7h". That is correct on a real
 * floor and fatal to the goldens: the demo fixture's timestamps were seeded
 * against the real clock too, so a committed PNG matched only on the day it
 * was captured and `goldens:check` failed on clock-derived text alone
 * (`docs/DEVIATIONS.md` §144's goldens note, §146).
 *
 * So the daemon serves its own clock on every snapshot — `now`, plus
 * `nowFixed` saying whether that instant is pinned by `DECKHQ_NOW` — and this
 * module is where the browser reads it.
 *
 * WHY `nowFixed` AND NOT JUST `now`. A live daemon's `now` is a SAMPLE. It is
 * taken when the snapshot is built and it is already a few hundred
 * milliseconds old when it arrives, and the next one is a poll away. Freezing
 * the browser on it would stop the panel's per-second "waiting …" line and
 * make the queue strip's elapsed times advance in poll-sized steps — a real
 * regression, on every real floor, in exchange for nothing. A PINNED `now` is
 * the opposite: it is the whole point, and the client must stop dead on it or
 * the capture is not reproducible. One boolean tells the two apart, so the
 * live path is byte-for-byte the behaviour that was there before (`Date.now()`
 * and nothing else) and the pinned path is exact.
 *
 * No imports and no DOM, so anything can read the clock — including
 * `render/`, which is loaded dynamically and must not acquire a dependency on
 * the application shell.
 */

/**
 * The daemon's instant, when the daemon says its clock is pinned; `null`
 * whenever it is the machine's own, which is every ordinary session.
 * @type {number|null}
 */
let pinned = null;

/**
 * Take the clock from a snapshot. Called once per snapshot in `app.js`, before
 * anything reads a time from it.
 *
 * A snapshot from an older daemon carries neither field and pins nothing,
 * which is the fallback the whole module is built around: no `now`, no
 * `nowFixed`, `Date.now()`.
 *
 * @param {{now?:unknown, nowFixed?:unknown}|null|undefined} snapshot
 * @returns {number|null} the instant now pinned, or null
 */
export function adoptSnapshotClock(snapshot) {
  // `typeof` rather than `Number(...)`, because `Number(null)` is 0 and a
  // clock pinned to the Unix epoch draws every age as fifty-six years.
  const at = snapshot && snapshot.now;
  const ok = typeof at === 'number' && Number.isFinite(at);
  pinned = snapshot && snapshot.nowFixed === true && ok ? at : null;
  return pinned;
}

/**
 * Now, for anything that formats an age or a time.
 *
 * @returns {number} ms epoch — the snapshot's pinned instant, or this tab's clock
 */
export function now() {
  return pinned === null ? Date.now() : pinned;
}

/** @returns {boolean} true while the daemon's clock is pinned */
export function isPinned() {
  return pinned !== null;
}
