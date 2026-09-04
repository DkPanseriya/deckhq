/**
 * Reading the transcript directory (WP-22 follow-up).
 *
 * Split out of `adapter.mjs` unchanged: listing a project's session files,
 * WP-41's subagent index and its two windows, the summary cache keyed on
 * mtime and size (docs/DEVIATIONS.md §78), and `scanSessions` itself.
 *
 * All transcript parsing is `parse.mjs`'s; nothing here reads a `.jsonl`
 * line directly.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { agentId, splitAgentId } from '../../core/model.mjs';
import { cacheFileFor } from '../../core/paths.mjs';
import { SummaryCache } from '../../core/summary-cache.mjs';
import {
  PROJECTS_DIR,
  HEAD_BYTES,
  TAIL_BYTES,
  readHead,
  readTail,
  parseSummary,
  SUBAGENT_DIR,
  SUBAGENT_MAX_DEPTH,
  subagentIdFromFile,
  subagentMetaFile,
  parseSubagentMeta,
  parseSubagentTimes,
} from './parse.mjs';
import { readDesktopSessions } from './desktop.mjs';
import { RUNTIME_ID, mapWithConcurrency, noteScanEvidence } from './adapter-live.mjs';

/**
 * Every top-level session file directly under a project directory:
 * `~/.claude/projects/<slug>/<sessionId>.jsonl`. Deliberately not recursive —
 * subagent workflow transcripts live several levels deeper and are not
 * top-level sessions (CONTRACTS.md: "Do not reverse-engineer the cwd from
 * the directory name — read cwd from a record.").
 * `size` pairs with `mtimeMs` as the summary cache's invalidation key; it
 * was returned but not declared (WP-22).
 * @returns {Promise<{file:string, sessionId:string, mtimeMs:number, size:number}[]>}
 */
export async function listSessionFiles() {
  let projectDirs;
  try {
    projectDirs = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  } catch {
    return [];
  }

  const perDir = await Promise.all(
    projectDirs
      .filter((d) => d.isDirectory())
      .map(async (d) => {
        const dirPath = path.join(PROJECTS_DIR, d.name);
        let files;
        try {
          files = await fsp.readdir(dirPath, { withFileTypes: true });
        } catch {
          return [];
        }
        const out = [];
        for (const f of files) {
          if (!f.isFile() || !f.name.endsWith('.jsonl')) continue;
          const full = path.join(dirPath, f.name);
          let stat;
          try {
            stat = await fsp.stat(full);
          } catch {
            continue;
          }
          out.push({
            file: full,
            sessionId: f.name.slice(0, -'.jsonl'.length),
            mtimeMs: stat.mtimeMs,
            // Size pairs with mtime to invalidate the summary cache.
            size: stat.size,
          });
        }
        return out;
      }),
  );

  return perDir.flat();
}

// ------------------------------------------------------ subagents (WP-41)

/**
 * How long after its last written record a junior is still on the floor.
 *
 * A subagent transcript carries no stop marker of any kind (verified: the last
 * record is an ordinary `user` or `assistant` turn, §120), so with no hook to
 * say otherwise the only honest signal that a junior has finished is that its
 * file stopped moving. Too short and a junior thinking hard flickers off the
 * floor and back; too long and juniors that finished linger at a desk.
 *
 * Measured over 28,813 consecutive-record gaps in 300 real subagent
 * transcripts on this machine: p50 1.7 s, p90 7.9 s, p99 63.5 s, p99.9 253 s.
 * Five minutes clears 99.93% of them, so a junior effectively never blinks
 * out mid-task, and a finished one leaves within five minutes at the worst.
 * With hooks installed and a `SubagentStop` that names the junior, it leaves
 * at once and this never binds.
 */
export const SUBAGENT_IDLE_MS = 300_000;

/**
 * How recently a session's own transcript must have moved before its
 * `subagents/` directory is looked at.
 *
 * This is the cost control. Reading every session's subagent directory would
 * be one `readdir` per session — up to `SCAN_LIMIT` of them, every poll,
 * forever — to find juniors that by definition only exist while their parent
 * is running. A parent that has not written for half an hour has no live
 * junior, so its directory is not opened.
 *
 * Half an hour rather than `SUBAGENT_IDLE_MS`: a parent can sit silent for the
 * whole of a long junior's run (it writes the `Task` call, then nothing until
 * the result comes back), and the longest subagent lifetime measured here was
 * 88,273 s. This is generous on purpose — being wrong here loses a junior,
 * and being right costs one `readdir` on a directory that is nearly always
 * absent.
 */
