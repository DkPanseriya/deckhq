/**
 * WP-38 — `deckhq statusline`.
 *
 * Three things these tests exist to hold:
 *
 *   1. **The line says what the header says.** `waiting` is `counts.needsYou`
 *      and `handsUp` is the `needs_input` subset, computed by the same
 *      `counts()` the interface uses. WP-38's acceptance criterion is that the
 *      two agree.
 *   2. **The no-daemon path is fast.** There is a measured budget — 20 ms —
 *      and it is asserted here rather than asserted in a document.
 *   3. **Consent, and only what we wrote.** `--install` prints the literal
 *      JSON and the path and writes nothing without `--yes`; `--remove` takes
 *      out the tagged entry and refuses to touch a status line somebody else
 *      configured.
 *
 * And the standing one: a read command reads. Running the status line must
 * leave `state.json` byte-identical, whatever it finds there.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  DEFAULT_COMMAND,
  MARK,
  backupSettings,
  describeInstall,
  install,
  isOurStatusLine,
  remove,
  renderStatusline,
  runStatusline,
  statusFrom,
  statuslineOffline,
} from '../../src/cli/statusline.mjs';
import { askDaemon, findDaemon, readCache, readOffline, readState } from '../../src/cli/source.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let tmpRoot = null;

/** A throwaway directory that dies with the process. */
function scratch(name) {
  if (!tmpRoot) tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-statusline-'));
  const dir = path.join(tmpRoot, name);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * A machine on disk: `state.json` plus one runtime cache file.
 * @param {{ack?:any, identity?:any, sessions?:any[]}} spec
 */
function machine(spec = {}) {
  const dir = scratch(`m-${Math.random().toString(36).slice(2)}`);
  const cacheDir = path.join(dir, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });

  const stateFile = path.join(dir, 'state.json');
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      version: 1,
      settings: {},
      ack: spec.ack || {},
      identity: spec.identity || { projects: {}, agents: {}, projectOf: {}, names: {} },
      archivedProjects: {},
    }),
  );

  const entries = {};
  for (const s of spec.sessions || []) {
    entries[`/transcripts/${s.id}.jsonl`] = {
      mtimeMs: 1,
      size: 2,
      summary: {
        id: s.id,
        runtime: 'claude-code',
        title: s.title || 'a session',
        cwd: s.cwd || '/work/orbital-api',
        tokens: s.tokens ?? 1000,
        lastText: s.lastText || 'done',
        lastActivityAt: s.lastActivityAt ?? 1_700_000_000_000,
      },
    };
  }
  fs.writeFileSync(
    path.join(cacheDir, 'claude-code.json'),
    JSON.stringify({ version: 1, runtime: 'claude-code', updatedAt: 1, entries }),
  );

  return { dir, stateFile, cacheDir };
}

/** The snapshot shape `/api/state` returns, reduced to what this command reads. */
function snapshot(counts) {
  return {
    agents: [],
    counts: { needsYou: 0, handsUp: 0, stalled: 0, forReview: 0, ...counts },
  };
}

// ---------------------------------------------------------------------------
// The line
// ---------------------------------------------------------------------------

test('the line names the queue and the raised hands, and omits the zero half', () => {
  assert.equal(renderStatusline({ waiting: 3, handsUp: 1 }), `${MARK} 3 waiting · 1 hand up`);
  assert.equal(renderStatusline({ waiting: 4, handsUp: 2 }), `${MARK} 4 waiting · 2 hands up`);
  assert.equal(renderStatusline({ waiting: 3, handsUp: 0 }), `${MARK} 3 waiting`);
});

test('nothing waiting reads as clear, not as a blank', () => {
  assert.equal(renderStatusline({ waiting: 0, handsUp: 0 }), `${MARK} clear`);
});

test('the line never scores the human', () => {
  const text = renderStatusline({ waiting: 7, handsUp: 3 });
  assert.doesNotMatch(text, /\byou\b/i);
  assert.doesNotMatch(text, /left|still|again|streak/i);
});

