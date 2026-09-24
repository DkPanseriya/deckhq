/**
 * The PM pass — WP-71, `docs/07-STUDIO-DESIGN.md` §8, drift control.
 *
 * On a schedule — every 30 minutes on the injected clock, and on demand — the
 * planner is handed the blueprint, the board and the handovers since the last
 * pass, and asked for flags in one fixed shape:
 *
 *     [{ "cardId": "c7", "kind": "scope", "text": "outside milestone 2" }]
 *
 * **Flags never act.** A flag cannot move a column, reassign a role or stop a
 * session. `applyFlags()` below writes `flags` and nothing else, and an
 * `INVARIANT:` test in `test/unit/studio-drift.test.mjs` drives a pass whose
 * planner flags every card and asserts `board.json`'s columns come back byte
 * for byte.
 *
 * This module is the pure half and the schedule. It sends nothing itself:
 * the send is handed in by `src/http/routes/studio-drift.mjs`, which continues
 * the planner through the ordinary send path (§9 invariant 4 — Studio reaches
 * no session through anything of its own, and the static test forbids this
 * directory from importing the send hub or the adapters).
 *
 * ## Parsed tolerantly, believed narrowly
 *
 * A model asked for JSON answers with prose around it, a fenced block, a
 * trailing comma's worth of apology, or an object with the array inside it.
 * All of those are read. What is NOT believed: a card id this board does not
 * have (dropped, not invented), a flag with no text, and anything beyond
 * `MAX_PASS_FLAGS`. An answer with no array in it at all is zero flags and a
 * named reason, never an error that stops the schedule.
 */
import { MAX_FLAGS, MAX_TEXT } from './schema.mjs';

/** §11.4, the owner's default: every 30 minutes, tab open or not. */
export const PM_INTERVAL_MS = 30 * 60 * 1000;

/** The flag kind a PM pass writes. The planner's own word goes in the text. */
export const DRIFT_KIND = 'drift';

/** How many flags one pass may write. A pass, not a rewrite of the board. */
export const MAX_PASS_FLAGS = 64;

/** What of each card the planner is shown, in this order. */
export const PM_CARD_FIELDS = Object.freeze([
  'id',
  'title',
  'milestone',
  'role',
  'column',
  'acceptance',
  'acceptanceDone',
  'budget',
  'flags',
]);

/** How much of the blueprint and of each handover the planner is handed. */
export const MAX_BLUEPRINT_CHARS = 8000;
export const MAX_HANDOVER_CHARS = 1500;

/**
 * The fixed-shape instruction. The same words every pass; nothing of the
 * user's is interpolated into it — the material follows it, fenced.
 */
export const PM_INSTRUCTION = [
  'DeckHQ PM pass. Read the blueprint, the board and the handovers below, and look for drift:',
  'a card outside its milestone, a card whose budget is being spent without its criteria being',
  'met, a handover that does not match its card, work nobody is assigned to.',
  '',
  'Answer with a JSON array and nothing else, in exactly this shape:',
  '[{"cardId": "<a card id from the board>", "kind": "<one word>", "text": "<one sentence>"}]',
  '',
  'Answer [] when nothing has drifted. Do not edit any file, move any card or start any work:',
  'your flags are shown to the user, who decides what to do about them.',
].join('\n');

/** @param {unknown} v @param {number} max */
function clean(v, max) {
  return typeof v === 'string'
    ? v
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max)
    : '';
}

/**
 * The one message a pass sends: the instruction, then the three materials.
 *
 * @param {{blueprint?:string|null, board?:{cards?:any[]}|null,
 *          handovers?:Array<{cardId:string|null, name:string, sections?:Record<string,string|null>}>,
 *          since?:number|null}} input
 * @returns {string}
 */
export function pmMessage(input) {
  const blueprint = String(input.blueprint || '').slice(0, MAX_BLUEPRINT_CHARS);
  // The fields the planner needs, copied by name. Built from a list rather
  // than an object literal so this file holds no `column:` key at all — it
  // READS a card's column to show it and has no business writing one, and
  // the static gate in `test/unit/studio-invariant.test.mjs` can say so.
  const cards = (input.board?.cards || []).map((/** @type {any} */ c) =>
    Object.fromEntries(PM_CARD_FIELDS.map((key) => [key, c[key] ?? null])),
  );
  const handovers = (input.handovers || []).map((h) => {
    const body = Object.entries(h.sections || {})
      .filter(([, text]) => text)
      .map(([name, text]) => `### ${name}\n${text}`)
      .join('\n\n')
      .slice(0, MAX_HANDOVER_CHARS);
    return `## ${h.name} (card ${h.cardId ?? 'unattached'})\n\n${body}`;
  });
  return [
    PM_INSTRUCTION,
    '',
    '---- blueprint.md ----',
    blueprint || '(no blueprint)',
    '',
    '---- board ----',
    JSON.stringify(cards, null, 1),
    '',
    input.since
      ? '---- handovers since the last pass ----'
      : '---- handovers (this is the first pass) ----',
    handovers.length ? handovers.join('\n\n') : '(none)',
  ].join('\n');
}

