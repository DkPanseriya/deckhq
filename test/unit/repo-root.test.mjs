/**
 * A worktree is not a project — `src/core/repo-root.mjs`.
 *
 * Every directory here is built by hand: a `.git` directory, or a `.git` FILE
 * with the `gitdir:` line git would have written, and the `commondir` file
 * beside it. Nothing runs git, because the resolver must not either.
 */
import { scratchDir } from '../helpers/isolate.mjs';

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const { repoRootFor, clearRepoCache, parseGitFile, claudeWorktreeOf, studioWorktreeOf } =
  await import('../../src/core/repo-root.mjs');
const { samePath } = await import('../../src/core/same-path.mjs');
const { projectIdFromCwd } = await import('../../src/core/model.mjs');

beforeEach(() => clearRepoCache());

/** A main checkout: `<root>/.git/` with the two files every repository has. */
function mainCheckout(prefix = 'repo-root-') {
  const root = path.join(scratchDir(prefix), 'career-ops');
  fs.mkdirSync(path.join(root, '.git', 'worktrees'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  return root;
}

/**
 * A linked worktree of `root` at `at`, the way `git worktree add` leaves it.
 * @param {string} root
 * @param {string} at
 * @param {{relative?: boolean, commondir?: string|null}} [opts]
 */
function linkWorktree(root, at, opts = {}) {
  const name = path.basename(at);
  const admin = path.join(root, '.git', 'worktrees', name);
  fs.mkdirSync(admin, { recursive: true });
  fs.mkdirSync(at, { recursive: true });
  if (opts.commondir !== null) {
    fs.writeFileSync(path.join(admin, 'commondir'), `${opts.commondir ?? '../..'}\n`);
  }
  const gitdir = opts.relative ? path.relative(at, admin) : admin;
  fs.writeFileSync(path.join(at, '.git'), `gitdir: ${gitdir.replace(/\\/g, '/')}\n`);
  return at;
}

test('a main checkout is its own repository, and keeps the spelling it was asked with', () => {
  const root = mainCheckout();
  const got = repoRootFor(root);
  assert.equal(got.kind, 'main');
  assert.equal(got.root, root);
  assert.equal(got.worktree, null);
});

test('a linked worktree with an ABSOLUTE gitdir resolves to the repository', () => {
  const root = mainCheckout();
  const wt = linkWorktree(root, path.join(root, '.claude', 'worktrees', 'awesome-franklin-2d1495'));
  const got = repoRootFor(wt);
  assert.equal(got.kind, 'worktree');
  assert.equal(samePath(got.root, root), true);
  assert.equal(projectIdFromCwd(got.root), projectIdFromCwd(root));
  assert.equal(got.worktree.name, 'awesome-franklin-2d1495');
  assert.equal(samePath(got.worktree.path, wt), true);
});

test('a linked worktree with a RELATIVE gitdir resolves to the repository', () => {
  const root = mainCheckout();
  const wt = linkWorktree(root, path.join(path.dirname(root), 'career-ops-feature'), {
    relative: true,
  });
  assert.match(fs.readFileSync(path.join(wt, '.git'), 'utf8'), /^gitdir: \.\.\//);
  const got = repoRootFor(wt);
  assert.equal(got.kind, 'worktree');
  assert.equal(projectIdFromCwd(got.root), projectIdFromCwd(root));
  assert.equal(got.worktree.name, 'career-ops-feature');
});

test('a worktree whose commondir file is missing is read from its gitdir path', () => {
  const root = mainCheckout();
  const wt = linkWorktree(root, path.join(path.dirname(root), 'wt-no-common'), { commondir: null });
  const got = repoRootFor(wt);
  assert.equal(got.kind, 'worktree');
  assert.equal(projectIdFromCwd(got.root), projectIdFromCwd(root));
});

test('a session started in a subdirectory belongs to the repository above it', () => {
  const root = mainCheckout();
  const deep = path.join(root, 'packages', 'api', 'src');
  fs.mkdirSync(deep, { recursive: true });
  const got = repoRootFor(deep);
  assert.equal(got.kind, 'main');
  assert.equal(projectIdFromCwd(got.root), projectIdFromCwd(root));
  assert.equal(got.worktree, null);

  const wt = linkWorktree(root, path.join(path.dirname(root), 'wt-nested'));
  const inside = path.join(wt, 'docs', 'plan');
  fs.mkdirSync(inside, { recursive: true });
  const nested = repoRootFor(inside);
  assert.equal(nested.kind, 'worktree');
  assert.equal(projectIdFromCwd(nested.root), projectIdFromCwd(root));
  assert.equal(nested.worktree.name, 'wt-nested');
  assert.equal(samePath(nested.worktree.path, wt), true);
});

test('a submodule is its own project, not a worktree of the repository around it', () => {
  const root = mainCheckout();
  const sub = path.join(root, 'vendor', 'lib');
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(path.join(root, '.git', 'modules', 'vendor', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(sub, '.git'), 'gitdir: ../../.git/modules/vendor/lib\n');
  const got = repoRootFor(sub);
  assert.equal(got.kind, 'submodule');
  assert.equal(got.root, sub);
  assert.equal(got.worktree, null);
  assert.notEqual(projectIdFromCwd(got.root), projectIdFromCwd(root));
});

test('a worktree of a bare repository is named for the repository', () => {
  const home = scratchDir('repo-root-bare-');
  const bare = path.join(home, 'career-ops', '.bare');
  const wt = path.join(home, 'career-ops', 'feature-x');
  const admin = path.join(bare, 'worktrees', 'feature-x');
  fs.mkdirSync(admin, { recursive: true });
  fs.mkdirSync(wt, { recursive: true });
  fs.writeFileSync(path.join(admin, 'commondir'), '../..\n');
  fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${admin.replace(/\\/g, '/')}\n`);
  const got = repoRootFor(wt);
  assert.equal(got.kind, 'worktree');
  assert.equal(got.bare, true);
  assert.equal(path.basename(got.root), 'career-ops');
  assert.equal(got.worktree.name, 'feature-x');

  // `project.git` is named for itself rather than for the directory holding it.
  const dotGit = path.join(home, 'srv', 'deckhq.git');
  const wt2 = path.join(home, 'elsewhere', 'hotfix');
  const admin2 = path.join(dotGit, 'worktrees', 'hotfix');
  fs.mkdirSync(admin2, { recursive: true });
  fs.mkdirSync(wt2, { recursive: true });
  fs.writeFileSync(path.join(wt2, '.git'), `gitdir: ${admin2.replace(/\\/g, '/')}\n`);
  const named = repoRootFor(wt2);
  assert.equal(named.bare, true);
  assert.equal(path.basename(named.root), 'deckhq');
});

test('a worktree that was already deleted is recognised by its path', () => {
  const root = mainCheckout();
  const gone = path.join(root, '.claude', 'worktrees', 'agent-a0fedbce8c57e1bf9');
  assert.equal(fs.existsSync(gone), false);
  const got = repoRootFor(gone);
  assert.equal(got.kind, 'guess');
  assert.equal(projectIdFromCwd(got.root), projectIdFromCwd(root));
  assert.equal(got.worktree.name, 'agent-a0fedbce8c57e1bf9');

  // Below it, too, and with the repository itself gone as well.
  const deeper = repoRootFor(path.join(gone, 'src', 'core'));
  assert.equal(deeper.worktree.name, 'agent-a0fedbce8c57e1bf9');
  assert.equal(projectIdFromCwd(deeper.root), projectIdFromCwd(root));

  const nowhere = path.join(scratchDir('repo-root-gone-'), 'no', 'such', 'repo');
  const lost = repoRootFor(path.join(nowhere, '.claude', 'worktrees', 'dazzling-dijkstra-657ac8'));
  assert.equal(lost.kind, 'guess');
  assert.equal(projectIdFromCwd(lost.root), projectIdFromCwd(nowhere));
  assert.equal(lost.worktree.name, 'dazzling-dijkstra-657ac8');
});

test('a deleted Studio worktree goes home to the repository it was hired for, when it is known', () => {
  const root = mainCheckout();
  const state = scratchDir('repo-root-state-');
  const gone = path.join(state, 'worktrees', 'career-ops-backend-dev');
  const got = repoRootFor(gone, { stateDir: state, knownRoots: [root] });
  assert.equal(got.kind, 'guess');
  assert.equal(got.root, root);
  assert.equal(got.worktree.name, 'backend-dev');

  // Nobody knows the repository: the directory stays what it was before.
  clearRepoCache();
  const unknown = repoRootFor(gone, { stateDir: state, knownRoots: [] });
  assert.equal(unknown.kind, 'none');
  assert.equal(unknown.root, gone);
  assert.equal(unknown.worktree, null);

  // And one that still exists is read, not guessed.
  const live = linkWorktree(root, path.join(state, 'worktrees', 'career-ops-reviewer'));
  const read = repoRootFor(live, { stateDir: state, knownRoots: [] });
  assert.equal(read.kind, 'worktree');
  assert.equal(projectIdFromCwd(read.root), projectIdFromCwd(root));
});

test('an unreadable or meaningless .git falls back to the directory itself, and never throws', () => {
  const dir = path.join(scratchDir('repo-root-bad-'), 'odd');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.git'), 'this is not what git writes\n');
  const got = repoRootFor(dir);
  assert.equal(got.kind, 'none');
  assert.equal(got.root, dir);
  assert.equal(got.worktree, null);

  for (const odd of ['', '   ', null, undefined, 42, '\u0000', 'relative/only']) {
    assert.doesNotThrow(() => repoRootFor(/** @type {any} */ (odd)));
  }
  assert.equal(repoRootFor('').kind, 'none');
  const bare = path.join(scratchDir('repo-root-none-'), 'plain');
  fs.mkdirSync(bare, { recursive: true });
  assert.equal(repoRootFor(bare).root, bare);
});

test('Windows spellings: separators and drive-letter case name one repository', () => {
  // The text of a `.git` file, and the two path heuristics, are read the same
  // on every platform — this half runs on Linux and macOS too.
  assert.equal(
    parseGitFile('gitdir: C:/Work/api/.git/worktrees/fix\r\n'),
    'C:/Work/api/.git/worktrees/fix',
  );
  assert.equal(parseGitFile('not a git file'), null);
  const a = claudeWorktreeOf('C:\\Work\\Api\\.claude\\worktrees\\fix\\src');
  const b = claudeWorktreeOf('c:/work/api/.claude/worktrees/fix');
  assert.equal(a.name, 'fix');
  assert.equal(projectIdFromCwd(a.root), projectIdFromCwd(b.root));
  assert.equal(projectIdFromCwd(a.root), projectIdFromCwd('c:\\work\\api'));
  assert.equal(claudeWorktreeOf('C:\\Work\\Api\\.claude\\notes'), null);
  const s = studioWorktreeOf(
    'C:\\Users\\Me\\.deckhq\\worktrees\\api-reviewer',
    'c:/users/me/.deckhq',
    ['C:\\Work\\Api'],
  );
  assert.equal(s.root, 'C:\\Work\\Api');
  assert.equal(s.name, 'reviewer');

  if (process.platform !== 'win32') return;
  const root = mainCheckout();
  const wt = linkWorktree(root, path.join(path.dirname(root), 'wt-case'));
  const flip = (/** @type {string} */ p) =>
    (p[0] === p[0].toUpperCase() ? p[0].toLowerCase() : p[0].toUpperCase()) + p.slice(1);
  const viaLower = repoRootFor(flip(wt).replace(/\\/g, '/'));
  const viaNative = repoRootFor(wt);
  assert.equal(viaLower.kind, 'worktree');
  assert.equal(projectIdFromCwd(viaLower.root), projectIdFromCwd(viaNative.root));
  assert.equal(samePath(viaLower.root, root), true);
  assert.equal(projectIdFromCwd(repoRootFor(flip(root)).root), projectIdFromCwd(root));
});

test('an answer is remembered, and forgotten when the .git it came from changes', () => {
  const root = mainCheckout();
  const dir = path.join(path.dirname(root), 'becomes-a-worktree');
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(repoRootFor(dir).kind, 'none');
  assert.equal(repoRootFor(dir), repoRootFor(dir), 'the same object: it was not walked twice');
  linkWorktree(root, dir);
  const after = repoRootFor(dir);
  assert.equal(after.kind, 'worktree');
  assert.equal(projectIdFromCwd(after.root), projectIdFromCwd(root));
});

test('the resolver reads files and spawns nothing', () => {
  const src = fs.readFileSync(new URL('../../src/core/repo-root.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /child_process|execFile|spawn\(/);
  assert.doesNotMatch(src, /Date\.now\(|Math\.random\(/);
});
