/**
 * GET  /api/session-target   what the panel's one button would do, and why
 * POST /api/go               do it: raise the session's window, or resume it
 *
 * WP-100. The owner, 8 October: _"wherever that session is running — a
 * separate terminal, the Claude Code app, anything — can we open that
 * particular session, so one click and you are back to your working window."_
 *
 * The rule the two routes hold between them: **a session that is running is
 * gone to, and never started a second time.** `POST /api/resume` on a live
 * session is a second process appending to one transcript; this is what stands
 * in front of it. Only a session whose process has ended is resumed, and then
 * in the place the person chose in settings.
 *
 * `GET` decides and changes nothing — it reads the process table, and no
 * window moves. `POST` is the only thing that raises a window, it is reached
 * only by a click, a key or a palette command, and like every other mutating
 * route it is refused cross-site by the daemon's Origin check before it gets
 * here. The browser sends a session id and nothing else: which window, which
 * process and which command are all decided here.
 *
 * Neither route reaches `/api/ack`, and nothing here touches `ackState`:
 * being taken to a session says nothing about whether the person is done with
 * it (THE INVARIANT, docs/01-PRODUCT.md §2).
 */
import process from 'node:process';
import { readJson, sendError, sendJson } from '../server.mjs';
import { splitAgentId } from '../../core/model.mjs';
import { createFocusRunner } from '../../core/session-focus.mjs';
import { describeOutcome, goToPlan, resolveSessionWindow } from '../../core/session-window.mjs';
import { describeTerminal } from '../../core/terminals.mjs';

/**
 * How long one read of the process table answers for. A panel that opens asks
 * once and the click that follows asks again; inside this window the second
 * is free. Short, because a table is a fact about a moment.
 */
const TABLE_TTL_MS = 4000;

/**
 * @param {import('../server.mjs').Router} router
 * @param {{registry:any, adapters:any, log:any, store:any,
 *          sessionFocus?: import('../../core/session-focus.mjs').FocusRunner,
 *          sessionPid?: (agent:any) => Promise<number|null>,
 *          describeTerminal?: (opts:any) => Promise<{label:string|null}>}} ctx
 *   The last three are test seams, undefined in production: a test must never
 *   raise a window on somebody's desktop, never depend on what happens to be
 *   running on the host, and never probe it for a terminal.
 */
