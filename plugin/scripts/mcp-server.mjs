#!/usr/bin/env node
/**
 * The DeckHQ MCP server: one tool, `deckhq_waiting`, so the model in any
 * session can answer "what is waiting on me across all my projects" without
 * the user leaving the terminal (`docs/plan/08-PLAN-V2-100X.md` B2).
 *
 * JSON-RPC 2.0 over stdio, one message per line, written by hand. There is no
 * SDK here for the same reason there is no dependency anywhere else in this
 * product: `08` §1.1 rule 3. The protocol surface a read-only, one-tool server
 * needs is `initialize`, `tools/list`, `tools/call` and `ping`, and that is
 * about two hundred lines including the comments.
 *
 * ## What it will not do
 *
 * **It never writes.** There is no `deckhq_ack` and there will not be one from
 * this server: acknowledging is the user discharging a debt, and a model that
 * can clear the needs-you count can clear it by accident. `docs/01-PRODUCT.md`
 * §2 is the invariant; a tool that lets an observer clear a user-owned state is
 * the exact shape it forbids.
 *
 * **It never starts anything.** A tool call is the model's decision, not the
 * user's; spawning a daemon on one is a side effect nobody asked for. The
 * `SessionStart` hook is where the daemon gets started, by the user opening a
 * session.
 *
 * **It makes no outbound call.** The only socket it opens is to 127.0.0.1.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { NO_DAEMON, findDaemon, renderWaiting, waitingFrom } from '../lib/deckhq.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The newest protocol revision this server was written against. */
const PROTOCOL_VERSION = '2025-06-18';

/** How long a tool call may spend looking for the daemon. */
const FIND_TIMEOUT_MS = 2000;

const VERSION = (() => {
  try {
    const manifest = path.join(HERE, '..', '.claude-plugin', 'plugin.json');
    return String(JSON.parse(fs.readFileSync(manifest, 'utf8')).version || '0.0.0');
  } catch {
    return '0.0.0';
  }
})();

/** The one tool, as `tools/list` describes it. */
export const TOOLS = [
  {
    name: 'deckhq_waiting',
    title: 'What is waiting on you',
    description:
      'Every AI coding session on this machine that is waiting on the user right now: finished ' +
      'and unreviewed, blocked with its hand up, or stalled. Covers every project and every ' +
      'runtime, including sessions this terminal never started and sessions whose process has ' +
      'already exited. Read-only. Answers from a DeckHQ daemon on 127.0.0.1 and makes no ' +
      'outbound network call.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

/**
 * Run the tool. Exported so the test can call it without a transport.
 * @param {{find?:typeof findDaemon, now?:number}} [deps]
 * @returns {Promise<{content:Array<{type:'text', text:string}>, structuredContent?:any}>}
 */
export async function callWaiting(deps = {}) {
  const find = deps.find || findDaemon;
  const found = await find({ timeoutMs: FIND_TIMEOUT_MS });
  if (!found) return { content: [{ type: 'text', text: NO_DAEMON }] };
  const rows = waitingFrom(found.snapshot);
  return {
    content: [{ type: 'text', text: renderWaiting(found.snapshot, { now: deps.now }) }],
    structuredContent: {
      waiting: rows.length,
      counts: found.snapshot.counts,
      agents: rows.map((a) => ({
        id: a.id,
        label: a.displayName || a.mk || null,
        project: a.projectName || a.projectId || null,
        state: a.activityState,
        runtime: a.runtime,
      })),
    },
  };
}

/**
 * Answer one JSON-RPC request. Returns null for a notification, which by the
 * specification gets no reply at all.
 *
 * @param {any} message
 * @param {{find?:typeof findDaemon, now?:number}} [deps]
 * @returns {Promise<any|null>}
 */
export async function handle(message, deps = {}) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) {
    return error(null, -32600, 'Invalid Request');
  }
  const { id, method } = message;
  // A notification has no id, and the specification forbids a response to one.
  const isNotification = id === undefined || id === null;

  switch (method) {
    case 'initialize': {
      // Echo a protocol version the client asked for when it is one we can
      // speak, so a client on an older revision is not told to give up over a
      // server whose whole surface is one read-only tool.
      const asked = message.params && message.params.protocolVersion;
      return ok(id, {
        protocolVersion: typeof asked === 'string' && asked ? asked : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'deckhq', version: VERSION },
        instructions:
          'Call deckhq_waiting when the user asks what is waiting on them, what needs review, ' +
          'or what other agent sessions are blocked. It is read-only and local.',
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return isNotification ? null : ok(id, {});
    case 'tools/list':
      return ok(id, { tools: TOOLS });
    case 'tools/call': {
      const name = message.params && message.params.name;
      if (name !== 'deckhq_waiting') {
        return error(id, -32602, `Unknown tool: ${String(name)}`);
      }
      try {
        return ok(id, await callWaiting(deps));
      } catch (err) {
        // A failed tool call is reported inside the result, not as a protocol
        // error: the model should see what went wrong and carry on.
        return ok(id, {
          isError: true,
          content: [{ type: 'text', text: `DeckHQ could not be read: ${err.message}` }],
        });
      }
    }
    default:
      if (isNotification) return null;
      return error(id, -32601, `Method not found: ${String(method)}`);
  }
}

/** @param {any} id @param {any} result */
function ok(id, result) {
  return { jsonrpc: '2.0', id, result };
}

/** @param {any} id @param {number} code @param {string} message */
function error(id, code, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message } };
}

/**
 * The stdio transport: newline-delimited JSON in, newline-delimited JSON out.
 *
 * Requests are answered in the order they arrive rather than concurrently. The
 * server has one tool, that tool takes at most two seconds, and serialising
 * removes every interleaving question a client could otherwise ask.
 */
export function serve(input = process.stdin, output = process.stdout, deps = {}) {
  let buffer = '';
  /** @type {Promise<void>} */
  let queue = Promise.resolve();

  input.setEncoding('utf8');
  input.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      queue = queue.then(async () => {
        /** @type {any} */
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          write(output, error(null, -32700, 'Parse error'));
          return;
        }
        const response = await handle(message, deps).catch((err) =>
          error(message && message.id, -32603, `Internal error: ${err.message}`),
        );
        if (response) write(output, response);
      });
    }
  });
  input.on('error', () => {});
  return () => queue;
}

/** @param {any} output @param {any} message */
function write(output, message) {
  try {
    output.write(JSON.stringify(message) + '\n');
  } catch {
    /* the client hung up mid-answer */
  }
}

// Only serve when run as the process entry point, so the test can import the
// handlers without a transport attaching itself to the test runner's stdin.
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  serve();
}
