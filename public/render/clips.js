/**
 * DeckHQ motion clips — motion is data, not code.
 *
 * Every clip is a keyframe set over a Pose (docs/03-VISUAL-SPEC.md §3), sampled
 * with ease-in-out-sine interpolation. Pure data + pure functions, no DOM, no
 * canvas — this file must import cleanly under plain Node (see test/unit/clips.test.mjs).
 *
 * docs/03-VISUAL-SPEC.md §4 is the source of truth for every clip's duration
 * and description. Durations and behaviours here are requirements, not hints.
 */

/**
 * @typedef {'rest'|'key'|'grip'|'open'|'raised'} HandState
 * @typedef {null|'mug'|'cue'|'paddle'|'controller'|'piece'|'plate'} Prop
 *
 * @typedef {object} Arm
 * @property {number} shoulder
 * @property {number} elbow
 * @property {HandState} hand
 *
 * @typedef {object} Pose
 * @property {number} bodyAngle    radians, facing
 * @property {number} lean         -1 back .. 1 forward
 * @property {number} headTurn     -1 .. 1
 * @property {Arm} armL
 * @property {Arm} armR
 * @property {number} legPhase     0..1, walk cycle; ignored when seated
 * @property {boolean} seated
 * @property {Prop} prop
 * @property {number} bob          vertical breathing offset in px
 * @property {boolean} ring        floor pulse-ring marker (hand_raise only)
 * @property {number} ringPhase    0..1, drives the ring's pulse
 * @property {number} fingerPhase  0..1, finger-tap detail for `type` at L2
 * @property {number} thoughtPhase 0..1, rise-and-fade envelope for `think`'s dots
 * @property {number} speechPhase  0..1, rise-and-fade envelope for `chat`'s dots
 *
 * @typedef {object} Keyframe
 * @property {number} t     0..1, position within the clip
 * @property {Partial<Pose>} pose
 *
 * @typedef {object} Clip
 * @property {number} duration      seconds
 * @property {boolean} loop
 * @property {boolean} seated
 * @property {Prop} prop
 * @property {Keyframe[]} keys
 * @property {boolean} [paired]
 * @property {number} [partnerPhaseOffset]
 * @property {boolean} [requiresPartner]
 * @property {boolean} [ring]
 * @property {Partial<Pose>} [reducedPose]
 */

const TAU = Math.PI * 2;

/** @returns {Pose} a fully-specified default pose. */
function defaultPose() {
  return {
    bodyAngle: 0,
    lean: 0,
    headTurn: 0,
    armL: { shoulder: 0, elbow: 0, hand: 'rest' },
    armR: { shoulder: 0, elbow: 0, hand: 'rest' },
    legPhase: 0,
    seated: false,
    prop: null,
    bob: 0,
    ring: false,
    ringPhase: 0,
    fingerPhase: 0,
    thoughtPhase: 0,
    speechPhase: 0,
  };
}

/**
 * Shallow-merges a partial pose onto a base pose. `armL`/`armR` merge one
 * level deep so a keyframe can move just `hand` without repeating angles.
 * @param {Pose} base
 * @param {Partial<Pose>} partial
 * @returns {Pose}
 */
function mergePose(base, partial) {
  const out = { ...base, armL: { ...base.armL }, armR: { ...base.armR } };
  for (const key of Object.keys(partial)) {
    if (key === 'armL' || key === 'armR') {
      out[key] = { ...out[key], ...partial[key] };
    } else {
      out[key] = partial[key];
    }
  }
  return out;
}

/** Shorthand for an arm keyframe field. */
function arm(shoulder, elbow, hand) {
  return { shoulder, elbow, hand };
}

/** Shorthand for a keyframe entry. */
function kf(t, pose) {
  return { t, pose };
}

/** ease-in-out-sine, per VISUAL-SPEC §4: "interpolated with ease-in-out-sine". */
function easeInOutSine(u) {
  return -(Math.cos(Math.PI * u) - 1) / 2;
}

/** Linear interpolation. */
function lerp(a, b, u) {
  return a + (b - a) * u;
}

