/**
 * WP-72 — the floor has one light, and the rooms are slabs standing on it.
 *
 * Everything here is a measurement rather than a look. The reason is §87's:
 * lighting is exactly the class of change that is obvious in a PNG and
 * invisible to a unit suite, so the parts of it that CAN be stated as numbers
 * — a direction, a band width, a shadow's reach against the circulation it
 * must not close, a wash against the ink read on it — are stated as numbers
 * here, and the goldens carry the rest.
 *
 * No DOM: every painter under test only ever calls methods on the `ctx` object
 * it is handed, so the recorder below is a real (if minimal) 2D context for
 * these purposes — the same technique `identity-visuals.test.mjs` and
 * `rig-orientation.test.mjs` already use on the rig.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CARPET_IDENTITY_WASH,
  LIGHT_DIR,
  PALETTE,
  PROJECT_IDENTITIES,
  identityFor,
  mixHex,
  washedCarpet,
} from '../../public/render/palette.js';
import {
  CONTACT_SHADOW_DIST_PX,
  ENVELOPE_SHADOW_DIST_PX,
  PROP_SHADOW_DIST_PX,
  ROOM_SLAB_EDGE_PX,
  ROOM_SLAB_SHADOW_BLUR_PX,
  ROOM_SLAB_SHADOW_DIST_PX,
  U_DEFAULT,
  WALL_SHADOW_DIST_PX,
  drawContactShadow,
  setLightShadow,
  shadowOffsetFor,
  withShadow,
} from '../../public/render/backdrop-paint.js';
import {
  castRoomShadow,
  paintCarpet,
  paintRoomSlabEdge,
  paintWallSegment,
} from '../../public/render/backdrop-floor.js';
import { CORRIDOR } from '../../public/render/plan-units.js';
import { MIN_SCALE } from '../../public/render/scene-lod.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, '..', '..', 'public');

/** Every distance along the ray the product actually casts at. */
const EVERY_DISTANCE = {
  PROP_SHADOW_DIST_PX,
  CONTACT_SHADOW_DIST_PX,
  WALL_SHADOW_DIST_PX,
  ROOM_SLAB_SHADOW_DIST_PX,
  ENVELOPE_SHADOW_DIST_PX,
};

// ------------------------------------------------------------- the recorder

/**
 * A 2D context that remembers what it was told to do.
 *
 * `ops` is the transcript in order; `shadow` is the live shadow state, saved
 * and restored with the stack so a painter that leaks one is visible.
 */
function makeRecorder() {
  const ops = [];
  const stack = [];
  const ctx = {
    ops,
    fillStyle: null,
    strokeStyle: null,
    lineWidth: 0,
    lineCap: '',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    /** the path being built, as a list of rects/other */
    _path: [],
    save() {
      stack.push({
        shadowColor: ctx.shadowColor,
        shadowBlur: ctx.shadowBlur,
        shadowOffsetX: ctx.shadowOffsetX,
        shadowOffsetY: ctx.shadowOffsetY,
      });
      ops.push({ op: 'save' });
    },
    restore() {
      const s = stack.pop();
      if (s) Object.assign(ctx, s);
      ops.push({ op: 'restore' });
    },
    translate() {},
    rotate() {},
    scale() {},
    beginPath() {
      ctx._path = [];
    },
    closePath() {},
    moveTo() {},
    lineTo() {},
    quadraticCurveTo() {},
    arc() {},
    rect(x, y, w, h) {
      ctx._path.push({ x, y, w, h });
    },
    ellipse(x, y, rx, ry) {
      ops.push({ op: 'ellipse', x, y, rx, ry, fillStyle: ctx.fillStyle });
    },
    clip(rule) {
      ops.push({ op: 'clip', rule: rule || 'nonzero', path: ctx._path.slice() });
    },
    fill() {
      ops.push({
        op: 'fill',
        path: ctx._path.slice(),
        fillStyle: ctx.fillStyle,
        shadowColor: ctx.shadowColor,
        shadowBlur: ctx.shadowBlur,
        shadowOffsetX: ctx.shadowOffsetX,
        shadowOffsetY: ctx.shadowOffsetY,
      });
    },
    stroke() {},
    setLineDash() {},
    strokeRect() {},
    fillText() {},
    measureText: (t) => ({ width: String(t).length * 6 }),
    fillRect(x, y, w, h) {
      ops.push({
        op: 'fillRect',
        x,
        y,
        w,
        h,
        fillStyle: ctx.fillStyle,
        shadowColor: ctx.shadowColor,
        shadowBlur: ctx.shadowBlur,
        shadowOffsetX: ctx.shadowOffsetX,
        shadowOffsetY: ctx.shadowOffsetY,
      });
    },
    createLinearGradient(x0, y0, x1, y1) {
      const stops = [];
      return { kind: 'linear', x0, y0, x1, y1, stops, addColorStop: (o, c) => stops.push([o, c]) };
    },
    createRadialGradient(x0, y0, r0, x1, y1, r1) {
      const stops = [];
      return {
        kind: 'radial',
        x0,
        y0,
        r0,
        x1,
        y1,
        r1,
        stops,
        addColorStop: (o, c) => stops.push([o, c]),
      };
    },
  };
  return ctx;
}

