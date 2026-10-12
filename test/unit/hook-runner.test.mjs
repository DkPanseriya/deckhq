/**
 * WHAT A HOOK IS STARTED BY.
 *
 * A hook written as `node -e …` runs whatever `node` the user's shell finds.
 * On a PC that has the DeckHQ app and no Node of its own it finds none: every
 * hook the app installed did nothing, and nothing said so. The app carries a
 * Node (`<app>/node/node.exe` beside `<app>/core/`, which is this package), so
 * a daemon running on THAT Node writes its hooks on it, by path.
 *
 * What is held here: when the bundled Node is recognised and when it is not;
 * how its path is written so every shell reads it; and the rule that stops two
 * DeckHQs on one machine from rewriting each other's entries.
 *
 * NOT MEASURED: a hook firing from a real Claude Code session on a PC without
 * Node. Nothing in this suite can be that machine.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CLAUDE_DIR = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-claude-'));
const STATE_DIR = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-state-'));
process.env.CLAUDE_CONFIG_DIR = CLAUDE_DIR;
process.env.DECKHQ_STATE_DIR = STATE_DIR;

const hooks = await import('../../src/adapters/claude-code/hooks.mjs');
const SETTINGS = path.join(CLAUDE_DIR, 'settings.json');

const APP = path.join(os.tmpdir(), 'DeckHQ');
const APP_NODE = path.join(APP, 'node', 'node.exe');
const APP_CORE = path.join(APP, 'core');
const SLASHED = APP_NODE.replace(/\\/g, '/');

async function reset() {
  await fsp.rm(SETTINGS, { force: true });
}

function commands() {
  const settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8'));
  const out = [];
  for (const groups of Object.values(settings.hooks || {})) {
    for (const group of groups || []) {
      for (const h of group.hooks || []) {
        if (h && h._deckhq === true && h.type !== 'http') out.push(h.command);
      }
    }
  }
  return out;
}

test("the app's Node is recognised by where it stands, and no other Node is", () => {
  assert.equal(hooks.bundledNode(APP_NODE, APP_CORE), APP_NODE);
  // An ordinary install: Node is somewhere else entirely.
  assert.equal(hooks.bundledNode(path.join(os.tmpdir(), 'nodejs', 'node.exe'), APP_CORE), null);
  // A folder called `node` that is not beside THIS package.
  assert.equal(
    hooks.bundledNode(APP_NODE, path.join(os.tmpdir(), 'elsewhere', 'core')),
    null,
    'a Node in a folder named node is not ours unless this package is beside it',
  );
  // This test process is not the app.
  assert.equal(hooks.bundledNode(), null);
  assert.equal(hooks.hookRunner(), 'node');
});

test('the runner is written so every shell reads it', () => {
  // Forward slashes, and bare: a quoted program name is not a command to PowerShell.
  const runner = hooks.hookRunner(APP_NODE, APP_CORE);
  assert.ok(!runner.includes('\\'), 'no backslash: a POSIX shell would eat it');
  if (!/\s/.test(SLASHED)) assert.equal(runner, SLASHED);

  // A space has to be quoted; nothing else can carry it.
  const spaced = path.join(os.tmpdir(), 'My Apps', 'DeckHQ');
  const withSpace = hooks.hookRunner(
    path.join(spaced, 'node', 'node.exe'),
    path.join(spaced, 'core'),
  );
  assert.match(withSpace, /^".* .*"$/);

  // A character some shell expands inside quotes is never written: plain `node`.
  for (const bad of ['a$b', 'a%b', 'a!b', 'a`b']) {
    const root = path.join(os.tmpdir(), bad, 'DeckHQ');
    assert.equal(
      hooks.hookRunner(path.join(root, 'node', 'node.exe'), path.join(root, 'core')),
      'node',
      bad,
    );
  }
});

test('a command says what starts it, and an entry can be read back', () => {
  assert.match(hooks.hookCommand(4317), /^node -e "/);
  const mine = hooks.hookCommand(4317, '"C:/My Apps/DeckHQ/node/node.exe"');
  assert.match(mine, /^"C:\/My Apps\/DeckHQ\/node\/node\.exe" -e "/);

  const entry = (/** @type {string} */ command) => ({ type: 'command', command, _deckhq: true });
  assert.equal(hooks.runnerOfEntry(entry(hooks.hookCommand(4317))), 'node');
  assert.equal(hooks.runnerOfEntry(entry(mine)), 'C:/My Apps/DeckHQ/node/node.exe');
  assert.equal(
    hooks.runnerOfEntry(entry(hooks.hookCommand(4317, 'C:/DeckHQ/node/node.exe'))),
    'C:/DeckHQ/node/node.exe',
  );
  // The port is still read from a command whoever starts it.
  assert.equal(hooks.portOfEntry(entry(mine)), 4317);
  // Not ours, or not a command: no runner.
  assert.equal(hooks.runnerOfEntry({ type: 'command', command: 'node -e "x"' }), null);
  assert.equal(hooks.runnerOfEntry(hooks.permissionEntry(4317)), null);
});

