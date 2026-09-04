/**
 * WP-28 — the agent's traits.
 *
 * `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §4: *"Read-only, inferred from
 * real behaviour, never trained and never affecting anything: how often it
 * raises its hand, its tool mix, its verbosity, its model. Surfaced as one
 * line in the hover card and as a tendency in idle animation. Two Point
 * Hospital's permanent staff traits, without the morale bar. No skill levels,
 * no training, no resignation."*
 *
 * One line, on the AGENT:
 *
 *     asks often · shell-heavy · terse · opus-5 · since 1 Sep
 *
 * ## The five rules this file exists to keep
 *
 * 1. **Nothing here scores the human.** `docs/plan/08-PLAN-V2-100X.md` §1.1
 *    rule 6. Every string in {@link TRAIT_COPY} is in the third person about
 *    the agent; the second person does not appear, the reader is never the
 *    subject, and there is nothing here that can be broken, lost or fallen
 *    behind on. `test/unit/traits.test.mjs` asserts that over the whole
 *    vocabulary rather than trusting the copy to stay that way.
 * 2. **Nothing here is a level, a score or a rank.** A trait is a WORD with a
 *    definition, never a number and never a comparison against another agent.
 *    No label carries a digit; no label or definition carries a superlative.
 *    Same test.
 * 3. **It is computed on read, and never written down.** There is no trait
 *    field in `state.json`, no trait record in the ledger, and no trait on the
 *    snapshot. `traits()` is a pure function of what has already been observed
 *    elsewhere, so a trait cannot go stale, cannot be trained, and cannot be
 *    *earned* — which is the whole difference between this and a level.
 * 4. **INVARIANT (`docs/01-PRODUCT.md` §2): computing a trait touches nothing
 *    user-owned.** This module imports nothing from `store.mjs`, so it cannot
 *    read `reviewSince` and cannot write `ackState` even by accident — the
 *    direction of the dependency IS the guarantee, exactly as it is for
 *    `ledger.mjs` (`docs/DEVIATIONS.md` §100). There is a named `INVARIANT:`
 *    test.
 * 5. **Nothing acts on a trait, so there is nothing to switch off.** The one
 *    thing a trait touches outside the two text surfaces is a weighting on the
 *    idle animation an agent already plays at its desk (`public/render/
 *    clips.js`), and that weighting cannot introduce a clip, cannot survive a
 *    real state change, and does not run under reduced motion. A setting for
 *    it would be a setting for nothing.
 *
 * ## What a "turn" is here, and why
 *
 * A turn is a time the agent STOPPED: an observed activity transition into
 * `for_review` (finished, up for review) or into `needs_input` (stopped to
 * ask). Both come from the ledger's `state` records, so the numerator and the
 * denominator of the hand-raise rate are counted over the same window, out of
 * the same file, by the same rule.
 *
 * The alternative — counting `tokens` records, of which the ledger holds far
 * more — was rejected: a scan sees a token total move several times inside one
 * turn, so "turns" would have meant "polls that caught something", and the
 * rate would have moved when the poll interval changed. `stalled` is not a
 * stop either; it is a clock running out, which is the opposite of the agent
 * choosing to hand back.
 *
 * Under {@link MIN_TURNS} stops the only honest answer is that there is not
 * enough behaviour to describe, and the line says exactly that: **new here**.
 */

/** Below this many observed stops, the only trait is "new here". */
export const MIN_TURNS = 5;

/**
 * Hand-raise bands, in raises per ten stops.
 *
 * Unmeasured, and said so plainly: the reference machine has no ledger old
 * enough to take a distribution from (`docs/DEVIATIONS.md` §133). These are
 * the obvious thirds of a rate that cannot exceed ten, and the first machine
 * with a month of ledger behind it should be looked at before they are
 * defended.
 */
export const ASKS_OFTEN_PER_10 = 3;
export const ASKS_SOMETIMES_PER_10 = 1;

/**
 * Verbosity bands, in characters of the median reply that said something.
 *
 * MEASURED, on 80 real transcripts on the reference machine on 4 September:
 * the median of per-session medians is 120 characters, the quartiles are 92
 * and 171, and the p90 is 1430. The distribution is bimodal — a stream of
 * one-line tool narrations around a few long answers — which is why the
 * summary takes a median and not a mean, and why the bands sit where they do:
 * 100 and 250 split that population roughly into quarters and a half rather
 * than into three empty boxes and one full one.
 */
export const TERSE_MAX_CHARS = 100;
export const EXPANSIVE_MIN_CHARS = 250;

/**
 * How much of the classified tool calls one class must hold before it is worth
 * a word. Measured on the same 80 transcripts: for the 70 sessions with five
 * or more classified calls the leading class holds 0.53 at the tenth
 * percentile and 0.69 at the median, so a bar at 0.45 lets the common case
 * through and still refuses to name a leader when there is not one.
 */
export const TOOL_LEAD_SHARE = 0.45;

