/**
 * Calendar days across the night the clocks change.
 *
 * On 26 October 2026, the day after Europe's clocks went back, the suite
 * failed: `prune(3)` removed 24 October, which a three-day window keeps,
 * because it counted back in 24-hour steps from a 25-hour day. The usage
 * windows did the same, an hour off. Pinned to a zone with the change, so
 * this runs the same on every machine.
 */
import '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.TZ = 'Europe/Berlin';

const { Ledger, dayKey, dayStart } = await import('../../src/core/ledger.mjs');
const { windowFor, trend } = await import('../../src/core/usage.mjs');

// Monday 26 October 2026, 10:00 in Berlin: the morning after the change.
const NOW = new Date(2026, 9, 26, 10, 0, 0).getTime();

test('the zone is pinned, and 25 October is 25 hours long in it', () => {
  assert.equal(dayStart('2026-10-26') - dayStart('2026-10-25'), 25 * 3600_000);
});

test('prune keeps every calendar day of its window across the change', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-dst-'));
  try {
    for (const day of ['2026-10-26', '2026-10-25', '2026-10-24', '2026-10-23']) {
      fs.writeFileSync(path.join(dir, `${day}.jsonl`), '{}\n');
    }
    const result = await new Ledger(dir, { machineId: 'x' }).prune(3, NOW);
    assert.deepEqual(result.removed, ['2026-10-23']);
    assert.equal(result.kept, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the 7-day usage window starts at midnight seven calendar days back', () => {
  const w = windowFor('7d', NOW);
  assert.equal(dayKey(w.since), '2026-10-20');
  assert.equal(w.since, dayStart('2026-10-20'));
});

test('a trend and the window before it meet at a midnight', () => {
  const t = trend([], { now: NOW, days: 7 });
  assert.equal(t.since, dayStart('2026-10-20'));
  assert.equal(t.priorSince, dayStart('2026-10-13'));
  assert.equal(t.priorUntil, t.since - 1);
});
