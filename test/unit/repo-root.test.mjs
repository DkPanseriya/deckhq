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
const { namesLiterally, MAX_IGNORE_FILE } = await import('../../src/core/repo-ignores.mjs');
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

test('a submodule is in the room of the repository that holds it, at a bench of its own', () => {
  const root = mainCheckout();
  const sub = path.join(root, 'vendor', 'lib');
  fs.mkdirSync(path.join(sub, 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, '.git', 'modules', 'vendor', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(sub, '.git'), 'gitdir: ../../.git/modules/vendor/lib\n');
  for (const cwd of [sub, path.join(sub, 'src')]) {
    const got = repoRootFor(cwd);
    assert.equal(got.kind, 'submodule');
    assert.equal(projectIdFromCwd(got.root), projectIdFromCwd(root));
    assert.equal(got.worktree.name, 'lib');
    assert.equal(got.worktree.kind, 'submodule');
    assert.equal(samePath(got.worktree.path, sub), true, 'actions run in the submodule');
    assert.equal(samePath(got.own, sub), true, 'and it is still its own repository');
  }

  // A `.git` file that points into a repository nobody can find names no room:
  // the submodule stays the project it was.
  const lost = path.join(scratchDir('repo-root-lost-sub-'), 'lib');
  fs.mkdirSync(lost, { recursive: true });
  const gone = path.join(scratchDir('repo-root-lost-outer-'), 'no-such-repo');
  fs.writeFileSync(
    path.join(lost, '.git'),
    `gitdir: ${gone.replace(/\\/g, '/')}/.git/modules/lib\n`,
  );
  const alone = repoRootFor(lost);
  assert.equal(alone.kind, 'submodule');
  assert.equal(alone.root, lost);
  assert.equal(alone.worktree, null);
  assert.equal(alone.own, lost);
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
  for (const file of ['repo-root.mjs', 'repo-ignores.mjs']) {
    const src = fs.readFileSync(new URL(`../../src/core/${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /child_process|execFile|spawn\(/, file);
    assert.doesNotMatch(src, /Date\.now\(|Math\.random\(/, file);
  }
});

// ------------------------------------------- a repository inside a repository

/** A clone mounted inside `outer` at `rel`: a `.git` DIRECTORY of its own. */
function mountClone(outer, rel = 'internal') {
  const at = path.join(outer, ...rel.split('/'));
  fs.mkdirSync(path.join(at, '.git'), { recursive: true });
  fs.writeFileSync(path.join(at, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  return at;
}

/** Write `outer`'s root `.gitignore`. */
const ignore = (/** @type {string} */ outer, /** @type {string} */ text) =>
  fs.writeFileSync(path.join(outer, '.gitignore'), text);

/** Is `dir` drawn in `outer`'s room, at a bench named for itself? */
function assertJoined(dir, outer, nested, why = '') {
  clearRepoCache();
  const got = repoRootFor(dir);
  assert.equal(got.kind, 'nested', why);
  assert.equal(projectIdFromCwd(got.root), projectIdFromCwd(outer), why);
  assert.equal(got.worktree.name, path.basename(nested), why);
  assert.equal(got.worktree.kind, 'nested', why);
  assert.equal(samePath(got.worktree.path, nested), true, `actions run in the clone ${why}`);
  assert.equal(samePath(got.own, nested), true, why);
}

/** Is `dir` still a project of its own? */
function assertSeparate(dir, outer, why = '') {
  clearRepoCache();
  const got = repoRootFor(dir);
  assert.equal(got.kind, 'main', why);
  assert.equal(got.root, dir, why);
  assert.equal(got.worktree, null, why);
  assert.equal(got.own, dir, why);
  assert.notEqual(projectIdFromCwd(got.root), projectIdFromCwd(outer), why);
}

test('a clone mounted in a repository that names it literally is in that repository’s room', () => {
  const outer = mainCheckout('repo-root-mount-');
  const nested = mountClone(outer);
  for (const line of ['/internal/', 'internal/', '/internal', 'internal', '/internal/  ']) {
    ignore(outer, `node_modules/\n*.log\n\n# the private planning repository\n${line}\n`);
    assertJoined(nested, outer, nested, JSON.stringify(line));
  }
  ignore(outer, 'node_modules/\r\n/internal/\r\n');
  assertJoined(nested, outer, nested, 'CRLF');
  const deep = path.join(nested, 'docs', 'plan');
  fs.mkdirSync(deep, { recursive: true });
  assertJoined(deep, outer, nested, 'from a directory inside the clone');

  // A deeper literal path names a deeper clone.
  const tools = mountClone(outer, 'vendor/tools');
  ignore(outer, '/vendor/tools/\n');
  assertJoined(tools, outer, tools, 'a deeper path');

  // `.git/info/exclude` is the same list, kept out of the tree.
  fs.rmSync(path.join(outer, '.gitignore'));
  fs.mkdirSync(path.join(outer, '.git', 'info'), { recursive: true });
  fs.writeFileSync(path.join(outer, '.git', 'info', 'exclude'), '# local\ninternal/\n');
  assertJoined(nested, outer, nested, 'info/exclude');
});

test('a clone the repository around it does not name stays a project of its own', () => {
  const outer = mainCheckout('repo-root-unnamed-');
  const nested = mountClone(outer);
  assertSeparate(nested, outer, 'no .gitignore at all');
  ignore(outer, 'node_modules/\ndist/\n# /internal/\n');
  assertSeparate(nested, outer, 'named only in a comment');
  ignore(outer, '  internal\n');
  assertSeparate(nested, outer, 'a line git reads as a name with spaces in front');

  // The folder a clone is in is not the clone: `/vendor/` does not name `vendor/tools`.
  const tools = mountClone(outer, 'vendor/tools');
  ignore(outer, '/vendor/\ntools\n');
  assertSeparate(tools, outer, 'its parent folder is named, it is not');
});

test('a wildcard is not a name: a clone ignored only by a pattern stays a project of its own', () => {
  const outer = mainCheckout('repo-root-wild-');
  const nested = mountClone(outer);
  for (const line of [
    '*',
    '/*',
    '**',
    '**/internal',
    'intern*',
    '/intern?l/',
    '[i]nternal',
    '\\internal',
  ]) {
    ignore(outer, `${line}\n`);
    assertSeparate(nested, outer, JSON.stringify(line));
  }
  // Named, and then taken back by name: git does not ignore it, so it is not claimed.
  ignore(outer, '/internal/\n!/internal/\n');
  assertSeparate(nested, outer, 'negated');
  ignore(outer, '!internal\n/internal/\n');
  assertJoined(nested, outer, nested, 'the last line that names it wins');
});

test('INVARIANT: a home directory kept in git with everything ignored does not swallow the projects below it', () => {
  const home = path.join(scratchDir('repo-root-home-'), 'me');
  fs.mkdirSync(path.join(home, '.git'), { recursive: true });
  fs.writeFileSync(path.join(home, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const api = mountClone(home, 'code/api');
  const web = mountClone(home, 'code/web');
  const top = mountClone(home, 'notes');
  for (const text of ['*\n!.bashrc\n!.gitignore\n', '/*\n!/.config/\n', '*\n', '/code/\n*\n']) {
    ignore(home, text);
    for (const project of [api, web, top]) assertSeparate(project, home, JSON.stringify(text));
    clearRepoCache();
    const rooms = [home, api, web, top].map((dir) => projectIdFromCwd(repoRootFor(dir).root));
    assert.equal(new Set(rooms).size, 4, `four rooms: ${JSON.stringify(text)}`);
  }
  // The same in `info/exclude`, which is where a dotfiles repository often keeps it.
  fs.rmSync(path.join(home, '.gitignore'));
  fs.mkdirSync(path.join(home, '.git', 'info'), { recursive: true });
  fs.writeFileSync(path.join(home, '.git', 'info', 'exclude'), '*\n');
  for (const project of [api, web, top]) assertSeparate(project, home, 'info/exclude');
});

test('a clone mounted in a linked worktree of the repository is in the repository’s room', () => {
  const root = mainCheckout('repo-root-mount-wt-');
  const wt = linkWorktree(root, path.join(root, '.claude', 'worktrees', 'agent-a1'));
  const nested = mountClone(wt);
  assertSeparate(nested, root, 'the worktree does not name it');
  ignore(wt, '/internal/\n');
  assertJoined(nested, root, nested, 'named by the worktree’s own .gitignore');
  // Named by the repository's `info/exclude`, which every worktree of it shares.
  fs.rmSync(path.join(wt, '.gitignore'));
  fs.mkdirSync(path.join(root, '.git', 'info'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'info', 'exclude'), 'internal\n');
  assertJoined(nested, root, nested, 'named by the shared info/exclude');
});

test('nesting is followed outward: a clone in a submodule in a repository ends at the repository', () => {
  const root = mainCheckout('repo-root-chain-');
  const sub = path.join(root, 'vendor', 'lib');
  fs.mkdirSync(sub, { recursive: true });
  fs.mkdirSync(path.join(root, '.git', 'modules', 'vendor', 'lib', 'info'), { recursive: true });
  fs.writeFileSync(path.join(sub, '.git'), 'gitdir: ../../.git/modules/vendor/lib\n');
  const nested = mountClone(sub, 'notes');
  // Not named by the submodule: the clone is its own project, the submodule is not.
  assertSeparate(nested, root, 'the submodule does not name it');
  ignore(sub, '/notes/\n');
  assertJoined(nested, root, nested, 'clone → submodule → repository');
  // And a linked worktree OF the clone is a linked worktree still, in that room.
  const wt = linkWorktree(nested, path.join(nested, '.claude', 'worktrees', 'agent-b2'));
  clearRepoCache();
  const got = repoRootFor(wt);
  assert.equal(got.kind, 'worktree');
  assert.equal(projectIdFromCwd(got.root), projectIdFromCwd(root));
  assert.deepEqual(
    { name: got.worktree.name, kind: got.worktree.kind },
    { name: 'agent-b2', kind: 'linked' },
  );
  assert.equal(samePath(got.worktree.path, wt), true);
  assert.equal(samePath(got.own, nested), true, 'its own repository is the clone');
  // The same worktree once it has been removed, recognised by its path alone.
  const gone = path.join(nested, '.claude', 'worktrees', 'agent-c3');
  const guessed = repoRootFor(gone);
  assert.equal(guessed.kind, 'guess');
  assert.equal(projectIdFromCwd(guessed.root), projectIdFromCwd(root));
  assert.equal(samePath(guessed.own, nested), true);
});

test('a .gitignore that cannot be read, or is too big to be one, claims nothing and throws nothing', () => {
  const outer = mainCheckout('repo-root-unreadable-');
  const nested = mountClone(outer);
  // A directory where the file should be: every read of it fails.
  fs.mkdirSync(path.join(outer, '.gitignore'));
  assert.doesNotThrow(() => repoRootFor(nested));
  assertSeparate(nested, outer, 'a directory called .gitignore');
  fs.rmdirSync(path.join(outer, '.gitignore'));
  // The line is there, on the first line, of a file past the size it is read to.
  ignore(outer, `/internal/\n${'# padding\n'.repeat(Math.ceil(MAX_IGNORE_FILE / 10) + 1)}`);
  assert.ok(fs.statSync(path.join(outer, '.gitignore')).size > MAX_IGNORE_FILE);
  assert.doesNotThrow(() => repoRootFor(nested));
  assertSeparate(nested, outer, 'a .gitignore over the cap');
  // The repository around it has a `.git` nobody can make sense of.
  const odd = path.join(scratchDir('repo-root-odd-outer-'), 'odd');
  fs.mkdirSync(odd, { recursive: true });
  fs.writeFileSync(path.join(odd, '.git'), 'not what git writes\n');
  ignore(odd, '/internal/\n');
  assertSeparate(mountClone(odd), odd, 'the outer .git is not a repository');
});

test('Windows and POSIX spellings of a literal line name the same directory', () => {
  assert.equal(namesLiterally('/internal/\n', 'internal'), true);
  assert.equal(namesLiterally('vendor/tools\r\n', 'vendor\\tools'), true);
  assert.equal(namesLiterally('/Vendor/Tools/\n', 'vendor/tools/'), true, 'case is not a name');
  assert.equal(namesLiterally('internal\n', 'docs/internal'), false, 'the whole path or nothing');
  assert.equal(namesLiterally('vendor\\tools\n', 'vendor/tools'), false, 'a backslash escapes');
  assert.equal(namesLiterally('', 'internal'), false);
  assert.equal(namesLiterally('/\n', ''), false, 'nothing names the repository itself');
  for (const odd of [null, undefined, 42, {}]) {
    assert.doesNotThrow(() => namesLiterally(/** @type {any} */ (odd), /** @type {any} */ (odd)));
  }

  const outer = mainCheckout('repo-root-spelt-');
  const nested = mountClone(outer);
  ignore(outer, '/internal/\n');
  const forward = repoRootFor(nested.replace(/\\/g, '/'));
  assert.equal(forward.kind, 'nested');
  assert.equal(projectIdFromCwd(forward.root), projectIdFromCwd(outer));
  assert.equal(forward.root.includes('\\'), false, 'answered in the spelling it was asked in');
  if (process.platform !== 'win32') return;
  assert.equal(repoRootFor(nested).root, outer, 'backslashes in, backslashes out');
  const shouted = path.join(outer, 'INTERNAL');
  assert.equal(projectIdFromCwd(repoRootFor(shouted).root), projectIdFromCwd(outer));
});

test('a nested answer is forgotten when the .gitignore it was read from changes', () => {
  const outer = mainCheckout('repo-root-ignore-cache-');
  const nested = mountClone(outer);
  assert.equal(repoRootFor(nested).kind, 'main');
  assert.equal(repoRootFor(nested), repoRootFor(nested), 'remembered while nothing changed');
  ignore(outer, '/internal/\n');
  const joined = repoRootFor(nested);
  assert.equal(joined.kind, 'nested');
  assert.equal(repoRootFor(nested), joined, 'and remembered again');
  ignore(outer, '# the line was taken out again\n');
  assert.equal(repoRootFor(nested).kind, 'main');
  fs.rmSync(path.join(outer, '.gitignore'));
  fs.mkdirSync(path.join(outer, '.git', 'info'), { recursive: true });
  fs.writeFileSync(path.join(outer, '.git', 'info', 'exclude'), 'internal\n');
  assert.equal(repoRootFor(nested).kind, 'nested', 'info/exclude is watched as well');
});
