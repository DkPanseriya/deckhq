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
 * the clip to a prop's own footprint, the facing, the two-pass shadow, and
 * the contact shadow underneath. What each KIND looks like is three modules:
 *
 *   backdrop-paint.js         the primitives — seeded RNG, rounded rect, the
 *                             two-pass shadow, the contact shadow
 *   backdrop-floor.js         floors, circulation, ambient occlusion, walls,
 *                             door swings
 *   backdrop-props-desk.js    desks, chairs, whiteboards, screens, plants
 *   backdrop-props-lounge.js  sofas, tables, the lamp, the water cooler
 *   backdrop-props-play.js    the games room and the kitchen
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
  withShadow,
  drawContactShadow,
  isTallProp,
  makeCanvas,
  PROP_BLEED,
  PROP_SHADOW_DIST_PX,
  seededRng,
} from './backdrop-paint.js';
import {
  paintHerringbone,
  paintCarpet,
  paintTile,
  paintCirculation,
  paintLightPool,
  paintRoomAmbientOcclusion,
  paintRoomSlabEdge,
  castRoomShadow,
  paintWallSegment,
  paintDoorSwing,
  DESK_POOL_MARGIN_U,
  DOOR_POOL_R_U,
  LIT_PROP_KINDS,
} from './backdrop-floor.js';
import { paintDeskProps } from './backdrop-props-desk.js';
import { paintLoungeProps } from './backdrop-props-lounge.js';
import { paintPlantProps } from './backdrop-props-plant.js';
import { paintPlayProps } from './backdrop-props-play.js';

export * from './backdrop-paint.js';
export * from './backdrop-floor.js';
export * from './backdrop-props-desk.js';
export * from './backdrop-props-lounge.js';
export * from './backdrop-props-plant.js';
export * from './backdrop-props-play.js';

/**
 * Paint one furniture prop. All props share a soft contact shadow
 * (VISUAL-SPEC §6: "every furniture item carries a soft contact shadow").
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

  // WP-78: how far the prop's own drop shadow travels is a question about its
  // HEIGHT, and height is declared per kind in `PROP_HEIGHT` rather than
  // guessed from `w * h`. A tall prop keeps WP-72's 3 px along the ray; a short
  // one casts straight down onto the floor it is lying on, blur and no slide.
  const tall = isTallProp(prop);
  const local = (fn) => {
    withShadow(ctx, () => fn(ctx), { blur: 8, dist: tall ? PROP_SHADOW_DIST_PX : 0 });
    fn(ctx);
  };

  if (
    !paintDeskProps(ctx, prop, u, w, h, local) &&
    !paintLoungeProps(ctx, prop, u, w, h, local) &&
    !paintPlayProps(ctx, prop, u, w, h, local) &&
    !paintPlantProps(ctx, prop, u, w, h, local)
  ) {
    // Unknown prop kinds still get a neutral block rather than being
    // silently dropped — better a plain box than a missing desk.
    ctx.fillStyle = PALETTE.furnitureMetal;
    roundRect(ctx, -w / 2, -h / 2, w, h, 2);
    ctx.fill();
  }

  ctx.restore();

  // Contact shadow beneath the whole footprint, in un-rotated plan space —
  // simpler and close enough at this scale for a soft ambient blob. Skipped
  // for 'manager': `drawManagerFigure` already draws a character-shaped
  // contact shadow sized to the figure's actual stance (rig.js's SHADOW_*
  // proportions), not to the padded anchor footprint — stacking this
  // bounding-box blob under it as well would just muddy the one that is
  // already correctly shaped and placed.
  if (prop.kind !== 'manager') drawContactShadow(ctx, prop.x * u, prop.y * u, w, h, tall);
}

// -------------------------------------------------------------------- bake

/**
 * Bake the whole floor (materials, walls, doors, furniture) to an offscreen
 * bitmap. Called once per plan change — never per frame
 * (docs/02-ARCHITECTURE.md §8).
 *
 * @param {import('./plan.js').Plan} plan
 * @param {number} [dpr] device pixel ratio; the returned canvas is `wpx*dpr`
 *   by `hpx*dpr` physical pixels, pre-scaled so callers can blit 1:1.
 * @returns {{ canvas: OffscreenCanvas | HTMLCanvasElement, wpx: number, hpx: number }}
 */
export function bakeBackdrop(plan, dpr = 1) {
  const u = U_DEFAULT;
  const wpx = Math.ceil(plan.width * u);
  const hpx = Math.ceil(plan.height * u);
  const scale = Math.max(1, dpr || 1);

  const canvas = makeCanvas(Math.ceil(wpx * scale), Math.ceil(hpx * scale));
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  // Zone floors. The zones tile the whole envelope, so there is no separate
  // "circulation" surface to paint under them — the plan is one continuous
  // floor whose material changes where the use changes.
  for (const room of plan.rooms) {
    const rx = room.x * u;
    const ry = room.y * u;
    const rw = room.w * u;
    const rh = room.h * u;
    const rng = seededRng(room.id);

    if (room.kind === 'corridor') {
      // Circulation is not a room and gets neither a room's ambient occlusion
      // nor a room's plate — there are no walls above it to occlude. A route
      // (the spine, a cross corridor) is poured circulation; a lobby, which is
      // just the open floor beside a room, takes that room's own material so
      // the two read as one space.
      if (room.floor === 'wood') paintHerringbone(ctx, rx, ry, rw, rh, rng, u);
      else if (room.floor === 'carpet') paintCarpet(ctx, rx, ry, rw, rh, rng, null, u);
      else if (room.floor === 'tile') paintTile(ctx, rx, ry, rw, rh, u);
      else paintCirculation(ctx, rx, ry, rw, rh);
      continue;
    }

    // WP-72: a project room's carpet is washed six per cent toward that
    // project's identity colour, so two rooms side by side are two rooms
    // before anybody has read a plate. Derived from `projectMk` — the number
    // that is assigned once and persisted (CONTRACTS-WP15.md §1) — so it is
    // the same wash under the same room on every machine and every rebake,
    // and it is the same colour the agents in it are already wearing.
    const tint = room.kind === 'project' ? identityFor(room.projectMk).accent : null;
    if (room.floor === 'wood') paintHerringbone(ctx, rx, ry, rw, rh, rng, u);
    else if (room.floor === 'tile') paintTile(ctx, rx, ry, rw, rh, u);
    else if (room.floor === 'circulation') paintCirculation(ctx, rx, ry, rw, rh);
    else paintCarpet(ctx, rx, ry, rw, rh, rng, tint, u);

    if (room.kitchenZone) {
      const kz = room.kitchenZone;
      paintTile(ctx, kz.x * u, kz.y * u, kz.w * u, kz.h * u, u);
    }

    paintRoomAmbientOcclusion(ctx, rx, ry, rw, rh);
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
    const rx = room.x * u;
    const ry = room.y * u;
    const rw = room.w * u;
    const rh = room.h * u;
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
  for (const door of plan.doors || []) {
    paintLightPool(ctx, door.x * u, door.y * u, DOOR_POOL_R_U * u);
  }

  // Walls, from the floor's own wall list. Two zones either side of a
  // partition share one segment, which is what makes this read as a single
  // building that has been divided rather than a row of separate huts.
  for (const wall of plan.walls || []) {
    paintWallSegment(ctx, wall, u);
  }
  for (const door of plan.doors) {
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
  }

  return { canvas, wpx, hpx };
}