test('runnerRuns: node if a node is on PATH, a path if the file is there', () => {
  const dir = path.join(os.tmpdir(), 'bin');
  const has = (/** @type {string[]} */ files) => (/** @type {string} */ f) => files.includes(f);
  assert.equal(
    hooks.runnerRuns('node', {
      env: { PATH: dir },
      platform: 'win32',
      exists: has([path.join(dir, 'node.exe')]),
    }),
    true,
  );
  assert.equal(
    hooks.runnerRuns('node', { env: { PATH: dir }, platform: 'win32', exists: has([]) }),
    false,
    'a PC with the app and no Node',
  );
  assert.equal(hooks.runnerRuns('node', { env: {}, exists: has([]) }), false);
  assert.equal(hooks.runnerRuns(SLASHED, { exists: has([SLASHED]) }), true);
  assert.equal(hooks.runnerRuns(SLASHED, { exists: has([]) }), false, 'the app was removed');
  assert.equal(hooks.runnerRuns(null), false);
});

test('THE CASE THIS EXISTS FOR: node hooks on a PC without Node are stale, and reinstall cures them', async () => {
  await reset();
  await hooks.install(4317); // as 1.7.1 of the app wrote them: `node -e …`
  assert.match(commands()[0], /^node -e "/);

  const app = { runner: SLASHED, runs: () => false }; // the app's daemon; no node on PATH
  assert.equal(await hooks.installed(4317, app), false, 'the banner must come back');

  await hooks.install(4317, app);
  const after = commands();
  assert.equal(after.length, 9, 'replaced, not added to');
  for (const c of after) assert.ok(c.startsWith(`${SLASHED} -e "`), c.slice(0, 60));
  assert.equal(await hooks.installed(4317, { runner: SLASHED, runs: () => true }), true);
});

test('TWO DECKHQS ON ONE MACHINE leave each other alone', async () => {
  await reset();
  // The app wrote them, on its own Node, which is still there.
  await hooks.install(4317, { runner: SLASHED });
  const written = fs.readFileSync(SETTINGS, 'utf8');

  // A daemon started with npx would write `node`: a different runner, but the
  // installed one runs, so it is installed and nothing is rewritten.
  const npx = { runner: 'node', runs: () => true };
  assert.equal(await hooks.installed(4317, npx), true);
  await hooks.install(4317, npx);
  assert.equal(fs.readFileSync(SETTINGS, 'utf8'), written, 'byte for byte');

  // And the other way round: `node` hooks, the app running, Node on PATH.
  await reset();
  await hooks.install(4317);
  const plain = fs.readFileSync(SETTINGS, 'utf8');
  const app = { runner: SLASHED, runs: () => true };
  assert.equal(await hooks.installed(4317, app), true);
  await hooks.install(4317, app);
  assert.equal(fs.readFileSync(SETTINGS, 'utf8'), plain, 'byte for byte');
});

test('the app was uninstalled: its hooks are stale to the DeckHQ that is left', async () => {
  await reset();
  await hooks.install(4317, { runner: SLASHED });
  const npx = { runner: 'node', runs: () => false }; // the path is gone
  assert.equal(await hooks.installed(4317, npx), false);
  await hooks.install(4317, npx);
  for (const c of commands()) assert.match(c, /^node -e "/);
});

test('a command in a shape we did not write is never called stale', () => {
  const settings = {
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'something else', _deckhq: true }] }] },
  };
  assert.equal(hooks.firstDeckhqRunner(settings), null);
  assert.equal(hooks.runnerStale(settings, { runner: SLASHED, runs: () => false }), false);
});
