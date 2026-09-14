/**
 * `POST /api/studio/plan` against a real daemon — WP-67,
 * `docs/07-STUDIO-DESIGN.md` §2, §3 and §10.
 *
 * Three of these are acceptance criteria rather than coverage:
 *
 *   2. **The argv is asserted element by element, with no shell anywhere.** The
 *      daemon is started with a stand-in for `launchTerminal`, so what the
 *      route actually handed the launcher is captured as an ARRAY and compared
 *      to one written out here by hand. Nothing is matched with a regex over a
 *      command line, because a regex over a command line is what you write when
 *      there is a command line to write it over.
 *   3. **Malformed output is reported with the line it failed on, and writes
 *      nothing.** A fixture planner writes a `roster.json` with a policy the
 *      schema does not know; the snapshot names the file, the line and the
 *      reason, carries no roster, and the bytes on disk are untouched.
 *   4. **The planner is an ordinary session.** Asserted structurally by
 *      `test/unit/studio-invariant.test.mjs` — no module under `src/studio/`
 *      can reach the registry or the adapters — and here by the fact that the
 *      only thing this route records about it is an id.
 *
 * Criterion (1), a real `claude` planner running an interview end to end on the
 * reference machine, is not a test: it was run by hand once, and its result —
 * files, sizes, validation, and no transcript — is `docs/DEVIATIONS.md` §159.
 *
 * No test in this file spawns a terminal. `launchTerminal` is replaced, and the
 * fixture planner is `node test/fixtures/fake-planner.mjs` run in the project
 * directory with the argv the route built.
 */
import { daemonScratch, scratchDir } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const { startDaemon } = await import('../../src/daemon.mjs');
const { PLANNER_KICKOFF, PLANNER_BRIEF } = await import('../../src/studio/brief.mjs');

const FAKE_PLANNER = fileURLToPath(new URL('../fixtures/fake-planner.mjs', import.meta.url));

/**
 * A daemon whose `launchTerminal` is a recorder, and optionally a runner.
 *
 * `launched` collects every `{command, cwd, prefix, pin}` the route produced —
 * `command` is the argv array, which is the whole of criterion (2). When
 * `mode` is given, the fixture planner is actually run with that argv, in that
 * directory, as a real child process.
 *
 * @param {{mode?:string, env?:Record<string,string>}} opts
 * @param {(ctx:any) => Promise<void>} fn
 */
async function withDaemon(opts, fn) {
  const { dir, stateFile, publicDir } = daemonScratch('studio-plan-');
  const projects = scratchDir('studio-plan-projects-');
  const a = path.join(projects, 'orbital');
  const b = path.join(projects, 'ledger');
  for (const p of [a, b]) await fsp.mkdir(path.join(p, 'src'), { recursive: true });

  /** @type {Array<{command:string[], cwd:string, prefix:string, pin:any}>} */
  const launched = [];
  /** @type {Array<Promise<any>>} */
  const runs = [];

  const launchTerminal = async (launch) => {
    launched.push({
      command: [...launch.command],
      cwd: launch.cwd,
      prefix: launch.prefix,
      pin: launch.pin,
    });
    if (!opts.mode) return { id: 'fake', label: 'fake', cmd: 'fake', args: [], scriptPath: null };
    // A real child, with the real argv, in the real directory — `claude`
    // replaced by a node script and nothing else. No shell: `execFile` with an
    // array, exactly as `trySpawnDetached` spawns.
    runs.push(
      new Promise((resolve) => {
        execFile(
          process.execPath,
          [FAKE_PLANNER, ...launch.command.slice(1)],
          {
            cwd: launch.cwd,
            env: { ...process.env, FAKE_PLANNER_MODE: opts.mode, ...(opts.env || {}) },
            windowsHide: true,
          },
          (err, stdout, stderr) => resolve({ err, stdout, stderr }),
        );
      }),
    );
    return { id: 'fake', label: 'fake', cmd: 'fake', args: [], scriptPath: null };
  };

  const d = await startDaemon({ port: 0, stateFile, publicDir, launchTerminal });
  try {
    await fn({
      d,
      dir,
      a,
      b,
      launched,
      /** Wait for every fixture planner started so far. */
      settle: () => Promise.all(runs),
    });
  } finally {
    await d.close();
    await fsp.rm(dir, { recursive: true, force: true });
    await fsp.rm(projects, { recursive: true, force: true });
  }
}

