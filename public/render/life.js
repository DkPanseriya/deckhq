/**
 * CHARACTER LIFE — WP-87, `docs/plan/12-MOTION-AND-CREW.md` §2.
 *
 * What a figure does beyond holding its pose: the typing cadence, the visor
 * flicker on a real tool call, the thought cloud that grows while a turn is
 * open and nothing is running, the wave, the page flip, the stall dots, the
 * power-down, the lounge, walking and running, and the two one-shots at the
 * ends of a session's life on the floor.
 *
 * THREE RULES, ALL OF THEM §1's, AND ALL OF THEM ENFORCED HERE RATHER THAN AT
 * THE DRAW SITE.
 *
 *   1. **Every phase comes from the injected clock.** Nothing in this file
 *      calls `Date.now()`, `performance.now()` or `Math.random()`. A phase is a
 *      pure function of `(nowMs, a real timestamp on the agent, identity)`,
 *      where `nowMs` is `public/clock.js`'s — pinned when the daemon's clock
 *      is pinned, which is what lets a golden photograph a MOVING frame.
 *   2. **Reduced motion is informative, not absent.** Every term below has a
 *      stated reduced value and it is the value that best communicates the
 *      state: the cloud at its size, the page held flat, two dots, the hand up.
 *      None of them carries a phase term, so two renders at two different
 *      clocks are byte-identical (`test/unit/character-life.test.mjs`).
 *   3. **Nothing animates that the registry did not report.** The visor
 *      flicker needs a `currentTool.since` that actually moved; the cloud needs
 *      a turn open with no tool in it; the power-down needs an end timestamp.
 *      Where the field is absent the motion does not happen and is never
 *      simulated — the refusal is the feature.
 *
 * NO ALLOCATION PER CALL. `characterLife()` fills one module-scope scratch
 * object and returns it, exactly as `rig-pose.js` holds its frame in module
 * scope, because the floor holds a hundred agents and a per-agent object per
 * frame is six thousand objects a second. The caller must read what it needs
 * before calling again for the next agent — which is what `scene-draw.js`
 * does, one figure at a time, synchronously.
 *
 * Pure: no DOM, no canvas, no `node:` import, so `node --test` loads it
 * directly (docs/DEVIATIONS.md §122).
 */

import { hashString } from './agents-core.js';

// ---------------------------------------------------------------- the table
//
// `docs/plan/12-MOTION-AND-CREW.md` §2's table, as data. `frames` and `period`
// are requirements, not hints: `test/unit/character-life.test.mjs` asserts each
// row against the document. `minLod` is the lowest LOD band the animation is
// drawn in at all — §1.3: at L0 the thought cloud, the page flip, the stall
// dots and every lounge prop are dropped, and **the visor and the raised hand
// are in no drop list at any zoom**.

/**
 * @typedef {object} LifeSpec
 * @property {number} frames   how many distinct frames the strip has
 * @property {number} period   seconds for one cycle (or for the one shot)
 * @property {boolean} loops   whether it repeats
 * @property {0|1|2} minLod    the lowest LOD band it is drawn in
 * @property {number} [every]  seconds between one-shots that repeat on a timer
 * @property {number} [speed]  plan units per second, for the two trips
 */

/** @type {Readonly<Record<string, LifeSpec>>} */
export const LIFE = Object.freeze({
  type: Object.freeze({ frames: 4, period: 0.9, loops: true, minLod: 0 }),
  visor_flicker: Object.freeze({ frames: 3, period: 0.24, loops: false, minLod: 0 }),
  think: Object.freeze({ frames: 4, period: 3.2, loops: true, minLod: 1 }),
  wave: Object.freeze({ frames: 4, period: 1.4, loops: true, minLod: 0 }),
  page_flip: Object.freeze({ frames: 4, period: 0.5, loops: false, minLod: 1, every: 12 }),
  slump: Object.freeze({ frames: 3, period: 4, loops: true, minLod: 1 }),
  power_down: Object.freeze({ frames: 5, period: 1.6, loops: false, minLod: 0 }),
  walk: Object.freeze({ frames: 2, period: 0.8, loops: true, minLod: 1, speed: 2.6 }),
  run: Object.freeze({ frames: 4, period: 0.52, loops: true, minLod: 1, speed: 4.6 }),
  spawn: Object.freeze({ frames: 3, period: 0.32, loops: false, minLod: 0 }),
  despawn: Object.freeze({ frames: 3, period: 0.42, loops: false, minLod: 0 }),
});

