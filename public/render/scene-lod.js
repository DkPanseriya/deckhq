/**
 * How big a character is drawn, and when one stops being drawn at all
 * (WP-22 follow-up).
 *
 * Split out of `scene.js` unchanged: the four thresholds that decide the
 * level of detail, the pure `characterScaleFor()` that turns px-per-unit into
 * a body scale, WP-41's junior scale, and the two methods that read them.
 * `_scale()` — the current px-per-unit — is here rather than with the camera
 * because it is the number every one of those thresholds is compared against.
 *
 * `scene.js` re-exports every name, so `minifloor.js`, `subagents.test.mjs`
 * and `scene-math.test.mjs` import exactly what they imported before.
 */

import { AGENT_SCALES, registerBodyScale } from './plan-scale.js';
import { BODY_HEIGHT_U, LEGIBILITY_MIN_PX } from './rig.js';
import { RIG_DETAIL_MIN_PX } from './rig-metrics.js';
import { rigHeight } from './rig-pose.js';
import { SceneBase } from './scene-base.js';

// ---------------------------------------------------------------------------
// The floor's camera: always exactly fit-to-viewport. Zoom and drag-to-pan
// were removed as a feature entirely — there is no user-adjustable
// magnification and nothing to pan to. `_fitScale`/`_camera` below exist
// only to place the fitted floor in the stage and to feed `agents.js`'s
// `worldToScreen`/`screenToWorld` the camera shape they expect. See
// `_recomputeFitScale`, `_centerCamera`, `_cameraParams`.
/**
 * A waiting badge needs roughly 44 px of width and the office seats it sits
 * over are 3.2 U apart, so below ~14 px per unit the badges of adjacent
 * agents cannot help but collide.
 */
export const BADGE_MIN_PX_PER_UNIT = 14;

/**
 * The smallest px-per-unit the floor is allowed to shrink to.
 *
 * A room is about 12 units across at its smallest, so below roughly this
 * scale a project room is under 100 px wide and its plate, its agents and its
 * furniture all stop being readable. Rather than keep shrinking, the floor
 * holds this scale and the working side scrolls. Chosen from what a room
 * needs to stay legible, not from a project count.
 */
export const MIN_SCALE = 7.5;

/**
 * THE CHARACTER SCALE IS NOT THE WORLD SCALE (05-GUI-UX-SPEC §6.2).
 *
 * A person is drawn at `max(worldScale, CHAR_MIN_PX_PER_UNIT)`, so below the
 * point where a body would be under `BODY_MIN_PX` tall people stop shrinking
 * with the plan and grow relative to it. A slightly-too-large person in a
 * small room is a legible floor; a correctly-scaled six-pixel person is a
 * decorative texture.
 *
 * The per-element floors — 11 px of name label, 12 px of state icon, 13 px of
 * waiting badge — are `rig.js`'s, because §6.2 states them per element and the
 * rig is where each one is measured and drawn.
 */
export let CHAR_MIN_PX_PER_UNIT = LEGIBILITY_MIN_PX.body / BODY_HEIGHT_U;

/**
 * THE FIT HAS A CEILING TOO (WP-55), AND IT WAS SET TOO LOW (WP-59).
 *
 * The building is the size of what is in it, so a quiet machine's floor is
 * genuinely small — one room, a reception and a lounge — and there has to be
 * some point past which blowing it up stops helping. WP-55 put that point at
 * 44 px of body and it turned out to be the second half of the defect §139
 * exists to fix: on a 2560 x 1440 stage the reference floor stopped growing at
 * 66% of the stage's height with a third of the window left as dark ground.
 * Nothing was wrong with the picture at that scale — it was simply small, on a
 * screen the user had given the whole of.
 *
 * 72 px is four and a half times the 16 px legibility floor. It is what a
 * 55-unit-tall building needs to reach the bottom of a 1440 px stage, which is
 * the number this constant is actually FOR: the ceiling exists to stop a floor
 * being magnified past its own window, not to stop it reaching it. Labels are
 * held to 11-14 px separately (`labelFontSize`) so a body this size still
 * carries a name rather than a banner.
 */
export const BODY_MAX_PX = 72;

/** The largest px-per-unit the floor is ever drawn at. See `BODY_MAX_PX`. */
export let CHAR_MAX_PX_PER_UNIT = BODY_MAX_PX / BODY_HEIGHT_U;

/**
 * The scale a person is drawn at, given the scale the FLOOR is drawn at.
 * Exported as a plain function so the legibility test can ask for it without a
 * canvas — see the note at the bottom of this file.
 * @param {number} worldScale px per plan unit
 */
export function characterScaleFor(worldScale) {
  return Math.max(Number(worldScale) || 0, CHAR_MIN_PX_PER_UNIT);
}

