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
  AGENT_SKINS,
  AGENT_HAIR_STYLES,
  AGENT_ACCENTS,
  AGENT_BUILDS,
  RARE_HAIR_COLORS,
  JACKET_COLORS,
  CROWN_GOLD,
  RARITY_TARGETS,
  RARITY_TRAITS,
  appearanceFor,
  rarityWord,
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

// ============================================================ WP-20: rarity
//
// docs/plan/04 §4 and docs/plan/08 §7: a stable per-session appearance with
// rarity tiers on the AGENT. The three things that must stay true are that it
// is deterministic, that it never comes near a state colour, and that the
// torso still carries the state at full strength.

/**
 * A recording context: every fill and stroke is logged with the style it was
 * painted in and the geometry it covered, which is what the torso-legibility
 * tests below actually need to assert. (`makeFakeCtx` above answers "does it
 * throw"; `rig-orientation.test.mjs`'s answers "is it in the right place".)
 */
function makeRecordingCtx() {
  const calls = [];
  let path = [];
  const ctx = {
    save: () => {},
    restore: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    beginPath: () => {
      path = [];
    },
    closePath: () => {},
    moveTo: (x, y) => path.push({ x, y }),
    lineTo: (x, y) => path.push({ x, y }),
    quadraticCurveTo: (cx, cy, x, y) => path.push({ x, y }),
    arc: (x, y, r) => path.push({ x, y, r, shape: 'arc' }),
    ellipse: (x, y, rx, ry) => path.push({ x, y, rx, ry, shape: 'ellipse' }),
    rect: () => {},
    fill: () => calls.push({ op: 'fill', style: ctx.fillStyle, alpha: ctx.globalAlpha, path }),
    stroke: () =>
      calls.push({
        op: 'stroke',
        style: ctx.strokeStyle,
        width: ctx.lineWidth,
        alpha: ctx.globalAlpha,
        path,
      }),
    fillRect: (x, y, w, h) =>
      calls.push({ op: 'fillRect', style: ctx.fillStyle, path: [{ x, y, w, h }] }),
    strokeRect: () => {},
    fillText: (text, x, y) => calls.push({ op: 'fillText', style: ctx.fillStyle, text, x, y }),
    strokeText: () => {},
    setLineDash: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    measureText: (t) => ({ width: String(t).length * 6 }),
  };
  ctx.fillStyle = null;
  ctx.strokeStyle = null;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 1;
  ctx.lineCap = null;
  ctx.lineJoin = null;
  ctx.font = null;
  ctx.textAlign = null;
  ctx.textBaseline = null;
  return { calls, ctx };
}

/** Ten thousand fixed synthetic ids — the same ten thousand on every run. */
function syntheticIds(n = 10000) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(`session-${i}`);
  return out;
}

// ---------------------------------------------------------- determinism

test('WP-20: the same session id gives the same appearance and the same tier, always', () => {
  for (const id of ['a', 'session-7', 'claude-code:9f2c-4410-abcd', '', 'zzz']) {
    assert.deepEqual(appearanceFor(id), appearanceFor(id));
  }
});

test('WP-20 STABILITY: appearance survives a restart — a fresh module gives identical faces', async () => {
  // A genuinely separate module instance, not the cached one: this is the
  // "across daemon restarts" claim, tested rather than asserted, and it also
  // proves nothing about a face is held in module state.
  const fresh = await import('../../public/render/palette.js?wp20-restart');
  assert.notEqual(fresh.appearanceFor, appearanceFor, 'expected a genuinely fresh module');
  for (const id of syntheticIds(500)) {
    assert.deepEqual(fresh.appearanceFor(id), appearanceFor(id), `${id} drifted across a restart`);
  }
});

