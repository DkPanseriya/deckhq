/**
 * POST /api/ack             the six user-owned actions
 * GET  /api/conversation    read one session's real conversation
 * POST /api/send            run a turn in a session
 * POST /api/open            spawn a terminal attached to a session
 * POST /api/resume          resume a session in a terminal or the desktop app
 * GET  /api/resume-targets  which resume targets are available right now
 *
 * docs/02-ARCHITECTURE.md §5, §5.1.
 */
import path from 'node:path';
import { execFile } from 'node:child_process';
import { mkdir, stat } from 'node:fs/promises';
import { readJson, sendError, sendJson } from '../server.mjs';
import { discoverActions, openUrl, revealInFileManager, runAction } from '../../core/actions.mjs';
import { ACK_ACTIONS, splitAgentId } from '../../core/model.mjs';
import { RESUME_TARGETS } from '../../core/store.mjs';
import { SendHub } from '../../core/sends.mjs';

/**
 * `git init` in a directory. argv array, never a shell string — the path is
 * user input and must never be parsed by a shell.
 * @param {string} cwd
 */
function gitInit(cwd) {
  return new Promise((resolve, reject) => {
    execFile('git', ['init'], { cwd, timeout: 15_000 }, (err) => {
      if (err) reject(err);
      else resolve(undefined);
    });
  });
}

const SEND_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_SEND_CHARS = 100_000;

/**
 * @param {import('../server.mjs').Router} router
 * @param {{registry:any, adapters:any, log:any}} ctx
 */
