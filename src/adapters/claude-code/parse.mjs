/**
 * Claude Code transcript parsing.
 *
 * docs/02-ARCHITECTURE.md §2.1: "All parsing lives in one file per adapter so a
 * format break is a single-file fix." This file is that fix point for Claude
 * Code. Nothing outside src/adapters/ may read a transcript file directly.
 *
 * Transcripts live at `~/.claude/projects/<mangled-cwd>/<sessionId>.jsonl`, one
 * JSON object per line, and reach 74 MB on this machine. We never read a whole
 * file: `readHead` takes a bounded slice from the start (title records appear
 * early), `readTail` takes a bounded slice from the end (recent state, token
 * usage, the freshest custom-title).
 *
 * Real-data notes verified against sessions on this machine (see CONTRACTS.md):
 *  - `{"type":"custom-title","customTitle":"…"}` is appended repeatedly through
 *    the file; the LAST physical occurrence is the one that should win.
 *  - `user`/`assistant` records carry `timestamp` (ISO), `cwd`, `gitBranch`,
 *    `isSidechain`, `message`. `message.content` may be a plain string or an
 *    array of blocks (`text`, `thinking`, `tool_use`, `tool_result`, …).
 *  - A single logical assistant turn is frequently split across *several*
 *    JSONL lines — one per content block — and every one of those lines
 *    repeats the identical `usage` object for that turn (verified up to 4x on
 *    a real 74 MB transcript here). Summing `usage` per line overcounts
 *    tokens; see the dedup-by-`message.id` comment in `parseSummary` below.
 *
 * Every entry point here is defensive: a corrupt or truncated line is skipped,
 * never thrown (CONTRACTS.md rule 6).
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { clampText } from '../../core/model.mjs';
import { estimateCost } from '../../core/rates.mjs';

/** Root of Claude Code's per-machine config. Overridable for tests/tooling. */
export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');

/** Where every project's session transcripts live, one subdir per cwd. */
export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

/** Bounded head read: title records appear near the start of the file. */
export const HEAD_BYTES = 256 * 1024;

/** Bounded tail read: recent state, token usage, the freshest custom-title. */
export const TAIL_BYTES = 2 * 1024 * 1024;

/**
 * Read up to `maxBytes` from the start of a file via a bounded stream read.
 * Never loads more than `maxBytes` into memory regardless of file size.
 * Never throws: a missing/unreadable file resolves to ''.
 * @param {string} file
 * @param {number} [maxBytes]
 * @returns {Promise<string>}
 */
export function readHead(file, maxBytes = HEAD_BYTES) {
  return new Promise((resolve) => {
    const chunks = [];
    let total = 0;
    let stream;
    try {
      stream = fs.createReadStream(file, { start: 0, end: Math.max(0, maxBytes - 1) });
    } catch {
      resolve('');
      return;
    }
    stream.on('data', (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
    });
    stream.on('end', () => resolve(Buffer.concat(chunks, total).toString('utf8')));
    stream.on('error', () => resolve(''));
  });
}

/**
 * Read up to `maxBytes` from the end of a file via a bounded stream read.
 * When the read did not start at byte 0 (the file is larger than the
 * window), the first line is necessarily a partial record and is discarded.
 * Never throws: a missing/unreadable file resolves to ''.
 * @param {string} file
 * @param {number} [maxBytes]
 * @returns {Promise<string>}
 */
export function readTail(file, maxBytes = TAIL_BYTES) {
  return new Promise((resolve) => {
    let size;
    try {
      size = fs.statSync(file).size;
    } catch {
      resolve('');
      return;
    }
    const start = Math.max(0, size - maxBytes);
    const chunks = [];
    let total = 0;
    let stream;
    try {
      stream = fs.createReadStream(file, { start, end: Math.max(start, size - 1) });
    } catch {
      resolve('');
      return;
    }
    stream.on('data', (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
    });
    stream.on('end', () => {
      let text = Buffer.concat(chunks, total).toString('utf8');
      if (start > 0) {
        // The read began mid-file: the first line is a partial record.
        const nl = text.indexOf('\n');
        text = nl === -1 ? '' : text.slice(nl + 1);
      }
      resolve(text);
    });
    stream.on('error', () => resolve(''));
  });
}

