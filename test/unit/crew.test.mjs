/**
 * WP-89 — THE CREW.
 *
 * `docs/plan/12-MOTION-AND-CREW.md` §3 is the design and §5 its acceptance
 * list. Nine properties, in the order the package states them:
 *
 *   1. **The workflow id survives the path.** `subagents/workflows/wf_<id>/`
 *      names a workflow and `listSubagentFiles` keeps it; a bare `Task`
 *      subagent gets `null` and never a synthetic one.
 *   2. **The crew snapshot is honest.** Every field is one the adapter
 *      reported; a junior is in a crew only because a transcript file exists;
 *      `active` is a file that grew inside the stall window and is FALSE for a
 *      runtime that reports no growth at all.
 *   3. **Three.** n = 0 … 14 over a driven registry: two or fewer keep WP-41's
 *      seats, three or more form an arc.
 *   4. **The arc is deterministic and inside the room**, at every size and on
 *      every stage `floor-integrity.test.mjs` uses.
 *   5. **The cables are axis-aligned, miss every desk, and never cross.**
 *   6. **The cap and the `+N` chip.** Twelve are seated; the rest have no seat
 *      and therefore no body, and the chip says how many.
 *   7. **Pulses only where the file moved**, junior → parent, capped at four.
 *   8. **Reduced motion is byte-identical across two clocks** and still says
 *      who is working.
 *   9. **The deck folds a crew** under a parent that is in the queue, and one
 *      `door` fires on the crossing and on nothing else.
 *
 * Everything here runs against the real modules: `crew.js` and `floor-rule.js`
 * are pure, and the adapter half reads a real directory tree written into an
 * isolated temp root (docs/DEVIATIONS.md §122).
 */

import '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CREW_ACTIVE_MS,
  CREW_DRAW_CAP,
  CREW_THRESHOLD,
  crewCrossings,
  crewsFrom,
  floorPopulation,
  isCrewFormation,
  juniorActive,
} from '../../public/floor-rule.js';
import {
  CREW_ARC_SPAN,
  CREW_PITCH,
  CREW_PULSE_MAX,
  CREW_SCALE,
  cableLanes,
  crewArc,
  crewCableExtent,
  crewCableLive,
  crewChipText,
  crewFootprint,
  crewPulseCount,
  crewRadius,
  crewSplit,
  pointAlong,
  segmentHitsRect,
} from '../../public/render/crew.js';
import { buildPlan } from '../../public/render/plan.js';
import { assignSeats } from '../../public/render/agents.js';
import { deskFootprints } from '../../public/render/agents-seats.js';
import { drawCrews } from '../../public/render/crew-draw.js';
import { crewGroups, queueGroups } from '../../public/deck.js';
import { workflowIdFromDir } from '../../src/adapters/claude-code/parse.mjs';
import { listSubagentFiles } from '../../src/adapters/claude-code/adapter-scan.mjs';

const NOW = 1_800_000_000_000;
const STAGES = [
  [1600, 1000],
  [1920, 1080],
  [1280, 800],
];

/** @param {object} over */
function agent(over = {}) {
  return {
    id: 'claude-code:s',
    projectId: 'p',
    ackState: 'active',
    activityState: 'working',
    lastActivityAt: NOW - 1000,
    ...over,
  };
}

/** A senior at a desk with `n` juniors, plus the project row the plan needs. */
function crewFloor(n, juniorOver = () => ({})) {
  const agents = [agent({ id: 'claude-code:s', projectId: 'p' })];
  for (let i = 0; i < n; i++) {
    agents.push(
      agent({
        id: `claude-code:j${String(i).padStart(2, '0')}`,
        projectId: 'p',
        subagent: true,
        parentId: 'claude-code:s',
        subagentType: 'Explore',
        lastGrowthAt: NOW,
        ...juniorOver(i),
      }),
    );
  }
  const projects = [{ id: 'p', name: 'p', sessionCount: n + 1, activeCount: n + 1 }];
  return { agents, projects };
}

// ---------------------------------------------------- 1. the workflow id

