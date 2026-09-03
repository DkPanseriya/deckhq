/**
 * WP-31 — the VS Code extension.
 *
 * The extension is thin by design, so most of what is worth asserting is that
 * it has not grown a second opinion about something the daemon already
 * decides, and that it still cannot reach the network.
 *
 * Three groups:
 *
 *   1. **`EGRESS:`** — the source of `vscode/` is read as text and checked for
 *      any host that is not loopback, and for the modules that could reach one.
 *      This is the test the package's promise rests on: a Marketplace listing
 *      is the easiest place in the whole product to leak a "check for updates"
 *      into, and it is the one surface a user cannot audit by running `netstat`
 *      before they install.
 *   2. **No second representation** — the extension's `needsYou`, its status
 *      line and its port scan are asserted against `src/core/model.mjs`,
 *      `src/cli/statusline.mjs` and `src/cli/source.mjs`. `docs/DEVIATIONS.md`
 *      has five entries on two representations of one thing being allowed to
 *      disagree; these are the guards against a sixth.
 *   3. Everything the extension genuinely owns: the quick pick's order, the
 *      webview CSP, the spawn plan, and the manifest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import format from '../../vscode/lib/format.js';
import loopback from '../../vscode/lib/loopback.js';
import command from '../../vscode/lib/command.js';
import webview from '../../vscode/lib/webview.js';
import monitorModule from '../../vscode/lib/monitor.js';

import { needsYou as modelNeedsYou, NEEDS_YOU_STATES } from '../../src/core/model.mjs';
import { renderStatusline, statusFrom } from '../../src/cli/statusline.mjs';
import { candidatePorts as cliCandidatePorts } from '../../src/cli/source.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VSCODE_DIR = path.join(ROOT, 'vscode');

/** Every runtime source file of the extension. */
function runtimeSources() {
  const files = [path.join(VSCODE_DIR, 'extension.js')];
  for (const name of fs.readdirSync(path.join(VSCODE_DIR, 'lib')).sort()) {
    if (name.endsWith('.js')) files.push(path.join(VSCODE_DIR, 'lib', name));
  }
  return files.map((file) => ({
    file: path.relative(ROOT, file),
    text: fs.readFileSync(file, 'utf8'),
  }));
}

// ---------------------------------------------------------------------------
// EGRESS
// ---------------------------------------------------------------------------