/** Shortest-arc interpolation for angle-like fields (bodyAngle, headTurn). */
function lerpAngle(a, b, u) {
  let diff = (b - a) % TAU;
  if (diff > Math.PI) diff -= TAU;
  if (diff < -Math.PI) diff += TAU;
  return a + diff * u;
}

// ---------------------------------------------------------------- work clips

/**
 * Typing reach. The rig places a hand at
 * `-0.4 + cos(shoulder) * 0.55 + cos(shoulder + elbow) * 0.5` on the local
 * forward axis, where NEGATIVE is forward. The old value (1.2, 0.35) computed
 * to -0.19 — technically in front, but so close to the body that the hands
 * read as folded rather than out on the desk. These angles put both hands a
 * clear -1.06 forward, which is what "typing hands in the front" looks like.
 */
const TYPE_ARM = arm(2.05, 0.45, 'rest');

/** @type {Clip} */
const TYPE_CLIP = {
  duration: 0.9,
  loop: true,
  seated: true,
  prop: null,
  keys: [
    kf(0, {
      lean: 0.15,
      armR: { ...TYPE_ARM, hand: 'key' },
      armL: { ...TYPE_ARM, hand: 'key' },
      bob: 0.4,
      fingerPhase: 1,
    }),
    kf(0.125, { armR: { ...TYPE_ARM, shoulder: 2.15, hand: 'key' }, bob: 0, fingerPhase: 0 }),
    kf(0.25, { armL: { ...TYPE_ARM, shoulder: 2.15, hand: 'key' }, bob: 0.4, fingerPhase: 1 }),
    kf(0.375, { armL: { ...TYPE_ARM, hand: 'key' }, bob: 0, fingerPhase: 0.15 }),
    kf(0.5, { armR: { ...TYPE_ARM, shoulder: 2.15, hand: 'key' }, bob: 0.4, fingerPhase: 0.9 }),
    kf(0.625, { armR: { ...TYPE_ARM, hand: 'key' }, bob: 0, fingerPhase: 0.05 }),
    kf(0.75, { armL: { ...TYPE_ARM, shoulder: 2.15, hand: 'key' }, bob: 0.4, fingerPhase: 1 }),
    kf(0.875, { armL: { ...TYPE_ARM, hand: 'key' }, bob: 0, fingerPhase: 0.15 }),
    kf(1, {
      lean: 0.15,
      armR: { ...TYPE_ARM, hand: 'key' },
      armL: { ...TYPE_ARM, hand: 'key' },
      bob: 0.4,
      fingerPhase: 1,
    }),
  ],
  reducedPose: {
    lean: 0.15,
    armR: { ...TYPE_ARM, hand: 'key' },
    armL: { ...TYPE_ARM, hand: 'key' },
    fingerPhase: 0.5,
  },
};

/** @type {Clip} */
const THINK_CLIP = {
  duration: 3.2,
  loop: true,
  seated: true,
  prop: null,
  keys: [
    kf(0, { lean: -0.2, headTurn: -0.3, armR: arm(2.45, 1.15, 'open'), thoughtPhase: 0.08 }),
    // Up to full opacity quickly, then held there: a thought that flickers on
    // and off once per loop is not a visible artifact, it is a glitch.
    kf(0.14, { thoughtPhase: 0.5 }),
    kf(0.42, { headTurn: 0.3, thoughtPhase: 0.5 }),
    kf(0.58, { thoughtPhase: 0.62 }),
    kf(0.86, { headTurn: -0.15, thoughtPhase: 0.5 }),
    kf(1, { headTurn: -0.3, thoughtPhase: 0.08 }),
  ],
  reducedPose: { lean: -0.2, headTurn: 0.15, armR: arm(2.45, 1.15, 'open'), thoughtPhase: 0.5 },
};

