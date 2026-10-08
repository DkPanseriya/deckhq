/**
 * DeckHQ baked backdrop — floors, walls, doors and furniture, painted once
 * per plan change to an offscreen bitmap. Nothing here runs per frame; the
 * scene blits the result and draws only the (animated) characters on top.
 * docs/03-VISUAL-SPEC.md §6, docs/02-ARCHITECTURE.md §8 (< 400 ms rebake,
 * animation is characters only).
 *
 * Canvas APIs are used only inside `bakeBackdrop` — this module has no DOM
 * access at module scope, so importing it is safe even where OffscreenCanvas
 * does not exist (e.g. under a plain Node test runner), as long as the
 * function itself is never called there.
 *
 * ============================================================================
 * WP-22 follow-up · this file is the bake itself, plus `paintProp`'s frame:
 * the clip to a prop's own footprint, the facing, and the cast and contact
 * every piece makes with the floor. What each KIND looks like is its modules:
 *
 *   backdrop-paint.js         the primitives — seeded RNG, rounded rect, the
 *                             light, the cast and the contact
 *   backdrop-floor.js         floors, circulation, the room slab, walls,
 *                             partitions, baseboards, doors
 *   backdrop-light.js         daylight: the window band, the patches on the
 *                             floor, the falloff, the shade at a wall's foot
 *   backdrop-props-desk.js    desks, chairs, whiteboards, screens, plants
 *   backdrop-props-lounge.js  sofas, tables, the lamp, the water cooler
 *   backdrop-props-play.js    the games room and the kitchen
 *   backdrop-props-room.js    what a project room is furnished with past its
 *                             desks: the meeting table, the credenza, the
 *                             standing whiteboard
 *
 * `paintProp`'s 970-line `switch` is now three switches, case for case and
 * line for line including every `break`; each answers false for a kind it
 * does not know, and the neutral block that was its `default` is the branch
 * taken when none of the three did.
 * ============================================================================
 */

import { identityFor, PALETTE } from './palette.js';
import {
  U_DEFAULT,
  roundRect,
  grounded,
  isTallProp,
  makeCanvas,
  PROP_BLEED,
  seededRng,
} from './backdrop-paint.js';
import {
  paintTile,
  paintLightPool,
  paintRoomSlabEdge,
  castRoomShadow,
  paintBaseboard,
  paintWallSegment,
  paintDoorSwing,
  wallPieces,
  WALL_PX,
  paintThresholdBand,
  paintLightsOff,
  DESK_POOL_MARGIN_U,
  DOOR_POOL_R_U,
  LIT_PROP_KINDS,
} from './backdrop-floor.js';
import { paintFloorMaterial } from './backdrop-floor-look.js';
import { paintRoomLight, paintWindowBand } from './backdrop-light.js';
import { LOOK, liveMaterial, materialForRoom } from './look-derive.js';
import { setDeviceScale, snapPx } from './device-px.js';
import { paintDeskProps } from './backdrop-props-desk.js';
import { paintLoungeProps } from './backdrop-props-lounge.js';
import { paintPlantProps } from './backdrop-props-plant.js';
import { paintPlayProps } from './backdrop-props-play.js';
import { paintRoomProps } from './backdrop-props-room.js';

export * from './backdrop-paint.js';
export * from './backdrop-floor.js';
export * from './backdrop-floor-look.js';
export * from './backdrop-light.js';
export * from './backdrop-props-desk.js';
export * from './backdrop-props-lounge.js';
export * from './backdrop-props-plant.js';
export * from './backdrop-props-play.js';
export * from './backdrop-props-room.js';

/**
 * Paint one furniture prop. Every piece meets the floor in its own outline
 * (VISUAL-SPEC §6: "every furniture item carries a soft contact shadow"), and
 * a tall one throws a cast along the light as well.
 * Coordinates arrive pre-converted to px, already rotated by `angle`.
 *
 * Exported since WP-78 so `test/unit/lighting.test.mjs` can ask one prop what
 * it casts. `bakeBackdrop` needs a real canvas and cannot run under
 * `node --test`; this takes any 2D context, including a recorder.
 */
