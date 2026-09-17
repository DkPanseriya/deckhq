/**
 * The two surfaces the roster reaches the user through — WP-68, §4.
 *
 *   1. `rolesOf()`, the server's answer: what `GET /api/studio` says about each
 *      role beyond what is in `roster.json`, and in particular the two things
 *      the file cannot say — which runtime the live session IS, and §4's
 *      *unverified launch* sentence when that runtime has one.
 *   2. `studioHireRows()` and `roleLine()`, the client's two readings of that
 *      answer: a palette row per role that is not already at a desk, and one
 *      line per role under the panel's three artefact rows.
 *
 * Everything here is pure. No daemon, no DOM, no fetch: these are the three
 * functions the two surfaces are built out of, and they are separated from
 * their drawing so that the RULES can be asserted rather than the markup.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rolesOf } from '../../src/http/routes/studio.mjs';
import { UNVERIFIED_LAUNCH } from '../../src/http/routes/studio-hire.mjs';
import { studioHireRows } from '../../public/palette-commands.js';
import { roleLine } from '../../public/panel-studio.js';

/** A `StudioStore.snapshot()`, as much of one as `rolesOf` reads. */
const snapOf = (roles) => ({
  dir: '/proj/.deckhq/studio',
  roster: { roster: { roles } },
});

const ROLE = (name, extra = {}) => ({
  name,
  purpose: `Owns the ${name} half.`,
  agentId: null,
  ...extra,
});

// ---------------------------------------------------------------------------
// rolesOf — the server's answer
// ---------------------------------------------------------------------------

test('an unhired role names no runtime rather than guessing one', () => {
  const [role] = rolesOf(snapOf([ROLE('backend')]), '/proj', [], '/data');
  assert.equal(role.name, 'backend');
  assert.equal(role.live, false);
  assert.equal(role.agentId, null);
  // The roster has no runtime field, and inventing `claude-code` here would be
  // the daemon deciding what it was never told.
  assert.equal(role.runtime, null);
  assert.equal(role.unverified, null);
  assert.equal(role.hireable, true);
});

test('a role whose recorded id is still on the floor is hired, and names its runtime', () => {
  const agents = [{ id: 'claude-code:a1', runtime: 'claude-code' }];
  const [role] = rolesOf(
    snapOf([ROLE('backend', { agentId: 'claude-code:a1' })]),
    '/proj',
    agents,
    '/data',
  );
  assert.equal(role.live, true);
  assert.equal(role.agentId, 'claude-code:a1');
  assert.equal(role.runtime, 'claude-code');
  // Claude Code is the one runtime §4 does not have to caveat.
  assert.equal(role.unverified, null);
});

test('a role hired on Codex carries §4’s unverified-launch sentence, verbatim', () => {
  const agents = [{ id: 'codex:c1', runtime: 'codex' }];
  const [role] = rolesOf(snapOf([ROLE('docs', { agentId: 'codex:c1' })]), '/proj', agents, '/data');
  assert.equal(role.runtime, 'codex');
  assert.equal(role.unverified, UNVERIFIED_LAUNCH.codex);
  assert.match(role.unverified, /unverified launch/);
});

test('a recorded id the scan no longer sees reads as unhired within one scan', () => {
  // The user closed the terminal. Nothing was rewritten: `roster.json` still
  // holds the id, and this is the answer that has to change, not the file.
  const [role] = rolesOf(
    snapOf([ROLE('backend', { agentId: 'claude-code:gone' })]),
    '/proj',
    [{ id: 'claude-code:other', runtime: 'claude-code' }],
    '/data',
  );
  assert.equal(role.live, false);
  assert.equal(role.agentId, 'claude-code:gone');
  assert.equal(role.runtime, null);
  assert.equal(role.unverified, null);
});

test('a role name git will not take says so, with the reason, before it is pressed', () => {
  const [role] = rolesOf(snapOf([ROLE('back end')]), '/proj', [], '/data');
  assert.equal(role.hireable, false);
  assert.equal(role.reason, 'role-space');
  assert.match(role.refusal, /refuses a role name it would have to escape/);
  // No worktree and no brief path, because there is no name to build one from.
  assert.equal(role.worktree, null);
  assert.equal(role.brief, null);
});

