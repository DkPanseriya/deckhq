/**
 * The catchphrase counter's limits hold inside one file, not only between
 * files: one multi-gigabyte transcript must not be read to the end, and one
 * enormous line must not be held in memory or thrown out of a stream handler.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { countInFile } from '../../src/adapters/claude-code/catchphrase.mjs';

const now = Date.now();
const window = { since: now - 86_400_000, until: now };
const line = () =>
  JSON.stringify({
    type: 'assistant',
    timestamp: new Date(now - 3_600_000).toISOString(),
    message: { content: [{ type: 'text', text: "You're absolutely right, that is the bug." }] },
  });

test('a byte budget stops the read part-way through one file, and says so', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-budget-'));
  try {
    const file = path.join(dir, 'big.jsonl');
    fs.writeFileSync(file, `${line()}\n`.repeat(20_000), 'utf8'); // about 3.6 MB
    const full = await countInFile(file, window);
    assert.equal(full.count, 20_000);
    assert.equal(full.truncated, false);
    const capped = await countInFile(file, window, { maxBytes: 200_000 });
    assert.equal(capped.truncated, true);
    assert.ok(capped.bytes < full.bytes, 'the rest of the file was not read');
    assert.ok(capped.count < full.count);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a deadline that has passed stops the read at the first chunk', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-budget-'));
  try {
    const file = path.join(dir, 'a.jsonl');
    fs.writeFileSync(file, `${line()}\n`.repeat(2_000), 'utf8');
    const out = await countInFile(file, window, { deadline: 0, now: () => 1 });
    assert.equal(out.truncated, true);
    assert.equal(out.count, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a line too long to hold is skipped, and the records after it still count', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-budget-'));
  try {
    const file = path.join(dir, 'huge-line.jsonl');
    const huge = `{"type":"assistant","x":"${'a'.repeat(9 * 1024 * 1024)}"}`;
    fs.writeFileSync(file, `${line()}\n${huge}\n${line()}\n`, 'utf8');
    const out = await countInFile(file, window);
    assert.equal(out.count, 2);
    assert.equal(out.truncated, true, 'a skipped record makes the count a floor');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
