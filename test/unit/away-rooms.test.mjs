/**
 * AWAY ROOMS: a repo whose sessions are all waiting in the office keeps its
 * room, with the lights off (the owner's floor of 6 October).
 *
 * Five repos had everybody on the reception sofas and nobody at a desk. They
 * were first laid as narrow strip rooms, a third of a live one, and on the
 * owner's own window that drew four slots showing a desk top under one hall:
 * _"we cannot make one room very big and the others really thin rectangles."_
 *
 * The rule now (`awayRooms` in `public/floor-rule.js`, `plan-proportions.js`
 * (e)): such a repo keeps the room it would have with somebody at the desk —
 * the same module, the same shape, one desk with nobody at it — and is drawn
 * dimmed, its plate intact. Asked of the real plan over the `away` demo
 * population (`test/helpers/large-floor.mjs`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { awayFloor, LARGE_NOW } from '../helpers/large-floor.mjs';
import { buildPlan } from '../../public/render/plan.js';
import { assignSeats } from '../../public/render/agents.js';
import { computeFill } from '../../public/render/scene-camera.js';
import { layoutPlate, platePlanFor } from '../../public/render/scene-labels.js';
import { plateHeroLine } from '../../public/render/plan-plate.js';
import { awayRooms, floorPopulation } from '../../public/floor-rule.js';
import { adoptSnapshotClock } from '../../public/clock.js';
import {
  DIM_PLATE_CONTRAST_MIN,
  LIGHTS_OFF_DIM,
  LIGHTS_OFF_HUE_MAX,
  LIGHTS_OFF_STEP_MAX,
  LIGHTS_OFF_STEP_MIN,
} from '../../public/render/plan-proportions.js';
import {
  allThemes,
  contrastRatio,
  dimmed,
  lightness,
  lightsOffVeil,
  materialTokensFor,
  plateGroundOverDim,
  rgb,
} from '../../public/render/themes.js';
import { DEFAULT_PALETTE } from '../../public/render/palette.js';

const AWAY = ['orbital-api', 'checkout-flow', 'design-system', 'data-pipeline', 'infra-terraform'];
const STAGES = [
  [2000, 970],
  [1600, 870],
  [1420, 690],
];

/** @param {{projects:any[], agents:any[]}} floor @param {number} w @param {number} h */
function planAt(floor, w, h) {
  return buildPlan(floor.projects, floor.agents, { stage: { w, h }, now: LARGE_NOW });
}

test('five away repos beside one working repo: every one keeps a room, and none is squashed', () => {
  for (const [w, h] of STAGES) {
    const plan = planAt(awayFloor(), w, h);
    const rooms = plan.rooms.filter((r) => r.kind === 'project');
    const working = rooms.find((r) => r.id === 'mobile-app');
    assert.ok(working && working.away !== true && working.dim !== true, `${w}x${h}`);
    const away = rooms.filter((r) => r.away === true);
    assert.deepEqual(away.map((r) => r.id).sort(), [...AWAY].sort(), `${w}x${h}`);
    for (const r of away) {
      assert.equal(r.dim, true, `${r.id} has its lights off`);
      assert.notEqual(r.pinned, true, 'an away room is not a pinned one');
      // Its desk is there, with its chair, and nobody is at it.
      assert.equal(r.props.filter((p) => p.kind === 'desk').length, 1, `${r.id} has one desk`);
      assert.ok(
        r.props.some((p) => p.kind === 'chair'),
        `${r.id}'s desk has its chair`,
      );
      // The furniture a one-desk room needs fits inside it: not a strip.
      assert.ok(r.w >= r.natural.w - 1e-6 && r.h >= r.natural.h - 1e-6, `${r.id} is squashed`);
    }
  }
});

test('nobody is seated in an away room: its people are on the sofas', () => {
  const floor = awayFloor();
  const plan = planAt(floor, 2000, 970);
  const seats = assignSeats(plan, floor.agents);
  for (const id of AWAY) {
    const room = plan.rooms.find((r) => r.id === id);
    for (const a of floor.agents.filter((x) => x.projectId === id)) {
      const at = seats.get(a.id);
      if (!at) continue;
      const inside =
        at.x > room.x && at.x < room.x + room.w && at.y > room.y && at.y < room.y + room.h;
      assert.ok(!inside, `${a.id} is drawn in ${id}, which has its lights off`);
    }
  }
});

