/**
 * AGENT SIZE AND THE SCALING LAW — WP-88c.
 * `docs/plan/11-LOOK-CONTROL-CENTRE.md` §2 and §5, `docs/03-VISUAL-SPEC.md` §11.
 *
 * §2 is two tables — what scales with the character and what the building sets —
 * and a rule for reading the live count. This file is the enforcement of both,
 * and it is worth its own suite because the defect it exists to prevent is the
 * class every golden in this project was added for: a figure a quarter larger
 * sitting THROUGH the desk it was drawn at, which passes every unit test written
 * against one size.
 *
 * FIVE THINGS ARE ASSERTED HERE AND NOWHERE ELSE:
 *
 *   1. the classification is COMPLETE — every number the planners export is on
 *      one side of the law, so a package that adds a dimension has to decide;
 *   2. every body length is exactly `s` times its medium value, and every
 *      building length is byte-identical at all four settings;
 *   3. **medium is today** — the emitted plan does not move when the setting is
 *      named, and does not drift after a visit to the other two;
 *   4. `auto` walks a sequence of counts the way §2 says, hysteresis included;
 *   5. the invariants WP-85b and WP-55 hold AT EVERY SIZE — a figure on its
 *      chair and off the desk, a rug no more than 1.35× its cluster, a name that
 *      does not land on a body, and a body over the 16 px legibility floor.
 *
 * IT PRINTS ITS MEASUREMENTS, for `interior.test.mjs`'s reason: a change that
 * moves a size should show you what it moved.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import * as SCALE from '../../public/render/plan-scale.js';
import * as UNITS from '../../public/render/plan-units.js';
import * as FURNITURE from '../../public/render/plan-furniture.js';
import * as PROPS from '../../public/render/plan-props.js';
import * as RIG from '../../public/render/rig-metrics.js';
import * as CORE from '../../public/render/agents-core.js';
import * as FLOORPAINT from '../../public/render/backdrop-floor.js';
import * as CREW from '../../public/render/crew.js';
import { buildPlan } from '../../public/render/plan.js';
import { assignSeats, worldToScreen } from '../../public/render/agents.js';
import {
  characterScaleFor,
  computeFitScale,
  computeTargetAspect,
  resolveLabelCollisions,
} from '../../public/render/scene.js';
import { MIN_SCALE } from '../../public/render/scene-lod.js';
import { characterBox, labelBox, LEGIBILITY_MIN_PX } from '../../public/render/rig.js';
import { AGENT_SIZES, DEFAULT_LOOK } from '../../public/render/look-options.js';
import { pickSessionScale } from '../../public/url-options.js';

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;
const SIZES = /** @type {const} */ (['small', 'medium', 'large']);

/** The namespaces the classification table names, by the key it names them by. */
const MODULES = {
  'plan-scale.js': SCALE,
  'plan-units.js': UNITS,
  'plan-furniture.js': FURNITURE,
  'plan-props.js': PROPS,
  'rig-metrics.js': RIG,
  'agents-core.js': CORE,
  'backdrop-floor.js': FLOORPAINT,
  'crew.js': CREW,
};

/** One table, printed. @param {string} title @param {Array<[string, string]>} rows */
function report(title, rows) {
  const w = rows.reduce((a, [k]) => Math.max(a, k.length), 0);
  console.log(`\n  ${title}`);
  for (const [k, v] of rows) console.log(`    ${k.padEnd(w)}  ${v}`);
}