/** @type {Clip} */
const DRINK_CLIP = {
  duration: 2.6,
  loop: false,
  seated: true,
  prop: null,
  keys: [
    // One hand takes the mug; the left stays on the keys for the whole clip.
    kf(0, {
      lean: 0.15,
      armR: arm(2.0, 0.5, 'grip'),
      armL: { ...TYPE_ARM, hand: 'key' },
      prop: 'mug',
    }),
    kf(0.15, { armR: arm(2.5, 0.4, 'grip'), armL: { ...TYPE_ARM, hand: 'key' } }),
    // Mug at the mouth, held.
    kf(0.31, { armR: arm(2.85, 0.35, 'grip'), armL: { ...TYPE_ARM, hand: 'key' } }),
    kf(0.54, { armR: arm(2.85, 0.35, 'grip'), armL: { ...TYPE_ARM, hand: 'key' } }),
    kf(0.73, { armR: arm(2.45, 0.45, 'grip'), armL: { ...TYPE_ARM, hand: 'key' } }),
    kf(1, {
      lean: 0.15,
      armR: { ...TYPE_ARM, hand: 'key' },
      armL: { ...TYPE_ARM, hand: 'key' },
      prop: null,
    }),
  ],
  reducedPose: {
    armR: arm(2.85, 0.35, 'grip'),
    armL: { ...TYPE_ARM, hand: 'key' },
    prop: 'mug',
  },
};

/** @type {Clip} */
const STRETCH_CLIP = {
  duration: 2.0,
  loop: false,
  seated: true,
  prop: null,
  keys: [
    kf(0, { lean: 0, armL: arm(0, 0, 'rest'), armR: arm(0, 0, 'rest') }),
    kf(0.4, { lean: -0.4, armL: arm(2.9, 0, 'open'), armR: arm(2.9, 0, 'open') }),
    kf(0.6, { lean: -0.4, armL: arm(2.9, 0, 'open'), armR: arm(2.9, 0, 'open') }),
    kf(1, { lean: 0, armL: arm(0, 0, 'rest'), armR: arm(0, 0, 'rest') }),
  ],
  reducedPose: { lean: -0.4, armL: arm(2.9, 0, 'open'), armR: arm(2.9, 0, 'open') },
};

/** @type {Clip} */
const HAND_RAISE_CLIP = {
  duration: 1.4,
  loop: true,
  seated: true,
  prop: null,
  ring: true,
  keys: [
    kf(0, { armR: arm(2.85, 0.15, 'raised'), armL: arm(0, 0, 'rest'), ring: true, ringPhase: 0 }),
    kf(0.5, { armR: arm(3.0, 0.2, 'raised'), ringPhase: 0.5 }),
    kf(1, { armR: arm(2.85, 0.15, 'raised'), ringPhase: 1 }),
  ],
  reducedPose: { armR: arm(2.9, 0.18, 'raised'), ring: true, ringPhase: 0.5 },
};

/** @type {Clip} */
const SLUMP_CLIP = {
  duration: 4.0,
  loop: true,
  seated: true,
  prop: null,
  keys: [kf(0, { lean: 0.35, bob: 0 }), kf(0.5, { bob: -0.15 }), kf(1, { lean: 0.35, bob: 0 })],
  reducedPose: { lean: 0.35 },
};

/**
 * The walk swing, in shoulder angle. `WALK_OUT` puts the hand at its widest
 * (`sin` near 1); `WALK_IN` tucks it back towards the body.
 */
const WALK_OUT = 1.62;
const WALK_MID = 1.2;
const WALK_IN = 0.72;

