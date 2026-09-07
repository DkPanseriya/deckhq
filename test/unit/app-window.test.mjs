/**
 * `deckhq app` — WP-62. The window's argv on each platform, the daemon it
 * reuses rather than duplicating, and the one URL it is allowed to open.
 *
 * Every platform is injected. Nothing here spawns a browser or a daemon: the
 * command's two side effects are `spawn()` calls, and both are asserted as
 * argv arrays, which is the discipline `docs/DEVIATIONS.md` §91 and §98 exist
 * to enforce.
 */
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

const {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  appProfileDir,
  appWindowCommand,
  defaultBrowserCommand,
  isLoopbackUrl,
  macAppBundle,
} = await import('../../src/core/app-window.mjs');

const { BIN, candidateAppPorts, findRunningDaemon, planOpen, runApp, startDetachedDaemon } =
  await import('../../src/cli/app.mjs');

const URL_4317 = 'http://127.0.0.1:4317/';
const PROFILE = '/state/app-profile';

// ---------------------------------------------------------------------------
// The argv, per platform
// ---------------------------------------------------------------------------

test('SECURITY: the Windows app window is one argv array, no shell', () => {
  const cmd = appWindowCommand({
    platform: 'win32',
    browser: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    url: URL_4317,
    profileDir: 'C:/Users/x/.deckhq/app-profile',
  });
  assert.deepEqual(cmd, {
    command: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args: [
      '--app=http://127.0.0.1:4317/',
      '--window-size=1600,1000',
      '--user-data-dir=C:/Users/x/.deckhq/app-profile',
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
});

test('the Linux app window is the same array against a different binary', () => {
  const cmd = appWindowCommand({
    platform: 'linux',
    browser: '/usr/bin/google-chrome',
    url: URL_4317,
    profileDir: PROFILE,
  });
  assert.equal(cmd.command, '/usr/bin/google-chrome');
  assert.deepEqual(cmd.args, [
    '--app=http://127.0.0.1:4317/',
    '--window-size=1600,1000',
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
  ]);
});

test('DOCS-ONLY (never run on a Mac): macOS is `open -na <bundle> --args`', () => {
  const cmd = appWindowCommand({
    platform: 'darwin',
    browser: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    url: URL_4317,
    profileDir: PROFILE,
  });
  assert.deepEqual(cmd, {
    command: 'open',
    args: [
      '-na',
      '/Applications/Google Chrome.app',
      '--args',
      '--app=http://127.0.0.1:4317/',
      '--window-size=1600,1000',
      `--user-data-dir=${PROFILE}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
});

test('a macOS binary outside a bundle is spawned directly', () => {
  const cmd = appWindowCommand({
    platform: 'darwin',
    browser: '/opt/homebrew/bin/chromium',
    url: URL_4317,
    profileDir: PROFILE,
  });
  assert.equal(cmd.command, '/opt/homebrew/bin/chromium');
  assert.equal(cmd.args[0], '--app=http://127.0.0.1:4317/');
});

test('macAppBundle keeps the bundle and drops the executable', () => {
  assert.equal(
    macAppBundle('/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
    '/Applications/Microsoft Edge.app',
  );
  assert.equal(macAppBundle('/usr/bin/google-chrome'), null);
  assert.equal(macAppBundle(''), null);
});

test('an unknown platform, or a missing browser or url, plans nothing', () => {
  assert.equal(
    appWindowCommand({ platform: 'aix', browser: '/x', url: URL_4317, profileDir: PROFILE }),
    null,
  );
  assert.equal(
    appWindowCommand({ platform: 'win32', browser: '', url: URL_4317, profileDir: PROFILE }),
    null,
  );
  assert.equal(
    appWindowCommand({ platform: 'win32', browser: '/x', url: '', profileDir: PROFILE }),
    null,
  );
});

test('the size is only ever two integers', () => {
  const cmd = appWindowCommand({
    platform: 'linux',
    browser: '/usr/bin/chromium',
    url: URL_4317,
    profileDir: PROFILE,
    width: 900.7,
    height: 700.2,
  });
  assert.equal(cmd.args[1], '--window-size=900,700');
  assert.equal(DEFAULT_WIDTH, 1600);
  assert.equal(DEFAULT_HEIGHT, 1000);
});

test('the profile is under the state dir, never beside the user own browsing', () => {
  assert.equal(appProfileDir('/home/x/.deckhq'), path.join('/home/x/.deckhq', 'app-profile'));
});

test('the default-browser fallback is the same three commands the daemon uses', () => {
  assert.deepEqual(defaultBrowserCommand({ platform: 'win32', url: URL_4317 }), {
    command: 'cmd',
    args: ['/c', 'start', '', URL_4317],
  });
  assert.deepEqual(defaultBrowserCommand({ platform: 'darwin', url: URL_4317 }), {
    command: 'open',
    args: [URL_4317],
  });
  assert.deepEqual(defaultBrowserCommand({ platform: 'linux', url: URL_4317 }), {
    command: 'xdg-open',
    args: [URL_4317],
  });
});

test('SECURITY: only loopback is ever a URL this command will open', () => {
  assert.equal(isLoopbackUrl('http://127.0.0.1:4317/'), true);
  assert.equal(isLoopbackUrl('http://localhost:4317/'), true);
  assert.equal(isLoopbackUrl('http://192.168.1.9:4317/'), false);
  assert.equal(isLoopbackUrl('https://deckhq.dev/'), false);
  assert.equal(isLoopbackUrl('not a url'), false);
});

// ---------------------------------------------------------------------------
// Which port is asked, and in what order
// ---------------------------------------------------------------------------

test('the port the user named is asked first, then daemon.json, then the hooks', () => {
  const ports = candidateAppPorts({ explicit: 4400, published: 4501, hooks: [4600], span: 3 });
  assert.deepEqual(ports, [4400, 4501, 4600, 4317, 4318, 4319]);
});

test('no duplicates, and nothing outside a legal port', () => {
  assert.deepEqual(candidateAppPorts({ explicit: 4317, published: 4317, span: 2 }), [4317, 4318]);
  assert.deepEqual(candidateAppPorts({ explicit: 0, published: 99999, span: 1 }), [4317]);
});

test('a daemon that answers is reused, and nothing is started', async () => {
  const asked = [];
  const found = await findRunningDaemon({
    ports: [4400, 4317],
    probe: async (p) => p === 4317,
    ask: async (p) => {
      asked.push(p);
      return { port: p, snapshot: { agents: [], counts: {} } };
    },
  });
  assert.deepEqual(found, { port: 4317, url: URL_4317 });
  assert.deepEqual(asked, [4317], 'only the listening port is spoken HTTP to');
});

test('a listening stranger that is not a DeckHQ is not a daemon', async () => {
  const found = await findRunningDaemon({
    ports: [4317],
    probe: async () => true,
    ask: async () => null,
  });
  assert.equal(found, null);
});

// ---------------------------------------------------------------------------
// Starting one, when none answers
// ---------------------------------------------------------------------------

/** A `spawn` that records its call and returns something `unref`-able. */
function recordingSpawn(calls, pid = 4242) {
  return (command, args, options) => {
    calls.push({ command, args, options });
    return { pid, unref() {} };
  };
}

test('the spawned daemon is detached, silent, and told not to open a browser', async () => {
  const calls = [];
  let asked = 0;
  const result = await startDetachedDaemon({
    spawnFn: recordingSpawn(calls),
    node: '/usr/bin/node',
    bin: '/pkg/bin/deckhq.mjs',
    find: async () => (++asked >= 2 ? { port: 4318, url: 'http://127.0.0.1:4318/' } : null),
    sleep: async () => {},
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, '/usr/bin/node');
  assert.deepEqual(calls[0].args, ['/pkg/bin/deckhq.mjs', '--no-open']);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.stdio, 'ignore');
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(result.port, 4318, 'the port the daemon actually bound, not the one we guessed');
  assert.equal(result.started, true);
  assert.equal(result.timedOut, false);
  assert.equal(result.pid, 4242);
});

test('an explicit port is passed through to the daemon it starts', async () => {
  const calls = [];
  await startDetachedDaemon({
    spawnFn: recordingSpawn(calls),
    port: 4400,
    find: async () => ({ port: 4400, url: 'http://127.0.0.1:4400/' }),
    sleep: async () => {},
  });
  assert.deepEqual(calls[0].args.slice(1), ['--no-open', '--port', '4400']);
});

test('the wait is bounded, and a daemon that never answers is reported not killed', async () => {
  const calls = [];
  let clock = 0;
  const result = await startDetachedDaemon({
    spawnFn: recordingSpawn(calls, 77),
    find: async () => null,
    now: () => (clock += 3000),
    sleep: async () => {},
    timeoutMs: 10_000,
  });
  assert.equal(result.timedOut, true);
  assert.equal(result.pid, 77);
  assert.equal(calls.length, 1, 'nothing was spawned to kill it');
});

test('bin/deckhq.mjs is resolved from the package, not from the PATH', () => {
  assert.equal(path.basename(BIN), 'deckhq.mjs');
  assert.equal(path.basename(path.dirname(BIN)), 'bin');
});

// ---------------------------------------------------------------------------
// The command end to end, with everything injected
// ---------------------------------------------------------------------------

/** Collect stdout/stderr from one run. */
function capture() {
  const out = [];
  const err = [];
  return {
    out,
    err,
    write: (s) => out.push(s),
    error: (s) => err.push(s),
    get stdout() {
      return out.join('');
    },
    get stderr() {
      return err.join('');
    },
  };
}

test('a running daemon is reused and the window opens against it', async () => {
  const io = capture();
  const calls = [];
  const code = await runApp([], {
    ...io,
    platform: 'win32',
    dataDir: 'C:/state',
    find: async () => ({ port: 4400, url: 'http://127.0.0.1:4400/' }),
    start: async () => assert.fail('a second daemon must not be started'),
    findBrowser: () => 'C:/chrome.exe',
    spawnFn: recordingSpawn(calls),
  });
  assert.equal(code, 0);
  assert.match(io.stdout, /already running/);
  assert.match(io.stdout, /Opened as an app window/);
  assert.equal(calls[0].command, 'C:/chrome.exe');
  assert.equal(calls[0].args[0], '--app=http://127.0.0.1:4400/');
  assert.equal(calls[0].args[2], `--user-data-dir=${path.join('C:/state', 'app-profile')}`);
});

test('no daemon means one is started, and the command says so', async () => {
  const io = capture();
  const calls = [];
  const code = await runApp([], {
    ...io,
    platform: 'linux',
    dataDir: '/state',
    find: async () => null,
    start: async () => ({
      port: 4317,
      url: URL_4317,
      pid: 9,
      started: true,
      timedOut: false,
    }),
    findBrowser: () => '/usr/bin/google-chrome',
    spawnFn: recordingSpawn(calls),
  });
  assert.equal(code, 0);
  assert.match(io.stdout, /started just now/);
  assert.equal(calls[0].command, '/usr/bin/google-chrome');
});

test('no Chromium anywhere falls back to the default browser and says so', async () => {
  const io = capture();
  const calls = [];
  const code = await runApp([], {
    ...io,
    platform: 'linux',
    find: async () => ({ port: 4317, url: URL_4317 }),
    findBrowser: () => null,
    spawnFn: recordingSpawn(calls),
  });
  assert.equal(code, 0);
  assert.deepEqual(calls[0], {
    command: 'xdg-open',
    args: [URL_4317],
    options: { detached: true, stdio: 'ignore' },
  });
  assert.match(io.stdout, /default browser/);
});

test('REGRESSION: the browser is never spawned with windowsHide', async () => {
  // Measured, not reasoned: `windowsHide` puts SW_HIDE in the child's
  // STARTUPINFO, Chrome reads nCmdShow from there for its first window, and
  // the whole browser came up on this machine with no window at all.
  // `docs/DEVIATIONS.md` §144.
  const calls = [];
  await runApp([], {
    write() {},
    error() {},
    platform: 'win32',
    find: async () => ({ port: 4317, url: URL_4317 }),
    findBrowser: () => 'C:/chrome.exe',
    spawnFn: recordingSpawn(calls),
  });
  assert.equal(calls[0].options.windowsHide, undefined);
  assert.equal(calls[0].options.detached, true);
});

test('--no-window reuses or starts the daemon and opens nothing', async () => {
  const io = capture();
  const calls = [];
  const code = await runApp(['--no-window'], {
    ...io,
    find: async () => ({ port: 4317, url: URL_4317 }),
    findBrowser: () => '/usr/bin/google-chrome',
    spawnFn: recordingSpawn(calls),
  });
  assert.equal(code, 0);
  assert.equal(calls.length, 0);
  assert.match(io.stdout, /127\.0\.0\.1:4317/);
});

test('a daemon that never came up is a non-zero exit that names the pid', async () => {
  const io = capture();
  const calls = [];
  const code = await runApp([], {
    ...io,
    find: async () => null,
    start: async () => ({ port: 4317, url: URL_4317, pid: 51, started: true, timedOut: true }),
    findBrowser: () => '/usr/bin/google-chrome',
    spawnFn: recordingSpawn(calls),
  });
  assert.equal(code, 1);
  assert.match(io.stderr, /pid 51/);
  assert.match(io.stderr, /left running rather than killed/);
  assert.equal(calls.length, 0, 'no window is opened against a daemon that is not there');
});

test('SECURITY: a non-loopback daemon url is refused rather than opened', async () => {
  const io = capture();
  const calls = [];
  const code = await runApp([], {
    ...io,
    find: async () => ({ port: 4317, url: 'http://10.0.0.5:4317/' }),
    findBrowser: () => '/usr/bin/google-chrome',
    spawnFn: recordingSpawn(calls),
  });
  assert.equal(code, 1);
  assert.match(io.stderr, /only ever opens 127\.0\.0\.1/);
  assert.equal(calls.length, 0);
});

test('--help prints and starts nothing', async () => {
  const io = capture();
  const code = await runApp(['--help'], {
    ...io,
    find: async () => assert.fail('--help must not look for a daemon'),
  });
  assert.equal(code, 0);
  assert.match(io.stdout, /deckhq app/);
});

test('planOpen falls back when the platform has no app-window form', () => {
  const plan = planOpen({ url: URL_4317, platform: 'aix', browser: '/x', dataDir: '/state' });
  assert.equal(plan.mode, 'default');
  assert.equal(plan.command.command, 'xdg-open');
});