test('EGRESS: no host but loopback appears in the extension source', () => {
  const sources = runtimeSources();
  assert.ok(sources.length >= 5, 'expected the extension to have runtime sources to scan');

  // Any `scheme://host` in the source, however it is spelled.
  const urls = /\b[a-z][a-z0-9+.-]*:\/\/([^\s'"`)\\]+)/gi;
  const allowed = new Set(['127.0.0.1', 'localhost', '[::1]']);
  for (const { file, text } of sources) {
    for (const match of text.matchAll(urls)) {
      const host = match[1].split('/')[0].split('@').pop().replace(/:\d*$/, '');
      // Fragment templates and doc references carry no host at all.
      if (host.startsWith('${') || host === '') continue;
      assert.ok(
        allowed.has(host),
        `${file} names a non-loopback host: ${match[0]} (only 127.0.0.1 may appear)`,
      );
    }
  }
});

test('EGRESS: the extension loads no module that could reach the network', () => {
  // `node:http` and `node:net` are the two it uses, and both are pinned to
  // `HOST` by the test above. Anything that resolves a name or speaks TLS has
  // no business here at all.
  const forbidden = ['node:https', 'node:dns', 'node:tls', 'node:dgram', "require('https')"];
  for (const { file, text } of runtimeSources()) {
    for (const name of forbidden) {
      assert.ok(!text.includes(name), `${file} references ${name}`);
    }
    assert.ok(!/\bfetch\s*\(/.test(text), `${file} calls fetch(); use lib/loopback.js`);
  }
});

test('EGRESS: only lib/loopback.js opens a socket', () => {
  for (const { file, text } of runtimeSources()) {
    if (file.endsWith('loopback.js')) continue;
    assert.ok(!/require\(['"]node:(http|net)['"]\)/.test(text), `${file} opens sockets directly`);
  }
});

test('EGRESS: the manifest declares no dependencies and no build step', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(VSCODE_DIR, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.devDependencies, undefined);
  assert.equal(pkg.scripts, undefined, 'a thin extension has nothing to build');
});

test('EGRESS: nothing in vscode/ is published to npm', () => {
  const root = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(Array.isArray(root.files), 'the npm package is an allow-list');
  for (const entry of root.files) {
    assert.ok(!entry.includes('vscode'), `root package.json "files" would ship ${entry}`);
  }
});

// ---------------------------------------------------------------------------
// No second representation
// ---------------------------------------------------------------------------

test("the extension's needsYou agrees with src/core/model.mjs", () => {
  assert.deepEqual([...format.NEEDS_YOU_STATES].sort(), [...NEEDS_YOU_STATES].sort());
  const states = [
    'working',
    'needs_input',
    'stalled',
    'for_review',
    'ended',
    'nonsense',
    undefined,
  ];
  for (const ackState of ['active', 'benched', 'let_go', undefined]) {
    for (const activityState of states) {
      const agent = { ackState, activityState };
      assert.equal(
        format.needsYou(agent),
        modelNeedsYou(agent),
        `disagreement on ${ackState}/${activityState}`,
      );
    }
  }
});

test('the status bar text agrees with `deckhq statusline`', () => {
  const cases = [
    { needsYou: 0, handsUp: 0 },
    { needsYou: 1, handsUp: 0 },
    { needsYou: 1, handsUp: 1 },
    { needsYou: 7, handsUp: 2 },
    { needsYou: 3, handsUp: 0 },
    { needsYou: -1, handsUp: 1.7 },
  ];
  for (const counts of cases) {
    const mine = format.statusBarText({ status: 'connected', counts });
    const cli = renderStatusline(statusFrom({ counts }));
    assert.equal(mine, cli, `disagreement on ${JSON.stringify(counts)}`);
  }
});

test('the status bar has a word for every state the monitor can be in', () => {
  assert.equal(format.statusBarText({ status: 'off' }), '▣ off');
  assert.equal(format.statusBarText({ status: 'starting' }), '▣ starting…');
  assert.equal(format.statusBarText({}), '▣ off');
  assert.match(format.statusBarTooltip({ status: 'off' }), /Start daemon/);
  assert.match(
    format.statusBarTooltip({ status: 'connected', port: 4317, counts: { forReview: 2 } }),
    /127\.0\.0\.1:4317/,
  );
});

test('the port scan is the same range the CLI scans', () => {
  const before = process.env.DECKHQ_PORT;
  delete process.env.DECKHQ_PORT;
  try {
    assert.deepEqual(loopback.candidatePorts(), cliCandidatePorts());
    assert.deepEqual(loopback.candidatePorts({ port: 4400 }), cliCandidatePorts({ port: 4400 }));
    assert.equal(loopback.candidatePorts({ port: 4400 })[0], 4400, 'a named port is asked first');
  } finally {
    if (before !== undefined) process.env.DECKHQ_PORT = before;
  }
});

// ---------------------------------------------------------------------------
// The quick pick
// ---------------------------------------------------------------------------

const NOW = 1_700_000_000_000;
const minute = 60_000;

function snapshot() {
  return {
    counts: { needsYou: 3 },
    agents: [
      {
        id: 'claude-code:aaa',
        ackState: 'active',
        activityState: 'for_review',
        reviewSince: NOW - 30 * minute,
        projectName: 'orbital-api',
        mk: 'MK1.2',
        lastText: 'Shall I open   the PR?\n\nIt is ready.',
      },
      {
        id: 'claude-code:bbb',
        ackState: 'active',
        activityState: 'needs_input',
        needsInputSince: NOW - 90 * minute,
        projectName: 'mobile-app',
        mk: 'MK2.1',
        displayName: 'Ada',
      },
      {
        id: 'claude-code:ccc',
        ackState: 'active',
        activityState: 'working',
        projectName: 'mobile-app',
        mk: 'MK2.2',
      },
      {
        id: 'claude-code:ddd',
        ackState: 'benched',
        activityState: 'for_review',
        reviewSince: NOW - 5 * minute,
        projectName: 'design-system',
        mk: 'MK3.1',
      },
    ],
  };
}

test('Show waiting lists only the queue, oldest first', () => {
  const items = format.waitingItems(snapshot(), NOW);
  assert.deepEqual(
    items.map((i) => i.id),
    ['claude-code:bbb', 'claude-code:aaa'],
    'working and benched agents are not on the plate',
  );
  assert.match(items[0].label, /Ada/, 'a name the user gave wins over the MK tag');
  assert.match(items[0].label, /1h 30m/);
  assert.match(items[0].description, /mobile-app · hand up/);
  assert.match(items[1].label, /MK1\.2/);
  assert.equal(items[1].detail, 'Shall I open the PR? It is ready.');
});

test('Show waiting on an empty floor is empty, not an error', () => {
  assert.deepEqual(format.waitingItems({}, NOW), []);
  assert.deepEqual(format.waitingItems({ agents: [] }, NOW), []);
  assert.deepEqual(format.waitingItems(null, NOW), []);
});

test('elapsed reads in the units a queue is read in', () => {
  assert.equal(format.elapsed(45_000), '45s');
  assert.equal(format.elapsed(45 * minute), '45m');
  assert.equal(format.elapsed(3 * 60 * minute + 20 * minute), '3h 20m');
  assert.equal(format.elapsed(26 * 60 * minute), '1d 2h');
  assert.equal(format.elapsed(0), '');
});

// ---------------------------------------------------------------------------
// The webview
// ---------------------------------------------------------------------------

test('the panel CSP allows one origin and nothing else', () => {
  const html = webview.floorHtml({
    url: 'http://127.0.0.1:4317/#agent=claude-code%3Aaaa',
    origin: 'http://127.0.0.1:4317',
    nonce: 'NONCE',
  });
  const csp = /content="([^"]+)"/.exec(html)[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-src http:\/\/127\.0\.0\.1:4317(;|$)/);
  assert.match(csp, /style-src 'nonce-NONCE'/);
  assert.match(csp, /script-src 'nonce-NONCE'/);
  assert.ok(!csp.includes('unsafe-inline'), 'no unsafe-inline anywhere in the policy');
  assert.ok(!csp.includes('unsafe-eval'));
  assert.ok(!csp.includes('*'), 'no wildcard source');
  assert.ok(!/connect-src|img-src|font-src/.test(csp), 'the wrapper needs none of these');
});

test('the panel frames the floor on its own origin', () => {
  const url = 'http://127.0.0.1:4400/#agent=x';
  const html = webview.floorHtml({ url, origin: 'http://127.0.0.1:4400', nonce: 'N' });
  assert.ok(html.includes(`src="${url}"`), 'the iframe loads the floor URL verbatim');
  // Loading the floor on its own origin is what keeps its own requests
  // same-origin, so the daemon's CSRF guard needs no exception for us.
  const hosts = [...html.matchAll(/https?:\/\/([0-9a-z.[\]-]+)/gi)].map((m) => m[1]);
  assert.deepEqual([...new Set(hosts)], ['127.0.0.1']);
});

test('the panel script refuses a URL that is not loopback', () => {
  const html = webview.floorHtml({
    url: 'http://127.0.0.1:4317/',
    origin: 'http://127.0.0.1:4317',
  });
  assert.match(html, /indexOf\('http:\/\/127\.0\.0\.1:'\) !== 0/);
  assert.ok(!html.includes('innerHTML'), 'nothing in the wrapper writes markup');
  assert.ok(!html.includes('eval('), 'nothing in the wrapper evaluates a string');
});

test('a quoted URL cannot break out of the iframe attribute', () => {
  const html = webview.floorHtml({
    url: 'http://127.0.0.1:4317/#agent=a"><script>x</script>',
    origin: 'http://127.0.0.1:4317',
    nonce: 'N',
  });
  assert.ok(!html.includes('<script>x</script>'));
  assert.match(html, /&quot;&gt;&lt;script&gt;/);
});

test('two nonces are not the same nonce', () => {
  assert.notEqual(webview.nonce(), webview.nonce());
  assert.match(webview.nonce(), /^[A-Za-z0-9]{32}$/);
});

// ---------------------------------------------------------------------------
// Starting a daemon
// ---------------------------------------------------------------------------

test('the start command keeps --no-open and honours a configured port', () => {
  assert.deepEqual(command.startArgv({}), ['npx', '--yes', 'deckhq', '--no-open']);
  assert.deepEqual(command.startArgv({ port: 4400 }), [
    'npx',
    '--yes',
    'deckhq',
    '--no-open',
    '--port',
    '4400',
  ]);
  assert.deepEqual(command.startArgv({ command: ['deckhq'], port: 0 }), ['deckhq', '--no-open']);
  assert.deepEqual(command.startArgv({ command: ['deckhq', '--no-open'] }), [
    'deckhq',
    '--no-open',
  ]);
});

/**
 * A Windows machine, in full: the `PATH`, what is on it, and the interpreter.
 *
 * npm ships `npx` (a POSIX shell script) beside `npx.cmd`, and VS Code ships
 * `code` beside `code.cmd` — the pair `cmd.exe` picks wrong. Everything the
 * resolver reads is here, so the answer it gives is decided by this object and
 * not by the machine running the test (docs/DEVIATIONS.md §114, §121).
 */
const WINDOWS_FILES = new Set([
  'C:\\bin\\npx',
  'C:\\bin\\npx.cmd',
  'C:\\bin\\code',
  'C:\\bin\\code.cmd',
  'C:\\bin\\deckhq.exe',
  'C:\\bin\\deckhq.cmd',
]);
const WINDOWS_MACHINE = {
  path: 'C:\\nowhere;C:\\bin',
  comspec: 'C:\\Windows\\system32\\cmd.exe',
  exists: (p) => WINDOWS_FILES.has(p),
};

test('SECURITY: a start command never becomes a shell string', () => {
  const posix = command.spawnPlan(['npx', '--yes', 'deckhq', '--no-open'], 'linux');
  assert.equal(posix.file, 'npx');
  assert.deepEqual(posix.args, ['--yes', 'deckhq', '--no-open']);
  assert.equal(posix.options.shell, false);

  // Every input the Windows plan reads is handed to it, so this row proves the
  // same thing on all nine matrix jobs rather than only on the three that
  // happen to be Windows (docs/DEVIATIONS.md §114, §121).
  const win = command.spawnPlan(['npx', 'deckhq'], 'win32', WINDOWS_MACHINE);
  assert.equal(win.file, 'C:\\Windows\\system32\\cmd.exe');
  assert.deepEqual(win.args.slice(0, 3), ['/d', '/s', '/c']);
  assert.equal(win.options.shell, false);
  // `npx` is resolved to what Windows will actually run — exactly, not by a
  // regex that a bare `npx` would also have satisfied.
  assert.equal(win.args[3], `""C:\\bin\\npx.cmd" "deckhq""`);
  assert.equal(command.windowsCommandLine(['npx', 'deckhq']), `""npx" "deckhq""`);

  // With no `comspec` injected the fallback is still an interpreter, and still
  // an argv array.
  const bare = command.spawnPlan(['deckhq.exe'], 'win32', { path: '', comspec: '' });
  assert.match(bare.file, /cmd\.exe$/i);
  assert.equal(bare.args[3], `""deckhq.exe""`);
});

test('a bare program name resolves to something Windows will run', () => {
  const resolve = (name, env = WINDOWS_MACHINE) => command.resolveWindowsExecutable(name, env);
  // The PATH above is a Windows PATH whatever the host is. Split on the host's
  // own `path.delimiter`, `C:\nowhere;C:\bin` is one directory that does not
  // exist, joined with `/` — so every lookup below silently returns the bare
  // name. That is §114's defect, in a module the §114 sweep did not cover.
  assert.equal(resolve('npx'), 'C:\\bin\\npx.cmd');
  assert.equal(resolve('code'), 'C:\\bin\\code.cmd');
  // Preference order: `.cmd` before `.exe`, which is the order `cmd` itself
  // reads PATHEXT in.
  assert.equal(resolve('deckhq'), 'C:\\bin\\deckhq.cmd');
  // A name that already carries an extension is taken as given, and one that
  // is nowhere on PATH is left for spawn to report.
  assert.equal(resolve('deckhq.exe'), 'deckhq.exe');
  assert.equal(resolve('nothing'), 'nothing');
  // An absolute name looks only where it was told to look, joined the Windows
  // way — `C:\bin` + `code.cmd`, never `C:\bin/code.cmd`.
  assert.equal(resolve('C:\\bin\\code'), 'C:\\bin\\code.cmd');
  assert.equal(resolve('C:\\nowhere\\code'), 'C:\\nowhere\\code');
});

test('the extension list is injected, and the host machine never decides it', () => {
  const resolve = (name, env) => command.resolveWindowsExecutable(name, env);
  // The runner's own PATHEXT — or its absence, on Linux and macOS — must not
  // reach this. The list is an input, and the order in it is the answer.
  assert.equal(
    resolve('deckhq', { ...WINDOWS_MACHINE, pathext: '.exe;.cmd' }),
    'C:\\bin\\deckhq.exe',
  );
  assert.equal(resolve('npx', { ...WINDOWS_MACHINE, pathext: '.exe' }), 'npx');
  // An empty injected PATH is an empty PATH, not a licence to read the host's.
  assert.equal(resolve('npx', { path: '', exists: () => true }), 'npx');
});

test('SECURITY: cmd.exe metacharacters are refused, never escaped', () => {
  for (const bad of ['a"b', '%PATH%', '!DELAYED!', 'x^y', 'a\nb', 'a\rb', 'npx & del /q C:\\*"']) {
    assert.throws(
      () => command.windowsCommandLine(['npx', bad]),
      /cannot be quoted safely/,
      `${JSON.stringify(bad)} was not refused`,
    );
  }
  // The characters `cmd` does honour inside quotes are quoted, not refused.
  assert.equal(command.windowsCommandLine([`a b`, `c&d`, `e|f`]), `""a b" "c&d" "e|f""`);
  assert.throws(() => command.windowsCommandLine([]), /empty command/);
  assert.throws(() => command.spawnPlan(['ok', ''], 'linux'), /non-empty string/);
});

test('the daemon announces its port on stdout, in both of its two messages', () => {
  assert.equal(command.portFromOutput('\n  DeckHQ  http://127.0.0.1:4317/\n\n'), 4317);
  assert.equal(
    command.portFromOutput(
      '  DeckHQ is already running at http://127.0.0.1:4400/ — the installed claude code hooks post there.',
    ),
    4400,
  );
  assert.equal(command.portFromOutput('npm warn exec the following package…'), null);
  assert.equal(command.portFromOutput(''), null);
  assert.equal(command.portFromOutput(null), null);
});

// ---------------------------------------------------------------------------
// Discovery and the live stream
// ---------------------------------------------------------------------------

test('findDaemon asks the configured port first and ignores an impostor', async () => {
  const asked = [];
  const found = await loopback.findDaemon({
    port: 4400,
    timeoutMs: 1000,
    probe: async () => true,
    ask: async (port) => {
      asked.push(port);
      if (port === 4400) return { ok: true }; // something else on the port
      if (port === 4318) return { agents: [], counts: { needsYou: 0 } };
      return null;
    },
  });
  assert.equal(asked[0], 4400, 'the configured port is asked first');
  assert.deepEqual(found, { port: 4318, snapshot: { agents: [], counts: { needsYou: 0 } } });
});

test('findDaemon speaks HTTP only to ports that answered a TCP probe', async () => {
  const asked = [];
  await loopback.findDaemon({
    timeoutMs: 1000,
    probe: async (port) => port === 4319,
    ask: async (port) => {
      asked.push(port);
      return null;
    },
  });
  assert.deepEqual(asked, [4319]);
});

test('findDaemon gives up rather than overrun its budget', async () => {
  const found = await loopback.findDaemon({
    timeoutMs: 0,
    probe: loopback.probe,
    ask: async () => {
      throw new Error('must not be reached with no budget');
    },
  });
  assert.equal(found, null);
});

/** A loopback server that speaks the daemon's SSE dialect. */
async function withSseServer(frames, fn) {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/state') {
      const body = JSON.stringify({ agents: [], counts: { needsYou: 0 } });
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(body);
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('retry: 1000\n\n');
    for (const frame of frames) res.write(frame);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await fn(server.address().port, server);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test('the SSE reader takes snapshots and ignores heartbeats', async () => {
  const snapshots = [];
  await withSseServer(
    [
      ': ping\n\n',
      `id: 1\nevent: state\ndata: ${JSON.stringify({ agents: [], counts: { needsYou: 1 } })}\n\n`,
      ': ping\n\n',
      // Split across two writes, to prove the buffer reassembles frames.
      `id: 2\nevent: state\ndata: ${JSON.stringify({ agents: [], counts: { needsYou: 2 } })}`,
      '\n\n',
      'id: 3\nevent: state\ndata: {not json\n\n',
    ],
    async (port) => {
      await new Promise((resolve) => {
        const sub = loopback.subscribe({
          port,
          onSnapshot: (s) => {
            snapshots.push(s.counts.needsYou);
            if (snapshots.length === 2) {
              sub.dispose();
              resolve();
            }
          },
          onClose: () => {},
        });
      });
    },
  );
  assert.deepEqual(snapshots, [1, 2]);
});

test('the SSE reader reports a stream that never opens', async () => {
  const closed = await new Promise((resolve) => {
    loopback.subscribe({
      // Nothing is listening on port 1, and loopback refuses instantly.
      port: 1,
      onSnapshot: () => resolve('snapshot'),
      onClose: () => resolve('closed'),
    });
  });
  assert.equal(closed, 'closed');
});

// ---------------------------------------------------------------------------
// The monitor
// ---------------------------------------------------------------------------

/** A Monitor with every socket replaced. */
function fakeMonitor(overrides = {}) {
  const changes = [];
  const monitor = new monitorModule.Monitor({
    port: () => null,
    onChange: (state) =>
      changes.push(`${state.status}:${state.counts ? state.counts.needsYou : '-'}`),
    setTimer: () => null,
    clearTimer: () => {},
    find: async () => null,
    ask: async () => null,
    sse: () => ({ dispose: () => {} }),
    ...overrides,
  });
  return { monitor, changes };
}

test('the monitor reports off when nothing is listening', async () => {
  const { monitor, changes } = fakeMonitor();
  await monitor.start();
  assert.equal(monitor.status, 'off');
  assert.equal(monitor.connectedPort, null);
  assert.deepEqual(changes, []);
  monitor.dispose();
});

test('the monitor takes the count from the stream once it is connected', async () => {
  let push = null;
  const { monitor, changes } = fakeMonitor({
    find: async () => ({ port: 4317, snapshot: { agents: [], counts: { needsYou: 1 } } }),
    sse: (opts) => {
      push = opts.onSnapshot;
      return { dispose: () => {} };
    },
  });
  await monitor.start();
  assert.equal(monitor.status, 'connected');
  assert.equal(monitor.connectedPort, 4317);
  push({ agents: [], counts: { needsYou: 4 } });
  assert.equal(monitor.counts.needsYou, 4);
  assert.deepEqual(changes, ['connected:1', 'connected:4']);
  monitor.dispose();
});

test('the monitor falls back to the poll when the stream drops', async () => {
  let close = null;
  let polls = 0;
  const { monitor } = fakeMonitor({
    find: async () => ({ port: 4317, snapshot: { agents: [], counts: { needsYou: 1 } } }),
    sse: (opts) => {
      close = opts.onClose;
      return { dispose: () => {} };
    },
    ask: async () => {
      polls += 1;
      return { agents: [], counts: { needsYou: 9 } };
    },
  });
  await monitor.start();
  close();
  await monitor.tick();
  assert.equal(polls, 1, 'the poll is the fallback, and only the fallback');
  assert.equal(monitor.counts.needsYou, 9);
  assert.equal(monitor.status, 'connected', 'a dropped stream is not a dead daemon');
  monitor.dispose();
});

test('the monitor notices a daemon that went away', async () => {
  let close = null;
  const { monitor } = fakeMonitor({
    find: async () => ({ port: 4317, snapshot: { agents: [], counts: { needsYou: 1 } } }),
    sse: (opts) => {
      close = opts.onClose;
      return { dispose: () => {} };
    },
    ask: async () => null,
  });
  await monitor.start();
  close();
  await monitor.tick();
  assert.equal(monitor.status, 'off');
  assert.equal(monitor.counts, null);
  monitor.dispose();
});

test('INVARIANT: the extension never asks the daemon to change anything', () => {
  // Two reads, and nothing else. No /api/ack, no /api/act, no POST at all: a
  // status bar and a panel chrome cannot discharge a debt by displaying it.
  // docs/01-PRODUCT.md §2.
  for (const { file, text } of runtimeSources()) {
    for (const forbidden of ['/api/ack', '/api/act', '/api/send', '/api/open', '/api/run']) {
      assert.ok(!text.includes(forbidden), `${file} names ${forbidden}`);
    }
    assert.ok(!/method:\s*['"]POST/i.test(text), `${file} makes a POST`);
    assert.ok(!/http\.request\(/.test(text), `${file} bypasses http.get`);
  }
  const paths = [
    ...runtimeSources()
      .map((s) => s.text)
      .join('\n')
      .matchAll(/path: '(\/api\/[^']*)'/g),
  ].map((m) => m[1]);
  assert.deepEqual([...new Set(paths)].sort(), ['/api/events']);
});

// ---------------------------------------------------------------------------
// The manifest
// ---------------------------------------------------------------------------

test('the manifest contributes the four commands WP-31 names', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(VSCODE_DIR, 'package.json'), 'utf8'));
  const commands = pkg.contributes.commands;
  assert.deepEqual(commands.map((c) => c.command).sort(), [
    'deckhq.openFloor',
    'deckhq.showWaiting',
    'deckhq.startDaemon',
    'deckhq.stopDaemon',
  ]);
  for (const entry of commands) assert.equal(entry.category, 'DeckHQ');
  assert.deepEqual(commands.map((c) => `${c.category}: ${c.title}`).sort(), [
    'DeckHQ: Open floor',
    'DeckHQ: Show waiting',
    'DeckHQ: Start daemon',
    'DeckHQ: Stop daemon',
  ]);

  // Every command the manifest promises is registered, and no other.
  const source = fs.readFileSync(path.join(VSCODE_DIR, 'extension.js'), 'utf8');
  const registered = [...source.matchAll(/registerCommand\('([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(registered.sort(), commands.map((c) => c.command).sort());
});

test('the manifest is a publishable Marketplace listing', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(VSCODE_DIR, 'package.json'), 'utf8'));
  assert.equal(pkg.publisher, 'DkPanseriya');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.main, './extension.js');
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  assert.ok(pkg.categories.length > 0);
  for (const category of pkg.categories) {
    assert.ok(
      ['Visualization', 'AI', 'Other', 'Debuggers', 'Testing', 'Notebooks'].includes(category),
      `${category} is not a VS Code category`,
    );
  }
  assert.equal(pkg.icon, 'media/icon.png');
  assert.ok(fs.statSync(path.join(VSCODE_DIR, pkg.icon)).size > 0);
  for (const file of ['README.md', 'CHANGELOG.md', 'LICENSE', '.vscodeignore']) {
    assert.ok(fs.existsSync(path.join(VSCODE_DIR, file)), `vscode/${file} is missing`);
  }
  assert.ok(pkg.engines.vscode.startsWith('^1.'));
});

test('the start command cannot be set by a workspace', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(VSCODE_DIR, 'package.json'), 'utf8'));
  const setting = pkg.contributes.configuration.properties['deckhq.startCommand'];
  assert.equal(setting.scope, 'application', 'a workspace must not name the program we spawn');
  assert.equal(setting.type, 'array');
  assert.deepEqual(setting.default, command.DEFAULT_START_COMMAND);
  assert.deepEqual(pkg.capabilities.untrustedWorkspaces.restrictedConfigurations, [
    'deckhq.startCommand',
  ]);
  // And the code does not take the workspace value either.
  const source = fs.readFileSync(path.join(VSCODE_DIR, 'extension.js'), 'utf8');
  assert.match(source, /inspect\('startCommand'\)/);
  assert.match(source, /globalValue \|\| inspected\.defaultValue/);
});

test('no telemetry, anywhere in the extension', () => {
  for (const { file, text } of runtimeSources()) {
    for (const word of ['telemetry', 'analytics', 'TelemetryLogger', 'reportError', 'sendEvent']) {
      assert.ok(
        !text.toLowerCase().includes(word.toLowerCase()) || /no telemetry|No telemetry/.test(text),
        `${file} mentions ${word}`,
      );
    }
  }
  const pkg = fs.readFileSync(path.join(VSCODE_DIR, 'package.json'), 'utf8');
  assert.ok(!pkg.toLowerCase().includes('telemetry') || pkg.includes('no telemetry'));
});
