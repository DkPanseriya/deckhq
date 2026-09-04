/**
 * What a character is holding, and what is over its head
 * (WP-22 follow-up).
 *
 * Split out of `rig.js` unchanged, and this is the clips glue: `clips.js`
 * names an activity and a prop, and these are the functions that draw the
 * named thing — the cue behind and in front of the body, the mug, the plate,
 * the paddle, the controller, the piece — plus the three status icons and the
 * thinking dots.
 */

import { PALETTE } from './palette.js';
import {
  TAU,
  OUTLINE,
  PROP_COLORS,
  ICON_MIN_PX,
  CLOUD_FILL,
  CLOUD_EDGE,
  DOT_COLOR,
} from './rig-metrics.js';
import { roundRectFill, _rHx, _rHy, _lHx, _lHy } from './rig-pose.js';

// ------------------------------------------------------------------- props

export function drawCueBehind(ctx, u) {
  const dx = _rHx - _lHx,
    dy = _rHy - _lHy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len,
    uy = dy / len;
  ctx.strokeStyle = PROP_COLORS.cue;
  ctx.lineCap = 'round';
  ctx.lineWidth = u * 0.09;
  ctx.beginPath();
  ctx.moveTo(_rHx, _rHy);
  ctx.lineTo(_rHx + ux * 0.35 * u, _rHy + uy * 0.35 * u);
  ctx.stroke();
}

export function drawCueFront(ctx, u) {
  const dx = _lHx - _rHx,
    dy = _lHy - _rHy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len,
    uy = dy / len;
  ctx.strokeStyle = PROP_COLORS.cue;
  ctx.lineCap = 'round';
  ctx.lineWidth = u * 0.07;
  ctx.beginPath();
  ctx.moveTo(_rHx, _rHy);
  ctx.lineTo(_lHx + ux * 0.9 * u, _lHy + uy * 0.9 * u);
  ctx.stroke();
}

export function drawMug(ctx, x, y, u) {
  const r = u * 0.16;
  ctx.fillStyle = PROP_COLORS.mug;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = PALETTE.inkCool;
  ctx.lineWidth = Math.max(0.5, u * 0.03);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x + r * 1.3, y, r * 0.5, -0.9, 0.9);
  ctx.stroke();
}

export function drawPlate(ctx, x, y, u) {
  const r = u * 0.2;
  ctx.fillStyle = PROP_COLORS.plate;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = PALETTE.inkCool;
  ctx.lineWidth = Math.max(0.4, u * 0.025);
  ctx.beginPath();
  ctx.arc(x, y, r * 0.68, 0, TAU);
  ctx.stroke();
}

export function drawPaddle(ctx, x, y, u) {
  ctx.fillStyle = PROP_COLORS.paddle;
  roundRectFill(ctx, x - u * 0.14, y - u * 0.18, u * 0.28, u * 0.24, u * 0.08);
  ctx.strokeStyle = PALETTE.inkWarm;
  ctx.lineWidth = Math.max(0.5, u * 0.03);
  ctx.beginPath();
  ctx.moveTo(x, y + u * 0.06);
  ctx.lineTo(x, y + u * 0.22);
  ctx.stroke();
}

export function drawController(ctx, x, y, u) {
  ctx.fillStyle = PROP_COLORS.controller;
  roundRectFill(ctx, x - u * 0.32, y - u * 0.12, u * 0.64, u * 0.22, u * 0.08);
}

export function drawPiece(ctx, x, y, u) {
  ctx.fillStyle = PROP_COLORS.piece;
  ctx.beginPath();
  ctx.arc(x, y, u * 0.1, 0, TAU);
  ctx.fill();
}

export function drawPropFront(ctx, prop, u) {
  if (prop === 'mug') drawMug(ctx, _rHx, _rHy, u);
  else if (prop === 'plate') drawPlate(ctx, _rHx, _rHy, u);
  else if (prop === 'paddle') drawPaddle(ctx, _rHx, _rHy, u);
  else if (prop === 'piece') drawPiece(ctx, _rHx, _rHy, u);
  else if (prop === 'controller') drawController(ctx, (_rHx + _lHx) / 2, (_rHy + _lHy) / 2, u);
  else if (prop === 'cue') drawCueFront(ctx, u);
}

// -------------------------------------------------------------------- icons