/**
 * What L0 gives up (§1.3). DERIVED from the table above rather than written a
 * second time, so the LOD test reads the rig's own answer and the two can never
 * disagree — the class of drift `rigDetail()` was introduced to close.
 */
export const LIFE_DROPPED_AT_L0 = Object.freeze(
  Object.keys(LIFE).filter((name) => LIFE[name].minLod > 0),
);

/**
 * What NOTHING drops, at any zoom and any LOD (§1.3, VISUAL-SPEC §3.6). The
 * visor says what state this is and the raised hand says it needs you; a floor
 * that stops drawing either at distance has stopped being a monitor.
 */
export const LIFE_NEVER_DROPPED = Object.freeze(['visor_flicker', 'wave']);

/** @param {string} name @param {0|1|2} lod */
export function lifeDrawnAt(name, lod) {
  const spec = LIFE[name];
  if (!spec) return false;
  return lod >= spec.minLod;
}

// ------------------------------------------------------ thresholds and gates

/** Seconds of quiet, with a turn open and no tool running, before the cloud. */
export const THINK_MIN_S = 2;
/** The cloud's three growth steps, in seconds (§2: one lobe, two, three). */
export const THINK_STEPS_S = Object.freeze([2, 6, 15]);
/** The most lobes the cloud ever reaches. It stops; it does not keep growing. */
export const THINK_MAX_LOBES = 3;
/** No more than one visor flicker per this many ms, however many tools open. */
export const FLICKER_MIN_GAP_MS = 500;
/** How long a benched agent holds one activity (§2, VISUAL-SPEC §4.3). */
export const LOUNGE_HOLD_MIN_S = 45;
export const LOUNGE_HOLD_MAX_S = 90;

// --------------------------------------------------------------- the phases

/**
 * A phase in `[0, 1)` for one animation, and THE ONLY WAY TIME ENTERS ANY OF
 * THEM.
 *
 * Three behaviours, and the third is the whole of WP-87's golden story:
 *
 *   - `reduced` returns exactly `0`, so every term derived from it drops out of
 *     the arithmetic and the frame has no time in it at all. Two renders at two
 *     different clocks are then byte-identical, which is what the reduced-motion
 *     test measures.
 *   - `pinned` — a number in `[0, 1)`, from `?phase=` — returns exactly that,
 *     for every animation, WITHOUT disabling motion. A one-shot plays at that
 *     phase and a gated one (the page flip's twelve-second timer) is treated as
 *     open, because the point of the pin is a still photograph in which every
 *     animation in §2 is visible at once.
 *   - otherwise the seconds are folded into the period.
 *
 * @param {number} seconds elapsed seconds from the injected clock
 * @param {number} period  the animation's own period, seconds
 * @param {{reduced?:boolean, pinned?:number|null}} [opts]
 * @returns {number} a phase in [0, 1)
 */
export function lifePhase(seconds, period, opts) {
  if (opts && opts.reduced) return 0;
  const pin = opts ? opts.pinned : null;
  if (typeof pin === 'number' && Number.isFinite(pin)) {
    const p = pin % 1;
    return p < 0 ? p + 1 : p;
  }
  const s = Number(seconds);
  const d = Number(period);
  if (!Number.isFinite(s) || !Number.isFinite(d) || d <= 0) return 0;
  let p = (s % d) / d;
  if (p < 0) p += 1;
  return p;
}

/**
 * Which frame of a strip a phase lands on. A strip is frames, not a blend —
 * §2 states a frame COUNT for every animation and a four-frame wave drawn as a
 * continuum is a different animation.
 * @param {number} phase  in [0, 1)
 * @param {number} frames
 * @returns {number} 0 .. frames-1
 */
export function lifeFrame(phase, frames) {
  const n = Math.max(1, Math.floor(frames) || 1);
  const p = Number.isFinite(phase) ? ((phase % 1) + 1) % 1 : 0;
  return Math.min(n - 1, Math.floor(p * n));
}

/**
 * Seconds between two instants on the injected clock, floored at zero.
 *
 * Zero rather than a negative for a timestamp in the future, which a live
 * daemon genuinely produces: `now` on a snapshot is a sample taken when the
 * snapshot was built, and a hook event can be stamped after it.
 * @param {number} nowMs @param {unknown} atMs
 * @returns {number} seconds, or -1 when `atMs` is not a usable instant
 */
