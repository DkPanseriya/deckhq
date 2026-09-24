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

import { largeFloor, LARGE_NOW } from '../helpers/large-floor.mjs';
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

/** The owner's CSS stage (690 px under the header) and the full window's. */
const STAGES = [
  [1420, 690],
  [2000, 1024],
];

/** Build one frame of the large floor at a stage, the way `_draw` does. */
function frameAt(viewW, viewH) {
  adoptSnapshotClock({ now: LARGE_NOW, nowFixed: true });
  try {
    const { projects, agents } = largeFloor();
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
      if (!spot) continue;
      placed.push({
        id: item.id,
        x: item.x + (spot.offsetX || 0),
        y: item.y + spot.offsetY,
        w: item.w,
        h: item.h,
      });
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
