/**
 * A 150-AGENT FLOOR KEEPS ITS WORDS (the 24 September live-floor audit).
 *
 * At the owner's real window — about 2000 x 1154, a 690 px stage, 150 agents
 * across 40 repos — the floor fell to L0 and drew no names, no `N need you`
 * line on any plate, and no crew cables or `+N`. Where it did draw names they
 * landed on the Lounge plate, on bodies and on each other. The rules this file
 * holds, over the `large` demo population (`test/helpers/large-floor.mjs`):
 *
 *   - the level of detail is the figure's drawn height, not the agent count;
 *   - every live agent carries its name, and every room plate its hero line;
 *   - no name lands on a body, a plate or another name;
 *   - a crew says each type once, with a count;
 *   - a plate drops its doing line before its tokens line, and never its hero.
 *
 * Everything is asked of the real plan, the real seats and the frame's own
 * label pass, through a context that only measures.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { crowdedOfficeFloor, largeFloor, LARGE_NOW } from '../helpers/large-floor.mjs';
import { buildPlan } from '../../public/render/plan.js';
import { assignSeats, worldToScreen } from '../../public/render/agents.js';
import { computeFill } from '../../public/render/scene-camera.js';
import { characterScaleFor, JUNIOR_SCALE, lodForFigure } from '../../public/render/scene-lod.js';
import { CREW_SCALE } from '../../public/render/crew.js';
import { rigHeight } from '../../public/render/rig-pose.js';
import { characterBox, drawCharacter } from '../../public/render/rig.js';
import { sampleClip } from '../../public/render/clips.js';
import { STATE_COLORS } from '../../public/render/palette.js';
import {
  buildingRect,
  isLiveAgent,
  frameLabelTexts,
  planFrameLabels,
} from '../../public/render/scene-frame-labels.js';
import { layoutPlate, platePlanFor, PLATE_KEEP_ORDER } from '../../public/render/scene-labels.js';
import { drawCrews } from '../../public/render/crew-draw.js';
import { floorPopulation, crewsFrom } from '../../public/floor-rule.js';
import { adoptSnapshotClock } from '../../public/clock.js';
import { BODY_HEIGHT_U } from '../../public/render/rig-metrics.js';
import {
  abbreviateName,
  NEAR_REACH,
  resolveLabelCollisions,
} from '../../public/render/label-spots.js';

/** Measures like a canvas: width in proportion to the font's px size. */
function measuringCtx() {
  return {
    font: '10px x',
    measureText(text) {
      const px = parseFloat(/(\d[\d.]*)px/.exec(this.font)?.[1] ?? '10');
      return { width: String(text).length * px * 0.58 };
    },
  };
}

const hits = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * The box a label is DRAWN in: its own, or the smaller form the pass chose
 * (`spot.text`/`spot.px`), at the pass's offset.
 * @param {any} item @param {{offsetY:number, offsetX?:number, text?:string, px?:number}} spot
 */
function drawnBox(item, spot) {
  const form = spot.px ? item.variants.find((v) => v.px === spot.px && v.text === spot.text) : item;
  assert.ok(form, `${item.id}: the pass chose a form the item does not have`);
  return {
    id: item.id,
    x: form.x + (spot.offsetX || 0),
    y: form.y + spot.offsetY,
    w: form.w,
    h: form.h,
  };
}

/** The owner's CSS stage (690 px under the header) and the full window's. */
const STAGES = [
  [1420, 690],
  [2000, 1024],
];