export function sinceS(nowMs, atMs) {
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) return -1;
  if (!Number.isFinite(nowMs)) return -1;
  return Math.max(0, (nowMs - atMs) / 1000);
}

// ------------------------------------------------------------ the animations

/**
 * How many lobes the thought cloud has, from how long the turn has been quiet.
 *
 * §2: *"It grows in three steps — one lobe at 2 s, two at 6 s, three at 15 s —
 * and then stops, because a cloud that kept growing would be a claim about
 * difficulty the data cannot support."* Zero is "no cloud at all", which is
 * what a running tool and a closed turn both get.
 * @param {number} quietS seconds since the last observed event
 * @returns {0|1|2|3}
 */
export function thoughtLobes(quietS) {
  const s = Number(quietS);
  if (!Number.isFinite(s)) return 0;
  let lobes = 0;
  for (const step of THINK_STEPS_S) if (s >= step) lobes++;
  return /** @type {0|1|2|3} */ (Math.min(THINK_MAX_LOBES, lobes));
}

/**
 * IS THIS AGENT THINKING, as far as anything observed can say?
 *
 * §2: *"DeckHQ cannot see extended reasoning … What it CAN see is that a turn
 * is open, no tool is running, and nothing has been written for N seconds."*
 * All three, and no fourth: a closed turn is `for_review`'s business, a running
 * tool is the bubble's, and an agent in any state but `working` is not mid-turn
 * at all.
 * @param {{activityState?:string, ackState?:string, currentTool?:unknown, turnEnded?:boolean}} agent
 */
export function turnIsOpen(agent) {
  if (!agent) return false;
  if (agent.ackState !== 'active') return false;
  if (agent.activityState !== 'working') return false;
  if (agent.turnEnded === true) return false;
  return !agent.currentTool;
}

/**
 * The visor flash, `0` (no flash) to `1` (full), over `visor_flicker`'s 0.24 s.
 *
 * Event motion, and the ONLY honest variable on a working figure: it fires on
 * a `currentTool.since` the adapter genuinely saw move. The 0.5 s cap lives in
 * `AgentRuntime#sync`, which is the only place that can see one `since`
 * replace another; this is handed the instant that cap ACCEPTED and does the
 * arithmetic.
 *
 * Three frames and no blend, so it reads as a flash rather than a fade.
 * @param {number} nowMs @param {unknown} firedAtMs
 * @param {{reduced?:boolean, pinned?:number|null}} [opts]
 * @returns {number} 0..1
 */
export function visorFlicker(nowMs, firedAtMs, opts) {
  // Reduced motion is "the lit visor, no flash" — §2's own words.
  if (opts && opts.reduced) return 0;
  const spec = LIFE.visor_flicker;
  const pin = opts ? opts.pinned : null;
  const elapsed = sinceS(nowMs, firedAtMs);
  if (elapsed < 0) return 0; // no tool event ever observed: no flash, ever
  if (typeof pin === 'number' && Number.isFinite(pin)) {
    return (lifeFrame(lifePhase(0, spec.period, opts), spec.frames) + 1) / spec.frames;
  }
  if (elapsed >= spec.period) return 0;
  const frame = lifeFrame(elapsed / spec.period, spec.frames);
  // Brightest on the first frame, falling away over the other two.
  return (spec.frames - frame) / spec.frames;
}

/**
 * The page flip, as how OPEN the page is: `1` flat (the reduced form, "page
 * held flat"), `0` edge-on.
 *
 * Idle motion, so §1.4's third class applies: it carries no meaning, it runs
 * only while `for_review` holds, and it stops the instant the state changes.
 * One flip of 0.5 s every 12 s.
 * @param {number} quietS seconds the review has been waiting
 * @param {{reduced?:boolean, pinned?:number|null}} [opts]
 * @returns {number} 0..1
 */
export function pageFlip(quietS, opts) {
  if (opts && opts.reduced) return 1;
  const spec = LIFE.page_flip;
  const pin = opts ? opts.pinned : null;
  let within;
  if (typeof pin === 'number' && Number.isFinite(pin)) {
    // A pinned phase opens the gate: the capture exists to show the flip.
    within = lifePhase(0, spec.period, opts) * spec.period;
  } else {
    const s = Number(quietS);
    if (!Number.isFinite(s) || s < 0) return 1;
    within = s % (spec.every || spec.period);
    if (within >= spec.period) return 1; // the eleven and a half seconds of holding it
  }
  const frame = lifeFrame(within / spec.period, spec.frames);
  // Four frames: flat, half, edge-on, half. The page never turns inside out.
  return [1, 0.5, 0, 0.5][frame];
}

