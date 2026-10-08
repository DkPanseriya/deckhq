/**
 * The thread, as something worth reading (WP-100).
 *
 * The owner, 8 October: _"if I want to read its response … see how we can
 * lift all that output, same as the Claude Code app: proper text formatting,
 * the hierarchies, links, opening artifacts."_
 *
 * What a session writes is not only prose. Between two things the agent said
 * there are the tools it ran, what came back, and what it reasoned on the way.
 * `GET /api/conversation?detail=1` hands those over as entries of their own,
 * and this file is how each one is drawn:
 *
 *   a message    the person's words exactly as typed; the agent's as markdown
 *   a tool call  ONE LINE — `Bash npm test`, `Edit src/x.js` — that opens to
 *                its input and its result
 *   reasoning    one quiet line that opens to the text
 *   a hand-back  a sub-agent's report, which is markdown and is drawn as it
 *
 * Collapsed by default, because a turn is forty tool calls and one answer and
 * the answer is what the card is for; one click from open, because sometimes
 * the question is exactly "what did it run".
 *
 * Every function here takes the document to build with and uses only
 * `createElement`, `createTextNode`, `appendChild`, `className`,
 * `setAttribute` and `textContent` — the same six the markdown renderer uses,
 * for the same reason: all of it is untrusted, and none of it is ever markup.
 * So it runs unchanged against a DOM stub (`test/unit/panel-transcript.test.mjs`).
 * Nothing here listens for anything; `panel-said.js` wires the clicks.
 */

import { inSessionControl, renderMarkdown } from './markdown.js';
import { humaniseToolSummary } from './mcp-tool-name.js';

/**
 * @typedef {object} Tool
 * @property {string} name
 * @property {string} summary
 * @property {string} input
 * @property {boolean} [inputTruncated]
 * @property {string|null} result
 * @property {boolean} [resultTruncated]
 * @property {number} [resultLength]
 * @property {boolean} [isError]
 * @property {boolean} [handback]
 *
 * @typedef {{role:string, text:string, at:number, images?:number, tool?:Tool}} Entry
 */

/**
 * Cut a conversation into what the card leads with and what it folds away.
 *
 * `latest` is the last thing the agent SAID. `earlier` is everything before
 * it, in order. `since` is what has happened after it — tools still running
 * on a turn that has not answered yet — which is not earlier and is not the
 * answer, so it is neither folded away nor mistaken for one.
 *
 * @param {Entry[]|null|undefined} messages
 * @returns {{latest:Entry|null, earlier:Entry[], since:Entry[]}}
 */
export function splitTranscript(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let at = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].role === 'assistant' && list[i].text) {
      at = i;
      break;
    }
  }
  if (at === -1) return { latest: null, earlier: list, since: [] };
  return { latest: list[at], earlier: list.slice(0, at), since: list.slice(at + 1) };
}

/**
 * The fold's one line: `earlier in this conversation · 6 messages · 14 tool calls`.
 * Reasoning is not counted — it is neither a message nor an act.
 * @param {Entry[]} earlier
 * @returns {string}
 */
export function earlierSummary(earlier) {
  const messages = earlier.filter((m) => m.role === 'user' || m.role === 'assistant').length;
  const tools = earlier.filter((m) => m.role === 'tool').length;
  const parts = ['earlier in this conversation'];
  if (messages) parts.push(`${messages} ${messages === 1 ? 'message' : 'messages'}`);
  if (tools) parts.push(`${tools} ${tools === 1 ? 'tool call' : 'tool calls'}`);
  return parts.join(' · ');
}

/** @param {number} n */
const count = (n) => Number(n || 0).toLocaleString('en-US');

/** @param {Document} doc @param {string} tag @param {string} className @param {string} [text] */
function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * One tool call: a line, and what is behind it.
 * @param {Tool} tool @param {Document} doc
 * @returns {HTMLElement}
 */
