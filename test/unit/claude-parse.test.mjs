// A machine of our own, before anything under `src/` is loaded: several of
// those modules resolve a path out of the environment while they evaluate.
// `docs/DEVIATIONS.md` §124.
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  readHead,
  readTail,
  parseSummary,
  parseConversation,
  HEAD_BYTES,
  TAIL_BYTES,
} from '../../src/adapters/claude-code/parse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, '..', 'fixtures', 'claude-sample.jsonl');

/** Bounded head+tail reads of the fixture, as scanSessions would perform them. */
async function readFixture() {
  const [head, tail] = await Promise.all([
    readHead(FIXTURE, HEAD_BYTES),
    readTail(FIXTURE, TAIL_BYTES),
  ]);
  return { head, tail };
}

function summarise(head, tail) {
  return parseSummary(head, tail, {
    id: 'sess-fixture-1',
    file: FIXTURE,
    mtimeMs: 1_700_000_000_000,
  });
}

test('a fixture with a deliberately corrupt line still yields a full summary', async () => {
  const { head, tail } = await readFixture();
  const summary = summarise(head, tail);
  assert.equal(summary.id, 'sess-fixture-1');
  assert.equal(summary.runtime, 'claude-code');
  assert.equal(typeof summary.title, 'string');
  assert.ok(summary.title.length > 0);
  // The corrupt line sits between two real turns; both sides must still be seen.
  assert.equal(summary.lastRole, 'assistant');
});

test('the LAST custom-title record wins, not the first', async () => {
  const { head, tail } = await readFixture();
  const summary = summarise(head, tail);
  assert.equal(summary.title, 'Final title');
  assert.equal(summary.hasCustomTitle, true);
});

test('title falls back to id.slice(0,8) when no custom-title, last-prompt or user text exists', () => {
  // No custom-title, no last-prompt, no user record at all in this chunk.
  const text = [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-01T00:00:00.000Z',
      message: {
        id: 'm1',
        role: 'assistant',
        model: 'claude-sonnet-5',
        content: [{ type: 'text', text: 'hi' }],
      },
    }),
  ].join('\n');
  const summary = parseSummary('', text, { id: 'abcdefgh12345', file: 'x', mtimeMs: 0 });
  assert.equal(summary.hasCustomTitle, false);
  assert.equal(summary.title, 'abcdefgh');
});

test('cwd, gitBranch and model come from the newest timestamped record', async () => {
  const { head, tail } = await readFixture();
  const summary = summarise(head, tail);
  assert.equal(summary.cwd, 'C:\\Dk\\Projects\\FixtureProj2');
  assert.equal(summary.gitBranch, 'feature/x');
  assert.equal(summary.model, 'claude-opus-5');
});

test('lastRole/lastText reflect the newest non-sidechain text turn', async () => {
  const { head, tail } = await readFixture();
  const summary = summarise(head, tail);
  assert.equal(summary.lastRole, 'assistant');
  assert.equal(summary.lastText, 'Final answer to your real question.');
});

test('token split is correct: dedups usage repeated across split content-block lines', async () => {
  const { head, tail } = await readFixture();
  const summary = summarise(head, tail);
  // Fixture turns (input+output / cacheRead+cacheCreate):
  //   msg_a  100+50  / 10+5     (primary thread)
  //   msg_b   20+10  /  2+1     (isSidechain: true -- still counted)
  //   msg_c 1000+500 /200+100   (split across TWO lines, same message.id and
  //                              usage -- and this fixture is small enough
  //                              that head+tail both see the whole file, so
  //                              this also proves head/tail overlap doesn't
  //                              double-count -- must be counted ONCE)
  //   msg_d   30+15  /  3+2     (tool_use + tool_result only, no text)
  //   msg_e  200+100 / 20+10    (primary thread, newest)
  assert.equal(summary.tokens, 100 + 50 + 20 + 10 + 1000 + 500 + 30 + 15 + 200 + 100); // 2025
  assert.equal(summary.cacheTokens, 10 + 5 + 2 + 1 + 200 + 100 + 3 + 2 + 20 + 10); // 353
  assert.ok(summary.costEstimate > 0);
});

