/**
 * OpenCode adapter — parsing, and degradation on a machine without it. WP-25.
 *
 * OpenCode is NOT installed on this machine (`opencode` is not on PATH and
 * `~/.local/share/opencode` does not exist), so these tests do two jobs at
 * once, exactly as `codex-parse.test.mjs` does:
 *
 *   1. Pin the documented shapes against synthetic fixtures, so a format break
 *      is a red test rather than an empty floor.
 *   2. Prove every adapter method is safe to call when the runtime is absent —
 *      empty results and clean failures, never a throw.
 *
 * The fixtures are synthetic copies of what three OpenCode commands print, and
 * the shapes are documented in `src/adapters/opencode/parse.mjs`, which carries
 * the provenance of every field name (read from `anomalyco/opencode` source on
 * 4 Sep 2026) and the argument for why this adapter shells out rather than
 * reading OpenCode's SQLite file. Nothing here has been checked against a real
 * install — see `docs/DEVIATIONS.md` §123 and `docs/ADAPTERS.md`'s honesty rule.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import {
  MAX_RECENT_MESSAGES,
  SQL,
  latestMessagePerSession,
  messageFromData,
  modelName,
  num,
  parseExport,
  parseJson,
  parseRows,
  partsToText,
  sessionFromInfoJson,
  sessionFromListRow,
  sessionFromSqlRow,
  truncateTitle,
} from '../../src/adapters/opencode/parse.mjs';
import {
  CLI,
  ROSTER_TTL_MS,
  adapter,
  opencodeNewSessionCommand,
  opencodeResumeCommand,
  opencodeRunArgs,
} from '../../src/adapters/opencode/adapter.mjs';
import { hooks } from '../../src/adapters/opencode/hooks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');

// ---------------------------------------------------------------------------
// JSON handling
// ---------------------------------------------------------------------------

test('parseJson: objects and arrays parse, everything else is null', () => {
  assert.deepEqual(parseJson('{"a":1}'), { a: 1 });
  assert.deepEqual(parseJson('[1,2]'), [1, 2]);
  assert.equal(parseJson('not json'), null);
  assert.equal(parseJson('"a string"'), null);
  assert.equal(parseJson('42'), null);
  assert.equal(parseJson(''), null);
  assert.equal(parseJson(undefined), null);
});

test('parseRows: finds the array even when the CLI wraps it in noise', () => {
  assert.deepEqual(parseRows('[{"id":"a"}]'), [{ id: 'a' }]);
  // A build that prints a warning line before the JSON must not cost the scan.
  assert.deepEqual(parseRows('warning: using dev build\n[{"id":"a"}]\n'), [{ id: 'a' }]);
  assert.deepEqual(parseRows('no array here'), []);
  assert.deepEqual(parseRows(''), []);
  // Non-object entries are dropped rather than carried into the mapper.
  assert.deepEqual(parseRows('[{"id":"a"},null,3,"x"]'), [{ id: 'a' }]);
});

test('num: reads numeric strings, refuses negatives and nonsense', () => {
  assert.equal(num(12), 12);
  assert.equal(num('1200'), 1200);
  assert.equal(num(-1), 0);
  assert.equal(num('-1'), 0);
  assert.equal(num(NaN), 0);
  assert.equal(num(null), 0);
  assert.equal(num('abc'), 0);
});

test('modelName: a bare string, a JSON blob, and an object all resolve', () => {
  assert.equal(modelName('claude-opus-5'), 'claude-opus-5');
  assert.equal(modelName('{"id":"claude-opus-5","providerID":"anthropic"}'), 'claude-opus-5');
  assert.equal(modelName({ id: 'claude-opus-5' }), 'claude-opus-5');
  assert.equal(modelName({ modelID: 'claude-opus-5' }), 'claude-opus-5');
  assert.equal(modelName(''), null);
  assert.equal(modelName(null), null);
});

// ---------------------------------------------------------------------------
// The SQL is a constant, and that is the security property
// ---------------------------------------------------------------------------

test('SQL: both queries are read-only SELECTs with nothing interpolated', () => {
  for (const [name, sql] of Object.entries(SQL)) {
    assert.match(sql, /^SELECT /, name);
    // Word-bounded: `time_updated` is a column name, not an UPDATE statement.
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|DROP|ATTACH|PRAGMA)\b/i, name);
    // `opencode db` runs whatever it is handed. The only safe way to use it is
    // to hand it a constant, so neither query may carry a placeholder that
    // some future caller could be tempted to fill in from a request body.
    assert.doesNotMatch(sql, /[?$]|\$\{/, name);
  }
  assert.match(SQL.recentMessages, new RegExp(`LIMIT ${MAX_RECENT_MESSAGES}$`));
});

test('CLI: every argv is an array and asks for JSON where the command offers it', () => {
  assert.deepEqual(CLI.sessionsQuery(), ['db', SQL.sessions, '--format', 'json']);
  assert.deepEqual(CLI.recentMessagesQuery(), ['db', SQL.recentMessages, '--format', 'json']);
  assert.deepEqual(CLI.sessionList(), ['session', 'list', '--format', 'json']);
  // The one place a session id reaches the CLI: as its own argv element.
  assert.deepEqual(CLI.exportSession('ses_1'), ['export', 'ses_1']);
  const nasty = "x'; DROP TABLE session; --";
  assert.deepEqual(CLI.exportSession(nasty), ['export', nasty]);
});

// ---------------------------------------------------------------------------
// Session rows — the three sources converge on one shape
// ---------------------------------------------------------------------------

test('sessionFromSqlRow: the full shape, from the fixture', () => {
  const [root, child, archived, broken] = parseRows(fixture('opencode-db-sessions.json'));

  const a = sessionFromSqlRow(root);
  assert.equal(a.id, 'ses_01HZX000000000000000000001');
  assert.equal(a.directory, 'C:\\Dk\\Projects\\demo-app');
  assert.equal(a.title, 'Add a health check endpoint to the server');
  assert.equal(a.parentId, null);
  assert.equal(a.model, 'claude-opus-5');
  assert.equal(a.inputTokens, 6100);
  assert.equal(a.outputTokens, 420);
  assert.equal(a.cacheTokens, 2048 + 512, 'cache read and write are one number on a summary');
  assert.equal(a.updatedAt, 1787648620000);
  assert.equal(a.archived, false);

  const b = sessionFromSqlRow(child);
  assert.equal(b.parentId, 'ses_01HZX000000000000000000001');
  assert.equal(b.model, 'claude-opus-5', 'a JSON blob in the model column still resolves');

  const c = sessionFromSqlRow(archived);
  assert.equal(c.archived, true);
  assert.equal(c.inputTokens, 1200, 'numeric strings are read');
  assert.equal(c.cacheTokens, 0, 'a negative count is refused rather than carried');
  assert.equal(c.model, null);

  assert.equal(sessionFromSqlRow(broken), null, 'a row with no id is refused');
  assert.equal(sessionFromSqlRow(null), null);
});

test('sessionFromSqlRow: an unknown future column is ignored, not fatal', () => {
  const [root] = parseRows(fixture('opencode-db-sessions.json'));
  assert.equal('an_unknown_future_column' in root, true, 'the fixture carries one');
  assert.equal(sessionFromSqlRow(root).id, 'ses_01HZX000000000000000000001');
});

test('sessionFromInfoJson: the nested legacy shape lands on the same fields', () => {
  const row = sessionFromInfoJson({
    id: 'ses_legacy',
    projectID: 'prj_demo',
    directory: '/home/x/demo',
    title: 'A pre-1.2.0 session',
    parentID: 'ses_parent',
    tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 8, write: 2 } },
    model: { id: 'claude-opus-5', providerID: 'anthropic' },
    time: { created: 1787000000000, updated: 1787000060000 },
  });
  assert.equal(row.id, 'ses_legacy');
  assert.equal(row.directory, '/home/x/demo');
  assert.equal(row.parentId, 'ses_parent');
  assert.equal(row.model, 'claude-opus-5');
  assert.equal(row.inputTokens, 100);
  assert.equal(row.outputTokens, 20);
  assert.equal(row.cacheTokens, 10);
  assert.equal(row.updatedAt, 1787000060000);
  assert.equal(sessionFromInfoJson({}), null);
});

test('sessionFromListRow: the thin documented fallback is honest about what it lacks', () => {
  const row = sessionFromListRow({
    id: 'ses_1',
    title: 'From session list',
    directory: '/home/x/demo',
    created: 1787000000000,
    updated: 1787000060000,
    projectId: 'prj_demo',
  });
  assert.equal(row.id, 'ses_1');
  assert.equal(row.directory, '/home/x/demo');
  assert.equal(row.updatedAt, 1787000060000);
  // Zero because the command does not report them — never a fabricated number.
  assert.equal(row.inputTokens, 0);
  assert.equal(row.outputTokens, 0);
  assert.equal(row.model, null);
  assert.equal(row.parentId, null);
});

// ---------------------------------------------------------------------------
// Messages, and the turn boundary
// ---------------------------------------------------------------------------

test('messageFromData: turnEnded is READ from time.completed, not inferred', () => {
  const done = messageFromData(
    '{"role":"assistant","time":{"created":1,"completed":2},"modelID":"m","path":{"cwd":"/w"}}',
  );
  assert.equal(done.role, 'assistant');
  assert.equal(done.completed, true);
  assert.equal(done.model, 'm');
  assert.equal(done.cwd, '/w');

  // Still streaming: created, never completed. This is the case every other
  // adapter here has to guess at and this one does not.
  const streaming = messageFromData('{"role":"assistant","time":{"created":1}}');
  assert.equal(streaming.completed, false);

  // A user message is never a finished turn, whatever its timestamps say.
  const user = messageFromData('{"role":"user","time":{"created":1,"completed":2}}');
  assert.equal(user.role, 'user');
  assert.equal(user.completed, false);
});

test('messageFromData: an object works as well as a JSON string, and junk is null', () => {
  assert.equal(messageFromData({ role: 'user', time: { created: 1 } }).role, 'user');
  assert.equal(messageFromData('{not json'), null);
  assert.equal(messageFromData('{"role":"system"}'), null);
  assert.equal(messageFromData(null), null);
});

test('latestMessagePerSession: newest-first rows collapse to one per session', () => {
  const rows = parseRows(fixture('opencode-db-messages.json'));
  const map = latestMessagePerSession(rows);

  const first = map.get('ses_01HZX000000000000000000001');
  assert.equal(first.role, 'assistant');
  assert.equal(first.completed, true, 'the newest row wins, not the older user turn');
  assert.equal(first.cwd, 'C:\\Dk\\Projects\\demo-app');

  const child = map.get('ses_01HZX000000000000000000002');
  assert.equal(child.completed, false, 'created but never completed: still working');

  assert.equal(map.get('ses_01HZX000000000000000000003').role, 'user');
  // A row whose `data` will not parse is skipped, not thrown on.
  assert.equal(map.has('ses_01HZX000000000000000000009'), false);
  assert.equal(latestMessagePerSession(null).size, 0);
});

// ---------------------------------------------------------------------------
// Export → conversation
// ---------------------------------------------------------------------------

test('partsToText: only text parts survive', () => {
  assert.equal(
    partsToText([
      { type: 'step-start' },
      { type: 'reasoning', text: 'thinking' },
      { type: 'text', text: 'a ' },
      { type: 'tool', tool: 'bash' },
      { type: 'text', text: 'b' },
    ]),
    'a b',
  );
  assert.equal(partsToText([]), '');
  assert.equal(partsToText(null), '');
});

test('parseExport: the fixture yields conversation text only, oldest first', () => {
  const messages = parseExport(fixture('opencode-export.json'));

  assert.deepEqual(
    messages.map((m) => m.role),
    ['user', 'assistant', 'assistant'],
    'the pure tool-call message carries no text and is not shown as an empty bubble',
  );
  assert.equal(messages[0].text, 'Add a health check endpoint to the server.');
  assert.equal(messages[1].text, 'I will add a /healthz route.');
  assert.equal(messages[2].text, 'Done — /healthz is wired into the readiness probe.');
  assert.equal(messages[1].at, 1787648420000);

  for (const m of messages) {
    assert.doesNotMatch(m.text, /npm test|server\.js|probe wiring|step-start/);
  }
});

test('parseExport: tolerates a bare array and an empty or broken document', () => {
  const bare = parseExport(
    JSON.stringify([{ role: 'user', time: { created: 5 }, parts: [{ type: 'text', text: 'hi' }] }]),
  );
  assert.deepEqual(bare, [{ role: 'user', text: 'hi', at: 5 }]);
  assert.deepEqual(parseExport('not json'), []);
  assert.deepEqual(parseExport('{}'), []);
  // No timestamp falls back rather than producing a NaN date.
  const [msg] = parseExport(
    JSON.stringify([{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }]),
    1234,
  );
  assert.equal(msg.at, 1234);
});

test('truncateTitle: collapses whitespace and truncates with an ellipsis', () => {
  assert.equal(truncateTitle('  a   b\n c '), 'a b c');
  assert.equal(truncateTitle('x'.repeat(80), 10), 'x'.repeat(9) + '…');
  assert.equal(truncateTitle(''), '');
});

// ---------------------------------------------------------------------------
// argv — asserted exactly, because these carry user data
// ---------------------------------------------------------------------------

test('opencodeResumeCommand: the session id is one argv element, never interpolated', () => {
  assert.deepEqual(opencodeResumeCommand('ses_1'), ['opencode', '--session', 'ses_1']);
  const nasty = "x'; rm -rf ~ #";
  assert.deepEqual(opencodeResumeCommand(nasty), ['opencode', '--session', nasty]);
});

test('opencodeNewSessionCommand: --prompt seeds the TUI; no prompt means bare opencode', () => {
  assert.deepEqual(opencodeNewSessionCommand(), ['opencode']);
  assert.deepEqual(opencodeNewSessionCommand('   '), ['opencode']);
  assert.deepEqual(opencodeNewSessionCommand('fix the build'), [
    'opencode',
    '--prompt',
    'fix the build',
  ]);
});

test('opencodeRunArgs: resumes when there is a session, runs fresh when there is not', () => {
  assert.deepEqual(opencodeRunArgs({ sessionId: 'ses_1', text: 'hi' }), [
    'run',
    '--session',
    'ses_1',
    'hi',
  ]);
  assert.deepEqual(opencodeRunArgs({ text: 'hi' }), ['run', 'hi']);
});

// ---------------------------------------------------------------------------
// The roster cache — §77's lesson, applied here before it became a bug
// ---------------------------------------------------------------------------

test('the roster TTL matches the Claude Code live probe: 60s, and is not the poll interval', () => {
  // Every read this adapter performs is a child process. An uncached scan on a
  // 5s poll is exactly the cost docs/DEVIATIONS.md §77 removed for Claude Code.
  assert.equal(ROSTER_TTL_MS, 60_000);
  assert.ok(ROSTER_TTL_MS >= 60_000, 'shortening this reintroduces the §77 cost');
});

// ---------------------------------------------------------------------------
// Degradation on a machine with no OpenCode
// ---------------------------------------------------------------------------

test('adapter identity: id and label match the registry contract', () => {
  assert.equal(adapter.id, 'opencode');
  assert.equal(adapter.label, 'OpenCode');
  for (const method of [
    'available',
    'liveSessions',
    'scanSessions',
    'conversation',
    'send',
    'openInTerminal',
    'openNewSession',
  ]) {
    assert.equal(typeof adapter[method], 'function', method);
  }
  assert.equal(typeof adapter.hooks, 'object');
});

test('adapter.available(): never throws, and is cached', async () => {
  const first = await adapter.available();
  assert.equal(typeof first, 'boolean');
  assert.equal(await adapter.available(), first);
});

test('adapter: every read degrades to empty on an OpenCode-free machine', async (t) => {
  if (await adapter.available()) {
    t.skip('OpenCode is present on this machine — the degradation path is not reachable');
    return;
  }
  assert.deepEqual(await adapter.scanSessions({ maxAgeDays: 30, limit: 10 }), []);
  assert.deepEqual(await adapter.scanSessions(), []);
  assert.deepEqual(await adapter.liveSessions(), []);
  assert.deepEqual(await adapter.conversation('opencode:ses_1'), []);
  assert.deepEqual(await adapter.conversation('opencode:ses_1', { maxMessages: 5 }), []);
});

test('adapter.send(): a clean failure, never a throw', async (t) => {
  if (await adapter.available()) {
    t.skip('OpenCode is present on this machine');
    return;
  }
  const res = await adapter.send('opencode:ses_1', 'hello');
  assert.equal(res.ok, false);
  assert.match(res.error, /not installed/i);
});

test('adapter.openInTerminal(): resolves silently rather than throwing', async (t) => {
  if (await adapter.available()) {
    t.skip('OpenCode is present on this machine');
    return;
  }
  await adapter.openInTerminal('opencode:ses_1', process.cwd());
});

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

test('hooks: unsupported, and honest about the plugin API it is not using', () => {
  assert.equal(hooks.supported, false);
  const plan = hooks.describe(4317);
  assert.deepEqual(plan.events, []);
  assert.match(plan.note, /plugin/i);
  assert.match(plan.note, /needs input/i);
  assert.match(plan.note, /stalled/i);
  // It must still say the good news: the turn boundary is not guessed here.
  assert.match(plan.note, /when a turn ended/i);
});

test('hooks: install and remove reject; installed() resolves false', async () => {
  await assert.rejects(() => hooks.install(4317), /does not install an OpenCode plugin/i);
  await assert.rejects(() => hooks.remove(), /nothing to remove/i);
  assert.equal(await hooks.installed(), false);
});
