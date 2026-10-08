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
  CAST_BLUR_RATIO,
  CONTACT_BLUR_U,
  CONTACT_GROW_U,
  ENVELOPE_SHADOW_BLUR_PX,
  ENVELOPE_SHADOW_DIST_PX,
  PROP_SHADOW_DIST_PX,
  ROOM_SLAB_EDGE_PX,
  ROOM_SLAB_SHADOW_BLUR_PX,
  ROOM_SLAB_SHADOW_DIST_PX,
  PROP_HEIGHT,
  SHADOW_U,
  SHORT_CONTACT_ALPHA,
  U_DEFAULT,
  WALL_SHADOW_DIST_PX,
  alphaScaled,
  contactUnder,
  isTallProp,
  lightCast,
  lightDir,
  setLightShadow,
  shadowOffsetFor,
  withShadow,
} from '../../public/render/backdrop-paint.js';
import { LOOK, applyLook, resetLook } from '../../public/render/look-derive.js';
import { DEFAULT_LOOK, LIGHT_MOOD_IDS, LIGHT_MOODS } from '../../public/render/look-options.js';
import { BAKE_MAX_PIXELS, bakeSize, paintProp } from '../../public/render/backdrop.js';
import { deviceGrid, setDeviceScale } from '../../public/render/device-px.js';
import { buildPlan } from '../../public/render/plan.js';
import { SHADOW_OX, SHADOW_OY } from '../../public/render/rig-metrics.js';
import { drawContactShadow as drawCharacterShadow } from '../../public/render/rig-body.js';
import { CHAR_MAX_PX_PER_UNIT } from '../../public/render/scene-lod.js';
import {
  castRoomShadow,
  paintCarpet,
  paintDoorSwing,
  paintRoomSlabEdge,
  paintWallSegment,
  wallBand,
  wallPieces,
} from '../../public/render/backdrop-floor.js';
import {
  daylightPatches,
  litRuns,
  paintRoomAmbientOcclusion,
  paintRoomLight,
  panesAlong,
  skylightOf,
  windowsOf,
} from '../../public/render/backdrop-light.js';
import {
  AO_ALPHA,
  AO_DEPTH_U,
  AO_LIT_SIDE,
  DOOR_OPENING_U,
  MULLION_U,
  PANE_U,
  PARTITION_STYLE_IDS,
  PARTITION_STYLES,
  PATCH_LENGTH_U,
  PATCHES_PER_ROOM,
  PLATE_BOX_U,
  WINDOW_INSET_U,
} from '../../public/render/look-ambience.js';
import { CORRIDOR } from '../../public/render/plan-units.js';
import { MIN_SCALE } from '../../public/render/scene-lod.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(HERE, '..', '..', 'public');