/** Build one frame of the large floor at a stage, the way `_draw` does. */
function frameAt(viewW, viewH, floor = largeFloor) {
  adoptSnapshotClock({ now: LARGE_NOW, nowFixed: true });
  try {
    const { projects, agents } = floor();
    const plan = buildPlan(projects, agents, { stage: { w: viewW, h: viewH }, now: LARGE_NOW });
    const seats = assignSeats(plan, agents);
    const { scale } = computeFill(plan.width, plan.height, viewW, viewH);
    const camera = { zoom: scale / 14, panX: 0, panY: 0, U: 14 };
    const charU = characterScaleFor(scale);
    const agentsById = new Map(agents.map((a) => [a.id, a]));
    const records = agents
      .filter((a) => seats.has(a.id))
      .map((a) => ({ ...seats.get(a.id), id: a.id, targetSeat: seats.get(a.id), agent: a }))
      .sort((a, b) => a.y - b.y);
    const pop = floorPopulation(agents, { now: LARGE_NOW });
    const snapshot = { projects, agents, counts: { drawn: { waiting: pop.waiting } } };
    const ctx = measuringCtx();
    const plates = plan.rooms
      .filter((r) => r.kind !== 'corridor')
      .map((room) => ({
        room,
        ...layoutPlate(ctx, room, platePlanFor(room, snapshot, plan), camera),
      }));
    const crewCounts = new Map(
      crewsFrom(agents, { now: LARGE_NOW }).map((c) => [c.parentId, c.count]),
    );
    const labels = planFrameLabels(ctx, {
      records,
      agentsById,
      camera,
      charU,
      crewCounts,
      badgeBoxes: [],
      plateBoxes: plates.map((p) => p.rect),
      selectedId: null,
      bounds: buildingRect(plan, camera),
      uOf: (rec) =>
        rec.agent.subagent === true
          ? characterScaleFor(scale * (rec.targetSeat.crew ? CREW_SCALE : JUNIOR_SCALE))
          : charU,
    });
    return {
      plan,
      seats,
      scale,
      camera,
      charU,
      agents,
      agentsById,
      records,
      plates,
      labels,
      crewCounts,
    };
  } finally {
    adoptSnapshotClock(null);
  }
}

test('F1 · the level of detail is the figure’s drawn height, and nothing else', () => {
  // WP-79: under 30 px of figure the rim, the glyph and the far limb go.
  assert.equal(lodForFigure(29.9), 0);
  assert.equal(lodForFigure(30), 1);
  assert.equal(lodForFigure(80), 2);
  // The same scale gives the same tier however many agents are on the floor:
  // the function takes no count, and the frame asks it of `rigHeight` alone.
  assert.equal(lodForFigure.length, 1);
  assert.equal(lodForFigure(rigHeight(characterScaleFor(8))), 0);
});

test('F1 · at the owner’s window, 150 agents in 40 repos: every live agent is named, every plate keeps its hero', () => {
  for (const [w, h] of STAGES) {
    const f = frameAt(w, h);
    assert.equal(f.agents.length, 150);
    const liveTop = f.records.filter((r) => isLiveAgent(r.agent) && r.targetSeat.crew !== true);
    assert.ok(liveTop.length >= 20, `only ${liveTop.length} live agents seated`);
    for (const rec of liveTop) {
      assert.ok(f.labels.texts.get(rec.id), `${w}x${h}: ${rec.id} has no name`);
      assert.ok(f.labels.plan.get(rec.id), `${w}x${h}: ${rec.agent.label} lost its name`);
    }
    // Every crew type on the floor is said, once, and placed.
    const crew = f.records.filter((r) => r.targetSeat.crew === true);
    assert.ok(crew.length >= 12, 'the crew formed');
    const types = new Set(crew.map((r) => r.agent.subagentType));
    const said = crew.filter((r) => f.labels.texts.get(r.id));
    assert.equal(said.length, types.size, 'one label per distinct type');
    for (const r of said)
      assert.ok(f.labels.plan.get(r.id), `${w}x${h}: ${f.labels.texts.get(r.id)} dropped`);

    // Every plate carries its title and its hero, and a room that needs you
    // says how many.
    for (const p of f.plates) {
      const hero = p.rows.find((row) => row.i === 1);
      assert.ok(hero && hero.text, `${w}x${h}: ${p.room.id} lost its hero line`);
      const project = f.plan.rooms.find((r) => r.id === p.room.id) && p.room.kind === 'project';
      const needs = project ? f.agents.filter((a) => a.projectId === p.room.id) : [];
      const n = needs.filter(
        (a) => a.ackState === 'active' && /for_review|needs_input|stalled/.test(a.activityState),
      ).length;
      if (n > 0) assert.match(hero.text, new RegExp(`^${n}\\b`), `${p.room.id}: "${hero.text}"`);
    }
  }
});

