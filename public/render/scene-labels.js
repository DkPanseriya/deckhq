/**
 * The room plates, and the labels that must not sit on each other
 * (WP-22 follow-up).
 *
 * Split out of `scene.js` unchanged: what a plate says, how a string too
 * long for its box is cut, the collision pass that nudges overlapping labels
 * apart, and the one method that paints a plate. `plateLinesFor` and
 * `resolveLabelCollisions` are pure and are what `scene-math.test.mjs` and
 * `subagents.test.mjs` read; `scene.js` re-exports them.
 *
 * The two type faces live here because this is the first place text is set on
 * canvas. Every number is set in the mono face, which is how tabular
 * stability is held on a surface with no `font-variant-numeric`
 * (docs/03-VISUAL-SPEC.md §7).
 */

import { formatTokens, PLATE_BAND, plateHeroLine, plateTertiaryLine } from './plan.js';
import { PALETTE, STATE_COLORS } from './palette.js';
import { formatElapsed } from './rig.js';
import { humaniseToolSummary } from '../mcp-tool-name.js';
import { waitingSince } from '../floor-rule.js';
import { worldToScreen } from './agents.js';
import { SceneCamera } from './scene-camera.js';
import { now as clockNow } from '../clock.js';

// Name-label collision resolution (tech-lead review finding 1,
// docs/DEVIATIONS.md "Findings from review"): how many extra candidate
// positions (each one label-height further down) a non-priority label gets
// before it is dropped rather than drawn overlapping.
export const MAX_LABEL_OFFSET_ATTEMPTS = 2;

export const FONT_UI = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";
// Every number is set in the mono face so tabular-nums-style stability holds on canvas,
// which has no font-variant-numeric of its own (docs/03-VISUAL-SPEC.md §7).
export const FONT_MONO =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, 'Courier New', monospace";

/**
 * THE PLATE SCALES WITH THE PLAN (WP-59).
 *
 * A room plate used to be set in fixed pixels — 12.5 px of name over 11 px of
 * data — which was right while the floor could only ever be drawn between
 * `MIN_SCALE` and a 44 px body. WP-59 raised the fit ceiling so a small floor
 * reaches the bottom of a 1440 px window, and at that scale a fixed 12.5 px
 * name is a caption on a door twice the size it was designed for: the plate
 * stops reading as part of the room and starts reading as an annotation
 * floating over it.
 *
 * So the plate is set in UNITS OF THE FLOOR with the old pixel sizes as its
 * floor. `PLATE_BASE_SCALE` is the px-per-unit at which those sizes are
 * exactly right, which is where the fit ceiling used to sit; below it nothing
 * changes, and above it every measurement in the plate — type, leading, the
 * hit rect — grows together, up to `PLATE_MAX_GROWTH`.
 */
export const PLATE_BASE_SCALE = 17.5;
export const PLATE_MAX_GROWTH = 1.6;

/**
 * How much larger than its stated size a plate is set, at world scale
 * `worldScale` px per unit. Pure, and exported so the scale test can ask.
 * @param {number} worldScale
 */
export function plateScaleFor(worldScale) {
  const s = Number(worldScale) || 0;
  return Math.min(PLATE_MAX_GROWTH, Math.max(1, s / PLATE_BASE_SCALE));
}

/**
 * Resolve overlapping name labels for one frame (tech-lead review finding 1,
 * docs/DEVIATIONS.md "Findings from review": labels collide with desk
 * furniture and with each other at L1). `items` should already be in the
 * caller's priority/paint order — earlier items get first claim on space.
 *
 * `pin: true` (the selected agent only) is placed unconditionally at
 * their natural position and contribute to what later items must avoid, but
 * are themselves never nudged or dropped — moving or hiding the one label
 * that says "this is the agent waiting on you" would defeat the point of it.
 *
 * Every other item is tried at its natural position, then at up to
 * `MAX_LABEL_OFFSET_ATTEMPTS` positions each one label-height further down;
 * if none of those clear every already-placed label, it is dropped rather
 * than drawn overlapping — the work order is explicit that a missing label
 * beats an unreadable smear.
 *
 * @param {{id:string, x:number, y:number, w:number, h:number, keep?:boolean}[]} items
 *   `x,y,w,h`: the label's un-offset screen-space box (top-left + size).
 * @returns {Map<string, {offsetY:number}|null>} per-id result; `null` means
 *   "do not draw this label this frame".
 */
