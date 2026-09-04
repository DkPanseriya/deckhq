/**
 * GET /api/packs — what installed asset packs bring to the page (WP-45).
 *
 * The browser cannot read `~/.deckhq/packs`, and `public/` may never import
 * from `src/`, so this is how a pack's themes and avatar sets reach the
 * renderer: as data, over loopback, the same way every other fact does.
 *
 * ## What this route is, and what it is not
 *
 * It is **read-only and additive**. It returns colours and names. There is no
 * POST here, nothing in the response can change what a session is, and
 * nothing about a pack reaches the queue, an acknowledgement or an action —
 * `test/integration/pack-acceptance.test.mjs` runs `/api/state`, `/api/ack`
 * and the counts with and without a pack installed and diffs them.
 *
 * It **re-reads the directory** rather than serving what the daemon loaded at
 * start, throttled by `currentPacks`'s one-second stamp check. That is what
 * makes `deckhq pack install` take effect in a running product without a
 * restart, and it is the same hot-reload discipline `src/core/rates.mjs`
 * applies to a user's rate card.
 *
 * It **says what it refused**. A theme dropped for failing the contrast gate
 * appears in `rejected` with its reason, so a customer who paid for a pack
 * can see which part of it this build would not paint, and why, without
 * reading a log file.
 */
import { sendJson } from '../server.mjs';
import { currentPacks } from '../../core/packs.mjs';

/**
 * @param {import('../server.mjs').Router} router
 * @param {{packsDir?:string, log:any}} ctx
 */
export function register(router, ctx) {
  router.get('/api/packs', (_req, res) => {
    const { packs, errors, avatars } = currentPacks({ dir: ctx.packsDir });
    sendJson(res, 200, {
      packs: packs.map((p) => ({
        name: p.name,
        version: p.version,
        publisher: p.publisher,
        blurb: p.blurb || '',
        keyId: p.keyId,
        // The theme documents themselves: the page needs the colours, not a
        // list of names, because the picker paints a swatch from them and
        // `applyTheme` paints the floor from them.
        themes: p.themes,
        avatars: p.avatars,
        rejected: p.rejected,
      })),
      // One entry per pack directory that could not be loaded at all —
      // unsigned, tampered, unreadable, or malformed in its envelope.
      errors,
      // Flattened for the settings sheet's avatar picker, which does not care
      // which pack a set came from until it names it.
      avatarSets: avatars,
    });
  });
}
