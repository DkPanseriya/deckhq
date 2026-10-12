#!/usr/bin/env node
/**
 * The rehearsal's stand-in for `claude`: what answers a send on a demo floor
 * started with `--rehearsal` (`demo-args.mjs`).
 *
 * The sessions on a demo floor are invented, so there is no conversation for a
 * reply to continue and the real `claude` must never be started against one.
 * This is started in its place, through the daemon's `sendBin` seam, with the
 * argv the real binary would have been given:
 *
 *     --demo-port N  --resume <session id>  -p <text>  --output-format stream-json …
 *
 * It does two things, both of them the way Claude Code itself would:
 *
 *   1. posts `UserPromptSubmit` for that session to the daemon's real
 *      `/api/hook` endpoint, which is what makes the session a working one;
 *   2. writes one turn of `stream-json` on stdout, ending in a `result`.
 *
 * NO MODEL RAN, AND THE REPLY SAYS SO. The one line this answers is not written
 * to look like work: a rehearsal that invented an answer would be a picture of
 * a product doing something it did not do.
 *
 * It never posts `Stop`, so the session stays working, as one does after a
 * reply, until the floor's own stall clock has something to say.
 */

import http from 'node:http';

const argv = process.argv.slice(2);
const value = (/** @type {string} */ flag) => {
  const i = argv.indexOf(flag);
  return i >= 0 && i + 1 < argv.length ? argv[i + 1] : '';
};

const port = Number(value('--demo-port'));
const sessionId = value('--resume');
const text = value('-p');

/** What it answers. Plain, and true. */
const REHEARSAL_REPLY =
  'Rehearsal: no model ran. On a real session this is where the agent carries on.';

/**
 * POST one hook event, the way the installed hook command would.
 * @param {Record<string, unknown>} body
 * @returns {Promise<void>}
 */
function postHook(body) {
  return new Promise((resolve) => {
    if (!(port > 0)) return resolve();
    const payload = Buffer.from(JSON.stringify(body));
    const req = http.request(
      {
        host: '127.0.0.1',
        port,
        path: '/api/hook',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve());
      },
    );
    req.on('error', () => resolve());
    req.end(payload);
  });
}

/** One line on stdout, resolved when it has actually been written. */
function line(/** @type {unknown} */ event) {
  return new Promise((resolve) => process.stdout.write(`${JSON.stringify(event)}\n`, resolve));
}

if (!sessionId) {
  process.stderr.write('demo-claude: no --resume <session id>\n');
  process.exitCode = 2;
} else {
  await postHook({
    session_id: sessionId,
    cwd: process.cwd(),
    hook_event_name: 'UserPromptSubmit',
    runtime: 'claude-code',
    prompt: text,
  });
  await line({ type: 'system', subtype: 'init', session_id: sessionId });
  await line({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text: REHEARSAL_REPLY }] },
    session_id: sessionId,
  });
  await line({
    type: 'result',
    subtype: 'success',
    is_error: false,
    num_turns: 1,
    result: REHEARSAL_REPLY,
    session_id: sessionId,
  });
}