test('§3.1: the `wf_<id>` segment is recovered from the path, and only from it', async () => {
  assert.equal(workflowIdFromDir('wf_01abc-XY'), 'wf_01abc-XY');
  // Not a workflow folder, and nothing is invented for one.
  for (const name of ['workflows', 'subagents', 'wf_', 'wf', 'agent-1.jsonl', '', 'WF_1']) {
    assert.equal(workflowIdFromDir(name), null, `${name} is not a workflow folder`);
  }
});

test('§3.1: listSubagentFiles keeps the workflow id it used to walk past', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'deckhq-crew-'));
  const session = path.join(root, 'parent-session');
  const plain = path.join(session, 'subagents');
  const flow = path.join(plain, 'workflows', 'wf_zz99');
  await fs.mkdir(flow, { recursive: true });
  await fs.writeFile(path.join(plain, 'agent-aaa.jsonl'), '{}\n');
  await fs.writeFile(path.join(flow, 'agent-bbb.jsonl'), '{}\n');
  // The workflow's own log sits beside the transcripts and is not a subagent.
  await fs.writeFile(path.join(flow, 'journal.jsonl'), '{}\n');

  const found = await listSubagentFiles(session, 'parent-session');
  const byId = new Map(found.map((f) => [f.subagentId, f]));
  assert.equal(found.length, 2, 'journal.jsonl is not a junior');
  assert.equal(byId.get('aaa').workflowId, null, 'a bare Task subagent is in no workflow');
  assert.equal(byId.get('bbb').workflowId, 'wf_zz99');
  // And the mtime the crew reads as `lastGrowthAt` is on every entry.
  for (const f of found) assert.equal(typeof f.mtimeMs, 'number');

  await fs.rm(root, { recursive: true, force: true });
});

// -------------------------------------------------- 2. the crew snapshot

test('§3: the crew per parent is exactly what the adapter reported, and no more', () => {
  const { agents } = crewFloor(3, (i) => ({
    label: `MK1.1j${i + 1}`,
    subagentType: ['Explore', 'general-purpose', null][i],
    workflowId: 'wf_one',
    spawnedAt: NOW - 60_000 * (i + 1),
    lastGrowthAt: NOW - [0, 30_000, 120_000][i],
  }));
  const [crew] = crewsFrom(agents, { now: NOW });

  assert.equal(crew.parentId, 'claude-code:s');
  assert.equal(crew.count, 3);
  assert.equal(crew.workflowId, 'wf_one', 'three juniors of one workflow ARE one workflow');
  assert.deepEqual(
    Object.keys(crew.members[0]).sort(),
    ['active', 'agentType', 'id', 'lastGrowthAt', 'name', 'spawnedAt', 'workflowId'],
    'a member carries seven observed fields and nothing inferred',
  );
  assert.deepEqual(
    crew.members.map((m) => m.active),
    [true, true, false],
    'active is a file that grew inside the stall window',
  );
  // Sorted by id, which is the order the arc seats them in.
  assert.deepEqual(
    crew.members.map((m) => m.id),
    ['claude-code:j00', 'claude-code:j01', 'claude-code:j02'],
  );
  // A type nobody reported is null, never a placeholder.
  assert.equal(crew.members[2].agentType, null);
});

test('§3: a junior appears in a crew ONLY because a transcript exists for it', () => {
  // A parent that says it has three juniors, with no junior rows behind it.
  const lying = [agent({ id: 'claude-code:s', juniorCount: 3 })];
  assert.deepEqual(crewsFrom(lying, { now: NOW }), [], 'a count is not a crew');
  // A junior with no parent link is nobody's crew rather than everybody's.
  const orphan = [agent({ id: 'claude-code:j', subagent: true, parentId: null })];
  assert.deepEqual(crewsFrom(orphan, { now: NOW }), []);
});

test('§3.1: a runtime that reports no growth never reads as active', () => {
  // Gemini CLI and OpenCode carry a parent link and nothing else.
  assert.equal(juniorActive({ lastGrowthAt: undefined }, NOW), false);
  assert.equal(juniorActive({ lastGrowthAt: null }, NOW), false);
  assert.equal(juniorActive({ lastGrowthAt: 0 }, NOW), false);
  assert.equal(juniorActive({ lastGrowthAt: NOW - CREW_ACTIVE_MS }, NOW), true, 'on the edge');
  assert.equal(juniorActive({ lastGrowthAt: NOW - CREW_ACTIVE_MS - 1 }, NOW), false);
});

