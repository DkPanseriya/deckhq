/**
 * The persistent scan cache.
 *
 * Two properties are doing all the work here and every test below is really
 * one of them:
 *
 *   1. A bad cache file is never anything worse than a slow start. Corrupt,
 *      truncated, foreign, mis-shaped or from an older schema — all of it is
 *      discarded in silence and rebuilt. Nothing here is user-owned, so
 *      throwing it away costs a scan and nothing else.
 *   2. A cache hit is indistinguishable from a fresh parse, including the fact
 *      that the caller may scribble on what it is handed. The desktop app's
 *      `archived` flag is stamped onto summaries AFTER the cache
 *      (docs/DEVIATIONS.md §46), and persisting the cache is exactly what
 *      would turn "a stale flag until the file changes" into "a stale flag
 *      forever". The copy-in/copy-out rule is what stops it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { SummaryCache, CACHE_SCHEMA_VERSION } from '../../src/core/summary-cache.mjs';

async function tmpFile() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-cache-'));
  return { dir, file: path.join(dir, 'claude-code.json') };
}

async function cleanup(dir) {
  await fsp.rm(dir, { recursive: true, force: true });
}

/** A summary shaped like the ones `parseSummary` produces. */
function summary(id, extra = {}) {
  return {
    id: `claude-code:${id}`,
    runtime: 'claude-code',
    title: `title ${id}`,
    hasCustomTitle: false,
    cwd: 'C:\\p',
    gitBranch: 'main',
    model: 'claude-sonnet-5',
    lastActivityAt: 1_700_000_000_000,
    tokens: 150,
    cacheTokens: 0,
    costEstimate: 0.001,
    lastRole: 'assistant',
    lastText: 'hello',
    turnEnded: true,
    ...extra,
  };
}

/** A cache with one entry already persisted, and the instance that wrote it. */
async function seeded(file, opts = {}) {
  const cache = new SummaryCache(file, { runtime: 'claude-code', ...opts });
  await cache.load();
  cache.set('/p/a.jsonl', 1000, 500, summary('a'));
  await cache.persist({ force: true });
  return cache;
}

// --------------------------------------------------------------------------
// Cold start, warm start, and the (path, mtime, size) key.
// --------------------------------------------------------------------------

test('a cold start with no cache file loads empty and reports no problem', async () => {
  const { dir, file } = await tmpFile();
  try {
    const cache = new SummaryCache(file, { runtime: 'claude-code' });
    await cache.load();
    assert.equal(cache.size, 0);
    assert.equal(cache.stats.discarded, null);
    assert.equal(cache.get('/p/a.jsonl', 1000, 500), undefined);
    // Nothing to write, so nothing is written: a read-only scan must not
    // create files it has no content for.
    assert.equal(await cache.persist({ force: true }), false);
    assert.equal(fs.existsSync(file), false);
  } finally {
    await cleanup(dir);
  }
});

test('a warm start serves the entry the previous process wrote', async () => {
  const { dir, file } = await tmpFile();
  try {
    await seeded(file);

    const next = new SummaryCache(file, { runtime: 'claude-code' });
    await next.load();
    assert.equal(next.stats.loadedEntries, 1);
    assert.deepEqual(next.get('/p/a.jsonl', 1000, 500), summary('a'));
    assert.equal(next.stats.hits, 1);
  } finally {
    await cleanup(dir);
  }
});

test('a changed mtime misses, even at the same size', async () => {
  const { dir, file } = await tmpFile();
  try {
    await seeded(file);
    const next = new SummaryCache(file, { runtime: 'claude-code' });
    await next.load();
    assert.equal(next.get('/p/a.jsonl', 1001, 500), undefined);
    assert.equal(next.stats.misses, 1);
  } finally {
    await cleanup(dir);
  }
});

test('a changed size misses, even at the same mtime', async () => {
  const { dir, file } = await tmpFile();
  try {
    await seeded(file);
    const next = new SummaryCache(file, { runtime: 'claude-code' });
    await next.load();
    assert.equal(next.get('/p/a.jsonl', 1000, 501), undefined);
  } finally {
    await cleanup(dir);
  }
});

