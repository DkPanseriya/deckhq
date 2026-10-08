/**
 * WP-99 — juniors read as juniors.
 *
 * Three things were asked for and each is held here as a measurement:
 *
 *   1. SIZE. A junior's box, its name, its halo, the point its cable ends in
 *      and the rect a coach mark points at all follow the one size it is drawn
 *      at (`_figureScale`). The step itself is held in `subagents.test.mjs`.
 *   2. THE TAG. A sub-agent's label is two rows — its role on a chip, then its
 *      name without the mark — and the two rows are ONE box to the collision
 *      pass. The chip's pair clears 4.5:1 on every theme; a lead keeps one row;
 *      no width is measured twice; and the role word is the same word in the
 *      deck's rows and a crew's list.
 *   3. THE ROLE IS `Junior`, AND NOTHING SAYS `Intern`. Nothing the daemon
 *      reads says which sub-agents were started as background tasks, so no
 *      field, type or name turns one into anything else.
 *
 * No DOM and no canvas: stub contexts and the real plan, as the suites beside
 * this one do.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { JUNIOR_MARK, JUNIOR_ROLE, bareName, roleWordFor } from '../../public/names.js';
import { renderDeckTable, renderRestingTable } from '../../public/deck.js';
import { SceneFrame } from '../../public/render/scene-frame.js';
import {
  frameLabelRoles,
  frameLabelTexts,
  planFrameLabels,
} from '../../public/render/scene-frame-labels.js';
import { resolveLabelCollisions } from '../../public/render/label-spots.js';
import {
  ROLE_CHIP_GAP,
  ROLE_CHIP_MIN_PX,
  roleChipColours,
  roleChipFontSize,
} from '../../public/render/name-tag.js';
import {
  BODY_HEIGHT_U,
  LABEL_MIN_PX,
  characterBox,
  drawLabel,
  labelBox,
  labelFontSize,
} from '../../public/render/rig.js';
import { laptopBox } from '../../public/render/rig-laptop.js';
import { drawCrews } from '../../public/render/crew-draw.js';
import { buildPlan } from '../../public/render/plan.js';
import { assignSeats, rigSeatOf, worldToScreen } from '../../public/render/agents.js';
import { computeFill } from '../../public/render/scene-camera.js';
import { JUNIOR_SCALE, characterScaleFor, juniorScaleFor } from '../../public/render/scene-lod.js';
import { overridePalette, resetPalette } from '../../public/render/palette.js';
import { THEMES } from '../../public/render/themes-tables.js';
import {
  GROUND_KEYS,
  contrastRatio,
  materialTokensFor,
} from '../../public/render/themes-derive.js';
import { crewsFrom } from '../../public/floor-rule.js';
import { adoptSnapshotClock } from '../../public/clock.js';
import { forgetTextMetrics } from '../../public/render/text-metrics.js';
import { LARGE_NOW, largeFloor, populationFloor } from '../helpers/large-floor.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Measures like a canvas, and counts how often it was asked. */
function measuringCtx() {
  return {
    font: '10px x',
    measured: 0,
    measureText(text) {
      this.measured++;
      const px = parseFloat(/(\d[\d.]*)px/.exec(this.font)?.[1] ?? '10');
      return { width: String(text).length * px * 0.58 };
    },
  };
}

/** A context that records what was painted, in what, and where. */
function recorder() {
  const calls = [];
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    font: '10px x',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    lineJoin: 'miter',
    measured: 0,
    save() {},
    restore() {},
    closePath() {},
    measureText(text) {
      this.measured++;
      const px = parseFloat(/(\d[\d.]*)px/.exec(this.font)?.[1] ?? '10');
      return { width: String(text).length * px * 0.58 };
    },
  };
  for (const name of [
    'beginPath',
    'moveTo',
    'lineTo',
    'quadraticCurveTo',
    'arc',
    'fill',
    'stroke',
    'fillRect',
    'fillText',
    'strokeText',
  ]) {
    ctx[name] = (...args) =>
      calls.push({ name, args, fill: ctx.fillStyle, stroke: ctx.strokeStyle, font: ctx.font });
  }
  return { calls, ctx };
}

