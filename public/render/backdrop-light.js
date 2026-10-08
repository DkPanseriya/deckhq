/**
 * DAYLIGHT ON THE FLOOR — where it comes in, where it lands, and where it does
 * not reach.
 *
 * The floor has one light, travelling down and to the right, so it enters
 * through the building's top and left walls. Four things follow from that and
 * all four are here:
 *
 *   - **the window band**: those two walls are glazed, pane by pane;
 *   - **the patches**: each pane lays a sheared patch of daylight on the floor
 *     of the room behind it, and a room with no window gets a skylight;
 *   - **the falloff**: a room is a little darker away from its windows;
 *   - **the corners**: a soft ramp of shade at the foot of every wall, deeper
 *     under the two walls the light comes over.
 *
 * Every size is in PLAN UNITS (a unit is about 0.30 m), every colour is the
 * resolved look's, and all of it is baked: nothing here runs in a frame. The
 * geometry is pure and exported, so a test can ask where a patch lies without
 * a canvas.
 */

import { fadedOut, PALETTE } from './palette.js';
import { alphaScaled, makeCanvas, roundRect, seededRng } from './backdrop-paint.js';
import { deviceScaleOf, snapPx, snapWidth } from './device-px.js';
import { LOOK } from './look-derive.js';
import {
  AO_ALPHA,
  AO_DEPTH_U,
  AO_LIT_SIDE,
  DAYLIGHT_DIM,
  MULLION_U,
  PANE_U,
  PATCH_FEATHER,
  PATCH_LENGTH_U,
  PATCHES_PER_ROOM,
  PLATE_BOX_U,
  SKYLIGHT_ALPHA,
  SKYLIGHT_OFFSET_U,
  SKYLIGHT_U,
  WINDOW_INSET_U,
} from './look-ambience.js';

const EPS = 1e-6;

// ------------------------------------------------------------- the geometry

/**
 * The stretches of a room's top and left edges that are outside wall, in plan
 * units along the wall. A room behind another room has none.
 *
 * @param {{x:number,y:number,w:number,h:number}} room
 * @param {ReadonlyArray<{x1:number,y1:number,x2:number,y2:number,kind:string}>} walls
 * @returns {{top:Array<[number,number]>, left:Array<[number,number]>}}
 */
export function litRuns(room, walls) {
  /** @type {Array<[number,number]>} */
  const top = [];
  /** @type {Array<[number,number]>} */
  const left = [];
  for (const wall of walls || []) {
    if (wall.kind !== 'exterior') continue;
    if (Math.abs(wall.y1 - wall.y2) < EPS && Math.abs(wall.y1 - room.y) < EPS) {
      const a = Math.max(room.x, Math.min(wall.x1, wall.x2));
      const b = Math.min(room.x + room.w, Math.max(wall.x1, wall.x2));
      if (b - a > EPS) top.push([a, b]);
    } else if (Math.abs(wall.x1 - wall.x2) < EPS && Math.abs(wall.x1 - room.x) < EPS) {
      const a = Math.max(room.y, Math.min(wall.y1, wall.y2));
      const b = Math.min(room.y + room.h, Math.max(wall.y1, wall.y2));
      if (b - a > EPS) left.push([a, b]);
    }
  }
  return { top, left };
}

/**
 * The panes along one run of wall: `PANE_U` wide between `MULLION_U` mullions,
 * centred, and stopping `WINDOW_INSET_U` short of both ends — a corner or the
 * junction with a partition.
 *
 * @param {number} a @param {number} b the run, in plan units along the wall
 * @returns {Array<[number,number]>}
 */
export function panesAlong(a, b) {
  const usable = b - a - 2 * WINDOW_INSET_U;
  const pitch = PANE_U + MULLION_U;
  const count = Math.floor((usable + MULLION_U) / pitch + EPS);
  if (count < 1) return [];
  const start = a + WINDOW_INSET_U + (usable - (count * pitch - MULLION_U)) / 2;
  /** @type {Array<[number,number]>} */
  const out = [];
  for (let i = 0; i < count; i++) out.push([start + i * pitch, start + i * pitch + PANE_U]);
  return out;
}

/**
 * A room's windows: every pane on its lit edges.
 * @param {{x:number,y:number,w:number,h:number}} room
 * @param {ReadonlyArray<any>} walls
 * @returns {{top:Array<[number,number]>, left:Array<[number,number]>}}
 */
