/**
 * One conversation, with what the model DID as well as what it said (WP-100).
 *
 * `parseConversation()` in `parse.mjs` keeps the prose and drops the rest —
 * `thinking`, `tool_use`, `tool_result` — because "the panel is a conversation,
 * not a trace of what the model did to answer it". That was the right call for
 * a card that showed one message. It is the wrong one for a transcript worth
 * reading: what the agent ran, and what came back, is most of what a person
 * opening the card wants to check. So this is the same walk over the same
 * records, with the three kinds of block kept as entries of their own:
 *
 *   role 'user'       what the person typed (and how many pictures came with it)
 *   role 'assistant'  what the model said
 *   role 'thinking'   what it reasoned, before
 *   role 'tool'       one call: its name, a one-line summary, its input, and
 *                     — once the matching `tool_result` has been read — its
 *                     result
 *
 * In the order they were written, so a turn reads as it happened. The default
 * reader is untouched, and so is everything that depends on it (the live
 * digest in `adapter-watch.mjs`, the scan's excerpt): this is asked for by
 * name, with `?detail=1`, by the one caller that draws it.
 *
 * WHY IT IS A FILE OF ITS OWN. `docs/02-ARCHITECTURE.md` §2.1 keeps a
 * runtime's format knowledge in its adapter, and this is in it; `parse.mjs` is
 * at 977 lines on a permanent exemption from the 900-line ceiling, and a
 * second reader of the same records is not a reason to make it longer.
 *
 * BOUNDED, because none of this is the product's own text. A tool's input and
 * its result are capped — a test run prints megabytes and the card needs the
 * end of it, not all of it — and every cap is reported (`truncated`, with the
 * original length) rather than applied silently. Everything is a string by
 * the time it leaves here; the browser sets it with `textContent`.
 */
import { jsonLines, stripWrappers } from './parse.mjs';
import { toolSummary } from './hooks-summary.mjs';

/** The most of one tool's input that is sent to the card. */
export const MAX_TOOL_INPUT = 4000;
/** The most of one tool's result. The END is kept: that is where a verdict is. */
export const MAX_TOOL_RESULT = 6000;
/** The most of one block of reasoning. */
export const MAX_THINKING = 4000;
/** Tools whose result is another agent's report, written as markdown. */
const HANDBACK_TOOLS = new Set(['Agent', 'Task']);

/**
 * A value as text a person can read: a string as itself, anything else as
 * indented JSON.
 * @param {unknown} value
 * @returns {string}
 */
function asText(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/**
 * A tool's input, as the card shows it. A `Bash` call is its command; an edit
 * is its file and the two strings; everything else is its JSON. Field by
 * field rather than a blob so the one thing a reader wants — the command, the
 * path — is the first line and not the fourth.
 * @param {string} name @param {any} input
 * @returns {string}
 */
export function toolInputText(name, input) {
  if (!input || typeof input !== 'object') return asText(input);
  if (name === 'Bash' && typeof input.command === 'string') return input.command;
  if ((name === 'Edit' || name === 'MultiEdit') && typeof input.file_path === 'string') {
    const edits = Array.isArray(input.edits) ? input.edits : [input];
    const parts = [input.file_path];
    for (const e of edits) {
      if (!e || typeof e !== 'object') continue;
      if (typeof e.old_string === 'string') parts.push(prefixLines('- ', e.old_string));
      if (typeof e.new_string === 'string') parts.push(prefixLines('+ ', e.new_string));
    }
    return parts.join('\n');
  }
  if (name === 'Write' && typeof input.file_path === 'string') {
    return `${input.file_path}\n${typeof input.content === 'string' ? input.content : ''}`;
  }
  if (HANDBACK_TOOLS.has(name) && typeof input.prompt === 'string') return input.prompt;
  return asText(input);
}

/**
 * A sub-agent call's one line: its name and the short description its lead
 * gave it — `Agent Audit the markdown renderer`. Every other tool's line is
 * `hooks-summary.mjs`'s, which has no shape for this one.
 * @param {string} name @param {any} input
 * @returns {string}
 */
function handbackSummary(name, input) {
  if (!HANDBACK_TOOLS.has(name) || !input || typeof input.description !== 'string') return '';
  const what = input.description.replace(/\s+/g, ' ').trim().slice(0, 80);
  return what ? `${name} ${what}` : '';
}

/** @param {string} prefix @param {string} text */
function prefixLines(prefix, text) {
  return text
    .split('\n')
    .map((l) => prefix + l)
    .join('\n');
}

/**
 * A `tool_result`'s content as text. It is a string, or an array of blocks of
 * which the `text` ones are text and an `image` is a picture this cannot show.
 * @param {unknown} content
 * @returns {string}
 */
export function toolResultText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return asText(content);
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== 'object') continue;
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text);
    else if (block.type === 'image') parts.push('[an image — open it in the session]');
  }
  return parts.join('\n');
}

