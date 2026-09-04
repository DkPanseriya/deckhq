/**
 * What the floor and its walls are made of (WP-22 follow-up).
 *
 * Split out of `backdrop.js` unchanged: the three floor materials, the
 * circulation lane, the ambient occlusion that seats a room on the floor, and
 * the wall and door-swing painters.
 *
 * All of it is baked once per plan change and blitted per frame — nothing
 * here runs in the frame loop (docs/02-ARCHITECTURE.md §8).
 */

import { PALETTE } from './palette.js';
import { roundRect } from './backdrop-paint.js';

// ------------------------------------------------------------- materials

/** 46 px herringbone lattice, four tone variations, 1.6 px seams. */
export function paintHerringbone(ctx, x, y, w, h, rng) {
  const CELL = 46;
  const L = CELL * 1.42;
  const W = CELL * 0.48;
  const tones = [
    PALETTE.woodHerringboneA,
    PALETTE.woodHerringboneB,
    PALETTE.woodHerringboneC,
    PALETTE.woodHerringboneD,
  ];
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  ctx.fillStyle = PALETTE.woodHerringboneB;
  ctx.fillRect(x, y, w, h);

  const cols = Math.ceil(w / CELL) + 3;
  const rows = Math.ceil(h / CELL) + 3;
  for (let j = -2; j < rows; j++) {
    for (let i = -2; i < cols; i++) {
      const dir = (i + j) % 2 === 0 ? 1 : -1;
      const toneIdx = Math.floor(rng() * tones.length);
      ctx.save();
      ctx.translate(x + i * CELL, y + j * CELL);
      ctx.rotate((dir * 45 * Math.PI) / 180);
      ctx.fillStyle = tones[toneIdx];
      ctx.fillRect(0, 0, L, W);
      ctx.strokeStyle = PALETTE.woodHerringboneSeam;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(0, 0, L, W);
      ctx.fillStyle = PALETTE.woodHerringboneSheen;
      ctx.fillRect(0, 0, L, W * 0.32);
      ctx.restore();
    }
  }
  ctx.restore();
}

/** Woven carpet, warm grey, fine two-tone noise. */
export function paintCarpet(ctx, x, y, w, h, rng) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  ctx.fillStyle = PALETTE.carpetBase;
  ctx.fillRect(x, y, w, h);
  const dots = Math.min(6000, Math.round(w * h * 0.6));
  for (let i = 0; i < dots; i++) {
    ctx.fillStyle = rng() > 0.5 ? PALETTE.carpetNoiseLight : PALETTE.carpetNoiseDark;
    ctx.fillRect(x + rng() * w, y + rng() * h, 1, 1);
  }
  ctx.restore();
}

/** Square tile with grout lines. */
export function paintTile(ctx, x, y, w, h) {
  // Grout is a hairline, not a rule. At full contrast on a 24px pitch the grid
  // outweighed everything standing on it and the room read as graph paper.
  const CELL = 30;
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  ctx.fillStyle = PALETTE.tileBase;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = PALETTE.tileGrout;
  ctx.lineWidth = 0.75;
  for (let gy = y; gy <= y + h + CELL; gy += CELL) {
    ctx.beginPath();
    ctx.moveTo(x, gy + 0.5);
    ctx.lineTo(x + w, gy + 0.5);
    ctx.stroke();
  }
  for (let gx = x; gx <= x + w + CELL; gx += CELL) {
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, y);
    ctx.lineTo(gx + 0.5, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Circulation floor: the corridors and the spine.
 *
 * Poured, seamless and almost featureless on purpose. Corridors are now most
 * of the space between rooms, and painting them as 24px tile drew a hard grid
 * over a third of the building — the plan read as graph paper rather than as a
 * floor. A long, very soft sheen down the length of the run is enough to say
 * "polished surface" without competing with anything in a room.
 */
export function paintCirculation(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = PALETTE.circulationBase;
  ctx.fillRect(x, y, w, h);
  const along = w >= h;
  const g = along
    ? ctx.createLinearGradient(x, y, x, y + h)
    : ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, PALETTE.circulationSheen);
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.03)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Wall drop shadow + ambient-occlusion band where wall meets floor, inset from a room's edges. */
export function paintRoomAmbientOcclusion(ctx, x, y, w, h) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  const bandH = 26;
  const top = ctx.createLinearGradient(x, y, x, y + bandH);
  top.addColorStop(0, PALETTE.wallAmbientOcclusion);
  top.addColorStop(1, 'rgba(70,58,42,0)');
  ctx.fillStyle = top;
  ctx.fillRect(x, y, w, bandH);
  const left = ctx.createLinearGradient(x, y, x + bandH, y);
  left.addColorStop(0, PALETTE.wallAmbientOcclusion);
  left.addColorStop(1, 'rgba(70,58,42,0)');
  ctx.fillStyle = left;
  ctx.fillRect(x, y, bandH, h);
  ctx.restore();
}

