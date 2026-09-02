/**
 * The Claude Code adapter's scan, seen through the persistent summary cache.
 *
 * The property that matters most is at the bottom: a scan served from the
 * cache is deep-equal to a scan that never saw one. The cache is allowed to
 * make the floor appear sooner. It is not allowed to change what is on it.
 *
 * `CLAUDE_CONFIG_DIR`, `DECKHQ_STATE_DIR` and `DECKHQ_DESKTOP_SESSIONS_DIR`
 * are all read at module-import time, and a warm start is by definition a
 * second process, so every scenario here runs in its own child — the same
 * shape as test/unit/paths.test.mjs.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADAPTER = pathToFileURL(
  path.resolve(HERE, '../../src/adapters/claude-code/adapter.mjs'),
).href;
const FIXTURE = path.resolve(HERE, '../fixtures/claude-sample.jsonl');
const SESSION_ID = '11111111-1111-1111-1111-111111111111';

/**
 * A throwaway machine: a `~/.claude` with one project holding one transcript,
 * a DeckHQ data directory, and a desktop-app store.
 */
async function makeWorld() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-scan-'));
  const claudeDir = path.join(root, 'claude');
  const projectDir = path.join(claudeDir, 'projects', 'C--Dk-Projects-FixtureProj');
  await fsp.mkdir(projectDir, { recursive: true });
  const transcript = path.join(projectDir, `${SESSION_ID}.jsonl`);
  await fsp.copyFile(FIXTURE, transcript);
  const stateDir = path.join(root, 'data');
  const desktopDir = path.join(root, 'desktop');
  return {
    root,
    claudeDir,
    projectDir,
    transcript,
    stateDir,
    desktopDir,
    cacheFile: path.join(stateDir, 'cache', 'claude-code.json'),
  };
}

/**
 * Run `body` in a fresh process against `world`, with `adapter` in scope and
 * `out(v)` to return a value. `stateDir` may be overridden to simulate a
 * machine that has never cached anything.
 * @param {Awaited<ReturnType<typeof makeWorld>>} world
 * @param {string} body
 * @param {{stateDir?: string}} [opts]
 */
function inChild(world, body, opts = {}) {
  const script = `
    const { adapter } = await import(${JSON.stringify(ADAPTER)});
    const out = (v) => process.stdout.write(JSON.stringify(v));
    const scan = () => adapter.scanSessions({ maxAgeDays: 36500, limit: 5000 });
    ${body}
  `;
  const stdout = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env: {
      ...process.env,
      CLAUDE_CONFIG_DIR: world.claudeDir,
      DECKHQ_STATE_DIR: opts.stateDir || world.stateDir,
      DECKHQ_DESKTOP_SESSIONS_DIR: world.desktopDir,
    },
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

/** Write a cache file by hand, so a scan can be caught using it. */
async function writeCache(world, payload) {
  await fsp.mkdir(path.dirname(world.cacheFile), { recursive: true });
  await fsp.writeFile(world.cacheFile, payload, 'utf8');
}

/**
 * A cache file whose one entry matches the fixture's real (mtime, size) but
 * carries an unmistakable title. If a scan returns that title, the transcript
 * was not re-read — which is the only way to prove a cache hit from outside.
 */
async function plantedCache(world, { version = 1, mtimeShift = 0, sizeShift = 0 } = {}) {
  const stat = await fsp.stat(world.transcript);
  await writeCache(
    world,
    JSON.stringify({
      version,
      runtime: 'claude-code',
      updatedAt: Date.now(),
      entries: {
        [world.transcript]: {
          mtimeMs: stat.mtimeMs + mtimeShift,
          size: stat.size + sizeShift,
          summary: {
            id: `claude-code:${SESSION_ID}`,
            runtime: 'claude-code',
            title: 'FROM THE CACHE',
            hasCustomTitle: true,
            cwd: 'C:\\Dk\\Projects\\FixtureProj',
            gitBranch: 'main',
            model: 'claude-sonnet-5',
            lastActivityAt: 1_800_000_000_000,
            tokens: 999,
            cacheTokens: 0,
            costEstimate: 0,
            lastRole: 'assistant',
            lastText: 'planted',
            turnEnded: true,
          },
        },
      },
    }),
  );
}

async function cleanup(world) {
  await fsp.rm(world.root, { recursive: true, force: true });
}

// --------------------------------------------------------------------------

test('a cold start with no cache file scans normally and writes one', async () => {
  const world = await makeWorld();
  try {
    assert.equal(fs.existsSync(world.cacheFile), false);
    const summaries = inChild(world, 'out(await scan())');

    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].id, `claude-code:${SESSION_ID}`);
    assert.equal(summaries[0].title, 'Final title');

    assert.ok(fs.existsSync(world.cacheFile), 'the scan left a cache behind');
    const cached = JSON.parse(await fsp.readFile(world.cacheFile, 'utf8'));
    assert.equal(cached.version, 1);
    assert.equal(cached.runtime, 'claude-code');
    assert.deepEqual(Object.keys(cached.entries), [world.transcript]);
  } finally {
    await cleanup(world);
  }
});

