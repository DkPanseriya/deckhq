/**
 * WP-100 · the two joins "go to session" is built on.
 *
 *   transcript id  ->  the desktop app's OWN id for that session
 *   session id     ->  the process it is running in
 *
 * The first matters because the app's deep link opens a session only by the
 * id the app minted (`local_…`), which is the name of the file it keeps for
 * that session; a transcript's uuid is refused. The second is what the walk
 * to a window starts from.
 *
 * Both read a store this project does not own, so both are run here against a
 * store this file wrote — never the developer's.
 */
// A machine of our own, before anything under `src/` is loaded.
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { APP_SESSION_ID, appSessionIdFor, clearDesktopCache } =
  await import('../../src/adapters/claude-code/desktop.mjs');
const { sessionPid } = await import('../../src/adapters/claude-code/adapter-live.mjs');

const CLI_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLI_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const CLI_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

async function makeStore() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-applink-'));
  const dir = path.join(root, 'install-1', 'profile-1');
  await fsp.mkdir(dir, { recursive: true });
  process.env.DECKHQ_DESKTOP_SESSIONS_DIR = root;
  clearDesktopCache();
  return { root, dir };
}

test('the app’s id for a session is the name of the file the app keeps for it', async () => {
  const store = await makeStore();
  try {
    const write = (name, record) =>
      fs.writeFileSync(path.join(store.dir, name), JSON.stringify(record), 'utf8');
    write('local_11111111-2222-3333-4444-555555555555.json', {
      sessionId: 'local_11111111-2222-3333-4444-555555555555',
      cliSessionId: CLI_A,
      isArchived: false,
    });
    // Archived in the app: its link handler looks only among sessions that
    // are not, so a link here would arrive at the app's default view.
    write('local_archived.json', {
      sessionId: 'local_archived',
      cliSessionId: CLI_B,
      isArchived: true,
    });
    // Not a session file at all, though it names a transcript.
    write('scheduled-tasks.json', { cliSessionId: CLI_C });

    assert.equal(await appSessionIdFor(CLI_A), 'local_11111111-2222-3333-4444-555555555555');
    assert.equal(await appSessionIdFor(CLI_B), null, 'an archived session is not one a link opens');
    assert.equal(await appSessionIdFor(CLI_C), null, 'a file not named like a session is not one');
    assert.equal(await appSessionIdFor('never-in-the-app'), null);
    assert.equal(await appSessionIdFor(''), null);

    // Un-archiving rewrites the file, and the answer follows on the next ask.
    write('local_archived.json', {
      sessionId: 'local_archived',
      cliSessionId: CLI_B,
      isArchived: false,
    });
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(path.join(store.dir, 'local_archived.json'), later, later);
    assert.equal(await appSessionIdFor(CLI_B), 'local_archived');
  } finally {
    delete process.env.DECKHQ_DESKTOP_SESSIONS_DIR;
    clearDesktopCache();
    await fsp.rm(store.root, { recursive: true, force: true });
  }
});

test('the id pattern is the app’s own, to the character', () => {
  assert.ok(APP_SESSION_ID.test('local_ab88288e-2d30-4c72-b919-6d9b6fd71002'));
  assert.ok(!APP_SESSION_ID.test('ab88288e-2d30-4c72-b919-6d9b6fd71002'));
  assert.ok(!APP_SESSION_ID.test('local_'));
  assert.ok(!APP_SESSION_ID.test('local_a b'));
  assert.ok(!APP_SESSION_ID.test(`local_${'a'.repeat(65)}`));
});

test('a session’s process comes from the live roster, and only when the roster names one', async () => {
  const sessions = async () => [
    {
      id: 'claude-code:live-1',
      runtime: 'claude-code',
      cwd: '/x',
      name: null,
      startedAt: 1,
      pid: 4242,
    },
    {
      id: 'claude-code:no-pid',
      runtime: 'claude-code',
      cwd: '/x',
      name: null,
      startedAt: 1,
      pid: null,
    },
    { id: 'claude-code:zero', runtime: 'claude-code', cwd: '/x', name: null, startedAt: 1, pid: 0 },
  ];
  assert.equal(await sessionPid('live-1', { sessions }), 4242);
  assert.equal(await sessionPid('claude-code:live-1', { sessions }), 4242, 'an agent id works too');
  assert.equal(await sessionPid('no-pid', { sessions }), null);
  assert.equal(await sessionPid('zero', { sessions }), null, 'pid 0 is not a process');
  assert.equal(await sessionPid('ended', { sessions }), null);
  assert.equal(await sessionPid('', { sessions }), null);
});