/** Every distance along the ray the product actually casts at. */
const EVERY_DISTANCE = {
  PROP_SHADOW_DIST_PX,
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

test('every shadow length on the floor is stated in plan units', () => {
  // A unit is about 0.30 m, so a length in units is a claim about a real
  // shadow; a length in pixels is a claim about one zoom. The pixel names the
  // painters still use are these, on the 14 px design grid, and nothing else.
  for (const [name, value] of Object.entries(SHADOW_U)) {
    assert.ok(
      value > 0 && value < 4,
      `SHADOW_U.${name} is ${value}; that is not a length in units`,
    );
  }
  const grid = [
    [PROP_SHADOW_DIST_PX, SHADOW_U.propCast],
    [WALL_SHADOW_DIST_PX, SHADOW_U.wallCast],
    [ROOM_SLAB_SHADOW_DIST_PX, SHADOW_U.slab],
    [ROOM_SLAB_SHADOW_BLUR_PX, SHADOW_U.slabBlur],
    [ROOM_SLAB_EDGE_PX, SHADOW_U.slabEdge],
    [ENVELOPE_SHADOW_DIST_PX, SHADOW_U.envelope],
    [ENVELOPE_SHADOW_BLUR_PX, SHADOW_U.envelopeBlur],
  ];
  for (const [px, units] of grid) assert.ok(Math.abs(px - units * U_DEFAULT) < 1e-9);
  // The building's own drop is the one the floor has always shipped with.
  const off = shadowOffsetFor(ENVELOPE_SHADOW_DIST_PX);
  assert.ok(Math.abs(off.x - 8) < 1e-9 && Math.abs(off.y - 8) < 1e-9);
  // Contact is a fraction of a unit: a line where a thing meets the floor.
  assert.ok(CONTACT_GROW_U > 0 && CONTACT_GROW_U < CONTACT_BLUR_U && CONTACT_BLUR_U < 0.3);
  assert.ok(
    CAST_BLUR_RATIO > 0 && CAST_BLUR_RATIO < 1,
    'a cast softer than it is long is a smudge',
  );
});

test('the light has three moods, and every one of them travels down and to the right', () => {
  const rows = [];
  try {
    for (const id of LIGHT_MOOD_IDS) {
      applyLook({ ...DEFAULT_LOOK, light: id }, 'default');
      const dir = lightDir();
      assert.equal(dir, LIGHT_MOODS[id].dir, `${id}: the painters read a different light`);
      assert.ok(dir.x > 0 && dir.y > 0, `${id}: the light leaves the down-right quadrant`);
      assert.ok(Math.abs(Math.hypot(dir.x, dir.y) - 1) < 1e-9, `${id}: not a direction`);
      assert.equal(lightCast(), LIGHT_MOODS[id].cast);
      // What a tall prop casts, in units, and where the context is told to put it.
      const ctx = makeRecorder();
      paintProp(ctx, { kind: 'desk', x: 4, y: 6, w: 3, h: 2, angle: 0 }, U_DEFAULT);
      const cast = ctx.ops.find((o) => o.op === 'fill' && o.shadowOffsetX > 0);
      assert.ok(cast, `${id}: a desk cast nothing along the light`);
      assert.ok(cast.shadowOffsetX > 0 && cast.shadowOffsetY > 0);
      const length = Math.hypot(cast.shadowOffsetX, cast.shadowOffsetY) / U_DEFAULT;
      assert.ok(Math.abs(length - SHADOW_U.propCast * LIGHT_MOODS[id].cast) < 1e-9);
      assert.ok(Math.abs(cast.shadowBlur - CAST_BLUR_RATIO * length * U_DEFAULT) < 1e-9);
      rows.push(
        `${id}: (${dir.x.toFixed(3)}, ${dir.y.toFixed(3)}), desk cast ${length.toFixed(2)} U`,
      );
    }
  } finally {
    resetLook();
  }
  assert.equal(lightDir(), LIGHT_DIR, 'the floor as it ships is lit from somewhere else');
  console.log(`  light moods — ${rows.join(' · ')}`);
});

// ------------------------------------------------- WP-78: honest shadows
//
// The owner, 14 September: "the oval shadows sometimes are offset and make no
// sense." WP-72 gave everything on the floor the same 45-degree ray, which is
// right for a thing with height and wrong for a thing lying on the floor. WP-78
// stopped the short ones sliding; this is the rest of it — there is no oval.
// Contact is the object's own outline, straight underneath.

test('contact under a footprint is the footprint itself, grown and blurred, with no offset', () => {
  const ctx = makeRecorder();
  contactUnder(ctx, 100, 200, 40, 20, 5, false, U_DEFAULT);
  assert.equal(ctx.ops.filter((o) => o.op === 'ellipse').length, 0, 'an oval came back');
  const fill = ctx.ops.find((o) => o.op === 'fill');
  assert.ok(fill, 'no contact was drawn at all');
  assert.equal(fill.shadowOffsetX, 0, 'a rug does not throw its contact to one side');
  assert.equal(fill.shadowOffsetY, 0, 'nor down the page');
  assert.ok(Math.abs(fill.shadowBlur - CONTACT_BLUR_U * U_DEFAULT) < 1e-9);
  assert.equal(fill.shadowColor, alphaScaled(PALETTE.shadowContact, SHORT_CONTACT_ALPHA));
  assert.notEqual(
    fill.shadowColor,
    PALETTE.shadowContact,
    'a short thing presses as hard as a tall one',
  );
  // A degenerate footprint draws nothing rather than throwing.
  const none = makeRecorder();
  contactUnder(none, 0, 0, 0, 10);
  assert.equal(none.ops.filter((o) => o.op === 'fill').length, 0);
});

test('no painter lays an oval for a contact shadow', () => {
  // By source: the function that drew it is gone from every backdrop module,
  // and the primitives file draws no ellipse at all.
  const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const dir = path.join(PUBLIC, 'render');
  for (const file of fs.readdirSync(dir).filter((n) => /^backdrop.*\.js$/.test(n))) {
    const src = code(fs.readFileSync(path.join(dir, file), 'utf8'));
    assert.doesNotMatch(src, /drawContactShadow\s*\(/, `${file} still lays the contact oval`);
  }
  const paint = code(fs.readFileSync(path.join(dir, 'backdrop-paint.js'), 'utf8'));
  assert.doesNotMatch(paint, /\.ellipse\(/, 'backdrop-paint.js draws an ellipse');
  // And by behaviour: paint every kind there is and look for an ellipse filled
  // in the contact colour. The manager is a person and keeps the one under
  // its feet (`rig-body.js`), which is right for a footprint that small.
  for (const kind of Object.keys(PROP_HEIGHT)) {
    if (kind === 'manager') continue;
    const ctx = makeRecorder();
    paintProp(ctx, { kind, x: 4, y: 6, w: 3, h: 2, angle: 0, id: kind }, U_DEFAULT);
    const ovals = ctx.ops.filter(
      (o) =>
        o.op === 'ellipse' && String(o.fillStyle).startsWith(PALETTE.shadowContact.slice(0, 14)),
    );
    assert.equal(ovals.length, 0, `${kind} lays an oval in the contact colour`);
  }
});

test('WP-78: how tall a prop is, is DECLARED, and every prop the plan emits declares it', () => {
  // The rule this exists to enforce: a size heuristic gets a rug — the biggest
  // and flattest thing in a project room — exactly backwards, so height is a
  // property rather than an inference. A new prop with no entry is a test
  // failure, not a default.
  for (const [kind, height] of Object.entries(PROP_HEIGHT)) {
    assert.ok(height === 'tall' || height === 'short', `${kind} is "${height}"`);
  }

  // (a) every kind a real plan puts on a real floor.
  const projects = [
    { id: 'p0', name: 'p0', sessionCount: 9, tokens: 1 },
    { id: 'p1', name: 'p1', sessionCount: 2, tokens: 1 },
  ];
  const agents = [];
  for (let i = 0; i < 9; i++)
    agents.push({ id: `a${i}`, projectId: 'p0', ackState: 'active', activityState: 'working' });
  for (let i = 0; i < 2; i++)
    agents.push({ id: `b${i}`, projectId: 'p1', ackState: 'active', activityState: 'working' });
  for (let i = 0; i < 30; i++)
    agents.push({
      id: `c${i}`,
      projectId: 'p0',
      ackState: 'benched',
      activityState: 'ended',
      lastActivityAt: 1_800_000_000_000,
    });
  for (let i = 0; i < 6; i++)
    agents.push({
      id: `w${i}`,
      projectId: 'p0',
      ackState: 'active',
      activityState: 'for_review',
      reviewSince: 1_799_000_000_000 + i,
    });
  const plan = buildPlan(projects, agents, { targetAspect: 1.7, now: 1_800_000_000_000 });
  /** @type {Set<string>} */
  const emitted = new Set();
  for (const room of plan.rooms) for (const prop of room.props || []) emitted.add(prop.kind);
  assert.ok(emitted.size > 10, `only ${emitted.size} prop kinds on a fully furnished floor`);
  for (const kind of [...emitted].sort()) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(PROP_HEIGHT, kind),
      `the plan emits "${kind}" and PROP_HEIGHT does not say whether it is tall or short`,
    );
  }

  // (b) and every kind the PAINTERS answer to, including the ones no current
  // population happens to place. A prop that is drawn is a prop that casts.
  const painted = new Set();
  for (const file of [
    'backdrop-props-desk.js',
    'backdrop-props-lounge.js',
    'backdrop-props-play.js',
  ]) {
    const src = fs.readFileSync(path.join(PUBLIC, 'render', file), 'utf8');
    for (const m of src.matchAll(/case '([a-z_0-9]+)':/g)) painted.add(m[1]);
  }
  assert.ok(painted.size > 20, `only ${painted.size} painted kinds were found`);
  for (const kind of [...painted].sort()) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(PROP_HEIGHT, kind),
      `a painter draws "${kind}" and PROP_HEIGHT does not say whether it is tall or short`,
    );
  }

  // An unknown kind reads short rather than throwing or floating, and a prop
  // may still override its own kind.
  assert.equal(isTallProp({ kind: 'no_such_prop' }), false);
  assert.equal(isTallProp({ kind: 'desk' }), true);
  assert.equal(isTallProp({ kind: 'desk', tall: false }), false);
  assert.equal(isTallProp({ kind: 'rug', tall: true }), true);
});