/**
 * The stall dots' opacity. Two dots, and they are a STATE signal rather than
 * an idle one: `stalled` is the one state whose whole meaning is "nothing is
 * happening", so the dots hold at half under reduced motion instead of going.
 * @param {number} phase the `slump` phase
 * @param {{reduced?:boolean}} [opts]
 * @returns {number} 0..1
 */
export function stallDots(phase, opts) {
  if (opts && opts.reduced) return 0.55;
  const p = Number.isFinite(phase) ? phase : 0;
  // One slow rise and fall per four-second cycle, floored so the dots never
  // vanish entirely — a stalled session that looks like nothing is a session
  // the reader stops seeing.
  return 0.35 + 0.45 * (Math.sin(p * Math.PI * 2) * 0.5 + 0.5);
}

/**
 * The power-down, `0` (still lit) to `1` (dark), quantised to `power_down`'s
 * five frames.
 *
 * §2: *"`ended` LATCHES. The power-down runs once, keyed to the agent's own end
 * timestamp; a re-render afterwards draws frame 5 and nothing else."* Keying it
 * to the timestamp rather than to a flag on a record is what makes "once, ever"
 * true across a reload, a second tab and a re-plan: the arithmetic cannot run
 * twice because it is not a trigger, it is a subtraction.
 *
 * Under reduced motion it is frame 5 immediately — the ended pose, which is the
 * one this floor already drew.
 * @param {number} nowMs @param {unknown} endedAtMs
 * @param {{reduced?:boolean, pinned?:number|null}} [opts]
 * @returns {number} 0..1
 */
export function powerDown(nowMs, endedAtMs, opts) {
  if (opts && opts.reduced) return 1;
  const spec = LIFE.power_down;
  const pin = opts ? opts.pinned : null;
  if (typeof pin === 'number' && Number.isFinite(pin)) {
    return (lifeFrame(lifePhase(0, spec.period, opts), spec.frames) + 1) / spec.frames;
  }
  const elapsed = sinceS(nowMs, endedAtMs);
  // No end timestamp is not "it never ended" — it is "nothing told us when".
  // A figure the model calls `ended` is drawn ended, which is frame 5.
  if (elapsed < 0 || elapsed >= spec.period) return 1;
  return (lifeFrame(elapsed / spec.period, spec.frames) + 1) / spec.frames;
}

/**
 * A one-shot envelope, `0` at the start and `1` when it is over. Both ends of a
 * session's life on the floor use it: `spawn` reads it as how far the pop-in
 * has come, `despawn` as how far the fold-away has.
 * @param {number} nowMs @param {unknown} atMs @param {string} which `'spawn'`|`'despawn'`
 * @param {{reduced?:boolean, pinned?:number|null}} [opts]
 * @returns {number} 0..1
 */
export function oneShot(nowMs, atMs, which, opts) {
  const spec = LIFE[which];
  if (!spec) return 1;
  // "the figure simply present" / "the figure simply gone": both are the
  // finished frame, which is 1.
  if (opts && opts.reduced) return 1;
  const pin = opts ? opts.pinned : null;
  if (typeof pin === 'number' && Number.isFinite(pin)) {
    return (lifeFrame(lifePhase(0, spec.period, opts), spec.frames) + 1) / spec.frames;
  }
  const elapsed = sinceS(nowMs, atMs);
  if (elapsed < 0 || elapsed >= spec.period) return 1;
  return (lifeFrame(elapsed / spec.period, spec.frames) + 1) / spec.frames;
}

// ---------------------------------------------------------------- the trips

/**
 * DOES THIS TRIP RUN? §2, and it is the one claim in this file rather than a
 * state: *"The one trip that runs is an agent going to Your Office because it
 * needs input. Nothing else on this floor ever runs, which is what keeps the
 * claim readable across a room; `for_review` walks, because it is waiting on
 * you but is not blocked mid-turn."*
 * @param {string} placement where the agent is heading
 * @param {{activityState?:string, ackState?:string}|null} agent
 * @returns {boolean}
 */
export function tripRuns(placement, agent) {
  if (placement !== 'office') return false;
  if (!agent || agent.ackState !== 'active') return false;
  return agent.activityState === 'needs_input';
}

// --------------------------------------------------------------- the lounge

