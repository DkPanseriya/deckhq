/**
 * `deckhq doctor` — the environment report.
 *
 * The command's job is to make DeckHQ's advantage checkable on the user's own
 * machine. That makes the wording as load-bearing as the arithmetic, and there
 * is one specific overclaim these tests exist to keep dead.
 *
 * `claude agents --json` was measured on the reference machine: it returns
 * every live session, `kind: "interactive"`, including terminal-launched ones
 * in other repositories. It is NOT blind to terminal sessions. So the earlier
 * headline — "DeckHQ sees 61 sessions the agent view cannot", which was 66
 * all-history minus 5 running — was literally true and rhetorically dishonest,
 * and a reader who ran the command would have caught it. What the runtime's
 * view actually does is forget a session when its process exits.
 *
 * So: the only thing we claim the agent view does not list is sessions that
 * are waiting on the user AND not running. Several tests below assert the
 * absence of the old phrasings, not just the presence of the new ones.
 *
 * Everything is driven through a fake registry: the real one reads the
 * machine's transcripts, which vary per machine and per hour.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ago,
  buildProofHtml,
  checkState,
  collectReport,
  deckFrom,
  group,
  PITCH,
  readTerminalPin,
  redact,
  renderReport,
  renderShare,
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

const NOW = 1_700_000_000_000;

/** Nothing is listening on any loopback port. The common case. */
const noDaemon = { probe: async () => false, inspect: async () => null };

/**
 * A DeckHQ daemon on `port`, and nothing on any other port.
 * @param {number} port
 * @param {{hookHealth?:Map<string,any>, deck?:any}} [what]
 */
function daemonOn(port, what = {}) {
  return {
    probe: async (p) => p === port,
    inspect: async (p) =>
      p === port
        ? {
            port,
            hookHealth: what.hookHealth || new Map(),
            deck: what.deck || {
              found: true,
              waiting: 0,
              waitingNotRunning: 0,
              oldestWaitAt: null,
              total: 0,
            },
          }
        : null,
  };
}

let tmpCount = 0;
async function tmpStateDir() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), `deckhq-doctor-${tmpCount++}-`));
  return { dataDir: dir, stateFile: path.join(dir, 'state.json') };
}

/**
 * The terminal row, pinned. Which emulator is actually installed varies by
 * machine and by CI runner, so every test that is not ABOUT the terminal row
 * gets this fixed answer rather than whatever the box happens to have.
 */
const A_TERMINAL = {
  id: 'ghostty',
  label: 'Ghostty',
  reason: 'env',
  present: true,
  pinned: false,
};

/** Collect with every machine-dependent input pinned. */
async function collect(adapters, extra = {}) {
  const { dataDir, stateFile } = extra.state || (await tmpStateDir());
  const machine = extra.machine || noDaemon;
  return collectReport({
    adapters,
    dataDir,
    stateFile,
    now: NOW,
    terminal: async () => A_TERMINAL,
    ...machine,
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
    { machine: daemonOn(4317) },
  );
  const text = renderReport(report, { home: '/home/x' });

  assert.match(text, /claude code {5}available/);
  assert.match(text, /transcripts {5}51 sessions across 2 projects/);
  assert.match(text, /running now {5}3 {3}\(claude code's own agent view reports 3\)/);
  assert.match(text, /on the floor {4}51 {2}← 48 sessions have already finished/);

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
// The arithmetic, and what may be claimed about it
// ---------------------------------------------------------------------------

test('finished is transcripts minus what the runtime reports running', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(51, '/p'), live: sessionsIn(3, '/p') })),
  );
  assert.equal(report.runtimes[0].sessions, 51);
  assert.equal(report.runtimes[0].liveReported, 3);
  assert.equal(report.runtimes[0].finished, 48);
  assert.match(
    renderReport(report),
    /← 48 sessions have already finished; the agent view no longer lists them/,
  );
});