// ------------------------------------------------------- 3. the threshold

test('§3.2: three or more is a crew; two or fewer keep the seats they had', () => {
  for (let n = 0; n <= 14; n++) {
    const { agents, projects } = crewFloor(n);
    const plan = buildPlan(projects, agents, { stage: { w: 1600, h: 1000 }, now: NOW });
    const seats = assignSeats(plan, agents);
    const juniors = agents.filter((a) => a.subagent);
    const crewSeats = juniors.map((j) => seats.get(j.id)).filter((s) => s && s.crew === true);
    if (n < CREW_THRESHOLD) {
      assert.equal(crewSeats.length, 0, `${n} juniors must not form a crew`);
      for (const j of juniors) assert.ok(seats.get(j.id), `${n}: every junior is still drawn`);
    } else {
      assert.equal(crewSeats.length, Math.min(n, CREW_DRAW_CAP), `${n} juniors form an arc`);
    }
    assert.equal(isCrewFormation(n), n >= CREW_THRESHOLD);
  }
});

test('§3.2, bug 201: a benched senior’s working crew stays at the room’s desk', () => {
  // It used to follow the senior into the lounge and stand there in WP-59d's
  // rows. A working junior is placed by its own state: the crew is in the
  // project room, cabled to the room's primary desk, with the senior's name on
  // it — and the senior is in the lounge, where the user's bench put it.
  const { agents, projects } = crewFloor(6);
  agents[0].ackState = 'benched';
  const plan = buildPlan(projects, agents, { stage: { w: 1600, h: 1000 }, now: NOW });
  const seats = assignSeats(plan, agents);
  const room = plan.rooms.find((r) => r.kind === 'project' && r.id === 'p');
  const desks = plan.seats.get('p') || [];
  assert.equal(desks.length, 1, 'one desk: the one the crew is cabled to');
  for (const j of agents.filter((a) => a.subagent)) {
    const seat = seats.get(j.id);
    assert.ok(seat, 'nothing is dropped');
    assert.equal(seat.crew, true, 'six working juniors are a formation');
    assert.equal(seat.crewAway, true, 'and their parent is not at the desk');
    assert.equal(seat.crewAnchor.x, desks[0].x);
    assert.equal(seat.crewAnchor.y, desks[0].y);
    assert.ok(seat.x >= room.x && seat.x <= room.x + room.w, 'inside the project room');
    assert.ok(seat.y >= room.y && seat.y <= room.y + room.h, 'inside the project room');
  }
  const lounge = plan.rooms.find((r) => r.kind === 'lounge');
  const senior = seats.get(agents[0].id);
  assert.ok(senior.x >= lounge.x && senior.x <= lounge.x + lounge.w, 'the senior rests');
});

// ------------------------------------------------- 4. the arc's geometry

test('§3.2: the arc is a pure function of seat, room and count', () => {
  const anchor = { x: 20, y: 20, angle: -Math.PI / 2 };
  const room = { x: 0, y: 0, w: 60, h: 60, plateBand: 3.4 };
  const a = crewArc(anchor, room, 5);
  const b = crewArc(anchor, room, 5);
  assert.deepEqual(
    a.seats.map((s) => [s.x, s.y]),
    b.seats.map((s) => [s.x, s.y]),
    'two calls, one answer',
  );
  // The radius opens until neighbours are a body apart, never below the floor.
  assert.equal(crewRadius(3), crewRadius(2), 'both are held at the minimum');
  assert.ok(crewRadius(12) > crewRadius(5), 'twelve needs a bigger circle, not a denser one');
  for (let n = 3; n <= 12; n++) {
    const arc = crewArc(anchor, room, n);
    for (let i = 1; i < n; i++) {
      const d = Math.hypot(
        arc.seats[i].x - arc.seats[i - 1].x,
        arc.seats[i].y - arc.seats[i - 1].y,
      );
      assert.ok(
        d >= CREW_PITCH - 1e-6,
        `${n}: neighbours ${i - 1} and ${i} are ${d.toFixed(2)} apart`,
      );
    }
  }
  // And the footprint the room bids for really does contain the arc.
  const fp = crewFootprint(5);
  const xs = a.seats.map((s) => s.x);
  assert.ok(Math.max(...xs) - Math.min(...xs) <= fp.w + 1e-6);
});

