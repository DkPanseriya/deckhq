/**
 * THE TWO-ROW NAME TAG (WP-99): a role chip over a sub-agent's name.
 *
 * A lead's name is one line of haloed text under its feet. A sub-agent's is
 * two rows: a small chip that says what it is — `Junior` — on a background of
 * its own, and under it the name, without the `·jr` the chip has already said.
 * Size says junior from across the room; the chip says it in a word.
 *
 * THE TWO ROWS ARE ONE BOX. `stackRole` takes the box `labelBox` measured for
 * the name and returns the box of the whole tag: the same top edge, the wider
 * of the two rows across, and the chip's height deeper. That one box is what
 * the frame's collision pass places, shrinks, abbreviates, moves and drops, so
 * a chip is never set without its name nor a name without its chip.
 *
 * THE CHIP IS A PLATE'S INK, INSIDE OUT. A room plate is ink on a halo; the
 * chip is the halo's colour on a fill of `plateInkSecondary`, the ink a
 * plate's own name is set in. Both are the theme's tokens and nothing else, so
 * the pair is as far apart on a dark floor as on a light one, and it is not
 * the name's own treatment — a pale outline round dark glyphs — which is what
 * makes it a second row rather than a second line.
 * `test/unit/juniors-read.test.mjs` measures the pair on every theme.
 *
 * Every width goes through `text-metrics.js`: a role word is one string in one
 * font for the whole floor, measured once and never per frame.
 */

import { PALETTE } from './palette.js';
import { snapPx } from './device-px.js';
import { sansFont } from './rig-metrics.js';
import { roundRectPath } from './rig-pose.js';
import { textWidth } from './text-metrics.js';

/**
 * The smallest a role word is set, in screen px. A step under a name's own
 * 11 px, because it is one of a handful of known words and not a name to be
 * read letter by letter; it is still a size `sansFont` sets whole.
 */
export const ROLE_CHIP_MIN_PX = 10;
/** A role word's size as a share of the name under it. */
export const ROLE_CHIP_SHARE = 0.84;
/** The air between the chip and the name's own box, in screen px. */
export const ROLE_CHIP_GAP = 1;

/**
 * The size a role word is set in, over a name set at `namePx`.
 * @param {number} namePx
 */
export function roleChipFontSize(namePx) {
  return Math.max(ROLE_CHIP_MIN_PX, namePx * ROLE_CHIP_SHARE);
}

/**
 * The chip's own fill and ink, from the tokens in force: what `drawRoleChip`
 * paints with, said once so a test can measure the pair.
 * @returns {{fill:string, ink:string}}
 */
export function roleChipColours() {
  return { fill: PALETTE.plateInkSecondary, ink: opaque(PALETTE.plateHalo) };
}

/** The last halo made opaque, so a frame asks for a string and builds none. */
let _haloOf = '';
let _halo = '';

/**
 * A token's colour at full strength: `rgba(244,241,234,0.92)` → `rgb(244,241,234)`.
 * The halo is laid at 0.92 over whatever is behind it; on a chip nothing is.
 * @param {string} colour
 */
function opaque(colour) {
  if (colour === _haloOf) return _halo;
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(String(colour).trim());
  _haloOf = colour;
  _halo = m ? `rgb(${m[1]},${m[2]},${m[3]})` : colour;
  return _halo;
}

/**
 * ONE BOX FOR BOTH ROWS: the name's box, with a role chip stacked on top of it.
 *
 * @param {{font:string, measureText:(text:string)=>{width:number}}} ctx
 * @param {{text:string, x:number, y:number, w:number, h:number, top:number}} name
 *   the name's own box (`labelBox`)
 * @param {string} role the word on the chip
 * @param {number} namePx the size the name is set in
 * @returns {{text:string, x:number, y:number, w:number, h:number, top:number,
 *   role:string, chip:{x:number, y:number, w:number, h:number, px:number}}}
 *   `x,y,w,h` is the whole tag; `top` is where the NAME is drawn; `chip` is the
 *   first row, centred over it
 */
export function stackRole(ctx, name, role, namePx) {
  const px = roleChipFontSize(namePx);
  const cw = textWidth(ctx, sansFont(px), role) + px;
  const ch = px * 1.36;
  const mid = name.x + name.w / 2;
  const w = Math.max(name.w, cw);
  const drop = ch + ROLE_CHIP_GAP;
  return {
    text: name.text,
    x: mid - w / 2,
    y: name.y,
    w,
    h: name.h + drop,
    top: name.top + drop,
    role,
    chip: { x: mid - cw / 2, y: name.y, w: cw, h: ch, px },
  };
}

/**
 * Paint a tag's first row. The caller paints the name under it, as it paints
 * any name.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number, y:number, w:number, h:number, px:number}} chip from `stackRole`
 * @param {string} role
 * @param {number} dx @param {number} dy the collision pass's offset for the tag
 */
export function drawRoleChip(ctx, chip, role, dx, dy) {
  // On whole device pixels, as the name's own top line is.
  const x = snapPx(ctx, chip.x + dx);
  const y = snapPx(ctx, chip.y + dy);
  ctx.fillStyle = PALETTE.plateInkSecondary;
  roundRectPath(ctx, x, y, chip.w, chip.h, chip.h * 0.3);
  ctx.fill();
  ctx.font = sansFont(chip.px);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = opaque(PALETTE.plateHalo);
  ctx.fillText(role, x + chip.w / 2, y + chip.h / 2 + chip.h * 0.04);
}
