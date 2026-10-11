/**
 * THE BADGE PICKER'S PICTURES — a robot wearing each chest badge, drawn by the
 * floor's own painter.
 *
 * WHAT AN "AVATAR" IS ON THIS FLOOR. An agent's `avatar` is one of seven
 * glyph names (`AVATAR_GLYPHS`: hex, triangle, square, diamond, drop, star,
 * cross). It changes exactly one thing a person can see: the small mark on the
 * badge on a robot's chest, which is otherwise its project's own
 * (`identityFor(projectMk, avatar)` → `drawChestGlyph`). The badge is drawn on
 * the floor wherever a figure is large enough for it (30 px of frame and up),
 * in the panel's close-up, on the board and on the mini-floor.
 *
 * So it is real, and small — and the two sheets that set it used to offer it
 * as seven bare outlines under the word "Avatar", which said neither what it
 * was nor where it would appear. Each choice is now the thing itself: the
 * upper half of a robot in that project's colours, wearing that badge, painted
 * by `drawCharacter`. A picture cannot drift from the floor it stands for.
 *
 * Imported dynamically by the sheets (`app-dialogs.js`): it pulls in the rig,
 * which the shell must not wait for, and a build where it does not arrive
 * falls back to the outlines.
 */

import { sampleClip } from './render/clips.js';
import { PALETTE, STATE_COLORS, appearanceFor, identityFor } from './render/palette.js';
import { BODY_HEIGHT_U, drawCharacter } from './render/rig.js';

/** A thumbnail, in logical pixels: wide enough for the shoulders, cut at the waist. */
export const AGENT_THUMB_W = 56;
export const AGENT_THUMB_H = 52;
/** How tall the whole robot would stand: only its top half is in the picture. */
const BODY_PX = 88;
/** The state every thumbnail is drawn in: the colour most of a floor is. */
const THUMB_STATE = 'working';

/**
 * Paint one robot's head and chest, wearing `glyph` — or its project's own
 * badge when `glyph` is null.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{glyph:string|null, projectMk:number, w?:number, h?:number}} spec
 */
export function paintAgentThumb(ctx, spec) {
  const w = spec.w || AGENT_THUMB_W;
  const h = spec.h || AGENT_THUMB_H;
  // The floor it stands on, in the theme the tab is painted in.
  ctx.fillStyle = PALETTE.carpetBase;
  ctx.fillRect(0, 0, w, h);
  drawCharacter(ctx, sampleClip('stand_wait', 0, true), {
    x: w / 2,
    // The feet are below the picture: the badge sits in its lower third, whole.
    y: h + BODY_PX * 0.2,
    u: BODY_PX / BODY_HEIGHT_U,
    lod: 2,
    state: THUMB_STATE,
    color: STATE_COLORS[THUMB_STATE],
    identity: identityFor(spec.projectMk, spec.glyph),
    // One plain session for every card, so the cards differ in the badge alone.
    appearance: appearanceFor('badge-picker'),
    reduced: true,
  });
}

/**
 * A canvas of one thumbnail, or `null` where this browser gives no 2D context.
 * @param {any} doc @param {{glyph:string|null, projectMk:number}} spec
 */
export function agentThumb(doc, spec) {
  try {
    const scale = Math.max(2, Number(globalThis.devicePixelRatio) || 1);
    const canvas = doc.createElement('canvas');
    canvas.width = Math.ceil(AGENT_THUMB_W * scale);
    canvas.height = Math.ceil(AGENT_THUMB_H * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.scale(scale, scale);
    paintAgentThumb(ctx, spec);
    canvas.setAttribute('aria-hidden', 'true');
    return canvas;
  } catch {
    return null;
  }
}
