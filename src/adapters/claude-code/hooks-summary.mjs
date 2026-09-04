/**
 * What a hook payload is allowed to say (WP-22 follow-up).
 *
 * Split out of `hooks.mjs` unchanged: the ceilings on a command and a
 * pattern, the per-tool summary, WP-19's permission request and its
 * suggestions, and the deny message.
 *
 * Everything here is a bounded, redacted description of somebody else's tool
 * call: a path is made relative, a search pattern is clipped, a URL is
 * reduced to its host. The panel renders every one of these as text.
 */

import path from 'node:path';
import { MAX_TOOL_SUMMARY, MAX_PERMISSION_SUMMARY } from '../../core/model.mjs';

// ------------------------------------------------------- the tool summary

/** The most of a `Bash` command line the floor will ever carry (WP-52). */
export const MAX_COMMAND = 80;

/**
 * How much of a search pattern or a host the bubble carries. Shorter than a
 * command line because neither is prose: a regular expression past forty
 * characters is not read at a glance over somebody's head, it is recognised
 * by its beginning.
 */
export const MAX_PATTERN = 40;

/**
 * The tools whose first argument is a file this session is touching. All four
 * carry it as `file_path`, and all four show it the same way — relative to
 * the SESSION's cwd, and nothing but a basename when it escapes.
 */
export const FILE_TOOLS = new Set(['Edit', 'Read', 'Write', 'MultiEdit']);

/**
 * One line of plain text, at most `max` characters.
 *
 * Hook payloads are text this project did not write: a command can contain
 * newlines, tabs, ANSI escapes or a lone control byte, and all of it ends up
 * on a canvas and in the panel header. Everything outside the printable range
 * becomes a space, runs of whitespace collapse, and the result is cut to
 * length. (The renderer draws it with `fillText`/`textContent` and never as
 * markup — see `docs/DEVIATIONS.md` §89.)
 * @param {string} value
 * @param {number} max
 */
export function oneLine(value, max) {
  const flat = String(value ?? '')
    // `\p{C}` is every control, format and surrogate code point: a raw ESC
    // from a shell command, an embedded newline, a bidi override that would
    // reorder the rest of the line. None of it may reach a canvas.
    .replace(/\p{C}+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > max ? flat.slice(0, max - 1) + '…' : flat;
}

/**
 * A file path as the floor should show it: relative to the session's own
 * working directory, or — for anything outside it — its basename alone.
 *
 * The bubble hangs over a floor that gets screenshotted and pasted into
 * issues; "never contains project paths outside the session's cwd" is the
 * WP-52 acceptance criterion, so a path that escapes the cwd loses everything
 * but its last segment rather than being shown or dropped.
 * @param {string} file
 * @param {string} cwd
 */
export function relativePath(file, cwd) {
  const raw = String(file ?? '').trim();
  if (!raw) return '';
  const basename = path.basename(raw.replace(/[\\/]+$/, '')) || raw;
  if (!cwd) return oneLine(basename, MAX_TOOL_SUMMARY);
  try {
    const abs = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
    const rel = path.relative(cwd, abs);
    if (!rel || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) {
      return oneLine(basename, MAX_TOOL_SUMMARY);
    }
    return oneLine(rel.replace(/\\/g, '/'), MAX_TOOL_SUMMARY);
  } catch {
    return oneLine(basename, MAX_TOOL_SUMMARY);
  }
}

/**
 * A search pattern as the floor should show it.
 *
 * A `Grep` pattern is a regular expression the user typed — a search string,
 * not a place the tool opened — so it is flattened and cut and nothing else.
 * A `Glob` pattern is usually the same kind of thing (`**\/*.ts` is a shape),
 * but an ABSOLUTE one names a location, and a location outside the session's
 * cwd is exactly what WP-52 says must not reach a screenshot. So an absolute
 * pattern goes through {@link relativePath} and a relative one does not,
 * which keeps `src/**\/*.ts` readable and reduces `/somebody/else/**\/*.ts`
 * to its last segment.
 * @param {string} value
 * @param {string} cwd
 */
export function searchPattern(value, cwd) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  if (!path.isAbsolute(raw)) return oneLine(raw, MAX_PATTERN);
  return oneLine(relativePath(raw, cwd), MAX_PATTERN);
}

