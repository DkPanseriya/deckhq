/**
 * DeckHQ character rig — one procedural rig, canvas 2D, no sprite sheets.
 *
 * WP-79 REPLACED THE FIGURE AND KEPT THE RIG. What is drawn is now **B**, the
 * 45° three-quarter robot from `docs/media/design/character` — a chunky barrel,
 * a dome head and a bright wrap visor, billboarded so it always faces the
 * camera on a top-down floor. What did NOT change is everything around it: one
 * `drawCharacter`, called by the floor, the mini-floor, the panel's close-up
 * and the manager's own avatar; the same `Pose`; the same two identity hashes;
 * the same chrome slot above the head; the same halo and the same contact
 * ellipse at the feet.
 *
 * Three rules the figure is built on, from the design study's README:
 *
 *   1. **The state colour owns the whole body mass, head included.** Every
 *      shape is a tint of `opts.color` (`rigTints`). The old rig spent the head
 *      and the hair on identity and left a coloured waistcoat, which at 22 px
 *      read as a grey blob with a stripe.
 *   2. **The face is a bright pane with a dark mark.** A lit visor on a
 *      coloured dome survives 24 px; the inverse does not.
 *   3. **Identity is two or three small elements** — the antenna tip, the ear
 *      cups, the chest badge, the boots — and never the body.
 *
 * Scales cleanly across the whole zoom range because every dimension derives
 * from `u` (px per plan unit) through ONE number: `rigHeight(u)`, the figure's
 * height in screen px. `rig-pose.js`'s frame turns a local point into a screen
 * point, and nothing else in this rig knows about pixels at all.
 *
 * Performance (docs/02-ARCHITECTURE.md §8: 25 animated characters at 60 fps):
 * `drawCharacter` allocates no objects or arrays per call, issues no
 * `ctx.save`/`ctx.rotate` per part, and uses no `Path2D`. The figure's geometry
 * is resolved once per character into module-scope scratch (`rigSetup`) and
 * every path builder reads it from there.
 *
 * ============================================================================
 * WP-22 follow-up · this file is the rig's assembly: the rings under a
 * character, the badge and label over it, and `drawCharacter` itself. The
 * parts are six modules:
 *
 *   rig-metrics.js  every dimension, colour and threshold, and the text helpers
 *   rig-pose.js     the local frame, the six poses, the drawing primitives
 *   rig-body.js     halo, shadow, base, arms, barrel, dome, visor, crown
 *   rig-traits.js   the identity slots, the glyph, the rarity markers
 *   rig-props.js    the clips glue: mug, plate, cue, paddle, controller,
 *                   piece, and the three status icons
 *   rig-bubble.js   WP-52's tool bubble
 *
 * Every name those modules export is re-exported here, so `scene-draw.js`,
 * `minifloor.js` and the test files import what they always imported.
 * ============================================================================
 */

import { PALETTE, STATE_COLORS } from './palette.js';
import {
  TAU,
  BASE_U,
  BODY_HEIGHT_U,
  SELECTION_RING_COLOR,
  SELECTION_RING_R,
  RING_BASE_R,
  BADGE_MIN_PX,
  CHROME_BADGE_U,
  MANAGER_SUIT,
  MANAGER_SCALE,
  labelFontSize,
  truncateLabel,
  monoFont,
  sansFont,
  rigTints,
} from './rig-metrics.js';
import { idlePhase, rigFrame, rigHeight, rigPoseFor, roundRectFill } from './rig-pose.js';
import {
  drawContactShadow,
  drawFigureHalo,
  drawFigureRim,
  drawRigBarrel,
  drawRigBase,
  drawRigCard,
  drawRigCrown,
  drawRigDome,
  drawRigFarArm,
  drawRigNearArm,
  drawRigVisor,
  haloRimWidth,
  rigSetup,
} from './rig-body.js';
import { drawGlow, managerIdentity, rigIdentity } from './rig-traits.js';
import { drawCueBehind, drawPropFront, drawIcon, drawDots, drawStallDots } from './rig-props.js';
import { toolIconKind, drawToolBubble, drawToolIcon, toolBubbleText } from './rig-bubble.js';

