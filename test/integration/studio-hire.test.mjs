/**
 * `POST /api/studio/hire` against a real daemon — WP-68, §4 and §10.
 *
 * The four acceptance criteria, in order:
 *
 *   1. **Three roles give three worktrees, three briefs and three sessions on
 *      the floor within one scan, each wearing its role name.** Real `git
 *      worktree add` on a real temp repository; the fake CLI writes a real
 *      transcript in each worktree; the registry finds them by the ORDINARY
 *      scan and `pendingIdentities` puts the role name on each.
 *   2. **The argv is an array, element by element, with no shell anywhere** —
 *      asserted after it has been through `execFile`, from the file the
 *      fixture wrote, not from the object the route built.
 *   3. **A runtime with no `openNewSession` is refused by name**, and so are a
 *      role name with a space, a quote or a `;`, a Hire with no consent, and a
 *      seventh role — that one with the count.
 *   4. **Firing leaves the worktree and the process alone, and says so.**
 *
 * No test here opens a terminal. `launchTerminal` is a recorder that runs
 * `node test/fixtures/fake-hire.mjs` with the argv the route built.
 */
import { CLAUDE_DIR, daemonScratch, scratchDir } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const { startDaemon } = await import('../../src/daemon.mjs');
const { describeFire, projectSlug } = await import('../../src/studio/worktree.mjs');
const { hireKickoff } = await import('../../src/studio/brief-role.mjs');
const { MAX_HIRE_AT_ONCE } = await import('../../src/studio/schema.mjs');
// The adapter registry the daemon itself uses: the same module object, so
// taking `openNewSession` off one here is taking it off the one the route
// looks up. Put back in a `finally`, every time.
const adapters = await import('../../src/adapters/index.mjs');

const FAKE_HIRE = fileURLToPath(new URL('../fixtures/fake-hire.mjs', import.meta.url));

const ROSTER = (projectKey, names) => ({
  version: 1,
  projectKey,
  roles: names.map((name) => ({
    name,
    purpose: `Owns the ${name} half.`,
    systemPrompt: `You are the ${name}.`,
    allowedTools: [],
    permissionPolicy: 'ask',
    agentId: null,
  })),
});

/** A real git repository with a commit, because `worktree add` needs a HEAD. */
async function gitRepo(dir) {
  const run = (argv) =>
    new Promise((resolve, reject) =>
      execFile('git', argv, { cwd: dir, windowsHide: true }, (err, out) =>
        err ? reject(err) : resolve(out),
      ),
    );
  await fsp.mkdir(dir, { recursive: true });
  await run(['init', '-q']);
  await run(['config', 'user.email', 't@example.com']);
  await run(['config', 'user.name', 'Test']);
  await fsp.writeFile(path.join(dir, 'README.md'), '# a project\n', 'utf8');
  await run(['add', '.']);
  await run(['commit', '-qm', 'first']);
}

/**
 * @param {{run?:boolean}} opts `run` actually starts the fixture CLI
 * @param {(ctx:any) => Promise<void>} fn
 */