/**
 * WHAT HAPPENS IN EACH BAY (§2, and `docs/media/motion/lounge-activities.png`).
 *
 * `plan-service.js` lays four bays — sitting, café, quiet, games — and every
 * lounge spot now carries the name of the one it stands in. An activity is
 * therefore a fact about WHERE somebody is sitting rather than a free choice
 * over the whole clip list, which is what stopped agents playing pool in the
 * middle of a room with no table in front of them.
 *
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const BAY_ACTIVITIES = Object.freeze({
  sitting: Object.freeze(['lounge_idle']),
  cafe: Object.freeze(['coffee', 'eat']),
  quiet: Object.freeze(['read']),
  games: Object.freeze(['pool', 'table_tennis', 'board_game', 'arcade']),
});

/**
 * The bay a spot of this kind stands in — the inverse of the table above, for a
 * plan built before spots carried their own bay.
 *
 * `chat` is deliberately absent from BOTH. It is a real clip and a real thing
 * two people do in a lounge, and nothing in `plan-service.js` lays a place for
 * it: two agents facing each other need no furniture, so there is no spot to
 * deal and no bay to deal it from. Dealing it anyway would put two people
 * gesturing at each other across a pool table. It stays a clip the rotation can
 * be handed and is not one the bays offer.
 */
export const ACTIVITY_BAY = Object.freeze({
  lounge_idle: 'sitting',
  coffee: 'cafe',
  eat: 'cafe',
  read: 'quiet',
  pool: 'games',
  table_tennis: 'games',
  board_game: 'games',
  arcade: 'games',
});

/**
 * WHICH ACTIVITY, AND IT IS A HASH RATHER THAN A ROLL (§1.1, §2).
 *
 * `BAY_ACTIVITIES[bay][hash(sessionId, cycleIndex) % n]`, so two tabs on one
 * floor show the same lounge, a reload does not re-deal it, and a golden can
 * photograph it. Identity has been a pure function of the session id since
 * WP-20 and this is the same discipline applied to behaviour.
 *
 * An unknown bay falls to `sitting` rather than to nothing: a benched agent
 * always has something to be doing.
 * @param {string} sessionId
 * @param {string} bay
 * @param {number} [cycleIndex]
 * @returns {string} a clip name
 */
export function loungeActivityFor(sessionId, bay, cycleIndex = 0) {
  const pool = BAY_ACTIVITIES[bay] || BAY_ACTIVITIES.sitting;
  const n = pool.length;
  const h = hashString(`${sessionId}:${bay}:${Math.floor(cycleIndex) || 0}`);
  return pool[h % n];
}

/**
 * How long that activity is held, in ms — 45 to 90 s, from the same hash and
 * the same cycle index, never `Math.random`.
 * @param {string} sessionId @param {number} [cycleIndex]
 * @returns {number} ms
 */
export function loungeHoldMs(sessionId, cycleIndex = 0) {
  const h = hashString(`${sessionId}:hold:${Math.floor(cycleIndex) || 0}`);
  const span = LOUNGE_HOLD_MAX_S - LOUNGE_HOLD_MIN_S;
  return Math.round((LOUNGE_HOLD_MIN_S + (h % (span * 1000)) / 1000) * 1000);
}

// ---------------------------------------------------------------- the scratch

/**
 * One figure's life this frame. Module scope, filled by `characterLife()` and
 * read by `rig.js` before the next figure is computed — see the file header on
 * why it is not a fresh object per agent.
 *
 * @typedef {object} Life
 * @property {number} flicker  visor flash, 0..1
 * @property {number} lobes    thought-cloud lobes, 0 (no cloud) .. 3
 * @property {number} cloud    the cloud's sway, -1..1
 * @property {number} card     how open the held page is, 0 edge-on .. 1 flat
 * @property {number} dots     stall-dot opacity, 0 (none) .. 1
 * @property {number} power    power-down, 0 lit .. 1 dark
 * @property {number} scale    spawn/despawn size multiplier, 0..1
 * @property {number} fade     spawn/despawn opacity, 0..1
 * @property {boolean} running this trip is a run rather than a walk
 * @property {boolean} [still] an ended figure whose power-down has run: no bob, no blink
 */

/** @type {Life} */
const _life = {
  flicker: 0,
  lobes: 0,
  cloud: 0,
  card: 1,
  dots: 0,
  power: 0,
  scale: 1,
  fade: 1,
  running: false,
  still: false,
};