export * from './rig-metrics.js';
export * from './rig-pose.js';
export * from './rig-body.js';
export * from './rig-traits.js';
export * from './rig-props.js';
export * from './rig-bubble.js';

// ------------------------------------------------------------------ chrome

export function drawFloorRing(ctx, ox, oy, u, phase, color, reduced) {
  const baseR = u * RING_BASE_R;
  let r, alpha;
  if (reduced) {
    r = baseR;
    alpha = 0.5;
  } else {
    const s = Math.sin(phase * TAU) * 0.5 + 0.5;
    r = baseR + s * u * 0.35;
    alpha = 0.25 + s * 0.35;
  }
  const prevAlpha = ctx.globalAlpha;
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.lineWidth = u * 0.16;
  ctx.beginPath();
  ctx.arc(ox, oy, r, 0, TAU);
  ctx.stroke();
  ctx.globalAlpha = prevAlpha;
}

export function drawSelectionRing(ctx, ox, oy, u) {
  ctx.strokeStyle = SELECTION_RING_COLOR;
  ctx.lineWidth = Math.max(1.2, u * 0.14);
  ctx.beginPath();
  ctx.arc(ox, oy, u * SELECTION_RING_R, 0, TAU);
  ctx.stroke();
}

/**
 * Which state a resolved state COLOUR came from.
 *
 * `drawCharacter` has always been handed the colour rather than the state, and
 * B needs the state itself — it picks the pose and the mark on the visor. Every
 * caller was updated to pass `opts.state`, and this is the fallback for the
 * ones that were not: the colour is always exactly a `STATE_COLORS` entry
 * (`scene-agent.js`'s `colorForAgent` returns nothing else), so the inverse is
 * exact rather than a guess. A colour from outside the table — a theme's, a
 * test's — lands on `working`, which draws.
 * @param {string} color
 * @returns {string}
 */
export function stateForColor(color) {
  const want = String(color || '').toLowerCase();
  for (const [state, value] of Object.entries(STATE_COLORS)) {
    if (value.toLowerCase() === want) return state;
  }
  return 'working';
}

/**
 * The badge pill's box in screen space, without drawing anything.
 *
 * The same measure-then-paint split {@link labelBox} has, and split out for the
 * same reason (WP-60): a badge can only be kept out of its neighbour's way if
 * something knows how wide both of them will be BEFORE either is drawn, and
 * that pass runs once for the whole frame rather than per character.
 *
 * @param {{font:string, measureText:(text:string)=>{width:number}}} ctx
 *   only `.font` (assigned) and `.measureText` are read, so a plain stub with
 *   those two members is enough — which is what the unit test uses.
 * @param {number} ox character origin x (screen px); the pill is centred on it
 * @param {number} oy character origin y (screen px)
 * @param {number} u px per plan unit at the CHARACTER scale
 * @param {string} text
 * @returns {{fontPx:number, x:number, y:number, w:number, h:number}}
 */
export function badgeBox(ctx, ox, oy, u, text) {
  const fontPx = Math.max(BADGE_MIN_PX, u * 0.7);
  ctx.font = monoFont(fontPx);
  const padX = u * 0.35;
  const w = ctx.measureText(text).width + padX * 2;
  // The pill grows with its text, so a floored font must not be drawn into an
  // unfloored box: at a tight fit scale the glyphs stood proud of the badge.
  const h = Math.max(u * 1.05, fontPx * 1.5);
  return { fontPx, x: ox - w / 2, y: oy - u * CHROME_BADGE_U - h, w, h };
}

export function drawBadge(ctx, ox, oy, u, text, color) {
  const box = badgeBox(ctx, ox, oy, u, text);
  // `badgeBox` already set it; re-assert before drawing, exactly as `drawLabel`
  // does, so a caller that measured several badges between the two cannot have
  // left another size in place.
  ctx.font = monoFont(box.fontPx);
  ctx.fillStyle = color;
  roundRectFill(ctx, box.x, box.y, box.w, box.h, box.h * 0.32);
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, box.x + box.w / 2, box.y + box.h / 2 + box.h * 0.04);
  ctx.restore();
}