async function withDaemon(opts, fn) {
  const { dir, stateFile, publicDir } = daemonScratch('studio-hire-');
  const projects = scratchDir('studio-hire-projects-');
  const project = path.join(projects, 'orbital');
  await gitRepo(project);

  const argvDir = path.join(dir, 'argv');
  // Where the route will put them: the daemon's data directory is the one its
  // `stateFile` lives in, and `<data>/worktrees` is `worktreesDirFor()`.
  const worktrees = path.join(dir, 'worktrees');
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
    if (opts.run) {
      runs.push(
        new Promise((resolve) => {
          execFile(
            process.execPath,
            [FAKE_HIRE, ...launch.command.slice(1)],
            {
              cwd: launch.cwd,
              env: { ...process.env, FAKE_HIRE_ARGV_DIR: argvDir, CLAUDE_CONFIG_DIR: CLAUDE_DIR },
              windowsHide: true,
            },
            (err, stdout, stderr) => resolve({ err, stdout, stderr }),
          );
        }),
      );
    }
    return { id: 'fake', label: 'fake', cmd: 'fake', args: [], scriptPath: null };
  };

  const d = await startDaemon({ port: 0, stateFile, publicDir, launchTerminal });
  try {
    await fn({
      d,
      dir,
      project,
      launched,
      argvDir,
      worktrees,
      settle: () => Promise.all(runs),
    });
  } finally {
    await d.close();
    // Best-effort, and it has to be: these are git worktrees on Windows, where
    // a `.git` file the OS still has a handle on answers EBUSY for a moment
    // after the process that touched it exited. Everything here is under the
    // isolated root, which goes at the end of the run either way, so a
    // cleanup that could not finish must not fail a test that passed.
    for (const victim of [worktrees, dir, projects]) {
      await fsp
        .rm(victim, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
        .catch(() => {});
    }
  }
}

