/**
 * Project actions.
 *
 * This module runs scripts, so its tests are mostly about what it REFUSES to
 * run. Nothing here executes anything: discovery and path confinement are what
 * decide whether execution is safe, so those are what is tested.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { discoverActions, runAction } from '../../src/core/actions.mjs';

async function project(files = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-actions-'));
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(dir, name);
    await fs.mkdir(path.dirname(full), { recursive: true });
    await fs.writeFile(full, body);
  }
  return dir;
}

test('every project offers its folder, whether or not it has scripts', async () => {
  const dir = await project();
  const actions = await discoverActions(dir);
  assert.ok(
    actions.some((a) => a.id === 'reveal' && a.kind === 'reveal'),
    'a project always has a folder to open',
  );
  await fs.rm(dir, { recursive: true, force: true });
});

test('a conventional dashboard script is discovered without configuration', async () => {
  const name = process.platform === 'win32' ? 'dashboard.bat' : 'dashboard.sh';
  const dir = await project({ [name]: 'echo hi' });
  const actions = await discoverActions(dir);
  const dash = actions.find((a) => a.id === 'dashboard');
  assert.ok(dash, `${name} should be discovered`);
  assert.equal(dash.kind, 'run');
  assert.equal(dash.file, name);
  await fs.rm(dir, { recursive: true, force: true });
});

test('a project with no script offers no runnable action', async () => {
  const dir = await project({ 'README.md': '# hi' });
  const actions = await discoverActions(dir);
  assert.ok(!actions.some((a) => a.kind === 'run'), 'nothing to run means no screen on the floor');
  await fs.rm(dir, { recursive: true, force: true });
});

test('a manifest can bind extra actions to furniture', async () => {
  const dir = await project({
    'tools/report.sh': 'echo report',
    '.deckhq.json': JSON.stringify({
      actions: [
        { id: 'report', label: 'Daily report', file: 'tools/report.sh', furniture: 'shelf' },
        { id: 'docs', label: 'Docs', url: 'https://example.com/docs' },
      ],
    }),
  });
  const actions = await discoverActions(dir);
  const report = actions.find((a) => a.id === 'report');
  assert.ok(report, 'a manifest action should be offered');
  assert.equal(report.kind, 'run');
  assert.equal(report.furniture, 'shelf');
  const docs = actions.find((a) => a.id === 'docs');
  assert.equal(docs.kind, 'open');
  await fs.rm(dir, { recursive: true, force: true });
});

test('SAFETY: a manifest cannot point at a file outside its own project', async () => {
  const outside = await project({ 'evil.sh': 'echo pwned' });
  const dir = await project({
    '.deckhq.json': JSON.stringify({
      actions: [
        { id: 'escape', label: 'escape', file: '../evil.sh' },
        { id: 'absolute', label: 'absolute', file: path.join(outside, 'evil.sh') },
        { id: 'deep', label: 'deep', file: '../../../../etc/passwd' },
      ],
    }),
  });
  const actions = await discoverActions(dir);
  for (const id of ['escape', 'absolute', 'deep']) {
    assert.ok(!actions.some((a) => a.id === id), `${id} must be refused, not clamped`);
  }
  await fs.rm(dir, { recursive: true, force: true });
  await fs.rm(outside, { recursive: true, force: true });
});

test('SAFETY: a manifest cannot name a file that does not exist', async () => {
  const dir = await project({
    '.deckhq.json': JSON.stringify({ actions: [{ id: 'ghost', file: 'nope.sh' }] }),
  });
  const actions = await discoverActions(dir);
  assert.ok(!actions.some((a) => a.id === 'ghost'));
  await fs.rm(dir, { recursive: true, force: true });
});

test('SAFETY: only http(s) URLs may be opened', async () => {
  const dir = await project({
    '.deckhq.json': JSON.stringify({
      actions: [
        { id: 'file', label: 'file', url: 'file:///etc/passwd' },
        { id: 'js', label: 'js', url: 'javascript:alert(1)' },
        { id: 'ok', label: 'ok', url: 'http://localhost:3000' },
      ],
    }),
  });
  const actions = await discoverActions(dir);
  assert.ok(!actions.some((a) => a.id === 'file'), 'file: URLs must be refused');
  assert.ok(!actions.some((a) => a.id === 'js'), 'javascript: URLs must be refused');
  assert.ok(actions.some((a) => a.id === 'ok'));
  await fs.rm(dir, { recursive: true, force: true });
});

test('SAFETY: runAction refuses a path that escapes the project', async () => {
  const dir = await project({ 'ok.sh': 'echo ok' });
  await assert.rejects(
    () => runAction(dir, { id: 'x', label: 'x', kind: 'run', file: '../../../evil.sh' }),
    /outside its project|no longer exists/,
  );
  await fs.rm(dir, { recursive: true, force: true });
});

test('a malformed manifest is ignored rather than breaking discovery', async () => {
  const dir = await project({ '.deckhq.json': '{ not json' });
  const actions = await discoverActions(dir);
  assert.ok(
    actions.some((a) => a.id === 'reveal'),
    'convention still stands when the manifest is unreadable',
  );
  await fs.rm(dir, { recursive: true, force: true });
});

test('a missing directory yields no actions rather than throwing', async () => {
  const actions = await discoverActions(path.join(os.tmpdir(), 'deckhq-does-not-exist-xyz'));
  assert.deepEqual(actions, []);
});
