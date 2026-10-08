/**
 * WP-100 · a session's transcript, read with what the agent did.
 *
 * Two halves of one path, and both are run against the fixture session in
 * `test/fixtures/rich-transcript.mjs` — the records Claude Code writes:
 *
 *   src/adapters/claude-code/transcript-detail.mjs   records -> entries
 *   public/panel-transcript.js                       entries -> elements
 *
 * The second half builds DOM, so it is run against `test/helpers/dom-stub.mjs`,
 * which records what was asked for and parses nothing.
 */
// A machine of our own, before anything under `src/` is loaded.
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { HANDBACK, LONG_OUTPUT, REPLY, richTranscriptJsonl } from '../fixtures/rich-transcript.mjs';
import { all, byClass, byTag, doc } from '../helpers/dom-stub.mjs';
import {
  earlierSummary,
  renderEntries,
  renderThinking,
  renderToolCall,
  splitTranscript,
} from '../../public/panel-transcript.js';

const { MAX_TOOL_RESULT, bounded, parseConversationDetail, toolInputText, toolResultText } =
  await import('../../src/adapters/claude-code/transcript-detail.mjs');
const { parseConversation } = await import('../../src/adapters/claude-code/parse.mjs');

const CWD = '/home/dev/code/panel';
const JSONL = richTranscriptJsonl({ cwd: CWD, now: Date.UTC(2026, 9, 8, 12) });
const entries = parseConversationDetail(JSONL);

// --------------------------------------------------------------- the reader

test('the detail reader keeps the order things happened in: said, thought, ran, got back', () => {
  assert.deepEqual(
    entries.map((e) => (e.role === 'tool' ? `tool:${e.tool.name}` : e.role)),
    [
      'user',
      'thinking',
      'assistant',
      'tool:Read',
      'tool:Bash',
      'tool:Edit',
      'tool:Grep',
      'tool:Agent',
      'assistant',
      'user',
      'thinking',
      'assistant',
    ],
  );
  assert.equal(entries[entries.length - 1].text, REPLY);
});

test('a tool call is one line, and its result is attached to it rather than shown as something the user said', () => {
  const tools = entries.filter((e) => e.role === 'tool').map((e) => e.tool);
  assert.deepEqual(
    tools.map((t) => t.summary),
    [
      'Read public/markdown.js',
      'Bash npm test',
      'Edit public/markdown.js',
      'Grep <script>alert(1)</script>',
      'Agent Audit the markdown renderer',
    ],
  );
  // No `user` entry is a tool result: there are exactly the two things typed.
  assert.deepEqual(
    entries.filter((e) => e.role === 'user').map((e) => e.text),
    ['Audit how the panel renders a reply, then fix the worst of it.', 'Here is how it looks now.'],
  );
  const [read, bash, edit, grep, agent] = tools;
  assert.match(read.result, /A small block-level markdown renderer/);
  assert.equal(bash.input, 'npm test');
  // An edit is its file and the two strings, as a diff reads.
  assert.match(edit.input, /^\/home\/dev\/code\/panel\/public\/markdown\.js\n- const HR/);
  assert.match(edit.input, /\n\+ const HR = /);
  assert.match(edit.result, /has been updated/, 'a block-array result is read as its text');
  assert.equal(grep.isError, true);
  assert.equal(grep.result, 'No matches found');
  assert.equal(agent.handback, true);
  assert.equal(agent.result, HANDBACK);
  assert.match(agent.input, /list what a Claude Code reply contains/);
});

test('a long result is cut to its END, and says how much there was', () => {
  const bash = entries.find((e) => e.role === 'tool' && e.tool.name === 'Bash').tool;
  assert.equal(bash.resultTruncated, true);
  assert.equal(bash.resultLength, LONG_OUTPUT.length);
  assert.equal(bash.result.length, MAX_TOOL_RESULT);
  assert.ok(
    bash.result.endsWith('case-240.test.mjs'),
    'the verdict is at the end, so the end is kept',
  );
  assert.deepEqual(bounded('abcdef', 4), { text: 'abcd', truncated: true, length: 6 });
  assert.deepEqual(bounded('abcdef', 4, 'end'), { text: 'cdef', truncated: true, length: 6 });
  assert.deepEqual(bounded('abc', 4), { text: 'abc', truncated: false, length: 3 });
});