/** One demo population as a frame holds it: plan, seats, records, camera. */
function floorAt(name, viewW = 1600, viewH = 936) {
  adoptSnapshotClock({ now: LARGE_NOW, nowFixed: true });
  const { projects, agents } = name === 'large' ? largeFloor() : populationFloor(name);
  const plan = buildPlan(projects, agents, { stage: { w: viewW, h: viewH }, now: LARGE_NOW });
  const seats = assignSeats(plan, agents);
  const { scale } = computeFill(plan.width, plan.height, viewW, viewH);
  const records = agents
    .filter((a) => seats.has(a.id))
    .map((a) => ({
      ...seats.get(a.id),
      id: a.id,
      targetSeat: seats.get(a.id),
      agent: a,
      path: [],
      clip: 'type',
      clipStartedAt: LARGE_NOW - 5000,
      placement: 'desk',
      seated: true,
      angle: 0,
      initialised: true,
    }))
    .sort((a, b) => a.y - b.y);
  const agentsById = new Map(agents.map((a) => [a.id, a]));
  const scene = Object.create(SceneFrame.prototype);
  Object.assign(scene, {
    canvas: { width: viewW, height: viewH },
    _dpr: 1,
    _camera: { panX: 0, panY: 0 },
    _fitScale: scale,
    _zoom: 1,
    _plan: plan,
    _agentsById: agentsById,
    _runtime: { all: () => records, get: (id) => records.find((r) => r.id === id) },
  });
  const camera = scene._cameraParams();
  const crewCounts = new Map(
    crewsFrom(agents, { now: LARGE_NOW }).map((c) => [c.parentId, c.count]),
  );
  return { scene, plan, seats, scale, records, agents, agentsById, camera, crewCounts };
}

const juniorsOf = (f) => f.records.filter((r) => r.agent.subagent === true);
const leadsOf = (f) => f.records.filter((r) => r.agent.subagent !== true);

// ------------------------------------------------------------------- 1. size

test('SIZE: everything that hangs off a junior is asked the one scale it is drawn at', () => {
  for (const name of ['demo', 'crew', 'large']) {
    const f = floorAt(name);
    const lead = characterScaleFor(f.scale);
    const junior = juniorScaleFor(f.scale);
    assert.ok(juniorsOf(f).length > 0, `${name} has no junior to measure`);
    for (const rec of f.records) {
      const want = rec.agent.subagent === true ? junior : lead;
      assert.equal(f.scene._figureScale(rec.agent), want, `${name}: ${rec.id}`);
      assert.equal(f.scene._scaleOf(rec), want);
      // The rect a coach mark points at is the figure's own drawn box.
      const feet = worldToScreen(rec, f.camera);
      assert.deepEqual(
        f.scene.anchorFor('agent', rec.id),
        characterBox(feet.x, feet.y, want),
        `${name}: ${rec.id}'s anchor is not its drawn box`,
      );
    }
    // A junior's box is one ladder step of a lead's, in both directions.
    const j = f.scene.anchorFor('agent', juniorsOf(f)[0].id);
    const l = f.scene.anchorFor('agent', leadsOf(f)[0].id);
    assert.ok(Math.abs(j.h / l.h - JUNIOR_SCALE) < 1e-9);
    assert.ok(Math.abs(j.w / l.w - JUNIOR_SCALE) < 1e-9);
    assert.ok(Math.abs(j.h - junior * BODY_HEIGHT_U) < 1e-9);
  }
});

test('SIZE: the name pass keeps names off a junior’s drawn body, not off a lead-sized one', () => {
  const f = floorAt('crew');
  const labels = planFrameLabels(measuringCtx(), {
    records: f.records,
    agentsById: f.agentsById,
    camera: f.camera,
    charU: characterScaleFor(f.scale),
    crewCounts: f.crewCounts,
    uOf: (rec) => f.scene._scaleOf(rec),
  });
  for (const rec of juniorsOf(f)) {
    const feet = worldToScreen(rec, f.camera);
    const body = labels.obstacles.find((o) => o.id === `body:${rec.id}`);
    const drawn = characterBox(feet.x, feet.y, juniorScaleFor(f.scale));
    assert.deepEqual({ x: body.x, y: body.y, w: body.w, h: body.h }, drawn);
  }
});