test('§5: no body is ever drawn outside its room, at any size or stage', () => {
  for (const n of [3, 5, 8, 12, 14]) {
    const { agents, projects } = crewFloor(n);
    for (const [w, h] of STAGES) {
      const plan = buildPlan(projects, agents, { stage: { w, h }, now: NOW });
      const seats = assignSeats(plan, agents);
      const room = plan.rooms.find((r) => r.id === 'p');
      for (const j of agents.filter((a) => a.subagent)) {
        const seat = seats.get(j.id);
        if (!seat) continue; // over the cap: no seat, no body, and that is the chip
        assert.ok(
          seat.x >= room.x &&
            seat.x <= room.x + room.w &&
            seat.y >= room.y &&
            seat.y <= room.y + room.h,
          `${n} at ${w}x${h}: ${j.id} is outside its room`,
        );
      }
    }
  }
});

// ------------------------------------------------------- 5. the cables

test('§5: every cable is axis-aligned, misses every desk, and no two cross', () => {
  const anchor = { x: 30, y: 30, angle: -Math.PI / 2 };
  const room = { x: 0, y: 0, w: 80, h: 80, plateBand: 3.4 };
  // A plant and a neighbouring table standing in the way of the fifth cable.
  const obstacles = [{ x: 22, y: 26, w: 3, h: 3 }];
  for (let n = CREW_THRESHOLD; n <= CREW_DRAW_CAP; n++) {
    const arc = crewArc(anchor, room, n, obstacles);
    /** @type {{a:{x:number,y:number}, b:{x:number,y:number}}[]} */
    const segments = [];
    for (const seat of arc.seats) {
      assert.ok(seat.route.length >= 2, 'a cable is always drawn');
      for (let i = 0; i + 1 < seat.route.length; i++) {
        const a = seat.route[i];
        const b = seat.route[i + 1];
        assert.ok(
          Math.abs(a.x - b.x) < 1e-6 || Math.abs(a.y - b.y) < 1e-6,
          `${n}: a cable run is not axis-aligned`,
        );
        for (const rect of obstacles) {
          assert.equal(
            segmentHitsRect(a, b, rect),
            false,
            `${n}: a cable runs through the furniture`,
          );
        }
        segments.push({ a, b, owner: seat.u });
      }
      assert.ok(seat.route.length <= 4, 'two bends at most');
    }
    // No two cables of one crew intersect. Every run is axis-aligned, so a
    // crossing is one horizontal meeting one vertical.
    for (const p of segments) {
      for (const q of segments) {
        if (p.owner === q.owner) continue;
        const pv = Math.abs(p.a.x - p.b.x) < 1e-6;
        const qv = Math.abs(q.a.x - q.b.x) < 1e-6;
        if (pv === qv) continue;
        const v = pv ? p : q;
        const hz = pv ? q : p;
        const between = (t, lo, hi) => t > Math.min(lo, hi) + 1e-6 && t < Math.max(lo, hi) - 1e-6;
        assert.equal(
          between(v.a.x, hz.a.x, hz.b.x) && between(hz.a.y, v.a.y, v.b.y),
          false,
          `${n}: two cables of one crew cross`,
        );
      }
    }
  }
});

test('§3.2: lanes are distinct and the outermost cable runs nearest the desk', () => {
  const seats = [{ u: -4 }, { u: -2 }, { u: 0 }, { u: 2 }, { u: 4 }];
  const lanes = cableLanes(seats);
  assert.equal(new Set(lanes).size, lanes.length, 'every lane is its own');
  assert.ok(lanes[0] < lanes[2], 'the outermost member crosses closest to the desk');
  assert.ok(lanes[4] < lanes[2]);
});