/** @type {Clip} */
const WALK_CLIP = {
  duration: 0.8,
  loop: true,
  seated: false,
  prop: null,
  keys: [
    // `sin(shoulder)` is how far the hand sits out to the side, so the swing
    // is authored on that axis: one arm reaches out while the other tucks in,
    // and they trade every half cycle. The old keyframes swung the shoulder
    // through zero, which sent each hand across the body instead of out from
    // it, and left both arms behind the torso.
    kf(0, {
      legPhase: 0,
      bob: 0,
      armR: arm(WALK_OUT, 0.25, 'rest'),
      armL: arm(WALK_IN, 0.25, 'rest'),
    }),
    kf(0.25, {
      legPhase: 0.25,
      bob: 0.5,
      armR: arm(WALK_MID, 0.25, 'rest'),
      armL: arm(WALK_MID, 0.25, 'rest'),
    }),
    kf(0.5, {
      legPhase: 0.5,
      bob: 0,
      armR: arm(WALK_IN, 0.25, 'rest'),
      armL: arm(WALK_OUT, 0.25, 'rest'),
    }),
    kf(0.75, {
      legPhase: 0.75,
      bob: 0.5,
      armR: arm(WALK_MID, 0.25, 'rest'),
      armL: arm(WALK_MID, 0.25, 'rest'),
    }),
    kf(1, {
      legPhase: 1,
      bob: 0,
      armR: arm(WALK_OUT, 0.25, 'rest'),
      armL: arm(WALK_IN, 0.25, 'rest'),
    }),
  ],
  reducedPose: { legPhase: 0, armR: arm(WALK_OUT, 0.25, 'rest'), armL: arm(WALK_IN, 0.25, 'rest') },
};

/** @type {Clip} */
const STAND_WAIT_CLIP = {
  duration: 4.0,
  loop: true,
  seated: false,
  prop: null,
  keys: [
    kf(0, { lean: 0, headTurn: 0 }),
    kf(0.25, { lean: 0.08 }),
    kf(0.5, { lean: -0.08, headTurn: 0.4 }),
    kf(0.6, { headTurn: 0 }),
    kf(0.75, { lean: 0.08 }),
    kf(1, { lean: 0, headTurn: 0 }),
  ],
  reducedPose: {},
};

// -------------------------------------------------------------- lounge clips

/** @type {Clip} */
const POOL_CLIP = {
  duration: 4.5,
  loop: true,
  seated: false,
  prop: 'cue',
  keys: [
    kf(0, { lean: 0.3, armR: arm(0.8, 0.5, 'grip'), armL: arm(1.3, 0.6, 'grip') }),
    kf(0.6, { armR: arm(0.6, 0.4, 'grip') }),
    kf(0.75, { armR: arm(1.8, 0.7, 'grip') }),
    kf(1, { lean: 0.3, armR: arm(0.8, 0.5, 'grip'), armL: arm(1.3, 0.6, 'grip') }),
  ],
  reducedPose: { lean: 0.3, armR: arm(0.8, 0.5, 'grip'), armL: arm(1.3, 0.6, 'grip'), prop: 'cue' },
};

/** @type {Clip} */
const TABLE_TENNIS_CLIP = {
  duration: 1.6,
  loop: true,
  seated: false,
  prop: 'paddle',
  paired: true,
  partnerPhaseOffset: 0.5,
  requiresPartner: true,
  keys: [
    kf(0, { armR: arm(0.7, 0.4, 'grip') }),
    kf(0.5, { armR: arm(1.7, 0.6, 'grip') }),
    kf(1, { armR: arm(0.7, 0.4, 'grip') }),
  ],
  reducedPose: { armR: arm(1.2, 0.5, 'grip'), prop: 'paddle' },
};

/** @type {Clip} */
const BOARD_GAME_CLIP = {
  duration: 5.0,
  loop: true,
  seated: true,
  prop: null,
  requiresPartner: true,
  keys: [
    kf(0, { lean: 0.1, armR: arm(0.3, 0.4, 'rest'), prop: null }),
    kf(0.2, { armR: arm(1.3, 0.8, 'grip'), prop: 'piece' }),
    kf(0.35, { armR: arm(1.3, 0.8, 'open'), prop: null }),
    kf(0.5, { armR: arm(0.3, 0.4, 'rest') }),
    kf(0.6, { headTurn: 0.25, armR: arm(1.6, 1.2, 'open') }),
    kf(0.8, { headTurn: 0, armR: arm(0.3, 0.4, 'rest') }),
    kf(1, { lean: 0.1, armR: arm(0.3, 0.4, 'rest'), prop: null }),
  ],
  reducedPose: { lean: 0.1, armR: arm(1.3, 0.8, 'grip'), prop: 'piece' },
};

