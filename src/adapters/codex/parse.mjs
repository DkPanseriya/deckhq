/**
 * Codex CLI rollout-file parsing.
 *
 * docs/02-ARCHITECTURE.md §2.1: "All parsing lives in one file per adapter so a
 * format break is a single-file fix." This file is that fix point for Codex.
 *
 * Codex's on-disk session format is undocumented and has changed across CLI
 * versions. We have never observed it directly on this machine (Codex is not
 * installed here — see docs/04-BUILD-PLAN.md WP2 and CONTRACTS.md). Everything
 * below is written defensively against the openai/codex repository conventions:
 * try several key aliases, never throw, fall back to null/empty. A line that
 * does not match anything we recognise is simply ignored, not an error.
 *
 * ---------------------------------------------------------------------------
 * SHAPES THIS FILE HANDLES (update this list first when the format changes):
 * ---------------------------------------------------------------------------
 *
 * 1. Session meta record (normally the first line of a rollout file):
 *      { type: 'session_meta' | 'meta', payload: { id, timestamp, cwd, originator,
 *        workdir, instructions, cli_version, ... } }
 *    or a flat, unwrapped variant with the same fields at the top level.
 *    cwd resolution order (per spec): payload.cwd, then payload.originator,
 *    then payload.workdir, else the caller falls back to 'unknown'.
 *
 * 2. Wrapped event records:
 *      { type: 'response_item', payload: { type: 'message', role, content } }
 *      { type: 'event_msg',     payload: { type: 'token_count', info: {...} } }
 *      { type: 'event_msg',     payload: { type: 'agent_message', message } }
 *      { type: 'message',       payload: { role, content } }
 *      { type: 'turn_context',  payload: { cwd, model, ... } }  -- not a message
 *
 * 3. Flat, unwrapped message records with no envelope:
 *      { role: 'user'|'assistant', content, timestamp }
 *
 * 4. Message content, in any of the above:
 *      - a plain string
 *      - an array of parts: { type: 'input_text'|'output_text'|'text', text }
 *        (other part types, e.g. images or tool payloads, are skipped)
 *      - a bare string under `message` instead of `content` (event_msg style)
 *
 * 5. Non-message response items, explicitly excluded from conversation text
 *    (tool calls and reasoning are never surfaced — WP1/WP2 acceptance: "no
 *    [tool: ...] artefacts"):
 *      function_call, function_call_output, local_shell_call,
 *      local_shell_call_output, custom_tool_call, custom_tool_call_output,
 *      tool_call, tool_result, web_search_call, computer_call,
 *      computer_call_output, reasoning
 *
 * 6. Token usage, probed under several nestings and several key aliases:
 *      payload.info.total_token_usage / payload.info.last_token_usage /
 *      payload.usage / payload.total_token_usage / payload itself / the
 *      record itself, each checked for:
 *        input_tokens | inputTokens | prompt_tokens
 *        output_tokens | outputTokens | completion_tokens
 *        cached_input_tokens | cachedInputTokens | cache_read_input_tokens |
 *        cache_creation_input_tokens
 *    Whichever usage record appears LAST in the file wins (we assume these are
 *    running totals, as Codex's token_count events report cumulative usage;
 *    summing them would double-count).
 *
 * 7. A model hint, probed on turn_context payloads (payload.model) and on any
 *    record carrying a top-level or payload-level `model` string.
 *
 * A line that fails JSON.parse, or an object that matches none of the above,
 * is simply skipped by the caller (see extractMessage/extractUsage/
 * extractSessionMeta all returning null) — never thrown.
 */

import { open, stat } from 'node:fs/promises';

/** Maximum bytes read from the start of a file (title / meta discovery). */
export const HEAD_BYTES = 256 * 1024;

/** Maximum bytes read from the end of a file (recent state / usage). */
export const TAIL_BYTES = 2 * 1024 * 1024;

const NON_MESSAGE_ITEM_TYPES = new Set([
  'function_call',
  'function_call_output',
  'local_shell_call',
  'local_shell_call_output',
  'custom_tool_call',
  'custom_tool_call_output',
  'tool_call',
  'tool_result',
  'web_search_call',
  'computer_call',
  'computer_call_output',
  'reasoning',
]);

/** event_msg / response_item `type` values that imply a role when none is given. */
const ITEM_TYPE_ROLE = {
  agent_message: 'assistant',
  user_message: 'user',
};

/**
 * Read up to `maxBytes` from the start of a file without loading the whole
 * thing. docs contract: head <= 256 KB.
 * @param {string} filePath
 * @param {number} [maxBytes]
 * @returns {Promise<{text:string, truncated:boolean, size:number}>}
 */
