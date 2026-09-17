/**
 * One project's `.deckhq/studio/` directory, as a store — WP-66.
 *
 * `docs/07-STUDIO-DESIGN.md` §3. It holds the three artefacts, the two
 * directories and the two text files:
 *
 *     .deckhq/studio/
 *       README.md        what this directory is, carrying the consent tag
 *       blueprint.md     the plan
 *       roster.json      the roles
 *       board.json       the cards
 *       rules.md         the coding rules, written once
 *       briefs/          one per role
 *       handovers/       one per finished card
 *
 * ## What it borrows from `src/core/store.mjs`, and what it cannot
 *
 * **The atomic write, whole.** Temp file, then rename, with the directory
 * created first. A half-written `board.json` is a board the user loses.
 *
 * **The corrupt-file discipline, adapted, and the adaptation is deliberate.**
 * `state.json` is a file nobody but DeckHQ writes, so `Store.load()` may back
 * a corrupt one up and start from defaults. **These files are the user's.**
 * They are meant to be edited by hand, committed to a repository and reviewed
 * in a diff, so a `board.json` that does not parse is REPORTED — with the
 * path and the line — and left exactly where it is. Nothing here silently
 * replaces a file somebody wrote. A corrupt file is quarantined to
 * `<file>.corrupt-<ts>` only at the moment a write is about to replace it, so
 * the bytes survive even then.
 *
 * ## Confinement
 *
 * Every path goes through `resolveInside()` (`./paths.mjs`), which refuses —
 * never clamps — a path that leaves the directory, by `..`, by being
 * absolute, or through a symlink. There is no method here that takes an
 * absolute path.
 *
 * Nothing in this file opens a socket or starts a process.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { createLog } from '../core/log.mjs';
import { projectKeyFor } from '../core/ledger-record.mjs';
import { DIRS, FILES, resolveInside, studioDirFor } from './paths.mjs';
import {
  DEFAULT_RULES,
  emptyBoard,
  emptyRoster,
  validateBlueprint,
  validateBoard,
  validateRoster,
} from './schema.mjs';

/**
 * The most this store will read from one file. A brief, a handover and a
 * board are documents a person reads; anything past a megabyte is not one,
 * and reading it would be a way to make the daemon spend memory on request.
 */
export const MAX_FILE_BYTES = 1024 * 1024;