// ------------------------------------------------------------ the direction

test('WP-72: the floor has ONE light, and it is in the upper left', () => {
  assert.ok(LIGHT_DIR.x > 0, `LIGHT_DIR.x is ${LIGHT_DIR.x}; a shadow must fall to the RIGHT`);
  assert.ok(LIGHT_DIR.y > 0, `LIGHT_DIR.y is ${LIGHT_DIR.y}; a shadow must fall DOWN the page`);
  const length = Math.hypot(LIGHT_DIR.x, LIGHT_DIR.y);
  assert.ok(
    Math.abs(length - 1) < 1e-9,
    `LIGHT_DIR is ${length.toFixed(4)} long; it is a direction, so a distance along it ` +
      'must be the distance you asked for',
  );
  assert.ok(Object.isFrozen(LIGHT_DIR), 'a renderer could rotate the sun');
});

test('WP-72: NO shadow on this floor offsets up or left, at any distance', () => {
  // The acceptance criterion, stated over every distance the product casts at
  // and then over a sweep, because a sign error is the failure this catches
  // and a sign error does not care which constant it is in.
  const distances = [...Object.values(EVERY_DISTANCE), 0.25, 1, 2, 3, 7, 26, 100];
  for (const dist of distances) {
    const off = shadowOffsetFor(dist);
    assert.ok(off.x >= 0, `a shadow at ${dist} offsets LEFT (${off.x})`);
    assert.ok(off.y >= 0, `a shadow at ${dist} offsets UP (${off.y})`);
    if (dist > 0) {
      // And every one of them shares the direction, not merely the sign: two
      // shadows at different angles is two lights.
      assert.ok(
        Math.abs(off.x / off.y - LIGHT_DIR.x / LIGHT_DIR.y) < 1e-9,
        `a shadow at ${dist} is lit from somewhere else`,
      );
      assert.ok(Math.abs(Math.hypot(off.x, off.y) - dist) < 1e-9);
    }
  }
});

test('WP-72: setLightShadow writes BOTH offsets, and withShadow gives them back', () => {
  const ctx = makeRecorder();
  ctx.shadowOffsetX = -999;
  ctx.shadowOffsetY = -999;
  withShadow(
    ctx,
    (c) => {
      // Inside: both offsets set, from the one direction.
      assert.ok(c.shadowOffsetX > 0, 'shadowOffsetX was left where it was found');
      assert.ok(c.shadowOffsetY > 0, 'shadowOffsetY was not set');
      assert.equal(c.shadowBlur, 8);
      assert.equal(c.shadowColor, PALETTE.shadowContact);
    },
    { blur: 8, dist: PROP_SHADOW_DIST_PX },
  );
  assert.equal(ctx.shadowOffsetX, -999, 'withShadow leaked its shadow');
  assert.equal(ctx.shadowOffsetY, -999, 'withShadow leaked its shadow');

  setLightShadow(ctx, { blur: 4, dist: 10, color: 'rgba(1,2,3,0.4)' });
  assert.equal(ctx.shadowColor, 'rgba(1,2,3,0.4)');
  assert.equal(ctx.shadowBlur, 4);
  assert.ok(ctx.shadowOffsetX > 0 && ctx.shadowOffsetY > 0);
});

test('WP-72: the floor keeps every vertical drop it already had', () => {
  // The three offsets that shipped before this package were (2, 2), (2, 2) and
  // (3, 3) once a horizontal component existed at all; the building's was 8.
  // Stating the distance along the ray must REPRODUCE them, or "we added a
  // light" would also mean "we quietly flattened every shadow on the floor".
  const expected = [
    [CONTACT_SHADOW_DIST_PX, 2],
    [WALL_SHADOW_DIST_PX, 2],
    [PROP_SHADOW_DIST_PX, 3],
    [ENVELOPE_SHADOW_DIST_PX, 8],
  ];
  for (const [dist, drop] of expected) {
    const off = shadowOffsetFor(dist);
    assert.ok(Math.abs(off.y - drop) < 1e-9, `expected a ${drop} px drop, got ${off.y}`);
    assert.ok(Math.abs(off.x - drop) < 1e-9, `expected a ${drop} px slide, got ${off.x}`);
  }
});

