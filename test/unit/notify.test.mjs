/**
 * WP-16 · the daemon's OS notifications.
 *
 * Three things are being proved here, in order of how much they would cost to
 * get wrong:
 *
 *   1. **The interruption budget is what the plan says it is.**
 *      `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §6 spends an interruption
 *      on exactly two events. `for_review` and `stalled` get a badge and
 *      nothing else, and that absence is asserted rather than assumed.
 *   2. **User text never becomes code.** Every argv array is asserted whole,
 *      and a hostile title has to arrive at the notifier as one element that
 *      equals it. `docs/DEVIATIONS.md` §28, §91, §95.
 *   3. **One notification per coalescing window**, not one per session.
 *
 * Nothing in this file starts a process. The one real Windows toast this
 * package fired is recorded in `docs/DEVIATIONS.md` §101.
 */
// A machine of our own, before anything under `src/` is loaded: several of
// those modules resolve a path out of the environment while they evaluate.
// `docs/DEVIATIONS.md` §123.
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  APP_NAME,
  WINDOWS_SCRIPT,
  notifierAvailable,
  notifyCommand,
  oneLine,
  sendNotification,
} from '../../src/core/notify.mjs';
import {
  COALESCE_WINDOW_MS,
  NOTIFYING_ENTRY,
  NotificationWatcher,
  composeNotification,
  interruptingEvents,
  stateIndex,
} from '../../src/core/notify-watch.mjs';
import { Registry } from '../../src/core/state-machine.mjs';
import { DEFAULT_SETTINGS } from '../../src/core/store.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

/** The string this project uses to prove a value never reaches a parser. */
const HOSTILE = 'Ada"; & $(rm -rf ~) `whoami` | notify-send pwned & %PATH%';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

function fakeStore(settings = {}) {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  return {
    get settings() {
      return { ...s };
    },
    setSettings(patch) {
      Object.assign(s, patch);
    },
  };
}

