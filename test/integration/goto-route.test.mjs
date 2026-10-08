/**
 * WP-100 · `GET /api/session-target` and `POST /api/go`, against a real daemon
 * on a real loopback port.
 *
 * Two things are replaced, and only those two: which process a session is in
 * (`sessionPid`) and the runner that asks the machine where that process's
 * window is and raises it (`sessionFocus`). A test that used the real ones
 * would raise a window on the developer's desktop in the middle of a run, and
 * would pass or fail on what happened to be open. Everything else — the
 * router, the registry, the Origin check, the session on disk — is the
 * product.
 */
// First, and before anything under `src/`: it moves the machine.
import { daemonScratch, writeClaudeSession } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const { startDaemon } = await import('../../src/daemon.mjs');
const { adapter: claude } = await import('../../src/adapters/claude-code/adapter.mjs');

const SESSION = '44444444-4444-4444-4444-444444444444';

/** A table in the shape `focus.ps1 -Action table` printed on Windows 11. */
function tableWithTerminal(pid) {
  return {
    processes: [
      { pid: 100, ppid: 1, name: 'WindowsTerminal.exe' },
      { pid: 200, ppid: 100, name: 'powershell.exe' },
      { pid, ppid: 200, name: 'claude.exe' },
    ],
    windows: [
      {
        hwnd: 9001,
        pid: 100,
        title: 'The planted one',
        windowClass: 'CASCADIA_HOSTING_WINDOW_CLASS',
      },
    ],
    console: { hwnd: 7, root: 9001, pid: 100, title: 'The planted one' },
  };
}

/**
 * @param {object} seams
 * @param {(d:any, agentId:string, calls:any) => Promise<void>} fn
 */