/**
 * Parse a bounded chunk of a transcript into records, one JSON object per
 * line. A line that fails to parse (corrupt, or a partial record cut off at
 * a head/tail boundary) is silently skipped, never thrown.
 * @param {string} text
 * @returns {Generator<any>}
 */
function* jsonLines(text) {
  if (!text) return;
  const lines = text.split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    try {
      const rec = JSON.parse(line);
      if (rec && typeof rec === 'object') yield rec;
    } catch {
      // Corrupt or partial line. Skip it and keep going.
    }
  }
}

/**
 * Flatten a user/assistant message's `content` field to plain prose. Only
 * `text` blocks are kept — `thinking`, `tool_use`, `tool_result` and any
 * other block type are dropped entirely, per docs/04-BUILD-PLAN.md WP1: the
 * panel is a conversation, not a trace of what the model did to answer it.
 * `content` may be a plain string or an array of blocks.
 * @param {unknown} content
 * @returns {string}
 */
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (
      block &&
      typeof block === 'object' &&
      block.type === 'text' &&
      typeof block.text === 'string'
    ) {
      parts.push(block.text);
    }
  }
  return parts.join('\n\n');
}

// Synthetic wrapper tags Claude Code injects for local slash-commands and
// system reminders. These are harness plumbing, not conversation — strip
// them out; if nothing real is left, the whole message is dropped.
// `<command-args>` is not explicitly named in the interface spec but is
// always emitted alongside `<command-name>`/`<command-message>` for slash
// commands with arguments (verified on real transcripts, e.g. `/model`); it
// is stripped too so a bare command invocation collapses to nothing rather
// than leaking its argument text into the panel.
const WRAPPER_RE =
  /<system-reminder>[\s\S]*?<\/system-reminder>|<command-message>[\s\S]*?<\/command-message>|<command-name>[\s\S]*?<\/command-name>|<command-args>[\s\S]*?<\/command-args>|<local-command-stdout>[\s\S]*?<\/local-command-stdout>/g;

/** @param {string} text */
function stripWrappers(text) {
  return text.replace(WRAPPER_RE, '').trim();
}

/**
 * The LAST `custom-title` record's `customTitle`, or null if none is present
 * in this chunk. Physical file order (not timestamp) decides "last" — these
 * records carry no timestamp of their own and are simply re-appended.
 * @param {string} text
 * @returns {string|null}
 */
function lastCustomTitle(text) {
  let found = null;
  for (const rec of jsonLines(text)) {
    if (rec.type === 'custom-title' && typeof rec.customTitle === 'string' && rec.customTitle) {
      found = rec.customTitle;
    }
  }
  return found;
}

/**
 * First record across the given chunks (searched in order) matching `pred`.
 * @param {string[]} texts
 * @param {(rec:any) => boolean} pred
 * @returns {any|null}
 */
function findFirst(texts, pred) {
  for (const text of texts) {
    for (const rec of jsonLines(text)) {
      let ok = false;
      try {
        ok = Boolean(pred(rec));
      } catch {
        ok = false;
      }
      if (ok) return rec;
    }
  }
  return null;
}

/** @param {string} s */
function truncateTitle(s) {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > 60 ? t.slice(0, 59) + '…' : t;
}

/**
 * Summarise one session from bounded head/tail reads.
 *
 * For files larger than the combined head+tail window this is necessarily an
 * approximation: token totals only reflect the assistant turns visible in
 * the bounded slices, not the whole file. We deliberately do NOT scale the
 * total by (fileSize / bytesRead) to estimate the untouched middle of the
 * file — token density varies wildly across a conversation (a single research
 * turn can dwarf fifty short replies), so a byte-fraction extrapolation would
 * fabricate a number with no honest basis. We say so here instead.
 *
 * @param {string} headText
 * @param {string} tailText
 * @param {{id:string, file?:string, mtimeMs:number, sidechain?:boolean}} meta
 *   `sidechain` (WP-41): this file IS a subagent transcript, so every record in
 *   it carries `isSidechain: true` and the usual "sidechain turns are not what
 *   the session said" filter would leave the summary blank. Set it only for a
 *   file found under a `subagents/` directory; a primary transcript must keep
 *   the filter, because there the sidechain records belong to somebody else.
 * @returns {import('../../core/model.mjs').SessionSummary}
 */
