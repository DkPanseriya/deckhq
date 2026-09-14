/**
 * Studio's two structural invariants — WP-66, `docs/07-STUDIO-DESIGN.md` §9.
 *
 * Both are STATIC: they read the source and fail on a second writer or a
 * second data path, which is the only way to hold a rule that is about code
 * nobody has written yet. A behavioural test can only prove the paths that
 * exist today; these fail on the one somebody adds tomorrow.
 *
 *   1. **A card's column is user-owned** (§5.2). It changes on the user
 *      dragging or pressing — `POST /api/studio/card` — and on the budget stop
 *      in `blockForBudget()`, which may reach `blocked` and no other column.
 *      Nothing else in `src/studio/` or `src/http/` may write it.
 *   2. **Studio keeps no session list of its own** (§9 invariant 4). Every
 *      session it will ever spawn is an ordinary registry session found by the
 *      ordinary scan, so no module under `src/studio/` may import the registry,
 *      the adapters or the send hub, and none may hold a collection of
 *      sessions.
 */
import '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../../src/', import.meta.url));

/** Every `.mjs` under one of `src/`'s subdirectories, as repo-relative paths. */
function sources(...dirs) {
  /** @type {string[]} */
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.mjs')) out.push(full);
    }
  };
  for (const dir of dirs) {
    const full = path.join(SRC, dir);
    if (fs.existsSync(full)) walk(full);
  }
  return out.sort();
}

/** `src/`-relative, with forward slashes, so the assertions read the same everywhere. */
function label(file) {
  return path.relative(SRC, file).split(path.sep).join('/');
}

/**
 * Source with its comments taken out.
 *
 * Deliberately crude — it is not a parser, and it does not need to be. What it
 * has to do is stop a sentence in a header (this one says "writes a card's
 * column" several times) from counting as a write.
 * @param {string} src
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

/**
 * Every place a `column` property is given a value, in the three shapes this
 * codebase can express one: an assignment, a computed assignment, and a key in
 * an object literal.
 * @param {string} src
 * @returns {string[]} the matched text, trimmed
 */
function columnWrites(src) {
  const body = stripComments(src);
  /** @type {string[]} */
  const found = [];
  const patterns = [
    /[\w.\]]+\.column\s*=\s*[^=][^;\n]*/g,
    /\[\s*['"]column['"]\s*\]\s*=\s*[^=][^;\n]*/g,
    /(?:^|[{,(\s])column\s*:\s*[^,\n]*/gm,
  ];
  for (const re of patterns) {
    for (const m of body.matchAll(re)) found.push(m[0].trim().replace(/\s+/g, ' '));
  }
  return found.sort();
}

test('INVARIANT: the only writers of a card column are the card route and the budget stop', () => {
  /** @type {Record<string, string[]>} */
  const actual = {};
  for (const file of sources('studio', 'http')) {
    const writes = columnWrites(fs.readFileSync(file, 'utf8'));
    if (writes.length) actual[label(file)] = writes;
  }

  // Every entry, and why it is allowed to be here. A new key in this object is
  // a new way a card can move, and it needs a reason on this line before it
  // needs a passing test.
  const expected = {
    // The normaliser. It COPIES a value `validateBoard` has already checked
    // against the six columns; it chooses nothing and cannot invent a column.
    'studio/schema.mjs': ['column: col'],
    // WP-67. The `board.json` EXAMPLE embedded in the planner's brief — text
    // in a prompt, not a board. Nothing reads it back; the value is
    // `COLUMNS[0]`, which is `backlog`, which is where the brief tells the
    // planner every card starts and where `op: 'create'` puts one anyway. A
    // card reaches a real board through the route below and nowhere else.
    'studio/brief.mjs': ['column: COLUMNS[0]'],
    // The budget stop (§8). Asserted below to reach `blocked` and nowhere else.
    'studio/budget.mjs': ['card.column = BLOCKED_COLUMN'],
    // The user's own press, and the only funnel in the HTTP layer.
    'http/routes/studio.mjs': [
      // op: 'move' — the drag or the key press.
      'column: target',
      // op: 'create' — a new card, in `backlog` unless the user named one.
      "column: typeof patch.column === 'string' ? patch.column : 'backlog'",
    ],
  };

  assert.deepEqual(
    Object.keys(actual).sort(),
    Object.keys(expected).sort(),
    'a file outside the two funnels writes a card column',
  );
  for (const [file, writes] of Object.entries(expected)) {
    assert.deepEqual(actual[file], [...writes].sort(), `${file} writes a column somewhere new`);
  }
});

test('INVARIANT: the budget stop can reach `blocked` and no other column', async () => {
  const file = new URL('../../src/studio/budget.mjs', import.meta.url);
  const body = stripComments(fs.readFileSync(fileURLToPath(file), 'utf8'));
  const { COLUMNS, BLOCKED_COLUMN } = await import('../../src/studio/schema.mjs');

  // Not one of the other five column names appears in the file at all — as a
  // literal, as a constant, anywhere.
  for (const column of COLUMNS) {
    if (column === BLOCKED_COLUMN) continue;
    assert.equal(body.includes(column), false, `budget.mjs names the column "${column}"`);
  }

  // And it does what it says: it blocks, it flags, and a second pass over an
  // already-blocked card changes nothing (so WP-71 cannot post two messages).
  const { blockForBudget } = await import('../../src/studio/budget.mjs');
  const board = { cards: [{ id: 'c1', column: 'in_progress', flags: [], updatedAt: 0 }] };
  const first = blockForBudget(board, 'c1', { text: '80% spent, 1/4 criteria met', at: 178 });
  assert.equal(first.moved, true);
  assert.equal(board.cards[0].column, BLOCKED_COLUMN);
  assert.deepEqual(board.cards[0].flags, [
    { kind: 'budget', text: '80% spent, 1/4 criteria met', at: 178 },
  ]);
  const second = blockForBudget(board, 'c1', { text: 'again', at: 200 });
  assert.equal(second.moved, false);
  assert.equal(board.cards[0].flags.length, 1);
  // And a card it has never heard of is not invented.
  assert.deepEqual(blockForBudget(board, 'nope', { text: '', at: 1 }), {
    moved: false,
    card: null,
  });
});

test('INVARIANT: Studio keeps no session list of its own', () => {
  // The guarantee is structural, and it is the direction of the imports —
  // `test/unit/ledger-invariant.test.mjs` makes the same argument for the
  // ledger. A module that cannot reach the registry cannot keep a second copy
  // of what the registry knows.
  const forbidden = [
    'state-machine.mjs',
    'registry',
    '../adapters/',
    'sends.mjs',
    'permissions.mjs',
    'identity.mjs',
  ];
  for (const file of sources('studio')) {
    const src = fs.readFileSync(file, 'utf8');
    const body = stripComments(src);
    for (const needle of forbidden) {
      assert.equal(
        body.includes(needle),
        false,
        `${label(file)} reaches for "${needle}"; Studio reads sessions through nothing of its own`,
      );
    }
    // And no module declares a collection of sessions, under any of the names
    // one would be given.
    assert.equal(
      /\b(sessions|agents|liveSessions)\s*[=:]\s*(\[|new (Map|Set))/.test(body),
      false,
      `${label(file)} declares a session collection`,
    );
  }
});