test('WP-78: a tall prop casts along the ray and a short one only meets the floor', () => {
  const box = (kind) => ({ kind, x: 4, y: 6, w: 3, h: 2, angle: 0 });
  const castsOf = (kind) => {
    const ctx = makeRecorder();
    paintProp(ctx, box(kind), U_DEFAULT);
    return ctx.ops.filter((o) => (o.op === 'fill' || o.op === 'fillRect') && o.shadowBlur > 0);
  };

  // A desk: one fill thrown along the light, one pressed straight down.
  const tall = castsOf('user_desk');
  const along = tall.filter((o) => o.shadowOffsetX > 0 && o.shadowOffsetY > 0);
  const under = tall.filter((o) => o.shadowOffsetX === 0 && o.shadowOffsetY === 0);
  assert.ok(along.length > 0, 'a desk stopped casting along the ray');
  assert.ok(under.length > 0, 'a desk does not meet the floor it stands on');
  assert.equal(along.length + under.length, tall.length, 'a desk cast somewhere else');
  for (const op of under) assert.equal(op.shadowColor, PALETTE.shadowContact);
  // The contact is tighter than the cast is long: a line, not a second shadow.
  assert.ok(under[0].shadowBlur < Math.hypot(along[0].shadowOffsetX, along[0].shadowOffsetY));

  const short = castsOf('plant_broad');
  assert.ok(short.length > 0, 'a plant does not meet the floor');
  for (const op of short) {
    assert.equal(op.shadowOffsetX, 0, 'a potted plant slid its shadow sideways');
    assert.equal(op.shadowOffsetY, 0, 'a potted plant dropped its shadow down the page');
    assert.equal(op.shadowColor, alphaScaled(PALETTE.shadowContact, SHORT_CONTACT_ALPHA));
  }

  // A rug is laid, not stood: its contact is its own outline, under it.
  const rug = castsOf('rug');
  assert.ok(rug.length > 0, 'a rug does not meet the floor');
  for (const op of rug) assert.equal(op.shadowOffsetX + op.shadowOffsetY, 0);
});