test('F7 · no name lands on a body, a plate or another name', () => {
  for (const [w, h] of STAGES) {
    const f = frameAt(w, h);
    const bodies = f.records.map((r) => {
      const s = worldToScreen(r, f.camera);
      return characterBox(s.x, s.y, f.charU);
    });
    const plates = f.plates.map((p) => p.rect).filter((r) => r.w > 0);
    const placed = [];
    for (const item of f.labels.labels) {
      const spot = f.labels.plan.get(item.id);
      if (spot) placed.push(drawnBox(item, spot));
    }
    // And no name is centred off the building's side walls.
    const b = buildingRect(f.plan, f.camera);
    for (const r of placed) {
      const cx = r.x + r.w / 2;
      assert.ok(cx >= b.x && cx <= b.x + b.w, `${w}x${h}: ${r.id} stepped off the floor`);
    }
    let onBody = 0;
    let onPlate = 0;
    let onName = 0;
    for (const [i, rect] of placed.entries()) {
      for (const b of bodies) if (hits(rect, b)) onBody++;
      for (const p of plates) if (hits(rect, p)) onPlate++;
      for (let j = i + 1; j < placed.length; j++) if (hits(rect, placed[j])) onName++;
    }
    assert.deepEqual(
      { onBody, onPlate, onName },
      { onBody: 0, onPlate: 0, onName: 0 },
      `${w}x${h}`,
    );
  }
});

test('F7 · a crew says each of its types once, with a count', () => {
  const seat = (i, crewOf = 'p') => ({ crew: true, crewOf, crewIndex: i });
  const types = [
    'Explore',
    'general-purpose',
    'general-purpose',
    'Explore',
    'general-purpose',
    'test-engineer',
  ];
  const records = types.map((t, i) => ({
    id: `j${i}`,
    targetSeat: seat(i),
    agent: { id: `j${i}`, subagent: true, subagentType: t, label: `P.j${i}` },
  }));
  records.push({ id: 'p', targetSeat: {}, agent: { id: 'p', label: 'Nova' } });
  const texts = frameLabelTexts(records, new Map());
  assert.equal(texts.get('j0'), 'Explore ×2');
  assert.equal(texts.get('j1'), 'general-purpose ×3');
  assert.equal(texts.get('j5'), 'test-engineer');
  assert.equal(texts.get('p'), 'Nova');
  for (const id of ['j2', 'j3', 'j4']) assert.equal(texts.has(id), false, `${id} repeats a type`);
});

/** One wide project room with every plate line present, at `scale` px/U. */
function plateAt(scale, { w = 30, doing = true } = {}) {
  const room = {
    kind: 'project',
    id: 'p',
    name: 'orbital-api',
    x: 0,
    y: 0,
    w,
    h: 40,
    plateBand: 3.4,
  };
  const plate = {
    lines: [
      'orbital-api',
      '6 need you · oldest 1d 2h',
      doing ? 'Nova · npm test' : '',
      'today 5.8M tok · with cache',
    ],
    heroHead: '6 need you',
    doing: doing ? ['Nova · npm test'] : [],
    dot: STATE_COLORS.for_review,
    tooltip: '',
  };
  return layoutPlate(measuringCtx(), room, plate, { zoom: scale / 14, panX: 0, panY: 0, U: 14 });
}