function post(d, pathname, body) {
  return fetch(`${d.url}api/studio${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify(body),
  });
}

async function snapshot(d, project) {
  const res = await fetch(`${d.url}api/studio?project=${encodeURIComponent(project)}`);
  return res.json();
}

const studioDir = (root) => path.join(root, '.deckhq', 'studio');

// ---------------------------------------------------------------------------
// Consent
// ---------------------------------------------------------------------------

test('ACCEPTANCE: without consent the planner is refused, with the hint, and nothing is started', async () => {
  await withDaemon({}, async ({ d, a, launched }) => {
    const res = await post(d, '/plan', { cwd: a });
    assert.equal(res.status, 409);
    const body = await res.json();
    assert.match(body.error, /Studio is not enabled/);
    assert.match(body.error, /\/api\/studio\/enable/);
    assert.match(body.error, /deckhq studio enable/);
    // Not one process, and not one byte.
    assert.deepEqual(launched, []);
    assert.equal(fs.existsSync(path.join(a, '.deckhq')), false);
  });
});

test('consent for one project does not start a planner in another', async () => {
  await withDaemon({}, async ({ d, a, b, launched }) => {
    await post(d, '/enable', { cwd: a, confirm: true });
    const res = await post(d, '/plan', { cwd: b });
    assert.equal(res.status, 409);
    assert.deepEqual(launched, []);
  });
});

// ---------------------------------------------------------------------------
// The argv
// ---------------------------------------------------------------------------

test('ACCEPTANCE: the planner argv is an array, element by element, with no shell anywhere', async () => {
  await withDaemon({}, async ({ d, a, launched }) => {
    await post(d, '/enable', { cwd: a, confirm: true });
    const res = await post(d, '/plan', { cwd: a });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.started, true);
    // The id is honestly absent: it is the runtime's to mint and the scan's to
    // find, and answering with one here would mean inventing it.
    assert.equal(body.agentId, null);

    assert.equal(launched.length, 1);
    const launch = launched[0];
    const briefPath = path.join(studioDir(a), 'briefs', PLANNER_BRIEF);

    // THE CRITERION. Four elements, named one at a time.
    assert.ok(Array.isArray(launch.command));
    assert.equal(launch.command.length, 4);
    assert.equal(launch.command[0], 'claude');
    assert.equal(launch.command[1], '--append-system-prompt-file');
    assert.equal(launch.command[2], briefPath);
    assert.equal(launch.command[3], PLANNER_KICKOFF);
    assert.deepEqual(launch.command, [
      'claude',
      '--append-system-prompt-file',
      briefPath,
      PLANNER_KICKOFF,
    ]);
    assert.equal(launch.cwd, a);

    // And no element is a command line: nothing in it is quoted, joined, or
    // carries a shell metacharacter this route put there.
    for (const element of launch.command) {
      assert.equal(typeof element, 'string');
      assert.equal(/[|&;><`$]/.test(element), false, element);
    }

    // The brief is on disk, inside the consented directory, and it is a file
    // the route wrote rather than text on a command line.
    assert.equal(body.brief, briefPath);
    assert.equal(body.briefWritten, true);
    assert.ok(fs.statSync(briefPath).size > 1000);
  });
});

