/**
 * Geometry invariants for `public/render/plan.js` under
 * `docs/05-LAYOUT-REWORK.md` §2.1–§2.3 and the §3 acceptance list.
 *
 * This file measures the plan objectively rather than by eye:
 *   - §3.3 "nothing floats" — no prop sits more than 2.0 U from the wall or
 *     the object its anchor names, over the whole floor.
 *   - §3.4 chair-to-desk gap is 0.15 U ± 0.05, everywhere.
 *   - §3.9 density is uniform: the same gap/inset in the smallest and the
 *     largest room, because §2.1 fixes density once and never rescales it
 *     per room.
 *   - Every prop's anchor is well-formed and its target resolves to a real
 *     zone or id-carrying prop; `resolveAnchors` is idempotent.
 *   - The squarified treemap tiles its rectangle exactly, and no two rooms
 *     ever overlap or spill outside the floor.
 *
 * Plan-level behaviour (aspect ratio, lounge sizing, session counts, token
 * formatting, ...) lives in `plan.test.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, resolveAnchors } from '../../public/render/plan.js';

const EPS = 1e-6;
const MAX_FLOAT_DISTANCE = 2.0;
const CHAIR_GAP_MIN = 0.1; // 0.15 ± 0.05
const CHAIR_GAP_MAX = 0.2;

/** @param {string} id @param {number} sessionCount @param {object} [extra] */
function makeProject(id, sessionCount, extra = {}) {
  return { id, name: id, sessionCount, tokens: 0, needsYou: 0, ...extra };
}

/** @param {number} n */
function benchedAgents(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `bench-${i}`, ackState: 'benched' }));
}

/** @param {number} n */
function waitingAgents(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `wait-${i}`,
    ackState: 'active',
    activityState: 'for_review',
  }));
}

// The orchestrator's 16-project reference fixture, exercised with both a
// benched and a waiting population so every activity block and the office
// waiting area are all present at once.
const SESSION_COUNTS_16 = [1, 1, 1, 1, 2, 2, 5, 11, 21, 3, 4, 1, 1, 2, 6, 1];

function bigFixturePlan() {
  const projects = SESSION_COUNTS_16.map((c, i) =>
    makeProject(`proj-${i}`, c, { tokens: c * 10_000 }),
  );
  const agents = [...benchedAgents(12), ...waitingAgents(21)];
  return buildPlan(projects, agents);
}