test('INVARIANT OF HONESTY: nothing ever claims the agent view cannot SEE a session', async () => {
  // The runtime's own view lists interactive terminal sessions perfectly well
  // while they are alive. It forgets them when they exit. Those are different
  // claims and only the second one is ours to make.
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(66, '/p'), live: sessionsIn(5, '/p') })),
    {
      machine: daemonOn(4317, {
        deck: {
          found: true,
          waiting: 7,
          waitingNotRunning: 7,
          oldestWaitAt: NOW - 26 * 3600_000,
          total: 66,
        },
      }),
    },
  );
  // Every surface the claim can reach a stranger through, including the share
  // block, which is the one written to be pasted somewhere public.
  const surfaces = [
    renderReport(report),
    buildProofHtml(report, { host: 'testbox' }),
    renderShare(report, { home: '/home/ada', host: 'testbox' }),
  ];
  for (const text of surfaces) {
    assert.doesNotMatch(text, /cannot see/i);
    assert.doesNotMatch(text, /the agent view cannot/i);
    assert.doesNotMatch(text, /(?:invisible|blind|hidden from)/i);
    // 61 is transcripts-minus-running. It may be described as finished, but it
    // must never be the subject of a claim about what the agent view lists.
    assert.doesNotMatch(text, /61 sessions the agent view/i);
  }
});

test('the comparison line is absent when nothing has finished', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(3, '/p'), live: sessionsIn(3, '/p') })),
  );
  assert.equal(report.runtimes[0].finished, 0);
  const text = renderReport(report);
  assert.doesNotMatch(text, /←/);
  assert.doesNotMatch(text, /already finished/);
  assert.match(text, /on the floor {4}3\n/);
});

test('a runtime reporting more running than we have on disk clamps to zero, never negative', async () => {
  // A session started seconds ago has a live entry before its transcript is
  // written. "-2 sessions have already finished" is nonsense in the one image
  // this project launches on.
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(1, '/p'), live: sessionsIn(3, '/p') })),
  );
  assert.equal(report.runtimes[0].finished, 0);
  const text = renderReport(report);
  assert.doesNotMatch(text, /←/);
  assert.doesNotMatch(text, /-\d+ session/);
  assert.match(text, /on the floor {4}1\n/);
});

test('exactly one finished session reads as a singular session', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(2, '/p'), live: sessionsIn(1, '/p') })),
  );
  assert.match(renderReport(report), /← 1 session has already finished/);
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
// The deck — what is actually owed
// ---------------------------------------------------------------------------

test('the deck counts only sessions that are waiting AND not running', async () => {
  // A session the runtime still lists as running may be sitting on a
  // permission prompt. The runtime's own view WOULD show that one, so counting
  // it as something the runtime hides would be false.
  const deck = deckFrom({
    counts: {},
    agents: [
      { ackState: 'active', activityState: 'for_review', live: false, reviewSince: NOW - 3600_000 },
      { ackState: 'active', activityState: 'for_review', live: false, reviewSince: NOW - 7200_000 },
      {
        ackState: 'active',
        activityState: 'needs_input',
        live: true,
        needsInputSince: NOW - 60_000,
      },
      { ackState: 'active', activityState: 'stalled', live: false, lastOutputAt: NOW - 600_000 },
      { ackState: 'active', activityState: 'working', live: true },
      // Benched and let-go sessions are not waiting on anybody.
      { ackState: 'benched', activityState: 'for_review', live: false, reviewSince: NOW - 999 },
      { ackState: 'let_go', activityState: 'for_review', live: false, reviewSince: NOW - 999 },
    ],
  });

  assert.equal(deck.waiting, 4); // includes the running needs_input one
  assert.equal(deck.waitingNotRunning, 3); // the number we are allowed to claim
  assert.equal(deck.oldestWaitAt, NOW - 7200_000);
  assert.equal(deck.total, 7);
});

test('the waiting row states the debt, and says none of it is running', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(66, '/p'), live: sessionsIn(5, '/p') })),
    {
      machine: daemonOn(4317, {
        deck: {
          found: true,
          waiting: 9,
          waitingNotRunning: 7,
          oldestWaitAt: NOW - 26 * 3600_000,
          total: 66,
        },
      }),
    },
  );
  assert.match(
    renderReport(report),
    /waiting on you {2}7 {2}← none of these are running; oldest 26h/,
  );
});