/** @type {Clip} */
const ARCADE_CLIP = {
  duration: 2.2,
  loop: true,
  seated: false,
  prop: 'controller',
  keys: [
    kf(0, {
      lean: 0.2,
      bodyAngle: -0.06,
      armL: arm(1.0, 0.5, 'grip'),
      armR: arm(1.0, 0.5, 'grip'),
    }),
    kf(0.5, { lean: 0.35, bodyAngle: 0.06 }),
    kf(1, { lean: 0.2, bodyAngle: -0.06 }),
  ],
  reducedPose: {
    lean: 0.3,
    armL: arm(1.0, 0.5, 'grip'),
    armR: arm(1.0, 0.5, 'grip'),
    prop: 'controller',
  },
};

/** @type {Clip} */
const COFFEE_CLIP = {
  duration: 6.0,
  loop: false,
  seated: false,
  prop: null,
  keys: [
    kf(0, { legPhase: 0, armR: arm(0, 0, 'rest') }),
    kf(0.08, { legPhase: 0.5 }),
    kf(0.17, { legPhase: 0 }),
    kf(0.25, { legPhase: 0, armR: arm(0.9, 0.4, 'open') }),
    kf(0.3, { armR: arm(0, 0, 'rest') }),
    kf(0.55, { armR: arm(0, 0, 'rest') }),
    kf(0.6, { armR: arm(1.0, 0.5, 'grip'), prop: 'mug' }),
    kf(0.62, { legPhase: 0 }),
    kf(0.75, { legPhase: 0.5, armR: arm(1.3, 0.7, 'grip') }),
    kf(0.88, { legPhase: 0 }),
    kf(1, { legPhase: 0, seated: true, armR: arm(1.0, 0.5, 'grip'), prop: 'mug' }),
  ],
  reducedPose: { seated: true, armR: arm(1.0, 0.5, 'grip'), prop: 'mug' },
};

/** @type {Clip} */
const EAT_CLIP = {
  duration: 3.4,
  loop: true,
  seated: true,
  prop: 'plate',
  keys: [
    kf(0, { lean: 0.1, armR: arm(0.8, 0.7, 'grip') }),
    kf(0.4, { armR: arm(2.2, 1.3, 'grip') }),
    kf(0.53, { armR: arm(2.2, 1.3, 'grip') }),
    kf(0.8, { armR: arm(0.8, 0.7, 'grip') }),
    kf(1, { lean: 0.1, armR: arm(0.8, 0.7, 'grip') }),
  ],
  reducedPose: { lean: 0.1, armR: arm(2.2, 1.3, 'grip'), prop: 'plate' },
};

/** @type {Clip} */
const CHAT_CLIP = {
  duration: 4.0,
  loop: true,
  seated: false,
  prop: null,
  paired: true,
  partnerPhaseOffset: 0.5,
  requiresPartner: true,
  keys: [
    kf(0, { armR: arm(0, 0, 'open'), speechPhase: 1 }),
    kf(0.45, { armR: arm(1.4, 0.5, 'open') }),
    kf(0.5, { armR: arm(0, 0, 'open'), speechPhase: 0 }),
    kf(0.95, { armR: arm(1.4, 0.5, 'open') }),
    kf(1, { armR: arm(0, 0, 'open'), speechPhase: 1 }),
  ],
  reducedPose: { armR: arm(1.0, 0.4, 'open'), speechPhase: 1 },
};

/** @type {Clip} */
const LOUNGE_IDLE_CLIP = {
  duration: 5.0,
  loop: true,
  seated: true,
  prop: null,
  keys: [
    kf(0, { lean: -0.3, headTurn: 0 }),
    kf(0.4, { headTurn: 0 }),
    kf(0.55, { headTurn: 0.35 }),
    kf(0.7, { headTurn: 0 }),
    kf(1, { lean: -0.3, headTurn: 0 }),
  ],
  reducedPose: { lean: -0.3 },
};

/**
 * Every motion clip in the product, keyed by name. VISUAL-SPEC §4.1 (work
 * clips) and §4.2 (lounge clips) — 16 clips total. Data, not code.
 * @type {Record<string, Clip>}
 */