test('§3.2: a cable through a real room misses the tables it is planned around', () => {
  const { agents, projects } = crewFloor(6);
  const plan = buildPlan(projects, agents, { stage: { w: 1600, h: 1000 }, now: NOW });
  const seats = assignSeats(plan, agents);
  const room = plan.rooms.find((r) => r.id === 'p');
  const rects = deskFootprints(room);
  assert.ok(rects.length > 0, 'the room has furniture to route around');

  let checked = 0;
  for (const junior of agents.filter((a) => a.subagent)) {
    const seat = seats.get(junior.id);
    assert.equal(seat.crew, true);
    const port = seat.route[seat.route.length - 1];
    for (let i = 0; i + 1 < seat.route.length; i++) {
      for (const rect of rects) {
        // The desk the port sits ON is where the cable is meant to end — §3.2
        // puts the port on the desk's front edge. Every OTHER footprint in the
        // room is one the route had to find its way round.
        const terminal =
          port.x >= rect.x &&
          port.x <= rect.x + rect.w &&
          port.y >= rect.y &&
          port.y <= rect.y + rect.h;
        if (terminal) continue;
        assert.equal(
          segmentHitsRect(seat.route[i], seat.route[i + 1], rect),
          false,
          `${junior.id}: a cable runs through a table`,
        );
        checked++;
      }
    }
  }
  assert.ok(checked > 0, 'the property was actually exercised');
});

// ----------------------------------------------------- 6. the cap and +N

test('§3.2: twelve are drawn and the rest are a chip', () => {
  assert.deepEqual(crewSplit(5), { drawn: 5, overflow: 0 });
  assert.deepEqual(crewSplit(CREW_DRAW_CAP), { drawn: CREW_DRAW_CAP, overflow: 0 });
  assert.deepEqual(crewSplit(20), { drawn: CREW_DRAW_CAP, overflow: 20 - CREW_DRAW_CAP });

  const { agents, projects } = crewFloor(20);
  const plan = buildPlan(projects, agents, { stage: { w: 1600, h: 1000 }, now: NOW });
  const seats = assignSeats(plan, agents);
  const drawn = agents.filter((a) => a.subagent && seats.get(a.id));
  assert.equal(drawn.length, CREW_DRAW_CAP, 'a crew of twenty draws twelve bodies');
  // And the snapshot still carries all twenty, so the panel and the deck have
  // them: the chip stands for sessions, not for sessions that were forgotten.
  assert.equal(crewsFrom(agents, { now: NOW })[0].count, 20);
});

test('audit F10: the chip is +N for the undrawn, and "working" is over the whole crew', () => {
  // The arithmetic, on its own.
  assert.equal(crewChipText(13, 12, null), '+1');
  assert.equal(crewChipText(12, 12, null), '', 'nothing undrawn, nothing to say');
  assert.equal(crewChipText(13, 12, 7), '+1 · 7/13 working');
  assert.equal(crewChipText(5, 5, 2), '2/5 working');
  assert.equal(crewChipText(13, 12, 20), '+1 · 13/13 working', 'never more than the crew');

  // And on the floor: thirteen at the desk, the even-numbered six of the drawn
  // twelve and the undrawn thirteenth writing. The audit's chip read "6/13".
  const quiet = NOW - 10 * CREW_ACTIVE_MS;
  const { agents, projects } = crewFloor(13, (i) => ({
    lastGrowthAt: i === 12 || i % 2 === 0 ? NOW : quiet,
  }));
  const plan = buildPlan(projects, agents, { stage: { w: 1600, h: 1000 }, now: NOW });
  const seats = assignSeats(plan, agents);
  const records = agents
    .filter((a) => seats.get(a.id)?.crew === true)
    .map((a) => ({ id: a.id, agent: a, targetSeat: seats.get(a.id), x: 0, y: 0 }));
  assert.equal(records.length, CREW_DRAW_CAP);
  /** @type {string[]} */
  const texts = [];
  const ctx = new Proxy(
    { measureText: (t) => ({ width: String(t).length * 6 }) },
    {
      get: (target, key) =>
        key === 'fillText'
          ? (text) => texts.push(String(text))
          : key in target
            ? target[key]
            : () => {},
      set: () => true,
    },
  );
  drawCrews(/** @type {any} */ (ctx), {
    records,
    agentsById: new Map(agents.map((a) => [a.id, a])),
    camera: { U: 20, zoom: 1, panX: 0, panY: 0 },
    scale: 20,
    charU: 30,
    lod: 2,
    reduced: true,
    pinned: 0,
    nowMs: NOW,
    seatOf: (id) => seats.get(id),
    crewCounts: new Map(),
  });
  assert.ok(texts.includes('+1 · 7/13 working'), `the chip read ${JSON.stringify(texts)}`);
});