function post(d, pathname, body) {
  return fetch(`${d.url}api/studio${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', connection: 'close' },
    body: JSON.stringify(body),
  });
}

const studioDir = (root) => path.join(root, '.deckhq', 'studio');

/** Enable Studio and put a roster with these role names on disk. */
async function seed(d, project, names) {
  await post(d, '/enable', { cwd: project, confirm: true });
  const snap = await (
    await fetch(`${d.url}api/studio?project=${encodeURIComponent(project)}`)
  ).json();
  await fsp.mkdir(studioDir(project), { recursive: true });
  await fsp.writeFile(
    path.join(studioDir(project), 'roster.json'),
    `${JSON.stringify(ROSTER(snap.projectKey, names), null, 2)}\n`,
    'utf8',
  );
  return snap.projectKey;
}

// ---------------------------------------------------------------------------
// The refusals, every one of which happens before anything is made
// ---------------------------------------------------------------------------

test('ACCEPTANCE: without consent a Hire is refused, and nothing is created', async () => {
  await withDaemon({}, async ({ d, project, launched, worktrees }) => {
    const res = await post(d, '/hire', { cwd: project, role: 'backend' });
    assert.equal(res.status, 409);
    assert.match((await res.json()).error, /Studio is not enabled/);
    assert.deepEqual(launched, []);
    assert.equal(fs.existsSync(worktrees), false);
  });
});

test('ACCEPTANCE: a role name with a space, a quote or a ";" is refused by its own reason', async () => {
  await withDaemon({}, async ({ d, project, launched, worktrees }) => {
    await seed(d, project, ['backend']);
    for (const [name, reason] of [
      ['back end', 'role-space'],
      ['back"end', 'role-quote'],
      ['back;end', 'role-semicolon'],
      ['-backend', 'role-leading-dash'],
      ['back/end', 'role-separator'],
    ]) {
      const res = await post(d, '/hire', { cwd: project, role: name });
      assert.equal(res.status, 400, name);
      const body = await res.json();
      assert.equal(body.reason, reason, name);
      assert.equal(body.role, name);
      assert.match(body.error, /refuses a role name it would have to escape/);
    }
    assert.deepEqual(launched, []);
    assert.equal(fs.existsSync(worktrees), false);
  });
});

test('ACCEPTANCE: a seventh role is refused WITH THE COUNT, and nothing is created', async () => {
  await withDaemon({}, async ({ d, project, launched, worktrees }) => {
    const names = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7'];
    await seed(d, project, names);
    const res = await post(d, '/hire', { cwd: project, roles: names });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.count, 7);
    assert.equal(body.max, MAX_HIRE_AT_ONCE);
    assert.match(body.error, /at most 6 roles and this one names 7/);
    assert.deepEqual(launched, []);
    assert.equal(fs.existsSync(worktrees), false);
  });
});

test('ACCEPTANCE: a runtime with no openNewSession is refused BY NAME', async () => {
  await withDaemon({}, async ({ d, project, launched }) => {
    await seed(d, project, ['backend']);
    // A runtime this build does not have at all.
    const unknown = await post(d, '/hire', { cwd: project, role: 'backend', runtime: 'nope' });
    assert.equal(unknown.status, 404);
    assert.match((await unknown.json()).error, /Unknown runtime "nope"/);

    // And one it has, with that method taken away.
    const adapter = adapters.getAdapter('codex');
    const real = adapter.openNewSession;
    delete adapter.openNewSession;
    try {
      const res = await post(d, '/hire', { cwd: project, role: 'backend', runtime: 'codex' });
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.match(body.error, /^Codex cannot start a new session/);
      assert.match(body.error, /refused by name rather than silently skipped/);
    } finally {
      adapter.openNewSession = real;
    }
    assert.deepEqual(launched, []);
  });
});

test('a role that is not in roster.json is refused rather than invented', async () => {
  await withDaemon({}, async ({ d, project, launched }) => {
    await seed(d, project, ['backend']);
    const res = await post(d, '/hire', { cwd: project, role: 'frontend' });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.reason, 'role-unknown');
    assert.match(body.error, /not a role in this project's roster\.json/);
    assert.deepEqual(launched, []);
  });
});

// ---------------------------------------------------------------------------
// The argv
// ---------------------------------------------------------------------------

test('ACCEPTANCE: the spawn argv is an array, element by element, with no shell anywhere', async () => {
  await withDaemon({ run: true }, async ({ d, project, launched, argvDir, worktrees, settle }) => {
    await seed(d, project, ['backend']);
    const res = await post(d, '/hire', { cwd: project, role: 'backend' });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.equal(body.hired.length, 1);
    assert.deepEqual(body.refused, []);

    const hired = body.hired[0];
    const worktree = path.join(worktrees, `${projectSlug(project)}-backend`);
    assert.equal(hired.worktree, worktree);
    assert.equal(hired.branch, 'studio/backend');
    assert.equal(hired.worktreeCreated, true);
    assert.deepEqual(hired.worktreeArgv, ['worktree', 'add', worktree, '-b', 'studio/backend']);
    // The id is honestly absent: the runtime mints it and the scan finds it.
    assert.equal(hired.agentId, null);

    const brief = path.join(studioDir(project), 'briefs', 'backend.md');
    assert.equal(hired.brief, brief);
    assert.equal(hired.briefWritten, true);
    assert.equal(hired.briefBeside, null);

    assert.equal(launched.length, 1);
    assert.deepEqual(launched[0].command, [
      'claude',
      '--append-system-prompt-file',
      brief,
      hireKickoff(brief),
    ]);
    assert.equal(launched[0].cwd, worktree);

    // And the same array, after `execFile` has carried it to a real process.
    await settle();
    const seen = JSON.parse(
      fs.readFileSync(path.join(argvDir, path.basename(worktree) + '.json'), 'utf8'),
    );
    assert.deepEqual(seen.argv, ['--append-system-prompt-file', brief, hireKickoff(brief)]);
    assert.equal(path.resolve(seen.cwd), worktree);
    // The brief's BODY is never on the command line.
    assert.ok(!seen.argv.some((a) => a.includes('## 1. The plan')));
  });
});

// ---------------------------------------------------------------------------
// Three roles, three worktrees, three briefs, three sessions
// ---------------------------------------------------------------------------

test('ACCEPTANCE: three roles give three worktrees, three briefs and three named sessions', async () => {
  await withDaemon({ run: true }, async ({ d, project, launched, worktrees, settle }) => {
    const names = ['backend', 'frontend', 'docs'];
    await seed(d, project, names);

    const res = await post(d, '/hire', { cwd: project, roles: names });
    assert.equal(res.status, 202);
    const body = await res.json();
    assert.deepEqual(body.refused, []);
    assert.equal(body.hired.length, 3);
    assert.equal(launched.length, 3);

    for (const name of names) {
      const worktree = path.join(worktrees, `${projectSlug(project)}-${name}`);
      assert.ok(fs.existsSync(worktree), `${name} has no worktree`);
      assert.ok(fs.existsSync(path.join(worktree, 'README.md')), `${name}'s worktree is empty`);
      const brief = path.join(studioDir(project), 'briefs', `${name}.md`);
      assert.ok(fs.existsSync(brief), `${name} has no brief`);
      assert.match(fs.readFileSync(brief, 'utf8'), new RegExp(`You are the ${name}`));
    }
    // rules.md, created once by the first of the three.
    assert.equal(body.hired.filter((h) => h.rulesWritten).length, 1);

    // The sessions the fixture wrote, found by the ORDINARY scan.
    await settle();
    await d.registry.refresh();
    const state = await (await fetch(`${d.url}api/state`)).json();
    const mine = (state.agents || []).filter((a) =>
      path.resolve(a.cwd || '').startsWith(worktrees),
    );
    assert.equal(mine.length, 3, `found ${mine.length} sessions in the worktrees`);
    assert.deepEqual(
      // §156 applies a queued name as `displayName` in `snapshot()`, which is
      // what `/api/state` carries. That is the mechanism §4 names, unchanged.
      mine.map((a) => a.displayName).sort(),
      [...names].sort(),
      'the sessions are not wearing their role names',
    );

    // And the roster now carries an agentId per role, from that same scan.
    //
    // Polled, not awaited: the record is a write the scan's own listener makes
    // after the scan returns, and pretending otherwise would be a test that
    // passes because it happened to be slow enough. The poll TURNS THE CRANK —
    // EVERY round asks for another scan and waits for it — because that is what
    // a real floor does: the registry polls on a timer, so a role whose
    // transcript was not on disk yet when one pass ran is found by the next
    // one. A test with no timer that only slept would be asserting that every
    // one of the three landed on a single pass, which is a stronger claim than
    // §4 makes and one a loaded machine can fail on nothing.
    //
    // The ceiling is a FAILURE PATH, not a wait: the loop leaves the instant
    // the three ids are on disk, which on an idle machine is the first round.
    // It is generous because the thing it bounds is a whole `npm test` running
    // beside this one — §190. What it must never be is a guess at how long the
    // scan takes, which is what a fixed round count was.
    const rosterFile = path.join(studioDir(project), 'roster.json');
    const readRoster = () => {
      try {
        return JSON.parse(fs.readFileSync(rosterFile, 'utf8'));
      } catch {
        return { roles: [] };
      }
    };
    const complete = (r) => r.roles.length === names.length && r.roles.every((x) => x.agentId);
    const deadline = Date.now() + 45_000;
    /** @type {any} */
    let roster = readRoster();
    let turns = 0;
    while (!complete(roster) && Date.now() < deadline) {
      await d.registry.refresh().catch(() => {});
      // The record is chained behind the listener that the refresh just ran,
      // so yield once before reading the file it writes.
      await new Promise((r) => setTimeout(r, 25));
      roster = readRoster();
      turns += 1;
    }
    assert.ok(
      complete(roster),
      `after ${turns} scans in ${Math.round((45_000 - (deadline - Date.now())) / 1000)}s the ` +
        `roster is ${JSON.stringify(roster.roles.map((r) => [r.name, r.agentId]))}`,
    );
    assert.deepEqual(roster.roles.map((r) => r.name).sort(), [...names].sort());
    for (const role of roster.roles) {
      assert.ok(role.agentId, `${role.name} has no agentId`);
      assert.ok(
        mine.some((a) => a.id === role.agentId),
        `${role.name}'s agentId is not a session on the floor`,
      );
    }
  });
});

