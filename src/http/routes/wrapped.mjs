/**
 * GET /api/wrapped?kind=week|annual[&at=<ms epoch>]
 *
 * WP-27. Everything the weekly and annual Wrapped cards say, computed locally
 * from the event ledger and from the transcripts already on this disk.
 * `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §3.4: *"Generated locally. One
 * click to PNG. No email, no server, no account."* This route is the whole of
 * the server side of that sentence, and it makes no outbound request of any
 * kind.
 *
 * Three things it does that `GET /api/stats` does not.
 *
 * **It computes the window twice.** The card says whether the longest wait
 * *fell*, and a fall is a comparison — so the same digest is taken over the
 * window and over the window immediately before it, of exactly the same
 * length. Two windows of different lengths would make "it fell" an artifact of
 * the arithmetic.
 *
 * **It prices the window's tokens.** `docs/DEVIATIONS.md` §111 decision 6: a
 * `tokens` ledger record carries a delta and a project key and **not a model**,
 * so a window's tokens are priced at each room's own average rate. That is an
 * estimate of an estimate, it is labelled as one everywhere it is shown, and
 * it names the dated rate card it came from (standing rule 7).
 *
 * **It asks the adapters for one phrase.** §3.4's "one genuinely funny derived
 * stat". Reading a transcript is adapter work by rule (`08` §1.1 rule 8), so
 * this route asks `src/adapters/index.mjs` for a count and never learns what a
 * transcript looks like. It is the one expensive thing here — measured at 1.9 s
 * over 300 MB for a week on the reference machine — and it runs once a week,
 * never on the poll path.
 *
 * As with `/api/stats`, no path and no project name is ever put into a ledger
 * number: the response carries a `projects` map from hash to display name,
 * built by hashing the cwds the registry already holds.
 */
import { sendError, sendJson } from '../server.mjs';
import { projectKeyFor, readAll, windowDigest } from '../../core/ledger.mjs';
import { catchphraseCount } from '../../adapters/index.mjs';
import { rateCardVersion } from '../../core/rates.mjs';

/** The two windows a Wrapped is ever about. */
export const WRAPPED_KINDS = /** @type {const} */ (['week', 'annual']);

/**
 * The bounds of the window a card is about, in local time.
 *
 * **The week starts on Monday**, because §3.4's card arrives on Monday morning
 * and is about the week that just ended. A Sunday-start week would hand the
 * Monday reader a card whose last day was yesterday and whose first day was
 * eight days ago.
 *
 * **The year is the calendar year to date.** The annual card appears on or
 * after 1 December (`08` §7), which is three weeks before the year is over —
 * so it is honestly "the year so far" and the card says so rather than
 * implying a year that has not finished.
 *
 * @param {'week'|'annual'} kind
 * @param {number} at
 * @returns {{since:number, until:number, previousSince:number, label:string, key:string}}
 */
export function wrappedWindow(kind, at) {
  const now = new Date(at);
  if (kind === 'annual') {
    const start = new Date(now.getFullYear(), 0, 1).getTime();
    return {
      since: start,
      until: at,
      previousSince: new Date(now.getFullYear() - 1, 0, 1).getTime(),
      label: `${now.getFullYear()} so far`,
      key: `${now.getFullYear()}-annual`,
    };
  }
  // Monday 00:00 of the week that just ended: back to this week's Monday, then
  // seven days further.
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const backToMonday = (monday.getDay() + 6) % 7;
  monday.setDate(monday.getDate() - backToMonday);
  const end = monday.getTime();
  const start = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 7).getTime();
  const prev = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() - 14).getTime();
  return {
    since: start,
    until: end,
    previousSince: prev,
    label: 'last week',
    key: weekKey(start),
  };
}

/**
 * `2026-W36` for the ISO-ish week containing `ms`. Only ever used as an
 * opaque "has this card been shown" marker, so it needs to be stable and
 * unique per week and nothing more.
 * @param {number} ms
 */