/** Fewer classified calls than this says nothing about a mix. */
export const MIN_TOOL_CALLS = 5;

/**
 * The whole trait vocabulary: every word this product will say about an
 * agent's behaviour, and what each one means.
 *
 * It is a table rather than strings scattered through the code so that the
 * copy can be read in one place and asserted in one test. Adding a word here
 * is the only way to add a trait, and the test will refuse a word that ranks,
 * scores, addresses the reader or carries a digit.
 *
 * @type {Record<string, {label:string, definition:string}>}
 */
export const TRAIT_COPY = {
  asks_often: {
    label: 'asks often',
    definition: 'stops to ask on many of the turns it finishes',
  },
  asks_sometimes: {
    label: 'asks sometimes',
    definition: 'stops to ask now and again',
  },
  self_directed: {
    label: 'self-directed',
    definition: 'finishes its turns without stopping to ask',
  },
  files_heavy: {
    label: 'files-heavy',
    definition: 'reading and writing files is the bulk of its tool work',
  },
  shell_heavy: {
    label: 'shell-heavy',
    definition: 'shell commands are the bulk of its tool work',
  },
  web_heavy: {
    label: 'web-heavy',
    definition: 'fetching over the network is the bulk of its tool work',
  },
  search_heavy: {
    label: 'search-heavy',
    definition: 'searching the tree is the bulk of its tool work',
  },
  even_mix: {
    label: 'even mix',
    definition: 'its tool work is spread across the four kinds',
  },
  terse: {
    label: 'terse',
    definition: 'its replies are short',
  },
  measured: {
    label: 'measured',
    definition: 'its replies run to a paragraph',
  },
  expansive: {
    label: 'expansive',
    definition: 'its replies run long',
  },
  new_here: {
    label: 'new here',
    definition: 'too little behaviour on this floor to describe yet',
  },
};

/** Which tool class earns which word. */
const TOOL_KEY = {
  files: 'files_heavy',
  shell: 'shell_heavy',
  web: 'web_heavy',
  search: 'search_heavy',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `1756684800000` → `1 Sep`. No `Intl`, for the reason `public/records.js`
 * gives: this string has to read the same on a Node build without a full ICU
 * as it does in a browser.
 * @param {number} ms
 * @returns {string}
 */
export function shortDate(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const month = MONTHS[d.getMonth()];
  return month ? `${d.getDate()} ${month}` : '';
}

/**
 * `claude-opus-5-20260501` → `opus-5`.
 *
 * `public/panel-format.js`'s `shortModel` strips the vendor prefix and stops
 * there, which is right for a state line where the exact build matters. A
 * trait line is a character sketch, and a datestamp in the middle of one reads
 * as a version number the reader is being asked to compare. The date comes
 * off; nothing else is invented.
 * @param {string|null|undefined} model
 * @returns {string|null}
 */
export function traitModel(model) {
  if (!model) return null;
  const short = String(model)
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .replace(/-latest$/, '');
  return short || null;
}

/**
 * The earliest moment the ledger has any evidence of this session, or null.
 *
 * `first_seen` carries `since` — the timestamp the session ENTERED the state
 * it was in when the ledger first wrote it down (`docs/DEVIATIONS.md` §100,
 * decision 1) — so an episode that began before the ledger existed is still
 * measured from where it began rather than from the day the file rolled over.
 * @param {any[]} records this session's records, any order
 * @returns {number|null}
 */
function firstSeenAt(records) {
  let earliest = null;
  for (const rec of records) {
    const candidates =
      rec.kind === 'session' && typeof rec.since === 'number' ? [rec.since, rec.t] : [rec.t];
    for (const t of candidates) {
      if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) continue;
      if (earliest == null || t < earliest) earliest = t;
    }
  }
  return earliest;
}

/**
 * @param {number} raisesPer10
 * @returns {string} a key into {@link TRAIT_COPY}
 */
function handKey(raisesPer10) {
  if (raisesPer10 >= ASKS_OFTEN_PER_10) return 'asks_often';
  if (raisesPer10 >= ASKS_SOMETIMES_PER_10) return 'asks_sometimes';
  return 'self_directed';
}

/**
 * @param {Record<string, number>|null|undefined} mix
 * @returns {string|null} a key into {@link TRAIT_COPY}, or null when there is
 *   not enough tool work to say anything at all.
 */
function toolKey(mix) {
  if (!mix) return null;
  /** @type {Array<['files'|'shell'|'web'|'search', number]>} */
  const entries = [
    ['files', Number(mix.files) || 0],
    ['shell', Number(mix.shell) || 0],
    ['web', Number(mix.web) || 0],
    ['search', Number(mix.search) || 0],
  ];
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  if (total < MIN_TOOL_CALLS) return null;
  // Ties resolve by the fixed order above rather than by whichever key the
  // object happened to be built with, so the same mix always says the same
  // word. A tie at or above the share bar is vanishingly rare and picking a
  // stable answer is better than picking a different one each read.
  let lead = entries[0];
  for (const entry of entries) if (entry[1] > lead[1]) lead = entry;
  if (lead[1] / total < TOOL_LEAD_SHARE) return 'even_mix';
  return TOOL_KEY[lead[0]];
}