test('hiring the same role twice reuses the worktree and does not rewrite the brief', async () => {
  await withDaemon({}, async ({ d, project }) => {
    await seed(d, project, ['backend']);
    const first = (await (await post(d, '/hire', { cwd: project, role: 'backend' })).json())
      .hired[0];
    const second = (await (await post(d, '/hire', { cwd: project, role: 'backend' })).json())
      .hired[0];
    assert.equal(first.worktreeCreated, true);
    assert.equal(second.worktreeCreated, false);
    assert.equal(second.worktreeReused, true);
    assert.equal(second.worktreeArgv, null);
    assert.equal(second.briefWritten, false);
    assert.equal(second.briefReason, 'identical');
    assert.equal(second.briefBeside, null);
  });
});

test('a brief the user edited is left alone and the regeneration is reported beside it', async () => {
  await withDaemon({}, async ({ d, project }) => {
    await seed(d, project, ['backend']);
    await post(d, '/hire', { cwd: project, role: 'backend' });
    const brief = path.join(studioDir(project), 'briefs', 'backend.md');
    await fsp.writeFile(brief, '# Mine\n', 'utf8');

    const hired = (await (await post(d, '/hire', { cwd: project, role: 'backend' })).json())
      .hired[0];
    assert.equal(hired.briefWritten, false);
    assert.equal(hired.briefReason, 'edited');
    assert.ok(hired.briefBeside.endsWith(`backend.next.md`));
    assert.equal(fs.readFileSync(brief, 'utf8'), '# Mine\n');
  });
});