export function paintProp(ctx, prop, u) {
  const w = prop.w * u;
  const h = prop.h * u;
  // A Prop is a top-left rect, exactly like Room and Zone — that is the one
  // convention the whole geometry layer, the anchor resolver and the tests
  // all share. Every shape below is drawn about its own centre, so translate
  // to the centre of that rect. Treating x,y as the centre here (as this did
  // originally) offset every desk, chair, monitor, rug and whiteboard by half
  // its own size up and to the left.
  ctx.save();
  ctx.translate(prop.x * u + w / 2, prop.y * u + h / 2);

  // A prop may not paint outside its own footprint.
  //
  // Every rectangle on this floor is anchored, tested and reasoned about as
  // `x, y, w, h`; a painter that strays outside that puts furniture on the
  // floor plan where the plan says there is none, and no amount of checking
  // the GEOMETRY will ever find it. The allowance is for the parts of a prop
  // that are deliberately bigger than their anchor footprint — a plant's
  // foliage over its pot, a lamp's pool of light — and for the soft edge of a
  // shadow; it is not enough to hide a misplaced piece of furniture.
  //
  // THE MANAGER IS THE ONE EXEMPTION, and it is the same exemption the contact
  // shadow already makes below: it is a PERSON, not furniture. A person's
  // footprint is where they stand, and their body is almost entirely above it —
  // since WP-79 by `BODY_HEIGHT_U` (2.52 U) of billboarded robot, against a
  // 2 U anchor rect. Clipping a character to the tile it stands on took the
  // dome off the user's own avatar and left a headless suit at the end of the
  // desk. The rule the clip exists to enforce — "furniture on the floor plan
  // where the plan says there is none" — is a rule about floor coverage, and
  // the manager covers exactly the floor its contact ellipse covers.
  if (prop.kind !== 'manager') {
    ctx.beginPath();
    ctx.rect(
      -w / 2 - PROP_BLEED * u,
      -h / 2 - PROP_BLEED * u,
      w + 2 * PROP_BLEED * u,
      h + 2 * PROP_BLEED * u,
    );
    ctx.clip();
  }

  // The clip is set in the prop's OWN, axis-aligned footprint — the rectangle
  // the plan reasons about — and only then is the prop's facing applied. Doing
  // it the other way round clips an unrotated drawing to a rotated box, which
  // is how a thirty-two unit sofa run came out as a single cushion.
  ctx.rotate(prop.angle || 0);

  // WP-78: how far the prop's own shadow travels is a question about its
  // HEIGHT, and height is declared per kind in `PROP_HEIGHT` rather than
  // guessed from `w * h`. A tall prop casts along the light and presses its
  // own outline into the floor; a short one only presses (`grounded`). There
  // is no oval under either: contact is the shape of the thing itself.
  const tall = isTallProp(prop);
  const local = (fn) => grounded(ctx, fn, tall, u);

  if (
    !paintDeskProps(ctx, prop, u, w, h, local) &&
    !paintLoungeProps(ctx, prop, u, w, h, local) &&
    !paintPlayProps(ctx, prop, u, w, h, local) &&
    !paintPlantProps(ctx, prop, u, w, h, local) &&
    !paintRoomProps(ctx, prop, u, w, h, local)
  ) {
    // Unknown prop kinds still get a neutral block rather than being
    // silently dropped — better a plain box than a missing desk.
    ctx.fillStyle = PALETTE.furnitureMetal;
    roundRect(ctx, -w / 2, -h / 2, w, h, 2);
    ctx.fill();
  }

  ctx.restore();
}

// -------------------------------------------------------------------- bake

/**
 * THE MOST PIXELS ONE BAKE MAY HOLD: 16 million, which is 64 MB of RGBA.
 *
 * A bake is sized by the screen now rather than by the plan, so it needs a
 * ceiling the screen cannot raise. Sixteen million is a whole 4K display at one
 * bitmap pixel per device pixel with room to spare, and is under what the
 * 150-agent floor used to cost at a pixel ratio of 2 when every bake was 28
 * device pixels to the unit. Past it the bake is taken at the nearest lower
 * scale that fits and the blit stretches it — soft, and bounded.
 */
