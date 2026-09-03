/**
 * The desktop app's session store, seen through its per-file cache.
 *
 * `readDesktopSessions()` runs on every poll, forever, so its result is cached
 * per file and keyed by `(path, mtime, size)` — the same invalidation rule as
 * `src/core/summary-cache.mjs` (docs/DEVIATIONS.md §78).
 *
 * The two properties that matter, and the reason the cache is here rather than
 * folded into the summary cache: a cache hit is indistinguishable from a fresh
 * read, and an archive flip is seen on the very next call, because archiving
 * rewrites the file this cache is keyed on. `archived` drives `let_go`, so a
 * stale `true` re-fires an agent the user rehired, on every poll, forever
 * (§46, §68).
 *
 * `desktopSessionsDir()` reads the environment on every call, not at import
 * time, so unlike test/unit/claude-scan-cache.test.mjs these run in-process —
 * which is also what lets them count the reads that did and did not happen.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  readDesktopSessions,
  clearDesktopCache,
  desktopCacheStats,
  desktopCacheSize,
  _scanTopLevelFields,
} from '../../src/adapters/claude-code/desktop.mjs';

const CLI_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const CLI_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

/**
 * A throwaway store, laid out the way the app really lays one out:
 * `<root>/<install>/<profile>/local_<id>.json`.
 */
async function makeStore() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-desktop-'));
  const dir = path.join(root, 'install-1', 'profile-1');
  await fsp.mkdir(dir, { recursive: true });
  process.env.DECKHQ_DESKTOP_SESSIONS_DIR = root;
  clearDesktopCache();
  return { root, dir };
}

async function cleanup(store) {
  delete process.env.DECKHQ_DESKTOP_SESSIONS_DIR;
  clearDesktopCache();
  await fsp.rm(store.root, { recursive: true, force: true });
}

/**
 * @param {{dir:string}} store
 * @param {string} name
 * @param {object} record
 * @returns {string} the file written
 */
function write(store, name, record) {
  const file = path.join(store.dir, name);
  fs.writeFileSync(file, JSON.stringify(record), 'utf8');
  return file;
}

/**
 * Pin a file's mtime, so (mtime, size) can be varied one at a time — and
 * prove the pin took. The cache compares `mtimeMs` to the millisecond, so the
 * value is given in milliseconds with a non-zero fraction of a second, and the
 * stat is read straight back: a filesystem that rounded it would make the
 * "size moved, mtime did not" test below pass for the wrong reason, with the
 * re-read caused by the timestamp rather than by the size.
 * @returns {number} the `mtimeMs` the filesystem actually holds
 */
function setMtimeMs(file, ms) {
  const when = new Date(ms);
  fs.utimesSync(file, when, when);
  const held = fs.statSync(file).mtimeMs;
  assert.equal(held, ms, `mtimeMs did not round-trip on this filesystem: asked ${ms}, got ${held}`);
  return held;
}

/** Reads performed by the call `fn` makes. */
async function readsDuring(fn) {
  const before = desktopCacheStats.reads;
  const value = await fn();
  return { value, reads: desktopCacheStats.reads - before };
}

// --------------------------------------------------------------------------

test('every joinable file is read and keyed by cliSessionId', async () => {
  const store = await makeStore();
  try {
    write(store, 'local_a.json', {
      sessionId: 'local_a',
      cliSessionId: CLI_A,
      isArchived: true,
      title: 'Archived one',
    });
    write(store, 'local_b.json', { sessionId: 'local_b', cliSessionId: CLI_B, isArchived: false });

    const map = await readDesktopSessions();
    assert.equal(map.size, 2);
    assert.deepEqual(map.get(CLI_A), { archived: true, title: 'Archived one' });
    assert.deepEqual(map.get(CLI_B), { archived: false, title: undefined });
  } finally {
    await cleanup(store);
  }
});

