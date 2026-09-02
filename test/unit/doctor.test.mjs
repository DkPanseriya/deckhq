/**
 * `deckhq doctor` — the environment report.
 *
 * The command exists to make one claim checkable on the user's own machine:
 * that DeckHQ sees sessions the runtime's own agent view cannot. That claim is
 * a subtraction, and a subtraction that is wrong in either direction is worse
 * than not making the claim at all — too high and we are lying in a launch
 * image, negative and we are printing nonsense. Most of what follows pins that
 * arithmetic and the exit code that goes with it.
 *
 * Everything is driven through a fake registry: the real one reads the
 * machine's transcripts, which vary per machine and per hour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ago,
  buildProofHtml,
  checkState,
  collectReport,
  group,
  renderReport,
  runDoctor,
  tildify,
} from '../../src/cli/doctor.mjs';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

/**
 * A runtime adapter with only the surface `doctor` is allowed to touch.
 * @param {Partial<{id:string,label:string,available:boolean,sessions:any[],live:any[],
 *   hooksSupported:boolean,installed:boolean,port:number|null,version:string,
 *   scanThrows:string}>} spec
 */
function fakeAdapter(spec = {}) {
  const {
    id = 'claude-code',
    label = 'Claude Code',
    available = true,
    sessions = [],
    live = [],
    hooksSupported = true,
    installed = false,
    port = null,
    version,
    scanThrows,
  } = spec;

  const adapter = {
    id,
    label,
    available: async () => available,
    scanSessions: async () => {
      if (scanThrows) throw new Error(scanThrows);
      return sessions;
    },
    liveSessions: async () => live,
    hooks: {
      supported: hooksSupported,
      installed: async () => installed,
      installedPort: async () => port,
    },
  };
  if (version !== undefined) adapter.version = async () => version;
  return adapter;
}

/** @param {number} n @param {string} cwd */
function sessionsIn(n, cwd) {
  return Array.from({ length: n }, (_, i) => ({ id: `${cwd}#${i}`, cwd }));
}

/** A registry of the given adapters, in the shape src/adapters/index.mjs has. */
function registry(...adapters) {
  return { getAdapters: () => adapters };
}

let tmpCount = 0;
async function tmpStateDir() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `deckhq-doctor-${tmpCount++}-`));
  return { dataDir: dir, stateFile: path.join(dir, 'state.json') };
}

/** Collect with every machine-dependent input pinned. */
async function collect(adapters, extra = {}) {
  const { dataDir, stateFile } = extra.state || (await tmpStateDir());
  return collectReport({
    adapters,
    dataDir,
    stateFile,
    now: 1_700_000_000_000,
    probe: extra.probe || (async () => true),
    hookHealth: extra.hookHealth || (async () => new Map()),
    ...extra.overrides,
  });
}

// ---------------------------------------------------------------------------
// The report renders
// ---------------------------------------------------------------------------

test('the report renders a row for every runtime in the registry, available or not', async () => {
  const report = await collect(
    registry(
      fakeAdapter({
        id: 'claude-code',
        label: 'Claude Code',
        sessions: [...sessionsIn(30, '/a'), ...sessionsIn(21, '/b')],
        live: sessionsIn(3, '/a'),
        installed: true,
        port: 4317,
      }),
      fakeAdapter({ id: 'codex', label: 'Codex', available: false, hooksSupported: false }),
      fakeAdapter({ id: 'gemini', label: 'Gemini CLI', available: false, hooksSupported: false }),
    ),
  );
  const text = renderReport(report, { home: '/home/x' });

  assert.match(text, /claude code {5}available/);
  assert.match(text, /transcripts {5}51 sessions across 2 projects/);
  assert.match(text, /live now {8}3 {3}\(claude code's own agent view reports 3\)/);
  assert.match(text, /on the floor {4}51 {2}← DeckHQ sees 48 sessions the agent view cannot/);

  // Every registered runtime gets a row, including the ones that are absent.
  assert.match(text, /codex {11}not installed/);
  assert.match(text, /gemini cli {6}not installed/);

  // An unavailable runtime gets exactly one row — no transcripts/live/floor
  // rows full of zeroes underneath it.
  assert.equal(text.match(/transcripts/g).length, 1);

  assert.match(text, /hooks {11}installed, port 4317/);
  assert.match(text, /state {11}.*state\.json, writable/);
  assert.match(text, /egress {10}none\. no outbound sockets\./);
});

test('a version is printed when the adapter offers one, and omitted when it does not', async () => {
  const withVersion = await collect(registry(fakeAdapter({ version: '2.1.184' })));
  assert.match(renderReport(withVersion), /claude code {5}2\.1\.184 on PATH/);
  assert.equal(withVersion.runtimes[0].version, '2.1.184');

  const without = await collect(registry(fakeAdapter({})));
  assert.match(renderReport(without), /claude code {5}available/);
  assert.equal(without.runtimes[0].version, null);
});

// ---------------------------------------------------------------------------
// The arithmetic — the whole point of the command
// ---------------------------------------------------------------------------

test('sessions the agent view cannot see is transcripts minus what the runtime reports live', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(51, '/p'), live: sessionsIn(3, '/p') })),
  );
  assert.equal(report.runtimes[0].sessions, 51);
  assert.equal(report.runtimes[0].liveReported, 3);
  assert.equal(report.runtimes[0].unseenByRuntime, 48);
  assert.match(renderReport(report), /← DeckHQ sees 48 sessions the agent view cannot/);
});

