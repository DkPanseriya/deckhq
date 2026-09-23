/**
 * The Studio board, driven — WP-69, `docs/07-STUDIO-DESIGN.md` §5.2 and §5.4.
 *
 * `board-view.test.mjs` asserts the picture. This asserts the MOVES, which are
 * the other half of WP-69's first acceptance criterion (*"every move
 * performable from the keyboard"*) and the whole of its third (*"drag-to-Ready
 * with no assignee asks and never guesses"*).
 *
 * `public/board-ui.js` takes its document, its fetch, its toast, its project
 * and its selection as arguments, so every one of them here is a stub that
 * RECORDS. Nothing is mocked out of the module system, no browser is started,
 * and the only way a request can appear in `calls` below is if the controller
 * made it.
 *
 * The three things worth reading for:
 *
 *   1. a keyboard move is one `POST /api/studio/card` with `op:'move'`, and
 *      nothing else writes a column;
 *   2. a refusal puts the card back in the column it came from and shows the
 *      DAEMON'S sentence, not one this client invented;
 *   3. Ready is the only column that hands off, and with no assignee it asks —
 *      no hire, no send, and the card left where the user put it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HIRE_RUNTIME, createBoardUI } from '../../public/board-ui.js';
import { cardMessage } from '../../public/board-view.js';

// --------------------------------------------------------------- DOM stub
//
// `board-view.test.mjs`'s recorder, plus the three things a CONTROLLER needs
// that a renderer does not: listeners it can fire, a `classList` it can read,
// and enough of a selector engine for `.board-card`, `.board-drop` and
// `.board-card[data-card="c3"]` — which are the only three this file asks for.

class StubNode {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.className = '';
    this.attrs = /** @type {Record<string,string>} */ ({});
    this.listeners = /** @type {Record<string, Function[]>} */ ({});
    this.hidden = false;
    this.focused = 0;
    this._text = /** @type {string|null} */ (null);
    const classes = () => String(this.className).split(/\s+/).filter(Boolean);
    this.classList = {
      add: (c) => {
        if (!classes().includes(c)) this.className = [...classes(), c].join(' ');
      },
      remove: (c) => {
        this.className = classes()
          .filter((x) => x !== c)
          .join(' ');
      },
      contains: (c) => classes().includes(c),
    };
  }
  appendChild(child) {
    // `textContent = ''` is how this product empties a node, and the board
    // empties its body and then fills it again on every paint. So a child
    // arriving clears the emptying, exactly as a real node's would.
    this._text = null;
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
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  focus() {
    this.focused++;
  }
  /** Fire one event on this node. No bubbling: the board binds on the card. */
  fire(type, event = {}) {
    const e = { preventDefault() {}, ...event };
    for (const fn of this.listeners[type] || []) fn(e);
    return e;
  }
  querySelectorAll(selector) {
    const m = /^\.([\w-]+)(?:\[([\w-]+)="([^"]*)"\])?$/.exec(String(selector));
    if (!m) throw new Error(`the stub does not understand "${selector}"`);
    const [, cls, attr, value] = m;
    return all(this).filter(
      (n) =>
        n !== this &&
        String(n.className).split(/\s+/).includes(cls) &&
        (!attr || n.getAttribute(attr) === value),
    );
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
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

/** @param {any} node @param {any[]} out */
function all(node, out = []) {
  out.push(node);
  for (const c of node.children || []) all(c, out);
  return out;
}

const doc = { createElement: (tag) => new StubNode(tag) };

// ------------------------------------------------------------- the fixture

const PROJECT = { id: 'p1', cwd: '/code/orbital-api', name: 'orbital-api' };

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

/** A fresh board on every build, so one test's optimistic write cannot reach another. */
function boardDoc() {
  return {
    version: 1,
    projectKey: '1f4a9c3e7b20d581',
    cards: [
      card({ id: 'c1', title: 'Write the schema', column: 'backlog', role: 'backend' }),
      card({
        id: 'c2',
        title: 'Refund path returns the fee',
        column: 'backlog',
        role: 'docs',
        acceptance: ['a failing test first'],
      }),
      card({ id: 'c3', title: 'Nobody owns this', column: 'backlog', role: null }),
      card({ id: 'c4', title: 'Audit the bucket', column: 'blocked', role: 'backend' }),
    ],
  };
}

const ROLES = [
  // `backend` has a session the scan can see; `docs` has been named and never hired.
  { name: 'backend', purpose: 'the API', agentId: 'claude-code:abc', live: true },
  { name: 'docs', purpose: 'the manual', agentId: null, live: false },
];

/**
 * Build a board over stubs.
 *
 * `routes` maps a pathname to `{ status, body }` or to a function of the
 * parsed request body. Anything not named answers 200 with `{}`, so a test
 * says only what it is about.
 *
 * @param {{routes?:Record<string, any>, project?:any}} [opts]
 */
function build(opts = {}) {
  const host = new StubNode('section');
  const body = new StubNode('div');
  const stage = new StubNode('div');
  /** @type {Array<{url:string, method:string, body:any}>} */
  const calls = [];
  /** @type {Array<{text:string, isError:boolean}>} */
  const toasts = [];
  /** @type {string[]} */
  const said = [];
  /** @type {any[]} */
  const opened = [];
  /** @type {string[]} */
  const selected = [];
  const snapshot = { studio: { board: { present: true, board: boardDoc() } }, roles: ROLES };

  const routes = {
    '/api/studio': () => ({
      status: 200,
      body: { ...snapshot, project: PROJECT.cwd, enabled: true },
    }),
    ...(opts.routes || {}),
  };

  const ui = createBoardUI({
    host,
    body,
    stageEl: stage,
    document: doc,
    editor: { open: (o) => opened.push(o), close: () => {} },
    getProject: () => ('project' in opts ? opts.project : PROJECT),
    onSelect: (id) => selected.push(id),
    notify: (text, o) => toasts.push({ text, isError: Boolean(o?.isError) }),
    announce: (text) => said.push(text),
    fetch: async (url, init = {}) => {
      const path = String(url).split('?')[0];
      const sent = init.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url: String(url), method: init.method || 'GET', body: sent });
      const route = routes[path];
      const answer = typeof route === 'function' ? route(sent) : route || { status: 200, body: {} };
      return {
        ok: answer.status >= 200 && answer.status < 300,
        status: answer.status,
        json: async () => answer.body,
      };
    },
  });

  return { ui, host, body, stage, calls, toasts, said, opened, selected };
}

