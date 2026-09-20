/**
 * The Studio board's picture — WP-69, `docs/07-STUDIO-DESIGN.md` §5.4.
 *
 * WP-69 is accepted on *"every card is reachable and every move performable
 * from the keyboard, and a screen reader reads the columns in board order"*.
 * Half of that is a claim about a DOM, so the DOM is asserted directly: the
 * render functions in `public/board-view.js` are pure and take their
 * `document`, the technique `deck-view.test.mjs`, `diff-view.test.mjs` and
 * `markdown.test.mjs` use. The other half — the moves themselves — is
 * `board-ui.test.mjs`.
 *
 * Two things here are pins rather than assertions about this file:
 *
 *   - the six columns, against `src/studio/schema.mjs`'s own list. The browser
 *     is never handed a Node module, so they are two declarations of one fact,
 *     and a column the page knew about and the validator did not would be a
 *     card the user could drag into a board that then refused to load;
 *   - `cardMessage()`, against `cardSection()` in `src/studio/brief-role.mjs`.
 *     One is what a LIVE session is sent and the other is what a brief file
 *     says, and they are written in two processes for the same reason — so
 *     every field one carries, the other must carry.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BOARD_COLUMNS,
  COLUMN_IDS,
  EMPTY_BOARD_LINES,
  acceptanceCount,
  boardOrder,
  budgetText,
  buildCard,
  cardChips,
  cardLabel,
  cardMessage,
  cardsByColumn,
  columnLabel,
  renderBoardColumns,
  renderBoardTable,
  renderEmptyBoard,
  stepColumn,
} from '../../public/board-view.js';
import { COLUMNS } from '../../src/studio/schema.mjs';
import { cardSection } from '../../src/studio/brief-role.mjs';

// --------------------------------------------------------------- DOM stub
//
// Records exactly what the renderer asked for. Nothing here parses HTML, so
// the only way an element can exist is if the renderer created it.

class StubNode {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
    this.attrs = /** @type {Record<string,string>} */ ({});
    this._text = null;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  append(...kids) {
    for (const kid of kids) this.appendChild(kid);
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }
  get textContent() {
    if (this._text !== null) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
}
const doc = { createElement: (tag) => new StubNode(tag) };

/** Every element in the tree, depth first. */
function all(node, out = []) {
  out.push(node);
  for (const c of node.children || []) all(c, out);
  return out;
}
const byTag = (root, tag) => all(root).filter((n) => n.tagName === tag.toUpperCase());
const byClass = (root, cls) =>
  all(root).filter((n) => String(n.className).split(/\s+/).includes(cls));

// --------------------------------------------------------------- a board
//
// Deliberately awkward: two columns out of order in the file (so grouping is
// observable rather than accidental), an unassigned card, a card with no
// budget, a card with two flags, and one card in every column.

const card = (extra) => ({
  title: 'a card',
  acceptance: [],
  milestone: null,
  role: null,
  budget: null,
  agentId: null,
  worktree: null,
  handover: null,
  flags: [],
  updatedAt: 0,
  ...extra,
});

const BOARD = {
  version: 1,
  projectKey: '1f4a9c3e7b20d581',
  cards: [
    card({ id: 'c3', title: 'Refund path returns the fee', column: 'in_progress', role: 'backend' }),
    card({ id: 'c1', title: 'Write the schema', column: 'backlog', role: 'backend' }),
    card({
      id: 'c7',
      title: 'Nobody owns this',
      column: 'ready',
      role: null,
      acceptance: ['one thing'],
    }),
    card({
      id: 'c2',
      title: 'Ship the docs',
      column: 'done',
      role: 'docs',
      acceptance: ['a failing test first', 'npm test green', 'the guide says so'],
      milestone: 'm2',
      budget: { tokens: 400000, minutes: 90 },
      flags: [
        { kind: 'budget', text: '80% spent, 1/4 criteria met', at: 178 },
        { kind: 'scope', text: 'outside milestone 2', at: 179 },
      ],
    }),
    card({ id: 'c4', title: 'Audit the bucket', column: 'review', role: 'backend' }),
    card({ id: 'c5', title: 'Stopped on cost', column: 'blocked', role: 'docs' }),
    card({ id: 'c6', title: 'Second in backlog', column: 'backlog', role: null }),
  ],
};

// ------------------------------------------------------------- the columns

test('the six columns are the schema’s six, in the schema’s order', () => {
  assert.deepEqual(COLUMN_IDS, [...COLUMNS]);
  assert.equal(BOARD_COLUMNS.length, 6);
  // And every one is called something a person would read on a board.
  assert.deepEqual(
    BOARD_COLUMNS.map((c) => c.label),
    ['Backlog', 'Ready', 'In progress', 'Review', 'Done', 'Blocked'],
  );
  assert.equal(columnLabel('in_progress'), 'In progress');
  // A column this build does not know reads as itself rather than as blank.
  assert.equal(columnLabel('someday'), 'someday');
});