test('an away room keeps its plate: the need-you line is the one a live room would say', () => {
  adoptSnapshotClock({ now: LARGE_NOW, nowFixed: true });
  try {
    const floor = awayFloor();
    const [w, h] = STAGES[0];
    const plan = planAt(floor, w, h);
    const { scale } = computeFill(plan.width, plan.height, w, h);
    const camera = { zoom: scale / 14, panX: 0, panY: 0, U: 14 };
    const ctx = {
      font: '10px x',
      measureText(t) {
        const px = parseFloat(/(\d[\d.]*)px/.exec(this.font)?.[1] ?? '10');
        return { width: String(t).length * px * 0.58 };
      },
    };
    const snapshot = { projects: floor.projects, agents: floor.agents };
    for (const id of AWAY) {
      const room = plan.rooms.find((r) => r.id === id);
      const project = floor.projects.find((p) => p.id === id);
      const plate = platePlanFor(room, snapshot, plan);
      // Exactly the plan a live room of this repo gets.
      const { away: _away, dim: _dim, ...asLive } = room;
      assert.deepEqual(plate, platePlanFor(asLive, snapshot, plan), id);
      assert.equal(plate.heroHead, plateHeroLine(project), id);
      assert.match(plate.lines[1], new RegExp(`^${project.needsYou} need you`), id);
      const hero = layoutPlate(ctx, room, plate, camera).rows.find((r) => r.i === 1);
      assert.ok(
        hero && hero.text.startsWith(`${project.needsYou} need you`),
        `${id}: ${hero?.text}`,
      );
    }
  } finally {
    adoptSnapshotClock(null);
  }
});

test('the lights come back the moment one of its sessions works, and the room does not move', () => {
  const floor = awayFloor();
  const before = planAt(floor, 2000, 970).rooms.find((r) => r.id === 'checkout-flow');
  assert.equal(before.away, true);
  assert.equal(before.dim, true);
  // ONE session of the repo goes back to its desk.
  let moved = false;
  const agents = floor.agents.map((a) => {
    if (moved || a.projectId !== 'checkout-flow' || a.activityState !== 'for_review') return a;
    moved = true;
    return { ...a, activityState: 'working', reviewSince: null };
  });
  assert.ok(moved);
  const after = planAt({ projects: floor.projects, agents }, 2000, 970);
  const room = after.rooms.find((r) => r.id === 'checkout-flow');
  assert.notEqual(room.away, true);
  assert.notEqual(room.dim, true);
  assert.notEqual(room.pinned, true);
  assert.ok((after.seats.get('checkout-flow') || []).length >= 1, 'with a desk to sit at');
});

test('an away repo is still on the floor: its finished sessions rest in the lounge', () => {
  const floor = awayFloor();
  const plan = planAt(floor, 2000, 970);
  const seats = assignSeats(plan, floor.agents);
  const resting = floor.agents.filter(
    (a) => a.projectId === 'orbital-api' && a.activityState === 'ended',
  );
  assert.ok(resting.length > 0);
  const drawn = resting.filter((a) => seats.has(a.id)).length;
  const behindChip = plan.loungeOverflow?.count ?? 0;
  assert.ok(drawn > 0 || behindChip > 0, 'nobody from an away repo is in the lounge');
});

test('a floor where every repo is away has every room dark, and every room a room', () => {
  const floor = awayFloor();
  const projects = floor.projects.filter((p) => p.id !== 'mobile-app');
  const agents = floor.agents.filter((a) => a.projectId !== 'mobile-app');
  const pop = floorPopulation(agents, { now: LARGE_NOW });
  const split = awayRooms(projects, pop);
  assert.equal(split.rooms.length, AWAY.length);
  assert.ok(split.rooms.every((p) => p.away === true));
  assert.equal(split.strip.length, 0);
  const plan = planAt({ projects, agents }, 2000, 970);
  const rooms = plan.rooms.filter((r) => r.kind === 'project');
  assert.equal(rooms.length, AWAY.length);
  assert.ok(rooms.every((r) => r.away === true && r.dim === true));
});

test('`awayRooms` flags a copy: the project record it was handed is never written to', () => {
  const floor = awayFloor();
  const pop = floorPopulation(floor.agents, { now: LARGE_NOW });
  const split = awayRooms(floor.projects, pop);
  assert.ok(floor.projects.every((p) => !('away' in p)));
  assert.deepEqual(
    split.rooms.map((p) => p.id),
    split.onFloor.map((p) => p.id),
    'the rooms are every repo on the floor, in floor order',
  );
  assert.deepEqual(
    split.rooms
      .filter((p) => p.away)
      .map((p) => p.id)
      .sort(),
    [...AWAY].sort(),
  );
});

