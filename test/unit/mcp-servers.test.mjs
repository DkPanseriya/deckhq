// A machine of our own, before anything under `src/` is loaded.
// `docs/DEVIATIONS.md` §124.
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  parseMcpList,
  mcpServersFromInit,
  lastMcpServers,
} from '../../src/adapters/claude-code/parse.mjs';
import {
  describeMcpServers,
  MCP_LIST_TIMEOUT_MS,
  newestSessionMcpServers,
  runMcpList,
} from '../../src/adapters/claude-code/adapter-mcp.mjs';
import { collectRuntime } from '../../src/cli/doctor-collect.mjs';
import { describeMcp, renderReport } from '../../src/cli/doctor-report.mjs';
import { describeMcpForShare, renderShare } from '../../src/cli/doctor-share.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIST_FIXTURE = path.join(HERE, '..', 'fixtures', 'claude-mcp-list.txt');

/**
 * The smallest report `renderReport` will render, around one runtime row.
 * @param {any} runtime
 */
function reportWith(runtime) {
  return /** @type {any} */ ({
    generatedAt: Date.parse('2026-09-08T00:00:00Z'),
    ok: true,
    runtimes: [runtime],
    hooks: [],
    deck: { found: false, waiting: null, waitingNotRunning: null, oldestWaitAt: null, total: null },
    state: { path: 'x', writable: true, error: null },
    terminal: { id: null, label: null, reason: null, present: false, pinned: false },
    egress: { outbound: 0, note: 'none. no outbound sockets.' },
    problems: [],
    notes: [],
  });
}

// ------------------------------------------------------- `claude mcp list`

test('fixture: the real `claude mcp list` shape parses to names and statuses', async () => {
  const text = await fs.readFile(LIST_FIXTURE, 'utf8');
  const parsed = parseMcpList(text);
  assert.deepEqual(parsed.servers, [
    { name: 'fixture-notes', status: 'connected' },
    { name: 'fixture-mail', status: 'connected' },
    { name: 'fixture-weather', status: 'failed' },
  ]);
  assert.equal(parsed.connected, 2);
  assert.equal(parsed.failed, 1);
});

test('the parser keeps no target at all — not the command, not the URL', async () => {
  const text = await fs.readFile(LIST_FIXTURE, 'utf8');
  const parsed = parseMcpList(text);
  const rendered = JSON.stringify(parsed);
  // A target can carry a token in a query string or a host. It is prevented
  // structurally: there is nothing in the parse result to print.
  for (const leak of ['example.invalid', 'https://', 'C:\\fixture', 'node ', '(HTTP)']) {
    assert.ok(!rendered.includes(leak), `parse result carries ${leak}`);
  }
});

test('the status test does not depend on which tick glyph the CLI uses', () => {
  const both = parseMcpList(
    ['a: x - ✔ Connected', 'b: y - ✓ Connected', 'c: z - Connected'].join('\n'),
  );
  assert.equal(both.connected, 3);
  assert.equal(both.failed, 0);
  const bad = parseMcpList('d: y - ✗ Failed to connect\ne: y - ✘ Needs authentication');
  assert.equal(bad.connected, 0);
  assert.equal(bad.failed, 2);
});

test('a header, a blank line and a line with no status are all skipped, never thrown on', () => {
  const parsed = parseMcpList(
    ['Checking MCP server health…', '', 'No MCP servers configured.', 'junk'].join('\n'),
  );
  assert.deepEqual(parsed.servers, []);
  assert.equal(parsed.connected, 0);
  assert.equal(parsed.failed, 0);
  // Every degenerate input is an empty list rather than a throw.
  for (const input of [undefined, null, '', 42, {}]) {
    assert.deepEqual(parseMcpList(/** @type {any} */ (input)).servers, []);
  }
});

// ------------------------------------------------------------- init events

test('a `system`/`init` record yields its mcp_servers, verbatim statuses', () => {
  const rec = {
    type: 'system',
    subtype: 'init',
    session_id: 'sess-1',
    tools: ['Bash', 'Read', 'mcp__fixture-notes__search'],
    mcp_servers: [
      { name: 'fixture-notes', status: 'connected' },
      { name: 'fixture-weather', status: 'failed' },
      { name: 'fixture-auth', status: 'needs-auth' },
    ],
  };
  assert.deepEqual(mcpServersFromInit(rec), [
    { name: 'fixture-notes', status: 'connected' },
    { name: 'fixture-weather', status: 'failed' },
    // Kept as the runtime spelled it: deciding that this means "failed" is
    // not the parser's call to make.
    { name: 'fixture-auth', status: 'needs-auth' },
  ]);
});

test('anything that is not an init event with a list is null', () => {
  for (const rec of [
    null,
    {},
    { type: 'system' },
    { type: 'system', subtype: 'status', mcp_servers: [] },
    { type: 'assistant', subtype: 'init', mcp_servers: [] },
    { type: 'system', subtype: 'init' },
    { type: 'system', subtype: 'init', mcp_servers: 'three' },
  ]) {
    assert.equal(mcpServersFromInit(/** @type {any} */ (rec)), null);
  }
  // An init event with an EMPTY list is an answer, not an absence.
  assert.deepEqual(mcpServersFromInit({ type: 'system', subtype: 'init', mcp_servers: [] }), []);
});

