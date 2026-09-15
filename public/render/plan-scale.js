/**
 * AGENT SIZE, AND THE SCALING LAW — WP-88c.
 * `docs/plan/11-LOOK-CONTROL-CENTRE.md` §2, and `docs/03-VISUAL-SPEC.md` §11.
 *
 * The owner, 15 September: *"the user can set the size of agents compared to
 * screen; someone with 100 agents wants them smaller, someone with 5–10 wants
 * them bigger so they are not lost; accordingly the size of table, chair, sofa,
 * everything adjusts automatically."*
 *
 * ============================================================================
 * THE LAW, IN ONE SENTENCE
 *
 *   **Everything a body sets scales by `s`. Everything the building sets does
 *   not.**
 *
 * A chair is sized by a person. A corridor is sized by a plan. So a seat, the
 * pitch between two people, the depth of a surface somebody reaches across, the
 * clearance a body needs beside a prop and the figure's own chrome all move with
 * `s`; while room padding, the corridor, the plate band, the parquet cell, every
 * minimum, every ratio and every type size do not.
 *
 * `s` is 0.80 / 1.00 / 1.25 for `small` / `medium` / `large`, which is
 * `RIG_UNIT_U` 1.6 / 2.0 / 2.5 and therefore `BODY_HEIGHT_U` 2.02 / 2.52 / 3.15.
 * **Medium is today, exactly** — every base below is the constant that was there
 * before, so `s = 1` is the identity and `goldens:check` sees nothing.
 *
 * ============================================================================
 * WHY THE CONSTANTS ARE `let` AND NOT A FUNCTION CALL
 *
 * The alternative was `bodyU(SEAT_PITCH)` at four hundred call sites, which is
 * four hundred chances to forget one and no way at all to tell that somebody
 * had. An ES module's exported bindings are LIVE: `import { SEAT_PITCH }` reads
 * the binding, not a copy, so re-assigning it here changes what every planner
 * sees on its next call and nothing on the call sites has to know this file
 * exists. It is the device `PALETTE` and `LOOK` already are — one mutable
 * object the whole floor reads at paint time — pushed down one level to the
 * numbers themselves.
 *
 * The cost is that the scale is process state, and it is paid the way the other
 * two pay it: `buildPlan` sets it at the top of every plan, so the plan and the
 * figures drawn on it can never be at two sizes.
 *
 * THIS MODULE IMPORTS NOTHING, on purpose. Every module with a body constant in
 * it imports THIS one and registers its own rescale — so there is no cycle, and
 * a module that is never loaded simply never rescales.
 *
 * Pure data, three pure functions and one registry. No DOM, no clock, no
 * randomness.
 */

// ------------------------------------------------------------- the settings

/** The three sizes, and the scale factor each one is (§2). */
export const AGENT_SCALES = Object.freeze({ small: 0.8, medium: 1, large: 1.25 });

/** The figure's own frame unit at each size — §2's 1.6 / 2.0 / 2.5. */
export const RIG_UNITS = Object.freeze({ small: 1.6, medium: 2.0, large: 2.5 });

/** Every size a plan may actually be laid at. `auto` resolves to one of these. */
export const SIZE_IDS = Object.freeze(['small', 'medium', 'large']);

/**
 * The size a floor is laid at when nobody has said otherwise.
 *
 * **Medium, and not `auto`** — which is a departure from §6's owner decision 3,
 * and it is decision 2 that forces it. *"A default that changed the shipped
 * floor would move every golden and decide for the majority who never open the
 * section."* `auto` on the `single` fixture is one live agent, which is `large`,
 * which is a different floor: the two decisions cannot both hold, and the one
 * that says *the shipped floor does not move* is also §5's acceptance and the
 * goldens strategy. So `auto` ships as an option, one click away in the Look
 * section, and the floor a user who never opens it sees is the floor they had.
 * `docs/DEVIATIONS.md` §177.
 */
export const DEFAULT_AGENT_SIZE = 'medium';

// --------------------------------------------------------------- `auto`

/**
 * WHERE `auto` CHANGES ITS MIND (§2): *"≤ 10 large, ≤ 40 medium, else small"*.
 */
export const AUTO_LARGE_MAX = 10;
export const AUTO_MEDIUM_MAX = 40;

