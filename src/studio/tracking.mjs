/**
 * Tracking — WP-71, `docs/07-STUDIO-DESIGN.md` §7.
 *
 * Per card and per milestone, and every number has a file behind it:
 *
 *   tokens        the ledger's `tokens` records for the card's session, folded
 *                 by `aggregate()` in `src/core/usage.mjs` — the same fold the
 *                 Usage tab and `deckhq stats` read, so the three cannot
 *                 disagree about what a token is
 *   cost          ONLY when `showCost` is on, priced per model by the dated
 *                 rate card and labelled `list price`; a model the card cannot
 *                 price, or a record that named no model, prints no number
 *   time          the card's own `moves` — the stretches it spent in
 *                 `in_progress`, each bounded by the two column moves that
 *                 opened and closed it
 *   review        `reviewEpisodes()`, unchanged, for the card's session
 *   tests         quoted verbatim from the handover's section, through
 *                 `testsQuote()`: "the handover says 43 passed"
 *   burn-down     the acceptance criteria the USER ticked, against the cards
 *                 left in the milestone
 *
 * Nothing is estimated, interpolated or projected. A figure with nothing
 * behind it is `{status:'no data'}` and carries no number at all — not a
 * zero, which would be a measurement nobody made. That is `NO_DATA` from
 * `usage.mjs` and the refusal the rate card already makes for a model it
 * cannot price.
 *
 * Pure: records, a board, a roster and the handovers in; numbers out. No disk,
 * no clock of its own (`now` is handed in), and nothing here writes a board.
 * The one thing that acts on these numbers is `blockForBudget()`, called from
 * `src/http/routes/studio-drift.mjs` with what `crossedBudget()` below says.
 */
import { NO_DATA, aggregate } from '../core/usage.mjs';
import { reviewEpisodes } from '../core/ledger-stats.mjs';
import { costOf, matchRate } from '../core/rates.mjs';

/** The column whose stretches are "time on the card". */
export const WORK_COLUMN = 'in_progress';

/** The label every cost figure carries. Never a bill. */
export const LIST_PRICE = 'list price';

/** What a figure with nothing behind it is. No number, not even a zero. */
export const NOTHING = Object.freeze({ status: NO_DATA });

/** @param {unknown} n */
const finite = (n) => (typeof n === 'number' && Number.isFinite(n) ? n : null);

/**
 * The session a card's numbers come from: the card's own `agentId` when it
 * has one, otherwise the agent recorded against its role at Hire. Never a
 * guess — a card whose role has no recorded agent has no session.
 *
 * @param {{agentId?:string|null, role?:string|null}} card
 * @param {{roles?:Array<{name?:string, agentId?:string|null}>}|null} [roster]
 * @returns {string|null}
 */
export function agentOfCard(card, roster) {
  if (card?.agentId) return String(card.agentId);
  const role = card?.role ? String(card.role).toLowerCase() : '';
  if (!role) return null;
  const found = (roster?.roles || []).find((r) => String(r?.name || '').toLowerCase() === role);
  return found?.agentId ? String(found.agentId) : null;
}

/**
 * The stretches a card spent in `in_progress`, from its move history.
 *
 * A stretch opens on a move INTO the column and closes on the next move OUT
 * of it. One still open is closed at `now` and says so. A move out with no
 * move in before it — a card created straight into `in_progress`, or moved
 * before this build recorded moves — has no start anybody wrote down, so that
 * stretch is not counted rather than being given one.
 *
 * @param {Array<{from:string, to:string, at:number}>|undefined} moves
 * @param {number} now
 * @returns {Array<{since:number, until:number, open:boolean}>}
 */
export function workStretches(moves, now) {
  /** @type {Array<{since:number, until:number, open:boolean}>} */
  const out = [];
  let since = /** @type {number|null} */ (null);
  for (const move of Array.isArray(moves) ? [...moves] : []) {
    const at = finite(move?.at);
    if (at == null) continue;
    if (move.from === WORK_COLUMN && since != null) {
      out.push({ since, until: at, open: false });
      since = null;
    }
    if (move.to === WORK_COLUMN) since = at;
  }
  if (since != null) out.push({ since, until: Math.max(since, now), open: true });
  return out;
}

/**
 * `true` when `t` falls inside one of the stretches.
 * @param {number} t
 * @param {Array<{since:number, until:number}>} stretches
 */
function within(t, stretches) {
  return stretches.some((s) => t >= s.since && t <= s.until);
}

