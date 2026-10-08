/**
 * The resume-target preference (`resumeIn`), the pinned terminal (`terminal`,
 * WP-04) and the Claude Code desktop-app hand-off (`openInApp` /
 * `buildAppResumeUri`).
 *
 * Nothing here spawns a real process. `openInApp`'s availability check is
 * always overridden via its `checkAvailable` test seam (see adapter.mjs) so
 * the "no handler" path can be exercised without touching the Windows
 * registry or the machine's actual `claude://` registration — and the
 * success path (which would genuinely spawn `cmd /c start ...`) is
 * deliberately never exercised here at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { Readable } from 'node:stream';

import { Store, DEFAULT_SETTINGS, RESUME_TARGETS, TERMINAL_AUTO } from '../../src/core/store.mjs';
import { adapter, buildAppResumeUri } from '../../src/adapters/claude-code/adapter.mjs';
import { terminalIds } from '../../src/adapters/claude-code/terminals.mjs';
import { register as registerSettings } from '../../src/http/routes/settings.mjs';
import { dropRoot, onRoot, storeRoot } from '../helpers/store-root.mjs';

const tmpFile = () => storeRoot('resume');

/**
 * Wait for every store opened on this root, then take the root away. Removing
 * it while a 250 ms debounced write is still owed is the race §185 records —
 * ENOENT on POSIX, ENOTEMPTY on Windows, and neither is about resuming.
 */
const cleanup = (dir) => dropRoot(dir);

// ---------------------------------------------------------- resumeIn / store

test('RESUME_TARGETS names exactly "app" and "terminal"', () => {
  assert.deepEqual([...RESUME_TARGETS], ['app', 'terminal']);
});

test('resumeIn defaults to "terminal"', async () => {
  const { dir, file } = await tmpFile();
  try {
    assert.equal(DEFAULT_SETTINGS.resumeIn, 'terminal');
    const store = onRoot(dir, new Store(file));
    await store.load();
    assert.equal(store.settings.resumeIn, 'terminal');
  } finally {
    await cleanup(dir);
  }
});

test('resumeIn round-trips through setSettings', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = onRoot(dir, new Store(file));
    await store.load();

    store.setSettings({ resumeIn: 'app' });
    assert.equal(store.settings.resumeIn, 'app');

    store.setSettings({ resumeIn: 'terminal' });
    assert.equal(store.settings.resumeIn, 'terminal');

    // Untouched by a patch that does not mention it.
    store.setSettings({ resumeIn: 'app' });
    store.setSettings({ notifications: false });
    assert.equal(store.settings.resumeIn, 'app');
  } finally {
    await cleanup(dir);
  }
});

test('setSettings rejects an invalid resumeIn, falling back to the default rather than storing it', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = onRoot(dir, new Store(file));
    await store.load();

    store.setSettings({ resumeIn: 'app' });
    assert.equal(store.settings.resumeIn, 'app');

    // A bogus string must not silently become the new stored value.
    store.setSettings({ resumeIn: 'browser-tab' });
    assert.equal(store.settings.resumeIn, DEFAULT_SETTINGS.resumeIn);

    // Nor may a wrong-typed value.
    store.setSettings({ resumeIn: 'app' });
    store.setSettings({ resumeIn: 123 });
    assert.equal(store.settings.resumeIn, DEFAULT_SETTINGS.resumeIn);
  } finally {
    await cleanup(dir);
  }
});

test('load() sanitizes an invalid resumeIn found on disk instead of treating the file as corrupt', async () => {
  const { dir, file } = await tmpFile();
  try {
    await fs.writeFile(
      file,
      JSON.stringify({ version: 1, settings: { resumeIn: 'not-a-real-target' } }),
      'utf8',
    );
    const store = onRoot(dir, new Store(file));
    await store.load();
    assert.equal(store.settings.resumeIn, 'terminal');
    // A sanitized field is not the same thing as a corrupt file: no
    // "<file>.corrupt-*" backup should have been written for this.
    const entries = await fs.readdir(dir);
    assert.ok(!entries.some((f) => f.includes('.corrupt-')));
  } finally {
    await cleanup(dir);
  }
});

