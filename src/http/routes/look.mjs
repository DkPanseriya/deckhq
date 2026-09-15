/**
 * GET  /api/look   what the building is made of, as an exportable document
 * POST /api/look   apply one, or refuse it whole
 *
 * WP-88a. `src/core/look.mjs` has the document and the schema; §1 of
 * `docs/plan/11-LOOK-CONTROL-CENTRE.md` has the rules it is measured against.
 *
 * ## The one rule this route is built around
 *
 * **Nothing is applied until everything validates, and a refusal changes
 * nothing.** The body is parsed, the ids are checked against the catalogue and
 * the whole combination is measured against every shipped theme BEFORE the first
 * write. A refused look therefore leaves the floor exactly as it found it and
 * says why — with the problems list, one row per picker, which is what WP-88b's
 * section renders beside the control that caused it.
 *
 * A clamp would be worse than a refusal: the user would have a floor that
 * matched neither what they chose nor what they had, and no way to tell which.
 *
 * ## Loopback, and cross-site
 *
 * Both are the server's, not this file's: `daemon.mjs` binds 127.0.0.1 and
 * nothing else, and its cross-site request-forgery guard runs before any route
 * sees a POST. This route adds nothing because there is nothing for it to add.
 *
 * ## The invariant
 *
 * Nothing here calls `act()`. A look repaints the building; it cannot
 * acknowledge, bench, let go or rehire anybody, and it carries no key that names
 * a session (`docs/01-PRODUCT.md` §2).
 */

import { readJson, sendError, sendJson } from '../server.mjs';
import { buildLookDocument, validateLookDocument } from '../../core/look.mjs';

/**
 * @param {import('../server.mjs').Router} router
 * @param {{registry:any, store:any, log:any}} ctx
 */
export function register(router, ctx) {
  const { registry, store } = ctx;

  router.get('/api/look', (_req, res) => {
    sendJson(res, 200, buildLookDocument(store.settings));
  });

  router.post('/api/look', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }

    // `'error' in result` rather than `!result.ok`: the same idiom
    // `src/http/routes/layout.mjs` uses, and the one the type checker narrows.
    const result = validateLookDocument(body);
    if ('error' in result) {
      return sendJson(res, 400, { error: result.error, problems: result.problems || [] });
    }

    const { kind: _kind, version: _version, ...look } = result.look;
    store.setSettings({ look });
    await store.save();
    registry.onSettingsChanged?.();
    sendJson(res, 200, { ok: true, look: buildLookDocument(store.settings) });
  });
}
