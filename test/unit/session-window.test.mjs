/**
 * WP-100 · which window a running session is in, and what the one button says.
 *
 * `resolveSessionWindow()` is a pure function of a process table and a list of
 * windows, so every rule in it is asserted here against a table written out by
 * hand. The tables are not invented: each one is the SHAPE that was read off a
 * Windows 11 machine on 8 October with `src/core/focus.ps1 -Action table`,
 * with the pids changed — a tab Windows Terminal started, a tab Windows handed
 * it, a classic console, the Claude desktop app.
 *
 * Nothing in this file spawns a process or touches a window. The runner's own
 * `exec` is replaced, so the argv it would have run is what is asserted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  describeOutcome,
  describeTarget,
  goToPlan,
  hostFor,
  resolveSessionWindow,
} from '../../src/core/session-window.mjs';
import {
  FOCUS_SCRIPT,
  createFocusRunner,
  focusCommand,
  focusSupport,
  intArg,
  macFocusCommand,
  parsePsTable,
  parseWmctrl,
} from '../../src/core/session-focus.mjs';

const p = (pid, ppid, name, extra = {}) => ({ pid, ppid, name, ...extra });
const w = (hwnd, pid, title, windowClass = 'Chrome_WidgetWin_1') => ({
  hwnd,
  pid,
  title,
  windowClass,
});

// ------------------------------------------------------------ the resolution

test('a tab Windows Terminal started itself: the walk upward arrives at the terminal', () => {
  const table = {
    processes: [
      p(100, 1, 'WindowsTerminal.exe'),
      p(200, 100, 'powershell.exe'),
      p(300, 200, 'claude.exe'),
      p(301, 300, 'conhost.exe'),
    ],
    windows: [w(9001, 100, 'fix the parser', 'CASCADIA_HOSTING_WINDOW_CLASS')],
    console: null,
  };
  const t = resolveSessionWindow({ pid: 300, table });
  assert.equal(t.ok, true);
  assert.equal(t.kind, 'terminal');
  assert.equal(t.label, 'Windows Terminal');
  assert.equal(t.hwnd, 9001);
  assert.equal(t.hostPid, 100);
  assert.equal(t.via, 'ancestor');
  assert.equal(t.exact, true);
  assert.equal(t.tabbed, true);
  assert.equal(t.sessionPid, 300);
});

test('a tab Windows HANDED to the terminal: the shell’s parent is not the terminal, and the console says where it is', () => {
  // Measured: PowerShell opened from Start with Windows Terminal as the
  // default terminal. Its parent is whatever launched it — here a process
  // that has already exited — so the walk finds nothing at all.
  const table = {
    processes: [
      p(100, 1, 'WindowsTerminal.exe'),
      p(200, 4242, 'powershell.exe'),
      p(300, 200, 'claude.exe'),
    ],
    windows: [
      w(9001, 100, 'another tab', 'CASCADIA_HOSTING_WINDOW_CLASS'),
      w(9002, 100, 'Windows PowerShell', 'CASCADIA_HOSTING_WINDOW_CLASS'),
    ],
    console: {
      hwnd: 77,
      root: 9002,
      pid: 100,
      windowClass: 'CASCADIA_HOSTING_WINDOW_CLASS',
      title: 'Windows PowerShell',
    },
  };
  const t = resolveSessionWindow({ pid: 300, table });
  assert.equal(t.ok, true);
  assert.equal(t.label, 'Windows Terminal');
  assert.equal(t.hwnd, 9002, 'the window the console is hosted in, not the first one');
  assert.equal(t.via, 'console');
  assert.equal(t.exact, true);
  assert.equal(t.tabTitle, 'Windows PowerShell');

  // Without the console's answer the same table has no answer, and says so
  // rather than taking a window that merely exists.
  const blind = resolveSessionWindow({ pid: 300, table: { ...table, console: null } });
  assert.equal(blind.ok, false);
  assert.equal(blind.reason, 'no-window');
});

test('one terminal process, several windows: the console picks the window the walk cannot', () => {
  const table = {
    processes: [p(100, 1, 'WindowsTerminal.exe'), p(200, 100, 'pwsh.exe'), p(300, 200, 'node.exe')],
    windows: [
      w(9001, 100, 'front window', 'CASCADIA_HOSTING_WINDOW_CLASS'),
      w(9002, 100, 'the right one', 'CASCADIA_HOSTING_WINDOW_CLASS'),
    ],
    console: { hwnd: 78, root: 9002, pid: 100, title: 'the right one' },
  };
  assert.equal(resolveSessionWindow({ pid: 300, table }).hwnd, 9002);

  // The walk alone takes the front one and admits it guessed.
  const guessed = resolveSessionWindow({ pid: 300, table: { ...table, console: null } });
  assert.equal(guessed.hwnd, 9001);
  assert.equal(guessed.exact, false);
});

test('a classic console: the window belongs to the shell, and is called what it is', () => {
  // Measured: a `ConsoleWindowClass` window reports the SHELL as its owner,
  // not conhost.exe.
  const table = {
    processes: [p(50, 1, 'conhost.exe'), p(200, 50, 'cmd.exe'), p(300, 200, 'claude.exe')],
    windows: [w(4654540, 200, 'C:\\Windows\\system32\\cmd.exe', 'ConsoleWindowClass')],
    console: {
      hwnd: 4654540,
      root: 4654540,
      pid: 200,
      windowClass: 'ConsoleWindowClass',
      title: 'x',
    },
  };
  const t = resolveSessionWindow({ pid: 300, table });
  assert.equal(t.kind, 'console');
  assert.equal(t.label, 'a Command Prompt window');
  assert.equal(t.tabbed, false);
  assert.equal(t.tabTitle, '', 'a console has no tabs, so no tab is named');

  const ps = resolveSessionWindow({
    pid: 300,
    table: { ...table, processes: [p(200, 1, 'powershell.exe'), p(300, 200, 'claude.exe')] },
  });
  assert.equal(ps.label, 'a PowerShell window');
});

test('a session in the Claude desktop app: its parent is the app, which owns the one window', () => {
  // Measured: the session is `claude.exe` and so is the app. Only one of
  // them has a window, which is what tells them apart.
  const table = {
    processes: [
      p(39472, 1, 'claude.exe'),
      p(18048, 39472, 'claude.exe'),
      p(29240, 18048, 'conhost.exe'),
    ],
    windows: [w(264110, 39472, 'Claude')],
    console: null,
  };
  const t = resolveSessionWindow({ pid: 18048, table });
  assert.equal(t.ok, true);
  assert.equal(t.kind, 'app');
  assert.equal(t.label, 'the Claude desktop app');
  assert.equal(t.hostPid, 39472);
  assert.equal(t.hwnd, 264110);
});

test('an editor with several windows: the one titled with the session’s folder is taken', () => {
  const table = {
    processes: [
      p(10, 1, 'Code.exe'),
      p(11, 10, 'Code.exe'),
      p(12, 11, 'powershell.exe'),
      p(13, 12, 'claude.exe'),
    ],
    windows: [
      w(1, 10, 'notes.md - scratch - Visual Studio Code'),
      w(2, 10, 'panel.js - DeckHQ - Visual Studio Code'),
    ],
    // An editor's terminal is a pseudoconsole nobody owns: the console
    // answers with a hidden window that is not in the list.
    console: { hwnd: 555, root: 555, pid: 12, windowClass: 'PseudoConsoleWindow', title: 'pwsh' },
  };
  const t = resolveSessionWindow({ pid: 13, table, cwd: 'C:\\Dk\\Projects\\DeckHQ' });
  assert.equal(t.kind, 'editor');
  assert.equal(t.label, 'VS Code');
  assert.equal(t.hwnd, 2);
  assert.equal(t.exact, true);
  assert.equal(t.via, 'ancestor');

  // No folder to go on: the front window, and it says it guessed.
  const guessed = resolveSessionWindow({ pid: 13, table, cwd: '' });
  assert.equal(guessed.hwnd, 1);
  assert.equal(guessed.exact, false);
});

test('the walk stops at the desktop: a folder window is never "the session"', () => {
  const table = {
    processes: [p(5, 1, 'explorer.exe'), p(200, 5, 'cmd.exe'), p(300, 200, 'claude.exe')],
    windows: [w(1, 5, 'Projects - File Explorer', 'CabinetWClass')],
    console: null,
  };
  const t = resolveSessionWindow({ pid: 300, table });
  assert.equal(t.ok, false);
  assert.equal(t.reason, 'no-window');
  assert.match(t.message, /no window/i);
});

test('a turn DeckHQ is running itself has no window, and the terminal deckhq was started in is not it', () => {
  const table = {
    processes: [
      p(100, 1, 'WindowsTerminal.exe'),
      p(200, 100, 'powershell.exe'),
      p(777, 200, 'node.exe'), // the daemon
      p(300, 777, 'claude.exe'), // `claude -p --resume`, spawned by a send
    ],
    windows: [w(9001, 100, 'deckhq', 'CASCADIA_HOSTING_WINDOW_CLASS')],
    console: null,
  };
  const t = resolveSessionWindow({ pid: 300, table, selfPid: 777 });
  assert.equal(t.ok, false);
  assert.equal(t.reason, 'headless');
  // Without that rule the walk would have arrived, confidently, at 9001.
  assert.equal(resolveSessionWindow({ pid: 300, table }).hwnd, 9001);
});

test('a process that has ended, and a table that loops, both answer without hanging', () => {
  assert.equal(
    resolveSessionWindow({ pid: 1, table: { processes: [], windows: [] } }).reason,
    'gone',
  );
  const loop = {
    processes: [p(1, 2, 'a.exe'), p(2, 1, 'b.exe')],
    windows: [],
    console: null,
  };
  assert.equal(resolveSessionWindow({ pid: 1, table: loop }).reason, 'no-window');
});

test('a program nobody listed still counts if it has a window, and is called by its own name', () => {
  const table = {
    processes: [p(10, 1, 'SomeTerm.exe'), p(11, 10, 'bash.exe'), p(12, 11, 'claude.exe')],
    windows: [w(1, 10, 'bash', 'SomeTermClass')],
    console: null,
  };
  const t = resolveSessionWindow({ pid: 12, table });
  assert.equal(t.kind, 'window');
  assert.equal(t.label, 'SomeTerm');
});

test('with no list of windows (macOS) only an application bundle counts, and the CLI is not the app', () => {
  // `claude` the command and `Claude` the app have one name. Only a process
  // inside a bundle is a windowed program.
  const cli = {
    processes: [
      p(1, 0, 'launchd'),
      p(10, 1, 'iTerm', { app: true }),
      p(11, 10, 'zsh'),
      p(12, 11, 'claude'),
    ],
    windows: null,
  };
  const t = resolveSessionWindow({ pid: 12, table: cli });
  assert.equal(t.ok, true);
  assert.equal(t.label, 'iTerm');
  assert.equal(t.hostPid, 10);
  assert.equal(t.hwnd, null);

  // An editor's helper is the editor: the OUTERMOST process of the bundle.
  const editor = {
    processes: [
      p(1, 0, 'launchd'),
      p(20, 1, 'Visual Studio Code', { app: true }),
      p(21, 20, 'Visual Studio Code', { app: true }),
      p(22, 21, 'zsh'),
      p(23, 22, 'claude'),
    ],
    windows: null,
  };
  assert.equal(resolveSessionWindow({ pid: 23, table: editor }).hostPid, 20);

  const nothing = {
    processes: [p(1, 0, 'launchd'), p(11, 1, 'zsh'), p(12, 11, 'claude')],
    windows: null,
  };
  assert.equal(resolveSessionWindow({ pid: 12, table: nothing }).reason, 'no-window');
});

test('the catalogue matches an image name whatever its case and with or without .exe', () => {
  assert.equal(hostFor('WINDOWSTERMINAL.EXE').label, 'Windows Terminal');
  assert.equal(hostFor('Code.exe').kind, 'editor');
  assert.equal(hostFor('idea64.exe').label, 'a JetBrains IDE');
  assert.equal(hostFor('wezterm-gui').label, 'WezTerm');
  assert.equal(hostFor('explorer.exe'), null);
  assert.equal(hostFor(''), null);
});

// ------------------------------------------------------------------ the label

const RESUME = { preference: 'terminal', appAvailable: false, terminalLabel: 'Windows Terminal' };
const SUPPORTED = { supported: true };
const TARGET = resolveSessionWindow({
  pid: 300,
  table: {
    processes: [p(100, 1, 'WindowsTerminal.exe'), p(300, 100, 'claude.exe')],
    windows: [w(9001, 100, 'fix the parser', 'CASCADIA_HOSTING_WINDOW_CLASS')],
    console: { hwnd: 7, root: 9001, pid: 100, title: 'fix the parser' },
  },
});

test('LABEL: a running session is gone to; an ended one is resumed where the person chose', () => {
  const running = goToPlan({
    agent: { live: true },
    pid: 300,
    reportsPid: true,
    runtimeLabel: 'Claude Code',
    support: SUPPORTED,
    target: TARGET,
    resume: RESUME,
  });
  assert.equal(running.action, 'focus');
  assert.equal(running.label, 'Go to session');
  assert.equal(running.disabled, false);
  assert.equal(running.detail, 'Windows Terminal — tab “fix the parser”');

  const ended = goToPlan({
    agent: { live: false },
    pid: null,
    reportsPid: true,
    runtimeLabel: 'Claude Code',
    support: SUPPORTED,
    target: null,
    resume: RESUME,
  });
  assert.equal(ended.action, 'resume');
  assert.equal(ended.label, 'Resume in Windows Terminal');
  assert.equal(ended.resumeTarget, 'terminal');
  assert.equal(ended.disabled, false);

  const inApp = goToPlan({
    agent: { live: false },
    pid: null,
    reportsPid: true,
    runtimeLabel: 'Claude Code',
    support: SUPPORTED,
    target: null,
    resume: { preference: 'app', appAvailable: true, terminalLabel: 'Windows Terminal' },
  });
  assert.equal(inApp.label, 'Resume in the desktop app');
  assert.equal(inApp.resumeTarget, 'app');
});

test('LABEL: a running session that cannot be reached is NOT quietly resumed', () => {
  // The whole point of the button: a second `--resume` of a live session is
  // two processes on one transcript. So the button stays "Go to session",
  // goes dead, and says why.
  const noWindow = goToPlan({
    agent: { live: true },
    pid: 300,
    reportsPid: true,
    runtimeLabel: 'Claude Code',
    support: SUPPORTED,
    target: { ok: false, reason: 'no-window', message: 'It is running, but no window…' },
    resume: RESUME,
  });
  assert.equal(noWindow.action, 'focus');
  assert.equal(noWindow.label, 'Go to session');
  assert.equal(noWindow.disabled, true);
  assert.equal(noWindow.detail, 'It is running, but no window…');

  const unsupported = goToPlan({
    agent: { live: true },
    pid: 300,
    reportsPid: true,
    runtimeLabel: 'Claude Code',
    support: { supported: false, reason: 'Wayland gives no program a way…' },
    target: null,
    resume: RESUME,
  });
  assert.equal(unsupported.action, 'focus');
  assert.equal(unsupported.disabled, true);
  assert.equal(unsupported.detail, 'Wayland gives no program a way…');

  const notYet = goToPlan({
    agent: { live: true },
    pid: null,
    reportsPid: true,
    runtimeLabel: 'Claude Code',
    support: SUPPORTED,
    target: null,
    resume: RESUME,
  });
  assert.equal(notYet.action, 'focus');
  assert.equal(notYet.disabled, true);
  assert.match(notYet.detail, /has not been told its process yet/);
});

test('LABEL: a runtime that never names a process gets Resume, and the line under it says why', () => {
  const codex = goToPlan({
    agent: { live: true },
    pid: null,
    reportsPid: false,
    runtimeLabel: 'Codex',
    support: SUPPORTED,
    target: null,
    resume: RESUME,
  });
  assert.equal(codex.action, 'resume');
  assert.equal(codex.label, 'Resume in Windows Terminal');
  assert.match(codex.detail, /Codex does not say which process/);
});

test('LABEL: the app is not promised for a session the app cannot open', () => {
  const plan = goToPlan({
    agent: { live: false },
    pid: null,
    reportsPid: true,
    runtimeLabel: 'Claude Code',
    support: SUPPORTED,
    target: null,
    resume: { preference: 'app', appAvailable: false, terminalLabel: null },
  });
  assert.equal(plan.label, 'Resume in a terminal');
  assert.equal(plan.resumeTarget, 'terminal');
  assert.match(plan.detail, /cannot open this session/);
});

test('a guessed window is admitted in the line under the button', () => {
  const plan = goToPlan({
    agent: { live: true },
    pid: 300,
    reportsPid: true,
    runtimeLabel: 'Claude Code',
    support: SUPPORTED,
    target: { ...TARGET, exact: false },
    resume: RESUME,
  });
  assert.match(plan.detail, /several windows; the front one is raised/);
});

// --------------------------------------------------------------- what is said

test('what the person is told afterwards is what was read back, not what was hoped', () => {
  assert.equal(describeTarget(TARGET), 'Windows Terminal — tab “fix the parser”');

  assert.equal(
    describeOutcome(TARGET, { foreground: true, tab: 'selected', tabs: 3 }),
    'Windows Terminal is in front, on this session’s tab.',
  );
  assert.match(
    describeOutcome(TARGET, { foreground: false, flashed: true, tab: 'none' }),
    /would not let DeckHQ bring Windows Terminal forward — its taskbar button is flashing/,
  );
  assert.match(
    describeOutcome(TARGET, { foreground: true, tab: 'ambiguous', tabs: 4, tabTitle: 'node' }),
    /4 tabs there, and more than one is called “node”/,
  );
  assert.match(
    describeOutcome(TARGET, { foreground: true, tab: 'unmatched', tabs: 2, tabTitle: 'pwsh' }),
    /could not be picked out of 2; the session’s own title is “pwsh”/,
  );
  // A platform that cannot be asked claims nothing.
  assert.match(describeOutcome(TARGET, { foreground: null }), /was asked to come forward/);

  const app = { ...TARGET, kind: 'app', label: 'the Claude desktop app', tabbed: false };
  assert.equal(
    describeOutcome(app, { foreground: true, opened: true }),
    'The Claude desktop app is in front, on this session.',
  );
  assert.match(describeOutcome(app, { foreground: true, opened: false }), /not one the app lists/);
});

// ------------------------------------------------------------------ the argv

test('SECURITY: the script is run with -File and the only values are numbers this module wrote', () => {
  const table = focusCommand('table', { pid: 4242 });
  assert.equal(table.command, 'powershell.exe');
  assert.deepEqual(table.args, [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    FOCUS_SCRIPT,
    '-Action',
    'table',
    '-ProcessId',
    '4242',
  ]);
  assert.ok(!table.args.includes('-Command'));

  const focus = focusCommand('focus', { hwnd: 9001, pid: 100, consolePid: 300 });
  assert.deepEqual(focus.args.slice(6), [
    '-Action',
    'focus',
    '-Hwnd',
    '9001',
    '-ProcessId',
    '100',
    '-ConsolePid',
    '300',
  ]);

  // Anything that is not a positive whole number never reaches a command line.
  for (const bad of ['1; calc', '0', -1, 1.5, NaN, '', null, '9001 -Action table']) {
    assert.throws(() => intArg(bad, 'hwnd'), /positive whole number/, String(bad));
  }
  assert.throws(() => focusCommand('focus', { hwnd: '1 & calc', pid: 1 }));
  assert.throws(() => focusCommand('focus', { hwnd: 1, pid: '$(calc)' }));

  const mac = macFocusCommand(4242);
  assert.equal(mac.command, 'osascript');
  assert.equal(mac.args[mac.args.length - 1], '4242');
  assert.ok(
    mac.args.slice(0, -1).every((a) => !a.includes('4242')),
    'the pid is an argument, never part of the script text',
  );
});

test('the runner hands the script exactly that argv, and never a real process in a test', async () => {
  const calls = [];
  const exec = (command, args, _opts, cb) => {
    calls.push({ command, args });
    const action = args[args.indexOf('-Action') + 1];
    cb(
      null,
      action === 'table'
        ? JSON.stringify({
            processes: [p(1, 0, 'a.exe')],
            windows: [],
            foreground: 0,
            console: null,
          })
        : JSON.stringify({
            ok: true,
            foreground: true,
            restored: false,
            flashed: false,
            tab: 'selected',
            tabs: 2,
            tabTitle: 't',
          }),
      '',
    );
  };
  const runner = createFocusRunner({ platform: 'win32', exec });
  assert.equal((await runner.support()).supported, true);
  const table = await runner.table(300);
  assert.equal(table.processes.length, 1);
  assert.deepEqual(table.windows, []);

  const out = await runner.focus({ ...TARGET, kind: 'terminal', tabbed: true });
  assert.equal(out.foreground, true);
  assert.equal(out.tab, 'selected');
  assert.ok(calls[1].args.includes('-ConsolePid'), 'a tabbed terminal is asked to pick the tab');

  // An editor's terminals are not picked by console title.
  await runner.focus({ ...TARGET, kind: 'editor', tabbed: true });
  assert.ok(!calls[2].args.includes('-ConsolePid'));

  // A failure is the script's own sentence, not a stack.
  const failing = createFocusRunner({
    platform: 'win32',
    exec: (_c, _a, _o, cb) => cb(new Error('exit 1'), '', 'that window is gone\r\n'),
  });
  await assert.rejects(() => failing.focus(TARGET), /^Error: that window is gone$/);
});

test('macOS and Linux: the tables parse, and the support line says what was never run', async () => {
  const ps = parsePsTable(
    [
      '    1     0 /sbin/launchd',
      '  501     1 /Applications/iTerm.app/Contents/MacOS/iTerm2',
      '  777   501 /Applications/Visual Studio Code.app/Contents/Frameworks/Code Helper.app/Contents/MacOS/Code Helper',
      '  900   501 -zsh',
      '  901   900 claude',
    ].join('\n'),
  );
  assert.deepEqual(ps[1], { pid: 501, ppid: 1, name: 'iTerm', app: true });
  assert.equal(ps[2].name, 'Visual Studio Code', 'the outermost bundle names a helper');
  assert.deepEqual(ps[4], { pid: 901, ppid: 900, name: 'claude' });

  const wins = parseWmctrl(
    [
      '0x03800003  0 4242   host Terminal — fix the parser',
      '0x01000001 -1 0      host Desktop',
    ].join('\n'),
  );
  assert.deepEqual(wins, [{ hwnd: '0x03800003', pid: 4242, title: 'Terminal — fix the parser' }]);

  assert.deepEqual(
    [focusSupport({ platform: 'win32' }).supported, focusSupport({ platform: 'win32' }).verified],
    [true, true],
  );
  const mac = focusSupport({ platform: 'darwin' });
  assert.equal(mac.supported, true);
  assert.equal(mac.verified, false);
  assert.match(mac.how, /never run on a Mac/);

  const wayland = focusSupport({ platform: 'linux', env: { WAYLAND_DISPLAY: 'wayland-0' } });
  assert.equal(wayland.supported, false);
  assert.match(wayland.reason, /Wayland/);

  const bare = focusSupport({ platform: 'linux', env: { DISPLAY: ':0' }, hasWmctrl: false });
  assert.equal(bare.supported, false);
  assert.match(bare.reason, /wmctrl/);

  const x11 = focusSupport({ platform: 'linux', env: { DISPLAY: ':0' }, hasWmctrl: true });
  assert.equal(x11.supported, true);
  assert.equal(x11.verified, false);

  // The Linux runner raises by the id `wmctrl` printed, and nothing else.
  const calls = [];
  const linux = createFocusRunner({
    platform: 'linux',
    env: { DISPLAY: ':0' },
    exec: (command, args, _o, cb) => {
      calls.push([command, ...args]);
      cb(null, '', '');
    },
  });
  await linux.focus({ ...TARGET, hwnd: '0x03800003' });
  assert.deepEqual(calls[0], ['wmctrl', '-ia', '0x03800003']);
  await assert.rejects(() => linux.focus({ ...TARGET, hwnd: '0x1; rm -rf ~' }), /not a window id/);
});