test('waiting is the header numeral and hands up is its subset', () => {
  const status = statusFrom({
    counts: { needsYou: 5, handsUp: 2, forReview: 2, stalled: 1 },
    source: 'daemon',
    port: 4317,
  });
  assert.deepEqual(status, {
    waiting: 5,
    handsUp: 2,
    forReview: 2,
    stalled: 1,
    source: 'daemon',
    port: 4317,
  });
  assert.equal(status.forReview + status.handsUp + status.stalled, status.waiting);
});

// ---------------------------------------------------------------------------
// The two sources
// ---------------------------------------------------------------------------

test('a running daemon is preferred, and its numbers are the ones printed', async () => {
  const out = [];
  const code = await runStatusline([], {
    write: (s) => out.push(s),
    read: async () => ({
      counts: snapshot({ needsYou: 3, handsUp: 1 }).counts,
      source: 'daemon',
      port: 4317,
    }),
  });
  assert.equal(code, 0);
  assert.equal(out.join(''), `${MARK} 3 waiting · 1 hand up\n`);
});

test('--json is one object with the same numbers and the rendered text', async () => {
  const out = [];
  await runStatusline(['--json'], {
    write: (s) => out.push(s),
    read: async () => ({
      counts: snapshot({ needsYou: 2, handsUp: 2 }).counts,
      source: 'state',
      port: null,
    }),
  });
  const parsed = JSON.parse(out.join(''));
  assert.equal(parsed.waiting, 2);
  assert.equal(parsed.handsUp, 2);
  assert.equal(parsed.source, 'state');
  assert.equal(parsed.text, `${MARK} 2 waiting · 2 hands up`);
});

test('the files answer when no daemon does: reviewSince is for_review, needsInputSince is a hand', () => {
  const { stateFile, cacheDir } = machine({
    sessions: [{ id: 'claude-code:a' }, { id: 'claude-code:b' }, { id: 'claude-code:c' }],
    ack: {
      'claude-code:a': { state: 'active', reviewSince: 1_700_000_000_000, needsInputSince: null },
      'claude-code:b': { state: 'active', reviewSince: null, needsInputSince: 1_700_000_000_000 },
      'claude-code:c': { state: 'active', reviewSince: null, needsInputSince: null },
    },
  });
  const status = statuslineOffline({ stateFile, cacheDir });
  assert.equal(status.source, 'state');
  assert.equal(status.waiting, 2);
  assert.equal(status.handsUp, 1);
  assert.equal(status.forReview, 1);
});

test('a benched or let-go agent is not waiting on anybody', () => {
  const { stateFile, cacheDir } = machine({
    sessions: [{ id: 'claude-code:a' }, { id: 'claude-code:b' }],
    ack: {
      'claude-code:a': { state: 'benched', reviewSince: 1_700_000_000_000 },
      'claude-code:b': { state: 'let_go', needsInputSince: 1_700_000_000_000 },
    },
  });
  assert.equal(statuslineOffline({ stateFile, cacheDir }).waiting, 0);
});

test('the offline path never invents a stall — it has no clock and no liveness to invent one from', () => {
  const { stateFile, cacheDir } = machine({
    sessions: [{ id: 'claude-code:a', lastActivityAt: 1 }],
    ack: {},
  });
  const deck = readOffline({ stateFile, cacheDir });
  assert.equal(deck.counts.stalled, 0);
  assert.equal(deck.counts.working, 0);
  assert.deepEqual(
    deck.agents.map((a) => a.activityState),
    ['ended'],
  );
});

test('a debt whose summary fell out of the capped cache is still counted', () => {
  // The cache is bounded by entries and by bytes; an ack record is not.
  // Under-reporting the queue is the failure that matters.
  const { stateFile, cacheDir } = machine({
    sessions: [],
    ack: { 'claude-code:gone': { state: 'active', reviewSince: 1_700_000_000_000 } },
  });
  const status = statuslineOffline({ stateFile, cacheDir });
  assert.equal(status.waiting, 1);
});