test('every column is drawn, empty or not, and carries its count', () => {
  const grouped = cardsByColumn(BOARD);
  assert.deepEqual(
    grouped.map((g) => g.id),
    [...COLUMNS],
  );
  assert.deepEqual(
    grouped.map((g) => g.cards.length),
    [2, 1, 1, 1, 1, 1],
  );
  // The file's own order inside a column, because nothing sorts a board.
  assert.deepEqual(
    grouped[0].cards.map((c) => c.id),
    ['c1', 'c6'],
  );

  const drawn = renderBoardColumns(BOARD, {}, doc);
  const heads = byClass(drawn, 'board-col-head').map((h) => h.textContent);
  assert.deepEqual(heads, ['Backlog2', 'Ready1', 'In progress1', 'Review1', 'Done1', 'Blocked1']);
  // Six drop targets, one per column, including for a column with no cards —
  // an empty column has to be somewhere a card can be put.
  assert.deepEqual(
    byClass(drawn, 'board-drop').map((d) => d.getAttribute('data-column')),
    [...COLUMNS],
  );
});

// --------------------------------------------------------- the table below

test('ACCEPTANCE (1): the table mirrors the cards in board order', () => {
  const order = boardOrder(BOARD).map((c) => c.id);
  assert.deepEqual(order, ['c1', 'c6', 'c7', 'c3', 'c4', 'c2', 'c5']);

  const table = renderBoardTable(BOARD, doc);
  assert.equal(table.tagName, 'TABLE');
  const rows = byTag(table, 'TBODY')[0].children;
  assert.deepEqual(
    rows.map((r) => r.getAttribute('data-card')),
    order,
    'the table rows must be boardOrder() and nothing else',
  );
  // And the columns the picture draws are the columns the table states, in
  // the same order: the two cannot disagree about where a card is.
  assert.deepEqual(
    rows.map((r) => r.children[0].textContent),
    ['Backlog', 'Backlog', 'Ready', 'In progress', 'Review', 'Done', 'Blocked'],
  );
});

test('the table is a real table: a caption, column headers, and a row header per card', () => {
  const table = renderBoardTable(BOARD, doc);
  const caption = byTag(table, 'CAPTION')[0];
  assert.ok(caption, 'the table has no caption');
  assert.match(caption.textContent, /board order/i);

  const headers = byTag(byTag(table, 'THEAD')[0], 'TH');
  assert.deepEqual(
    headers.map((h) => h.textContent),
    ['Column', 'Card', 'Title', 'Assignee', 'Acceptance', 'Budget', 'Flags'],
  );
  for (const th of headers) assert.equal(th.getAttribute('scope'), 'col');

  const body = byTag(table, 'TBODY')[0];
  for (const row of body.children) {
    const rowHeader = byTag(row, 'TH')[0];
    assert.equal(rowHeader.getAttribute('scope'), 'row', 'a card id is the row header');
    assert.equal(rowHeader.textContent, row.getAttribute('data-card'));
  }
});

test('the table says what each card is, and says "nobody" rather than nothing', () => {
  const table = renderBoardTable(BOARD, doc);
  const row = byTag(table, 'TBODY')[0].children.find((r) => r.getAttribute('data-card') === 'c2');
  assert.deepEqual(
    row.children.map((cell) => cell.textContent),
    [
      'Done',
      'c2',
      'Ship the docs',
      'docs',
      '3 criteria',
      '400,000 tokens · 90 min',
      '80% spent, 1/4 criteria met; outside milestone 2',
    ],
  );
  const orphan = byTag(table, 'TBODY')[0].children.find(
    (r) => r.getAttribute('data-card') === 'c7',
  );
  assert.equal(orphan.children[3].textContent, 'nobody');
  assert.equal(orphan.children[5].textContent, 'no budget', 'no budget must not read as zero');
  assert.equal(orphan.children[6].textContent, 'none');
});

test('the table is drawn for an empty board too', () => {
  const table = renderBoardTable({ cards: [] }, doc);
  assert.equal(byTag(table, 'TBODY')[0].children.length, 0);
  assert.match(String(table.className), /sr-only/);
});

// ---------------------------------------------------------------- a card

test('a card shows its title, its assignee, its acceptance count, its budget and its flags', () => {
  const drawn = renderBoardColumns(BOARD, { agentIdFor: () => null }, doc);
  const c2 = byClass(drawn, 'board-card').find((n) => n.getAttribute('data-card') === 'c2');
  assert.equal(byClass(c2, 'board-card-title')[0].textContent, 'Ship the docs');
  assert.equal(byClass(c2, 'board-card-role')[0].textContent, 'docs');
  assert.deepEqual(
    byClass(c2, 'board-chip').map((chip) => chip.textContent),
    [
      '3 criteria',
      '400,000 tokens · 90 min',
      '80% spent, 1/4 criteria met',
      'outside milestone 2',
    ],
  );
  // Both counts, because §11.5 shows both and either trips the stop.
  assert.equal(budgetText(BOARD.cards[3]), '400,000 tokens · 90 min');
  assert.equal(budgetText(card({ budget: { tokens: null, minutes: 30 } })), '30 min');
  assert.equal(budgetText(card({ budget: null })), null);
  assert.equal(acceptanceCount(card({ acceptance: ['one'] })).text, '1 criterion');
  assert.equal(cardChips(card({})).length, 0, 'a bare card wears no chips at all');
});