export function windowsOf(room, walls) {
  const runs = litRuns(room, walls);
  return {
    top: runs.top.flatMap(([a, b]) => panesAlong(a, b)),
    left: runs.left.flatMap(([a, b]) => panesAlong(a, b)),
  };
}

/** @param {number[][]} poly */
function boxOf(poly) {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/**
 * THE PATCHES OF DAYLIGHT IN ONE ROOM, as parallelograms in plan units.
 *
 * Each is as wide as its pane and sheared along the light, `PATCH_LENGTH_U`
 * times the mood's cast long. `axis` says which way the far edge fades. At most
 * `PATCHES_PER_ROOM`, spread across the room, and none over the corner the
 * room's plate is read in.
 *
 * @param {{x:number,y:number,w:number,h:number}} room
 * @param {{top:Array<[number,number]>, left:Array<[number,number]>}} windows
 * @param {{dir:{x:number,y:number}, cast:number}} light
 * @returns {Array<{poly:number[][], axis:'x'|'y'}>}
 */
export function daylightPatches(room, windows, light) {
  const reach = PATCH_LENGTH_U * light.cast;
  const dx = light.dir.x * reach;
  const dy = light.dir.y * reach;
  /** @type {Array<{poly:number[][], axis:'x'|'y'}>} */
  const all = [];
  for (const [a, b] of windows.top) {
    all.push({
      axis: 'y',
      poly: [
        [a, room.y],
        [b, room.y],
        [b + dx, room.y + dy],
        [a + dx, room.y + dy],
      ],
    });
  }
  for (const [a, b] of windows.left) {
    all.push({
      axis: 'x',
      poly: [
        [room.x, a],
        [room.x, b],
        [room.x + dx, b + dy],
        [room.x + dx, a + dy],
      ],
    });
  }
  const plate = {
    x0: room.x,
    y0: room.y,
    x1: room.x + PLATE_BOX_U.w,
    y1: room.y + PLATE_BOX_U.h,
  };
  const clear = all.filter(({ poly }) => {
    const box = boxOf(poly);
    return box.x0 >= plate.x1 - EPS || box.y0 >= plate.y1 - EPS;
  });
  if (clear.length <= PATCHES_PER_ROOM) return clear;
  /** @type {typeof clear} */
  const out = [];
  for (let i = 0; i < PATCHES_PER_ROOM; i++) {
    out.push(clear[Math.round((i * (clear.length - 1)) / (PATCHES_PER_ROOM - 1))]);
  }
  return out;
}

/**
 * The skylight of a room no window reaches: one rounded patch, set off from the
 * room's centre toward the light, kept inside the room and off the plate.
 *
 * @param {{x:number,y:number,w:number,h:number}} room
 * @returns {{x:number,y:number,w:number,h:number}|null}
 */
export function skylightOf(room) {
  const w = Math.min(SKYLIGHT_U.w, room.w - 2);
  const h = Math.min(SKYLIGHT_U.h, room.h - PLATE_BOX_U.h - 1.5);
  if (w < SKYLIGHT_U.w / 2 || h < SKYLIGHT_U.h / 2) return null;
  const clamp = (/** @type {number} */ v, /** @type {number} */ lo, /** @type {number} */ hi) =>
    Math.max(lo, Math.min(hi, v));
  const x = clamp(
    room.x + room.w / 2 - SKYLIGHT_OFFSET_U - w / 2,
    room.x + 1,
    room.x + room.w - 1 - w,
  );
  const y = clamp(
    room.y + room.h / 2 - SKYLIGHT_OFFSET_U - h / 2,
    room.y + PLATE_BOX_U.h + 0.5,
    room.y + room.h - 1 - h,
  );
  return { x, y, w, h };
}

// ---------------------------------------------------------------- the grain

/** @type {Map<number, any>} */
const TILES = new Map();

/**
 * One 64 × 64 tile of seeded noise, each pixel white or black at up to `amp`
 * steps of alpha out of 255. The same tile on every machine and every bake.
 * @param {number} amp
 */
function noiseTile(amp) {
  if (TILES.has(amp)) return TILES.get(amp);
  let tile = null;
  if (typeof OffscreenCanvas !== 'undefined' || typeof document !== 'undefined') {
    const canvas = /** @type {any} */ (makeCanvas(64, 64));
    const c = canvas && typeof canvas.getContext === 'function' ? canvas.getContext('2d') : null;
    if (c && typeof c.createImageData === 'function') {
      const img = c.createImageData(64, 64);
      const rng = seededRng(`grain:${amp}`);
      for (let i = 0; i < 64 * 64; i++) {
        const v = Math.round((rng() * 2 - 1) * amp);
        const o = i * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = v > 0 ? 255 : 0;
        img.data[o + 3] = Math.abs(v);
      }
      c.putImageData(img, 0, 0);
      tile = canvas;
    }
  }
  TILES.set(amp, tile);
  return tile;
}

/**
 * LAY A GRAIN OVER A RECTANGLE: seeded noise, one device pixel to a grain.
 *
 * At one step it is a dither — it breaks a long, shallow gradient before the
 * eye can find its steps. At three it is a felt. Aperiodic at any scale, which
 * is the point: a pattern with no pitch cannot beat against the pixel grid.
 * A context that cannot make a pattern is left as it is.
 *
 * @param {any} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} [amp] steps of alpha out of 255
 */
export function paintGrain(ctx, x, y, w, h, amp = 1) {
  if (!ctx || typeof ctx.createPattern !== 'function') return;
  const tile = noiseTile(amp);
  if (!tile) return;
  const pattern = ctx.createPattern(tile, 'repeat');
  if (!pattern) return;
  const k = deviceScaleOf(ctx);
  if (k !== 1 && typeof pattern.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
    pattern.setTransform(new DOMMatrix().scale(1 / k));
  }
  ctx.save();
  ctx.fillStyle = pattern;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

// --------------------------------------------------------------- the paint

/**
 * Any palette colour at an alpha of its own.
 * @param {string} colour @param {number} alpha
 */
function at(colour, alpha) {
  return fadedOut(colour).replace(/,0\)$/, `,${alpha})`);
}

/**
 * Shade at the foot of a room's four walls.
 *
 * Four ramps, `AO_DEPTH_U` deep, from `AO_ALPHA` at the wall to nothing. The
 * two under the walls the light comes over — top and left — are `AO_LIT_SIDE`
 * times deeper, and where two ramps cross the corner is darker without anybody
 * drawing a corner.
 *
 * @param {any} ctx
 * @param {number} x @param {number} y @param {number} w @param {number} h
 * @param {number} u px per plan unit
 */
export function paintRoomAmbientOcclusion(ctx, x, y, w, h, u) {
  const near = at(PALETTE.shadowContact, AO_ALPHA);
  const far = fadedOut(PALETTE.shadowContact);
  const shallow = Math.min(AO_DEPTH_U * u, w / 2, h / 2);
  const deep = Math.min(AO_DEPTH_U * AO_LIT_SIDE * u, w / 2, h / 2);
  if (!(shallow > 0)) return;
  /** @param {number} x0 @param {number} y0 @param {number} x1 @param {number} y1 */
  const ramp = (x0, y0, x1, y1) => {
    const g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, near);
    g.addColorStop(1, far);
    ctx.fillStyle = g;
  };
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ramp(x, y, x, y + deep);
  ctx.fillRect(x, y, w, deep);
  ramp(x, y, x + deep, y);
  ctx.fillRect(x, y, deep, h);
  ramp(x, y + h, x, y + h - shallow);
  ctx.fillRect(x, y + h - shallow, w, shallow);
  ramp(x + w, y, x + w - shallow, y);
  ctx.fillRect(x + w - shallow, y, shallow, h);
  ctx.restore();
}