export function register(router, ctx) {
  const { registry, store, log } = ctx;
  const runner = ctx.sessionFocus || createFocusRunner();
  const terminalFor = ctx.describeTerminal || describeTerminal;

  /** @type {{pid:number, at:number, table:any}|null} */
  let cached = null;

  /** @param {number} pid @param {boolean} [fresh] */
  async function tableFor(pid, fresh = false) {
    const now = Date.now();
    if (!fresh && cached && cached.pid === pid && now - cached.at < TABLE_TTL_MS) {
      return cached.table;
    }
    const table = await runner.table(pid);
    cached = { pid, at: Date.now(), table };
    return table;
  }

  /**
   * Everything both routes need, decided once.
   * @param {string} id
   * @param {{fresh?:boolean}} [opts]
   */
  async function decide(id, opts = {}) {
    const agent = registry.agents.find((a) => a.id === id);
    if (!agent) return { status: 404, error: 'Unknown session' };

    // WP-41. A junior has no session of its own to be in: it runs inside its
    // lead's process, in its lead's window. So that is where it is gone to.
    let subject = agent;
    if (agent.subagent === true) {
      subject = registry.agents.find((a) => a.id === agent.parentId) || null;
      if (!subject) {
        return { status: 409, error: 'That junior’s lead is no longer on the floor.' };
      }
    }

    const { runtime, sessionId } = splitAgentId(subject.id);
    const adapter = ctx.adapters.getAdapter(runtime);
    if (!adapter) return { status: 404, error: `Unknown runtime "${runtime}"` };

    const reportsPid = Boolean(ctx.sessionPid) || typeof adapter.sessionPid === 'function';
    let pid = null;
    try {
      pid = ctx.sessionPid
        ? await ctx.sessionPid(subject)
        : reportsPid
          ? await adapter.sessionPid(sessionId)
          : null;
    } catch (err) {
      log.warn('session pid lookup failed', subject.id, err.message);
    }

    const support = await runner.support();
    let target = null;
    if (pid != null && support.supported) {
      try {
        target = resolveSessionWindow({
          pid,
          table: await tableFor(pid, opts.fresh),
          cwd: subject.cwd,
          selfPid: process.pid,
        });
      } catch (err) {
        log.warn('could not read the process table', err.message);
        target = {
          ok: false,
          reason: 'no-window',
          message: `DeckHQ could not ask this machine where it is: ${err.message}`,
        };
      }
    }

    let appAvailable = false;
    let terminalLabel = null;
    if (pid == null) {
      // Only an ended session is resumed, so only then is it worth finding
      // out where. Neither answer is allowed to fail the request.
      try {
        appAvailable = Boolean(
          typeof adapter.appAvailableFor === 'function'
            ? await adapter.appAvailableFor(sessionId)
            : typeof adapter.openInApp === 'function' &&
                typeof adapter.appAvailable === 'function' &&
                (await adapter.appAvailable()),
        );
      } catch {
        appAvailable = false;
      }
      try {
        terminalLabel = (await terminalFor({ pin: store.settings.terminal })).label || null;
      } catch {
        terminalLabel = null;
      }
    }

    const plan = goToPlan({
      agent: subject,
      pid,
      reportsPid,
      runtimeLabel: adapter.label || runtime,
      support,
      target,
      resume: {
        preference: store.settings.resumeIn === 'app' ? 'app' : 'terminal',
        appAvailable,
        terminalLabel,
      },
    });
    if (agent !== subject && plan.action === 'focus') {
      plan.label = 'Go to its lead’s session';
    }
    return { status: 200, agent, subject, adapter, sessionId, pid, support, target, plan };
  }

  router.get('/api/session-target', async (req, res, url) => {
    const id = url.searchParams.get('id') || '';
    if (!id) return sendError(res, 400, 'id is required');
    const d = await decide(id);
    if (d.status !== 200) return sendError(res, d.status, d.error);
    // A junior of an ENDED lead has nothing to be resumed into: `--resume
    // <agentId>` opens nothing (WP-41). The panel shows no button for it.
    const action = d.agent !== d.subject && d.plan.action === 'resume' ? 'none' : d.plan.action;
    return sendJson(res, 200, {
      id,
      action,
      label: d.plan.label,
      detail: d.plan.detail,
      disabled: d.plan.disabled,
      resumeTarget: d.plan.resumeTarget,
      supported: d.support.supported,
      verified: d.support.verified,
      where:
        d.target && d.target.ok
          ? {
              kind: d.target.kind,
              label: d.target.label,
              windowTitle: d.target.windowTitle,
              tabTitle: d.target.tabTitle,
            }
          : null,
    });
  });

  router.post('/api/go', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    const id = String(body.id || '');
    if (!id) return sendError(res, 400, 'id is required');

    let d = await decide(id);
    if (d.status !== 200) return sendError(res, d.status, d.error);

    if (d.plan.action === 'resume') {
      if (d.agent !== d.subject) {
        return sendError(res, 409, 'A junior is resumed by its lead carrying on, not on its own.');
      }
      const target = d.plan.resumeTarget === 'app' ? 'app' : 'terminal';
      try {
        if (target === 'app') {
          await d.adapter.openInApp(d.sessionId, d.subject.cwd);
        } else {
          await d.adapter.openInTerminal(d.sessionId, d.subject.cwd, {
            terminal: store.settings.terminal,
            codexBin: store.settings.codexBin,
          });
        }
        return sendJson(res, 200, {
          ok: true,
          did: 'resume',
          target,
          message: target === 'app' ? 'Opened in the desktop app' : 'Opened in a terminal',
        });
      } catch (err) {
        log.warn('go: resume failed', id, target, err.message);
        return sendError(res, 500, err.message);
      }
    }

    if (d.plan.disabled || !d.target || d.target.ok !== true) {
      return sendJson(res, 409, {
        error: d.plan.detail || 'That session’s window could not be found.',
        reason: d.target && d.target.ok === false ? d.target.reason : 'unsupported',
      });
    }

    // The desktop app is one window for every session in it, so raising it is
    // only half of arriving: it is first handed the session's own link, which
    // it answers by showing that session. A session the app has no record of
    // still gets the window, and is told so.
    let opened = false;
    if (d.target.kind === 'app' && typeof d.adapter.openInApp === 'function') {
      try {
        await d.adapter.openInApp(d.sessionId, d.subject.cwd);
        opened = true;
      } catch (err) {
        log.debug('go: the app was not handed a link', id, err.message);
      }
    }

    let result;
    try {
      result = await runner.focus(d.target);
    } catch (first) {
      // The window was found a moment ago and is gone, or its handle is now
      // somebody else's. Look once more, from a fresh table, before saying so.
      d = await decide(id, { fresh: true });
      if (d.status !== 200 || !d.target || d.target.ok !== true) {
        log.warn('go: focus failed', id, first.message);
        return sendJson(res, 409, {
          error: `That session’s window could not be raised: ${first.message}`,
          reason: 'no-window',
        });
      }
      try {
        result = await runner.focus(d.target);
      } catch (second) {
        log.warn('go: focus failed twice', id, second.message);
        return sendJson(res, 409, {
          error: `That session’s window could not be raised: ${second.message}`,
          reason: 'no-window',
        });
      }
    }

    return sendJson(res, 200, {
      ok: true,
      did: 'focus',
      foreground: result.foreground,
      where: { kind: d.target.kind, label: d.target.label },
      message: describeOutcome(d.target, { ...result, opened }),
    });
  });
}