/**
 * The list-price estimate for one fold, or the refusal.
 *
 * Priced model by model. Any token the rate card cannot account for — a
 * record that named no model, a model with no row, or a record that gave a
 * total and no breakdown — makes the WHOLE figure `no rate`, because a sum
 * that silently left some of the spend out is a smaller number that looks
 * like the answer.
 *
 * @param {ReturnType<typeof aggregate>} fold
 * @param {{version?:string, rates?:any[]}|null} rateCard
 */
function costFor(fold, rateCard) {
  const version = rateCard?.version || 'unknown';
  const refuse = { status: 'no rate', rateCard: version, label: LIST_PRICE };
  if (!rateCard || fold.attributed.model < fold.totals.total) return refuse;
  let usd = 0;
  for (const bucket of fold.byModel) {
    const rate = matchRate(bucket.model, rateCard.rates || []);
    const counted = bucket.input + bucket.cacheWrite + bucket.cacheRead + bucket.output;
    if (!rate || counted !== bucket.total) return refuse;
    usd += costOf(bucket, rate);
  }
  return {
    status: 'ok',
    usd: Math.round(usd * 10000) / 10000,
    rateCard: version,
    label: LIST_PRICE,
  };
}

/**
 * One card's figures.
 *
 * @param {any} card a card as `validateBoard` normalised it
 * @param {{records?:any[], roster?:any, handovers?:any[], now:number,
 *          showCost?:boolean, rateCard?:any}} opts
 */
export function trackCard(card, opts) {
  const now = opts.now;
  const agentId = agentOfCard(card, opts.roster);
  const stretches = workStretches(card?.moves, now);

  // --- tokens: the session's records, inside the card's stretches when it
  // has any. A card with no stretches is measured over the whole session and
  // says so in `scope`, because that is a different claim.
  const mine = agentId
    ? (opts.records || []).filter((r) => r && String(r.sessionId || '') === agentId)
    : [];
  const scoped = stretches.length ? mine.filter((r) => within(Number(r.t), stretches)) : mine;
  const fold = aggregate(scoped, { now, since: 0, until: Number.MAX_SAFE_INTEGER });
  const tokens = fold.empty
    ? NOTHING
    : {
        status: 'ok',
        total: fold.totals.total,
        input: fold.totals.input,
        cacheWrite: fold.totals.cacheWrite,
        cacheRead: fold.totals.cacheRead,
        output: fold.totals.output,
        absent: fold.totals.absent,
        records: fold.totals.records,
        scope: stretches.length ? 'card' : 'session',
      };

  // --- time on the card: the stretches, each bounded by two moves.
  const ms = stretches.reduce((sum, s) => sum + (s.until - s.since), 0);
  const time = stretches.length
    ? {
        status: 'ok',
        ms,
        minutes: Math.floor(ms / 60000),
        open: stretches.some((s) => s.open),
        since: stretches[0].since,
        stretches: stretches.length,
      }
    : NOTHING;

  // --- time in review: `reviewEpisodes()`, unchanged, for the session.
  const episodes = agentId
    ? reviewEpisodes(mine, { now }).filter(
        (e) => !stretches.length || e.start >= stretches[0].since,
      )
    : [];
  const review = episodes.length
    ? {
        status: 'ok',
        ms: episodes.reduce((sum, e) => sum + e.ms, 0),
        episodes: episodes.length,
        open: episodes.some((e) => e.end == null),
      }
    : NOTHING;

  // --- tests run: a quotation, never a count in DeckHQ's own voice.
  const handover = (opts.handovers || []).find((h) => h && h.cardId === card?.id && h.quote);
  const tests = handover
    ? { status: 'ok', quote: String(handover.quote), path: String(handover.path || '') }
    : NOTHING;

  // --- the criteria the user ticked.
  const criteria = Array.isArray(card?.acceptance) ? card.acceptance.filter(Boolean) : [];
  const ticked = Array.isArray(card?.acceptanceDone)
    ? card.acceptanceDone.filter((t) => criteria.includes(t)).length
    : 0;
  const acceptance = criteria.length ? { status: 'ok', ticked, total: criteria.length } : NOTHING;

  const cost = opts.showCost ? (fold.empty ? NOTHING : costFor(fold, opts.rateCard)) : null;
  const measured = [tokens, time, review, tests].some((f) => f.status === 'ok');

  /** @type {any} */
  const out = {
    cardId: String(card?.id || ''),
    status: measured ? 'ok' : NO_DATA,
    milestone: card?.milestone || null,
    agentId,
    tokens,
    time,
    review,
    tests,
    acceptance,
    budget: card?.budget || null,
  };
  // The money is behind the switch, and absent — not null — when it is off,
  // so a surface that forgot to check the setting has nothing to print.
  if (cost) out.cost = cost;
  out.crossed = crossedBudget(out);
  return out;
}