/** A registry double: a snapshot subscription and the one accessor WP-16 reads. */
function fakeRegistry(cleanIds = new Set()) {
  const subs = new Set();
  return {
    on(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    snapshot() {
      return { agents: [] };
    },
    wasClosedCleanly: (id) => cleanIds.has(id),
    emit(snapshot) {
      for (const fn of subs) fn(snapshot);
    },
    subscriberCount: () => subs.size,
  };
}

/** A hand-cranked clock, so coalescing is proved rather than slept through. */
function fakeTimers() {
  let next = 1;
  const pending = new Map();
  return {
    setTimeout(fn) {
      const id = next++;
      pending.set(id, fn);
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    runAll() {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
      return fns.length;
    },
    get size() {
      return pending.size;
    },
  };
}

function agent(over = {}) {
  return {
    id: 'claude:s1',
    label: 'Ada',
    mk: 'MK1',
    title: 'refactor the scanner',
    projectName: 'orbital-api',
    activityState: 'working',
    ackState: 'active',
    live: true,
    ...over,
  };
}

/** A watcher wired to fakes, plus the notifications it produced. */
function makeWatcher(over = {}) {
  const sent = [];
  const registry = over.registry || fakeRegistry();
  const store = over.store || fakeStore({ osNotify: true });
  const timers = over.timers || fakeTimers();
  const watcher = new NotificationWatcher({
    registry,
    store,
    timers,
    platform: 'linux',
    send: (n) => {
      sent.push(n);
      return true;
    },
    ...over.opts,
  });
  return { watcher, sent, registry, store, timers };
}

// ---------------------------------------------------------------------------
// 1. The interruption budget
// ---------------------------------------------------------------------------

test('only needs_input is worth an interruption on entry', () => {
  assert.deepEqual(Object.keys(NOTIFYING_ENTRY), ['needs_input']);
});

test('for_review and stalled are badge-only: entering either notifies nothing', () => {
  for (const state of ['for_review', 'stalled']) {
    const prev = stateIndex({ agents: [agent({ activityState: 'working' })] });
    const events = interruptingEvents(prev, { agents: [agent({ activityState: state })] });
    assert.deepEqual(
      events,
      [],
      `entering ${state} raised an OS notification; 04 §6 says it is a badge`,
    );
  }
});

test('entering needs_input is one hands-up event', () => {
  const prev = stateIndex({ agents: [agent()] });
  const events = interruptingEvents(prev, { agents: [agent({ activityState: 'needs_input' })] });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'hands_up');
  assert.equal(events[0].label, 'Ada');
  assert.equal(events[0].projectName, 'orbital-api');
});

test('staying in needs_input notifies once, not on every snapshot', () => {
  const raised = agent({ activityState: 'needs_input' });
  let prev = stateIndex({ agents: [agent()] });
  assert.equal(interruptingEvents(prev, { agents: [raised] }).length, 1);
  prev = stateIndex({ agents: [raised] });
  assert.equal(interruptingEvents(prev, { agents: [raised] }).length, 0);
  assert.equal(interruptingEvents(prev, { agents: [raised] }).length, 0);
});

test('a session first seen in needs_input is not announced', () => {
  // A daemon restart must not replay the backlog at the user.
  const events = interruptingEvents(new Map(), {
    agents: [agent({ activityState: 'needs_input' })],
  });
  assert.deepEqual(events, []);
});

test('notifyHandsUp off suppresses the hands-up event', () => {
  const prev = stateIndex({ agents: [agent()] });
  const events = interruptingEvents(
    prev,
    { agents: [agent({ activityState: 'needs_input' })] },
    { settings: { notifyHandsUp: false } },
  );
  assert.deepEqual(events, []);
});

test('a benched or let-go session never interrupts', () => {
  for (const ackState of ['benched', 'let_go']) {
    const prev = stateIndex({ agents: [agent({ ackState })] });
    const events = interruptingEvents(prev, {
      agents: [agent({ ackState, activityState: 'needs_input' })],
    });
    assert.deepEqual(events, []);
  }
});

// ---------------------------------------------------------------------------
// 2. Death detection
// ---------------------------------------------------------------------------

test('a working session whose process vanishes is one death event', () => {
  const prev = stateIndex({ agents: [agent({ activityState: 'working', live: true })] });
  const events = interruptingEvents(prev, {
    agents: [agent({ activityState: 'ended', live: false })],
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'died');
});

test('a stalled session that dies counts too', () => {
  const prev = stateIndex({ agents: [agent({ activityState: 'stalled', live: true })] });
  const events = interruptingEvents(prev, {
    agents: [agent({ activityState: 'ended', live: false })],
  });
  assert.equal(events.length, 1);
});

test('a session that said goodbye does not interrupt', () => {
  const prev = stateIndex({ agents: [agent({ activityState: 'working', live: true })] });
  const events = interruptingEvents(
    prev,
    { agents: [agent({ activityState: 'ended', live: false })] },
    { wasClosedCleanly: (id) => id === 'claude:s1' },
  );
  assert.deepEqual(events, [], 'Stop or SessionEnd fired; this death was expected');
});

test('dying out of for_review is not a death: for_review survives death by design', () => {
  const prev = stateIndex({ agents: [agent({ activityState: 'for_review', live: true })] });
  const events = interruptingEvents(prev, {
    agents: [agent({ activityState: 'for_review', live: false })],
  });
  assert.deepEqual(events, []);
});

test('an already-dead session is not re-announced on every scan', () => {
  const dead = agent({ activityState: 'ended', live: false });
  const prev = stateIndex({ agents: [dead] });
  assert.deepEqual(interruptingEvents(prev, { agents: [dead] }), []);
});

test('the registry reports Stop and SessionEnd as a clean close, and nothing else', () => {
  const registry = new Registry({ store: storeDouble(), adapters: [] });
  const id = 'claude:s1';
  const hook = (hookEvent) => registry.applyHook({ runtime: 'claude', sessionId: 's1', hookEvent });

  assert.equal(registry.wasClosedCleanly(id), false, 'an unseen session has said nothing');
  hook('SessionStart');
  assert.equal(registry.wasClosedCleanly(id), false);
  hook('PreToolUse');
  assert.equal(registry.wasClosedCleanly(id), false);
  hook('Stop');
  assert.equal(registry.wasClosedCleanly(id), true);
  hook('UserPromptSubmit');
  assert.equal(registry.wasClosedCleanly(id), false, 'a new prompt reopens the session');
  hook('SessionEnd');
  assert.equal(registry.wasClosedCleanly(id), true);
});

/** The minimum store surface `Registry` touches. */
function storeDouble() {
  const ack = new Map();
  return {
    async load() {},
    get settings() {
      return { ...DEFAULT_SETTINGS };
    },
    get seededAt() {
      return 1;
    },
    markSeeded() {},
    getAck: (id) => (ack.has(id) ? { ...ack.get(id) } : undefined),
    setAck(id, patch) {
      const next = { state: 'active', ...(ack.get(id) || {}), ...patch };
      ack.set(id, next);
      return { ...next };
    },
    allAck: () => ({}),
    isProjectArchived: () => false,
    setProjectArchived() {},
    archivedProjects: () => [],
    writeError: null,
  };
}

// ---------------------------------------------------------------------------
// 3. Coalescing: one notification per window
// ---------------------------------------------------------------------------

test('three sessions raising a hand in one window is exactly one notification', () => {
  const { watcher, sent } = makeWatcher();
  const before = ['a', 'b', 'c'].map((id) => agent({ id, activityState: 'working' }));
  const after = ['a', 'b', 'c'].map((id) => agent({ id, activityState: 'needs_input' }));
  watcher.observe({ agents: before });
  watcher.observe({ agents: after });
  assert.equal(sent.length, 1);
  assert.equal(watcher.sentCount, 1);
  assert.equal(sent[0].body, '3 sessions raised a hand');
});

test('a second transition inside the window waits for it, then sends one more', () => {
  const { watcher, sent, timers } = makeWatcher();
  watcher.observe({ agents: [agent({ id: 'a' }), agent({ id: 'b' })] });
  watcher.observe({
    agents: [agent({ id: 'a', activityState: 'needs_input' }), agent({ id: 'b' })],
  });
  assert.equal(sent.length, 1, 'the first hand goes up immediately');

  watcher.observe({
    agents: [
      agent({ id: 'a', activityState: 'needs_input' }),
      agent({ id: 'b', activityState: 'needs_input' }),
    ],
  });
  assert.equal(sent.length, 1, 'the second is held for the window, not sent');
  assert.equal(timers.size, 1);
  timers.runAll();
  assert.equal(sent.length, 2);
  assert.equal(sent[1].body, 'Ada raised a hand in orbital-api');
});

test('the coalescing window matches the client', () => {
  assert.equal(COALESCE_WINDOW_MS, 10_000);
});

test('a mixed batch says neither hands nor deaths', () => {
  assert.equal(
    composeNotification([
      { kind: 'hands_up', label: 'Ada', projectName: 'p' },
      { kind: 'died', label: 'Bram', projectName: 'p' },
    ]).body,
    '2 sessions are waiting',
  );
});

// ---------------------------------------------------------------------------
// 4. Copy
// ---------------------------------------------------------------------------

test('the body copy carries no second-person fault', () => {
  const batches = [
    [{ kind: 'hands_up', label: 'Ada', projectName: 'orbital-api' }],
    [{ kind: 'died', label: 'Ada', projectName: 'orbital-api' }],
    [
      { kind: 'hands_up', label: 'Ada', projectName: 'p' },
      { kind: 'hands_up', label: 'Bram', projectName: 'p' },
    ],
    [
      { kind: 'died', label: 'Ada', projectName: 'p' },
      { kind: 'died', label: 'Bram', projectName: 'p' },
    ],
    [
      { kind: 'hands_up', label: 'Ada', projectName: 'p' },
      { kind: 'died', label: 'Bram', projectName: 'p' },
    ],
  ];
  for (const batch of batches) {
    const { title, body } = composeNotification(batch);
    const line = `${title} ${body}`;
    assert.doesNotMatch(
      line,
      /\b(you|your|you're|forgot|left|neglect|ignored|abandon)\b/i,
      `"${line}" blames the reader. The agents are the characters; the manager is never scored.`,
    );
  }
});

test('one raised hand names the agent and the project', () => {
  assert.deepEqual(
    composeNotification([{ kind: 'hands_up', label: 'Ada', projectName: 'orbital-api' }]),
    {
      title: 'DeckHQ',
      body: 'Ada raised a hand in orbital-api',
    },
  );
});

test('one death says what happened, not whose fault it was', () => {
  assert.equal(
    composeNotification([{ kind: 'died', label: 'Bram', projectName: 'orbital-api' }]).body,
    'Bram stopped mid-task in orbital-api',
  );
});

test('oneLine flattens control characters and caps the length', () => {
  assert.equal(oneLine('a\nb\tc'), 'a b c');
  assert.equal(oneLine('  padded  '), 'padded');
  assert.equal(oneLine('x'.repeat(400)).length, 120);
});

// ---------------------------------------------------------------------------
// 5. The argv arrays
// ---------------------------------------------------------------------------

test('SECURITY: the Windows argv is a fixed script plus two separate values', () => {
  const cmd = notifyCommand('win32', 'DeckHQ', HOSTILE, { scriptPath: 'C:/x/notify.ps1' });
  assert.deepEqual(cmd, {
    command: 'powershell',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:/x/notify.ps1',
      '-Title',
      'DeckHQ',
      '-Body',
      HOSTILE,
    ],
  });
});

test('SECURITY: the macOS argv keeps the AppleScript text fixed', () => {
  const cmd = notifyCommand('darwin', HOSTILE, 'orbital-api');
  assert.deepEqual(cmd, {
    command: 'osascript',
    args: [
      '-e',
      'on run argv',
      '-e',
      'display notification (item 2 of argv) with title (item 1 of argv)',
      '-e',
      'end run',
      HOSTILE,
      'orbital-api',
    ],
  });
  // Not one `-e` statement mentions the value it will be given.
  for (let i = 1; i < cmd.args.length; i += 2) {
    if (cmd.args[i - 1] !== '-e') continue;
    assert.doesNotMatch(cmd.args[i], /Ada|rm -rf|whoami/);
  }
});

test('SECURITY: the Linux argv stops option parsing before the user text', () => {
  const cmd = notifyCommand('linux', 'DeckHQ', '-x stopped mid-task');
  assert.deepEqual(cmd, {
    command: 'notify-send',
    args: ['--app-name=DeckHQ', '--', 'DeckHQ', '-x stopped mid-task'],
  });
});

test('SECURITY: a hostile title reaches every notifier as exactly one argument', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const cmd = notifyCommand(platform, HOSTILE, 'orbital-api');
    const carrying = cmd.args.filter((a) => a.includes('Ada'));
    assert.equal(carrying.length, 1, `${platform}: the title reached ${carrying.length} arguments`);
    assert.equal(carrying[0], HOSTILE, `${platform}: the title was modified in transit`);
    // And no argument is a shell, or a request for one.
    for (const arg of cmd.args) {
      assert.doesNotMatch(String(arg), /^(sh|bash|zsh|cmd|-c|-lc|\/c)$/);
    }
  }
});