test('a second call with nothing changed opens no files at all', async () => {
  const store = await makeStore();
  try {
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: true });
    write(store, 'local_b.json', { cliSessionId: CLI_B, isArchived: false });

    const cold = await readsDuring(readDesktopSessions);
    assert.equal(cold.reads, 2, 'the first call reads both');

    const warm = await readsDuring(readDesktopSessions);
    assert.equal(warm.reads, 0, 'the second reads neither');
    assert.equal(desktopCacheStats.hits, 2);

    // And it is the same answer, not a cheaper one.
    assert.deepEqual([...warm.value.entries()], [...cold.value.entries()]);
  } finally {
    await cleanup(store);
  }
});

test('INVARIANT: archiving is seen on the very next call', async () => {
  const store = await makeStore();
  try {
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: false });
    assert.equal((await readDesktopSessions()).get(CLI_A).archived, false);

    // What the app does when the user archives: it rewrites this file. The
    // summary cache cannot see this happen — archiving never touches the
    // transcript — which is exactly why the flag is cached here instead.
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: true });
    const after = await readsDuring(readDesktopSessions);
    assert.equal(after.reads, 1, 're-read, not served from the cache');
    assert.equal(after.value.get(CLI_A).archived, true);

    // And back again: a rehire is not stickier than a firing.
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: false });
    assert.equal((await readDesktopSessions()).get(CLI_A).archived, false);
  } finally {
    await cleanup(store);
  }
});

test('a file whose mtime moved but whose size did not is re-read', async () => {
  const store = await makeStore();
  try {
    // Same length, different content, so size alone cannot notice.
    const file = write(store, 'local_a.json', { cliSessionId: CLI_A, title: 'aaa' });
    const first = setMtimeMs(file, 1_700_000_000_250);
    assert.equal((await readDesktopSessions()).get(CLI_A).title, 'aaa');

    write(store, 'local_a.json', { cliSessionId: CLI_A, title: 'bbb' });
    const second = setMtimeMs(file, 1_700_000_000_750);
    assert.notEqual(second, first);
    assert.equal(
      fs.statSync(file).size,
      JSON.stringify({ cliSessionId: CLI_A, title: 'aaa' }).length,
    );

    const after = await readsDuring(readDesktopSessions);
    assert.equal(after.reads, 1);
    assert.equal(after.value.get(CLI_A).title, 'bbb');
  } finally {
    await cleanup(store);
  }
});

test('a file whose size moved but whose mtime did not is re-read', async () => {
  const store = await makeStore();
  try {
    const file = write(store, 'local_a.json', { cliSessionId: CLI_A, title: 'aaa' });
    const pinned = setMtimeMs(file, 1_700_000_000_250);
    assert.equal((await readDesktopSessions()).get(CLI_A).title, 'aaa');

    // A longer title, then the mtime pinned back to where it was — the case a
    // coarse filesystem timestamp would otherwise hide. The premise is
    // asserted: if the timestamp had moved, the re-read below would prove
    // nothing about the size half of the key.
    write(store, 'local_a.json', { cliSessionId: CLI_A, title: 'aaaa' });
    assert.equal(setMtimeMs(file, 1_700_000_000_250), pinned);

    const after = await readsDuring(readDesktopSessions);
    assert.equal(after.reads, 1);
    assert.equal(after.value.get(CLI_A).title, 'aaaa');
  } finally {
    await cleanup(store);
  }
});

test('INVARIANT: the caller is handed a copy, never the cached object', async () => {
  const store = await makeStore();
  try {
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: false });

    const first = await readDesktopSessions();
    // A caller doing what the adapter is one edit away from doing. If this
    // reached the cache, the file would never be re-read to correct it — the
    // §68 copy-out bug, in the one place where the flag actually lives.
    first.get(CLI_A).archived = true;

    const second = await readDesktopSessions();
    assert.equal(desktopCacheStats.hits, 1, 'served from the cache, so nothing re-read it');
    assert.equal(second.get(CLI_A).archived, false);
  } finally {
    await cleanup(store);
  }
});