/**
 * THE BOX ONE CHARACTER OCCUPIES, in screen px, given its ground contact.
 *
 * The figure runs UP from its feet by `BODY_HEIGHT_U`, and out either side by
 * `SELECTION_RING_R` — the radius of the shape the interface already draws to
 * mean *this one*, which is the product's own answer to "how wide is a person"
 * and is sized to clear the widest pose the rig can reach.
 *
 * ONE definition, because three surfaces need it and three copies of it is the
 * class of bug docs/DEVIATIONS.md §16, §35, §38, §52 and §55 all belong to:
 * `scene-hit.js` turns a character into the rect a coach mark points at,
 * `scene-draw.js` feeds it to the label-collision pass as an obstacle, and the
 * tests measure against it.
 *
 * @param {number} ox @param {number} oy the ground contact, screen px
 * @param {number} u px per plan unit at the CHARACTER scale
 * @returns {{x:number, y:number, w:number, h:number}}
 */
export function characterBox(ox, oy, u) {
  const w = 2 * SELECTION_RING_R * u;
  const h = BODY_HEIGHT_U * u;
  return { x: ox - w / 2, y: oy - h, w, h };
}

/**
 * HOW FAR UNDER THE FEET A NAME LABEL SITS (WP-79 re-measured this).
 *
 * A label hangs below the ground contact, and the two things it must clear are
 * the FEET — which are at the contact, not above it — and the figure's own
 * halo, whose ground pool is a radial reaching `FIGURE_HALO_POOL_SPAN ×
 * BODY_HEIGHT_U` (1.46 U) in every direction. The old 1.35 U put the label's
 * top inside that pool, which was invisible while a figure was 22 px of mass
 * and obvious once it filled its height: the name sat in the bright disc rather
 * than under it.
 *
 * 1.62 U clears the pool's radius with a little air, and is still well inside
 * `SELECTION_RING_R`'s idea of how much room a person occupies, so the
 * collision pass at a shared desk is resolving the same crowding it always was
 * — measured over the demo population in `test/unit/scene-math.test.mjs`:
 * zero label-over-body overlaps, and the same number of nudges.
 */
export const LABEL_DROP_U = 1.62;

/**
 * The label's bounding box in screen space, without drawing anything.
 * Nothing is painted behind the text any more (CONTRACTS-WP15.md §3 — the
 * backing plate this used to describe is gone), so this box is now purely a
 * measurement: the room for `scene.js`'s per-frame label-collision pass
 * (tech-lead review finding 1) to reason about, sized with the same padding
 * a plate would have had so labels still keep a little breathing room from
 * each other.
 * @param {{font:string, measureText:(text:string)=>{width:number}}} ctx
 *   only `.font` (assigned) and `.measureText` are read — a plain stubbed
 *   object with those two members is enough, which is what the unit test
 *   for this function uses; a real `CanvasRenderingContext2D` also works.
 * @param {number} ox character origin x (screen px)
 * @param {number} oy character origin y (screen px)
 * @param {number} u px per plan unit at the current zoom
 * @param {string} rawLabel
 * @returns {{text:string, x:number, y:number, w:number, h:number, top:number}}
 *   `x,y,w,h`: the text's bounding box (screen space, before any collision
 *   offset). `top`: the text's un-offset draw y (baseline `'top'`), reused
 *   by `drawLabel` so measurement and paint never drift apart.
 */
export function labelBox(ctx, ox, oy, u, rawLabel) {
  const text = truncateLabel(rawLabel);
  const fontPx = labelFontSize(u);
  ctx.font = sansFont(fontPx);
  const textW = ctx.measureText(text).width;
  const padX = Math.max(3, u * 0.18);
  const padY = Math.max(1.5, u * 0.09);
  const w = textW + padX * 2;
  const h = fontPx * 1.18 + padY * 2;
  const top = oy + u * LABEL_DROP_U;
  return { text, x: ox - w / 2, y: top - padY, w, h, top };
}

