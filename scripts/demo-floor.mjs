/**
 * Start DeckHQ against a synthetic machine, for screenshots and demos.
 *
 * The floor in the README has to show the product doing its job — agents in
 * every state, across several projects — without publishing anybody's real
 * project names, session titles or token spend. So this builds a fake
 * `~/.claude` from scratch, points a daemon at it with `CLAUDE_CONFIG_DIR` and
 * `DECKHQ_STATE_DIR`, and drives it into the states we want to show through
 * the real `/api/hook` endpoint — exactly the way Claude Code drives it.
 *
 * Nothing here is a mock of the product. The transcripts are parsed by the
 * real parser, the states are produced by the real state machine, and the
 * floor is laid out by the real planner. Only the data is invented.
 *
 *   node scripts/demo-floor.mjs                    # start and print the URL
 *   node scripts/demo-floor.mjs --port N           # a different port (0 = any free port)
 *   node scripts/demo-floor.mjs --population NAME  # a different fixture, see POPULATIONS
 *   node scripts/demo-floor.mjs --theme NAME       # a floor theme (WP-30), see THEME_NAMES
 *   node scripts/demo-floor.mjs --ledger-fixture   # + a synthetic week of ledger records,
 *                                                  #   so the day's card and Wrapped appear
 *
 * Ctrl-C to stop. The fixture lives in a temp directory and is rebuilt on
 * every run; nothing is written to your real ~/.claude or ~/.deckhq.
 *
 * Everything about a population is a pure function of its name: ids, titles,
 * ages and token counts are all derived from the session's index, never from
 * the clock or a random source. That is what lets `scripts/goldens.mjs`
 * photograph each one and compare the pixels against a committed golden.
 *
 * ============================================================================
 * WP-22 follow-up · this file is the run: bring the fixture up, start a real
 * daemon against it, drive it into the states through the real `/api/hook`
 * endpoint, and hold the floor until Ctrl-C. What it drives is three modules:
 *
 *   demo-args.mjs         the flags, and the fixture directory they name
 *   demo-populations.mjs  the floors, and WP-41's juniors
 *   demo-write.mjs        building the fake machine on disk
 * ============================================================================
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import http from 'node:http';

import { CARDS_OFF } from '../public/postcard.js';
import { themeByName, themeNames } from '../src/core/themes.mjs';
import {
  BIN_DIR,
  CLAUDE_DIR,
  HOUR,
  LEDGER_FIXTURE,
  MINUTE,
  PACK_FILE,
  POPULATION,
  PORT,
  PROJECTS_DIR,
  ROOT,
  STATE_DIR,
  THEME,
} from './demo-args.mjs';
import { JUNIORS, SESSIONS, JUNIOR_PARENT } from './demo-populations.mjs';
import {
  fakeId,
  keepJuniorsWorking,
  rmrf,
  writeClaudeShim,
  writeLedgerFixture,
  writeProjectDirs,
  writeSettings,
  writeTranscript,
  writeSubagent,
} from './demo-write.mjs';

/** POST one hook event, the way the installed hook command would. */
function postHook(port, body) {
  return new Promise((resolve) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/hook',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', resolve);
    req.end(payload);
  });
}

function post(port, route, body) {
  return new Promise((resolve) => {
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: route,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      },
      (res) => {
        res.resume();
        res.on('end', resolve);
      },
    );
    req.on('error', resolve);
    req.end(payload);
  });
}

// ---------------------------------------------------------------- build

rmrf(ROOT);
fs.mkdirSync(PROJECTS_DIR, { recursive: true });
fs.mkdirSync(STATE_DIR, { recursive: true });
writeClaudeShim();
writeSettings();

