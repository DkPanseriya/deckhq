/**
 * GET /api/changes?id=   what changed on disk in a session's working tree
 *
 * docs/plan/05-GUI-UX-SPEC.md §4.2, docs/plan/06-ENGINEERING-WORKPLAN.md WP-08.
 *
 * Three read-only git commands, run in the session's cwd with argv arrays
 * (never a shell string — the path is user data): the unstaged diff, the
 * staged diff, and how many commits the branch is ahead of the default
 * branch. The result is cached per scan: the same `scannedAt` for the same
 * directory answers from memory, so a panel that polls costs three spawns per
 * scan per project at most, not per poll.
 *
 * ATTRIBUTION HONESTY. With several agents in one repository a working-tree
 * diff belongs to the directory, not to any one of them. The response is
 * therefore about the project — the panel heads it "what changed in
 * <project>" — and nothing here names an agent. A clean repository is a
 * result ("nothing uncommitted"), not an absence: the section never hides.
 *
 * The four outcomes the panel must draw, each a distinct `status`:
 *   ok         a repository, with `files`/`staged`/`ahead` filled in
 *   clean      a repository with nothing uncommitted (still reports `ahead`)
 *   no-repo    the directory exists but is not inside a git work tree
 *   no-git     git itself is not installed or not on PATH
 *   missing    the directory no longer exists
 */
import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { sendError, sendJson } from '../server.mjs';

const GIT_TIMEOUT_MS = 8_000;
const MAX_OUTPUT = 4 * 1024 * 1024;

/**
 * @typedef {{path:string, added:number|null, removed:number|null, binary:boolean}} FileChange
 * @typedef {{
 *   status: 'ok'|'clean'|'no-repo'|'no-git'|'missing',
 *   cwd: string,
 *   files: FileChange[],
 *   staged: FileChange[],
 *   totals: {files:number, added:number, removed:number},
 *   ahead: {count:number, base:string}|null,
 *   branch: string|null,
 *   error?: string,
 * }} Changes
 */

/**
 * Run git with an argv array in `cwd`. Resolves `{code, stdout, stderr}`;
 * rejects only when the binary itself could not be started.
 * @param {string} git
 * @param {string[]} args
 * @param {string} cwd
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
        // Never let a repository prompt for credentials or open an editor.
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

/**
 * `git diff --numstat` is `--stat`'s machine-readable twin: the same per-file
 * figures, tab-separated, with full paths (the human form truncates long ones
 * with `…`). Binary files report `-  -`.
 * @param {string} out
 * @returns {FileChange[]}
 */
export function parseNumstat(out) {
  /** @type {FileChange[]} */
  const files = [];
  for (const line of String(out).split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    if (parts.length < 3) continue;
    const [a, r] = parts;
    // A rename carries "old\tnew" as two more fields; the new path is what
    // the reader is looking at.
    const path = parts.length >= 4 ? parts[parts.length - 1] : parts[2];
    const binary = a === '-' || r === '-';
    files.push({
      path: path.replace(/^"|"$/g, ''),
      added: binary ? null : Number(a),
      removed: binary ? null : Number(r),
      binary,
    });
  }
  return files;
}

/** @param {FileChange[]} lists */
function totals(...lists) {
  let files = 0;
  let added = 0;
  let removed = 0;
  for (const list of lists) {
    for (const f of list) {
      files++;
      added += f.added || 0;
      removed += f.removed || 0;
    }
  }
  return { files, added, removed };
}

/**
 * The branch to count commits against: the remote's HEAD when there is one,
 * else whichever of `main`/`master` exists locally.
 * @param {string} git @param {string} cwd
 * @returns {Promise<string|null>}
 */
async function defaultBranch(git, cwd) {
  const remote = await runGit(
    git,
    ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    cwd,
  );
  if (remote.code === 0 && remote.stdout.trim()) return remote.stdout.trim();
  for (const name of ['main', 'master']) {
    const r = await runGit(git, ['rev-parse', '--verify', '--quiet', `refs/heads/${name}`], cwd);
    if (r.code === 0) return name;
  }
  return null;
}

