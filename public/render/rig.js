/**
 * DeckHQ character rig — one procedural rig, canvas 2D, no sprite sheets.
 *
 * Scales cleanly across zoom 0.35-2.5 because every dimension derives from
 * `u` (px per plan unit at the current zoom). Body colour is the state
 * colour, passed in by the caller (scene.js resolves it from palette.js's
 * `STATE_COLORS`) — this module never needs the state name itself, only the
 * resolved colour, a badge string, and an icon name. Skin, hair and prop
 * materials are constant across agents by design (VISUAL-SPEC §3):
 * individuality is carried by the name label, not by appearance.
 *
 * Performance (docs/02-ARCHITECTURE.md §8: 25 animated characters at 60 fps):
 * `drawCharacter` allocates no objects or arrays per call. Body-part
 * transforms are computed by hand (rotate a local point, then translate) into
 * flat module-scope scratch numbers rather than via `ctx.save/rotate/restore`
 * per limb — `drawCharacter` itself never calls `ctx.save`/`ctx.restore` at
 * all; the few stateful canvas properties it touches (`globalAlpha`) are
 * read and restored manually, which is cheaper than a full state push/pop.
 *
 * ============================================================================
 * WP-22 follow-up · this file is the rig's assembly: the rings under a
 * character, the badge and label over it, and `drawCharacter` itself, which
 * paints every part in order. The parts are six modules:
 *
 *   rig-metrics.js  every dimension, colour and threshold, and the text
 *                   helpers
 *   rig-pose.js     the pose, the limb transforms, and the arm solve
 *   rig-body.js     shadow, legs, torso, arms, head, hair, waistband
 *   rig-traits.js   glasses, rarity, glow, glyph, identity marks, suit
 *   rig-props.js    the clips glue: mug, plate, cue, paddle, controller,
 *                   piece, and the three status icons
 *   rig-bubble.js   WP-52's tool bubble
 *
 * Not one function body changed and the dependency runs one way — metrics,
 * then pose, then the four drawing modules, then this one. Every name the
 * module exported is re-exported here, so `scene-draw.js`, `minifloor.js`,
 * `postcard.js` and four test files import what they always imported.
 * ============================================================================
 */

import { PALETTE } from './palette.js';
import {
  TAU,
  BASE_U,
  SELECTION_RING_COLOR,
  SELECTION_RING_R,
  RING_BASE_R,
  BADGE_MIN_PX,
  MANAGER_SUIT,
  MANAGER_SCALE,
  labelFontSize,
  truncateLabel,
  monoFont,
  sansFont,
} from './rig-metrics.js';
import { makePose, computeArmGeometry, roundRectFill } from './rig-pose.js';
import {
  drawContactShadow,
  drawSimpleBody,
  drawLegs,
  drawTorso,
  drawArmStroke,
  drawFingerTicks,
  drawHead,
  drawHair,
  drawWaistband,
} from './rig-body.js';
import {
  drawGlasses,
  drawRarityTrait,
  drawGlow,
  drawIdentityMarks,
  drawSuitAccents,
} from './rig-traits.js';
import { drawCueBehind, drawPropFront, drawIcon, drawDots } from './rig-props.js';
import { toolIconKind, drawToolBubble, drawToolIcon } from './rig-bubble.js';

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