/**
 * Cut to a budget. `keep: 'end'` keeps the tail, which is where a command's
 * verdict is; the default keeps the head.
 * @param {string} text @param {number} max @param {'start'|'end'} [keep]
 * @returns {{text:string, truncated:boolean, length:number}}
 */
export function bounded(text, max, keep = 'start') {
  const s = String(text ?? '');
  if (s.length <= max) return { text: s, truncated: false, length: s.length };
  return {
    text: keep === 'end' ? s.slice(s.length - max) : s.slice(0, max),
    truncated: true,
    length: s.length,
  };
}

/**
 * @typedef {object} DetailTool
 * @property {string} id
 * @property {string} name
 * @property {string} summary     one line: `Bash npm test`, `Edit src/x.js`
 * @property {string} input
 * @property {boolean} inputTruncated
 * @property {string|null} result   null until the matching result is read —
 *   a call still running, or one whose result is past the tail window
 * @property {boolean} resultTruncated
 * @property {number} resultLength  of the whole result, before any cut
 * @property {boolean} isError
 * @property {boolean} handback     its result is another agent's report
 *
 * @typedef {{role:'user'|'assistant'|'thinking', text:string, at:number, images?:number}
 *   | {role:'tool', text:string, at:number, tool:DetailTool}} DetailMessage
 */

/**
 * The conversation with its tools and reasoning kept, oldest first.
 *
 * @param {string} text  a bounded tail of a transcript
 * @param {{maxMessages?:number, sidechain?:boolean}} [opts] as
 *   `parseConversation`'s: `sidechain` is a junior's own transcript, where
 *   every record carries the flag and dropping them would leave nothing.
 * @returns {DetailMessage[]}
 */
export function parseConversationDetail(text, { maxMessages = 400, sidechain = false } = {}) {
  /** @type {DetailMessage[]} */
  const out = [];
  /** @type {Map<string, DetailTool>} */
  const open = new Map();

  for (const rec of jsonLines(text)) {
    if (rec.type !== 'user' && rec.type !== 'assistant') continue;
    if (!sidechain && rec.isSidechain === true) continue;
    if (!rec.message || typeof rec.message !== 'object') continue;
    const ts = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
    const at = Number.isFinite(ts) ? ts : 0;
    const content = rec.message.content;

    if (typeof content === 'string') {
      const cleaned = stripWrappers(content);
      if (cleaned) out.push({ role: rec.type, text: cleaned, at });
      continue;
    }
    if (!Array.isArray(content)) continue;

    /** @type {string[]} */
    let prose = [];
    let images = 0;
    const flush = () => {
      const cleaned = stripWrappers(prose.join('\n\n'));
      prose = [];
      if (!cleaned && !images) return;
      /** @type {DetailMessage} */
      const msg = { role: rec.type, text: cleaned, at };
      if (images) msg.images = images;
      images = 0;
      out.push(msg);
    };

    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        prose.push(block.text);
      } else if (block.type === 'image') {
        images++;
      } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
        flush();
        const cut = bounded(block.thinking.trim(), MAX_THINKING);
        if (cut.text) out.push({ role: 'thinking', text: cut.text, at });
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        flush();
        const said = toolSummary({ tool_name: block.name, tool_input: block.input, cwd: rec.cwd });
        const input = bounded(toolInputText(block.name, block.input), MAX_TOOL_INPUT);
        /** @type {DetailTool} */
        const tool = {
          id: typeof block.id === 'string' ? block.id : '',
          name: block.name,
          summary: handbackSummary(block.name, block.input) || (said ? said.summary : block.name),
          input: input.text,
          inputTruncated: input.truncated,
          result: null,
          resultTruncated: false,
          resultLength: 0,
          isError: false,
          handback: HANDBACK_TOOLS.has(block.name),
        };
        if (tool.id) open.set(tool.id, tool);
        out.push({ role: 'tool', text: tool.summary, at, tool });
      } else if (block.type === 'tool_result') {
        // The answer to a call made earlier. It is attached to that call
        // rather than shown as something the person said — in the transcript
        // it is a `user` record, and it is nothing a user typed.
        const tool = open.get(String(block.tool_use_id || ''));
        if (!tool) continue; // its call is before the tail window
        const cut = bounded(toolResultText(block.content), MAX_TOOL_RESULT, 'end');
        tool.result = cut.text;
        tool.resultTruncated = cut.truncated;
        tool.resultLength = cut.length;
        tool.isError = block.is_error === true;
      }
    }
    flush();
  }
  return maxMessages > 0 && out.length > maxMessages ? out.slice(out.length - maxMessages) : out;
}