// ------------------------------------------------------- terminal / store

test('the terminal pin defaults to auto, and detection is what "auto" means', async () => {
  const { dir, file } = await tmpFile();
  try {
    assert.equal(DEFAULT_SETTINGS.terminal, TERMINAL_AUTO);
    const store = onRoot(dir, new Store(file));
    await store.load();
    assert.equal(store.settings.terminal, 'auto');
  } finally {
    await cleanup(dir);
  }
});

test('a terminal pin round-trips through setSettings and survives unrelated patches', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = onRoot(dir, new Store(file));
    await store.load();

    store.setSettings({ terminal: 'ghostty' });
    assert.equal(store.settings.terminal, 'ghostty');

    store.setSettings({ notifications: false });
    assert.equal(store.settings.terminal, 'ghostty');

    store.setSettings({ terminal: TERMINAL_AUTO });
    assert.equal(store.settings.terminal, 'auto');
  } finally {
    await cleanup(dir);
  }
});

test('SECURITY: the store keeps anything shell-shaped out of the terminal pin', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = onRoot(dir, new Store(file));
    await store.load();
    // The store validates by shape, not by membership — the emulator table
    // lives in the adapter and `core/` must not import from there. What it
    // guarantees is that the stored value can never be a path, a flag, a
    // shell fragment or a non-string.
    for (const bad of [
      '/bin/sh -c "curl evil|sh"',
      '../../../bin/sh',
      '$(id)',
      'ghostty; rm -rf ~',
      'Ghostty',
      '-e',
      '',
      '   ',
      123,
      null,
      { id: 'ghostty' },
      ['ghostty'],
    ]) {
      store.setSettings({ terminal: 'kitty' });
      store.setSettings({ terminal: bad });
      assert.equal(store.settings.terminal, TERMINAL_AUTO, `accepted ${JSON.stringify(bad)}`);
    }
  } finally {
    await cleanup(dir);
  }
});

test('load() sanitizes a hand-edited terminal pin rather than calling the file corrupt', async () => {
  const { dir, file } = await tmpFile();
  try {
    await fs.writeFile(
      file,
      JSON.stringify({ version: 1, settings: { terminal: '/usr/bin/sh -c evil' } }),
      'utf8',
    );
    const store = onRoot(dir, new Store(file));
    await store.load();
    assert.equal(store.settings.terminal, TERMINAL_AUTO);
    const entries = await fs.readdir(dir);
    assert.ok(!entries.some((f) => f.includes('.corrupt-')));
  } finally {
    await cleanup(dir);
  }
});

// ------------------------------------------------- terminal / the settings route

/** Drive one registered route with a fake request and collect the response. */
async function postSettings(store, body) {
  /** @type {Map<string, Function>} */
  const posts = new Map();
  const router = {
    get: () => router,
    post: (p, h) => {
      posts.set(p, h);
      return router;
    },
  };
  registerSettings(/** @type {any} */ (router), {
    store,
    registry: { onSettingsChanged() {} },
    log: { warn() {} },
  });

  // Buffers, not strings: `readJson` concatenates the chunks as bytes, which
  // is what a real socket delivers.
  const req = Readable.from([Buffer.from(JSON.stringify(body), 'utf8')]);
  /** @type {{status:number|null, body:any}} */
  const out = { status: null, body: null };
  const res = {
    writeHead(status) {
      out.status = status;
    },
    end(payload) {
      out.body = JSON.parse(payload);
    },
  };
  await posts.get('/api/settings')(req, res);
  return out;
}

test('the settings route accepts every emulator id the table offers, on any platform', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = onRoot(dir, new Store(file));
    await store.load();
    // Including ids for other platforms: a state file that moves between a Mac
    // and a Linux box is not a bad request, and detection ignores a pin it
    // cannot resolve.
    for (const id of terminalIds()) {
      const res = await postSettings(store, { terminal: id });
      assert.equal(res.status, 200, id);
      assert.equal(res.body.terminal, id);
    }
  } finally {
    await cleanup(dir);
  }
});