export function drawBadge(ctx, ox, oy, u, text, color) {
  const fontPx = Math.max(BADGE_MIN_PX, u * 0.7);
  ctx.font = monoFont(fontPx);
  const padX = u * 0.35;
  const w = ctx.measureText(text).width + padX * 2;
  // The pill grows with its text, so a floored font must not be drawn into an
  // unfloored box: at a tight fit scale the glyphs stood proud of the badge.
  const h = Math.max(u * 1.05, fontPx * 1.5);
  const topY = oy - u * 2.35 - h;
  ctx.fillStyle = color;
  roundRectFill(ctx, ox - w / 2, topY, w, h, h * 0.32);
  ctx.save();
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, ox, topY + h / 2 + h * 0.04);
  ctx.restore();
}

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
  const top = oy + u * 1.35;
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
 * FACING CONVENTION (VISUAL-SPEC §3's `Pose.bodyAngle`): 0 faces +x (east),
 * `Math.PI / 2` faces +y (south) — identical to `plan.js`'s `angleTo` (see
 * its doc comment there) and therefore to `Seat.angle`, which is where
 * `bodyAngle` ultimately comes from: `clips.js`'s `sampleClip` only ever
 * returns a small relative sway on top of it, and `scene.js` adds the
 * seat's absolute facing before calling `drawCharacter`.
 *
 * The body parts below are authored in a *local*, unrotated frame where
 * "forward" (the head — VISUAL-SPEC: "the head sits forward-of-centre") is
 * local -y and "lateral" (left/right, e.g. `SHOULDER_OFFSET_X`) is local x.
 * That local frame itself faces local -y, a quarter turn away from the +x
 * the convention above requires. Every routine that turns one of those
 * local points into a screen point must therefore rotate by
 * `bodyAngle + Math.PI / 2`, never by `bodyAngle` directly — that
 * quarter-turn correction is `facingRot` below, threaded through
 * `cosA`/`sinA` into `drawLegs` / `computeArmGeometry` / `drawHead` /
 * `drawHair`, and passed straight through to `drawTorso` / `drawHair`
 * wherever they need the facing angle itself rather than its sine/cosine.
 *
 * Get this wrong — e.g. rotate by raw `bodyAngle` — and the head (which has
 * no lateral offset) ends up displaced along what is actually the
 * character's *side* axis, while the arms (which do have a real lateral
 * spread) end up spread along what is actually the *forward/back* axis:
 * this was exactly the "hands on one side, head on the other, arms coming
 * out of the back" bug. See test/unit/rig-orientation.test.mjs.
 */

/**
 * Draws one character. `opts.u` is px-per-unit at the current zoom; every
 * dimension derives from it so the rig scales cleanly across 0.35-2.5.
 *
 * Draw order (VISUAL-SPEC §3, plus floor-level chrome and above-head chrome
 * that the §3 body-part order doesn't cover): floor ring -> selection ring ->
 * contact shadow -> legs -> torso -> held prop (behind) -> arms -> head ->
 * hair -> identity marks (collar accent + glyph, when `opts.identity` is set)
 * -> prop (in front) -> state icon (or the tool bubble, or thought/speech
 * dots) -> badge -> name label.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {import('./clips.js').Pose} pose
 * @param {{ x:number, y:number, u:number, lod:0|1|2, color:string,
 *   label?:string, labelOffsetY?:number, icon?:'hand'|'hourglass'|'check'|null,
 *   badge?:string|null, selected?:boolean, reduced?:boolean,
 *   tool?:{name:string, summary:string}|null,
 *   identity?:{hair:string, accent:string, glyph:string}|null,
 *   appearance?:import('./palette.js').Appearance|null }} opts
 *   `tool` (WP-52): the agent's `currentTool` from the snapshot, or null. Drawn
 *   as a bubble with the summary at `lod >= 1`, as a tool-class icon at L0 and
 *   under reduced motion, and not at all when a state icon or a waiting badge
 *   already occupies the space above the head.
 *   `labelOffsetY`: vertical screen-px nudge applied to the label only
 *   (`scene.js`'s per-frame collision resolution, tech-lead review finding 1).
 *   `identity` (CONTRACTS-WP15.md §2): project appearance from
 *   `palette.js`'s `identityFor`. The torso stays `opts.color` — the state
 *   colour — regardless; identity rides on hair, a small clothing accent and
 *   a shoulder/back glyph only, and only at `lod >= 1` (L0's `drawSimpleBody`
 *   has no hair or accent layer to carry it).
 *   `appearance` (WP-20): who this particular session is, from `palette.js`'s
 *   `appearanceFor(sessionId)` — hair style, skin, an outfit accent, glasses,
 *   build, and a rarity trait on a minority of agents. Optional and additive:
 *   omit it and this function draws exactly what it drew before. Nothing here
 *   touches the torso fill, the state icon or the badge, so the two things the
 *   floor has to say — what state this session is in and whether it is waiting
 *   on you — read identically with or without it, at every LOD.
 */
