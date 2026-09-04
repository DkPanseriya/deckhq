/**
 * Compressed rollouts — WP-23a, `docs/DEVIATIONS.md` §136.2.
 *
 * Codex's CLI runs a background worker that rewrites an untouched rollout
 * journal as Zstandard, verifies the copy decodes, and deletes the plain file.
 * `walkSessionFiles()` accepted a file only when its name ended `.jsonl`, so a
 * compressed session left the floor with **no error anywhere** — a wrong
 * number, silently, and the sessions that vanished were the oldest.
 *
 * There are two correct behaviours here and this machine can only ever exhibit
 * one of them, because `zlib.zstdDecompressSync` is a property of the Node the
 * suite happens to run on (22.15+) and this package's floor is 18. So the
 * capability is injected, the directory walk takes its branch as an argument,
 * and the sentence the floor branch produces is a pure function — otherwise
 * half of this would be asserted on nobody's machine.
 *
 * The one thing that IS run for real, when the host can: a round trip through
 * `zstdCompressSync` and back out through the adapter's own readers, asserting
 * that a compressed session parses to the same records as the plain one.
 */
import '../helpers/isolate.mjs';

import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import zlib from 'node:zlib';

import {
  COMPRESSED_SUFFIX,
  extractMessage,
  extractSessionMeta,
  hasZstd,
  isCompressedRollout,
  parseRecords,
  readCompressed,
  readRolloutHead,
  readRolloutTail,
} from '../../src/adapters/codex/parse.mjs';
import { describeCompressedGap, walkSessionFiles } from '../../src/adapters/codex/adapter.mjs';

/** A Node with Zstandard, and one without, as objects rather than as versions. */
const NO_ZSTD = {};
const ZSTD = zlib;

const UUID_A = '5b1f6e2a-1234-4abc-9def-000000000001';
const UUID_B = '5b1f6e2a-1234-4abc-9def-000000000002';

/** Two lines of a plausible rollout journal — synthetic, per `ADAPTERS.md` §7. */
const ROLLOUT =
  JSON.stringify({
    type: 'session_meta',
    payload: { id: UUID_B, timestamp: '2026-08-01T09:00:00.000Z', cwd: 'C:\\work\\old-thing' },
  }) +
  '\n' +
  JSON.stringify({
    type: 'response_item',
    payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'ship it' }] },
  }) +
  '\n' +
  JSON.stringify({
    type: 'event_msg',
    payload: { type: 'agent_message', message: 'shipped' },
  }) +
  '\n';

let tmpCount = 0;
/** A `~/.codex/sessions`-shaped tree with one plain and one compressed rollout. */
async function sessionsTree({ compress = true } = {}) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), `deckhq-zst-${tmpCount++}-`));
  const day = path.join(root, '2026', '08', '01');
  await fsp.mkdir(day, { recursive: true });
  const plain = path.join(day, `rollout-2026-08-01T09-00-00-${UUID_A}.jsonl`);
  const packed = path.join(day, `rollout-2026-08-01T09-00-00-${UUID_B}${COMPRESSED_SUFFIX}`);
  await fsp.writeFile(plain, ROLLOUT, 'utf8');
  await fsp.writeFile(
    packed,
    compress && hasZstd() ? zlib.zstdCompressSync(Buffer.from(ROLLOUT, 'utf8')) : 'not zstd at all',
  );
  return { root, plain, packed };
}

// ---------------------------------------------------------------------------
// The capability, both ways
// ---------------------------------------------------------------------------

test('hasZstd is a capability check, not a version comparison', () => {
  assert.equal(hasZstd(NO_ZSTD), false);
  assert.equal(hasZstd({ zstdDecompressSync: () => Buffer.alloc(0) }), true);
  assert.equal(hasZstd(undefined), hasZstd(zlib));
});

test('isCompressedRollout recognises the suffix Codex writes, case-insensitively', () => {
  assert.equal(isCompressedRollout(`rollout-x-${UUID_A}.jsonl.zst`), true);
  assert.equal(isCompressedRollout(`ROLLOUT-X-${UUID_A}.JSONL.ZST`), true);
  assert.equal(isCompressedRollout(`rollout-x-${UUID_A}.jsonl`), false);
  assert.equal(isCompressedRollout('notes.zst'), false);
});

// ---------------------------------------------------------------------------
// The walk — the actual defect
// ---------------------------------------------------------------------------

test('a Node WITH zstd reads the compressed rollout, and skips nothing', async () => {
  const { root, plain, packed } = await sessionsTree();
  const walked = await walkSessionFiles(root, { readCompressed: true });
  assert.deepEqual(walked.files.sort(), [plain, packed].sort());
  assert.equal(walked.skipped, 0);
});

