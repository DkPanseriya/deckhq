/**
 * The handover — WP-70, `docs/07-STUDIO-DESIGN.md` §6.
 *
 * *"There is no magic. The brief carries a documented instruction: when you
 * believe a card is done, write `.deckhq/studio/handovers/<cardId>.md` with
 * what changed, the tests you ran and their real counts, open questions, and
 * the next step. The agent writes an ordinary file."*
 *
 * So this module is three small things and nothing else:
 *
 *   1. **The instruction**, as the paragraph the role brief carries and the
 *      `handover.md` template beside the planner's brief. One wording, in one
 *      place, so the file an agent is asked for and the file this parses are
 *      the same file.
 *   2. **A tolerant parse.** Four headed sections, matched on words rather
 *      than on an exact heading, because what writes them is a language model
 *      and a parser that demanded `## What changed` to the letter would
 *      report nothing on the day it wrote `## What Changed:`. A section that
 *      is not there is REPORTED as missing and never invented — an empty
 *      "tests run" is the most dangerous field in this product, and a parser
 *      that filled it in would be the thing that made it dangerous.
 *   3. **A watch**, over the directory, on `src/core/watch-path.mjs` — the
 *      transcript watcher's own loop, given a second caller rather than
 *      copied.
 *
 * ## What this file cannot do, by construction
 *
 * **It never moves a card** (§5.2). It has no idea what a column is: the word
 * does not appear below, `test/unit/studio-invariant.test.mjs` greps for it,
 * and the only thing a handover produces here is a FLAG —
 * `{kind:'handover', at, path}` — which is what §5.2 permits an observed
 * event to write and the whole of what it permits.
 *
 * **It never claims a test count.** `testsQuote()` returns a sentence that
 * begins "the handover says", or null. §7's table is explicit — *"Tests run:
 * quoted verbatim from the handover"* — and a number this product printed in
 * its own voice would be a measurement DeckHQ did not make.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { watchPath } from '../core/watch-path.mjs';
import { DIRS } from './paths.mjs';

/** The extension a handover is written with. */
export const HANDOVER_EXT = '.md';

/**
 * The suffix that marks a bounce note rather than a handover.
 *
 * `<cardId>.bounce.md` is written by the review gate and read by the next
 * brief (`brief-role.mjs`, §6.1). It lives in the same directory and it is
 * NOT a handover, so the watch skips it — otherwise DeckHQ's own note would
 * flag the card it was written about, one bounce at a time, for ever.
 */
export const BOUNCE_SUFFIX = '.bounce.md';

/** How much of one section is carried into a snapshot. */
export const MAX_SECTION_CHARS = 4000;

/** How long a quoted test line may be before it is cut. */
export const MAX_QUOTE_CHARS = 160;

/**
 * The four parts, in the order §6 names them, with the words that find each
 * one's heading.
 *
 * `label` is the heading the template asks for and the review surface draws.
 * `match` is what a heading is tested against, and it is deliberately loose:
 * an agent writing `### Tests run (real counts)` or `## 2. What changed` has
 * done what it was asked, and a reader that refused those would be reporting
 * a missing section that is on the screen in front of the user.
 */
export const SECTIONS = /** @type {const} */ ([
  { key: 'changed', label: 'What changed', match: /chang/i },
  { key: 'tests', label: 'Tests run', match: /test/i },
  { key: 'questions', label: 'Open questions', match: /question/i },
  { key: 'next', label: 'Next step', match: /next/i },
]);

/**
 * The instruction the role brief carries, and the one the template repeats.
 *
 * ONE wording. The file an agent is asked to write and the file `parse()`
 * reads are the same file, and two descriptions of it in two places is how
 * they stop being.
 *
 * @param {string} handoversDir absolute path to the directory
 * @returns {string}
 */
export function handoverInstruction(handoversDir) {
  return [
    'When you believe this card is done, write a handover:',
    '',
    `    ${path.join(handoversDir, '<cardId>.md')}`,
    '',
    'Use the card id as the filename — `c7.md` for card `c7` — and these four',
    'headings, in this order:',
    '',
    ...SECTIONS.map((s) => `    ## ${s.label}`),
    '',
    'Under **Tests run**, put the counts you actually saw, in the words the',
    'runner printed them in. DeckHQ QUOTES that line back to the user and',
    'attributes it to you; it never runs anything to check it, and it never',
    'prints the number in its own voice. A count you did not see is a lie this',
    'product will repeat.',
    '',
    'Writing the file does NOT move the card. It raises a review, and the user',
    'moves the card or bounces it back with a note. Keep working only if they',
    'ask you to.',
  ].join('\n');
}

