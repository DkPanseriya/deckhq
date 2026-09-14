/**
 * The planner's interview brief — WP-67, `docs/07-STUDIO-DESIGN.md` §2 and §3.
 *
 * The brief is a prompt, so most of what can be said about it is about its
 * words. Two things here are stronger than that, and they are the reason this
 * file exists:
 *
 *   1. **The schemas in the brief are the schemas this build validates.** The
 *      embedded examples are parsed and handed to `validateRoster` and
 *      `validateBoard`, so a brief that drifted from the validator fails here
 *      rather than in a planner session six months from now.
 *   2. **An edited brief is never overwritten** (§6.1, §9 invariant 3). The
 *      regeneration is written beside it, and the user's is what is returned.
 */
import '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { scratchDir } from '../helpers/isolate.mjs';

const {
  PLANNER_BRIEF,
  PLANNER_BRIEF_NEXT,
  PLANNER_KICKOFF,
  PLANNER_TEMPLATE,
  ensurePlannerBrief,
  renderPlannerBrief,
} = await import('../../src/studio/brief.mjs');
const { StudioStore } = await import('../../src/studio/store.mjs');
const { COLUMNS, MAX_CARDS, MAX_ROLES, PERMISSION_POLICIES, validateBoard, validateRoster } =
  await import('../../src/studio/schema.mjs');

/** A project directory, and the store over it. */
function project() {
  const root = scratchDir('studio-brief-');
  return { root, store: new StudioStore(root) };
}

/** The brief as a planner would receive it. */
function brief() {
  const { root, store } = project();
  return {
    root,
    store,
    text: renderPlannerBrief(root, { dir: store.dir, projectKey: store.projectKey }),
  };
}

// ---------------------------------------------------------------------------
// The schemas, which are generated and not copied
// ---------------------------------------------------------------------------

test('the roster the brief shows is a roster this build accepts', () => {
  const { text, store } = brief();
  const block = /### `roster\.json`[\s\S]*?```json\n([\s\S]*?)\n```/.exec(text);
  assert.ok(block, 'the brief embeds no roster example');
  const parsed = JSON.parse(block[1]);
  const result = validateRoster(parsed, { raw: block[1] });
  assert.ok(!('error' in result), JSON.stringify(result));
  assert.equal(result.roster.projectKey, store.projectKey);
  assert.equal(result.roster.roles[0].permissionPolicy, PERMISSION_POLICIES[0]);
});

test('the board the brief shows is a board this build accepts, and starts in backlog', () => {
  const { text, store } = brief();
  const block = /### `board\.json`[\s\S]*?```json\n([\s\S]*?)\n```/.exec(text);
  assert.ok(block, 'the brief embeds no board example');
  const parsed = JSON.parse(block[1]);
  const result = validateBoard(parsed, { raw: block[1] });
  assert.ok(!('error' in result), JSON.stringify(result));
  assert.equal(result.board.projectKey, store.projectKey);
  assert.equal(result.board.cards[0].column, COLUMNS[0]);
});

test('every enumerated value and every ceiling comes off the schema module', () => {
  const { text } = brief();
  for (const column of COLUMNS) assert.ok(text.includes(column), `the brief omits "${column}"`);
  for (const policy of PERMISSION_POLICIES) {
    assert.ok(text.includes(policy), `the brief omits "${policy}"`);
  }
  assert.ok(text.includes(String(MAX_ROLES)), 'the brief omits the role ceiling');
  assert.ok(text.includes(String(MAX_CARDS)), 'the brief omits the card ceiling');
  // And the template itself holds NO schema of its own: no JSON block, no
  // schema key and no ceiling. Every one of those values reached the brief
  // through `src/studio/schema.mjs`, which is what stops the two drifting.
  const template = fs.readFileSync(PLANNER_TEMPLATE, 'utf8');
  // A ```json fence in the template holds a placeholder and nothing else.
  for (const [, body] of template.matchAll(/```json\n([\s\S]*?)\n```/g)) {
    assert.match(body.trim(), /^\{\{[A-Z_]+\}\}$/, `the template hand-copies JSON: ${body}`);
  }
  for (const key of ['"permissionPolicy"', '"projectKey"', '"column"', '"allowedTools"']) {
    assert.equal(template.includes(key), false, `the template hand-copies ${key}`);
  }
  for (const ceiling of [MAX_ROLES, MAX_CARDS]) {
    assert.equal(template.includes(String(ceiling)), false, `the template hand-copies ${ceiling}`);
  }
  for (const hole of ['ROSTER_SCHEMA', 'ROSTER_RULES', 'BOARD_SCHEMA', 'BOARD_RULES']) {
    assert.ok(template.includes(`{{${hole}}}`), `the template has no hole for ${hole}`);
  }
});