/** Every export of a namespace whose value is a plain finite number. */
function numbersOf(ns) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const key of Object.keys(ns)) {
    const value = ns[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** Every classified constant, at whatever size the scale is currently at. */
function snapshotConstants() {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [file, ns] of Object.entries(MODULES)) {
    const nums = numbersOf(ns);
    for (const [key, value] of Object.entries(nums)) out[`${file}:${key}`] = value;
  }
  return out;
}

/** @param {string} id @param {any} over */
const agent = (id, over = {}) => ({
  id,
  projectId: 'p0',
  ackState: 'active',
  activityState: 'working',
  lastActivityAt: NOW,
  ...over,
});

/**
 * A floor: `projects` is a list of head counts, and the extras are the three
 * populations the service side is sized by.
 * @param {number[]} sizes
 * @param {{waiting?:number, benched?:number, goneHome?:number}} [extra]
 */
function floor(sizes, extra = {}) {
  const projects = sizes.map((n, i) => ({
    id: `p${i}`,
    name: `repo-${i}`,
    sessionCount: n,
    tokens: 1000 * (i + 1),
    needsYou: 0,
  }));
  /** @type {any[]} */
  const agents = [];
  sizes.forEach((n, i) => {
    for (let k = 0; k < n; k++) agents.push(agent(`p${i}-${k}`, { projectId: `p${i}` }));
  });
  for (let k = 0; k < (extra.waiting ?? 0); k++) {
    agents.push(agent(`w${k}`, { activityState: 'for_review', reviewSince: 1_000_000 + k * 1000 }));
  }
  for (let k = 0; k < (extra.benched ?? 0); k++) {
    agents.push(agent(`b${k}`, { ackState: 'benched', activityState: 'ended' }));
  }
  for (let k = 0; k < (extra.goneHome ?? 0); k++) {
    agents.push(
      agent(`g${k}`, {
        ackState: 'benched',
        activityState: 'ended',
        lastActivityAt: NOW - 30 * DAY,
      }),
    );
  }
  return { projects, agents };
}

/** Populations chosen to straddle the thresholds a size actually moves. */
const POPULATIONS = [
  { name: 'empty', spec: /** @type {const} */ ([[], {}]) },
  { name: 'single', spec: /** @type {const} */ ([[1], {}]) },
  { name: 'three', spec: /** @type {const} */ ([[4, 3, 2], { benched: 4, waiting: 2 }]) },
  { name: 'busy', spec: /** @type {const} */ ([[8, 2], { benched: 7, waiting: 4 }]) },
  {
    name: 'crowd',
    spec: /** @type {const} */ ([[21, 5, 3, 1], { benched: 12, waiting: 9, goneHome: 6 }]),
  },
  // The README floor's own shape and size: six repos, five of them with somebody
  // in them, a queue and a lounge — twenty-seven people drawn, which is the
  // population §5 asks the label question of.
  {
    name: 'demo',
    spec: /** @type {const} */ ([[4, 4, 3, 3, 2], { benched: 7, waiting: 4 }]),
  },
  {
    name: 'hundred',
    spec: /** @type {const} */ ([
      [12, 12, 12, 12, 8, 8, 8, 8, 6, 6, 4, 4],
      { benched: 20, waiting: 14 },
    ]),
  },
];

const ASPECTS = [1.3, 1.6, 2.06];
const STAGE = { w: 1600, h: 936 };

/** @param {string} name @param {string|undefined} agentSize @param {number} targetAspect */
function planFor(name, agentSize, targetAspect = 1.6) {
  const pop = POPULATIONS.find((p) => p.name === name);
  if (!pop) throw new Error(`no population ${name}`);
  const { projects, agents } = floor([...pop.spec[0]], pop.spec[1]);
  return buildPlan(projects, agents, { targetAspect, now: NOW, agentSize });
}

// ------------------------------------------------------- 1. the classification

test('§2: every number the planners export is on one side of the law, and on only one', () => {
  // THE WHOLE POINT OF THE TABLE. A law that lives in a document is a law that a
  // package can add a constant beside without noticing; this is what makes the
  // decision compulsory. A new export fails here until somebody has said whether
  // a person sets it or the building does.
  let classified = 0;
  const counts = { body: 0, building: 0, pure: 0 };
  for (const [file, ns] of Object.entries(MODULES)) {
    const table = SCALE.SCALE_CLASSES[file];
    assert.ok(table, `${file} exports numbers and the classification does not know it`);
    const buckets = /** @type {const} */ (['body', 'building', 'pure']);
    /** @type {Map<string, string>} */
    const where = new Map();
    for (const bucket of buckets) {
      for (const name of table[bucket]) {
        assert.equal(
          where.has(name),
          false,
          `${file}/${name} is classified twice — as ${where.get(name)} and as ${bucket}`,
        );
        where.set(name, bucket);
        assert.equal(
          typeof ns[name],
          'number',
          `${file}/${name} is classified and is not a number this module exports`,
        );
        counts[bucket]++;
      }
    }
    for (const name of Object.keys(numbersOf(ns))) {
      assert.ok(where.has(name), `${file} exports ${name} and nothing says whether it scales`);
      classified++;
    }
  }
  assert.equal(
    classified,
    counts.body + counts.building + counts.pure,
    'the table names a constant its module does not export',
  );
  report('§2, the two tables as a count', [
    ['body — a person sets it', String(counts.body)],
    ['building — the plan sets it', String(counts.building)],
    ['neither — a ratio, a count, a px', String(counts.pure)],
    ['modules covered', String(Object.keys(MODULES).length)],
  ]);
});

// ------------------------------------------------------- 2. the law, measured

test('§2: a body length is exactly s × its medium value, and nothing else moves', () => {
  SCALE.resetAgentScale();
  const medium = snapshotConstants();

  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const size of SIZES) {
    SCALE.setAgentSize(size);
    const s = SCALE.AGENT_SCALES[size];
    const now = snapshotConstants();
    let moved = 0;
    let held = 0;
    for (const file of Object.keys(MODULES)) {
      const table = SCALE.SCALE_CLASSES[file];
      for (const name of table.body) {
        const key = `${file}:${name}`;
        // `1e-12` is a float epsilon and not a tolerance: every body constant is
        // its base times `s` in ONE multiplication, so the only difference a
        // correct implementation can produce is the last bit of a double.
        assert.ok(
          Math.abs(now[key] - medium[key] * s) < 1e-12,
          `${key} at ${size} is ${now[key]}, not ${medium[key]} × ${s}`,
        );
        moved++;
      }
      for (const bucket of /** @type {const} */ (['building', 'pure'])) {
        for (const name of table[bucket]) {
          const key = `${file}:${name}`;
          assert.equal(now[key], medium[key], `${key} moved at ${size} and the building sets it`);
          held++;
        }
      }
    }
    rows.push([size, `s = ${s} · ${moved} lengths moved · ${held} held`]);
    // And back, exactly: a size the user visits and leaves must leave nothing
    // behind, or `medium` stops being today the second somebody clicks around.
    SCALE.resetAgentScale();
    assert.deepEqual(snapshotConstants(), medium, `${size} left a constant behind`);
  }
  report('the scaling law', rows);
});