test("WP-78: a character's shadow is within 1 px of its feet, at every scale it is drawn", () => {
  // The feet point IS `(x, y)`: `drawCharacter` is handed the seat or spot the
  // person is standing on and draws the whole body about it, rotating the legs
  // with the facing rather than hanging them down the page. So the ground
  // contact is the origin, and the ellipse belongs on it.
  //
  // Measured at the LARGEST `u` the floor is ever drawn at, because the offsets
  // are fractions of `u` and a fraction that reads as nothing at the fit scale
  // is 15 px of daylight at the close one.
  for (const u of [7.5, 14, CHAR_MAX_PX_PER_UNIT, 64]) {
    const ctx = makeRecorder();
    drawCharacterShadow(ctx, 120, 240, u);
    const blob = ctx.ops.find((o) => o.op === 'ellipse');
    assert.ok(blob, `no contact shadow was drawn at u=${u}`);
    const off = Math.hypot(blob.x - 120, blob.y - 240);
    assert.ok(off <= 1, `at u=${u} the shadow is ${off.toFixed(2)} px from the feet point`);
  }
  // Stated on the constants too, so the reason survives a refactor of the
  // painter: the offset is zero because it is a decision, not because the
  // painter happens not to add it.
  assert.equal(SHADOW_OX, 0);
  assert.equal(SHADOW_OY, 0);
});