/**
 * AND HOW FAR PAST A THRESHOLD ONE ARRIVAL HAS TO CARRY THE FLOOR (§2).
 *
 * *"±2 hysteresis — up at 12 and 42, down at 8 and 38 — so a floor on a boundary
 * does not flip every poll."* A machine sitting at ten live sessions starts one
 * more and stops it again every few minutes, and without this every one of those
 * would re-plan the building and re-bake its backdrop: the rooms would change
 * size under the user's hands twice a minute, for nothing.
 *
 * The band is stated on the COUNT rather than on the scale because that is what
 * moves. Which edge applies depends on which side the floor is already on, which
 * is the whole of what hysteresis is, and is why `autoAgentSize` takes the
 * previous size as an argument rather than reading a clock. There is no rate
 * limit here and there is deliberately none: a timer would be a second, weaker
 * answer to the same question, and this file may not read the clock.
 */
export const AUTO_HYSTERESIS = 2;

/**
 * The size `auto` picks, for a live count and the size the floor is already at.
 *
 * A pure function of two arguments — no clock, no randomness, no module state —
 * so the sequence of sizes a sequence of counts produces is a thing a test can
 * enumerate, and `agent-size.test.mjs` does.
 *
 * @param {number} live how many people the floor is about to draw
 * @param {string|null} [previous] the size it is at now, or null for a cold start
 * @returns {'small'|'medium'|'large'}
 */
export function autoAgentSize(live, previous) {
  const n = Math.max(0, Math.floor(Number(live) || 0));
  const prev = SIZE_IDS.includes(String(previous)) ? String(previous) : null;
  // Cold: the plain thresholds. There is no side to be on yet.
  if (!prev) return n <= AUTO_LARGE_MAX ? 'large' : n <= AUTO_MEDIUM_MAX ? 'medium' : 'small';
  const h = AUTO_HYSTERESIS;
  // Each edge sits where the floor is NOT: a large floor holds out to 12, and a
  // floor that is not large has to come all the way down to 8 to become one.
  const largeMax = prev === 'large' ? AUTO_LARGE_MAX + h : AUTO_LARGE_MAX - h;
  const mediumMax = prev === 'small' ? AUTO_MEDIUM_MAX - h : AUTO_MEDIUM_MAX + h;
  if (n <= largeMax) return 'large';
  if (n <= mediumMax) return 'medium';
  return 'small';
}

/**
 * A setting and a population, resolved to one of the three sizes.
 * @param {unknown} setting `small` | `medium` | `large` | `auto` | anything
 * @param {number} live
 * @param {string|null} [previous]
 */
export function resolveAgentSize(setting, live, previous) {
  const want = String(setting ?? '');
  if (SIZE_IDS.includes(want)) return want;
  if (want === 'auto') return autoAgentSize(live, previous);
  return DEFAULT_AGENT_SIZE;
}

// ------------------------------------------------------------- the registry

/**
 * THE LIVE SCALE. The same device `PALETTE` and `LOOK` are: a mutable object the
 * whole floor reads, replaced in one place and never copied.
 *
 * `size` is what the floor is laid at; `setting` is what the user asked for, so
 * a picker can show `auto` and the count it resolved to at the same time.
 * @type {{size:string, setting:string, s:number, live:number}}
 */
export const AGENT_SCALE = {
  size: DEFAULT_AGENT_SIZE,
  setting: DEFAULT_AGENT_SIZE,
  s: AGENT_SCALES[DEFAULT_AGENT_SIZE],
  live: 0,
};

/** @type {Array<(s:number) => void>} */
const scalers = [];

/**
 * Register a module's own rescale, and run it once at the current scale.
 *
 * Running it IMMEDIATELY is what makes load order irrelevant: a module imported
 * after the scale was last set catches up on its first line rather than sitting
 * at medium until the next plan.
 *
 * @param {(s:number) => void} fn
 */
export function registerBodyScale(fn) {
  scalers.push(fn);
  fn(AGENT_SCALE.s);
}

/**
 * Every number in `base`, times `s`. The half of the rescale that is arithmetic
 * rather than assignment, so a module's own block is two lists of names and no
 * numbers at all — which is what stops a base drifting from the constant it is
 * the base of.
 * @template {Record<string, number>} T
 * @param {T} base @param {number} s @returns {T}
 */
export function scaleAll(base, s) {
  /** @type {any} */
  const out = {};
  for (const key of Object.keys(base)) out[key] = /** @type {any} */ (base)[key] * s;
  return out;
}

/**
 * Lay the floor at a size. Returns what it actually resolved to.
 *
 * @param {unknown} setting the look's `agentSize`
 * @param {number} [live] how many people the floor is about to draw
 */