test('a fractional mtime survives the JSON round trip exactly', async () => {
  // stat().mtimeMs is a double with sub-millisecond precision on NTFS. If it
  // did not round-trip bit-for-bit through JSON, every entry would miss on
  // every warm start and the whole cache would be a silent no-op.
  const { dir, file } = await tmpFile();
  try {
    const mtime = 1756800000123.4567;
    const cache = new SummaryCache(file, { runtime: 'claude-code' });
    await cache.load();
    cache.set('/p/a.jsonl', mtime, 500, summary('a'));
    await cache.persist({ force: true });

    const next = new SummaryCache(file, { runtime: 'claude-code' });
    await next.load();
    assert.ok(next.get('/p/a.jsonl', mtime, 500));
  } finally {
    await cleanup(dir);
  }
});

// --------------------------------------------------------------------------
// A bad file is a slow start, never a failed one.
// --------------------------------------------------------------------------

for (const [label, contents] of [
  ['garbage bytes', '\u0000\u0001not json at all'],
  ['a truncated write', '{"version":1,"runtime":"claude-code","entries":{"/p/a.js'],
  ['a JSON array', '[1,2,3]'],
  ['a JSON string', '"hello"'],
  ['JSON null', 'null'],
  ['an empty file', ''],
  ['entries that are not an object', '{"version":1,"runtime":"claude-code","entries":[]}'],
]) {
  test(`${label} is discarded silently and rebuilt`, async () => {
    const { dir, file } = await tmpFile();
    try {
      await fsp.mkdir(path.dirname(file), { recursive: true });
      await fsp.writeFile(file, contents, 'utf8');

      const cache = new SummaryCache(file, { runtime: 'claude-code' });
      await cache.load(); // must not throw
      assert.equal(cache.size, 0);
      assert.equal(cache.get('/p/a.jsonl', 1000, 500), undefined);

      // and it rebuilds over the top, atomically
      cache.set('/p/a.jsonl', 1000, 500, summary('a'));
      assert.equal(await cache.persist({ force: true }), true);
      const reread = new SummaryCache(file, { runtime: 'claude-code' });
      await reread.load();
      assert.equal(reread.size, 1);
    } finally {
      await cleanup(dir);
    }
  });
}

test('a schema version bump discards the file rather than migrating it', async () => {
  const { dir, file } = await tmpFile();
  try {
    await seeded(file);

    const bumped = new SummaryCache(file, {
      runtime: 'claude-code',
      schemaVersion: CACHE_SCHEMA_VERSION + 1,
    });
    await bumped.load();
    assert.equal(bumped.size, 0);
    assert.equal(bumped.stats.discarded, 'version');

    // The old file is not left to rot: the next persist overwrites it, and it
    // comes back readable at the new version and unreadable at the old one.
    bumped.set('/p/b.jsonl', 2000, 600, summary('b'));
    await bumped.persist({ force: true });

    const old = new SummaryCache(file, { runtime: 'claude-code' });
    await old.load();
    assert.equal(old.size, 0);
    assert.equal(old.stats.discarded, 'version');
  } finally {
    await cleanup(dir);
  }
});

test("another runtime's cache file is discarded, not parsed", async () => {
  const { dir, file } = await tmpFile();
  try {
    await seeded(file);
    const other = new SummaryCache(file, { runtime: 'codex' });
    await other.load();
    assert.equal(other.size, 0);
    assert.equal(other.stats.discarded, 'runtime');
  } finally {
    await cleanup(dir);
  }
});

test('one malformed entry is dropped; the rest of the file still loads', async () => {
  const { dir, file } = await tmpFile();
  try {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(
      file,
      JSON.stringify({
        version: CACHE_SCHEMA_VERSION,
        runtime: 'claude-code',
        entries: {
          '/p/good.jsonl': { mtimeMs: 1, size: 2, summary: summary('good') },
          '/p/nosummary.jsonl': { mtimeMs: 1, size: 2 },
          '/p/badmtime.jsonl': { mtimeMs: 'soon', size: 2, summary: summary('x') },
          '/p/badsize.jsonl': { mtimeMs: 1, size: null, summary: summary('x') },
          '/p/noid.jsonl': { mtimeMs: 1, size: 2, summary: { title: 'no id' } },
          '/p/notanentry.jsonl': 7,
        },
      }),
      'utf8',
    );

    const cache = new SummaryCache(file, { runtime: 'claude-code' });
    await cache.load();
    assert.equal(cache.size, 1);
    assert.ok(cache.get('/p/good.jsonl', 1, 2));
  } finally {
    await cleanup(dir);
  }
});