/**
 * Trim text with an ellipsis until it fits maxW at the context's current
 * font. Binary search rather than character-by-character, so a long room name
 * costs a handful of measureText calls per frame, not dozens.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxW
 */
export function ellipsise(ctx, text, maxW) {
  if (maxW <= 0) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + '…' : '';
}

/**
 * THE LONGEST WAIT IN A SET OF AGENTS, AND WHOSE STATE IT IS (WP-81).
 *
 * `waitingSince` is the one definition of "waiting" on this floor — the
 * `reviewSince` of a `for_review` agent or the `needsInputSince` of a
 * `needs_input` one, and `Infinity` for everybody else. A `stalled` agent
 * counts toward `needsYou` and has no timestamp of its own, so it colours the
 * plate's dot but can never set its `oldest`: the plate says how long it can
 * prove, not how long it suspects.
 *
 * @param {any[]} agents
 * @param {number} now ms epoch, from the injected clock
 * @returns {{oldest:number, state:string|null}}
 */
function longestWait(agents, now) {
  let oldest = 0;
  /** @type {string|null} */
  let state = null;
  let stalled = false;
  for (const a of agents) {
    if (!a || a.ackState !== 'active') continue;
    if (a.activityState === 'stalled') stalled = true;
    const since = waitingSince(a);
    if (!Number.isFinite(since)) continue;
    const waited = now - since;
    // `for_review` outranks `needs_input` at an equal wait: crimson is the
    // reserved colour and the one the badges on the floor already use.
    const better =
      waited > oldest || (waited === oldest && a.activityState === 'for_review') || state === null;
    if (better) {
      oldest = Math.max(oldest, waited);
      if (state !== 'for_review' || a.activityState === 'for_review') state = a.activityState;
    }
  }
  if (state === null && stalled) state = 'stalled';
  return { oldest, state };
}

/** How much of a tool summary a plate will carry before it cuts (WP-81). */
export const PLATE_DOING_CHARS = 26;

/** At most this many "who is doing what" entries share the plate's second line. */
export const PLATE_DOING_ENTRIES = 2;

