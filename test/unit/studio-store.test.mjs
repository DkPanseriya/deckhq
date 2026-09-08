/**
 * The Studio schemas, the store and the path confinement — WP-66.
 *
 * `docs/07-STUDIO-DESIGN.md` §3, §5.1, §10. Four of this file's tests are
 * acceptance criteria rather than coverage:
 *
 *   - a write resolving outside `<project>/.deckhq/studio/` is REFUSED, with
 *     the offending path, tested with `..`, with an absolute path and with a
 *     symlink (§10, criterion 2);
 *   - an unknown `column` is refused, and the refusal names the path in the
 *     document and the line of the file;
 *   - the board round-trips byte-identically through the store;
 *   - a file that does not parse is reported and LEFT WHERE IT IS, because
 *     these files are the user's.
 */
import { ROOT, scratchDir } from '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { StudioStore, serialise } = await import('../../src/studio/store.mjs');
const { StudioPathError, resolveInside, studioDirFor } = await import('../../src/studio/paths.mjs');
const { DEFAULT_RULES, emptyBoard, validateBlueprint, validateBoard, validateRoster } =
  await import('../../src/studio/schema.mjs');

/** A project directory of our own, inside the isolated root. */
function project(name = 'proj-') {
  const dir = scratchDir(name);
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  return dir;
}

/** A store with its studio directory already made, as `enable` would leave it. */
function enabled(name = 'proj-') {
  const root = project(name);
  const store = new StudioStore(root);
  fs.mkdirSync(store.dir, { recursive: true });
  return store;
}

/**
 * The refusal itself. `assert.throws` proves that one happened and hands back
 * nothing, and every assertion below is about what the message SAYS — the
 * offending path is the whole of §10 criterion 2.
 * @param {() => any} fn
 */
function refusal(fn) {
  try {
    fn();
  } catch (err) {
    assert.equal(err.name, 'StudioPathError', `threw the wrong thing: ${err.message}`);
    return err;
  }
  assert.fail('that was not refused');
}

// ---------------------------------------------------------------------------
// Confinement — §3 step 4, §10 criterion 2
// ---------------------------------------------------------------------------

test('a path that climbs out with `..` is refused, and the message names it', () => {
  const store = enabled();
  const err = refusal(() => store.pathOf(path.join('handovers', '..', '..', '..', 'evil.md')));
  assert.match(err.message, /Refused/);
  assert.ok(err.message.includes('evil.md'), err.message);
  assert.ok(err.offending.includes('evil.md'));
  // And nothing was created on the way to finding out.
  assert.equal(fs.existsSync(path.join(store.root, 'evil.md')), false);
});

test('an absolute path is refused rather than joined', () => {
  const store = enabled();
  const outside = path.join(ROOT, 'outside.md');
  const err = refusal(() => store.pathOf(outside));
  assert.ok(err.message.includes('absolute path'), err.message);
  assert.ok(err.message.includes(outside));
  // The POSIX shape too, which `path.isAbsolute` also answers on Windows.
  assert.throws(() => store.pathOf('/etc/passwd'), StudioPathError);
});