test('a card with no assignee says so, and is never given one', () => {
  const drawn = renderBoardColumns(BOARD, { agentIdFor: () => 'claude-code:x' }, doc);
  const c7 = byClass(drawn, 'board-card').find((n) => n.getAttribute('data-card') === 'c7');
  assert.equal(byClass(c7, 'board-card-role')[0].textContent, 'no assignee');
  assert.equal(byTag(c7, 'CANVAS').length, 0);
});

test('a face is drawn only for a role with a live session (§105)', () => {
  // A face is a pure function of the session id, so a role nobody has hired
  // has no face and inventing one would be inventing a person.
  const hired = buildCard(BOARD.cards[0], { agentIdFor: () => 'claude-code:abc' }, doc);
  const canvas = byClass(hired, 'board-face')[0];
  assert.ok(canvas, 'a hired role gets the floor’s own face');
  assert.equal(canvas.getAttribute('data-agent'), 'claude-code:abc');
  assert.equal(canvas.getAttribute('aria-hidden'), 'true', 'the face is not the label');

  const unhired = buildCard(BOARD.cards[0], { agentIdFor: () => null }, doc);
  assert.equal(byClass(unhired, 'board-face').length, 0);
});

test('every card is a tab stop, is draggable, and says everything in its label', () => {
  const drawn = renderBoardColumns(BOARD, {}, doc);
  const cards = byClass(drawn, 'board-card');
  assert.equal(cards.length, BOARD.cards.length, 'every card is drawn');
  for (const el of cards) {
    assert.equal(el.getAttribute('tabindex'), '0');
    assert.equal(el.getAttribute('draggable'), 'true');
    assert.equal(el.getAttribute('role'), 'button');
    assert.ok(el.getAttribute('aria-label'));
  }
  // The columns are presentational: one list drawn in six places, not six
  // lists. The label on the card is what carries the column.
  assert.equal(drawn.getAttribute('role'), 'presentation');
  const label = cardLabel(BOARD.cards[3]);
  assert.match(label, /^Done\./);
  assert.match(label, /Ship the docs/);
  assert.match(label, /card c2/);
  assert.match(label, /Assigned to docs/);
  assert.match(label, /3 criteria/);
  assert.match(label, /Budget 400,000 tokens/);
  assert.match(label, /Milestone m2/);
  assert.match(label, /Flag: 80% spent/);
  assert.match(cardLabel(BOARD.cards[2]), /No assignee\./);
  assert.match(cardLabel(BOARD.cards[2]), /Ready\./);
});

// ------------------------------------------------------------ the keyboard

test('[ and ] walk the six columns and stop at both ends', () => {
  assert.equal(stepColumn('backlog', 1), 'ready');
  assert.equal(stepColumn('ready', 1), 'in_progress');
  assert.equal(stepColumn('blocked', 1), null, 'the last column is the last column');
  assert.equal(stepColumn('backlog', -1), null, 'and the first is the first');
  assert.equal(stepColumn('done', -1), 'review');
  // No wrapping, ever: a `]` on a Blocked card that quietly returned it to
  // Backlog is the one keystroke this product could least afford to get wrong.
  for (const direction of /** @type {const} */ ([1, -1])) {
    const walked = [];
    let at = direction === 1 ? 'backlog' : 'blocked';
    while (at) {
      walked.push(at);
      at = stepColumn(at, direction);
    }
    assert.equal(walked.length, 6, 'the walk must terminate');
  }
});

// -------------------------------------------- the message a live session gets

test('the message to a live session carries every field the brief’s card section does', () => {
  const c2 = { ...BOARD.cards[3], column: 'ready' };
  const message = cardMessage(c2);
  const brief = cardSection(c2);
  for (const must of ['c2', 'Ship the docs', 'm2', ...c2.acceptance]) {
    assert.ok(message.includes(must), `the message drops "${must}"`);
    assert.ok(brief.includes(must), `the brief drops "${must}" — the pin is backwards`);
  }
  // And it names the handover the card is finished by, which is the one
  // instruction §6 says the agent is given.
  assert.match(message, /\.deckhq\/studio\/handovers\/c2\.md/);
  // It does not move the card and does not tell anybody to: §5.2.
  assert.match(message, /Do not move the card/);
});

test('a card with no acceptance criteria asks for them rather than inventing any', () => {
  const message = cardMessage(card({ id: 'c9', title: 'vague', column: 'ready' }));
  assert.match(message, /carries no acceptance criteria/);
  assert.equal(/Accepted when/.test(message), false);
});

// ------------------------------------------------------------- empty board

test('an empty board says how to get a card rather than that there are none', () => {
  const empty = renderEmptyBoard(doc);
  const text = empty.textContent;
  assert.match(text, /No cards yet/);
  // §5: the board is the output of a plan, so the answer to "no cards" is
  // always the same one — run the planner.
  assert.match(text, /plan this project/);
  assert.match(text, /board\.json/);
  assert.equal(EMPTY_BOARD_LINES.length, 2);
});