test('§2: the figure is 2.02 / 2.52 / 3.15 U, off a frame unit of 1.6 / 2.0 / 2.5', () => {
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const [size, unit, height] of /** @type {const} */ ([
    ['small', 1.6, 2.016],
    ['medium', 2.0, 2.52],
    ['large', 2.5, 3.15],
  ])) {
    SCALE.setAgentSize(size);
    assert.ok(Math.abs(RIG.RIG_UNIT_U - unit) < 1e-12, `${size}: RIG_UNIT_U is ${RIG.RIG_UNIT_U}`);
    assert.ok(
      Math.abs(RIG.BODY_HEIGHT_U - height) < 1e-9,
      `${size}: BODY_HEIGHT_U is ${RIG.BODY_HEIGHT_U}, not ${height}`,
    );
    // §2's table prints 2.02 for small, which is this number to two places —
    // `1.6 × 1.26` is 2.016 and the document rounds. Said out loud so nobody
    // "fixes" the constant to make the document literal.
    rows.push([size, `${unit} U frame · ${RIG.BODY_HEIGHT_U.toFixed(3)} U crown to sole`]);
    SCALE.resetAgentScale();
  }
  report('the figure', rows);
});

// ------------------------------------------------------------ 3. medium is today

test('§5: at medium the emitted plan is byte-identical to the floor with no setting at all', () => {
  // The acceptance in one line. `agentSize` absent is the code path every caller
  // that predates this package takes, and `medium` is the same floor by
  // construction — `s = 1` is the identity. If these two ever differ, every
  // committed golden is wrong and this is where it says so.
  for (const pop of POPULATIONS) {
    for (const aspect of ASPECTS) {
      const before = JSON.stringify(planFor(pop.name, undefined, aspect));
      const named = JSON.stringify(planFor(pop.name, 'medium', aspect));
      assert.equal(named, before, `${pop.name} @ ${aspect} moved when medium was named`);
    }
  }
  SCALE.resetAgentScale();
});

