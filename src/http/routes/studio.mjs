/**
 * `/api/studio/*` — WP-66's half of `docs/07-STUDIO-DESIGN.md` §5.3.
 *
 *   GET  /api/studio?project=            consent state, blueprint, roster, board
 *   POST /api/studio/enable              `{cwd}` describes; `{cwd, confirm:true}` writes
 *   POST /api/studio/disable             removes tagged files only
 *   POST /api/studio/roster              replace the roster the user edited
 *   POST /api/studio/card                create, edit or MOVE a card
 *   GET  /api/studio/tracking?project=   §7's numbers — WP-71, in `studio-drift.mjs`
 *   POST /api/studio/pm-pass             a PM pass now — WP-71, likewise
 *   POST /api/studio/plan                start or continue the planner — WP-67
 *   POST /api/studio/hire                `{role}` or `{roles}` — worktrees, briefs, the spawn
 *   POST /api/studio/handover            Accept or Bounce — WP-70
 *
 * Loopback only, and a cross-site POST is refused before it reaches here, by
 * the guard in `src/daemon.mjs` that every other route stands behind. Nothing
 * in this file opens a socket or reads a transcript.
 *
 * ## The one thing that starts a process, and what it starts (WP-67)
 *
 * `POST /api/studio/plan` calls `adapter.openNewSession(project, …)` — the
 * same adapter method, with the same shape of options, that `/api/new-project`
 * calls when the user points DeckHQ at a directory. That is the whole point:
 * the planner is not a second kind of thing. It is a `claude` session in the
 * project directory, found by the ordinary scan, sitting at an ordinary desk,
 * answered from the ordinary panel over `SendHub` (§9 invariant 4). Continuing
 * the interview is the composer, not an endpoint.
 *
 * **Studio writes none of the three artefacts.** The planner writes them, as
 * files, with its own tools; this route reads them back through `StudioStore`
 * and validates them. Nothing below has a code path that produces a
 * `blueprint.md`, a `roster.json` or a `board.json`, and the only file this
 * route ever writes is the planner's own brief.
 *
 * ## The one rule this route exists to hold
 *
 * **`POST /api/studio/card` is the only place in the HTTP layer that writes a
 * card's column** (§5.2). Not "the only place that should"; the only place
 * that does, asserted by `test/unit/studio-invariant.test.mjs`, which reads
 * this file and `src/studio/` and fails on a second writer. The only other
 * writer in the tree is `blockForBudget()`, which may write `blocked` and
 * nothing else.
 *
 * And within this route, a column moves on `op: 'move'` alone. `op: 'edit'`
 * carrying a column is REFUSED rather than quietly ignored: a request that
 * meant to move a card and was silently answered with "I changed the title"
 * is how a board stops being trustworthy.
 *
 * ## Consent
 *
 * Every write below `enable` requires a grant for that project — `state.json`'s
 * `studio.consent[projectKey]` — and answers 403 without one. Reading does
 * not: `GET /api/studio` is how the page finds out whether there is a grant,
 * so requiring one would make the answer unreachable.
 */
import fs from 'node:fs';
import path from 'node:path';

import { readJson, sendError, sendJson } from '../server.mjs';
import { now as clockNow } from '../../core/clock.mjs';
import { DATA_DIR } from '../../core/paths.mjs';
import { samePath } from '../../core/same-path.mjs';
import { projectKeyFor } from '../../core/ledger-record.mjs';
import { StudioPathError } from '../../studio/paths.mjs';
import { StudioStore } from '../../studio/store.mjs';
import { COLUMNS, MAX_CARDS, appendMove, validateBoard } from '../../studio/schema.mjs';
import { PLANNER_KICKOFF, ensurePlannerBrief } from '../../studio/brief.mjs';
import { UNVERIFIED_LAUNCH, registerHire } from './studio-hire.mjs';
import { registerHandover } from './studio-handover.mjs';
import { registerDrift } from './studio-drift.mjs';
import { readHandovers } from '../../studio/handover.mjs';
import { roleBriefRel } from '../../studio/brief-role.mjs';
import { checkRoleName, worktreePathFor } from '../../studio/worktree.mjs';
import {
  describeDisable,
  describeEnable,
  disable as disableStudio,
  enable as enableStudio,
  plannedPaths,
} from '../../studio/consent.mjs';