test('parseConversation excludes thinking/tool_use/tool_result blocks, sidechains, and harness wrapper text', async () => {
  const tail = await readTail(FIXTURE, TAIL_BYTES);
  const messages = parseConversation(tail, { maxMessages: 50 });

  assert.deepEqual(
    messages.map((m) => ({ role: m.role, text: m.text })),
    [
      { role: 'user', text: "Let's build a widget." },
      { role: 'assistant', text: 'Sure, I can help.' },
      { role: 'assistant', text: 'Here is the plan.' },
      { role: 'user', text: 'What is the status of the widget?' },
      { role: 'assistant', text: 'Final answer to your real question.' },
    ],
  );

  for (const m of messages) {
    assert.ok(!/tool_use|tool_result|thinking/i.test(m.text), `leaked trace artefact: ${m.text}`);
    assert.ok(
      !/<system-reminder|<command-name|<command-message|<command-args|<local-command-stdout/i.test(
        m.text,
      ),
      `leaked harness wrapper: ${m.text}`,
    );
  }

  // Oldest first.
  for (let i = 1; i < messages.length; i++) {
    assert.ok(messages[i].at >= messages[i - 1].at);
  }
});

test('parseConversation respects maxMessages, keeping the most recent', () => {
  const lines = [];
  for (let i = 0; i < 10; i++) {
    lines.push(
      JSON.stringify({
        type: i % 2 === 0 ? 'user' : 'assistant',
        isSidechain: false,
        timestamp: `2026-08-01T00:00:${String(i).padStart(2, '0')}.000Z`,
        message: {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: [{ type: 'text', text: `turn ${i}` }],
        },
      }),
    );
  }
  const messages = parseConversation(lines.join('\n'), { maxMessages: 3 });
  assert.deepEqual(
    messages.map((m) => m.text),
    ['turn 7', 'turn 8', 'turn 9'],
  );
});

test('parseSummary and parseConversation never throw on garbage input', () => {
  assert.doesNotThrow(() =>
    parseSummary('not json at all', '{{{', { id: 'x', file: 'x', mtimeMs: 0 }),
  );
  assert.doesNotThrow(() =>
    parseConversation('\u0000\u0001garbage\n{"type":"user"}', { maxMessages: 10 }),
  );
  const empty = parseSummary('', '', { id: 'empty-id-here', file: 'x', mtimeMs: 42 });
  assert.equal(empty.title, 'empty-id'); // falls back to id.slice(0,8)
  assert.equal(empty.lastActivityAt, 42); // falls back to mtimeMs when no timestamp is seen
  assert.equal(empty.tokens, 0);
  assert.equal(empty.cacheTokens, 0);
});

test('readHead truncates to maxBytes; readTail discards a genuinely partial first line', async () => {
  const tmp = path.join(os.tmpdir(), `deckhq-parse-bounds-${process.pid}-${Date.now()}.jsonl`);
  // Three equal-length, easy-to-reason-about lines (8 bytes each incl. \n).
  const lineA = '{"v":1}\n';
  const lineB = '{"v":2}\n';
  const lineC = '{"v":3}\n';
  await fs.writeFile(tmp, lineA + lineB + lineC, 'utf8');
  try {
    const head = await readHead(tmp, 10);
    assert.equal(head.length, 10);
    assert.equal(head.slice(0, 8), lineA);

    // 20 of the 24 bytes -> start=4, landing mid-way through lineA ("{"v\"":1}\n"
    // truncated to ":1}\n"). The partial fragment must be dropped entirely,
    // leaving exactly lineB + lineC.
    const tail = await readTail(tmp, 20);
    assert.equal(tail, lineB + lineC);
  } finally {
    await fs.rm(tmp, { force: true });
  }
});

test('readHead and readTail never throw on a missing file', async () => {
  const missing = path.join(os.tmpdir(), `deckhq-does-not-exist-${Date.now()}.jsonl`);
  assert.equal(await readHead(missing, 100), '');
  assert.equal(await readTail(missing, 100), '');
});

/**
 * An assistant turn that calls a tool: narration text, then the `tool_use`
 * block, in the same message. This is the shape that made a busy session look
 * finished — `contentToText` reads only `text` blocks, so the narration is the
 * last text in the file for as long as the tool runs, and the `tool_result`
 * (which carries no text block) never moves `lastRole` back to 'user'.
 */