test('§5: a plan at medium is the same plan after a visit to small and to large', () => {
  // The float-drift question, asked directly. Every body constant is re-derived
  // from its own base rather than multiplied by a ratio, so a round trip is
  // exact — but "is exact" is a claim about arithmetic nobody should have to
  // take on trust when a golden depends on it.
  for (const pop of POPULATIONS) {
    const first = JSON.stringify(planFor(pop.name, 'medium'));
    planFor(pop.name, 'small');
    planFor(pop.name, 'large');
    planFor(pop.name, 'small', 2.06);
    const again = JSON.stringify(planFor(pop.name, 'medium'));
    assert.equal(again, first, `${pop.name} drifted after a round trip through the other sizes`);
  }
  SCALE.resetAgentScale();
});

// ------------------------------------------------------------------- 4. auto

test('§2: auto is ≤10 large, ≤40 medium, else small — with ±2 of hysteresis', () => {
  assert.equal(SCALE.AUTO_LARGE_MAX, 10);
  assert.equal(SCALE.AUTO_MEDIUM_MAX, 40);
  assert.equal(SCALE.AUTO_HYSTERESIS, 2);

  // Cold, with nothing to be on the other side of: the plain thresholds.
  for (const [n, want] of /** @type {const} */ ([
    [0, 'large'],
    [10, 'large'],
    [11, 'medium'],
    [40, 'medium'],
    [41, 'small'],
    [400, 'small'],
  ])) {
    assert.equal(SCALE.autoAgentSize(n, null), want, `cold at ${n}`);
  }

  // AND THE WHOLE POINT OF THE BAND, on one injected sequence of counts: a floor
  // sitting on a threshold while one session starts and stops must not re-plan
  // the building twice a minute. §2's own numbers — *"up at 12 and 42, down at 8
  // and 38"* — read off the walk rather than asserted one edge at a time.
  const walk = [0, 5, 9, 10, 11, 12, 13, 20, 39, 41, 42, 43, 41, 39, 38, 20, 12, 11, 9, 8];
  /** @type {string|null} */
  let prev = null;
  const got = walk.map((n) => {
    prev = SCALE.autoAgentSize(n, prev);
    return prev;
  });
  assert.deepEqual(
    got,
    [
      // rising: large holds past ten, and gives way at thirteen
      'large',
      'large',
      'large',
      'large',
      'large',
      'large',
      'medium',
      'medium',
      // rising: medium holds past forty, and gives way at forty-three
      'medium',
      'medium',
      'medium',
      'small',
      // falling: small holds down to thirty-nine, and gives way at thirty-eight
      'small',
      'small',
      'medium',
      'medium',
      // falling: medium holds down to nine, and gives way at eight
      'medium',
      'medium',
      'medium',
      'large',
    ],
    `auto walked ${got.join(' ')}`,
  );
  report(
    'auto on one sequence',
    walk.map((n, i) => [String(n), got[i]]),
  );
});

test('§2: auto reads the people the floor DRAWS, and a plan says what it landed on', () => {
  // Not the session list: the population below has six live agents and thirty
  // that have gone home, and a floor of six people is a floor for `large`.
  const quiet = buildPlan(...Object.values(floor([3, 2, 1], { goneHome: 30 })), {
    targetAspect: 1.6,
    now: NOW,
    agentSize: 'auto',
  });
  assert.equal(quiet.agentSize, 'large');
  assert.equal(quiet.agentScale, 1.25);

  const packed = buildPlan(...Object.values(floor([12, 12, 12, 12], { benched: 20 })), {
    targetAspect: 1.6,
    now: NOW,
    agentSize: 'auto',
  });
  assert.equal(packed.agentSize, 'small');
  assert.equal(packed.agentScale, 0.8);

  // And a named size is never overruled by a count.
  for (const size of SIZES) {
    assert.equal(planFor('hundred', size).agentSize, size);
    assert.equal(planFor('single', size).agentSize, size);
  }
  SCALE.resetAgentScale();
});

// ------------------------------------------- 5. the invariants, at every size