test("WP-72: a prop's contact shadow sits down-right of the prop, never up-left", () => {
  const ctx = makeRecorder();
  drawContactShadow(ctx, 100, 200, 40, 20);
  const blob = ctx.ops.find((o) => o.op === 'ellipse');
  assert.ok(blob, 'no contact shadow was drawn at all');
  // Bottom-centre of the footprint is (120, 220); the shadow is offset from it
  // along the light and nowhere else.
  const off = shadowOffsetFor(CONTACT_SHADOW_DIST_PX);
  assert.ok(Math.abs(blob.x - (120 + off.x)) < 1e-9, `blob.x is ${blob.x}`);
  assert.ok(Math.abs(blob.y - (220 + off.y)) < 1e-9, `blob.y is ${blob.y}`);
  assert.ok(blob.x > 120 && blob.y > 220, 'the contact shadow is up-left of its prop');
});

test('WP-72: a real wall casts along the light; a waist-high partition still casts nothing', () => {
  for (const kind of ['exterior', 'solid']) {
    const ctx = makeRecorder();
    paintWallSegment(ctx, { x1: 0, y1: 4, x2: 20, y2: 4, kind }, U_DEFAULT);
    const cast = ctx.ops.find((o) => o.op === 'fillRect' && o.shadowBlur > 0);
    assert.ok(cast, `a ${kind} wall cast no shadow`);
    assert.ok(cast.shadowOffsetX > 0, `a ${kind} wall's shadow offsets left`);
    assert.ok(cast.shadowOffsetY > 0, `a ${kind} wall's shadow offsets up`);
  }
  const ctx = makeRecorder();
  paintWallSegment(ctx, { x1: 0, y1: 4, x2: 20, y2: 4, kind: 'partition' }, U_DEFAULT);
  for (const op of ctx.ops) {
    if (op.op !== 'fillRect') continue;
    assert.equal(
      op.shadowBlur,
      0,
      'a partition is waist height and casts nothing — VISUAL-SPEC §6',
    );
  }
});

test('WP-72: backdrop-paint.js is the only place a shadow offset is written', () => {
  // The structural half of "one light". It is not that every painter happens
  // to agree; it is that there is one place to disagree from. A file that sets
  // `shadowOffsetY` and leaves `shadowOffsetX` alone is a second light, added
  // by omission, and that is exactly what this floor had before WP-72.
  const files = [
    ...fs
      .readdirSync(path.join(PUBLIC, 'render'))
      .filter((f) => f.endsWith('.js'))
      .map((f) => path.join('render', f)),
    'minifloor.js',
    'snapshot.js',
  ];
  const offenders = [];
  for (const rel of files) {
    const full = path.join(PUBLIC, rel);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    if (!/\bshadowOffset[XY]\s*=/.test(src)) continue;
    if (rel === path.join('render', 'backdrop-paint.js')) continue;
    offenders.push(rel);
  }
  assert.deepEqual(
    offenders,
    [],
    `${offenders.join(', ')} sets a shadow offset directly; use setLightShadow() so the ` +
      'floor keeps one light — docs/DEVIATIONS.md §149',
  );
});

// -------------------------------------------------------------- the slab

test('WP-72: the slab edge is at least 3 px wide at the smallest a floor is ever drawn', () => {
  // A baked pixel is not a screen pixel: the bake is at `U_DEFAULT` px per
  // unit and the floor is drawn at the fit scale, which `computeFill` clamps
  // to at least `MIN_SCALE`. So the worst case is the whole test.
  const onScreen = (ROOM_SLAB_EDGE_PX / U_DEFAULT) * MIN_SCALE;
  assert.ok(
    onScreen >= 3,
    `the slab edge is ${onScreen.toFixed(2)} px at the minimum fit scale ` +
      `(${ROOM_SLAB_EDGE_PX} baked px, U=${U_DEFAULT}, scale=${MIN_SCALE}); it must be >= 3`,
  );
});

test('WP-72: a room slab shadow cannot close the circulation between two rooms', () => {
  // A shadow reaches its offset plus its blur. Two rooms face each other
  // across `CORRIDOR` units of screed, and only the up-light one casts into
  // it, so half the gap is a bar with a real margin in it — but the gap is the
  // thing that must survive, so it is measured against `CORRIDOR` rather than
  // against the 56 px it currently happens to be.
  const gapPx = CORRIDOR * U_DEFAULT;
  const reach = ROOM_SLAB_SHADOW_DIST_PX + ROOM_SLAB_SHADOW_BLUR_PX;
  assert.ok(
    reach < gapPx / 2,
    `a room's shadow reaches ${reach} px into a ${gapPx} px corridor; over half of it and the ` +
      'circulation reads as a dark band rather than as a floor',
  );
});