export function weekKey(ms) {
  const d = new Date(ms);
  const jan1 = new Date(d.getFullYear(), 0, 1);
  const days = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
  const week = Math.floor((days + ((jan1.getDay() + 6) % 7)) / 7) + 1;
  return `${d.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

/**
 * What the window's tokens cost, at each room's own average rate.
 *
 * Pure, and exported, because it is the one piece of arithmetic here that
 * could be wrong in a way that still looks plausible. It differs from
 * `todaySpendFor` in `state-machine.mjs` in one deliberate way: a room with no
 * token movement in the window contributes **nothing**, where the room plate
 * falls back to the project's lifetime total. That fallback is right for a
 * plate that must say something about a room today; it would be badly wrong
 * here, where it would add a project's entire history to a week.
 *
 * @param {Record<string, number>} tokensPerProject window tokens by project key
 * @param {Array<{cwd?:string, tokens?:number, cacheTokens?:number, costEstimate?:number, costRated?:boolean}>} projects
 * @returns {{estimate:number|null, rated:number, unrated:number}}
 */
export function windowSpend(tokensPerProject, projects) {
  let estimate = 0;
  let rated = 0;
  let unrated = 0;
  const moved = tokensPerProject || {};
  for (const p of projects || []) {
    const key = projectKeyFor(p.cwd || '');
    const delta = Number(moved[key]) || 0;
    if (delta <= 0) continue;
    const lifetime = Number(p.costEstimate) || 0;
    const total = (Number(p.tokens) || 0) + (Number(p.cacheTokens) || 0);
    if (p.costRated !== true || lifetime <= 0 || total <= 0) {
      unrated += 1;
      continue;
    }
    // Clamped for the same reason the plate clamps: a window cannot have cost
    // more than the sessions in it have ever cost.
    estimate += Math.min(lifetime, (delta / total) * lifetime);
    rated += 1;
  }
  return {
    // Null, not zero. Zero is a claim about the money (§111 decision 4).
    estimate: rated > 0 ? Math.round(estimate * 100) / 100 : null,
    rated,
    unrated,
  };
}

/**
 * @param {import('../server.mjs').Router} router
 * @param {{registry:any, ledger:any, log:any}} ctx
 */
export function register(router, ctx) {
  const { registry, log } = ctx;

  router.get('/api/wrapped', async (_req, res, url) => {
    const ledger = ctx.ledger;
    if (!ledger) return sendError(res, 503, 'The ledger is not running');

    const kind = url.searchParams.get('kind') || 'week';
    if (!(/** @type {readonly string[]} */ (WRAPPED_KINDS).includes(kind))) {
      return sendError(res, 400, `kind must be one of ${WRAPPED_KINDS.join(', ')}`);
    }
    const rawAt = url.searchParams.get('at');
    let at = Date.now();
    if (rawAt != null && rawAt !== '') {
      const n = Number(rawAt);
      if (!Number.isFinite(n)) return sendError(res, 400, 'at must be a timestamp in ms');
      at = n;
    }

    try {
      const bounds = wrappedWindow(/** @type {'week'|'annual'} */ (kind), at);
      const records = await readAll(ledger.dir);
      const window = windowDigest(records, { since: bounds.since, until: bounds.until });
      const previous = windowDigest(records, {
        since: bounds.previousSince,
        until: bounds.since,
      });

      const liveProjects = registry?.snapshot?.().projects || [];
      /** @type {Record<string, string>} */
      const projects = {};
      for (const p of liveProjects) {
        if (!p.cwd) continue;
        projects[projectKeyFor(p.cwd)] = p.name || p.id;
      }

      // §3.4's derived stat. Bounded and optional: a runtime that cannot be
      // read, or a read that runs past its ceiling, costs the line and never
      // the card.
      let catchphrase = { supported: false, phrase: '', count: 0, truncated: false };
      try {
        catchphrase = await catchphraseCount({ since: bounds.since, until: bounds.until });
      } catch (err) {
        log.warn('wrapped: catchphrase count failed', err.message);
      }

      return sendJson(res, 200, {
        kind,
        label: bounds.label,
        since: bounds.since,
        until: bounds.until,
        key: bounds.key,
        window,
        previous,
        spend: {
          ...windowSpend(window.tokensPerProject, liveProjects),
          rateCardVersion: rateCardVersion(),
        },
        catchphrase,
        projects,
        incomplete: Boolean(ledger.writeError),
      });
    } catch (err) {
      log.warn('wrapped failed', err.message);
      return sendError(res, 500, err.message);
    }
  });
}
