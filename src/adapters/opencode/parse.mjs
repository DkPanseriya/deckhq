/**
 * OpenCode session parsing. WP-25.
 *
 * `docs/02-ARCHITECTURE.md` §2.1: "All parsing lives in one file per adapter so
 * a format break is a single-file fix." This file is that fix point for
 * OpenCode. Nothing outside `src/adapters/opencode/` knows any of the field
 * names or the SQL below (`docs/plan/08-PLAN-V2-100X.md` §1.1 rule 8).
 *
 * ---------------------------------------------------------------------------
 * PROVENANCE — read this before changing anything here
 * ---------------------------------------------------------------------------
 *
 * **OpenCode is not installed on the reference machine.** `opencode --version`
 * is not on PATH and `~/.local/share/opencode` does not exist; both were
 * checked, read-only, on 4 September 2026 and were absent. Nothing in this file
 * has ever been run against real OpenCode data. Every shape below was read out
 * of the published source and documentation on that date and is a hypothesis
 * until somebody runs it against a real install — `08` §1.1 rule 11.
 * `docs/DEVIATIONS.md` §123 says the same, and the README's Honest limits says
 * it to users.
 *
 * Read from `anomalyco/opencode` branch `dev`, 4 September 2026 (the repository
 * moved from `sst/opencode`, which now redirects):
 *   - `packages/core/src/global.ts` — the data directory, via `xdg-basedir`
 *   - `packages/core/src/database/database.ts` — the SQLite file's path
 *   - `packages/core/src/session/sql.ts` — the `session`/`message` tables
 *   - `packages/schema/src/v1/session.ts` — `SessionInfo` and the message types
 *   - `packages/opencode/src/storage/storage.ts` — the two legacy JSON layouts
 *   - `packages/opencode/src/cli/cmd/{tui,run,session,db}.ts` — the CLI surface
 *   https://github.com/anomalyco/opencode · https://opencode.ai/docs/
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO SQLITE READER IN THIS DIRECTORY
 * ---------------------------------------------------------------------------
 *
 * Since **v1.2.0 (14 February 2026)** OpenCode keeps everything in one SQLite
 * database — `~/.local/share/opencode/opencode.db` — and migrates the old flat
 * files into it on first run. DeckHQ has no runtime dependencies (`08` §1.1
 * rule 3), so reading it directly would mean writing a SQLite reader here.
 *
 * We did not, and the reason is not effort:
 *
 *   1. **The database runs in WAL mode.** Recent writes live in
 *      `opencode.db-wal` until a checkpoint folds them into the main file. A
 *      reader that parsed only the main file would systematically miss the
 *      newest sessions — which are exactly the ones this product exists to
 *      show. Correctness therefore needs the b-tree pages *and* the WAL index
 *      *and* overflow-page chains, which is a dependency's worth of code that
 *      cannot be tested on a machine with no OpenCode on it.
 *   2. **`docs/02-ARCHITECTURE.md` §2.1 already answers this**: "prefer
 *      supported surfaces over file parsing wherever both exist". OpenCode
 *      ships three, all of which emit JSON: `opencode db "<sql>" --format
 *      json`, `opencode session list --format json`, and `opencode export`.
 *      That is the same shape as Claude Code's `claude agents --json`, and it
 *      is a supported interface rather than a guess at a byte layout.
 *
 * So this adapter shells out to OpenCode and parses its JSON. The SQL lives
 * here, with the rest of the format knowledge.
 *
 * ---------------------------------------------------------------------------
 * SHAPES THIS FILE HANDLES (update this list first when the format changes)
 * ---------------------------------------------------------------------------
 *
 * 1. A `session` table row, as `opencode db --format json` returns it — the V1
 *    `SessionInfo` flattened into columns:
 *      { id, project_id, workspace_id, parent_id, slug, directory, path, title,
 *        version, cost, tokens_input, tokens_output, tokens_reasoning,
 *        tokens_cache_read, tokens_cache_write, model, agent,
 *        time_created, time_updated, time_compacting, time_archived }
 *    `directory` is the absolute working directory. It is NOT called `cwd` at
 *    this level — `cwd` appears on a message, under `path`.
 *    Times are epoch **milliseconds**.
 *
 * 2. A `message` table row: `{ id, session_id, time_created, time_updated,
 *    data }`, where `data` is a JSON string holding the V1 message body minus
 *    the hoisted `id`/`sessionID`. An assistant body is
 *      { role: 'assistant', time: { created, completed? }, modelID, providerID,
 *        path: { cwd, root }, cost, tokens: { input, output, reasoning,
 *        cache: { read, write } }, finish?, error? }
 *    and a user body is
 *      { role: 'user', time: { created }, model: { providerID, modelID } }
 *    **`time.completed` is the turn-ended signal**: it is absent while the
 *    assistant is still streaming.
 *
 * 3. `opencode session list --format json`, the thinner documented fallback:
 *      [ { id, title, updated, created, projectId, directory } ]
 *    Root sessions only — it does not list juniors.
 *
 * 4. `opencode export <id>` — session data as JSON. Handled shape-tolerantly:
 *    an array of messages, or an object carrying one under `messages`, where
 *    each entry is either a bare message body or a `{ info, parts }` envelope.
 *    Text lives in the parts, as `{ type: 'text', text }`; every other part
 *    type (tool, reasoning, patch, snapshot, step-start, …) is skipped so no
 *    `[tool: ...]` artefact can reach the panel.
 *
 * 5. Two pre-v1.2.0 on-disk JSON layouts, still present on an install that
 *    never upgraded. `walkLegacySessions` in ./adapter.mjs walks them, and
 *    carries the caveat that matters — they are read ONLY when the CLI answers
 *    nothing, because on a migrated install they are stale copies:
 *      gen 1  <data>/project/<slug>/storage/session/info/<sessionID>.json
 *      gen 2  <data>/storage/session/<projectID>/<sessionID>.json
 *    Both hold the V1 `SessionInfo` object, nested rather than flattened:
 *      { id, projectID, directory, title, parentID?, version,
 *        cost?, tokens?: { input, output, reasoning, cache: { read, write } },
 *        model?: { id, providerID }, time: { created, updated } }
 *
 * Anything that fails `JSON.parse`, or matches none of the above, is skipped
 * rather than thrown (CONTRACTS.md rule 6).
 */