test('a picture the person attached is counted, and one in a result is named', () => {
  const withImage = entries.find((e) => e.role === 'user' && e.images);
  assert.equal(withImage.images, 1);
  assert.equal(withImage.text, 'Here is how it looks now.');
  assert.equal(
    toolResultText([
      { type: 'text', text: 'a' },
      { type: 'image', source: {} },
    ]),
    'a\n[an image — open it in the session]',
  );
  assert.equal(toolInputText('Write', { file_path: 'a.txt', content: 'hi' }), 'a.txt\nhi');
  assert.match(
    toolInputText('WebFetch', { url: 'https://example.com' }),
    /"url": "https:\/\/example\.com"/,
  );
  assert.equal(toolInputText('X', null), '');
  // A sub-agent's line is its description, on one line whatever was typed.
  const [task] = parseConversationDetail(
    JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't',
            name: 'Task',
            input: { description: 'check\n   the  press', prompt: 'p' },
          },
        ],
      },
    }),
  );
  assert.equal(task.tool.summary, 'Task check the press');
});

test('the plain reader is untouched: text only, as every other caller reads it', () => {
  const plain = parseConversation(JSONL, { maxMessages: 50 });
  assert.deepEqual(
    plain.map((m) => m.role),
    ['user', 'assistant', 'assistant', 'user', 'assistant'],
  );
  assert.ok(plain.every((m) => !('tool' in m)));
});

test('a result whose call is before the window is dropped, and a call with no result yet says so', () => {
  const lines = JSONL.trim().split('\n');
  // Cut the transcript so the Read call is gone and its result is first.
  const tail = lines.slice(4).join('\n');
  const cut = parseConversationDetail(tail);
  assert.ok(cut.every((e) => e.role !== 'user' || !/A small block-level/.test(e.text)));
  // And stop right after a call: it has no result, which is "still running".
  const open = parseConversationDetail(lines.slice(0, 5).join('\n'));
  const last = open[open.length - 1];
  assert.equal(last.role, 'tool');
  assert.equal(last.tool.result, null);
  assert.equal(parseConversationDetail(JSONL, { maxMessages: 3 }).length, 3);
  assert.deepEqual(parseConversationDetail('not json\n{"type":"user"}\n'), []);
});

// --------------------------------------------------------------- the drawing

test('the card leads with the last thing the agent said, and folds the rest above it', () => {
  const { latest, earlier, since } = splitTranscript(entries);
  assert.equal(latest.text, REPLY);
  assert.equal(earlier.length, entries.length - 1);
  assert.deepEqual(since, []);
  assert.equal(earlierSummary(earlier), 'earlier in this conversation · 4 messages · 5 tool calls');
  assert.equal(
    earlierSummary([{ role: 'user', text: 'x', at: 0 }]),
    'earlier in this conversation · 1 message',
  );

  // A turn still in progress: what it has done since is neither the answer
  // nor history.
  const midTurn = entries.slice(0, 5);
  const mid = splitTranscript(midTurn);
  assert.equal(mid.latest.text, 'I’ll read the renderer first.');
  assert.deepEqual(
    mid.since.map((e) => e.role),
    ['tool', 'tool'],
  );
  // Nothing from the agent yet.
  assert.deepEqual(splitTranscript([entries[0]]), {
    latest: null,
    earlier: [entries[0]],
    since: [],
  });
  assert.deepEqual(splitTranscript(null), { latest: null, earlier: [], since: [] });
});