test('a warm start is served from the cache without re-reading the transcript', async () => {
  const world = await makeWorld();
  try {
    await plantedCache(world);
    const summaries = inChild(world, 'out(await scan())');
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].title, 'FROM THE CACHE');
    assert.equal(summaries[0].tokens, 999);
  } finally {
    await cleanup(world);
  }
});

test('a file whose mtime changed is re-parsed, not served stale', async () => {
  const world = await makeWorld();
  try {
    await plantedCache(world, { mtimeShift: -5000 });
    const summaries = inChild(world, 'out(await scan())');
    assert.equal(summaries[0].title, 'Final title');
    assert.notEqual(summaries[0].tokens, 999);
  } finally {
    await cleanup(world);
  }
});

test('a file whose size changed is re-parsed, not served stale', async () => {
  const world = await makeWorld();
  try {
    await plantedCache(world, { sizeShift: 1 });
    const summaries = inChild(world, 'out(await scan())');
    assert.equal(summaries[0].title, 'Final title');
  } finally {
    await cleanup(world);
  }
});

test('a transcript that was deleted loses its cache entry', async () => {
  const world = await makeWorld();
  try {
    // A first scan caches the real session, then a second machine state has
    // that transcript gone and one other still present.
    inChild(world, 'out((await scan()).length)');
    const before = JSON.parse(await fsp.readFile(world.cacheFile, 'utf8'));
    assert.equal(Object.keys(before.entries).length, 1);

    await fsp.rm(world.transcript);
    // A second transcript so the scan still has something to parse (and so
    // something is dirty, which is what triggers the rewrite).
    const other = path.join(world.projectDir, '22222222-2222-2222-2222-222222222222.jsonl');
    await fsp.copyFile(FIXTURE, other);

    const summaries = inChild(world, 'out(await scan())');
    assert.equal(summaries.length, 1);

    const after = JSON.parse(await fsp.readFile(world.cacheFile, 'utf8'));
    assert.deepEqual(Object.keys(after.entries), [other]);
  } finally {
    await cleanup(world);
  }
});

test('a projects directory that reads as empty does not empty the cache', async () => {
  const world = await makeWorld();
  try {
    inChild(world, 'out((await scan()).length)');
    const before = await fsp.readFile(world.cacheFile, 'utf8');

    // An unreadable or momentarily missing projects directory returns the same
    // empty list as "the user deleted everything". Treating the two the same
    // would throw a good cache away and buy a full cold scan next start.
    await fsp.rm(path.join(world.claudeDir, 'projects'), { recursive: true, force: true });
    assert.deepEqual(inChild(world, 'out(await scan())'), []);

    assert.equal(await fsp.readFile(world.cacheFile, 'utf8'), before);
  } finally {
    await cleanup(world);
  }
});

