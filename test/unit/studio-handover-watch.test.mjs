/**
 * A HANDOVER IS ONE FILE WRITTEN ONCE — so the watch may not lose it.
 *
 * The Studio watch used to mark a handover as seen and THEN hand it to its
 * listener. The listener writes the flag onto `board.json`, and on Windows
 * that write is refused while anything else has the board open. When it was,
 * the flag was never written and nothing offered the file again: it had not
 * changed, and the watch only speaks of changes. The integration suite met
 * this as a thirty-second wait that expired about one full run in three.
 *
 * These tests make the listener and the rename fail on purpose, so the lost
 * event is reproduced every time and not one time in three.
 */
import { scratchDir } from '../helpers/isolate.mjs';

import { mock, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const { watchHandovers } = await import('../../src/studio/handover.mjs');
const { RENAME_WAITS_MS, renameOver } = await import('../../src/studio/store.mjs');

const FAST = { pollMs: 25, debounceMs: 5 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait for `ready()`, as a ceiling and never as a delay. */
async function until(ready, ms = 10_000) {
  const stop = Date.now() + ms;
  while (!ready() && Date.now() < stop) await sleep(10);
  return ready();
}

const busy = () =>
  Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' });

test('RULE: a handover the listener could not take is offered again, with nothing changing on disk', async () => {
  const dir = scratchDir('handover-watch-');
  fs.writeFileSync(path.join(dir, 'c1.md'), '# Handover for c1\n');
  /** @type {string[][]} */
  const offers = [];
  const stop = await watchHandovers(dir, {
    ...FAST,
    onChange: async (files) => {
      offers.push(files.map((f) => f.name));
      // The board cannot be written the first two times it is tried.
      if (offers.length <= 2) throw busy();
    },
  });
  try {
    assert.ok(
      await until(() => offers.length >= 3),
      `offered ${offers.length} time(s), then never again`,
    );
    assert.deepEqual(offers.slice(0, 3), [['c1.md'], ['c1.md'], ['c1.md']]);
    // Once taken it is seen, and a taken file is not news.
    await sleep(FAST.pollMs * 8);
    assert.equal(offers.length, 3, 'a handover that was taken is not offered again');
  } finally {
    stop();
  }
});

test('RULE: a listener that answers false is asked again, and one that answers nothing is not', async () => {
  const dir = scratchDir('handover-watch-');
  fs.writeFileSync(path.join(dir, 'c2.md'), '# Handover for c2\n');
  let refused = 0;
  let quiet = 0;
  const stopRefusing = await watchHandovers(dir, {
    ...FAST,
    onChange: () => ++refused >= 3,
  });
  const stopQuiet = await watchHandovers(dir, { ...FAST, onChange: () => void quiet++ });
  try {
    assert.ok(await until(() => refused >= 3), `asked ${refused} time(s)`);
    await sleep(FAST.pollMs * 8);
    assert.equal(refused, 3, 'and not asked a fourth time once it said yes');
    assert.equal(quiet, 1, 'a listener that returns nothing has taken the tick, as before');
  } finally {
    stopRefusing();
    stopQuiet();
  }
});

test('RULE: a file that arrives while another is still owed is offered with it, and neither is lost', async () => {
  const dir = scratchDir('handover-watch-');
  fs.writeFileSync(path.join(dir, 'c1.md'), 'one\n');
  let open = false;
  /** @type {string[][]} */
  const taken = [];
  const stop = await watchHandovers(dir, {
    ...FAST,
    onChange: (files) => {
      if (!open) return false;
      taken.push(files.map((f) => f.name));
      return true;
    },
  });
  try {
    await sleep(FAST.pollMs * 4);
    await fsp.writeFile(path.join(dir, 'c2.md'), 'two\n');
    await sleep(FAST.pollMs * 4);
    assert.deepEqual(taken, [], 'nothing was taken while the board was busy');
    open = true;
    assert.ok(await until(() => taken.length >= 1), 'the owed files were never offered again');
    assert.deepEqual(taken.flat().sort(), ['c1.md', 'c2.md']);
  } finally {
    stop();
  }
});

test('RULE: the rename of an atomic write is tried again while the target is busy, and only then', async (t) => {
  const dir = scratchDir('rename-over-');
  const from = path.join(dir, 'board.json.tmp-1');
  const to = path.join(dir, 'board.json');
  const real = fsp.rename.bind(fsp);
  let failures = 0;
  let calls = 0;
  let code = 'EPERM';
  t.after(() => mock.restoreAll());
  mock.method(fsp, 'rename', async (a, b) => {
    calls++;
    if (failures-- > 0) throw Object.assign(new Error(`${code}: rename`), { code });
    return real(a, b);
  });

  // Busy twice, then free: the write lands, on the third try.
  fs.writeFileSync(from, 'new');
  fs.writeFileSync(to, 'old');
  failures = 2;
  await renameOver(from, to);
  assert.equal(calls, 3);
  assert.equal(fs.readFileSync(to, 'utf8'), 'new');

  // Busy for longer than it waits: the failure comes out as it was, after every try.
  fs.writeFileSync(from, 'newer');
  failures = 99;
  calls = 0;
  await assert.rejects(renameOver(from, to), { code: 'EPERM' });
  assert.equal(calls, RENAME_WAITS_MS.length + 1);
  assert.equal(fs.readFileSync(to, 'utf8'), 'new', 'the file being replaced is untouched');

  // Anything that is not "busy" is not waited on.
  failures = 1;
  calls = 0;
  code = 'ENOENT';
  await assert.rejects(renameOver(from, to), { code: 'ENOENT' });
  assert.equal(calls, 1);
});