/**
 * The one runtime that has a planner brief — WP-67, and `docs/ADAPTERS.md` §6.
 *
 * The brief in `src/studio/briefs/planner.md` was written for Claude Code and
 * has been run against it. Handing it to Codex, Gemini CLI or OpenCode would be
 * claiming a thing nobody has measured, so those are refused **by name** with
 * the reason, rather than attempted and half-working. WP-68 is where a second
 * runtime is measured.
 */
const PLANNER_RUNTIME = 'claude-code';

/**
 * How long a started planner is waited for before the wait is given up.
 *
 * Ten minutes, which is `PENDING_IDENTITY_TTL_MS` and is the same number for
 * the same reason: what is being waited for is a terminal window opening and a
 * runtime writing its first transcript line, which is seconds. Restated rather
 * than imported, because the two are allowed to diverge — one is about a name
 * and one is about an id — and `test/integration/studio-plan.test.mjs` asserts
 * this one on its own.
 */
export const PLANNER_WAIT_MS = 10 * 60 * 1000;

/**
 * The session a planner spawn turned into, or null.
 *
 * The newest session in the project's directory that this build has not
 * already recorded as somebody's planner — `createPendingIdentities`' match
 * rule, for its reason: the session that has just started is the newest one,
 * and two projects must never claim one session. There is no private list
 * here and no second scan; this reads the registry's own agents and picks one
 * by its id (§9 invariant 4).
 *
 * @param {Array<{id?:string, cwd?:string, runtime?:string, lastActivityAt?:number}>} agents
 * @param {string} root resolved project directory
 * @param {Set<string>} taken agent ids already recorded as a planner
 */
export function plannerAmong(agents, root, taken) {
  return (
    (Array.isArray(agents) ? agents : [])
      .filter(
        (a) =>
          a &&
          typeof a.id === 'string' &&
          !taken.has(a.id) &&
          String(a.runtime || '') === PLANNER_RUNTIME &&
          samePath(a.cwd, root),
      )
      .sort((a, b) => (b.lastActivityAt || 0) - (a.lastActivityAt || 0))[0] || null
  );
}

/**
 * The project directory a request names, resolved, or a reason it was refused.
 *
 * Absolute and existing, both checked: a relative path would be resolved
 * against whatever directory the daemon happens to have been started in, which
 * is not something the user chose.
 *
 * @param {unknown} raw
 * @returns {{root:string, projectKey:string}|{error:string}}
 */
export function resolveProject(raw) {
  const value = typeof raw === 'string' ? raw.trim() : '';
  if (!value) return { error: 'a project directory is required' };
  if (value.includes('\0')) return { error: 'that is not a path' };
  if (!path.isAbsolute(value)) {
    return { error: `"${value}" is not an absolute path, and a relative one names no project` };
  }
  const root = path.resolve(value);
  let stat;
  try {
    stat = fs.statSync(root);
  } catch {
    return { error: `${root} does not exist` };
  }
  if (!stat.isDirectory()) return { error: `${root} is not a directory` };
  return { root, projectKey: projectKeyFor(root) };
}

/**
 * The roster's roles, as the page needs them — WP-68, §4.
 *
 * Six things per role that the snapshot on its own does not say:
 *
 *   `live`      the recorded `agentId` is STILL a session on the floor. Read
 *               out of the registry here rather than remembered, so a role
 *               whose terminal the user closed reads as unhired within one
 *               scan instead of staying hired for ever.
 *   `worktree`  where its worktree is, or would be.
 *   `brief`     where its brief is, or would be.
 *   `hireable`  and, when it is not, the named reason — `checkRoleName()`'s,
 *               the same one a Hire would answer with. A role name the planner
 *               suggested and git will not take says so on the card rather
 *               than on the press.
 *   `runtime`   what the live session actually IS, read off the registry. The
 *               roster carries no runtime field on purpose (§4: roles are the
 *               user's property and a runtime is a launch decision, not a
 *               property of the role), so the honest answer for an unhired
 *               role is `null` rather than a guess.
 *   `unverified` §4's *unverified launch* sentence when that runtime has one,
 *               so the roster line can say what cannot be known about a Codex,
 *               Gemini CLI or OpenCode session instead of drawing it like a
 *               Claude Code one.
 *
 * Pure apart from the agent list it is handed.
 *
 * @param {any} snap `StudioStore.snapshot()`
 * @param {string} root the project directory
 * @param {Array<{id?:string, runtime?:string}>} agents the registry's own agents
 * @param {string} [dataDir]
 */
