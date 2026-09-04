/**
 * `POST /api/snapshot` — the half of WP-14 that writes to the user's disk.
 *
 * The interesting assertions are all refusals. This is the only endpoint in
 * the product whose entire purpose is to put a file on disk, so what it
 * accepts is the whole of its security surface.
 *
 * The machine is pinned before `src/` is imported (`docs/DEVIATIONS.md` §123),
 * so the daemon behind these refusals is scanning a temp root rather than the
 * developer's transcripts.
 */
// First, and before anything under `src/`: it moves the machine.
import { daemonScratch } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import process from 'node:process';
import path from 'node:path';

const { startDaemon } = await import('../../src/daemon.mjs');
const { MAX_SNAPSHOT_BYTES } = await import('../../src/http/routes/snapshot.mjs');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A tiny but structurally real PNG: the signature plus some bytes. */
function fakePng(extra = 64) {
  return Buffer.concat([PNG_MAGIC, Buffer.alloc(extra, 0x42)]);
}

async function withDaemon(fn) {
  const { dir, stateFile, publicDir } = daemonScratch('snap-');
  const snapshotDir = path.join(dir, 'snapshots');
  const d = await startDaemon({ port: 0, stateFile, publicDir, snapshotDir });
  try {
    await fn(d, snapshotDir);
  } finally {
    await d.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const post = (d, body, headers = {}) =>
  fetch(d.url + 'api/snapshot', {
    method: 'POST',
    headers: { 'content-type': 'image/png', ...headers },
    body,
  });

test('a PNG is written, and the daemon names the file', async () => {
  await withDaemon(async (d, snapshotDir) => {
    const res = await post(d, fakePng());
    assert.equal(res.status, 200);
    const body = await res.json();

    const names = await fs.readdir(snapshotDir);
    assert.equal(names.length, 1);
    assert.match(names[0], /^deckhq-\d{8}-\d{6}\.png$/);
    assert.equal(path.basename(body.file), names[0]);
    // Inside the directory it was told to use, and nowhere else.
    assert.equal(path.dirname(path.resolve(body.file)), path.resolve(snapshotDir));

    const written = await fs.readFile(path.join(snapshotDir, names[0]));
    assert.deepEqual(written, fakePng(), 'the bytes on disk are not the bytes that were sent');
    assert.equal(body.bytes, 72);
  });
});

test('the directory is created on demand, so a fresh machine works', async () => {
  await withDaemon(async (d, snapshotDir) => {
    // `withDaemon` never creates it; the first `S` does.
    await assert.rejects(fs.stat(snapshotDir));
    assert.equal((await post(d, fakePng())).status, 200);
    assert.ok((await fs.stat(snapshotDir)).isDirectory());
  });
});

test('SECURITY: nothing but a PNG is written', async () => {
  await withDaemon(async (d, snapshotDir) => {
    for (const [what, body] of [
      ['an empty body', Buffer.alloc(0)],
      ['a script', Buffer.from('#!/bin/sh\nrm -rf ~\n')],
      ['an ELF binary', Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1, 0, 0])],
      ['a JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0])],
      // The content-type header is a claim, not evidence: the magic bytes
      // decide, so a shell script announced as a PNG is still refused.
      ['a script announced as a PNG', Buffer.from('MZ not a png at all')],
    ]) {
      const res = await post(d, body);
      assert.ok(res.status >= 400, `${what} was accepted (${res.status})`);
      await res.text();
    }
    await assert.rejects(fs.readdir(snapshotDir), 'something was written for a refused body');
  });
});

test('SECURITY: the request cannot influence the path it is written to', async () => {
  await withDaemon(async (d, snapshotDir) => {
    // There is no filename field to abuse, so the attempt is to smuggle one
    // through the headers the route does read. It has to be ignored entirely.
    const res = await post(d, fakePng(), {
      'x-filename': '../../escaped.png',
      'content-disposition': 'attachment; filename="../../escaped.png"',
    });
    assert.equal(res.status, 200);
    const names = await fs.readdir(snapshotDir);
    assert.equal(names.length, 1);
    assert.match(names[0], /^deckhq-\d{8}-\d{6}\.png$/);
    const parent = await fs.readdir(path.dirname(snapshotDir));
    assert.ok(!parent.includes('escaped.png'), 'a snapshot escaped its directory');
  });
});

test('an oversized body is refused rather than truncated onto disk', async () => {
  await withDaemon(async (d, snapshotDir) => {
    const huge = Buffer.concat([PNG_MAGIC, Buffer.alloc(MAX_SNAPSHOT_BYTES + 1024, 0x42)]);
    const res = await post(d, huge).catch((err) => ({ status: 0, err }));
    // The connection is destroyed as soon as the ceiling is passed, so either
    // a 413 or a refused socket is correct — a half-written file is not.
    if (res.status) assert.equal(res.status, 413);
    await assert.rejects(fs.readdir(snapshotDir), 'a truncated snapshot reached the disk');
  });
});

test('a snapshot at the 2 MB target goes through', async () => {
  // The size budget is the client's problem, not the route's: the route only
  // has to not be the thing that stops a legitimate one.
  await withDaemon(async (d) => {
    const twoMb = Buffer.concat([PNG_MAGIC, Buffer.alloc(2 * 1024 * 1024, 0x42)]);
    const res = await post(d, twoMb);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).bytes, twoMb.length);
  });
});

// DELIBERATE HOST READ — the only one in the suite. `docs/DEVIATIONS.md` §123.5.
// Everything else runs against a temp root, but the claim here is that the
// office is named after *this machine*, so the machine's own name is the
// expected value and there is nothing to inject. `os.hostname()` is a constant
// -time read of a string, not a scan of a directory, so it costs the suite
// nothing and cannot make one run disagree with the next. `DECKHQ_HOSTNAME` is
// deleted by the isolate helper rather than pinned for exactly this reason.
test('the hostname the strip is named after comes from /api/about', async () => {
  await withDaemon(async (d) => {
    const about = await (await fetch(d.url + 'api/about')).json();
    assert.equal(typeof about.hostname, 'string');
    assert.ok(about.hostname.length > 0, 'the office would have no name');
    assert.equal(about.hostname, os.hostname());
  });
});

test('DECKHQ_HOSTNAME replaces it, and only with something hostname-shaped', async () => {
  const restore = process.env.DECKHQ_HOSTNAME;
  try {
    await withDaemon(async (d) => {
      const ask = async () => (await (await fetch(d.url + 'api/about')).json()).hostname;

      process.env.DECKHQ_HOSTNAME = 'DECKHQ-DEMO';
      assert.equal(await ask(), 'DECKHQ-DEMO');

      // Anything that is not a hostname falls back to the real one rather
      // than reaching the strip: this value is drawn into an image and could
      // otherwise carry a sentence somebody chose.
      for (const bad of ['', '  ', 'a b', '../../etc', 'x'.repeat(80), '-leading']) {
        process.env.DECKHQ_HOSTNAME = bad;
        assert.equal(await ask(), os.hostname(), `"${bad}" was accepted as a hostname`);
      }
    });
  } finally {
    if (restore === undefined) delete process.env.DECKHQ_HOSTNAME;
    else process.env.DECKHQ_HOSTNAME = restore;
  }
});
