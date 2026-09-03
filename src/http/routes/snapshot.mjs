/**
 * POST /api/snapshot   save one office snapshot PNG
 *
 * WP-14, `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §3.2. `S` in the
 * browser composites the floor and a stat strip into a PNG, puts it on the
 * clipboard, and posts the bytes here to be written to
 * `~/.deckhq/snapshots/`. The clipboard is the share path; the file is what
 * makes the clipboard survive the next copy.
 *
 * THE RULES THIS ROUTE FOLLOWS, and why each one is here rather than assumed:
 *
 *   1. **The daemon names the file.** Nothing the browser sends becomes part
 *      of a path — not a filename, not a fragment of one, not a hostname. The
 *      name is the daemon's own clock. A route that takes a name from a
 *      request body is a route that eventually writes outside its directory.
 *   2. **The body must be a PNG.** The magic bytes are checked before
 *      anything is written. This endpoint's whole purpose is to put a file on
 *      the user's disk; "whatever you send me" is not an acceptable content
 *      contract for that, whatever the content-type header claims.
 *   3. **Its own size ceiling.** `server.mjs`'s `readJson` caps every other
 *      route at 1 MB, which is right for JSON and wrong for the one route
 *      that carries an image. The ceiling here is 8 MB — comfortably over
 *      §3.2's 2 MB target so an oversized capture is reported rather than
 *      truncated, and far under anything that could exhaust memory.
 *   4. **It touches nothing else.** No ack state, no settings, no identity.
 *      A snapshot is a picture; the model is not involved.
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { sendError, sendJson } from '../server.mjs';
import { SNAPSHOT_DIR } from '../../core/paths.mjs';

/** Body ceiling for this route only. See rule 3 above. */
export const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

/** The eight bytes every PNG starts with. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * `deckhq-20260904-142233.png`. Local time, because a person looking for
 * "the one I took just now" is thinking in their own clock, and seconds
 * because `S` is one keystroke and two in the same minute is normal.
 *
 * Exported so the naming is asserted rather than eyeballed.
 * @param {Date} at
 * @returns {string}
 */
export function snapshotFilename(at) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return (
    `deckhq-${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}` +
    `-${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}.png`
  );
}

/**
 * Read a request body as bytes, refusing anything over `limit`.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} limit
 * @returns {Promise<Buffer>}
 */
function readBytes(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    /** @type {Buffer[]} */
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Snapshot too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('error', reject);
    req.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

/**
 * @param {import('../server.mjs').Router} router
 * @param {{log:any, snapshotDir?:string}} ctx
 */
export function register(router, ctx) {
  const { log } = ctx;
  const dir = ctx.snapshotDir || SNAPSHOT_DIR;

  router.post('/api/snapshot', async (req, res) => {
    /** @type {Buffer} */
    let body;
    try {
      body = await readBytes(req, MAX_SNAPSHOT_BYTES);
    } catch (err) {
      return sendError(res, 413, err.message);
    }
    if (body.length === 0) return sendError(res, 400, 'Empty snapshot');
    if (!body.subarray(0, 8).equals(PNG_MAGIC)) {
      return sendError(res, 415, 'A snapshot must be a PNG');
    }

    const file = path.join(dir, snapshotFilename(new Date()));
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(file, body);
    } catch (err) {
      // A snapshot that cannot be written is not a crash and not silence:
      // the clipboard copy already happened, so the client says which half
      // worked. Same voice as the store's write error.
      log.warn('could not write snapshot', err);
      return sendError(res, 500, `Could not write ${file}: ${err.message}`);
    }
    log.info(`snapshot written to ${file}`);
    sendJson(res, 200, { file, bytes: body.length });
  });
}
