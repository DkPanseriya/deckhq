/**
 * Codex CLI rollout-file parsing.
 *
 * docs/02-ARCHITECTURE.md §2.1: "All parsing lives in one file per adapter so a
 * format break is a single-file fix." This file is that fix point for Codex.
 *
 * Codex's on-disk session format is undocumented and has changed across CLI
 * versions, so everything below is still written defensively — try several key
 * aliases, never throw, fall back to null/empty, and ignore rather than reject
 * a line that matches nothing we recognise.
 *
 * **It is no longer written blind.** On 4 September 2026 (WP-23,
 * `docs/DEVIATIONS.md` §137, `docs/plan/CODEX-VERIFICATION.md` §6) this was
 * measured against real rollout journals written by codex-cli 0.153.1 — one
 * from the Codex desktop app, one from `codex exec` — on the reference Windows
 * machine. The shapes below marked MEASURED were read off those files. Three
 * assumptions in this file turned out to be wrong and are corrected here:
 * `originator` is a client name and never a path (§4 below), a rollout's first
 * `role: 'user'` record is usually injected context rather than anything the
 * user typed (§5), and `token_count`'s "total" is per-process rather than
 * per-thread, so a resumed session's totals halved (§7).
 *
 * ---------------------------------------------------------------------------
 * SHAPES THIS FILE HANDLES (update this list first when the format changes):
 * ---------------------------------------------------------------------------
 *
 * 1. Session meta record (normally the first line of a rollout file):
 *      { type: 'session_meta' | 'meta', payload: { id, session_id, timestamp,
 *        cwd, originator, cli_version, source, thread_source, model_provider,
 *        history_mode, context_window, ... } }
 *    or a flat, unwrapped variant with the same fields at the top level.
 *    MEASURED: 0.153.1 writes both `id` and `session_id`, equal, and equal to
 *    the uuid in the filename.
 *
 * 2. Wrapped event records:
 *      { type: 'response_item', payload: { type: 'message', role, content } }
 *      { type: 'event_msg',     payload: { type: 'token_count', info: {...} } }
 *      { type: 'event_msg',     payload: { type: 'agent_message', message } }
 *      { type: 'message',       payload: { role, content } }
 *      { type: 'turn_context',  payload: { cwd, model, ... } }  -- not a message
 *    MEASURED, and new in 0.153.1: `token_usage_record` (§7), `world_state`,
 *    and `event_msg` payload types `task_started`, `task_complete` (§9),
 *    `item_completed`, `thread_settings_applied`. Every record also carries a
 *    monotonic `ordinal`. None of these are conversation messages;
 *    `item_completed` in particular repeats a message that already has its own
 *    `response_item`, and reading it would double every turn.
 *
 * 3. Flat, unwrapped message records with no envelope:
 *      { role: 'user'|'assistant', content, timestamp }
 *
 * 4. `cwd` comes from `payload.cwd`, or `payload.workdir`, else the caller
 *    falls back to 'unknown'. **`originator` is NOT a fallback for it.**
 *    MEASURED: it is the name of the client that opened the session —
 *    `'Codex Desktop'` from the app, `'codex_exec'` from the CLI — so the
 *    fallback this file used to have would have put a session in a room called
 *    "Codex Desktop". `ADAPTERS.md`'s rule is `unknown` over a guess.
 *
 * 5. A rollout's user-role records are NOT all things the user typed.
 *    MEASURED: before the real prompt, 0.153.1 writes a `role: 'developer'`
 *    record (instructions, ~22 KB) and a `role: 'user'` record holding
 *    `<recommended_plugins>` and `<environment_context>` (~5 KB) — in both the
 *    desktop and the `codex exec` rollout. Taking "the first user message" as
 *    the title therefore produced `"<recommended_plugins> Here is a list of…"`
 *    on every session on the floor, and the conversation panel opened on the
 *    same blob.
 *    The discriminator is on the record itself:
 *      payload.internal_chat_message_metadata_passthrough.content_item_kinds
 *    which is `['user.text']` for a real prompt and names the injected content
 *    otherwise (`['plugins.recommendations','environments.environment_context']`,
 *    `['generic.developer_instructions', …]`). A user record that carries the
 *    field and does not claim `user.text` is not a message. A record without
 *    the field is unchanged — older rollouts do not have it.
 *
 * 6. Message content, in any of the above:
 *      - a plain string
 *      - an array of parts: { type: 'input_text'|'output_text'|'text', text }
 *        (other part types, e.g. images or tool payloads, are skipped)
 *      - a bare string under `message` instead of `content` (event_msg style)
 *
 * 6b. Non-message response items, explicitly excluded from conversation text
 *    (tool calls and reasoning are never surfaced — WP1/WP2 acceptance: "no
 *    [tool: ...] artefacts"):
 *      function_call, function_call_output, local_shell_call,
 *      local_shell_call_output, custom_tool_call, custom_tool_call_output,
 *      tool_call, tool_result, web_search_call, computer_call,
 *      computer_call_output, reasoning
 *
 * 7. Token usage, probed under several nestings and several key aliases:
 *      payload.thread_token_usage / payload.info.total_token_usage /
 *      payload.info.last_token_usage / payload.usage /
 *      payload.total_token_usage / payload itself / the record itself, each
 *      checked for:
 *        input_tokens | inputTokens | prompt_tokens
 *        output_tokens | outputTokens | completion_tokens
 *        cached_input_tokens | cachedInputTokens | cache_read_input_tokens |
 *        cache_creation_input_tokens
 *
 *    **Only one of those is cumulative, and it is not the one this file used
 *    to prefer.** MEASURED across a two-turn rollout:
 *      token_usage_record.turn_token_usage    turn 1: 12589 in   turn 2: 12603 in
 *      token_usage_record.usage               (the same as turn_token_usage)
 *      token_usage_record.thread_token_usage  turn 1: 12589 in   turn 2: 25192 in
 *      event_msg token_count info.total_token_usage    12589         12603
 *      event_msg token_count info.last_token_usage     12589         12603
 *    `total_token_usage` counts the *process*, so a session resumed by a fresh
 *    `codex exec` reports its newest turn as the total and the floor showed
 *    12621 tokens for a session that had spent 25231. `thread_token_usage` is
 *    the only field that counts the thread.
 *
 *    So {@link extractUsage} reports a `scope`, and the caller prefers the last
 *    `'thread'`-scoped reading over the last `'turn'`-scoped one rather than
 *    trusting file order. Nothing is ever summed: both are running totals of
 *    something, and adding them double-counts.
 *
 * 8. A model hint, probed on turn_context payloads (payload.model) and on any
 *    record carrying a top-level or payload-level `model` string. MEASURED:
 *    `turn_context.model` is the model that served the turn and can differ from
 *    `thread_settings_applied.thread_settings.model`, which is the one the
 *    thread asked for. The served model is the one worth reporting.
 *
 * 9. Turn boundaries. MEASURED: 0.153.1 brackets every turn with
 *    `event_msg/task_started` and `event_msg/task_complete`, the latter
 *    carrying `last_agent_message`. That is a real end-of-turn marker, which
 *    this format was previously assumed not to have — see {@link turnBoundary}.
 *
 * 10. The `codex exec --json` event stream is a DIFFERENT schema from the
 *    rollout file, and this file used to assume they were the same one.
 *    MEASURED, in full, from one `codex exec resume … --json` run:
 *      {"type":"thread.started","thread_id":"…"}
 *      {"type":"turn.started"}
 *      {"type":"item.completed","item":{"id":"item_0","type":"agent_message","text":"OK"}}
 *      {"type":"turn.completed","usage":{"input_tokens":…,"output_tokens":…}}
 *    and, on failure, `{"type":"item.completed","item":{"type":"error","message":…}}`,
 *    `{"type":"error","message":…}` and `{"type":"turn.failed","error":{"message":…}}`.
 *    Dotted type names, an `item` rather than a `payload`, and a flat `text`
 *    rather than a content-part array: none of the rollout extractors match any
 *    of it, so a `send()` that worked returned the whole raw JSONL as the
 *    assistant's reply. {@link extractExecEvent} is the reader for it.
 *
 * 11. A rollout journal Codex has COMPRESSED: the same JSONL, Zstandard-framed,
 *    named `rollout-<ISO>-<uuid>.jsonl.zst`. A background worker in the CLI
 *    rewrites an untouched journal (documented at roughly seven days), checks
 *    the copy decodes, and deletes the plain file — so this is not an archive
 *    format, it is the SAME session a week later. Read out of the installed
 *    `codex.exe` 0.153.1 rather than from a blog: the binary carries the
 *    literal `.jsonl.zst`, `rollout compression worker failed for`, and a
 *    metrics family `codex.rollout_compression.*`. `docs/DEVIATIONS.md` §136.2.
 *    Still not MEASURED: no rollout on the reference machine is old enough to
 *    have been compressed, so this stays the one shape here read from a binary
 *    rather than from a file.
 *
 * A line that fails JSON.parse, or an object that matches none of the above,
 * is simply skipped by the caller (see extractMessage/extractUsage/
 * extractSessionMeta all returning null) — never thrown.
 */