// --------------------------------------------------------- 7. the pulses

test('§3.2: pulses exist only on a cable whose junior is writing, 1 / 2 / 4, capped', () => {
  const at = (ms) => ({ lastGrowthAt: NOW - ms });
  assert.equal(crewPulseCount(at(0), NOW), CREW_PULSE_MAX);
  assert.equal(crewPulseCount(at(CREW_ACTIVE_MS / 8), NOW), CREW_PULSE_MAX);
  assert.equal(crewPulseCount(at(CREW_ACTIVE_MS / 4), NOW), 2);
  assert.equal(crewPulseCount(at(CREW_ACTIVE_MS - 1), NOW), 1);
  assert.equal(crewPulseCount(at(CREW_ACTIVE_MS + 1), NOW), 0, 'a finished junior does not pulse');
  assert.equal(crewPulseCount({}, NOW), 0, 'nor one whose runtime says nothing');
  for (const ms of [0, 1000, 20_000, 59_000]) {
    assert.ok(crewPulseCount(at(ms), NOW) <= CREW_PULSE_MAX, 'never more than four');
  }
});

test('§3.2: a pulse travels junior → parent and never the other way', () => {
  const route = [
    { x: 0, y: 0 },
    { x: 0, y: 10 },
    { x: 10, y: 10 },
  ];
  const out = { x: 0, y: 0 };
  // t = 0 is the laptop, which is the FIRST point; t = 1 is the port, the last.
  pointAlong(route, 0, out);
  assert.deepEqual({ ...out }, { x: 0, y: 0 });
  pointAlong(route, 1, out);
  assert.deepEqual({ ...out }, { x: 10, y: 10 });
  // And it advances monotonically, which is the whole of "one direction".
  let last = -1;
  for (let t = 0; t <= 1.0001; t += 0.05) {
    pointAlong(route, t, out);
    const travelled = Math.hypot(out.x - route[0].x, out.y - route[0].y);
    assert.ok(travelled >= last - 1e-9, 'a pulse never runs backwards');
    last = travelled;
  }
});

// ------------------------------------------------------ 8. reduced motion

test('§1.2: under reduced motion two clocks draw the same cable, and it still informs', () => {
  const working = { lastGrowthAt: NOW - 1000 };
  const finished = { lastGrowthAt: NOW - 10 * CREW_ACTIVE_MS };
  for (const later of [NOW, NOW + 7_919, NOW + 3_600_000]) {
    assert.equal(
      crewCableLive(working, NOW, { reduced: true }),
      crewCableLive(working, NOW, { reduced: true }),
    );
    // Two clocks, one frame: the value carries no phase term at all.
    assert.equal(
      crewCableLive(finished, NOW, { reduced: true }),
      crewCableLive(finished, later, { reduced: true }),
    );
    assert.equal(
      crewCableExtent(NOW, { spawnAt: NOW - 100 }, { reduced: true }),
      crewCableExtent(later, { spawnAt: NOW - 100 }, { reduced: true }),
    );
  }
  // Informative, not absent: green and grey are still two different cables.
  assert.equal(crewCableLive(working, NOW, { reduced: true }), 1);
  assert.equal(crewCableLive(finished, NOW, { reduced: true }), 0);
});

test('§3.2: a cable draws on when a junior arrives and retracts when one leaves', () => {
  const half = { spawnAt: NOW - 150 };
  assert.ok(crewCableExtent(NOW, half, {}) > 0 && crewCableExtent(NOW, half, {}) < 1);
  assert.equal(
    crewCableExtent(NOW, { spawnAt: NOW - 10_000 }, {}),
    1,
    'and then it is simply there',
  );
  const going = { leftAt: NOW - 150 };
  assert.ok(crewCableExtent(NOW, going, {}) > 0 && crewCableExtent(NOW, going, {}) < 1);
  assert.equal(crewCableExtent(NOW, { leftAt: NOW - 10_000 }, {}), 0, 'and then it is gone');
  // `?phase=` pins it without turning motion off — the golden's seam.
  assert.ok(Math.abs(crewCableExtent(NOW, { spawnAt: NOW }, { pinned: 0.16 }) - 0.16) < 1e-9);
});

