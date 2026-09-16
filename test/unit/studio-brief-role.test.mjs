/**
 * The brief one hired role is started under — WP-68, §6.1.
 *
 * Four parts in order, and two rules about writing them: `rules.md` is
 * created once and never rewritten, and a brief that would overwrite an
 * edited one — or one a session is running under — goes beside it as
 * `<role>.next.md` and is reported.
 */
import '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { scratchDir } from '../helpers/isolate.mjs';

const { blueprintExcerpt, cardSection, ensureRoleBrief, roleBriefRel, roleBriefNextRel } =
  await import('../../src/studio/brief-role.mjs');
const { StudioStore } = await import('../../src/studio/store.mjs');
const { DEFAULT_RULES } = await import('../../src/studio/schema.mjs');

const ROLE = {
  name: 'backend',
  purpose: 'Owns the daemon.',
  systemPrompt: 'Prefer small modules.',
  allowedTools: [],
  permissionPolicy: 'ask',
  budget: null,
  agentId: null,
};

const CARD = {
  id: 'c3',
  title: 'The ledger fold',
  acceptance: ['it folds', 'it is tested'],
  milestone: 'm2',
  role: 'backend',
  column: 'doing',
  flags: ['urgent'],
  handover: null,
  worktree: null,
  agentId: null,
  updatedAt: 0,
};

const BLUEPRINT = [
  '# A project',
  '',
  '## Goal',
  '',
  'Fold the ledger.',
  '',
  '## Non-goals',
  '',
  'Not a database.',
  '',
  '## Milestone m1',
  '',
  'The first one.',
  '',
  '## Milestone m2',
  '',
  'The second one, which is this card.',
  '',
].join('\n');

function project() {
  const root = scratchDir('studio-role-brief-');
  const store = new StudioStore(root);
  fs.mkdirSync(store.dir, { recursive: true });
  return { root, store };
}

// ---------------------------------------------------------------------------
// The four parts
// ---------------------------------------------------------------------------

test('the excerpt is goal, non-goals and the card’s milestone — not the other one', () => {
  const { text } = blueprintExcerpt(BLUEPRINT, 'm2');
  assert.match(text, /Fold the ledger/);
  assert.match(text, /Not a database/);
  assert.match(text, /which is this card/);
  assert.doesNotMatch(text, /The first one/);
});

test('a blueprint with no headings this build knows falls back to its head, and says so', () => {
  const { text, whole } = blueprintExcerpt('Just some prose about a thing.', null);
  assert.equal(whole, true);
  assert.match(text, /Just some prose/);
});

test('an empty blueprint is an empty excerpt rather than a throw', () => {
  assert.deepEqual(blueprintExcerpt(null, 'm2'), { text: '', whole: false });
});

test('a role with no card is told to ask rather than to pick one', () => {
  const text = cardSection(null);
  assert.match(text, /No card is assigned/);
  assert.match(text, /Do not pick one/);
});

test('the card section carries the id, the acceptance and the flags', () => {
  const text = cardSection(CARD);
  assert.match(text, /\*\*c3\*\*/);
  assert.match(text, /- it folds/);
  assert.match(text, /- it is tested/);
  assert.match(text, /`urgent`/);
});

test('ACCEPTANCE: the brief is the four parts of §6.1, in order', async () => {
  const { store } = project();
  await store.writeBlueprint(BLUEPRINT);
  await store.writeDoc('handovers', 'c3-first.md', 'It was half done.');
  await store.writeText(path.join('handovers', 'c3.bounce.md'), 'The tests did not run.');

  const out = await ensureRoleBrief(store, ROLE, {
    card: { ...CARD, handover: 'c3-first.md' },
    worktree: '/tmp/wt',
  });
  assert.equal(out.written, true);
  assert.equal(out.beside, null);
  assert.equal(out.rulesWritten, true);

  const text = fs.readFileSync(out.file, 'utf8');
  const order = [
    '## 1. The plan',
    '## 2. Your card',
    '## 3. What happened before',
    '## 4. The coding rules',
  ];
  let at = -1;
  for (const heading of order) {
    const found = text.indexOf(heading);
    assert.ok(found > at, `${heading} is out of order`);
    at = found;
  }
  assert.match(text, /Fold the ledger/);
  assert.match(text, /\*\*c3\*\*/);
  assert.match(text, /It was half done/);
  assert.match(text, /bounced back/);
  assert.match(text, /The tests did not run/);
  assert.match(text, /Write a failing test first/);
  assert.match(text, /Prefer small modules/);
});

// ---------------------------------------------------------------------------
// rules.md, created once
// ---------------------------------------------------------------------------

test('rules.md is created once with the two-line default and never rewritten', async () => {
  const { store } = project();
  const first = await ensureRoleBrief(store, ROLE, {});
  assert.equal(first.rulesWritten, true);
  const rulesFile = store.pathOf('rules.md');
  assert.equal(fs.readFileSync(rulesFile, 'utf8'), DEFAULT_RULES);

  fs.writeFileSync(rulesFile, '# Mine\n\n- Only mine.\n');
  const second = await ensureRoleBrief(store, { ...ROLE, name: 'frontend' }, {});
  assert.equal(second.rulesWritten, false);
  assert.equal(fs.readFileSync(rulesFile, 'utf8'), '# Mine\n\n- Only mine.\n');
  assert.match(fs.readFileSync(second.file, 'utf8'), /Only mine/);
});

// ---------------------------------------------------------------------------
// The never-overwrite rule
// ---------------------------------------------------------------------------

test('a second call with the same inputs writes nothing and reports identical', async () => {
  const { store } = project();
  const first = await ensureRoleBrief(store, ROLE, { card: CARD });
  const second = await ensureRoleBrief(store, ROLE, { card: CARD });
  assert.equal(first.written, true);
  assert.equal(second.written, false);
  assert.equal(second.beside, null);
  assert.equal(second.reason, 'identical');
  assert.equal(fs.existsSync(store.pathOf(roleBriefNextRel(ROLE.name))), false);
});

test('a brief the user edited is left alone and the regeneration goes beside it', async () => {
  const { store } = project();
  await ensureRoleBrief(store, ROLE, { card: CARD });
  const file = store.pathOf(roleBriefRel(ROLE.name));
  fs.writeFileSync(file, '# Mine now\n');

  const out = await ensureRoleBrief(store, ROLE, { card: CARD });
  assert.equal(out.written, false);
  assert.equal(out.reason, 'edited');
  assert.ok(out.beside && out.beside.endsWith(`${ROLE.name}.next.md`));
  assert.equal(fs.readFileSync(file, 'utf8'), '# Mine now\n');
  assert.match(fs.readFileSync(out.beside, 'utf8'), /\*\*c3\*\*/);
});

test('ACCEPTANCE: a brief is never regenerated under a running session', async () => {
  const { store } = project();
  await ensureRoleBrief(store, ROLE, { card: CARD });
  const file = store.pathOf(roleBriefRel(ROLE.name));
  const before = fs.readFileSync(file, 'utf8');

  // The card moved on underneath: without `running` this would be rewritten.
  const moved = { ...CARD, title: 'The ledger fold, again', column: 'review' };
  const out = await ensureRoleBrief(store, ROLE, { card: moved, running: true });
  assert.equal(out.written, false);
  assert.equal(out.reason, 'running');
  assert.ok(out.beside);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.match(fs.readFileSync(out.beside, 'utf8'), /again/);
});
