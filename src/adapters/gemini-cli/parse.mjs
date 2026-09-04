/**
 * Gemini CLI session-file parsing. WP-24.
 *
 * `docs/02-ARCHITECTURE.md` §2.1: "All parsing lives in one file per adapter so
 * a format break is a single-file fix." This file is that fix point for Gemini
 * CLI. Nothing outside `src/adapters/gemini-cli/` knows any of the field names
 * below (`docs/plan/08-PLAN-V2-100X.md` §1.1 rule 8).
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE — read this before changing anything here
 * ---------------------------------------------------------------------------
 *
 * **Gemini CLI is not installed on the reference machine.** `~/.gemini` does
 * not exist there; it was checked, read-only, on 4 September 2026 and was
 * absent. Nothing in this file has ever been run against real Gemini CLI data.
 * Every shape below was read out of the published source and documentation on
 * that date, and is a hypothesis until somebody runs it against a real profile
 * — `08` §1.1 rule 11. `docs/DEVIATIONS.md` §123 carries the same statement,
 * and the README's Honest limits says it to users.
 *
 * Read from `google-gemini/gemini-cli` `main`, 4 September 2026:
 *   - `packages/core/src/services/chatRecordingTypes.ts` — the record types
 *   - `packages/core/src/config/storage.ts` — the directory layout
 *   - `packages/core/src/config/projectRegistry.ts` — the project slug
 *   - `packages/core/src/core/logger.ts` — `logs.json` and `checkpoint-*.json`
 *   - `packages/cli/src/config/config.ts` — the resume/prompt flags
 *   https://github.com/google-gemini/gemini-cli
 *
 * Where the documentation and the source disagree, the source wins and the
 * disagreement is noted in place. There is one: the docs still describe the
 * per-project directory as `<project_hash>`, and the source has replaced the
 * hash with a slug. Both are handled — see `projectDirLooksLegacy`.
 *
 * ---------------------------------------------------------------------------
 * SHAPES THIS FILE HANDLES (update this list first when the format changes)
 * ---------------------------------------------------------------------------
 *
 * A session file is JSONL at
 *   `~/.gemini/tmp/<projectId>/chats/session-<timestamp>-<shortId>.jsonl`
 * and, for a junior spawned by another session,
 *   `~/.gemini/tmp/<projectId>/chats/<parentSessionId>/<sessionId>.jsonl`.
 *
 * 1. The metadata line (normally the first), a `PartialMetadataRecord`:
 *      { sessionId, projectHash, startTime, lastUpdated, summary?,
 *        directories?, kind?: 'main'|'subagent', memoryScratchpad? }
 *    `projectHash` keeps its name from the era when it held a hash; it now
 *    holds the project slug. It is NOT a working directory.
 *
 * 2. Message lines, a `MessageRecord` = `BaseMessageRecord & extra`:
 *      { id, timestamp, content, displayContent?, type }
 *    with `type: 'user'` (or 'info'|'error'|'warning', which are UI notices and
 *    are NOT conversation), or `type: 'gemini'` plus any of:
 *      { toolCalls?: ToolCallRecord[], thoughts?: [...], model?: string,
 *        tokens?: { input, output, cached, thoughts?, tool?, total } }
 *
 * 3. A metadata update line: `{ $set: { ...PartialMetadataRecord } }`
 *
 * 4. A rewind marker: `{ $rewindTo: <messageId> }`. Everything recorded after
 *    the message it names was undone in the UI. We do not replay rewinds — see
 *    `isRewind` and its note.
 *
 * 5. Message content is a `PartListUnion` from `@google/genai`:
 *      - a plain string
 *      - one part object: `{ text }`, or `{ functionCall }` / `{ inlineData }`
 *        / `{ functionResponse }`, which carry no readable text and are skipped
 *      - an array of either of the above
 *
 * 6. Two older generations that may still be on disk beside the above, both
 *    read by `parseCheckpoint`:
 *      - `checkpoint-<tag>.json` from `/chat save`: either a bare
 *        `Content[]` (the legacy form the CLI still branches on) or
 *        `{ history: Content[], authType? }`. A `Content` is
 *        `{ role: 'user'|'model', parts: [{text}] }`.
 *      - `logs.json`: `[{ sessionId, messageId, timestamp, type, message }]`,
 *        where `type` only ever takes the value `'user'` — it records prompts,
 *        never replies, so it can never carry a conversation and this adapter
 *        does not scan it.
 *
 * A line that fails `JSON.parse`, or an object matching none of the above, is
 * skipped rather than thrown (CONTRACTS.md rule 6).
 */