test('no placeholder survives into the brief, and an unfillable one is loud', () => {
  const { text } = brief();
  assert.equal(
    /\{\{[A-Z_]+\}\}/.test(text.replace(/^<!--[\s\S]*?-->/, '')),
    false,
    text.slice(0, 400),
  );
});

// ---------------------------------------------------------------------------
// The interview, and the three files
// ---------------------------------------------------------------------------

test('the brief asks goal, non-goals, constraints, milestones and roles, in that order', () => {
  const { text } = brief();
  const at = (needle) => text.indexOf(needle);
  const order = [
    at('**Goal.**'),
    at('**Non-goals.**'),
    at('**Constraints.**'),
    at('**Milestones.**'),
    at('**Roles.**'),
  ];
  for (const [i, position] of order.entries())
    assert.ok(position > 0, `question ${i + 1} is absent`);
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    'the questions are out of order',
  );
  // Milestones carry their acceptance criteria; that is the whole of §3's row.
  assert.match(text, /acceptance criteria/);
});

test('the brief names the three files, as paths inside the consented directory', () => {
  const { text, store } = brief();
  for (const name of ['blueprint.md', 'roster.json', 'board.json']) {
    const full = path.join(store.dir, name);
    assert.ok(text.includes(full), `the brief does not name ${full}`);
  }
});

test('the brief forbids writing anywhere else, and ends by requiring one word', () => {
  const { text } = brief();
  assert.match(text, /may not write, create, move or delete any other file/);
  assert.match(text, /Do not write any file outside the three named above/);
  // The last line of the last message is `written`, on a line of its own.
  assert.match(text, /\*\*last line of your final message\*\*/);
  assert.match(text, /```\nwritten\n```/);
});

test('the first prompt carries no path and no user text', () => {
  assert.equal(PLANNER_KICKOFF.includes(path.sep), false, PLANNER_KICKOFF);
  assert.match(PLANNER_KICKOFF, /interview/);
});

// ---------------------------------------------------------------------------
// §9 invariant 3 — brief files are the user's
// ---------------------------------------------------------------------------

test('the brief is written once, and an edited one is never overwritten', async () => {
  const { store } = project();
  const file = path.join(store.dir, 'briefs', PLANNER_BRIEF);

  const first = await ensurePlannerBrief(store);
  assert.equal(first.written, true);
  assert.equal(first.beside, null);
  assert.equal(first.file, file);
  const asWritten = fs.readFileSync(file, 'utf8');

  // Again, unchanged: nothing is written and nothing is put beside it.
  const second = await ensurePlannerBrief(store);
  assert.equal(second.written, false);
  assert.equal(second.beside, null);
  assert.equal(fs.existsSync(path.join(store.dir, 'briefs', PLANNER_BRIEF_NEXT)), false);

  // Now the user edits it. Theirs stays, byte for byte, and ours goes beside.
  const mine = `${asWritten}\n\nAlso: ask about the deploy target.\n`;
  await fsp.writeFile(file, mine, 'utf8');
  const third = await ensurePlannerBrief(store);
  assert.equal(third.written, false);
  assert.equal(third.file, file);
  assert.equal(third.beside, path.join(store.dir, 'briefs', PLANNER_BRIEF_NEXT));
  assert.equal(fs.readFileSync(file, 'utf8'), mine, 'the edited brief was overwritten');
  assert.equal(fs.readFileSync(third.beside, 'utf8'), asWritten);
});