/**
 * The phase options every helper below is handed, in module scope for the same
 * reason `_life` is: `characterLife` runs once per visible agent per frame and
 * a fresh `{reduced, pinned}` per call is a hundred objects a frame.
 * @type {{reduced:boolean, pinned:number|null}}
 */
const _phaseOpts = { reduced: false, pinned: null };

/** The still, informative frame: every term at its reduced-motion value. */
function rest() {
  _life.flicker = 0;
  _life.lobes = 0;
  _life.cloud = 0;
  _life.card = 1;
  _life.dots = 0;
  _life.power = 0;
  _life.scale = 1;
  _life.fade = 1;
  _life.running = false;
  _life.still = false;
  return _life;
}

/**
 * EVERYTHING ONE FIGURE IS DOING THIS FRAME, from the snapshot and the clock
 * and nothing else.
 *
 * The honesty rule is this function's post-condition and the shape of its
 * body: every branch is gated on a field the registry actually reported, and
 * the default for a missing field is the still frame rather than a guess.
 *
 * @param {{id?:string, activityState?:string, ackState?:string, turnEnded?:boolean,
 *   currentTool?:{since?:number}|null, lastActivityAt?:number, reviewSince?:number|null}|null} agent
 * @param {{nowMs:number, state:string, lod:0|1|2, reduced?:boolean,
 *   pinned?:number|null, flickerAt?:number|null, spawnAt?:number|null,
 *   leftAt?:number|null, walking?:boolean, running?:boolean}} opts
 * @returns {Life} the shared scratch — read it before the next call
 */
export function characterLife(agent, opts) {
  const life = rest();
  if (!agent || !opts) return life;
  const reduced = opts.reduced === true;
  const lod = /** @type {0|1|2} */ (opts.lod ?? 2);
  const phaseOpts = _phaseOpts;
  phaseOpts.reduced = reduced;
  phaseOpts.pinned = opts.pinned ?? null;
  const now = opts.nowMs;

  // THE VISOR, AT EVERY LOD. §1.3: the visor is in no drop list.
  life.flicker = visorFlicker(now, opts.flickerAt ?? null, phaseOpts);

  // THE ENDS OF A LIFE ON THE FLOOR. A pop-in and a fold-away are the figure's
  // own size, so they are computed before anything hangs off it.
  if (typeof opts.leftAt === 'number') {
    const t = oneShot(now, opts.leftAt, 'despawn', phaseOpts);
    life.scale = 1 - t;
    life.fade = 1 - t;
    return life; // a figure folding away does nothing else
  }
  if (typeof opts.spawnAt === 'number') {
    const t = oneShot(now, opts.spawnAt, 'spawn', phaseOpts);
    life.scale = t;
    life.fade = t;
  }

  life.running = opts.running === true;
  if (opts.walking === true || life.running) return life;

  const state = opts.state;
  if (state === 'ended' || state === 'let_go') {
    // §1.4's list of refusals: *"no animation at all on `let_go`"*. A let-go
    // session is drawn powered down and is not animated into it.
    life.power = state === 'let_go' ? 1 : powerDown(now, agent.lastActivityAt, phaseOpts);
    // §2's table: `ended` is a slump, "seated, still". Once the one-shot
    // power-down has run, nothing on the figure moves — not the slump's
    // breathing, not the antenna bob, not the visor blink (audit F9: every
    // ended body in the lounge drew 1-2 px of motion between two frames).
    life.still = life.power >= 1;
    return life;
  }

  if (state === 'working' && lifeDrawnAt('think', lod) && turnIsOpen(agent)) {
    const quiet = sinceS(now, agent.lastActivityAt);
    life.lobes = quiet < 0 ? 0 : thoughtLobes(quiet);
    if (life.lobes > 0) {
      life.cloud = reduced
        ? 0
        : Math.sin(lifePhase(quiet, LIFE.think.period, phaseOpts) * Math.PI * 2);
    }
  } else if (state === 'stalled' && lifeDrawnAt('slump', lod)) {
    const quiet = sinceS(now, agent.lastActivityAt);
    life.dots = stallDots(
      lifePhase(quiet < 0 ? 0 : quiet, LIFE.slump.period, phaseOpts),
      phaseOpts,
    );
  } else if (state === 'for_review' && lifeDrawnAt('page_flip', lod)) {
    const waited = sinceS(now, agent.reviewSince ?? agent.lastActivityAt);
    life.card = pageFlip(waited < 0 ? 0 : waited, phaseOpts);
  }

  return life;
}