test('a Codex role is hired and flagged UNVERIFIED LAUNCH', async () => {
  await withDaemon({}, async ({ d, project, launched }) => {
    await seed(d, project, ['backend']);
    const adapter = adapters.getAdapter('codex');
    const real = adapter.openNewSession;
    // Codex's own `openNewSession` checks that Codex is installed; this is
    // about the route's answer, not about whether the reference machine has it.
    adapter.openNewSession = async (cwd, o) => {
      await (o.launch || (() => {}))({
        command: ['codex', o.instructions],
        cwd,
        prefix: 'codex-new',
      });
    };
    try {
      const res = await post(d, '/hire', { cwd: project, role: 'backend', runtime: 'codex' });
      assert.equal(res.status, 202);
      const hired = (await res.json()).hired[0];
      assert.equal(hired.runtime, 'codex');
      assert.match(hired.unverified, /unverified launch/);
      assert.match(hired.unverified, /no Codex terminal has ever been opened/);
      // The brief still travels as a path, in one argv element.
      assert.equal(launched.length, 1);
      assert.deepEqual(launched[0].command, ['codex', hireKickoff(hired.brief)]);
    } finally {
      adapter.openNewSession = real;
    }
  });
});

// ---------------------------------------------------------------------------
// Fire
// ---------------------------------------------------------------------------

test('ACCEPTANCE: firing leaves the worktree and the process alone, and says so', async () => {
  await withDaemon({}, async ({ d, project }) => {
    await seed(d, project, ['backend']);
    const hired = (await (await post(d, '/hire', { cwd: project, role: 'backend' })).json())
      .hired[0];
    const marker = path.join(hired.worktree, 'work.txt');
    await fsp.writeFile(marker, 'an agent did this\n', 'utf8');

    const fired = describeFire({ role: 'backend', worktree: hired.worktree, branch: hired.branch });
    assert.equal(fired.removedWorktree, false);
    assert.equal(fired.removedBranch, false);
    assert.equal(fired.stoppedProcess, false);
    assert.match(fired.note, /untouched/);
    assert.match(fired.note, /does not signal a process it did not start/);
    assert.deepEqual(fired.youCouldRun, ['git', 'worktree', 'remove', hired.worktree]);

    // Nothing was run and nothing was removed.
    assert.ok(fs.existsSync(hired.worktree));
    assert.equal(fs.readFileSync(marker, 'utf8'), 'an agent did this\n');
  });
});