export function setAgentSize(setting, live = 0) {
  const want = String(setting ?? DEFAULT_AGENT_SIZE);
  const asked = want === 'auto' || SIZE_IDS.includes(want) ? want : DEFAULT_AGENT_SIZE;
  const size = resolveAgentSize(
    asked,
    live,
    AGENT_SCALE.setting === 'auto' ? AGENT_SCALE.size : null,
  );
  const s = AGENT_SCALES[/** @type {keyof typeof AGENT_SCALES} */ (size)];
  AGENT_SCALE.size = size;
  AGENT_SCALE.setting = asked;
  AGENT_SCALE.live = Math.max(0, Math.floor(Number(live) || 0));
  if (AGENT_SCALE.s !== s) {
    AGENT_SCALE.s = s;
    for (const fn of scalers) fn(s);
  }
  return AGENT_SCALE;
}

/**
 * THE LIVE COUNT, AND THE SIZE IT BUYS — the one call `buildPlan` makes.
 *
 * `live` is the people the plan is about to DRAW: everyone at a desk, everyone
 * waiting in the reception, everyone standing in the lounge. Not the session
 * list, and that is the whole of the definition — a machine with forty ended
 * sessions that have gone home is not a busy floor, and shrinking it for them
 * would be sizing an office by its filing cabinet.
 *
 * It takes `floorPopulation`'s own record rather than a number so the count has
 * one definition; it is read duck-typed rather than imported, because this file
 * imports nothing.
 *
 * @param {unknown} setting the look's `agentSize`
 * @param {{desks?:Map<string,number>, waiting?:number, benchedDrawn?:number}} pop
 */
export function sizeForPopulation(setting, pop) {
  const desks = pop && pop.desks ? [...pop.desks.values()].reduce((n, k) => n + k, 0) : 0;
  return setAgentSize(setting, desks + (pop?.waiting || 0) + (pop?.benchedDrawn || 0));
}

/** Put every body constant back where it ships. For tests, and for a reload. */
export function resetAgentScale() {
  AGENT_SCALE.setting = DEFAULT_AGENT_SIZE;
  AGENT_SCALE.size = DEFAULT_AGENT_SIZE;
  AGENT_SCALE.live = 0;
  if (AGENT_SCALE.s !== AGENT_SCALES[DEFAULT_AGENT_SIZE]) {
    AGENT_SCALE.s = AGENT_SCALES[DEFAULT_AGENT_SIZE];
    for (const fn of scalers) fn(AGENT_SCALE.s);
  }
  return AGENT_SCALE;
}

// ------------------------------------- the body constants that lived in units
//
// These came OUT of `plan-units.js` rather than being made mutable in place,
// for the reason `plan-shapes.js` and `plan-furniture.js` each came out of it:
// that file stands at WP-22's 900-line ceiling and had no room for a second
// declaration of anything. `plan-units.js` re-exports every name below, so the
// twenty-odd modules that import them did not change a line.

/** Table geometry. Seats sit along the two long sides. */
export let SEAT_PITCH = 2.6;
export let TABLE_DEPTH = 2.6;
export let CHAIR = 2;
export let CHAIR_GAP = 0.15;
/** The floor two people back their chairs into, between one desk and the next. */
export let TABLE_GAP = 3.2;

/**
 * How much of a project room's west wall its whiteboard takes, at the least. It
 * grows with the wall (WP-59c) and `plan-rooms.js` leaves the last of the wall
 * for the corner planting.
 */
export let WHITEBOARD_H = 5.2;

/** How far a corner plant sits from the two walls it stands between. */
export let CORNER_PLANT_INSET = 1.2;

/** Shortest sofa run worth sitting on, and how deep a run is drawn. */
export let SOFA_MIN_RUN = 5.2;
export let SOFA_DEPTH = 2.6;

/**
 * How much the reception grows per agent waiting in it. A queue of one gets a
 * small room; a queue of twenty gets the full reception. Per PERSON, so it is
 * the person's own number and moves with them.
 */
export let OFFICE_GROWTH_W = 0.8;
export let OFFICE_GROWTH_H = 0.55;

/** Pitch between two people sitting on the same sofa run. */
export let OFFICE_SEAT_PITCH = 2.6;

/** Grid of the reception's overflow chairs. */
export let OFFICE_CHAIR_PITCH = 3.2;
export let OFFICE_CHAIR_ROW = 2.8;

/**
 * How far apart two people WAIT, which is not the seat pitch: a waiting session
 * is a body plus a badge plus a name, and that stack is roughly four units tall.
 */
