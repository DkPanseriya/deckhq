/**
 * The state file is written temp-then-rename. On Windows the rename fails for a
 * moment when another process has the file open; a write that gave up on the
 * first EPERM lost every acknowledgement since the last good one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../../src/core/store.mjs';

const quiet = { error() {}, warn() {}, info() {}, debug() {} };
const busy = (code) => Object.assign(new Error(`${code}: file in use`), { code });

test('a rename refused while another process holds the file is retried, and the write lands', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-retry-'));
  const file = path.join(dir, 'state.json');
  let attempts = 0;
  const rename = async (from, to) => {
    attempts += 1;
    if (attempts <= 2) throw busy('EPERM');
    await fsp.rename(from, to);
  };
  const store = new Store(file, { log: quiet, rename });
  await store.load();
  store.save();
  await store.flush();
  assert.equal(attempts, 3);
  assert.equal(store.writeError, null);
  assert.ok(fs.existsSync(file));
  assert.deepEqual(fs.readdirSync(dir), ['state.json']);
});

test('a write that keeps failing is reported, leaves no temp file, and is tried again on shutdown', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-retry-'));
  const file = path.join(dir, 'state.json');
  let locked = true;
  const rename = async (from, to) => {
    if (locked) throw busy('EBUSY');
    await fsp.rename(from, to);
  };
  const store = new Store(file, { log: quiet, rename });
  await store.load();
  store.save();
  await store.flush();
  assert.ok(store.writeError, 'the failure is surfaced');
  assert.deepEqual(fs.readdirSync(dir), [], 'no temp file is left behind');

  locked = false;
  await store.flush(); // shutdown: nothing scheduled, but the last write failed
  assert.equal(store.writeError, null);
  assert.ok(fs.existsSync(file));
});

test('a rename error that is not "file in use" is not retried', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-retry-'));
  let attempts = 0;
  const rename = async () => {
    attempts += 1;
    throw busy('ENOSPC');
  };
  const store = new Store(path.join(dir, 'state.json'), { log: quiet, rename });
  await store.load();
  store.save();
  await store.flush();
  assert.equal(attempts, 1);
  assert.match(store.writeError.message, /ENOSPC/);
});
