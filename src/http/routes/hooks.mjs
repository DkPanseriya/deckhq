/**
 * GET  /api/hooks           what each adapter would write, and whether it has
 * POST /api/hooks/install   consent-gated install
 * POST /api/hooks/remove    exact removal
 * POST /api/hook            the callback the runtime itself calls
 *
 * docs/02-ARCHITECTURE.md §4.1, §5, §6.
 *
 * The hook callback must respond within 200 ms and must never block the
 * runtime, so it acknowledges first and processes on the next tick.
 */
import { readJson, sendError, sendJson } from '../server.mjs';
import { DEFAULT_PORT } from '../../adapters/claude-code/hooks.mjs';

/**
 * @param {import('../server.mjs').Router} router
 * @param {{registry:any, adapters:any, log:any, port:any, refreshHookStatus?:any}} ctx
 *   `port` was read and `refreshHookStatus` written without either being
 *   declared (WP-22).
 */
export function register(router, ctx) {
  const { registry, adapters, log } = ctx;

  /** The port this daemon actually bound, known once the listener is up. */
  const port = () => ctx.port ?? DEFAULT_PORT;

  async function statusFor(adapter) {
    let installed = false;
    let plan = null;
    let error = null;
    let installedAtPort = null;
    let viaPlugin = false;
    /** @type {{key:string, file:string}|null} */
    let blockedByPolicy = null;
    try {
      plan = adapter.hooks.describe(port());
      if (adapter.hooks.supported) {
        installed = await adapter.hooks.installed(port());
        installedAtPort = (await adapter.hooks.installedPort?.()) ?? null;
        viaPlugin = Boolean(await adapter.hooks.pluginInstalled?.());
        // WP-56. A managed policy can switch these hooks off over DeckHQ's
        // head, and the result is indistinguishable from a broken install
        // everywhere else: the file is right, the port is right, nothing
        // arrives (`docs/DEVIATIONS.md` §86.4, §115). Never fails the status.
        if (installed || viaPlugin) {
          try {
            const found = await adapter.hooks.blockedByPolicy?.({
              port: installedAtPort ?? port(),
              viaPlugin,
            });
            blockedByPolicy =
              found && found.key && found.file
                ? { key: String(found.key), file: String(found.file) }
                : null;
          } catch {
            blockedByPolicy = null;
          }
        }
      }
    } catch (err) {
      error = err.message;
    }
    return {
      runtime: adapter.id,
      label: adapter.label,
      supported: Boolean(adapter.hooks.supported),
      // WP-37. The plugin carries the same hook block and writes nothing into
      // the settings file, so a machine that installed it that way is
      // delivering exact events while `installed()` — which reads settings.json
      // — says no. Either route counts as installed.
      installed: installed || viaPlugin,
      viaPlugin,
      plan,
      error,
      port: port(),
      // Set only when hooks are present but aimed somewhere else — the one
      // failure mode that otherwise looks exactly like a working install. The
      // plugin's hook command discovers the port at run time, so it cannot
      // drift, and a stale settings-file entry beside a working plugin is not
      // a fault worth a banner.
      staleAtPort:
        !viaPlugin && installedAtPort != null && installedAtPort !== port()
          ? installedAtPort
          : null,
      // `{key, file}` when a managed settings key stops these hooks from
      // running, otherwise null. The header banner says so; there is no
      // button, because there is nothing on this side to press.
      blockedByPolicy,
      ...registry.hookHealthFor(adapter.id),
    };
  }

  router.get('/api/hooks', async (_req, res) => {
    const list = await Promise.all(adapters.getAdapters().map(statusFor));
    sendJson(res, 200, { adapters: list });
  });

  router.post('/api/hooks/install', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    const runtime = String(body.runtime || 'claude-code');
    if (body.consent !== true) {
      return sendError(res, 400, 'Explicit consent is required to write hooks');
    }
    const adapter = adapters.getAdapter(runtime);
    if (!adapter) return sendError(res, 404, `Unknown runtime "${runtime}"`);
    if (!adapter.hooks.supported) {
      return sendError(res, 400, `${adapter.label} does not support hooks`);
    }
    try {
      await adapter.hooks.install(port());
      await refreshHookStatus();
      return sendJson(res, 200, await statusFor(adapter));
    } catch (err) {
      log.error('hook install failed', runtime, err.message);
      return sendError(res, 500, err.message);
    }
  });

  router.post('/api/hooks/remove', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    const runtime = String(body.runtime || 'claude-code');
    const adapter = adapters.getAdapter(runtime);
    if (!adapter) return sendError(res, 404, `Unknown runtime "${runtime}"`);
    if (!adapter.hooks.supported) {
      return sendError(res, 400, `${adapter.label} does not support hooks`);
    }
    try {
      await adapter.hooks.remove();
      await refreshHookStatus();
      return sendJson(res, 200, await statusFor(adapter));
    } catch (err) {
      log.error('hook removal failed', runtime, err.message);
      return sendError(res, 500, err.message);
    }
  });

  router.post('/api/hook', (req, res) => {
    // Acknowledge immediately. The runtime is blocked until we answer.
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 512 * 1024) {
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      sendJson(res, 200, { ok: true });
      const raw = Buffer.concat(chunks).toString('utf8');
      setImmediate(() => {
        try {
          const payload = raw ? JSON.parse(raw) : {};
          // "Which tool is this" is a runtime-format question, so it is
          // answered by that runtime's adapter (docs/02-ARCHITECTURE.md §2).
          // An adapter that does not report tool events simply has no
          // `toolSummary`, and the floor draws no bubble for it.
          const adapter = adapters.getAdapter(String(payload.runtime || 'claude-code'));
          const toolSummary = adapter && adapter.hooks && adapter.hooks.toolSummary;
          const subagentEvent = adapter && adapter.hooks && adapter.hooks.subagentEvent;
          registry.applyHook(normaliseHookPayload(payload, toolSummary, subagentEvent));
        } catch (err) {
          log.warn('bad hook payload', err.message);
        }
      });
    });
    req.on('error', () => {
      try {
        res.end();
      } catch {
        /* already gone */
      }
    });
  });

  async function refreshHookStatus() {
    /** @type {Record<string, {supported:boolean, installed:boolean}>} */
    const status = {};
    for (const adapter of adapters.getAdapters()) {
      let installed = false;
      try {
        installed = adapter.hooks.supported
          ? (await adapter.hooks.installed(port())) ||
            Boolean(await adapter.hooks.pluginInstalled?.())
          : false;
      } catch {
        installed = false;
      }
      status[adapter.id] = { supported: Boolean(adapter.hooks.supported), installed };
    }
    registry.setHookStatus(status);
    return status;
  }

  // Expose it so the daemon can prime the status on boot.
  /** @type {any} */ (register).refreshHookStatus = refreshHookStatus;
  ctx.refreshHookStatus = refreshHookStatus;
}