/**
 * WHAT A ROOM'S DOOR PLATE SAYS, RIGHT NOW, AND IN WHAT ORDER OF IMPORTANCE.
 *
 * A plate is recomputed from the live snapshot rather than read from
 * `room.plateLines`, because the plan is rebuilt only when the floor's SHAPE
 * changes and these numbers move on every poll. `room.plateLines` is the
 * fallback for a room the snapshot has nothing to say about.
 *
 * **WP-81 RANKED THE LINES INSTEAD OF LISTING THEM.** The plate used to read
 * `orbital-api · 7 sessions · 580k tok · 2 need you` over `today 5.8M tok ·
 * with cache`: three numbers set in one size and one colour, of which exactly
 * one — `2 need you` — is ever acted on. Ranking them was left to the reader,
 * which is the opposite of a glance. The four slots now are:
 *
 *   0. **title** — the room's name. Who this is about.
 *   1. **hero** — `2 need you · oldest 1d 2h`, the largest thing on the plate
 *      and the only line with a state colour beside it. When nothing needs
 *      you it says what the room IS doing instead — `3 working`, or `quiet` —
 *      so the slot is never empty and never has to be re-read to find out it
 *      is empty.
 *   2. **doing** — up to two live `currentTool` summaries, `MK1.1 · npm test`,
 *      the only line on the plate that says what the work actually is.
 *   3. **tertiary** — `today 5.8M tok · with cache`, WP-83's figure, with the
 *      cost after it when `settings.showCost` is on. Smallest and softest.
 *
 * **THE SESSION COUNT AND THE LIFETIME TOTAL MOVED TO `tooltip`.** They are
 * the size of the room rather than the state of it; nobody has ever got up
 * because a room held seven sessions. `_drawRoomPlate` publishes the string on
 * the plate's hit rect and `app-floor.js` hangs it off the canvas's `title`,
 * so the facts are one hover away and no longer competing with the one that
 * matters. A PINNED room is the exception (`room.pinned`): nothing runs in it,
 * so the session count is the only fact it has and it keeps the hero slot.
 *
 * **NOTHING HERE IS ESTIMATED.** Every string traces to a named field —
 * `project.needsYou` / `.working` / `.tokens` / `.todayTokens` from
 * `model.mjs`'s own per-project counters and the ledger's day tally,
 * `agent.reviewSince` / `.needsInputSince` through `waitingSince`, and
 * `agent.currentTool.summary` as the adapter wrote it. Where a figure is
 * absent the plate says `no data` rather than a zero
 * (`docs/DEVIATIONS.md` §157.3).
 *
 * A plain named export rather than only a method, for the reason the note at
 * the bottom of this file gives: `new Scene(...)` needs a canvas, so anything
 * that must be unit-tested lives out here where a stub snapshot is enough.
 *
 * @typedef {object} PlatePlan
 * @property {string[]} lines `[title, hero, doing, tertiary]`, any of which
 *   after the first may be `''` — `_drawRoomPlate` draws nothing for those.
 * @property {string} heroHead the hero without its `· oldest …` tail, which is
 *   what a plate too narrow for the whole line falls back to.
 * @property {string[]} doing the second line's entries, unjoined, so a narrow
 *   plate can drop the second one rather than ellipsising through it.
 * @property {string|null} dot the state colour beside the hero, or `null`.
 * @property {string} tooltip the facts the plate no longer prints.
 *
 * @param {any} room
 * @param {any} snapshot
 * @param {any} [plan]
 * @returns {PlatePlan}
 */