test('the waiting row admits it cannot count without a running daemon', async () => {
  const report = await collect(registry(fakeAdapter({ sessions: sessionsIn(66, '/p') })));
  assert.equal(report.deck.found, false);
  assert.equal(report.deck.waitingNotRunning, null);
  assert.match(renderReport(report), /waiting on you {2}needs a running DeckHQ to count/);
});

test('a debt of zero is reported as zero, not hidden', async () => {
  const report = await collect(registry(fakeAdapter({ sessions: sessionsIn(66, '/p') })), {
    machine: daemonOn(4317, {
      deck: { found: true, waiting: 0, waitingNotRunning: 0, oldestWaitAt: null, total: 66 },
    }),
  });
  assert.match(renderReport(report), /waiting on you {2}0 {3}nothing is waiting on you/);
});

// ---------------------------------------------------------------------------
// Exit codes
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The terminal row (WP-04)
// ---------------------------------------------------------------------------

/** @param {any} terminal */
async function terminalRow(terminal) {
  const report = await collect(registry(fakeAdapter()), {
    overrides: { terminal: async () => terminal },
  });
  return renderReport(report)
    .split('\n')
    .find((l) => l.trim().startsWith('terminal'));
}

test('the terminal row names the emulator and how it was found', async () => {
  assert.match(
    await terminalRow(A_TERMINAL),
    /terminal\s+Ghostty\s+\(this session runs inside it\)/,
  );
  assert.match(
    await terminalRow({ ...A_TERMINAL, id: 'kitty', label: 'kitty', reason: 'installed' }),
    /kitty\s+\(installed\)/,
  );
  assert.match(
    await terminalRow({ ...A_TERMINAL, id: 'konsole', label: 'Konsole', reason: 'TERMINAL' }),
    /Konsole\s+\(\$TERMINAL\)/,
  );
  assert.match(
    await terminalRow({
      ...A_TERMINAL,
      id: 'terminal-app',
      label: 'Terminal.app',
      reason: 'fallback',
    }),
    /Terminal\.app\s+\(always present\)/,
  );
});

test('a pinned terminal says so, and says when it is not on this machine', async () => {
  assert.match(
    await terminalRow({ ...A_TERMINAL, reason: 'pinned', pinned: true }),
    /Ghostty\s+\(pinned in settings\)/,
  );
  assert.match(
    await terminalRow({ ...A_TERMINAL, reason: 'pinned', pinned: true, present: false }),
    /Ghostty\s+\(pinned in settings; not found on this machine\)/,
  );
});

test('INVARIANT OF HONESTY: the terminal row never claims the launch works', async () => {
  // WP-04 is implemented and unit-tested, and has not been run on a real Mac
  // or Linux desktop (docs/DEVIATIONS.md §9, §91). Every phrase in this row
  // names a check that was run — an environment variable, a binary, a bundle,
  // a stored setting. None of them may promise an outcome.
  for (const reason of ['env', 'installed', 'TERMINAL', 'pinned', 'fallback']) {
    const line = await terminalRow({ ...A_TERMINAL, reason, pinned: reason === 'pinned' });
    assert.doesNotMatch(line, /\bwill\b|\bworks?\b|verified|supported|tested/i, line);
  }
});

test('a machine with no terminal at all says so, and is not a failure', async () => {
  const none = { id: null, label: null, reason: null, present: false, pinned: false };
  assert.match(await terminalRow(none), /none found/);
  const report = await collect(registry(fakeAdapter()), {
    overrides: { terminal: async () => none },
  });
  // Honest, but not a reason to exit non-zero: DeckHQ still captures
  // everything it captured before, and "open in terminal" is one action.
  assert.equal(report.ok, true);
});