test('F8 · the collapse order: the doing line goes first, the tokens second, the hero never', () => {
  assert.deepEqual(PLATE_KEEP_ORDER, [
    [0, 1, 2, 3],
    [0, 1, 3],
    [0, 1],
  ]);
  const rowsAt = (scale, opts) => plateAt(scale, opts).rows.map((r) => r.i);
  // Room for everything.
  assert.deepEqual(rowsAt(18), [0, 1, 2, 3]);
  // Room for two lines under the title: the hero and the tokens.
  assert.deepEqual(rowsAt(11), [0, 1, 3]);
  // The owner's 8 px per unit: the title and the hero, and the hero is whole.
  const tight = plateAt(8);
  assert.deepEqual(
    tight.rows.map((r) => r.i),
    [0, 1],
  );
  assert.equal(tight.rows[1].text, '6 need you · oldest 1d 2h');
  // Even under MIN_SCALE the hero is drawn, never dropped.
  assert.deepEqual(rowsAt(6), [0, 1]);
  // And nothing is set under 11 px on the way down.
  for (const s of [6, 8, 11, 14, 18]) {
    for (const r of plateAt(s).rows) assert.ok(r.px >= 11, `${r.px} px at ${s} px/U`);
  }
  // A band that fits the tokens line fits it whether or not a doing line exists.
  assert.deepEqual(rowsAt(11, { doing: false }), [0, 1, 3]);
});

test('F1 · a hero too wide for its plate collapses to the dot and the count', () => {
  const narrow = plateAt(8, { w: 9 });
  const hero = narrow.rows.find((r) => r.i === 1);
  assert.ok(hero.dotted > 0, 'the state dot stays');
  assert.match(hero.text, /^6( need you)?$/);
  const narrower = plateAt(8, { w: 5 });
  assert.equal(narrower.rows.find((r) => r.i === 1).text, '6');
});

test('F1 · the rig draws a name at L0', () => {
  const texts = [];
  const ctx = new Proxy(
    { canvas: {}, globalAlpha: 1, measureText: (t) => ({ width: String(t).length * 6 }) },
    {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'fillText') return (t) => texts.push(t);
        if (key === 'createLinearGradient' || key === 'createRadialGradient')
          return () => ({ addColorStop() {} });
        return () => {};
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    },
  );
  drawCharacter(ctx, sampleClip('type', 0, true), {
    x: 100,
    y: 100,
    u: 8,
    lod: 0,
    color: STATE_COLORS.working,
    state: 'working',
    label: 'Nova',
    reduced: true,
  });
  assert.ok(texts.includes('Nova'), 'no name at L0');
});

test('F1 · a crew’s cables and its +N chip are drawn at L0', () => {
  const f = frameAt(1420, 690);
  const strokes = [];
  const texts = [];
  const ctx = new Proxy(
    { globalAlpha: 1, measureText: (t) => ({ width: String(t).length * 6 }) },
    {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'stroke') return () => strokes.push(1);
        if (key === 'fillText') return (t) => texts.push(t);
        return () => {};
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    },
  );
  drawCrews(ctx, {
    records: f.records,
    agentsById: f.agentsById,
    camera: f.camera,
    scale: f.scale,
    charU: f.charU,
    lod: 0,
    reduced: false,
    pinned: 0,
    nowMs: LARGE_NOW,
    crewCounts: f.crewCounts,
    seatOf: (id) => f.seats.get(id) || null,
  });
  assert.ok(f.scale < 10, `the stage was meant to be tight, got ${f.scale} px/U`);
  assert.ok(strokes.length >= 12, `${strokes.length} cables at L0`);
  assert.ok(texts.includes('+1'), `no +N chip at L0: ${texts.join(', ')}`);
});

// ---------------------------------------------------------------------------
// NAMES STAY NEXT TO THEIR BODIES (the owner's floor, 6 October): five names
// sat in a row across the office rug, a label-height under the standing row in
// front of the top sofa, each clear of everything and none of them anybody's.
// ---------------------------------------------------------------------------