export let OFFICE_QUEUE_PITCH = 3.8;
export let OFFICE_QUEUE_ROW = 6.4;

/** How far apart two people SIT on the reception sofas — the same stack again. */
export let OFFICE_SOFA_PITCH = 5.2;

/** The pitch of the standing-room band along the lounge's promenade. */
export let MINGLE_PITCH = 2.4;
export let MINGLE_ROW = 2.4;
/** One body and the clear width beside it: the densest two people may stand. */
export let MINGLE_PITCH_MIN = 2;
export let MINGLE_ROW_MIN = 2;

const BASE = {
  SEAT_PITCH,
  TABLE_DEPTH,
  CHAIR,
  CHAIR_GAP,
  TABLE_GAP,
  WHITEBOARD_H,
  CORNER_PLANT_INSET,
  SOFA_MIN_RUN,
  SOFA_DEPTH,
  OFFICE_GROWTH_W,
  OFFICE_GROWTH_H,
  OFFICE_SEAT_PITCH,
  OFFICE_CHAIR_PITCH,
  OFFICE_CHAIR_ROW,
  OFFICE_QUEUE_PITCH,
  OFFICE_QUEUE_ROW,
  OFFICE_SOFA_PITCH,
  MINGLE_PITCH,
  MINGLE_ROW,
  MINGLE_PITCH_MIN,
  MINGLE_ROW_MIN,
};

registerBodyScale((s) => {
  ({
    SEAT_PITCH,
    TABLE_DEPTH,
    CHAIR,
    CHAIR_GAP,
    TABLE_GAP,
    WHITEBOARD_H,
    CORNER_PLANT_INSET,
    SOFA_MIN_RUN,
    SOFA_DEPTH,
    OFFICE_GROWTH_W,
    OFFICE_GROWTH_H,
    OFFICE_SEAT_PITCH,
    OFFICE_CHAIR_PITCH,
    OFFICE_CHAIR_ROW,
    OFFICE_QUEUE_PITCH,
    OFFICE_QUEUE_ROW,
    OFFICE_SOFA_PITCH,
    MINGLE_PITCH,
    MINGLE_ROW,
    MINGLE_PITCH_MIN,
    MINGLE_ROW_MIN,
  } = scaleAll(BASE, s));
});

// --------------------------------------------------------- the classification

/**
 * EVERY CONSTANT, ON ONE SIDE OF THE LAW OR THE OTHER.
 *
 * §2 is a pair of tables and this is those tables said where they are enforced,
 * module by module. `agent-size.test.mjs` enumerates each module's exports and
 * fails on a number that is in neither list — so a package that adds a dimension
 * has to decide which side it is on before it can ship, which is the only way a
 * law like this survives its own author.
 *
 * Three buckets rather than two, because a module of dimensions also holds
 * things that are not dimensions:
 *
 *   - **`body`** — scales by `s`. A person sets it.
 *   - **`building`** — a LENGTH IN PLAN UNITS that does not scale. The plan sets
 *     it: padding, circulation, minimums, the pattern a floor is laid in.
 *   - **`pure`** — not a length at all. A ratio, a share, a count, a seed, a
 *     duration, a screen-pixel threshold. Type is UI and is always here: *"a
 *     large floor gets larger people under the same labels, not larger labels."*
 *
 * @type {Readonly<Record<string, {body:ReadonlyArray<string>,
 *   building:ReadonlyArray<string>, pure:ReadonlyArray<string>}>>}
 */
