/**
 * One git worktree per hired role — WP-68, `docs/07-STUDIO-DESIGN.md` §4.
 *
 * `git worktree add <state>/worktrees/<project>-<role> -b studio/<role>`, and
 * every word of that sentence is a decision:
 *
 *   **Under the state directory**, not under the user's repository (§11.2,
 *   owner's default). Removal then knows exactly what it made, and a project
 *   the user is about to commit gains no untracked directory it has to
 *   gitignore.
 *
 *   **A branch per role**, `studio/<role>`, so two hired roles never write the
 *   same index and a `git log` says which role did what.
 *
 *   **An argv array, never a shell** (§9). `execFile` with an array, no
 *   `shell: true`, no interpolation into a command line anywhere — the rule
 *   `docs/DEVIATIONS.md` §28 makes absolute for this whole area.
 *
 * ## THE REFUSAL, and why it is not an escape
 *
 * A role name is a job title somebody typed. `roster.json` accepts a wide one
 * — "Backend engineer" is a job title (`schema.mjs`'s `ROLE_NAME_RE`) — but a
 * name that is about to become an argv element, a branch name AND a directory
 * name is a narrower question, and §10's acceptance criterion (2) settles it:
 * *a role name with a space, a quote or a `;` is refused rather than escaped*.
 *
 * So this module holds an **allowlist**, and everything outside it is refused
 * with a NAMED reason the user can act on. Escaping would mean getting three
 * re-parsings right at once (argv, git's refname rules, the filesystem's) and
 * being wrong on exactly one platform; refusing costs the user a rename and
 * cannot be subtly wrong. The five §10 names each get their own sentence,
 * because "invalid role name" is not a thing anybody can fix.
 *
 * ## What Fire does, which is nothing
 *
 * §8: **Fire takes the role off the floor and the board and leaves the process
 * alone.** It leaves the worktree alone too, and `describeFire()` is the whole
 * of the removal helper: it returns the path, the branch, the two things it
 * did NOT do, and the command the user may run themselves. Removing a worktree
 * would delete work an agent did and DeckHQ never saw, and killing a process
 * DeckHQ did not start is the promise `docs/DEVIATIONS.md` §115 refuses to
 * make. Neither is a thing a button may do quietly.
 *
 * Nothing here opens a socket, reads a transcript, or knows what a session is.
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { samePath } from '../core/same-path.mjs';

/** The directory, under the state directory, that holds every one of them. */
export const WORKTREES_DIR = 'worktrees';

/** Every Studio branch starts here, so `git branch --list 'studio/*'` is a roster. */
export const BRANCH_PREFIX = 'studio/';

/** How long one git call is waited for. A worktree add is disk, not network. */
export const GIT_TIMEOUT_MS = 60 * 1000;

/**
 * What a role name may be, once it is going to be an argv element, a git
 * refname and a directory name all at once. See the header.
 */
export const ROLE_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

/**
 * A git call that failed, or a role name that was refused. `reason` is a
 * stable token the caller can branch on; `error.message` is the sentence.
 */
export class WorktreeError extends Error {
  /**
   * @param {string} message
   * @param {string} reason a stable token — `role-space`, `not-a-repo`, …
   * @param {string} [value] the offending value, when there is one
   */
  constructor(message, reason, value) {
    super(message);
    this.name = 'WorktreeError';
    this.reason = reason;
    this.value = value || '';
  }
}

/**
 * Is this role name safe to hire under, and if not, exactly what is wrong?
 *
 * The named cases come first so the message is one the user can act on, and
 * the allowlist catches everything else rather than letting it through.
 *
 * @param {unknown} raw
 * @returns {{name:string}|{error:string, reason:string}}
 */
