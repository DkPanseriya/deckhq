/**
 * What a character does while it is standing there (WP-22 follow-up).
 *
 * Split out of `agents.js` unchanged: which activity comes next, how a
 * paired one finds a partner, and which clip an activity is drawn as. The
 * rotation itself is `clips.js`'s; this is the choosing.
 *
 * Pure, like every `agents-*` module and `agents.js` itself: no `node:`
 * import, no `document`, no `window`, no canvas. That is what lets
 * `test/unit/*.mjs` load this side of the renderer directly under
 * `node --test` (docs/DEVIATIONS.md §122).
 */

import {
  LOUNGE_CLIPS,
  PAIRED_ACTIVITIES,
  SOLO_ACTIVITIES,
  ROTATION_MIN_S,
  ROTATION_MAX_S,
} from './agents-core.js';

/** @typedef {import('./agents-core.js').Room} Room */
/** @typedef {import('./agents-core.js').Door} Door */
/** @typedef {import('./agents-core.js').Plan} Plan */
/** @typedef {import('./agents-core.js').Seat} Seat */
/** @typedef {import('./agents-core.js').PlacedSeat} PlacedSeat */
/** @typedef {import('./agents-core.js').LoungeSpot} LoungeSpot */
/** @typedef {import('./agents-core.js').NavLine} NavLine */
/** @typedef {import('./agents-core.js').WalkPoint} WalkPoint */
/** @typedef {import('./agents-core.js').AgentLike} AgentLike */
/** @typedef {import('./agents-core.js').AgentRecord} AgentRecord */

// -------------------------------------------------------- activity rotation

/**
 * Decide the next lounge activity for a benched agent. Paired activities
 * degrade to a solo activity when `availability[activity]` is not truthy.
 * Uses the record's own seeded RNG, so a fixed sequence of calls against a
 * fresh record (same agent id) always reproduces the same sequence.
 *
 * Delegates to `makeActivityRotation` from `./clips.js` when the caller
 * supplies one (e.g. once that file exists and `scene.js` wires it through);
 * otherwise this is the fallback implementation of the same §4.3 rule.
 *
 * @param {AgentRecord} record
 * @param {Record<string, boolean>} [availability]  which paired activities
 *   currently have an open partner slot
 * @param {(record:AgentRecord, availability:Record<string,boolean>) => {activity:string,duration:number,paired:boolean}} [makeActivityRotation]
 * @returns {{activity:string, duration:number, paired:boolean}}
 */
export function pickNextActivity(record, availability = {}, makeActivityRotation) {
  if (typeof makeActivityRotation === 'function') {
    return makeActivityRotation(record, availability);
  }
  const rng = record.rng;
  const idx = Math.floor(rng() * LOUNGE_CLIPS.length);
  let activity = LOUNGE_CLIPS[idx];
  let paired = PAIRED_ACTIVITIES.has(activity);
  if (paired && !availability[activity]) {
    const soloIdx = Math.floor(rng() * SOLO_ACTIVITIES.length);
    activity = SOLO_ACTIVITIES[soloIdx];
    paired = false;
  }
  const duration = ROTATION_MIN_S + rng() * (ROTATION_MAX_S - ROTATION_MIN_S);
  return { activity, duration, paired };
}

/**
 * Adapts `clips.js`'s real `makeActivityRotation(rng)` (a factory returning
 * `{ pick({partnerFree}) => {activity, holdMs, degraded} }`) to the
 * `{activity, duration, paired}` shape used internally here. `agents.js`
 * never imports `./clips.js` itself (see file header), so `scene.js` passes
 * the real factory in through `AgentRuntime#step`'s `opts.makeActivityRotation`
 * once it exists; this is the seam that consumes it.
 * @param {AgentRecord} record
 * @param {Record<string, boolean>} availability
 * @param {(rng: () => number) => {pick: (opts?: {partnerFree?: (activity:string)=>boolean}) => {activity:string, holdMs:number, degraded:boolean}}} makeActivityRotationFactory
 */
export function pickNextActivityFromClips(record, availability, makeActivityRotationFactory) {
  const picker = makeActivityRotationFactory(record.rng);
  const result = picker.pick({ partnerFree: (activity) => !!availability[activity] });
  return { activity: result.activity, duration: result.holdMs / 1000, paired: !result.degraded };
}

// -------------------------------------------------------------- clip mapping

/**
 * Minimal fallback for `clipForState` (specified to live in `./clips.js`,
 * which this module cannot statically import — see file header). Only covers
 * desk states; office/lounge/let_go are handled by their callers.
 * @param {AgentLike['activityState']} activityState
 */
export function clipForActivity(activityState) {
  if (activityState === 'needs_input') return 'hand_raise';
  if (activityState === 'stalled') return 'slump';
  // An ended session is not producing output; it must not appear to type.
  if (activityState === 'ended') return 'slump';
  return 'type';
}

/**
 * The clip an agent should start when it arrives at `placement`.
 * @param {AgentLike} agent
 * @param {'desk'|'office'|'lounge'|'let_go'} placement
 */
export function initialClipFor(agent, placement) {
  if (placement === 'desk') return clipForActivity(agent.activityState);
  if (placement === 'office') return 'stand_wait';
  return null; // lounge: chosen once the agent arrives
}