test('the comparison line is absent when the runtime can see everything', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(3, '/p'), live: sessionsIn(3, '/p') })),
  );
  assert.equal(report.runtimes[0].unseenByRuntime, 0);
  const text = renderReport(report);
  assert.doesNotMatch(text, /←/);
  assert.doesNotMatch(text, /cannot/);
  // The row itself still reports the floor count.
  assert.match(text, /on the floor {4}3\n/);
});

test('a runtime reporting more live than we have on disk clamps to zero, never negative', async () => {
  // A session started seconds ago has a live entry before its transcript is
  // written. Reporting "-2 sessions the agent view cannot see" would be
  // nonsense in the one image this project launches on.
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(1, '/p'), live: sessionsIn(3, '/p') })),
  );
  assert.equal(report.runtimes[0].unseenByRuntime, 0);
  const text = renderReport(report);
  assert.doesNotMatch(text, /←/);
  assert.doesNotMatch(text, /sees -\d/);
  assert.match(text, /on the floor {4}1\n/);
});

test('exactly one session hidden reads as a singular session', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(2, '/p'), live: sessionsIn(1, '/p') })),
  );
  assert.match(renderReport(report), /DeckHQ sees 1 session the agent view cannot/);
});

test('projects are distinct working directories, not session count', async () => {
  const report = await collect(
    registry(
      fakeAdapter({
        sessions: [
          ...sessionsIn(10, '/one'),
          ...sessionsIn(5, '/two'),
          // A session whose cwd could not be determined must not invent a project.
          { id: 'x', cwd: '' },
        ],
      }),
    ),
  );
  assert.equal(report.runtimes[0].sessions, 16);
  assert.equal(report.runtimes[0].projects, 2);
});

// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------

test('a healthy machine exits 0', async () => {
  const report = await collect(registry(fakeAdapter({ sessions: sessionsIn(5, '/p') })));
  assert.equal(report.ok, true);
  assert.deepEqual(report.problems, []);
});

test('a state path that cannot be written is a failure', async () => {
  const { dataDir } = await tmpStateDir();
  // A file where the data directory should be: mkdir and write both fail,
  // which is the shape of every real cause (read-only volume, root-owned dir).
  const blocked = path.join(dataDir, 'blocked');
  await fsp.writeFile(blocked, 'not a directory', 'utf8');

  const report = await collect(registry(fakeAdapter({ sessions: sessionsIn(5, '/p') })), {
    state: { dataDir: blocked, stateFile: path.join(blocked, 'state.json') },
  });

  assert.equal(report.state.writable, false);
  assert.ok(report.state.error);
  assert.equal(report.ok, false);
  assert.match(report.problems.join('\n'), /state is not writable/);
  assert.match(renderReport(report), /NOT WRITABLE/);
});

test('an absent optional runtime is not a failure', async () => {
  const report = await collect(
    registry(
      fakeAdapter({ sessions: sessionsIn(5, '/p') }),
      fakeAdapter({ id: 'codex', label: 'Codex', available: false, hooksSupported: false }),
    ),
  );
  assert.equal(report.ok, true);
  assert.equal(report.runtimes[1].available, false);
  assert.deepEqual(report.problems, []);
});

test('no runtime available at all is a failure', async () => {
  const report = await collect(
    registry(
      fakeAdapter({ available: false, hooksSupported: false }),
      fakeAdapter({ id: 'codex', label: 'Codex', available: false, hooksSupported: false }),
    ),
  );
  assert.equal(report.ok, false);
  assert.match(report.problems.join('\n'), /no agent runtime is available/);
});

test('hooks installed at a port nothing is listening on is a failure, and says so', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(5, '/p'), installed: true, port: 4317 })),
    { probe: async () => false },
  );
  assert.equal(report.hooks[0].listening, false);
  assert.equal(report.ok, false);
  assert.match(report.problems.join('\n'), /nothing is listening there/);
  assert.match(renderReport(report), /NOTHING LISTENING THERE/);
});

