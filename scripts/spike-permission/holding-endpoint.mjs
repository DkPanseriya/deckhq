/**
 * ============================================================================
 * NOT PRODUCT CODE. Throwaway spike artefact for WP-19. Do not import from
 * `src/`, do not extend, do not ship. It exists so the finding in
 * docs/DEVIATIONS.md "WP-19 spike" is reproducible by hand on any machine.
 * Delete it when the WP-19 build lands.
 * ============================================================================
 *
 * A stand-in for the DeckHQ daemon's future `PermissionRequest` endpoint. It
 * does the one thing the spike needed to pin down: accept Claude Code's
 * `PermissionRequest` hook POST, hold the HTTP response open while a human
 * decides somewhere else, then answer with the decision in the shape the
 * runtime actually accepts.
 *
 * How to run it
 * -------------
 *   node scripts/spike-permission/holding-endpoint.mjs            # port 4319
 *
 * Then, in another terminal, start a Claude Code session that points at it
 * WITHOUT touching your real settings — `--settings` takes a file path and
 * layers on top of the normal scopes:
 *
 *   claude --settings scripts/spike-permission/settings.sample.json
 *
 * Ask it to run a Bash command. The terminal prompt appears AND this process
 * prints the pending request. Answer it here:
 *
 *   curl -X POST 127.0.0.1:4319/decide -d '{"id":"<id>","decision":"allow"}'
 *   curl -X POST 127.0.0.1:4319/decide -d '{"id":"<id>","decision":"deny"}'
 *   curl -X POST 127.0.0.1:4319/decide -d '{"id":"<id>","decision":"session"}'
 *
 * The terminal prompt is dismissed and the session continues. Answering in the
 * terminal instead cancels the hook — both surfaces stay live, first answer
 * wins.
 *
 * `GET /pending` lists what is waiting. Nothing is persisted anywhere.
 */

import http from 'node:http';

const PORT = Number(process.argv[2] || 4319);

/**
 * Requests we are holding open, keyed by `tool_use_id`.
 * @type {Map<string, {payload:any, res:import('node:http').ServerResponse, at:number}>}
 */
const pending = new Map();

/**
 * The response body the installed Claude Code (verified on 2.1.231) accepts.
 * Note `decision` is an OBJECT discriminated on `behavior` — not the bare
 * string the prose docs show — and "allow for this session" is expressed as a
 * permission update with `destination: "session"`, not a separate behaviour.
 *
 * @param {'allow'|'deny'|'session'} decision
 * @param {any} payload the hook input, whose `permission_suggestions` carry
 *   the exact rules the terminal prompt would have offered
 */
function decisionBody(decision, payload) {
  if (decision === 'deny') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PermissionRequest',
        decision: {
          behavior: 'deny',
          message: 'Denied from DeckHQ.',
          // interrupt: true would also abort the turn. Deliberately not set:
          // a denial should leave the session able to carry on.
        },
      },
    };
  }

  const suggestions = Array.isArray(payload?.permission_suggestions)
    ? payload.permission_suggestions
    : [];

  // Echo the runtime's own suggestions back, retargeted at the session, so
  // "Allow for this session" adds exactly the rule the terminal would have.
  const forSession = suggestions
    .filter((s) => s && s.type === 'addRules')
    .map((s) => ({ ...s, destination: 'session' }));

  return {
    hookSpecificOutput: {
      hookEventName: 'PermissionRequest',
      decision: {
        behavior: 'allow',
        ...(decision === 'session' && forSession.length > 0
          ? { updatedPermissions: forSession }
          : {}),
      },
    },
  };
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<any>}
 */
function readJson(req) {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} code
 * @param {any} body
 */
function sendJson(res, code, body) {
  const out = Buffer.from(JSON.stringify(body));
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': out.length });
  res.end(out);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);

  // The hook lands here. We do NOT answer yet.
  if (req.method === 'POST' && url.pathname === '/api/permission') {
    const payload = await readJson(req);
    const id = String(payload.tool_use_id || `no-id-${Date.now()}`);

    console.log(
      `\n[hand up] ${payload.tool_name} in ${payload.cwd}\n` +
        `  session ${payload.session_id}\n` +
        `  id      ${id}\n` +
        `  input   ${JSON.stringify(payload.tool_input)}\n` +
        `  suggest ${JSON.stringify(payload.permission_suggestions ?? [])}\n` +
        `  answer  curl -X POST 127.0.0.1:${PORT}/decide -d '{"id":"${id}","decision":"allow"}'`,
    );

    pending.set(id, { payload, res, at: Date.now() });

    // If the session gives up first (the user answered in the terminal, or the
    // 600 s hook timeout elapsed), drop it. Never answer a dead socket, and
    // never answer on a timer of our own.
    res.on('close', () => {
      if (pending.has(id)) {
        pending.delete(id);
        console.log(`[withdrawn] ${id} — the session stopped waiting`);
      }
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/pending') {
    return sendJson(res, 200, {
      pending: [...pending.entries()].map(([id, p]) => ({
        id,
        tool: p.payload.tool_name,
        session: p.payload.session_id,
        input: p.payload.tool_input,
        waitingMs: Date.now() - p.at,
      })),
    });
  }

  if (req.method === 'POST' && url.pathname === '/decide') {
    const body = await readJson(req);
    const id = String(body.id || '');
    const decision =
      body.decision === 'deny' ? 'deny' : body.decision === 'session' ? 'session' : 'allow';
    const held = pending.get(id);
    if (!held) return sendJson(res, 404, { error: `nothing pending for "${id}"` });

    pending.delete(id);
    const answer = decisionBody(decision, held.payload);
    console.log(`[answered] ${id} -> ${decision} ${JSON.stringify(answer)}`);
    sendJson(held.res, 200, answer);
    return sendJson(res, 200, { ok: true, id, decision });
  }

  return sendJson(res, 404, { error: 'not found' });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`spike holding endpoint on http://127.0.0.1:${PORT}/api/permission`);
  console.log(
    `point a session at it: claude --settings scripts/spike-permission/settings.sample.json`,
  );
});