export const SUBAGENT_PARENT_WINDOW_MS = 30 * 60_000;

/**
 * Where each known junior's transcript is, so `conversation()` and
 * `findSessionFile()` can answer for an id that is not a top-level session.
 * Rebuilt by every scan; a junior that has left simply falls out of it.
 * @type {Map<string, string>}
 */
export let subagentFiles = new Map();

/** Test seam: forget which junior transcripts the last scan found. */
export function _resetSubagentIndex() {
  subagentFiles = new Map();
}

/**
 * Every subagent transcript under one parent session's directory.
 *
 * Two shapes exist on disk and both are handled (§120):
 *   `<sessionDir>/subagents/agent-<id>.jsonl`                 — a Task subagent
 *   `<sessionDir>/subagents/workflows/wf_<id>/agent-<id>.jsonl` — a workflow one
 *
 * `journal.jsonl` sits beside the second and is the workflow's own log, not a
 * subagent: `subagentIdFromFile` returns null for it, which is what drops it.
 * Never throws — a session with no `subagents/` directory (the overwhelming
 * majority) resolves to [].
 *
 * @param {string} sessionDir `<projectDir>/<parentSessionId>`
 * @param {string} parentSessionId
 * @returns {Promise<{file:string, subagentId:string, parentSessionId:string,
 *   mtimeMs:number, size:number}[]>}
 */
export async function listSubagentFiles(sessionDir, parentSessionId) {
  /** @type {{file:string, subagentId:string, parentSessionId:string, mtimeMs:number, size:number}[]} */
  const out = [];

  /** @param {string} dir @param {number} depth */
  async function walk(dir, depth) {
    let entries;
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return; // no subagents/ here, or it is not readable. Both are normal.
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < SUBAGENT_MAX_DEPTH) await walk(full, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const subagentId = subagentIdFromFile(e.name);
      if (!subagentId) continue;
      let stat;
      try {
        stat = await fsp.stat(full);
      } catch {
        continue;
      }
      out.push({
        file: full,
        subagentId,
        parentSessionId,
        mtimeMs: stat.mtimeMs,
        size: stat.size,
      });
    }
  }

  await walk(path.join(sessionDir, SUBAGENT_DIR), 0);
  return out;
}

/**
 * Summarise the juniors that are still working, for the sessions that could
 * plausibly have one.
 *
 * A junior is a session in every way the model cares about — it has a cwd, a
 * title, tokens, a last line and an activity state — plus four fields nobody
 * else has: `subagent`, `parentSessionId`, `subagentType` and `spawnedAt`.
 * Everything here is parsed by `parse.mjs`; this function does directories,
 * freshness and assembly and nothing else (standing rule 8).
 *
 * A junior whose transcript has not moved for `SUBAGENT_IDLE_MS` is NOT
 * returned. That is the "it leaves when it stops" half of WP-41 and it is a
 * display decision made in one place: nothing about a junior is persisted, no
 * `ackState` is ever written for one, so a junior leaving the floor cannot
 * touch a user-owned field even in principle.
 *
 * @param {{file:string, sessionId:string, mtimeMs:number, size:number}[]} parents the scan's
 *   own candidate list — already sorted and bounded.
 * @param {number} now
 * @returns {Promise<import('../../core/model.mjs').SessionSummary[]>}
 */
