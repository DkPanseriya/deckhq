/**
 * `~/.deckhq/daemon.json` — the record a running daemon leaves so a hook
 * written before its port was chosen can still find it (WP-37).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  clearDaemonFile,
  readDaemonFile,
  stateDirId,
  writeDaemonFile,
} from '../../src/core/daemon-file.mjs';

/** A fresh empty directory that cleans itself up. */
function tmpdir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-daemonfile-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('a written record reads back with the port and url', (t) => {
  const file = path.join(tmpdir(t), 'daemon.json');
  writeDaemonFile({ file, port: 4400, url: 'http://127.0.0.1:4400/', pid: 999, now: 12345 });

  const record = readDaemonFile(file);
  assert.deepEqual(record, {
    port: 4400,
    url: 'http://127.0.0.1:4400/',
    pid: 999,
    startedAt: 12345,
  });
});

test('the directory is created if it does not exist', (t) => {
  const file = path.join(tmpdir(t), 'nested', 'deeper', 'daemon.json');
  assert.notEqual(writeDaemonFile({ file, port: 4317, url: 'http://127.0.0.1:4317/' }), null);
  assert.equal(readDaemonFile(file)?.port, 4317);
});

test('no temp file is left behind', (t) => {
  const dir = tmpdir(t);
  writeDaemonFile({ file: path.join(dir, 'daemon.json'), port: 4317, url: 'x' });
  assert.deepEqual(fs.readdirSync(dir), ['daemon.json']);
});

test('a missing, malformed or portless file reads as no record at all', (t) => {
  const dir = tmpdir(t);
  const file = path.join(dir, 'daemon.json');
  assert.equal(readDaemonFile(file), null);

  fs.writeFileSync(file, 'not json');
  assert.equal(readDaemonFile(file), null);

  fs.writeFileSync(file, '[1,2,3]');
  assert.equal(readDaemonFile(file), null);

  fs.writeFileSync(file, JSON.stringify({ url: 'http://127.0.0.1:4317/' }));
  assert.equal(readDaemonFile(file), null);

  fs.writeFileSync(file, JSON.stringify({ port: 99999 }));
  assert.equal(readDaemonFile(file), null);
});

test('a record with a port but no url still yields a loopback url', (t) => {
  const file = path.join(tmpdir(t), 'daemon.json');
  fs.writeFileSync(file, JSON.stringify({ port: 4321 }));
  assert.equal(readDaemonFile(file)?.url, 'http://127.0.0.1:4321/');
});

test('clearing removes our own record', (t) => {
  const file = path.join(tmpdir(t), 'daemon.json');
  writeDaemonFile({ file, port: 4317, url: 'x', pid: 4242 });
  clearDaemonFile({ file, pid: 4242 });
  assert.equal(fs.existsSync(file), false);
});

test('clearing leaves a record another daemon wrote', (t) => {
  // A restart writes the new record before the old process finishes closing
  // its sockets. An unconditional unlink there would leave a live daemon with
  // no way for a hook to find it.
  const file = path.join(tmpdir(t), 'daemon.json');
  writeDaemonFile({ file, port: 4318, url: 'x', pid: 777 });
  clearDaemonFile({ file, pid: 4242 });
  assert.equal(readDaemonFile(file)?.pid, 777);
});

test('clearing a file that is not there is not an error', (t) => {
  clearDaemonFile({ file: path.join(tmpdir(t), 'nothing.json'), pid: 1 });
});

test('a write that cannot happen returns null rather than throwing', (t) => {
  // A directory where the file should be: the closest portable stand-in for a
  // read-only home directory. Publishing the port is a convenience; failing to
  // must never fail a daemon start.
  const dir = tmpdir(t);
  const file = path.join(dir, 'daemon.json');
  fs.mkdirSync(file);
  assert.equal(writeDaemonFile({ file, port: 4317, url: 'x' }), null);
});

// ---------------------------------------------------------------------------
// Which state directory a daemon serves
// ---------------------------------------------------------------------------

test('the state directory id is a short hash, the same every time it is asked', (t) => {
  const dir = tmpdir(t);
  const id = stateDirId(dir);
  assert.match(id, /^[0-9a-f]{16}$/);
  assert.equal(stateDirId(dir), id);
  assert.equal(stateDirId(dir + path.sep), id, 'a trailing separator is not another directory');
});

test('two state directories have two ids', (t) => {
  const dir = tmpdir(t);
  assert.notEqual(stateDirId(path.join(dir, 'a')), stateDirId(path.join(dir, 'b')));
});

test('the id does not change when the directory is created after it was first asked', (t) => {
  // `deckhq app` asks before the daemon it is about to start has made the
  // directory, and the daemon answers after. They have to agree.
  const dir = path.join(tmpdir(t), 'not', 'yet');
  const before = stateDirId(dir);
  fs.mkdirSync(dir, { recursive: true });
  assert.equal(stateDirId(dir), before);
});

test('SECURITY: the id carries nothing of the path it was made from', (t) => {
  const dir = path.join(tmpdir(t), 'a-user-name');
  const id = stateDirId(dir);
  assert.ok(!id.includes('/') && !id.includes('\\'),'an id is never a path');
  assert.ok(!id.includes('a-user-name'));
});
