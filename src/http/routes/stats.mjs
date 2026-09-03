/**
 * GET /api/stats?since=<ms epoch>
 *
 * WP-17. The numbers `docs/01-PRODUCT.md` §6 names, computed from the event
 * ledger and from nothing else:
 *
 *   - median and p90 time from entering `for_review` to being discharged
 *   - how many items have been sitting there longer than 24h
 *   - discharges per day, sends per day
 *   - tokens per project per day
 *   - the longest wait ever, and the day it started
 *
 * WP-46 adds `records`: the team's five records — longest wait ever, busiest
 * day, busiest week, the room that never slept, the fastest discharge day —
 * each with the day it was set and each carrying the first day the ledger
 * holds, so a young ledger reports what it has rather than a week it has not
 * lived through. The raw record COUNT, which used to be `records`, is
 * `recordCount`; `computeStats` emits both names, so nothing that read the
 * count has to move at once.
 *
 * Three things this route deliberately does not do.
 *
 * **It does not read the registry's live state.** Every number is a replay of
 * what was written down. A stats page that quietly mixed "what the ledger
 * says" with "what the floor looks like right now" would be unfalsifiable —
 * you could never tell whether a falling median was real or an artifact of
 * the live half. The one exception is the project *name*: see below.
 *
 * **It does not touch ack state**, read or write. It is a reader of a
 * directory of text files.
 *
 * **It does not leak a path.** Ledger records carry `projectKey`, a hash. The
 * response adds a `projects` map from key to display name, and it is built by
 * hashing the cwds the registry already holds — so a project the ledger knows
 * about but that has no session on the floor stays a hash, and no path is ever
 * put in the response.
 */
import { sendError, sendJson } from '../server.mjs';
import {
  computeStats,
  projectKeyFor,
  readAll,
  records as teamRecords,
  windowDigest,
} from '../../core/ledger.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WINDOW_MS = 30 * DAY_MS;

/**
 * @param {import('../server.mjs').Router} router
 * @param {{registry:any, ledger:any, log:any}} ctx
 */
export function register(router, ctx) {
  const { registry, log } = ctx;

  router.get('/api/stats', async (_req, res, url) => {
    const ledger = ctx.ledger;
    if (!ledger) return sendError(res, 503, 'The ledger is not running');

    const now = Date.now();
    const raw = url.searchParams.get('since');
    let since = now - DEFAULT_WINDOW_MS;
    if (raw != null && raw !== '') {
      const n = Number(raw);
      if (!Number.isFinite(n)) return sendError(res, 400, 'since must be a timestamp in ms');
      // A relative window is the shape a status line wants; an absolute epoch
      // is the shape a Wrapped wants. Anything below a year of milliseconds is
      // read as "this many ms ago", which is unambiguous for any real epoch.
      since = n < 0 ? now + n : n < 365 * DAY_MS ? now - n : n;
    }

    try {
      // Everything, not the window: an episode that began before `since` is
      // still measured from where it began, and "ever" means ever. Bounded by
      // retention — see ledger.mjs `readAll`.
      const records = await readAll(ledger.dir);
      const stats = computeStats(records, { now, since });

      /** @type {Record<string, string>} */
      const projects = {};
      for (const p of registry?.snapshot?.().projects || []) {
        if (!p.cwd) continue;
        projects[projectKeyFor(p.cwd)] = p.name || p.id;
      }

      return sendJson(res, 200, {
        ...stats,
        // WP-46. Deliberately NOT windowed by `since`: a record is a record,
        // and the same reason `longestWaitEver` ignores the window applies to
        // every one of these.
        records: teamRecords(records, { now }),
        // WP-18. The one part of this response that IS the window: what
        // happened between `since` and now, room by room. The daily postcard
        // asks for `?since=<local midnight>` and reads this; nothing else in
        // the body changed shape. `since`/`until` travel inside it so a card
        // can never label a number with a period it was not computed over.
        window: windowDigest(records, { since, until: now }),
        projects,
        // Say so rather than quietly reporting a short answer.
        incomplete: Boolean(ledger.writeError),
      });
    } catch (err) {
      log.warn('stats failed', err.message);
      return sendError(res, 500, err.message);
    }
  });
}