export function drawCharacter(ctx, pose, opts) {
  const ox = opts.x,
    oy = opts.y,
    u = opts.u,
    lod = opts.lod,
    color = opts.color;
  const reduced = !!opts.reduced;
  const identity = opts.identity || null;
  const appearance = opts.appearance || null;
  const skin = appearance ? appearance.skin : undefined;
  const build = appearance ? appearance.build : 1;
  const trait = appearance ? appearance.trait : null;
  // See the FACING CONVENTION comment above — rotating by pose.bodyAngle
  // directly (instead of facingRot) is the bug this file used to have.
  const facingRot = pose.bodyAngle + Math.PI / 2;
  const cosA = Math.cos(facingRot);
  const sinA = Math.sin(facingRot);

  if (pose.ring) drawFloorRing(ctx, ox, oy, u, pose.ringPhase, color, reduced);
  if (opts.selected) drawSelectionRing(ctx, ox, oy, u);
  // Behind everything, including the contact shadow: an aura the body stands
  // in, not a mark on the body (WP-20's legendary `glow`).
  if (trait === 'glow' && lod >= 1) drawGlow(ctx, ox, oy, u, appearance.traitColor);

  drawContactShadow(ctx, ox, oy, u);

  if (lod === 0) {
    drawSimpleBody(ctx, ox, oy, u, color, skin, build);
  } else {
    const by = oy + pose.bob * (u / BASE_U);
    drawLegs(ctx, pose, ox, by, cosA, sinA, u, color);
    drawTorso(ctx, ox, by, facingRot, u, color, build);
    // The outfit accent goes on before the arms, so a sleeve crosses it.
    if (appearance) drawWaistband(ctx, ox, by, cosA, sinA, u, build, appearance.accent);
    if (trait === 'jacket') {
      drawRarityTrait(
        ctx,
        ox,
        by,
        cosA,
        sinA,
        u,
        facingRot,
        build,
        'jacket',
        appearance.traitColor,
      );
    }

    computeArmGeometry(ox, by, cosA, sinA, u, 1, pose.armR.shoulder, pose.armR.elbow);
    computeArmGeometry(ox, by, cosA, sinA, u, -1, pose.armL.shoulder, pose.armL.elbow);

    if (pose.prop === 'cue') drawCueBehind(ctx, u);

    drawArmStroke(ctx, 1, u, color, skin);
    drawArmStroke(ctx, -1, u, color, skin);
    if (lod >= 2 && pose.armR.hand === 'key') drawFingerTicks(ctx, 1, u, pose.fingerPhase);
    if (lod >= 2 && pose.armL.hand === 'key') drawFingerTicks(ctx, -1, u, pose.fingerPhase);

    drawHead(ctx, ox, by, cosA, sinA, u, skin);
    // A rare hair colour is the one place the per-agent channel overrules the
    // project channel (~2.5% of agents — see DEVIATIONS and palette.js).
    const hairColor =
      (appearance && appearance.hairColor) || (identity ? identity.hair : undefined);
    drawHair(
      ctx,
      ox,
      by,
      cosA,
      sinA,
      u,
      facingRot,
      hairColor,
      appearance ? appearance.hairStyle : undefined,
    );
    if (identity) drawIdentityMarks(ctx, ox, by, cosA, sinA, u, identity);
    // A hat covers the hair, so it is drawn over it; the same is true of a
    // scarf over the collar and a crown over the crown of the head.
    if (trait === 'hat' || trait === 'scarf' || trait === 'crown') {
      drawRarityTrait(ctx, ox, by, cosA, sinA, u, facingRot, build, trait, appearance.traitColor);
    }
    // Glasses last on the face, and L2 only — see `drawGlasses`. A hat sits
    // back on the crown, so the brow it would cover is still there to wear
    // them.
    if (appearance && appearance.glasses && lod >= 2) {
      drawGlasses(ctx, ox, by, cosA, sinA, u, facingRot);
    }

    if (pose.prop) drawPropFront(ctx, pose.prop, u);
  }

  // Above-head chrome, in one place because it is one slot. Precedence:
  // the state icon, then the tool bubble (WP-52), then the abstract thought
  // cloud. The bubble YIELDS — a raised hand and a waiting badge are the
  // things the user has to act on, and "what it is doing" must never be
  // drawn over, or beside, either of them. It also replaces the thought
  // cloud rather than joining it: the cloud says "thinking", the bubble says
  // what about, and two clouds over one head is noise.
  const tool = opts.tool || null;
  const showTool = tool && !opts.icon && !opts.badge;
  if (opts.icon) {
    drawIcon(ctx, ox, oy, u, opts.icon, color, pose.ringPhase);
  } else if (showTool && lod >= 1 && !reduced) {
    drawToolBubble(ctx, ox, oy, u, tool.summary);
  } else if (showTool) {
    // L0, or reduced motion at any LOD: the class, not the sentence.
    drawToolIcon(ctx, ox, oy, u, toolIconKind(tool.name));
  } else {
    const thoughtOpacity = Math.sin(Math.min(1, Math.max(0, pose.thoughtPhase)) * Math.PI);
    if (thoughtOpacity > 0.02) drawDots(ctx, ox, oy, u, thoughtOpacity);
    const speechOpacity = Math.sin(Math.min(1, Math.max(0, pose.speechPhase)) * Math.PI);
    if (speechOpacity > 0.02) drawDots(ctx, ox, oy, u, speechOpacity);
  }

  if (opts.badge) drawBadge(ctx, ox, oy, u, opts.badge, color);
  if (lod >= 1 && opts.label) drawLabel(ctx, ox, oy, u, opts.label, opts.labelOffsetY);
}

