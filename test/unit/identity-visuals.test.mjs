/**
 * Identity + visual-discipline guards for CONTRACTS-WP15.md §2 (per-project
 * appearance) and its manager-avatar addendum.
 *
 * No DOM: `palette.js` is pure data (must import cleanly in Node — see its
 * own file header) and `rig.js`'s `drawCharacter`/`drawManagerFigure` only
 * ever call methods on the `ctx` object they are handed, so a plain object
 * stub covering those methods is a real, if minimal, CanvasRenderingContext2D
 * for this file's purposes.
 *
 * "Every STATE_COLORS entry is still distinct from every other" already has
 * a test in test/unit/state-visuals.test.mjs ("every state colour is
 * distinguishable from every other") — not duplicated here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PALETTE,
  STATE_COLORS,
  PROJECT_IDENTITIES,
  AVATAR_GLYPHS,
  identityFor,
} from '../../public/render/palette.js';
import { drawCharacter, drawManagerFigure, makePose } from '../../public/render/rig.js';
import { sampleClip } from '../../public/render/clips.js';

// ---------------------------------------------------------------- fake ctx

/**
 * A minimal CanvasRenderingContext2D stand-in: every drawing method is a
 * no-op, every style property is a plain assignable field. Good enough for
 * "does this throw", which is all the drawing tests below check — geometric
 * correctness for the rig is already covered by rig-orientation.test.mjs's
 * point-recording fake context.
 */
function makeFakeCtx() {
  const noop = () => {};
  const ctx = {
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    scale: noop,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    arc: noop,
    ellipse: noop,
    rect: noop,
    fill: noop,
    stroke: noop,
    fillRect: noop,
    strokeRect: noop,
    fillText: noop,
    strokeText: noop,
    setLineDash: noop,
    createLinearGradient: () => ({ addColorStop: noop }),
    measureText: (t) => ({ width: String(t).length * 6 }),
  };
  for (const prop of [
    'fillStyle',
    'strokeStyle',
    'lineWidth',
    'lineCap',
    'lineJoin',
    'globalAlpha',
    'font',
    'textAlign',
    'textBaseline',
  ]) {
    ctx[prop] = null;
  }
  return ctx;
}

// ------------------------------------------------------------- colour maths

/** @param {string} hex @returns {{r:number,g:number,b:number}} */
function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * Plain Euclidean distance in sRGB space: 0 (identical) up to ~441.7 (pure
 * black vs pure white). Computed, not eyeballed — the work order's own
 * instruction for the crimson guard below.
 * @param {string} hexA @param {string} hexB
 * @returns {number}
 */
function colorDistance(hexA, hexB) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

// A distance below this reads as "the same colour" at a glance on the floor
// — comfortably above anti-aliasing/shade noise (single-digit distances) and
// comfortably below "a different colour family entirely" (100+, which is
// where every actual PROJECT_IDENTITIES entry sits relative to crimson —
// see palette.js's own comment on the hue range it was built from).
const SMALL_COLOR_DISTANCE = 60;

// -------------------------------------------------------------- identityFor

test('identityFor is a deterministic, pure function of projectMk', () => {
  for (const mk of [1, 2, 3, 7, 12, 14, 100]) {
    assert.deepEqual(identityFor(mk), identityFor(mk));
  }
});

test('PROJECT_IDENTITIES covers at least 12 projects before identityFor repeats', () => {
  assert.ok(
    PROJECT_IDENTITIES.length >= 12,
    `only ${PROJECT_IDENTITIES.length} identities, CONTRACTS-WP15.md §2 requires >= 12`,
  );
  const seen = new Map();
  for (let mk = 1; mk <= PROJECT_IDENTITIES.length; mk++) {
    const id = identityFor(mk);
    const key = `${id.hair}|${id.accent}`;
    assert.ok(
      !seen.has(key),
      `MK${mk} repeats MK${seen.get(key)}'s hair/accent before all ${PROJECT_IDENTITIES.length} identities were used`,
    );
    seen.set(key, mk);
  }
  // It does eventually cycle, rather than growing unbounded or throwing.
  assert.deepEqual(identityFor(PROJECT_IDENTITIES.length + 1), identityFor(1));
});

test('identityFor always returns a valid glyph from AVATAR_GLYPHS, including for bad projectMk input', () => {
  for (const mk of [0, 1, 2, 5, 11, 12, 13, 25, -3, 1.7, NaN, Infinity, -Infinity]) {
    const id = identityFor(mk);
    assert.ok(
      AVATAR_GLYPHS.includes(id.glyph),
      `projectMk=${mk} -> glyph "${id.glyph}" is not a member of AVATAR_GLYPHS`,
    );
    assert.equal(typeof id.hair, 'string');
    assert.equal(typeof id.accent, 'string');
  }
});