/**
 * Draws the name label: haloed text directly on the floor, no backing plate
 * (CONTRACTS-WP15.md §3: "Agent labels lose their backing plates. Short MK
 * tags need far less room than a session title did, so they no longer need
 * a plate to be legible.") — KEPT the halo stroke, DROPPED the rounded plate
 * that used to sit behind it. A halo (stroke the glyphs in a light tone,
 * then fill them dark) brightens only the pixels immediately behind each
 * letter, so — unlike a flat ink fill on its own — it holds contrast against
 * both floor materials and against patterned desk furniture without needing
 * an opaque backing; a plate was overkill once the label shrank from a full
 * session title down to a short MK tag or display name. `offsetY` is
 * `scene.js`'s per-frame collision-avoidance nudge, 0 when the label needs
 * none.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ox @param {number} oy @param {number} u
 * @param {string} rawLabel
 * @param {number} [offsetY]
 */
export function drawLabel(ctx, ox, oy, u, rawLabel, offsetY) {
  const box = labelBox(ctx, ox, oy, u, rawLabel);
  const dy = offsetY || 0;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.font = sansFont(labelFontSize(u)); // labelBox already set it; re-assert before drawing
  ctx.lineWidth = Math.max(2, u * 0.16);
  ctx.strokeStyle = 'rgba(255,253,249,0.95)';
  ctx.strokeText(box.text, ox, box.top + dy);
  ctx.fillStyle = PALETTE.inkWarm;
  ctx.fillText(box.text, ox, box.top + dy);
  // Text alignment is global context state. Leaking 'center' out of here
  // pushed every room plate's text off its position.
  ctx.restore();
}

// -------------------------------------------------------------- the rig API

/**
 * THE STILL FRAME OF WP-87's CHARACTER LIFE, for every caller that has none.
 *
 * The mini-floor, the panel's close-up, `drawManagerFigure` and every test that
 * calls `drawCharacter` directly all draw a figure with no director behind it.
 * Rather than nine `life ? life.x : default` reads, there is one frozen object
 * whose every term is the resting value — which is also the reduced-motion
 * value, so a caller with no life and a caller under `prefers-reduced-motion`
 * draw the same picture, as they must.
 * @type {import('./life.js').Life}
 */
export const REST_LIFE = Object.freeze({
  flicker: 0,
  lobes: 0,
  cloud: 0,
  card: 1,
  dots: 0,
  power: 0,
  scale: 1,
  fade: 1,
  running: false,
});

/**
 * THE BILLBOARD CONVENTION (WP-79, replacing the old FACING CONVENTION).
 *
 * B does not turn. `pose.bodyAngle` is still carried, still means what
 * VISUAL-SPEC §3 says it means (0 faces +x, `PI/2` faces +y — `plan.js`'s
 * `angleTo`, and therefore `Seat.angle`), and is still what the seat, the path
 * tangent and the clip's sway compose into. The rig simply does not rotate the
 * FIGURE by it, because a three-quarter robot drawn on a plan has no facing to
 * contradict: the sprite always faces the reader, and the contact ellipse under
 * its feet is the only element in the floor's own plane. That is the top-down
 * RPG convention, and it is what makes all six poses readable from whichever
 * direction the user happens to be scanning.
 *
 * The old rig DID turn, and it produced this renderer's worst bug — a head on
 * one side and the hands on the other (docs/DEVIATIONS.md §26), because the
 * local frame faced local -y while `bodyAngle` measured from +x. There is no
 * quarter-turn correction to get wrong any more, and no way to get it wrong.
 * `test/unit/rig-orientation.test.mjs` now measures the opposite property: that
 * the figure is IDENTICAL at every facing.
 */