test('a missing state file is a quiet zero, not a crash', () => {
  const status = statuslineOffline({
    stateFile: path.join(scratch('empty'), 'nothing.json'),
    cacheDir: path.join(scratch('empty'), 'nowhere'),
  });
  assert.equal(status.waiting, 0);
  assert.equal(renderStatusline(status), `${MARK} clear`);
});

test('a corrupt state file and a corrupt cache read as an empty machine', () => {
  const dir = scratch('corrupt');
  const stateFile = path.join(dir, 'state.json');
  const cacheDir = path.join(dir, 'cache');
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(stateFile, '{not json');
  fs.writeFileSync(path.join(cacheDir, 'claude-code.json'), 'also not json');
  assert.deepEqual(readState(stateFile).found, false);
  assert.deepEqual(readCache(cacheDir), []);
  assert.equal(statuslineOffline({ stateFile, cacheDir }).waiting, 0);
});

// ---------------------------------------------------------------------------
// The budget
// ---------------------------------------------------------------------------

/** The budget, in milliseconds. WP-38's acceptance criterion, measured. */
const BUDGET_MS = 20;

/**
 * What a fixed unit of the same KIND of work costs on the machine the budget
 * was set on, quiet: five read-and-parses of a 200 KB JSON file, which is what
 * the no-daemon path is mostly made of. About 7 ms there. Above
 * `QUIET_UNIT_MS` the machine is slower than that one or busy, and a
 * wall-clock reading taken then is a reading of the machine, not of the code.
 *
 * A CPU-only loop was tried here first and is the wrong probe: it does not
 * move with the file and allocation contention that actually slows this path.
 * docs/DEVIATIONS.md §132.
 */
const QUIET_UNIT_MS = 14;

/**
 * The ceiling applied when the machine is NOT quiet. Deliberately loose: it
 * cannot police 20 ms on a machine that cannot even be measured to 20 ms, but
 * it still fails an order-of-magnitude regression, which is the class of
 * defect a budget exists to catch. It is never skipped.
 */
const LOADED_CEILING_MS = 250;

/** A fixed 200 KB of JSON on disk, for `unitCostMs` to read. */
function calibrationFile() {
  const file = path.join(scratch('calibration'), 'unit.json');
  const rows = [];
  for (let i = 0; i < 900; i++) rows.push({ id: `row-${i}`, text: 'x'.repeat(200), n: i });
  fs.writeFileSync(file, JSON.stringify(rows));
  return file;
}

/**
 * Time five read-and-parses of that file — about as long as the call being
 * measured, and that matters more than it sounds. A probe much shorter than
 * its subject is rarely preempted at all: a single 1.4 ms parse read "quiet"
 * on a machine where the 58 ms call beside it was being descheduled
 * constantly. The probe has to be exposed to the scheduler for as long as the
 * thing it is vouching for.
 * @param {string} file
 */
function unitCostMs(file) {
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 5; i++) {
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'));
    // Reading the length is what keeps the parse from being optimised away.
    if (rows.length !== 900) throw new Error('unreachable');
  }
  return Number(process.hrtime.bigint() - t0) / 1e6;
}