export function platePlanFor(room, snapshot, plan) {
  const snap = snapshot || {};
  const one = (title, hero, tooltip = '') => ({
    lines: [title, hero],
    heroHead: hero,
    doing: [],
    dot: null,
    tooltip,
  });
  const fallback = () => {
    const lines = room.plateLines || [room.name, ''];
    return { lines, heroHead: lines[1] || '', doing: [], dot: null, tooltip: '' };
  };

  if (room.kind === 'project') {
    const project = (snap.projects || []).find((p) => p.id === room.id);
    if (!project) return fallback();
    // WP-41. Juniors are counted apart from the sessions, because they are a
    // different KIND of occupant: the user did not start them, cannot bench
    // them, and they will be gone before the next coffee. "3 sessions ·
    // +2 juniors" says what is in the room; folding them into `sessionCount`
    // would quietly claim the user has five things running. It is a fact about
    // the room's SIZE, so since WP-81 it rides on the tooltip with the rest.
    const juniors = Number(project.juniors) || 0;
    const juniorPart = juniors > 0 ? ` · +${juniors} junior${juniors === 1 ? '' : 's'}` : '';
    const n = Number(project.sessionCount) || 0;
    const tooltip =
      `${room.name} · ${n} session${n === 1 ? '' : 's'}${juniorPart} · ` +
      `${formatTokens(project.tokens)} tok in and out`;
    // WP-77. A PINNED room says why it is there, and says it instead of the
    // numbers a live room carries. Nothing is running in it, so its tokens are
    // history and its `need you` is zero by construction — figures that cannot
    // change are figures nobody should keep reading. The word that CAN change
    // is the one the plate is for.
    if (room.pinned === true) {
      return one(room.name, `${n} session${n === 1 ? '' : 's'} · pinned`, tooltip);
    }
    const mine = (snap.agents || []).filter((a) => a && a.projectId === room.id);
    const { oldest, state } = longestWait(mine, clockNow());
    const heroHead = plateHeroLine(project);
    const needs = Number(project.needsYou) || 0;
    const hero =
      needs > 0 && oldest > 0 ? `${heroHead} · oldest ${formatElapsed(oldest)}` : heroHead;
    const dot =
      needs > 0
        ? STATE_COLORS[state || 'needs_input']
        : heroHead === 'quiet'
          ? null
          : STATE_COLORS.working;
    const doing = doingEntriesFor(mine);
    return {
      lines: [
        room.name,
        hero,
        doing.join(', '),
        plateTertiaryLine(project, snap.settings?.showCost === true),
      ],
      heroHead,
      doing,
      dot,
      tooltip,
    };
  }
  if (room.kind === 'office') {
    const c = snap.counts || {};
    // WP-78: the office holds BOTH waiting states now, so the plate counts
    // both. `drawn.waiting` is that number, computed once in `counts()`;
    // `forReview` is what an older daemon's snapshot carries and all it can
    // honestly claim.
    const waiting = c.drawn && typeof c.drawn.waiting === 'number' ? c.drawn.waiting : c.forReview;
    // The longest wait is the number that makes debt visible. Individual
    // badges cannot fit across a packed waiting area at a tight fit scale,
    // so the plate carries the worst case; per-agent badges reappear once
    // the viewport is wide enough to fit them.
    const { oldest, state } = longestWait(snap.agents || [], clockNow());
    const n = waiting || 0;
    // WP-81: the same grammar as a project room's hero. A count and the worst
    // wait when there is something to act on; what the room IS otherwise,
    // rather than a `0` the eye has to stop on to discover means "nothing".
    const head = n > 0 ? `${n} waiting` : 'nobody waiting';
    const hero = n > 0 && oldest > 0 ? `${head} · oldest ${formatElapsed(oldest)}` : head;
    return {
      lines: [room.name, hero],
      heroHead: head,
      doing: [],
      dot: n > 0 ? STATE_COLORS[state || 'needs_input'] : null,
      tooltip: '',
    };
  }
  if (room.kind === 'lounge') {
    const c = snap.counts || {};
    // THE DOOR PLATE CARRIES THE PEOPLE WHO ARE NOT IN THE ROOM (`08` B6).
    // The lounge is sized by, and draws, only the benched agents still
    // inside the gone-home window; the rest are on this line and nowhere
    // else on the floor. `counts.benched` is every benched agent, which is
    // what the header reports and what the panel lists — nothing about
    // their state changed, only whether they are drawn.
    const goneHome = plan && plan.goneHome ? plan.goneHome.size : 0;
    // WP-78: the lounge rests the ENDED as well as the benched, so the number
    // on the door is both. It stays honest about the split by saying "resting"
    // rather than "benched" — benching is a user action and most of the people
    // in here now did not have it done to them.
    const drawn =
      c.drawn && typeof c.drawn.lounge === 'number'
        ? c.drawn.lounge
        : Math.max(0, (c.benched || 0) - goneHome);
    // WP-81: the lounge keeps its two lines and its words. Nobody in it is
    // waiting on the user, so its hero is a state rather than an action and it
    // gets no dot — the same rule a `quiet` project room follows.
    return one(
      room.name,
      goneHome > 0 ? `${drawn} resting · ${goneHome} went home` : `${drawn} resting`,
    );
  }
  if (room.kind === 'let_go') {
    const c = snap.counts || {};
    const n = c.letGo || 0;
    // WP-61 renamed the action, the state, the toast and the panel header, and
    // left this one plate saying "let go · archived" because a string the
    // canvas paints moves the goldens (§143.2). WP-60 regenerates them, so it
    // moves here too — and `archived` goes with it, because WP-61's own
    // sentence is that the conversation is KEPT rather than archived.
    return one(room.name, `${n} fired`);
  }
  return fallback();
}