/**
 * Draws one character. `opts.u` is px-per-unit at the current zoom; every
 * dimension derives from it so the rig scales cleanly across 0.35-2.5.
 *
 * Draw order: floor ring -> selection ring -> aura -> figure halo -> contact
 * shadow -> rim -> base -> far arm -> barrel -> held prop (behind) -> near arm
 * and mitt -> held page -> dome -> visor -> crown -> prop (in front) -> state
 * icon (or the tool bubble, or thought/speech dots) -> badge -> name label.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./clips.js').Pose} pose
 * @param {{ x:number, y:number, u:number, lod:0|1|2, color:string, state?:string,
 *   label?:string, labelOffsetY?:number, icon?:'hand'|'hourglass'|'check'|null,
 *   badge?:string|null, selected?:boolean, reduced?:boolean, seconds?:number,
 *   walking?:boolean, tool?:{name:string, summary:string}|null,
 *   phase?:number|null, life?:import('./life.js').Life|null,
 *   identity?:{hair:string, accent:string, glyph:string}|null,
 *   appearance?:import('./palette.js').Appearance|null }} opts
 *   `life` (WP-87): what this figure is doing beyond its pose — the visor
 *   flash on a real tool call, the thought cloud's size and sway, the page
 *   flip, the stall dots, the power-down, and the pop-in/fold-away at the two
 *   ends of a session's life on the floor. Computed once per agent per frame by
 *   `life.js` from the snapshot and the injected clock. Omitted, every term
 *   rests at its reduced-motion value ({@link REST_LIFE}).
 *   `phase` (WP-87): the `?phase=` pin, carried for callers that want to say
 *   they are drawing a pinned frame; the rig itself reads only `life`.
 *   `state` (WP-79): which of the six the figure is in. It picks the pose and
 *   the mark on the visor. Optional: omitted, it is recovered exactly from
 *   `color` (see `stateForColor`).
 *   `seconds` (WP-79): elapsed seconds from the INJECTED clock, for the idle
 *   micro-motion. Omitted, or under `reduced`, the figure is static.
 *   `tool` (WP-52): the agent's `currentTool` from the snapshot, or null. Drawn
 *   as a bubble with the summary at `lod >= 1`, as a tool-class icon at L0 and
 *   under reduced motion, and not at all when a state icon or a waiting badge
 *   already occupies the space above the head.
 *   `labelOffsetY`: vertical screen-px nudge applied to the label only.
 *   `identity` (CONTRACTS-WP15.md §2): project appearance from
 *   `palette.js`'s `identityFor` — the chest badge, its glyph, and the boots.
 *   `appearance` (WP-20): who this particular session is, from
 *   `palette.js`'s `appearanceOf(agent)` — the antenna tip, the ear cups, the
 *   mitts, the barrel's width, the dome's size, the crown accessory, the brow
 *   bar, and a rarity marker on a minority of agents. Neither channel touches
 *   the barrel's fill or the visor's tint: the state owns both.
 */