test('a symlink pointing outside the directory is refused, not followed', (t) => {
  const store = enabled();
  const elsewhere = path.join(ROOT, 'elsewhere');
  fs.mkdirSync(elsewhere, { recursive: true });
  const link = path.join(store.dir, 'handovers');
  try {
    // A junction on Windows: a directory symlink there needs a privilege a
    // test runner does not have, and a junction does the same thing.
    fs.symlinkSync(elsewhere, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (err) {
    t.skip(`this filesystem will not make a link: ${err.message}`);
    return;
  }

  // The string alone resolves INSIDE the directory, so only the filesystem
  // check can catch this one. That is why there are two.
  assert.ok(path.join(store.dir, 'handovers', 'c7.md').startsWith(store.dir));
  const err = refusal(() => store.pathOf('handovers/c7.md'));
  assert.ok(err.message.includes('through a link'), err.message);
  assert.ok(err.message.includes('c7.md'));
  assert.equal(fs.existsSync(path.join(elsewhere, 'c7.md')), false);
});

test('the directory itself, and an ordinary name inside it, resolve', () => {
  const dir = studioDirFor(project());
  assert.equal(resolveInside(dir, 'board.json'), path.join(dir, 'board.json'));
  assert.equal(resolveInside(dir, 'briefs/api.md'), path.join(dir, 'briefs', 'api.md'));
  assert.throws(() => resolveInside(dir, ''), StudioPathError);
});

// ---------------------------------------------------------------------------
// The board schema
// ---------------------------------------------------------------------------

/** A valid board with one card, pretty-printed the way the store writes one. */
function boardWith(column) {
  return {
    version: 1,
    projectKey: 'a'.repeat(16),
    cards: [
      {
        id: 'c7',
        title: 'Refund path returns the fee',
        acceptance: ['a failing test first', 'npm test green'],
        milestone: 'm2',
        role: 'backend',
        column,
        budget: { tokens: 400000, minutes: 90 },
        agentId: null,
        worktree: null,
        handover: null,
        flags: [],
        updatedAt: 178,
      },
    ],
  };
}

test('an unknown column is refused, with the path in the document and the line in the file', () => {
  const raw = serialise(boardWith('shipped'));
  const result = validateBoard(JSON.parse(raw), { raw });
  assert.ok('error' in result, 'a board with a column this build cannot draw was accepted');
  assert.equal(result.path, 'cards[0].column');
  assert.ok(result.line > 1, `expected a real line, got ${result.line}`);
  // The line it names really is the line the value is on.
  assert.match(raw.split('\n')[result.line - 1], /"column": "shipped"/);
  assert.match(result.error, /"shipped" is not a column/);
  assert.match(result.error, /backlog, ready, in_progress, review, done, blocked/);
});

test('the second card is reported as the second card', () => {
  const doc = boardWith('backlog');
  doc.cards.push({ ...doc.cards[0], id: 'c8', column: 'nope' });
  const raw = serialise(doc);
  const result = validateBoard(JSON.parse(raw), { raw });
  assert.ok('error' in result);
  assert.equal(result.path, 'cards[1].column');
  assert.match(raw.split('\n')[result.line - 1], /"column": "nope"/);
});

test('all six columns are accepted, and nothing else is', () => {
  for (const column of ['backlog', 'ready', 'in_progress', 'review', 'done', 'blocked']) {
    assert.ok('board' in validateBoard(boardWith(column)), column);
  }
  for (const column of ['Backlog', 'in progress', '', 'todo', null, 7]) {
    assert.ok('error' in validateBoard(boardWith(column)), JSON.stringify(column));
  }
});

test('a duplicate card id, a wrong version and a missing project key are each refused by name', () => {
  const dup = boardWith('backlog');
  dup.cards.push({ ...dup.cards[0] });
  assert.equal(validateBoard(dup).path, 'cards[1].id');

  const version = { ...boardWith('backlog'), version: 2 };
  assert.equal(validateBoard(version).path, 'version');

  const key = { ...boardWith('backlog'), projectKey: 'not-a-key' };
  assert.equal(validateBoard(key).path, 'projectKey');
});

test('a roster validates its roles, and refuses a policy it does not know', () => {
  const roster = {
    version: 1,
    projectKey: 'b'.repeat(16),
    roles: [
      {
        name: 'backend',
        purpose: 'the API',
        systemPrompt: 'You are the backend.',
        allowedTools: ['Edit', 'Bash'],
        permissionPolicy: 'ask',
        budget: { tokens: 400000, minutes: 90 },
      },
    ],
  };
  const ok = validateRoster(roster);
  assert.ok('roster' in ok);
  assert.equal(ok.roster.roles[0].agentId, null, 'agentId is set at Hire, never guessed');

  const bad = { ...roster, roles: [{ ...roster.roles[0], permissionPolicy: 'yolo' }] };
  assert.equal(validateRoster(bad).path, 'roles[0].permissionPolicy');

  const nameless = { ...roster, roles: [{ ...roster.roles[0], name: 'a/b' }] };
  assert.equal(validateRoster(nameless).path, 'roles[0].name');
});

test('a blueprint is markdown with no front matter', () => {
  assert.ok('blueprint' in validateBlueprint('# Orbital\n\nGoal: ship it.\n'));
  assert.ok('error' in validateBlueprint(''));
  const fronted = validateBlueprint('---\ntitle: Orbital\n---\n\n# Orbital\n');
  assert.ok('error' in fronted);
  assert.equal(fronted.line, 1);
  assert.match(fronted.error, /no front matter/);
  // A `---` that is a horizontal rule further down is not front matter.
  assert.ok('blueprint' in validateBlueprint('# Orbital\n\n---\n\nGoal.\n'));
});

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

test('the board round-trips byte-identically through the store', async () => {
  const store = enabled();
  const board = boardWith('in_progress');
  board.projectKey = store.projectKey;

  const first = await store.writeBoard(board);
  assert.ok('board' in first);
  const bytesOnce = fs.readFileSync(first.file, 'utf8');

  const read = store.readBoard();
  assert.equal(read.present, true);
  assert.equal(read.error, undefined);
  assert.deepEqual(read.board, first.board);

  const second = await store.writeBoard(read.board);
  assert.ok('board' in second);
  const bytesTwice = fs.readFileSync(second.file, 'utf8');

  assert.equal(bytesTwice, bytesOnce, 'the same board wrote different bytes the second time');
  assert.deepEqual(JSON.parse(bytesTwice), JSON.parse(bytesOnce));
  // And a third pass through the raw text, so the round trip is the FILE's and
  // not just the object's.
  const reparsed = validateBoard(JSON.parse(bytesTwice), { raw: bytesTwice });
  assert.ok('board' in reparsed);
  assert.equal(serialise(reparsed.board), bytesOnce);
});

test('a board that does not parse is reported with its path, and is left exactly where it is', async () => {
  const store = enabled();
  const file = store.pathOf('board.json');
  fs.writeFileSync(file, '{ "version": 1, oops\n', 'utf8');

  const read = store.readBoard();
  assert.equal(read.present, true);
  assert.match(read.error, /board\.json is not valid JSON/);
  assert.equal(read.errorPath, 'board.json');
  // THE POINT: these files are the user's. Reading a broken one changes nothing.
  assert.equal(fs.readFileSync(file, 'utf8'), '{ "version": 1, oops\n');
  assert.deepEqual(
    fs.readdirSync(store.dir),
    ['board.json'],
    'reading a corrupt board left something behind',
  );

  // A write over it keeps the bytes rather than deleting them.
  const written = await store.writeBoard({ ...emptyBoard(store.projectKey) });
  assert.ok('board' in written);
  const kept = fs.readdirSync(store.dir).filter((n) => n.includes('.corrupt-'));
  assert.equal(kept.length, 1, 'the unparseable board was not kept');
  assert.equal(fs.readFileSync(path.join(store.dir, kept[0]), 'utf8'), '{ "version": 1, oops\n');
});

test('an absent board reads as an empty one, and is not an error', () => {
  const store = enabled();
  const read = store.readBoard();
  assert.equal(read.present, false);
  assert.equal(read.error, undefined);
  assert.deepEqual(read.board, emptyBoard(store.projectKey));
  assert.deepEqual(fs.readdirSync(store.dir), [], 'reading an absent board created something');
});

test('rules.md is written once and never rewritten', async () => {
  const store = enabled();
  const first = await store.ensureRules();
  assert.equal(first.written, true);
  assert.equal(fs.readFileSync(first.file, 'utf8'), DEFAULT_RULES);

  fs.writeFileSync(first.file, '# Mine\n', 'utf8');
  const second = await store.ensureRules();
  assert.equal(second.written, false);
  assert.equal(fs.readFileSync(first.file, 'utf8'), '# Mine\n');
});

test('briefs and handovers are listed by name, and read through the same confinement', async () => {
  const store = enabled();
  await store.writeDoc('handovers', 'c7.md', 'what changed\n');
  await store.writeDoc('briefs', 'backend.md', 'the brief\n');
  assert.deepEqual(store.handovers(), ['c7.md']);
  assert.deepEqual(store.briefs(), ['backend.md']);
  assert.equal(store.readDoc('handovers', 'c7.md'), 'what changed\n');
  assert.throws(() => store.readDoc('handovers', '../../../etc/passwd'), StudioPathError);
});

test('the snapshot carries every error rather than throwing on the first', () => {
  const store = enabled();
  fs.writeFileSync(store.pathOf('board.json'), 'not json', 'utf8');
  fs.writeFileSync(store.pathOf('blueprint.md'), '---\na: b\n---\n', 'utf8');
  fs.writeFileSync(
    store.pathOf('roster.json'),
    serialise({ version: 1, projectKey: store.projectKey, roles: [] }),
    'utf8',
  );

  const snap = store.snapshot();
  assert.ok(snap.board.error, 'the board error was swallowed');
  assert.ok(snap.blueprint.error, 'the blueprint error was swallowed');
  // A broken board does not take the roster down with it.
  assert.equal(snap.roster.error, null);
  assert.deepEqual(snap.roster.roster.roles, []);
  assert.equal(snap.projectKey, store.projectKey);
});