export function parseSummary(headText, tailText, { id, mtimeMs, sidechain = false }) {
  // In a subagent transcript every record is the subagent's own speech; in a
  // primary one a sidechain record belongs to a junior and must not win "what
  // did this session last say".
  const primary = sidechain
    ? /** @param {any} _r */ (_r) => true
    : /** @param {any} r */ (r) => r.isSidechain !== true;
  let cwd = null;
  let cwdTs = -Infinity;
  let gitBranch = null;
  let gitBranchTs = -Infinity;
  let model = null;
  let modelTs = -Infinity;
  let newestTs = -Infinity;

  let lastRole = null;
  let lastText = '';
  let lastTextTs = -Infinity;

  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let cacheWriteTokens = 0;
  // Spans both the head and tail scan: a small file's head and tail windows
  // can overlap completely (both reads return the whole file), and a single
  // turn's usage can appear on more than one line within a single window
  // (see file header comment). Dedup by message id so each turn's usage is
  // ever added exactly once regardless of how many times we see it.
  const seenAssistantMsgIds = new Set();

  const scan = (text) => {
    for (const rec of jsonLines(text)) {
      const ts = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
      const hasTs = Number.isFinite(ts);
      if (hasTs && ts > newestTs) newestTs = ts;

      if (hasTs && typeof rec.cwd === 'string' && rec.cwd && ts >= cwdTs) {
        cwd = rec.cwd;
        cwdTs = ts;
      }
      if (hasTs && typeof rec.gitBranch === 'string' && rec.gitBranch && ts >= gitBranchTs) {
        gitBranch = rec.gitBranch;
        gitBranchTs = ts;
      }

      if (rec.type === 'assistant' && rec.message && typeof rec.message === 'object') {
        const msgModel = typeof rec.message.model === 'string' ? rec.message.model : null;
        if (hasTs && msgModel && ts >= modelTs) {
          model = msgModel;
          modelTs = ts;
        }

        const usage = rec.message.usage;
        const msgId = typeof rec.message.id === 'string' ? rec.message.id : null;
        if (usage && typeof usage === 'object' && (!msgId || !seenAssistantMsgIds.has(msgId))) {
          if (msgId) seenAssistantMsgIds.add(msgId);
          inputTokens += Number(usage.input_tokens) || 0;
          outputTokens += Number(usage.output_tokens) || 0;
          cacheReadTokens += Number(usage.cache_read_input_tokens) || 0;
          cacheWriteTokens += Number(usage.cache_creation_input_tokens) || 0;
        }

        // Subagent traffic still counts toward token spend, but never wins
        // "what did the session last say" — that's the primary thread only.
        if (primary(rec)) {
          const t = contentToText(rec.message.content);
          if (t && hasTs && ts >= lastTextTs) {
            lastRole = 'assistant';
            lastText = t;
            lastTextTs = ts;
          }
        }
      } else if (rec.type === 'user' && rec.message && typeof rec.message === 'object') {
        if (primary(rec)) {
          const t = contentToText(rec.message.content);
          if (t && hasTs && ts >= lastTextTs) {
            lastRole = 'user';
            lastText = t;
            lastTextTs = ts;
          }
        }
      }
    }
  };

  scan(headText);
  scan(tailText);

  // Title: the LAST custom-title record wins — it is appended repeatedly
  // through the file. Search the tail first (nearer the end of the file, so
  // more likely to hold the freshest one), then fall back to the head.
  let title = lastCustomTitle(tailText);
  if (title == null) title = lastCustomTitle(headText);
  const hasCustomTitle = title != null;

  if (title == null) {
    const promptRec = findFirst(
      [headText, tailText],
      (r) => r.type === 'last-prompt' && typeof r.lastPrompt === 'string' && r.lastPrompt,
    );
    if (promptRec) {
      title = truncateTitle(promptRec.lastPrompt);
    } else {
      const userRec = findFirst(
        [headText, tailText],
        (r) => r.type === 'user' && primary(r) && r.message && typeof r.message === 'object',
      );
      const text = userRec ? contentToText(userRec.message.content) : '';
      title = text ? truncateTitle(text) : String(id).slice(0, 8);
    }
  }

  const lastActivityAt = Number.isFinite(newestTs) ? newestTs : mtimeMs;

  return {
    id,
    runtime: 'claude-code',
    title,
    hasCustomTitle,
    cwd: cwd || '',
    gitBranch,
    model,
    lastActivityAt,
    tokens: inputTokens + outputTokens,
    cacheTokens: cacheReadTokens + cacheWriteTokens,
    costEstimate: estimateCost({
      input: inputTokens,
      output: outputTokens,
      cacheRead: cacheReadTokens,
      cacheWrite: cacheWriteTokens,
      model,
    }),
    lastRole,
    lastText: clampText(lastText),
    turnEnded: turnHasEnded(tailText, sidechain),
  };
}