/**
 * WHO IS DOING WHAT, RIGHT NOW, IN ONE ROOM (WP-81, the plate's second line).
 *
 * The one line on the plate that is not a count. It is built from
 * `agent.currentTool` — WP-52's observed tool call, written by a `PreToolUse`
 * hook and cleared by `state-machine-scan.mjs` when it goes stale — and from
 * nothing else: an agent with no tool open contributes no entry, and no entry
 * is invented for it. `humaniseToolSummary` is the same substitution the panel
 * and the floor's thought bubble make, so `mcp__gmail__send` reads
 * `Gmail · send` on all three surfaces rather than three different ways.
 *
 * Ordered by id, not by `currentTool.since`. `since` moves on every tool call,
 * so ordering by it would let two agents swap places on a wall between two
 * frames for no reason a reader could see; an id never moves, which is the
 * same reason `assignSeats` sorts by it.
 *
 * @param {any[]} agents the room's own agents
 * @returns {string[]} at most `PLATE_DOING_ENTRIES` `name · summary` entries
 */
export function doingEntriesFor(agents) {
  /** @type {string[]} */
  const out = [];
  const live = [...(agents || [])]
    .filter((a) => a && a.ackState === 'active' && a.activityState === 'working')
    .filter((a) => a.currentTool && typeof a.currentTool.summary === 'string')
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  for (const a of live) {
    const summary = humaniseToolSummary(a.currentTool.name, a.currentTool.summary).trim();
    if (!summary) continue;
    const cut =
      summary.length > PLATE_DOING_CHARS ? summary.slice(0, PLATE_DOING_CHARS - 1) + '…' : summary;
    out.push(`${a.label || a.mk || a.id} · ${cut}`);
    if (out.length === PLATE_DOING_ENTRIES) break;
  }
  return out;
}

/**
 * The plate's lines alone. The shape every caller before WP-81 wanted, kept
 * because `plan-rooms.js`'s fallback `plateLines`, `scene.js`'s re-export and
 * four test files all speak it.
 * @param {any} room
 * @param {any} snapshot
 * @param {any} [plan]
 * @returns {string[]}
 */
export function plateLinesFor(room, snapshot, plan) {
  return platePlanFor(room, snapshot, plan).lines;
}

export function resolveLabelCollisions(items) {
  /** @type {{x:number,y:number,w:number,h:number}[]} */
  const placed = [];
  const result = new Map();

  const overlaps = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // `pin` is an exemption and `keep` is only a priority. Making needs-you
  // labels exempt collapsed in the case that matters most: every agent in the
  // waiting area is for_review, so all of them were exempt at once and the
  // office turned into an unreadable band of overlapping names. Exactly one
  // label — the selected agent's — is ever truly exempt.
  const pinned = items.filter((it) => it.pin);
  const kept = items.filter((it) => it.keep && !it.pin);
  const rest = items.filter((it) => !it.keep && !it.pin);

  for (const it of pinned) {
    placed.push({ x: it.x, y: it.y, w: it.w, h: it.h });
    result.set(it.id, { offsetY: 0 });
  }

  for (const it of [...kept, ...rest]) {
    let chosenOffset = null;
    for (let attempt = 0; attempt <= MAX_LABEL_OFFSET_ATTEMPTS; attempt++) {
      const offsetY = attempt * it.h;
      const rect = { x: it.x, y: it.y + offsetY, w: it.w, h: it.h };
      if (!placed.some((p) => overlaps(rect, p))) {
        chosenOffset = offsetY;
        placed.push(rect);
        break;
      }
    }
    result.set(it.id, chosenOffset === null ? null : { offsetY: chosenOffset });
  }

  return result;
}

