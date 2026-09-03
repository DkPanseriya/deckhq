/**
 * GET  /api/diff?id=&file=      the unified diff for one file
 * POST /api/open-in-editor      {id, file, line}
 *
 * docs/plan/08-PLAN-V2-100X.md §8.1 and §9 WP-47; `05-GUI-UX-SPEC.md` §4.1
 * ends the changes section with `[ open the diff ]`, which WP-08 deliberately
 * left here (docs/DEVIATIONS.md §85.2).
 *
 * This is `/api/changes` one level deeper and follows it exactly: two
 * read-only git commands per file, argv arrays (the path is user data), run
 * in the session's own cwd, cached per scan so a panel that polls costs
 * nothing. It never touches ack state.
 *
 * ATTRIBUTION HONESTY (`05` §4.2). A working-tree diff belongs to the
 * directory, not to an agent. Nothing in this response names one, and the
 * panel keeps heading the section "what changed in <project>".
 *
 * CONFINEMENT. `file` is a path from the client. It is resolved against the
 * repository's own top level and refused — 400, never clamped — if it lands
 * outside. `git rev-parse --show-toplevel` is what defines "inside": a
 * session's cwd is often a subdirectory of its repository, and
 * `git diff --numstat` (what the panel's rows are built from) reports paths
 * relative to the top level, not to the cwd.
 *
 * THE CAP. A diff is unbounded — a lockfile regeneration is megabytes — and
 * this one is being rendered into a side panel. The response carries at most
 * `MAX_DIFF_BYTES` per diff, cut on a line boundary, with `truncated: true`
 * so the panel can say so rather than quietly showing half a file.
 */
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { readJson, sendError, sendJson } from '../server.mjs';
import { openInEditor } from '../../core/editor.mjs';

const GIT_TIMEOUT_MS = 8_000;
/** Room for a diff well past the cap, so the cap is ours and not execFile's. */
const MAX_OUTPUT = 8 * 1024 * 1024;

/** 200 KB per diff. Two of those is still a fraction of one JSON response. */
export const MAX_DIFF_BYTES = 200 * 1024;

/**
 * @typedef {{text:string, truncated:boolean, bytes:number}} DiffText
 * @typedef {{
 *   status: 'ok'|'empty'|'outside'|'no-repo'|'no-git'|'missing',
 *   cwd: string,
 *   file: string,
 *   unstaged: DiffText,
 *   staged: DiffText,
 *   error?: string,
 * }} FileDiff
 */

/**
 * Run git with an argv array in `cwd`. Same shape and same hardening as
 * `routes/changes.mjs`: no credential prompt, no editor, C locale, and it
 * rejects only when the binary itself could not be started.
 * @param {string} git @param {string[]} args @param {string} cwd
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
function runGit(git, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(
      git,
      ['--no-optional-locks', ...args],
      {
        cwd,
        timeout: GIT_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', LC_ALL: 'C' },
      },
      (err, stdout, stderr) => {
        if (err && (err.code === 'ENOENT' || err.code === 'EACCES')) return reject(err);
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
        resolve({ code, stdout: String(stdout || ''), stderr: String(stderr || '') });
      },
    );
  });
}

/** @param {string} p */
const fwd = (p) => p.replace(/\\/g, '/');

/**
 * Cut a diff to the cap on a line boundary. Byte-based, because the cap is
 * about the size of the response and a multi-byte file is still a file.
 * @param {string} text
 * @returns {DiffText}
 */
export function capDiff(text) {
  const s = String(text || '');
  const bytes = Buffer.byteLength(s, 'utf8');
  if (bytes <= MAX_DIFF_BYTES) return { text: s, truncated: false, bytes };
  let cut = Buffer.from(s, 'utf8').subarray(0, MAX_DIFF_BYTES).toString('utf8');
  const nl = cut.lastIndexOf('\n');
  // A cut mid-character leaves a replacement glyph; trimming back to the last
  // newline removes it and keeps every rendered line whole.
  if (nl > 0) cut = cut.slice(0, nl + 1);
  return { text: cut, truncated: true, bytes };
}

/**
 * Resolve `file` inside the repository that `cwd` belongs to.
 *
 * @param {string} top   the repository's top level, absolute
 * @param {string} file  as it arrived from the client
 * @returns {string|null} absolute path, or null when it is not inside `top`
 */
