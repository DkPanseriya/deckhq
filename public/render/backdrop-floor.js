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

import { fadedOut, PALETTE, washedCarpet } from './palette.js';
import {
  roundRect,
  setLightShadow,
  ROOM_SLAB_EDGE_PX,
  ROOM_SLAB_SHADOW_BLUR_PX,
  ROOM_SLAB_SHADOW_DIST_PX,
  WALL_SHADOW_DIST_PX,
} from './backdrop-paint.js';

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

/**
 * Woven carpet, warm grey, fine two-tone noise.
 *
 * `tint` is the identity colour of the project whose room this is, or nothing
 * for the circulation that happens to be carpeted (WP-72). The carpet moves
 * `CARPET_IDENTITY_WASH` — six per cent — of the way toward it and no further:
 * the room agrees with the ring on the agent sitting in it, and the surface is
 * still a carpet. The NOISE is untouched, so the weave stays one material
 * across the whole floor and only its ground shifts.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {() => number} rng
 * @param {string|null} [tint]
 */
export function paintCarpet(ctx, x, y, w, h, rng, tint = null) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  ctx.fillStyle = washedCarpet(PALETTE.carpetBase, tint);
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

// ------------------------------------------------------------- the room slab

/**
 * Cast a room's own shadow onto the floor AROUND it (WP-72).
 *
 * A room is a slab laid on the screed, and this is the shadow its rim throws.
 * It is what a partitioned project room never had: a partition is waist height
 * and correctly casts nothing (VISUAL-SPEC §6), so a row of project rooms was
 * a set of carpets printed on one continuous surface, with a 2.5 px line
 * between them doing all the work of saying they were separate rooms.
 *
 * THE SHADOW IS DRAWN WITHOUT DRAWING THE SHAPE. The room's own carpet must
 * not be darkened — the plate, the names and the "+" are read on it, and
 * `assertThemeContrast` measures the ink against the carpet, not against the
 * carpet under its own shadow. So the context is clipped to everything EXCEPT
 * the room (one even-odd path: the whole bitmap, then the room), the room's
 * rect is filled opaque, and the fill itself is clipped away. What survives is
 * exactly the part of the blur that landed outside.
 *
 * It is called after every floor material is down, so the shadow lands on the
 * neighbour a room shares a partition with as well as on the circulation
 * between bands — which is the case the acceptance criterion names, and the
 * one a room-at-a-time pass would have painted over.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} canvasW @param {number} canvasH the bake, in baked pixels
 */
export function castRoomShadow(ctx, x, y, w, h, canvasW, canvasH) {
  if (w <= 0 || h <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvasW, canvasH);
  ctx.rect(x, y, w, h);
  ctx.clip('evenodd');
  setLightShadow(ctx, {
    blur: ROOM_SLAB_SHADOW_BLUR_PX,
    dist: ROOM_SLAB_SHADOW_DIST_PX,
    color: PALETTE.slabShadow,
  });
  // Opaque, and never seen: the clip above removes every pixel of it. Only
  // `shadowColor` reaches the floor, and only where the blur put it.
  ctx.fillStyle = '#000000';
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.restore();
}

/**
 * The slab's own thickness, seen from directly above (WP-72).
 *
 * A darker band inside the room's two LIGHT-AWAY sides — south and east, since
 * the key light is upper-left. The other two sides already carry
 * `paintRoomAmbientOcclusion`'s wall band, which is a different statement
 * (a wall standing above the floor occludes the light reaching the corner) and
 * a different shape (26 px, very soft), so the four edges together read as a
 * lit slab rather than as a room outlined in dark.
 *
 * The band fades INWARD from the edge rather than sitting as a hard stripe:
 * a stripe on a herringbone floor at fit scale aliases into the plank seams,
 * and the gradient's far stop is `slabEdge` at zero alpha rather than a
 * transparent black, so nothing interpolates through a hue the floor does not
 * have.
 *
 * @param {CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 */
export function paintRoomSlabEdge(ctx, x, y, w, h) {
  const band = Math.min(ROOM_SLAB_EDGE_PX, w / 2, h / 2);
  if (band <= 0) return;
  const near = fadedOut(PALETTE.slabEdge);
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();

  const east = ctx.createLinearGradient(x + w - band, y, x + w, y);
  east.addColorStop(0, near);
  east.addColorStop(1, PALETTE.slabEdge);
  ctx.fillStyle = east;
  ctx.fillRect(x + w - band, y, band, h);

  const south = ctx.createLinearGradient(x, y + h - band, x, y + h);
  south.addColorStop(0, near);
  south.addColorStop(1, PALETTE.slabEdge);
  ctx.fillStyle = south;
  ctx.fillRect(x, y + h - band, w, band);

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
    // The same light as everything else on this floor (WP-72). At 45° this is
    // the (2, 2) the wall already shipped with, plus the horizontal component
    // it was missing.
    setLightShadow(ctx, {
      blur: 7,
      dist: WALL_SHADOW_DIST_PX,
      color: 'rgba(60,52,44,0.28)',
    });
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