test('near ring · sixteen waiting on the office sofas: every name within 1.2 body heights of its feet, no overlaps', () => {
  // The owner's window (2000 x 1185, a 970 px stage) over the crowded office:
  // sixteen waiting on three sofa runs, the top run with a standing row in
  // front of it, six full rooms and a full lounge — the shape that put those
  // names on the rug.
  const f = frameAt(2000, 970, crowdedOfficeFloor);
  const waiting = f.records.filter(
    (r) =>
      r.agent.subagent !== true && /for_review|needs_input/.test(String(r.agent.activityState)),
  );
  assert.equal(waiting.length, 16);
  const rows = new Set(waiting.map((r) => Math.round(worldToScreen(r, f.camera).y)));
  assert.ok(rows.size >= 3, `the sixteen sit in ${rows.size} rows`);
  assert.equal(NEAR_REACH, 1.2);
  const bh = f.charU * BODY_HEIGHT_U;
  const placed = [];
  for (const item of f.labels.labels) {
    const spot = f.labels.plan.get(item.id);
    if (spot) placed.push(drawnBox(item, spot));
  }
  for (const rec of waiting) {
    const spot = f.labels.plan.get(rec.id);
    assert.ok(spot, `${rec.agent.label} lost its name`);
    assert.notEqual(spot.leader, true, `${rec.agent.label} left its body`);
    const box = placed.find((p) => p.id === rec.id);
    const s = worldToScreen(rec, f.camera);
    const d = Math.hypot(box.x + box.w / 2 - s.x, box.y + box.h / 2 - s.y) / bh;
    assert.ok(d <= 1.2, `${rec.agent.label}'s name is ${d.toFixed(2)} body heights from its feet`);
  }
  // Zero overlaps: no name on a body, on a plate, or on another name.
  const bodies = f.records.map((r) => {
    const s = worldToScreen(r, f.camera);
    return characterBox(s.x, s.y, f.charU);
  });
  const plates = f.plates.map((p) => p.rect).filter((r) => r.w > 0);
  let overlaps = 0;
  for (const [i, rect] of placed.entries()) {
    for (const b of bodies) if (hits(rect, b)) overlaps++;
    for (const p of plates) if (hits(rect, p)) overlaps++;
    for (let j = i + 1; j < placed.length; j++) if (hits(rect, placed[j])) overlaps++;
  }
  assert.equal(overlaps, 0);
});

test('near ring · a crowded name shrinks, then abbreviates, and only then moves, with a leader', () => {
  assert.equal(abbreviateName('Cassio'), 'Cass.');
  assert.equal(abbreviateName('Nova'), 'Nova', 'four letters is already as short as it gets');
  assert.equal(abbreviateName('general-purpose ×3'), 'general-purpose ×3');
  assert.equal(abbreviateName('Marta·jr', '·jr'), 'Mart·jr', 'a junior keeps its mark');
  assert.equal(abbreviateName('Ines·jr', '·jr'), 'Ines·jr');
  // One figure, feet at (100, 100), a body 40 px tall, between two pinned walls
  // that leave a 32 px gap under it and a ceiling over its head.
  const label = (w) => ({ x: 100 - w / 2, y: 120, w, h: 14 });
  const walls = [
    { id: 'west', x: 0, y: 40, w: 84, h: 110, pin: true },
    { id: 'east', x: 116, y: 40, w: 200, h: 110, pin: true },
    { id: 'ceiling', x: 0, y: 0, w: 316, h: 40, pin: true },
  ];
  const item = {
    id: 'a',
    ...label(40),
    keep: true,
    up: -60,
    feet: { x: 100, y: 100 },
    bh: 40,
    side: 12,
    variants: [
      { ...label(36), text: 'Cassio', px: 11 },
      { ...label(30), text: 'Cass.', px: 11 },
    ],
  };
  // 40 px and the shrunk 36 px do not fit the gap; the abbreviation does.
  assert.deepEqual(resolveLabelCollisions([...walls, item]).get('a'), {
    offsetY: 0,
    text: 'Cass.',
    px: 11,
  });
  // Fill the gap: nothing near is clear, so the name moves, and says whose it is.
  const closed = [...walls, { id: 'gap', x: 84, y: 40, w: 32, h: 110, pin: true }];
  const moved = resolveLabelCollisions([...closed, item]).get('a');
  assert.equal(moved?.leader, true);
  assert.equal(moved?.text, 'Cass.');
  // A resting figure's name is not drawn rather than moved away from its body.
  assert.equal(resolveLabelCollisions([...closed, { ...item, keep: false }]).get('a'), null);
});