test('a malformed server entry is skipped and the rest of the list survives', () => {
  const servers = mcpServersFromInit({
    type: 'system',
    subtype: 'init',
    mcp_servers: [null, 'nope', { status: 'connected' }, { name: 'ok', status: 'connected' }],
  });
  assert.deepEqual(servers, [{ name: 'ok', status: 'connected' }]);
});

test('a server name carrying control characters is collapsed to one printable line', () => {
  const servers = mcpServersFromInit({
    type: 'system',
    subtype: 'init',
    mcp_servers: [{ name: 'ev\u0007il\nname', status: 'con\nnected' }],
  });
  assert.deepEqual(servers, [{ name: 'ev il name', status: 'con nected' }]);
});

test('the LAST init record in a file wins, and physical order decides it', () => {
  const text = [
    JSON.stringify({
      type: 'system',
      subtype: 'init',
      mcp_servers: [{ name: 'a', status: 'connected' }],
    }),
    'this line is deliberately corrupt {',
    JSON.stringify({
      type: 'system',
      subtype: 'init',
      mcp_servers: [{ name: 'b', status: 'failed' }],
    }),
  ].join('\n');
  assert.deepEqual(lastMcpServers([text]), [{ name: 'b', status: 'failed' }]);
  assert.equal(lastMcpServers(['']), null);
});

// ----------------------------------------------------------- the adapter

