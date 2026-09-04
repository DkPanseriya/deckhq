/**
 * WP-52's tool bubble — "doing: Bash npm test", on the floor
 * (WP-22 follow-up).
 *
 * Split out of `rig.js` unchanged: which icon a tool name means, how a
 * summary is fitted to one line, the box that line needs, and the two draws.
 * The text comes from a hook payload and is measured and drawn as text; it is
 * never treated as markup anywhere (`test/unit/thought-bubble.test.mjs`).
 */

import { TAU, CLOUD_FILL, CLOUD_EDGE, DOT_COLOR, sansFont } from './rig-metrics.js';
import { roundRectFill, roundRectStroke } from './rig-pose.js';
import { PALETTE } from './palette.js';

// -------------------------------------------------------- the tool bubble
//
// WP-52 (docs/plan/08-PLAN-V2-100X.md §3.5, §9). What an agent is DOING,
// above its head: the summary in a bubble at L1 and above, a tool-class icon
// at L0 and under reduced motion. Deliberately in the same comic idiom as the
// thought cloud above, and deliberately quiet — cloud fill and ink, never a
// state colour, because "what it is doing" must not compete with the three
// colours that mean "this needs you".

/** How wide a bubble may get, in px per unit and as a hard pixel ceiling. */
export const BUBBLE_MAX_W_U = 9;
export const BUBBLE_MAX_W_PX = 150;
export const BUBBLE_MIN_W_PX = 44;

/**
 * The tool-class icon a tool name maps to (`08` §3.5's "station per tool
 * class", as a state icon first). Unknown names — an MCP tool, a runtime that
 * invents its own — fall to `other` rather than to nothing: the agent IS
 * doing something, and the floor should say so.
 * @param {string|null|undefined} name
 * @returns {'file'|'shell'|'web'|'other'}
 */
export function toolIconKind(name) {
  switch (String(name || '')) {
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'MultiEdit':
    case 'NotebookEdit':
    case 'NotebookRead':
    case 'Glob':
    case 'Grep':
    case 'LS':
      return 'file';
    case 'Bash':
    case 'BashOutput':
    case 'KillBash':
    case 'KillShell':
      return 'shell';
    case 'WebFetch':
    case 'WebSearch':
      return 'web';
    default:
      return 'other';
  }
}

/**
 * Shorten `text` with `ctx` until it fits `maxW`. Binary search would be
 * quicker; a summary is at most 120 characters and this runs once per visible
 * agent per frame, so the straightforward walk is fine and easier to trust.
 * @param {{measureText:(t:string)=>{width:number}}} ctx
 * @param {string} text
 * @param {number} maxW
 */
export function fitOneLine(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let cut = text.length;
  while (cut > 1) {
    cut--;
    const candidate = text.slice(0, cut).trimEnd() + '…';
    if (ctx.measureText(candidate).width <= maxW) return candidate;
  }
  return '…';
}

/**
 * The bubble's box and its already-truncated one-line text, without drawing
 * anything — the same measure-then-paint split as {@link labelBox}, so a unit
 * test can assert the fit rule against a stubbed context.
 * @param {{font:string, measureText:(text:string)=>{width:number}}} ctx
 * @param {number} ox @param {number} oy @param {number} u
 * @param {string} summary
 * @returns {{text:string, x:number, y:number, w:number, h:number, fontPx:number}}
 */