test('hooks that are simply not installed are not a failure', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(5, '/p'), installed: false })),
    { probe: async () => false },
  );
  assert.equal(report.ok, true);
  assert.match(renderReport(report), /hooks {11}not installed \(DeckHQ polls instead\)/);
});

test('an adapter that throws is reported rather than swallowed', async () => {
  const report = await collect(
    registry(fakeAdapter({ scanThrows: 'transcript directory is unreadable' })),
  );
  assert.equal(report.ok, false);
  assert.match(report.problems.join('\n'), /transcript directory is unreadable/);
  assert.match(renderReport(report), /error: transcript directory is unreadable/);
});

// ---------------------------------------------------------------------------
// Hook delivery evidence
// ---------------------------------------------------------------------------

test('event counts come from a running daemon, and are omitted when there is none', async () => {
  const health = new Map([
    ['claude-code', { eventsSeen: 1204, lastEventAt: 1_700_000_000_000 - 120_000 }],
  ]);
  const withDaemon = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(5, '/p'), installed: true, port: 4317 })),
    { probe: async () => true, hookHealth: async () => health },
  );
  assert.equal(withDaemon.hooks[0].eventsSeen, 1204);
  assert.match(
    renderReport(withDaemon),
    /hooks {11}installed, port 4317, 1,204 events, last 2m ago/,
  );

  // Hooks installed and a daemon listening, but no events yet this run.
  const quiet = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(5, '/p'), installed: true, port: 4317 })),
    {
      probe: async () => true,
      hookHealth: async () => new Map([['claude-code', { eventsSeen: 0, lastEventAt: null }]]),
    },
  );
  assert.match(renderReport(quiet), /installed, port 4317, 0 events, none yet this run/);
});

test('a runtime with no hook mechanism reports nothing rather than zero', async () => {
  const report = await collect(
    registry(
      fakeAdapter({ sessions: sessionsIn(5, '/p'), installed: true, port: 4317 }),
      fakeAdapter({ id: 'codex', label: 'Codex', hooksSupported: false }),
    ),
    {
      probe: async () => true,
      hookHealth: async () =>
        new Map([
          ['claude-code', { eventsSeen: 7, lastEventAt: null }],
          ['codex', { eventsSeen: 0, lastEventAt: null }],
        ]),
    },
  );
  const codex = report.hooks.find((h) => h.runtime === 'codex');
  assert.equal(codex.supported, false);
  assert.equal(codex.eventsSeen, null);
  // ...and it gets no hooks row in the text at all.
  assert.doesNotMatch(renderReport(report), /hooks \(codex\)/);
});

// ---------------------------------------------------------------------------
// --json
// ---------------------------------------------------------------------------

test('--json emits one JSON document with a stable shape', async () => {
  const { dataDir, stateFile } = await tmpStateDir();
  let out = '';
  const code = await runDoctor(['--json'], {
    write: (s) => {
      out += s;
    },
    collect: () =>
      collectReport({
        adapters: registry(
          fakeAdapter({ sessions: sessionsIn(51, '/p'), live: sessionsIn(3, '/p') }),
          fakeAdapter({ id: 'codex', label: 'Codex', available: false, hooksSupported: false }),
        ),
        dataDir,
        stateFile,
        now: 1_700_000_000_000,
        probe: async () => true,
        hookHealth: async () => new Map(),
      }),
  });

  assert.equal(code, 0);
  const parsed = JSON.parse(out); // exactly one document, always

  assert.deepEqual(Object.keys(parsed).sort(), [
    'egress',
    'generatedAt',
    'hooks',
    'ok',
    'problems',
    'proof',
    'runtimes',
    'state',
  ]);
  assert.deepEqual(Object.keys(parsed.runtimes[0]).sort(), [
    'available',
    'error',
    'id',
    'label',
    'live',
    'liveReported',
    'projects',
    'sessions',
    'unseenByRuntime',
    'version',
  ]);
  assert.deepEqual(Object.keys(parsed.hooks[0]).sort(), [
    'error',
    'eventsSeen',
    'installed',
    'label',
    'lastEventAt',
    'listening',
    'port',
    'runtime',
    'supported',
  ]);
  assert.deepEqual(Object.keys(parsed.state).sort(), ['error', 'path', 'writable']);
  assert.deepEqual(Object.keys(parsed.egress).sort(), ['note', 'outbound']);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.runtimes[0].unseenByRuntime, 48);
  assert.equal(parsed.egress.outbound, 0);
  // No text report leaks into the JSON stream.
  assert.doesNotMatch(out, /on the floor/);
});

