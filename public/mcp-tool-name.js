/**
 * MCP tool ids, read back into something a person can see — WP-64.
 *
 * An MCP tool arrives at DeckHQ as the id the runtime uses internally:
 *
 *     mcp__gmail__send
 *     mcp__linear__create_issue
 *
 * On the floor that is a bubble full of underscores that says the same word
 * three times. This file is the whole of the fix: `mcp__<server>__<tool>`
 * becomes `{server, tool}`, and a display label reads `Gmail · send`.
 *
 * ## Why this lives in `public/`
 *
 * `public/` may never import from `src/`, because `public/` is served as
 * static files and `src/` is not (`docs/DEVIATIONS.md` §122). The floor is
 * where this label is drawn, so the implementation is here and
 * `src/core/mcp-tool-name.mjs` re-exports it — the same direction
 * `src/core/themes.mjs` imports `public/render/themes.js` and
 * `src/core/identity.mjs` imports `public/names.js`.
 *
 * ## What it will NOT do
 *
 * It renames nothing. The server segment is the name the user gave that
 * server in their own config and the tool segment is the tool's own name, so
 * neither is re-spelled: no underscore-to-space rewriting, no title casing of
 * every word, no dictionary of "nice" names for servers we happen to know.
 * The single cosmetic liberty is upper-casing the server's first letter, which
 * is why `mcp__gmail__send` reads `Gmail · send` and `mcp__claude-in-chrome__find`
 * reads `Claude-in-chrome · find` rather than something invented.
 *
 * The raw id is never thrown away by anything that calls this: the floor keeps
 * it on the panel line's tooltip, so the string you would grep for is still
 * one hover away.
 */

/** The prefix every MCP tool id carries. */
export const MCP_PREFIX = 'mcp__';

/** What separates the server from the tool. */
export const MCP_SEP = '__';

/** The middle dot the label joins with, spaced. */
export const LABEL_JOIN = ' · ';

/**
 * Split `mcp__<server>__<tool>` into its two halves.
 *
 * The split is at the FIRST `__` after the prefix: a server name may contain a
 * single underscore (`ccd_session`) and a tool name very often does
 * (`create_issue`, `read_page`), so anything after that first separator is the
 * tool, double underscores included. A tool id that is not an MCP one, or one
 * with an empty half, is `null` — the caller then shows the id it already had,
 * which is the honest answer for a name this function cannot read.
 *
 * Pure: no I/O, no globals, same input same output.
 *
 * @param {unknown} name the runtime's own tool name
 * @returns {{server:string, tool:string}|null}
 */
export function parseMcpToolName(name) {
  const raw = typeof name === 'string' ? name : '';
  if (!raw.startsWith(MCP_PREFIX)) return null;
  const rest = raw.slice(MCP_PREFIX.length);
  const cut = rest.indexOf(MCP_SEP);
  if (cut <= 0) return null;
  const server = rest.slice(0, cut);
  const tool = rest.slice(cut + MCP_SEP.length);
  if (!server || !tool) return null;
  return { server, tool };
}

/**
 * Is this tool id an MCP one?
 * @param {unknown} name
 * @returns {boolean}
 */
export function isMcpToolName(name) {
  return parseMcpToolName(name) !== null;
}

/**
 * The server's name with its first letter upper-cased, and nothing else
 * touched. See the file header for why this is the only liberty taken.
 * @param {string} server
 * @returns {string}
 */
export function displayServer(server) {
  const s = String(server ?? '');
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * `mcp__gmail__send` → `Gmail · send`.
 *
 * Anything that is not an MCP tool id comes back unchanged, so a caller can
 * pass every tool name it has through this without asking first.
 *
 * @param {unknown} name
 * @returns {string}
 */
export function mcpToolLabel(name) {
  const parsed = parseMcpToolName(name);
  if (!parsed) return typeof name === 'string' ? name : '';
  return displayServer(parsed.server) + LABEL_JOIN + parsed.tool;
}

/**
 * The same substitution inside a tool SUMMARY.
 *
 * A summary is `<tool name>` on its own for every tool the adapter has no
 * argument shape for, and MCP tools are all of them today — but it is built by
 * the adapter and may grow arguments, so only the leading id is replaced and
 * the rest of the line is left exactly as it was. A summary that does not
 * begin with the tool's own name is returned untouched: it is then something
 * this function did not build and cannot safely edit.
 *
 * @param {unknown} name    the runtime's tool name, e.g. `mcp__gmail__send`
 * @param {unknown} summary the adapter's one-line summary
 * @returns {string}
 */
export function humaniseToolSummary(name, summary) {
  const rawName = typeof name === 'string' ? name : '';
  const text = typeof summary === 'string' ? summary : '';
  if (!isMcpToolName(rawName)) return text;
  if (!text) return mcpToolLabel(rawName);
  if (text !== rawName && !text.startsWith(rawName + ' ')) return text;
  return mcpToolLabel(rawName) + text.slice(rawName.length);
}