/**
 * Which cap a tracked card has crossed, or null.
 *
 * §11.5, the owner's default: a cap counts tokens AND wall time, and either
 * one trips the stop. Only a MEASURED figure can cross a cap — a card whose
 * tokens read `no data` has not spent its token budget, it has spent nothing
 * anybody recorded. A cap of zero is no cap: a card budgeted to spend nothing
 * would be blocked by its first scan.
 *
 * @param {ReturnType<typeof trackCard>} tracked
 * @returns {{which:'tokens'|'minutes', spent:number, cap:number, text:string}|null}
 */
export function crossedBudget(tracked) {
  const budget = tracked?.budget;
  if (!budget) return null;
  const criteria =
    tracked.acceptance?.status === 'ok'
      ? `, ${tracked.acceptance.ticked}/${tracked.acceptance.total} criteria met`
      : '';
  const tokensCap = finite(budget.tokens);
  if (tokensCap && tracked.tokens?.status === 'ok' && tracked.tokens.total >= tokensCap) {
    const spent = tracked.tokens.total;
    return {
      which: 'tokens',
      spent,
      cap: tokensCap,
      text: `${spent.toLocaleString('en-US')} of ${tokensCap.toLocaleString('en-US')} tokens spent${criteria}`,
    };
  }
  const minutesCap = finite(budget.minutes);
  if (minutesCap && tracked.time?.status === 'ok' && tracked.time.ms >= minutesCap * 60000) {
    const spent = tracked.time.minutes;
    return {
      which: 'minutes',
      spent,
      cap: minutesCap,
      text: `${spent} of ${minutesCap} minutes on the card${criteria}`,
    };
  }
  return null;
}

/**
 * Per milestone: the burn-down, and the tokens its cards measured.
 *
 * Cards with no milestone are not a milestone, and are left out rather than
 * gathered under a heading nobody wrote.
 *
 * @param {Array<any>} cards the board's cards
 * @param {Array<ReturnType<typeof trackCard>>} tracked
 */
export function trackMilestones(cards, tracked) {
  /** @type {Map<string, any>} */
  const by = new Map();
  for (const card of cards || []) {
    const key = card?.milestone ? String(card.milestone) : '';
    if (!key) continue;
    let m = by.get(key);
    if (!m) {
      m = { milestone: key, cards: 0, left: 0, ticked: 0, criteria: 0, tokens: 0, measured: 0 };
      by.set(key, m);
    }
    m.cards += 1;
    if (card.column !== 'done') m.left += 1;
    const criteria = Array.isArray(card.acceptance) ? card.acceptance.filter(Boolean) : [];
    m.criteria += criteria.length;
    m.ticked += Array.isArray(card.acceptanceDone)
      ? card.acceptanceDone.filter((t) => criteria.includes(t)).length
      : 0;
    const t = tracked.find((x) => x.cardId === card.id);
    if (t?.tokens?.status === 'ok') {
      m.tokens += t.tokens.total;
      m.measured += 1;
    }
  }
  return [...by.values()].map((m) => ({
    milestone: m.milestone,
    cards: m.cards,
    left: m.left,
    burnDown: m.criteria
      ? { status: 'ok', ticked: m.ticked, criteria: m.criteria, left: m.left }
      : NOTHING,
    tokens: m.measured ? { status: 'ok', total: m.tokens, cards: m.measured } : NOTHING,
  }));
}

/**
 * The whole answer for one board.
 *
 * @param {{cards?:any[]}|null} board
 * @param {{records?:any[], roster?:any, handovers?:any[], now:number,
 *          showCost?:boolean, rateCard?:any}} opts
 */
export function trackBoard(board, opts) {
  const cards = Array.isArray(board?.cards) ? board.cards : [];
  const tracked = cards.map((card) => trackCard(card, opts));
  return {
    showCost: Boolean(opts.showCost),
    cards: tracked,
    milestones: trackMilestones(cards, tracked),
  };
}
