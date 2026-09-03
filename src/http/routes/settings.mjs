/**
 * GET  /api/settings
 * POST /api/settings
 * POST /api/refresh   force a scan now
 *
 * docs/02-ARCHITECTURE.md §5.
 */
import { readJson, sendError, sendJson } from '../server.mjs';
import { RESUME_TARGETS } from '../../core/store.mjs';
import { EDITOR_NAMES } from '../../core/editor.mjs';
import { terminalIds } from '../../adapters/claude-code/terminals.mjs';

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
  'editor',
  'terminal',
]);

/**
 * Every id `terminal` may name, across every platform — `auto` plus the
 * emulator table. Computed once: the table is static.
 */
const TERMINAL_IDS = new Set(terminalIds());

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
      // `editor` is the one setting whose value becomes a program (WP-47), so
      // it is checked here rather than trusted: the empty string means
      // "decide for me", and anything else must be a name on the allowlist in
      // core/editor.mjs. A rejected value is reported, not silently defaulted.
      if (k === 'editor') {
        const name = typeof v === 'string' ? v.trim().toLowerCase() : null;
        if (name === null) continue;
        if (name && !(/** @type {readonly string[]} */ (EDITOR_NAMES).includes(name))) {
          return sendError(res, 400, `editor must be one of ${EDITOR_NAMES.join(', ')}, or ""`);
        }
        patch[k] = name;
        continue;
      }
      // And for `terminal`: this is the only layer that can know which
      // emulators exist, so it is the layer that rejects an id none of them
      // matches. A valid id for another platform IS accepted — a state file
      // that travels between a Mac and a Linux box is not a bad request, and
      // detection ignores a pin it cannot resolve.
      if (k === 'terminal' && !(typeof v === 'string' && TERMINAL_IDS.has(v))) continue;
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