test('the no-daemon path answers inside its 20 ms budget', (t) => {
  // 400 sessions, all of them waiting: five times the reference machine's
  // session count and every one of them carrying an ack record, so this is
  // slower than the machine the budget was set on.
  const sessions = [];
  const ack = {};
  for (let i = 0; i < 400; i++) {
    const id = `claude-code:session-${i}`;
    sessions.push({
      id,
      title: `a session with a reasonably long title ${i}`,
      cwd: `/work/project-${i % 12}`,
      lastText: 'x'.repeat(400),
      lastActivityAt: 1_700_000_000_000 + i,
    });
    ack[id] = { state: 'active', reviewSince: 1_700_000_000_000 + i, needsInputSince: null };
  }
  const { stateFile, cacheDir } = machine({ sessions, ack });

  const calibration = calibrationFile();
  statuslineOffline({ stateFile, cacheDir }); // warm the page cache
  unitCostMs(calibration); // and the JIT on the probe

  // Interleaved on purpose: the two readings have to come out of the SAME few
  // milliseconds, or a lull between them calls a machine quiet whose runs were
  // taken under load. That is exactly how this test passed at 19.36 ms once.
  const runs = [];
  const units = [];
  for (let i = 0; i < 9; i++) {
    const t0 = process.hrtime.bigint();
    renderStatusline(statuslineOffline({ stateFile, cacheDir }));
    runs.push(Number(process.hrtime.bigint() - t0) / 1e6);
    units.push(unitCostMs(calibration));
  }
  runs.sort((a, b) => a - b);
  units.sort((a, b) => a - b);
  const median = runs[4];
  assert.equal(statuslineOffline({ stateFile, cacheDir }).waiting, 400);

  const unit = units[4];
  const quiet = unit < QUIET_UNIT_MS;
  const ceiling = quiet ? BUDGET_MS : LOADED_CEILING_MS;
  t.diagnostic(
    `no-daemon path: median ${median.toFixed(2)} ms · unit ${unit.toFixed(2)} ms · ` +
      `ceiling ${ceiling} ms (${quiet ? 'quiet machine, the budget' : 'busy or slow machine'})`,
  );
  assert.ok(
    median < ceiling,
    quiet
      ? `no-daemon path took ${median.toFixed(2)} ms, budget is ${BUDGET_MS} ms`
      : `no-daemon path took ${median.toFixed(2)} ms. The ${BUDGET_MS} ms budget was not ` +
          `applied: a fixed unit of work costs ${unit.toFixed(2)} ms here against ~7 ms on the ` +
          `machine the budget was set on, so this clock is measuring contention. The loose ` +
          `${LOADED_CEILING_MS} ms ceiling still failed.`,
  );
});

test('only a port that is actually listening is spoken HTTP to', async () => {
  const probed = [];
  const asked = [];
  const found = await findDaemon({
    port: 4400,
    timeoutMs: 200,
    span: 3,
    probe: async (port) => {
      probed.push(port);
      return port === 4318;
    },
    ask: async (port, budget) => {
      asked.push({ port, budget });
      return null;
    },
  });
  assert.equal(found, null);
  assert.equal(probed[0], 4400, 'the named port is the first candidate');
  assert.deepEqual([...probed].sort(), [4317, 4318, 4319, 4400]);
  // The whole point: a refused port costs one TCP connect, and on a machine
  // with no daemon the HTTP client is never stood up at all.
  assert.deepEqual(
    asked.map((a) => a.port),
    [4318],
  );
});

test('a port that hangs costs the budget and not a second more', async () => {
  const t0 = Date.now();
  const found = await findDaemon({
    timeoutMs: 40,
    span: 4,
    probe: async () => true,
    ask: async (port, budget) => {
      await new Promise((r) => setTimeout(r, Math.min(budget, 500)));
      return null;
    },
  });
  assert.equal(found, null);
  // The budget is wall-clock, not per-port: once it is gone, nothing else is
  // asked, and the status line falls back to the files.
  assert.ok(Date.now() - t0 < 250, 'the search outran its own budget');
});

test('the daemon that answers is the one used', async () => {
  const found = await findDaemon({
    timeoutMs: 200,
    span: 2,
    probe: async () => true,
    ask: async (port) => (port === 4318 ? { port, snapshot: { agents: [], counts: {} } } : null),
  });
  assert.equal(found.port, 4318);
});

test('the only host this command ever contacts is 127.0.0.1', async () => {
  const urls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    throw new Error('refused');
  };
  try {
    await askDaemon(4317, 50);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(urls, ['http://127.0.0.1:4317/api/state']);
});