// WP-45. The pack goes in after the reset above wiped the fixture and before
// the theme is written into `state.json`, because a pack theme is only a name
// this build knows once the pack is registered. Into the FIXTURE's state
// directory, never the real one: this script exists so that nothing real ends
// up in a committed screenshot, and the inverse matters just as much — a demo
// must not install anything into the developer's own `~/.deckhq`.
let packNote = null;
if (PACK_FILE) {
  const { currentPacks, installPack } = await import('../src/core/packs.mjs');
  const packsDir = path.join(STATE_DIR, 'packs');
  const installed = installPack(fs.readFileSync(PACK_FILE), { dir: packsDir });
  if ('error' in installed) {
    process.stderr.write(`could not install ${PACK_FILE}: ${installed.error}
`);
    process.exit(2);
  } else {
    // An `else` rather than an early exit, because `types/node.d.ts` is a
    // hand-written stub and does not type `process.exit` as `never`, so the
    // checker cannot narrow past it (WP-22's lesson: the annotation is what
    // stops a drift, and working around it here would be working around the
    // checker).
    const loaded = currentPacks({ dir: packsDir, force: true });
    packNote = `${installed.pack.name} ${installed.pack.version} — ${loaded.themes.join(', ') || 'no themes'}`;
    if (!themeByName(THEME)) {
      process.stderr.write(`unknown theme "${THEME}"; one of: ${themeNames().join(', ')}
`);
      process.exit(2);
    }
  }
}

// The projects live inside the fixture too, so the review card can read real
// working trees (see writeProjectDirs) and nothing on the real disk is touched.
const root = path.join(ROOT, 'code');
writeProjectDirs(root);
const built = SESSIONS.map(([project, title, state, ageHours, tokensM], i) => {
  const id = fakeId(i + 1);
  const cwd = path.join(root, project);
  writeTranscript({
    id,
    cwd,
    title,
    ageHours,
    tokensM,
    // Only the ones we want standing in the office end on a finished turn.
    finished: state === 'for_review',
  });
  return { id, agentId: `claude-code:${id}`, cwd, project, title, state };
});

// WP-41. The juniors, once their parent's transcript exists to hang them off.
// Only the `demo` population has them: `reference` photographs `08` §0's
// machine, which had none, and `single` and `empty` are controls.
if (POPULATION === 'demo') {
  const parent = built.find((s) => s.title === JUNIOR_PARENT);
  if (parent) {
    for (const junior of JUNIORS) {
      writeSubagent({ parentId: parent.id, cwd: parent.cwd, junior });
    }
    keepJuniorsWorking();
  }
}

// Seed ack state so the lounge is populated the moment the daemon starts,
// and so seeding does not re-derive something else on first run.
// Ack state the daemon restores on start. `reviewSince` is what actually puts
// an agent in the office and gives it a waiting-time badge; staggering the
// values is what makes the queue look like a queue rather than a clump.
const ack = {};
const WAITS = [26 * HOUR, 4 * HOUR, 40 * MINUTE, 7 * MINUTE];
let waitIndex = 0;
for (const s of built) {
  if (s.state === 'benched') ack[s.agentId] = { state: 'benched', updatedAt: Date.now() };
  else if (s.state === 'let_go') ack[s.agentId] = { state: 'let_go', updatedAt: Date.now() };
  else if (s.state === 'for_review') {
    ack[s.agentId] = {
      state: 'active',
      reviewSince: Date.now() - WAITS[waitIndex++ % WAITS.length],
      updatedAt: Date.now(),
    };
  }
}
fs.writeFileSync(
  path.join(STATE_DIR, 'state.json'),
  JSON.stringify(
    {
      version: 1,
      seededAt: Date.now(),
      // `onboarded` keeps the first-run dialog off a floor that exists to be
      // photographed; the capture scripts used to have to dismiss it.
      settings: {
        stallWindowMs: 2 * MINUTE,
        notifications: false,
        onboarded: true,
        // The day's card (WP-18) and Wrapped (WP-27) are marked already shown,
        // for exactly the reason `onboarded` is: this floor exists to be
        // photographed, and a capture taken after 22:00 — or on a Monday, or
        // in December — would otherwise have a card over the middle of it and
        // every golden would fail on the clock. `--ledger-fixture` turns the
        // markers off, which is how the cards' own screenshots are taken.
        postcardDay: LEDGER_FIXTURE ? '' : CARDS_OFF,
        wrappedShown: LEDGER_FIXTURE ? '' : CARDS_OFF,
        // WP-30. `default` is written explicitly rather than omitted so the
        // fixture states the theme it was built for, and a themed goldens
        // capture differs from the plain one in exactly one value.
        theme: themeByName(THEME).name,
      },
      ack,
    },
    null,
    2,
  ),
);

// The synthetic ledger, only when it was asked for. It is written before the
// daemon starts so `Ledger.prime()` reads it as the day already in progress,
// exactly as a restart would.
let ledgerFixture = null;
if (LEDGER_FIXTURE) ledgerFixture = await writeLedgerFixture(built);