// ---------------------------------------------------------------------------
// studioHireRows — the palette
// ---------------------------------------------------------------------------

/** @param {Array<any>} studioRoles */
function rowsFor(studioRoles) {
  /** @type {string[]} */
  const called = [];
  const rows = studioHireRows({
    studioRoles,
    actions: { studioHire: (name) => called.push(name) },
  });
  return { rows, called };
}

test('ACCEPTANCE: one hire row per role, and none for a role already at a desk', () => {
  const { rows } = rowsFor([
    { name: 'backend', purpose: 'the API', live: false, hireable: true },
    { name: 'frontend', purpose: 'the page', live: true, hireable: true },
    { name: 'docs', purpose: 'the words', live: false, hireable: true },
  ]);
  assert.deepEqual(
    rows.map((r) => r.label),
    ['Studio: hire backend', 'Studio: hire docs'],
  );
  // Ids are unique, so two roles can never collapse into one row.
  assert.equal(new Set(rows.map((r) => r.id)).size, rows.length);
  for (const row of rows) assert.equal(row.group, 'command');
});

test('the row runs the hire for its own name and nobody else’s', () => {
  const { rows, called } = rowsFor([
    { name: 'backend', live: false, hireable: true },
    { name: 'docs', live: false, hireable: true },
  ]);
  rows[1].run();
  assert.deepEqual(called, ['docs']);
});

test('the hint is the role’s purpose, and the refusal when there is one', () => {
  const { rows } = rowsFor([
    { name: 'backend', purpose: 'Owns the API half.', live: false, hireable: true },
    {
      name: 'back end',
      live: false,
      hireable: false,
      refusal: 'git refuses a role name with a space',
    },
  ]);
  assert.equal(rows[0].hint, 'Owns the API half.');
  assert.equal(rows[1].hint, 'git refuses a role name with a space');
  // Drawn, not hidden: the reason is a thing the user can go and fix, and a
  // row that vanished would be a role nobody could find out about.
  assert.equal(rows[1].label, 'Studio: hire back end');
  assert.equal(rows[1].hireable, false);
});

test('the role name is a keyword, so typing the role finds the row', () => {
  const { rows } = rowsFor([{ name: 'docs', live: false, hireable: true }]);
  assert.ok(rows[0].keywords.includes('docs'));
  assert.ok(rows[0].keywords.includes('hire'));
});

test('no roster, no rows — and never a throw', () => {
  assert.deepEqual(studioHireRows({ actions: {} }), []);
  assert.deepEqual(studioHireRows({ studioRoles: null, actions: {} }), []);
  assert.deepEqual(studioHireRows({ studioRoles: [null, { name: '' }], actions: {} }), []);
});

// ---------------------------------------------------------------------------
// roleLine — the panel
// ---------------------------------------------------------------------------

test('ACCEPTANCE: the panel’s roster line is one of four states, and says which', () => {
  assert.deepEqual(roleLine({ name: 'backend', live: false, hireable: true }), {
    state: 'not-hired',
    line: 'not hired',
  });
  assert.deepEqual(
    roleLine({ name: 'backend', live: true, agentId: 'claude-code:a1', hireable: true }),
    { state: 'hired', line: 'hired — claude-code:a1' },
  );
  assert.deepEqual(
    roleLine({
      name: 'docs',
      live: true,
      agentId: 'codex:c1',
      unverified: UNVERIFIED_LAUNCH.codex,
      hireable: true,
    }),
    { state: 'unverified', line: 'hired, unverified — codex:c1' },
  );
  assert.deepEqual(
    roleLine({ name: 'back end', live: false, hireable: false, refusal: 'git refuses that' }),
    { state: 'refused', line: 'git refuses that' },
  );
});

test('the id is in the line, because the id is what every other surface takes', () => {
  const line = roleLine({ live: true, agentId: 'claude-code:a1', hireable: true }).line;
  assert.match(line, /claude-code:a1/);
});

test('a role with nothing in it is a line rather than a throw', () => {
  assert.equal(roleLine(undefined).state, 'not-hired');
  assert.equal(roleLine({}).state, 'not-hired');
});