test('WP-20: every appearance field is drawn from its declared vocabulary, for any input', () => {
  const inputs = [...syntheticIds(200), '', null, undefined, 42, 'x'.repeat(400)];
  for (const id of inputs) {
    const a = appearanceFor(/** @type {any} */ (id));
    assert.ok(AGENT_HAIR_STYLES.includes(a.hairStyle), `${id}: hairStyle ${a.hairStyle}`);
    assert.ok(AGENT_SKINS.includes(a.skin), `${id}: skin ${a.skin}`);
    assert.ok(AGENT_ACCENTS.includes(a.accent), `${id}: accent ${a.accent}`);
    assert.ok(AGENT_BUILDS.includes(a.build), `${id}: build ${a.build}`);
    assert.equal(typeof a.glasses, 'boolean');
    assert.ok(Object.keys(RARITY_TARGETS).includes(a.tier), `${id}: tier ${a.tier}`);
    if (a.tier === 'common') {
      assert.equal(a.trait, null, 'a common agent has no trait — that is what common means');
      assert.equal(a.traitColor, null);
    } else {
      assert.ok(RARITY_TRAITS[a.tier].includes(a.trait), `${id}: ${a.tier} trait ${a.trait}`);
      assert.ok(a.traitColor, `${id}: a trait with no colour to draw it in`);
    }
    // A rare hair colour is the only thing allowed to overrule the project's.
    if (a.hairColor !== null) {
      assert.equal(a.trait, 'hair');
      assert.ok(RARE_HAIR_COLORS.includes(a.hairColor));
    }
  }
});

// ------------------------------------------------------------ distribution

test('WP-20: the tier split over 10,000 ids is within 20% of the published targets', () => {
  const ids = syntheticIds();
  const counts = { common: 0, uncommon: 0, rare: 0, legendary: 0 };
  for (const id of ids) counts[appearanceFor(id).tier]++;

  const report = Object.entries(counts)
    .map(([tier, n]) => `${tier} ${(n / ids.length) * 100}%`)
    .join(', ');
  for (const [tier, target] of Object.entries(RARITY_TARGETS)) {
    const share = counts[tier] / ids.length;
    assert.ok(
      share >= target * 0.8 && share <= target * 1.2,
      `${tier}: ${(share * 100).toFixed(2)}% is outside ±20% of the ${(target * 100).toFixed(
        0,
      )}% target — ${report}`,
    );
  }
  // Both traits inside a tier get used; a tier with one dead branch would
  // silently halve the variety the whole mechanic exists for.
  const traits = new Set(ids.map((id) => appearanceFor(id).trait));
  for (const tier of ['uncommon', 'rare', 'legendary']) {
    for (const trait of RARITY_TRAITS[tier]) {
      assert.ok(traits.has(trait), `no agent in 10,000 drew the ${tier} trait "${trait}"`);
    }
  }
});

test('WP-20: rarityWord is a word for uncommon and better, and nothing at all for common', () => {
  assert.equal(rarityWord('common'), null);
  assert.equal(rarityWord('uncommon'), 'uncommon');
  assert.equal(rarityWord('rare'), 'rare');
  assert.equal(rarityWord('legendary'), 'legendary');
  assert.equal(rarityWord('nonsense'), null);
  assert.equal(rarityWord(undefined), null);
  // It is a word, never a number: nothing here may parse as one, or the
  // interface would be a step away from scoring the human (08 §1.1 rule 6).
  for (const tier of ['uncommon', 'rare', 'legendary']) {
    assert.ok(Number.isNaN(Number(rarityWord(tier))));
  }
});

// -------------------------------------------- COLOUR DISCIPLINE: appearance

test('COLOUR DISCIPLINE: no appearance colour is near crimson, or near ANY state colour', () => {
  // Stricter than the project-identity guard above, and for the same reason
  // one level up: crimson must mean exactly one thing, and every OTHER state
  // colour is a thing an agent's clothes must not be able to imitate either.
  const tables = {
    AGENT_ACCENTS,
    RARE_HAIR_COLORS,
    JACKET_COLORS,
    CROWN_GOLD: [CROWN_GOLD],
  };
  for (const [name, list] of Object.entries(tables)) {
    for (const [i, colour] of [...list].entries()) {
      for (const [state, value] of Object.entries(STATE_COLORS)) {
        const d = colorDistance(colour, value);
        assert.ok(
          d > SMALL_COLOR_DISTANCE,
          `${name}[${i}] (${colour}) is only ${d.toFixed(1)} from STATE_COLORS.${state} (${value})`,
        );
      }
    }
  }
});

// Skin's own bar, deliberately lower than the clothing bar above — see the
// AGENT_SKINS comment in palette.js for the argument. Still a real floor: at
// 40, a head is never at risk of dissolving into the torso under it.
const SKIN_MIN_COLOR_DISTANCE = 40;