/** Open the board and let its first `GET /api/studio` settle. */
async function opened(opts) {
  const it = build(opts);
  it.ui.open();
  await it.ui.refresh();
  return it;
}

const posts = (it, path) =>
  it.calls.filter((c) => c.method === 'POST' && c.url.split('?')[0] === path);
const cardEl = (it, id) => it.body.querySelector(`.board-card[data-card="${id}"]`);

// ------------------------------------------------------------------ moves

test('ACCEPTANCE (1): "]" on a focused card moves it one column, through op:"move"', async () => {
  const it = await opened();
  cardEl(it, 'c1').fire('keydown', { key: ']' });
  await new Promise((r) => setImmediate(r));

  const moves = posts(it, '/api/studio/card');
  assert.equal(moves.length, 1, 'one request, and one only');
  assert.deepEqual(moves[0].body, {
    cwd: PROJECT.cwd,
    op: 'move',
    cardId: 'c1',
    column: 'ready',
  });
});

test('the arrows are the same move, and "[" walks the other way', async () => {
  const it = await opened();
  cardEl(it, 'c4').fire('keydown', { key: 'ArrowLeft' });
  await new Promise((r) => setImmediate(r));
  assert.equal(posts(it, '/api/studio/card')[0].body.column, 'done');

  const back = await opened();
  cardEl(back, 'c4').fire('keydown', { key: 'ArrowRight' });
  await new Promise((r) => setImmediate(r));
  assert.equal(
    posts(back, '/api/studio/card').length,
    0,
    'blocked is the last column; there is nowhere to the right of it',
  );
  assert.match(back.said.at(-1), /already in the last column/);
});

test('a chord is not a move: the board leaves ⌘] to the browser', async () => {
  const it = await opened();
  cardEl(it, 'c1').fire('keydown', { key: ']', metaKey: true });
  await new Promise((r) => setImmediate(r));
  assert.equal(posts(it, '/api/studio/card').length, 0);
});

test('Enter on a card opens the editor on that card, and moves nothing', async () => {
  const it = await opened();
  cardEl(it, 'c2').fire('keydown', { key: 'Enter' });
  assert.equal(it.opened.length, 1);
  assert.equal(it.opened[0].card.id, 'c2');
  assert.equal(posts(it, '/api/studio/card').length, 0);
});

test('a refusal puts the card back, and says what the daemon said', async () => {
  const it = await opened({
    routes: {
      '/api/studio/card': () => ({
        status: 400,
        body: { error: '"ready" is not a column you can reach from here', line: 12 },
      }),
    },
  });
  cardEl(it, 'c1').fire('keydown', { key: ']' });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));

  assert.equal(
    cardEl(it, 'c1').getAttribute('data-column'),
    'backlog',
    'the card is back where it started',
  );
  const complaint = it.toasts.find((t) => t.isError);
  assert.ok(complaint, 'a refusal is reported');
  assert.match(complaint.text, /is not a column you can reach from here/);
  assert.match(complaint.text, /line 12/);
  assert.match(it.said.at(-1), /back in Backlog/);
});

