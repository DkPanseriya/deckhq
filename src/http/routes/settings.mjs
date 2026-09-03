/**
 * GET  /api/settings
 * POST /api/settings
 * GET  /api/about     read-only facts the settings sheet shows and cannot change
 * POST /api/refresh   force a scan now
 *
 * docs/02-ARCHITECTURE.md §5; docs/plan/05-GUI-UX-SPEC.md §5.4 for the sheet
 * these routes serve.
 */
import os from 'node:os';
import process from 'node:process';

import { readJson, sendError, sendJson } from '../server.mjs';
import { DEFAULT_SETTINGS, MOTION_MODES, RESUME_TARGETS } from '../../core/store.mjs';
import { rateCardVersion } from '../../core/rates.mjs';
import { EDITOR_NAMES } from '../../core/editor.mjs';
import { terminalIds } from '../../adapters/claude-code/terminals.mjs';

/**
 * Exactly the persisted settings, derived rather than restated. The two lists
 * drifting apart is how `showLetGo` survived for four months: the route
 * accepted it, the store persisted it, and nothing read it.
 * `test/unit/settings-keys.test.mjs` asserts this identity.
 */
const ALLOWED = new Set(Object.keys(DEFAULT_SETTINGS));

/**
 * Every id `terminal` may name, across every platform — `auto` plus the
 * emulator table. Computed once: the table is static.
 */
const TERMINAL_IDS = new Set(terminalIds());

/**
 * A hostname the operator asked for instead of the machine's own, sanitised
 * to the characters a hostname can have so nothing else can arrive through
 * it. Empty when unset, which is every real install.
 * @returns {string}
 */
function demoHostname() {
  const raw = String(process.env.DECKHQ_HOSTNAME || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/.test(raw) ? raw : '';
}

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
      // And for `reducedMotion`: an unknown mode would be stored as the
      // default, which is not what the caller asked for.
      if (k === 'reducedMotion' && !(/** @type {readonly string[]} */ (MOTION_MODES).includes(v))) {
        continue;
      }
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
      // And `goneHomeDays` (WP-50): only a finite number is a candidate. The
      // store clamps it to [0, 365] and falls back to the default for
      // anything else.
      if (k === 'goneHomeDays' && !Number.isFinite(Number(v))) continue;
      // And `ledgerRetentionDays` (WP-17). The store clamps this to 1..3650; a
      // non-number would silently become the default, so it is rejected here
      // where the caller can be told.
      if (k === 'ledgerRetentionDays' && !(typeof v === 'number' && Number.isFinite(v))) continue;
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
      rateCardVersion: rateCardVersion(),
      writeError: store.writeError,
      // The office is named after the machine, because people share things
      // with their name on them (WP-14,
      // `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §3.2). The browser
      // cannot read this, so it comes from here. It never leaves the machine:
      // this daemon makes no outbound request of any kind, and the only place
      // the value goes is into a PNG the user asked for.
      //
      // `DECKHQ_HOSTNAME` overrides it. That exists for the same reason
      // `scripts/demo-floor.mjs` invents project names and token counts: a
      // screenshot committed to a public repository must carry nobody's real
      // anything, and a machine name is somebody's real something.
      hostname: demoHostname() || os.hostname(),
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
