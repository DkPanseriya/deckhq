/**
 * GET  /api/settings
 * POST /api/settings
 * GET  /api/about     read-only facts the settings sheet shows and cannot change
 * POST /api/refresh   force a scan now
 *
 * docs/02-ARCHITECTURE.md §5; docs/plan/05-GUI-UX-SPEC.md §5.4 for the sheet
 * these routes serve.
 */
import { readJson, sendError, sendJson } from '../server.mjs';
import { DEFAULT_SETTINGS, MOTION_MODES, RESUME_TARGETS } from '../../core/store.mjs';
import { RATE_CARD_VERSION } from '../../core/model.mjs';

/**
 * Exactly the persisted settings, derived rather than restated. The two lists
 * drifting apart is how `showLetGo` survived for four months: the route
 * accepted it, the store persisted it, and nothing read it.
 * `test/unit/settings-keys.test.mjs` asserts this identity.
 */
const ALLOWED = new Set(Object.keys(DEFAULT_SETTINGS));

/**
 * @param {import('../server.mjs').Router} router
 * @param {{registry:any, store:any, log:any}} ctx
 */
export function register(router, ctx) {
  const { registry, store } = ctx;

  router.get('/api/settings', (_req, res) => {
    sendJson(res, 200, store.settings);
  });

  router.post('/api/settings', async (req, res) => {
    let body;
    try {
      body = await readJson(req);
    } catch (err) {
      return sendError(res, 400, err.message);
    }
    /** @type {Record<string, unknown>} */
    const patch = {};
    for (const [k, v] of Object.entries(body)) {
      if (!ALLOWED.has(k)) continue;
      // The allowlist above only gates the KEY. `resumeIn` additionally has
      // its value checked here rather than trusted — an unknown string
      // would otherwise reach the store, which would silently fall back to
      // the default; rejecting it here instead means a bad request is
      // reported back to the caller rather than quietly ignored.
      if (k === 'resumeIn' && !(/** @type {readonly string[]} */ (RESUME_TARGETS).includes(v))) {
        continue;
      }
      // Same for `approveText`: only a string is a candidate. The store trims,
      // caps and falls back to the default for a blank one.
      if (k === 'approveText' && typeof v !== 'string') continue;
      if (k === 'reducedMotion' && !(/** @type {readonly string[]} */ (MOTION_MODES).includes(v))) {
        continue;
      }
      patch[k] = v;
    }
    if (Object.keys(patch).length === 0) return sendError(res, 400, 'No known settings in body');
    store.setSettings(patch);
    await store.save();
    registry.onSettingsChanged?.();
    sendJson(res, 200, store.settings);
  });

  // The settings sheet's "Data" section. Two facts the user can read and
  // cannot change: where their acknowledgements live, and which dated rate
  // table every cost estimate on the floor came from. A cost with no
  // traceable rate card is a number nobody can check.
  router.get('/api/about', (_req, res) => {
    sendJson(res, 200, {
      statePath: store.file,
      rateCardVersion: RATE_CARD_VERSION,
      writeError: store.writeError,
    });
  });

  router.post('/api/refresh', async (_req, res) => {
    try {
      await registry.refresh();
      sendJson(res, 200, { ok: true, scannedAt: registry.snapshot().scannedAt });
    } catch (err) {
      sendError(res, 500, err.message);
    }
  });
}