test('tool calls are collapsed to one line each, in one column, and open to input and result', () => {
  const nodes = renderEntries(splitTranscript(entries).earlier, doc);
  const root = doc.createElement('div');
  for (const n of nodes) root.appendChild(n);

  const calls = byClass(root, 'tool-call');
  // five tools and two blocks of reasoning
  assert.equal(calls.length, 7);
  assert.ok(
    calls.every((c) => c.tagName === 'DETAILS' && c.open === false),
    'collapsed by default',
  );
  assert.deepEqual(
    byClass(root, 'tool-call-line').map((l) => l.textContent),
    [
      'thinkingThe renderer is in public/markdown.js. Read it before judging it.',
      'Readpublic/markdown.js',
      'Bashnpm test',
      'Editpublic/markdown.js',
      'Grep<script>alert(1)</script>failed',
      'AgentAudit the markdown renderer',
      'thinkingEverything is in. Write it up with the table and the fix.',
    ],
  );
  // The five calls between two messages are one run, not five paragraphs.
  assert.equal(byClass(root, 'tool-run').length, 3);
  assert.equal(byClass(byClass(root, 'tool-run')[1], 'tool-call').length, 5);

  // A failed call is marked, and the mark is a word.
  const failed = byClass(root, 'tool-call--error');
  assert.equal(failed.length, 1);
  assert.equal(byClass(failed[0], 'tool-call-state')[0].textContent, 'failed');

  // A long result says it was cut and offers the session.
  const bash = calls[2];
  assert.match(
    byClass(bash, 'tool-call-cut')[0].textContent,
    /The last 6,000 of [\d,]+ characters\./,
  );
  assert.equal(byClass(bash, 'md-in-session').length, 1);

  // A sub-agent's report is drawn as the markdown it is.
  const agent = calls[5];
  assert.deepEqual(
    byClass(agent, 'tool-call-label').map((l) => l.textContent),
    ['asked', 'handed back'],
  );
  assert.equal(byClass(agent, 'md-h2')[0].textContent, 'Audit of the markdown renderer');
  assert.equal(byTag(agent, 'li').length, 2);

  // The person's words are exactly what was typed, and their picture is named.
  const users = byClass(root, 'msg--user');
  assert.equal(users.length, 2);
  assert.match(
    users[1].textContent,
    /Here is how it looks now\.1 image attached open in the session/,
  );
});

test('SECURITY: nothing a tool was given or gave back becomes an element', () => {
  const hostile = {
    name: '<img src=x onerror=alert(1)>',
    summary: '<img src=x onerror=alert(1)> <script>alert(1)</script>',
    input: '</pre><script>alert(1)</script>',
    result: '<iframe src="javascript:alert(1)"></iframe>',
    isError: false,
    handback: false,
  };
  const node = renderToolCall(hostile, doc);
  const tags = new Set(all(node).map((n) => n.tagName));
  assert.deepEqual([...tags].sort(), ['DETAILS', 'DIV', 'PRE', 'SPAN', 'SUMMARY']);
  assert.match(node.textContent, /<script>alert\(1\)<\/script>/);
  for (const n of all(node)) {
    for (const name of Object.keys(n.attributes || {})) assert.ok(!/^on/i.test(name), name);
  }
  // A hand-back goes through the markdown renderer, which holds its own line.
  const report = renderToolCall(
    {
      ...hostile,
      name: 'Agent',
      summary: 'Agent',
      handback: true,
      result: '[x](javascript:alert(1)) <script>x</script>',
    },
    doc,
  );
  assert.equal(byTag(report, 'a').length, 0);
  assert.equal(byTag(report, 'script').length, 0);
  // Reasoning is text.
  const thought = renderThinking('<b onmouseover=alert(1)>hm</b>', doc);
  assert.equal(byTag(thought, 'b').length, 0);
  assert.match(thought.textContent, /<b onmouseover=alert\(1\)>hm<\/b>/);
});

test('an MCP tool is read back into its server and tool, and a call with no result yet says so', () => {
  const node = renderToolCall(
    { name: 'mcp__gmail__send', summary: 'mcp__gmail__send', input: '{}', result: null },
    doc,
  );
  assert.equal(byClass(node, 'tool-call-name')[0].textContent, 'Gmail · send');
  assert.equal(byClass(node, 'tool-call-state')[0].textContent, 'no result yet');
  assert.equal(
    byClass(node, 'tool-call-label').length,
    1,
    'no result section for a call still running',
  );
});