test('a corrupt cache file never prevents a scan, and is rebuilt', async () => {
  const world = await makeWorld();
  try {
    await writeCache(world, '{"version":1,"runtime":"claude-co\u0000\u0000');
    const summaries = inChild(world, 'out(await scan())');
    assert.equal(summaries.length, 1);
    assert.equal(summaries[0].title, 'Final title');

    const rebuilt = JSON.parse(await fsp.readFile(world.cacheFile, 'utf8'));
    assert.equal(rebuilt.version, 1);
    assert.deepEqual(Object.keys(rebuilt.entries), [world.transcript]);
  } finally {
    await cleanup(world);
  }
});

test('a cache file from another schema version is discarded, not trusted', async () => {
  const world = await makeWorld();
  try {
    // Same planted entry that a matching version WOULD have been served from.
    await plantedCache(world, { version: 999 });
    const summaries = inChild(world, 'out(await scan())');
    assert.equal(summaries[0].title, 'Final title');

    const rewritten = JSON.parse(await fsp.readFile(world.cacheFile, 'utf8'));
    assert.equal(rewritten.version, 1);
  } finally {
    await cleanup(world);
  }
});

// --------------------------------------------------------------------------
// The property the cache exists to not break.
// --------------------------------------------------------------------------

test('a scan served from the cache is byte-identical to one that never saw it', async () => {
  const world = await makeWorld();
  try {
    // 1. cold: no cache file exists, so this parses everything and persists.
    const cold = inChild(world, 'out(await scan())');
    assert.ok(fs.existsSync(world.cacheFile));

    // 2. warm: a second process, served from what the first one wrote.
    const warm = inChild(world, 'out(await scan())');

    // 3. control: a third process pointed at a data directory that has never
    //    held a cache, so it parses from scratch again.
    const control = inChild(world, 'out(await scan())', {
      stateDir: path.join(world.root, 'no-cache-here'),
    });

    assert.deepEqual(warm, cold);
    assert.deepEqual(warm, control);
    assert.equal(JSON.stringify(warm), JSON.stringify(control));
  } finally {
    await cleanup(world);
  }
});

// --------------------------------------------------------------------------
// docs/DEVIATIONS.md §46: the archive flag is applied AFTER the cache, and
// persisting the cache is what would have made a stale one permanent.
// --------------------------------------------------------------------------

/** @param {string} dir @param {boolean} archived */
async function writeDesktopSession(dir, archived) {
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(
    path.join(dir, 'local_abc.json'),
    JSON.stringify({ sessionId: 'local_abc', cliSessionId: SESSION_ID, isArchived: archived }),
    'utf8',
  );
}

test('INVARIANT: an archive flag never enters the persisted cache', async () => {
  const world = await makeWorld();
  try {
    await writeDesktopSession(world.desktopDir, true);

    const summaries = inChild(world, 'out(await scan())');
    assert.equal(summaries[0].archived, true, 'the scan still reports the flag');

    const raw = await fsp.readFile(world.cacheFile, 'utf8');
    assert.equal(raw.includes('archived'), false, 'but it is not what got written down');
  } finally {
    await cleanup(world);
  }
});

test('INVARIANT: un-archiving is seen on the next start even though the summary is cached', async () => {
  const world = await makeWorld();
  try {
    // Archived, cached, daemon restarted, then un-archived in the app. The
    // transcript never changed, so every summary below is a cache hit — which
    // is precisely the case that would strand a `let_go` agent as fired
    // forever if the flag had been cached with it.
    await writeDesktopSession(world.desktopDir, true);
    const first = inChild(world, 'out(await scan())');
    assert.equal(first[0].archived, true);

    await writeDesktopSession(world.desktopDir, false);
    const second = inChild(world, 'out(await scan())');
    assert.equal(second[0].archived, false, 'rehired, from a cache hit');

    // And with the desktop store gone entirely, `archived` is absent rather
    // than a stale boolean: the registry reads undefined as "this runtime
    // cannot see an archive", never as "not archived".
    await fsp.rm(world.desktopDir, { recursive: true, force: true });
    const third = inChild(world, 'out(await scan())');
    assert.equal('archived' in third[0], false);
  } finally {
    await cleanup(world);
  }
});
