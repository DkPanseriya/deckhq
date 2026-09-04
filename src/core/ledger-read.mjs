/**
 * Reading the ledger back (WP-22 follow-up).
 *
 * Split out of `ledger.mjs` unchanged: parse a day file, list the days,
 * read one, read a window of them.
 *
 * Rule 3 in `ledger.mjs`'s header is why every function here drops rather
 * than throws — a truncated final line is skipped, an unreadable day is
 * absent. The ledger is measurement, not state: it can be incomplete, and it
 * cannot be wrong in a way that violates the product invariant.
 */

import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { DAY_FILE_RE } from './ledger-record.mjs';

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/**
 * Lines to records, skipping anything that does not parse.
 *
 * A ledger file is appended to by a live process and can legitimately end
 * mid-line after a power cut. One bad line costs one record; it must never
 * cost the file.
 *
 * @param {string} text
 * @returns {any[]}
 */
export function parseRecords(text) {
  /** @type {any[]} */
  const out = [];
  for (const line of String(text || '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) continue;
    if (typeof rec.kind !== 'string' || typeof rec.t !== 'number') continue;
    out.push(rec);
  }
  return out;
}

/**
 * Which days this ledger holds, oldest first.
 * @param {string} dir
 * @returns {Promise<string[]>}
 */
export async function listDays(dir) {
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch {
    return [];
  }
  /** @type {string[]} */
  const days = [];
  for (const name of names) {
    const m = DAY_FILE_RE.exec(name);
    if (m) days.push(m[1]);
  }
  return days.sort();
}

/**
 * One day's records.
 * @param {string} dir
 * @param {string} day
 * @returns {Promise<any[]>}
 */
export async function readDay(dir, day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return [];
  try {
    return parseRecords(await fsp.readFile(path.join(dir, `${day}.jsonl`), 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Every record in the ledger, oldest first, optionally from a given day on.
 *
 * The whole ledger rather than a window, because the numbers this feeds are
 * not all windowed: an episode that started before `since` still has to be
 * measured from where it started, and "longest wait ever" means ever. The
 * ceiling is retention: 90 days of a busy floor is a few megabytes.
 *
 * @param {string} dir
 * @param {{fromDay?:string}} [opts]
 * @returns {Promise<any[]>}
 */
export async function readAll(dir, opts = {}) {
  const days = await listDays(dir);
  /** @type {any[]} */
  const out = [];
  for (const day of days) {
    if (opts.fromDay && day < opts.fromDay) continue;
    for (const rec of await readDay(dir, day)) out.push(rec);
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}