/** Bounding box of a set of rects. */
function boundsOf(items) {
  if (!items.length) return { x: 0, y: 0, w: 0, h: 0 };
  const minX = Math.min(...items.map((i) => i.x));
  const minY = Math.min(...items.map((i) => i.y));
  const maxX = Math.max(...items.map((i) => i.x + i.w));
  const maxY = Math.max(...items.map((i) => i.y + i.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Every zone plus every id-carrying prop in a room, keyed by id. */
function byIdMap(room) {
  const map = new Map();
  for (const z of room.zones || []) map.set(z.id, z);
  for (const p of room.props) if (p.id) map.set(p.id, p);
  return map;
}

/** Edge-to-edge gap between two rects; 0 when touching or overlapping. */
function rectGap(a, b) {
  const dx = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
  const dy = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
  return Math.hypot(dx, dy);
}

/** Distance from a prop's rect to the nearest of its room's four walls. */
function wallDist(prop, room) {
  const L = room.x;
  const T = room.y;
  const R = room.x + room.w;
  const B = room.y + room.h;
  return Math.min(prop.x - L, R - (prop.x + prop.w), prop.y - T, B - (prop.y + prop.h));
}

function rectsOverlap(a, b, eps = EPS) {
  return (
    a.x < b.x + b.w - eps && a.x + a.w > b.x + eps && a.y < b.y + b.h - eps && a.y + a.h > b.y + eps
  );
}

/** Edge-to-edge (wall or attachment-target) distance for one resolved prop. */
function propAnchorDistance(prop, room, targets) {
  const a = prop.anchor;
  if (a.type === 'wall' || a.type === 'corner') return wallDist(prop, room);
  const targetId = a.type === 'attached' ? a.to : a.of;
  const target = targets.get(targetId);
  assert.ok(target, `${room.id}/${prop.kind}: anchor target "${targetId}" does not resolve`);
  return rectGap(prop, target);
}

// -------------------------------------------------------- §3.3 nothing floats

test('§3.3 no prop is more than 2.0 U from the nearest wall or its anchor target', () => {
  const plan = bigFixturePlan();
  let checked = 0;
  for (const room of plan.rooms) {
    const targets = byIdMap(room);
    for (const prop of room.props) {
      const dist = propAnchorDistance(prop, room, targets);
      assert.ok(
        dist <= MAX_FLOAT_DISTANCE + EPS,
        `${room.id}/${prop.kind} is ${dist.toFixed(3)} U from its anchor — nothing may float past 2.0 U`,
      );
      checked++;
    }
  }
  assert.ok(checked > 50, 'sanity: the fixture should exercise a substantial number of props');
});

// -------------------------------------------------------------- §3.4 chairs

test('§3.4 chair-to-desk gap is 0.15 U ± 0.05 for every chair, in every room', () => {
  const plan = bigFixturePlan();
  let chairCount = 0;
  for (const room of plan.rooms) {
    const targets = byIdMap(room);
    for (const prop of room.props) {
      if (prop.kind !== 'chair') continue;
      assert.equal(prop.anchor.type, 'attached', 'a chair must be attached to its desk');
      const desk = targets.get(prop.anchor.to);
      assert.ok(desk, `${room.id}: chair's desk target "${prop.anchor.to}" does not resolve`);
      const gap = rectGap(prop, desk);
      assert.ok(
        gap >= CHAIR_GAP_MIN && gap <= CHAIR_GAP_MAX,
        `${room.id}: chair-desk gap ${gap} is outside 0.15 ± 0.05`,
      );
      chairCount++;
    }
  }
  assert.ok(chairCount > 0, 'sanity: the fixture must contain chairs');
});

// --------------------------------------------------------- §3.9 uniform density

test('§3.9 chair and plant offsets are identical in the smallest and the largest zone', () => {
  const plan = bigFixturePlan();
  const projectRooms = plan.rooms.filter((r) => r.kind === 'project');
  assert.ok(projectRooms.length >= 2, 'need at least two project rooms to compare');

  const byArea = [...projectRooms].sort((a, b) => a.w * a.h - b.w * b.h);
  const smallest = byArea[0];
  const largest = byArea[byArea.length - 1];
  assert.ok(
    largest.w * largest.h > smallest.w * smallest.h * 2,
    'sanity: the fixture must actually contain rooms of very different sizes',
  );

  // Density is fixed by the furniture, never rescaled per zone: a chair is
  // the same distance from its table and a plant the same distance from the
  // table it stands beside, in the smallest zone and the largest.
  const measure = (room) => {
    const targets = byIdMap(room);
    const chair = room.props.find((p) => p.kind === 'chair');
    const plant = room.props.find((p) => p.kind === 'plant');
    const table = targets.get(chair.anchor.to);
    const plantTarget = targets.get(plant.anchor.to);
    return { chairGap: rectGap(chair, table), plantInset: rectGap(plant, plantTarget) };
  };

  const small = measure(smallest);
  const large = measure(largest);

  assert.ok(
    Math.abs(small.chairGap - large.chairGap) < EPS,
    `chair gap differs: ${smallest.id}=${small.chairGap} vs ${largest.id}=${large.chairGap}`,
  );
  assert.ok(
    Math.abs(small.plantInset - large.plantInset) < EPS,
    `plant offset differs: ${smallest.id}=${small.plantInset} vs ${largest.id}=${large.plantInset}`,
  );
});

// ------------------------------------------------------------------ anchors

const ANCHOR_SIDES = new Set(['N', 'S', 'E', 'W']);
const ANCHOR_CORNERS = new Set(['NE', 'NW', 'SE', 'SW']);

test('every prop carries a valid, well-formed anchor', () => {
  const plan = bigFixturePlan();
  for (const room of plan.rooms) {
    for (const prop of room.props) {
      const a = prop.anchor;
      assert.ok(a && typeof a === 'object', `${room.id}/${prop.kind} has no anchor`);
      switch (a.type) {
        case 'zone':
          // Anchored directly to the zone it stands in, by an offset from the
          // zone's origin — used where a prop belongs to the room itself
          // rather than to another prop.
          assert.equal(typeof a.of, 'string');
          assert.equal(typeof a.dx, 'number');
          assert.equal(typeof a.dy, 'number');
          break;
        case 'wall':
          assert.ok(ANCHOR_SIDES.has(a.side), `${room.id}/${prop.kind}: bad wall side "${a.side}"`);
          assert.equal(typeof a.along, 'number');
          break;
        case 'corner':
          assert.ok(
            ANCHOR_CORNERS.has(a.corner),
            `${room.id}/${prop.kind}: bad corner "${a.corner}"`,
          );
          break;
        case 'attached':
          assert.equal(typeof a.to, 'string');
          assert.ok(
            ANCHOR_SIDES.has(a.edge),
            `${room.id}/${prop.kind}: bad attach edge "${a.edge}"`,
          );
          assert.equal(typeof a.along, 'number');
          break;
        case 'centered':
          assert.equal(typeof a.of, 'string');
          break;
        default:
          assert.fail(`${room.id}/${prop.kind} has unknown anchor type "${a.type}"`);
      }
      for (const key of ['x', 'y', 'w', 'h', 'angle']) {
        assert.ok(Number.isFinite(prop[key]), `${room.id}/${prop.kind}.${key} is not finite`);
      }
    }
  }
});

test('every attached.to / centered.of target resolves to a real zone or id-carrying prop', () => {
  const plan = bigFixturePlan();
  for (const room of plan.rooms) {
    const targets = byIdMap(room);
    for (const prop of room.props) {
      const a = prop.anchor;
      if (a.type !== 'attached' && a.type !== 'centered') continue;
      const id = a.type === 'attached' ? a.to : a.of;
      assert.ok(targets.has(id), `${room.id}/${prop.kind}: no zone or prop with id "${id}"`);
    }
  }
});

test('resolveAnchors is idempotent: running it again does not move anything', () => {
  const plan = bigFixturePlan();
  for (const room of plan.rooms) {
    const before = room.props.map((p) => [p.x, p.y]);
    resolveAnchors(room);
    const after = room.props.map((p) => [p.x, p.y]);
    before.forEach(([x, y], i) => {
      assert.ok(
        Math.abs(after[i][0] - x) < 1e-9,
        `${room.id} prop ${i} (${room.props[i].kind}) x moved on re-resolve`,
      );
      assert.ok(
        Math.abs(after[i][1] - y) < 1e-9,
        `${room.id} prop ${i} (${room.props[i].kind}) y moved on re-resolve`,
      );
    });
  }
});

// ------------------------------------------------------------ treemap soundness

function twelvePlusProjectPlan() {
  const counts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 21];
  const projects = counts.map((c, i) => makeProject(`p${i}`, c, { tokens: c * 1000 }));
  return { plan: buildPlan(projects, benchedAgents(10)), count: counts.length };
}

test('treemap soundness: no two rooms overlap on a 12+ project floor', () => {
  const { plan, count } = twelvePlusProjectPlan();
  // office + N projects + lounge, plus however many corridors the plan needs
  // to connect them. The zones are what this counts; circulation is separate.
  const zones = plan.rooms.filter((r) => r.kind !== 'corridor');
  assert.equal(zones.length, count + 2, 'office + N projects + lounge');
  assert.ok(
    plan.rooms.some((r) => r.kind === 'corridor'),
    'the floor must lay out circulation between its zones',
  );
  for (let i = 0; i < plan.rooms.length; i++) {
    for (let j = i + 1; j < plan.rooms.length; j++) {
      assert.ok(
        !rectsOverlap(plan.rooms[i], plan.rooms[j]),
        `rooms overlap: ${plan.rooms[i].id} and ${plan.rooms[j].id}`,
      );
    }
  }
});

test('treemap soundness: every room lies inside the floor rectangle', () => {
  const { plan } = twelvePlusProjectPlan();
  for (const room of plan.rooms) {
    assert.ok(room.x >= -EPS, `${room.id} starts left of the floor`);
    assert.ok(room.y >= -EPS, `${room.id} starts above the floor`);
    assert.ok(room.x + room.w <= plan.width + EPS, `${room.id} extends past the right edge`);
    assert.ok(room.y + room.h <= plan.height + EPS, `${room.id} extends past the bottom edge`);
  }
});

test('every zone holds its own furniture, and the zones tile the floor exactly', () => {
  // The floor is one continuous envelope divided into zones that share their
  // boundaries. Two things must hold together: no zone may be too small for
  // the furniture it was built around, and the zones must cover the envelope
  // completely — any uncovered floor would be the dead space this model
  // exists to remove.
  for (const benched of [0, 6, 12]) {
    const projects = SESSION_COUNTS_16.map((c, i) => makeProject('proj-' + i, c));
    const plan = buildPlan(projects, [...benchedAgents(benched), ...waitingAgents(11)]);

    for (const room of plan.rooms) {
      // Corridors are circulation, not zones: no furniture to hold.
      if (room.kind === 'corridor') continue;
      const box = boundsOf(room.props);
      assert.ok(
        box.x >= room.x - EPS &&
          box.y >= room.y - EPS &&
          box.x + box.w <= room.x + room.w + EPS &&
          box.y + box.h <= room.y + room.h + EPS,
        `${room.id}: furniture ${box.w.toFixed(1)}x${box.h.toFixed(1)} does not fit its zone ${room.w.toFixed(1)}x${room.h.toFixed(1)}`,
      );
    }

    const covered = plan.rooms.reduce((a, r) => a + r.w * r.h, 0);
    const envelope = plan.width * plan.height;
    assert.ok(
      Math.abs(covered - envelope) / envelope < 0.001,
      `zones cover ${((covered / envelope) * 100).toFixed(1)}% of the floor, expected 100%`,
    );
  }
});

test('zones never overlap, and all lie inside the envelope', () => {
  const plan = buildPlan(
    SESSION_COUNTS_16.map((c, i) => makeProject('proj-' + i, c)),
    [...benchedAgents(10), ...waitingAgents(11)],
  );
  for (let i = 0; i < plan.rooms.length; i++) {
    for (let j = i + 1; j < plan.rooms.length; j++) {
      const a = plan.rooms[i];
      const b = plan.rooms[j];
      assert.ok(!rectsOverlap(a, b), `rooms overlap: ${a.id} and ${b.id}`);
    }
  }
  // Nothing may sit outside the floor either.
  for (const room of plan.rooms) {
    assert.ok(room.x >= -EPS && room.y >= -EPS, `${room.id} starts outside the floor`);
    assert.ok(room.x + room.w <= plan.width + EPS, `${room.id} overflows the floor on x`);
    assert.ok(room.y + room.h <= plan.height + EPS, `${room.id} overflows the floor on y`);
  }
});

test('the office leads the packing, so it lands in the top-left region', () => {
  // 01-PRODUCT.md §4.3: the user's office is always the top-left corner.
  const plan = buildPlan(
    SESSION_COUNTS_16.map((c, i) => makeProject('proj-' + i, c)),
    [...benchedAgents(4), ...waitingAgents(11)],
  );
  const office = plan.rooms.find((r) => r.kind === 'office');
  assert.ok(office, 'no office on the floor');
  const others = plan.rooms.filter((r) => r !== office);
  for (const r of others) {
    assert.ok(
      office.y <= r.y + EPS || office.x <= r.x + EPS,
      `${r.id} sits above and to the left of the office`,
    );
  }
});