export function checkRoleName(raw) {
  const name = typeof raw === 'string' ? raw : '';
  const refuse = (reason, why) => ({
    error: `"${name}" cannot be hired: ${why} DeckHQ refuses a role name it would have to escape rather than escaping it, because a worktree path, a branch name and a command line each quote differently. Rename the role to letters, digits, ".", "_" or "-".`,
    reason,
  });

  if (!name.trim()) return refuse('role-empty', 'a role needs a name.');
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return refuse('role-control', 'it carries a control character.');
  }
  if (/\s/.test(name)) return refuse('role-space', 'it carries a space.');
  if (/["'`]/.test(name)) return refuse('role-quote', 'it carries a quote.');
  if (name.includes(';')) return refuse('role-semicolon', 'it carries a ";".');
  if (name.startsWith('-')) {
    return refuse('role-leading-dash', 'it starts with "-", which git would read as an option.');
  }
  if (/[\\/]/.test(name) || name.includes(':')) {
    return refuse('role-separator', 'it carries a path separator.');
  }
  if (name === '.' || name === '..' || name.includes('..')) {
    return refuse('role-dots', 'it carries "..".');
  }
  if (name.length > 64) return refuse('role-length', 'it is longer than 64 characters.');
  if (!ROLE_RE.test(name)) {
    return refuse(
      'role-charset',
      'it carries a character outside letters, digits, ".", "_" and "-".',
    );
  }
  return { name };
}

/**
 * The project half of a worktree's directory name.
 *
 * The directory's basename, lowercased and reduced to the same alphabet a role
 * name lives in. It is a LABEL, not an identity — `projectKeyFor()` is the
 * identity, and two projects called `api` in different parents would collide
 * here — so the caller is the one that must not let two projects share a
 * worktree, and `ensureWorktree()` refuses a directory that belongs to another
 * repository rather than adopting it.
 *
 * @param {string} projectRoot
 * @returns {string}
 */
export function projectSlug(projectRoot) {
  const base = path.basename(path.resolve(String(projectRoot || '')));
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 48);
  return slug || 'project';
}

/** `<dataDir>/worktrees`. */
export function worktreesDirFor(dataDir) {
  return path.join(path.resolve(String(dataDir || '')), WORKTREES_DIR);
}

/** `<dataDir>/worktrees/<project>-<role>`, absolute. Pure. */
export function worktreePathFor(dataDir, projectRoot, role) {
  return path.join(worktreesDirFor(dataDir), `${projectSlug(projectRoot)}-${role}`);
}

/** `studio/<role>`. Pure. */
export function branchFor(role) {
  return `${BRANCH_PREFIX}${role}`;
}

/**
 * The argv `git` is given, as an array, so a test can assert it element by
 * element rather than read a command line back out of a log.
 *
 * `-b` only when the branch does not exist yet: `git worktree add -b` on a
 * branch that is already there fails, and a role hired, fired and hired again
 * is exactly that case. With the branch present the argv names it positionally
 * and git checks it out into the new worktree.
 *
 * @param {string} worktreePath absolute
 * @param {string} branch
 * @param {{newBranch?:boolean}} [opts]
 * @returns {string[]}
 */
export function addWorktreeArgv(worktreePath, branch, opts = {}) {
  return opts.newBranch === false
    ? ['worktree', 'add', worktreePath, branch]
    : ['worktree', 'add', worktreePath, '-b', branch];
}

/**
 * Run one `git` command with an argv array and no shell.
 *
 * @param {string[]} argv
 * @param {{cwd:string, timeoutMs?:number}} opts
 * @returns {Promise<{code:number, stdout:string, stderr:string}>} a non-zero
 *   exit is an ANSWER, not a throw: half of what this module asks git is a
 *   question whose "no" is an exit code.
 */
export function runGit(argv, opts) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      argv,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err && /** @type {any} */ (err).code === 'ENOENT') {
          reject(
            new WorktreeError(
              'git was not found on PATH, and a Studio worktree is a git worktree. Install git, or hire nobody.',
              'no-git',
            ),
          );
          return;
        }
        const code = err ? Number(/** @type {any} */ (err).code ?? 1) : 0;
        resolve({ code, stdout: String(stdout || ''), stderr: String(stderr || '') });
      },
    );
  });
}

/**
 * Every worktree path this repository already knows about.
 * @param {(argv:string[], opts:any) => Promise<{code:number, stdout:string}>} git
 * @param {string} cwd
 * @returns {Promise<string[]>}
 */
export async function listWorktrees(git, cwd) {
  const out = await git(['worktree', 'list', '--porcelain'], { cwd });
  if (out.code !== 0) return [];
  return out.stdout
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => path.resolve(line.slice('worktree '.length).trim()));
}