export function rolesOf(snap, root, agents, dataDir = DATA_DIR) {
  /** id → runtime, for the two answers below that both need the same lookup. */
  const live = new Map(
    (agents || []).filter((a) => a?.id).map((a) => [a.id, String(a.runtime || '')]),
  );
  const roles = snap?.roster?.roster?.roles || [];
  return roles.map((role) => {
    const name = String(role.name || '');
    const checked = checkRoleName(name);
    const ok = !('error' in checked);
    const isLive = Boolean(role.agentId && live.has(role.agentId));
    const runtime = isLive ? live.get(role.agentId) || null : null;
    return {
      name,
      purpose: role.purpose || '',
      agentId: role.agentId || null,
      live: isLive,
      runtime,
      unverified: (runtime && UNVERIFIED_LAUNCH[runtime]) || null,
      hireable: ok,
      refusal: ok ? null : checked.error,
      reason: ok ? null : checked.reason,
      worktree: ok ? worktreePathFor(dataDir, root, name) : null,
      brief: ok ? path.join(snap.dir, roleBriefRel(name)) : null,
    };
  });
}

/**
 * The next free `c<n>` on this board. Ids are the user's to read and to type
 * into a handover filename, so they are short and sequential rather than
 * random.
 * @param {{cards:Array<{id:string}>}} board
 */