/**
 * Is this filename a handover, and which card is it for?
 *
 * The card id is the basename, and that is the whole rule — §6's instruction
 * says so in as many words, so a file called `c7.md` is card `c7`'s handover
 * and a file called `notes.md` is a handover for a card called `notes`, which
 * is very probably a card nobody has. It is reported `unattached` rather than
 * dropped (§6, acceptance (3)), which is what this returning a card id for
 * every `.md` makes possible.
 *
 * @param {string} name a filename, no directory
 * @returns {string|null} the card id, or null when this is not a handover
 */
export function cardIdForName(name) {
  const file = String(name || '').trim();
  if (!file || file.includes('/') || file.includes('\\')) return null;
  if (file.toLowerCase().endsWith(BOUNCE_SUFFIX)) return null;
  if (!file.toLowerCase().endsWith(HANDOVER_EXT)) return null;
  const id = file.slice(0, -HANDOVER_EXT.length).trim();
  return id || null;
}

/**
 * Split a handover into its four sections, tolerantly.
 *
 * Every answer is one of three things, and they are different:
 *
 *   a string   the section is there, and this is what it said
 *   `null`     the heading is not in the file
 *   `''`       the heading is there and nothing is under it
 *
 * The third is not folded into the second. "The agent wrote no tests section"
 * and "the agent wrote a tests heading and left it empty" are different
 * facts about a review, and a parser that reported them the same way would be
 * deciding which one the user gets told.
 *
 * @param {string} text
 * @returns {{sections:Record<string,string|null>, missing:string[],
 *            preamble:string}}
 */
export function parseHandover(text) {
  const lines = String(text || '').split('\n');
  /** @type {Array<{heading:string, body:string[]}>} */
  const found = [];
  /** @type {string[]} */
  const preamble = [];
  for (const line of lines) {
    const m = /^\s{0,3}#{1,6}\s+(.*)$/.exec(line);
    if (m) found.push({ heading: m[1].trim(), body: [] });
    else if (found.length) found[found.length - 1].body.push(line);
    else preamble.push(line);
  }

  /** @type {Record<string, string|null>} */
  const sections = {};
  /** @type {string[]} */
  const missing = [];
  /** Headings already spoken for, so `Tests` cannot also answer `Next step`. */
  const taken = new Set();
  for (const spec of SECTIONS) {
    const hit = found.find((s, i) => !taken.has(i) && spec.match.test(s.heading));
    if (!hit) {
      sections[spec.key] = null;
      missing.push(spec.label);
      continue;
    }
    taken.add(found.indexOf(hit));
    sections[spec.key] = hit.body.join('\n').trim().slice(0, MAX_SECTION_CHARS);
  }
  return { sections, missing, preamble: preamble.join('\n').trim() };
}

/**
 * The tests line, as a QUOTATION and never as a figure — §7, §6.
 *
 * *"Tests run: quoted verbatim from the handover — 'the handover says 43
 * passed'."* So the sentence names its source before it names a number, the
 * number is the agent's own words rather than a value this product parsed out
 * and re-formatted, and there is no code path here that produces a count with
 * no attribution in front of it. `test/unit/studio-handover.test.mjs` is the
 * copy test that holds the wording.
 *
 * @param {Record<string, string|null>} sections
 * @returns {string|null} null when there is nothing to quote, which is an
 *   answer and is drawn as one.
 */
export function testsQuote(sections) {
  const body = sections?.tests;
  if (body == null) return null;
  const line = String(body)
    .split('\n')
    .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
    .find((l) => /\d/.test(l));
  if (!line) return null;
  const quoted = line.length > MAX_QUOTE_CHARS ? `${line.slice(0, MAX_QUOTE_CHARS - 1)}…` : line;
  return `the handover says ${quoted}`;
}

/**
 * The flag one handover puts on its card — and the ONLY thing a handover
 * writes to a board (§5.2).
 *
 * @param {string} file the handover's path, as the user would open it
 * @param {number} at
 * @returns {{kind:'handover', at:number, path:string}}
 */
export function handoverFlag(file, at) {
  return { kind: 'handover', at: Number(at) || 0, path: String(file || '') };
}

/**
 * Every handover on disk, parsed, with the card each one names.
 *
 * `cardId` is null when the board has no card by that name — §6's *"a
 * handover for an unknown card id is shown unattached rather than dropped"*.
 * The file is still read, still parsed and still in the list; what it does
 * not have is somewhere to be a flag.
 *
 * @param {import('./store.mjs').StudioStore} store
 * @param {Array<{id?:string}>} cards the board's cards, for the attachment
 * @returns {Array<{cardId:string|null, name:string, path:string,
 *                  sections:Record<string,string|null>, missing:string[],
 *                  quote:string|null, mtime:number}>}
 */