/**
 * A JUNIOR IS ONE STEP DOWN THE AGENT-SIZE LADDER FROM ITS LEAD (WP-99).
 *
 * The ladder is `AGENT_SCALES` — small 0.8, medium 1, large 1.25 — and its
 * steps are one ratio: small over medium is medium over large. That ratio is
 * this number, so a junior beside a `large` lead is the size of a `medium`
 * one, beside a `medium` lead the size of a `small` one, and beside a `small`
 * lead one step under the ladder's foot. It is derived, not typed, so the
 * ladder cannot move without it.
 *
 * ONE NUMBER, AND IT IS APPLIED TO WHAT THE LEAD IS ACTUALLY DRAWN AT. There
 * used to be two — 0.80 beside a parent (WP-41) and 0.65 in a formation
 * (WP-89) — and both went through `characterScaleFor`, which holds a body at
 * 16 px: on a floor at the legibility floor, which is where a crowded floor
 * sits, a junior and its lead came out the same size and nothing but the name
 * said which was which. {@link juniorScaleFor} takes the step AFTER the lead's
 * own floor, so the difference is the same step at every fit and at every
 * agent-size setting, `auto` included.
 *
 * WHAT THAT COSTS, MEASURED: at the legibility floor a lead's body is 16 px
 * and a junior's is 12.8 px. §6.2's 16 px is a floor on a SESSION's body; a
 * junior's is one step under it and no lower, and its name is still set at
 * 11 px like everybody's (`labelFontSize`).
 */
export const JUNIOR_SCALE = AGENT_SCALES.small / AGENT_SCALES.medium;

/**
 * The scale a junior is drawn at, given the scale the FLOOR is drawn at: its
 * lead's own drawn scale, one ladder step down.
 * @param {number} worldScale px per plan unit
 */
export function juniorScaleFor(worldScale) {
  return characterScaleFor(worldScale) * JUNIOR_SCALE;
}

/**
 * THE LEVEL OF DETAIL IS A FACT ABOUT THE FIGURE, NOT THE FLOOR (audit F1).
 *
 * It used to be `lodForZoom(px per unit / U)`, with L0 below 0.7, and at the
 * owner's own window — a 690 px stage, 8 px per unit — that put a 150-agent
 * floor at L0, where the tier took every name, every plate's `need you` line,
 * the crew's cables and its `+N` with it. None of those had a size reason to
 * go: a name is held to 11 px whatever the scale.
 *
 * So the tier is read off the one number the rig already drops detail by: the
 * figure's drawn height (`rigHeight`). Under `RIG_DETAIL_MIN_PX` (30 px) it is
 * L0, and L0 means only what WP-79 says — no rim halo, no chest glyph, no far
 * limb, the tool as its icon, and §1.3's slow life (the thinking cloud, the
 * page flip, the slump) held still. The visor and the raised hand are drawn at
 * every tier, and so are names, plate lines, cables and chips. It does not
 * read the agent count: a crowded floor is only L0 where its people are small.
 */
export const LOD_FULL_MIN_PX = 40;

/**
 * @param {number} figurePx the figure's drawn height in screen px
 * @returns {0|1|2}
 */
export function lodForFigure(figurePx) {
  const h = Number(figurePx) || 0;
  if (h < RIG_DETAIL_MIN_PX) return 0;
  return h < LOD_FULL_MIN_PX ? 1 : 2;
}

export class SceneLod extends SceneBase {
  /** The px-per-unit the floor is actually drawn at: fit scale times zoom. */
  _scale() {
    return this._fitScale * this._zoom;
  }

  /**
   * The px-per-unit a PERSON is drawn at, which is not the same number.
   *
   * 05-GUI-UX-SPEC.md §6.2: below the point where a body would be under
   * `BODY_MIN_PX`, people stop scaling down with the plan. Everything derived
   * from a character — its label box, its badge, its icon, its hit radius —
   * reads this rather than `_scale()`, so the whole figure grows together
   * instead of a body floating away from the label under it.
   */
  _characterScale() {
    return characterScaleFor(this._scale());
  }

  /**
   * The px-per-unit THIS figure is drawn at: a junior's is one ladder step
   * under everybody else's ({@link juniorScaleFor}). One method, because the
   * body, its name, its badge, its halo, its cable's end and the box a coach
   * mark points at all have to be asked the same question.
   * @param {{subagent?:boolean}|null|undefined} agent
   */
  _figureScale(agent) {
    return agent && agent.subagent === true
      ? juniorScaleFor(this._scale())
      : this._characterScale();
  }

  /** This frame's level of detail: `lodForFigure` of a senior's drawn height. */
  _lod() {
    return lodForFigure(rigHeight(this._characterScale()));
  }
}

// ----------------------------------------------------- the scaling law (§2)
//
// **THE TWO LEVEL-OF-DETAIL THRESHOLDS ARE IN SCREEN PIXELS AND THEREFORE DO
// NOT SCALE** — 16 px of body at the bottom, 72 px at the top. What they are
// stated ON does: both are `px / BODY_HEIGHT_U`, and `BODY_HEIGHT_U` moves with
// the agent size, so the floor at `small` is allowed to be drawn smaller before
// people stop shrinking with it, and at `large` the fit stops growing sooner.
// That is the right way round: a floor of a hundred small agents still puts
// every body over the legibility floor, because the floor is on the BODY.
//
// Re-derived rather than scaled, for `plan-furniture.js`'s reason: a quotient
// of a scaled number is already scaled, and multiplying it again would be a
// second answer to the same question.
registerBodyScale(() => {
  CHAR_MIN_PX_PER_UNIT = LEGIBILITY_MIN_PX.body / BODY_HEIGHT_U;
  CHAR_MAX_PX_PER_UNIT = BODY_MAX_PX / BODY_HEIGHT_U;
});