/** JSON as this store writes it. One key per line, and a trailing newline. */
export function serialise(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export class StudioStore {
  /**
   * @param {string} projectRoot the project directory, absolute
   * @param {{log?: import('../core/log.mjs').Log}} [opts]
   */
  constructor(projectRoot, opts = {}) {
    /** The project directory. */
    this.root = path.resolve(String(projectRoot || ''));
    /** `<project>/.deckhq/studio`. */
    this.dir = studioDirFor(this.root);
    /** The 16 hex characters the ledger uses for the same directory. */
    this.projectKey = projectKeyFor(this.root);
    this._log = opts.log || createLog('studio');
  }

  /**
   * One path inside this directory, resolved and confined.
   * @param {string} relative
   * @returns {string}
   */
  pathOf(relative) {
    return resolveInside(this.dir, relative);
  }

  /** Has this project been given a studio directory yet? */
  exists() {
    try {
      return fs.statSync(this.dir).isDirectory();
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Bytes
  // -------------------------------------------------------------------------

  /**
   * One text file, or null when it is not there.
   *
   * A file past `MAX_FILE_BYTES` reads as null with a warning rather than as
   * a megabyte in the response body.
   *
   * @param {string} relative
   * @returns {string|null}
   */
  readText(relative) {
    const file = this.pathOf(relative);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      return null;
    }
    if (!stat.isFile()) return null;
    if (stat.size > MAX_FILE_BYTES) {
      this._log.warn(`${file} is ${stat.size} bytes, past the ${MAX_FILE_BYTES} Studio reads`);
      return null;
    }
    try {
      return fs.readFileSync(file, 'utf8');
    } catch (err) {
      this._log.warn(`could not read ${file}`, err);
      return null;
    }
  }

  /**
   * Write one text file atomically: temp file, then rename.
   * @param {string} relative
   * @param {string} text
   * @returns {Promise<string>} the path written
   */
  async writeText(relative, text) {
    const file = this.pathOf(relative);
    const tmp = `${file}.tmp-${process.pid}`;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(tmp, String(text), 'utf8');
    await fsp.rename(tmp, file);
    return file;
  }

  /**
   * Move a file that does not parse out of the way, keeping its bytes.
   *
   * Called only from a write path, and only when the file it is about to
   * replace is corrupt: the user's bytes are never deleted, and they are never
   * silently overwritten either.
   *
   * @param {string} relative
   * @returns {Promise<string|null>} where it went, or null if there was nothing
   */
  async quarantine(relative) {
    const file = this.pathOf(relative);
    if (!fs.existsSync(file)) return null;
    const backup = `${file}.corrupt-${Date.now()}`;
    try {
      await fsp.rename(file, backup);
      this._log.warn(`${file} did not parse; kept at ${backup}`);
      return backup;
    } catch (err) {
      this._log.warn(`could not keep a copy of ${file}`, err);
      return null;
    }
  }

  /**
   * The names in one of this directory's subdirectories, sorted. Never
   * recursive, and never a path: a caller that wants the contents asks for
   * them by name, which goes through `pathOf` again.
   *
   * @param {string} relative
   * @returns {string[]}
   */
  list(relative) {
    const dir = this.pathOf(relative);
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile())
        .map((e) => e.name)
        .sort();
    } catch {
      return [];
    }
  }

  // -------------------------------------------------------------------------
  // The three artefacts
  // -------------------------------------------------------------------------

  /**
   * `board.json`, validated.
   *
   * Four answers, and they are different things:
   *
   *   `{ board, present:false }`  no file yet — an empty board, not an error
   *   `{ board, present:true }`   a board this build understands
   *   `{ error, path, line }`     a file that parses but is not a board
   *   `{ error, path:'board.json', line }` a file that does not parse at all
   *
   * @returns {{board?:any, present:boolean, raw:string|null, error?:string,
   *            errorPath?:string, line?:number|null}}
   */
  readBoard() {
    return this._readJson(FILES.board, validateBoard, 'board', () => emptyBoard(this.projectKey));
  }

  /** `roster.json`, on the same terms. */
  readRoster() {
    return this._readJson(FILES.roster, validateRoster, 'roster', () =>
      emptyRoster(this.projectKey),
    );
  }

  /**
   * @param {string} name
   * @param {(v:unknown, o:{raw:string|null}) => any} validate
   * @param {'board'|'roster'} key
   * @param {() => any} empty
   */
  _readJson(name, validate, key, empty) {
    const raw = this.readText(name);
    if (raw == null) return { [key]: empty(), present: false, raw: null };
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return {
        present: true,
        raw,
        error: `${name} is not valid JSON: ${/** @type {any} */ (err)?.message || err}`,
        errorPath: name,
        line: null,
      };
    }
    const result = validate(parsed, { raw });
    if ('error' in result) {
      return {
        present: true,
        raw,
        error: result.error,
        errorPath: result.path,
        line: result.line,
      };
    }
    return { [key]: result[key], present: true, raw };
  }

  /**
   * Validate and write a board.
   *
   * The document written is the NORMALISED one, with its key order fixed by
   * `validateBoard`, which is what makes the round trip byte-identical.
   *
   * @param {unknown} value
   * @returns {Promise<{board:any, file:string}|{error:string, path:string, line:number|null}>}
   */
  async writeBoard(value) {
    const result = validateBoard(value, { raw: null });
    if ('error' in result) return result;
    const existing = this.readBoard();
    if (existing.error) await this.quarantine(FILES.board);
    const file = await this.writeText(FILES.board, serialise(result.board));
    return { board: result.board, file };
  }

  /**
   * Validate and write a roster.
   * @param {unknown} value
   * @returns {Promise<{roster:any, file:string}|{error:string, path:string, line:number|null}>}
   */
  async writeRoster(value) {
    const result = validateRoster(value, { raw: null });
    if ('error' in result) return result;
    const existing = this.readRoster();
    if (existing.error) await this.quarantine(FILES.roster);
    const file = await this.writeText(FILES.roster, serialise(result.roster));
    return { roster: result.roster, file };
  }

  /**
   * Write one role's `agentId`, and nothing else — WP-68, §4.
   *
   * This is the ONE field of the roster DeckHQ writes. Everything else in
   * `roster.json` is the planner's to propose and the user's to edit (§4), so
   * this reads the file, replaces one string, and writes it back through the
   * same validator every other write goes through. A roster that does not
   * parse is left exactly as it is: the user is going to fix it by hand, and
   * quarantining their file to record an id would be a trade nobody agreed to.
   *
   * `agentId` is never guessed. The caller passes an id the ORDINARY scan
   * found, which is why Studio keeps no session list of its own (§9 invariant
   * 4, and `test/unit/studio-invariant.test.mjs` fails on one).
   *
   * @param {string} roleName matched case-insensitively, as the schema's
   *   duplicate check matches
   * @param {string|null} agentId null clears it, which is what Fire does
   * @returns {Promise<{recorded:boolean, why?:string, roster?:any, file?:string}>}
   */
  async recordRoleAgent(roleName, agentId) {
    const current = this.readRoster();
    if (current.error) return { recorded: false, why: current.error };
    if (!current.present) return { recorded: false, why: 'there is no roster.json' };

    const want = String(roleName || '')
      .trim()
      .toLowerCase();
    const roles = current.roster.roles || [];
    const at = roles.findIndex((r) => String(r.name || '').toLowerCase() === want);
    if (at < 0) return { recorded: false, why: `no role called "${roleName}"` };

    const id = agentId == null ? null : String(agentId).trim() || null;
    if (roles[at].agentId === id) return { recorded: false, why: 'unchanged' };

    const next = {
      ...current.roster,
      roles: roles.map((r, i) => (i === at ? { ...r, agentId: id } : r)),
    };
    const result = await this.writeRoster(next);
    if ('error' in result) return { recorded: false, why: result.error };
    return { recorded: true, roster: result.roster, file: result.file };
  }

  /**
   * `blueprint.md`, as text.
   * @returns {{present:boolean, blueprint:string|null, error?:string, line?:number|null}}
   */
  readBlueprint() {
    const raw = this.readText(FILES.blueprint);
    if (raw == null) return { present: false, blueprint: null };
    const result = validateBlueprint(raw);
    if ('error' in result) {
      return { present: true, blueprint: null, error: result.error, line: result.line };
    }
    return { present: true, blueprint: result.blueprint };
  }

  /**
   * @param {string} text
   * @returns {Promise<{blueprint:string, file:string}|{error:string, path:string, line:number|null}>}
   */
  async writeBlueprint(text) {
    const result = validateBlueprint(text);
    if ('error' in result) return result;
    const file = await this.writeText(FILES.blueprint, result.blueprint);
    return { blueprint: result.blueprint, file };
  }

  // -------------------------------------------------------------------------
  // rules.md, briefs and handovers
  // -------------------------------------------------------------------------

  /** The coding rules, or null. */
  readRules() {
    return this.readText(FILES.rules);
  }

  /**
   * Write `rules.md` **only if it is not there** (§6.1).
   *
   * The rules are the user's. A file DeckHQ regenerated would be a file whose
   * edits kept vanishing, so this returns `{ written:false }` on a second call
   * rather than restoring the default over the top.
   *
   * @returns {Promise<{written:boolean, file:string}>}
   */
  async ensureRules() {
    const file = this.pathOf(FILES.rules);
    if (fs.existsSync(file)) return { written: false, file };
    await this.writeText(FILES.rules, DEFAULT_RULES);
    return { written: true, file };
  }

  /** The brief filenames, sorted. */
  briefs() {
    return this.list(DIRS.briefs);
  }

  /** The handover filenames, sorted. */
  handovers() {
    return this.list(DIRS.handovers);
  }

  /**
   * One brief or handover, by filename. The name goes through `pathOf`, so
   * `../../etc/passwd` is refused rather than read.
   *
   * @param {'briefs'|'handovers'} which
   * @param {string} name
   * @returns {string|null}
   */
  readDoc(which, name) {
    return this.readText(path.join(DIRS[which], String(name || '')));
  }

  /**
   * @param {'briefs'|'handovers'} which
   * @param {string} name
   * @param {string} text
   * @returns {Promise<string>}
   */
  writeDoc(which, name, text) {
    return this.writeText(path.join(DIRS[which], String(name || '')), text);
  }

  /**
   * Everything the tab needs in one read, and nothing that needs a spawn.
   *
   * Errors are carried rather than thrown: a board that does not parse must
   * not take the roster and the blueprint down with it, because the whole
   * point of naming the line is that the user can go and fix it.
   *
   * ## `problems`, and why the watch is a re-read (WP-67)
   *
   * Every one of the three reads above hits the disk, so this snapshot is
   * always what is on disk **now**. That is the whole of Studio's artefact
   * watch: there is no cache to go stale, and — this being the half that
   * matters — no watcher that could ever write a file back. A planner's three
   * files appear in the next `GET /api/studio` because they are read, not
   * because anything was notified.
   *
   * `problems` is the same three answers turned into one list the page can
   * draw without knowing the shape of each: `{ file, line, error }`, one entry
   * per artefact that is present and does not validate. An artefact that is
   * absent is not a problem — it is a plan nobody has written yet.
   */
  snapshot() {
    const board = this.readBoard();
    const roster = this.readRoster();
    const blueprint = this.readBlueprint();
    /** @type {Array<{file:string, path:string, line:number|null, error:string}>} */
    const problems = [];
    if (blueprint.error) {
      problems.push({
        file: FILES.blueprint,
        path: this.pathOf(FILES.blueprint),
        line: blueprint.line ?? null,
        error: blueprint.error,
      });
    }
    if (roster.error) {
      problems.push({
        file: FILES.roster,
        path: this.pathOf(FILES.roster),
        line: roster.line ?? null,
        error: roster.error,
      });
    }
    if (board.error) {
      problems.push({
        file: FILES.board,
        path: this.pathOf(FILES.board),
        line: board.line ?? null,
        error: board.error,
      });
    }
    return {
      problems,
      root: this.root,
      dir: this.dir,
      projectKey: this.projectKey,
      exists: this.exists(),
      blueprint: {
        present: blueprint.present,
        text: blueprint.blueprint,
        error: blueprint.error || null,
        line: blueprint.line ?? null,
      },
      roster: {
        present: roster.present,
        roster: roster.roster || null,
        error: roster.error || null,
        errorPath: roster.errorPath || null,
        line: roster.line ?? null,
      },
      board: {
        present: board.present,
        board: board.board || null,
        error: board.error || null,
        errorPath: board.errorPath || null,
        line: board.line ?? null,
      },
      rules: { present: this.readRules() != null },
      briefs: this.briefs(),
      handovers: this.handovers(),
    };
  }
}
