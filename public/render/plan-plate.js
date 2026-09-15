/**
 * WHAT A ROOM PLATE SAYS, IN WORDS — WP-81.
 *
 * Split out of `plan-rooms.js` when WP-81 turned two plate lines into four and
 * pushed that file past `08`'s 900-line ceiling. It is a clean cut rather than
 * a convenient one: everything here is a pure `project row -> string`, with no
 * geometry, no units and no furniture in it, which is why `scene-labels.js`
 * can read it directly and why `plan-rooms.js`'s own fallback `plateLines` and
 * the live plate cannot end up saying two different things.
 *
 * WP-81. THE PLATE RANKS ITS FIGURES, AND THE RANKING IS THE DESIGN.
 *
 * The owner, 14 September: _"Make sure the calculations on the whiteboard of
 * the project rooms are right and informative and not just there for the sake
 * of it. […] how to make it easy to read at a glance in a split second so the
 * user does not have to spend effort reading it."_
 *
 * The plate used to read `orbital-api · 7 sessions · 580k tok · 2 need you`
 * over `today 5.8M tok · with cache`: three numbers of equal weight, of which
 * one is an action, one is a size and one is a bill nobody is sent. A glance
 * cannot rank them because the type does not, so the reader has to.
 */

/**
 * Compact token formatting, e.g. `2200000 -> '2.2M'`.
 * @param {number} n
 */
export function formatTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1000)}k`;
  return `${Math.round(v)}`;
}

/**
 * The room plate's payroll line (WP-26), or `''` when there is nothing
 * honest to put on it.
 *
 * Three rules, and the third is the one that matters:
 *
 *   1. **Quiet.** It is the third line on a door plate, under the name and the
 *      session count. It is context for a room, not a headline.
 *   2. **Dated by its own words.** `today` when the ledger has the day's token
 *      deltas for this project; `to date` when it does not and the line is the
 *      session totals falling back (`todaySpendFor` in
 *      `src/core/state-machine.mjs`). The plate never says "today" about a
 *      number that is not today's.
 *   3. **It says what kind of number it is.** `list price` is not decoration:
 *      `08` §1.1 rule 7 is that cost is an estimate and never a bill, and a
 *      currency figure on a wall with no qualifier beside it reads as a bill.
 *      A project nothing in the rate card can price gets NO LINE at all rather
 *      than `$0.00` — see `src/core/rates.mjs`.
 *
 * @param {{todaySpend?:number|null, todaySpendIsToday?:boolean}} project
 * @returns {string}
 */
export function payrollLine(project) {
  const usd = project ? project.todaySpend : null;
  if (usd == null || !Number.isFinite(Number(usd))) return '';
  const amount = `≈ $${Number(usd).toFixed(2)}`;
  return project.todaySpendIsToday
    ? `today ${amount} · list price`
    : `${amount} to date · list price`;
}

/**
 * The room plate's third line when cost is off, which is how it ships (WP-83).
 *
 * TOKENS, NOT MONEY, and the same three rules the payroll line keeps:
 *
 *   1. **Quiet.** Still the third line on a door plate, still context.
 *   2. **Dated by its own words.** `today` when the ledger has the day's token
 *      deltas for this room — `Ledger.todayTokens`, folded per project by
 *      `todayTokensFor` in `src/core/state-machine-rules.mjs` — and `to date`
 *      when it does not and this is the room's lifetime total falling back.
 *      The plate never says "today" about a number that is not today's.
 *   3. **It says nothing rather than something it cannot measure.** A room
 *      with no token figure at all gets no line, exactly as an unpriceable
 *      room got none before.
 *
 * **`with cache` is not decoration either.** The data line above this one is
 * `project.tokens`, which is input plus output and nothing else; this line is
 * that plus the cache traffic, which on a real room is an order of magnitude
 * larger. Two token figures on one plate that count different things, with
 * only one of them saying so, is a plate that looks wrong to anybody who adds
 * them up — and the bigger of the two is the one that needed the qualifier.
 *
 * Kept in the same file as `payrollLine` because the two are alternatives for
 * one slot and the choice between them is made in one place
 * (`plateTertiaryLine` below, read by `platePlanFor` in `scene-labels.js`).
 *
 * @param {{todayTokens?:number|null, todayTokensIsToday?:boolean, tokens?:number,
 *          cacheTokens?:number}} project
 * @returns {string}
 */
export function tokenLine(project) {
  const today = project ? project.todayTokens : null;
  if (today != null && Number.isFinite(Number(today)) && Number(today) > 0) {
    return project.todayTokensIsToday
      ? `today ${formatTokens(Number(today))} tok · with cache`
      : `${formatTokens(Number(today))} tok to date · with cache`;
  }
  const lifetime = (Number(project?.tokens) || 0) + (Number(project?.cacheTokens) || 0);
  if (lifetime <= 0) return '';
  return `${formatTokens(lifetime)} tok to date · with cache`;
}

// ------------------------------------------ the two lines WP-81 ranks them by

/**
 * THE ONE LINE THAT MIGHT MAKE SOMEBODY GET UP (WP-81).
 *
 * `N need you` when the room is holding somebody up, `N working` when it is
 * not and something is running, `quiet` when neither. Never a token count:
 * nobody has ever acted on a token count, and a figure that is never acted on
 * is decoration (`01-PRODUCT.md` §4).
 *
 * The `· oldest …` tail is added by `platePlanFor`, which has the agents and
 * therefore the waits; this function has only a project row, so it states the
 * head and nothing it cannot measure.
 *
 * `working` is `model.mjs`'s own per-project counter — active AND working —
 * and a snapshot from a daemon that predates it makes the room `quiet` rather
 * than guessing.
 *
 * @param {{needsYou?:number, working?:number}} project
 * @returns {string}
 */
export function plateHeroLine(project) {
  const needs = Number(project?.needsYou) || 0;
  if (needs > 0) return `${needs} need you`;
  const working = Number(project?.working) || 0;
  if (working > 0) return `${working} working`;
  return 'quiet';
}

/**
 * THE QUIETEST LINE: WHAT THIS ROOM HAS SPENT (WP-81, over WP-83's figure).
 *
 * Tokens by default and the cost after them only when `settings.showCost` is
 * on, which is a change from WP-83: there the two were alternatives for one
 * slot, and the reason was that two token figures on one plate needed telling
 * apart. There is only one token figure on this plate now — the session count
 * and the lifetime total moved to the plate's tooltip — so the money, when a
 * user has asked for it, can stand beside the tokens instead of replacing
 * them. `list price` stays glued to the figure (`08` §1.1 rule 7).
 *
 * `no data` rather than an empty line, because §157.3's rule is that absence
 * is a value: a room whose ledger says nothing should say that it says
 * nothing, not leave a gap a reader will fill in with the room above.
 *
 * @param {any} project
 * @param {boolean} showCost
 * @returns {string}
 */
export function plateTertiaryLine(project, showCost) {
  const tokens = tokenLine(project);
  if (!showCost) return tokens || 'no data';
  const money = payrollLine(project);
  if (!money) return tokens || 'no data';
  if (!tokens) return money;
  // Both halves date themselves — `today …` or `… to date` — and a plate that
  // says "today" twice in one line reads as two rows run together. When they
  // agree about the day, the second one drops the word.
  const tail = tokens.startsWith('today ') && money.startsWith('today ') ? money.slice(6) : money;
  return `${tokens} · ${tail}`;
}
