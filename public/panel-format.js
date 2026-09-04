/**
 * How the panel says a number, a name and a cost (WP-22 follow-up).
 *
 * Split out of `panel.js` unchanged. Pure string functions, no DOM: the
 * compact name for a toast, WP-41's junior line, the four number formats, and
 * the two cost-copy rules WP-26 wrote down once for the panel and the board.
 *
 * `panel.js` re-exports `juniorMetaFor`, `costLineParts` and
 * `boardCostParts`, so `test/unit/subagents.test.mjs` and
 * `test/unit/rates.test.mjs` import exactly what they imported before.
 */

// ------------------------------------------------------------- utilities

/** The compact name for toasts and placeholders: display name, else MK tag. */
export function who(a) {
  return a?.displayName || a?.label || a?.mk || a?.title || 'this session';
}

/**
 * The junior line for the panel's state row (WP-41), or null when the session
 * is neither a junior nor has one.
 *
 * Exported because it is the whole rule in one pure function and
 * `test/unit/subagents.test.mjs` reads it directly rather than standing up a
 * DOM to find out what a string says.
 *
 * @param {any} agent
 * @param {any} snapshot the current snapshot, for looking the parent up by id.
 *   A junior whose parent is not in it — it was archived, or the scan caught
 *   the junior first — still says "junior", just not whose.
 * @returns {string|null}
 */
export function juniorMetaFor(agent, snapshot) {
  if (!agent) return null;
  if (agent.subagent === true) {
    const parent = ((snapshot && snapshot.agents) || []).find((p) => p && p.id === agent.parentId);
    return parent ? `junior of ${who(parent)}` : 'junior';
  }
  const n = Number(agent.juniorCount) || 0;
  if (n <= 0) return null;
  return n === 1 ? '1 junior' : `${n} juniors`;
}

/** "claude-opus-5" reads as "opus-5" on a line that already says Claude Code. */
export function shortModel(model) {
  if (!model) return null;
  return String(model).replace(/^claude-/, '');
}

/** @param {number} n */
export function formatNumber(n) {
  return Number(n || 0).toLocaleString('en-US');
}

/** 1,440,000 → "1.44M"; 12,300 → "12.3k"; small numbers stay whole. */
export function formatCompact(n) {
  const v = Number(n || 0);
  if (v >= 1e6) return `${(v / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return String(v);
}

/** @param {number} n */
export function formatCost(n) {
  return `≈ $${Number(n || 0).toFixed(2)}`;
}

/**
 * The bottom line of the review card, as the parts the renderer joins with
 * `·` (WP-26).
 *
 * Three obligations, and none of them is optional:
 *
 *   1. **It names its source.** `rate card 2026-09-04` is the dated table in
 *      `src/data/rates.json` — or the user's own `~/.deckhq/rates.json`, in
 *      which case the version carries their date or `+local`. A cost figure
 *      whose table nobody can name is a figure nobody can check.
 *   2. **It says what kind of number it is.** `list price`, and `not a bill`
 *      in as many words. `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 7.
 *   3. **It refuses to invent one.** A model the rate card has no row for
 *      reads `no rate for this model`, never `$0.00`. Zero is a claim about
 *      the money and we do not have one.
 *
 * Exported for `test/unit/rates.test.mjs`, which asserts every branch of it
 * carries "list price" or "estimate" and never "bill" without "not a".
 *
 * @param {{costEstimate?:number|null}} agent
 * @param {string|null|undefined} version
 * @returns {string[]}
 */
export function costLineParts(agent, version) {
  const card = `rate card ${version || 'unknown'}`;
  const usd = agent ? agent.costEstimate : null;
  if (usd == null || !Number.isFinite(Number(usd))) {
    return ['no rate for this model', card, 'estimate unavailable'];
  }
  return [formatCost(usd), `list price, ${card}`, 'not a bill'];
}

/**
 * The same three obligations, for a whole room rather than one session: the
 * project board's cost strings (WP-26).
 *
 * It lives beside {@link costLineParts} rather than in `app.js` because the
 * copy rule is the thing being shared, not the DOM — one definition of "what a
 * cost figure must say about itself", read by both surfaces and scanned as
 * text by `test/unit/rates.test.mjs`. The board sums per-session estimates, so
 * `cost` is `null` when NOTHING in the room could be priced: a room of unknown
 * models sums to zero, and zero is a claim about the money nobody has.
 *
 * Three strings because the board reads them in three places, and two of them
 * travel alone:
 *
 *   - `tile` sits under its own `Est. cost` label in the tile grid;
 *   - `total` is the board's bottom line, beside the token total;
 *   - `note` is the sentence under the whole board, and is the one that names
 *     the dated table every figure above it came from.
 *
 * @param {number|null|undefined} cost the room's summed estimate, or null
 * @param {string|null|undefined} version the snapshot's `rateCardVersion`
 * @returns {{tile:string, total:string, note:string}}
 */
export function boardCostParts(cost, version) {
  const card = `rate card ${version || 'unknown'}`;
  if (cost == null || !Number.isFinite(Number(cost))) {
    return {
      tile: 'no rate',
      total: 'no rate · estimate unavailable',
      note: `No model in this room is in the ${card}, so there is no cost estimate here. Esc closes.`,
    };
  }
  return {
    tile: formatCost(cost),
    total: `${formatCost(cost)} · list price`,
    note: `Cost is an estimate at public list prices, not a bill · ${card}. Esc closes.`,
  };
}

/** @param {number} ms */
export function formatElapsed(ms) {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}