// ------------------------------------------------------------- the manager

/**
 * The user's own avatar, standing at the head of their desk — not an agent,
 * so it carries none of an agent's chrome: a fixed suit tone instead of a
 * state colour, no state icon, no waiting badge, no hand-raise ring, no MK
 * tag, no project identity. Reuses the exact same body primitives as
 * `drawCharacter`, in the same order — contact shadow -> legs -> torso ->
 * arms -> head -> hair -> suit accents — so it reads as unmistakably the
 * same species as every agent on the floor: just bigger, standing taller,
 * and in a suit.
 *
 * Called from `backdrop.js`'s `paintProp` (`case 'manager'`), which bakes the
 * whole floor once per plan change, never per frame — so unlike
 * `drawCharacter` this takes one fixed confident standing pose rather than a
 * Pose sampled from a clip: legs together, arms at rest, chest square to the
 * queue.
 *
 * `backdrop.js` calls this from inside a translate-to-the-prop-centre
 * transform with the ambient `ctx.rotate` cancelled back out first, because
 * (like `drawCharacter`) this function bakes facing into the coordinates it
 * hands to `ctx` itself, exactly per the FACING CONVENTION above — it must
 * not also be called under an active rotation, or the figure would be turned
 * twice.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ x:number, y:number, u:number, angle?:number }} opts
 *   `x,y`: the figure's centre, in the current (translate-only) transform.
 *   `u`: px-per-unit before the manager's own size bump (`MANAGER_SCALE`
 *   above — "a bit bigger" than an agent, per the work order).
 *   `angle`: facing, in `Pose.bodyAngle`'s convention (0 = +x/east).
 */
export function drawManagerFigure(ctx, opts) {
  const ox = opts.x,
    oy = opts.y,
    u = opts.u * MANAGER_SCALE;
  const bodyAngle = opts.angle || 0;
  const facingRot = bodyAngle + Math.PI / 2;
  const cosA = Math.cos(facingRot);
  const sinA = Math.sin(facingRot);
  const pose = makePose({
    bodyAngle,
    armL: { shoulder: 0, elbow: 0, hand: 'rest' },
    armR: { shoulder: 0, elbow: 0, hand: 'rest' },
  });

  drawContactShadow(ctx, ox, oy, u);
  drawLegs(ctx, pose, ox, oy, cosA, sinA, u, MANAGER_SUIT);
  drawTorso(ctx, ox, oy, facingRot, u, MANAGER_SUIT);

  computeArmGeometry(ox, oy, cosA, sinA, u, 1, pose.armR.shoulder, pose.armR.elbow);
  computeArmGeometry(ox, oy, cosA, sinA, u, -1, pose.armL.shoulder, pose.armL.elbow);
  drawArmStroke(ctx, 1, u, MANAGER_SUIT);
  drawArmStroke(ctx, -1, u, MANAGER_SUIT);

  drawHead(ctx, ox, oy, cosA, sinA, u);
  drawHair(ctx, ox, oy, cosA, sinA, u, facingRot);
  drawSuitAccents(ctx, ox, oy, cosA, sinA, u);
}
