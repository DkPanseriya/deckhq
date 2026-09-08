/**
 * `/api/studio/*` — WP-66's half of `docs/07-STUDIO-DESIGN.md` §5.3.
 *
 *   GET  /api/studio?project=            consent state, blueprint, roster, board
 *   POST /api/studio/enable              `{cwd}` describes; `{cwd, confirm:true}` writes
 *   POST /api/studio/disable             removes tagged files only
 *   POST /api/studio/roster              replace the roster the user edited
 *   POST /api/studio/card                create, edit or MOVE a card
 *   GET  /api/studio/tracking?project=   §7's numbers
 *   POST /api/studio/plan                501 — WP-67
 *   POST /api/studio/hire                501 — WP-68
 *   POST /api/studio/handover            501 — WP-70
 *
 * Loopback only, and a cross-site POST is refused before it reaches here, by
 * the guard in `src/daemon.mjs` that every other route stands behind. Nothing
 * in this file opens a socket, starts a process or reads a transcript.
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
import { projectKeyFor } from '../../core/ledger-record.mjs';
import { StudioPathError } from '../../studio/paths.mjs';
import { StudioStore } from '../../studio/store.mjs';
import { COLUMNS, MAX_CARDS, validateBoard } from '../../studio/schema.mjs';
import {
  describeDisable,
  describeEnable,
  disable as disableStudio,
  enable as enableStudio,
  plannedPaths,
} from '../../studio/consent.mjs';

/** What a package that does not exist yet answers with, and why. */
const NOT_YET = {
  '/api/studio/plan': 'the planner session lands in WP-67; this build has the store and the board',
  '/api/studio/hire': 'worktrees, briefs and the spawn land in WP-68; nothing runs in this build',
  '/api/studio/handover': 'the handover watcher and the review gate land in WP-70',
};

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
 * @param {{store:any, log:any, dataDir?:string}} ctx
 */
export function register(router, ctx) {
  const dataDir = ctx.dataDir || DATA_DIR;
  const { store } = ctx;

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
    sendJson(res, 200, {
      project: project.root,
      projectKey: project.projectKey,
      dir: studio.dir,
      enabled: Boolean(consent),
      consent,
      // What enabling would write, so the page can draw the consent screen
      // without a second request, and so the screen is the same list the CLI
      // prints.
      wouldWrite: plannedPaths(project.root),
      columns: [...COLUMNS],
      studio: studio.snapshot(),
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
      board.cards.push({
        ...patch,
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
        // The move. One line, one funnel, and it is a user's press.
        board.cards[index] = { ...before, column: target, updatedAt: at };
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
  // GET /api/studio/tracking — §7, with nothing behind it yet
  // -------------------------------------------------------------------------

  router.get('/api/studio/tracking', (_req, res, url) => {
    const project = resolveProject(url.searchParams.get('project'));
    if ('error' in project) return sendError(res, 400, project.error);
    // §7: "A card with no ledger records reads `no data` rather than zero" —
    // the refusal the rate card already makes for a model it cannot price.
    // WP-71 folds the ledger; until it does, EVERY card reads no data, and
    // saying so is the whole content of this response. No number is invented
    // here, not even a zero.
    sendJson(res, 200, {
      project: project.root,
      projectKey: project.projectKey,
      cards: [],
      note: 'no data',
      why: 'the per-card ledger fold, the burn-down and the cap land in WP-71',
    });
  });

  // -------------------------------------------------------------------------
  // The three that need a spawn, and say so
  // -------------------------------------------------------------------------

  for (const [pathname, why] of Object.entries(NOT_YET)) {
    router.post(pathname, (_req, res) => sendError(res, 501, why));
  }
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
