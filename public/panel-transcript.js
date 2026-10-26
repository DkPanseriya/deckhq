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
 * THE TURN THE CARD LEADS WITH (the owner, 25 October 2026: "I never look at
 * its output or respond to it… the panel is very crowded and hard to
 * understand"). The card reads like Claude Code: what you asked, what it did,
 * what it said. So the latest answer is drawn with the prompt that started it
 * above it, and the work between them folded to one line.
 *
 * `prompt` is the last thing the person typed before `latest`; `work` is what
 * happened between the two (tools, reasoning, the agent's notes on the way);
 * `earlier` is everything before the prompt. With no prompt in the transcript
 * (a session the agent opened itself) `work` starts at the top.
 *
 * @param {Entry[]|null|undefined} messages
 * @returns {{latest:Entry|null, prompt:Entry|null, work:Entry[], earlier:Entry[], since:Entry[]}}
 */
export function splitTurn(messages) {
  const { latest, earlier, since } = splitTranscript(messages);
  if (!latest) return { latest, prompt: null, work: [], earlier, since };
  let p = -1;
  for (let i = earlier.length - 1; i >= 0; i--) {
    if (earlier[i].role === 'user' && isTyped(earlier[i].text)) {
      p = i;
      break;
    }
  }
  if (p === -1) return { latest, prompt: null, work: earlier, earlier: [], since };
  return {
    latest,
    prompt: earlier[p],
    work: earlier.slice(p + 1),
    earlier: earlier.slice(0, p),
    since,
  };
}

/**
 * Did a PERSON type this? A user-role entry is also how the runtime hands a
 * session what nobody typed: a background task finishing
 * (`<task-notification>`), a slash command's echo and output, a system
 * reminder, an interruption marker. Those wake a turn but are not the
 * question it answers, so they are its work, never its prompt.
 * @param {string|null|undefined} text
 */
export function isTyped(text) {
  const t = String(text || '').trimStart();
  if (!t) return false;
  if (/^\[Request interrupted/.test(t)) return false;
  return !/^<(task-notification|system-reminder|local-command-[a-z-]+|command-[a-z-]+|user-memory-input)\b/.test(
    t,
  );
}

/** The tools that write a file, and whose input starts with its path. */
const WRITING_TOOLS = new Set(['Edit', 'MultiEdit', 'Write']);

/**
 * The files this session edited, as repository-relative paths, lower-cased
 * for comparing: read off its own Edit, MultiEdit and Write calls, whose
 * input's first line is the file's path (`transcript-detail.mjs`). A path
 * outside `root` is not this repository's and is left out. What a shell
 * command changed is not counted: there is no path to read.
 * @param {Entry[]|null|undefined} messages
 * @param {string|null|undefined} root the repository's root
 * @returns {Set<string>}
 */
export function touchedFiles(messages, root) {
  const out = new Set();
  const base = String(root || '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
    .toLowerCase();
  for (const m of Array.isArray(messages) ? messages : []) {
    if (m.role !== 'tool' || !m.tool || !WRITING_TOOLS.has(m.tool.name)) continue;
    const first = String(m.tool.input || '')
      .split('\n')[0]
      .trim()
      .replace(/\\/g, '/')
      .toLowerCase();
    if (!first) continue;
    if (base && first.startsWith(`${base}/`)) out.add(first.slice(base.length + 1));
    else if (!/^([a-z]:)?\//.test(first)) out.add(first.replace(/^\.\//, ''));
  }
  return out;
}

/**
 * The work fold's one line: `24 tool calls · 3 notes`. A note is something
 * the agent said on the way, before its answer.
 * @param {Entry[]} work
 * @returns {string}
 */
export function workSummary(work) {
  const tools = work.filter((m) => m.role === 'tool').length;
  const notes = work.filter((m) => m.role === 'assistant' && m.text).length;
  const woken = work.filter((m) => m.role === 'user' && !isTyped(m.text)).length;
  const parts = [];
  if (tools) parts.push(`${tools} ${tools === 1 ? 'tool call' : 'tool calls'}`);
  if (notes) parts.push(`${notes} ${notes === 1 ? 'note' : 'notes'}`);
  if (woken) parts.push(`${woken} ${woken === 1 ? 'notice' : 'notices'}`);
  if (!parts.length && work.length) parts.push('its reasoning');
  return parts.join(' · ');
}

/**
 * The earlier fold's one line: `6 earlier turns`. A turn is one thing the
 * person typed.
 * @param {Entry[]} earlier
 * @returns {string}
 */
export function earlierTurns(earlier) {
  const turns = earlier.filter((m) => m.role === 'user' && isTyped(m.text)).length;
  if (!turns) return earlierSummary(earlier);
  return `${turns} earlier ${turns === 1 ? 'turn' : 'turns'}`;
}

/**
 * WHAT IT IS ASKING YOU, if anything: the last question in the last two
 * paragraphs of its answer, as one sentence. Read off the text alone, so it
 * is shown only where the floor already says the session is waiting on you;
 * an answer that asks nothing gives null, and the card shows no box.
 * @param {string|null|undefined} text
 * @returns {string|null}
 */
export function askOf(text) {
  const paras = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .slice(-2)
    .reverse();
  for (const para of paras) {
    const plain = para
      .replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s+/gm, '')
      .replace(/[*_`]+/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    const questions = plain.match(/[^.!?]*\?/g);
    if (!questions) continue;
    const q = questions[questions.length - 1].trim();
    if (q.length < 8) continue;
    return q.length > 280 ? `${q.slice(0, 277).trimEnd()}…` : q;
  }
  return null;
}

/**
 * What the person typed to start this turn: one quiet block, `>` and their
 * words exactly as typed, cut to a few lines until it is clicked.
 * @param {Entry} m @param {Document} doc
 */
export function renderPrompt(m, doc) {
  const wrap = el(doc, 'div', 'turn-prompt');
  wrap.setAttribute('title', 'Your prompt. Click to show all of it.');
  wrap.appendChild(el(doc, 'span', 'turn-prompt-mark', '>'));
  wrap.appendChild(el(doc, 'span', 'turn-prompt-text', m.text));
  if (m.images) wrap.appendChild(renderAttachments(m.images, doc));
  return wrap;
}

/**
 * What it did between the prompt and the answer, folded to one line that
 * opens to every call: `● 24 tool calls · 3 notes`.
 * @param {Entry[]} work @param {Document} doc @param {{agentName?:string}} [opts]
 */
export function renderWork(work, doc, opts = {}) {
  const details = doc.createElement('details');
  details.className = 'turn-work';
  const summary = doc.createElement('summary');
  summary.className = 'turn-work-line';
  // A drawn dot, not a glyph: state colours never set text.
  const dot = el(doc, 'span', 'turn-work-dot');
  dot.setAttribute('aria-hidden', 'true');
  summary.appendChild(dot);
  summary.appendChild(el(doc, 'span', 'turn-work-what', workSummary(work)));
  // The last tool it ran, so the line says something before it is opened.
  const last = [...work].reverse().find((m) => m.role === 'tool' && m.tool);
  if (last && last.tool) {
    const name = humaniseToolSummary(last.tool.name, last.tool.name) || last.tool.name;
    summary.appendChild(el(doc, 'span', 'turn-work-last', `last: ${name}`));
  }
  details.appendChild(summary);
  const body = el(doc, 'div', 'turn-work-body');
  for (const node of renderEntries(work, doc, opts)) body.appendChild(node);
  details.appendChild(body);
  return details;
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
 * Something the runtime handed the session that nobody typed (`isTyped`): one
 * quiet line, `notice  Background command "…" completed`, that opens to the
 * text as it came. The line is the notice's own `<summary>` where it has one.
 * @param {string} text @param {Document} doc
 */
export function renderNotice(text, doc) {
  const details = doc.createElement('details');
  details.className = 'tool-call tool-call--thinking tool-call--notice';
  const summary = doc.createElement('summary');
  summary.className = 'tool-call-line';
  summary.appendChild(el(doc, 'span', 'tool-call-name', 'notice'));
  const raw = String(text || '');
  const said = /<summary>([\s\S]*?)<\/summary>/.exec(raw);
  const line = (said ? said[1] : raw.replace(/<[^>]*>/g, ' '))
    .split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (line) summary.appendChild(el(doc, 'span', 'tool-call-what', line.slice(0, 120)));
  details.appendChild(summary);
  const body = el(doc, 'div', 'tool-call-body');
  body.appendChild(el(doc, 'pre', 'tool-call-pre', raw));
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
    const notice = m.role === 'user' && !isTyped(m.text);
    if (m.role === 'tool' || m.role === 'thinking' || notice) {
      if (!run) {
        run = el(doc, 'div', 'tool-run');
        out.push(run);
      }
      run.appendChild(
        notice
          ? renderNotice(m.text, doc)
          : m.role === 'tool' && m.tool
            ? renderToolCall(m.tool, doc)
            : renderThinking(m.text, doc),
      );
      continue;
    }
    run = null;
    out.push(renderMessage(m, doc, opts));
  }
  return out;
}