test('§5: a seated figure sits ON its chair and never through the desk, at every size', () => {
  // WP-85b's own invariant, asked three times. It is THE question a scaling law
  // can get wrong silently: a chair that scaled while the gap to the desk did
  // not is a figure standing on the table top, and no other test would see it.
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const size of SIZES) {
    let seats = 0;
    for (const pop of POPULATIONS) {
      for (const aspect of ASPECTS) {
        const plan = planFor(pop.name, size, aspect);
        for (const room of plan.rooms) {
          if (room.kind !== 'project') continue;
          const chairs = (room.props || []).filter((p) => p.kind === 'chair');
          const desks = (room.props || []).filter((p) => p.kind === 'desk');
          for (const seat of plan.seats.get(room.id) || []) {
            seats++;
            const chair = chairs.find(
              (c) =>
                seat.x >= c.x - 1e-6 &&
                seat.x <= c.x + c.w + 1e-6 &&
                seat.y >= c.y - 1e-6 &&
                seat.y <= c.y + c.h + 1e-6,
            );
            assert.ok(chair, `${size}/${room.id}: a seat with no chair under it`);
            for (const desk of desks) {
              const on =
                seat.x + RIG.SHADOW_RX > desk.x &&
                seat.x - RIG.SHADOW_RX < desk.x + desk.w &&
                seat.y + RIG.SHADOW_RY > desk.y &&
                seat.y - RIG.SHADOW_RY < desk.y + desk.h;
              assert.equal(on, false, `${size}/${room.id}: a figure has its feet on the desk top`);
            }
          }
        }
      }
    }
    assert.ok(seats >= 60, `${size}: expected a real ladder of seats, measured ${seats}`);
    rows.push([size, `${seats} seats · contact ellipse ${RIG.SHADOW_RX.toFixed(2)} U`]);
  }
  SCALE.resetAgentScale();
  report('the seated figure', rows);
});

test('§3.4: a task rug is never more than 1.35× its desk cluster, at every size', () => {
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const size of SIZES) {
    let worst = 0;
    let rooms = 0;
    for (const pop of POPULATIONS) {
      for (const aspect of ASPECTS) {
        for (const room of planFor(pop.name, size, aspect).rooms) {
          if (room.kind !== 'project' || room.pinned) continue;
          const group = (room.zones || []).find((z) => z.id === 'desk-group');
          const rug = (room.props || []).find((p) => p.kind === 'rug');
          if (!group || !rug) continue;
          rooms++;
          for (const [axis, got, base] of /** @type {const} */ ([
            ['width', rug.w, group.w],
            ['depth', rug.h, group.h],
          ])) {
            worst = Math.max(worst, got / base);
            assert.ok(
              got / base <= UNITS.RUG_MAX_OVER_CLUSTER + 1e-9,
              `${size}/${room.id}: the rug's ${axis} is ${(got / base).toFixed(2)}× its cluster`,
            );
          }
        }
      }
    }
    assert.ok(rooms >= 20, `${size}: expected a real ladder of rooms, measured ${rooms}`);
    rows.push([size, `${rooms} rooms · worst ${worst.toFixed(3)}×`]);
  }
  SCALE.resetAgentScale();
  report(`the task rug (ceiling ${UNITS.RUG_MAX_OVER_CLUSTER})`, rows);
});

test('§5: the same population puts the same people in the same rooms in the same order', () => {
  // WP-80's criterion was that the room RECTANGLES do not move, and §2 says why
  // that is the wrong invariant: *"a 3.15 U robot at a 2.6 U desk sits through
  // the desk"*. This is the right one — the rooms grow and shrink with their
  // contents, and who is in them does not change.
  for (const pop of POPULATIONS) {
    /** @type {string|null} */
    let expected = null;
    for (const size of [...SIZES, 'auto']) {
      const { projects, agents } = floor([...pop.spec[0]], pop.spec[1]);
      const plan = buildPlan(projects, agents, { targetAspect: 1.6, now: NOW, agentSize: size });
      const seats = assignSeats(plan, agents);
      /** @type {Map<string,string>} */
      const where = new Map();
      const at = (seat) => `${seat.x.toFixed(4)},${seat.y.toFixed(4)}`;
      for (const room of plan.rooms) {
        for (const [i, seat] of (plan.seats.get(room.id) || []).entries()) {
          where.set(at(seat), `${room.id}#${i}`);
        }
      }
      // The queue is ORDERED and the order is the claim: `assignSeats` fills the
      // reception oldest wait first, so a size that shuffled it would be seating
      // people by how big they are.
      for (const [i, seat] of (plan.officeSeats || []).entries()) {
        where.set(at(seat), `reception#${i}`);
      }
      if (plan.officeChair) where.set(at(plan.officeChair), 'manager');
      // Anything else is the lounge, and it is deliberately NOT asked which SPOT:
      // which activity a benched agent gets is a property of the lounge's
      // furniture, and the lounge's furniture is exactly what a size moves. The
      // claim §5 makes is about rooms, not about pool cues.
      const placed = agents
        .map((a) => {
          const seat = seats.get(a.id);
          return `${a.id}=${seat ? where.get(at(seat)) || 'lounge' : '-'}`;
        })
        .join('|');
      if (expected === null) expected = placed;
      else assert.equal(placed, expected, `${pop.name} seats people differently at ${size}`);
    }
  }
  SCALE.resetAgentScale();
});