test('the settings route rejects a terminal id no platform has, rather than storing it', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = onRoot(dir, new Store(file));
    await store.load();
    store.setSettings({ terminal: 'kitty' });

    for (const bad of ['hyper', 'sh', '', 'GHOSTTY', 42, null, ['kitty']]) {
      const res = await postSettings(store, { terminal: bad });
      // Nothing known was in the body, so the whole request is a 400 and the
      // stored value is untouched — not quietly reset to the default.
      assert.equal(res.status, 400, JSON.stringify(bad));
      assert.equal(store.settings.terminal, 'kitty');
    }
  } finally {
    await cleanup(dir);
  }
});

// ---------------------------------------------------------------- the URI

// WP-100. These two used to assert a link carrying the TRANSCRIPT's id and a
// `&source=deckhq` tag. Measured against Claude desktop 2.26454: the app
// refuses that id (`code entry link invalid ?session`, in its own log) and
// opens a session only by its own `local_…` id; and the `&` ended the command
// `cmd /c start` was given, so the tag never arrived. What is asserted now is
// the link the app was seen to honour.

test('buildAppResumeUri builds the claude://code/continue deep link from the app’s own id', () => {
  const uri = buildAppResumeUri('local_ab88288e-2d30-4c72-b919-6d9b6fd71002');
  assert.equal(uri, 'claude://code/continue?session=local_ab88288e-2d30-4c72-b919-6d9b6fd71002');
});

test('SECURITY: buildAppResumeUri refuses anything that is not an id the app minted', () => {
  // The link is handed to `cmd /c start` on Windows. An id that passes the
  // app's own pattern has nothing in it `cmd` reads as syntax; anything else
  // is refused here rather than quoted.
  for (const bad of [
    '733ff312-32b1-426c-a677-4847240dd7b2', // a transcript's id: the app refuses it too
    'local_x & calc',
    'local_x&source=deckhq',
    'local_',
    `local_${'a'.repeat(65)}`,
    'weird id/with?special&chars=1',
    '',
  ]) {
    assert.throws(() => buildAppResumeUri(bad), /not an id/i, bad);
  }
  assert.doesNotMatch(buildAppResumeUri('local_abc-123'), /[&|^<>%" ]/);
});

test('openInApp hands the OS the app’s id for the session, and nothing when the app has no record of it', async () => {
  const sent = [];
  const dispatch = async (uri) => {
    sent.push(uri);
  };
  await adapter.openInApp('733ff312-32b1-426c-a677-4847240dd7b2', process.cwd(), {
    checkAvailable: async () => true,
    appIdFor: async (id) => (id === '733ff312-32b1-426c-a677-4847240dd7b2' ? 'local_abc' : null),
    dispatch,
  });
  assert.deepEqual(sent, ['claude://code/continue?session=local_abc']);

  // A session started in a terminal is not the app's: say so, send nothing.
  await assert.rejects(
    () =>
      adapter.openInApp('a-terminal-session', process.cwd(), {
        checkAvailable: async () => true,
        appIdFor: async () => null,
        dispatch,
      }),
    /no record of this session/,
  );
  assert.equal(sent.length, 1, 'nothing was dispatched for a session the app cannot open');

  assert.equal(
    await adapter.appAvailableFor('a-terminal-session', {
      checkAvailable: async () => true,
      appIdFor: async () => null,
    }),
    false,
    '"resume in app" is not offered where the app would arrive nowhere',
  );
  assert.equal(
    await adapter.appAvailableFor('x', {
      checkAvailable: async () => true,
      appIdFor: async () => 'local_abc',
    }),
    true,
  );
  assert.equal(
    await adapter.appAvailableFor('x', {
      checkAvailable: async () => false,
      appIdFor: async () => 'local_abc',
    }),
    false,
  );
});

// ----------------------------------------------------------- openInApp gate

test('openInApp throws a clear error when no handler is available, without spawning anything', async () => {
  let checked = false;
  await assert.rejects(
    () =>
      adapter.openInApp('some-session-id', process.cwd(), {
        checkAvailable: async () => {
          checked = true;
          return false;
        },
      }),
    /claude:\/\/|desktop app/i,
  );
  assert.equal(checked, true, 'the availability check must actually have run');
});