export const SCALE_CLASSES = Object.freeze({
  'plan-scale.js': Object.freeze({
    body: Object.freeze(Object.keys(BASE)),
    building: Object.freeze([]),
    pure: Object.freeze(['AUTO_LARGE_MAX', 'AUTO_MEDIUM_MAX', 'AUTO_HYSTERESIS']),
  }),
  'plan-units.js': Object.freeze({
    // Re-exported from here, so they are classified here and listed there too:
    // the test reads both namespaces and both have to agree.
    body: Object.freeze(Object.keys(BASE)),
    building: Object.freeze([
      'U',
      'MARGIN',
      'PLATE_BAND',
      'PLUS_SIZE_U',
      'PLUS_MARGIN_U',
      'PLUS_CLEAR_U',
      'CORRIDOR',
      'FIXTURE_TOP',
      'RUG_ROOM_INSET',
      'ROOM_PAD',
      'MIN_PROJECT_ROOM_W',
      'MIN_PROJECT_ROOM_H',
      'PINNED_MIN_H',
      'PINNED_MAX_H',
      'PINNED_ROW_MIN_W',
      'OFFICE_MIN_H',
      'OFFICE_MIN_W',
      'OFFICE_MAX_W',
      'OFFICE_MAX_H',
      'OFFICE_ROW_MAX_W',
      'OFFICE_ROW_MAX_DEPTH',
      'LOUNGE_ROW_MIN_W',
      'LOUNGE_SOFA_GROUP_H',
      'LOUNGE_MIN_H',
      'LOUNGE_GAP',
      'SERVICE_MAX_W',
      'SERVICE_W_STEP',
      'DOOR_WIDTH',
    ]),
    pure: Object.freeze([
      'ASPECT_MIN',
      'ASPECT_MAX',
      'DEFAULT_ASPECT',
      'ASPECT_TOLERANCE',
      'ASPECT_SETTLE',
      'OPEN_FLOOR_MAX',
      'FLOOR_OPEN_MAX',
      'ROOM_WIDTH_STRETCH_MAX',
      'ROOM_HEIGHT_STRETCH_MAX',
      'WORKING_OPEN_MAX',
      'ROOM_FILL_COLUMN_MAX',
      'CELL_OCCUPANCY_RATIO_MAX',
      'ROWS_ASPECT_MIN',
      'ROWS_OPEN_MIN',
      'OFFICE_ROW_ASPECT_MAX',
      'LOUNGE_ROW_ASPECT_MAX',
      'SERVICE_COLUMN_MAX',
      'RUG_MAX_OVER_CLUSTER',
      'PINNED_DEPTH_SHARE',
      'PINNED_AREA_SHARE',
      'OFFICE_VISITOR_CHAIRS',
      'OFFICE_SURPLUS_SHARE',
      'LOUNGE_SHARE_MIN',
      'LOUNGE_SHARE_MAX',
      'LOUNGE_SHARE_STEP',
      'LOUNGE_QUIET_MAX',
      'LOUNGE_SHARE_PER',
      'LOUNGE_MAX_GAMES',
      'MAX_WORKING_ROWS',
      'PROJECT_ASPECT_LIMIT',
      'WORKING_HEADROOM',
      'BAND_STRETCH_MAX',
      'ROOM_FILL_MAX',
      'HEIGHT_BAND_RATIO',
      'OFFICE_ASPECT_MIN',
      'OFFICE_COLUMN_MIN',
      'ROOM_ASPECT_MAX',
      'SOFA_SEAT_BIAS',
    ]),
  }),
  'plan-furniture.js': Object.freeze({
    // EVERY LENGTH IN THE FURNITURE SET SCALES, and that is the owner's sentence
    // rather than an inference: *"the size of table, chair, sofa, everything
    // adjusts automatically."* Nothing in §2's does-not-scale table comes from
    // this module, and a lounge of 25% larger people around the same pool table
    // is the picture the law exists to prevent.
    body: Object.freeze([
      'SEAT_TUB',
      'SEAT_TASK',
      'SEAT_STOOL',
      'SEAT_ARMCHAIR',
      'RUG_CLUSTER_PAD',
      'WHITEBOARD_W',
      'WHITEBOARD_MAX_H',
      'SHELF_W',
      'SHELF_MAX_H',
      'PINBOARD_W',
      'PINBOARD_H',
      'PINBOARD_GAP',
      'BREAKOUT_RUG_D',
      'BREAKOUT_TABLE',
      'BREAKOUT_MARGIN',
      'BREAKOUT_BAND',
      'MONITOR_W',
      'MONITOR_H',
      'DESK_TRAY_W',
      'DESK_TRAY_H',
      'WATER_COOLER',
      'OFFICE_RUG_INSET',
      'OFFICE_RUG_LEAD',
      'LOUNGE_STOOL_PITCH',
      'LOUNGE_COFFEE_W',
      'LOUNGE_COFFEE_H',
      'LOUNGE_FRIDGE_W',
      'LOUNGE_FRIDGE_H',
      'LOUNGE_DINING',
      'LOUNGE_POOL_W',
      'LOUNGE_POOL_H',
      'LOUNGE_TT_W',
      'LOUNGE_TT_H',
      'LOUNGE_ARCADE_W',
      'LOUNGE_ARCADE_H',
    ]),
    building: Object.freeze([]),
    pure: Object.freeze(['BREAKOUT_CLEAR_RATIO']),
  }),
  'plan-props.js': Object.freeze({
    body: Object.freeze([
      'PLANT_BROAD',
      'PLANT_BLADE',
      'PLANT_TREE',
      'PLANTER_W',
      'PLANTER_MARGIN',
      'BOOKCASE_W',
      'BOOKCASE_MAX_H',
      'BOOKCASE_MIN_RUN',
      'PROP_ATTACH_MAX',
      'CHAR_CLEAR_U',
    ]),
    building: Object.freeze([
      'DOORMAT_W',
      'DOORMAT_H',
      'DOORMAT_INSET',
      'SILHOUETTE_SPACING',
      'CLEAR_PATCH_MAX',
      'LOUNGE_BAY_ROW_MIN',
    ]),
    pure: Object.freeze([
      'PLANTS_PER_PROJECT_ROOM',
      'PLANTS_PER_LOUNGE_BAY',
      'PROP_CLEAR_U2',
      'LOUNGE_BAY_ROW_MIN_COUNT',
    ]),
  }),
  'rig-metrics.js': Object.freeze({
    body: Object.freeze([
      'RIG_UNIT_U',
      'BODY_HEIGHT_U',
      'CHROME_TOP_U',
      'CHROME_BUBBLE_U',
      'CHROME_BADGE_U',
      'SELECTION_RING_R',
      'RING_BASE_R',
      'SHADOW_RX',
      'SHADOW_RY',
    ]),
    building: Object.freeze([]),
    pure: Object.freeze([
      'TAU',
      'BASE_U',
      'MANAGER_SCALE',
      'SHADOW_OX',
      'SHADOW_OY',
      'RIG_CROWN',
      'RIG_DETAIL_MIN_PX',
      'RIG_MARK_MIN_PX',
      'LABEL_MIN_PX',
      'ICON_MIN_PX',
      'BADGE_MIN_PX',
      'LABEL_MAX_PX',
    ]),
  }),
  'agents-core.js': Object.freeze({
    body: Object.freeze([
      'OVERFLOW_RING_R',
      'SEAT_SPREAD',
      'JUNIOR_OFFSET',
      'JUNIOR_BACK',
      'JUNIOR_ROW',
      'JUNIOR_PAD',
    ]),
    building: Object.freeze([]),
    pure: Object.freeze([
      'WALK_SPEED',
      'RUN_SPEED',
      'ROTATION_MIN_S',
      'ROTATION_MAX_S',
      'IDLE_TYPE_MIN_S',
      'IDLE_TYPE_MAX_S',
      'EPS',
      'ACTIVITY_PICK_ATTEMPTS',
    ]),
  }),
  // WP-89. Seven lengths, all of them set by a person: the chord between two
  // seated juniors is a junior's own width, the smallest radius is a body's
  // clearance from a chair, and the three cable spacings are the gaps between
  // the people the cables run between. The scale and the arc's span are ratios.
  'crew.js': Object.freeze({
    body: Object.freeze([
      'CREW_PITCH',
      'CREW_R_MIN',
      'CREW_LAPTOP_GAP',
      'CREW_PORT_PITCH',
      'CREW_PORT_OFFSET',
      'CREW_LANE_0',
      'CREW_LANE_STEP',
      'CREW_CHIP_OUT',
    ]),
    building: Object.freeze([]),
    pure: Object.freeze([
      'CREW_SCALE',
      'CREW_ARC_SPAN',
      'CREW_THRESHOLD',
      'CREW_DRAW_CAP',
      'CREW_ACTIVE_MS',
      'CREW_CABLE_MS',
      'CREW_FOLD_MS',
      'CREW_PULSE_MS',
      'CREW_PULSE_MAX',
    ]),
  }),
  'backdrop-floor.js': Object.freeze({
    body: Object.freeze(['DESK_POOL_MARGIN_U']),
    // §2's own list: *"herringbone cell · carpet weave pitch · tile cell ·
    // threshold pool"*. A floor pattern is laid by the building, so a room of
    // larger people is the same parquet with fewer boards showing.
    building: Object.freeze([
      'HERRINGBONE_CELL_U',
      'HERRINGBONE_SEAM_U',
      'CARPET_WEAVE_PITCH_U',
      'TILE_CELL_U',
      'DOOR_POOL_R_U',
      'THRESHOLD_RUN_U',
      'THRESHOLD_DEPTH_U',
    ]),
    pure: Object.freeze(['HERRINGBONE_BLOCK_L', 'HERRINGBONE_BLOCK_W']),
  }),
});