test('WP-72: the slab edge darkens the two LIGHT-AWAY sides, and stays inside the room', () => {
  const ctx = makeRecorder();
  const [x, y, w, h] = [100, 50, 300, 200];
  paintRoomSlabEdge(ctx, x, y, w, h);
  const bands = ctx.ops.filter((o) => o.op === 'fillRect');
  assert.equal(bands.length, 2, 'a slab has exactly two shaded rims, not four');

  const east = bands.find((b) => b.w < b.h);
  const south = bands.find((b) => b.w > b.h);
  assert.ok(east && south, 'the two rims are not one vertical and one horizontal');

  // EAST — away from an upper-left light, so the far side is the lit-away one.
  assert.equal(east.w, ROOM_SLAB_EDGE_PX);
  assert.equal(east.x + east.w, x + w, 'the east rim does not reach the east wall');
  assert.equal(east.y, y);
  assert.equal(east.h, h);
  // SOUTH.
  assert.equal(south.h, ROOM_SLAB_EDGE_PX);
  assert.equal(south.y + south.h, y + h, 'the south rim does not reach the south wall');
  assert.equal(south.x, x);
  assert.equal(south.w, w);

  // Neither rim leaves the room: a slab edge that ate the circulation would
  // be the same defect as a shadow that did.
  for (const b of bands) {
    assert.ok(b.x >= x && b.y >= y && b.x + b.w <= x + w && b.y + b.h <= y + h);
  }
  // And each fades INTO the room rather than sitting as a stripe, with both
  // stops the same hue so nothing bands through a colour the floor lacks.
  for (const b of bands) {
    assert.equal(b.fillStyle.kind, 'linear');
    assert.equal(b.fillStyle.stops.length, 2);
    assert.match(b.fillStyle.stops[0][1], /,\s*0\)$/, 'the inner stop is not transparent');
    assert.equal(b.fillStyle.stops[1][1], PALETTE.slabEdge);
  }
  // The east gradient runs west-to-east and the south one north-to-south.
  assert.ok(east.fillStyle.x1 > east.fillStyle.x0 && east.fillStyle.y0 === east.fillStyle.y1);
  assert.ok(south.fillStyle.y1 > south.fillStyle.y0 && south.fillStyle.x0 === south.fillStyle.x1);
});

test('WP-72: a tiny room gets a rim it can hold, not one wider than itself', () => {
  const ctx = makeRecorder();
  paintRoomSlabEdge(ctx, 0, 0, 8, 6);
  const bands = ctx.ops.filter((o) => o.op === 'fillRect');
  for (const b of bands) {
    assert.ok(b.w <= 8 && b.h <= 6, 'the rim is bigger than the room');
    assert.ok(Math.min(b.w, b.h) > 0);
  }
});

test('WP-72: a room casts onto its neighbours and never onto its own carpet', () => {
  const ctx = makeRecorder();
  castRoomShadow(ctx, 100, 50, 300, 200, 1000, 800);
  const clip = ctx.ops.find((o) => o.op === 'clip');
  assert.ok(clip, 'the shadow was cast with no clip, so it darkened the room it belongs to');
  assert.equal(clip.rule, 'evenodd', 'a nonzero clip here is the whole bitmap, not the ring');
  assert.deepEqual(clip.path, [
    { x: 0, y: 0, w: 1000, h: 800 },
    { x: 100, y: 50, w: 300, h: 200 },
  ]);
  const cast = ctx.ops.find((o) => o.op === 'fill');
  assert.ok(cast, 'nothing was filled, so nothing cast');
  assert.equal(cast.shadowColor, PALETTE.slabShadow);
  assert.equal(cast.shadowBlur, ROOM_SLAB_SHADOW_BLUR_PX);
  assert.ok(cast.shadowOffsetX > 0 && cast.shadowOffsetY > 0, 'the room is lit from below-right');
  assert.deepEqual(cast.path, [{ x: 100, y: 50, w: 300, h: 200 }]);
});

test('WP-72: a degenerate room casts nothing rather than throwing', () => {
  const ctx = makeRecorder();
  castRoomShadow(ctx, 10, 10, 0, 40, 100, 100);
  castRoomShadow(ctx, 10, 10, 40, -1, 100, 100);
  paintRoomSlabEdge(ctx, 10, 10, 0, 0);
  assert.equal(
    ctx.ops.filter((o) => o.op === 'fill' || o.op === 'fillRect').length,
    0,
    'a room with no area painted something',
  );
});