/**
 * How many recent messages one enrichment query pulls back.
 *
 * The query asks for the newest messages across every session and this file
 * keeps the first it sees per session. A ceiling is what stops a machine with
 * a year of history from pulling its whole message table into memory to
 * answer a question about the newest few dozen sessions; sessions past it
 * simply keep the `lastRole`/`turnEnded` they had from their session row,
 * which is none, and lose nothing else.
 */
export const MAX_RECENT_MESSAGES = 2000;

/**
 * The SQL this adapter runs, as data rather than inline strings, so the two
 * queries can be asserted in a test without spawning anything.
 *
 * Both are read-only `SELECT`s and neither interpolates anything: they take no
 * parameters at all, so there is no value from a request body anywhere near
 * them. That is deliberate — `opencode db` runs whatever it is handed, and the
 * only safe way to use it is to hand it a constant.
 */
export const SQL = {
  /**
   * Every session, newest first. `SELECT *` rather than a column list on
   * purpose: the table has gained columns across versions, and a list would
   * turn "OpenCode added a column" into "the query errors and DeckHQ shows no
   * sessions". Unknown columns are ignored by `sessionFromSqlRow`.
   */
  sessions: 'SELECT * FROM session ORDER BY time_updated DESC',
  /**
   * The newest messages across all sessions. The caller keeps the first row it
   * sees for each `session_id`, which — because the rows arrive newest first —
   * is that session's latest message.
   */
  recentMessages: `SELECT session_id, time_created, data FROM message ORDER BY time_created DESC LIMIT ${MAX_RECENT_MESSAGES}`,
};

/**
 * Parse a JSON document, never throwing. Returns null for invalid JSON and for
 * anything that is not an object or an array.
 * @param {string} text
 * @returns {any}
 */
