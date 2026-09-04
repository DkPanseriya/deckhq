/**
 * Which Claude Code sessions are actually alive (WP-22 follow-up).
 *
 * Split out of `adapter.mjs` unchanged: the bounded-concurrency map, the
 * "is the binary here" check, the `claude --list` probe and its two rate
 * limits, the pid liveness check, and the roster the scan reads.
 *
 * Live is an OBSERVED fact and never a user-owned one. Nothing here touches
 * ack state, and a probe that fails leaves the previous roster in place
 * rather than declaring everybody dead.
 */

import fs from 'node:fs';
import { execFile } from 'node:child_process';
import { agentId } from '../../core/model.mjs';
import { PROJECTS_DIR } from './parse.mjs';

/** The id every agent from this runtime carries, before the colon. */
export const RUNTIME_ID = 'claude-code';

/**
 * Run `fn` over `items` with at most `limit` calls in flight at once,
 * returning results in the original order regardless of completion order.
 * @template T,R
 * @param {T[]} items
 * @param {number} limit
 * @param {(item:T, index:number) => Promise<R>} fn
 * @returns {Promise<R[]>}
 */
export async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, () =>
    worker(),
  );
  await Promise.all(workers);
  return results;
}

/** @param {string} cmd */
export function commandExists(cmd) {
  return new Promise((resolve) => {
    const finder = process.platform === 'win32' ? 'where' : 'which';
    execFile(finder, [cmd], { windowsHide: true, timeout: 5000 }, (err) => resolve(!err));
  });
}

export let availableCache = null;

/**
 * Is Claude Code present on this machine? Cheap, cached for the process
 * lifetime. True if `~/.claude/projects` exists (history to show) or the
 * `claude` binary resolves on PATH (a live roster is possible). Never throws.
 * @returns {Promise<boolean>}
 */
export async function available() {
  if (availableCache !== null) return availableCache;
  availableCache = await computeAvailable();
  return availableCache;
}

export async function computeAvailable() {
  try {
    if (fs.existsSync(PROJECTS_DIR)) return true;
  } catch {
    // fall through to the binary check
  }
  try {
    return await commandExists('claude');
  } catch {
    return false;
  }
}

/**
 * Ask Claude Code itself, via its supported CLI surface, which sessions are
 * alive right now. This spawns the whole CLI, so it is the expensive half of
 * `liveSessions()` below and is called only when that decides a fresh answer
 * is actually needed. Never throws — a missing/failing CLI resolves to [].
 * @returns {Promise<import('../../core/model.mjs').LiveSession[]>}
 */
