/**
 * POST /api/permission          the runtime's `PermissionRequest` hook. HELD.
 * POST /api/permission/decide   the panel's answer. The only decisive caller.
 *
 * WP-19. `docs/DEVIATIONS.md` §86 and §97, `docs/plan/08-PLAN-V2-100X.md` B4.
 *
 * This is the one route in the daemon that deliberately does NOT answer
 * quickly. `/api/hook` acknowledges in under 200 ms by contract because the
 * runtime is blocked on it (`src/http/routes/hooks.mjs`); this one is blocked
 * on a person, and holds the socket for as long as the runtime is willing to
 * wait. Two opposite contracts, so two routes — sharing one would have made
 * the sub-200 ms promise untestable.
 *
 * The terminal prompt is on screen the whole time this socket is open: the
 * runtime races the hook against its own UI and takes whichever answers first
 * (§86.4). So there is no failure mode here that blocks a session. A refused
 * connection, a closed daemon, an expired hold, a body the parser rejects —
 * all of them mean "the terminal decides", which is the correct outcome and
 * the reason a closed DeckHQ can never get in anybody's way.
 */
import { readJson, sendError, sendJson } from '../server.mjs';

/** The most of a hook payload we will read before giving up on it. */
const MAX_PAYLOAD = 512 * 1024;

/**
 * Serial number behind the fallback request key, and the reason it exists.
 *
 * §86.2 read `tool_use_id` out of the installed build and called it "the
 * natural correlation key". The first real `PermissionRequest` this project
 * ever received — Claude Code 2.1.260, 4 September, `docs/DEVIATIONS.md` §133
 * — **carries no `tool_use_id` at all**, so every request falls back to the
 * key minted here. A key of `session:timestamp` alone is not enough for that
 * to be the normal path: an agent making parallel tool calls raises two hands
 * milliseconds apart, and two requests landing in the same millisecond would
 * collide, which `Permissions.hold()` resolves by superseding — releasing the
 * first socket with `{}` and dropping its card. A counter makes the key
 * unique whatever the clock does.
 */
let fallbackSerial = 0;

/**
 * @param {import('../server.mjs').Router} router
 * @param {{registry:any, adapters:any, permissions:any, log:any}} ctx
 */
export function register(router, ctx) {
  const { adapters, log } = ctx;

  /** The holds live on ctx so the daemon can shut them down. */
  const permissions = () => ctx.permissions;

  /**
   * The runtime knocks. We do not answer.
   *
   * Everything that can go wrong here ends the same way — `{}`, an empty JSON
   * object, which the runtime reads as "no decision" and falls through to its
   * own prompt. Nothing in this handler can produce a decision; only the
   * `/decide` route below can.
   */
  router.post('/api/permission', (req, res) => {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    let aborted = false;

    const passOn = () => {
      // Not a decision. The terminal prompt wins.
      if (!res.headersSent) sendJson(res, 200, {});
    };

    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_PAYLOAD) {
        aborted = true;
        req.destroy();
        return;
      }
      chunks.push(c);
    });

    req.on('error', () => {
      try {
        res.end();
      } catch {
        /* already gone */
      }
    });

    req.on('end', () => {
      if (aborted) return passOn();
      let payload;
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        payload = raw ? JSON.parse(raw) : {};
      } catch (err) {
        log.warn('bad permission payload', err.message);
        return passOn();
      }

      const runtime = String(payload.runtime || 'claude-code');
      const adapter = adapters.getAdapter(runtime);
      const parse = adapter && adapter.hooks && adapter.hooks.permissionRequest;
      if (typeof parse !== 'function') {
        // A runtime whose adapter cannot read a permission payload has no
        // business being answered by us.
        log.warn(`no permission parser for runtime "${runtime}"`);
        return passOn();
      }

      let request;
      try {
        request = parse(payload);
      } catch (err) {
        log.warn('could not read a permission payload', err.message);
        return passOn();
      }
      if (!request || !request.sessionId) return passOn();

      const holder = permissions();
      if (!holder) return passOn();

      const held = holder.hold(
        {
          ...request,
          runtime,
          // `tool_use_id` is the correlation key when there is one (§86.2).
          // On the runtime measured in §133 there never is one, so the
          // fallback below is the normal path rather than the exception, and
          // it has to stay unique across requests that arrive together.
          id: request.id || `${request.sessionId}:${Date.now()}:${(fallbackSerial += 1)}`,
        },
        res,
      );
      if (!held) return passOn();
      log.info(`permission requested: ${request.tool} in ${request.sessionId}`);
      // No response is written here. That is the whole point.
    });
  });

  /**
   * The panel's answer, and the only path in the product that can produce a
   * decision. There is no timer, no heuristic and no allowlist behind it: a
   * human pressed one of three buttons.
   */
  router.post('/api/permission/decide', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    const id = String(body.id || '');
    const decision = String(body.decision || '');
    if (!id) return sendError(res, 400, 'A request id is required');
    if (decision !== 'allow' && decision !== 'deny' && decision !== 'session') {
      return sendError(res, 400, `Unknown decision "${decision}"`);
    }

    const runtime = String(body.runtime || 'claude-code');
    const adapter = adapters.getAdapter(runtime);
    const bodyFor = adapter && adapter.hooks && adapter.hooks.permissionDecisionBody;
    if (typeof bodyFor !== 'function') {
      return sendError(res, 400, `${runtime} cannot be answered from here`);
    }

    const holder = permissions();
    if (!holder) return sendError(res, 404, 'Nothing is waiting');

    const out = holder.decide(id, /** @type {any} */ (decision), bodyFor);
    if (!out.ok) return sendError(res, out.status, out.error);
    log.info(`permission ${id} answered: ${decision}`);
    return sendJson(res, 200, { ok: true, id, decision, sent: out.body });
  });
}