test('SIZE: a crew’s cable ends in the laptop, at the junior’s own scale', () => {
  const f = floorAt('crew');
  const juniorU = juniorScaleFor(f.scale);
  const { calls, ctx } = recorder();
  drawCrews(ctx, {
    records: f.records,
    agentsById: f.agentsById,
    camera: f.camera,
    scale: f.scale,
    charU: characterScaleFor(f.scale),
    juniorU,
    lod: 2,
    reduced: true,
    pinned: null,
    nowMs: LARGE_NOW,
    seatOf: (id) => f.seats.get(id) || null,
    crewCounts: f.crewCounts,
  });
  // One stroked path per member: the `lineTo` before each `stroke` is its end.
  const ends = [];
  calls.forEach((c, i) => {
    if (c.name === 'stroke' && calls[i - 1].name === 'lineTo') ends.push(calls[i - 1].args);
  });
  const crew = juniorsOf(f).filter((r) => r.targetSeat.crew === true);
  assert.equal(ends.length, crew.length, 'a member has no cable');
  for (const rec of crew) {
    const feet = worldToScreen(rec, f.camera);
    const deck = laptopBox(feet.x, feet.y, juniorU);
    const centre = [deck.x + deck.w / 2, deck.y + deck.h / 2];
    assert.ok(
      ends.some((e) => Math.abs(e[0] - centre[0]) < 1e-6 && Math.abs(e[1] - centre[1]) < 1e-6),
      `${rec.id}'s cable does not end in its laptop`,
    );
  }
});

test('SEAT: a junior on bare carpet sits at a laptop; one given furniture sits in it', () => {
  // Two juniors beside their lead (`demo`), five in an arc (`crew`).
  for (const name of ['demo', 'crew']) {
    const f = floorAt(name);
    for (const rec of juniorsOf(f)) {
      assert.equal(rec.targetSeat.junior, true, `${name}: ${rec.id} has a junior place`);
      assert.equal(rigSeatOf(rec, null), 'floor', `${name}: ${rec.id} is not on the floor`);
    }
    for (const rec of leadsOf(f).filter((r) => r.agent.activityState === 'working')) {
      assert.notEqual(rigSeatOf(rec, null), 'floor', `${name}: a lead is on the floor`);
    }
  }
  // A junior at a real desk, or in the reception, has an ordinary seat.
  const rec = (over) => ({ path: [], targetSeat: { x: 1, y: 2 }, seated: true, ...over });
  assert.equal(rigSeatOf(rec({ placement: 'desk' }), null), 'desk');
  assert.equal(rigSeatOf(rec({ placement: 'office' }), null), 'sofa');
});

// -------------------------------------------------------------------- 2. tag