test('a terminal probe that throws leaves the row empty rather than failing the report', async () => {
  const report = await collect(registry(fakeAdapter()), {
    overrides: {
      terminal: async () => {
        throw new Error('/Applications is not readable');
      },
    },
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.terminal, {
    id: null,
    label: null,
    reason: null,
    present: false,
    pinned: false,
  });
  assert.match(renderReport(report), /none found/);
});

test('the pinned terminal comes from the state file the report is already reading', async () => {
  const { dataDir, stateFile } = await tmpStateDir();
  await fsp.writeFile(
    stateFile,
    JSON.stringify({ version: 1, settings: { terminal: 'wezterm' } }),
    'utf8',
  );
  /** @type {any[]} */
  const asked = [];
  await collectReport({
    adapters: registry(fakeAdapter()),
    dataDir,
    stateFile,
    now: NOW,
    ...noDaemon,
    terminal: async (opts) => {
      asked.push(opts);
      return A_TERMINAL;
    },
  });
  assert.deepEqual(asked, [{ pin: 'wezterm' }]);
});

test('readTerminalPin answers "auto" for every way a state file can be unusable', async () => {
  const { dataDir, stateFile } = await tmpStateDir();
  assert.equal(await readTerminalPin(stateFile), 'auto'); // absent
  for (const body of ['', 'not json', 'null', '[]', '{"settings":{}}', '{"settings":42}']) {
    await fsp.writeFile(stateFile, body, 'utf8');
    assert.equal(await readTerminalPin(stateFile), 'auto', body);
  }
  await fsp.writeFile(stateFile, JSON.stringify({ settings: { terminal: ' kitty ' } }), 'utf8');
  assert.equal(await readTerminalPin(stateFile), 'kitty');
  assert.equal(await readTerminalPin(dataDir), 'auto'); // a directory, not a file
});

test('the share block does not carry which terminal this person uses', async () => {
  // The block is a launch asset that gets pasted in public. Which emulator
  // someone runs is a fact about them and adds nothing to the numbers, so it
  // stays in the local report. docs/DEVIATIONS.md §91.
  const report = await collect(registry(fakeAdapter({ sessions: sessionsIn(3, '/p') })));
  const share = renderShare(report);
  assert.doesNotMatch(share, /Ghostty|terminal\s+/i);
});

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

test('hooks installed while DeckHQ is simply not running is informational, not a failure', async () => {
  // This is most machines most of the time. `doctor` will end up in health
  // checks, and failing here would make it useless there.
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(5, '/p'), installed: true, port: 4317 })),
  );
  assert.equal(report.hooks[0].listening, false);
  assert.equal(report.ok, true);
  assert.deepEqual(report.problems, []);
  assert.match(report.notes.join('\n'), /DeckHQ is not running/);
  assert.match(renderReport(report), /· Claude Code hooks post to 127\.0\.0\.1:4317/);
});

test('hooks pointing at one port while DeckHQ runs on another IS a failure', async () => {
  // The one failure mode that looks perfect from every other surface: the
  // settings file is valid, the header claims exact state, and every event is
  // dropped on the floor.
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(5, '/p'), installed: true, port: 4317 })),
    { machine: daemonOn(4320) },
  );
  assert.equal(report.hooks[0].listening, false);
  assert.equal(report.deck.port, 4320);
  assert.equal(report.ok, false);
  assert.match(
    report.problems.join('\n'),
    /hooks post to 127\.0\.0\.1:4317, but DeckHQ is running on 4320/,
  );
  assert.match(report.problems.join('\n'), /every hook event is being dropped/);
});

test('hooks aimed at the port DeckHQ is actually on is healthy', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(5, '/p'), installed: true, port: 4317 })),
    { machine: daemonOn(4317) },
  );
  assert.equal(report.hooks[0].listening, true);
  assert.equal(report.ok, true);
  assert.deepEqual(report.notes, []);
});

test('--port widens the search to a daemon outside the default range', async () => {
  const adapters = registry(
    fakeAdapter({ sessions: sessionsIn(5, '/p'), installed: true, port: 4317 }),
  );
  const { dataDir, stateFile } = await tmpStateDir();
  const machine = daemonOn(4400);

  const blind = await collectReport({ adapters, dataDir, stateFile, now: NOW, ...machine });
  assert.equal(blind.deck.found, false); // 4400 is outside 4317..4326

  const told = await collectReport({
    adapters,
    dataDir,
    stateFile,
    now: NOW,
    port: 4400,
    ...machine,
  });
  assert.equal(told.deck.found, true);
  assert.equal(told.deck.port, 4400);
  assert.equal(told.ok, false); // ...and now the mismatch is visible
});

