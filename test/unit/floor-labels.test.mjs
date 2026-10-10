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

import {
  crowdedOfficeFloor,
  LARGE_NOW,
  ownerShapedFloor,
  populationFloor,
} from '../helpers/large-floor.mjs';
import { drawnBox, frameAt, hits, measuringCtx } from '../helpers/label-frame.mjs';
import { cloudBox, placeClouds } from '../../public/render/cloud-spots.js';
import { drawDots } from '../../public/render/rig-props.js';
import { buildPlan } from '../../public/render/plan.js';
import { worldToScreen } from '../../public/render/agents.js';
import { characterScaleFor, lodForFigure } from '../../public/render/scene-lod.js';
import { rigHeight } from '../../public/render/rig-pose.js';
import { characterBox, drawCharacter } from '../../public/render/rig.js';
import { sampleClip } from '../../public/render/clips.js';
import { STATE_COLORS } from '../../public/render/palette.js';
import {
  buildingRect,
  isLiveAgent,
  frameLabelTexts,
  wallBoxes,
} from '../../public/render/scene-frame-labels.js';
import { layoutPlate, PLATE_KEEP_ORDER } from '../../public/render/scene-labels.js';
import { sofaPlacesOn } from '../../public/render/plan-office-seats.js';
import { drawCrews } from '../../public/render/crew-draw.js';
import { adoptSnapshotClock } from '../../public/clock.js';
import { BODY_HEIGHT_U } from '../../public/render/rig-metrics.js';
import {
  abbreviateName,
  LOWER_REACH,
  NEAR_REACH,
  resolveLabelCollisions,
} from '../../public/render/label-spots.js';

/** The owner's CSS stage (690 px under the header) and the full window's. */
const STAGES = [
  [1420, 690],
  [2000, 1024],
];

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
      return characterBox(s.x, s.y, f.uOf(r));
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