import { open, stat } from 'node:fs/promises';
import zlib from 'node:zlib';

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

// ---------------------------------------------------------------------------
// Compressed rollouts (§136.2)
// ---------------------------------------------------------------------------

/** What Codex names a rollout journal once its compression worker has been. */
export const COMPRESSED_SUFFIX = '.jsonl.zst';

/**
 * The largest compressed rollout this will open at all. Zstandard's ratio on
 * JSONL is comfortably better than 10:1, so 16 MB compressed is a very large
 * session — and the bound exists so that a file which is not what its name
 * says cannot be read into memory whole before anything notices.
 */
export const MAX_COMPRESSED_BYTES = 16 * 1024 * 1024;

/**
 * And the largest thing it will decompress TO. A decompression bomb is the
 * one hazard a plain read does not have: the bounded reads elsewhere in this
 * file are bounded because the caller says how many bytes to take, and a
 * `.zst` decides that for itself unless it is told otherwise. `zlib` enforces
 * this by refusing rather than by truncating, which is the right way round —
 * a half-decoded JSONL would be silently wrong, and a refusal is countable.
 */
export const MAX_DECOMPRESSED_BYTES = 64 * 1024 * 1024;

/** @param {string} name @returns {boolean} */
export function isCompressedRollout(name) {
  return String(name).toLowerCase().endsWith(COMPRESSED_SUFFIX);
}

