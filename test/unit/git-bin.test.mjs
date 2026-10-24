/**
 * SECURITY: `git` IS STARTED BY ITS PATH ON PATH, NEVER FROM THE PROJECT FOLDER.
 *
 * The review card asks git what changed in a session's folder as soon as it
 * opens. On Windows a bare `git` would be looked for in that folder first.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gitBin } from '../../src/core/git-bin.mjs';

const present = (/** @type {string[]} */ files) => (/** @type {string} */ p) => files.includes(p);

test('SECURITY: on Windows git is the absolute path found on PATH, never a relative entry', () => {
  const env = { PATH: '.;bin;C:\\Program Files\\Git\\cmd', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  const isFile = present(['.\\git.exe', 'bin\\git.exe', 'C:\\Program Files\\Git\\cmd\\git.exe']);
  assert.equal(gitBin({ platform: 'win32', env, isFile }), 'C:\\Program Files\\Git\\cmd\\git.exe');
});

test('SECURITY: on Windows a git that only a shell could start is not used', () => {
  const env = { PATH: 'C:\\tools', PATHEXT: '.COM;.EXE;.BAT;.CMD' };
  assert.equal(gitBin({ platform: 'win32', env, isFile: present(['C:\\tools\\git.bat']) }), null);
});

test('on Windows with no git on PATH, nothing is returned to start', () => {
  assert.equal(gitBin({ platform: 'win32', env: { PATH: '' }, isFile: () => false }), null);
});

test('elsewhere the bare name is used: the search is PATH only', () => {
  assert.equal(gitBin({ platform: 'linux' }), 'git');
  assert.equal(gitBin({ platform: 'darwin' }), 'git');
});