test('§1.1: nothing in the crew reads a wall clock or rolls a die', async () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const rel of ['crew.js', 'crew-draw.js']) {
    const text = await fs.readFile(path.join(here, '..', '..', 'public', 'render', rel), 'utf8');
    // The comments explain why these are forbidden; the code must not use them.
    const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    assert.equal(/\bDate\.now\(\)/.test(code), false, `${rel} reads the machine's clock`);
    assert.equal(/\bMath\.random\(\)/.test(code), false, `${rel} rolls a die`);
    assert.equal(/\bperformance\.now\(\)/.test(code), false, `${rel} reads a tab-local counter`);
  }
});

// ------------------------------------------------- 9. the deck and the cue

test('§3.2: the deck folds a crew under a parent that is in the queue', () => {
  const parent = agent({
    id: 'claude-code:s',
    activityState: 'for_review',
    reviewSince: NOW - 9e5,
  });
  const juniors = [0, 1, 2].map((i) =>
    agent({
      id: `claude-code:j${i}`,
      subagent: true,
      parentId: 'claude-code:s',
      activityState: 'for_review',
      reviewSince: NOW - 1e5,
      subagentType: 'Explore',
    }),
  );
  const rows = queueGroups([parent, ...juniors]).flatMap((g) => g.rows);
  assert.deepEqual(
    rows.map((r) => r.id),
    ['claude-code:s'],
    'one row, not four',
  );
  const folded = crewGroups([parent, ...juniors]);
  assert.equal(folded.get('claude-code:s').length, 3);

  // A junior whose parent is NOT in the queue keeps its own row: folding it
  // under a row that does not exist would hide it.
  const alone = queueGroups(juniors).flatMap((g) => g.rows);
  assert.equal(alone.length, 3);
});

test('§4: one door on the crossing from two juniors to three, and none after', () => {
  const crews = (n) => [{ parentId: 'claude-code:s', count: n }];
  assert.deepEqual(crewCrossings(new Map(), crews(2)), [], 'two is not a crew');
  assert.deepEqual(crewCrossings(new Map([['claude-code:s', 2]]), crews(3)), ['claude-code:s']);
  assert.deepEqual(
    crewCrossings(new Map([['claude-code:s', 3]]), crews(4)),
    [],
    'a crew that grows is not a crew that formed',
  );
  assert.deepEqual(
    crewCrossings(new Map([['claude-code:s', 5]]), crews(5)),
    [],
    'and one that holds is silent',
  );
  // Five juniors appearing inside one poll is ONE crossing and therefore one cue.
  assert.equal(crewCrossings(new Map(), crews(5)).length, 1);
});

// ------------------------------------------------------ the room's own bid

test('§3.2: a crew is contents — the room bids for the arc and not for five chairs', () => {
  const { agents } = crewFloor(5);
  const pop = floorPopulation(agents, { now: NOW });
  assert.deepEqual(pop.crews.get('p'), [5], 'the formation is reported to the planner');
  assert.equal(pop.desks.get('p'), 1, 'and its members are not desks');

  const small = floorPopulation(crewFloor(2).agents, { now: NOW });
  assert.equal(small.crews.has('p'), false, 'two juniors are not a formation');
  assert.equal(small.desks.get('p'), 3, 'and they still take a seat each, as WP-41 had it');

  // The bid grows with the crew, and the arc's own scale is the brief's band.
  assert.ok(crewFootprint(12).h > crewFootprint(5).h);
  assert.ok(CREW_SCALE >= 0.6 && CREW_SCALE <= 0.7, 'the brief asks for 0.60-0.70');
  assert.ok(CREW_ARC_SPAN > 0 && CREW_ARC_SPAN < Math.PI);
});