/**
 * A fetched URL as the floor should show it: the host, and nothing else.
 *
 * The path and the query string of a URL an agent fetched are the parts that
 * carry an issue number, a document id, a search term or a token, and this
 * string goes over a head on a floor that gets screenshotted. "Which service
 * is it talking to" is the whole of what the bubble is for.
 * @param {string} value
 */
export function fetchHost(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const host = new URL(raw).hostname;
    return oneLine(host, MAX_PATTERN);
  } catch {
    // Not a URL this runtime can parse. A bare name says less than a guess
    // that might be a path.
    return '';
  }
}

/**
 * What a `PreToolUse` payload says the session is doing, as a name plus a
 * summary of at most {@link MAX_TOOL_SUMMARY} characters (WP-52,
 * `docs/plan/08-PLAN-V2-100X.md` §9).
 *
 * Parsing lives here rather than in the HTTP route because the payload shape
 * is Claude Code's, and nothing outside `src/adapters/` may know a runtime's
 * format (`docs/02-ARCHITECTURE.md` §2).
 *
 *   Bash      -> `Bash npm test` (first 80 characters of the command line)
 *   Edit      -> `Edit src/foo.ts` (relative to cwd; basename if outside it)
 *   Read      -> `Read src/foo.ts`
 *   Write     -> `Write src/foo.ts`
 *   MultiEdit -> `MultiEdit src/foo.ts`
 *   Grep      -> `Grep TODO\\(.*\\)` (first 40 characters of the pattern)
 *   Glob      -> `Glob src/**\/*.ts`
 *   WebFetch  -> `WebFetch example.com` (the host, never the path)
 *   other     -> the tool name on its own
 *
 * The five after `Read` were left as bare names by the package that built
 * this: inventing argument shapes was a spec change rather than an
 * implementation detail, and they were to be revisited once the bubble had
 * been watched on a real machine (`docs/DEVIATIONS.md` §89, "Accepted
 * limits"). They are revisited. Every one of them keeps the same two
 * disciplines as the first three — a path relative to the SESSION's cwd, and
 * nothing but a basename for a path outside it — and the two that carry
 * neither a path nor a command say the least they can rather than the most.
 *
 * @param {Record<string, any>} payload
 * @returns {{name:string, summary:string}|null} null when the payload names
 *   no tool at all — there is then nothing honest to draw.
 */
export function toolSummary(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const name = oneLine(payload.tool_name ?? payload.toolName ?? '', 40);
  if (!name) return null;
  const input =
    payload.tool_input && typeof payload.tool_input === 'object'
      ? payload.tool_input
      : payload.toolInput && typeof payload.toolInput === 'object'
        ? payload.toolInput
        : {};
  const cwd = String(payload.cwd || payload.workspace || '');

  let summary = name;
  if (name === 'Bash') {
    const command = oneLine(input.command ?? '', MAX_COMMAND);
    if (command) summary = `${name} ${command}`;
  } else if (FILE_TOOLS.has(name)) {
    const file = relativePath(input.file_path ?? input.filePath ?? '', cwd);
    if (file) summary = `${name} ${file}`;
  } else if (name === 'Grep' || name === 'Glob') {
    const pattern = searchPattern(input.pattern ?? '', cwd);
    if (pattern) summary = `${name} ${pattern}`;
  } else if (name === 'WebFetch') {
    const host = fetchHost(input.url ?? '');
    if (host) summary = `${name} ${host}`;
  }
  return { name, summary: oneLine(summary, MAX_TOOL_SUMMARY) };
}