test('a deleted file loses its entry, and the rest survive', async () => {
  const store = await makeStore();
  try {
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: true });
    const b = write(store, 'local_b.json', { cliSessionId: CLI_B, isArchived: false });
    assert.equal((await readDesktopSessions()).size, 2);
    assert.equal(desktopCacheSize(), 2);

    fs.rmSync(b);
    const after = await readsDuring(readDesktopSessions);
    assert.equal(after.reads, 0, 'the survivor is still a hit');
    assert.equal(after.value.size, 1);
    assert.equal(after.value.has(CLI_B), false);
    assert.equal(desktopCacheSize(), 1, 'and the dead entry is gone, not accumulating');
  } finally {
    await cleanup(store);
  }
});

test('a store directory that reads as empty does not empty the cache', async () => {
  const store = await makeStore();
  try {
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: true });
    assert.equal((await readDesktopSessions()).size, 1);

    // An unreadable or momentarily missing store returns the same empty
    // listing as "the app deleted everything". Treating the two the same
    // would throw a good cache away and buy a re-read of 8 MB next poll.
    process.env.DECKHQ_DESKTOP_SESSIONS_DIR = path.join(store.root, 'not-here');
    assert.equal((await readDesktopSessions()).size, 0);
    assert.equal(desktopCacheSize(), 1);

    process.env.DECKHQ_DESKTOP_SESSIONS_DIR = store.root;
    const back = await readsDuring(readDesktopSessions);
    assert.equal(back.reads, 0);
    assert.equal(back.value.get(CLI_A).archived, true);
  } finally {
    await cleanup(store);
  }
});

test('an unusable file yields no entry, does not condemn the rest, and is not re-read', async () => {
  const store = await makeStore();
  try {
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: true });
    fs.writeFileSync(path.join(store.dir, 'broken.json'), '{"cliSessionId": "aaa', 'utf8');
    // Well-formed JSON, but not this store's shape — the app is free to keep
    // other files in here, and free to change the format entirely.
    write(store, 'foreign.json', { somethingElse: true });

    const cold = await readsDuring(readDesktopSessions);
    assert.equal(cold.value.size, 1);
    assert.equal(cold.value.get(CLI_A).archived, true);
    assert.equal(cold.reads, 3);

    // The failures are remembered too, so a store full of files this adapter
    // cannot use does not re-parse them all on every poll forever.
    const warm = await readsDuring(readDesktopSessions);
    assert.equal(warm.reads, 0);
    assert.equal(warm.value.size, 1);
  } finally {
    await cleanup(store);
  }
});

test('a file repaired after a bad parse is picked up', async () => {
  const store = await makeStore();
  try {
    const file = path.join(store.dir, 'local_a.json');
    fs.writeFileSync(file, '{"cliSessionId": "aaa', 'utf8'); // caught mid-write
    assert.equal((await readDesktopSessions()).size, 0);

    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: true });
    const after = await readsDuring(readDesktopSessions);
    assert.equal(after.reads, 1);
    assert.equal(after.value.get(CLI_A).archived, true);
  } finally {
    await cleanup(store);
  }
});

test('nested install/profile directories are still walked', async () => {
  const store = await makeStore();
  try {
    const deeper = path.join(store.root, 'install-2', 'profile-9');
    fs.mkdirSync(deeper, { recursive: true });
    write(store, 'local_a.json', { cliSessionId: CLI_A, isArchived: false });
    fs.writeFileSync(
      path.join(deeper, 'local_b.json'),
      JSON.stringify({ cliSessionId: CLI_B, isArchived: true }),
      'utf8',
    );

    const map = await readDesktopSessions();
    assert.equal(map.size, 2);
    assert.equal(map.get(CLI_B).archived, true);
  } finally {
    await cleanup(store);
  }
});