export async function scanSubagents(parents, now) {
  const fresh = parents.filter((p) => now - p.mtimeMs <= SUBAGENT_PARENT_WINDOW_MS);
  if (!fresh.length) {
    subagentFiles = new Map();
    return [];
  }

  const perParent = await mapWithConcurrency(fresh, SCAN_CONCURRENCY, (p) =>
    listSubagentFiles(path.join(path.dirname(p.file), p.sessionId), p.sessionId),
  );
  const candidates = perParent.flat().filter((f) => now - f.mtimeMs <= SUBAGENT_IDLE_MS);

  /** @type {Map<string, string>} */
  const index = new Map();
  for (const c of candidates) index.set(c.subagentId, c.file);
  subagentFiles = index;

  const summaries = await mapWithConcurrency(candidates, SCAN_CONCURRENCY, async (entry) => {
    try {
      const base = path.basename(entry.file);
      const [head, tail, metaText] = await Promise.all([
        readHead(entry.file, HEAD_BYTES),
        readTail(entry.file, TAIL_BYTES),
        fsp
          .readFile(path.join(path.dirname(entry.file), subagentMetaFile(base)), 'utf8')
          .catch(() => ''),
      ]);
      const meta = parseSubagentMeta(metaText);
      const times = parseSubagentTimes(head, tail);
      const summary = parseSummary(head, tail, {
        id: entry.subagentId,
        mtimeMs: entry.mtimeMs,
        sidechain: true,
      });
      return {
        ...summary,
        id: agentId(RUNTIME_ID, entry.subagentId),
        // The Task call's own description is a better title than the first
        // 60 characters of a prompt the user never wrote by hand.
        title: meta.description || summary.title,
        hasCustomTitle: Boolean(meta.description) || summary.hasCustomTitle,
        model: summary.model ?? meta.model ?? null,
        subagent: true,
        parentSessionId: entry.parentSessionId,
        subagentType: meta.agentType,
        subagentDescription: meta.description,
        spawnedAt: times.spawnedAt,
      };
    } catch (err) {
      // Same rule as a session: one unreadable junior never fails a scan.
      console.error(
        `[claude-code] failed to parse subagent ${entry.subagentId}:`,
        err && err.message ? err.message : err,
      );
      return null;
    }
  });

  return /** @type {any[]} */ (summaries.filter((s) => s !== null));
}

/**
 * Parsed-summary cache, keyed by file path and invalidated by (mtime, size).
 *
 * The daemon re-scans every few seconds, forever, on a machine where a single
 * transcript reaches 74 MB. Re-reading and re-parsing every session on every
 * poll cost roughly 100 MB of file I/O every 5 s and pinned about a fifth of
 * a core — an order of magnitude over the idle-CPU budget in
 * docs/02-ARCHITECTURE.md §8. Almost every session on disk is finished and
 * will never change again; only the handful that are live do.
 *
 * A file whose mtime and size are both unchanged cannot have changed content
 * in any way this parser would see, so its previous summary is reused.
 *
 * It persists to `~/.deckhq/cache/claude-code.json`, so the *first* scan after
 * a daemon start is served from it too and the floor is populated immediately
 * rather than after a second of parsing. See src/core/summary-cache.mjs for
 * why a corrupt one is discarded in silence, and for the copy-in/copy-out rule
 * that keeps the desktop archive flag out of it (docs/DEVIATIONS.md §46).
 */
export const summaryCache = new SummaryCache(cacheFileFor(RUNTIME_ID), { runtime: RUNTIME_ID });

/**
 * Measured: the cold scan is dominated by JSON parsing, not by disk, so
 * raising this above 8 bought no wall-clock time and did raise peak memory
 * (concurrency x TAIL_BYTES of live buffers). Left at 8 deliberately.
 */
export const SCAN_CONCURRENCY = 8;

/**
 * Every Claude Code session on disk, newest first, bounded by `opts`.
 * @param {{maxAgeDays:number, limit:number}} opts
 * @returns {Promise<import('../../core/model.mjs').SessionSummary[]>}
 */