/**
 * WP-60. WHICH WAITING BADGES MAY BE DRAWN, AND WHAT STANDS FOR THE ONES THAT
 * MAY NOT.
 *
 * On the owner's own floor at 1920 x 1080 the office wall carried seven
 * crimson pills in one row — `3d 2d 21h 2d 3h 2d 2h 1h 58m 1h 55m 20m` — each
 * one overlapping its neighbour into a band of digits that says nothing. Every
 * number in it was true and none of them was readable, which is the worst way
 * for a floor to be wrong: it looks like data.
 *
 * THE RULE. A badge is drawn only where it does not collide with a neighbour's
 * badge. The colliding ones are not nudged and not stacked — there is nowhere
 * for a pill above a seated row to go, and `resolveLabelCollisions` above
 * already proves what happens when everything in the waiting area claims an
 * exemption at once — they are REPLACED BY ONE PILL at the row's start, which
 * says the two things the seven pills were between them saying: how many are
 * waiting, and how long the worst of them has been.
 *
 * NOTHING IS HIDDEN BY THIS. Each person keeps their state icon and their
 * name, which is what says WHO is waiting; the panel and the queue strip still
 * carry every individual time, to the minute, and this is the only surface
 * where those times were ever unreadable. A badge is a glance, not a record.
 *
 * A ROW is a set of badges whose boxes overlap VERTICALLY, which on a seated
 * queue is exactly the people sharing a run of sofa. Two rows of waiting agents
 * one above the other are two independent problems and get two independent
 * answers, because a pill for the row above cannot say anything true about the
 * row below.
 *
 * Pure, and takes boxes rather than a canvas, so `scene-math.test.mjs` can hold
 * the rule without a DOM — the same contract `resolveLabelCollisions` has.
 *
 * @param {{id:string, x:number, y:number, w:number, h:number, ms:number}[]} items
 *   `x,y,w,h`: the badge pill's screen-space box (`badgeBox` in `rig.js`).
 *   `ms`: how long that agent has been waiting, for the aggregate's `oldest`.
 * @returns {{drawn:Set<string>, pills:{x:number,y:number,count:number,oldest:number}[]}}
 *   `drawn` is the ids that keep their own badge. Each pill is a row's
 *   aggregate: `x` is its LEFT edge — the row's start — and `y` its top.
 */
export function resolveBadgeCollisions(items) {
  /** @type {Set<string>} */
  const drawn = new Set();
  /** @type {{x:number,y:number,count:number,oldest:number}[]} */
  const pills = [];
  if (!items || items.length === 0) return { drawn, pills };

  // Down the wall first, then along it. `records` reaches here sorted by world
  // y, which is not the same order — a row of sofa is one world y but several
  // screen ones once the seats are at different depths — so the rows are cut
  // here from the boxes that will actually be drawn.
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  /** @type {typeof sorted[]} */
  const rows = [];
  let bottom = -Infinity;
  for (const it of sorted) {
    // A new row starts where a badge clears the ones above it outright. The
    // running bottom is the SHALLOWEST of the row so far, so one tall pill
    // cannot swallow the row under it.
    if (!rows.length || it.y >= bottom) {
      rows.push([it]);
      bottom = it.y + it.h;
    } else {
      rows[rows.length - 1].push(it);
      bottom = Math.min(bottom, it.y + it.h);
    }
  }

  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);
    // COLLIDING MEANS TOUCHING EITHER NEIGHBOUR, not merely following one that
    // was kept. A badge with clear air on both sides is readable wherever it
    // stands and keeps its own number; the run of seven that touch each other
    // are all of them unreadable, which is why all seven go into the pill and
    // it says "7 waiting" rather than "6".
    const hits = row.map(
      (it, i) =>
        (i > 0 && row[i - 1].x + row[i - 1].w > it.x) ||
        (i < row.length - 1 && it.x + it.w > row[i + 1].x),
    );
    /** @type {typeof row} */
    const colliding = [];
    row.forEach((it, i) => {
      if (hits[i]) colliding.push(it);
      else drawn.add(it.id);
    });
    if (!colliding.length) continue;
    pills.push({
      // The row's START, and left-aligned there: the pill is wider than the
      // badge it replaces and everything to its right is a slot this pass just
      // emptied, so it grows into space nothing else wants.
      x: colliding[0].x,
      y: Math.min(...colliding.map((it) => it.y)),
      count: colliding.length,
      oldest: Math.max(...colliding.map((it) => it.ms || 0)),
    });
  }

  return { drawn, pills };
}