test('near ring · sixteen waiting on the office sofas: all seated, every name within 1.6 body heights of its feet, no overlaps', () => {
  // The owner's window (2000 x 1185, a 970 px stage) over the crowded office:
  // sixteen waiting on three sofa runs, six full rooms and a full lounge — the
  // shape that once stood five of them on the rug with their names in a row
  // under nobody.
  const f = frameAt(2000, 970, crowdedOfficeFloor);
  const waiting = f.records.filter(
    (r) =>
      r.agent.subagent !== true && /for_review|needs_input/.test(String(r.agent.activityState)),
  );
  assert.equal(waiting.length, 16);
  assert.equal(waiting.filter((r) => r.targetSeat.standing).length, 0, 'somebody is standing');
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
    // The second level is the one name that is meant to be on a leader.
    const lower = rec.targetSeat.nameRow === 1;
    if (!lower) assert.notEqual(spot.leader, true, `${rec.agent.label} left its body`);
    const box = placed.find((p) => p.id === rec.id);
    const s = worldToScreen(rec, f.camera);
    const d = Math.hypot(box.x + box.w / 2 - s.x, box.y + box.h / 2 - s.y) / bh;
    const reach = lower ? LOWER_REACH : NEAR_REACH;
    assert.ok(
      d <= reach + 1e-6,
      `${rec.agent.label}'s name is ${d.toFixed(2)} body heights from its feet`,
    );
  }
  // Zero overlaps: no name on a body, on a plate, or on another name.
  const bodies = f.records.map((r) => {
    const s = worldToScreen(r, f.camera);
    return characterBox(s.x, s.y, f.uOf(r));
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

// ---------------------------------------------------------------------------
// THE OFFICE OF SIXTEEN, WITH ITS BADGES (the owner's floor at 2000 x 1185):
// where the top sofa met the corner, wait badges and names stood in a stack,
// a name two rows from its body and another figure's badge between them.
// ---------------------------------------------------------------------------

const OFFICES_OF_SIXTEEN = /** @type {const} */ ([
  ['the crowded office', 2000, 970, crowdedOfficeFloor],
  ['the owner-shaped floor', 2000, 1060, ownerShapedFloor],
]);

test('the office of sixteen · badges, names and bodies never overlap, and a badge stays over its own head', () => {
  for (const [name, w, h, floor] of OFFICES_OF_SIXTEEN) {
    const f = frameAt(w, h, floor, { badges: true });
    const waiting = f.records.filter(
      (r) => r.agent.ackState === 'active' && /for_review|needs_input/.test(r.agent.activityState),
    );
    assert.equal(waiting.length, 16, name);
    assert.equal(waiting.filter((r) => r.targetSeat.standing).length, 0, `${name}: standing`);
    // Nobody's time was folded into a pill: every badge that exists is drawn.
    assert.equal(f.badgePlan.pills.length, 0, `${name}: badges collided into a pill`);
    assert.ok(f.badgeBoxes.length >= 12, `${name}: ${f.badgeBoxes.length} badges`);

    const bh = f.charU * BODY_HEIGHT_U;
    const at = new Map(f.records.map((r) => [r.id, worldToScreen(r, f.camera)]));
    const bodies = f.records.map((r) => ({
      id: r.id,
      // The box each is DRAWN in: a junior's is a ladder step smaller (WP-99).
      ...characterBox(at.get(r.id).x, at.get(r.id).y, f.uOf(r)),
    }));
    const names = [];
    for (const item of f.labels.labels) {
      const spot = f.labels.plan.get(item.id);
      if (spot) names.push(drawnBox(item, spot));
    }
    const found = { badgeOnBadge: 0, badgeOnBody: 0, nameOnBody: 0, nameOnBadge: 0, nameOnName: 0 };
    for (const [i, b] of f.badgeBoxes.entries()) {
      const own = b.id.slice(6);
      // The office's plate stops short of the badge over its first cushion.
      for (const p of f.plates) assert.ok(!hits(b, p.rect), `${name}: a badge is under a plate`);
      for (const body of bodies) if (body.id !== own && hits(b, body)) found.badgeOnBody++;
      for (let j = i + 1; j < f.badgeBoxes.length; j++)
        if (hits(b, f.badgeBoxes[j])) found.badgeOnBadge++;
      // Over its own head, and near it: the top of the head to the badge's
      // centre is under a body and a half.
      const s = at.get(own);
      assert.ok(Math.abs(b.x + b.w / 2 - s.x) < 0.5, `${name}: a badge is not over its head`);
      const rise = s.y - bh - (b.y + b.h / 2);
      assert.ok(rise > 0 && rise <= 1.5 * bh, `${name}: a badge is ${rise / bh} bodies up`);
    }
    for (const [i, n] of names.entries()) {
      for (const body of bodies) if (hits(n, body)) found.nameOnBody++;
      for (const b of f.badgeBoxes) if (hits(n, b)) found.nameOnBadge++;
      for (let j = i + 1; j < names.length; j++) if (hits(n, names[j])) found.nameOnName++;
    }
    assert.deepEqual(
      found,
      { badgeOnBadge: 0, badgeOnBody: 0, nameOnBody: 0, nameOnBadge: 0, nameOnName: 0 },
      name,
    );

    // THE UNIT. Every badged figure keeps its name beside it: under the feet or
    // against the body, never over the badge, never on a leader — and nobody
    // else's name is set between the badge and the head or the feet and the name.
    let under = 0;
    for (const b of f.badgeBoxes) {
      const id = b.id.slice(6);
      const s = at.get(id);
      const spot = f.labels.plan.get(id);
      const mine = names.find((n) => n.id === id);
      assert.ok(spot && mine, `${name}: ${f.agentsById.get(id).label} lost its name`);
      // On a cushion between two taken ones the name is a line lower, on a
      // leader that runs down between its neighbours' names.
      const lower = f.seats.get(id).nameRow === 1 && spot.leader === true;
      if (!lower)
        assert.notEqual(spot.leader, true, `${name}: ${f.agentsById.get(id).label} left its body`);
      assert.ok(mine.y + mine.h / 2 > s.y - bh, `${name}: a name was set over its own badge`);
      const reach = Math.hypot(mine.x + mine.w / 2 - s.x, mine.y + mine.h / 2 - s.y) / bh;
      assert.ok(
        reach <= (lower ? LOWER_REACH : NEAR_REACH) + 1e-6,
        `${name}: a name is ${reach} bodies from its feet`,
      );
      const column = [{ x: b.x, y: b.y, w: b.w, h: s.y - bh - b.y }];
      if (mine.y >= s.y && Math.abs(mine.x + mine.w / 2 - s.x) <= mine.w / 4 + 0.5) {
        under++;
        column.push(
          lower
            ? { x: s.x - 0.5, y: s.y, w: 1, h: mine.y - s.y }
            : { x: mine.x, y: s.y, w: mine.w, h: mine.y - s.y },
        );
      }
      for (const other of names) {
        if (other.id === id) continue;
        for (const c of column)
          assert.ok(!hits(other, c), `${name}: a name is set inside ${id}'s badge-and-name unit`);
      }
    }
    // The sofas that run across the screen and the standing rows: all of them.
    assert.ok(under >= f.badgeBoxes.length - 3, `${name}: ${under} names under their feet`);
  }
});

test('a dense run sets its names at two levels, and the sixteen all sit', () => {
  adoptSnapshotClock({ now: LARGE_NOW, nowFixed: true });
  try {
    const { projects, agents } = ownerShapedFloor();
    const plan = buildPlan(projects, agents, { stage: { w: 2000, h: 1060 }, now: LARGE_NOW });
    const office = plan.rooms.find((r) => r.kind === 'office');
    const runs = office.props.filter((p) => p.kind === 'sofa');
    assert.equal(runs.length, 3);
    const cushions = runs.reduce((n, run) => n + sofaPlacesOn(run).length, 0);
    assert.ok(cushions >= 16, `${cushions} cushions`);
    assert.equal(plan.officeSeats.length, 16);
    assert.equal(plan.officeSeats.filter((s) => s.standing).length, 0, 'somebody is standing');
    // A cushion is about a body wide: nobody is seated closer than that, and
    // only on a run across the screen does anybody carry the second level.
    const across = runs.filter((run) => run.w > run.h);
    for (const seat of plan.officeSeats.filter((s) => s.nameRow === 1)) {
      const run = across.find((r) =>
        sofaPlacesOn(r).some((p) => Math.hypot(p.x - seat.x, p.y - seat.y) < 1e-9),
      );
      assert.ok(run, 'a second-level name on a run that lies down the screen');
      const pitch = (Math.max(run.w, run.h) - 1.2) / sofaPlacesOn(run).length;
      const beside = plan.officeSeats.filter(
        (s) => s !== seat && Math.abs(s.y - seat.y) < 1e-9 && Math.abs(s.x - seat.x) < pitch + 0.01,
      );
      assert.ok(beside.length >= 1, 'a second-level name with nobody sitting beside it');
      assert.ok(
        beside.every((s) => s.nameRow !== 1),
        'two neighbours on the same level',
      );
    }
  } finally {
    adoptSnapshotClock(null);
  }
  // THE LEVELS, on three people shoulder to shoulder: feet 30 px apart, names
  // 40 px wide. The middle one is `lower`: a line down, on a leader.
  const body = (id, x) => ({ id: `body:${id}`, x: x - 14, y: 60, w: 28, h: 40, pin: true });
  const name = (id, x, lower) => ({
    id,
    x: x - 20,
    y: 120,
    w: 40,
    h: 14,
    keep: true,
    unit: true,
    lower,
    feet: { x, y: 100 },
    bh: 40,
    side: 14,
  });
  const three = [
    body('a', 100),
    body('b', 130),
    body('c', 160),
    name('a', 100, false),
    name('b', 130, true),
    name('c', 160, false),
  ];
  const out = resolveLabelCollisions(three);
  assert.deepEqual(out.get('a'), { offsetY: 0 });
  assert.deepEqual(out.get('c'), { offsetY: 0 });
  assert.deepEqual(out.get('b'), { offsetY: 14, leader: true });
  assert.ok((120 + 14 + 7 - 100) / 40 <= LOWER_REACH);
  // With its line already taken, a second-level name is placed like any other.
  const blocked = [{ id: 'wall', x: 100, y: 134, w: 60, h: 14, pin: true }, ...three];
  const moved = resolveLabelCollisions(blocked).get('b');
  assert.ok(moved && !(moved.offsetY === 14 && !moved.offsetX));
});

// ------------------------------------------- a thought cloud yields to a name

test('no thought cloud is over a name, a role chip, a wait badge or a crew chip', () => {
  let mirrored = 0;
  let dropped = 0;
  let wouldCover = 0;
  for (const name of ['crew', 'demo', 'crowded']) {
    for (const [w, h] of [...STAGES, [1600, 869]]) {
      const f = frameAt(w, h, () => populationFloor(name), { badges: true });
      const names = f.labels.labels
        .filter((it) => f.labels.plan.get(it.id))
        .map((it) => drawnBox(it, f.labels.plan.get(it.id)));
      const chrome = f.labels.obstacles.filter((o) => /^(badge|pill|chip):/.test(o.id));
      const taken = [...names, ...chrome];
      assert.ok(names.length > 0, `${name}: the floor has names to be covered`);
      for (const rec of f.records) {
        const s = worldToScreen(rec, f.camera);
        const side = f.labels.clouds.get(rec.id);
        assert.ok(side === 1 || side === -1 || side === 0, `${name} ${rec.id}: a side`);
        // Every figure is asked, cloud or not: a cloud can open on any of them.
        const natural = cloudBox(s.x, s.y, f.uOf(rec), 1);
        if (taken.some((t) => hits(natural, t))) wouldCover++;
        if (side === -1) mirrored++;
        if (side === 0) dropped++;
        if (side === 0) continue;
        const box = cloudBox(s.x, s.y, f.uOf(rec), side);
        const over = taken.find((t) => hits(box, t));
        assert.equal(over, undefined, `${name} ${w}x${h}: ${rec.id}'s cloud is over ${over?.id}`);
        // On its own side wherever that side is clear: nothing moves for nothing.
        if (!taken.some((t) => hits(natural, t))) assert.equal(side, 1);
      }
    }
  }
  assert.ok(wouldCover > 0, 'unplaced, a cloud covers a name on these floors');
  assert.ok(mirrored > 0, 'and the other side of the head is where most of them go');
  assert.equal(wouldCover, mirrored + dropped);
});

test('a name that is not under, over or beside its own figure is on a leader', () => {
  let tied = 0;
  for (const name of ['crew', 'demo', 'crowded']) {
    for (const [w, h] of [...STAGES, [1600, 869]]) {
      const f = frameAt(w, h, () => populationFloor(name), { badges: true });
      for (const it of f.labels.labels) {
        const spot = f.labels.plan.get(it.id);
        if (!spot) continue;
        const box = drawnBox(it, spot);
        // The body is half as wide as the ring `side` is the radius of.
        const half = it.side / 2;
        const under = box.x < it.feet.x + half && box.x + box.w > it.feet.x - half;
        const level = box.y < it.feet.y && box.y + box.h > it.feet.y - it.bh;
        if (under || level) continue;
        tied++;
        assert.equal(spot.leader, true, `${name}: ${f.labels.texts.get(it.id)} stands alone`);
      }
    }
  }
  assert.ok(tied > 0, 'these floors set a name clear of its figure: the test has a case');
  // The rule itself, on the case the crew floor drew: a tag wider than the
  // body it names, pushed aside at its own depth until none of it is under it.
  const wide = { id: 'tag', x: 60, y: 104, w: 80, h: 12, keep: true };
  const item = { ...wide, feet: { x: 100, y: 100 }, bh: 60, side: 6, variants: [] };
  const chip = { id: 'chip', x: 92, y: 100, w: 16, h: 20, pin: true };
  const spot = resolveLabelCollisions([chip, item]).get('tag');
  assert.deepEqual(spot, { offsetY: 0, offsetX: -50, leader: true });
  assert.equal(resolveLabelCollisions([item]).get('tag').leader, undefined);
});

/** The floors the rule is held over; `wide` is `three` in a 1920 × 1080 window. */
const ROOMED = [
  ...['demo', 'crowded', 'three', 'pair', 'crew', 'away'].flatMap((name) =>
    [...STAGES, [1600, 869]].map(([w, h]) => [name, w, h]),
  ),
  ['three', 1920, 949],
];

test('a name is always inside its own room: never across a wall, never past it', () => {
  let brought = 0;
  for (const [name, w, h] of ROOMED) {
    const f = frameAt(w, h, () => populationFloor(name), { badges: true });
    const at = `${name} ${w}x${h}`;
    const walls = wallBoxes(f.plan, f.camera);
    const names = []; // every name drawn, in the box it is drawn in
    for (const it of f.labels.labels) {
      const spot = f.labels.plan.get(it.id);
      if (spot) names.push({ ...drawnBox(it, spot), it });
    }
    // No two names intersect.
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        assert.ok(!hits(names[i], names[j]), `${at}: ${names[i].id} and ${names[j].id} overlap`);
      }
    }
    for (const n of names) {
      const rec = f.records.find((r) => r.id === n.id);
      const room = f.plan.rooms.find(
        (r) =>
          r.kind !== 'corridor' &&
          rec.x >= r.x &&
          rec.x <= r.x + r.w &&
          rec.y >= r.y &&
          rec.y <= r.y + r.h,
      );
      assert.ok(room, `${at}: ${rec.agent.label} is seated in a room`);
      const a = worldToScreen({ x: room.x, y: room.y }, f.camera);
      const b = worldToScreen({ x: room.x + room.w, y: room.y + room.h }, f.camera);
      const who = `${at}: ${f.labels.texts.get(n.id)} (${room.kind})`;
      // Entirely inside its own room's rectangle…
      assert.ok(n.x > a.x && n.y > a.y && n.x + n.w < b.x && n.y + n.h < b.y, `${who} is outside`);
      // …and not touching the band a wall is painted in.
      assert.ok(!walls.some((wall) => hits(n, wall)), `${who} touches a wall`);
      // Counted where its own place was on one: it has been brought inside.
      if (walls.some((wall) => hits(n.it, wall))) brought++;
    }
    // And nobody at a desk or waiting lost their name for it.
    for (const rec of f.records) {
      if (!isLiveAgent(rec.agent) || !f.labels.texts.has(rec.id)) continue;
      assert.ok(f.labels.plan.get(rec.id), `${at}: ${rec.agent.label} lost its name`);
    }
  }
  assert.ok(brought > 20, 'these floors seat people against walls: the test has cases');
});

test('against a wall a name is lifted under its feet, then set beside, then over its badge', () => {
  // A room whose floor ends 12 px under the feet; the name hangs 4 px under them.
  const room = { x: 0, y: 0, w: 400, h: 112 };
  const base = { id: 'n', x: 80, y: 104, w: 40, h: 12, keep: true, variants: [], room };
  const item = { ...base, feet: { x: 100, y: 100 }, bh: 40, side: 8 };
  const body = { id: 'body:n', x: 92, y: 60, w: 16, h: 40, pin: true };
  // (1) Lifted by the least that brings it inside: its foot on the room's.
  assert.deepEqual(resolveLabelCollisions([body, item]).get('n'), { offsetY: 112 - 116 });
  // (2) No room under the feet at all: beside the body, at seat height.
  const low = { ...room, h: 108 };
  const beside = resolveLabelCollisions([body, { ...item, room: low }]).get('n');
  assert.ok(beside.offsetX < 0 && beside.offsetY < 0 && beside.leader === undefined);
  assert.equal(104 + beside.offsetY + 12, 99, 'its foot a pixel over the floor line');
  // (3) Neighbours either side as well: over its own wait badge.
  const left = { id: 'body:l', x: 40, y: 60, w: 50, h: 40, pin: true };
  const right = { id: 'body:r', x: 110, y: 60, w: 50, h: 40, pin: true };
  const badge = { id: 'badge:n', x: 85, y: 30, w: 30, h: 14, pin: true };
  const over = 30 - 1 - 12 - 104;
  const boxed = [body, left, right, badge, { ...item, room: low, unit: true, over }];
  assert.deepEqual(resolveLabelCollisions(boxed).get('n'), { offsetY: over });
  // Never past the wall: with no room to hold it at all, a resting name is not drawn.
  const tiny = { ...room, y: 200 };
  assert.equal(resolveLabelCollisions([body, { ...item, keep: false, room: tiny }]).get('n'), null);
});

test('a cloud takes its own side, then the other, then none', () => {
  const me = { id: 'a', x: 100, y: 100, u: 10 };
  assert.equal(placeClouds([me], []).get('a'), 1);
  const right = cloudBox(100, 100, 10, 1);
  const left = cloudBox(100, 100, 10, -1);
  assert.ok(right.x > left.x && right.y === left.y, 'mirrored about the head');
  assert.equal(placeClouds([me], [right]).get('a'), -1);
  assert.equal(placeClouds([me], [right, left]).get('a'), 0);
});

test('the box a cloud is placed by holds every lobe of the cloud that is drawn', () => {
  for (const side of [1, -1]) {
    for (const sway of [-1, 0, 1]) {
      /** @type {{x:number, y:number, r:number}[]} */
      const arcs = [];
      const noop = () => {};
      const ctx = {
        globalAlpha: 1,
        lineWidth: 1,
        beginPath: noop,
        moveTo: noop,
        fill: noop,
        stroke: noop,
        arc: (x, y, r) => arcs.push({ x, y, r }),
      };
      drawDots(/** @type {any} */ (ctx), 200, 300, 20, 1, 3, sway, side);
      const box = cloudBox(200, 300, 20, side);
      // The two trailing beats lead from the head to the cloud and are under
      // it; the cloud itself is every arc from the third on.
      const lobes = arcs.slice(2);
      assert.ok(lobes.length >= 4);
      const edge = ctx.lineWidth / 2;
      for (const a of lobes) {
        assert.ok(a.x - a.r - edge >= box.x - 1e-6 && a.x + a.r + edge <= box.x + box.w + 1e-6);
        assert.ok(a.y - a.r - edge >= box.y - 1e-6 && a.y + a.r + edge <= box.y + box.h + 1e-6);
      }
    }
  }
});
