/**
 * GET  /api/settings
 * POST /api/settings
 * POST /api/refresh   force a scan now
 *
 * docs/02-ARCHITECTURE.md §5.
 */
import { readJson, sendError, sendJson } from '../server.mjs';
import { RESUME_TARGETS } from '../../core/store.mjs';

const ALLOWED = new Set([
  'stallWindowMs',
  'notifications',
  'sound',
  'zoom',
  'pollIntervalMs',
  'showLetGo',
  'onboarded',
  'resumeIn',
  'approveText',
]);

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
      patch[k] = v;
    }
    if (Object.keys(patch).length === 0) return sendError(res, 400, 'No known settings in body');
    store.setSettings(patch);
    await store.save();
    registry.onSettingsChanged?.();
    sendJson(res, 200, store.settings);
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