/**
 * The array in an answer, wherever it is. `null` when there is none.
 * @param {string} text
 * @returns {unknown[]|null}
 */
function arrayIn(text) {
  const tries = [text.trim()];
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fence) tries.push(fence[1].trim());
  const open = text.indexOf('[');
  const close = text.lastIndexOf(']');
  if (open !== -1 && close > open) tries.push(text.slice(open, close + 1));
  for (const attempt of tries) {
    try {
      const value = JSON.parse(attempt);
      if (Array.isArray(value)) return value;
      if (value && typeof value === 'object' && Array.isArray(value.flags)) return value.flags;
    } catch {
      // the next shape
    }
  }
  return null;
}

/**
 * The flags in a planner's answer, or zero flags and the reason.
 *
 * @param {unknown} answer the planner's reply text
 * @param {Iterable<string>} cardIds the ids this board actually has
 * @returns {{flags:Array<{cardId:string, kind:string, text:string}>, dropped:number,
 *            reason:string|null}}
 */
export function parseFlags(answer, cardIds) {
  const known = new Set([...cardIds].map(String));
  const list = arrayIn(String(answer ?? ''));
  if (!list) {
    return { flags: [], dropped: 0, reason: 'the planner answered with no JSON array' };
  }
  /** @type {Array<{cardId:string, kind:string, text:string}>} */
  const flags = [];
  let dropped = 0;
  const seen = new Set();
  for (const raw of list) {
    const item = /** @type {any} */ (raw);
    const cardId = clean(item?.cardId ?? item?.card ?? item?.id, 64);
    const kind = clean(item?.kind, 24).toLowerCase() || 'note';
    const text = clean(item?.text ?? item?.message, MAX_TEXT - 40);
    const key = `${cardId}\u0000${kind}\u0000${text}`;
    if (!known.has(cardId) || !text || seen.has(key) || flags.length >= MAX_PASS_FLAGS) {
      dropped += 1;
      continue;
    }
    seen.add(key);
    flags.push({ cardId, kind, text });
  }
  return { flags, dropped, reason: null };
}

/**
 * Put a pass's flags on their cards. FLAGS ONLY.
 *
 * Every other field of every card is left exactly as it was — the column
 * above all (§8: *"They never act"*). A flag identical to the newest drift
 * flag already on the card is not written twice, so a planner that says the
 * same thing every half hour does not push the card's other flags off the end.
 *
 * @param {{cards:any[]}} board changed in place
 * @param {Array<{cardId:string, kind:string, text:string}>} flags
 * @param {number} at
 * @returns {number} how many flags were written
 */
export function applyFlags(board, flags, at) {
  let written = 0;
  for (const flag of flags) {
    const card = (board?.cards || []).find((c) => String(c?.id) === flag.cardId);
    if (!card) continue;
    const text = `${flag.kind}: ${flag.text}`;
    const existing = Array.isArray(card.flags) ? card.flags : [];
    const newest = [...existing].reverse().find((f) => f?.kind === DRIFT_KIND);
    if (newest && newest.text === text) continue;
    const next = [...existing, { kind: DRIFT_KIND, text, at }];
    card.flags = next.slice(-MAX_FLAGS);
    written += 1;
  }
  return written;
}

/**
 * The schedule, on an injected clock.
 *
 * `tick(key)` is called by whatever drives time — the daemon's elapsed-time
 * timer in production, a test's hand in a test — and runs a pass for `key`
 * when `intervalMs` has passed on `now()` since the last one. The first tick
 * for a key starts its clock rather than running a pass: a daemon starting
 * up is not thirty minutes of drift. `runNow(key)` is the on-demand pass, and
 * resets the clock like any other. One pass per key at a time; a tick that
 * lands on a pass in flight is a no-op, not a queue.
 *
 * @param {{now:() => number, run:(key:string, since:number|null) => Promise<any>,
 *          intervalMs?:number}} opts
 */
export function createPmSchedule(opts) {
  const intervalMs = opts.intervalMs ?? PM_INTERVAL_MS;
  /** key → when the last pass began (or the clock started) */
  const last = new Map();
  /** key → whether a pass has ever run, for "since the last pass" */
  const ran = new Map();
  const running = new Set();

  /** @param {string} key */
  async function runNow(key) {
    if (running.has(key)) return { ok: false, busy: true };
    running.add(key);
    const since = ran.get(key) ?? null;
    const at = opts.now();
    last.set(key, at);
    try {
      const result = await opts.run(key, since);
      ran.set(key, at);
      return result;
    } finally {
      running.delete(key);
    }
  }

  return {
    intervalMs,
    runNow,
    /** @param {string} key */
    async tick(key) {
      const now = opts.now();
      if (!last.has(key)) {
        last.set(key, now);
        return null;
      }
      if (now - /** @type {number} */ (last.get(key)) < intervalMs) return null;
      return runNow(key);
    },
    /** @param {string} key */
    lastPass(key) {
      return ran.get(key) ?? null;
    },
  };
}
