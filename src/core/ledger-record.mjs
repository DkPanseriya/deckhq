/**
 * What a ledger record is made of (WP-22 follow-up).
 *
 * Split out of `ledger.mjs` unchanged: the five kinds, the ceilings a record
 * is clamped to, the day arithmetic every reader and writer shares, and
 * `projectKeyFor` — the hash that is the reason no record ever carries a
 * path (`ledger.mjs`'s rule 4).
 *
 * A leaf: it imports nothing from the rest of the ledger, which is what lets
 * the writer, the reader, the statistics and the export all share one
 * definition of a day.
 */

import { createHash } from 'node:crypto';

/** Every `kind` this module writes. Anything else on a line is ignored. */
export const LEDGER_KINDS = /** @type {const} */ (['session', 'state', 'action', 'send', 'tokens']);

/** How often the buffer is written, at most. WP-17: "at most every 2 s". */
export const FLUSH_INTERVAL_MS = 2000;

/**
 * Ceiling on buffered records. Reached only when the disk has stopped
 * accepting writes: at that point the choice is between dropping the oldest
 * measurements and growing a daemon's heap until it dies, and a daemon that
 * dies takes the acknowledgements with it.
 */
export const MAX_BUFFERED = 10_000;

/** Longest string any single field may carry into a record. */
export const MAX_FIELD = 200;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** `settings.ledgerRetentionDays`, the default and its bounds. */
export const DEFAULT_RETENTION_DAYS = 90;
export const MIN_RETENTION_DAYS = 1;
export const MAX_RETENTION_DAYS = 3650;

export const DAY_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

// ---------------------------------------------------------------------------
// Keys and days
// ---------------------------------------------------------------------------

/**
 * The stable, path-free identifier for a project.
 *
 * A truncated SHA-256 of the directory, normalised the way
 * `model.projectIdFromCwd` normalises it (separators and case) so Windows and
 * POSIX agree, and so `C:\Work\api` and `c:/work/api/` are one project. The
 * hash is the whole point of WP-48: a ledger that a team merges in somebody
 * else's storage must be able to say "these two machines worked on the same
 * repository" without either machine's directory layout leaving the machine.
 *
 * @param {string} cwd
 * @returns {string} 16 hex characters
 */
export function projectKeyFor(cwd) {
  const normalised = String(cwd || '')
    .replace(/[\\/]+/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
  if (!normalised) return 'unknown';
  return createHash('sha256').update(normalised, 'utf8').digest('hex').slice(0, 16);
}

/**
 * The local day a timestamp belongs to, `YYYY-MM-DD`.
 *
 * Local, not UTC: "discharges per day" and "the office cleared" are facts
 * about the user's day, and a ledger that rolled over at 01:00 local would
 * split one evening's work across two cards.
 *
 * @param {number} ms
 */
export function dayKey(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Local midnight at the start of a `YYYY-MM-DD`, or NaN.
 * @param {string} day
 */
export function dayStart(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ''));
  if (!m) return NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** @param {unknown} v */
export function clampField(v) {
  const s = String(v ?? '');
  return s.length > MAX_FIELD ? s.slice(0, MAX_FIELD) : s;
}

/** @param {unknown} n */
export function finiteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * @param {unknown} v
 * @returns {number}
 */
export function clampRetentionDays(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_RETENTION_DAYS;
  return Math.min(MAX_RETENTION_DAYS, Math.max(MIN_RETENTION_DAYS, Math.floor(n)));
}