test("an explicit avatar override wins over the derived glyph, but hair/accent stay the project's own", () => {
  const mk = 3;
  const derived = identityFor(mk);
  assert.notEqual(derived.glyph, 'star', 'fixture assumption: MK3 does not natively derive "star"');
  const overridden = identityFor(mk, 'star');
  assert.equal(overridden.glyph, 'star');
  // Hair and accent are project-level, not per-agent — CONTRACTS-WP15.md
  // §2's table gives only the glyph row an override.
  assert.equal(overridden.hair, derived.hair);
  assert.equal(overridden.accent, derived.accent);
});

test('an avatar override that is not a real glyph is ignored, falling back to the derived one', () => {
  const derived = identityFor(5);
  const result = identityFor(5, 'not-a-real-glyph');
  assert.equal(result.glyph, derived.glyph);
  const resultNull = identityFor(5, null);
  assert.equal(resultNull.glyph, derived.glyph);
});

// ------------------------------------------------ COLOUR DISCIPLINE: crimson

test('COLOUR DISCIPLINE: no PROJECT_IDENTITIES hair or accent is within a small colour distance of STATE_COLORS.for_review', () => {
  const crimson = STATE_COLORS.for_review;
  for (const [i, id] of PROJECT_IDENTITIES.entries()) {
    const dHair = colorDistance(id.hair, crimson);
    const dAccent = colorDistance(id.accent, crimson);
    assert.ok(
      dHair > SMALL_COLOR_DISTANCE,
      `PROJECT_IDENTITIES[${i}].hair (${id.hair}) is only ${dHair.toFixed(1)} from crimson (${crimson}); threshold is ${SMALL_COLOR_DISTANCE}`,
    );
    assert.ok(
      dAccent > SMALL_COLOR_DISTANCE,
      `PROJECT_IDENTITIES[${i}].accent (${id.accent}) is only ${dAccent.toFixed(1)} from crimson (${crimson}); threshold is ${SMALL_COLOR_DISTANCE}`,
    );
  }
});

test("COLOUR DISCIPLINE: the manager's suit is a fixed tone, not a state colour, and reads nothing like crimson", () => {
  // The manager is the user, not an agent (WP15 addendum): it must never be
  // mistaken for for_review's "someone is standing in your office".
  for (const [state, colour] of Object.entries(STATE_COLORS)) {
    assert.notEqual(
      PALETTE.managerSuit.toLowerCase(),
      colour.toLowerCase(),
      `PALETTE.managerSuit equals STATE_COLORS.${state} (${colour})`,
    );
  }
  const d = colorDistance(PALETTE.managerSuit, STATE_COLORS.for_review);
  assert.ok(d > SMALL_COLOR_DISTANCE, `managerSuit is only ${d.toFixed(1)} from crimson`);
});

// --------------------------------------------------------------- rendering

test('drawCharacter with an identity does not throw at every LOD', () => {
  const identity = identityFor(4);
  for (const lod of [0, 1, 2]) {
    const ctx = makeFakeCtx();
    const pose = sampleClip('type', 0.3, false);
    pose.bodyAngle = Math.PI / 3;
    assert.doesNotThrow(() => {
      drawCharacter(ctx, pose, {
        x: 40,
        y: 60,
        u: 16,
        lod,
        color: STATE_COLORS.working,
        identity,
        label: 'MK4.1',
        badge: '2d 4h',
        icon: lod === 0 ? null : 'check',
        selected: true,
      });
    }, `lod ${lod} threw with opts.identity set`);
  }
});

test('drawCharacter does not throw for every glyph in AVATAR_GLYPHS (including an unrecognised one)', () => {
  for (const glyph of [...AVATAR_GLYPHS, 'not-a-real-glyph']) {
    const identity = identityFor(2, glyph);
    const ctx = makeFakeCtx();
    const pose = makePose({ armR: { shoulder: 0, elbow: 0, hand: 'rest' } });
    assert.doesNotThrow(() => {
      drawCharacter(ctx, pose, {
        x: 10,
        y: 10,
        u: 14,
        lod: 1,
        color: STATE_COLORS.benched,
        identity,
      });
    }, `glyph "${glyph}" threw`);
  }
});

test('drawCharacter without an identity behaves exactly as before (opts.identity is optional)', () => {
  const ctx = makeFakeCtx();
  const pose = sampleClip('hand_raise', 0.5, false);
  assert.doesNotThrow(() => {
    drawCharacter(ctx, pose, { x: 0, y: 0, u: 14, lod: 2, color: STATE_COLORS.needs_input });
  });
});

test('drawManagerFigure does not throw, for every facing, and never receives state chrome', () => {
  // drawManagerFigure's own opts shape (x, y, u, angle) has no room for a
  // label/badge/icon/identity to begin with — this just confirms it still
  // renders cleanly across the facings a room could plausibly ask for.
  for (const angle of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2]) {
    const ctx = makeFakeCtx();
    assert.doesNotThrow(() => {
      drawManagerFigure(ctx, { x: 50, y: 60, u: 14, angle });
    }, `angle ${angle} threw`);
  }
  // No angle supplied at all (backdrop.js always passes one, but the
  // function should not depend on that).
  const ctx = makeFakeCtx();
  assert.doesNotThrow(() => drawManagerFigure(ctx, { x: 0, y: 0, u: 14 }));
});