test('hooks that are simply not installed are not a failure', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(5, '/p'), installed: false })),
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
  const hookHealth = new Map([['claude-code', { eventsSeen: 1204, lastEventAt: NOW - 120_000 }]]);
  const withDaemon = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(5, '/p'), installed: true, port: 4317 })),
    { machine: daemonOn(4317, { hookHealth }) },
  );
  assert.equal(withDaemon.hooks[0].eventsSeen, 1204);
  assert.match(
    renderReport(withDaemon),
    /hooks {11}installed, port 4317, 1,204 events, last 2m ago/,
  );

  const quiet = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(5, '/p'), installed: true, port: 4317 })),
    {
      machine: daemonOn(4317, {
        hookHealth: new Map([['claude-code', { eventsSeen: 0, lastEventAt: null }]]),
      }),
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
      machine: daemonOn(4317, {
        hookHealth: new Map([
          ['claude-code', { eventsSeen: 7, lastEventAt: null }],
          ['codex', { eventsSeen: 0, lastEventAt: null }],
        ]),
      }),
    },
  );
  const codex = report.hooks.find((h) => h.runtime === 'codex');
  assert.equal(codex.supported, false);
  assert.equal(codex.eventsSeen, null);
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
        now: NOW,
        ...noDaemon,
      }),
  });

  assert.equal(code, 0);
  const parsed = JSON.parse(out); // exactly one document, always

  assert.deepEqual(Object.keys(parsed).sort(), [
    'deck',
    'egress',
    'generatedAt',
    'hooks',
    'notes',
    'ok',
    'problems',
    'proof',
    'runtimes',
    'share',
    'state',
    'terminal',
  ]);
  // Null rather than absent when the flag was not given: the shape is stable
  // whatever the flags, which is the whole contract of this mode.
  assert.equal(parsed.share, null);
  assert.deepEqual(Object.keys(parsed.runtimes[0]).sort(), [
    'available',
    'error',
    'finished',
    'id',
    'label',
    'live',
    'liveReported',
    'projects',
    'sessions',
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
  assert.deepEqual(Object.keys(parsed.deck).sort(), [
    'found',
    'oldestWaitAt',
    'port',
    'total',
    'waiting',
    'waitingNotRunning',
  ]);
  assert.deepEqual(Object.keys(parsed.state).sort(), ['error', 'path', 'writable']);
  assert.deepEqual(Object.keys(parsed.terminal).sort(), [
    'id',
    'label',
    'pinned',
    'present',
    'reason',
  ]);
  assert.deepEqual(Object.keys(parsed.egress).sort(), ['note', 'outbound']);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.runtimes[0].finished, 48);
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
        now: NOW,
        ...noDaemon,
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
// The real binary
// ---------------------------------------------------------------------------

test('the CLI actually exits, cleanly, with one JSON document on stdout', async () => {
  // Every other test in this file calls runDoctor() and asserts its RETURN
  // value. That is why 364 of them passed against a binary that aborted at
  // exit: `process.exit()` tore the loop down while the daemon socket was
  // still closing, and libuv killed the process with 127 after printing a
  // perfectly correct report (docs/DEVIATIONS.md §76). A command's contract
  // includes how it ends, so this one spawns the real thing.
  //
  // The exit code is asserted as "a code doctor chose", not a specific value:
  // on a machine with no runtime installed — which is every CI runner — a
  // report of 1 is the correct answer.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const bin = path.join(root, 'bin', 'deckhq.mjs');

  const { code, stdout, stderr } = await new Promise((resolve) => {
    execFile(
      process.execPath,
      [bin, 'doctor', '--json'],
      { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 },
      (err, out, errOut) =>
        resolve({ code: err ? (err.code ?? 1) : 0, stdout: out, stderr: errOut }),
    );
  });

  assert.ok(code === 0 || code === 1, `doctor exited with ${code}; stderr: ${stderr}`);
  assert.doesNotMatch(stderr, /Assertion failed/i);
  const parsed = JSON.parse(stdout);
  assert.equal(typeof parsed.ok, 'boolean');
  assert.equal(parsed.ok, code === 0);
  assert.ok(Array.isArray(parsed.runtimes));
});

// ---------------------------------------------------------------------------
// The proof card
// ---------------------------------------------------------------------------

test('the proof card leads with the debt when a daemon can supply it', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(66, '/p'), live: sessionsIn(5, '/p') })),
    {
      machine: daemonOn(4317, {
        deck: {
          found: true,
          waiting: 7,
          waitingNotRunning: 7,
          oldestWaitAt: NOW - 26 * 3600_000,
          total: 66,
        },
      }),
    },
  );
  const html = buildProofHtml(report, { host: 'testbox' });

  assert.match(html, /7 finished sessions are still waiting on you\./);
  assert.match(html, /The agent view lists none of them\./);
  assert.match(html, /Oldest: 26h\./);
  // The two columns are labelled as what they are.
  assert.match(html, /sessions running right now/);
  assert.match(html, /sessions on the floor/);
  assert.match(html, />5</);
  assert.match(html, />66</);
});