export async function readHead(filePath, maxBytes = HEAD_BYTES) {
  const st = await stat(filePath);
  const size = st.size;
  const len = Math.min(size, maxBytes);
  if (len === 0) return { text: '', truncated: false, size };
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0);
    return { text: buf.toString('utf8'), truncated: size > maxBytes, size };
  } finally {
    await fh.close();
  }
}

/**
 * Read up to `maxBytes` from the end of a file without loading the whole
 * thing. docs contract: tail <= 2 MB.
 * @param {string} filePath
 * @param {number} [maxBytes]
 * @returns {Promise<{text:string, truncated:boolean, size:number}>}
 */
export async function readTail(filePath, maxBytes = TAIL_BYTES) {
  const st = await stat(filePath);
  const size = st.size;
  const len = Math.min(size, maxBytes);
  if (len === 0) return { text: '', truncated: false, size };
  const start = size - len;
  const fh = await open(filePath, 'r');
  try {
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, start);
    return { text: buf.toString('utf8'), truncated: start > 0, size };
  } finally {
    await fh.close();
  }
}

/**
 * Split a chunk of file text into lines, optionally dropping a partial line
 * at either edge. A head read may cut the last line mid-object; a tail read
 * (when it did not start at byte 0) may cut the first line mid-object.
 * @param {string} text
 * @param {{dropFirstPartial?:boolean, dropLastPartial?:boolean}} [opts]
 * @returns {string[]}
 */
export function linesFromChunk(text, opts = {}) {
  const { dropFirstPartial = false, dropLastPartial = false } = opts;
  if (!text) return [];
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  if (dropFirstPartial && lines.length) lines.shift();
  if (dropLastPartial && lines.length) lines.pop();
  return lines;
}

/**
 * Parse one JSONL line. Never throws; a corrupt line yields null so a scan
 * can skip it and keep going (CONTRACTS.md rule 6).
 * @param {string} line
 * @returns {object|null}
 */
