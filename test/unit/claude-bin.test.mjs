/**
 * SECURITY: `claude` IS STARTED BY ITS PATH ON PATH, NEVER FROM THE PROJECT.
 *
 * A reply from the panel runs `claude` in the session's project folder, and a
 * bare name is looked for there first on Windows. So the binary is found on
 * PATH, in absolute folders only, and where PATH has none nothing is started.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeBin } from '../../src/adapters/claude-code/claude-bin.mjs';
import { findOnPath } from '../../src/core/editor.mjs';
import { send } from '../../src/adapters/claude-code/adapter-send.mjs';

test('claude is found on PATH, as an absolute path, and only as something spawn can start', () => {
  const have = new Set([
    'C:\\Tools\\claude.cmd',
    'C:\\Users\\a\\.local\\bin\\claude.exe',
    'C:\\Repo\\claude.exe',
  ]);
  const isFile = (/** @type {string} */ p) => have.has(p);
  const env = { PATH: 'C:\\Tools;C:\\Users\\a\\.local\\bin', PATHEXT: '.CMD;.EXE' };
  assert.equal(
    claudeBin({ env, platform: 'win32', isFile }),
    'C:\\Users\\a\\.local\\bin\\claude.exe',
    'a .cmd shim cannot be started without a shell, so it is passed over',
  );
  assert.equal(
    claudeBin({
      env: { PATH: '/usr/local/bin' },
      platform: 'linux',
      isFile: (p) => p === '/usr/local/bin/claude',
    }),
    '/usr/local/bin/claude',
  );
  assert.equal(claudeBin({ env: { PATH: '' }, platform: 'win32', isFile }), null);
});

test('a relative PATH entry is the working folder, and is never searched', () => {
  const isFile = (/** @type {string} */ p) =>
    p === '.\\claude.exe' || p === 'bin\\claude.exe' || p === './claude';
  assert.equal(
    findOnPath('claude', { env: { PATH: '.;bin' }, platform: 'win32', isFile, exts: ['.exe'] }),
    null,
  );
  assert.equal(findOnPath('claude', { env: { PATH: '.' }, platform: 'linux', isFile }), null);
});

test('with no claude on PATH a reply starts nothing and says why', async () => {
  const saved = process.env.PATH;
  process.env.PATH = '';
  try {
    const got = await send('claude-code:abc', 'hello', { cwd: process.cwd() });
    assert.deepEqual(got, { ok: false, error: 'claude is not on PATH' });
  } finally {
    process.env.PATH = saved;
  }
});