test('the proof card drops the comparative claim entirely when no daemon can count the debt', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(66, '/p'), live: sessionsIn(5, '/p') })),
  );
  const html = buildProofHtml(report, { host: 'testbox' });

  assert.match(html, /61 of them have already finished\./);
  // No softened version of the old claim sneaks back in. The left column's
  // label still names the thing it is counting ("its own agent view") — that
  // is a description of the 5, not an assertion about the 61.
  assert.doesNotMatch(html, /lists none of them/i);
  assert.doesNotMatch(html, /no longer lists|forgets|cannot/i);
  assert.doesNotMatch(html, /agent view (?:cannot|does not|no longer)/i);
});

test('the proof card says something true when nothing has finished', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(3, '/p'), live: sessionsIn(3, '/p') })),
  );
  const html = buildProofHtml(report, { host: 'testbox' });
  assert.match(html, /Every session on this machine is running right now\./);
  assert.doesNotMatch(html, /agent view lists none/);
});

test('the proof card is self-contained: no network reference of any kind', async () => {
  const report = await collect(
    registry(fakeAdapter({ sessions: sessionsIn(51, '/p'), live: sessionsIn(3, '/p') })),
  );
  const html = buildProofHtml(report, { host: 'testbox' });

  // Rule 2 of the plan, made checkable: a launch asset that fetches something
  // contradicts the exact thing it exists to prove.
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /@import|url\(/i);
  assert.doesNotMatch(html, /<img|<link/i);
});

test('the proof card prefers the runtime that actually has finished sessions', async () => {
  const report = await collect(
    registry(
      fakeAdapter({
        id: 'codex',
        label: 'Codex',
        sessions: sessionsIn(2, '/p'),
        live: sessionsIn(2, '/p'),
        hooksSupported: false,
      }),
      fakeAdapter({ sessions: sessionsIn(51, '/p'), live: sessionsIn(3, '/p') }),
    ),
  );
  const html = buildProofHtml(report, { host: 'testbox' });
  assert.match(html, /claude code/);
  assert.match(html, /48 of them have already finished/);
});

test('the proof card escapes anything it interpolates', async () => {
  const report = await collect(registry(fakeAdapter({ sessions: sessionsIn(1, '/p') })));
  const html = buildProofHtml(report, { host: '<script>alert(1)</script>' });
  assert.doesNotMatch(html, /<script>alert/);
  assert.match(html, /&lt;script&gt;/);
});

// ---------------------------------------------------------------------------
// The share block (WP-44)
// ---------------------------------------------------------------------------

/** A report with something in every field the share block can draw from. */
async function fullReport(extra = {}) {
  return collect(
    registry(
      fakeAdapter({
        sessions: [
          ...sessionsIn(52, '/Users/ada/skunkworks-alpha'),
          ...sessionsIn(18, 'C:/Dk/Projects/ClientAcme'),
        ],
        live: sessionsIn(1, '/Users/ada/skunkworks-alpha'),
        installed: true,
        port: 4317,
      }),
      fakeAdapter({ id: 'codex', label: 'Codex', available: false, hooksSupported: false }),
    ),
    {
      machine: daemonOn(4317, {
        hookHealth: new Map([['claude-code', { eventsSeen: 1204, lastEventAt: NOW - 120_000 }]]),
        deck: {
          found: true,
          waiting: 49,
          waitingNotRunning: 47,
          oldestWaitAt: NOW - 26 * 3600_000,
          total: 70,
        },
      }),
      ...extra,
    },
  );
}

