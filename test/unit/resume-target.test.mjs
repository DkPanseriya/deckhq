/**
 * The resume-target preference (`resumeIn`) and the Claude Code desktop-app
 * hand-off (`openInApp` / `buildAppResumeUri`).
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
import os from 'node:os';
import path from 'node:path';

import { Store, DEFAULT_SETTINGS, RESUME_TARGETS } from '../../src/core/store.mjs';
import { adapter, buildAppResumeUri } from '../../src/adapters/claude-code/adapter.mjs';

async function tmpFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-resume-'));
  return { dir, file: path.join(dir, 'state.json') };
}

async function cleanup(dir) {
  await fs.rm(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------- resumeIn / store

test('RESUME_TARGETS names exactly "app" and "terminal"', () => {
  assert.deepEqual([...RESUME_TARGETS], ['app', 'terminal']);
});

test('resumeIn defaults to "terminal"', async () => {
  const { dir, file } = await tmpFile();
  try {
    assert.equal(DEFAULT_SETTINGS.resumeIn, 'terminal');
    const store = new Store(file);
    await store.load();
    assert.equal(store.settings.resumeIn, 'terminal');
  } finally {
    await cleanup(dir);
  }
});

test('resumeIn round-trips through setSettings', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = new Store(file);
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
    const store = new Store(file);
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
    const store = new Store(file);
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

// ---------------------------------------------------------------- the URI

test('buildAppResumeUri builds the claude://code/continue deep link', () => {
  const uri = buildAppResumeUri('abc-123');
  assert.equal(uri, 'claude://code/continue?session=abc-123&source=deckhq');
});

test('buildAppResumeUri URL-encodes the session id', () => {
  // A session id is normally a UUID, but the function must not assume
  // that — anything with URL-meaningful characters must still survive an
  // unambiguous round trip through the query string.
  const raw = 'weird id/with?special&chars=1';
  const uri = buildAppResumeUri(raw);

  assert.ok(
    uri.includes(encodeURIComponent(raw)),
    'the encoded session id should appear verbatim in the URI',
  );
  assert.ok(!uri.includes('id/with?special'), 'the raw, unencoded id must not appear');

  // And it decodes back to exactly the original value.
  const parsed = new URL(uri.replace(/^claude:\/\//, 'https://'));
  assert.equal(parsed.searchParams.get('session'), raw);
  assert.equal(parsed.searchParams.get('source'), 'deckhq');
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