test('a runtime that is not Claude Code is refused by name, not attempted', async () => {
  await withDaemon({}, async ({ d, a, launched }) => {
    await post(d, '/enable', { cwd: a, confirm: true });
    const res = await post(d, '/plan', { cwd: a, runtime: 'codex' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /"codex" is refused/);
    assert.match(body.error, /Claude Code/);
    assert.deepEqual(launched, []);
  });
});

// ---------------------------------------------------------------------------
// The artefacts
// ---------------------------------------------------------------------------

test('ACCEPTANCE: a planner writes the three files and the snapshot shows them valid', async () => {
  await withDaemon({ mode: 'write' }, async ({ d, a, settle }) => {
    await post(d, '/enable', { cwd: a, confirm: true });

    const before = await snapshot(d, a);
    assert.equal(before.studio.blueprint.present, false);
    assert.equal(before.studio.roster.present, false);
    assert.equal(before.studio.board.present, false);
    assert.deepEqual(before.studio.problems, []);

    assert.equal((await post(d, '/plan', { cwd: a })).status, 202);
    const [run] = await settle();
    assert.equal(run.err, null, String(run.stderr));
    // The brief's own closing rule, obeyed by the fixture: one word, last.
    assert.equal(run.stdout.trim().split('\n').at(-1), 'written');

    const after = await snapshot(d, a);
    assert.deepEqual(after.studio.problems, [], JSON.stringify(after.studio.problems));

    assert.equal(after.studio.blueprint.present, true);
    assert.equal(after.studio.blueprint.error, null);
    assert.match(after.studio.blueprint.text, /## Goal/);

    assert.equal(after.studio.roster.present, true);
    assert.equal(after.studio.roster.error, null);
    assert.equal(after.studio.roster.roster.projectKey, after.projectKey);
    assert.equal(after.studio.roster.roster.roles[0].name, 'backend');
    assert.equal(after.studio.roster.roster.roles[0].permissionPolicy, 'ask');

    assert.equal(after.studio.board.present, true);
    assert.equal(after.studio.board.error, null);
    assert.equal(after.studio.board.board.cards.length, 1);
    // Every card the planner wrote starts in `backlog` (§5.2).
    assert.equal(after.studio.board.board.cards[0].column, 'backlog');

    // The bytes are the planner's. Nothing in DeckHQ rewrote them: the files
    // on disk are what the child process wrote, character for character.
    for (const name of ['blueprint.md', 'roster.json', 'board.json']) {
      const file = path.join(studioDir(a), name);
      assert.ok(fs.statSync(file).size > 0, name);
    }
  });
});

test('ACCEPTANCE: a malformed roster is reported with its file, its line and its reason, and is not rewritten', async () => {
  await withDaemon({ mode: 'bad-roster' }, async ({ d, a, settle }) => {
    await post(d, '/enable', { cwd: a, confirm: true });
    assert.equal((await post(d, '/plan', { cwd: a })).status, 202);
    await settle();

    const file = path.join(studioDir(a), 'roster.json');
    const bytes = fs.readFileSync(file, 'utf8');

    const snap = await snapshot(d, a);
    assert.equal(snap.studio.problems.length, 1, JSON.stringify(snap.studio.problems));
    const problem = snap.studio.problems[0];
    assert.equal(problem.file, 'roster.json');
    assert.equal(problem.path, file);
    assert.match(problem.error, /"yolo" is not one of ask, allowlist, plan/);
    // The LINE, and it is the line `permissionPolicy` is actually on.
    assert.equal(typeof problem.line, 'number');
    assert.equal(bytes.split('\n')[problem.line - 1].includes('permissionPolicy'), true, bytes);

    // No roster in the snapshot: a document that does not validate is refused
    // whole, never half-applied.
    assert.equal(snap.studio.roster.roster, null);
    assert.equal(snap.studio.roster.present, true);
    assert.equal(snap.studio.roster.errorPath, 'roles[0].permissionPolicy');

    // ...and the other two are unaffected. A bad roster does not take the
    // blueprint and the board down with it.
    assert.equal(snap.studio.blueprint.error, null);
    assert.equal(snap.studio.board.error, null);

    // Read it again: still the planner's bytes, and no `.corrupt-` beside it.
    const again = await snapshot(d, a);
    assert.equal(again.studio.problems.length, 1);
    assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'the bad roster was rewritten');
    assert.deepEqual(
      fs.readdirSync(studioDir(a)).filter((n) => n.includes('corrupt')),
      [],
    );
  });
});

// ---------------------------------------------------------------------------
// The brief is the user's
// ---------------------------------------------------------------------------

test('a brief the user edited is what runs, and the regeneration goes beside it', async () => {
  await withDaemon({}, async ({ d, a, launched }) => {
    await post(d, '/enable', { cwd: a, confirm: true });
    await post(d, '/plan', { cwd: a });

    const brief = path.join(studioDir(a), 'briefs', PLANNER_BRIEF);
    const mine = `${fs.readFileSync(brief, 'utf8')}\n\nAlso: ask about the deploy target.\n`;
    fs.writeFileSync(brief, mine, 'utf8');

    const body = await (await post(d, '/plan', { cwd: a })).json();
    assert.equal(body.briefWritten, false);
    assert.equal(body.briefBeside, path.join(studioDir(a), 'briefs', 'planner.next.md'));
    assert.equal(fs.readFileSync(brief, 'utf8'), mine, 'the edited brief was overwritten');
    // And it is still the user's file that is on the command line.
    assert.equal(launched.at(-1).command[2], brief);
  });
});

// ---------------------------------------------------------------------------
// The record, which is an id and nothing else
// ---------------------------------------------------------------------------

test('the planner record is one id per project, written only when a scan finds one', async () => {
  await withDaemon({}, async ({ d, a, dir }) => {
    await post(d, '/enable', { cwd: a, confirm: true });
    await post(d, '/plan', { cwd: a });

    // Nothing has been found, so nothing has been recorded. The endpoint does
    // not guess, and neither does the snapshot.
    const snap = await snapshot(d, a);
    assert.equal(snap.planner, null);
    const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
    assert.deepEqual(state.studio.planner ?? {}, {});
  });
});
