/**
 * The warm window helper: one PowerShell, started once, asked many times.
 *
 * Going to a session used to start PowerShell and compile the helper twice per
 * click, 1.1 to 1.5 s each (measured 25 October 2026). These drive the helper
 * against a fake process, so no test starts PowerShell or raises a window.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  createWarmHelper,
  createFocusRunner,
  serveCommand,
  FOCUS_SCRIPT,
} from '../../src/core/session-focus.mjs';

/**
 * A stand-in for the PowerShell process. `answer(line)` decides each reply;
 * `null` from it means the process says nothing.
 * @param {(line:string) => string|null} answer
 */
function fakeSpawn(answer) {
  const started = [];
  const spawn = (command, args) => {
    const proc = new EventEmitter();
    const stdout = new EventEmitter();
    stdout.setEncoding = () => {};
    proc.stdout = stdout;
    proc.lines = [];
    proc.killed = false;
    proc.stdin = {
      write(text) {
        for (const line of text.split('\n').filter(Boolean)) {
          proc.lines.push(line);
          const reply = answer(line);
          if (reply !== null) setImmediate(() => stdout.emit('data', `${reply}\r\n`));
        }
      },
      end() {},
    };
    proc.kill = () => {
      proc.killed = true;
    };
    proc.unref = () => {};
    started.push({ command, args, proc });
    setImmediate(() => stdout.emit('data', '{"ready":true}\n'));
    return proc;
  };
  return { spawn, started };
}

const TABLE = '{"processes":[{"pid":1,"ppid":0,"name":"a"}],"windows":[],"console":null}';

test('the helper starts once and answers every question in order', async () => {
  const { spawn, started } = fakeSpawn((line) => `{"ok":true,"echo":"${line}"}`);
  const warm = createWarmHelper(serveCommand('ps.exe'), { spawn, idleMs: 60_000 });
  const answers = await Promise.all([
    warm.ask('table 0'),
    warm.ask('table 7'),
    warm.ask('focus 1 2 0'),
  ]);
  assert.equal(started.length, 1, 'one PowerShell for three questions');
  assert.deepEqual(
    answers.map((a) => JSON.parse(a).echo),
    ['table 0', 'table 7', 'focus 1 2 0'],
  );
  warm.stop();
});

test('its argv is the fixed script and the fixed word, and nothing else', () => {
  assert.deepEqual(serveCommand('ps.exe'), {
    command: 'ps.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      FOCUS_SCRIPT,
      '-Action',
      'serve',
    ],
  });
});

test('a helper that stops answering is ended and the next question starts a new one', async () => {
  let silent = true;
  const { spawn, started } = fakeSpawn(() => (silent ? null : TABLE));
  const warm = createWarmHelper(serveCommand('ps.exe'), { spawn, timeoutMs: 20 });
  await assert.rejects(warm.ask('table 0'), /did not answer/);
  assert.equal(started[0].proc.killed, true, 'a helper in an unknown state is not reused');
  silent = false;
  assert.equal(await warm.ask('table 0'), TABLE);
  assert.equal(started.length, 2);
  warm.stop();
});

test('an idle helper is let go', async () => {
  const { spawn, started } = fakeSpawn(() => TABLE);
  const warm = createWarmHelper(serveCommand('ps.exe'), { spawn, idleMs: 10 });
  await warm.ask('table 0');
  assert.equal(warm.running(), true);
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(warm.running(), false);
  assert.equal(started[0].proc.killed, true);
});

test('the runner asks the warm helper, in numbers only, and never starts a one-shot', async () => {
  const asked = [];
  const warm = {
    async ask(line) {
      asked.push(line);
      return line.startsWith('table')
        ? TABLE
        : '{"ok":true,"foreground":true,"restored":false,"flashed":false,"tab":"none","tabs":0}';
    },
  };
  const exec = () => assert.fail('no one-shot PowerShell while the warm helper answers');
  const runner = createFocusRunner({ platform: 'win32', exec, warm });
  const table = await runner.table(300);
  assert.equal(table.processes.length, 1);
  const done = await runner.focus({
    hwnd: 42,
    hostPid: 9,
    kind: 'app',
    tabbed: false,
    sessionPid: 300,
  });
  assert.equal(done.foreground, true);
  assert.deepEqual(asked, ['table 300', 'focus 42 9 0']);
});

test('a window the helper refuses is an answer, not a reason to ask again in a one-shot', async () => {
  const warm = { ask: async () => '{"ok":false,"error":"that window is gone"}' };
  const exec = () => assert.fail('a refusal is not retried in a one-shot');
  const runner = createFocusRunner({ platform: 'win32', exec, warm });
  await assert.rejects(
    runner.focus({ hwnd: 42, hostPid: 9, kind: 'app', tabbed: false, sessionPid: 300 }),
    /that window is gone/,
  );
});

test('a broken helper falls back to the one-shot run it replaced', async () => {
  const warm = { ask: async () => Promise.reject(new Error('the window helper stopped')) };
  const calls = [];
  const exec = (command, args, opts, cb) => {
    calls.push(args);
    cb(null, TABLE, '');
  };
  const runner = createFocusRunner({ platform: 'win32', exec, warm, powershell: 'ps.exe' });
  const table = await runner.table(300);
  assert.equal(table.processes.length, 1);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(-4), ['-Action', 'table', '-ProcessId', '300']);
});

test('a runner given a stubbed exec and no helper starts none', async () => {
  const calls = [];
  const exec = (command, args, opts, cb) => {
    calls.push(args);
    cb(null, TABLE, '');
  };
  const runner = createFocusRunner({ platform: 'win32', exec, powershell: 'ps.exe' });
  await runner.table(300);
  assert.equal(calls.length, 1, 'the one-shot, exactly as before');
});