/**
 * Has the session's turn actually ENDED — is it idle, waiting on the user?
 *
 * This is the question `placement()` really asks, and `lastRole` cannot
 * answer it. An assistant turn that calls a tool narrates first ("Let me
 * check X") and emits the `tool_use` in the same message; the `tool_result`
 * comes back as a `user` record carrying no text block. Since `contentToText`
 * reads only `text` blocks, that narration stays the last text in the file
 * for the whole tool call, so "assistant spoke last" is true throughout. Busy
 * agents were being sent to the manager's office on the strength of it.
 *
 * Asking "is a tool open" is also not enough: between a `tool_result` and the
 * next assistant message no call is outstanding, yet the model is mid-turn.
 *
 * So look at the last real record in the file and let its SHAPE answer:
 *
 *   - assistant, text, no `tool_use`  -> the turn ended. Up for review.
 *   - assistant with a `tool_use`     -> a tool is running.
 *   - user (`tool_result` or a prompt) -> the model is generating.
 *
 * Scanned backwards from the end, so it costs one record in the normal case
 * and a torn final line just falls through to the record before it. The tail
 * is a bounded read, which is fine: only the end of the file can say what is
 * happening now.
 *
 * @param {string} tailText
 * @param {boolean} [sidechain] the file is a subagent transcript, so its
 *   `isSidechain` records ARE the conversation. See `parseSummary`.
 * @returns {boolean}
 */
function turnHasEnded(tailText, sidechain = false) {
  const lines = tailText.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line || line.charCodeAt(0) !== 123 /* { */) continue;

    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue; // torn or partial line; the record before it still counts
    }
    if (!rec || (!sidechain && rec.isSidechain === true)) continue;
    if (rec.type !== 'assistant' && rec.type !== 'user') continue;
    const msg = rec.message;
    if (!msg || typeof msg !== 'object') continue;

    // A user record — a tool result, or a fresh prompt — means the model is
    // mid-turn either way.
    if (rec.type === 'user') return false;

    // `stop_reason` settles it outright when present, and it is the only
    // signal that survives block splitting. A logical assistant turn is
    // written as SEVERAL lines, one per content block ("text", then
    // "tool_use"), so for a moment the newest line is a text block with no
    // tool call beside it yet — which looks exactly like a finished turn.
    // Every line of a tool-calling turn already carries
    // `stop_reason: "tool_use"`, including that text line, so reading it
    // closes the window instead of leaving a poll free to catch it.
    // Verified on this machine: 158 "tool_use" against 20 "end_turn".
    const stop = msg.stop_reason;
    if (typeof stop === 'string') return stop !== 'tool_use';

    const content = msg.content;
    if (typeof content === 'string') return content.trim().length > 0;
    if (!Array.isArray(content)) continue;

    let hasToolUse = false;
    let hasText = false;
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'tool_use') hasToolUse = true;
      else if (block.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        hasText = true;
      }
    }
    if (hasToolUse) return false; // a call is outstanding
    return hasText; // text and nothing else: the turn is over
  }
  return false; // nothing to go on: assume busy rather than invent a review
}