/**
 * Claude Code posts its own payload shape. Normalise it into the shape the
 * registry expects, without assuming any particular key is present.
 * @param {Record<string, any>} p
 * @param {((payload: Record<string, any>) => {name:string,summary:string}|null)|undefined|null} [toolSummary]
 *   the adapter's own tool-payload parser (WP-52). Only consulted for
 *   `PreToolUse`, the one event that names a tool that is starting.
 * @param {((payload: Record<string, any>) => {agentId:string,parentSessionId:string|null}|null)|undefined|null} [subagentEvent]
 *   the adapter's own subagent-payload parser (WP-41). Only consulted for
 *   `SubagentStop`, and it returns null whenever the payload names no junior —
 *   in which case the event does exactly what it did before this package.
 */
function normaliseHookPayload(p, toolSummary, subagentEvent) {
  const hookEvent = String(p.hook_event_name || p.hookEventName || p.event || '');
  /** @type {{name:string,summary:string}|null} */
  let tool = null;
  if (hookEvent === 'PreToolUse' && typeof toolSummary === 'function') {
    try {
      tool = toolSummary(p) || null;
    } catch {
      // A payload the adapter cannot make sense of is not an error worth
      // failing the whole event over: the rest of it still applies.
      tool = null;
    }
  }
  /** @type {{agentId:string, parentSessionId:string|null}|null} */
  let subagent = null;
  if (hookEvent === 'SubagentStop' && typeof subagentEvent === 'function') {
    try {
      subagent = subagentEvent(p) || null;
    } catch {
      subagent = null;
    }
  }
  return {
    runtime: String(p.runtime || 'claude-code'),
    sessionId: String(p.session_id || p.sessionId || ''),
    hookEvent,
    cwd: String(p.cwd || p.workspace || ''),
    matcher: String(p.matcher || p.notification_type || p.type || ''),
    message: String(p.message || ''),
    tool,
    subagent,
    at: Date.now(),
    payload: p,
  };
}