export const BAKE_MAX_PIXELS = 16_000_000;

/**
 * How big a bake of a `planW` x `planH` floor comes out, and at what scale.
 *
 * Pure, so the scene can ask before it bakes and a test can ask without a
 * canvas. `region` is a rectangle of the floor in DEVICE pixels at `pxPerUnit`;
 * it is clipped to the floor and moved onto whole pixels, and a bake of it is a
 * window onto the same drawing rather than a different one.
 *
 * @param {number} planW @param {number} planH plan units
 * @param {number} pxPerUnit device pixels per plan unit asked for
 * @param {{x:number,y:number,w:number,h:number}|null} [region]
 * @returns {{ppu:number, x:number, y:number, w:number, h:number, capped:boolean}}
 */
export function bakeSize(planW, planH, pxPerUnit, region = null) {
  let ppu =
    Number(pxPerUnit) > 0 && Number.isFinite(Number(pxPerUnit)) ? Number(pxPerUnit) : U_DEFAULT;
  const whole = (n) => Math.max(1, Math.ceil(n - 1e-6));
  let fullW = whole(planW * ppu);
  let fullH = whole(planH * ppu);
  if (region) {
    const x = Math.max(0, Math.min(fullW - 1, Math.floor(region.x)));
    const y = Math.max(0, Math.min(fullH - 1, Math.floor(region.y)));
    const w = Math.max(1, Math.min(fullW, Math.ceil(region.x + region.w)) - x);
    const h = Math.max(1, Math.min(fullH, Math.ceil(region.y + region.h)) - y);
    if (w * h <= BAKE_MAX_PIXELS) return { ppu, x, y, w, h, capped: false };
  }
  let capped = false;
  if (fullW * fullH > BAKE_MAX_PIXELS) {
    ppu *= Math.sqrt(BAKE_MAX_PIXELS / (fullW * fullH));
    // Rounding up can step back over the line by a row; one nudge always clears it.
    while (whole(planW * ppu) * whole(planH * ppu) > BAKE_MAX_PIXELS) ppu *= 0.999;
    fullW = whole(planW * ppu);
    fullH = whole(planH * ppu);
    capped = true;
  }
  return { ppu, x: 0, y: 0, w: fullW, h: fullH, capped };
}

/**
 * Bake the floor (materials, walls, doors, furniture) to an offscreen bitmap.
 * Called once per plan change and once per settled scale — never per frame
 * (docs/02-ARCHITECTURE.md §8).
 *
 * THE BITMAP IS BAKED AT THE SCALE IT IS DRAWN AT. `pxPerUnit` is device pixels
 * per plan unit: the px-per-unit the floor is on screen at, times the display's
 * pixel ratio. It used to be fixed at 14 times the ratio, and the blit stretched
 * the result to whatever the fit scale was — by 13 % on an ordinary floor and by
 * a factor of two on a quiet or magnified one — which is why crisp vector
 * figures stood on a soft floor. Every painter still draws on the 14 px design
 * grid (`U_DEFAULT`); the context is scaled by `pxPerUnit / 14`, so the drawing
 * is the same drawing and the raster is the device's.
 *
 * `opts.region`, in device pixels of the floor at `pxPerUnit`, bakes that window
 * and nothing else. It is how a magnified floor stays one to one without a
 * bitmap the size of the magnification.
 *
 * @param {import('./plan.js').Plan} plan
 * @param {number} [pxPerUnit] device pixels per plan unit; the design grid's
 *   own 14 when not given
 * @param {{region?: {x:number,y:number,w:number,h:number}|null}} [opts]
 * @returns {{ canvas: OffscreenCanvas | HTMLCanvasElement, ppu: number,
 *   x: number, y: number, wpx: number, hpx: number }} `ppu` is the scale it was
 *   actually baked at (lower than asked only past `BAKE_MAX_PIXELS`); `x`, `y`
 *   are where the bitmap's corner is on the floor, in its own pixels; `wpx`,
 *   `hpx` are the floor on the design grid.
 */