test('a full-height wall casts along the light, and a partition casts what its style says', () => {
  const along = (ctx) =>
    ctx.ops.filter((o) => (o.op === 'fillRect' || o.op === 'fill') && o.shadowOffsetX > 0);
  const seg = (kind) => ({ x1: 0, y1: 4, x2: 20, y2: 4, kind });
  for (const kind of ['exterior', 'solid']) {
    const ctx = makeRecorder();
    paintWallSegment(ctx, seg(kind), U_DEFAULT);
    const cast = along(ctx)[0];
    assert.ok(cast, `a ${kind} wall cast no shadow`);
    assert.ok(cast.shadowOffsetY > 0, `a ${kind} wall's shadow offsets up`);
    const length = Math.hypot(cast.shadowOffsetX, cast.shadowOffsetY) / U_DEFAULT;
    assert.ok(Math.abs(length - SHADOW_U.wallCast) < 1e-9, `a ${kind} wall casts ${length} U`);
  }
  const rows = [];
  try {
    for (const id of PARTITION_STYLE_IDS) {
      applyLook({ ...DEFAULT_LOOK, partitions: id, light: 'evening' }, 'default');
      const style = PARTITION_STYLES[id];
      const ctx = makeRecorder();
      paintWallSegment(ctx, seg('partition'), U_DEFAULT);
      const casts = along(ctx);
      if (style.cast > 0) {
        assert.ok(casts.length > 0, `a ${id} partition cast nothing`);
        const length = Math.hypot(casts[0].shadowOffsetX, casts[0].shadowOffsetY) / U_DEFAULT;
        // In units, and stretched by the mood like every other cast.
        assert.ok(Math.abs(length - style.cast * LIGHT_MOODS.evening.cast) < 1e-9);
        rows.push(`${id} ${length.toFixed(2)} U`);
      } else {
        assert.equal(casts.length, 0, `${id} throws a shadow along the light`);
        // …and still stands on the floor: a contact, straight underneath.
        const under = ctx.ops.filter((o) => o.op === 'fillRect' && o.shadowBlur > 0);
        assert.ok(under.length > 0, `${id} does not meet the floor`);
        rows.push(`${id} none`);
      }
      // The band is as thick as the style says, or the three pixels glass needs.
      const band = wallBand(ctx, seg('partition'), U_DEFAULT);
      assert.ok(band.thickness >= Math.min(3, style.bandU * U_DEFAULT) - 1e-9);
      // A low one stops short of both corners.
      const [from, to] = band.spans[0];
      assert.ok(Math.abs(from - style.insetU * U_DEFAULT) < 1e-9, `${id} starts at ${from}`);
      assert.ok(Math.abs(to - (20 - style.insetU) * U_DEFAULT) < 1e-9);
      // A style with a frame draws it in the frame colour, on both faces.
      if (style.frame) {
        const frame = ctx.ops.filter(
          (o) => o.op === 'fillRect' && o.fillStyle === LOOK.partitions.glassFrame,
        );
        assert.ok(frame.length >= 2, `a ${id} partition has no frame line`);
      }
    }
  } finally {
    resetLook();
  }
  console.log(`  partition casts in evening light — ${rows.join(' · ')}`);
});

test('a stretch of wall is built once, by the strongest wall on it, and stops at a doorway', () => {
  const walls = [
    { x1: 0, y1: 10, x2: 60, y2: 10, kind: 'partition' },
    { x1: 0, y1: 10, x2: 20, y2: 10, kind: 'solid' },
    { x1: 20, y1: 10, x2: 60, y2: 10, kind: 'partition' },
    { x1: 0, y1: 0, x2: 60, y2: 0, kind: 'exterior' },
    { x1: 20, y1: 0, x2: 20, y2: 10, kind: 'solid' },
  ];
  const doors = [{ x: 10, y: 10, angle: -Math.PI / 2, width: 3.5 }];
  const pieces = wallPieces(walls, doors);
  const on = (kind) => pieces.filter((p) => p.kind === kind && p.y1 === 10 && p.y2 === 10);
  const length = (list) => list.reduce((n, p) => n + (p.x2 - p.x1), 0);
  // The solid wall owns its 20 units, less the doorway; the partition has the rest, once.
  assert.ok(Math.abs(length(on('solid')) - (20 - DOOR_OPENING_U)) < 1e-9);
  assert.ok(Math.abs(length(on('partition')) - 40) < 1e-9, 'a shared stretch was built twice');
  assert.equal(on('solid').length, 2, 'the wall does not stop for its door');
  for (const p of on('solid')) {
    assert.ok(p.x2 <= 10 - DOOR_OPENING_U / 2 + 1e-9 || p.x1 >= 10 + DOOR_OPENING_U / 2 - 1e-9);
  }
  // Weakest first, so a full-height wall is painted over a partition's end.
  const ranks = pieces.map((p) => ['partition', 'solid', 'exterior'].indexOf(p.kind));
  assert.deepEqual(
    ranks,
    [...ranks].sort((p, q) => p - q),
  );
  // The plan's own wall list is left as it was handed in.
  assert.equal(walls.length, 5);
  assert.equal(walls[0].x2, 60);
  // A door is a leaf and its swing, and nothing dashed.
  const ctx = makeRecorder();
  let stroked = 0;
  ctx.stroke = () => (stroked += 1);
  paintDoorSwing(ctx, doors[0], U_DEFAULT);
  assert.equal(stroked, 2, 'a door is one leaf and one swing');
});