test('§5: at small, no name lands on a body, and shrinking costs no names', () => {
  // The design README's own risk note, asked at the size that makes it hardest.
  // `small` packs the desks 20% closer together while the LABEL does not shrink
  // at all — §2: *"a large floor gets larger people under the same labels"* — so
  // if any size can draw a name over somebody's head it is this one.
  //
  // TWO CLAIMS, AND THE SECOND ONE IS WHY MEDIUM IS MEASURED BESIDE IT. Zero
  // labels on a body is absolute and holds at every size. How MANY names survive
  // is not: `resolveLabelCollisions` drops rather than overlaps, and a bench of
  // six people one body apart loses names at every size this product has ever
  // drawn — so the honest question is not "how many" but *"does making the
  // people smaller cost names"*, and the answer is measured against medium
  // rather than against a number somebody picked.
  const ctx = { font: '', measureText: (t) => ({ width: String(t).length * 6 }) };
  const hits = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const demo = POPULATIONS.find((p) => p.name === 'demo');

  /** @param {string} size @param {number} viewW @param {number} viewH */
  function measure(size, viewW, viewH) {
    const { projects, agents } = floor([...demo.spec[0]], demo.spec[1]);
    const plan = buildPlan(projects, agents, {
      targetAspect: computeTargetAspect(viewW, viewH),
      now: NOW,
      agentSize: size,
    });
    const seats = assignSeats(plan, agents);
    const fit = computeFitScale(plan.width, plan.height, viewW, viewH);
    const u = characterScaleFor(fit);
    const camera = { zoom: fit / 14, panX: 0, panY: 0, U: 14 };
    const people = agents
      .map((a) => ({ id: a.id, seat: seats.get(a.id) }))
      .filter((p) => p.seat)
      .map((p) => ({ id: p.id, ...worldToScreen(p.seat, camera) }))
      .sort((a, b) => a.y - b.y);
    // Exactly what `scene-draw.js` builds: every body first and pinned, then the
    // labels, through the frame's own collision pass.
    const bodies = people.map((p) => ({
      id: `body:${p.id}`,
      ...characterBox(p.x, p.y, u),
      pin: true,
    }));
    const items = people.map((p) => {
      const box = labelBox(ctx, p.x, p.y, u, 'MK4.1');
      return { id: p.id, x: box.x, y: box.y, w: box.w, h: box.h };
    });
    const resolved = resolveLabelCollisions([...bodies, ...items]);
    let overlaps = 0;
    let drawn = 0;
    for (const item of items) {
      const placed = resolved.get(item.id);
      if (!placed) continue; // dropped rather than drawn over a body
      drawn++;
      const rect = { x: item.x, y: item.y + placed.offsetY, w: item.w, h: item.h };
      for (const body of bodies) if (hits(rect, body)) overlaps++;
    }
    return { people: people.length, drawn, overlaps, u };
  }

  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const [viewW, viewH] of [
    [1600, 936],
    [1280, 656],
  ]) {
    /** @type {Record<string, any>} */
    const seen = {};
    for (const size of SIZES) {
      const m = measure(size, viewW, viewH);
      seen[size] = m;
      assert.ok(m.people >= 27, `${size}: expected a floor of 27, drew ${m.people}`);
      assert.equal(m.overlaps, 0, `${size} at ${viewW}x${viewH}: a name landed on a body`);
      rows.push([
        `${size} ${viewW}x${viewH}`,
        `${m.people} people at u=${m.u.toFixed(1)} · ${m.drawn} names · 0 on a body`,
      ]);
    }
    assert.ok(
      seen.small.drawn >= Math.floor(seen.medium.drawn * 0.8),
      `${viewW}x${viewH}: small draws ${seen.small.drawn} names where medium draws ` +
        `${seen.medium.drawn} — shrinking the people cost the floor its names`,
    );
  }
  SCALE.resetAgentScale();
  report('names over a floor of 27', rows);
});