export function register(router, ctx) {
  const { registry, store, log } = ctx;
  // WP-09's in-flight sends. An embedder that built its own ctx without one
  // gets a hub of its own rather than a crash on the first send.
  const sends = ctx.sends || (ctx.sends = new SendHub({ log }));

  /** @param {string} id */
  function adapterFor(id) {
    const { runtime } = splitAgentId(id);
    const adapter = ctx.adapters.getAdapter(runtime);
    if (!adapter) throw new Error(`Unknown runtime "${runtime}"`);
    return adapter;
  }

  router.post('/api/ack', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    const id = String(body.id || '');
    const action = String(body.action || '');
    if (!id) return sendError(res, 400, 'id is required');
    if (!(/** @type {readonly string[]} */ (ACK_ACTIONS).includes(action))) {
      return sendError(res, 400, `action must be one of ${ACK_ACTIONS.join(', ')}`);
    }
    try {
      const agent = await registry.act(id, action);
      return sendJson(res, 200, { ok: true, agent });
    } catch (err) {
      log.warn('ack failed', id, action, err.message);
      return sendError(res, 409, err.message);
    }
  });

  /**
   * Settle the floor: bench every idle agent in one go.
   *
   * A first run against a real machine inherits a long backlog — 50-odd
   * sessions, nearly all of them finished weeks ago — and walking each one to
   * the lounge by hand is not a reasonable ask. "Idle" means the session is
   * not live: its process is gone, so it is neither working nor able to
   * answer. Live sessions are left exactly as they are, whatever they are
   * doing, because those are the ones the floor exists to show.
   *
   * Archived sessions are skipped: they are let go, and the app's archive —
   * not this button — owns that.
   *
   * This is an explicit user action, so it is `act()` like any button press;
   * the invariant is untouched.
   */
  router.post('/api/settle', async (req, res) => {
    let benched = 0;
    const failed = [];
    for (const agent of registry.snapshot().agents || []) {
      if (agent.live) continue;
      if (agent.ackState !== 'active') continue;
      try {
        await registry.act(agent.id, 'bench');
        benched++;
      } catch (err) {
        failed.push({ id: agent.id, error: err.message });
      }
    }
    log.info(
      'settle: benched',
      benched,
      'idle agents',
      failed.length ? `(${failed.length} failed)` : '',
    );
    return sendJson(res, 200, { ok: true, benched, failed });
  });

  /**
   * Collapse a project room off the floor, or bring it back.
   *
   * A view preference, not agent state: it changes nothing about what is
   * captured or what any session is doing. An archived repo whose agents are
   * all idle drops off the floor entirely; one with an active agent stays
   * open regardless, so this can never hide somebody who is working.
   */
  router.post('/api/project-archive', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    const id = String(body.id || '');
    if (!id) return sendError(res, 400, 'id is required');
    const archived = body.archived !== false;

    const known = (registry.snapshot().projects || []).some((p) => p.id === id);
    if (!known) return sendError(res, 404, `no such project: ${id}`);

    registry.setProjectArchived(id, archived);
    return sendJson(res, 200, { ok: true, id, archived });
  });

  router.get('/api/conversation', async (req, res, url) => {
    const id = url.searchParams.get('id');
    if (!id) return sendError(res, 400, 'id is required');
    const maxMessages = Math.min(Number(url.searchParams.get('limit')) || 200, 1000);
    try {
      // Reading a conversation is a passive act. It must never touch ack state.
      const messages = await adapterFor(id).conversation(splitAgentId(id).sessionId, {
        maxMessages,
      });
      return sendJson(res, 200, { id, messages });
    } catch (err) {
      log.warn('conversation failed', id, err.message);
      return sendError(res, 500, err.message);
    }
  });

  /**
   * Run a turn in a session.
   *
   * WP-09. This answers **202 Accepted** the moment the child is spawned and
   * the turn's progress arrives on `GET /api/events?stream=send` as
   * `send` events carrying the `sendId` this hands back. The composer is
   * therefore handed back to the user in the time it takes to start a
   * process, not in the time it takes the model to think — which was the
   * open half of `docs/plan/01-AUDIT.md` F8.
   *
   * The whole turn is still awaited HERE, in the background, because two
   * things have to happen when it finishes and neither belongs to the
   * browser: the ledger entry, and the final result event.
   *
   * Sending is an explicit user action, so it may legitimately move observed
   * state. It does not touch `ackState`, and there is no /api/ack call
   * anywhere on this path — `2 Approve` reaches this route and nothing else
   * (THE INVARIANT, docs/01-PRODUCT.md §2).
   */
  router.post('/api/send', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    const id = String(body.id || '');
    const text = String(body.text ?? '');
    if (!id) return sendError(res, 400, 'id is required');
    if (!text.trim()) return sendError(res, 400, 'text is required');
    if (text.length > MAX_SEND_CHARS) return sendError(res, 413, 'Message too long');

    const agent = registry.agents.find((a) => a.id === id);
    if (!agent) return sendError(res, 404, 'Unknown session');

    let adapter;
    try {
      adapter = adapterFor(id);
    } catch (err) {
      return sendError(res, 404, err.message);
    }

    const { sendId, signal } = sends.begin({ agentId: id });

    // The turn, running in the background. Nothing below writes to `res`.
    const turn = adapter
      .send(splitAgentId(id).sessionId, text, {
        cwd: agent.cwd,
        timeoutMs: SEND_TIMEOUT_MS,
        signal,
        onEvent: (event) => sends.publish(sendId, event),
      })
      .then(
        (result) => {
          registry.noteSent?.(id, { chars: text.length, ok: result.ok !== false });
          // An adapter that produced no `result` event of its own — an older
          // runtime, a crash, a timeout — still has to close the turn on the
          // wire, or the panel would sit typing forever.
          if (!result.ok) {
            sends.publish(sendId, { type: 'error', error: result.error || 'Send failed' });
          }
          sends.publish(sendId, { type: 'done', ok: result.ok !== false });
          return result;
        },
        (err) => {
          log.warn('send failed', id, err.message);
          sends.publish(sendId, { type: 'error', error: err.message || 'Send failed' });
          sends.publish(sendId, { type: 'done', ok: false });
          return { ok: false, error: err.message };
        },
      )
      .finally(() => sends.end(sendId));

    // Awaited only so an unhandled rejection cannot escape; `turn` never
    // rejects, because `.then`'s second argument already absorbs it.
    turn.catch(() => {});

    return sendJson(res, 202, { ok: true, id, sendId });
  });

  /**
   * Start a new project: open a terminal running a fresh session in a
   * directory the user names. The room appears on the floor on the next scan,
   * because a project IS its directory — there is nothing else to create.
   */
  router.post('/api/new-project', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    const dir = String(body.cwd || body.path || '').trim();
    const runtime = String(body.runtime || 'claude-code');
    const wantCreate = body.create === true;
    const wantGitInit = body.gitInit === true;
    const instructions = String(body.instructions || '').trim();
    if (!dir) return sendError(res, 400, 'cwd is required');

    const adapter = ctx.adapters.getAdapter(runtime);
    if (!adapter) return sendError(res, 404, `Unknown runtime "${runtime}"`);
    if (typeof adapter.openNewSession !== 'function') {
      return sendError(res, 400, `${adapter.label} cannot start a new session`);
    }

    const resolved = path.resolve(dir);
    let exists = false;
    try {
      const info = await stat(resolved);
      if (!info.isDirectory()) return sendError(res, 400, 'That path is not a directory');
      exists = true;
    } catch {
      exists = false;
    }

    // A directory is only created when the user explicitly asked for it in
    // the dialog. Without that tick, a typo in a path is an error, not a new
    // folder somewhere unexpected on their disk.
    if (!exists) {
      if (!wantCreate) return sendError(res, 400, 'That directory does not exist');
      try {
        await mkdir(resolved, { recursive: true });
      } catch (err) {
        return sendError(res, 500, `Could not create that directory: ${err.message}`);
      }
    }

    if (wantGitInit) {
      try {
        await gitInit(resolved);
      } catch (err) {
        return sendError(res, 500, `Could not run git init: ${err.message}`);
      }
    }

    try {
      await adapter.openNewSession(resolved, {
        instructions,
        terminal: store.settings.terminal,
      });
      queuePendingIdentity(resolved, body.name, body.avatar);
      // Pick the new session up as soon as the runtime writes its transcript.
      setTimeout(() => registry.refresh().catch(() => {}), 2500);
      return sendJson(res, 200, { ok: true, cwd: resolved });
    } catch (err) {
      log.warn('new project failed', resolved, err.message);
      return sendError(res, 500, err.message);
    }
  });

  /**
   * Give an agent a short name and an avatar, or clear them.
   *
   * Identity is presentation only: it never touches ack state, and passing
   * `null` clears a field rather than deleting the MK numbering underneath.
   */
  router.post('/api/identity', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    const id = String(body.id || '');
    if (!id) return sendError(res, 400, 'id is required');
    if (!ctx.identity) return sendError(res, 500, 'Identity is unavailable');

    const agent = registry.agents.find((a) => a.id === id);
    if (!agent) return sendError(res, 404, 'Unknown session');

    /** @type {{name?: string|null, avatar?: string|null}} */
    const patch = {};
    if ('name' in body) patch.name = body.name;
    if ('avatar' in body) patch.avatar = body.avatar;
    if (Object.keys(patch).length === 0) {
      return sendError(res, 400, 'Give a name or an avatar to set');
    }

    const rec = ctx.identity.setDisplay(id, patch);
    await store.save();
    registry.emitNow?.();
    return sendJson(res, 200, { ok: true, id, ...rec });
  });

  /**
   * Start another session inside a project that already exists.
   *
   * This is what the in-room `+` does. The name and avatar are attached to the
   * session once it appears — they cannot be set before it exists, because the
   * session id is the runtime's to mint.
   */
  router.post('/api/agent', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    const cwd = String(body.cwd || '').trim();
    const runtime = String(body.runtime || 'claude-code');
    const instructions = String(body.instructions || '').trim();
    if (!cwd) return sendError(res, 400, 'cwd is required');

    const adapter = ctx.adapters.getAdapter(runtime);
    if (!adapter) return sendError(res, 404, `Unknown runtime "${runtime}"`);
    if (typeof adapter.openNewSession !== 'function') {
      return sendError(res, 400, `${adapter.label} cannot start a new session`);
    }

    const resolved = path.resolve(cwd);
    try {
      const info = await stat(resolved);
      if (!info.isDirectory()) return sendError(res, 400, 'That path is not a directory');
    } catch {
      return sendError(res, 400, 'That directory does not exist');
    }

    try {
      await adapter.openNewSession(resolved, {
        instructions,
        terminal: store.settings.terminal,
      });
      queuePendingIdentity(resolved, body.name, body.avatar);
      setTimeout(() => registry.refresh().catch(() => {}), 2500);
      return sendJson(res, 200, { ok: true, cwd: resolved });
    } catch (err) {
      log.warn('new agent failed', resolved, err.message);
      return sendError(res, 500, err.message);
    }
  });

  /**
   * A name and avatar chosen before the session existed, waiting for the scan
   * that discovers it. Applied to the newest session in that directory, then
   * dropped — so a queued identity can never attach itself to the wrong
   * session weeks later.
   * @type {{cwd:string, name?:string, avatar?:string, at:number}[]}
   */
  const pendingIdentities = [];
  const PENDING_TTL_MS = 5 * 60 * 1000;

  function queuePendingIdentity(cwd, name, avatar) {
    if (!name && !avatar) return;
    pendingIdentities.push({ cwd, name, avatar, at: Date.now() });
  }

  registry.on(() => {
    if (pendingIdentities.length === 0 || !ctx.identity) return;
    const now = Date.now();
    for (let i = pendingIdentities.length - 1; i >= 0; i--) {
      const p = pendingIdentities[i];
      if (now - p.at > PENDING_TTL_MS) {
        pendingIdentities.splice(i, 1);
        continue;
      }
      const match = registry.agents
        .filter((a) => path.resolve(a.cwd || '') === p.cwd && !a.displayName)
        .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))[0];
      if (!match) continue;
      ctx.identity.setDisplay(match.id, { name: p.name ?? null, avatar: p.avatar ?? null });
      store.save();
      pendingIdentities.splice(i, 1);
    }
  });

  /**
   * What a project's furniture can do. Discovered from conventional filenames
   * plus the repo's own optional `.deckhq.json`.
   */
  router.get('/api/actions', async (req, res, url) => {
    const projectId = url.searchParams.get('projectId') || '';
    const project = registry.snapshot().projects.find((p) => p.id === projectId);
    if (!project) return sendError(res, 404, 'Unknown project');
    try {
      const list = await discoverActions(project.cwd);
      return sendJson(res, 200, { projectId, cwd: project.cwd, actions: list });
    } catch (err) {
      return sendError(res, 500, err.message);
    }
  });

  /** Show a project's folder in the OS file manager. The shelf. */
  router.post('/api/reveal', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    const project = registry.snapshot().projects.find((p) => p.id === String(body.projectId || ''));
    if (!project) return sendError(res, 404, 'Unknown project');
    try {
      await revealInFileManager(project.cwd);
      return sendJson(res, 200, { ok: true, cwd: project.cwd });
    } catch (err) {
      log.warn('reveal failed', project.cwd, err.message);
      return sendError(res, 500, err.message);
    }
  });

  /**
   * Run one of a project's own scripts. The screen.
   *
   * The browser sends only an action ID. What that resolves to is decided here
   * from the project's directory, and the resolved file has already been
   * proved to exist inside it — the page can never supply a command.
   */
  router.post('/api/run', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    const projectId = String(body.projectId || '');
    const actionId = String(body.actionId || 'dashboard');
    const project = registry.snapshot().projects.find((p) => p.id === projectId);
    if (!project) return sendError(res, 404, 'Unknown project');

    try {
      const list = await discoverActions(project.cwd);
      const action = list.find((a) => a.id === actionId);
      if (!action) return sendError(res, 404, `That project has no "${actionId}" action`);
      if (action.kind === 'reveal') {
        await revealInFileManager(project.cwd);
        return sendJson(res, 200, { ok: true });
      }
      const out = await runAction(project.cwd, action);
      // A dashboard usually needs a moment to bind its port before the page
      // it serves will load.
      if (out.url) setTimeout(() => openUrl(out.url), 1500);
      return sendJson(res, 200, { ok: true, ran: action.label, url: out.url || null });
    } catch (err) {
      log.warn('run failed', projectId, actionId, err.message);
      return sendError(res, 500, err.message);
    }
  });

  router.post('/api/open', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    const id = String(body.id || '');
    if (!id) return sendError(res, 400, 'id is required');
    const agent = registry.agents.find((a) => a.id === id);
    if (!agent) return sendError(res, 404, 'Unknown session');
    try {
      await adapterFor(id).openInTerminal(splitAgentId(id).sessionId, agent.cwd, {
        terminal: store.settings.terminal,
      });
      return sendJson(res, 200, { ok: true });
    } catch (err) {
      log.warn('open failed', id, err.message);
      return sendError(res, 500, err.message);
    }
  });

  /**
   * Resume a session in whichever interface the user actually works in.
   * `target` defaults to their saved preference (`resumeIn`, from
   * /api/settings); passing one explicitly does not change that preference
   * — the panel POSTs to /api/settings itself when the user picks a
   * different default. Kept alongside, never replacing, /api/open above.
   */
  router.post('/api/resume', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    const id = String(body.id || '');
    if (!id) return sendError(res, 400, 'id is required');

    let target;
    if (body.target !== undefined && body.target !== null) {
      target = String(body.target);
      if (!(/** @type {readonly string[]} */ (RESUME_TARGETS).includes(target))) {
        return sendError(res, 400, `target must be one of ${RESUME_TARGETS.join(', ')}`);
      }
    } else {
      target = store.settings.resumeIn;
    }

    const agent = registry.agents.find((a) => a.id === id);
    if (!agent) return sendError(res, 404, 'Unknown session');

    let adapter;
    try {
      adapter = adapterFor(id);
    } catch (err) {
      return sendError(res, 404, err.message);
    }

    if (target === 'app' && typeof adapter.openInApp !== 'function') {
      return sendError(res, 400, `${adapter.label} cannot resume in the desktop app`);
    }

    try {
      if (target === 'app') {
        await adapter.openInApp(splitAgentId(id).sessionId, agent.cwd);
      } else {
        await adapter.openInTerminal(splitAgentId(id).sessionId, agent.cwd, {
          terminal: store.settings.terminal,
        });
      }
      return sendJson(res, 200, { ok: true, target });
    } catch (err) {
      log.warn('resume failed', id, target, err.message);
      return sendError(res, 500, err.message);
    }
  });

  /**
   * Which resume targets are actually usable right now, so the panel knows
   * whether to offer "Resume in app" at all. `id` (optional) resolves the
   * right runtime's adapter — a codex session, for instance, has no
   * `openInApp` regardless of what is installed. Defaults to the
   * `claude-code` adapter when no id is given.
   */
  router.get('/api/resume-targets', async (req, res, url) => {
    const id = url.searchParams.get('id') || '';
    const runtime = id ? splitAgentId(id).runtime : 'claude-code';
    const adapter = ctx.adapters.getAdapter(runtime);
    let appAvailable = false;
    try {
      appAvailable = Boolean(
        adapter && typeof adapter.appAvailable === 'function' && (await adapter.appAvailable()),
      );
    } catch (err) {
      log.warn('appAvailable check failed', runtime, err.message);
    }
    return sendJson(res, 200, { targets: RESUME_TARGETS, appAvailable });
  });
}
