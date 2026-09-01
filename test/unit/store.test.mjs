import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Store, DEFAULT_SETTINGS } from '../../src/core/store.mjs';

/** A log that records calls instead of writing to stderr, for assertions. */
function fakeLog() {
  const calls = { info: [], warn: [], error: [], debug: [] };
  return {
    calls,
    info: (...a) => calls.info.push(a),
    warn: (...a) => calls.warn.push(a),
    error: (...a) => calls.error.push(a),
    debug: (...a) => calls.debug.push(a),
  };
}

async function tmpFile() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-store-'));
  return { dir, file: path.join(dir, 'state.json') };
}

async function cleanup(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('load() with no file on disk starts from defaults', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = new Store(file);
    await store.load();
    assert.deepEqual(store.settings, DEFAULT_SETTINGS);
    assert.equal(store.seededAt, null);
    assert.deepEqual(store.allAck(), {});
  } finally {
    await cleanup(dir);
  }
});

test('setSettings merges and clamps stallWindowMs to 2-120 minutes', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = new Store(file);
    await store.load();

    store.setSettings({ notifications: false });
    assert.equal(store.settings.notifications, false);
    assert.equal(store.settings.stallWindowMs, DEFAULT_SETTINGS.stallWindowMs);

    store.setSettings({ stallWindowMs: 1000 }); // below 2 minutes
    assert.equal(store.settings.stallWindowMs, 2 * 60 * 1000);

    store.setSettings({ stallWindowMs: 999 * 60 * 1000 }); // above 120 minutes
    assert.equal(store.settings.stallWindowMs, 120 * 60 * 1000);

    store.setSettings({ stallWindowMs: 30 * 60 * 1000 }); // within range
    assert.equal(store.settings.stallWindowMs, 30 * 60 * 1000);
  } finally {
    await cleanup(dir);
  }
});

test('seededAt / markSeeded round-trips', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = new Store(file);
    await store.load();
    assert.equal(store.seededAt, null);
    store.markSeeded(12345);
    assert.equal(store.seededAt, 12345);
  } finally {
    await cleanup(dir);
  }
});

test('getAck/setAck/allAck round-trip and merge patches', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = new Store(file);
    await store.load();

    assert.equal(store.getAck('claude-code:a'), undefined);

    store.setAck('claude-code:a', { state: 'benched' });
    let rec = store.getAck('claude-code:a');
    assert.equal(rec.state, 'benched');
    assert.equal(rec.reviewSince, null);
    assert.equal(rec.needsInputSince, null);
    assert.equal(typeof rec.updatedAt, 'number');

    store.setAck('claude-code:a', { reviewSince: 555 });
    rec = store.getAck('claude-code:a');
    // patch merges onto the existing record rather than replacing it
    assert.equal(rec.state, 'benched');
    assert.equal(rec.reviewSince, 555);

    const all = store.allAck();
    assert.deepEqual(Object.keys(all), ['claude-code:a']);

    // returned records are copies, not live references
    rec.state = 'let_go';
    assert.equal(store.getAck('claude-code:a').state, 'benched');
  } finally {
    await cleanup(dir);
  }
});

test('save() debounces: no write appears before ~250ms, one appears after', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = new Store(file);
    await store.load();

    store.setAck('claude-code:a', { state: 'benched' });
    assert.equal(fs.existsSync(file), false, 'must not write synchronously');

    await sleep(100);
    assert.equal(fs.existsSync(file), false, 'must not write before the debounce window elapses');

    await sleep(300);
    assert.equal(fs.existsSync(file), true, 'must have written after the debounce window');
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(onDisk.ack['claude-code:a'].state, 'benched');
  } finally {
    await cleanup(dir);
  }
});

test('rapid successive writes coalesce into the latest state', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = new Store(file);
    await store.load();

    store.setAck('claude-code:a', { state: 'active' });
    store.setAck('claude-code:a', { state: 'benched' });
    store.setAck('claude-code:a', { state: 'let_go' });

    await sleep(350);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(onDisk.ack['claude-code:a'].state, 'let_go');
  } finally {
    await cleanup(dir);
  }
});

test('flush() writes immediately without waiting for the debounce window', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = new Store(file);
    await store.load();

    store.setAck('claude-code:a', { state: 'benched' });
    assert.equal(fs.existsSync(file), false);

    await store.flush();
    assert.equal(fs.existsSync(file), true);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(onDisk.ack['claude-code:a'].state, 'benched');
  } finally {
    await cleanup(dir);
  }
});