export function probeLiveSessions() {
  return new Promise((resolve) => {
    execFile(
      'claude',
      ['agents', '--json'],
      { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
      (err, stdout) => {
        if (err) {
          resolve([]);
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          resolve([]);
          return;
        }
        if (!Array.isArray(parsed)) {
          resolve([]);
          return;
        }
        const out = [];
        for (const item of parsed) {
          if (!item || typeof item !== 'object' || typeof item.sessionId !== 'string') continue;
          out.push({
            id: agentId(RUNTIME_ID, item.sessionId),
            runtime: RUNTIME_ID,
            cwd: typeof item.cwd === 'string' ? item.cwd : '',
            name: typeof item.name === 'string' ? item.name : null,
            startedAt: typeof item.startedAt === 'number' ? item.startedAt : null,
            pid: typeof item.pid === 'number' ? item.pid : null,
          });
        }
        resolve(out);
      },
    );
  });
}

/**
 * How stale the cached live roster is allowed to get before the CLI is asked
 * again. See `liveSessions` for why this is not the poll interval.
 *
 * Chosen against the budget rather than by taste. One probe costs 406-984 ms
 * of child CPU (609 ms median), so a probe every 30 s would still spend ~2%
 * of a core at idle — the whole of docs/02-ARCHITECTURE.md §8's allowance,
 * on one question. At 60 s it is ~1%, and the extra 30 s of staleness lands
 * only on the case `noteScanEvidence` cannot see anyway: a session that is
 * alive and writing nothing.
 */
export const LIVE_PROBE_TTL_MS = 60_000;

/**
 * Floor on how often disk evidence may drag a probe forward (below). Without
 * it, a transcript that is being appended to by something the roster never
 * lists — a `claude -p` run, a subagent, an editor touching the file — would
 * force a spawn on every single poll, which is the behaviour this cache
 * exists to remove.
 */
export const LIVE_PROBE_MIN_INTERVAL_MS = 10_000;

/**
 * The last answer `probeLiveSessions()` gave, and when. `ids` is the same
 * roster as a set, kept alongside so the scan can test membership without
 * rebuilding it every poll.
 * @type {{at:number, sessions:import('../../core/model.mjs').LiveSession[], ids:Set<string>}}
 */
export let liveProbe = { at: 0, sessions: [], ids: new Set() };

/** Set by `scanSessions` when the transcripts disagree with `liveProbe`. */
export let liveProbeForced = false;

/**
 * Is this pid still a running process? `signal 0` delivers nothing; it only
 * runs the permission and existence checks, so this is a syscall and no more
 * — measured at 0.055 ms for a whole roster, against 400-1000 ms of child CPU
 * for one CLI spawn.
 *
 * `EPERM` means the process exists but is not ours to signal, which is alive,
 * not dead. Only `ESRCH` (and anything else unexpected) is treated as gone.
 * A non-positive pid is never passed through: on POSIX `kill(0, sig)` signals
 * the entire process group.
 *
 * Verified on Windows, where libuv answers signal 0 with `OpenProcess` plus
 * `GetExitCodeProcess` rather than a real signal (docs/DEVIATIONS.md §82): a
 * pid that has exited, a pid that never existed, and a child that has exited
 * while this process still holds its handle all throw `ESRCH`; the protected
 * System process (pid 4) throws `EPERM`. So the same two-way reading holds on
 * every platform this runs on.
 *
 * What this cannot tell is WHICH process holds the pid. A session that exits
 * and whose pid the OS hands to some other process inside one poll interval
 * reads alive until the next probe replaces the roster — see `liveSessions`
 * for the size of that window and why it is accepted rather than closed.
 * @param {number} pid
 * @returns {boolean}
 */
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return !!err && err.code === 'EPERM';
  }
}

/** Copy out, so a caller holding a roster can never write into the cache. */
export function copyRoster(sessions) {
  return sessions.map((s) => ({ ...s }));
}

/**
 * Sessions Claude Code reports as currently alive. Never throws.
 *
 * `probeLiveSessions()` above boots the entire Claude Code CLI to answer
 * this. Measured on this machine, per call: 521-721 ms median wall, and
 * 406-984 ms of the child's OWN processor time (609 ms median). The daemon
 * polls every 5 s forever, so calling it per poll spent ~12% of a core on a
 * question whose answer almost never changes — six times the idle budget in
 * docs/02-ARCHITECTURE.md §8, and out of process, so nothing measuring this
 * daemon's own CPU could see it. See docs/DEVIATIONS.md §77.
 *
 * So the probe is cached, and the cache is corrected between probes by the
 * two things that are cheap:
 *
 *   - **A session that exits** is caught by a pid check on every call, so a
 *     dead session still leaves the roster within one poll, exactly as
 *     before. This is the common transition and it costs nothing.
 *   - **A session that comes alive** is caught by `scanSessions`: a
 *     transcript with activity newer than the last probe, belonging to a
 *     session the roster does not list, drags the next probe forward instead
 *     of waiting out the TTL. This matters on the degraded path, where the
 *     poll is the only liveness signal there is (§4.2); with hooks installed
 *     `SessionStart` already reports it directly and authoritatively.
 *
 * What is left stale is the one case neither covers: a session that starts
 * or resumes and then writes nothing at all — a terminal opened and left
 * sitting at the prompt. It reads as `ended` for up to `LIVE_PROBE_TTL_MS`.
 * That is the price, and it is bounded, self-correcting, and cannot move any
 * user-owned state: `live` is observed, and `for_review` is sticky through a
 * liveness loss either way (see the Registry's invariant).
 *
 * An entry with no pid is kept until the next probe. Nothing cheap can say
 * otherwise, and the probe is what is authoritative for it.
 *
 * A pid the check has once called dead is retired for good: it leaves the
 * cached roster and nothing short of the next probe can bring that session
 * back, so a pid the OS later hands to some other process cannot revive it.
 * The one exposure that leaves is a session that exits AND has its pid reused
 * inside a single poll interval, before any check saw it dead — that impostor
 * reads alive until the TTL probe. Measured on the reference machine (Windows
 * 11), a pid recurs only after 123–155 further process creations, so it takes
 * ~25 spawns a second during the 5 s the check is blind; and `live` is an
 * observation, never a user-owned state, so the worst outcome is a desk drawn
 * occupied for up to 60 s. No cheap cross-platform identity for a pid exists
 * without spawning — the exact cost this cache removes — so the window is
 * accepted and recorded (docs/DEVIATIONS.md §82) rather than closed. With
 * hooks installed it does not arise at all: `SessionEnd` is authoritative and
 * the registry prefers it over this roster.
 *
 * @param {{probe?: () => Promise<import('../../core/model.mjs').LiveSession[]>,
 *          now?: number, alive?: (pid:number) => boolean}} [opts] test seams,
 *   in the same shape as `openInApp`'s: `probe` stands in for the CLI spawn so
 *   a test can count how many times it actually happened, `now` stands in for
 *   the clock so the TTL can be crossed without sleeping through it, and
 *   `alive` stands in for the pid check so a pid can be made to die and come
 *   back on cue. The daemon passes none of them.
 * @returns {Promise<import('../../core/model.mjs').LiveSession[]>}
 */