export function parseJson(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * `opencode db --format json` emits a JSON array of row objects. Some CLI
 * builds wrap warnings or a trailing newline around it, so the array is
 * located rather than assumed to be the whole of stdout.
 * @param {string} stdout
 * @returns {Record<string, any>[]}
 */
export function parseRows(stdout) {
  const direct = parseJson(stdout);
  if (Array.isArray(direct)) return direct.filter(isPlainObject);

  const text = String(stdout ?? '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  const sliced = parseJson(text.slice(start, end + 1));
  return Array.isArray(sliced) ? sliced.filter(isPlainObject) : [];
}

/** @param {unknown} v */
function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/** @param {...unknown} vals */
function firstString(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return null;
}

/**
 * A non-negative finite number, or 0. Token counts and timestamps arrive from
 * a JSON column and a CLI's stdout; a string `"1200"` is worth reading, and a
 * negative or NaN one is worth refusing.
 * @param {unknown} n
 * @returns {number}
 */
export function num(n) {
  if (typeof n === 'number') return Number.isFinite(n) && n >= 0 ? n : 0;
  if (typeof n === 'string' && n.trim()) {
    const parsed = Number(n);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  }
  return 0;
}

/**
 * A model identifier from any of the three places one appears: the session
 * row's `model` column (a string, or a JSON blob of `{id, providerID}`), the
 * V1 `model` object, or an assistant message's flat `modelID`.
 * @param {unknown} model
 * @returns {string|null}
 */
export function modelName(model) {
  if (typeof model === 'string') {
    const trimmed = model.trim();
    if (!trimmed) return null;
    // The column can hold a JSON object rather than a bare name.
    if (trimmed.startsWith('{')) {
      const parsed = parseJson(trimmed);
      return parsed ? modelName(parsed) : trimmed;
    }
    return trimmed;
  }
  if (isPlainObject(model)) {
    return firstString(
      /** @type {any} */ (model).id,
      /** @type {any} */ (model).modelID,
      /** @type {any} */ (model).model,
    );
  }
  return null;
}

/**
 * Normalise one `session` table row into the fields a summary needs.
 * Unknown columns are ignored, and a row with no id is refused.
 * @param {Record<string, any>} row
 * @returns {{id:string, directory:string|null, title:string, parentId:string|null,
 *            model:string|null, createdAt:number, updatedAt:number,
 *            inputTokens:number, outputTokens:number, cacheTokens:number,
 *            archived:boolean}|null}
 */
export function sessionFromSqlRow(row) {
  if (!isPlainObject(row)) return null;
  const id = firstString(row.id);
  if (!id) return null;

  return {
    id,
    directory: firstString(row.directory),
    title: typeof row.title === 'string' ? row.title : '',
    parentId: firstString(row.parent_id, row.parentID),
    model: modelName(row.model),
    createdAt: num(row.time_created),
    updatedAt: num(row.time_updated),
    inputTokens: num(row.tokens_input),
    outputTokens: num(row.tokens_output),
    // Cache reads and writes are one number on a SessionSummary.
    cacheTokens: num(row.tokens_cache_read) + num(row.tokens_cache_write),
    // `time_archived` is OpenCode's own archive flag, and the desktop-archive
    // rule from docs/DEVIATIONS.md §46 applies: it is the runtime's answer,
    // read fresh on every scan and never cached.
    archived: num(row.time_archived) > 0,
  };
}

/**
 * Normalise the nested V1 `SessionInfo` object — the shape in both legacy JSON
 * layouts — into the same fields `sessionFromSqlRow` returns, so the two paths
 * converge before they reach the adapter.
 * @param {Record<string, any>} info
 * @returns {ReturnType<typeof sessionFromSqlRow>}
 */
export function sessionFromInfoJson(info) {
  if (!isPlainObject(info)) return null;
  const id = firstString(info.id);
  if (!id) return null;

  const tokens = isPlainObject(info.tokens) ? info.tokens : {};
  const cache = isPlainObject(tokens.cache) ? tokens.cache : {};
  const time = isPlainObject(info.time) ? info.time : {};

  return {
    id,
    directory: firstString(info.directory),
    title: typeof info.title === 'string' ? info.title : '',
    parentId: firstString(info.parentID, info.parentId),
    model: modelName(info.model),
    createdAt: num(time.created),
    updatedAt: num(time.updated),
    inputTokens: num(tokens.input),
    outputTokens: num(tokens.output),
    cacheTokens: num(cache.read) + num(cache.write),
    archived: num(time.archived) > 0,
  };
}

/**
 * Normalise one row of `opencode session list --format json`:
 * `{id, title, updated, created, projectId, directory}`. The documented,
 * stable fallback — thinner than the SQL path: no tokens, no cost, no model,
 * and root sessions only.
 * @param {Record<string, any>} row
 * @returns {ReturnType<typeof sessionFromSqlRow>}
 */
export function sessionFromListRow(row) {
  if (!isPlainObject(row)) return null;
  const id = firstString(row.id);
  if (!id) return null;

  return {
    id,
    directory: firstString(row.directory),
    title: typeof row.title === 'string' ? row.title : '',
    parentId: null,
    model: null,
    createdAt: num(row.created),
    updatedAt: num(row.updated),
    inputTokens: 0,
    outputTokens: 0,
    cacheTokens: 0,
    archived: false,
  };
}

/**
 * Read one message body — the JSON in a `message` row's `data` column, or a
 * message object out of an export.
 *
 * **`turnEnded` is `time.completed` being set**, which is the strongest
 * turn-boundary signal of any runtime DeckHQ reads: OpenCode records the
 * moment the assistant finished rather than leaving it to be inferred from
 * "the assistant spoke last". A user message is never a finished turn, and an
 * assistant message that errored is finished but is not up for review in the
 * ordinary sense — it is still reported as ended, because a failed turn that
 * never appeared would be worse than one labelled plainly.
 *
 * @param {unknown} data the `data` column (a JSON string) or an object
 * @returns {{role:'user'|'assistant', at:number, completed:boolean,
 *            model:string|null, cwd:string|null}|null}
 */
export function messageFromData(data) {
  const body = typeof data === 'string' ? parseJson(data) : data;
  if (!isPlainObject(body)) return null;

  const role = body.role === 'assistant' ? 'assistant' : body.role === 'user' ? 'user' : null;
  if (!role) return null;

  const time = isPlainObject(body.time) ? body.time : {};
  const path = isPlainObject(body.path) ? body.path : {};

  return {
    role,
    at: num(time.created),
    completed: role === 'assistant' && num(time.completed) > 0,
    model: modelName(body.modelID ?? body.model),
    cwd: firstString(path.cwd),
  };
}

/**
 * Fold the newest-first message rows into one entry per session: the latest
 * message that session has.
 * @param {Record<string, any>[]} rows rows of `SQL.recentMessages`
 * @returns {Map<string, NonNullable<ReturnType<typeof messageFromData>>>}
 */
export function latestMessagePerSession(rows) {
  /** @type {Map<string, NonNullable<ReturnType<typeof messageFromData>>>} */
  const out = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isPlainObject(row)) continue;
    const sessionId = firstString(row.session_id, row.sessionID);
    if (!sessionId || out.has(sessionId)) continue;
    const msg = messageFromData(row.data);
    if (msg) out.set(sessionId, msg);
  }
  return out;
}