export function parseLine(line) {
  if (typeof line !== 'string') return null;
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Convenience: parse every line of a text blob into records, silently
 * dropping corrupt or non-object lines. Intended for small reads (tests,
 * or a head/tail chunk already bounded by the caller) — never call this on
 * an unbounded read of a whole file.
 * @param {string} text
 * @returns {object[]}
 */
export function parseRecords(text) {
  return linesFromChunk(text)
    .map(parseLine)
    .filter((r) => r !== null);
}

/** @param {...unknown} vals */
function firstString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/** @param {...unknown} vals */
function firstNumber(...vals) {
  for (const v of vals) {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * @param {unknown} ts
 * @returns {number|null}
 */
function timestampToMs(ts) {
  if (!ts || typeof ts !== 'string') return null;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

/**
 * Heuristic: does this record look like the session meta record? Used only
 * for readability at call sites; extractSessionMeta() does the real work and
 * is safe to call unconditionally.
 * @param {Record<string, any>} rec  one parsed JSONL record, shape unknown
 * @returns {boolean}
 */
export function isSessionMeta(rec) {
  if (!rec || typeof rec !== 'object') return false;
  if (rec.type === 'session_meta' || rec.type === 'meta') return true;
  if (!rec.type && (rec.id || rec.session_id || rec.sessionId) && rec.cwd !== undefined) {
    return true;
  }
  return false;
}

/**
 * Extract {id, timestamp, cwd, instructions} from a session meta record.
 * Returns null if `rec` does not carry any recognisable meta fields at all.
 * @param {Record<string, any>} rec  one parsed JSONL record, shape unknown
 * @returns {{id:string|null, timestamp:string|null, cwd:string|null, instructions:string|null}|null}
 */
export function extractSessionMeta(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const body = rec.payload && typeof rec.payload === 'object' ? rec.payload : rec;

  const id = firstString(body.id, body.session_id, body.sessionId, rec.id, rec.session_id);
  const timestamp = firstString(body.timestamp, rec.timestamp);
  // Spec-mandated fallback order: cwd, then originator, then workdir.
  const cwd = firstString(body.cwd, body.originator, body.workdir);
  const instructions = typeof body.instructions === 'string' ? body.instructions : null;

  if (id === null && timestamp === null && cwd === null && instructions === null) return null;
  return { id, timestamp, cwd, instructions };
}

/**
 * Normalise message content (string, array of typed parts, or nullish) into
 * plain text. Non-text parts (images, tool payloads, etc.) are skipped.
 * @param {unknown} content
 * @returns {string}
 */
export function contentToText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      if (part == null) continue;
      if (typeof part === 'string') {
        parts.push(part);
        continue;
      }
      if (typeof part === 'object') {
        const t = part.type;
        if (t === 'input_text' || t === 'output_text' || t === 'text' || t === undefined) {
          if (typeof part.text === 'string') parts.push(part.text);
        }
      }
    }
    return parts.join('');
  }
  return '';
}

/** @param {Record<string, any>} body */
function pickRawContent(body) {
  if (body.content !== undefined) return body.content;
  if (typeof body.message === 'string') return body.message;
  if (body.text !== undefined) return body.text;
  return undefined;
}

/**
 * Extract a text-only conversation message from a record, trying several
 * envelope shapes. Returns null for anything that is not a plain user/
 * assistant message — tool calls, tool results, reasoning, and turn_context
 * records are deliberately excluded (the panel is a conversation, not a
 * trace; see docs/04-BUILD-PLAN.md WP1 acceptance criteria, reused for WP2).
 * @param {Record<string, any>} rec  one parsed JSONL record, shape unknown
 * @returns {{role:'user'|'assistant', text:string, at:number|null}|null}
 */
export function extractMessage(rec) {
  if (!rec || typeof rec !== 'object') return null;
  if (rec.type === 'turn_context') return null;

  const candidates = [];
  if (rec.payload && typeof rec.payload === 'object') {
    candidates.push(rec.payload);
    if (rec.payload.msg && typeof rec.payload.msg === 'object') candidates.push(rec.payload.msg);
    if (rec.payload.message && typeof rec.payload.message === 'object') {
      candidates.push(rec.payload.message);
    }
  }
  candidates.push(rec);

  for (const body of candidates) {
    if (!body || typeof body !== 'object') continue;
    const itemType = body.type;
    if (itemType && NON_MESSAGE_ITEM_TYPES.has(itemType)) return null;

    let role = firstString(body.role);
    if (role !== 'user' && role !== 'assistant') {
      const inferred = itemType && ITEM_TYPE_ROLE[itemType];
      role = inferred || null;
    }
    if (role !== 'user' && role !== 'assistant') continue;

    const text = contentToText(pickRawContent(body));
    if (!text) continue;

    const at = timestampToMs(firstString(body.timestamp, rec.timestamp));
    return { role, text, at };
  }
  return null;
}

/**
 * Extract token usage from a token-count/usage event, probing several
 * nestings and several key aliases. Returns null if none are present.
 * The last usage record found while scanning a file wins (assumed to be a
 * cumulative running total, per Codex's token_count events) — callers must
 * not sum multiple results together.
 * @param {Record<string, any>} rec  one parsed JSONL record, shape unknown
 * @returns {{inputTokens:number, outputTokens:number, cachedInputTokens:number}|null}
 */
export function extractUsage(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const body = rec.payload && typeof rec.payload === 'object' ? rec.payload : rec;

  const nestings = [
    body.info && body.info.total_token_usage,
    body.info && body.info.last_token_usage,
    body.info,
    body.usage,
    body.total_token_usage,
    body,
    rec,
  ];

  for (const c of nestings) {
    if (!c || typeof c !== 'object') continue;
    const inputTokens = firstNumber(c.input_tokens, c.inputTokens, c.prompt_tokens);
    const outputTokens = firstNumber(c.output_tokens, c.outputTokens, c.completion_tokens);
    const cachedInputTokens = firstNumber(
      c.cached_input_tokens,
      c.cachedInputTokens,
      c.cache_read_input_tokens,
      c.cache_creation_input_tokens,
    );
    if (inputTokens !== null || outputTokens !== null || cachedInputTokens !== null) {
      return {
        inputTokens: inputTokens || 0,
        outputTokens: outputTokens || 0,
        cachedInputTokens: cachedInputTokens || 0,
      };
    }
  }
  return null;
}

/**
 * Best-effort model name hint, from a turn_context record or any record
 * that happens to carry a `model` field.
 * @param {Record<string, any>} rec  one parsed JSONL record, shape unknown
 * @returns {string|null}
 */
export function extractModelHint(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const body = rec.payload && typeof rec.payload === 'object' ? rec.payload : rec;
  return firstString(body.model, rec.model);
}

/**
 * Truncate a title to `max` characters, collapsing whitespace, matching the
 * "first user prompt, truncated to 60 chars" rule for Codex titles.
 * @param {string} text
 * @param {number} [max]
 * @returns {string}
 */
export function truncateTitle(text, max = 60) {
  const t = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return '';
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}

/**
 * Recover a session id from a rollout filename when the meta record is
 * missing or unreadable. Codex rollout filenames look like
 * `rollout-<iso-timestamp>-<uuid>.jsonl`; we grab the trailing UUID if
 * present, else fall back to the filename minus its extension.
 * @param {string} filename
 * @returns {string}
 */
export function sessionIdFromFilename(filename) {
  const base = String(filename || '').replace(/\.jsonl$/i, '');
  const m = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return m ? m[1] : base;
}