export const CLIPS = {
  type: TYPE_CLIP,
  think: THINK_CLIP,
  drink: DRINK_CLIP,
  stretch: STRETCH_CLIP,
  hand_raise: HAND_RAISE_CLIP,
  slump: SLUMP_CLIP,
  walk: WALK_CLIP,
  stand_wait: STAND_WAIT_CLIP,
  pool: POOL_CLIP,
  table_tennis: TABLE_TENNIS_CLIP,
  board_game: BOARD_GAME_CLIP,
  arcade: ARCADE_CLIP,
  coffee: COFFEE_CLIP,
  eat: EAT_CLIP,
  chat: CHAT_CLIP,
  lounge_idle: LOUNGE_IDLE_CLIP,
};

/** The eight §4.2 lounge clip names. */
export const LOUNGE_CLIPS = [
  'pool',
  'table_tennis',
  'board_game',
  'arcade',
  'coffee',
  'eat',
  'chat',
  'lounge_idle',
];

/** Idle variations interleaved into `working` (§4.1, §4.3). */
export const IDLE_VARIATIONS = ['drink', 'think', 'stretch'];

// ------------------------------------------------------- the desk idle director

/**
 * How long an agent types between idle variations, in seconds.
 *
 * §4.1 says `drink` is "triggered occasionally during `working`" and `stretch`
 * is an "occasional idle variation", and never said how occasional. Twenty to
 * forty-five seconds is the band where a floor of eight working agents shows
 * about one variation every few seconds somewhere on it — enough that the room
 * is alive, rare enough per agent that it never reads as fidgeting.
 *
 * The floor of twenty is also what keeps a screenshot honest: nothing but
 * `type` can be on screen for the first twenty seconds after a state change,
 * which is longer than any capture this project takes.
 */
export const IDLE_TYPE_MIN_S = 20;
export const IDLE_TYPE_MAX_S = 45;

/**
 * How the director weights what comes next. `type` is heavily favoured because
 * a working agent is mostly working; the three variations share the rest.
 * @type {Record<string, number>}
 */
export const IDLE_WEIGHTS = { type: 6, drink: 1, think: 1, stretch: 1 };

/**
 * WP-28's tendency: which clip a trait leans on, and nothing more.
 *
 * *"An agent tagged shell-heavy prefers the coffee clip, asks-often prefers the
 * thinking cloud, expansive prefers typing bursts."* Every value here is a clip
 * the agent already plays at its desk — this table cannot introduce one, and a
 * tendency this map does not know is ignored rather than guessed at.
 * @type {Record<string, string>}
 */
export const TENDENCY_CLIP = { coffee: 'drink', thinking: 'think', typing: 'type' };

/** How much a tendency multiplies its clip's weight. */
export const TENDENCY_WEIGHT = 3;

/**
 * The idle director for an agent sitting at its desk and working.
 *
 * Returns what to play next and for how long. It is a WEIGHTING, not a script:
 * every clip it can name is in {@link IDLE_VARIATIONS} or is `type`, a
 * tendency only changes how often one of them comes up, and the caller cancels
 * the whole thing the moment the agent's real state changes — a hand going up
 * is not something to be animated around (`public/render/agents.js`, `sync`).
 * It is never called under `prefers-reduced-motion`.
 *
 * A trait therefore changes nothing except which of four existing animations
 * an already-idle agent is a little more likely to play. That is the entire
 * mechanical effect of WP-28, and it is why there is no setting for it.
 *
 * @param {() => number} rng a function returning a float in [0,1). Inject a
 *   seeded one for deterministic tests.
 * @param {{tendency?: string|null}} [opts]
 * @returns {{ pick: () => { clip: string, holdS: number } }}
 */