// ---------------------------------------------------------------------------
// The invariant
// ---------------------------------------------------------------------------

test('INVARIANT: printing the status line does not touch state.json', async () => {
  const { stateFile, cacheDir } = machine({
    sessions: [{ id: 'claude-code:a' }],
    ack: { 'claude-code:a': { state: 'active', reviewSince: 1_700_000_000_000 } },
  });
  const before = fs.readFileSync(stateFile);
  for (let i = 0; i < 3; i++) statuslineOffline({ stateFile, cacheDir });
  assert.deepEqual(fs.readFileSync(stateFile), before);
});

test('INVARIANT: an agent with no MK number is not given one by a read', () => {
  const { stateFile, cacheDir } = machine({
    sessions: [{ id: 'claude-code:a' }],
    identity: { projects: {}, agents: {}, projectOf: {}, names: {} },
  });
  const before = fs.readFileSync(stateFile, 'utf8');
  const deck = readOffline({ stateFile, cacheDir });
  assert.equal(deck.agents[0].mk, null);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), before);
});

// ---------------------------------------------------------------------------
// Install and remove
// ---------------------------------------------------------------------------

test('the plan is the literal JSON and the file it goes in', () => {
  const plan = describeInstall({ file: '/home/ada/.claude/settings.json' });
  assert.equal(plan.file, '/home/ada/.claude/settings.json');
  assert.deepEqual(JSON.parse(plan.json), {
    statusLine: { type: 'command', command: DEFAULT_COMMAND, refreshInterval: 5, _deckhq: true },
  });
  assert.match(plan.note, /Nothing leaves this computer/);
  assert.match(plan.note, /--remove/);
});

test('--install without --yes prints the plan and the path, and writes nothing', async () => {
  const dir = scratch('consent');
  const file = path.join(dir, 'settings.json');
  const out = [];
  const code = await runStatusline(['--install'], {
    write: (s) => out.push(s),
    settingsFile: file,
    backupDir: path.join(dir, 'backups'),
  });
  const text = out.join('');
  assert.equal(code, 0);
  assert.match(text, /"statusLine"/);
  assert.match(text, /"_deckhq": true/);
  assert.ok(text.includes(file));
  assert.match(text, /Nothing was changed/);
  assert.equal(fs.existsSync(file), false);
});

test('--install --yes writes the tagged block and backs the file up first', async () => {
  const dir = scratch('install');
  const file = path.join(dir, 'settings.json');
  const backupDir = path.join(dir, 'backups');
  await fsp.writeFile(file, JSON.stringify({ theme: 'dark', hooks: { Stop: [] } }, null, 2));

  const out = [];
  const code = await runStatusline(['--install', '--yes'], {
    write: (s) => out.push(s),
    settingsFile: file,
    backupDir,
  });
  assert.equal(code, 0);

  const written = JSON.parse(await fsp.readFile(file, 'utf8'));
  assert.equal(written.statusLine.type, 'command');
  assert.equal(written.statusLine.command, DEFAULT_COMMAND);
  assert.equal(written.statusLine._deckhq, true);
  // Everything that was already in the file is still in it.
  assert.equal(written.theme, 'dark');
  assert.deepEqual(written.hooks, { Stop: [] });

  const backups = await fsp.readdir(backupDir);
  assert.equal(backups.length, 1);
  const backup = JSON.parse(await fsp.readFile(path.join(backupDir, backups[0]), 'utf8'));
  assert.equal(backup.existed, true);
  assert.match(backup.raw, /"theme": "dark"/);
});

test('the backup file name does not collide with the hooks installer’s', async () => {
  const dir = scratch('backup-names');
  const file = await backupSettings({ dir, existed: false, raw: null, now: 123 });
  assert.equal(path.basename(file), 'statusline-backup-123.json');
  // hooks.mjs restores the newest `settings-backup-*.json` verbatim; ours must
  // never be picked up as one of those. docs/DEVIATIONS.md §92.
  assert.doesNotMatch(path.basename(file), /^settings-backup-\d+\.json$/);
});

