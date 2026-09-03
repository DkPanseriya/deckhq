/**
 * Counting one phrase across a window of Claude Code transcripts. WP-27.
 *
 * `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §3.4 asks Wrapped for "one
 * genuinely funny derived stat (the count of a phrase across all transcripts,
 * in the spirit of the 'you're absolutely right' tracker)". This is that count,
 * and it lives here because `docs/02-ARCHITECTURE.md` §2.1 and `08` §1.1 rule 8
 * are absolute: **all runtime-format parsing stays inside its adapter.** No
 * route, no core module and no client file knows what a transcript looks like.
 *
 * ## What it counts, exactly
 *
 * Occurrences of the phrase in the **text an assistant actually wrote**, in
 * records whose own timestamp falls inside the window. Not: the same phrase
 * in a user's message quoting it back, not a `tool_result` that happens to
 * contain it, not a match in a record from three months ago that happens to
 * sit in a file touched today. Each of those would inflate the number, and a
 * funny statistic that is not true is just a wrong statistic.
 *
 * ## How it stays affordable
 *
 * Measured on the reference machine, 4 September 2026, for a seven-day window:
 * **58 candidate transcripts, 300.7 MB, 1.9 s wall clock, 7.3 ms longest
 * single event-loop block** — and the honest answer was **0**, against 11
 * matches that appear anywhere in those files at all. The gap between 11 and 0
 * is the whole reason for the timestamp and role filters above.
 *
 * Three things keep that number where it is:
 *
 *   1. **Only files whose mtime falls in the window are opened.** A transcript
 *      untouched since June holds no assistant turn from this week.
 *   2. **One regular expression pass per chunk, and no `JSON.parse` until it
 *      matches.** Parsing every line of 300 MB would cost minutes; parsing
 *      only the lines that already contain the phrase costs nothing, because
 *      there are eleven of them. This is the inversion that makes the feature
 *      possible at all — the obvious implementation (parse every record, then
 *      test its text) is the one that is too expensive, which is the branch
 *      `06-ENGINEERING-WORKPLAN.md` WP-27's brief allowed for.
 *   3. **Hard ceilings on files, bytes and wall clock**, and a `truncated`
 *      flag when one is hit. Wrapped then says the count is a floor rather
 *      than quietly reporting a short answer — `08` §1.1 rule 11.
 *
 * It is never run on the poll path. It is computed when a Wrapped card is
 * generated, which is once a week.
 */

import fs from 'node:fs';
import path from 'node:path';

import { PROJECTS_DIR } from './parse.mjs';

/**
 * The phrase, and its apostrophes. Claude Code transcripts carry both the
 * ASCII `'` and the typographic `’` depending on what the model emitted, and a
 * counter that saw only one of them would be wrong in a way nobody would ever
 * notice.
 */