export function resolveInRepo(top, file) {
  const raw = String(file || '');
  if (!raw || raw.includes('\0')) return null;
  const root = path.resolve(top);
  const target = path.resolve(root, raw);
  // `relative` is the only trustworthy containment test on Windows, where
  // drive letters and case-insensitivity make prefix comparison unsafe. Same
  // rule as `serveStatic` in http/server.mjs.
  const rel = path.relative(root, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return target;
}

/**
 * The unified diff for one file, unstaged and staged.
 *
 * `--no-ext-diff` and `--no-textconv` matter: both let a repository's own
 * config name a program to run while producing a diff, and this diff is
 * produced because a browser asked for it.
 *
 * @param {string} cwd   the session's working directory
 * @param {string} file  path from the client, relative to the repo top level
 * @param {{git?: string}} [opts]
 * @returns {Promise<FileDiff>}
 */
export async function collectFileDiff(cwd, file, opts = {}) {
  const git = opts.git || 'git';
  /** @type {FileDiff} */
  const out = {
    status: 'ok',
    cwd,
    file: String(file || ''),
    unstaged: { text: '', truncated: false, bytes: 0 },
    staged: { text: '', truncated: false, bytes: 0 },
  };

  try {
    const info = await stat(cwd);
    if (!info.isDirectory()) throw new Error('not a directory');
  } catch {
    out.status = 'missing';
    return out;
  }

  let top;
  try {
    top = await runGit(git, ['rev-parse', '--show-toplevel'], cwd);
  } catch (err) {
    out.status = 'no-git';
    out.error = err.message;
    return out;
  }
  if (top.code !== 0 || !top.stdout.trim()) {
    out.status = 'no-repo';
    return out;
  }

  const root = top.stdout.trim();
  const target = resolveInRepo(root, out.file);
  if (!target) {
    out.status = 'outside';
    return out;
  }
  out.file = fwd(path.relative(path.resolve(root), target));

  // An absolute pathspec with forward slashes: unambiguous from any cwd
  // inside the repository, and portable (checked against git 2.55 on
  // Windows, where `--numstat` paths are top-level-relative but the cwd
  // need not be the top level).
  const pathspec = fwd(target);
  const base = ['diff', '--no-ext-diff', '--no-textconv', '--no-color'];
  const [unstaged, staged] = await Promise.all([
    runGit(git, [...base, '--', pathspec], cwd),
    runGit(git, [...base, '--cached', '--', pathspec], cwd),
  ]);
  out.unstaged = capDiff(unstaged.stdout);
  out.staged = capDiff(staged.stdout);
  if (!out.unstaged.text && !out.staged.text) out.status = 'empty';
  return out;
}

/**
 * One cache entry per (directory, file), valid for one scan — the same
 * contract as `createChangesCache`, so expanding a row costs two git spawns
 * per scan however often the panel re-renders.
 * @param {(cwd:string, file:string) => Promise<FileDiff>} [collect]
 */
export function createDiffCache(collect = collectFileDiff) {
  /** @type {Map<string, {scannedAt:number|null, promise:Promise<FileDiff>}>} */
  const cache = new Map();
  return {
    /** @param {string} cwd @param {string} file @param {number|null} scannedAt */
    get(cwd, file, scannedAt) {
      const key = JSON.stringify([cwd, file]);
      const hit = cache.get(key);
      if (hit && hit.scannedAt === scannedAt) return hit.promise;
      const promise = collect(cwd, file).catch((err) => {
        cache.delete(key);
        throw err;
      });
      cache.set(key, { scannedAt, promise });
      if (cache.size > 400) cache.delete(cache.keys().next().value);
      return promise;
    },
    size: () => cache.size,
  };
}

/**
 * @param {import('../server.mjs').Router} router
 * @param {{registry:any, store:any, log:any}} ctx
 */
export function register(router, ctx) {
  const { registry, store, log } = ctx;
  const cache = createDiffCache();

  /** The session, or an error already sent. @returns {any|null} */
  function sessionFor(res, id) {
    if (!id) {
      sendError(res, 400, 'id is required');
      return null;
    }
    const agent = registry.agents.find((a) => a.id === id);
    if (!agent) {
      sendError(res, 404, 'Unknown session');
      return null;
    }
    if (!agent.cwd) {
      sendError(res, 404, 'That session has no working directory');
      return null;
    }
    return agent;
  }

  router.get('/api/diff', async (req, res, url) => {
    const id = url.searchParams.get('id') || '';
    const file = url.searchParams.get('file') || '';
    const agent = sessionFor(res, id);
    if (!agent) return;
    if (!file) return sendError(res, 400, 'file is required');
    const snap = registry.snapshot();
    try {
      // A read of the working tree. It must never touch ack state.
      const diff = await cache.get(agent.cwd, file, snap.scannedAt);
      if (diff.status === 'outside') {
        return sendError(res, 400, 'That path is outside the session’s repository');
      }
      return sendJson(res, 200, {
        id,
        project: agent.projectName,
        scannedAt: snap.scannedAt,
        max: MAX_DIFF_BYTES,
        ...diff,
      });
    } catch (err) {
      log.warn('diff failed', id, err.message);
      return sendError(res, 500, err.message);
    }
  });

  /**
   * Open one file at one line in the user's editor.
   *
   * The client sends a session id, a path and a line. It never sends a
   * command: which program this means is `settings.editor` resolved against
   * `core/editor.mjs`'s allowlist, and a value outside that set is refused.
   */
  router.post('/api/open-in-editor', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    const id = String(body.id || '');
    const agent = sessionFor(res, id);
    if (!agent) return;
    const file = String(body.file || '');
    if (!file) return sendError(res, 400, 'file is required');
    const line = Number(body.line) > 0 ? Math.floor(Number(body.line)) : 1;

    let root;
    try {
      const top = await runGit('git', ['rev-parse', '--show-toplevel'], agent.cwd);
      root = top.code === 0 && top.stdout.trim() ? top.stdout.trim() : null;
    } catch {
      root = null;
    }
    // No repository is not a reason to refuse: the session's own directory is
    // then the only boundary there is, and it is the right one.
    const target = resolveInRepo(root || agent.cwd, file);
    if (!target) {
      return sendError(res, 400, 'That path is outside the session’s repository');
    }

    try {
      const opened = openInEditor({
        file: target,
        line,
        preference: store.settings.editor,
        cwd: agent.cwd,
      });
      return sendJson(res, 200, { ok: true, editor: opened.editor, label: opened.label });
    } catch (err) {
      log.warn('open-in-editor refused', id, err.message);
      return sendError(res, 400, err.message);
    }
  });
}
