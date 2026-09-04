/**
 * The guard on the guard. `docs/DEVIATIONS.md` §123.
 *
 * `scripts/test.mjs` plants a **canary home** for the whole run — an empty
 * machine in a temp directory, holding one transcript whose title is a string
 * nobody should ever see — points `HOME`, `USERPROFILE` and `%APPDATA%` at it,
 * unsets every path override so each one is derived from it, and preloads
 * `test/helpers/canary.cjs` into every process. Any `fs` call that names a path
 * inside that home is written to a log, and the run fails on a non-empty log
 * naming the function, the path and the frame.
 *
 * That is the whole-suite assertion, and it is made by the runner rather than
 * by a test on purpose: it covers all 1,500 tests, including the file somebody
 * adds tomorrow, and it costs nothing, where a test that re-ran the suite
 * inside itself would double the wall clock to cover exactly the same ground
 * once.
 *
 * What is left for a test is the part the runner cannot check about itself:
 *
 *   1. **The tripwire can fail.** A guard that has never been seen to fire is
 *      a guard nobody should trust, so a child process is sent to read the
 *      canary and the log is asserted to have caught it.
 *   2. **The sentinel is invisible from an isolated floor.** The canary title
 *      would be the first thing on a floor, in a status line and in a snapshot
 *      if anything scanned that home. A real daemon is started against an
 *      isolated machine and the whole snapshot is searched for it.
 */
// First, and before anything under `src/`: it moves the machine.
import { daemonScratch, writeClaudeSession } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD = path.resolve(HERE, '../helpers/canary.cjs');

const { startDaemon } = await import('../../src/daemon.mjs');

test('the tripwire catches a read of the canary home, and names it', async () => {
  // A canary of this test's own, so nothing here disturbs the run's.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-canary-probe-'));
  const home = path.join(root, 'home');
  const log = path.join(root, 'reads.jsonl');
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(path.join(home, 'transcript.jsonl'), '{}\n', 'utf8');
  fs.writeFileSync(log, '', 'utf8');

  const source = `
    const fs = require('node:fs');
    const path = require('node:path');
    try { fs.readFileSync(path.join(process.env.DECKHQ_CANARY_HOME, 'transcript.jsonl'), 'utf8'); }
    catch {}
    try { fs.readdirSync(path.join(process.env.DECKHQ_CANARY_HOME, 'does-not-exist')); } catch {}
  `;

  await new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ['--require', PRELOAD, '-e', source],
      {
        env: {
          ...process.env,
          DECKHQ_CANARY_HOME: home,
          DECKHQ_CANARY_LOG: log,
          NODE_OPTIONS: '',
        },
      },
      (err) => (err ? reject(err) : resolve(undefined)),
    );
  });

  const records = fs
    .readFileSync(log, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));

  assert.ok(records.length >= 2, `the tripwire recorded ${records.length} of 2 accesses`);
  assert.ok(
    records.some((r) => r.fn === 'fs.readFileSync' && r.path.endsWith('transcript.jsonl')),
    'a read of a file that exists was not recorded',
  );
  assert.ok(
    records.some((r) => r.fn === 'fs.readdirSync' && r.path.endsWith('does-not-exist')),
    'an attempt on a path that does not exist was not recorded; an attempt is the defect',
  );
  for (const r of records) {
    assert.equal(typeof r.frame, 'string');
    assert.ok(r.frame.length > 0, 'a recorded access has to say where it came from');
  }

  fs.rmSync(root, { recursive: true, force: true });
});

test('the canary title reaches no floor, no count and no snapshot', async (t) => {
  const title = process.env.DECKHQ_CANARY_TITLE;
  if (!title) {
    t.skip('not running under scripts/test.mjs, so there is no canary to look for');
    return;
  }

  // The isolated machine has one session of its own on it, so this is a floor
  // with something on it rather than the actor floor — which is the case where
  // a leaked scan of the real home would actually show.
  const planted = writeClaudeSession({
    sessionId: '44444444-4444-4444-4444-444444444444',
    title: 'The only session this machine has',
    project: 'isolated',
  });
  const { stateFile, publicDir } = daemonScratch('guard-');
  const d = await startDaemon({ port: 0, stateFile, publicDir });
  try {
    await d.registry.refresh();
    const snapshot = await (await fetch(d.url + 'api/state')).json();

    assert.equal(snapshot.agents.length, 1, 'the isolated floor is not the only floor being read');
    assert.equal(snapshot.agents[0].title, planted.title);

    const text = JSON.stringify(snapshot);
    assert.equal(
      text.includes(title),
      false,
      'the canary session is on the floor: something scanned the home the suite is not allowed to read',
    );
    assert.equal(text.includes('canary-project'), false, 'the canary project reached the snapshot');

    // The same claim about the surfaces that quote a session rather than list
    // one: the conversation body and the wrapped card.
    const convo = await (
      await fetch(d.url + 'api/conversation?id=' + encodeURIComponent(snapshot.agents[0].id))
    ).text();
    assert.equal(convo.includes(title), false, 'the canary transcript was read as a conversation');
  } finally {
    await d.close();
    planted.remove();
  }
});