async function withDaemon(seams, fn) {
  const planted = writeClaudeSession({ sessionId: SESSION, project: 'goto' });
  const { dir, stateFile, publicDir } = daemonScratch('goto-');
  const calls = { table: [], focus: [] };
  const sessionFocus = {
    support: async () => seams.support || { supported: true, verified: true, how: 'test' },
    table: async (pid) => {
      calls.table.push(pid);
      if (seams.tableThrows) throw new Error('powershell is not on this machine');
      return (seams.table || tableWithTerminal)(pid);
    },
    focus: async (target) => {
      calls.focus.push(target);
      if (seams.focusThrows) throw new Error('that window is gone');
      return (
        seams.focusResult || {
          foreground: true,
          tab: 'selected',
          tabs: 2,
          tabTitle: 'The planted one',
        }
      );
    },
  };
  const d = await startDaemon({
    port: 0,
    stateFile,
    publicDir,
    sessionFocus,
    sessionPid: async () => ('pid' in seams ? seams.pid : 300),
    describeTerminal: async () => ({ label: 'Windows Terminal' }),
  });
  try {
    await d.registry.refresh();
    const agent = d.registry.agents.find((a) => a.id.endsWith(SESSION));
    assert.ok(agent, 'the planted session did not reach the floor');
    await fn(d, agent.id, calls);
  } finally {
    await d.close();
    planted.remove();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const go = (d, body, headers = {}) =>
  fetch(d.url + 'api/go', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('a running session: the target says where it is, and the click raises that one window', async () => {
  await withDaemon({}, async (d, id, calls) => {
    const res = await fetch(`${d.url}api/session-target?id=${encodeURIComponent(id)}`);
    assert.equal(res.status, 200);
    const target = await res.json();
    assert.equal(target.action, 'focus');
    assert.equal(target.label, 'Go to session');
    assert.equal(target.disabled, false);
    assert.equal(target.detail, 'Windows Terminal — tab “The planted one”');
    assert.deepEqual(target.where, {
      kind: 'terminal',
      label: 'Windows Terminal',
      windowTitle: 'The planted one',
      tabTitle: 'The planted one',
    });
    // INVARIANT-adjacent: asking where a session is raises nothing.
    assert.equal(calls.focus.length, 0, 'a GET must never move a window');

    const out = await go(d, { id });
    assert.equal(out.status, 200);
    const body = await out.json();
    assert.equal(body.ok, true);
    assert.equal(body.did, 'focus');
    assert.equal(body.foreground, true);
    assert.equal(body.message, 'Windows Terminal is in front, on this session’s tab.');

    assert.equal(calls.focus.length, 1);
    assert.equal(calls.focus[0].hwnd, 9001);
    assert.equal(calls.focus[0].hostPid, 100);
    assert.equal(calls.focus[0].sessionPid, 300);
    // The table read for the GET served the click that followed it.
    assert.deepEqual(calls.table, [300]);
  });
});

test('INVARIANT: going to a session never touches ack state', async () => {
  await withDaemon({}, async (d, id) => {
    const before = d.registry.agents.find((a) => a.id === id);
    const { ackState, reviewSince, needsInputSince } = before;
    await fetch(`${d.url}api/session-target?id=${encodeURIComponent(id)}`);
    assert.equal((await go(d, { id })).status, 200);
    const after = d.registry.agents.find((a) => a.id === id);
    assert.equal(after.ackState, ackState);
    assert.equal(after.reviewSince, reviewSince);
    assert.equal(after.needsInputSince, needsInputSince);
  });
});

test('a bad id and a missing id are refused, and nothing is looked up or raised', async () => {
  await withDaemon({}, async (d, _id, calls) => {
    const missing = await go(d, {});
    assert.equal(missing.status, 400);
    assert.match((await missing.json()).error, /id is required/);

    const unknown = await go(d, { id: 'claude-code:no-such-session' });
    assert.equal(unknown.status, 404);

    const junk = await go(d, { id: '../../etc/passwd; calc' });
    assert.equal(junk.status, 404);

    assert.equal((await fetch(d.url + 'api/session-target')).status, 400);
    assert.equal((await fetch(d.url + 'api/session-target?id=nope')).status, 404);

    const notJson = await fetch(d.url + 'api/go', { method: 'POST', body: '{' });
    assert.equal(notJson.status, 400);

    assert.deepEqual(calls, { table: [], focus: [] });
  });
});

test('a running session with no window: the button is dead and says why, and the click is a 409', async () => {
  const table = (pid) => ({
    processes: [{ pid, ppid: 1, name: 'claude.exe' }],
    windows: [],
    console: null,
  });
  await withDaemon({ table }, async (d, id, calls) => {
    const target = await (
      await fetch(`${d.url}api/session-target?id=${encodeURIComponent(id)}`)
    ).json();
    assert.equal(target.action, 'focus', 'it does not quietly become Resume');
    assert.equal(target.disabled, true);
    assert.match(target.detail, /no window on this desktop/);
    assert.equal(target.where, null);

    const out = await go(d, { id });
    assert.equal(out.status, 409);
    const body = await out.json();
    assert.equal(body.reason, 'no-window');
    assert.match(body.error, /no window on this desktop/);
    assert.equal(calls.focus.length, 0);
  });
});

test('a machine that cannot do it says so: no table is read and nothing is raised', async () => {
  const support = {
    supported: false,
    verified: false,
    how: '',
    reason: 'Wayland gives no program a way to raise another program’s window.',
  };
  await withDaemon({ support }, async (d, id, calls) => {
    const target = await (
      await fetch(`${d.url}api/session-target?id=${encodeURIComponent(id)}`)
    ).json();
    assert.equal(target.supported, false);
    assert.equal(target.disabled, true);
    assert.match(target.detail, /Wayland/);
    const out = await go(d, { id });
    assert.equal(out.status, 409);
    assert.equal((await out.json()).reason, 'unsupported');
    assert.deepEqual(calls, { table: [], focus: [] });
  });
});

test('a window that vanished between the look and the click is a 409 with the reason, after one fresh look', async () => {
  await withDaemon({ focusThrows: true }, async (d, id, calls) => {
    const out = await go(d, { id });
    assert.equal(out.status, 409);
    assert.match((await out.json()).error, /could not be raised: that window is gone/);
    assert.equal(calls.focus.length, 2, 'tried, looked again from a fresh table, tried once more');
    assert.equal(calls.table.length, 2);
  });
});

test('a machine that will not answer is a sentence, not a 500', async () => {
  await withDaemon({ tableThrows: true }, async (d, id) => {
    const target = await (
      await fetch(`${d.url}api/session-target?id=${encodeURIComponent(id)}`)
    ).json();
    assert.equal(target.disabled, true);
    assert.match(
      target.detail,
      /could not ask this machine where it is: powershell is not on this machine/,
    );
  });
});

test('a session whose process has ended: the same button is Resume, in the place the person chose', async () => {
  const opened = [];
  const real = claude.openInTerminal;
  // The one method that would open a real terminal window. Put back below.
  claude.openInTerminal = async (...args) => {
    opened.push(args);
  };
  try {
    await withDaemon({ pid: null }, async (d, id, calls) => {
      const target = await (
        await fetch(`${d.url}api/session-target?id=${encodeURIComponent(id)}`)
      ).json();
      assert.equal(target.action, 'resume');
      assert.equal(target.label, 'Resume in Windows Terminal');
      assert.equal(target.resumeTarget, 'terminal');
      assert.equal(target.disabled, false);

      const out = await go(d, { id });
      assert.equal(out.status, 200);
      const body = await out.json();
      assert.equal(body.did, 'resume');
      assert.equal(body.target, 'terminal');

      assert.equal(opened.length, 1);
      assert.equal(opened[0][0], SESSION, 'the session id travels as a value, not as a command');
      assert.deepEqual(
        calls,
        { table: [], focus: [] },
        'an ended session has no window to look for',
      );
    });
  } finally {
    claude.openInTerminal = real;
  }
});

test('SECURITY: a cross-site POST cannot raise a window', async () => {
  await withDaemon({}, async (d, id, calls) => {
    const evil = await go(d, { id }, { origin: 'https://evil.example.com' });
    assert.equal(evil.status, 403, 'a foreign Origin must be refused');

    const evilSite = await go(d, { id }, { 'sec-fetch-site': 'cross-site' });
    assert.equal(evilSite.status, 403, 'Sec-Fetch-Site: cross-site must be refused');

    assert.deepEqual(calls, { table: [], focus: [] }, 'refused before anything was looked up');

    const ours = await go(
      d,
      { id },
      { origin: d.url.replace(/\/$/, ''), 'sec-fetch-site': 'same-origin' },
    );
    assert.equal(ours.status, 200, 'our own page is not blocked');
    assert.equal(calls.focus.length, 1);
  });
});
