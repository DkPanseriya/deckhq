/**
 * GET /api/replay/days        which days can be watched
 * GET /api/replay?day=YYYY-MM-DD   one day, as frames
 *
 * WP-45's "watch yesterday", and free — `src/core/replay.mjs`'s header carries
 * the argument for why a feature that reads your own ledger cannot be sold.
 *
 * Two GETs, no POST, and nothing here writes. This route reads the ledger
 * directory and the registry's project NAMES and nothing else — the same two
 * sources `/api/stats` reads, for the same reason and with the same rule: a
 * ledger record carries `projectKey`, a hash, and the response adds a map
 * from key to display name built by hashing the cwds the registry already
 * holds, so a project the ledger knows about but that has no session on the
 * floor stays a hash and no path is ever put in a response.
 *
 * ## THE INVARIANT (docs/01-PRODUCT.md §2)
 *
 * A replay changes no acknowledgement. It cannot: there is no writer in this
 * file, `reconstructQueue` is a pure fold, and the client's replay is a second
 * render target for the same `Scene` rather than a snapshot handed to
 * `handleSnapshot`. `test/unit/replay.test.mjs` asserts it end to end — replay
 * a day whose records include an acknowledgement, and the live state is
 * byte-identical afterwards.
 */
import { sendError, sendJson } from '../server.mjs';
import { projectKeyFor } from '../../core/ledger.mjs';
import { readReplay, replayDays } from '../../core/replay.mjs';

/**
 * @param {import('../server.mjs').Router} router
 * @param {{registry:any, ledger:any, log:any}} ctx
 */
export function register(router, ctx) {
  /** The key-to-name map, built the way `/api/stats` builds it. */
  const projectNames = () => {
    /** @type {Record<string, string>} */
    const projects = {};
    for (const p of ctx.registry?.snapshot?.().projects || []) {
      if (!p.cwd) continue;
      projects[projectKeyFor(p.cwd)] = p.name || p.id;
    }
    return projects;
  };

  router.get('/api/replay/days', async (_req, res) => {
    const ledger = ctx.ledger;
    if (!ledger) return sendError(res, 503, 'The ledger is not running');
    try {
      sendJson(res, 200, { days: await replayDays(ledger.dir) });
    } catch (err) {
      ctx.log.warn('replay days failed', err.message);
      sendError(res, 500, err.message);
    }
  });

  router.get('/api/replay', async (_req, res, url) => {
    const ledger = ctx.ledger;
    if (!ledger) return sendError(res, 503, 'The ledger is not running');
    const day = url.searchParams.get('day') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
      return sendError(res, 400, 'day must be a YYYY-MM-DD date');
    }
    try {
      const replay = await readReplay(ledger.dir, { day });
      sendJson(res, 200, { ...replay, projects: projectNames() });
    } catch (err) {
      ctx.log.warn('replay failed', err.message);
      sendError(res, 500, err.message);
    }
  });
}