/**
 * @param {number} medianChars
 * @returns {string|null} a key into {@link TRAIT_COPY}, or null when no reply
 *   has been read.
 */
function voiceKey(medianChars) {
  if (!medianChars || medianChars <= 0) return null;
  if (medianChars < TERSE_MAX_CHARS) return 'terse';
  if (medianChars >= EXPANSIVE_MIN_CHARS) return 'expansive';
  return 'measured';
}

/**
 * The idle-animation tendency for a trait set, or null.
 *
 * Three tendencies, each naming a clip the agent ALREADY plays at its desk —
 * `drink` is §4.1's coffee, `think` is §4.1's thought cloud, `type` is §4.1's
 * keyboard. Nothing here can introduce a clip; the weighting lives in
 * `public/render/clips.js` and every clip it can reach is in
 * `IDLE_VARIATIONS` or is `type`.
 *
 * The order is fixed and shell-heavy wins, because an agent can hold two of
 * these at once and a tendency that changed with the reading order would make
 * the same agent fidget differently on two loads of the same floor.
 *
 * @param {{keys:Record<string,string|null>}} parts
 * @returns {'coffee'|'thinking'|'typing'|null}
 */
function tendencyFor(parts) {
  if (parts.keys.tools === 'shell_heavy') return 'coffee';
  if (parts.keys.hands === 'asks_often') return 'thinking';
  if (parts.keys.voice === 'expansive') return 'typing';
  return null;
}

/**
 * @typedef {object} TraitSet
 * @property {string} id
 * @property {boolean} degraded  under {@link MIN_TURNS} observed stops: the
 *   line is "new here" and nothing else, because nothing else would be true
 * @property {number} turns      observed stops the line was computed over
 * @property {{key:string, label:string, definition:string}[]} list
 * @property {string} line       the labels, joined with ` · `
 * @property {'coffee'|'thinking'|'typing'|null} tendency
 */

/**
 * The traits of one agent, computed from the ledger and the session summary
 * and from nothing else.
 *
 * Called on read. Holds no state, writes nothing, and is safe to call as often
 * as a surface wants it.
 *
 * @param {string} sessionId the product's own agent id (`runtime:uuid`)
 * @param {{records?: any[], summary?: {model?:string|null,
 *   toolMix?:Record<string, number>|null, textMedian?:number}|null,
 *   now?: number}} [input]
 *   `records` may be the whole ledger or one session's slice — anything whose
 *   `sessionId` is not this one is ignored, so a caller never has to filter
 *   twice. `summary` is `registry.traitInput(id)`'s shape.
 * @returns {TraitSet}
 */
export function traits(sessionId, input = {}) {
  const id = String(sessionId || '');
  const all = Array.isArray(input.records) ? input.records : [];
  const summary = input.summary || null;

  /** @type {any[]} */
  const mine = [];
  for (const rec of all) {
    if (rec && typeof rec === 'object' && rec.sessionId === id) mine.push(rec);
  }

  let stops = 0;
  let raises = 0;
  for (const rec of mine) {
    if (rec.kind !== 'state' || rec.dim !== 'activity') continue;
    if (rec.to === 'needs_input') {
      raises += 1;
      stops += 1;
    } else if (rec.to === 'for_review') {
      stops += 1;
    }
  }

  const since = firstSeenAt(mine);
  const model = traitModel(summary?.model);

  /** @type {{key:string, label:string, definition:string}[]} */
  const list = [];
  /** @param {string|null} key */
  const push = (key) => {
    if (!key) return;
    const copy = TRAIT_COPY[key];
    if (copy) list.push({ key, label: copy.label, definition: copy.definition });
  };

  if (stops < MIN_TURNS) {
    push('new_here');
    return {
      id,
      degraded: true,
      turns: stops,
      list,
      // Nothing else joins it. A degraded line that still carried the model
      // and the date would look like a trait line with two traits missing,
      // and the honest reading is that there is not one yet.
      line: TRAIT_COPY.new_here.label,
      tendency: null,
    };
  }

  const keys = {
    hands: handKey((raises / stops) * 10),
    tools: toolKey(summary?.toolMix),
    voice: voiceKey(Number(summary?.textMedian) || 0),
  };
  push(keys.hands);
  push(keys.tools);
  push(keys.voice);

  // The model and the tenure are facts, not traits: they get a place on the
  // line and no entry in `list`, because neither has a definition to give and
  // neither was inferred from anything.
  const parts = list.map((t) => t.label);
  if (model) parts.push(model);
  if (since != null) {
    const day = shortDate(since);
    if (day) parts.push(`since ${day}`);
  }

  return {
    id,
    degraded: false,
    turns: stops,
    list,
    line: parts.join(' · '),
    tendency: tendencyFor({ keys }),
  };
}
