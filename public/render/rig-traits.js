/**
 * What makes one agent look like itself (WP-22 follow-up).
 *
 * Split out of `rig.js` unchanged: the glasses, WP-30's rarity trait, the
 * glow behind a rare one, the glyph over its head, the identity marks, and
 * the manager's suit accents.
 *
 * These are the only things about a character that are not shared with every
 * other character on the floor. Everything else — skin, hair, prop materials
 * — is constant by design (docs/03-VISUAL-SPEC.md §3).
 */

import { PALETTE } from './palette.js';
import {
  TAU,
  HEAD_R,
  HEAD_OFFSET_Y,
  SHOULDER_OFFSET_Y,
  TORSO_RX,
  COLLAR_OFFSET_Y,
  GLYPH_OFFSET_X,
  GLYPH_OFFSET_Y,
  MANAGER_SHIRT,
  MANAGER_TIE,
} from './rig-metrics.js';
import { SIDES, _rx, _ry, rotateLocal } from './rig-pose.js';

/**
 * Glasses: two lens rings on the forward face of the head. The head carries no
 * features at all, so these are the only thing on it that says which way it is
 * looking — which is why they are drawn forward of centre rather than centred.
 *
 * L2 only. At L1 a lens is under a pixel across and becomes a smudge on the
 * face, which reads as dirt rather than as a person who wears glasses.
 */
export function drawGlasses(ctx, ox, oy, cosA, sinA, u, facingRot) {
  rotateLocal(0, HEAD_OFFSET_Y, cosA, sinA);
  const hx = ox + _rx * u,
    hy = oy + _ry * u;
  const r = HEAD_R * u;
  const fx = -Math.cos(facingRot + Math.PI / 2),
    fy = -Math.sin(facingRot + Math.PI / 2);
  const sx = -fy,
    sy = fx;
  const cx = hx + fx * r * 0.34,
    cy = hy + fy * r * 0.34;
  const lensR = r * 0.23;
  const gap = r * 0.32;
  ctx.strokeStyle = PALETTE.inkCool;
  ctx.lineWidth = Math.max(0.6, u * 0.045);
  ctx.beginPath();
  ctx.arc(cx + sx * gap, cy + sy * gap, lensR, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx - sx * gap, cy - sy * gap, lensR, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx + sx * (gap - lensR), cy + sy * (gap - lensR));
  ctx.lineTo(cx - sx * (gap - lensR), cy - sy * (gap - lensR));
  ctx.stroke();
}

/**
 * The rarity traits (WP-20; docs/plan/08 §7). One per agent, drawn after the
 * hair so nothing occludes it, and every one of them off the torso: the state
 * colour keeps its area and the state icon keeps the slot above the head.
 *
 * `glow` is the exception to "after the hair" — it goes behind the body, and
 * `drawCharacter` calls it separately, early.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ox @param {number} oy @param {number} cosA @param {number} sinA
 * @param {number} u @param {number} facingRot @param {number} build
 * @param {string} trait @param {string} colour
 */