import { open, stat } from 'node:fs/promises';

/** Maximum bytes read from the start of a file (title / metadata discovery). */
export const HEAD_BYTES = 256 * 1024;

/** Maximum bytes read from the end of a file (recent state / usage). */
export const TAIL_BYTES = 2 * 1024 * 1024;

/** Prefix on an auto-recorded session file, from `SESSION_FILE_PREFIX`. */
export const SESSION_FILE_PREFIX = 'session-';

/**
 * `MessageRecord.type` values that are conversation. `info`, `error` and
 * `warning` are UI notices the CLI writes into the same stream; showing them
 * as if the model or the user had said them would be a lie about who spoke.
 * @type {Record<string, 'user'|'assistant'>}
 */
const MESSAGE_TYPE_ROLE = {
  user: 'user',
  gemini: 'assistant',
};

/**
 * `ToolCallRecord.status` spellings that mean the call has NOT finished.
 *
 * The enum's exact members were not read off the source, so this is a deny
 * list of the plausible in-flight spellings rather than an allow list of
 * terminal ones: an unknown status reads as finished, which at worst calls a
 * busy session idle for one poll. The opposite default would hide a finished
 * session from the review queue forever, and the queue is the product.
 */
const PENDING_TOOL_STATUS = new Set([
  'executing',
  'scheduled',
  'validating',
  'pending',
  'awaiting_approval',
  'awaiting-approval',
  'confirming',
  'in_progress',
]);

/**
 * Read up to `maxBytes` from the start of a file without loading the whole
 * thing. Documented contract: head <= 256 KB.
 *
 * Deliberately duplicated from the Codex adapter rather than shared. These
 * four helpers are the only generic code in an otherwise format-specific file,
 * and §2.1's promise — "a format break is a single-file fix" — is worth more
 * than sixty lines: a contributor adding a fifth runtime copies one file and
 * owns all of it, and no adapter can break another by touching a helper.
 * `docs/ADAPTERS.md` says so out loud, and `docs/DEVIATIONS.md` §123 records
 * it as a choice rather than an oversight.
 *
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
 * thing. Documented contract: tail <= 2 MB.
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
 * Split a chunk of file text into lines, optionally dropping a partial line at
 * either edge. A head read may cut the last line mid-object; a tail read that
 * did not start at byte 0 may cut the first.
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
 * Parse one JSONL line. Never throws; a corrupt line yields null so a scan can
 * skip it and keep going (CONTRACTS.md rule 6).
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
 * Parse every line of a text blob into records, dropping corrupt and
 * non-object lines. For small reads only — a head/tail chunk the caller has
 * already bounded, or a fixture. Never call it on a whole-file read.
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

/**
 * @param {unknown} ts an ISO-8601 string, per `BaseMessageRecord.timestamp`
 * @returns {number|null}
 */
export function timestampToMs(ts) {
  if (!ts || typeof ts !== 'string') return null;
  const t = Date.parse(ts);
  return Number.isFinite(t) ? t : null;
}

/**
 * Extract the session metadata carried by the first line, or by any later
 * `{$set: {...}}` update. Returns null when the record carries none of it.
 *
 * `projectHash` is passed through under the name the format gives it and is
 * NOT a working directory: it is the slug of the project directory's basename
 * (`projectRegistry.ts`), or, on a profile written by an older build, the
 * sha256 of the project's absolute path. The adapter resolves it to a real
 * path through `~/.gemini/projects.json`; see `reverseProjectRegistry`.
 *
 * @param {Record<string, any>} rec one parsed JSONL record, shape unknown
 * @returns {{sessionId:string|null, projectHash:string|null, startTime:number|null,
 *            lastUpdated:number|null, summary:string|null, kind:string|null,
 *            directories:string[]}|null}
 */
export function extractSessionMeta(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const body = rec.$set && typeof rec.$set === 'object' ? rec.$set : rec;
  // A message record carries `id`, never `sessionId`; refusing those here is
  // what keeps a conversation line from being read as metadata.
  if (typeof body.sessionId !== 'string' && typeof body.projectHash !== 'string') {
    if (typeof body.summary !== 'string') return null;
  }

  const directories = Array.isArray(body.directories)
    ? body.directories.filter((d) => typeof d === 'string' && d.length > 0)
    : [];

  return {
    sessionId: firstString(body.sessionId),
    projectHash: firstString(body.projectHash),
    startTime: timestampToMs(body.startTime),
    lastUpdated: timestampToMs(body.lastUpdated),
    summary: firstString(body.summary),
    kind: firstString(body.kind),
    directories,
  };
}