// ---------------------------------------------------------------- daylight

const ROOM = Object.freeze({ x: 10, y: 0, w: 40, h: 20 });
const ENVELOPE = Object.freeze([
  { x1: 0, y1: 0, x2: 80, y2: 0, kind: 'exterior' },
  { x1: 0, y1: 0, x2: 0, y2: 40, kind: 'exterior' },
  { x1: 0, y1: 40, x2: 80, y2: 40, kind: 'exterior' },
  { x1: 10, y1: 0, x2: 10, y2: 20, kind: 'partition' },
]);

test('daylight comes in through the top and left walls, pane by pane', () => {
  // The room touches the top wall along its own width and nothing on the left
  // but a partition; a room on the bottom wall is lit by neither.
  assert.deepEqual(litRuns(ROOM, ENVELOPE), { top: [[10, 50]], left: [] });
  assert.deepEqual(litRuns({ x: 0, y: 20, w: 10, h: 20 }, ENVELOPE).top, []);
  assert.deepEqual(litRuns({ x: 0, y: 20, w: 10, h: 20 }, ENVELOPE).left, [[20, 40]]);
  const panes = panesAlong(10, 50);
  assert.ok(panes.length >= 8, `${panes.length} panes in forty units of wall`);
  for (const [a, b] of panes) assert.ok(Math.abs(b - a - PANE_U) < 1e-9);
  for (let i = 1; i < panes.length; i++) {
    assert.ok(
      Math.abs(panes[i][0] - panes[i - 1][1] - MULLION_U) < 1e-9,
      'a mullion is the wrong width',
    );
  }
  // Short of both corners, by the same margin: the band is centred.
  assert.ok(panes[0][0] >= 10 + WINDOW_INSET_U - 1e-9);
  assert.ok(panes.at(-1)[1] <= 50 - WINDOW_INSET_U + 1e-9);
  assert.ok(Math.abs(panes[0][0] - 10 - (50 - panes.at(-1)[1])) < 1e-9);
  // A run too short for one pane has none.
  assert.deepEqual(panesAlong(0, PANE_U + 2 * WINDOW_INSET_U - 0.1), []);
});

test('a room takes at most three patches, sheared along the light, and none over its plate', () => {
  for (const id of LIGHT_MOOD_IDS) {
    const light = LIGHT_MOODS[id];
    const patches = daylightPatches(ROOM, windowsOf(ROOM, ENVELOPE), light);
    assert.ok(patches.length > 0 && patches.length <= PATCHES_PER_ROOM, `${id}: ${patches.length}`);
    for (const { poly } of patches) {
      // As wide as its pane at the wall, and the far edge is the near edge
      // moved along the light by the mood's own length.
      assert.ok(Math.abs(poly[1][0] - poly[0][0] - PANE_U) < 1e-9);
      const dx = poly[3][0] - poly[0][0];
      const dy = poly[3][1] - poly[0][1];
      assert.ok(dx > 0 && dy > 0, `${id}: a patch travels up or left`);
      assert.ok(Math.abs(Math.hypot(dx, dy) - PATCH_LENGTH_U * light.cast) < 1e-9);
      assert.ok(Math.abs(dx / dy - light.dir.x / light.dir.y) < 1e-9, `${id}: lit from elsewhere`);
      // Clear of the corner the plate is read in.
      const left = Math.min(...poly.map((p) => p[0]));
      assert.ok(left >= ROOM.x + PLATE_BOX_U.w - 1e-9, `${id}: a patch lies under the plate`);
    }
  }
  // A room no window reaches has a skylight instead, inside it and off the plate.
  const inner = { x: 30, y: 12, w: 20, h: 16 };
  assert.deepEqual(windowsOf(inner, ENVELOPE), { top: [], left: [] });
  const sky = skylightOf(inner);
  assert.ok(sky, 'a windowless room is unlit');
  assert.ok(sky.x >= inner.x && sky.x + sky.w <= inner.x + inner.w);
  assert.ok(sky.y >= inner.y + PLATE_BOX_U.h && sky.y + sky.h <= inner.y + inner.h);
  assert.ok(sky.x + sky.w / 2 < inner.x + inner.w / 2, 'the skylight is set away from the light');
  assert.equal(skylightOf({ x: 0, y: 0, w: 4, h: 4 }), null, 'a cupboard has a skylight');
});

