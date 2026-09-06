/**
 * WP-61 · "Let go" is called **Fire** everywhere a person can read it, and
 * `let_go` everywhere a machine can.
 *
 * The rename is a copy change and nothing else. There is no migration, no new
 * ack action and no new mutation path: `act('let_go')` is still the only way
 * an agent leaves the floor, `ACK_STATES` still carries `let_go`, every ledger
 * record ever written still says `let_go`, and the palette row is still
 * `cmd:show-let-go`. Ids and states are addresses; only the words moved
 * (docs/DEVIATIONS.md §143).
 *
 * So this file pins both halves:
 *
 *   1. the state id has NOT changed — asserted against `src/core/model.mjs`,
 *      the state machine's own transition, and the label tables' keys;
 *   2. no surface a person reads says "let go" any more — asserted by reading
 *      the string literals out of the client and the CLI, with two named
 *      exceptions that are deliberate;
 *
 * and then drives the two behaviours the rename brought with it: the question
 * asked before firing, and the sentence said afterwards.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { ACK_STATES } from '../../src/core/model.mjs';
import {
  ACTION_LABELS,
  STATE_LABELS,
  fireQuestion,
  legalActions,
} from '../../public/panel-rules.js';
import { createActionsPart } from '../../public/panel-actions.js';
import { setCurrentId, setDisplayedAgent } from '../../public/panel-state.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

// ------------------------------------------------- 1 · the id did not move

test('WP-61: the ack state is still `let_go` — the rename is copy, not data', () => {
  assert.ok(
    /** @type {readonly string[]} */ (ACK_STATES).includes('let_go'),
    'ACK_STATES still carries let_go; a ledger full of `let_go` records depends on it',
  );
  assert.ok(
    !(/** @type {readonly string[]} */ (ACK_STATES).includes('fired')),
    'no `fired` state was added',
  );
  assert.ok('let_go' in ACTION_LABELS, 'the action is still keyed `let_go`');
  assert.ok('let_go' in STATE_LABELS, 'the state is still keyed `let_go`');
  // And it is still the action the rules hand out, under its own name.
  assert.deepEqual(legalActions({ ackState: 'benched' }), ['recall', 'let_go']);
  assert.deepEqual(legalActions({ ackState: 'let_go' }), ['rehire']);
});