test('§5: every body clears 16 px at small, and no floor leaves its stage at large', () => {
  /** @type {Array<[string,string]>} */
  const rows = [];
  for (const size of SIZES) {
    let worstBody = Infinity;
    let worstFill = 0;
    for (const pop of POPULATIONS) {
      const plan = planFor(pop.name, size, computeTargetAspect(STAGE.w, STAGE.h));
      const fit = computeFitScale(plan.width, plan.height, STAGE.w, STAGE.h);
      const body = characterScaleFor(fit) * RIG.BODY_HEIGHT_U;
      worstBody = Math.min(worstBody, body);
      assert.ok(
        body >= LEGIBILITY_MIN_PX.body - 1e-9,
        `${size}/${pop.name}: a body is ${body.toFixed(1)} px, under §6.2's floor`,
      );
      // And the building is inside the window it was planned for. `MIN_SCALE` is
      // the one case where it is not — the floor holds and the working side
      // scrolls — so the assertion is the fit, not a promise it never bites.
      if (fit > MIN_SCALE + 1e-9) {
        assert.ok(
          plan.width * fit <= STAGE.w + 1e-6 && plan.height * fit <= STAGE.h + 1e-6,
          `${size}/${pop.name}: the building is drawn off the stage`,
        );
      }
      worstFill = Math.max(worstFill, (plan.width * fit) / STAGE.w);
    }
    rows.push([size, `smallest body ${worstBody.toFixed(1)} px · widest fill ${(worstFill * 100).toFixed(0)}%`]); // prettier-ignore
  }
  SCALE.resetAgentScale();
  report('legibility at fit scale', rows);
});

// -------------------------------------------------------------- the settings

test('§2: the catalogue, the default and `?scale=` agree about what a size is', () => {
  assert.deepEqual([...AGENT_SIZES], ['small', 'medium', 'large', 'auto']);
  for (const id of SCALE.SIZE_IDS) assert.ok(AGENT_SIZES.includes(id));
  // Owner decision 2 over decision 3: the shipped look is a SIZE and not `auto`,
  // because `auto` on a quiet machine is `large` and that is a floor the twelve
  // committed goldens are not photographs of. `docs/DEVIATIONS.md` §177.
  assert.equal(DEFAULT_LOOK.agentSize, 'medium');
  assert.equal(SCALE.DEFAULT_AGENT_SIZE, 'medium');

  // `?scale=` is one of four words, this tab only, and unknown values do nothing.
  const base = { preset: 'studio-oak', agentSize: 'medium' };
  assert.equal(pickSessionScale('', base, AGENT_SIZES), base, 'no parameter must change nothing');
  assert.equal(pickSessionScale('?scale=enormous', base, AGENT_SIZES), base);
  assert.equal(pickSessionScale('?scale=%%%', base, AGENT_SIZES), base);
  for (const id of AGENT_SIZES) {
    assert.deepEqual(pickSessionScale(`?scale=${id}`, base, AGENT_SIZES), {
      ...base,
      agentSize: id,
    });
    // Case and spacing are a URL's business, not the floor's.
    assert.deepEqual(pickSessionScale(`?scale=${id.toUpperCase()}`, base, AGENT_SIZES), {
      ...base,
      agentSize: id,
    });
  }
  // And it leaves the rest of the look exactly as it found it.
  const rich = { ...DEFAULT_LOOK, preset: 'night-lab' };
  const out = /** @type {any} */ (pickSessionScale('?scale=large', rich, AGENT_SIZES));
  assert.equal(out.preset, 'night-lab');
  assert.equal(out.scheme, rich.scheme);
});