/**
 * Text out of a message's parts. Only `type: 'text'` parts carry readable
 * text; tool calls, reasoning, patches, snapshots and step markers are skipped
 * so the panel stays a conversation rather than a trace.
 * @param {unknown} parts
 * @returns {string}
 */
export function partsToText(parts) {
  if (!Array.isArray(parts)) return '';
  const out = [];
  for (const part of parts) {
    if (!isPlainObject(part)) continue;
    if (part.type !== 'text') continue;
    if (typeof part.text === 'string' && part.text) out.push(part.text);
  }
  return out.join('');
}

/**
 * Parse `opencode export <id>` output into a conversation, most recent last.
 *
 * The export's exact envelope is the least-documented thing this adapter
 * touches, so it is read shape-tolerantly: the messages may be the top-level
 * array or sit under `messages`, and each entry may be a bare message body or
 * a `{info, parts}` envelope. A message with no text — a pure tool turn —
 * is skipped rather than shown as an empty bubble.
 *
 * @param {string} stdout
 * @param {number} fallbackAt used when a message carries no timestamp
 * @returns {import('../../core/model.mjs').Message[]}
 */
export function parseExport(stdout, fallbackAt = Date.now()) {
  const parsed = parseJson(stdout);
  if (!parsed) return [];

  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed.messages)
      ? parsed.messages
      : Array.isArray(parsed.data)
        ? parsed.data
        : [];

  const out = [];
  for (const entry of list) {
    if (!isPlainObject(entry)) continue;
    const info = isPlainObject(entry.info) ? entry.info : entry;
    const msg = messageFromData(info);
    if (!msg) continue;
    const text = partsToText(entry.parts ?? info.parts);
    if (!text) continue;
    out.push({ role: msg.role, text, at: msg.at || fallbackAt });
  }
  return out;
}

/**
 * Truncate a title to `max` characters, collapsing whitespace. Same rule as
 * every other adapter.
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