// --- The head window, and the scanner behind it (§79) ----------------------
//
// A miss no longer parses the file: it reads a bounded prefix and pulls the
// three fields out of the text. `fullReads` counts the misses that could not
// be answered that way and had to take the whole file, so these can assert
// which path ran, not just that the answer came out right.

/** A record padded the way a real one is: the wanted fields, then bulk. */
function padded(fields, padBytes = 200_000) {
  const remoteMcpServersConfig = {};
  for (let i = 0; i * 40 < padBytes; i++) {
    remoteMcpServersConfig[`server-${i}`] = { url: 'https://example.invalid/mcp', tools: [] };
  }
  return { ...fields, remoteMcpServersConfig };
}

test('a 200 KB file is answered from the head window, without reading the rest', async () => {
  const store = await makeStore();
  try {
    write(store, 'local_a.json', padded({ cliSessionId: CLI_A, isArchived: true, title: 'Big' }));
    assert.ok(fs.statSync(path.join(store.dir, 'local_a.json')).size > 150_000);

    const cold = await readsDuring(readDesktopSessions);
    assert.equal(cold.reads, 1);
    assert.equal(desktopCacheStats.fullReads, 0, 'the head window answered it');
    assert.deepEqual(cold.value.get(CLI_A), { archived: true, title: 'Big' });
  } finally {
    await cleanup(store);
  }
});

test('INVARIANT: a nested cliSessionId is not mistaken for the file’s own', async () => {
  const store = await makeStore();
  try {
    write(
      store,
      'local_a.json',
      padded({
        sessionId: 'local_a',
        // The app really does keep nested session records in here, and they
        // come FIRST. A regex over the text would take this one.
        backgroundTaskSuggestions: { first: { cliSessionId: CLI_B, isArchived: true } },
        cliSessionId: CLI_A,
        isArchived: false,
        title: 'Real',
      }),
    );

    const map = await readDesktopSessions();
    assert.deepEqual([...map.keys()], [CLI_A]);
    assert.equal(map.get(CLI_A).archived, false);
  } finally {
    await cleanup(store);
  }
});

test('fields past the head window cost a full read, but are still found', async () => {
  const store = await makeStore();
  try {
    // 64 KB of other keys first: eight times the window.
    const before = {};
    for (let i = 0; i < 900; i++) before[`filler-${i}`] = 'x'.repeat(64);
    write(store, 'local_a.json', {
      ...before,
      cliSessionId: CLI_A,
      isArchived: true,
      title: 'Late',
    });

    const cold = await readsDuring(readDesktopSessions);
    assert.equal(cold.reads, 1);
    assert.equal(desktopCacheStats.fullReads, 1, 'the window could not answer, so the file did');
    assert.deepEqual(cold.value.get(CLI_A), { archived: true, title: 'Late' });
  } finally {
    await cleanup(store);
  }
});

test('a title decodes exactly as JSON.parse would, escapes and all', async () => {
  const store = await makeStore();
  try {
    const title = 'quote " backslash \ newline \n tab \t emoji 🛠 café';
    write(store, 'local_a.json', padded({ cliSessionId: CLI_A, isArchived: false, title }));

    const map = await readDesktopSessions();
    assert.equal(map.get(CLI_A).title, title);
  } finally {
    await cleanup(store);
  }
});

test('a multi-byte character split by the window boundary does not corrupt the answer', async () => {
  const store = await makeStore();
  try {
    // Put a 4-byte emoji astride byte 8192, inside the title — so the scanner
    // meets a replacement character mid-string, has to give up on the window,
    // and the full read has to produce the real text.
    const HEAD = 8 * 1024;
    const tail = '","cliSessionId":"' + CLI_A + '","isArchived":true}';
    const head = '{"filler":"';
    const emoji = '🛠';
    const padLen = HEAD - Buffer.byteLength(head) - 2; // emoji starts at 8190
    const raw = head + 'x'.repeat(padLen) + emoji + 'y' + tail;
    assert.equal(Buffer.byteLength(head + 'x'.repeat(padLen)), HEAD - 2);
    fs.writeFileSync(path.join(store.dir, 'local_a.json'), raw, 'utf8');

    const map = await readDesktopSessions();
    assert.equal(desktopCacheStats.fullReads, 1);
    assert.equal(map.get(CLI_A).archived, true);
    // And the value that straddled the boundary is intact, not a replacement
    // character — the full read starts from byte 0, not from the window.
    assert.equal(JSON.parse(raw).filler.endsWith(emoji + 'y'), true);
  } finally {
    await cleanup(store);
  }
});