test('--remove takes out only the entry DeckHQ wrote', async () => {
  const dir = scratch('remove');
  const file = path.join(dir, 'settings.json');
  const backupDir = path.join(dir, 'backups');
  await fsp.writeFile(file, JSON.stringify({ theme: 'dark' }, null, 2));
  await install({ file, backupDir });

  const out = [];
  const code = await runStatusline(['--remove', '--yes'], {
    write: (s) => out.push(s),
    settingsFile: file,
    backupDir,
  });
  assert.equal(code, 0);
  const after = JSON.parse(await fsp.readFile(file, 'utf8'));
  assert.equal('statusLine' in after, false);
  assert.equal(after.theme, 'dark');
});

test('--remove leaves somebody else’s status line exactly where it is', async () => {
  const dir = scratch('foreign');
  const file = path.join(dir, 'settings.json');
  const foreign = { type: 'command', command: 'my-own-script.sh' };
  const raw = JSON.stringify({ statusLine: foreign }, null, 2);
  await fsp.writeFile(file, raw);

  const errs = [];
  const code = await runStatusline(['--remove', '--yes'], {
    write: () => {},
    error: (s) => errs.push(s),
    settingsFile: file,
    backupDir: path.join(dir, 'backups'),
  });
  assert.equal(code, 1);
  assert.match(errs.join(''), /not written by DeckHQ/);
  assert.equal(await fsp.readFile(file, 'utf8'), raw);
});

test('an untagged status line of ours is still recognised as ours', () => {
  assert.equal(isOurStatusLine({ type: 'command', command: 'deckhq statusline' }), true);
  assert.equal(isOurStatusLine({ type: 'command', command: 'npx deckhq statusline --json' }), true);
  assert.equal(
    isOurStatusLine({ type: 'command', command: 'node "/opt/deckhq/bin/deckhq.mjs" statusline' }),
    true,
  );
  assert.equal(isOurStatusLine({ type: 'command', command: 'my-own-script.sh' }), false);
  assert.equal(isOurStatusLine({ _deckhq: true, command: 'anything' }), true);
  assert.equal(isOurStatusLine(null), false);
  assert.equal(isOurStatusLine('deckhq statusline'), false);
});

test('a settings file that is not valid JSON stops the install and changes nothing', async () => {
  const dir = scratch('broken');
  const file = path.join(dir, 'settings.json');
  await fsp.writeFile(file, '{ definitely not json');
  const errs = [];
  const code = await runStatusline(['--install', '--yes'], {
    write: () => {},
    error: (s) => errs.push(s),
    settingsFile: file,
    backupDir: path.join(dir, 'backups'),
  });
  assert.equal(code, 1);
  assert.match(errs.join(''), /not valid JSON/);
  assert.equal(await fsp.readFile(file, 'utf8'), '{ definitely not json');
});

test('removing when there is nothing of ours to remove says so and exits clean', async () => {
  const dir = scratch('nothing');
  const file = path.join(dir, 'settings.json');
  await fsp.writeFile(file, '{}');
  const out = [];
  const code = await runStatusline(['--remove', '--yes'], {
    write: (s) => out.push(s),
    settingsFile: file,
    backupDir: path.join(dir, 'backups'),
  });
  assert.equal(code, 0);
  assert.match(out.join(''), /Nothing to remove/);
});

test('an install into a machine with no settings file at all, then removed, leaves no file behind', async () => {
  const dir = scratch('absent');
  const file = path.join(dir, 'settings.json');
  const backupDir = path.join(dir, 'backups');
  await install({ file, backupDir });
  assert.equal(fs.existsSync(file), true);
  await remove({ file, backupDir });
  assert.equal(fs.existsSync(file), false);
});