/**
 * Fold a later metadata record into an earlier one, field by field.
 *
 * `{$set: {...}}` is a **partial update, not a replacement**: the first line
 * carries the session id, and a `summary` may only arrive several turns later
 * in a record that carries nothing else. Merging with a plain object spread
 * would let that later record's absent `sessionId` overwrite the real one with
 * null, and a session with no id cannot be resumed, cannot be opened, and
 * cannot be told apart from the next one. So the merge is written out per
 * field, and it lives here rather than in the adapter because "which fields a
 * `$set` may partially update" is a fact about the format.
 *
 * @param {NonNullable<ReturnType<typeof extractSessionMeta>>} base
 * @param {NonNullable<ReturnType<typeof extractSessionMeta>>} next
 * @returns {NonNullable<ReturnType<typeof extractSessionMeta>>}
 */
export function mergeMeta(base, next) {
  return {
    sessionId: next.sessionId || base.sessionId,
    projectHash: next.projectHash || base.projectHash,
    startTime: next.startTime ?? base.startTime,
    lastUpdated: next.lastUpdated ?? base.lastUpdated,
    summary: next.summary || base.summary,
    kind: next.kind || base.kind,
    directories: next.directories.length ? next.directories : base.directories,
  };
}

/**
 * Is this line a rewind marker?
 *
 * `{$rewindTo: <messageId>}` says the user rewound the conversation, so the
 * records between that message and the marker were undone. We deliberately do
 * NOT replay it: doing so correctly needs the whole file, and this adapter
 * reads a bounded head and tail (`docs/02-ARCHITECTURE.md` §8). The cost of
 * ignoring it is that a rewound turn can still be the "last thing said" for
 * one scan. The cost of a full read is a scan budget, on every session, for
 * a case that is rare. Recognised so it is never mistaken for a message.
 * @param {Record<string, any>} rec
 * @returns {boolean}
 */
export function isRewind(rec) {
  return Boolean(rec && typeof rec === 'object' && rec.$rewindTo !== undefined);
}

/**
 * Normalise a `PartListUnion` into plain text. Non-text parts — function
 * calls, function responses, inline data — carry no readable text and are
 * skipped, so no `[tool: ...]` artefact can reach the panel.
 * @param {unknown} content
 * @returns {string}
 */
export function contentToText(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts = [];
    for (const part of content) {
      const text = contentToText(part);
      if (text) parts.push(text);
    }
    return parts.join('');
  }
  if (typeof content === 'object') {
    const part = /** @type {Record<string, any>} */ (content);
    if (typeof part.text === 'string') return part.text;
  }
  return '';
}

/**
 * Who spoke in this record, ignoring whether it carries any readable text.
 *
 * Separate from `extractMessage` on purpose, and the separation is load
 * bearing. A model turn whose content is nothing but a `functionCall` has no
 * text, so `extractMessage` correctly refuses it — showing it would put a
 * `[tool: ...]` artefact in the panel. But it is still the model taking a
 * turn, and if `turnEnded` were computed only from records with text, a
 * session whose newest record is a running tool call would be read as idle and
 * would join the review queue while it was still working. `digestRecords`
 * therefore tracks the last *turn* here and the last *message* there.
 *
 * @param {Record<string, any>} rec
 * @returns {'user'|'assistant'|null}
 */
export function turnRole(rec) {
  if (!rec || typeof rec !== 'object') return null;
  if (isRewind(rec) || rec.$set !== undefined) return null;
  return MESSAGE_TYPE_ROLE[rec.type] || null;
}

/**
 * Extract a text-only conversation message from a record. Returns null for
 * anything that is not a user or model turn: metadata, `$set`, `$rewindTo`,
 * and the `info` / `error` / `warning` UI notices are all excluded.
 *
 * `displayContent` is preferred when present — it is what the CLI actually
 * showed the human, and the panel is a review surface for a conversation, not
 * a trace of what was sent to the API.
 *
 * @param {Record<string, any>} rec one parsed JSONL record, shape unknown
 * @returns {{role:'user'|'assistant', text:string, at:number|null,
 *            model:string|null, pendingTool:boolean,
 *            tokens:{input:number, output:number, cached:number, total:number}|null}|null}
 */