export function bakeBackdrop(plan, pxPerUnit = U_DEFAULT, opts = {}) {
  const u = U_DEFAULT;
  const wpx = Math.ceil(plan.width * u);
  const hpx = Math.ceil(plan.height * u);
  const size = bakeSize(plan.width, plan.height, pxPerUnit, (opts && opts.region) || null);
  const scale = size.ppu / u;

  const canvas = makeCanvas(size.w, size.h);
  const ctx = canvas.getContext('2d');
  ctx.translate(-size.x, -size.y);
  ctx.scale(scale, scale);
  // What one design pixel is on the device: shadows are scaled by it and
  // hairlines are laid on it (`device-px.js`).
  setDeviceScale(ctx, scale);
  // A room's four edges, on device pixels. Rooms tile the floor, and an edge
  // is snapped rather than a size, so two neighbours still meet on one line.
  const edge = (/** @type {number} */ v) => snapPx(ctx, v * u);
  const rectOf = (/** @type {{x:number,y:number,w:number,h:number}} */ r) => {
    const rx = edge(r.x);
    const ry = edge(r.y);
    return { rx, ry, rw: edge(r.x + r.w) - rx, rh: edge(r.y + r.h) - ry };
  };
  // Zone floors. The zones tile the whole envelope, so there is no separate
  // "circulation" surface to paint under them — the plan is one continuous
  // floor whose material changes where the use changes.
  for (const room of plan.rooms) {
    const { rx, ry, rw, rh } = rectOf(room);
    const rng = seededRng(room.id);

    if (room.kind === 'corridor') {
      // Circulation is not a room and gets neither a room's ambient occlusion
      // nor a room's plate — there are no walls above it to occlude. A route
      // (the spine, a cross corridor) is poured circulation; a lobby, which is
      // just the open floor beside a room, takes that room's own material so
      // the two read as one space.
      // WP-88a: WHICH material is the look's (`materialForRoom`), and it is the
      // same dispatcher every other zone goes through. A lobby still takes the
      // room's own material and the corridor still takes the corridor's, which
      // is exactly the chain of `if`s this replaces.
      paintFloorMaterial(
        ctx,
        materialForRoom(room, LOOK.look.floors),
        rx,
        ry,
        rw,
        rh,
        rng,
        null,
        u,
      );
      continue;
    }

    // WP-72: a project room's carpet is washed six per cent toward that
    // project's identity colour, so two rooms side by side are two rooms
    // before anybody has read a plate. Derived from `projectMk` — the number
    // that is assigned once and persisted (CONTRACTS-WP15.md §1) — so it is
    // the same wash under the same room on every machine and every rebake,
    // and it is the same colour the agents in it are already wearing.
    const tint = room.kind === 'project' ? identityFor(room.projectMk).accent : null;
    paintFloorMaterial(ctx, materialForRoom(room, LOOK.look.floors), rx, ry, rw, rh, rng, tint, u);

    if (room.kitchenZone) {
      // The cafe's own floor, and NOT a picker: §1.a's zones are four uses and a
      // kitchen bay inside the lounge is a fifth. A kitchen has a floor the rest
      // of a lounge does not, on every floor anybody has ever stood on.
      const kz = rectOf(room.kitchenZone);
      paintTile(ctx, kz.rx, kz.ry, kz.rw, kz.rh, u);
    }

    // DAYLIGHT, on the finished floor and under everything that stands on it:
    // the room falls away from its windows, each pane lays a patch, and the
    // foot of every wall is in shade.
    paintRoomLight(ctx, room, { rx, ry, rw, rh }, plan.walls || [], u);
  }

  // EVERY ROOM IS A SLAB ON THE SCREED (WP-72).
  //
  // A second pass, after every floor material is down and before the walls go
  // on, and the order is the point twice over. After the materials, because a
  // room's shadow falls on its NEIGHBOUR — across the circulation between two
  // bands, and across the partition it shares with the room beside it — and a
  // room-at-a-time pass would have had the next room's carpet painted over it.
  // Before the walls, because a wall is a thing standing ON the slab and its
  // own shadow belongs on top of the slab's, not under it.
  //
  // Corridors are excluded: the screed IS the ground here. A slab edge on a
  // corridor would be the floor casting a shadow onto itself.
  for (const room of plan.rooms) {
    if (room.kind === 'corridor') continue;
    const { rx, ry, rw, rh } = rectOf(room);
    castRoomShadow(ctx, rx, ry, rw, rh, wpx, hpx);
    paintRoomSlabEdge(ctx, rx, ry, rw, rh);
  }

  // POOLS OF LIGHT (WP-85a §3.2).
  //
  // After every floor material and after the slabs, because a pool lies ON the
  // finished floor — under the wall it spills against, under the desk it lights
  // and under the person at it. Before the walls for the same reason.
  //
  // This is what turns WP-72's key light into a light. There was no pool
  // anywhere on this floor, so the light was a shadow direction and nothing
  // else; §3.2 puts one over the manager's desk, over every working desk and on
  // every threshold, which is where a real plan lights because that is where
  // the work and the arriving happen. The lounge bays' centrepieces are on that
  // list too and are not lit here: the bays are WP-85c and a pool with nothing
  // under it is a stain.
  //
  // Baked, static, and free at L0 — `docs/plan/10-INTERIOR-DESIGN.md` §4:
  // reduced motion costs nothing because nothing here moves.
  for (const room of plan.rooms) {
    // A room with the lights off has no pool over its desk: that is the light.
    if (room.dim) continue;
    for (const prop of room.props || []) {
      if (!LIT_PROP_KINDS.includes(prop.kind)) continue;
      const pw = prop.w * u;
      const ph = prop.h * u;
      paintLightPool(
        ctx,
        prop.x * u + pw / 2,
        prop.y * u + ph / 2,
        Math.hypot(pw, ph) / 2 + DESK_POOL_MARGIN_U * u,
      );
    }
  }
  // §3.3's threshold, then the pool that lands on it: the band is a change of
  // SURFACE and the pool is light falling on that surface, so the pool goes
  // over it and not the other way round.
  for (const door of plan.doors || []) {
    paintThresholdBand(ctx, door, u);
    paintLightPool(ctx, door.x * u, door.y * u, DOOR_POOL_R_U * u);
  }

  // Walls, from the floor's own wall list. Two zones either side of a
  // partition share one segment, which is what makes this read as a single
  // building that has been divided rather than a row of separate huts.
  //
  // In this order: the baseboard at the foot of each room's walls, the walls
  // themselves (weakest first, and stopping at a doorway), the glazing in the
  // outside wall, and each door standing open in its opening.
  const pieces = wallPieces(plan.walls || [], plan.doors || []);
  for (const room of plan.rooms) {
    const floor = liveMaterial(materialForRoom(room, LOOK.look.floors));
    paintBaseboard(ctx, room, rectOf(room), pieces, u, floor.baseboard);
  }
  for (const wall of pieces) {
    paintWallSegment(ctx, wall, u);
  }
  for (const room of plan.rooms) {
    paintWindowBand(ctx, room, plan.walls || [], u, WALL_PX.exterior);
  }
  for (const door of plan.doors || []) {
    paintDoorSwing(ctx, door, u);
  }

  // Furniture, each with its own contact shadow. Room plates are NOT drawn
  // here — they are live text drawn every frame by the scene, so a stat
  // change never forces a re-bake. Space for the plate is simply left
  // empty at each room's top-left.
  for (const room of plan.rooms) {
    for (const prop of room.props || []) {
      paintProp(ctx, prop, u);
    }
    // LIGHTS OFF, last: the veil dims the furniture with the floor under it.
    if (room.dim) {
      const { rx, ry, rw, rh } = rectOf(room);
      paintLightsOff(ctx, rx, ry, rw, rh);
    }
  }

  return { canvas, ppu: size.ppu, x: size.x, y: size.y, wpx, hpx };
}