process.env.CLAUDE_CONFIG_DIR = CLAUDE_DIR;
process.env.DECKHQ_STATE_DIR = STATE_DIR;
// The office snapshot names the office after the machine (WP-14), and this
// script exists so that nothing real ends up in a committed screenshot. A
// machine name is somebody's real something, so it is invented here too.
process.env.DECKHQ_HOSTNAME = 'DECKHQ-DEMO';
process.env.PATH = `${BIN_DIR}${path.delimiter}${process.env.PATH}`;

const { startDaemon } = await import('../src/daemon.mjs');
// stateFile is passed explicitly so the daemon skips its legacy migration —
// the demo must never pull anything out of a real install.
const { url, port, close } = await startDaemon({
  port: PORT,
  stateFile: path.join(STATE_DIR, 'state.json'),
  // WP-45. `PACKS_DIR` was resolved from the real home when `src/core/paths.mjs`
  // was first imported — which is before this script points `DECKHQ_STATE_DIR`
  // at its fixture — so the daemon has to be told where the fixture's packs
  // are. Passing it unconditionally is also what stops a demo from ever
  // reading, or photographing, whatever the developer happens to have
  // installed in their own `~/.deckhq/packs`.
  packsDir: path.join(STATE_DIR, 'packs'),
});

// Install hooks through the real consent-gated endpoint, AFTER the listener is
// up. The port has to be the one actually bound — `--port` may have been taken
// and walked forward — and installing here also refreshes the daemon's own
// hook status, which is what switches it off the degraded path.
await post(port, '/api/hooks/install', { runtime: 'claude-code', consent: true });

// Drive the floor into the states we want to show, through the real hook
// endpoint. Order matters: SessionStart makes a session live, and only a live
// session can be working, blocked or stalled.
const hook = (s, hookEvent) =>
  postHook(port, {
    session_id: s.id,
    cwd: s.cwd,
    hook_event_name: hookEvent,
    runtime: 'claude-code',
  });

for (const s of built) {
  if (s.state === 'working' || s.state === 'needs_input' || s.state === 'stalled') {
    await hook(s, 'SessionStart');
  }
}
for (const s of built) {
  if (s.state === 'needs_input') await hook(s, 'Notification');
  if (s.state === 'stalled') await hook(s, 'UserPromptSubmit'); // starts the stall clock
}

const stallSeconds = 2 * 60;
process.stdout.write(
  [
    '',
    `  DeckHQ demo floor  ${url}`,
    '',
    `  population: ${POPULATION}`,
    `  theme:    ${themeByName(THEME).name}`,
    ...(packNote ? [`  pack:     ${packNote}`] : []),
    `  fixture:  ${ROOT}`,
    `  projects: ${new Set(built.map((s) => s.project)).size}`,
    `  sessions: ${built.length}`,
    ...(ledgerFixture
      ? [`  ledger:   ${ledgerFixture.records} records across ${ledgerFixture.days} days (fixture)`]
      : []),
    '',
    `  "stalled" appears after ~${stallSeconds}s (the minimum stall window).`,
    '  Ctrl-C to stop. Nothing was written to your real ~/.claude or ~/.deckhq.',
    '',
  ].join('\n'),
);

/**
 * How long a graceful shutdown gets before it is taken away from it.
 *
 * `daemon.close()` awaits `server.close()`, and `server.close()` does not
 * complete while any request is still in flight — which an SSE stream, by
 * definition, always is. A browser sitting on the floor therefore held this
 * process open forever on a signal. That was a real defect in `close()` and it
 * has been fixed there: `close()` ends its own event streams and returns in
 * milliseconds with a browser attached (docs/DEVIATIONS.md §126.3, §128).
 * This backstop stays regardless, because a demo script that will not answer
 * Ctrl-C is its own bug whatever the reason, and the fixture directory is
 * removed either way — which is the one thing shutdown genuinely owes.
 */
const SHUTDOWN_GRACE_MS = 4000;

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    let done = false;
    const leave = () => {
      if (done) return;
      done = true;
      rmrf(ROOT);
      process.exit(0);
    };
    const forced = setTimeout(leave, SHUTDOWN_GRACE_MS);
    if (typeof forced.unref === 'function') forced.unref();
    close().finally(() => {
      clearTimeout(forced);
      leave();
    });
  });
}