/** HSL hue in degrees, and the chroma it is the hue of. @param {string} colour */
function hueOf(colour) {
  const [r, g, b] = rgb(colour).map((n) => n / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return { hue: 0, chroma: 0 };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (h * 60 + 360) % 360, chroma: d };
}

test('lights off is two neutral tokens: the same hue, a quarter less light, on every theme', () => {
  const shipped = materialTokensFor(allThemes()[0]);
  assert.equal(DEFAULT_PALETTE.lightsOff, shipped.lightsOff);
  assert.equal(DEFAULT_PALETTE.lightsOffMute, shipped.lightsOffMute);
  for (const theme of allThemes()) {
    const tokens = materialTokensFor(theme);
    // Neither fill has a hue of its own: a veil with one is what made olive.
    for (const name of ['lightsOff', 'lightsOffMute']) {
      const m = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(tokens[name]);
      assert.ok(m, `${theme.name}: ${name} is ${tokens[name]}`);
      assert.ok(m[1] === m[2] && m[2] === m[3], `${theme.name}: ${name} is not a grey`);
    }
    assert.equal(Number(/([\d.]+)\)$/.exec(tokens.lightsOffMute)[1]), LIGHTS_OFF_DIM);
    assert.equal(Number(/([\d.]+)\)$/.exec(tokens.lightsOff)[1]), lightsOffVeil(theme.floor));

    const lit = theme.floor.carpet;
    const off = dimmed(theme.floor, lit);
    const drop = 1 - lightness(off) / lightness(lit);
    assert.ok(
      drop >= LIGHTS_OFF_STEP_MIN && drop <= LIGHTS_OFF_STEP_MAX,
      `${theme.name}: the carpet is ${(drop * 100).toFixed(1)}% less light with the lights off`,
    );
    const a = hueOf(lit);
    const b = hueOf(off);
    const turn = Math.abs(a.hue - b.hue);
    assert.ok(
      Math.min(turn, 360 - turn) <= LIGHTS_OFF_HUE_MAX,
      `${theme.name}: the dimmed carpet is ${turn.toFixed(1)}° from the lit one`,
    );
    assert.ok(b.chroma < a.chroma * 0.75, `${theme.name}: the dim kept the carpet's colour`);
    // It still reads as that room's floor rather than as a hole in it.
    assert.ok(contrastRatio(off, lit) < 2.6, `${theme.name}: ${contrastRatio(off, lit)}`);
    assert.ok(contrastRatio(off, lit) > 1.15, `${theme.name}: the dim cannot be seen`);
    console.log(
      `    ${theme.name}: L* ${lightness(lit).toFixed(1)} → ${lightness(off).toFixed(1)} ` +
        `(-${(drop * 100).toFixed(1)}%), hue ${a.hue.toFixed(1)}° → ${b.hue.toFixed(1)}°`,
    );
  }
});

test('the desk still stands out of the carpet with the lights off', () => {
  for (const theme of allThemes()) {
    const desk = materialTokensFor(theme).deskTop;
    const lit = contrastRatio(desk, theme.floor.carpet);
    const off = contrastRatio(dimmed(theme.floor, desk), dimmed(theme.floor, theme.floor.carpet));
    assert.ok(off >= 1.3, `${theme.name}: a dimmed desk is ${off.toFixed(2)}:1 on its carpet`);
    assert.ok(off >= lit * 0.85, `${theme.name}: the dim flattened the desk, ${off.toFixed(2)}`);
  }
});

test('a dimmed room’s plate is intact: every rank of its text is at least 4.5:1', () => {
  for (const theme of allThemes()) {
    const tokens = materialTokensFor(theme);
    const behind = plateGroundOverDim(theme.floor, theme.floor.carpet);
    for (const rank of ['plateInk', 'plateInkSecondary', 'plateInkTertiary']) {
      const ratio = contrastRatio(tokens[rank], behind);
      assert.ok(
        ratio >= DIM_PLATE_CONTRAST_MIN,
        `${theme.name}: ${rank} is ${ratio.toFixed(2)}:1 on a dimmed room's plate`,
      );
    }
  }
});