/**
 * Can this Node decompress Zstandard?
 *
 * `zlib.zstdDecompressSync` arrived in Node 22.15 / 23.8. This package's floor
 * is Node 18 (`package.json` `engines`, `docs/DEVIATIONS.md` §130) and
 * `08-PLAN-V2-100X.md` §1.1 rule 3 forbids taking a dependency to fill the
 * gap, so the answer is a capability check and two behaviours, not a version
 * comparison: a runtime that has it reads compressed rollouts, one that does
 * not counts them and says so. Injectable so both branches are exercised from
 * one test run on one machine.
 * @param {{zstdDecompressSync?: unknown}} [z]
 * @returns {boolean}
 */
export function hasZstd(z = zlib) {
  return typeof z?.zstdDecompressSync === 'function';
}

/**
 * The whole of a compressed rollout, as bytes, or null when it cannot be read
 * — no zstd on this Node, a file bigger than the bound, a frame that does not
 * decode, or an output past {@link MAX_DECOMPRESSED_BYTES}. Never throws: the
 * caller counts a null and carries on, exactly as it does for a corrupt line.
 *
 * Compressed rollouts are the OLD ones by construction, so this is a cold
 * path: a session is compressed only after about a week untouched.
 *
 * @param {string} filePath
 * @param {{zlib?: any, maxCompressedBytes?: number, maxDecompressedBytes?: number}} [opts]
 * @returns {Promise<{buf: Buffer, compressedSize: number}|null>}
 */
export async function readCompressed(filePath, opts = {}) {
  const z = opts.zlib || zlib;
  if (!hasZstd(z)) return null;
  const maxIn = opts.maxCompressedBytes ?? MAX_COMPRESSED_BYTES;
  const maxOut = opts.maxDecompressedBytes ?? MAX_DECOMPRESSED_BYTES;

  let size;
  try {
    size = (await stat(filePath)).size;
  } catch {
    return null;
  }
  if (size === 0 || size > maxIn) return null;

  let raw;
  const fh = await open(filePath, 'r');
  try {
    raw = Buffer.alloc(size);
    await fh.read(raw, 0, size, 0);
  } catch {
    return null;
  } finally {
    await fh.close();
  }

  try {
    return { buf: z.zstdDecompressSync(raw, { maxOutputLength: maxOut }), compressedSize: size };
  } catch {
    return null;
  }
}