export function readHandovers(store, cards = []) {
  const known = new Set((cards || []).map((c) => String(c?.id || '')));
  /** @type {any[]} */
  const out = [];
  for (const name of store.handovers()) {
    const id = cardIdForName(name);
    if (!id) continue;
    const text = store.readDoc('handovers', name);
    if (text == null) continue;
    const parsed = parseHandover(text);
    let mtime = 0;
    try {
      mtime = fs.statSync(store.pathOf(path.join(DIRS.handovers, name))).mtimeMs;
    } catch {
      mtime = 0;
    }
    out.push({
      cardId: known.has(id) ? id : null,
      name,
      path: store.pathOf(path.join(DIRS.handovers, name)),
      sections: parsed.sections,
      missing: parsed.missing,
      quote: testsQuote(parsed.sections),
      mtime,
    });
  }
  return out;
}

/**
 * The stamp the fallback poll compares for a DIRECTORY.
 *
 * A directory's own mtime changes when an entry is added or removed and NOT
 * when one of its files is edited, so a poll on the directory alone would
 * miss the second write of the same handover — which is exactly the shape
 * "on a new **or changed** file" names. So the stamp is every entry's name,
 * size and mtime, joined. The directory holds at most one file per card, and
 * a board holds at most `MAX_CARDS`, so this is a bounded read of a small
 * directory once a second on the platforms where `fs.watch` does not work.
 *
 * @param {string} dir
 * @returns {Promise<string>}
 */
export async function stampDir(dir) {
  const names = (await fsp.readdir(dir)).sort();
  /** @type {string[]} */
  const parts = [];
  for (const name of names) {
    if (!cardIdForName(name)) continue;
    try {
      const info = await fsp.stat(path.join(dir, name));
      parts.push(`${name}:${info.size}:${info.mtimeMs}`);
    } catch {
      // Gone between the readdir and the stat. The next tick sees it.
    }
  }
  return parts.join('|');
}

/**
 * Watch one project's handovers directory and say which files are new or
 * changed.
 *
 * On `src/core/watch-path.mjs`, which is the transcript watcher's own loop:
 * one `fs.watch`, one debounce, one poll behind both, and — the half that
 * matters here — a directory that DOES NOT EXIST YET is watched for one
 * appearing, because `handovers/` is empty on every project until an agent
 * writes into it.
 *
 * **The first tick reports everything.** A handover written while the daemon
 * was not running is still a handover nobody has reviewed, and the alternative
 * — taking the directory as a baseline — would mean a card silently losing
 * its flag because DeckHQ happened to be closed. The flag write is idempotent
 * (`src/http/routes/studio-handover.mjs`), so reporting a file twice costs
 * nothing.
 *
 * @param {string} dir absolute path to `<project>/.deckhq/studio/handovers`
 * @param {{onChange?:(files:Array<{name:string, path:string, mtime:number}>) => void,
 *          pollMs?:number, debounceMs?:number}} [opts]
 * @returns {Promise<() => void>} a stop function; calling it twice is safe.
 */
export async function watchHandovers(dir, opts = {}) {
  /** name → `size:mtime`, as of the last tick. @type {Map<string,string>} */
  const seen = new Map();

  return watchPath({
    resolve: async () => {
      try {
        return (await fsp.stat(dir)).isDirectory() ? dir : null;
      } catch {
        return null;
      }
    },
    stamp: stampDir,
    tick: async (target) => {
      /** @type {Array<{name:string, path:string, mtime:number}>} */
      const changed = [];
      const names = (await fsp.readdir(target)).sort();
      const present = new Set();
      for (const name of names) {
        if (!cardIdForName(name)) continue;
        present.add(name);
        let info;
        try {
          info = await fsp.stat(path.join(target, name));
        } catch {
          continue;
        }
        const stamp = `${info.size}:${info.mtimeMs}`;
        if (seen.get(name) === stamp) continue;
        seen.set(name, stamp);
        changed.push({ name, path: path.join(target, name), mtime: info.mtimeMs });
      }
      // A file the user deleted is forgotten, so writing it again is news.
      for (const name of [...seen.keys()]) if (!present.has(name)) seen.delete(name);
      if (changed.length && typeof opts.onChange === 'function') opts.onChange(changed);
    },
    pollMs: opts.pollMs,
    debounceMs: opts.debounceMs,
  });
}