/**
 * @param {string} cwd
 * @param {{git?: string}} [opts] `git` overrides the binary, for tests
 * @returns {Promise<Changes>}
 */
export async function collectChanges(cwd, opts = {}) {
  const git = opts.git || 'git';
  /** @type {Changes} */
  const out = {
    status: 'ok',
    cwd,
    files: [],
    staged: [],
    totals: { files: 0, added: 0, removed: 0 },
    ahead: null,
    branch: null,
  };

  try {
    const info = await stat(cwd);
    if (!info.isDirectory()) throw new Error('not a directory');
  } catch {
    out.status = 'missing';
    return out;
  }

  let inside;
  try {
    inside = await runGit(git, ['rev-parse', '--is-inside-work-tree'], cwd);
  } catch (err) {
    out.status = 'no-git';
    out.error = err.message;
    return out;
  }
  if (inside.code !== 0 || inside.stdout.trim() !== 'true') {
    out.status = 'no-repo';
    return out;
  }

  const [unstaged, staged, branch] = await Promise.all([
    runGit(git, ['diff', '--numstat'], cwd),
    runGit(git, ['diff', '--cached', '--numstat'], cwd),
    runGit(git, ['rev-parse', '--abbrev-ref', 'HEAD'], cwd),
  ]);
  out.files = parseNumstat(unstaged.stdout);
  out.staged = parseNumstat(staged.stdout);
  out.totals = totals(out.files, out.staged);
  out.branch = branch.code === 0 ? branch.stdout.trim() || null : null;

  const base = await defaultBranch(git, cwd);
  if (base && out.branch && out.branch !== base) {
    const count = await runGit(git, ['rev-list', '--count', `${base}..HEAD`], cwd);
    if (count.code === 0) out.ahead = { count: Number(count.stdout.trim()) || 0, base };
  } else if (base) {
    out.ahead = { count: 0, base };
  }

  if (out.totals.files === 0) out.status = 'clean';
  return out;
}

/**
 * One cache entry per directory, valid for one scan. `scannedAt` is the
 * registry's own clock, so a forced refresh invalidates it exactly as a
 * scheduled one does.
 */
export function createChangesCache(collect = collectChanges) {
  /** @type {Map<string, {scannedAt:number|null, promise:Promise<Changes>}>} */
  const cache = new Map();
  return {
    /** @param {string} cwd @param {number|null} scannedAt */
    get(cwd, scannedAt) {
      const hit = cache.get(cwd);
      if (hit && hit.scannedAt === scannedAt) return hit.promise;
      const promise = collect(cwd).catch((err) => {
        cache.delete(cwd);
        throw err;
      });
      cache.set(cwd, { scannedAt, promise });
      if (cache.size > 200) cache.delete(cache.keys().next().value);
      return promise;
    },
    size: () => cache.size,
  };
}

/**
 * @param {import('../server.mjs').Router} router
 * @param {{registry:any, log:any}} ctx
 */
export function register(router, ctx) {
  const { registry, log } = ctx;
  const cache = createChangesCache();

  router.get('/api/changes', async (req, res, url) => {
    const id = url.searchParams.get('id') || '';
    if (!id) return sendError(res, 400, 'id is required');
    const agent = registry.agents.find((a) => a.id === id);
    if (!agent) return sendError(res, 404, 'Unknown session');
    if (!agent.cwd) return sendError(res, 404, 'That session has no working directory');
    const snap = registry.snapshot();
    try {
      // A read of the working tree. It must never touch ack state.
      const changes = await cache.get(agent.cwd, snap.scannedAt);
      return sendJson(res, 200, {
        id,
        project: agent.projectName,
        scannedAt: snap.scannedAt,
        ...changes,
      });
    } catch (err) {
      log.warn('changes failed', id, err.message);
      return sendError(res, 500, err.message);
    }
  });
}