export async function liveSessions(opts = {}) {
  const probe = opts.probe || probeLiveSessions;
  const isAlive = opts.alive || pidAlive;
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const age = now - liveProbe.at;
  const due =
    liveProbe.at === 0 ||
    age >= LIVE_PROBE_TTL_MS ||
    (liveProbeForced && age >= LIVE_PROBE_MIN_INTERVAL_MS);

  if (due) {
    liveProbeForced = false;
    const sessions = await probe();
    // Stamped after the probe returns, not before it: the roster describes
    // the moment the CLI answered, and `scanSessions` compares transcript
    // timestamps against exactly that moment.
    const at = typeof opts.now === 'number' ? opts.now : Date.now();
    liveProbe = { at, sessions, ids: new Set(sessions.map((s) => s.id)) };
    return copyRoster(sessions);
  }

  const alive = liveProbe.sessions.filter((s) => s.pid == null || isAlive(s.pid));
  if (alive.length !== liveProbe.sessions.length) {
    liveProbe.sessions = alive;
    liveProbe.ids = new Set(alive.map((s) => s.id));
  }
  return copyRoster(alive);
}

/**
 * Does this scan's evidence contradict the cached roster? A session whose
 * transcript has moved since the last probe, and which that probe did not
 * list, is either newly alive or newly resumed — either way the roster is
 * out of date and the next `liveSessions()` should pay for a fresh one.
 *
 * Only ever sets the flag. Clearing it is `liveSessions`' job, so a forced
 * probe that the minimum interval defers is not lost.
 * @param {import('../../core/model.mjs').SessionSummary[]} summaries sorted
 *   newest-first, so the common case exits on the first entry.
 */
export function noteScanEvidence(summaries) {
  if (!liveProbe.at || liveProbeForced) return;
  for (const s of summaries) {
    if ((s.lastActivityAt || 0) <= liveProbe.at) break; // sorted: nothing newer follows
    // WP-41. A junior is never in the live roster — `claude agents --json`
    // lists sessions, not subagents — so a busy junior would force a fresh
    // CLI spawn on every single poll, which is the exact cost §77's cache
    // exists to remove. Its parent is in the roster and speaks for it.
    if (s.subagent === true) continue;
    if (!liveProbe.ids.has(s.id)) {
      liveProbeForced = true;
      return;
    }
  }
}

/**
 * Drop the cached live roster. Test seam only — the daemon never needs this,
 * because the cache is keyed on time and self-corrects.
 */
export function _resetLiveProbeCache() {
  liveProbe = { at: 0, sessions: [], ids: new Set() };
  liveProbeForced = false;
}