/**
 * `readHead` for either kind of rollout: the plain seek when the file is
 * `.jsonl`, and the same slice of the decoded bytes when it is `.jsonl.zst`.
 *
 * The head/tail discipline is identical either way — the same bound, the same
 * `truncated` flag, so the caller's partial-line handling does not change and
 * a compressed session is summarised from exactly the records a plain one
 * would be.
 * @param {string} filePath
 * @param {number} [maxBytes]
 * @param {{zlib?: any, maxCompressedBytes?: number, maxDecompressedBytes?: number}} [opts]
 * @returns {Promise<{text:string, truncated:boolean, size:number}>}
 */
export async function readRolloutHead(filePath, maxBytes = HEAD_BYTES, opts = {}) {
  if (!isCompressedRollout(filePath)) return readHead(filePath, maxBytes);
  const got = await readCompressed(filePath, opts);
  if (!got) return { text: '', truncated: false, size: 0 };
  const len = Math.min(got.buf.length, maxBytes);
  return {
    text: got.buf.subarray(0, len).toString('utf8'),
    truncated: got.buf.length > maxBytes,
    size: got.buf.length,
  };
}

/**
 * `readTail` for either kind of rollout. See {@link readRolloutHead}.
 * @param {string} filePath
 * @param {number} [maxBytes]
 * @param {{zlib?: any, maxCompressedBytes?: number, maxDecompressedBytes?: number}} [opts]
 * @returns {Promise<{text:string, truncated:boolean, size:number}>}
 */