// ----------------------------------------------------------- the carpet wash

test('WP-72: the identity wash is at most six per cent, and is all the carpet moves', () => {
  assert.ok(
    CARPET_IDENTITY_WASH <= 0.06,
    `the wash is ${CARPET_IDENTITY_WASH}; the acceptance bar is 6%`,
  );
  const base = '#E4DFD3';
  for (const identity of PROJECT_IDENTITIES) {
    const washed = washedCarpet(base, identity.accent);
    assert.equal(washed, mixHex(base, identity.accent, CARPET_IDENTITY_WASH));
    // Asking for more than the ceiling gets the ceiling.
    assert.equal(washed, washedCarpet(base, identity.accent, 0.9));
    // And it is a wash rather than a repaint: no channel moves further than
    // the ceiling's share of the distance to the identity colour.
    const ch = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const a = ch(base);
    const b = ch(identity.accent);
    const c = ch(washed);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(c[i] - a[i]) <= Math.abs(b[i] - a[i]) * CARPET_IDENTITY_WASH + 1);
    }
  }
});

test('WP-72: no wash without a project, and the same wash for the same project, always', () => {
  assert.equal(washedCarpet('#E4DFD3', null), '#E4DFD3');
  assert.equal(washedCarpet('#E4DFD3', undefined), '#E4DFD3');
  // Determinism: the wash is a pure function of the MK number, which is
  // assigned once and persisted, so it survives a rebake and a restart.
  for (const mk of [1, 2, 7, 14, 15, 0, -3, 2.7, NaN]) {
    const once = washedCarpet('#E4DFD3', identityFor(mk).accent);
    const twice = washedCarpet('#E4DFD3', identityFor(mk).accent);
    assert.equal(once, twice);
    assert.match(once, /^#[0-9a-f]{6}$/);
  }
});

test('WP-72: only a project room takes the wash; the circulation carpet does not', () => {
  const rng = () => 0.5;
  const plain = makeRecorder();
  paintCarpet(plain, 0, 0, 20, 20, rng);
  const plainBase = plain.ops.find((o) => o.op === 'fillRect');
  assert.equal(plainBase.fillStyle, PALETTE.carpetBase);

  const tinted = makeRecorder();
  const accent = PROJECT_IDENTITIES[3].accent;
  paintCarpet(tinted, 0, 0, 20, 20, rng, accent);
  const tintedBase = tinted.ops.find((o) => o.op === 'fillRect');
  assert.equal(tintedBase.fillStyle, washedCarpet(PALETTE.carpetBase, accent));
  assert.notEqual(tintedBase.fillStyle, PALETTE.carpetBase, 'the wash changed nothing');
});

// ------------------------------------------------------- baked, and still

test('WP-72: the whole pass is baked, and nothing in it moves', () => {
  const backdrop = fs.readFileSync(path.join(PUBLIC, 'render', 'backdrop.js'), 'utf8');
  const floor = fs.readFileSync(path.join(PUBLIC, 'render', 'backdrop-floor.js'), 'utf8');
  // The slab pass is inside the bake, which runs once per plan change.
  assert.match(backdrop, /castRoomShadow\(/);
  assert.match(backdrop, /paintRoomSlabEdge\(/);
  // And none of it is a function of time or of chance: a re-bake of the same
  // plan in the same theme has to be pixel-identical (WP-63's rule). Comments
  // are stripped first — every one of these files explains in prose that it
  // does not call `Math.random()`, and a guard that read the prose would be
  // measuring the explanation rather than the code.
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  for (const [name, src] of [
    ['backdrop.js', backdrop],
    ['backdrop-floor.js', floor],
    [
      'backdrop-paint.js',
      fs.readFileSync(path.join(PUBLIC, 'render', 'backdrop-paint.js'), 'utf8'),
    ],
  ]) {
    assert.doesNotMatch(
      code(src),
      /Math\.random\(|Date\.now\(|performance\.now\(/,
      `${name} is not pure`,
    );
  }
});

test('WP-72: the ground falloff is built once per camera, not once per frame', () => {
  const src = fs.readFileSync(path.join(PUBLIC, 'render', 'scene-draw.js'), 'utf8');
  // The one gradient the floor cannot bake — the ground is by definition
  // outside the envelope the bake IS — is memoised on the camera it describes.
  assert.match(src, /_groundFalloff\(/);
  assert.match(src, /this\._groundWash\s*&&\s*this\._groundWash\.key === key/);
  assert.match(src, /createRadialGradient\(/);
});