/**
 * ONE ROOM'S DAYLIGHT: the falloff, then the patches or the skylight, then the
 * shade at the walls, then a dither over the lot.
 *
 * A room with the lights off keeps its daylight at `DAYLIGHT_DIM` — the sun
 * does not switch off.
 *
 * @param {any} ctx
 * @param {{x:number,y:number,w:number,h:number,dim?:boolean}} room
 * @param {{rx:number,ry:number,rw:number,rh:number}} rect the room on the device grid, in px
 * @param {ReadonlyArray<any>} walls
 * @param {number} u px per plan unit
 */
export function paintRoomLight(ctx, room, rect, walls, u) {
  const { rx, ry, rw, rh } = rect;
  if (!(rw > 0) || !(rh > 0)) return;
  const light = LOOK.light;
  const k = room.dim ? DAYLIGHT_DIM : 1;
  const windows = windowsOf(room, walls);
  const patches = daylightPatches(room, windows, light);
  const sky = patches.length ? null : skylightOf(room);
  const runs = litRuns(room, walls);
  const fromTop = runs.top.length > 0;
  const fromLeft = runs.left.length > 0;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.clip();

  // The falloff: nothing at the windows, `light.falloff` at the far side.
  const shade = k === 1 ? light.falloff : alphaScaled(light.falloff, k);
  let g;
  if (fromTop || fromLeft) {
    g = ctx.createLinearGradient(rx, ry, fromLeft ? rx + rw : rx, fromTop ? ry + rh : ry);
  } else {
    const cx = sky ? (sky.x + sky.w / 2) * u : rx + rw / 2;
    const cy = sky ? (sky.y + sky.h / 2) * u : ry + rh / 2;
    const far = Math.max(
      Math.hypot(cx - rx, cy - ry),
      Math.hypot(rx + rw - cx, cy - ry),
      Math.hypot(cx - rx, ry + rh - cy),
      Math.hypot(rx + rw - cx, ry + rh - cy),
    );
    g = ctx.createRadialGradient(cx, cy, 0, cx, cy, far);
  }
  g.addColorStop(0, fadedOut(shade));
  g.addColorStop(1, shade);
  ctx.fillStyle = g;
  ctx.fillRect(rx, ry, rw, rh);

  // The patches. Full for the near part, feathered to nothing over the rest.
  const day = k === 1 ? light.layer : alphaScaled(light.layer, k);
  for (const { poly, axis } of patches) {
    const box = boxOf(poly);
    const pg =
      axis === 'y'
        ? ctx.createLinearGradient(0, box.y0 * u, 0, box.y1 * u)
        : ctx.createLinearGradient(box.x0 * u, 0, box.x1 * u, 0);
    pg.addColorStop(0, day);
    pg.addColorStop(1 - PATCH_FEATHER, day);
    pg.addColorStop(1, fadedOut(day));
    ctx.fillStyle = pg;
    ctx.beginPath();
    poly.forEach(([px, py], i) => (i ? ctx.lineTo(px * u, py * u) : ctx.moveTo(px * u, py * u)));
    ctx.closePath();
    ctx.fill();
  }
  if (sky) {
    // Three nested sheets, each a third of the light: a soft edge without a
    // blur, and no step big enough to see.
    const third = alphaScaled(day, SKYLIGHT_ALPHA / 3);
    ctx.fillStyle = third;
    for (let i = 0; i < 3; i++) {
      const inset = i * 0.35 * u;
      roundRect(
        ctx,
        sky.x * u + inset,
        sky.y * u + inset,
        sky.w * u - 2 * inset,
        sky.h * u - 2 * inset,
        0.9 * u - inset / 2,
      );
      ctx.fill();
    }
  }
  ctx.restore();

  paintRoomAmbientOcclusion(ctx, rx, ry, rw, rh, u);
  paintGrain(ctx, rx, ry, rw, rh, 1);
}