// --- A window that ends mid-value (docs/DEVIATIONS.md §80) -----------------
//
// The scanner's contract is "null means read more, never a guess". The three
// ways an 8 KB prefix can cut a JSON value — inside a string, inside a number,
// on the backslash of an escape — are pinned first against the scanner itself
// and then end to end, where `fullReads` shows the fallback actually ran.

const HEAD = 8 * 1024;

/** The scanner's answer as a plain object — it builds on a null prototype. */
function scan(text) {
  const out = _scanTopLevelFields(text);
  return out === null ? null : { ...out };
}

/**
 * A file whose head window ends exactly on `cutAt` bytes of `prefix`, with
 * the wanted fields after the cut. `prefix` is everything up to and including
 * the byte that straddles the boundary; `rest` completes the document.
 */
function straddling(store, prefix, rest) {
  assert.ok(prefix.length >= HEAD, 'the prefix must reach the window boundary');
  const raw = prefix + rest;
  fs.writeFileSync(path.join(store.dir, 'local_a.json'), raw, 'utf8');
  return raw;
}

test('the scanner answers null, not a guess, when the text ends inside a string', () => {
  const whole = `{"filler":"abc","cliSessionId":"${CLI_A}","isArchived":true}`;
  assert.deepEqual(scan(whole), { cliSessionId: CLI_A, isArchived: true });
  // Cut inside the filler string, inside the key, and inside the wanted value.
  assert.equal(scan('{"filler":"ab'), null);
  assert.equal(scan('{"filler":"abc","cliSess'), null);
  assert.equal(scan(`{"filler":"abc","cliSessionId":"${CLI_A.slice(0, 8)}`), null);
});

test('the scanner answers null when the text ends inside a number or a bare literal', () => {
  // A number that runs off the end may be cut short: `12` could be `12345`.
  assert.equal(scan('{"n":12'), null);
  assert.equal(scan('{"n":1.5e'), null);
  assert.equal(scan('{"isArchived":tru'), null);
  // The same number with its terminator present is skipped cleanly.
  assert.deepEqual(scan(`{"n":12,"cliSessionId":"${CLI_A}"}`), {
    cliSessionId: CLI_A,
  });
  // And a literal that is complete but has nothing after it is still "cut":
  // the scanner cannot know the object closed.
  assert.equal(scan('{"isArchived":true'), null);
});

test('endOfString on an unclosed trailing escape stays in bounds and answers null', () => {
  // The backslash is the last character, so the escape it opens has no
  // second half. Skipping past it lands beyond the text; that must read as
  // "unclosed", not throw and not run past the end.
  assert.equal(scan('{"title":"abc\\'), null);
  assert.equal(scan('{"title":"abc\\"'), null); // the escaped quote is not a close
  assert.equal(scan('{"title":"abc\\u00'), null);
  assert.equal(scan('{"title":"abc\\\\'), null); // escaped backslash, then EOF
  assert.equal(scan('{"title":"abc\\\\"'), null); // ...closed, but the object is not
  assert.deepEqual(scan('{"title":"abc\\\\"}'), { title: 'abc\\' });
  assert.deepEqual(scan('{"title":"abc\\""}'), { title: 'abc"' });
});