test('the foot of every wall is in shade, deepest under the two the light comes over', () => {
  const ctx = makeRecorder();
  const fills = [];
  ctx.fillRect = (x, y, w, h) => fills.push({ x, y, w, h, style: ctx.fillStyle });
  paintRoomAmbientOcclusion(ctx, 100, 200, 400, 300, U_DEFAULT);
  assert.equal(fills.length, 4, 'a room has four walls');
  const [top, left, bottom, right] = fills;
  const deep = AO_DEPTH_U * AO_LIT_SIDE * U_DEFAULT;
  const shallow = AO_DEPTH_U * U_DEFAULT;
  assert.ok(Math.abs(top.h - deep) < 1e-9 && Math.abs(left.w - deep) < 1e-9);
  assert.ok(Math.abs(bottom.h - shallow) < 1e-9 && Math.abs(right.w - shallow) < 1e-9);
  for (const f of fills) {
    // Inside the room, a linear ramp, darkest at the wall and gone at its depth.
    assert.ok(f.x >= 100 && f.y >= 200 && f.x + f.w <= 500 + 1e-9 && f.y + f.h <= 500 + 1e-9);
    assert.equal(f.style.kind, 'linear');
    assert.match(f.style.stops[0][1], new RegExp(`,${AO_ALPHA}\\)$`));
    assert.match(f.style.stops[1][1], /,0\)$/);
  }
  // The whole of a room's light is clipped to the room, and never throws.
  const whole = makeRecorder();
  paintRoomLight(whole, ROOM, { rx: 140, ry: 0, rw: 560, rh: 280 }, ENVELOPE, U_DEFAULT);
  assert.ok(whole.ops.some((o) => o.op === 'clip'));
  paintRoomLight(makeRecorder(), ROOM, { rx: 0, ry: 0, rw: 0, rh: 0 }, ENVELOPE, U_DEFAULT);
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

// ------------------------------------------------- the device, and the bake

test('a shadow is the designed size on the device: blur and offset scale with it', () => {
  // `shadowBlur` and the two offsets are device pixels whatever the transform
  // says. Unscaled, a display at a pixel ratio of 2 drew every shadow at half
  // the size it was tuned at.
  const plain = makeRecorder();
  setLightShadow(plain, { blur: 8, dist: PROP_SHADOW_DIST_PX });
  assert.equal(plain.shadowBlur, 8, 'a context nobody has spoken for is told what it always was');

  for (const k of [1, 1.132, 1.5, 2, 2.264]) {
    const ctx = makeRecorder();
    setDeviceScale(ctx, k);
    setLightShadow(ctx, { blur: 8, dist: PROP_SHADOW_DIST_PX });
    assert.ok(Math.abs(ctx.shadowBlur - 8 * k) < 1e-9, `blur at ${k}`);
    assert.ok(Math.abs(ctx.shadowOffsetX - plain.shadowOffsetX * k) < 1e-9, `offset x at ${k}`);
    assert.ok(Math.abs(ctx.shadowOffsetY - plain.shadowOffsetY * k) < 1e-9, `offset y at ${k}`);
    // On screen — device pixels over the scale — it is the same shadow.
    assert.ok(Math.abs(ctx.shadowBlur / k - plain.shadowBlur) < 1e-9);
  }
});

test('in a bake a wall is on the device grid: both faces, both ends, whole pixels thick', () => {
  for (const k of [0.536, 1.132, 1.5, 1.699, 2.264, 3.06]) {
    for (const wall of [
      { x1: 3.3, y1: 4.7, x2: 21.9, y2: 4.7, kind: 'exterior' },
      { x1: 7.1, y1: 2.2, x2: 7.1, y2: 30.4, kind: 'solid' },
      { x1: 0, y1: 9.35, x2: 18, y2: 9.35, kind: 'partition', door: { at: 9, width: 3 } },
    ]) {
      const ctx = makeRecorder();
      setDeviceScale(ctx, k);
      paintWallSegment(ctx, wall, U_DEFAULT);
      const rects = ctx.ops.filter((o) => o.op === 'fillRect');
      assert.ok(rects.length >= 1, 'the wall drew nothing');
      for (const r of rects) {
        for (const [name, v] of [
          ['left', r.x * k],
          ['top', r.y * k],
          ['right', (r.x + r.w) * k],
          ['bottom', (r.y + r.h) * k],
        ]) {
          assert.ok(
            Math.abs(v - Math.round(v)) < 1e-6,
            `a ${wall.kind} wall's ${name} edge is at ${v.toFixed(3)} device px at scale ${k}`,
          );
        }
        const thick = Math.min(r.w, r.h) * k;
        assert.ok(thick >= 1 - 1e-6, `a ${wall.kind} wall is ${thick.toFixed(2)} device px thick`);
      }
    }
  }
});

test('a hairline grid in a bake is whole device pixels, and keeps the ink it was designed with', () => {
  // Outside a bake nothing moves: the weave, the grout and the joint are the
  // lines they always were.
  const free = deviceGrid(makeRecorder(), 3, 1);
  assert.deepEqual([free.pitch, free.width, free.alpha, free.at(6)], [3, 1, 1, 6.5]);

  for (const k of [0.536, 0.665, 1, 1.132, 1.5, 1.699, 2, 2.264]) {
    for (const [pitch, width] of [
      [3, 1],
      [22, 0.75],
      [168, 0.75],
    ]) {
      const ctx = makeRecorder();
      setDeviceScale(ctx, k);
      const grid = deviceGrid(ctx, pitch, width);
      const pd = grid.pitch * k;
      const wd = grid.width * k;
      assert.ok(Math.abs(pd - Math.round(pd)) < 1e-9, `pitch ${pitch} at ${k} is ${pd} device px`);
      assert.ok(Math.abs(wd - Math.round(wd)) < 1e-9 && wd >= 1 - 1e-9, `width at ${k} is ${wd}`);
      assert.ok(pd > wd, 'a line as wide as its pitch is a fill');
      // Every line starts and ends on a device pixel.
      for (const v of [0, grid.pitch, grid.pitch * 7]) {
        const top = (grid.at(v) - grid.width / 2) * k;
        assert.ok(Math.abs(top - Math.round(top)) < 1e-6, `a line's edge is at ${top} device px`);
      }
      // Coverage times alpha is the designed coverage, wherever it can be.
      const designed = width / pitch;
      const laid = (wd / pd) * grid.alpha;
      assert.ok(grid.alpha <= 1 && grid.alpha > 0);
      if (grid.alpha < 1) {
        assert.ok(Math.abs(laid - designed) < 1e-9, `the surface changed tone at scale ${k}`);
      } else {
        assert.ok(laid <= designed + 1e-9, 'rounding thickened a line and nothing thinned it');
      }
    }
  }
});

test('a bake is the drawn scale, a window onto it, or the nearest scale under the ceiling', () => {
  // The whole floor, one bitmap pixel to one device pixel.
  const whole = bakeSize(120, 60, 15.85);
  assert.deepEqual(
    [whole.ppu, whole.x, whole.y, whole.w, whole.h, whole.capped],
    [15.85, 0, 0, 1902, 951, false],
  );
  // A floor that is a whole number of pixels wide is not rounded up a column.
  assert.equal(bakeSize(118.4, 60, 2000 / 118.4).w, 2000);

  // A window: clipped to the floor, on whole pixels, at the scale asked for.
  const win = bakeSize(120, 60, 40, { x: -30.5, y: 100.2, w: 2000.9, h: 5000 });
  assert.deepEqual([win.ppu, win.x, win.y, win.w, win.h], [40, 0, 100, 1971, 2300]);

  // Past the ceiling the floor comes back whole, smaller, and under it.
  const big = bakeSize(400, 300, 28);
  assert.equal(big.capped, true);
  assert.ok(big.ppu < 28 && big.ppu > 11, `baked at ${big.ppu}`);
  assert.ok(big.w * big.h <= BAKE_MAX_PIXELS, `${big.w} x ${big.h} is over the ceiling`);
  assert.ok(big.w * big.h > BAKE_MAX_PIXELS * 0.98, 'the fallback gave away more than it had to');
  assert.equal(BAKE_MAX_PIXELS, 16_000_000, '64 MB of RGBA; say so in the changelog if it moves');

  // Nonsense in, the design grid out — never a zero-sized or infinite canvas.
  for (const bad of [0, -3, NaN, Infinity]) {
    const s = bakeSize(10, 10, bad);
    assert.equal(s.ppu, U_DEFAULT);
    assert.ok(s.w >= 1 && s.h >= 1);
  }
});