/**
 * THE FOUR TYPE SIZES A PLATE IS SET IN, AND THE BASELINE EACH SITS ON
 * (WP-81, `docs/plan/10-INTERIOR-DESIGN.md` §3.8).
 *
 * Every number is stated at `PLATE_BASE_SCALE` and multiplied by
 * `plateScaleFor` at draw time, exactly as the two sizes before them were.
 * The baselines are measured from the room's own top edge — the top of
 * `PLATE_BAND` — which is what lets `_drawRoomPlate` decide how many of them
 * the band can hold before it draws any.
 *
 * §3.8 asked for three sizes. There are four here because there are four
 * ranks, and the fourth costs no legibility: the hero is a size ABOVE the
 * name rather than a fourth size below it, and nothing is set under 11 px,
 * which is the floor §3.8 set. That the hero outranks the room's own name is
 * the whole point of the package — the name says which room, the hero says
 * whether to get up.
 */
export const PLATE_ROWS = Object.freeze([
  { px: 12.5, weight: 700, mono: false, lead: 12, halo: 3 }, // 0 title
  { px: 14, weight: 700, mono: true, lead: 16, halo: 3.2 }, // 1 hero
  { px: 11, weight: 600, mono: false, lead: 12, halo: 2.6 }, // 2 doing
  { px: 11, weight: 600, mono: true, lead: 11, halo: 2.6 }, // 3 tertiary
]);

/** How far a row's descenders reach below its baseline, for the band fit. */
const PLATE_DESCENT = 3;

/** The state dot's radius, and the gap it leaves before the hero's first glyph. */
const PLATE_DOT_R = 2.6;
const PLATE_DOT_GAP = 9;