export const CATCHPHRASE = "You're absolutely right";
const CATCHPHRASE_RE = /you(?:'|’)re absolutely right/gi;

/** Ceilings. A machine with a decade of transcripts must not turn a card into a walk. */
export const MAX_FILES = 400;
export const MAX_BYTES = 1024 * 1024 * 1024;
export const MAX_MS = 15_000;

/**
 * The text an assistant record actually wrote — `text` blocks only.
 *
 * `thinking` is excluded deliberately: it is not something the agent said to
 * anybody, and counting it would make the number depend on whether extended
 * thinking happened to be on. `tool_use` and `tool_result` are excluded for
 * the same reason a `grep` output containing the phrase is not the agent
 * saying it.
 * @param {any} message
 * @returns {string}
 */
export function assistantText(message) {
  const c = message?.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  let out = '';
  for (const block of c) {
    if (block && block.type === 'text' && typeof block.text === 'string') out += `${block.text}\n`;
  }
  return out;
}

/**
 * How many times the phrase appears in one string.
 * @param {string} text
 * @returns {number}
 */
export function countIn(text) {
  if (!text) return 0;
  CATCHPHRASE_RE.lastIndex = 0;
  const m = String(text).match(CATCHPHRASE_RE);
  return m ? m.length : 0;
}

/**
 * Does this record count, and for how many?
 *
 * Exported so the rule can be tested without a file: an assistant record
 * inside the window counts its text's matches, and everything else counts
 * zero.
 * @param {any} rec a parsed transcript line
 * @param {{since:number, until:number}} window
 * @returns {number}
 */
export function countInRecord(rec, window) {
  if (!rec || rec.type !== 'assistant') return 0;
  // A sidechain is a subagent's own transcript and its records also appear in
  // the subagent's file; counting both would double it.
  if (rec.isSidechain === true) return 0;
  const t = Date.parse(rec.timestamp);
  if (!Number.isFinite(t) || t < window.since || t > window.until) return 0;
  return countIn(assistantText(rec.message));
}

/**
 * Every transcript that could hold a record inside the window.
 * @param {{dir?:string, since:number, until:number}} o
 * @returns {Promise<Array<{file:string, size:number}>>}
 */
async function candidates(o) {
  const root = o.dir || PROJECTS_DIR;
  /** @type {Array<{file:string, size:number, mtime:number}>} */
  const out = [];
  let dirs;
  try {
    dirs = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    let files;
    try {
      files = await fs.promises.readdir(path.join(root, d.name));
    } catch {
      continue;
    }
    for (const name of files) {
      if (!name.endsWith('.jsonl')) continue;
      const file = path.join(root, d.name, name);
      try {
        const st = await fs.promises.stat(file);
        // A file last written before the window began cannot hold a record
        // inside it. The reverse is not true — a file written today may be
        // mostly old — which is what the per-record timestamp check is for.
        if (st.mtimeMs < o.since) continue;
        out.push({ file, size: st.size, mtime: st.mtimeMs });
      } catch {
        /* a transcript that vanished mid-scan is not an error */
      }
    }
  }
  // Newest first, so a machine that hits the file ceiling counts the most
  // recent work rather than an arbitrary alphabetical slice of it.
  out.sort((a, b) => b.mtime - a.mtime);
  return out.map(({ file, size }) => ({ file, size }));
}

/**
 * Count the phrase in one file's in-window assistant turns.
 *
 * Streams, never loads the file, and parses only the lines that already
 * contain the phrase. Never throws: an unreadable or truncated file
 * contributes what it managed to read.
 * @param {string} file
 * @param {{since:number, until:number}} window
 * @returns {Promise<{count:number, bytes:number}>}
 */
export function countInFile(file, window) {
  return new Promise((resolve) => {
    let count = 0;
    let bytes = 0;
    /** Whatever followed the last newline in the previous chunk. */
    let carry = '';
    let stream;
    try {
      stream = fs.createReadStream(file, { encoding: 'utf8' });
    } catch {
      resolve({ count: 0, bytes: 0 });
      return;
    }
    stream.on('data', (chunk) => {
      bytes += Buffer.byteLength(chunk, 'utf8');
      const text = carry + chunk;
      const lastNl = text.lastIndexOf('\n');
      if (lastNl < 0) {
        // One line longer than a chunk. Keep it whole — a transcript record is
        // a single line and can legitimately be megabytes — but never let the
        // carry grow without a newline ever arriving beyond one file's worth.
        carry = text;
        return;
      }
      const body = text.slice(0, lastNl);
      carry = text.slice(lastNl + 1);
      CATCHPHRASE_RE.lastIndex = 0;
      let m;
      while ((m = CATCHPHRASE_RE.exec(body)) !== null) {
        const start = body.lastIndexOf('\n', m.index) + 1;
        let end = body.indexOf('\n', m.index);
        if (end < 0) end = body.length;
        try {
          count += countInRecord(JSON.parse(body.slice(start, end)), window);
        } catch {
          /* a corrupt or truncated line is skipped, never thrown (CONTRACTS rule 6) */
        }
        // Resume past the whole record: its remaining matches are already
        // counted by `countInRecord`.
        CATCHPHRASE_RE.lastIndex = Math.max(end, m.index + 1);
      }
    });
    stream.on('end', () => {
      if (carry) {
        try {
          count += countInRecord(JSON.parse(carry), window);
        } catch {
          /* the last line of a file being written is routinely half a record */
        }
      }
      resolve({ count, bytes });
    });
    stream.on('error', () => resolve({ count, bytes }));
  });
}

/**
 * How many times an assistant said the phrase between two timestamps.
 *
 * @param {{since:number, until?:number, dir?:string, maxFiles?:number,
 *          maxBytes?:number, maxMs?:number, now?:()=>number}} o
 * @returns {Promise<{phrase:string, count:number, files:number, bytes:number,
 *                    ms:number, truncated:boolean}>}
 */
export async function countCatchphrase(o) {
  const until = Number.isFinite(Number(o?.until)) ? Number(o.until) : Date.now();
  const since = Number(o?.since);
  const clock = o?.now || (() => Date.now());
  const started = clock();
  const result = {
    phrase: CATCHPHRASE,
    count: 0,
    files: 0,
    bytes: 0,
    ms: 0,
    truncated: false,
  };
  if (!Number.isFinite(since) || since >= until) return result;

  const maxFiles = Number(o?.maxFiles) > 0 ? Number(o.maxFiles) : MAX_FILES;
  const maxBytes = Number(o?.maxBytes) > 0 ? Number(o.maxBytes) : MAX_BYTES;
  const maxMs = Number(o?.maxMs) > 0 ? Number(o.maxMs) : MAX_MS;

  const files = await candidates({ dir: o?.dir, since, until });
  if (files.length > maxFiles) result.truncated = true;

  for (const f of files.slice(0, maxFiles)) {
    if (result.bytes >= maxBytes || clock() - started >= maxMs) {
      result.truncated = true;
      break;
    }
    const r = await countInFile(f.file, { since, until });
    result.count += r.count;
    result.bytes += r.bytes;
    result.files += 1;
  }
  result.ms = clock() - started;
  return result;
}

export default countCatchphrase;