test('runMcpList spawns `claude mcp list` as an argv array, never a shell string', async () => {
  /** @type {any[]} */
  const calls = [];
  await runMcpList({
    run: (
      /** @type {any} */ file,
      /** @type {any} */ args,
      /** @type {any} */ opts,
      /** @type {any} */ cb,
    ) => {
      calls.push({ file, args, opts });
      cb(null, 'x: y - ✔ Connected\n');
      return /** @type {any} */ ({});
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, 'claude');
  assert.deepEqual(calls[0].args, ['mcp', 'list']);
  assert.equal(calls[0].opts.timeout, MCP_LIST_TIMEOUT_MS);
});

test('a missing binary, a timeout and an error each say which one it was', async () => {
  const reason = async (/** @type {any} */ err) =>
    (
      await runMcpList({
        run: (
          /** @type {any} */ _f,
          /** @type {any} */ _a,
          /** @type {any} */ _o,
          /** @type {any} */ cb,
        ) => {
          cb(err, '');
          return /** @type {any} */ ({});
        },
      })
    ).reason;
  assert.equal(
    await reason(Object.assign(new Error('spawn'), { code: 'ENOENT' })),
    'claude is not on PATH',
  );
  assert.match(
    await reason(Object.assign(new Error('timeout'), { killed: true })),
    /did not answer within 10s/,
  );
  assert.equal(await reason(new Error('exit 1')), 'claude mcp list exited with an error');
});

test('the CLI answers first; the newest session is the fallback; neither is "not checked"', async () => {
  const ok = (/** @type {string} */ out) => ({
    run: (
      /** @type {any} */ _f,
      /** @type {any} */ _a,
      /** @type {any} */ _o,
      /** @type {any} */ cb,
    ) => {
      cb(null, out);
      return /** @type {any} */ ({});
    },
  });
  const noCli = {
    run: (
      /** @type {any} */ _f,
      /** @type {any} */ _a,
      /** @type {any} */ _o,
      /** @type {any} */ cb,
    ) => {
      cb(Object.assign(new Error('nope'), { code: 'ENOENT' }), '');
      return /** @type {any} */ ({});
    },
  };

  const fromCli = await describeMcpServers(ok('a: t - ✔ Connected\nb: t - ✗ Failed to connect\n'));
  assert.equal(fromCli.checked, true);
  assert.equal(fromCli.source, 'cli');
  assert.equal(fromCli.connected, 1);
  assert.equal(fromCli.failed, 1);

  const initLine = JSON.stringify({
    type: 'system',
    subtype: 'init',
    mcp_servers: [
      { name: 'a', status: 'connected' },
      { name: 'b', status: 'failed' },
    ],
  });
  const fromSession = await describeMcpServers({
    ...noCli,
    list: async () => [
      { file: 'old.jsonl', sessionId: 'old', mtimeMs: 1, size: 1 },
      { file: 'new.jsonl', sessionId: 'new', mtimeMs: 2, size: 1 },
    ],
    head: async (/** @type {string} */ file) => (file === 'new.jsonl' ? initLine : ''),
  });
  assert.equal(fromSession.source, 'session');
  assert.equal(fromSession.connected, 1);
  assert.equal(fromSession.failed, 1);

  const neither = await describeMcpServers({
    ...noCli,
    list: async () => [],
    head: async () => '',
  });
  assert.equal(neither.checked, false);
  assert.equal(neither.source, null);
  assert.equal(neither.reason, 'claude is not on PATH');
  // NEVER a zero: "not checked" and "none configured" are different facts.
  assert.deepEqual(neither.servers, []);
});

test('newestSessionMcpServers degrades to null on a machine with no transcripts', async () => {
  assert.equal(await newestSessionMcpServers({ list: async () => [] }), null);
  assert.equal(
    await newestSessionMcpServers({
      list: async () => {
        throw new Error('unreadable');
      },
    }),
    null,
  );
});

// --------------------------------------------------------- the doctor rows

test('an adapter with no describeMcpServers gets `mcp: null`, and therefore no row', async () => {
  /** @param {any} extra */
  const fake = (extra) => ({
    id: 'fictional',
    label: 'Fictional',
    available: async () => true,
    scanSessions: async () => [],
    liveSessions: async () => [],
    ...extra,
  });
  const scan = { maxAgeDays: 1, limit: 1 };

  const without = await collectRuntime(fake({}), scan);
  assert.equal(without.mcp, null);
  assert.equal(renderReport(reportWith(without)).includes('mcp servers'), false);

  const with_ = await collectRuntime(
    fake({
      describeMcpServers: async () => ({
        checked: true,
        source: 'cli',
        reason: null,
        servers: [{ name: 'weather', status: 'failed' }],
        connected: 2,
        failed: 1,
      }),
    }),
    scan,
  );
  assert.equal(with_.mcp?.connected, 2);
  assert.ok(renderReport(reportWith(with_)).includes('2 connected, 1 failed (weather)'));

  // An adapter whose method throws must never fail the report.
  const thrower = await collectRuntime(
    fake({
      describeMcpServers: async () => {
        throw new Error('exploded');
      },
    }),
    scan,
  );
  assert.equal(thrower.mcp, null);
  assert.equal(thrower.error, null);
});

test('the doctor row reports counts, names the source, and names the failures', () => {
  assert.equal(
    describeMcp({ checked: true, source: 'cli', connected: 3, failed: 0, servers: [] }),
    '3 connected   (claude mcp list)',
  );
  assert.equal(
    describeMcp({
      checked: true,
      source: 'cli',
      connected: 3,
      failed: 1,
      servers: [{ name: 'weather', status: 'failed' }],
    }),
    '3 connected, 1 failed (weather)   (claude mcp list)',
  );
  assert.equal(
    describeMcp({ checked: true, source: 'session', connected: 1, failed: 0, servers: [] }),
    "1 connected   (from the newest session's init event)",
  );
  assert.equal(
    describeMcp({ checked: true, source: 'cli', connected: 0, failed: 0, servers: [] }),
    'none configured   (claude mcp list)',
  );
  assert.equal(
    describeMcp({
      checked: false,
      reason: 'claude is not on PATH',
      connected: 0,
      failed: 0,
      servers: [],
    }),
    'not checked: claude is not on PATH',
  );
});

test('the share row carries counts only: no name, no target, no source', () => {
  assert.equal(
    describeMcpForShare({
      checked: true,
      connected: 3,
      failed: 1,
      servers: [{ name: 'weather', status: 'failed' }],
    }),
    '3 connected, 1 failed',
  );
  assert.equal(
    describeMcpForShare({ checked: true, connected: 2, failed: 0, servers: [] }),
    '2 connected',
  );
  assert.equal(
    describeMcpForShare({ checked: true, connected: 0, failed: 0, servers: [] }),
    'none configured',
  );
  assert.equal(
    describeMcpForShare({ checked: false, connected: 0, failed: 0, servers: [] }),
    'not checked',
  );
});

test('`doctor --share` does not print an MCP server name', () => {
  const report = {
    generatedAt: Date.parse('2026-09-08T00:00:00Z'),
    ok: true,
    runtimes: [
      {
        id: 'claude-code',
        label: 'Claude Code',
        available: true,
        version: null,
        binary: null,
        readLimit: null,
        mcp: {
          checked: true,
          source: 'cli',
          reason: null,
          servers: [
            { name: 'sekrit-internal-jira', status: 'connected' },
            { name: 'sekrit-weather', status: 'failed' },
          ],
          connected: 1,
          failed: 1,
        },
        sessions: 2,
        projects: 1,
        live: 0,
        liveReported: 0,
        finished: 2,
        error: null,
      },
    ],
    hooks: [],
    deck: { found: false, waiting: null, waitingNotRunning: null, oldestWaitAt: null, total: null },
    state: { path: 'x', writable: true, error: null },
    terminal: { id: null, label: null, reason: null, present: false, pinned: false },
    egress: { outbound: 0, note: 'none. no outbound sockets.' },
    problems: [],
    notes: [],
  };
  const block = renderShare(/** @type {any} */ (report), {
    home: 'C:\\Users\\nobody',
    host: 'testbox',
  });
  assert.ok(block.includes('1 connected, 1 failed'));
  assert.ok(!block.includes('sekrit'), 'the share block named an MCP server');
});