test('a cache file that cannot be written is not an error anyone hears about', async () => {
  const { dir } = await tmpFile();
  try {
    // A path whose parent is a FILE, so mkdir and write both fail.
    const blocker = path.join(dir, 'blocker');
    await fsp.writeFile(blocker, 'not a directory', 'utf8');
    const cache = new SummaryCache(path.join(blocker, 'nested', 'claude-code.json'), {
      runtime: 'claude-code',
    });
    await cache.load(); // must not throw
    cache.set('/p/a.jsonl', 1000, 500, summary('a'));
    assert.equal(await cache.persist({ force: true }), false);
    // Still usable in memory — the process just does not get the benefit next
    // time round.
    assert.ok(cache.get('/p/a.jsonl', 1000, 500));
  } finally {
    await cleanup(dir);
  }
});

// --------------------------------------------------------------------------
// The archived-flag trap. docs/DEVIATIONS.md §46.
// --------------------------------------------------------------------------

test('a summary handed out is a copy: scribbling on it cannot reach the cache', async () => {
  const { dir, file } = await tmpFile();
  try {
    const cache = await seeded(file);

    const first = cache.get('/p/a.jsonl', 1000, 500);
    // This is exactly what the adapter does after the cache: stamp the
    // desktop app's archive flag onto the summary it is about to return.
    first.archived = true;
    first.title = 'mutated';

    const second = cache.get('/p/a.jsonl', 1000, 500);
    assert.equal(second.archived, undefined);
    assert.equal(second.title, 'title a');
  } finally {
    await cleanup(dir);
  }
});

test('an archived flag is stripped on the way in and never reaches disk', async () => {
  const { dir, file } = await tmpFile();
  try {
    const cache = new SummaryCache(file, { runtime: 'claude-code' });
    await cache.load();
    cache.set('/p/a.jsonl', 1000, 500, summary('a', { archived: true }));
    await cache.persist({ force: true });

    const raw = await fsp.readFile(file, 'utf8');
    assert.equal(raw.includes('archived'), false);

    const next = new SummaryCache(file, { runtime: 'claude-code' });
    await next.load();
    assert.equal(next.get('/p/a.jsonl', 1000, 500).archived, undefined);
  } finally {
    await cleanup(dir);
  }
});

// --------------------------------------------------------------------------
// Bounds.
// --------------------------------------------------------------------------

test('an entry whose file is gone is evicted', async () => {
  const { dir, file } = await tmpFile();
  try {
    const cache = new SummaryCache(file, { runtime: 'claude-code' });
    await cache.load();
    cache.set('/p/a.jsonl', 1, 1, summary('a'));
    cache.set('/p/gone.jsonl', 2, 2, summary('gone'));
    cache.set('/p/b.jsonl', 3, 3, summary('b'));

    const evicted = cache.retain(new Set(['/p/a.jsonl', '/p/b.jsonl']));
    assert.equal(evicted, 1);
    assert.equal(cache.size, 2);
    assert.equal(cache.get('/p/gone.jsonl', 2, 2), undefined);

    await cache.persist({ force: true });
    const next = new SummaryCache(file, { runtime: 'claude-code' });
    await next.load();
    assert.equal(next.size, 2);
  } finally {
    await cleanup(dir);
  }
});

test('retaining nothing evicts nothing when every file is still there', async () => {
  const { dir, file } = await tmpFile();
  try {
    const cache = new SummaryCache(file, { runtime: 'claude-code' });
    await cache.load();
    cache.set('/p/a.jsonl', 1, 1, summary('a'));
    assert.equal(cache.retain(new Set(['/p/a.jsonl'])), 0);
    assert.equal(cache.size, 1);
  } finally {
    await cleanup(dir);
  }
});