test('the share block is fenced, and the pitch is its last line', async () => {
  const report = await fullReport();
  const block = renderShare(report, { home: '/Users/ada', host: 'ada-mbp' });

  const lines = block.split('\n');
  assert.equal(lines[0], '```', 'the first line opens the fence and nothing else');
  assert.equal(lines.at(-1), '', 'the block ends with a newline');
  assert.equal(lines.at(-2), '```', 'the last line closes the fence');
  assert.equal(lines.at(-3), PITCH, 'the pitch is the last line inside it');
  assert.equal(block.split('```').length - 1, 2, 'exactly one fence, opened and closed');

  // And the numbers a reader would check are all there.
  assert.match(block, /transcripts +70 sessions across 2 projects/);
  assert.match(block, /running now +1 {3}\(claude code's own agent view reports 1\)/);
  assert.match(block, /on the floor +70 {2}← 69 sessions have already finished/);
  assert.match(block, /waiting on you +47 {2}← none of these are running; oldest 26h/);
  assert.match(block, /hooks +installed, 1,204 events, last 2m ago/);
  assert.match(block, /egress +none\. no outbound sockets\./);
  assert.match(block, /codex +not installed/);
  // Dated to the day, never to the hour: the hour is a fact about the person.
  assert.match(block, /^deckhq doctor · \d{4}-\d{2}-\d{2}$/m);
  assert.doesNotMatch(block, /\d{2}:\d{2}/);
});

test('WP-44: no scanned project directory name reaches the share block', async () => {
  const report = await fullReport();
  const block = renderShare(report, { home: '/Users/ada', host: 'ada-mbp' });

  // The two working directories the fixture scanned, whole and in pieces.
  for (const leak of [
    '/Users/ada/skunkworks-alpha',
    'C:/Dk/Projects/ClientAcme',
    'skunkworks-alpha',
    'ClientAcme',
    'skunkworks',
    'Dk',
    'ada',
  ]) {
    assert.ok(!block.includes(leak), `the share block leaks "${leak}":\n${block}`);
  }
  // The count survives; only the names are gone.
  assert.match(block, /2 projects/);
});

test('the share block carries no path, no machine name and no state location', async () => {
  const { dataDir, stateFile } = await tmpStateDir();
  const report = await fullReport({ state: { dataDir, stateFile } });
  const block = renderShare(report, { home: '/Users/ada', host: 'ada-mbp' });

  // The real state path of this test run is in the report and must not be in
  // the block; its verdict must be.
  assert.ok(report.state.path.length > 0);
  assert.ok(!block.includes(report.state.path));
  assert.ok(!block.includes(path.basename(dataDir)));
  assert.match(block, /state +writable/);

  // Nothing that looks like a path at all: no drive letter, no ~, no absolute
  // POSIX path, no UNC share, no home directory.
  assert.doesNotMatch(block, /[A-Za-z]:[\\/]/);
  assert.doesNotMatch(block, /(?:^|\s)~[\\/]/);
  assert.doesNotMatch(block, /\\\\/);
  assert.doesNotMatch(block, /(?:\/[A-Za-z0-9._@%+-]+){2}/);
  assert.ok(!block.includes('ada-mbp'));
  // A port is not a secret, but it is not information either.
  assert.doesNotMatch(block, /4317/);
});

test('a problem is counted in the share block, never quoted into it', async () => {
  // The two free-text fields in the report both carry paths in practice: an
  // adapter's error message (a filesystem error names the file) and the state
  // check's own message.
  const report = await collect(
    registry(
      fakeAdapter({
        scanThrows: "ENOENT: no such file or directory, open '/Users/ada/secret-client/.claude'",
        installed: true,
        port: 4400,
      }),
    ),
    { machine: daemonOn(4317) },
  );
  assert.equal(report.ok, false);
  assert.equal(report.problems.length, 2, 'the scan error and the hook-port mismatch');

  const block = renderShare(report, { home: '/Users/ada', host: 'ada-mbp' });
  assert.match(block, /! 2 problems — run `deckhq doctor` here for the detail/);
  assert.ok(!block.includes('secret-client'));
  assert.ok(!block.includes('ENOENT'));
  assert.doesNotMatch(block, /4400|4317/);
  // The row still says the hooks could not be read, without saying what it read.
  assert.match(block, /hooks +installed/);
});

test('redact removes the machine from anything that reached the block by another route', () => {
  const opts = { home: '/Users/ada', host: 'ada-mbp.local' };
  assert.equal(
    redact('state at /Users/ada/.deckhq/state.json, writable', opts),
    'state at [path], writable',
  );
  assert.equal(redact('open C:\\Users\\ada\\work\\api', opts), 'open [path]');
  assert.equal(redact('open C:/Users/ada/work/api', opts), 'open [path]');
  assert.equal(redact('~/.deckhq/state.json', opts), '[path]');
  assert.equal(redact('\\\\build01\\share\\out', opts), '[path]');
  assert.equal(redact('/home/other/project', opts), '[path]');
  assert.equal(redact('running on ada-mbp.local now', opts), 'running on [host] now');
  assert.equal(redact('running on ADA-MBP now', opts), 'running on [host] now');
  // Windows home written with the other separator is still home.
  assert.equal(redact('C:/Users/ada/x', { home: 'C:\\Users\\ada', host: 'pc' }), '[path]');
  // What it must NOT touch: the report's own vocabulary.
  const clean = '70 sessions across 18 projects · 127.0.0.1 · none. no outbound sockets.';
  assert.equal(redact(clean, opts), clean);
  // A two-letter hostname is indistinguishable from a word, so it is left alone
  // rather than shredding the text it is supposed to protect.
  assert.equal(redact('on the floor 70', { home: '/h', host: 'on' }), 'on the floor 70');
});

test('--share prints the block and nothing else, and keeps the exit code', async () => {
  const { dataDir, stateFile } = await tmpStateDir();
  const build = () =>
    collectReport({
      adapters: registry(
        fakeAdapter({ sessions: sessionsIn(51, '/p'), live: sessionsIn(3, '/p') }),
      ),
      dataDir,
      stateFile,
      now: NOW,
      ...noDaemon,
    });

  let out = '';
  const code = await runDoctor(['--share'], {
    write: (s) => {
      out += s;
    },
    collect: build,
  });

  assert.equal(code, 0);
  assert.equal(out.split('```').length - 1, 2);
  assert.match(out, /48 sessions have already finished/);
  // The plain report is not printed above it: the block is meant to be
  // selected whole or piped straight into a clipboard command.
  assert.equal(out.match(/on the floor/g).length, 1);
  assert.ok(!out.includes(stateFile));
  assert.ok(out.trimEnd().endsWith('```'));
});

test('--share --json stays exactly one JSON document, with the block as a field', async () => {
  const { dataDir, stateFile } = await tmpStateDir();
  let out = '';
  const code = await runDoctor(['--json', '--share'], {
    write: (s) => {
      out += s;
    },
    collect: () =>
      collectReport({
        adapters: registry(
          fakeAdapter({ sessions: sessionsIn(51, '/p'), live: sessionsIn(3, '/p') }),
        ),
        dataDir,
        stateFile,
        now: NOW,
        ...noDaemon,
      }),
  });

  assert.equal(code, 0);
  const parsed = JSON.parse(out);
  assert.equal(typeof parsed.share, 'string');
  assert.ok(parsed.share.startsWith('```\n'));
  assert.ok(parsed.share.trimEnd().endsWith('```'));
  assert.ok(parsed.share.includes(PITCH));
});

test('--help lists --share', async () => {
  let out = '';
  await runDoctor(['--help'], {
    write: (s) => {
      out += s;
    },
    collect: () => {
      throw new Error('doctor --help must not collect a report');
    },
  });
  assert.match(out, /--share/);
});

test('the share block still renders when there is nothing to boast about', async () => {
  // No runtime, no daemon: the block must be honest and printable, not empty
  // and not an exception.
  const report = await collect(registry(fakeAdapter({ available: false })));
  const block = renderShare(report, { home: '/Users/ada', host: 'ada-mbp' });
  assert.match(block, /claude code +not installed/);
  assert.match(block, /waiting on you +needs a running DeckHQ to count/);
  assert.equal(block.split('\n').at(-3), PITCH);
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