/**
 * Full message list for one session's bounded tail read, oldest first.
 * Text blocks only: `thinking`, `tool_use` and `tool_result` blocks are
 * excluded entirely, subagent (`isSidechain`) turns are excluded, and
 * harness wrapper text (`<system-reminder>`, `<command-name>`,
 * `<command-message>`, `<command-args>`, `<local-command-stdout>`) is
 * stripped; a message left empty after stripping is dropped.
 * @param {string} text
 * @param {{maxMessages?:number, sidechain?:boolean}} [opts] `sidechain`
 *   (WP-41): this text came from a subagent transcript, where every record is
 *   flagged `isSidechain` and dropping them would leave the panel empty.
 * @returns {import('../../core/model.mjs').Message[]}
 */
export function parseConversation(text, { maxMessages = 200, sidechain = false } = {}) {
  const out = [];
  for (const rec of jsonLines(text)) {
    if (rec.type !== 'user' && rec.type !== 'assistant') continue;
    if (!sidechain && rec.isSidechain === true) continue;
    if (!rec.message || typeof rec.message !== 'object') continue;

    const raw = contentToText(rec.message.content);
    const cleaned = stripWrappers(raw);
    if (!cleaned) continue;

    const ts = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
    out.push({
      role: rec.type,
      text: cleaned,
      at: Number.isFinite(ts) ? ts : 0,
    });
  }
  return maxMessages > 0 && out.length > maxMessages ? out.slice(out.length - maxMessages) : out;
}

// --------------------------------------------------------- subagents (WP-41)

/**
 * The directory Claude Code writes subagent transcripts into, inside a
 * session's own directory. Verified on this machine (2.1.222 – 2.1.231):
 *
 *   ~/.claude/projects/<projectDir>/<parentSessionId>/subagents/agent-<id>.jsonl
 *   ~/.claude/projects/<projectDir>/<parentSessionId>/subagents/agent-<id>.meta.json
 *
 * Workflow subagents nest one level deeper under `workflows/wf_<id>/`, with a
 * `journal.jsonl` beside them that is the workflow's own log and NOT a
 * subagent. Full measurements: `docs/DEVIATIONS.md` §120.
 */
export const SUBAGENT_DIR = 'subagents';

/** Filenames in a `subagents/` directory that are transcripts, and their id. */
const SUBAGENT_FILE_RE = /^agent-([A-Za-z0-9_-]+)\.jsonl$/;

/** How deep below `subagents/` a transcript may be. `workflows/wf_x/a.jsonl` is 2. */
export const SUBAGENT_MAX_DEPTH = 2;

/**
 * The subagent id a transcript filename names, or null when the file is not a
 * subagent transcript at all (`journal.jsonl` is the case that matters).
 * @param {string} basename
 * @returns {string|null}
 */
export function subagentIdFromFile(basename) {
  const m = SUBAGENT_FILE_RE.exec(String(basename || ''));
  return m ? m[1] : null;
}

/** The sidecar metadata filename for a subagent transcript. @param {string} basename */
export function subagentMetaFile(basename) {
  return String(basename).replace(/\.jsonl$/, '.meta.json');
}

/**
 * @typedef {object} SubagentMeta
 * @property {string|null} agentType    e.g. `general-purpose`, `Explore`,
 *   `workflow-subagent`, or a user's own agent name
 * @property {string|null} description  the Task call's short description
 * @property {string|null} model
 * @property {string|null} toolUseId    the parent's `Task` tool_use id
 * @property {number|null} spawnDepth   1 for a subagent of the session itself
 * @property {string|null} parentAgentId set when a subagent spawned this one
 */

/**
 * Parse an `agent-<id>.meta.json` sidecar. Never throws: a missing, empty or
 * corrupt file gives an all-null record, which is exactly what a junior with
 * no metadata should look like.
 *
 * Key shapes measured across 987 sidecars on this machine:
 * 607 `agentType,spawnDepth`; 239 `agentType` alone;
 * 50 `agentType,description,spawnDepth,toolUseId`; 38 of those also with
 * `model`; 34 also with `spawnedWithWorktree,worktreeBranch,worktreePath`;
 * 4 with `parentAgentId`. Nothing is required, so nothing here is.
 *
 * @param {string} text
 * @returns {SubagentMeta}
 */