// ------------------------------------------------- the permission request

/**
 * Tools whose approval card IS the interaction surface. The runtime discards
 * a hook allow for these and makes the user answer in the session:
 * `if (!g.updatedInput && e.requiresUserInteraction?.()) return null`
 * (`docs/DEVIATIONS.md` §86.3). The panel must therefore offer no buttons for
 * them, and say where to answer instead.
 *
 * MCP tools carry the same property through their own `anthropic/…` metadata,
 * which the hook payload does not currently include; `requires_user_interaction`
 * is read from the payload as well so that the day the runtime starts sending
 * it, DeckHQ is already honouring it.
 */
export const REQUIRES_USER_INTERACTION = new Set(['AskUserQuestion', 'ExitPlanMode']);

/**
 * A file path as a permission card should show it: relative to the session's
 * own working directory when it is inside it, and **unchanged** when it is
 * not.
 *
 * This is deliberately the opposite of {@link relativePath}, which reduces an
 * outside path to its basename so a screenshot of the floor cannot carry
 * somebody else's directory tree. Here the reader is deciding whether to let
 * a write happen, and a write landing outside the project is precisely the
 * case where hiding the location would be the dangerous choice. The card is a
 * review surface, not a wall decoration.
 * @param {string} file
 * @param {string} cwd
 */
export function permissionPath(file, cwd) {
  const raw = String(file ?? '').trim();
  if (!raw || !cwd) return raw;
  try {
    const abs = path.isAbsolute(raw) ? raw : path.resolve(cwd, raw);
    const rel = path.relative(cwd, abs);
    if (!rel || rel === '.' || rel.startsWith('..') || path.isAbsolute(rel)) return raw;
    return rel.replace(/\\/g, '/');
  } catch {
    return raw;
  }
}

/**
 * The one line the card puts under the tool name: what this call would
 * actually do.
 * @param {string} name
 * @param {Record<string, any>} input
 * @param {string} cwd
 */
export function permissionSummary(name, input, cwd) {
  const one = (v) => oneLine(v, MAX_PERMISSION_SUMMARY);
  if (name === 'Bash') return one(input.command ?? '');
  const file = input.file_path ?? input.filePath ?? input.notebook_path ?? input.path;
  if (typeof file === 'string' && file.trim()) return one(permissionPath(file, cwd));
  if (typeof input.url === 'string' && input.url.trim()) return one(input.url);
  if (typeof input.command === 'string' && input.command.trim()) return one(input.command);
  // Anything else: the input's own keys, so the card never claims to know
  // more about a tool than it does.
  const parts = [];
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    parts.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  }
  return one(parts.join(' · '));
}

/**
 * A human label for one `addRules` suggestion — the runtime's own rule text,
 * never one DeckHQ minted.
 * @param {any} suggestion
 */
export function suggestionLabel(suggestion) {
  const rules = Array.isArray(suggestion.rules) ? suggestion.rules : [];
  const parts = rules
    .map((r) => {
      const tool = oneLine(r?.toolName ?? '', 40);
      const content = oneLine(r?.ruleContent ?? '', 80);
      if (!tool) return content;
      return content ? `${tool}(${content})` : tool;
    })
    .filter(Boolean);
  return oneLine(parts.join(', '), MAX_TOOL_SUMMARY);
}

/**
 * What a `PermissionRequest` payload says, in the shape the daemon and the
 * panel use (WP-19). Parsing lives here, not in the HTTP route, because the
 * payload shape is Claude Code's and nothing outside `src/adapters/` may know
 * a runtime's format (`docs/02-ARCHITECTURE.md` §2).
 *
 * `permission_suggestions` is the field that earns the third button: it is the
 * set of permission updates the terminal prompt itself would have offered, so
 * "Allow for this session" retargets one of the runtime's own rules rather
 * than inventing rule syntax (`docs/DEVIATIONS.md` §86.2). Only `addRules` is
 * kept: `setMode` and `addDirectories` are wider grants than the button says.
 *
 * @param {Record<string, any>} payload
 * @returns {{id:string, sessionId:string, cwd:string, tool:string, summary:string,
 *   suggestions:any[], requiresUserInteraction:boolean}|null} null when the
 *   payload names no tool — there is then nothing honest to ask about.
 */