export function makeIdleRotation(rng, opts = {}) {
  const random = rng || Math.random;
  const favoured = opts.tendency ? TENDENCY_CLIP[opts.tendency] || null : null;

  /** @type {[string, number][]} */
  const weighted = Object.entries(IDLE_WEIGHTS).map(([clip, w]) => [
    clip,
    clip === favoured ? w * TENDENCY_WEIGHT : w,
  ]);
  const total = weighted.reduce((sum, [, w]) => sum + w, 0);

  return {
    pick() {
      let roll = random() * total;
      let clip = weighted[weighted.length - 1][0];
      for (const [name, w] of weighted) {
        roll -= w;
        if (roll < 0) {
          clip = name;
          break;
        }
      }
      if (clip === 'type') {
        return { clip, holdS: IDLE_TYPE_MIN_S + random() * (IDLE_TYPE_MAX_S - IDLE_TYPE_MIN_S) };
      }
      // A one-shot variation is held for exactly its own length; a looping one
      // (`think`) is held for two cycles, which is long enough for the thought
      // dots to rise twice and short enough that it never becomes the pose.
      const { duration, loop } = CLIPS[clip];
      return { clip, holdS: loop ? duration * 2 : duration };
    },
  };
}

// ------------------------------------------------------------- resolving t=0

/**
 * Progressively resolves a clip's keyframes into fully-specified poses, so
 * that each keyframe only needs to state what changed since the previous one.
 * Memoized per clip name — clip data is static for the process lifetime.
 * @param {string} name
 * @returns {{ duration: number, loop: boolean, keys: { t: number, pose: Pose }[] }}
 */
const resolvedCache = new Map();
function resolveClip(name) {
  const cached = resolvedCache.get(name);
  if (cached) return cached;
  const clip = CLIPS[name];
  if (!clip) throw new Error(`clips.js: unknown clip "${name}"`);
  let running = defaultPose();
  if (clip.seated !== undefined) running.seated = clip.seated;
  if (clip.prop !== undefined) running.prop = clip.prop;
  if (clip.ring) running.ring = true;
  const keys = clip.keys.map((k) => {
    running = mergePose(running, k.pose);
    return { t: k.t, pose: running };
  });
  const data = { duration: clip.duration, loop: clip.loop, keys };
  resolvedCache.set(name, data);
  return data;
}

/** Blends two fully-resolved poses at eased factor `u` (0..1). */
function blendPose(a, b, u) {
  return {
    bodyAngle: lerpAngle(a.bodyAngle, b.bodyAngle, u),
    lean: lerp(a.lean, b.lean, u),
    headTurn: lerpAngle(a.headTurn, b.headTurn, u),
    armL: {
      shoulder: lerp(a.armL.shoulder, b.armL.shoulder, u),
      elbow: lerp(a.armL.elbow, b.armL.elbow, u),
      hand: a.armL.hand,
    },
    armR: {
      shoulder: lerp(a.armR.shoulder, b.armR.shoulder, u),
      elbow: lerp(a.armR.elbow, b.armR.elbow, u),
      hand: a.armR.hand,
    },
    legPhase: lerp(a.legPhase, b.legPhase, u),
    seated: a.seated,
    prop: a.prop,
    bob: lerp(a.bob, b.bob, u),
    ring: a.ring,
    ringPhase: lerp(a.ringPhase, b.ringPhase, u),
    fingerPhase: lerp(a.fingerPhase, b.fingerPhase, u),
    thoughtPhase: lerp(a.thoughtPhase, b.thoughtPhase, u),
    speechPhase: lerp(a.speechPhase, b.speechPhase, u),
  };
}

/**
 * Builds the single time-invariant pose used under `prefers-reduced-motion`
 * for a clip — "the pose that best communicates the state" (VISUAL-SPEC §10).
 * @param {string} name
 * @returns {Pose}
 */
function buildReducedPose(name) {
  const clip = CLIPS[name];
  let base = defaultPose();
  if (clip.seated !== undefined) base.seated = clip.seated;
  if (clip.prop !== undefined) base.prop = clip.prop;
  if (clip.ring) base.ring = true;
  if (clip.reducedPose) base = mergePose(base, clip.reducedPose);
  return base;
}