function toolCallTurn(id = 'tu_1') {
  return JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-01T00:00:00.000Z',
    message: {
      id: 'm1',
      role: 'assistant',
      model: 'claude-sonnet-5',
      content: [
        { type: 'text', text: 'Let me check that file.' },
        { type: 'tool_use', id, name: 'Read', input: { file_path: 'x' } },
      ],
    },
  });
}

function toolResultRecord(id = 'tu_1') {
  return JSON.stringify({
    type: 'user',
    timestamp: '2026-08-01T00:00:05.000Z',
    message: {
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: id, content: 'file contents' }],
    },
  });
}

test('a session part-way through a tool call has not ended its turn', () => {
  const text = toolCallTurn();
  const summary = parseSummary('', text, { id: 'sess1', file: 'x', mtimeMs: 0 });
  assert.equal(summary.lastRole, 'assistant', 'narration is still the last text');
  assert.equal(summary.turnEnded, false, 'but the turn has NOT ended');
});

test('a returned tool result is still mid-turn: the model is generating', () => {
  const text = [toolCallTurn(), toolResultRecord()].join('\n');
  const summary = parseSummary('', text, { id: 'sess1', file: 'x', mtimeMs: 0 });
  // The gap the first version of this fix missed. No call is outstanding
  // here, yet the session is very much working.
  assert.equal(summary.turnEnded, false);
});

test('an ordinary finished turn has no tool in flight', () => {
  const text = JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-01T00:00:00.000Z',
    message: {
      id: 'm2',
      role: 'assistant',
      model: 'claude-sonnet-5',
      content: [{ type: 'text', text: 'All done.' }],
    },
  });
  const summary = parseSummary('', text, { id: 'sess1', file: 'x', mtimeMs: 0 });
  assert.equal(summary.lastRole, 'assistant');
  assert.equal(summary.turnEnded, true, 'so this one really is for review');
});

test('a torn final line falls through to the record before it', () => {
  const text = [toolCallTurn(), '{"type":"user","message":{"content":[{"type":"tool_res'].join(
    '\n',
  );
  const summary = parseSummary('', text, { id: 'sess1', file: 'x', mtimeMs: 0 });
  assert.equal(summary.turnEnded, false);
});

test('a fresh user prompt with no reply yet is mid-turn, not up for review', () => {
  const text = [
    JSON.stringify({
      type: 'assistant',
      timestamp: '2026-08-01T00:00:00.000Z',
      message: { id: 'm1', role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    }),
    JSON.stringify({
      type: 'user',
      timestamp: '2026-08-01T00:01:00.000Z',
      message: { role: 'user', content: [{ type: 'text', text: 'now do the next bit' }] },
    }),
  ].join('\n');
  const summary = parseSummary('', text, { id: 'sess1', file: 'x', mtimeMs: 0 });
  assert.equal(summary.turnEnded, false);
});

test('stop_reason "tool_use" on a text-only line keeps the turn open', () => {
  // A logical assistant turn is written as several lines, one per content
  // block. The text block lands before its tool_use block, so for a moment
  // the newest line looks like a finished turn. Every line of that turn
  // carries stop_reason "tool_use", which closes the window.
  const text = JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-01T00:00:00.000Z',
    message: {
      id: 'm1',
      role: 'assistant',
      stop_reason: 'tool_use',
      content: [{ type: 'text', text: 'Let me check that file.' }],
    },
  });
  const summary = parseSummary('', text, { id: 's', file: 'x', mtimeMs: 0 });
  assert.equal(summary.turnEnded, false, 'a text block mid-turn is not an ending');
});

test('stop_reason "end_turn" ends the turn', () => {
  const text = JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-01T00:00:00.000Z',
    message: {
      id: 'm1',
      role: 'assistant',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'All done.' }],
    },
  });
  const summary = parseSummary('', text, { id: 's', file: 'x', mtimeMs: 0 });
  assert.equal(summary.turnEnded, true);
});

test('a thinking-only line mid-turn is not an ending', () => {
  const text = JSON.stringify({
    type: 'assistant',
    timestamp: '2026-08-01T00:00:00.000Z',
    message: {
      id: 'm1',
      role: 'assistant',
      stop_reason: 'tool_use',
      content: [{ type: 'thinking', thinking: 'hmm' }],
    },
  });
  const summary = parseSummary('', text, { id: 's', file: 'x', mtimeMs: 0 });
  assert.equal(summary.turnEnded, false);
});
