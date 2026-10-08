/**
 * The name on a worktree's bench (`plan-worktrees.js`).
 *
 * A small plate on the bench top, in the plate colours the floor already
 * writes names in: the branch the worktree is on where a session reported one,
 * else its directory name, cut short. It is what tells two benches in one room
 * apart, and it is all a bench says — who is at it is the bodies' job.
 *
 * Drawn every frame under the bodies, beside the crews, because it is a label
 * on furniture rather than furniture: the backdrop is baked from props, and a
 * name is not one.
 */

import { PALETTE } from './palette.js';
import { worldToScreen } from './agents.js';
import { sansFont } from './rig-metrics.js';

/** The smallest and largest the name is set at, in pixels. */
const LABEL_MIN_PX = 9;
const LABEL_MAX_PX = 12;

/**
 * The text cut to a width, with an ellipsis where it was cut.
 * @param {CanvasRenderingContext2D} ctx @param {string} text @param {number} maxPx
 */
function fitText(ctx, text, maxPx) {
  if (ctx.measureText(text).width <= maxPx) return text;
  let cut = text.replace(/\u2026$/, '');
  while (cut.length > 1 && ctx.measureText(`${cut}\u2026`).width > maxPx) cut = cut.slice(0, -1);
  return `${cut}\u2026`;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {{benches?: ReadonlyArray<{label:string, w:number, labelAt:{x:number, y:number}}>|null,
 *   camera: any, charU: number}} view `charU` is a body's pixel height unit,
 *   so the name is sized with the people it sits beside
 */
export function drawWorktreeLabels(ctx, view) {
  const benches = view.benches || [];
  if (!benches.length) return;
  const fontPx = Math.max(LABEL_MIN_PX, Math.min(LABEL_MAX_PX, view.charU * 0.36));
  ctx.save();
  ctx.font = sansFont(fontPx);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.globalAlpha = 1;
  for (const bench of benches) {
    if (!bench.label) continue;
    const at = worldToScreen(bench.labelAt, view.camera);
    // Never wider than the bench it is written on.
    const edge = worldToScreen(
      { x: bench.labelAt.x + bench.w / 2, y: bench.labelAt.y },
      view.camera,
    );
    const text = fitText(
      ctx,
      String(bench.label),
      Math.max(fontPx * 3, (edge.x - at.x) * 2 - fontPx),
    );
    const w = ctx.measureText(text).width + fontPx * 0.8;
    const h = fontPx * 1.4;
    ctx.fillStyle = PALETTE.plateHalo;
    ctx.fillRect(at.x - w / 2, at.y - h / 2, w, h);
    ctx.fillStyle = PALETTE.plateInk;
    ctx.fillText(text, at.x, at.y);
  }
  ctx.restore();
}