export function drawRarityTrait(ctx, ox, oy, cosA, sinA, u, facingRot, build, trait, colour) {
  rotateLocal(0, HEAD_OFFSET_Y, cosA, sinA);
  const hx = ox + _rx * u,
    hy = oy + _ry * u;
  const r = HEAD_R * u;
  const backAngle = facingRot + Math.PI / 2;
  const bx = Math.cos(backAngle),
    by = Math.sin(backAngle);
  const sx = -by,
    sy = bx;
  // On a plan view the crown of the head is its far side from the body, which
  // is the direction the character faces — the exact opposite of `backAngle`,
  // the direction the hair cap is drawn in.
  const ux = -bx,
    uy = -by;

  switch (trait) {
    case 'hat': {
      // A cap seen from above: a brim, a darker crown inside it, and a rim
      // line so it reads as an object on the head rather than as a coloured
      // disc where a head used to be — which is what the first pass, an
      // unlined ellipse a fifth wider than the skull, actually looked like.
      // It is set back so the brow still shows in front of it.
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.ellipse(hx + bx * r * 0.14, hy + by * r * 0.14, r * 1.0, r * 0.9, backAngle, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = PALETTE.inkWarm;
      ctx.lineWidth = Math.max(0.6, u * 0.035);
      ctx.stroke();
      ctx.fillStyle = PALETTE.inkWarm;
      ctx.globalAlpha = 0.26;
      ctx.beginPath();
      ctx.ellipse(hx + bx * r * 0.05, hy + by * r * 0.05, r * 0.58, r * 0.5, backAngle, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      break;
    }
    case 'scarf': {
      // A band around the neck plus one short tail trailing off a shoulder.
      rotateLocal(0, COLLAR_OFFSET_Y, cosA, sinA);
      const nx = ox + _rx * u,
        ny = oy + _ry * u;
      ctx.strokeStyle = colour;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, u * 0.16);
      ctx.beginPath();
      ctx.moveTo(nx - sx * r * 0.7, ny - sy * r * 0.7);
      ctx.lineTo(nx + sx * r * 0.7, ny + sy * r * 0.7);
      ctx.stroke();
      ctx.lineWidth = Math.max(0.8, u * 0.11);
      ctx.beginPath();
      ctx.moveTo(nx + sx * r * 0.6, ny + sy * r * 0.6);
      ctx.lineTo(nx + sx * r * 0.86 + bx * r * 0.9, ny + sy * r * 0.86 + by * r * 0.9);
      ctx.stroke();
      break;
    }
    case 'jacket': {
      // A yoke across the shoulders and two lapels: tailoring drawn as an
      // edge, so the torso's fill — the state — is untouched underneath.
      const halfW = TORSO_RX * build * 0.9;
      rotateLocal(-halfW, SHOULDER_OFFSET_Y + 0.06, cosA, sinA);
      const ax = ox + _rx * u,
        ay = oy + _ry * u;
      rotateLocal(halfW, SHOULDER_OFFSET_Y + 0.06, cosA, sinA);
      const bx2 = ox + _rx * u,
        by2 = oy + _ry * u;
      ctx.strokeStyle = colour;
      ctx.lineCap = 'round';
      ctx.lineWidth = Math.max(1, u * 0.17);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx2, by2);
      ctx.stroke();
      rotateLocal(0, COLLAR_OFFSET_Y + 0.1, cosA, sinA);
      const cx = ox + _rx * u,
        cy = oy + _ry * u;
      ctx.lineWidth = Math.max(0.8, u * 0.1);
      for (const side of SIDES) {
        ctx.beginPath();
        ctx.moveTo(cx + sx * side * r * 0.18, cy + sy * side * r * 0.18);
        ctx.lineTo(
          cx + sx * side * r * 0.72 + bx * r * 0.7,
          cy + sy * side * r * 0.72 + by * r * 0.7,
        );
        ctx.stroke();
      }
      break;
    }
    case 'crown': {
      // Three points on a band, sitting on the crown of the head — outside the
      // head circle so it is a silhouette, not a decal.
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(hx + ux * r * 1.0 - sx * r * 0.72, hy + uy * r * 1.0 - sy * r * 0.72);
      ctx.lineTo(hx + ux * r * 1.0 + sx * r * 0.72, hy + uy * r * 1.0 + sy * r * 0.72);
      ctx.lineTo(hx + ux * r * 1.62 + sx * r * 0.5, hy + uy * r * 1.62 + sy * r * 0.5);
      ctx.lineTo(hx + ux * r * 1.22 + sx * r * 0.24, hy + uy * r * 1.22 + sy * r * 0.24);
      ctx.lineTo(hx + ux * r * 1.7, hy + uy * r * 1.7);
      ctx.lineTo(hx + ux * r * 1.22 - sx * r * 0.24, hy + uy * r * 1.22 - sy * r * 0.24);
      ctx.lineTo(hx + ux * r * 1.62 - sx * r * 0.5, hy + uy * r * 1.62 - sy * r * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    }
    default:
      break;
  }
}

/**
 * The legendary `glow`: a soft aura behind the whole figure.
 *
 * Deliberately STATIC and deliberately not a floor ring. The two rings this
 * rig already draws on the floor mean specific things — a pulsing one is a
 * raised hand, a still one is the current selection — and a third would
 * dilute both. An aura sits behind the body instead, reads at a glance, and
 * says nothing about state.
 */
export function drawGlow(ctx, ox, oy, u, colour) {
  const prevAlpha = ctx.globalAlpha;
  ctx.fillStyle = colour;
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.ellipse(ox, oy - 0.3 * u, 1.25 * u, 1.5 * u, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  ctx.ellipse(ox, oy - 0.3 * u, 0.95 * u, 1.15 * u, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = prevAlpha;
}

// -------------------------------------------------------- identity + suit

/**
 * One small vector glyph from CONTRACTS-WP15.md §2's `AVATAR_GLYPHS`
 * vocabulary (`palette.js`). No fonts, no emoji — pure vector paths, drawn
 * small enough to read as a mark rather than an icon. Falls back to the
 * 'hex' shape for any unrecognised name (defensive, per this codebase's
 * "better a plain box than a missing desk" convention in backdrop.js).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} r
 * @param {string} kind @param {string} color
 */
export function drawGlyph(ctx, x, y, r, kind, color) {
  ctx.fillStyle = color;
  switch (kind) {
    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.87, y + r * 0.5);
      ctx.lineTo(x - r * 0.87, y + r * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    case 'square':
      ctx.fillRect(x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5);
      break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
      break;
    case 'drop':
      ctx.beginPath();
      ctx.arc(x, y + r * 0.2, r * 0.7, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.55, y - r * 0.05);
      ctx.lineTo(x - r * 0.55, y - r * 0.05);
      ctx.closePath();
      ctx.fill();
      break;
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const outerA = -Math.PI / 2 + (i * TAU) / 5;
        const innerA = outerA + TAU / 10;
        const px = x + Math.cos(outerA) * r,
          py = y + Math.sin(outerA) * r;
        const ix = x + Math.cos(innerA) * r * 0.45,
          iy = y + Math.sin(innerA) * r * 0.45;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        ctx.lineTo(ix, iy);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'cross': {
      const t = r * 0.42;
      ctx.fillRect(x - t / 2, y - r, t, r * 2);
      ctx.fillRect(x - r, y - t / 2, r * 2, t);
      break;
    }
    case 'ring':
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(0.6, r * 0.32);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.68, 0, TAU);
      ctx.stroke();
      break;
    case 'hex':
    default:
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6 - Math.PI / 6;
        const px = x + Math.cos(a) * r,
          py = y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
  }
}

/**
 * Project identity marks (CONTRACTS-WP15.md §2): a small clothing accent at
 * the collar, and the avatar glyph on the shoulder/back. Both use
 * `identity.accent` — one accent colour in two places reads as one
 * identity, not two unrelated decorations. Drawn last among the body parts
 * (after hair, in `drawCharacter`) so nothing painted afterward occludes
 * them; gated on `lod >= 1` by the caller, same as hair itself.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ox @param {number} oy @param {number} cosA @param {number} sinA @param {number} u
 * @param {{hair:string, accent:string, glyph:string}} identity
 */
export function drawIdentityMarks(ctx, ox, oy, cosA, sinA, u, identity) {
  rotateLocal(0, COLLAR_OFFSET_Y, cosA, sinA);
  const cx = ox + _rx * u,
    cy = oy + _ry * u;
  ctx.fillStyle = identity.accent;
  ctx.beginPath();
  ctx.arc(cx, cy, u * 0.13, 0, TAU);
  ctx.fill();

  rotateLocal(GLYPH_OFFSET_X, GLYPH_OFFSET_Y, cosA, sinA);
  const gx = ox + _rx * u,
    gy = oy + _ry * u;
  drawGlyph(ctx, gx, gy, u * 0.22, identity.glyph, identity.accent);
}

/**
 * The manager's collar + tie — the detail that reads "suit", not just "dark
 * shirt". Manager-only; agents never call this (their "small clothing
 * accent" is `drawIdentityMarks`'s collar dot instead).
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} ox @param {number} oy @param {number} cosA @param {number} sinA @param {number} u
 */
export function drawSuitAccents(ctx, ox, oy, cosA, sinA, u) {
  rotateLocal(0, COLLAR_OFFSET_Y, cosA, sinA);
  const nx = ox + _rx * u,
    ny = oy + _ry * u;
  const s = u * 0.32;
  ctx.fillStyle = MANAGER_SHIRT;
  ctx.beginPath();
  ctx.moveTo(nx, ny);
  ctx.lineTo(nx - s * 0.55, ny - s * 0.15);
  ctx.lineTo(nx, ny + s * 0.9);
  ctx.lineTo(nx + s * 0.55, ny - s * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = MANAGER_TIE;
  ctx.beginPath();
  ctx.moveTo(nx - s * 0.13, ny);
  ctx.lineTo(nx + s * 0.13, ny);
  ctx.lineTo(nx + s * 0.08, ny + s * 1.3);
  ctx.lineTo(nx, ny + s * 1.55);
  ctx.lineTo(nx - s * 0.08, ny + s * 1.3);
  ctx.closePath();
  ctx.fill();
}
