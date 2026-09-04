/**
 * GET  /api/layout   the floor's arrangement, as an exportable document
 * POST /api/layout   apply one, or refuse it whole
 *
 * WP-30. `src/core/layout.mjs` has the document, the schema and the reason
 * pinned room positions are not in it.
 *
 * ## The one rule this route is built around
 *
 * **Nothing is applied until everything validates.** The body is parsed,
 * validated and turned into a settings patch and a room order BEFORE the first
 * write. A malformed layout therefore leaves the theme, the room order, the
 * archived rooms and the two floor preferences exactly as it found them, and
 * says why in one sentence. Half-applying a layout would be worse than
 * refusing it: the user would have a floor that matched neither the file nor
 * what they had before, and no way to tell which half landed.
 *
 * ## The invariant
 *
 * Nothing here calls `act()`. A layout moves rooms and repaints them; it
 * cannot acknowledge, bench, let go or rehire anybody, and it carries no key
 * that names a session (`docs/01-PRODUCT.md` §2).
 */

import { readJson, sendError, sendJson } from '../server.mjs';
import { buildLayout, settingsPatchFor, validateLayout } from '../../core/layout.mjs';

/**
 * @param {import('../server.mjs').Router} router
 * @param {{registry:any, store:any, log:any}} ctx
 */
export function register(router, ctx) {
  const { registry, store } = ctx;

  router.get('/api/layout', (_req, res) => {
    sendJson(res, 200, buildLayout(registry.snapshot()));
  });

  router.post('/api/layout', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }

    // `'error' in result` rather than `!result.ok`: the same idiom
    // `src/cli/deck.mjs` uses on `resolveId`'s result, and the one the type
    // checker narrows.
    const result = validateLayout(body);
    if ('error' in result) return sendError(res, 400, result.error);
    const layout = result.layout;

    // Everything below this line is a write, and every one of them is now
    // known to be legal. The order is deliberate but not load-bearing: each
    // step is independently valid, so there is no state in which one of them
    // could fail and leave the others stranded.
    store.setSettings(settingsPatchFor(layout));
    registry.setRoomOrder(layout.rooms);

    // Archived rooms are set from the document's own list rather than diffed
    // against what is there: a layout states the whole arrangement, so a room
    // the document does not archive is a room the document says is open.
    const archived = new Set(layout.archivedRooms);
    for (const id of layout.rooms) {
      registry.setProjectArchived(id, archived.has(id));
    }

    await store.save();
    registry.onSettingsChanged?.();
    sendJson(res, 200, { ok: true, layout, applied: buildLayout(registry.snapshot()) });
  });
}
