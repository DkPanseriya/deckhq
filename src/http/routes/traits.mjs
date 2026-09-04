/**
 * GET /api/traits
 *
 * WP-28. One read-only line per agent — *"asks often · shell-heavy · terse ·
 * opus-5 · since 1 Sep"* — computed from the ledger and the session summary
 * and from nothing else. `src/core/traits.mjs` has the rules; this route is
 * the seam that hands it the two inputs.
 *
 * Four things it deliberately does not do.
 *
 * **It does not touch ack state**, read or write. It reads a directory of text
 * files and a per-session tally the scan already took. `traits.mjs` cannot
 * reach `store.mjs` at all, and `test/unit/traits-invariant.test.mjs` asserts
 * that the whole ack map is byte-identical across a call to this route.
 *
 * **It does not persist anything.** There is no trait in `state.json`, none in
 * the ledger, none on the snapshot. The answer is recomputed on every read,
 * which is what makes a trait a description rather than a level.
 *
 * **It does not rank.** No number in the response orders one agent against
 * another, and the vocabulary is fixed in `TRAIT_COPY` precisely so that it
 * can be asserted.
 *
 * **It does not name the human.** Nothing in the body has a second person in
 * it. `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 6.
 *
 * The response is a map keyed by agent id, so the floor's hover card and the
 * panel share one fetch and one cache and can never disagree about a line
 * while both are on screen — the same discipline WP-46's records line uses
 * (`docs/DEVIATIONS.md` §107).
 */
import { sendError, sendJson } from '../server.mjs';
import { readAll } from '../../core/ledger.mjs';
import { traits } from '../../core/traits.mjs';

/**
 * @param {import('../server.mjs').Router} router
 * @param {{registry:any, ledger:any, log:any}} ctx
 */
export function register(router, ctx) {
  const { registry, log } = ctx;

  router.get('/api/traits', async (_req, res, url) => {
    const ledger = ctx.ledger;
    if (!ledger) return sendError(res, 503, 'The ledger is not running');

    const wanted = url.searchParams.get('id');

    try {
      const records = await readAll(ledger.dir);

      // Grouped once rather than filtered per agent: `traits()` accepts either
      // the whole ledger or one session's slice, and on a floor with seventy
      // sessions and a ninety-day ledger the difference is a scan per agent.
      /** @type {Map<string, any[]>} */
      const bySession = new Map();
      for (const rec of records) {
        const id = rec && typeof rec.sessionId === 'string' ? rec.sessionId : null;
        if (!id) continue;
        const list = bySession.get(id);
        if (list) list.push(rec);
        else bySession.set(id, [rec]);
      }

      const agents = registry?.snapshot?.().agents || [];
      const now = Date.now();
      /** @type {Record<string, any>} */
      const out = {};
      for (const agent of agents) {
        if (wanted && agent.id !== wanted) continue;
        const set = traits(agent.id, {
          records: bySession.get(agent.id) || [],
          summary: registry.traitInput ? registry.traitInput(agent.id) : null,
          now,
        });
        out[agent.id] = {
          line: set.line,
          degraded: set.degraded,
          turns: set.turns,
          traits: set.list,
          tendency: set.tendency,
        };
      }

      return sendJson(res, 200, { traits: out });
    } catch (err) {
      log.warn('traits failed', err.message);
      return sendError(res, 500, err.message);
    }
  });
}