export function drawCharacter(ctx, pose, opts) {
  // WP-87 · what this figure is doing beyond its pose, from `life.js`. A caller
  // with none — the mini-floor, the panel's close-up, a test — gets `REST`, and
  // every term in it is the still, informative value, so nothing below is a
  // code path that only the floor takes.
  const life = opts.life || REST_LIFE;
  const ox = opts.x,
    oy = opts.y,
    // THE SPAWN POP-IN AND THE DESPAWN FOLD-AWAY (§2) are the figure's own
    // SIZE, which is `u`, so they are applied here and everything hanging off
    // the body — arms, visor, crown, prop — scales with it for free. Both rest
    // at 1, which is every frame of every figure that is neither arriving nor
    // leaving.
    u = opts.u * (life.scale === 1 ? 1 : Math.max(0.01, life.scale)),
    lod = opts.lod,
    color = opts.color;
  const reduced = !!opts.reduced;
  const appearance = opts.appearance || null;
  const trait = appearance ? appearance.trait : null;
  const state = opts.state || stateForColor(color);
  // `walking` is the caller's, because the caller is the only one that knows:
  // `scene-draw.js` plays `walk` whenever a record still has path left, which
  // `rec.clip` does not say until the walk ends. The pose is the fallback for
  // a caller that has nothing to add.
  const walking = opts.walking === true || (pose.seated === false && pose.legPhase > 0);
  const k = rigPoseFor(walking ? 'walking' : state);
  const id = rigIdentity(opts.identity || null, appearance);
  const dead = state === 'ended' || state === 'let_go';
  const tints = rigTints(color, dead);
  const h = rigHeight(u);
  const phase = idlePhase(opts.seconds, reduced, opts.phase ?? null);

  // The fold-away and the pop-in fade as well as scale, because a figure that
  // only shrank would read as walking away from the camera. `1` skips the
  // assignment entirely, so nothing but an arrival or a departure ever touches
  // the context's alpha.
  const prevAlpha = life.fade === 1 ? null : ctx.globalAlpha;
  if (prevAlpha !== null) ctx.globalAlpha = prevAlpha * Math.max(0, life.fade);

  if (pose.ring) drawFloorRing(ctx, ox, oy, u, pose.ringPhase, color, reduced);
  if (opts.selected) drawSelectionRing(ctx, ox, oy, u);
  // Behind everything, including the contact shadow: an aura the body stands
  // in, not a mark on the body (WP-20's legendary `glow`).
  if (trait === 'glow' && lod >= 1) drawGlow(ctx, ox, oy, u, appearance.traitColor);

  // THE HALO, BEFORE THE SHADOW (WP-85a §3.9). On a light floor this is a
  // ground pool, and the shadow belongs on top of it because the shadow is a
  // thing ON the floor and the pool is the floor. On a dark floor there is no
  // pool — a pool on a dark floor is a hole in the room — and the rim below is
  // the whole device. The rim is laid at §3.9's stated 1.1 px on BOTH, because
  // since WP-79 it is also B's own outline and one figure should not be
  // outlined twice as heavily as another for a reason the reader cannot see.
  drawFigureHalo(ctx, ox, oy, u, lod);

  drawContactShadow(ctx, ox, oy, u);

  // The body's own vertical breathing, from the clip. `bob` is stated in px at
  // BASE_U, so it is scaled into this zoom exactly as it always was.
  const by = oy + (reduced ? 0 : pose.bob * (u / BASE_U));
  rigFrame(ox, by, h);
  rigSetup(k, id, tints, h, phase, lod === 0, life);

  drawFigureRim(ctx, haloRimWidth(u));
  drawRigBase(ctx);
  drawRigFarArm(ctx);
  drawRigBarrel(ctx);

  if (pose.prop === 'cue') drawCueBehind(ctx, u);

  drawRigDome(ctx);
  drawRigVisor(ctx, dead ? 'ended' : state);
  // THE NEAR ARM GOES OVER THE DOME, AND THAT IS THE WHOLE REASON IT IS HERE.
  // At `needs_input` the mitt is at local y 0.97, level with the top of the
  // dome and just outside its edge, so an arm drawn before the head — which is
  // where the study's own sheet draws it — has its forearm painted over by the
  // head it is reaching past. A raised hand is the one thing on this floor that
  // must never be occluded (VISUAL-SPEC §5), including by the character raising
  // it. Every other pose puts the mitt well below the dome, so nothing else
  // moves at all.
  drawRigNearArm(ctx);
  drawRigCard(ctx);
  drawRigCrown(ctx);

  if (pose.prop) drawPropFront(ctx, pose.prop, u);

  // Above-head chrome, in one place because it is one slot. Precedence:
  // the state icon, then the tool bubble (WP-52), then the abstract thought
  // cloud. The bubble YIELDS — a raised hand and a waiting badge are the
  // things the user has to act on, and "what it is doing" must never be
  // drawn over, or beside, either of them.
  //
  // Every one of these hangs off the FEET at a fixed offset (`CHROME_TOP_U`
  // in `rig-metrics.js`), raised by WP-79 to clear a figure that now fills
  // its whole 2.52 U rather than a third of it.
  const tool = opts.tool || null;
  const showTool = tool && !opts.icon && !opts.badge;
  if (opts.icon) {
    drawIcon(ctx, ox, oy, u, opts.icon, color, pose.ringPhase);
  } else if (showTool && lod >= 1 && !reduced) {
    // WP-64: an MCP tool's raw id reads `Gmail · send` here. Every other
    // tool's summary is the adapter's, unchanged.
    drawToolBubble(ctx, ox, oy, u, toolBubbleText(tool));
  } else if (showTool) {
    // L0, or reduced motion at any LOD: the class, not the sentence.
    drawToolIcon(ctx, ox, oy, u, toolIconKind(tool.name));
  } else if (life.dots > 0) {
    // WP-87 · `stalled`'s two dots. They take the slot ahead of the clip's own
    // thought/speech dots because a stalled session is not thinking: it has
    // gone quiet, and that is the one thing the slot has to say about it.
    drawStallDots(ctx, ox, oy, u, life.dots);
  } else if (life.lobes > 0) {
    // WP-87 · the thinking cloud: a turn open, no tool running, and nothing
    // written for N seconds. Its SIZE is how long that has been true and its
    // sway is the only part of it that moves.
    drawDots(ctx, ox, oy, u, 1, life.lobes, life.cloud);
  } else {
    const thoughtOpacity = Math.sin(Math.min(1, Math.max(0, pose.thoughtPhase)) * Math.PI);
    if (thoughtOpacity > 0.02) drawDots(ctx, ox, oy, u, thoughtOpacity);
    const speechOpacity = Math.sin(Math.min(1, Math.max(0, pose.speechPhase)) * Math.PI);
    if (speechOpacity > 0.02) drawDots(ctx, ox, oy, u, speechOpacity);
  }

  if (opts.badge) drawBadge(ctx, ox, oy, u, opts.badge, color);
  if (lod >= 1 && opts.label) drawLabel(ctx, ox, oy, u, opts.label, opts.labelOffsetY);

  if (prevAlpha !== null) ctx.globalAlpha = prevAlpha;
}

