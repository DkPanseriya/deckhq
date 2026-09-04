// The machine is pinned before `src/` is imported (`docs/DEVIATIONS.md` §124).
import '../helpers/isolate.mjs';
/**
 * Gemini CLI adapter — parsing, and degradation on a machine without it. WP-24.
 *
 * Gemini CLI is NOT installed on this machine (`~/.gemini` does not exist), so
 * these tests do two jobs at once, exactly as `codex-parse.test.mjs` does:
 *
 *   1. Pin the documented on-disk format against a synthetic fixture, so a
 *      format break is a red test rather than an empty floor.
 *   2. Prove every adapter method is safe to call when the runtime is absent —
 *      empty results and clean failures, never a throw.
 *
 * The fixture is synthetic and its shape is documented in
 * `src/adapters/gemini-cli/parse.mjs`, which carries the provenance of every
 * field name (read from `google-gemini/gemini-cli` source on 4 Sep 2026).
 * Nothing here has been checked against real Gemini CLI data — see
 * `docs/DEVIATIONS.md` §123 and `docs/ADAPTERS.md`'s honesty rule.
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { test } from 'node:test';

import {
  contentToText,
  digestRecords,
  extractMessage,
  extractSessionMeta,
  extractTokens,
  hasPendingToolCall,
  isRewind,
  linesFromChunk,
  mergeMeta,
  parseCheckpoint,
  parseLine,
  parseRecords,
  projectDirLooksLegacy,
  readHead,
  readTail,
  reverseProjectRegistry,
  sessionIdFromFilename,
  truncateTitle,
  turnRole,
} from '../../src/adapters/gemini-cli/parse.mjs';
import {
  adapter,
  geminiNewSessionCommand,
  geminiPromptArgs,
  geminiResumeCommand,
} from '../../src/adapters/gemini-cli/adapter.mjs';
import { hooks } from '../../src/adapters/gemini-cli/hooks.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'gemini-sample.jsonl');

// ---------------------------------------------------------------------------
// Line handling
// ---------------------------------------------------------------------------

test('parseLine: valid object parses, corrupt and scalar lines return null', () => {
  assert.deepEqual(parseLine('{"a":1}'), { a: 1 });
  assert.equal(parseLine('{"a": this is not json'), null);
  assert.equal(parseLine('"just a string"'), null);
  assert.equal(parseLine('42'), null);
  assert.equal(parseLine(''), null);
  assert.equal(parseLine(undefined), null);
});

test('linesFromChunk: drops the trailing empty line and either partial edge', () => {
  assert.deepEqual(linesFromChunk('a\nb\nc\n'), ['a', 'b', 'c']);
  assert.deepEqual(linesFromChunk('partial\na\nb', { dropFirstPartial: true }), ['a', 'b']);
  assert.deepEqual(linesFromChunk('a\nb\npartial', { dropLastPartial: true }), ['a', 'b']);
  assert.deepEqual(linesFromChunk(''), []);
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

test('extractSessionMeta: the first line resolves id, project slug and times', () => {
  const meta = extractSessionMeta({
    sessionId: 'abc-123',
    projectHash: 'demo-app',
    startTime: '2026-08-22T09:00:00.000Z',
    lastUpdated: '2026-08-22T09:04:10.000Z',
    kind: 'main',
    directories: ['C:\\work\\demo-app'],
  });
  assert.equal(meta.sessionId, 'abc-123');
  assert.equal(meta.projectHash, 'demo-app');
  assert.equal(meta.startTime, Date.parse('2026-08-22T09:00:00.000Z'));
  assert.equal(meta.lastUpdated, Date.parse('2026-08-22T09:04:10.000Z'));
  assert.equal(meta.kind, 'main');
  assert.deepEqual(meta.directories, ['C:\\work\\demo-app']);
});

test('extractSessionMeta: a {$set} update is metadata, not a message', () => {
  const meta = extractSessionMeta({ $set: { summary: 'Health check endpoint' } });
  assert.equal(meta.summary, 'Health check endpoint');
  assert.equal(extractMessage({ $set: { summary: 'Health check endpoint' } }), null);
});

test('mergeMeta: a later {$set} adds fields and never nulls the ones it omits', () => {
  // The trap this exists for: `{$set:{summary}}` is a partial update, so a
  // plain object spread would overwrite the session id with the later
  // record's absent one. A session with no id cannot be resumed or opened.
  const first = extractSessionMeta({
    sessionId: 'abc-123',
    projectHash: 'demo-app',
    startTime: '2026-08-22T09:00:00.000Z',
    directories: ['/w/demo'],
  });
  const later = extractSessionMeta({ $set: { summary: 'A summary arriving late' } });
  const merged = mergeMeta(first, later);

  assert.equal(merged.sessionId, 'abc-123');
  assert.equal(merged.projectHash, 'demo-app');
  assert.equal(merged.startTime, Date.parse('2026-08-22T09:00:00.000Z'));
  assert.deepEqual(merged.directories, ['/w/demo']);
  assert.equal(merged.summary, 'A summary arriving late');

  // And a later value does win where one is actually given.
  const renamed = mergeMeta(merged, extractSessionMeta({ $set: { summary: 'Renamed' } }));
  assert.equal(renamed.summary, 'Renamed');
  assert.equal(renamed.sessionId, 'abc-123');
});

test('extractSessionMeta: a message record is not mistaken for metadata', () => {
  assert.equal(extractSessionMeta({ id: 'm1', timestamp: 'x', type: 'user', content: 'hi' }), null);
  assert.equal(extractSessionMeta(null), null);
  assert.equal(extractSessionMeta('nope'), null);
});

test('isRewind: a $rewindTo marker is recognised and never read as a message', () => {
  assert.equal(isRewind({ $rewindTo: 'm3' }), true);
  assert.equal(isRewind({ id: 'm1' }), false);
  assert.equal(extractMessage({ $rewindTo: 'm3' }), null);
  assert.equal(turnRole({ $rewindTo: 'm3' }), null);
});

// ---------------------------------------------------------------------------
// Content
// ---------------------------------------------------------------------------

test('contentToText: string, single part, and array of parts all normalise', () => {
  assert.equal(contentToText('plain'), 'plain');
  assert.equal(contentToText({ text: 'one' }), 'one');
  assert.equal(contentToText([{ text: 'a ' }, { text: 'b' }]), 'a b');
  assert.equal(contentToText(['a ', { text: 'b' }]), 'a b');
  assert.equal(contentToText(null), '');
  assert.equal(contentToText(42), '');
});

test('contentToText: non-text parts are skipped, so no tool artefact reaches the panel', () => {
  const content = [
    { text: 'Done — ' },
    { functionCall: { name: 'write_file', args: {} } },
    { inlineData: { mimeType: 'image/png', data: 'AAAA' } },
    { functionResponse: { name: 'write_file', response: {} } },
    { text: 'wired in.' },
  ];
  assert.equal(contentToText(content), 'Done — wired in.');
});

test('extractMessage: user and gemini become user and assistant', () => {
  const user = extractMessage({ id: 'm1', timestamp: 'x', type: 'user', content: 'hello' });
  assert.equal(user.role, 'user');
  const model = extractMessage({
    id: 'm2',
    timestamp: '2026-08-22T09:00:38.000Z',
    type: 'gemini',
    model: 'gemini-3-pro',
    content: [{ text: 'hi' }],
  });
  assert.equal(model.role, 'assistant');
  assert.equal(model.model, 'gemini-3-pro');
  assert.equal(model.at, Date.parse('2026-08-22T09:00:38.000Z'));
});

test('extractMessage: info, error and warning notices are not conversation', () => {
  for (const type of ['info', 'error', 'warning']) {
    assert.equal(extractMessage({ id: 'x', type, content: 'a notice' }), null, type);
    assert.equal(turnRole({ id: 'x', type, content: 'a notice' }), null, type);
  }
});

test('extractMessage: displayContent wins over content — the panel shows what the human saw', () => {
  const msg = extractMessage({
    id: 'm9',
    type: 'gemini',
    content: [{ text: 'raw model payload' }],
    displayContent: [{ text: 'what the user saw' }],
  });
  assert.equal(msg.text, 'what the user saw');
});

// ---------------------------------------------------------------------------
// Tokens and turn ending
// ---------------------------------------------------------------------------

test('extractTokens: a TokensSummary is read, and a record without one yields null', () => {
  assert.deepEqual(
    extractTokens({ tokens: { input: 10, output: 5, cached: 2, thoughts: 1, tool: 0, total: 18 } }),
    { input: 10, output: 5, cached: 2, total: 18 },
  );
  assert.equal(extractTokens({ id: 'm1' }), null);
  assert.equal(extractTokens({ tokens: {} }), null);
});

test('hasPendingToolCall: an in-flight status counts, a finished one does not', () => {
  assert.equal(hasPendingToolCall({ toolCalls: [{ status: 'executing' }] }), true);
  assert.equal(hasPendingToolCall({ toolCalls: [{ status: 'awaiting_approval' }] }), true);
  assert.equal(hasPendingToolCall({ toolCalls: [{ status: 'success' }] }), false);
  assert.equal(hasPendingToolCall({ toolCalls: [] }), false);
  assert.equal(hasPendingToolCall({}), false);
  // An unknown status reads as finished — the documented default, so a busy
  // session is at worst called idle for one poll rather than a finished one
  // being hidden from the review queue forever.
  assert.equal(hasPendingToolCall({ toolCalls: [{ status: 'brand_new_status' }] }), false);
});

test('turnEnded: the model spoke last with no tool running', () => {
  const d = digestRecords([
    { id: 'm1', type: 'user', content: 'go' },
    { id: 'm2', type: 'gemini', content: [{ text: 'done' }] },
  ]);
  assert.equal(d.turnEnded, true);
});

test('turnEnded: false while the user spoke last', () => {
  const d = digestRecords([
    { id: 'm1', type: 'gemini', content: [{ text: 'done' }] },
    { id: 'm2', type: 'user', content: 'and one more thing' },
  ]);
  assert.equal(d.turnEnded, false);
});

test('turnEnded: a bare tool call still counts as the model holding the floor', () => {
  // The regression this exists for: the last record is a model turn whose
  // content is only a functionCall, so it carries no text and is (correctly)
  // not a message. Reading turnEnded off the last *message* would call this
  // session idle and put a working agent in the review queue.
  const d = digestRecords([
    { id: 'm1', type: 'user', content: 'go' },
    { id: 'm2', type: 'gemini', content: [{ text: 'starting' }] },
    {
      id: 'm3',
      type: 'gemini',
      content: [{ functionCall: { name: 'write_file', args: {} } }],
      toolCalls: [{ id: 't1', name: 'write_file', status: 'executing' }],
    },
  ]);
  assert.equal(d.lastRole, 'assistant');
  assert.equal(d.lastText, 'starting');
  assert.equal(d.messages.length, 2, 'the bare tool call is not a message');
  assert.equal(d.turnEnded, false, 'but it is still a turn, and it has not ended');
});

test('tokens: input and cached take the maximum, output is summed', () => {
  // Gemini records `input` as the whole prompt for that turn, so it already
  // contains the history; summing it would count the conversation once per
  // turn. Output is new text each time and is counted once.
  const d = digestRecords([
    { id: 'm1', type: 'user', content: 'a' },
    {
      id: 'm2',
      type: 'gemini',
      content: [{ text: 'x' }],
      tokens: { input: 100, output: 10, cached: 5 },
    },
    { id: 'm3', type: 'user', content: 'b' },
    {
      id: 'm4',
      type: 'gemini',
      content: [{ text: 'y' }],
      tokens: { input: 300, output: 20, cached: 40 },
    },
  ]);
  assert.equal(d.inputTokens, 300);
  assert.equal(d.outputTokens, 30);
  assert.equal(d.cachedTokens, 40);
});

// ---------------------------------------------------------------------------
// Project slug resolution
// ---------------------------------------------------------------------------

test('projectDirLooksLegacy: a 64-hex directory is the old sha256 form', () => {
  assert.equal(projectDirLooksLegacy('a'.repeat(64)), true);
  assert.equal(projectDirLooksLegacy('demo-app'), false);
  assert.equal(projectDirLooksLegacy('project-2'), false);
  assert.equal(projectDirLooksLegacy(''), false);
});

test('reverseProjectRegistry: slug → absolute path, and an ambiguous slug is dropped', () => {
  const map = reverseProjectRegistry({
    projects: {
      'C:\\Dk\\Projects\\demo-app': 'demo-app',
      '/home/x/other': 'other',
    },
  });
  assert.equal(map.get('demo-app'), 'C:\\Dk\\Projects\\demo-app');
  assert.equal(map.get('other'), '/home/x/other');

  // Two paths claiming one slug means the file has been edited or merged
  // between machines. A wrong cwd puts a session in the wrong room, which is
  // worse than an honest "unknown".
  const clash = reverseProjectRegistry({
    projects: { '/a/demo': 'demo', '/b/demo': 'demo' },
  });
  assert.equal(clash.has('demo'), false);

  assert.equal(reverseProjectRegistry(null).size, 0);
  assert.equal(reverseProjectRegistry({}).size, 0);
  assert.equal(reverseProjectRegistry({ projects: 'nope' }).size, 0);
});

// ---------------------------------------------------------------------------
// Older generations still on disk
// ---------------------------------------------------------------------------

test('parseCheckpoint: reads both the bare array and the {history} wrapper', () => {
  const expected = [
    { role: 'user', text: 'save this' },
    { role: 'assistant', text: 'saved' },
  ];
  const bare = [
    { role: 'user', parts: [{ text: 'save this' }] },
    { role: 'model', parts: [{ text: 'saved' }] },
  ];
  assert.deepEqual(parseCheckpoint(bare), expected);
  assert.deepEqual(parseCheckpoint({ history: bare, authType: 'oauth-personal' }), expected);
  assert.deepEqual(parseCheckpoint(null), []);
  assert.deepEqual(parseCheckpoint({ history: 'nope' }), []);
});

test('sessionIdFromFilename: strips the extension for both file shapes', () => {
  assert.equal(
    sessionIdFromFilename('session-2026-08-22T09-00-00-7c9f1a20.jsonl'),
    'session-2026-08-22T09-00-00-7c9f1a20',
  );
  assert.equal(sessionIdFromFilename('7c9f1a20-3d4e.jsonl'), '7c9f1a20-3d4e');
  assert.equal(sessionIdFromFilename(''), '');
});

test('truncateTitle: collapses whitespace and truncates with an ellipsis', () => {
  assert.equal(truncateTitle('  a   b\n c '), 'a b c');
  assert.equal(truncateTitle('x'.repeat(80), 10), 'x'.repeat(9) + '…');
  assert.equal(truncateTitle(''), '');
  assert.equal(truncateTitle(null), '');
});

// ---------------------------------------------------------------------------
// The fixture, end to end
// ---------------------------------------------------------------------------

test('fixture: bounded head/tail reads see the whole small file', async () => {
  const head = await readHead(FIXTURE);
  const tail = await readTail(FIXTURE);
  assert.equal(head.truncated, false);
  assert.equal(tail.truncated, false);
  assert.equal(head.text, tail.text);
  // One line is deliberately corrupt and must be skipped, not thrown on.
  const raw = linesFromChunk(head.text);
  const records = parseRecords(head.text);
  assert.equal(records.length, raw.length - 1);
});

test('fixture: title comes from the summary a later {$set} added', async () => {
  const { text } = await readHead(FIXTURE);
  const records = parseRecords(text);
  let meta = null;
  for (const rec of records) {
    const m = extractSessionMeta(rec);
    if (m) meta = meta ? mergeMeta(meta, m) : m;
  }
  assert.equal(meta.sessionId, '7c9f1a20-3d4e-4b55-9a01-000000000001');
  assert.equal(meta.projectHash, 'demo-app');
  assert.equal(truncateTitle(meta.summary, 60), 'Health check endpoint for the demo server');
});

test('fixture: cwd resolves through the project registry, not out of the file', async () => {
  const { text } = await readHead(FIXTURE);
  const [first] = parseRecords(text);
  const slug = extractSessionMeta(first).projectHash;
  // The session file carries the slug; the absolute path lives in projects.json.
  const map = reverseProjectRegistry({ projects: { 'C:\\Dk\\Projects\\demo-app': 'demo-app' } });
  assert.equal(map.get(slug), 'C:\\Dk\\Projects\\demo-app');
  // And with no registry entry the adapter falls back to `directories[0]`.
  assert.deepEqual(extractSessionMeta(first).directories, ['C:\\Dk\\Projects\\demo-app']);
});

test('fixture: the digest yields conversation text only, with the right last activity', async () => {
  const { text } = await readHead(FIXTURE);
  const d = digestRecords(parseRecords(text));

  assert.deepEqual(
    d.messages.map((m) => m.role),
    ['user', 'assistant', 'user', 'assistant'],
  );
  assert.equal(d.firstUserText, 'Add a health check endpoint to the server.');
  assert.equal(d.lastRole, 'assistant');
  assert.equal(d.lastText, 'Done — /healthz is wired into the readiness probe.');
  assert.equal(d.lastAt, Date.parse('2026-08-22T09:03:40.000Z'));
  assert.equal(d.model, 'gemini-3-pro');

  // No thought, tool call, info notice or warning reached the conversation.
  for (const m of d.messages) {
    assert.doesNotMatch(m.text, /functionCall|write_file|Context left|context limit|probe first/);
  }
});

test('fixture: tokens and turn-ended', async () => {
  const { text } = await readHead(FIXTURE);
  const d = digestRecords(parseRecords(text));
  assert.equal(d.inputTokens, 6100, 'largest context reached');
  assert.equal(d.outputTokens, 420, '180 + 240, each turn counted once');
  assert.equal(d.cachedTokens, 2048);
  assert.equal(d.turnEnded, true, 'the model finished and its tool call succeeded');
});

// ---------------------------------------------------------------------------
// argv — asserted exactly, because these carry user data
// ---------------------------------------------------------------------------

test('geminiResumeCommand: the session id is one argv element, never interpolated', () => {
  assert.deepEqual(geminiResumeCommand('abc-123'), ['gemini', '--resume', 'abc-123']);
  const nasty = "x'; rm -rf ~ #";
  assert.deepEqual(geminiResumeCommand(nasty), ['gemini', '--resume', nasty]);
});

test('geminiNewSessionCommand: -i keeps the terminal open; no prompt means bare gemini', () => {
  assert.deepEqual(geminiNewSessionCommand(), ['gemini']);
  assert.deepEqual(geminiNewSessionCommand('   '), ['gemini']);
  assert.deepEqual(geminiNewSessionCommand('fix the build'), ['gemini', '-i', 'fix the build']);
});

test('geminiPromptArgs: resumes when there is a session, runs fresh when there is not', () => {
  assert.deepEqual(geminiPromptArgs({ sessionId: 'abc', text: 'hi' }), [
    '--resume',
    'abc',
    '-p',
    'hi',
  ]);
  assert.deepEqual(geminiPromptArgs({ text: 'hi' }), ['-p', 'hi']);
});

// ---------------------------------------------------------------------------
// Degradation on a machine with no Gemini CLI
// ---------------------------------------------------------------------------

test('adapter identity: id and label match the registry contract', () => {
  assert.equal(adapter.id, 'gemini-cli');
  assert.equal(adapter.label, 'Gemini CLI');
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

test('adapter: every read degrades to empty on a Gemini-CLI-free machine', async (t) => {
  if (await adapter.available()) {
    t.skip('Gemini CLI is present on this machine — the degradation path is not reachable');
    return;
  }
  assert.deepEqual(await adapter.scanSessions({ maxAgeDays: 30, limit: 10 }), []);
  assert.deepEqual(await adapter.scanSessions(), []);
  assert.deepEqual(await adapter.liveSessions(), []);
  assert.deepEqual(await adapter.conversation('gemini-cli:abc'), []);
  assert.deepEqual(await adapter.conversation('gemini-cli:abc', { maxMessages: 5 }), []);
});

test('adapter.send(): a clean failure, never a throw', async (t) => {
  if (await adapter.available()) {
    t.skip('Gemini CLI is present on this machine');
    return;
  }
  const res = await adapter.send('gemini-cli:abc', 'hello');
  assert.equal(res.ok, false);
  assert.match(res.error, /not installed/i);
});

test('adapter.openInTerminal(): resolves silently rather than throwing', async (t) => {
  if (await adapter.available()) {
    t.skip('Gemini CLI is present on this machine');
    return;
  }
  await adapter.openInTerminal('gemini-cli:abc', process.cwd());
});

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

test('hooks: unsupported, and honest about WHY — the runtime has them, DeckHQ does not use them', () => {
  assert.equal(hooks.supported, false);
  const plan = hooks.describe(4317);
  assert.deepEqual(plan.events, []);
  // Gemini CLI genuinely has a hooks mechanism, so "this runtime provides no
  // way to be notified" would be a false claim about somebody else's product,
  // which `08` §1.1 rule 11 forbids as firmly as a false claim about ours.
  // Codex's note said exactly that sentence until WP-23a found the same thing
  // true of Codex 0.153.1 and removed it there too (`DEVIATIONS.md` §136.3),
  // so no adapter in this tree makes that claim any more.
  assert.match(plan.note, /does have a hooks mechanism/i);
  assert.match(plan.note, /settings\.json/);
  assert.doesNotMatch(plan.note, /no hook mechanism/i);
  // And it still has to explain the cost of not using them.
  assert.match(plan.note, /needs input/i);
  assert.match(plan.note, /stalled/i);
});

test('hooks: install and remove reject; installed() resolves false', async () => {
  await assert.rejects(() => hooks.install(4317), /does not install Gemini CLI hooks/i);
  await assert.rejects(() => hooks.remove(), /nothing to remove/i);
  assert.equal(await hooks.installed(), false);
});