export function nextCardId(board) {
  let max = 0;
  for (const card of board.cards || []) {
    const m = /^c(\d+)$/.exec(String(card.id || ''));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `c${max + 1}`;
}

/**
 * @param {import('../server.mjs').Router} router
 * @param {{store:any, log:any, dataDir?:string, registry?:any, adapters?:any,
 *          pendingIdentities?:any, launchTerminal?:(opts:any) => Promise<any>,
 *          studioWatchOptions?:{pollMs?:number, debounceMs?:number},
 *          stopStudioWatch?:() => void,
 *          studioHandoverSettled?:() => Promise<any>,
 *          studioDriftTick?:() => Promise<any>}} ctx
 *   WP-67 added the last four. `registry` is read for one thing and one thing
 *   only — whether an agent id is still a session on the floor — and never
 *   copied; `launchTerminal` is the test seam `src/daemon.mjs` documents.
 */
export function register(router, ctx) {
  const dataDir = ctx.dataDir || DATA_DIR;
  const { store } = ctx;

  /**
   * Start watching one project's handovers. Assigned at the bottom of this
   * function, where WP-70's half is registered; inert until then, so the
   * order the two halves are wired in cannot matter.
   * @type {(root:string) => void}
   */
  let startWatching = () => {};

  /** The grant for a project, or null. */
  const consentFor = (projectKey) => store.studioConsentFor?.(projectKey) ?? null;

  /**
   * Read the body, resolve the project, and answer the two ways it can fail.
   * @returns {Promise<{root:string, projectKey:string, body:any}|null>}
   */
  const projectFromBody = async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      sendError(res, 400, err.message);
      return null;
    }
    if (!body || typeof body !== 'object') {
      sendError(res, 400, 'expected an object');
      return null;
    }
    const project = resolveProject(body.cwd ?? body.project);
    if ('error' in project) {
      sendError(res, 400, project.error);
      return null;
    }
    return { ...project, body };
  };

  /** A write path with no grant behind it stops here. */
  const requireConsent = (res, projectKey, root) => {
    const consent = consentFor(projectKey);
    if (!consent) {
      sendError(
        res,
        403,
        `Studio is not enabled for ${root}. POST /api/studio/enable with { confirm: true } first; ` +
          'consent is per project and is never inferred from another.',
      );
      return null;
    }
    return consent;
  };

  // -------------------------------------------------------------------------
  // GET /api/studio
  // -------------------------------------------------------------------------

  router.get('/api/studio', (_req, res, url) => {
    const project = resolveProject(url.searchParams.get('project'));
    if ('error' in project) return sendError(res, 400, project.error);
    const studio = new StudioStore(project.root, { log: ctx.log });
    const consent = consentFor(project.projectKey);
    // WP-67. The planner, as an id and whether that id is still a session on
    // the floor — read out of the registry here rather than remembered, so a
    // planner the user closed reads as gone within one scan instead of being a
    // link to nothing.
    const snap = studio.snapshot();
    const planner = store.studioPlannerFor?.(project.projectKey) || null;
    const plannerLive = planner
      ? (ctx.registry?.agents || []).some((a) => a.id === planner.agentId)
      : false;
    sendJson(res, 200, {
      project: project.root,
      projectKey: project.projectKey,
      dir: studio.dir,
      enabled: Boolean(consent),
      consent,
      planner: planner ? { ...planner, live: plannerLive } : null,
      // What enabling would write, so the page can draw the consent screen
      // without a second request, and so the screen is the same list the CLI
      // prints.
      wouldWrite: plannedPaths(project.root),
      columns: [...COLUMNS],
      studio: snap,
      // WP-68. The roster's roles, each with the three things a Hire row needs
      // and the page cannot work out for itself: whether the recorded
      // `agentId` is STILL a session on the floor, where its worktree would
      // go, and whether its name can be hired under at all. The refusal is
      // carried here rather than discovered on the press, so a name the
      // planner suggested and git will not take says so before it is clicked.
      roles: rolesOf(snap, project.root, ctx.registry?.agents || [], dataDir),
      // WP-70, §6. Every handover on disk, parsed into its four sections,
      // with the card it names — or `cardId: null`, which is the unattached
      // one: *"a handover for an unknown card id is shown unattached rather
      // than dropped"*. Read here rather than remembered, like the three
      // artefacts above it, so there is nothing cached to go stale and
      // nothing that could ever write one back.
      handovers: consent ? readHandovers(studio, snap?.board?.board?.cards || []) : [],
    });
  });

  // -------------------------------------------------------------------------
  // POST /api/studio/enable — describe, then write
  // -------------------------------------------------------------------------

  router.post('/api/studio/enable', async (req, res) => {
    const found = await projectFromBody(req, res);
    if (!found) return;
    const { root, projectKey, body } = found;
    const already = consentFor(projectKey);

    if (body.confirm !== true) {
      // §3 step 1 and WP-66 acceptance (1): every path it would write, and
      // NOT ONE BYTE written.
      return sendJson(res, 200, {
        ok: true,
        confirmed: false,
        enabled: Boolean(already),
        project: root,
        projectKey,
        paths: plannedPaths(root),
        describe: describeEnable(root),
        changed: false,
      });
    }

    if (already) {
      return sendJson(res, 200, {
        ok: true,
        confirmed: true,
        already: true,
        enabled: true,
        project: root,
        projectKey,
        consent: already,
        written: [],
        changed: false,
      });
    }

    try {
      const result = await enableStudio(root, { dataDir, store, now: clockNow() });
      await store.flush?.();
      // WP-70. The directory exists from this moment, so the watch on it
      // starts from this moment too — rather than at the next daemon start,
      // which is when a project enabled today would otherwise be looked at.
      startWatching(root);
      return sendJson(res, 200, {
        ok: true,
        confirmed: true,
        already: false,
        enabled: true,
        project: root,
        projectKey,
        dir: result.dir,
        consent: result.consent,
        written: result.written,
        dirs: result.dirs,
        changed: true,
      });
    } catch (err) {
      ctx.log.warn('studio enable failed', err?.message || err);
      return sendError(res, 409, err?.message || String(err));
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/studio/disable
  // -------------------------------------------------------------------------

  router.post('/api/studio/disable', async (req, res) => {
    const found = await projectFromBody(req, res);
    if (!found) return;
    const { root, projectKey, body } = found;

    if (body.confirm !== true) {
      const plan = describeDisable(root, { dataDir });
      return sendJson(res, 200, {
        ok: true,
        confirmed: false,
        project: root,
        projectKey,
        dir: plan.dir,
        wouldRemove: plan.tagged,
        wouldKeep: plan.others,
        changed: false,
      });
    }

    try {
      const result = await disableStudio(root, { dataDir, store });
      await store.flush?.();
      return sendJson(res, 200, {
        ok: true,
        confirmed: true,
        project: root,
        projectKey,
        dir: result.dir,
        removed: result.removed,
        missing: result.missing,
        // Named, not deleted: a file that no longer carries the marker, and
        // everything the user or an agent wrote.
        foreign: result.foreign,
        kept: result.kept,
        enabled: false,
        changed: true,
      });
    } catch (err) {
      ctx.log.warn('studio disable failed', err?.message || err);
      return sendError(res, 500, err?.message || String(err));
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/studio/roster
  // -------------------------------------------------------------------------

  router.post('/api/studio/roster', async (req, res) => {
    const found = await projectFromBody(req, res);
    if (!found) return;
    const { root, projectKey, body } = found;
    if (!requireConsent(res, projectKey, root)) return;

    const studio = new StudioStore(root, { log: ctx.log });
    try {
      const result = await studio.writeRoster({
        ...(body.roster && typeof body.roster === 'object' ? body.roster : {}),
        // The key is the project's, never the client's: a roster claiming to
        // belong to a different directory is a roster in the wrong place.
        projectKey,
      });
      if ('error' in result) {
        return sendJson(res, 400, { error: result.error, path: result.path, line: result.line });
      }
      return sendJson(res, 200, { ok: true, roster: result.roster, file: result.file });
    } catch (err) {
      return refusePath(res, err, ctx);
    }
  });

  // -------------------------------------------------------------------------
  // POST /api/studio/card — THE ONLY COLUMN WRITER
  // -------------------------------------------------------------------------

  router.post('/api/studio/card', async (req, res) => {
    const found = await projectFromBody(req, res);
    if (!found) return;
    const { root, projectKey, body } = found;
    if (!requireConsent(res, projectKey, root)) return;

    const op = typeof body.op === 'string' ? body.op.trim() : '';
    if (!['create', 'edit', 'move'].includes(op)) {
      return sendError(res, 400, 'op is one of create, edit or move');
    }

    const studio = new StudioStore(root, { log: ctx.log });
    let current;
    try {
      current = studio.readBoard();
    } catch (err) {
      return refusePath(res, err, ctx);
    }
    if (current.error) {
      // A board that does not parse is reported, not replaced. The user has
      // the path and the line, and their bytes are where they left them.
      return sendJson(res, 409, {
        error: current.error,
        path: current.errorPath,
        line: current.line,
      });
    }
    const board = { ...current.board, projectKey, cards: [...current.board.cards] };
    const at = clockNow();

    if (op === 'create') {
      if (board.cards.length >= MAX_CARDS) {
        return sendError(res, 400, `a board holds at most ${MAX_CARDS} cards`);
      }
      const patch = body.card && typeof body.card === 'object' ? body.card : {};
      const id =
        typeof patch.id === 'string' && patch.id.trim() ? patch.id.trim() : nextCardId(board);
      if (board.cards.some((c) => c.id === id)) {
        return sendError(res, 409, `there is already a card called "${id}"`);
      }
      // A new card starts in `backlog` unless the user named a column, which
      // they are entitled to do: creating a card straight into `done` is a
      // person recording something they already did.
      // A new card has no history: `moves` is written by a move and nothing
      // else, so a client that sent one is not believed.
      const fresh = { ...patch };
      delete fresh.moves;
      board.cards.push({
        ...fresh,
        id,
        column: typeof patch.column === 'string' ? patch.column : 'backlog',
        updatedAt: at,
      });
    } else {
      const cardId = typeof body.cardId === 'string' ? body.cardId.trim() : '';
      const index = board.cards.findIndex((c) => c.id === cardId);
      if (index === -1) return sendError(res, 404, `there is no card called "${cardId}"`);
      const before = board.cards[index];

      if (op === 'edit') {
        const patch = body.card && typeof body.card === 'object' ? { ...body.card } : {};
        // Refused rather than ignored. See the header.
        if ('column' in patch && patch.column !== before.column) {
          return sendError(
            res,
            400,
            'a card\'s column changes through op:"move" and nothing else. ' +
              'The column is yours: an edit that quietly moved a card would be a board you ' +
              'could not trust.',
          );
        }
        delete patch.column;
        delete patch.id;
        // WP-71. The move history belongs to the three column writers, so an
        // edit cannot rewrite the record "time on the card" is measured from.
        delete patch.moves;
        board.cards[index] = { ...before, ...patch, updatedAt: at };
      } else {
        const target = typeof body.column === 'string' ? body.column.trim() : '';
        if (!(/** @type {readonly string[]} */ (COLUMNS).includes(target))) {
          return sendError(
            res,
            400,
            `"${target}" is not a column. The six are ${COLUMNS.join(', ')}.`,
          );
        }
        // The move. One line, one funnel, and it is a user's press — and, from
        // WP-71, the record of it that §7's time on the card is measured from.
        board.cards[index] = {
          ...before,
          column: target,
          moves: appendMove(before.moves, before.column, target, at),
          updatedAt: at,
        };
      }
    }

    // Validated before it is written, so a card the client built badly is
    // refused with its path and its line rather than half-applied.
    const check = validateBoard(board, { raw: null });
    if ('error' in check) {
      return sendJson(res, 400, { error: check.error, path: check.path, line: check.line });
    }

    try {
      const written = await studio.writeBoard(check.board);
      if ('error' in written) {
        return sendJson(res, 400, { error: written.error, path: written.path, line: written.line });
      }
      return sendJson(res, 200, { ok: true, op, board: written.board, file: written.file });
    } catch (err) {
      return refusePath(res, err, ctx);
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/studio/tracking, POST /api/studio/pm-pass, and the budget stop
  // -------------------------------------------------------------------------

  // WP-71. Its own file, on `studio-hire.mjs`'s terms: §7's fold, §8's PM
  // pass and §8's hard stop — the THIRD column writer, which may reach
  // `blocked` and nothing else — with what each may not do in its header.
  const drift = registerDrift(router, ctx, { projectFromBody, consentFor, resolveProject });
  ctx.studioDriftTick = drift.tick;

  // -------------------------------------------------------------------------
  // POST /api/studio/plan — the planner session (WP-67, §2 Grill and §3)
  // -------------------------------------------------------------------------

  /**
   * Projects whose planner has been started and not yet seen by the scan.
   * `projectKey → { root, startedAt }`, at most one per project, emptied the
   * moment the scan hands one over or the wait runs out. Not a session list:
   * there is no session in it, by construction — it holds the directory we are
   * expecting one to appear in.
   * @type {Map<string, {root:string, startedAt:number}>}
   */
  const awaiting = new Map();

  /** Every agent id already spoken for, so two projects cannot claim one. */
  const takenPlanners = () =>
    new Set(Object.values(store.studioPlanner?.() || {}).map((p) => p.agentId));

  ctx.registry?.on?.(() => {
    if (awaiting.size === 0) return;
    const agents = ctx.registry.agents || [];
    const taken = takenPlanners();
    for (const [projectKey, want] of [...awaiting]) {
      // The wait is bounded by the same TTL a queued identity gets, and for
      // the same reason: what it is waiting for is a terminal opening and a
      // runtime writing its first transcript line. Longer than that is a
      // session that never arrived, and remembering it for ever would make
      // the next Plan press continue something that does not exist.
      if (clockNow() - want.startedAt > PLANNER_WAIT_MS) {
        awaiting.delete(projectKey);
        continue;
      }
      const found = plannerAmong(agents, want.root, taken);
      if (!found) continue;
      awaiting.delete(projectKey);
      taken.add(found.id);
      store.recordStudioPlanner(projectKey, { agentId: found.id, startedAt: want.startedAt });
      ctx.log.info(`studio planner for ${want.root} is ${found.id}`);
    }
  });

  router.post('/api/studio/plan', async (req, res) => {
    const found = await projectFromBody(req, res);
    if (!found) return;
    const { root, projectKey, body } = found;

    // Consent first, and with the hint. Studio writing the planner's brief is
    // a write inside `.deckhq/studio/`, and starting a session that has been
    // told to write three files there is the larger half of the same thing.
    const consent = consentFor(projectKey);
    if (!consent) {
      return sendError(
        res,
        409,
        `Studio is not enabled for ${root}. POST /api/studio/enable with { confirm: true }, or ` +
          `run \`deckhq studio enable "${root}" --yes\`, and you will be shown every path it ` +
          'would write first. Consent is per project and is never inferred from another.',
      );
    }

    const runtime = String(body.runtime || PLANNER_RUNTIME);
    if (runtime !== PLANNER_RUNTIME) {
      return sendError(
        res,
        400,
        `Studio's planner brief was written for Claude Code and has only ever been run against ` +
          `it, so "${runtime}" is refused rather than attempted. Handing it a brief nobody has ` +
          'measured it against would be a claim this project does not make (docs/ADAPTERS.md §6).',
      );
    }
    const adapter = ctx.adapters.getAdapter(runtime);
    if (!adapter) return sendError(res, 404, `Unknown runtime "${runtime}"`);
    if (typeof adapter.openNewSession !== 'function') {
      return sendError(res, 400, `${adapter.label} cannot start a new session`);
    }

    // Continue, rather than start a second one. §5.3 calls this endpoint
    // "start or continue the planner session", and continuing is the panel's
    // ordinary streaming send — so all this has to do is hand back the id.
    const known = store.studioPlannerFor?.(projectKey) || null;
    if (known && (ctx.registry?.agents || []).some((a) => a.id === known.agentId)) {
      return sendJson(res, 202, {
        ok: true,
        project: root,
        projectKey,
        started: false,
        agentId: known.agentId,
        startedAt: known.startedAt,
        note: 'this project already has a planner on the floor; answer it in the panel',
      });
    }
    if (known) store.forgetStudioPlanner?.(projectKey);

    const studio = new StudioStore(root, { log: ctx.log });
    /** @type {{file:string, written:boolean, beside:string|null}} */
    let brief;
    try {
      brief = await ensurePlannerBrief(studio);
    } catch (err) {
      return refusePath(res, err, ctx);
    }

    const startedAt = clockNow();
    try {
      await adapter.openNewSession(root, {
        // The brief is a FILE on the command line, never its own text (§4).
        systemPromptFile: brief.file,
        // One fixed sentence, with nothing of the user's in it.
        instructions: PLANNER_KICKOFF,
        terminal: store.settings.terminal,
        launch: ctx.launchTerminal,
      });
    } catch (err) {
      ctx.log.warn('studio plan failed', root, err?.message || err);
      return sendError(res, 500, err?.message || String(err));
    }

    // The same two lines `/api/new-project` runs after a spawn: a name waiting
    // for the session that is about to exist, and a scan sooner than the poll.
    ctx.pendingIdentities?.queue(root, 'Planner', null);
    awaiting.set(projectKey, { root, startedAt });
    setTimeout(() => ctx.registry?.refresh?.().catch(() => {}), 2500);

    // 202, and the id is honestly absent: the session id is the runtime's to
    // mint and the scan's to find, and answering with one now would mean
    // inventing it. The page watches `GET /api/studio` for `planner.agentId`.
    return sendJson(res, 202, {
      ok: true,
      project: root,
      projectKey,
      started: true,
      agentId: null,
      startedAt,
      brief: brief.file,
      // §6.1: an edited brief is never overwritten; the regeneration is beside
      // it, and the user's is what the session just started under.
      briefWritten: brief.written,
      briefBeside: brief.beside,
      note: 'the planner appears on the floor within one scan; answer it in the panel',
    });
  });

  // -------------------------------------------------------------------------
  // The two that still need a package, and say so
  // -------------------------------------------------------------------------

  // WP-68. Its own file: hiring is a worktree, a brief and a spawn per role,
  // and none of it belongs in the route that reads three artefacts back. It is
  // handed the two helpers above so a Hire reads a body and answers a missing
  // grant exactly as every other write here does.
  registerHire(router, ctx, { projectFromBody, consentFor });

  // WP-70. Its own file, on `studio-hire.mjs`'s terms: the directory watch
  // that FLAGS a card, and the one route besides `/api/studio/card` that may
  // write a column — and only after the user has named it.
  const handover = registerHandover(router, ctx, {
    projectFromBody,
    consentFor,
    watchOptions: ctx.studioWatchOptions,
  });
  ctx.stopStudioWatch = () => {
    handover.stop();
    drift.stop();
  };
  ctx.studioHandoverSettled = handover.settled;
  startWatching = handover.watchProject;
}

/**
 * A path Studio refused is a 400 naming the path, not a 500. The message
 * already carries the offending value; see `src/studio/paths.mjs`.
 * @param {any} res @param {any} err @param {{log:any}} ctx
 */
function refusePath(res, err, ctx) {
  if (err instanceof StudioPathError) {
    return sendJson(res, 400, { error: err.message, path: err.offending });
  }
  ctx.log.warn('studio write failed', err?.message || err);
  return sendError(res, 500, err?.message || String(err));
}