test('ROLE: every sub-agent is a Junior, a lead has no role, and nothing says Intern', () => {
  assert.equal(JUNIOR_ROLE, 'Junior');
  assert.equal(roleWordFor({ subagent: true }), 'Junior');
  for (const lead of [null, undefined, {}, { subagent: false }, { subagent: 'yes' }]) {
    assert.equal(roleWordFor(/** @type {any} */ (lead)), null);
  }
  // Nothing is guessed: not from a flag the snapshot does not carry, not from
  // a type, not from a name. Whatever a sub-agent looks like, it is a Junior.
  const lookalikes = [
    { background: true },
    { runInBackground: true },
    { isAsync: true },
    { subagentType: 'background-task' },
    { subagentType: 'intern' },
    { label: `Intern${JUNIOR_MARK}`, juniorName: 'Intern' },
    { subagentDescription: 'run in background' },
    { workflowId: 'wf_1' },
  ];
  for (const extra of lookalikes) {
    assert.equal(roleWordFor({ subagent: true, ...extra }), 'Junior', JSON.stringify(extra));
  }
  // And the word is not written anywhere a user could read it as a role.
  for (const file of ['public/names.js', 'public/deck-view.js', 'public/app-tooltip.js']) {
    const code = fs
      .readFileSync(path.join(ROOT, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
    assert.doesNotMatch(code, /intern\b/i, `${file} says Intern in code`);
  }
});

test('ROLE: the name under the chip is the name without the mark', () => {
  assert.equal(bareName(`Marta${JUNIOR_MARK}`), 'Marta');
  assert.equal(bareName('Marta'), 'Marta');
  assert.equal(bareName(`MK1.2${JUNIOR_MARK}`), 'MK1.2');
  assert.equal(bareName(JUNIOR_MARK), JUNIOR_MARK, 'a mark alone is not a name to strip');
  assert.equal(bareName(null), '');

  const f = floorAt('demo');
  const texts = frameLabelTexts(f.records, f.agentsById);
  const roles = frameLabelRoles(f.records, f.agentsById);
  for (const rec of juniorsOf(f)) {
    assert.equal(roles.get(rec.id), 'Junior');
    assert.equal(texts.get(rec.id), bareName(rec.agent.label));
    assert.ok(rec.agent.label.endsWith(JUNIOR_MARK), 'the fixture carries the mark');
    assert.ok(!texts.get(rec.id).includes(JUNIOR_MARK), `${texts.get(rec.id)} kept its mark`);
  }
  // A lead keeps one row, and its name exactly.
  for (const rec of leadsOf(f)) {
    assert.equal(roles.has(rec.id), false, `${rec.id} is a lead with a role`);
    assert.equal(texts.get(rec.id), rec.agent.label);
  }
  // A formation says each type once, under the same role word.
  const crew = floorAt('crew');
  const crewTexts = frameLabelTexts(crew.records, crew.agentsById);
  const crewRoles = frameLabelRoles(crew.records, crew.agentsById);
  for (const rec of juniorsOf(crew)) assert.equal(crewRoles.get(rec.id), 'Junior');
  assert.ok([...crewTexts.values()].includes('Explore ×2'));
});

test('TAG: the two rows are one box — the chip over the name, inside it, and centred', () => {
  const ctx = measuringCtx();
  for (const u of [6.4, 10, 16, 22, 40]) {
    for (const [text, px] of [
      ['Marta', undefined],
      ['Bartholomew', undefined],
      ['Mart.', LABEL_MIN_PX],
      ['Explore ×3', undefined],
    ]) {
      const one = labelBox(ctx, 200, 100, u, text, px);
      const two = labelBox(ctx, 200, 100, u, text, px, 'Junior');
      const where = `${text} at u ${u}`;
      // A lead's box is untouched by any of this.
      assert.equal(one.chip, undefined);
      assert.deepEqual(labelBox(ctx, 200, 100, u, text, px, null), one);
      // Same top edge, same centre; deeper by the chip and its gap.
      assert.equal(two.y, one.y, where);
      assert.equal(two.x + two.w / 2, 200, where);
      assert.ok(Math.abs(two.h - (one.h + two.chip.h + ROLE_CHIP_GAP)) < 1e-9, where);
      assert.ok(Math.abs(two.top - (one.top + two.chip.h + ROLE_CHIP_GAP)) < 1e-9, where);
      assert.ok(two.w >= one.w && two.w >= two.chip.w, where);
      // The chip is the first row, wholly inside the box and over the name.
      assert.equal(two.chip.y, two.y);
      assert.ok(two.chip.x >= two.x - 1e-9 && two.chip.x + two.chip.w <= two.x + two.w + 1e-9);
      assert.equal(two.chip.x + two.chip.w / 2, 200);
      assert.ok(two.chip.y + two.chip.h <= two.top, `${where}: the chip is on the name`);
      // Never under its floor, and never larger than the name it sits over.
      const namePx = px || labelFontSize(u);
      assert.equal(two.chip.px, roleChipFontSize(namePx));
      assert.ok(two.chip.px >= ROLE_CHIP_MIN_PX && two.chip.px <= namePx, where);
    }
  }
});

test('TAG: the collision pass moves, shrinks and drops both rows together', () => {
  const ctx = measuringCtx();
  const u = 12;
  const feet = { x: 300, y: 200 };
  const tag = labelBox(ctx, feet.x, feet.y, u, 'Marta', undefined, 'Junior');
  const name = labelBox(ctx, feet.x, feet.y, u, 'Marta');
  const item = (over = {}) => ({
    id: 'j',
    x: tag.x,
    y: tag.y,
    w: tag.w,
    h: tag.h,
    keep: true,
    feet,
    bh: u * BODY_HEIGHT_U,
    side: u * 1.35,
    lift: (tag.chip.h + ROLE_CHIP_GAP) / 2,
    ...over,
  });
  // Clear floor: it hangs where a name hangs.
  assert.deepEqual(resolveLabelCollisions([item()]).get('j'), { offsetY: 0 });
  // Something under the NAME ROW only — below where a one-row label would
  // end — still moves the tag: the box that has to be free is the whole tag.
  const under = { id: 'o', x: tag.x, y: name.y + name.h + 2, w: tag.w, h: 4, pin: true };
  assert.ok(under.y < tag.y + tag.h, 'the obstacle is inside the tag');
  const moved = resolveLabelCollisions([under, item()]).get('j');
  assert.ok(moved && (moved.offsetY !== 0 || moved.offsetX), 'the tag sat on it');
  const one = { ...item(), x: name.x, y: name.y, w: name.w, h: name.h, lift: 0 };
  assert.deepEqual(resolveLabelCollisions([under, one]).get('j'), { offsetY: 0 });
  // And a resting junior's tag with no room is dropped whole, not half.
  const wall = { id: 'w', x: 0, y: 0, w: 2000, h: 2000, pin: true };
  assert.equal(resolveLabelCollisions([wall, item({ keep: false })]).get('j'), null);

  // NEAR is asked of the row nearer the body, so a tag under a small junior's
  // feet is still that junior's. At the legibility floor a junior is 12.8 px:
  // measured from the tag's own centre it would be out of reach where it hangs.
  const small = juniorScaleFor(0);
  const tiny = labelBox(ctx, feet.x, feet.y, small, 'Marta', undefined, 'Junior');
  const at = (lift) =>
    resolveLabelCollisions([
      {
        id: 't',
        x: tiny.x,
        y: tiny.y,
        w: tiny.w,
        h: tiny.h,
        keep: true,
        feet,
        bh: small * BODY_HEIGHT_U,
        side: small * 1.35,
        lift,
      },
    ]).get('t');
  assert.deepEqual(at((tiny.chip.h + ROLE_CHIP_GAP) / 2), { offsetY: 0 });
  assert.notDeepEqual(at(0), { offsetY: 0 }, 'the fixture no longer shows why `lift` exists');
});

test('TAG: on the floor no tag lands on a body or on another label, and no width is measured twice', () => {
  for (const name of ['demo', 'crew', 'large']) {
    forgetTextMetrics();
    const f = floorAt(name, 2000, 1055);
    const ctx = measuringCtx();
    const view = {
      records: f.records,
      agentsById: f.agentsById,
      camera: f.camera,
      charU: characterScaleFor(f.scale),
      crewCounts: f.crewCounts,
      uOf: (rec) => f.scene._scaleOf(rec),
    };
    const first = planFrameLabels(ctx, view);
    const asked = ctx.measured;
    assert.ok(asked > 0);
    // The same frame again: every width is kept, the role word's among them.
    const again = planFrameLabels(ctx, view);
    assert.equal(ctx.measured, asked, `${name}: a width was measured a second time`);
    assert.deepEqual([...again.plan], [...first.plan]);

    const hits = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    const placed = [];
    let tags = 0;
    for (const it of first.labels) {
      const spot = first.plan.get(it.id);
      if (!spot) continue;
      const form = spot.text
        ? it.variants.find((v) => v.text === spot.text && v.px === spot.px) || it
        : spot.px
          ? it.variants.find((v) => v.px === spot.px) || it
          : it;
      placed.push({
        id: it.id,
        x: form.x + (spot.offsetX || 0),
        y: form.y + spot.offsetY,
        w: form.w,
        h: form.h,
      });
      if (first.roles.has(it.id)) tags++;
    }
    assert.ok(tags > 0, `${name}: no sub-agent's tag was placed`);
    const bodies = first.obstacles.filter((o) => String(o.id).startsWith('body:'));
    for (const [i, rect] of placed.entries()) {
      for (const b of bodies) assert.ok(!hits(rect, b), `${name}: ${rect.id} is on ${b.id}`);
      for (let j = i + 1; j < placed.length; j++) {
        assert.ok(!hits(rect, placed[j]), `${name}: ${rect.id} is on ${placed[j].id}`);
      }
    }
  }
});

test('TAG: a formation’s type is never cut to four letters', () => {
  const f = floorAt('crew', 1600, 936);
  const labels = planFrameLabels(measuringCtx(), {
    records: f.records,
    agentsById: f.agentsById,
    camera: f.camera,
    charU: characterScaleFor(f.scale),
    crewCounts: f.crewCounts,
    uOf: (rec) => f.scene._scaleOf(rec),
  });
  const types = new Set(juniorsOf(f).map((r) => r.agent.subagentType));
  let said = 0;
  for (const it of labels.labels) {
    const spot = labels.plan.get(it.id);
    const text = labels.texts.get(it.id);
    if (!types.has(text.replace(/ ×\d+$/, ''))) continue;
    assert.ok(spot, `${text} was dropped`);
    assert.equal(spot.text ?? text, text, `${text} was cut to ${spot.text}`);
    said++;
  }
  assert.equal(said, types.size, 'one label per type');
});

test('TAG: the chip is drawn in tokens, over the name, and measures nothing it has measured', () => {
  const { calls, ctx } = recorder();
  const u = 14;
  const box = labelBox(ctx, 120, 80, u, 'Marta', undefined, 'Junior');
  const before = ctx.measured;
  drawLabel(ctx, 120, 80, u, 'Marta', 6, -4, { role: 'Junior' });
  drawLabel(ctx, 120, 80, u, 'Marta', 6, -4, { role: 'Junior' });
  assert.equal(ctx.measured, before, 'drawing a tag measured its text again');

  const tone = roleChipColours();
  const words = calls.filter((c) => c.name === 'fillText').map((c) => [c.args[0], c.fill]);
  assert.deepEqual(words.slice(0, 2), [
    ['Junior', tone.ink],
    ['Marta', words[1][1]],
  ]);
  assert.notEqual(words[1][1], tone.ink, 'the name is set in the chip’s ink');
  // The chip's fill is painted before either word, and it moved with the tag.
  const fillAt = calls.findIndex((c) => c.name === 'fill' && c.fill === tone.fill);
  const roleAt = calls.findIndex((c) => c.name === 'fillText' && c.args[0] === 'Junior');
  assert.ok(fillAt >= 0 && fillAt < roleAt);
  const start = calls
    .slice(0, fillAt)
    .reverse()
    .find((c) => c.name === 'moveTo');
  assert.ok(
    Math.abs(start.args[1] - (box.chip.y + 6)) <= 1,
    'the chip did not move down with the tag',
  );
  const role = calls[roleAt];
  assert.ok(Math.abs(role.args[1] - (box.chip.x + box.chip.w / 2 - 4)) <= 1);
  // A lead's label paints no chip at all.
  const lead = recorder();
  drawLabel(lead.ctx, 120, 80, u, 'Marta', 0, 0, {});
  assert.equal(
    lead.calls.some((c) => c.fill === tone.fill && c.name === 'fill'),
    false,
  );
  assert.deepEqual(
    lead.calls.filter((c) => c.name === 'fillText').map((c) => c.args[0]),
    ['Marta'],
  );
});

test('CONTRAST: the role chip clears 4.5:1 on every theme, and is not the name’s own plate', () => {
  const hex = (colour) => {
    const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(colour);
    if (!m) return colour;
    return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
  };
  /** @type {Array<[string, string]>} */
  const rows = [];
  try {
    resetPalette();
    const shipped = roleChipColours();
    rows.push(['as shipped', contrastRatio(hex(shipped.ink), hex(shipped.fill)).toFixed(2)]);
    assert.ok(contrastRatio(hex(shipped.ink), hex(shipped.fill)) >= 4.5);
    for (const theme of THEMES) {
      const tokens = materialTokensFor(theme);
      overridePalette(tokens);
      const tone = roleChipColours();
      // Tokens, and only tokens.
      assert.equal(tone.fill, tokens.plateInkSecondary);
      assert.equal(hex(tone.ink), hex(tokens.plateHalo));
      const ratio = contrastRatio(hex(tone.ink), hex(tone.fill));
      rows.push([theme.name, ratio.toFixed(2)]);
      assert.ok(ratio >= 4.5, `${theme.name}: the role word is ${ratio.toFixed(2)}:1 on its chip`);
      // A different background from the name's: the chip is a fill of the ink,
      // where a name stands on the halo.
      assert.notEqual(hex(tone.fill), hex(tokens.plateHalo));
      // And the chip itself is a shape on the floor: 3:1 against every ground
      // a figure stands on, as every other graphic on it is held to.
      for (const key of GROUND_KEYS) {
        if (!theme.floor[key]) continue;
        const onFloor = contrastRatio(hex(tone.fill), theme.floor[key]);
        assert.ok(onFloor >= 3, `${theme.name}: the chip is ${onFloor.toFixed(2)}:1 on the ${key}`);
      }
      resetPalette();
    }
  } finally {
    resetPalette();
  }
  console.log('\n  WP-99, the role word on its chip');
  for (const [k, v] of rows) console.log(`    ${k.padEnd(14)}${v}:1`);
});

// ------------------------------------------------------------ 3. the panels

class StubNode {
  constructor(tagName) {
    this.tagName = String(tagName).toUpperCase();
    this.children = [];
    this.className = '';
    this.attrs = {};
    this._text = null;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }
  get textContent() {
    if (this._text !== null) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
  /** @returns {StubNode[]} every descendant with this class */
  byClass(name) {
    const out = [];
    for (const c of this.children) {
      if (c.className.split(' ').includes(name)) out.push(c);
      out.push(...c.byClass(name));
    }
    return out;
  }
}
const doc = { createElement: (tag) => new StubNode(tag) };

test('PANELS: the deck’s rows and a crew’s list say the role in the floor’s own word', () => {
  const lead = {
    id: 'claude-code:lead',
    label: 'Elif',
    mk: 'MK1.1',
    projectId: 'p',
    ackState: 'active',
    activityState: 'for_review',
    reviewSince: LARGE_NOW - 60_000,
  };
  const junior = (n, name, over = {}) => ({
    id: `claude-code:j${n}`,
    label: `${name}${JUNIOR_MARK}`,
    juniorName: name,
    mk: `MK1.1${JUNIOR_MARK}`,
    projectId: 'p',
    subagent: true,
    parentId: lead.id,
    subagentType: 'Explore',
    ackState: 'active',
    activityState: 'needs_input',
    needsInputSince: LARGE_NOW - 30_000,
    ...over,
  });
  const agents = [lead, junior(1, 'Marta'), junior(2, 'Yogesh')];

  // Folded under a parent that is in the queue: the crew's list.
  const table = renderDeckTable(agents, { now: LARGE_NOW }, doc);
  const items = table.byClass('deck-crew-list')[0].children;
  assert.equal(items.length, 2);
  for (const [i, li] of items.entries()) {
    const chip = li.byClass('deck-role');
    assert.equal(chip.length, 1);
    assert.equal(chip[0].textContent.trim(), roleWordFor(agents[i + 1]));
    assert.equal(li.textContent, `Junior Explore · ${['Marta', 'Yogesh'][i]}`);
    assert.ok(!li.textContent.includes(JUNIOR_MARK));
  }
  // The lead's own row has no role.
  const leadRow = table.byClass('deck-row')[0];
  assert.equal(leadRow.byClass('deck-role').length, 0);
  assert.equal(leadRow.byClass('deck-name')[0].textContent, 'Elif');

  // A junior as a row of its own — its parent is not in this list.
  for (const render of [renderDeckTable, renderRestingTable]) {
    const alone = render([junior(3, 'Hooman')], { now: LARGE_NOW }, doc);
    const row = alone.byClass('deck-row')[0];
    assert.equal(row.byClass('deck-role')[0].textContent.trim(), 'Junior');
    assert.equal(row.byClass('deck-name')[0].textContent, 'Hooman');
    // Its tag is still its parent's with the mark: the identity is unchanged.
    assert.equal(row.byClass('deck-mk')[0].textContent, `MK1.1${JUNIOR_MARK}`);
    assert.equal(row.byClass('deck-who')[0].textContent, `Junior HoomanMK1.1${JUNIOR_MARK}`);
  }
});

test('PANELS: the tooltip says the role with the function the floor’s tag asks', () => {
  // `showTooltip` needs a document; what can be held without one is that it
  // asks `roleWordFor`, puts the word in its own element, and says it first.
  const src = fs.readFileSync(path.join(ROOT, 'public/app-tooltip.js'), 'utf8');
  const at = src.indexOf('export function showTooltip(');
  const body = src.slice(at, src.indexOf('\nexport ', at + 10));
  const role = body.indexOf('roleWordFor(agent)');
  assert.ok(role > 0, 'the tooltip does not ask for the role');
  assert.match(body, /className = 'tooltip-role'/);
  assert.ok(role < body.indexOf('juniorName ||') || role < body.indexOf('b.textContent = name'));
  const css = fs.readFileSync(path.join(ROOT, 'public/style.css'), 'utf8');
  assert.match(css, /\.deck-role,\s*\.tooltip-role\s*\{/);
});