/**
 * Samples a clip at `t` seconds since it started, returning a complete Pose.
 *
 * `t` is NOT normalised — looping and holding are done here from `duration`.
 * A looping clip wraps; a non-looping clip holds its final keyframe once
 * `t >= duration`. Interpolation is ease-in-out-sine; `bodyAngle`/`headTurn`
 * take the shortest arc. `armL.hand`, `armR.hand`, `seated` and `prop` step
 * (never blend) to the value of the keyframe at or before `t`.
 *
 * Under `reduced === true` (prefers-reduced-motion) this returns a single
 * static representative pose with no time dependence at all.
 *
 * @param {string} name
 * @param {number} t
 * @param {boolean} [reduced]
 * @returns {Pose}
 */
export function sampleClip(name, t, reduced) {
  if (reduced) return buildReducedPose(name);
  const clip = CLIPS[name];
  if (!clip) throw new Error(`clips.js: unknown clip "${name}"`);
  const { duration, loop, keys } = resolveClip(name);

  let frac;
  if (loop) {
    let local = duration > 0 ? t % duration : 0;
    if (local < 0) local += duration;
    frac = duration > 0 ? local / duration : 0;
  } else if (t <= 0) {
    frac = 0;
  } else if (t >= duration) {
    frac = 1;
  } else {
    frac = duration > 0 ? t / duration : 0;
  }

  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].t <= frac) i++;
  const a = keys[i];
  const b = keys[Math.min(i + 1, keys.length - 1)];
  const span = b.t - a.t;
  const localU = span > 0 ? (frac - a.t) / span : 0;
  const easedU = easeInOutSine(Math.min(1, Math.max(0, localU)));
  return blendPose(a.pose, b.pose, easedU);
}

// --------------------------------------------------------- state -> clip map

/** @type {Record<string, string>} state name -> clip name; NOT a clip */
const STATE_CLIP = {
  working: 'type',
  needs_input: 'hand_raise',
  stalled: 'slump',
  for_review: 'stand_wait',
  benched: 'lounge_idle',
  // An ended session is not running. It must not play `type` — a still,
  // seated pose is what "finished, still at its desk" looks like. `slump`
  // is that pose; the amber that makes it read as *stalled* comes from the
  // state colour, not from the clip.
  ended: 'slump',
  moving: 'walk',
  let_go: null,
};

/**
 * The clip name for a given visual state (VISUAL-SPEC §5). `benched` returns
 * a default lounge clip; the scene should otherwise drive benched agents via
 * `makeActivityRotation`. `moving` (walking between locations) returns `walk`.
 * @param {string} state
 * @returns {string|null}
 */
export function clipForState(state) {
  return Object.prototype.hasOwnProperty.call(STATE_CLIP, state) ? STATE_CLIP[state] : null;
}

// ------------------------------------------------------------ activity rotation

/**
 * Builds a pure, testable activity-rotation picker for a benched agent
 * (VISUAL-SPEC §4.3): pick an activity, hold 45-90 s (randomised), then move.
 * Paired/group activities wait for a partner; if none is free, the agent
 * degrades to a solo activity.
 *
 * @param {() => number} [rng] a function returning a float in [0,1); defaults
 *   to `Math.random`. Inject a seeded/stubbed rng for deterministic tests.
 * @returns {{ pick: (opts?: { partnerFree?: (activity: string) => boolean }) => { activity: string, holdMs: number, degraded: boolean } }}
 */
export function makeActivityRotation(rng) {
  const random = rng || Math.random;
  const soloPool = LOUNGE_CLIPS.filter((name) => !CLIPS[name].requiresPartner);

  function pickFrom(pool) {
    const idx = Math.min(pool.length - 1, Math.floor(random() * pool.length));
    return pool[idx];
  }

  return {
    pick(opts) {
      const partnerFree = (opts && opts.partnerFree) || (() => true);
      let activity = pickFrom(LOUNGE_CLIPS);
      let degraded = false;
      if (CLIPS[activity].requiresPartner && !partnerFree(activity)) {
        activity = pickFrom(soloPool);
        degraded = true;
      }
      const holdMs = Math.round((45 + random() * 45) * 1000);
      return { activity, holdMs, degraded };
    },
  };
}
