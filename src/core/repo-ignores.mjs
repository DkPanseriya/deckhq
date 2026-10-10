/**
 * Does a repository NAME a directory inside it as not its own?
 *
 * `repo-root.mjs` asks this about a clone it found inside another repository's
 * working directory. A clone the outer repository names — `/internal/` in its
 * root `.gitignore`, or in `.git/info/exclude` — was put there on purpose, and
 * its sessions belong in the outer repository's room. A clone it does not name
 * is a project that happens to sit there.
 *
 * ONLY A LITERAL LINE IS A NAME. `/internal/`, `internal/`, `/internal` and
 * `internal` all name `internal`; `/vendor/tools/` names `vendor/tools`. A line
 * with `*`, `?`, `[` or a backslash in it is a pattern, and a pattern claims
 * nothing here: people keep a whole home directory in git with `*` ignored, and
 * every project they own would otherwise collapse into one room. For the same
 * reason the line must be the directory's WHOLE path from the repository's
 * root — `/code/` does not name `code/api`, and a bare `internal` does not
 * name `docs/internal`, though git would ignore both.
 *
 * A `!` line that names the same path takes the name back, and the last line
 * that names it wins, as in git. A `!` line with a pattern in it is not
 * evaluated. Letter case is not part of a name.
 *
 * Reads files only, never throws, and reads no more than `MAX_IGNORE_FILE` of
 * anything: a bigger file is treated as one that could not be read.
 */
import fs from 'node:fs';

/** A `.gitignore` past this many bytes is not read, and so names nothing. */
export const MAX_IGNORE_FILE = 256 * 1024;

/**
 * What a file was when an answer was read from it: enough to notice a change.
 * @typedef {object} Witness
 * @property {string} at
 * @property {'file'|'dir'|'other'|'absent'} type
 * @property {number} mtimeMs
 * @property {number} size
 */

/** A path as a `.gitignore` line would spell it: `/`, no slash at either end, lower case. */
function named(/** @type {unknown} */ p) {
  return (typeof p === 'string' ? p : '')
    .replace(/[\\/]+/g, '/')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

/**
 * Whether the text of an ignore file names `rel` by a literal line.
 * @param {string} text the file's contents
 * @param {string} rel the directory, relative to the repository's root
 * @returns {boolean}
 */
export function namesLiterally(text, rel) {
  const want = named(rel);
  if (!want || typeof text !== 'string') return false;
  let is = false;
  for (const raw of text.split(/\r?\n/)) {
    // Git drops trailing blanks, keeps leading ones, and reads `#` as a comment.
    let line = raw.replace(/[ \t]+$/, '');
    if (!line || line[0] === '#') continue;
    const taken = line[0] === '!';
    if (taken) line = line.slice(1);
    if (/[*?[\]\\]/.test(line)) continue;
    if (line.replace(/^\/+|\/+$/g, '').toLowerCase() === want) is = !taken;
  }
  return is;
}

/**
 * What is at a path right now.
 * @param {string} at
 * @returns {Witness}
 */
export function witnessOf(at) {
  try {
    const st = fs.statSync(at);
    const type = st.isFile() ? 'file' : st.isDirectory() ? 'dir' : 'other';
    return { at, type, mtimeMs: st.mtimeMs, size: st.size };
  } catch {
    return { at, type: 'absent', mtimeMs: 0, size: 0 };
  }
}

/**
 * Is a file still what it was when it was read? A directory is only asked
 * whether it is still there: a `.git` directory's own time moves with every
 * git command, and none of them changes what was read from beside it.
 * @param {Witness} w
 */
export function witnessStill(w) {
  const now = witnessOf(w.at);
  if (now.type !== w.type) return false;
  return w.type !== 'file' || (now.mtimeMs === w.mtimeMs && now.size === w.size);
}

/**
 * Whether any of a repository's ignore files names `rel`, and what was read to
 * find out. The files are read in the order given and as one list, so pass the
 * one git ranks lowest first (`info/exclude`, then the root `.gitignore`).
 *
 * @param {string[]} files
 * @param {string} rel
 * @returns {{named: boolean, seen: Witness[]}}
 */
export function namedIn(files, rel) {
  /** @type {Witness[]} */
  const seen = [];
  let text = '';
  for (const at of files) {
    const w = witnessOf(at);
    seen.push(w);
    if (w.type !== 'file' || w.size > MAX_IGNORE_FILE) continue;
    try {
      const read = fs.readFileSync(at, 'utf8');
      if (read.length <= MAX_IGNORE_FILE) text += `${read}\n`;
    } catch {
      // Unreadable is the same as absent: it names nothing.
    }
  }
  return { named: namesLiterally(text, rel), seen };
}