test('flush() with nothing pending resolves immediately and is a no-op', async () => {
  const { dir, file } = await tmpFile();
  try {
    const store = new Store(file);
    await store.load();
    await store.flush(); // nothing scheduled, nothing in flight
    assert.equal(fs.existsSync(file), false);
  } finally {
    await cleanup(dir);
  }
});

test('ATOMIC WRITE SURVIVAL: an interrupted write never corrupts the readable state.json', async () => {
  const { dir, file } = await tmpFile();
  try {
    const good = {
      version: 1,
      seededAt: 1000,
      settings: { ...DEFAULT_SETTINGS },
      ack: {
        'claude-code:abc': {
          state: 'benched',
          reviewSince: null,
          needsInputSince: null,
          updatedAt: 1,
        },
      },
    };
    fs.writeFileSync(file, JSON.stringify(good, null, 2), 'utf8');

    // Simulate a process kill *mid-write*: a write always goes to
    // "<file>.tmp-<pid>" first and only then replaces state.json via
    // fs.rename. A crash between those two steps leaves a stray temp file
    // and state.json completely untouched — that is the guarantee under
    // test, and it holds regardless of what garbage ends up in the temp
    // file, because state.json is never opened for direct writing.
    const tmpPath = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, '{"not": "valid json at all, and also truncated mid-obj', 'utf8');

    // state.json must still be exactly what it was, and still parseable.
    const onDisk = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(onDisk);
    assert.deepEqual(parsed, good);

    // A fresh Store pointed at the same file must load the good data fine.
    const store = new Store(file);
    await store.load();
    assert.equal(store.seededAt, 1000);
    assert.deepEqual(store.getAck('claude-code:abc'), good.ack['claude-code:abc']);

    // The leftover stray temp file must not block a subsequent real save:
    // our write always overwrites the temp path fully before renaming.
    store.setAck('claude-code:abc', { state: 'active' });
    await store.flush();
    const after = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(after.ack['claude-code:abc'].state, 'active');
  } finally {
    await cleanup(dir);
  }
});

test('load() recovers from unparseable JSON: backs up, warns, starts from defaults', async () => {
  const { dir, file } = await tmpFile();
  try {
    fs.writeFileSync(file, '{ this is not json ]]', 'utf8');
    const log = fakeLog();
    const store = new Store(file, { log });
    await store.load();

    assert.deepEqual(store.settings, DEFAULT_SETTINGS);
    assert.equal(store.seededAt, null);
    assert.equal(log.calls.warn.length, 1);

    const entries = fs.readdirSync(dir);
    const backup = entries.find((f) => f.startsWith('state.json.corrupt-'));
    assert.ok(backup, 'expected a corrupt-* backup file');
    assert.equal(fs.readFileSync(path.join(dir, backup), 'utf8'), '{ this is not json ]]');
  } finally {
    await cleanup(dir);
  }
});

test('load() recovers from valid JSON with the wrong top-level shape', async () => {
  const { dir, file } = await tmpFile();
  try {
    fs.writeFileSync(file, JSON.stringify(['not', 'an', 'object']), 'utf8');
    const log = fakeLog();
    const store = new Store(file, { log });
    await store.load();

    assert.deepEqual(store.settings, DEFAULT_SETTINGS);
    assert.equal(log.calls.warn.length, 1);
    const backup = fs.readdirSync(dir).find((f) => f.startsWith('state.json.corrupt-'));
    assert.ok(backup, 'expected a corrupt-* backup file');
  } finally {
    await cleanup(dir);
  }
});

test('load() fills in missing fields from a partial-but-valid file without treating it as corrupt', async () => {
  const { dir, file } = await tmpFile();
  try {
    fs.writeFileSync(file, JSON.stringify({ version: 1 }), 'utf8');
    const log = fakeLog();
    const store = new Store(file, { log });
    await store.load();

    assert.deepEqual(store.settings, DEFAULT_SETTINGS);
    assert.deepEqual(store.allAck(), {});
    assert.equal(log.calls.warn.length, 0, 'a partial file is not corrupt');
    const backup = fs.readdirSync(dir).find((f) => f.startsWith('state.json.corrupt-'));
    assert.equal(backup, undefined);
  } finally {
    await cleanup(dir);
  }
});

test('load() clamps an out-of-range stallWindowMs found on disk', async () => {
  const { dir, file } = await tmpFile();
  try {
    fs.writeFileSync(file, JSON.stringify({ version: 1, settings: { stallWindowMs: 5 } }), 'utf8');
    const store = new Store(file);
    await store.load();
    assert.equal(store.settings.stallWindowMs, 2 * 60 * 1000);
  } finally {
    await cleanup(dir);
  }
});
