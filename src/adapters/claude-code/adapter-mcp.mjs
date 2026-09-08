/**
 * Which MCP servers this machine's Claude Code has, and whether they answered
 * — WP-64.
 *
 * `doctor` grew a row and this is where its answer comes from. Two sources,
 * asked in this order:
 *
 *   1. `claude mcp list`, spawned with an argv array and a bounded timeout. This
 *      is the runtime's own health check, so its verdict is the runtime's and
 *      not ours — DeckHQ opens no socket to an MCP server, ever.
 *   2. the newest transcript's `system`/`init` event, when there is one. On
 *      this machine there never is (`./parse.mjs`'s `mcpServersFromInit`, and
 *      `docs/DEVIATIONS.md` §147), so this is a fallback written for the
 *      machine where the event exists rather than one exercised here.
 *
 * If neither answers, the report says **not checked** and why. It never says
 * zero: "no `claude` on PATH" and "no MCP servers configured" are different
 * facts and only one of them is about MCP servers.
 *
 * Every process this file starts takes an argv ARRAY. No shell, ever
 * (`docs/ADAPTERS.md` §1).
 */

import { execFile } from 'node:child_process';

import { lastMcpServers, parseMcpList, readHead } from './parse.mjs';
import { listSessionFiles } from './adapter-scan.mjs';

/**
 * How long `claude mcp list` gets.
 *
 * MEASURED, not chosen. The package that wrote this specified five seconds,
 * which is the budget every other spawn in this adapter uses. On the reference
 * machine, with four MCP servers configured, three consecutive runs took
 * **5383 ms, 6279 ms and 6145 ms** — the command is a health check that opens
 * a connection to every server it has, so it is slow in proportion to how many
 * you own, and a five-second budget made `doctor` print `not checked` on the
 * one machine that could actually answer. That is the exact failure this row
 * exists to prevent, so the number is ten seconds and this paragraph is why.
 *
 * It is a one-shot command's budget, not the daemon's: nothing on the poll
 * path runs this, so a slow answer costs a `doctor` run and nothing else.
 * `docs/DEVIATIONS.md` §147.1.
 */
export const MCP_LIST_TIMEOUT_MS = 10_000;

/** Output cap, so a runtime with a very long list cannot grow this process. */
export const MCP_LIST_MAX_BUFFER = 1024 * 1024;

/**
 * Run `claude mcp list` and hand back its stdout, or say why not.
 *
 * Never throws and never rejects: a missing binary, a non-zero exit and a
 * timeout each resolve to a `reason`, because `doctor` must not fail over a
 * row. The three are told apart because they are different facts — "claude is
 * not on PATH" is not "your servers are down" — and the row prints whichever
 * one is true.
 *
 * Note the deliberate lack of a cache. This runs once per `doctor` invocation
 * — a one-shot command — and never on the daemon's poll path, so the reason
 * `liveSessions()` caches its spawn (`adapter-live.mjs`, §77) does not apply.
 *
 * @param {{run?: typeof execFile}} [deps]
 * @returns {Promise<{text:string|null, reason:string|null}>}
 */
export function runMcpList(deps = {}) {
  const run = deps.run || execFile;
  return new Promise((resolve) => {
    run(
      'claude',
      ['mcp', 'list'],
      { windowsHide: true, timeout: MCP_LIST_TIMEOUT_MS, maxBuffer: MCP_LIST_MAX_BUFFER },
      (err, stdout) => {
        // A non-zero exit still tends to print the list it managed to check,
        // but a partial list reported as a whole one is exactly the kind of
        // number this project does not print. Nothing but a clean run counts.
        if (!err) {
          resolve({
            text: typeof stdout === 'string' ? stdout : String(stdout ?? ''),
            reason: null,
          });
          return;
        }
        const code = /** @type {any} */ (err).code;
        const killed = /** @type {any} */ (err).killed === true;
        resolve({
          text: null,
          reason:
            code === 'ENOENT'
              ? 'claude is not on PATH'
              : killed
                ? `claude mcp list did not answer within ${MCP_LIST_TIMEOUT_MS / 1000}s`
                : 'claude mcp list exited with an error',
        });
      },
    );
  });
}

/**
 * The newest transcript's init event, as `{name, status}[]`, or null.
 *
 * Reads ONE file's head — init is the first line of a session, so a bounded
 * head read either finds it immediately or it is not there.
 *
 * @param {{list?: typeof listSessionFiles, head?: typeof readHead}} [deps]
 * @returns {Promise<{name:string, status:string}[]|null>}
 */
export async function newestSessionMcpServers(deps = {}) {
  const list = deps.list || listSessionFiles;
  const head = deps.head || readHead;
  let files;
  try {
    files = await list();
  } catch {
    return null;
  }
  if (!Array.isArray(files) || files.length === 0) return null;
  let newest = null;
  for (const f of files) {
    if (!f || typeof f.file !== 'string') continue;
    if (!newest || f.mtimeMs > newest.mtimeMs) newest = f;
  }
  if (!newest) return null;
  try {
    return lastMcpServers([await head(newest.file)]);
  } catch {
    return null;
  }
}

/**
 * The optional adapter method `doctor` reads (the same shape of contract as
 * `version()` and `describeBinary()`): what is known about this runtime's MCP
 * servers, and how it came to be known.
 *
 * `checked: false` with a `reason` is a real answer and the common one. The
 * counts are only ever counts of lines something actually printed.
 *
 * @param {{run?: typeof execFile, list?: typeof listSessionFiles,
 *          head?: typeof readHead}} [deps] injected by the tests; the real
 *   call passes nothing.
 * @returns {Promise<{checked:boolean, source:'cli'|'session'|null,
 *   reason:string|null, servers:{name:string,status:string}[],
 *   connected:number, failed:number}>}
 */
export async function describeMcpServers(deps = {}) {
  const cli = await runMcpList(deps);
  if (cli.text !== null) {
    const parsed = parseMcpList(cli.text);
    return {
      checked: true,
      source: 'cli',
      reason: null,
      servers: parsed.servers,
      connected: parsed.connected,
      failed: parsed.failed,
    };
  }

  const fromSession = await newestSessionMcpServers(deps);
  if (fromSession && fromSession.length) {
    let connected = 0;
    let failed = 0;
    for (const s of fromSession) {
      if (/^connected$/i.test(s.status)) connected += 1;
      else failed += 1;
    }
    return {
      checked: true,
      source: 'session',
      reason: null,
      servers: fromSession,
      connected,
      failed,
    };
  }

  return {
    checked: false,
    source: null,
    reason: cli.reason || 'claude mcp list did not run',
    servers: [],
    connected: 0,
    failed: 0,
  };
}