test('COLOUR DISCIPLINE: no skin tone can dissolve into a state colour', () => {
  for (const [i, skin] of AGENT_SKINS.entries()) {
    for (const [state, value] of Object.entries(STATE_COLORS)) {
      const d = colorDistance(skin, value);
      assert.ok(
        d > SKIN_MIN_COLOR_DISTANCE,
        `AGENT_SKINS[${i}] (${skin}) is only ${d.toFixed(1)} from STATE_COLORS.${state} (${value})`,
      );
    }
  }
  // Crimson gets a tighter bar than the other states even here — it is the one
  // colour that must mean exactly one thing — but not the full clothing bar of
  // 60. The medium-deep skin range genuinely sits between crimson on one side
  // and copper/olive on the other; a 60 floor would have meant this product
  // could not draw a whole range of real faces in order to protect a channel
  // that skin does not carry. 50 is the honest number: the tightest tone is
  // 52.1 away, and it is a desaturated brown, which sRGB distance understates.
  // See docs/DEVIATIONS.md.
  for (const [i, skin] of AGENT_SKINS.entries()) {
    const d = colorDistance(skin, STATE_COLORS.for_review);
    assert.ok(d > 50, `AGENT_SKINS[${i}] (${skin}) is only ${d.toFixed(1)} from crimson`);
  }
});

test('WP-20: skin tones are actually distinguishable from each other', () => {
  for (let i = 0; i < AGENT_SKINS.length; i++) {
    for (let j = i + 1; j < AGENT_SKINS.length; j++) {
      const d = colorDistance(AGENT_SKINS[i], AGENT_SKINS[j]);
      assert.ok(d > 40, `AGENT_SKINS[${i}] and [${j}] are only ${d.toFixed(1)} apart`);
    }
  }
});

// ------------------------------------------------- STATE STAYS ON THE TORSO

/**
 * The torso: the filled ellipse whose centre is nearest the character's own
 * origin. Nearest rather than largest, because the contact shadow is a WIDER
 * ellipse (SHADOW_RX 0.86 vs TORSO_RX 0.82) — it is just offset down and to
 * the side, which is exactly what distinguishes it.
 */
function torsoFill(calls, cx, cy) {
  const fills = calls.filter(
    (c) => c.op === 'fill' && c.path.length === 1 && c.path[0].shape === 'ellipse',
  );
  assert.ok(fills.length > 0, 'no filled ellipse was drawn at all');
  const from = (c) => Math.hypot(c.path[0].x - cx, c.path[0].y - cy);
  return fills.reduce((a, b) => (from(b) < from(a) ? b : a));
}

test('LEGIBILITY: the torso is filled with the state colour, at full strength, for every appearance', () => {
  // The whole legibility model (VISUAL-SPEC §3, §5) is that the body colour IS
  // the state. Appearance rides on everything else; if this ever fails, the
  // floor has stopped answering the only question it exists to answer.
  const colour = STATE_COLORS.for_review;
  for (const id of syntheticIds(400)) {
    const appearance = appearanceFor(id);
    for (const lod of [0, 1, 2]) {
      const { calls, ctx } = makeRecordingCtx();
      const pose = sampleClip('type', 0.3, false);
      pose.bodyAngle = 1.1;
      drawCharacter(ctx, pose, {
        x: 90,
        y: 70,
        u: 18,
        lod,
        color: colour,
        identity: identityFor(3),
        appearance,
        label: 'Ada',
        icon: 'check',
      });
      const torso = torsoFill(calls, 90, 70);
      assert.equal(
        torso.style,
        colour,
        `${id} (${appearance.tier}/${appearance.trait}) at lod ${lod}: torso filled ${torso.style}`,
      );
      assert.equal(torso.alpha, 1, `${id} at lod ${lod}: the torso was drawn at reduced opacity`);
    }
  }
});