export function toolBubbleBox(ctx, ox, oy, u, summary) {
  const fontPx = Math.max(9, u * 0.5);
  ctx.font = sansFont(fontPx);
  const padX = Math.max(4, u * 0.28);
  const padY = Math.max(2, u * 0.14);
  const maxTextW = Math.max(
    BUBBLE_MIN_W_PX,
    Math.min(BUBBLE_MAX_W_U * u, BUBBLE_MAX_W_PX) - padX * 2,
  );
  const text = fitOneLine(ctx, String(summary || '').trim(), maxTextW);
  const w = ctx.measureText(text).width + padX * 2;
  const h = fontPx * 1.25 + padY * 2;
  // Sits clear of the head (its crown is about `oy - u * 1.45`), with the
  // trail below filling the gap.
  const y = oy - u * 1.75 - h;
  return { text, x: ox - w / 2, y, w, h, fontPx };
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ox @param {number} oy @param {number} u
 * @param {string} summary
 */
export function drawToolBubble(ctx, ox, oy, u, summary) {
  const box = toolBubbleBox(ctx, ox, oy, u, summary);
  ctx.fillStyle = CLOUD_FILL;
  ctx.strokeStyle = CLOUD_EDGE;
  ctx.lineWidth = Math.max(0.6, u * 0.045);

  // Two trailing beats, rising from beside the head to the bubble.
  for (const [tx, ty, tr] of [
    [ox + u * 0.42, oy - u * 1.12, u * 0.09],
    [ox + u * 0.2, oy - u * 1.5, u * 0.13],
  ]) {
    ctx.beginPath();
    ctx.arc(tx, ty, tr, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }

  const radius = Math.min(box.h * 0.45, u * 0.4);
  roundRectFill(ctx, box.x, box.y, box.w, box.h, radius);
  ctx.save();
  ctx.lineWidth = Math.max(0.6, u * 0.04);
  roundRectStroke(ctx, box.x, box.y, box.w, box.h, radius);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = sansFont(box.fontPx);
  ctx.fillStyle = PALETTE.inkWarm;
  // Canvas text: the summary is hook payload text, drawn as glyphs and never
  // interpreted. There is no markup path here at all.
  ctx.fillText(box.text, ox, box.y + box.h / 2 + box.h * 0.03);
  ctx.restore();
}

/**
 * The tool class as a chip above the head: what L0 and reduced motion get
 * instead of the bubble. Same slot as the state icons, never both — see
 * `drawCharacter`.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ox @param {number} oy @param {number} u
 * @param {'file'|'shell'|'web'|'other'} kind
 */
export function drawToolIcon(ctx, ox, oy, u, kind) {
  const size = Math.max(10, u * 0.85);
  const top = oy - u * 1.05 - size;
  const half = size / 2;
  const cx = ox;
  const cy = top + half;

  ctx.fillStyle = CLOUD_FILL;
  ctx.strokeStyle = CLOUD_EDGE;
  ctx.lineWidth = Math.max(0.6, size * 0.07);
  roundRectFill(ctx, cx - half, top, size, size, size * 0.28);
  roundRectStroke(ctx, cx - half, top, size, size, size * 0.28);

  ctx.save();
  ctx.strokeStyle = DOT_COLOR;
  ctx.fillStyle = DOT_COLOR;
  ctx.lineWidth = Math.max(0.9, size * 0.1);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const r = size * 0.3;
  if (kind === 'file') {
    // A page: two ruled lines.
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r * 0.5);
    ctx.lineTo(cx + r, cy - r * 0.5);
    ctx.moveTo(cx - r, cy + r * 0.5);
    ctx.lineTo(cx + r * 0.3, cy + r * 0.5);
    ctx.stroke();
  } else if (kind === 'shell') {
    // A prompt: a chevron and a caret bar.
    ctx.beginPath();
    ctx.moveTo(cx - r, cy - r * 0.7);
    ctx.lineTo(cx - r * 0.1, cy);
    ctx.lineTo(cx - r, cy + r * 0.7);
    ctx.moveTo(cx + r * 0.25, cy + r * 0.7);
    ctx.lineTo(cx + r, cy + r * 0.7);
    ctx.stroke();
  } else if (kind === 'web') {
    // A globe: a ring, a meridian, an equator.
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(cx, cy, r * 0.45, r, 0, 0, TAU);
    ctx.stroke();
  } else {
    // Anything else: a beat, so the floor still says "busy with something".
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.42, 0, TAU);
    ctx.fill();
  }
  ctx.restore();
}