// -------------------------------------------------------- card → session

test('ACCEPTANCE (3): into Ready with no assignee, the board asks and starts nothing', async () => {
  const it = await opened();
  await it.ui.moveCard('c3', 'ready');

  assert.equal(posts(it, '/api/studio/hire').length, 0, 'nothing is hired');
  assert.equal(posts(it, '/api/send').length, 0, 'nothing is sent');
  const ask = it.opened.at(-1);
  assert.ok(ask?.ask, 'the editor is opened with the question on it');
  assert.match(ask.ask, /no assignee/);
  assert.equal(ask.card.id, 'c3');
  assert.equal(
    cardEl(it, 'c3').getAttribute('data-column'),
    'ready',
    'the move was the user’s and is not undone by their not having answered yet',
  );
});

test('into Ready with an assignee that has no session hires, naming the card', async () => {
  const it = await opened({ routes: { '/api/studio/hire': () => ({ status: 200, body: {} }) } });
  await it.ui.moveCard('c2', 'ready');

  const hires = posts(it, '/api/studio/hire');
  assert.equal(hires.length, 1);
  assert.deepEqual(hires[0].body, {
    cwd: PROJECT.cwd,
    role: 'docs',
    cardId: 'c2',
    runtime: HIRE_RUNTIME,
  });
  assert.equal(posts(it, '/api/send').length, 0);
});

test('into Ready with a LIVE assignee sends the card as the next thing to do', async () => {
  const it = await opened({ routes: { '/api/send': () => ({ status: 200, body: {} }) } });
  await it.ui.moveCard('c1', 'ready');

  assert.equal(posts(it, '/api/studio/hire').length, 0, 'a live session is never re-hired');
  const sends = posts(it, '/api/send');
  assert.equal(sends.length, 1);
  assert.equal(sends[0].body.id, 'claude-code:abc');
  assert.equal(
    sends[0].body.text,
    cardMessage({ ...boardDoc().cards[0], column: 'ready' }),
    'the message is `cardMessage()`, the same fields the brief’s card section carries',
  );
});

test('a hand-off that failed leaves the card where the user put it', async () => {
  const it = await opened({
    routes: { '/api/send': () => ({ status: 503, body: { error: 'that session is gone' } }) },
  });
  await it.ui.moveCard('c1', 'ready');

  assert.equal(cardEl(it, 'c1').getAttribute('data-column'), 'ready');
  assert.match(it.toasts.find((t) => t.isError).text, /that session is gone/);
});

test('only Ready hands off: every other column is a move and nothing more', async () => {
  const it = await opened();
  await it.ui.moveCard('c1', 'in_progress');
  assert.equal(posts(it, '/api/studio/hire').length, 0);
  assert.equal(posts(it, '/api/send').length, 0);
  assert.equal(posts(it, '/api/studio/card').length, 1);
});

// ------------------------------------------------------- click, and the desk

test('§5.4: a card click lights its assignee’s desk — on the way out', async () => {
  const it = await opened();
  cardEl(it, 'c1').fire('click');
  assert.deepEqual(it.selected, [], 'nothing is selected while the board is still up');
  it.ui.close();
  assert.deepEqual(it.selected, ['claude-code:abc']);
});

test('a card whose role is not at a desk lights nothing, and says so', async () => {
  const it = await opened();
  cardEl(it, 'c2').fire('click');
  it.ui.close();
  assert.deepEqual(it.selected, []);
  assert.match(it.toasts.at(-1).text, /not at a desk yet/);
});

// ------------------------------------------------------------- the editor

test('create and edit go through the one route, with the verb named', async () => {
  const it = await opened({ routes: { '/api/studio/card': () => ({ status: 200, body: {} }) } });
  await it.ui.saveCard({ title: 'a new one' }, null);
  await it.ui.saveCard({ title: 'an old one' }, 'c1');

  const writes = posts(it, '/api/studio/card');
  assert.deepEqual(
    writes.map((w) => w.body.op),
    ['create', 'edit'],
  );
  assert.equal(writes[1].body.cardId, 'c1');
});

test('the daemon’s refusal of a save is returned to the dialog, not toasted away', async () => {
  const it = await opened({
    routes: {
      '/api/studio/card': () => ({
        status: 400,
        body: { error: 'a card needs a title', at: 'cards[0].title' },
      }),
    },
  });
  const answer = await it.ui.saveCard({ title: '' }, null);
  assert.match(answer.error, /a card needs a title/);
});

// --------------------------------------------------------- with no project

test('no project in view is said plainly, and nothing is fetched', async () => {
  const it = build({ project: null });
  it.ui.open();
  await it.ui.refresh();
  assert.equal(it.calls.length, 0, 'a board with no project asks the daemon nothing');
  assert.match(it.body.textContent, /project/i);
});