export function parseSubagentMeta(text) {
  /** @type {SubagentMeta} */
  const empty = {
    agentType: null,
    description: null,
    model: null,
    toolUseId: null,
    spawnDepth: null,
    parentAgentId: null,
  };
  if (!text) return empty;
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    return empty;
  }
  if (!j || typeof j !== 'object') return empty;
  const str = (/** @type {unknown} */ v) => (typeof v === 'string' && v ? v : null);
  return {
    agentType: str(j.agentType),
    description: str(j.description),
    model: str(j.model),
    toolUseId: str(j.toolUseId),
    spawnDepth: Number.isFinite(Number(j.spawnDepth)) ? Number(j.spawnDepth) : null,
    parentAgentId: str(j.parentAgentId),
  };
}

/**
 * When a subagent started, from the transcript's own first record.
 *
 * There is no spawn record and no stop record: a subagent transcript opens on
 * an ordinary `user` turn carrying the Task prompt and simply stops being
 * appended to when the junior finishes (verified — §120). So the oldest
 * timestamp in the head window is the spawn and the newest anywhere is the
 * last thing it did. Both are null when nothing in the window carries one,
 * and the caller falls back to the file's mtime.
 *
 * @param {string} headText
 * @param {string} tailText
 * @returns {{spawnedAt:number|null, lastActivityAt:number|null}}
 */
export function parseSubagentTimes(headText, tailText) {
  let spawnedAt = null;
  let newest = null;
  const scan = (/** @type {string} */ text) => {
    for (const rec of jsonLines(text)) {
      const ts = typeof rec.timestamp === 'string' ? Date.parse(rec.timestamp) : NaN;
      if (!Number.isFinite(ts)) continue;
      if (spawnedAt == null || ts < spawnedAt) spawnedAt = ts;
      if (newest == null || ts > newest) newest = ts;
    }
  };
  scan(headText);
  scan(tailText);
  return { spawnedAt, lastActivityAt: newest };
}

/**
 * The parent session id a subagent transcript path implies: the directory
 * immediately above `subagents/`. Null for anything else.
 * @param {unknown} transcriptPath
 * @returns {string|null}
 */
function parentOfTranscript(transcriptPath) {
  if (typeof transcriptPath !== 'string' || !transcriptPath) return null;
  const parts = transcriptPath.split(/[\\/]+/).filter(Boolean);
  const i = parts.lastIndexOf(SUBAGENT_DIR);
  if (i <= 0) return null;
  return parts[i - 1] || null;
}

/**
 * Which junior, if any, a hook payload is about.
 *
 * `SubagentStop` fires on the PARENT's session id — that is the whole reason
 * §89's thought bubbles attribute a junior's tools to its parent — so the
 * payload has to name the junior some other way if the floor is to know which
 * one sat down and which one left.
 *
 * THIS IS THE ONE PART OF WP-41 NOT VERIFIED ON A MACHINE. The reference
 * machine's Claude Code (2.1.231) could not be driven through a Task call
 * during this package (its OAuth token had expired), so the exact
 * `SubagentStop` payload keys are unconfirmed. This therefore reads whichever
 * of three shapes is present and returns `null` — not a guess — when none is:
 *
 *   1. an explicit `agent_id` / `agentId` / `subagent_id` field;
 *   2. a `transcript_path` inside a `subagents/` directory, whose basename is
 *      `agent-<id>.jsonl` and whose grandparent names the parent session —
 *      the shape verified ON DISK (§120);
 *   3. nothing, in which case the caller keeps today's behaviour exactly: the
 *      parent's `lastOutputAt` moves and no junior is touched.
 *
 * @param {Record<string, any>} payload
 * @returns {{agentId:string, parentSessionId:string|null}|null}
 */
export function subagentEvent(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const direct = payload.agent_id ?? payload.agentId ?? payload.subagent_id ?? null;
  if (typeof direct === 'string' && direct) {
    return { agentId: direct, parentSessionId: parentOfTranscript(payload.transcript_path) };
  }
  const tp = payload.transcript_path ?? payload.transcriptPath ?? null;
  if (typeof tp !== 'string' || !tp) return null;
  const parts = tp.split(/[\\/]+/).filter(Boolean);
  if (!parts.includes(SUBAGENT_DIR)) return null;
  const id = subagentIdFromFile(parts[parts.length - 1]);
  if (!id) return null;
  return { agentId: id, parentSessionId: parentOfTranscript(tp) };
}