export function drawHandIcon(ctx, cx, topY, size, color, pulse) {
  const s = size * (0.92 + 0.16 * pulse);
  const w = s * 0.62,
    h = s;
  const baseY = topY + size;
  const left = cx - w / 2;
  const fingerW = w * 0.15,
    gap = w * 0.03;
  ctx.fillStyle = color;
  roundRectFill(ctx, cx - w * 0.32, baseY - h * 0.42, w * 0.64, h * 0.42, w * 0.16);
  for (let i = 0; i < 4; i++) {
    const fx = left + i * (fingerW + gap);
    const fh = h * 0.5 * (1 - Math.abs(i - 1.5) * 0.06);
    roundRectFill(ctx, fx, baseY - h * 0.42 - fh, fingerW, fh, fingerW * 0.4);
  }
  roundRectFill(ctx, left - w * 0.12, baseY - h * 0.28, w * 0.16, h * 0.22, w * 0.08);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(0.6, size * 0.045);
  ctx.strokeRect(cx - w * 0.32, baseY - h * 0.42, w * 0.64, h * 0.42);
}

export function drawHourglassIcon(ctx, cx, topY, size, color) {
  const w = size * 0.68,
    h = size;
  const left = cx - w / 2,
    right = cx + w / 2,
    top = topY,
    bottom = topY + h,
    mid = topY + h / 2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(right, top);
  ctx.lineTo(cx, mid);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.lineTo(cx, mid);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(0.6, size * 0.08);
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(right, top);
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();
}

export function drawCheckIcon(ctx, cx, topY, size, color) {
  const r = size / 2;
  const cy = topY + r;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(0.8, size * 0.14);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(cx - r * 0.45, cy + r * 0.02);
  ctx.lineTo(cx - r * 0.12, cy + r * 0.35);
  ctx.lineTo(cx + r * 0.5, cy - r * 0.35);
  ctx.stroke();
}

/** High-contrast vector icons — no fonts, no emoji. Never under ICON_MIN_PX. */
export function drawIcon(ctx, ox, oy, u, kind, color, ringPhase) {
  const size = Math.max(ICON_MIN_PX, u * 0.9);
  const topY = oy - u * 1.05 - size;
  if (kind === 'hand') {
    const pulse = Math.sin(ringPhase * TAU) * 0.5 + 0.5;
    drawHandIcon(ctx, ox, topY, size, color, pulse);
  } else if (kind === 'hourglass') {
    drawHourglassIcon(ctx, ox, topY, size, color);
  } else if (kind === 'check') {
    drawCheckIcon(ctx, ox, topY, size, color);
  }
}

/** Thought (`think`) / speech (`chat`) dots: rise and fade above the head. */
export function drawDots(ctx, ox, oy, u, opacity) {
  // A thought cloud beside the head, in the comic-strip idiom: two small
  // trailing bubbles leading up to a lobed cloud. Three dots in a row read as
  // "loading" rather than "thinking" — the cloud is what makes it legible as
  // a thought at a glance, which is the whole point of the `working` state
  // having a visible thinking pose at all.
  const prevAlpha = ctx.globalAlpha;
  const cx = ox + u * 0.95;
  const cy = oy - u * 1.5;

  // The trail, rising from beside the head toward the cloud.
  ctx.fillStyle = CLOUD_FILL;
  ctx.strokeStyle = CLOUD_EDGE;
  ctx.lineWidth = Math.max(0.6, u * 0.045);
  const trail = [
    [ox + u * 0.5, oy - u * 0.55, u * 0.1],
    [ox + u * 0.72, oy - u * 0.95, u * 0.14],
  ];
  for (const [tx, ty, tr] of trail) {
    ctx.globalAlpha = opacity * 0.85;
    ctx.beginPath();
    ctx.arc(tx, ty, tr, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }

  // The cloud itself: overlapping lobes filled as one shape, so the seams
  // between them never show.
  ctx.globalAlpha = opacity;
  const lobes = [
    [-0.42, 0.06, 0.3],
    [-0.1, -0.16, 0.38],
    [0.28, 0.0, 0.3],
    [0.02, 0.2, 0.28],
  ];
  ctx.beginPath();
  for (const [lx, ly, lr] of lobes) {
    ctx.moveTo(cx + lx * u + lr * u, cy + ly * u);
    ctx.arc(cx + lx * u, cy + ly * u, lr * u, 0, TAU);
  }
  ctx.fill();
  ctx.stroke();

  // Three beats inside the cloud, so it still reads as active thought.
  ctx.fillStyle = DOT_COLOR;
  for (let i = -1; i <= 1; i++) {
    ctx.globalAlpha = opacity * (i === 0 ? 0.9 : 0.55);
    ctx.beginPath();
    ctx.arc(cx + i * u * 0.22, cy + u * 0.02, u * 0.055, 0, TAU);
    ctx.fill();
  }
  ctx.globalAlpha = prevAlpha;
}
