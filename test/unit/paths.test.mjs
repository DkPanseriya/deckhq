/**
 * Where state lives, and the one-time carry-over from where it used to live.
 *
 * The user-owned half of the model is the product. Keeping it in the package
 * directory meant `npx` could evict it on a version bump and a root-owned
 * global install could not write it at all — both silent. These tests pin the
 * location and the migration.
 *
 * The module reads the environment at import time, so it is imported per
 * scenario in a child process rather than once at the top of this file.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const PATHS_MODULE = path.resolve(HERE, '../../src/core/paths.mjs');

/**
 * Import paths.mjs in a fresh process with `env` applied, run `body` there,
 * and return whatever it prints as JSON.
 * @param {Record<string,string>} env
 * @param {string} body  JavaScript with `paths` in scope; must call out(value)
 */
function inChild(env, body) {
  const script = `
    const paths = await import(${JSON.stringify('file://' + PATHS_MODULE.replace(/\\/g, '/'))});
    const out = (v) => process.stdout.write(JSON.stringify(v));
    ${body}
  `;
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  return JSON.parse(stdout);
}

async function tmpdir(prefix) {
  return fsp.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('state lives under the home directory, never inside the package', async () => {
  const home = await tmpdir('deckhq-home-');
  const result = inChild(
    { HOME: home, USERPROFILE: home, DECKHQ_STATE_DIR: '' },
    'out(paths.STATE_FILE)',
  );
  assert.equal(result, path.join(home, '.deckhq', 'state.json'));
  await fsp.rm(home, { recursive: true, force: true });
});

test('DECKHQ_STATE_DIR overrides the location', async () => {
  const custom = await tmpdir('deckhq-custom-');
  const result = inChild(
    { DECKHQ_STATE_DIR: custom },
    'out({ state: paths.STATE_FILE, backups: paths.BACKUP_DIR })',
  );
  assert.equal(result.state, path.join(custom, 'state.json'));
  assert.equal(result.backups, path.join(custom, 'backups'));
  await fsp.rm(custom, { recursive: true, force: true });
});

test('a legacy state.json beside the package is carried over once', async () => {
  const legacy = await tmpdir('deckhq-legacy-');
  const data = await tmpdir('deckhq-data-');
  const payload = JSON.stringify({ version: 1, ack: { 'claude-code:x': { state: 'benched' } } });
  await fsp.writeFile(path.join(legacy, 'state.json'), payload, 'utf8');
  await fsp.mkdir(path.join(legacy, 'state'), { recursive: true });
  await fsp.writeFile(path.join(legacy, 'state', 'settings-backup-1.json'), '{}', 'utf8');

  const result = inChild(
    { DECKHQ_STATE_DIR: data },
    `out(paths.migrateLegacyState(${JSON.stringify(legacy)}))`,
  );

  assert.deepEqual(result, { state: true, backups: 1 });
  assert.equal(fs.readFileSync(path.join(data, 'state.json'), 'utf8'), payload);
  assert.ok(fs.existsSync(path.join(data, 'backups', 'settings-backup-1.json')));
  // The old copy is left where it was: a half-completed move loses the file.
  assert.ok(fs.existsSync(path.join(legacy, 'state.json')));

  await fsp.rm(legacy, { recursive: true, force: true });
  await fsp.rm(data, { recursive: true, force: true });
});

test('migration never overwrites state that already exists at the new location', async () => {
  const legacy = await tmpdir('deckhq-legacy-');
  const data = await tmpdir('deckhq-data-');
  await fsp.writeFile(path.join(legacy, 'state.json'), '{"from":"legacy"}', 'utf8');
  await fsp.writeFile(path.join(data, 'state.json'), '{"from":"current"}', 'utf8');

  const result = inChild(
    { DECKHQ_STATE_DIR: data },
    `out(paths.migrateLegacyState(${JSON.stringify(legacy)}))`,
  );

  assert.equal(result.state, false);
  assert.equal(fs.readFileSync(path.join(data, 'state.json'), 'utf8'), '{"from":"current"}');

  await fsp.rm(legacy, { recursive: true, force: true });
  await fsp.rm(data, { recursive: true, force: true });
});

test('migration with nothing to migrate is a silent no-op', async () => {
  const legacy = await tmpdir('deckhq-legacy-');
  const data = await tmpdir('deckhq-data-');
  const result = inChild(
    { DECKHQ_STATE_DIR: data },
    `out(paths.migrateLegacyState(${JSON.stringify(legacy)}))`,
  );
  assert.deepEqual(result, { state: false, backups: 0 });
  await fsp.rm(legacy, { recursive: true, force: true });
  await fsp.rm(data, { recursive: true, force: true });
});