test('SECURITY: the notifier source names no shell and spawns with an argv array', () => {
  const src = fs
    .readFileSync(path.join(ROOT, 'src', 'core', 'notify.mjs'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.doesNotMatch(src, /shell\s*:\s*true/);
  assert.doesNotMatch(src, /\bexec\(/);
  assert.match(src, /spawnFn\(cmd\.command, cmd\.args/);
});

test('SECURITY: the PowerShell script never interpolates a value into script text', () => {
  const ps = fs.readFileSync(WINDOWS_SCRIPT, 'utf8');
  assert.match(ps, /param\(/);
  assert.match(ps, /CreateTextNode\(\$Title\)/);
  assert.match(ps, /CreateTextNode\(\$Body\)/);
  // Neither value is ever inside a double-quoted PowerShell string, which is
  // the only place `$Title` would be expanded rather than passed.
  assert.doesNotMatch(ps, /"[^"\n]*\$(Title|Body)[^"\n]*"/);
  assert.doesNotMatch(ps, /Invoke-Expression|iex\b/);
});

test('the Windows script ships with the package', () => {
  assert.ok(fs.existsSync(WINDOWS_SCRIPT), `${WINDOWS_SCRIPT} is missing`);
  assert.ok(WINDOWS_SCRIPT.replace(/\\/g, '/').includes('/src/core/'), 'it must ship under src/');
});

test('a platform with no notifier degrades to nothing at all', () => {
  assert.equal(notifyCommand('aix', 'DeckHQ', 'x'), null);
  assert.equal(notifierAvailable('aix'), false);
  assert.equal(notifierAvailable('win32'), true);
  assert.equal(notifierAvailable('darwin'), true);
  assert.equal(notifierAvailable('linux'), true);
  assert.equal(sendNotification({ title: 'DeckHQ', body: 'x', platform: 'aix' }), false);
});

test('an absent notifier is silent, not fatal', () => {
  const thrown = sendNotification({
    title: 'DeckHQ',
    body: 'x',
    platform: 'linux',
    spawn: () => {
      throw new Error('ENOENT');
    },
  });
  assert.equal(thrown, false);
  // And an async spawn error must be handled rather than crash the daemon.
  const handlers = [];
  const ok = sendNotification({
    title: 'DeckHQ',
    body: 'x',
    platform: 'linux',
    spawn: () => ({ on: (ev, fn) => handlers.push([ev, fn]), unref() {} }),
  });
  assert.equal(ok, true);
  assert.deepEqual(
    handlers.map(([ev]) => ev),
    ['error'],
  );
  handlers[0][1](new Error('ENOENT')); // must not throw
});

test('APP_NAME is the product name', () => {
  assert.equal(APP_NAME, 'DeckHQ');
});

// ---------------------------------------------------------------------------
// 6. The switches
// ---------------------------------------------------------------------------

test('osNotify defaults off', () => {
  assert.equal(DEFAULT_SETTINGS.osNotify, false);
});

test('off by default: nothing fires without --notify or settings.osNotify', () => {
  const { watcher, sent } = makeWatcher({ store: fakeStore() });
  watcher.observe({ agents: [agent()] });
  watcher.observe({ agents: [agent({ activityState: 'needs_input' })] });
  assert.deepEqual(sent, []);
});

test('--notify turns it on without touching the stored setting', () => {
  const store = fakeStore();
  const { watcher, sent } = makeWatcher({ store, opts: { flag: true } });
  watcher.observe({ agents: [agent()] });
  watcher.observe({ agents: [agent({ activityState: 'needs_input' })] });
  assert.equal(sent.length, 1);
  assert.equal(store.settings.osNotify, false, '--notify must not persist');
});

test('the master notifications switch turns the daemon off too', () => {
  const { watcher, sent } = makeWatcher({
    store: fakeStore({ osNotify: true, notifications: false }),
  });
  watcher.observe({ agents: [agent()] });
  watcher.observe({ agents: [agent({ activityState: 'needs_input' })] });
  assert.deepEqual(sent, []);
});

test('turning it on mid-run does not replay what happened while it was off', () => {
  const store = fakeStore();
  const { watcher, sent } = makeWatcher({ store });
  watcher.observe({ agents: [agent()] });
  watcher.observe({ agents: [agent({ activityState: 'needs_input' })] });
  assert.deepEqual(sent, []);
  store.setSettings({ osNotify: true });
  watcher.observe({ agents: [agent({ activityState: 'needs_input' })] });
  assert.deepEqual(sent, [], 'the hand was already up; it is not news');
});

test('start seeds from the floor and stop unsubscribes', () => {
  const registry = fakeRegistry();
  const { watcher } = makeWatcher({ registry });
  watcher.start();
  assert.equal(registry.subscriberCount(), 1);
  watcher.start(); // idempotent
  assert.equal(registry.subscriberCount(), 1);
  watcher.stop();
  assert.equal(registry.subscriberCount(), 0);
});

test('the watcher runs off registry snapshots end to end', () => {
  const registry = fakeRegistry();
  const { watcher, sent } = makeWatcher({ registry });
  watcher.start();
  registry.emit({ agents: [agent({ activityState: 'working' })] });
  registry.emit({ agents: [agent({ activityState: 'needs_input' })] });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].body, 'Ada raised a hand in orbital-api');
});