export function permissionRequest(payload) {
  if (!payload || typeof payload !== 'object') return null;
  const tool = oneLine(payload.tool_name ?? payload.toolName ?? '', 60);
  if (!tool) return null;
  const input =
    payload.tool_input && typeof payload.tool_input === 'object'
      ? payload.tool_input
      : payload.toolInput && typeof payload.toolInput === 'object'
        ? payload.toolInput
        : {};
  const cwd = String(payload.cwd || payload.workspace || '');
  const rawSuggestions = Array.isArray(payload.permission_suggestions)
    ? payload.permission_suggestions
    : [];
  const suggestions = rawSuggestions
    .filter((s) => s && typeof s === 'object' && s.type === 'addRules' && Array.isArray(s.rules))
    .map((s) => ({ ...s, label: suggestionLabel(s) }));

  return {
    id: String(payload.tool_use_id || payload.toolUseId || ''),
    sessionId: String(payload.session_id || payload.sessionId || ''),
    cwd,
    tool,
    summary: permissionSummary(tool, input, cwd),
    suggestions,
    requiresUserInteraction:
      REQUIRES_USER_INTERACTION.has(tool) || payload.requires_user_interaction === true,
  };
}

/**
 * What a denied tool call says in the session's own transcript.
 *
 * User-visible copy, and the only sentence this product writes into somebody
 * else's terminal — so it is a sentence: capitalised, with a full stop, the
 * way `docs/DEVIATIONS.md` §86.3's table specified it. The build shipped a
 * lower-case fragment from the package brief instead and recorded the
 * difference (§97.3 decision 1) rather than reconciling it silently; §86.3 is
 * the spec and it wins.
 *
 * Exported so the tests assert the literal that ships rather than a copy of
 * it that can drift.
 */
export const DENY_MESSAGE = 'Denied from DeckHQ.';

/**
 * The body that answers a held `PermissionRequest`, in the shape the installed
 * runtime's parser actually accepts — a `behavior`-discriminated OBJECT, not
 * the bare string the prose documentation shows (`docs/DEVIATIONS.md` §86.3).
 * A body in the documented shape fails validation silently and the prompt just
 * sits there, so this function is the single place that spelling lives.
 *
 * Three things it will never emit, each with an `INVARIANT:` test:
 *   - `interrupt: true` on a deny. Denying one command is not stopping the
 *     agent, and the runtime's `interrupt` aborts the whole turn.
 *   - a `destination` other than `"session"`. `userSettings`, `projectSettings`
 *     and `localSettings` write a permanent grant into the user's settings
 *     files, and that is not a button this panel has.
 *   - anything at all on a timeout. Silence is how "let the terminal decide"
 *     is expressed; there is no `ask` behaviour to send.
 *
 * @param {'allow'|'deny'|'session'} decision
 * @param {any[]} [suggestions] the `addRules` suggestions from the request
 * @returns {Record<string, any>}
 */
export function permissionDecisionBody(decision, suggestions = []) {
  if (decision === 'deny') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: { behavior: 'deny', message: DENY_MESSAGE },
      },
    };
  }
  /** @type {Record<string, any>} */
  const inner = { behavior: 'allow' };
  if (decision === 'session') {
    const updates = (Array.isArray(suggestions) ? suggestions : [])
      .filter((s) => s && s.type === 'addRules')
      // `label` is ours, for the panel; it never goes back to the runtime.
      .map(({ label: _label, ...rest }) => ({ ...rest, destination: 'session' }));
    if (updates.length > 0) inner.updatedPermissions = updates;
  }
  return {
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: inner },
  };
}
