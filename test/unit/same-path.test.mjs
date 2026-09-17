/**
 * One directory, two names — `src/core/same-path.mjs`.
 *
 * DeckHQ recognises the session it has just started by the directory it
 * started it in, in three places: a queued name (`pending-identity.mjs`), a
 * planner (`plannerAmong`) and a hired role (`roleAmong`). All three compared
 * two strings, and all three were wrong wherever a directory has two names —
 * which is every macOS temp directory (`/var` is `/private/var`) and every
 * Windows runner's (`RUNNER~1`). The name never landed, the planner and the
 * role were never recognised, and none of it failed on Linux.
 *
 * So each matcher is asked the same question here: hired, planned or named by
 * a LINK, with the session reporting the REAL directory, the way an OS does.
 * The link is `fs.symlinkSync(…, 'junction')`, which needs no privilege on
 * Windows and is an ordinary symlink everywhere else.
 */
import { scratchDir } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const { canonicalPath, samePath } = await import('../../src/core/same-path.mjs');
const { createPendingIdentities } = await import('../../src/core/pending-identity.mjs');
const { plannerAmong } = await import('../../src/http/routes/studio.mjs');
const { roleAmong } = await import('../../src/http/routes/studio-hire.mjs');

/** A real directory, and a second name for it. */
function twoNames(prefix) {
  const real = scratchDir(prefix);
  const link = path.join(scratchDir(`${prefix}link-`), 'link');
  fs.symlinkSync(real, link, 'junction');
  return { real, link };
}

test('samePath: two names for one directory are the same path, and two directories are not', () => {
  const { real, link } = twoNames('same-path-');
  assert.equal(samePath(real, link), true);
  assert.equal(samePath(link, real), true);
  assert.equal(samePath(path.join(real, 'a'), path.join(link, 'a')), true, 'not there yet');
  assert.equal(samePath(real, path.dirname(real)), false);
  // A path that does not exist is compared as written, and never throws.
  assert.equal(samePath(path.join(real, 'nope'), path.join(real, 'nope')), true);
  assert.equal(samePath(path.join(real, 'nope'), path.join(real, 'other')), false);
});

test('samePath: an empty path names nothing, not the working directory', () => {
  assert.equal(samePath('', ''), false);
  assert.equal(samePath('', process.cwd()), false);
  assert.equal(samePath(process.cwd(), null), false);
  assert.equal(samePath(undefined, undefined), false);
});

test('canonicalPath: the link resolves to the real directory, and a missing leaf is joined back on', () => {
  const { real, link } = twoNames('same-path-canon-');
  assert.equal(canonicalPath(link), canonicalPath(real));
  assert.equal(
    canonicalPath(path.join(link, 'not', 'made', 'yet')),
    path.join(canonicalPath(real), 'not', 'made', 'yet'),
  );
  assert.equal(path.isAbsolute(canonicalPath('relative/thing')), true);
});

test('a queued name lands on a session whose cwd is the other name for the directory', () => {
  const { real, link } = twoNames('same-path-name-');
  const q = createPendingIdentities({ now: () => 1_760_000_000_000 });
  // The `+` button was pressed in a project opened by its link…
  q.queue(link, 'Ada', null);
  // …and the session reports where it is the way the OS spells it.
  const applied = q.settle([
    { id: 'elsewhere', cwd: path.dirname(real), displayName: null, lastActivityAt: 9 },
    { id: 'no-cwd', displayName: null, lastActivityAt: 8 },
    { id: 'mine', cwd: real, displayName: null, lastActivityAt: 1 },
  ]);
  assert.equal(applied.length, 1);
  assert.equal(applied[0].agent.id, 'mine');
  assert.equal(applied[0].name, 'Ada');
  assert.equal(q.size, 0);
});

test('a planner is recognised in its project under either name', () => {
  const { real, link } = twoNames('same-path-planner-');
  const agents = [
    { id: 'other-runtime', cwd: real, runtime: 'codex', lastActivityAt: 9 },
    { id: 'older', cwd: real, runtime: 'claude-code', lastActivityAt: 1 },
    { id: 'newer', cwd: real, runtime: 'claude-code', lastActivityAt: 2 },
  ];
  assert.equal(plannerAmong(agents, link, new Set())?.id, 'newer');
  assert.equal(plannerAmong(agents, link, new Set(['newer']))?.id, 'older');
  assert.equal(plannerAmong([{ id: 'x', runtime: 'claude-code' }], process.cwd(), new Set()), null);
});

test('a hired role is recognised in its worktree under either name', () => {
  const { real, link } = twoNames('same-path-role-');
  const agents = [
    { id: 'elsewhere', cwd: path.dirname(real), lastActivityAt: 9 },
    { id: 'no-cwd', lastActivityAt: 8 },
    { id: 'older', cwd: real, lastActivityAt: 1 },
    { id: 'newer', cwd: real, lastActivityAt: 2 },
  ];
  assert.equal(roleAmong(agents, link, new Set())?.id, 'newer');
  assert.equal(roleAmong(agents, link, new Set(['newer']))?.id, 'older');
  assert.equal(roleAmong(agents, link, new Set(['newer', 'older'])), null);
  // A session with no `cwd` is in no worktree — not even the one this process
  // happens to be standing in, which is what `path.resolve('')` used to say.
  assert.equal(roleAmong([{ id: 'no-cwd' }], process.cwd(), new Set()), null);
});