/**
 * THE WINDOW BAND: glazing in the thickness of the outside wall, on every lit
 * edge of one room. Painted over the wall, pane by pane — a sheet of glass in
 * a thin dark frame.
 *
 * @param {any} ctx
 * @param {{x:number,y:number,w:number,h:number}} room
 * @param {ReadonlyArray<any>} walls
 * @param {number} u px per plan unit
 * @param {number} thickness the outside wall's thickness, in px
 */
export function paintWindowBand(ctx, room, walls, u, thickness) {
  const windows = windowsOf(room, walls);
  if (!windows.top.length && !windows.left.length) return;
  const glass = LOOK.partitions;
  const line = snapWidth(ctx, 0.75);
  const t = snapWidth(ctx, thickness);
  ctx.save();
  /** @param {number} px @param {number} py @param {number} pw @param {number} ph */
  const pane = (px, py, pw, ph) => {
    ctx.fillStyle = glass.glassFrame;
    ctx.fillRect(px, py, pw, ph);
    if (pw > 2 * line && ph > 2 * line) {
      ctx.fillStyle = glass.glassPane;
      ctx.fillRect(px + line, py + line, pw - 2 * line, ph - 2 * line);
    }
  };
  for (const [a, b] of windows.top) {
    const from = snapPx(ctx, a * u);
    pane(from, snapPx(ctx, room.y * u - t / 2), snapPx(ctx, b * u) - from, t);
  }
  for (const [a, b] of windows.left) {
    const from = snapPx(ctx, a * u);
    pane(snapPx(ctx, room.x * u - t / 2), from, t, snapPx(ctx, b * u) - from);
  }
  ctx.restore();
}