test('past the entry ceiling, the most recently active entries are the ones kept', async () => {
  const { dir, file } = await tmpFile();
  try {
    const cache = new SummaryCache(file, { runtime: 'claude-code', maxEntries: 3 });
    await cache.load();
    for (let i = 0; i < 10; i++) {
      cache.set(`/p/${i}.jsonl`, 1000 + i, 10, summary(String(i)));
    }
    await cache.persist({ force: true });

    const next = new SummaryCache(file, { runtime: 'claude-code', maxEntries: 3 });
    await next.load();
    assert.equal(next.size, 3);
    for (const i of [9, 8, 7]) assert.ok(next.get(`/p/${i}.jsonl`, 1000 + i, 10), `kept ${i}`);
    for (const i of [0, 1, 6]) assert.equal(next.get(`/p/${i}.jsonl`, 1000 + i, 10), undefined);
    // Memory and disk agree; the in-memory map is trimmed to match.
    assert.equal(cache.size, 3);
  } finally {
    await cleanup(dir);
  }
});

test('past the byte ceiling, the file is capped and stays loadable', async () => {
  const { dir, file } = await tmpFile();
  try {
    const cache = new SummaryCache(file, { runtime: 'claude-code', maxBytes: 4096 });
    await cache.load();
    for (let i = 0; i < 200; i++) {
      cache.set(`/p/${i}.jsonl`, 1000 + i, 10, summary(String(i)));
    }
    await cache.persist({ force: true });

    const bytes = (await fsp.stat(file)).size;
    assert.ok(bytes <= 4096, `cache file is ${bytes} bytes`);

    const next = new SummaryCache(file, { runtime: 'claude-code', maxBytes: 4096 });
    await next.load();
    assert.ok(next.size > 0 && next.size < 200);
    // Newest first: 199 survives, 0 does not.
    assert.ok(next.get('/p/199.jsonl', 1199, 10));
    assert.equal(next.get('/p/0.jsonl', 1000, 10), undefined);
  } finally {
    await cleanup(dir);
  }
});

// --------------------------------------------------------------------------
// Writing.
// --------------------------------------------------------------------------

test('an unchanged cache is not rewritten', async () => {
  const { dir, file } = await tmpFile();
  try {
    const cache = await seeded(file);
    assert.equal(await cache.persist({ force: true }), false);
  } finally {
    await cleanup(dir);
  }
});

test('writes are rate-limited, and forcing overrides it', async () => {
  const { dir, file } = await tmpFile();
  try {
    const cache = new SummaryCache(file, { runtime: 'claude-code', minWriteIntervalMs: 30_000 });
    await cache.load();

    cache.set('/p/a.jsonl', 1, 1, summary('a'));
    // The first write of a process is always allowed: it is the cold scan,
    // and its result is the one most worth keeping.
    assert.equal(await cache.persist({ now: 1_000_000 }), true);

    cache.set('/p/b.jsonl', 2, 2, summary('b'));
    assert.equal(await cache.persist({ now: 1_005_000 }), false);
    assert.equal(await cache.persist({ now: 1_040_000 }), true);

    cache.set('/p/c.jsonl', 3, 3, summary('c'));
    assert.equal(await cache.persist({ force: true, now: 1_040_100 }), true);
  } finally {
    await cleanup(dir);
  }
});

test('the write is atomic and leaves no temp file behind', async () => {
  const { dir, file } = await tmpFile();
  try {
    const cache = new SummaryCache(file, { runtime: 'claude-code' });
    await cache.load();
    cache.set('/p/a.jsonl', 1, 1, summary('a'));
    await cache.persist({ force: true });

    const left = (await fsp.readdir(path.dirname(file))).filter((n) => n.includes('.tmp-'));
    assert.deepEqual(left, []);
    // The file that exists is a complete one.
    JSON.parse(await fsp.readFile(file, 'utf8'));
  } finally {
    await cleanup(dir);
  }
});