test("WP-61: `act('let_go')` is unchanged and no second mutation path was added", async () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/core/state-machine-rules.mjs'), 'utf8');
  assert.ok(src.includes('let_go'), 'the state machine still names let_go');
  assert.ok(
    !/\bfire\b/i.test(src.replace(/\/\*[\s\S]*?\*\//g, '')),
    'the daemon learned no `fire` action',
  );
  // The CLI gained no mutation of its own either: `ack` and `bench` are still
  // the only two subcommands that write, exactly as before this package.
  const bin = fs.readFileSync(path.join(ROOT, 'bin/deckhq.mjs'), 'utf8');
  const acts = [...bin.matchAll(/runAct\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(acts, ['acknowledge', 'bench'], 'no `deckhq fire` mutation was added');
});

// ---------------------------------------------------- 2 · the words moved

test('WP-61: the labels a person reads say Fire and Fired', () => {
  assert.equal(ACTION_LABELS.let_go, 'Fire', 'the ⋯ more menu item and the palette action');
  assert.equal(STATE_LABELS.let_go, 'Fired', 'the state, wherever it is named');
  // The palette keeps its own copy of both tables (it cannot import panel.js;
  // see `palette.test.mjs`). They must not drift.
  const palette = fs.readFileSync(path.join(ROOT, 'public/palette.js'), 'utf8');
  assert.match(palette, /let_go: 'Fire',/, "palette.js's ACTION_LABELS");
  assert.match(palette, /let_go: 'Fired',/, "palette.js's STATE_LABELS");
  const appState = fs.readFileSync(path.join(ROOT, 'public/app-state.js'), 'utf8');
  assert.match(appState, /let_go: 'Fired',/, "app.js's copy of STATE_LABELS");
});

/**
 * Every string literal in a file, with comments blanked first so a module
 * header explaining the old vocabulary is not read as copy.
 * @param {string} src
 */
function literals(src) {
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
  return [...code.matchAll(/(['"`])((?:\\.|(?!\1)[^\\])*)\1/g)].map((m) => m[2]);
}

/**
 * The surfaces this package owns. `public/render/` is NOT here and that is
 * deliberate: the room plate the floor draws still reads "1 let go ·
 * archived", and changing a string the canvas paints moves the goldens. It is
 * the one surface WP-61 left behind, named in docs/DEVIATIONS.md §143 rather
 * than quietly skipped.
 */
const OWNED = ['public', 'src/cli', 'bin'];

/** Every `.js`/`.mjs` under `dir`, minus `public/render`. */
function sources(dir, out = /** @type {string[]} */ ([])) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path.relative(ROOT, full).replace(/\\/g, '/') === 'public/render') continue;
      sources(full, out);
    } else if (/\.m?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * The two strings that are allowed to keep the old words, each for a reason
 * that is about the reader rather than about the code.
 */
const KEPT = new Set([
  // A palette search keyword, not a label: somebody who learned the product
  // as "let go" must still find the row. Discoverability, in a field nobody
  // sees (`public/palette.js`).
  'let go',
  'letgo',
  // The palette row's own id. An address, like the state, and renaming it
  // would be a data change dressed as a copy change.
  'cmd:show-let-go',
]);

test('WP-61: no user-facing string in the client or the CLI still says "let go"', () => {
  /** @type {string[]} */
  const offenders = [];
  for (const base of OWNED) {
    const dir = path.join(ROOT, base);
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.statSync(dir).isDirectory() ? sources(dir) : [dir]) {
      const rel = path.relative(ROOT, file).replace(/\\/g, '/');
      for (const s of literals(fs.readFileSync(file, 'utf8'))) {
        if (KEPT.has(s.toLowerCase())) continue;
        if (/let[ -]go/i.test(s)) offenders.push(`${rel}: ${JSON.stringify(s)}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'these strings still say "let go" to a person');
});

test('WP-61: the README and the site say Fired, and the six-state table keeps the id', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const row = readme.split('\n').find((l) => l.startsWith('| `let_go`'));
  assert.ok(row, 'the six-state table still has a `let_go` row');
  assert.match(row, /\*\*Fired\*\*/, 'the row says Fired');
  assert.match(row, /Show fired/, 'and names the view toggle by its new label');
  assert.ok(!/let[ -]go/i.test(readme), 'no "let go" is left in the README');
  const site = fs.readFileSync(path.join(ROOT, 'site/pages/model.html'), 'utf8');
  assert.ok(site.includes('<code>let_go</code>'), 'the site still names the state id');
  assert.ok(!/let-go agents/i.test(site), 'and no longer says "let-go agents"');
});

// ------------------------------------------- 3 · the question, and the line
//
// `performAction()` is the only caller of POST /api/ack in the whole client
// (docs/plan/08-PLAN-V2-100X.md §1.1 rule 1), so both new behaviours are
// driven through it. `createActionsPart` takes its DOM as a plain ctx object,
// which is why nothing here needs a document.

const AGENT = {
  id: 'claude-code:abc',
  mk: 'MK1.1',
  displayName: 'Ada',
  projectId: 'orbital-api',
  ackState: 'active',
  activityState: 'for_review',
};

/**
 * A `createActionsPart` wired to fakes, with `confirm` and `fetch` under this
 * test's control. Returns the part plus everything it said and sent.
 * @param {{confirm?: any, ok?: boolean, agent?: any}} [o]
 */
function actionsPart(o = {}) {
  const agent = o.agent ?? AGENT;
  /** @type {string[]} */
  const toasts = [];
  /** @type {any[]} */
  const posts = [];
  const saved = { fetch: globalThis.fetch, confirm: /** @type {any} */ (globalThis).confirm };
  Object.defineProperty(globalThis, 'fetch', {
    value: async (/** @type {string} */ url, /** @type {any} */ init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return { ok: o.ok !== false, status: o.ok === false ? 500 : 200, json: async () => ({}) };
    },
    configurable: true,
    writable: true,
  });
  Object.defineProperty(globalThis, 'confirm', {
    value: o.confirm,
    configurable: true,
    writable: true,
  });
  const noop = () => {};
  const el = () => ({
    hidden: false,
    textContent: '',
    focus: noop,
    setSelectionRange: noop,
    value: '',
    querySelector: () => null,
    appendChild: noop,
    append: noop,
  });
  const part = createActionsPart(
    /** @type {any} */ ({
      root: el(),
      getSnapshot: () => ({ agents: [agent], settings: {} }),
      toast: (/** @type {string} */ m) => void toasts.push(m),
      announce: noop,
      actionsWrap: el(),
      actionsEl: el(),
      moreMenu: el(),
      form: el(),
      textarea: el(),
    }),
  );
  part.wire({ pendingPermission: () => null, renderChrome: noop, sendText: noop, open: noop });
  setCurrentId(agent.id);
  setDisplayedAgent(agent);
  const restore = () => {
    Object.defineProperty(globalThis, 'fetch', {
      value: saved.fetch,
      configurable: true,
      writable: true,
    });
    if (saved.confirm === undefined) delete (/** @type {any} */ (globalThis).confirm);
    else
      Object.defineProperty(globalThis, 'confirm', {
        value: saved.confirm,
        configurable: true,
        writable: true,
      });
    setCurrentId(null);
    setDisplayedAgent(null);
  };
  return { part, toasts, posts, restore };
}

test('WP-61: firing asks one question first, and says nothing about the reader', () => {
  const q = fireQuestion('Ada');
  assert.equal(q, 'Fire Ada? The chat is kept and stays reachable from ⌘K → Show fired.');
  // docs/plan/08-PLAN-V2-100X.md §1.1 rule 6 and docs/plan/04 §5: the copy is
  // about the agent, never the second person with an implication of fault.
  assert.ok(!/\byou\b|\byour\b|are you sure/i.test(q), 'the question addresses nobody');
  // §46 and rule 8: DeckHQ never writes the runtime's archive flag, so the
  // copy must not promise that it does.
  assert.ok(!/archiv/i.test(q), "it does not claim to archive anything of the runtime's");
});

test('WP-61: a declined confirm sends nothing at all', async () => {
  const { part, posts, toasts, restore } = actionsPart({ confirm: () => false });
  try {
    await part.performAction('let_go');
    assert.deepEqual(posts, [], 'no /api/ack request was made');
    assert.deepEqual(toasts, [], 'and nothing was announced');
  } finally {
    restore();
  }
});

test('WP-61: an accepted confirm fires through performAction and says so', async () => {
  /** @type {string[]} */
  const asked = [];
  const { part, posts, toasts, restore } = actionsPart({
    confirm: (/** @type {string} */ q) => (asked.push(q), true),
  });
  try {
    await part.performAction('let_go');
    assert.equal(asked.length, 1, 'asked exactly once');
    assert.equal(asked[0], fireQuestion('Ada'));
    assert.deepEqual(
      posts.map((p) => [p.url, p.body.action]),
      [['/api/ack', 'let_go']],
      'one POST /api/ack, carrying the unchanged state id',
    );
    assert.deepEqual(toasts, ['Fired. Ada is off the floor.']);
  } finally {
    restore();
  }
});

test('WP-61: bench and recall are not made to ask, and their copy is unchanged', async () => {
  for (const [action, said] of [
    ['bench', 'Benched. Ada is in the lounge.'],
    ['recall', 'Recalled. Ada is back on the floor.'],
  ]) {
    const agent = action === 'recall' ? { ...AGENT, ackState: 'benched' } : AGENT;
    const { part, toasts, restore } = actionsPart({
      agent,
      confirm: () => assert.fail(`${action} must not ask a question`),
    });
    try {
      await part.performAction(action);
      assert.deepEqual(toasts, [said]);
    } finally {
      restore();
    }
  }
});

test('WP-61: a host with no confirm at all still fires', async () => {
  // Some embedders remove `confirm` outright. An explicit button press must
  // not become a no-op there.
  const { part, posts, restore } = actionsPart({ confirm: undefined });
  try {
    await part.performAction('let_go');
    assert.deepEqual(
      posts.map((p) => p.body.action),
      ['let_go'],
    );
  } finally {
    restore();
  }
});

test('WP-61: a failed fire is reported without blaming anybody', async () => {
  const { part, toasts, restore } = actionsPart({ confirm: () => true, ok: false });
  try {
    await part.performAction('let_go');
    assert.equal(toasts.length, 1);
    assert.match(toasts[0], /^Could not fire: /);
    assert.ok(!/\byou\b|\byour\b/i.test(toasts[0]), 'the failure is not the reader’s');
  } finally {
    restore();
  }
});