export function renderToolCall(tool, doc) {
  const running = tool.result === null || tool.result === undefined;
  const details = doc.createElement('details');
  details.className = tool.isError
    ? 'tool-call tool-call--error'
    : running
      ? 'tool-call tool-call--open'
      : 'tool-call';

  // `Bash npm test` is the name and then what it was asked. The name is set
  // apart so a column of calls reads down its left edge.
  // An MCP tool's id is read back into its server and tool; nothing else is
  // renamed.
  const label = humaniseToolSummary(tool.name, tool.name) || tool.name;
  const raw = String(tool.summary || tool.name);
  const rest = raw.startsWith(`${tool.name} `) ? raw.slice(tool.name.length + 1) : '';
  const summary = doc.createElement('summary');
  summary.className = 'tool-call-line';
  summary.setAttribute('title', raw);
  summary.appendChild(el(doc, 'span', 'tool-call-name', label));
  if (rest) summary.appendChild(el(doc, 'span', 'tool-call-what', rest));
  if (tool.isError) summary.appendChild(el(doc, 'span', 'tool-call-state', 'failed'));
  else if (running) summary.appendChild(el(doc, 'span', 'tool-call-state', 'no result yet'));
  details.appendChild(summary);

  const body = el(doc, 'div', 'tool-call-body');
  body.appendChild(el(doc, 'div', 'tool-call-label', tool.handback ? 'asked' : 'input'));
  body.appendChild(el(doc, 'pre', 'tool-call-pre', tool.input || '(nothing)'));
  if (tool.inputTruncated) {
    body.appendChild(
      el(doc, 'div', 'tool-call-cut', 'The start of it. The rest is in the session.'),
    );
  }
  if (!running) {
    body.appendChild(el(doc, 'div', 'tool-call-label', tool.handback ? 'handed back' : 'result'));
    if (tool.handback && tool.result) {
      // A sub-agent's report is written as markdown, to be read.
      const wrap = el(doc, 'div', 'tool-call-handback');
      wrap.appendChild(renderMarkdown(tool.result, doc));
      body.appendChild(wrap);
    } else {
      body.appendChild(el(doc, 'pre', 'tool-call-pre', tool.result || '(nothing)'));
    }
    if (tool.resultTruncated) {
      const cut = el(
        doc,
        'div',
        'tool-call-cut',
        `The last ${count(String(tool.result || '').length)} of ${count(tool.resultLength)} characters. `,
      );
      cut.appendChild(inSessionControl(doc));
      body.appendChild(cut);
    }
  }
  details.appendChild(body);
  return details;
}

/**
 * What the model reasoned: one quiet line that opens.
 * @param {string} text @param {Document} doc
 */
export function renderThinking(text, doc) {
  const details = doc.createElement('details');
  details.className = 'tool-call tool-call--thinking';
  const summary = doc.createElement('summary');
  summary.className = 'tool-call-line';
  summary.appendChild(el(doc, 'span', 'tool-call-name', 'thinking'));
  // The first line, so the fold says what it is about before it is opened.
  const first = String(text || '')
    .split('\n')
    .find((l) => l.trim());
  if (first) summary.appendChild(el(doc, 'span', 'tool-call-what', first.trim().slice(0, 120)));
  details.appendChild(summary);
  const body = el(doc, 'div', 'tool-call-body');
  body.appendChild(el(doc, 'div', 'tool-call-thought', text));
  details.appendChild(body);
  return details;
}

/**
 * "2 images — open in the session": a picture the person attached. It is on
 * their disk and in the session; this page has neither, and says where it is
 * rather than drawing a box that would be empty.
 * @param {number} n @param {Document} doc
 */
export function renderAttachments(n, doc) {
  const line = el(doc, 'div', 'msg-attached', `${n} ${n === 1 ? 'image' : 'images'} attached `);
  line.appendChild(inSessionControl(doc));
  return line;
}

/**
 * One message, with who said it.
 * @param {Entry} m @param {Document} doc @param {{agentName?:string}} [opts]
 */
export function renderMessage(m, doc, opts = {}) {
  const user = m.role === 'user';
  const wrap = el(doc, 'div', `msg msg--${user ? 'user' : 'assistant'}`);
  wrap.appendChild(el(doc, 'div', 'msg-who', user ? 'You' : opts.agentName || 'Agent'));
  const body = el(doc, 'div', 'msg-body');
  if (user) {
    // What the user typed is shown exactly as typed.
    body.className = 'msg-body msg-body--plain';
    body.textContent = m.text;
  } else {
    body.appendChild(renderMarkdown(m.text, doc));
  }
  wrap.appendChild(body);
  if (m.images) wrap.appendChild(renderAttachments(m.images, doc));
  return wrap;
}

/**
 * A run of entries, in order. Consecutive tool calls and reasoning are set
 * together as one tight column — a turn's work — between the messages that
 * frame it.
 * @param {Entry[]} entries @param {Document} doc @param {{agentName?:string}} [opts]
 * @returns {HTMLElement[]}
 */
export function renderEntries(entries, doc, opts = {}) {
  /** @type {HTMLElement[]} */
  const out = [];
  /** @type {HTMLElement|null} */
  let run = null;
  for (const m of entries) {
    if (m.role === 'tool' || m.role === 'thinking') {
      if (!run) {
        run = el(doc, 'div', 'tool-run');
        out.push(run);
      }
      run.appendChild(
        m.role === 'tool' && m.tool ? renderToolCall(m.tool, doc) : renderThinking(m.text, doc),
      );
      continue;
    }
    run = null;
    out.push(renderMessage(m, doc, opts));
  }
  return out;
}