export async function readRolloutTail(filePath, maxBytes = TAIL_BYTES, opts = {}) {
  if (!isCompressedRollout(filePath)) return readTail(filePath, maxBytes);
  const got = await readCompressed(filePath, opts);
  if (!got) return { text: '', truncated: false, size: 0 };
  const start = Math.max(0, got.buf.length - maxBytes);
  return {
    text: got.buf.subarray(start).toString('utf8'),
    truncated: start > 0,
    size: got.buf.length,
  };
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
  // cwd, then workdir. `originator` used to sit between them and must not:
  // MEASURED on 0.153.1, it is the client's name ('Codex Desktop', 'codex_exec'),
  // so the fallback named a room after a program. Shape list §4.
  const cwd = firstString(body.cwd, body.workdir);
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
 * The kind a real, typed user prompt claims for itself. Shape list §5.
 */
const USER_TEXT_KIND = 'user.text';

/**
 * Is this user-role record context Codex injected rather than something the
 * user typed? Shape list §5.
 *
 * The test is deliberately narrow, because a false positive silently deletes
 * somebody's message from their own conversation:
 *
 *   - it applies to `role: 'user'` records only — an assistant record declares
 *     `content_item_kinds: ['unknown']` and must never be touched by this;
 *   - it fires only when the field is PRESENT and does not claim `user.text`,
 *     so every rollout written before 0.153.1 added the field behaves exactly
 *     as it did before;
 *   - it reads the declaration rather than sniffing the text for `<xml>`-ish
 *     openings, which would eventually eat a message about XML.
 *
 * @param {Record<string, any>} body a message-shaped record body
 * @returns {boolean}
 */
export function isInjectedUserContext(body) {
  if (!body || typeof body !== 'object') return false;
  if (body.role !== 'user') return false;
  const meta = body.internal_chat_message_metadata_passthrough;
  if (!meta || typeof meta !== 'object') return false;
  const kinds = meta.content_item_kinds;
  if (!Array.isArray(kinds) || kinds.length === 0) return false;
  return !kinds.includes(USER_TEXT_KIND);
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
    if (isInjectedUserContext(body)) return null;

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
 *
 * `scope` says what the numbers count, and it is the whole point of this
 * function's return shape (shape list §7):
 *
 *   - `'thread'` — `thread_token_usage`, the running total for the whole
 *     conversation. The only field MEASURED to survive a resume.
 *   - `'turn'` — everything else, including `info.total_token_usage`, whose
 *     name promises more than it delivers: it totals the CLI process, so a
 *     resumed session's "total" is just its newest turn.
 *
 * Nothing here is ever summed by a caller: both are running totals, and adding
 * two running totals double-counts.
 * @param {Record<string, any>} rec  one parsed JSONL record, shape unknown
 * @returns {{inputTokens:number, outputTokens:number, cachedInputTokens:number,
 *            scope:'thread'|'turn'}|null}
 */
export function extractUsage(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const body = rec.payload && typeof rec.payload === 'object' ? rec.payload : rec;

  const nestings = [
    { at: body.thread_token_usage, scope: /** @type {const} */ ('thread') },
    { at: body.info && body.info.thread_token_usage, scope: /** @type {const} */ ('thread') },
    { at: body.info && body.info.total_token_usage, scope: /** @type {const} */ ('turn') },
    { at: body.info && body.info.last_token_usage, scope: /** @type {const} */ ('turn') },
    { at: body.info, scope: /** @type {const} */ ('turn') },
    { at: body.usage, scope: /** @type {const} */ ('turn') },
    { at: body.total_token_usage, scope: /** @type {const} */ ('turn') },
    { at: body, scope: /** @type {const} */ ('turn') },
    { at: rec, scope: /** @type {const} */ ('turn') },
  ];

  for (const { at: c, scope } of nestings) {
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
        scope,
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
 *
 * `.jsonl.zst` is stripped too (§136.2 taught the walker to accept compressed
 * journals but left this regex anchored on `.jsonl`, so the uuid was no longer
 * at the end of the string and a compressed session fell back to its whole
 * filename as an id).
 * @param {string} filename
 * @returns {string}
 */
export function sessionIdFromFilename(filename) {
  const base = String(filename || '').replace(/\.jsonl(\.zst)?$/i, '');
  const m = base.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i);
  return m ? m[1] : base;
}

/**
 * Where a record sits relative to a turn: `'started'` for the record that
 * opens one, `'ended'` for the record that closes it, null for everything
 * else. Shape list §9.
 *
 * This exists because the assumption it replaces was wrong. `turnEnded` used
 * to be "the assistant spoke last", which is a guess that reads a session as
 * finished for the whole time it is running a tool after its last sentence.
 * MEASURED on 0.153.1, a rollout brackets every turn explicitly, so the state
 * is readable rather than inferable.
 * @param {Record<string, any>} rec  one parsed JSONL record, shape unknown
 * @returns {'started'|'ended'|null}
 */
export function turnBoundary(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const body = rec.payload && typeof rec.payload === 'object' ? rec.payload : rec;
  const t = body.type;
  if (t === 'task_started' || t === 'turn.started') return 'started';
  if (t === 'task_complete' || t === 'turn.completed' || t === 'turn.failed') return 'ended';
  return null;
}

/**
 * Read one event out of a `codex exec --json` stream. Shape list §10 — a
 * different schema from the rollout file, which is why this is a different
 * function rather than another alias in {@link extractMessage}.
 *
 * Returns the assistant's text for a completed `agent_message` item, and the
 * message for an error item or a failed turn, so a caller can tell "Codex said
 * this" from "Codex could not". Null for the events that carry neither.
 * @param {Record<string, any>} rec  one parsed event, shape unknown
 * @returns {{kind:'assistant'|'error', text:string}|null}
 */
export function extractExecEvent(rec) {
  if (!rec || typeof rec !== 'object') return null;

  if (rec.type === 'item.completed' || rec.type === 'item.updated') {
    const item = rec.item;
    if (!item || typeof item !== 'object') return null;
    const text = typeof item.text === 'string' ? item.text : contentToText(item.content);
    if (item.type === 'agent_message') return text ? { kind: 'assistant', text } : null;
    if (item.type === 'error') {
      const message = firstString(item.message, text);
      return message ? { kind: 'error', text: message } : null;
    }
    return null;
  }

  if (rec.type === 'error') {
    const message = firstString(rec.message);
    return message ? { kind: 'error', text: message } : null;
  }

  if (rec.type === 'turn.failed') {
    const message = firstString(rec.error && rec.error.message, rec.message);
    return message ? { kind: 'error', text: message } : null;
  }

  return null;
}