test('a Node WITHOUT zstd counts the compressed rollout instead of dropping it silently', async () => {
  // This is the branch this package's Node 18 floor takes, and the whole
  // point of the fix: the session is still not on the floor, but the number
  // is now a number somebody can see rather than nothing at all.
  const { root, plain } = await sessionsTree();
  const walked = await walkSessionFiles(root, { readCompressed: false });
  assert.deepEqual(walked.files, [plain]);
  assert.equal(walked.skipped, 1);
});

test('the walk still finds nothing in a directory that is not there, either way', async () => {
  for (const readCompressed of [true, false]) {
    const walked = await walkSessionFiles(path.join(os.tmpdir(), 'deckhq-not-a-real-dir'), {
      readCompressed,
    });
    assert.deepEqual(walked, { files: [], skipped: 0 });
  }
});

// ---------------------------------------------------------------------------
// The sentence the floor branch produces
// ---------------------------------------------------------------------------

test('the gap is described with its count, its Node, and no gap at all for zero', () => {
  assert.equal(describeCompressedGap(0, 'v18.20.4'), null);
  assert.equal(describeCompressedGap(-1, 'v18.20.4'), null);
  assert.equal(describeCompressedGap(NaN, 'v18.20.4'), null);

  const one = describeCompressedGap(1, 'v18.20.4');
  assert.match(one, /^1 compressed Codex session is not read on Node < 22 \(v18\.20\.4\)/);
  assert.match(one, /Node 22\.15 or newer reads them\./);

  const many = describeCompressedGap(7, 'v18.20.4');
  assert.match(many, /^7 compressed Codex sessions are not read on Node < 22/);
  assert.match(many, /they are not on the floor/);
});

// ---------------------------------------------------------------------------
// Reading one, with the capability stubbed away
// ---------------------------------------------------------------------------

test('readCompressed answers null on a Node with no zstd, rather than throwing', async () => {
  const { packed } = await sessionsTree();
  assert.equal(await readCompressed(packed, { zlib: NO_ZSTD }), null);
});

test('readRolloutHead/Tail degrade to empty on a Node with no zstd', async () => {
  const { packed } = await sessionsTree();
  assert.deepEqual(await readRolloutHead(packed, 1024, { zlib: NO_ZSTD }), {
    text: '',
    truncated: false,
    size: 0,
  });
  assert.deepEqual(await readRolloutTail(packed, 1024, { zlib: NO_ZSTD }), {
    text: '',
    truncated: false,
    size: 0,
  });
});

test('a .zst that is not a zstd frame is skipped, not thrown', async () => {
  const { packed } = await sessionsTree({ compress: false });
  assert.equal(await readCompressed(packed, { zlib: ZSTD }), null);
});

test('a compressed rollout past the output bound is refused rather than half-read', async (t) => {
  if (!hasZstd()) return t.skip('this Node has no zstd');
  const { packed } = await sessionsTree();
  // A half-decoded JSONL would be silently wrong; a refusal is countable.
  assert.equal(await readCompressed(packed, { maxDecompressedBytes: 8 }), null);
  assert.equal(await readCompressed(packed, { maxCompressedBytes: 1 }), null);
});

// ---------------------------------------------------------------------------
// The real round trip, when the host can do one
// ---------------------------------------------------------------------------

test('REAL ROUND TRIP: a compressed rollout parses to exactly the plain one', async (t) => {
  if (!hasZstd()) return t.skip('this Node has no zstd');
  const { plain, packed } = await sessionsTree();

  const plainHead = await readRolloutHead(plain);
  const packedHead = await readRolloutHead(packed);
  assert.equal(packedHead.text, plainHead.text);
  assert.equal(packedHead.truncated, false);

  const meta = parseRecords(packedHead.text).map(extractSessionMeta).find(Boolean);
  assert.equal(meta.id, UUID_B);
  assert.equal(meta.cwd, 'C:\\work\\old-thing');

  const tail = await readRolloutTail(packed);
  const messages = parseRecords(tail.text).map(extractMessage).filter(Boolean);
  assert.deepEqual(
    messages.map((m) => [m.role, m.text]),
    [
      ['user', 'ship it'],
      ['assistant', 'shipped'],
    ],
  );
});

test('REAL ROUND TRIP: the head/tail bound applies to the decoded bytes, same as a plain file', async (t) => {
  if (!hasZstd()) return t.skip('this Node has no zstd');
  const { plain, packed } = await sessionsTree();
  const bound = 40;

  const plainHead = await readRolloutHead(plain, bound);
  const packedHead = await readRolloutHead(packed, bound);
  assert.equal(packedHead.text, plainHead.text);
  assert.equal(packedHead.truncated, true, 'a bounded head of a longer file is truncated');
  assert.equal(packedHead.text.length, bound);

  const plainTail = await readRolloutTail(plain, bound);
  const packedTail = await readRolloutTail(packed, bound);
  assert.equal(packedTail.text, plainTail.text);
  assert.equal(packedTail.truncated, true);
});