// -------------------------------------------------------------- walls/doors

/**
 * Paint one wall segment.
 *
 * Walls belong to the floor, not to a room, so this draws a segment rather
 * than a room outline: an exterior wall is thick and casts a shadow inward, a
 * solid interior wall (the user's office) is the same but thinner, and a
 * partition is waist height — a subordinate line that divides the open plan
 * without closing it off.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
   `bakeBackdrop` paints into whichever of the two the browser gave it, and
   has done since it was written; the parameter only named one (WP-22).
 * @param {{x1:number,y1:number,x2:number,y2:number,kind:string,door?:{at:number,width:number}}} wall
 * @param {number} u
 */
export function paintWallSegment(ctx, wall, u) {
  const x1 = wall.x1 * u;
  const y1 = wall.y1 * u;
  const x2 = wall.x2 * u;
  const y2 = wall.y2 * u;
  const horizontal = Math.abs(y2 - y1) < 0.5;

  const thickness = wall.kind === 'exterior' ? 6 : wall.kind === 'solid' ? 5 : 2.5;
  const half = thickness / 2;

  ctx.save();
  if (wall.kind === 'partition') {
    // Waist height: no shadow, and a softer fill, so it stays visually
    // subordinate to the real walls (VISUAL-SPEC section 6).
    ctx.fillStyle = PALETTE.partitionFill;
    ctx.strokeStyle = PALETTE.partitionEdge;
  } else {
    ctx.fillStyle = PALETTE.wallFill;
    ctx.strokeStyle = PALETTE.wallEdge;
    ctx.shadowColor = 'rgba(60,52,44,0.28)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 2;
  }

  /** @param {number} a @param {number} b */
  const span = (a, b) => {
    if (horizontal) ctx.fillRect(a, y1 - half, b - a, thickness);
    else ctx.fillRect(x1 - half, a, thickness, b - a);
  };

  const start = horizontal ? x1 : y1;
  const end = horizontal ? x2 : y2;
  if (wall.door) {
    const at = start + wall.door.at * u;
    const w = wall.door.width * u;
    span(start, Math.max(start, at - w / 2));
    span(Math.min(end, at + w / 2), end);
  } else {
    span(start, end);
  }
  ctx.restore();

  // A hairline on the wall face reads as the plaster edge and keeps the line
  // crisp once the whole floor is scaled down to fit the window.
  ctx.save();
  ctx.strokeStyle = wall.kind === 'partition' ? PALETTE.partitionEdge : PALETTE.wallEdge;
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  if (horizontal) {
    ctx.moveTo(x1, y1 - half);
    ctx.lineTo(x2, y1 - half);
    ctx.moveTo(x1, y1 + half);
    ctx.lineTo(x2, y1 + half);
  } else {
    ctx.moveTo(x1 - half, y1);
    ctx.lineTo(x1 - half, y2);
    ctx.moveTo(x1 + half, y1);
    ctx.lineTo(x1 + half, y2);
  }
  ctx.stroke();
  ctx.restore();
}

/** Gap in the wall plus a quarter-circle swing arc — reads instantly as a door. */
export function paintDoorSwing(ctx, door, u) {
  const cx = door.x * u;
  const cy = door.y * u;
  const r = door.width * u;
  ctx.save();
  ctx.strokeStyle = PALETTE.doorSwingArc;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(cx, cy - r / 2, r, door.angle, door.angle + Math.PI / 2);
  ctx.stroke();
  ctx.restore();
}