test('a window cut mid-string costs a full read, and the full read answers', async () => {
  const store = await makeStore();
  try {
    const head = '{"filler":"';
    const raw = straddling(
      store,
      head + 'x'.repeat(HEAD - head.length + 40), // the string closes 40 bytes past the window
      `","cliSessionId":"${CLI_A}","isArchived":true,"title":"Cut"}`,
    );
    assert.equal(JSON.parse(raw).cliSessionId, CLI_A, 'the whole file is valid JSON');

    const cold = await readsDuring(readDesktopSessions);
    assert.equal(cold.reads, 1);
    assert.equal(desktopCacheStats.fullReads, 1, 'the window could not answer');
    assert.deepEqual(cold.value.get(CLI_A), { archived: true, title: 'Cut' });
  } finally {
    await cleanup(store);
  }
});

test('a window cut mid-number costs a full read, and the full read answers', async () => {
  const store = await makeStore();
  try {
    // Pad so the digits of `n` straddle byte 8192: five digits inside the
    // window, five outside. A scanner that took `12345` as the whole number
    // would then find the window ending where a comma should be.
    const lead = '{"filler":"';
    const pad = 'x'.repeat(HEAD - lead.length - '","n":'.length - 5);
    const prefix = lead + pad + '","n":' + '12345';
    assert.equal(Buffer.byteLength(prefix), HEAD);
    const raw = straddling(store, prefix, `67890,"cliSessionId":"${CLI_A}","isArchived":false}`);
    assert.equal(JSON.parse(raw).n, 1234567890);

    const cold = await readsDuring(readDesktopSessions);
    assert.equal(cold.reads, 1);
    assert.equal(desktopCacheStats.fullReads, 1, 'the window could not answer');
    assert.deepEqual(cold.value.get(CLI_A), { archived: false, title: undefined });
  } finally {
    await cleanup(store);
  }
});

test('a window ending on the backslash of an escape costs a full read, and the title survives', async () => {
  const store = await makeStore();
  try {
    // The title holds an escaped quote whose backslash is the window's last
    // byte and whose quote is the first byte outside it. Read only the head,
    // the string is unclosed; read naively past the backslash, the quote
    // looks like a close. The answer has to come from the whole file.
    const lead = '{"title":"';
    const pad = 'x'.repeat(HEAD - lead.length - 1);
    const prefix = lead + pad + '\\';
    assert.equal(Buffer.byteLength(prefix), HEAD);
    const raw = straddling(store, prefix, `"tail","cliSessionId":"${CLI_A}","isArchived":true}`);
    const expected = JSON.parse(raw).title;
    assert.ok(expected.endsWith('x"tail'));

    const cold = await readsDuring(readDesktopSessions);
    assert.equal(cold.reads, 1);
    assert.equal(desktopCacheStats.fullReads, 1, 'the window could not answer');
    assert.deepEqual(cold.value.get(CLI_A), { archived: true, title: expected });
  } finally {
    await cleanup(store);
  }
});

test('the whole store is read without blocking the event loop', async () => {
  const store = await makeStore();
  try {
    for (let i = 0; i < 24; i++) {
      write(
        store,
        `local_${i}.json`,
        padded({ cliSessionId: `cli-${i}`, isArchived: i % 2 === 0 }),
      );
    }

    // The synchronous read this replaced stalled the loop for the whole call.
    // A setImmediate chain sees every turn, so the largest gap between turns
    // is the longest the daemon's HTTP server and SSE stream went unserved.
    let worst = 0;
    let last = performance.now();
    let stop = false;
    const tick = () => {
      const now = performance.now();
      worst = Math.max(worst, now - last);
      last = now;
      if (!stop) setImmediate(tick);
    };
    setImmediate(tick);
    const map = await readDesktopSessions();
    await new Promise((r) => setImmediate(r));
    stop = true;

    assert.equal(map.size, 24);
    assert.ok(worst < 50, `longest event-loop block was ${worst.toFixed(1)} ms`);
  } finally {
    await cleanup(store);
  }
});