export function extractMessage(rec) {
  if (!rec || typeof rec !== 'object') return null;
  if (isRewind(rec) || rec.$set !== undefined) return null;

  const role = MESSAGE_TYPE_ROLE[rec.type];
  if (!role) return null;

  const text = contentToText(rec.displayContent !== undefined ? rec.displayContent : rec.content);
  if (!text) return null;

  return {
    role,
    text,
    at: timestampToMs(rec.timestamp),
    model: firstString(rec.model),
    tokens: extractTokens(rec),
    pendingTool: hasPendingToolCall(rec),
  };
}

/**
 * Token usage recorded on one `gemini` message, as `TokensSummary`.
 * Returns null when the record carries none.
 * @param {Record<string, any>} rec
 * @returns {{input:number, output:number, cached:number, total:number}|null}
 */
export function extractTokens(rec) {
  if (!rec || typeof rec !== 'object') return null;
  const t = rec.tokens;
  if (!t || typeof t !== 'object') return null;
  /** @param {unknown} n */
  const num = (n) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : 0);
  const out = {
    input: num(t.input),
    output: num(t.output),
    cached: num(t.cached),
    total: num(t.total),
  };
  if (!out.input && !out.output && !out.cached && !out.total) return null;
  return out;
}

/**
 * Does this record carry a tool call that has not finished? Used only to keep
 * `turnEnded` honest — a model message that is still waiting on a tool is not
 * a turn that ended, it is a turn mid-flight.
 * @param {Record<string, any>} rec
 * @returns {boolean}
 */
export function hasPendingToolCall(rec) {
  if (!rec || typeof rec !== 'object' || !Array.isArray(rec.toolCalls)) return false;
  return rec.toolCalls.some(
    (call) =>
      call &&
      typeof call === 'object' &&
      typeof call.status === 'string' &&
      PENDING_TOOL_STATUS.has(call.status.toLowerCase()),
  );
}

/**
 * Roll a file's worth of message records up into the numbers a
 * `SessionSummary` needs.
 *
 * **The token arithmetic is a documented estimate, not a sum.** Gemini CLI
 * records `tokens` per model message, and its `input` is the whole prompt for
 * that turn — which contains the conversation so far. Adding those up would
 * count the same history once per turn and report a number several times too
 * large. So: `input` and `cached` take the LARGEST value seen (the widest
 * context the session reached), and `output` is SUMMED (each turn's output is
 * new text and is counted once). A `total` is used only when the parts are
 * missing.
 *
 * That is a hypothesis about the format's semantics, not a measurement, and it
 * is the first thing to check against a real profile. It is also bounded by
 * the tail window, which the README already states: token totals for very
 * large transcripts are approximate.
 *
 * @param {Record<string, any>[]} records parsed lines, in file order
 * @returns {{messages:Array<{role:'user'|'assistant', text:string, at:number|null}>,
 *            firstUserText:string, lastRole:'user'|'assistant'|null, lastText:string,
 *            lastAt:number|null, model:string|null, inputTokens:number,
 *            outputTokens:number, cachedTokens:number, turnEnded:boolean}}
 */
export function digestRecords(records) {
  const messages = [];
  let firstUserText = '';
  /** @type {'user'|'assistant'|null} */
  let lastRole = null;
  let lastText = '';
  /** @type {number|null} */
  let lastAt = null;
  /** @type {string|null} */
  let model = null;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedTokens = 0;
  let lastPendingTool = false;

  /** @type {'user'|'assistant'|null} */
  let lastTurnRole = null;

  for (const rec of records) {
    // Turn tracking runs over every user/model record, with or without text,
    // so a bare tool call still counts as the model holding the floor.
    const asTurn = turnRole(rec);
    if (asTurn) {
      lastTurnRole = asTurn;
      lastPendingTool = hasPendingToolCall(rec);
      const at = timestampToMs(rec.timestamp);
      if (at !== null) lastAt = at;
    }

    const msg = extractMessage(rec);
    if (!msg) continue;
    messages.push({ role: msg.role, text: msg.text, at: msg.at });
    if (!firstUserText && msg.role === 'user') firstUserText = msg.text;
    lastRole = msg.role;
    lastText = msg.text;
    if (msg.model) model = msg.model;
    if (msg.tokens) {
      inputTokens = Math.max(inputTokens, msg.tokens.input);
      cachedTokens = Math.max(cachedTokens, msg.tokens.cached);
      outputTokens += msg.tokens.output;
      if (!msg.tokens.input && !msg.tokens.output && msg.tokens.total) {
        inputTokens = Math.max(inputTokens, msg.tokens.total);
      }
    }
  }

  return {
    messages,
    firstUserText,
    lastRole,
    lastText,
    lastAt,
    model,
    inputTokens,
    outputTokens,
    cachedTokens,
    // The model took the last turn and is not waiting on a tool: idle, up for
    // review. Keyed off `lastTurnRole`, never off `lastRole` — see `turnRole`.
    turnEnded: lastTurnRole === 'assistant' && !lastPendingTool,
  };
}