/**
 * Make — or find — the worktree one role works in.
 *
 * **Idempotent, and it says which it was.** A role hired twice must not fail
 * and must not get a second directory: an existing worktree for that role is
 * reused and reported as reused, because "I made you one" and "you already had
 * one" are different facts and the card shows which.
 *
 * @param {string} projectRoot the repository, absolute
 * @param {string} role a name `checkRoleName()` has already accepted
 * @param {{dataDir:string, git?:typeof runGit, timeoutMs?:number}} opts
 *   `git` is the test seam: a stand-in records the argv instead of running it.
 * @returns {Promise<{path:string, branch:string, created:boolean, reused:boolean,
 *                    argv:string[]|null, newBranch:boolean}>}
 */
export async function ensureWorktree(projectRoot, role, opts) {
  const checked = checkRoleName(role);
  if ('error' in checked) throw new WorktreeError(checked.error, checked.reason, String(role));

  const root = path.resolve(String(projectRoot || ''));
  const git = opts.git || runGit;
  const timeoutMs = opts.timeoutMs;
  const target = worktreePathFor(opts.dataDir, root, checked.name);
  const branch = branchFor(checked.name);

  const isRepo = await git(['rev-parse', '--git-dir'], { cwd: root, timeoutMs });
  if (isRepo.code !== 0) {
    throw new WorktreeError(
      `${root} is not a git repository, and a Studio worktree is a git worktree. Run \`git init\` there first.`,
      'not-a-repo',
      root,
    );
  }

  const known = await listWorktrees(git, root);
  // `samePath`, not `===`: git lists the real path and `target` is spelt the
  // way the data directory was, and a worktree we made ourselves, unrecognised,
  // falls through to `occupied` below — a second Hire refused by the first.
  const registered = known.some((p) => samePath(p, target));
  if (registered && fs.existsSync(target)) {
    return { path: target, branch, created: false, reused: true, argv: null, newBranch: false };
  }
  if (!registered && fs.existsSync(target)) {
    throw new WorktreeError(
      `${target} already exists and is not a worktree of ${root}. DeckHQ will not write into a directory it did not make; move it aside or rename the role.`,
      'occupied',
      target,
    );
  }
  if (registered && !fs.existsSync(target)) {
    // Git remembers a worktree whose directory somebody deleted. Prune first,
    // so the add below is not refused by a record of a directory that is gone.
    await git(['worktree', 'prune'], { cwd: root, timeoutMs });
  }

  const hasBranch = await git(['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], {
    cwd: root,
    timeoutMs,
  });
  const newBranch = hasBranch.code !== 0;

  await fs.promises.mkdir(worktreesDirFor(opts.dataDir), { recursive: true });
  const argv = addWorktreeArgv(target, branch, { newBranch });
  const added = await git(argv, { cwd: root, timeoutMs });
  if (added.code !== 0) {
    throw new WorktreeError(
      `git worktree add failed for "${checked.name}": ${(added.stderr || added.stdout || '').trim() || `exit ${added.code}`}`,
      'git-failed',
      target,
    );
  }

  return { path: target, branch, created: true, reused: false, argv, newBranch };
}

/**
 * What firing a role does to its worktree and its process: **nothing**, and
 * this is the function that says so (§8).
 *
 * It removes no directory, runs no git command and signals no process. What it
 * returns is the note the card carries and the command the USER may run if
 * they want the worktree gone — theirs to run, in their own shell, having read
 * what is in it.
 *
 * @param {{worktree?:string|null, branch?:string|null, role?:string}} role
 * @returns {{worktree:string|null, branch:string|null, removedWorktree:false,
 *            removedBranch:false, stoppedProcess:false, note:string,
 *            youCouldRun:string[]|null}}
 */
export function describeFire(role = {}) {
  const worktree = role.worktree ? path.resolve(String(role.worktree)) : null;
  const branch = role.branch ? String(role.branch) : null;
  const who = role.role ? `"${role.role}"` : 'that role';
  const note = worktree
    ? `${who} is off the floor. Its worktree at ${worktree} is untouched and so is anything running in it: DeckHQ does not delete work it never saw, and does not signal a process it did not start.`
    : `${who} is off the floor. Nothing was removed and nothing was stopped.`;
  return {
    worktree,
    branch,
    removedWorktree: false,
    removedBranch: false,
    stoppedProcess: false,
    note,
    // Named, never run. `git worktree remove` refuses a dirty tree on its own,
    // which is one more reason this is the user's command and not ours.
    youCouldRun: worktree ? ['git', 'worktree', 'remove', worktree] : null,
  };
}