export async function scanSessions({ maxAgeDays, limit }) {
  // Reading the cache file is a one-off per process and never throws; a
  // missing or unusable one simply leaves every lookup below a miss, which is
  // exactly the behaviour before it existed.
  const [all] = await Promise.all([listSessionFiles(), summaryCache.load()]);
  const cutoff = Date.now() - maxAgeDays * 86400_000;
  const candidates = all
    .filter((f) => f.mtimeMs >= cutoff)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, limit);

  // Drop cache entries for transcripts that are no longer on disk, so neither
  // the map nor the file can grow without bound over a long-lived machine.
  // Measured against every file that EXISTS, not against this scan's
  // candidates: a session outside this call's age window or limit is still a
  // session, and evicting it would only buy a re-parse later.
  //
  // An empty listing is not evidence that every transcript was deleted — it is
  // also what an unreadable or momentarily missing projects directory returns.
  // Emptying the cache on that would throw away a perfectly good one and buy a
  // full cold scan next start, for nothing.
  if (all.length) summaryCache.retain(new Set(all.map((f) => f.file)));

  const summaries = await mapWithConcurrency(candidates, SCAN_CONCURRENCY, async (entry) => {
    const cached = summaryCache.get(entry.file, entry.mtimeMs, entry.size);
    if (cached) return cached;
    try {
      // The full 2 MB tail window is read deliberately, even though a few
      // hundred KB would be enough for state. Token totals are summed over
      // whatever is read, and a smaller window undersamples exactly the
      // largest sessions — which inverts the per-project comparison that
      // token accounting exists to answer (docs/01-PRODUCT.md F9). The cost
      // of this is paid once per file: the summary cache above means an
      // unchanged transcript is never re-read on later polls.
      const [head, tail] = await Promise.all([
        readHead(entry.file, HEAD_BYTES),
        readTail(entry.file, TAIL_BYTES),
      ]);
      const summary = parseSummary(head, tail, {
        id: entry.sessionId,
        file: entry.file,
        mtimeMs: entry.mtimeMs,
      });
      const prefixed = { ...summary, id: agentId(RUNTIME_ID, summary.id) };
      if (entry.size !== undefined) {
        summaryCache.set(entry.file, entry.mtimeMs, entry.size, prefixed);
      }
      return prefixed;
    } catch (err) {
      // A parse failure on one session must never fail the scan.
      // docs/02-ARCHITECTURE.md §2.1 / CONTRACTS.md rule 6.
      console.error(
        `[claude-code] failed to parse session ${entry.sessionId}:`,
        err && err.message ? err.message : err,
      );
      return null;
    }
  });

  // Everything that could change is now parsed, so this is the moment the
  // cache is worth keeping. Rate-limited and silent — see `persist`. Awaited
  // rather than fired and forgotten so a daemon killed straight after a scan
  // still leaves a usable cache behind; it only writes when a parse actually
  // happened, so a warm scan pays nothing for this line.
  await summaryCache.persist();

  // The desktop app's archive flag, joined on `cliSessionId`. Applied AFTER
  // the summary cache on purpose: archiving a session does not touch its
  // transcript, so a cached summary would keep a stale flag until the
  // conversation happened to change. Read once per scan, not per session.
  //
  // Persisting the cache makes that ordering sharper, not softer: the flag
  // would otherwise survive restarts, and `archived` drives `let_go`, so a
  // stale `true` would re-fire an agent the user had rehired on every poll,
  // forever. The stamp below therefore lands on summaries the cache hands out
  // by value — `SummaryCache.get` returns a copy and `set` strips `archived`
  // — so it can never reach the stored entry. Both halves are asserted.
  let desktop;
  try {
    desktop = await readDesktopSessions();
  } catch {
    desktop = null; // the app's own store; unreadable is not an error here
  }

  const out = summaries.filter((s) => s !== null);

  // WP-41. The juniors, appended to the same list: a subagent is a session
  // like any other from here on, and everything downstream — the state
  // machine, the plan, the panel — reads the four extra fields or ignores
  // them. Scanned from `candidates` rather than `all` so the same age window
  // and limit that bound the sessions bound their juniors, and so a machine
  // with nothing running pays one filter and no directory reads at all.
  try {
    out.push(...(await scanSubagents(candidates, Date.now())));
  } catch (err) {
    // A junior is a decoration on a floor that has to draw without one.
    console.error('[claude-code] subagent scan failed:', err && err.message ? err.message : err);
  }

  if (desktop && desktop.size) {
    for (const summary of out) {
      const meta = desktop.get(splitAgentId(summary.id).sessionId);
      if (meta) summary.archived = meta.archived;
    }
  }

  // File mtime (used above to pick which candidates are even worth reading,
  // since it's the only signal available before we've read anything) is not
  // a reliable proxy for true conversation recency: verified on this machine
  // that a large fraction of transcripts have an mtime that diverges from
  // their newest in-file timestamp by days to months (likely disturbed by
  // something outside Claude Code touching the file, e.g. an editor, backup
  // tool or sync client). Once parsed, we know the real answer, so the
  // result is re-sorted by the content-derived `lastActivityAt` before
  // returning — this is what "newest first" should mean to a caller.
  out.sort((a, b) => b.lastActivityAt - a.lastActivityAt);

  // Cheap by-product of a scan we were doing anyway: if a transcript has
  // moved since the cached live roster was taken and that roster does not
  // list its session, the roster is stale and the next `liveSessions()`
  // should re-probe rather than wait out its TTL. Reads the sorted list, so
  // it must come after the sort.
  noteScanEvidence(out);

  return out;
}