/**
 * Recover a session id from a session filename. Auto-recorded files are named
 * `session-<timestamp>-<shortId>.jsonl`, and a junior's file is just
 * `<sessionId>.jsonl` inside a directory named for its parent. Used only when
 * the metadata line is missing or unreadable.
 * @param {string} filename
 * @returns {string}
 */
export function sessionIdFromFilename(filename) {
  return String(filename || '').replace(/\.jsonl$/i, '');
}

/**
 * Does this per-project directory name look like one written by a build from
 * before the hash became a slug?
 *
 * A legacy directory is 64 hex characters (sha256 of the project's absolute
 * path); a current one is a slug of the directory's basename, `[a-z0-9-]+`.
 * The distinction is not cosmetic: a slug can be looked up in
 * `~/.gemini/projects.json` to recover the real path, and a hash cannot be
 * reversed at all. A session under a legacy directory therefore reports its
 * cwd as unknown rather than guessing.
 * @param {string} name
 * @returns {boolean}
 */
export function projectDirLooksLegacy(name) {
  return /^[0-9a-f]{64}$/i.test(String(name || ''));
}

/**
 * Invert `~/.gemini/projects.json` — `{projects: {"<abs path>": "<slug>"}}` —
 * into slug → absolute path, which is the direction this adapter needs.
 *
 * A slug that maps to more than one path is dropped rather than guessed at.
 * The registry is supposed to make slugs unique with a numeric suffix, so a
 * duplicate means the file has been edited or merged between machines, and a
 * wrong cwd puts a session in the wrong room on the floor — which is worse
 * than an honest "unknown".
 * @param {unknown} parsed the parsed contents of projects.json
 * @returns {Map<string, string>}
 */
export function reverseProjectRegistry(parsed) {
  /** @type {Map<string, string>} */
  const out = new Map();
  /** @type {Set<string>} */
  const ambiguous = new Set();
  const projects =
    parsed && typeof parsed === 'object' && /** @type {any} */ (parsed).projects
      ? /** @type {any} */ (parsed).projects
      : null;
  if (!projects || typeof projects !== 'object') return out;

  for (const [absPath, slug] of Object.entries(projects)) {
    if (typeof slug !== 'string' || !slug || typeof absPath !== 'string' || !absPath) continue;
    if (out.has(slug) && out.get(slug) !== absPath) {
      ambiguous.add(slug);
      continue;
    }
    out.set(slug, absPath);
  }
  for (const slug of ambiguous) out.delete(slug);
  return out;
}

/**
 * Read a `/chat save` checkpoint, in either of the two shapes the CLI itself
 * branches on: a bare `Content[]`, or `{history: Content[]}`. A `Content` is
 * `{role: 'user'|'model', parts: [{text}]}`.
 *
 * Checkpoints are not scanned as sessions — they are named tags, not a
 * timeline, and they carry no session id, no timestamps and no usage. This
 * exists so the shape is documented and tested in the one file that owns the
 * format, ready for the day something wants to read one.
 * @param {unknown} parsed
 * @returns {Array<{role:'user'|'assistant', text:string}>}
 */
export function parseCheckpoint(parsed) {
  const history = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray(/** @type {any} */ (parsed).history)
      ? /** @type {any} */ (parsed).history
      : [];

  const out = [];
  for (const entry of history) {
    if (!entry || typeof entry !== 'object') continue;
    const role = entry.role === 'model' ? 'assistant' : entry.role === 'user' ? 'user' : null;
    if (!role) continue;
    const text = contentToText(entry.parts);
    if (!text) continue;
    out.push({ role, text });
  }
  return out;
}

/**
 * Truncate a title to `max` characters, collapsing whitespace. Same rule as
 * every other adapter: the first user prompt, cut to 60.
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