test('runDoctor returns a non-zero exit code when the report is not ok', async () => {
  const { dataDir, stateFile } = await tmpStateDir();
  let out = '';
  const code = await runDoctor([], {
    write: (s) => {
      out += s;
    },
    collect: () =>
      collectReport({
        adapters: registry(fakeAdapter({ available: false, hooksSupported: false })),
        dataDir,
        stateFile,
        now: 1_700_000_000_000,
        probe: async () => true,
        hookHealth: async () => new Map(),
      }),
  });
  assert.equal(code, 1);
  assert.match(out, /! no agent runtime is available/);
});

test('--help prints usage, starts nothing, and exits 0', async () => {
  let out = '';
  const code = await runDoctor(['--help'], {
    write: (s) => {
      out += s;
    },
    collect: () => {
      throw new Error('doctor --help must not collect a report');
    },
  });
  assert.equal(code, 0);
  assert.match(out, /--capture-proof/);
  assert.match(out, /--json/);
});

// ---------------------------------------------------------------------------
// The proof card
// ---------------------------------------------------------------------------

test('the proof card is self-contained: no network reference of any kind', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(51, '/p'), live: sessionsIn(3, '/p') })),
  );
  const html = buildProofHtml(report, { host: 'testbox' });

  assert.match(html, /DeckHQ sees 48 sessions the agent view cannot/);
  assert.match(html, />51</);
  assert.match(html, />3</);
  assert.match(html, /testbox/);

  // Rule 2 of the plan, made checkable: a launch asset that fetches something
  // contradicts the exact thing it exists to prove.
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /@import|url\(/i);
  assert.doesNotMatch(html, /<img|<link/i);
});

test('the proof card prefers the runtime that actually demonstrates the gap', async () => {
  const report = await collect(
    registry(
      fakeAdapter({
        id: 'codex',
        label: 'Codex',
        sessions: sessionsIn(2, '/p'),
        live: sessionsIn(2, '/p'),
      }),
      fakeAdapter({ sessions: sessionsIn(51, '/p'), live: sessionsIn(3, '/p') }),
    ),
  );
  const html = buildProofHtml(report, { host: 'testbox' });
  assert.match(html, /claude code/);
  assert.match(html, /48 sessions the agent view cannot/);
});

test('the proof card says something true when there is no gap to show', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(3, '/p'), live: sessionsIn(3, '/p') })),
  );
  const html = buildProofHtml(report, { host: 'testbox' });
  assert.doesNotMatch(html, /sessions the agent view cannot/);
  assert.match(html, /agree on this machine/);
});

test('the proof card escapes anything it interpolates', async () => {
  const report = await collect(registry(fakeAdapter({ sessions: sessionsIn(1, '/p') })));
  const html = buildProofHtml(report, { host: '<script>alert(1)</script>' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

// ---------------------------------------------------------------------------
// Small helpers, pinned because the report's legibility depends on them
// ---------------------------------------------------------------------------

test('numbers are grouped without depending on the machine locale', () => {
  assert.equal(group(0), '0');
  assert.equal(group(51), '51');
  assert.equal(group(1204), '1,204');
  assert.equal(group(1000000), '1,000,000');
});

test('elapsed spans read in the largest unit that is still true', () => {
  assert.equal(ago(2000), '2s');
  assert.equal(ago(120_000), '2m');
  assert.equal(ago(3 * 3600_000), '3h');
  assert.equal(ago(5 * 86400_000), '5d');
  // A clock that moved backwards must not print "-3s ago".
  assert.equal(ago(-5), 'just now');
});

test('the home directory collapses to ~ so the report is safe to paste', () => {
  assert.equal(tildify('/home/dk/.deckhq/state.json', '/home/dk'), '~/.deckhq/state.json');
  assert.equal(
    tildify('C:\\Users\\dk\\.deckhq\\state.json', 'C:\\Users\\dk'),
    '~/.deckhq/state.json',
  );
  assert.equal(tildify('/etc/deckhq/state.json', '/home/dk'), '/etc/deckhq/state.json');
  // A sibling directory that merely starts with the same characters is not home.
  assert.equal(tildify('/home/dk2/state.json', '/home/dk'), '/home/dk2/state.json');
});

test('checkState proves writability by writing, and leaves no probe file behind', async () => {
  const { dataDir, stateFile } = await tmpStateDir();
  const result = checkState({ dataDir, stateFile });
  assert.equal(result.writable, true);
  assert.equal(result.error, null);
  assert.deepEqual(await fsp.readdir(dataDir), []);
});