export class SceneLabels extends SceneCamera {
  /**
   * The room's name and the three ranked lines under it, as plain text
   * directly on the floor — no card, no fill, no border, no rounded rect
   * (CONTRACTS-WP15.md §3 and `00-REQUIREMENTS.md` R-082: "do not make white
   * background pop up box, maybe just minimal fonts without background
   * colour"). `10-INTERIOR-DESIGN.md` §3.8 wanted the plate to become a quiet
   * CARD; it is refused here and the reason is R-082, which is the owner's own
   * words about this exact object and is marked done. What §3.8 actually needs
   * from a card — that nothing on the plate out-shouts the wall — is kept by
   * deriving `plateHalo` from the theme's `wall` instead of from a hard-coded
   * near-white, so the brightest thing behind a plate is now exactly the
   * brightest surface a room is allowed (`themes.js`).
   *
   * THE PLATE COLLAPSES FROM THE BOTTOM, IN RANK ORDER. `PLATE_BAND` is the
   * furniture-free strip across the top of every room, and §7's "a label never
   * covers furniture" holds only while the plate stays inside it. So the band's
   * height in pixels decides how many rows are drawn: the tertiary line goes
   * first, then the doing line, and a plate too narrow for its hero drops the
   * `· oldest …` tail rather than ellipsising a number. The title and the hero
   * are never dropped — between them they are the whole plate.
   */
  _drawRoomPlate(room, camera) {
    const ctx = this.ctx;
    const topLeft = worldToScreen({ x: room.x, y: room.y }, camera);
    const plate = this._platePlanFor(room);
    // A plate belongs to its room and must not spill over the corridor into
    // the neighbour: clamp it to the room's own width and ellipsise instead.
    const worldScale = camera.zoom * camera.U;
    const roomW = room.w * worldScale;
    // Every measurement below is stated at `PLATE_BASE_SCALE` and multiplied
    // by this, so the plate keeps its proportion to the door it is on.
    const k = plateScaleFor(worldScale);
    const maxW = Math.max(60 * k, roomW - 12 * k);
    const x = topLeft.x + 6 * k;
    const bandPx = (Number(room.plateBand) || PLATE_BAND) * worldScale;

    ctx.save();
    // The 2D context is shared with the rig, which can leave textAlign at
    // 'center' after drawing a name label or a badge. Text state is global,
    // so anything that draws text must assert what it needs rather than
    // inherit it.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // A halo, not a card.
    //
    // The ink already clears 4.5:1 against every floor tone, so this is not a
    // contrast problem — it is a PATTERN problem. Over the herringbone in the
    // office and the lounge, small glyphs sit on top of high-frequency plank
    // seams and simply disappear into them. A pale outline separates the
    // letterforms from whatever is behind them without putting a box back on
    // the floor, which is what the user asked to be rid of.
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    const ink = [
      PALETTE.plateInkSecondary, // the name is context: which room
      PALETTE.plateInk, // the hero is the message: what to do
      PALETTE.plateInkSecondary,
      PALETTE.plateInkTertiary,
    ];
    let widest = 0;
    let cursor = 0;
    let lastY = topLeft.y + PLATE_ROWS[0].lead * k;
    for (let i = 0; i < PLATE_ROWS.length; i++) {
      const row = PLATE_ROWS[i];
      let text = plate.lines[i] || '';
      // An empty slot takes no space: a room with nothing running closes the
      // gap rather than leaving a hole where its doing line would have been.
      if (!text) continue;
      const baseline = cursor + row.lead;
      // The band is the contract (§7). A row whose descenders would leave it
      // is not drawn, and every row below it goes with it — the ranking above
      // is exactly the order they are worth dropping in.
      if (i > 0 && (baseline + PLATE_DESCENT) * k > bandPx) break;
      const y = topLeft.y + baseline * k;
      ctx.font = `${row.weight} ${(row.px * k).toFixed(2)}px ${row.mono ? FONT_MONO : FONT_UI}`;
      // The hero is the one line that shortens rather than truncates: `2 need
      // you · oldest 1…` is a worse sentence than `2 need you`, and a cut
      // number is a wrong number.
      const dotted = i === 1 && plate.dot ? PLATE_DOT_GAP * k : 0;
      if (i === 1 && ctx.measureText(text).width + dotted > maxW) text = plate.heroHead;
      // Two people doing two things is one entry too many for a narrow door.
      if (i === 2 && plate.doing.length > 1 && ctx.measureText(text).width > maxW) {
        text = plate.doing[0];
      }
      text = ellipsise(ctx, text, maxW - dotted);
      if (!text) continue;
      if (dotted) {
        // State is never colour alone on this floor (`style.css`, the header's
        // own breakdown): the dot is the state, the words beside it say the
        // same thing, and the ink they are set in is the ink everything else
        // on the plate uses. The dot clears 3:1 against the plate's ground and
        // the text clears 4.5:1 — the split `10-INTERIOR-DESIGN.md` §1.3 had
        // to make on the characters, made again here.
        ctx.beginPath();
        ctx.arc(x + PLATE_DOT_R * k, y - (row.px / 3) * k, PLATE_DOT_R * k, 0, Math.PI * 2);
        ctx.fillStyle = PALETTE.plateHalo;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + PLATE_DOT_R * k, y - (row.px / 3) * k, PLATE_DOT_R * 0.72 * k, 0, Math.PI * 2);
        ctx.fillStyle = plate.dot;
        ctx.fill();
      }
      ctx.strokeStyle = PALETTE.plateHalo;
      ctx.lineWidth = row.halo * k;
      ctx.strokeText(text, x + dotted, y);
      ctx.fillStyle = ink[i];
      ctx.fillText(text, x + dotted, y);
      widest = Math.max(widest, ctx.measureText(text).width + dotted);
      cursor = baseline;
      lastY = y;
    }
    ctx.restore();

    // No card is drawn (above), but a room plate is still click-to-filter
    // (VISUAL-SPEC §8) — the hit rect wraps the text itself rather than a
    // drawn plate. Every line that was drawn is inside it: a plate you can
    // read is a plate you can click. `tooltip` rides along so the hover can
    // say what the plate stopped saying (WP-81).
    const top = topLeft.y + (PLATE_ROWS[0].lead - 11) * k;
    this._plateRects.push({
      x,
      y: top,
      w: widest,
      h: lastY + 4 * k - top,
      kind: room.kind === 'project' ? 'project' : room.kind,
      id: room.id,
      tooltip: plate.tooltip,
    });
  }

  _platePlanFor(room) {
    return platePlanFor(room, this._snapshot, this._plan);
  }

  _plateLinesFor(room) {
    return plateLinesFor(room, this._snapshot, this._plan);
  }
}