// ------------------------------------------------------------- the manager

/**
 * The user's own avatar, standing at the head of their desk — not an agent,
 * so it carries none of an agent's chrome: a fixed suit tone instead of a
 * state colour, no visor mark of any state, no icon, no waiting badge, no
 * hand-raise ring, no MK tag, no project identity. It is the same figure every
 * agent is, drawn by the same functions in the same order, so it reads as
 * unmistakably the same species: just bigger, standing taller, and in a suit.
 *
 * Called from `backdrop.js`'s `paintProp` (`case 'manager'`), which bakes the
 * whole floor once per plan change, never per frame — so unlike
 * `drawCharacter` this takes one fixed standing pose rather than a Pose sampled
 * from a clip, and no idle phase at all.
 *
 * `opts.angle` is accepted and ignored, exactly as `pose.bodyAngle` is: the
 * figure is billboarded (see THE BILLBOARD CONVENTION above). It stays in the
 * signature because `backdrop-props-desk.js` has a facing to hand over and a
 * caller should not have to know that the rig has stopped using it.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x:number, y:number, u:number, angle?:number }} opts
 */
export function drawManagerFigure(ctx, opts) {
  const ox = opts.x,
    oy = opts.y,
    u = opts.u * MANAGER_SCALE;
  const h = rigHeight(u);
  const k = rigPoseFor('for_review');
  const id = managerIdentity();
  const tints = rigTints(MANAGER_SUIT, false);

  // The manager is a character too, so it gets §3.9's halo like every other
  // figure on this floor — a suit at `#2B2F3A` needs it on a dark theme at
  // least as much as a state colour does. `lod` is 2: the manager is baked
  // into the backdrop once per plan change and is always drawn in full.
  drawFigureHalo(ctx, ox, oy, u, 2);

  drawContactShadow(ctx, ox, oy, u);

  rigFrame(ox, oy, h);
  rigSetup(k, id, tints, h, 0, false);

  drawFigureRim(ctx, haloRimWidth(u));
  drawRigBase(ctx);
  drawRigFarArm(ctx);
  drawRigBarrel(ctx);
  drawRigDome(ctx);
  // No state on this visor: the manager is the user, and the user has no
  // activity state. A plain lit pane, and nothing written on it.
  drawRigVisor(ctx, 'manager');
  drawRigNearArm(ctx);
  drawRigCrown(ctx);
}