test('LEGIBILITY: no appearance mark is a filled shape over the torso — every one is an edge or off-body', () => {
  // A second, independent guard on the same rule as above. It is not enough
  // that the torso is painted in the state colour; nothing may then be painted
  // over the top of it at torso scale.
  const colour = STATE_COLORS.working;
  for (const id of syntheticIds(400)) {
    const appearance = appearanceFor(id);
    const { calls, ctx } = makeRecordingCtx();
    drawCharacter(ctx, makePose(), {
      x: 0,
      y: 0,
      u: 20,
      lod: 2,
      color: colour,
      identity: identityFor(2),
      appearance,
    });
    const torso = torsoFill(calls, 0, 0);
    const torsoRy = torso.path[0].ry;
    // Anything big AND sitting on the body centre would be covering the state.
    // A hat is big but sits on the head, a contact shadow is big but sits at
    // the feet, an aura is big but is drawn at 16% opacity behind everything —
    // all three are what this test must not confuse for a cover-up.
    const covering = calls.filter(
      (c) =>
        c.op === 'fill' &&
        c !== torso &&
        c.style !== colour &&
        c.alpha === 1 &&
        c.path.some((p) => (p.ry || p.r || 0) >= torsoRy * 0.8 && Math.hypot(p.x, p.y) < 0.3 * 20),
    );
    assert.deepEqual(
      covering.map((c) => c.style),
      [],
      `${id} (${appearance.tier}/${appearance.trait}) paints a torso-scale shape over the state colour`,
    );
  }
});

test('LEGIBILITY: the chrome above the head is byte-identical with and without an appearance', () => {
  // The state icon, the waiting badge and the name label are the things the
  // user acts on. Appearance is drawn strictly below them and must not move,
  // recolour or displace any of it — at any LOD.
  const opts = {
    x: 120,
    y: 140,
    u: 22,
    color: STATE_COLORS.needs_input,
    identity: identityFor(6),
    label: 'Ada',
    badge: '2d 4h',
    icon: 'hand',
  };
  // A deliberately common appearance: a hat or a crown IS above the head, and
  // is the one thing allowed up there besides the chrome.
  const plain = syntheticIds(400)
    .map(appearanceFor)
    .find((a) => a.tier === 'common');
  assert.ok(plain, 'fixture assumption: at least one of 400 ids is common');

  for (const lod of [1, 2]) {
    const pose = sampleClip('hand_raise', 0.4, false);
    const headTopY = opts.y - 0.95 * opts.u - 0.5 * opts.u;
    const above = (calls) =>
      calls.filter((c) =>
        c.op === 'fillText'
          ? c.y <= headTopY
          : (c.path || []).length > 0 && c.path.every((p) => p.y <= headTopY),
      );

    const a = makeRecordingCtx();
    drawCharacter(a.ctx, pose, { ...opts, lod, appearance: null });
    const b = makeRecordingCtx();
    drawCharacter(b.ctx, pose, { ...opts, lod, appearance: plain });

    assert.deepEqual(above(b.calls), above(a.calls), `lod ${lod}: appearance disturbed the chrome`);
  }
});

// ----------------------------------------------------------- rendering, again

test('drawCharacter with an appearance does not throw, for every trait and every LOD', () => {
  const seen = new Set();
  for (const id of syntheticIds(3000)) {
    const appearance = appearanceFor(id);
    const key = `${appearance.trait}|${appearance.hairStyle}|${appearance.glasses}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const lod of [0, 1, 2]) {
      const ctx = makeFakeCtx();
      const pose = sampleClip('walk', 0.7, false);
      pose.bodyAngle = -2.1;
      assert.doesNotThrow(() => {
        drawCharacter(ctx, pose, {
          x: 12,
          y: 30,
          u: 16,
          lod,
          color: STATE_COLORS.stalled,
          identity: identityFor(9),
          appearance,
          label: 'Ada',
        });
      }, `lod ${lod} threw for ${key}`);
    }
  }
  // Every trait, every hair style and both glasses states were exercised.
  assert.ok(seen.size >= 2 * AGENT_HAIR_STYLES.length, `only ${seen.size} combinations covered`);
});

test('drawCharacter tolerates a malformed appearance rather than crashing the floor', () => {
  for (const appearance of [
    {},
    { skin: null, build: 0, hairStyle: 'nonsense', trait: 'nonsense', traitColor: null },
    { build: NaN, glasses: true },
  ]) {
    const ctx = makeFakeCtx();
    assert.doesNotThrow(
      () => {
        drawCharacter(ctx, makePose(), {
          x: 0,
          y: 0,
          u: 14,
          lod: 2,
          color: STATE_COLORS.benched,
          appearance,
        });
      },
      `threw on ${JSON.stringify(appearance)}`,
    );
  }
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
