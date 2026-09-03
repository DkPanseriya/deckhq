/**
 * Tests for `public/render/plan.js` against `docs/05-LAYOUT-REWORK.md`, which
 * supersedes `03-VISUAL-SPEC.md` §2 in full. This suite covers plan-level
 * behaviour: floor aspect (§3.2), lounge contraction/growth (§3.5), the
 * 21-session project (§3.8), determinism, and the pieces of the old contract
 * that the rework left untouched (token formatting, plate lines, the office
 * waiting queue, door placement).
 *
 * Geometry invariants that hold over every prop/room on the floor — nothing
 * floats (§3.3), chair-to-desk gap (§3.4), density uniformity (§3.9), anchor
 * validity, and treemap soundness — live in `layout-anchors.test.mjs`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, formatTokens, U } from '../../public/render/plan.js';

const EPS = 1e-6;
// docs/DEVIATIONS.md §12: 05-LAYOUT-REWORK.md §2.2's [1.60, 1.78] clamp and
// §3.1's "no letterbox band wider than 8 px" are mutually unsatisfiable —
// real stages run ~1.85-1.93 wide after the header is subtracted, so the
// 1.78 cap left four of five required viewport sizes letterboxed. §3.1 is
// the stated acceptance test, so the clamp widened to [1.20, 2.20]. Room
// proportions stay independently protected by [0.6, 1.8] (ROOM_ASPECT_*).
const ASPECT_MIN = 1.2;
const ASPECT_MAX = 2.2;

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

// A 16-project mix, per the orchestrator's reference fixture: a handful of
// solo projects, a couple of mid-size teams, and one 21-session outlier.
const SESSION_COUNTS_16 = [1, 1, 1, 1, 2, 2, 5, 11, 21, 3, 4, 1, 1, 2, 6, 1];

function bigProjects() {
  return SESSION_COUNTS_16.map((c, i) => makeProject(`proj-${i}`, c, { tokens: c * 10_000 }));
}

/** Deep, Map-aware snapshot of the geometry a rebuild must reproduce exactly. */
function snapshotGeometry(plan) {
  return JSON.stringify({
    width: plan.width,
    height: plan.height,
    targetAspect: plan.targetAspect,
    rooms: plan.rooms.map((r) => ({
      id: r.id,
      x: r.x,
      y: r.y,
      w: r.w,
      h: r.h,
      props: r.props.map((p) => [p.kind, p.x, p.y, p.w, p.h, p.angle]),
    })),
    seats: [...plan.seats.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([id, seats]) => [id, seats.map((s) => [s.x, s.y, s.angle])]),
    officeSeats: plan.officeSeats.map((s) => [s.x, s.y, s.angle]),
    loungeSpots: plan.loungeSpots.map((s) => [s.id, s.x, s.y, s.angle, s.capacity, s.partnerOf]),
    doors: plan.doors.map((d) => [d.x, d.y, d.angle, d.width]),
  });
}

// ------------------------------------------------------------------ basics

test('U is 14 px per unit', () => {
  assert.equal(U, 14);
});

test('formatTokens formats compactly, matching VISUAL-SPEC §7 examples', () => {
  assert.equal(formatTokens(2_200_000), '2.2M');
  assert.equal(formatTokens(840_000), '840k');
  assert.equal(formatTokens(500), '500');
  assert.equal(formatTokens(0), '0');
});

test('office has one door with a swing arc', () => {
  const plan = buildPlan([], []);
  assert.equal(plan.doors.length, 1);
  const door = plan.doors[0];
  assert.equal(typeof door.x, 'number');
  assert.equal(typeof door.y, 'number');
  assert.equal(typeof door.angle, 'number');
  assert.ok(door.width > 0);
});

// -------------------------------------------------------------- §3.2 aspect

// The floor takes the SHAPE OF THE SCREEN as far as its contents allow, and no
// further. WP13 §3.2 asks for the aspect to land within 0.02 of the target
// unconditionally; honouring that literally means padding the floor with void
// when the furniture's own proportions are a long way off — measured at a
// 198 x 96 floor holding a 76 x 72 building, seventy units of nothing added
// solely to make a ratio come out. `plan.js` therefore reaches the target by
// ARRANGEMENT (row count and service-column width, which cost nothing) and
// then pads only up to ASPECT_PAD_MAX. Recorded in docs/DEVIATIONS.md.
test('§3.2 the floor takes the screen shape, by arrangement first and padding second', () => {
  for (const target of [1.6, 1.7, 1.78]) {
    const plan = buildPlan(bigProjects(), benchedAgents(6), { targetAspect: target });
    assert.equal(plan.targetAspect, target, `targetAspect should echo back ${target}`);
    const actual = plan.width / plan.height;
    assert.ok(
      actual > target / 1.45 && actual < target * 1.45,
      `floor aspect ${actual} is nowhere near the requested ${target}`,
    );
  }
});

test('§3.2 a wider screen produces a wider floor, monotonically', () => {
  // The contract that actually matters: asking for a wider floor must never
  // give a narrower one. This is what makes the fit behave predictably as the
  // window is resized, and it holds whether or not the padding cap bites.
  const projects = bigProjects();
  const agents = benchedAgents(6);
  let previous = 0;
  for (const target of [1.2, 1.5, 1.8, 2.2]) {
    const plan = buildPlan(projects, agents, { targetAspect: target });
    const actual = plan.width / plan.height;
    assert.ok(
      actual >= previous - 1e-6,
      `aspect went backwards at target ${target}: ${actual} < ${previous}`,
    );
    previous = actual;
  }
});

test('§3.2 the floor is never mostly void, whatever aspect is asked for', () => {
  // The padding cap, stated as a property: a floor must be more building than
  // corridor. Some open floor is unavoidable and correct — one small project
  // beside a lounge full of benched agents genuinely leaves a bay empty — but
  // the aspect target must never be allowed to buy itself more space than the
  // rooms occupy. Before the cap this configuration reached 198 x 96 units to
  // hold 76 x 72 of building.
  for (const target of [1.2, 2.2]) {
    const plan = buildPlan([makeProject('p', 5)], benchedAgents(12), { targetAspect: target });
    const roomArea = plan.rooms
      .filter((r) => r.kind !== 'corridor')
      .reduce((a, r) => a + r.w * r.h, 0);
    const total = plan.width * plan.height;
    assert.ok(
      roomArea / total > 0.5,
      `only ${((roomArea / total) * 100).toFixed(0)}% of the floor is rooms at target ${target}`,
    );
  }
});

test('§3.2 out-of-range targetAspect is clamped into [1.20, 2.20]', () => {
  const low = buildPlan([makeProject('p', 5)], [], { targetAspect: 0.5 });
  assert.equal(low.targetAspect, ASPECT_MIN);

  const high = buildPlan([makeProject('p', 5)], [], { targetAspect: 5.0 });
  assert.equal(high.targetAspect, ASPECT_MAX);

  // Clamped or not, a wider request still gives a wider floor — where the plan
  // has a choice to make. WP-55: the envelope is the sum of its rooms, the
  // service column and the corridors, so the target aspect is spent on how the
  // working floor is BANDED rather than on stretching it, and a floor with one
  // room has nothing to band. Six do.
  const six = (aspect) =>
    buildPlan(
      Array.from({ length: 6 }, (_, i) => makeProject(`p${i}`, 3)),
      [],
      { targetAspect: aspect },
    );
  const narrow = six(0.5);
  const wide = six(5.0);
  assert.ok(
    wide.width / wide.height > narrow.width / narrow.height,
    `a wider stage should give a wider floor (${(wide.width / wide.height).toFixed(2)} vs ${(
      narrow.width / narrow.height
    ).toFixed(2)})`,
  );

  // No targetAspect at all defaults to 1.70 (headless/unit-test use, per the
  // WP13 contract), never to an unclamped value.
  const bare = buildPlan([makeProject('p', 5)], []);
  assert.equal(bare.targetAspect, 1.7);
});

// -------------------------------------------------------------- §3.5 lounge

test('the lounge furnishes itself to the benched population, and never dominates the floor', () => {
  // The lounge is now a permanent zone of the building rather than a room
  // that floats on it, so its share of the floor is set by the plan, not by
  // its contents. What must still adapt is the FURNITURE: an empty lounge is
  // a sofa group and a counter, and games appear only as people arrive to
  // use them.
  const measure = (benchedCount) => {
    const plan = buildPlan(bigProjects(), benchedAgents(benchedCount));
    const lounge = plan.rooms.find((r) => r.kind === 'lounge');
    assert.ok(lounge, 'lounge zone must always be present');
    const kinds = new Set(lounge.props.map((prop) => prop.kind));
    return {
      share: (lounge.w * lounge.h) / (plan.width * plan.height),
      props: lounge.props.length,
      kinds,
      spots: plan.loungeSpots.length,
    };
  };

  const empty = measure(0);
  const few = measure(12);
  const busy = measure(30);

  assert.ok(
    empty.props < busy.props,
    `an empty lounge must carry less furniture than a busy one (${empty.props} vs ${busy.props})`,
  );
  for (const games of ['pool_table', 'table_tennis', 'arcade_cabinet']) {
    assert.ok(!empty.kinds.has(games), `an empty lounge must not lay out a ${games}`);
    assert.ok(busy.kinds.has(games), `a lounge with thirty benched must have a ${games}`);
  }
  // WP-55: a table appears when there are more people than places to put them,
  // not on a fixed headcount. Twelve benched fit on the furniture the lounge
  // already has, so they get one table; thirty do not, so they get the games
  // room. Before this a dozen agents were dealt an arcade, and a service column
  // seventy-six units tall stood beside a working floor that needed twenty.
  assert.ok(
    few.props < busy.props,
    `a lounge of twelve must be less furnished than one of thirty (${few.props} vs ${busy.props})`,
  );
  assert.ok(!few.kinds.has('arcade_cabinet'), 'twelve benched do not fill an arcade');
  // The sofa group and the kitchen are always there.
  for (const always of ['sofa', 'counter']) {
    assert.ok(empty.kinds.has(always), `the lounge always has a ${always}`);
  }
  assert.ok(busy.spots > empty.spots, 'more benched agents means more places to be');
  assert.ok(
    empty.share < 0.35 && busy.share < 0.35,
    `the lounge must not dominate the floor (${(empty.share * 100).toFixed(1)}% / ${(busy.share * 100).toFixed(1)}%)`,
  );
});

// --------------------------------------------------------- §3.8 21 sessions

test('§3.8 a 21-session project seats every session, and every room in its plan keeps aspect in [0.6, 1.8]', () => {
  const plan = buildPlan([makeProject('career-ops', 21, { tokens: 2_200_000, needsYou: 3 })], []);
  const room = plan.rooms.find((r) => r.id === 'career-ops');
  assert.ok(room, 'project room must exist');

  const seats = plan.seats.get('career-ops');
  assert.equal(seats.length, 21, 'every one of the 21 sessions must get a seat — nothing hidden');

  for (const r of plan.rooms) {
    // A corridor is deliberately long and thin — that is what a corridor is.
    // The aspect band governs zones people work in.
    if (r.kind === 'corridor') continue;
    const aspect = r.w / r.h;
    assert.ok(
      aspect >= 0.6 - EPS && aspect <= 1.8 + EPS,
      `${r.id} aspect ${aspect} falls outside [0.6, 1.8]`,
    );
  }
});

test('a project with only one session still gets exactly one bench and one seat', () => {
  const plan = buildPlan([makeProject('tiny', 1)], []);
  const seats = plan.seats.get('tiny');
  assert.equal(seats.length, 1);
  const room = plan.rooms.find((r) => r.id === 'tiny');
  assert.equal(room.props.filter((p) => p.kind === 'desk').length, 1);
});

// -------------------------------------------------------------- determinism

test('building the same plan twice yields identical geometry', () => {
  const projectsA = bigProjects();
  const projectsB = bigProjects();
  const agentsA = [...benchedAgents(9), ...waitingAgents(5)];
  const agentsB = [...benchedAgents(9), ...waitingAgents(5)];

  const planA = buildPlan(projectsA, agentsA, { targetAspect: 1.72 });
  const planB = buildPlan(projectsB, agentsB, { targetAspect: 1.72 });

  assert.equal(snapshotGeometry(planA), snapshotGeometry(planB));
});

// -------------------------------------------------------- survivors: office

test('officeSeats count matches the waiting queue for every non-zero waiting count', () => {
  for (const n of [1, 3, 5, 7, 10, 21]) {
    const plan = buildPlan([], waitingAgents(n));
    assert.equal(plan.officeSeats.length, n, `waitingCount=${n} should produce ${n} seats`);
  }
});

test('the waiting area seats the wall sofas before it adds any loose chair', () => {
  // One guest chair is always at the desk. Beyond that, people take the wall
  // seating, and loose chairs only appear once the room is genuinely full.
  const modest = buildPlan([], waitingAgents(8));
  const office = modest.rooms.find((r) => r.kind === 'office');
  assert.equal(modest.officeSeats.length, 8);
  assert.equal(
    office.props.filter((p) => p.kind === 'waiting_chair').length,
    1,
    'only the guest chair at the desk — the sofas take the rest',
  );

  // Past what the walls can seat, the middle of the room fills with chairs.
  // The count that overflows depends on how big the reception is, and the
  // reception is sized to its queue — so this walks up until it does, and
  // checks that every one of them still gets a place.
  let overflowed = false;
  for (const waiting of [25, 40, 60, 90]) {
    const packed = buildPlan([], waitingAgents(waiting));
    const packedOffice = packed.rooms.find((r) => r.kind === 'office');
    assert.equal(packed.officeSeats.length, waiting, `${waiting} waiting need ${waiting} places`);
    if (packedOffice.props.filter((p) => p.kind === 'waiting_chair').length > 1) {
      overflowed = true;
      break;
    }
  }
  assert.ok(overflowed, 'a room past its seating capacity must gain chairs');

  // An empty office is still a furnished reception, not a bare box.
  const empty = buildPlan([], []);
  assert.equal(empty.officeSeats.length, 0);
  const emptyOffice = empty.rooms.find((r) => r.kind === 'office');
  for (const kind of ['sofa', 'magazine_table', 'user_desk', 'manager']) {
    assert.ok(
      emptyOffice.props.some((p) => p.kind === kind),
      `the reception needs a ${kind}`,
    );
  }
});

test('every waiting agent faces the desk, and the queue runs front-to-back', () => {
  const plan = buildPlan([], waitingAgents(11));
  const seats = plan.officeSeats;
  const desk = plan.rooms
    .find((r) => r.kind === 'office')
    .props.find((p) => p.kind === 'user_desk');
  const deskCentre = { x: desk.x + desk.w / 2, y: desk.y + desk.h / 2 };

  for (const seat of seats) {
    // The seat's facing must point at the desk, wherever it sits on the C.
    const want = Math.atan2(deskCentre.y - seat.y, deskCentre.x - seat.x);
    const diff = Math.abs(Math.atan2(Math.sin(seat.angle - want), Math.cos(seat.angle - want)));
    assert.ok(diff < 0.4, `a waiting agent is facing ${diff.toFixed(2)} rad away from the desk`);
  }

  // The front of the queue is the seat closest to the desk.
  const dist = (s) => Math.hypot(s.x - deskCentre.x, s.y - deskCentre.y);
  const closest = seats.reduce((a, b) => (dist(b) < dist(a) ? b : a));
  assert.ok(
    dist(seats[0]) <= dist(closest) + 1.5,
    'the longest-waiting agent should be at the front, nearest the desk',
  );
});

// ------------------------------------------------------- survivors: project

test('plate lines report session count, compact tokens, and needs-you count', () => {
  const plan = buildPlan([makeProject('career-ops', 21, { tokens: 2_200_000, needsYou: 3 })], []);
  const room = plan.rooms.find((r) => r.id === 'career-ops');
  assert.deepEqual(room.plateLines, ['career-ops', '21 sessions · 2.2M tok · 3 need you']);
});

test('plate lines use the singular "session" for a one-session project', () => {
  const plan = buildPlan([makeProject('solo', 1, { tokens: 500, needsYou: 0 })], []);
  const room = plan.rooms.find((r) => r.id === 'solo');
  assert.deepEqual(room.plateLines, ['solo', '1 session · 500 tok · 0 need you']);
});

// -------------------------------------------------------- survivors: lounge

test('table_tennis spots are paired via partnerOf, pointing at each other', () => {
  const plan = buildPlan([], benchedAgents(30));
  const tt = plan.loungeSpots.filter((s) => s.kind === 'table_tennis');
  assert.equal(tt.length, 2, 'a 30-benched plan should have earned the table tennis activity');
  assert.equal(tt[0].partnerOf, tt[1].id);
  assert.equal(tt[1].partnerOf, tt[0].id);
});

test('plan.seats is a Map keyed by projectId, one entry per project room', () => {
  const plan = buildPlan(bigProjects(), benchedAgents(10));
  assert.ok(plan.seats instanceof Map);
  const projectRooms = plan.rooms.filter((r) => r.kind === 'project');
  assert.equal(plan.seats.size, projectRooms.length);
  for (const room of projectRooms) {
    assert.ok(plan.seats.has(room.id));
  }
});

test('only the agent being seen sits across from the manager', () => {
  // A real office does not seat the whole queue facing the boss. There is one
  // guest chair at the desk, it belongs to the front of the queue, and
  // everybody else waits on the seating around the walls.
  const plan = buildPlan([], waitingAgents(9));
  const office = plan.rooms.find((r) => r.kind === 'office');
  const desk = office.props.find((p) => p.kind === 'user_desk');
  const deskCentre = { x: desk.x + desk.w / 2, y: desk.y + desk.h / 2 };
  const dist = (s) => Math.hypot(s.x - deskCentre.x, s.y - deskCentre.y);

  const near = plan.officeSeats.filter((s) => dist(s) < 8);
  assert.equal(near.length, 1, 'exactly one seat may be at the desk');
  assert.equal(
    plan.officeSeats.indexOf(near[0]),
    0,
    'and it must be the front of the queue — the agent that has waited longest',
  );
});

test('the waiting seating is against the walls, leaving the middle of the room clear', () => {
  const plan = buildPlan([], waitingAgents(9));
  const office = plan.rooms.find((r) => r.kind === 'office');
  const sofas = office.props.filter((p) => p.kind === 'sofa');
  assert.ok(sofas.length >= 3, 'the reception needs a run of seating on three walls');

  for (const sofa of sofas) {
    const gap = Math.min(
      sofa.x - office.x,
      sofa.y - office.y,
      office.x + office.w - (sofa.x + sofa.w),
      office.y + office.h - (sofa.y + sofa.h),
    );
    assert.ok(
      gap < 3.5,
      `a sofa sits ${gap.toFixed(1)} U from any wall — it should be against one`,
    );
  }
});

test('the lounge reads as a rest area at a glance, even when empty', () => {
  const empty = buildPlan([], []).rooms.find((r) => r.kind === 'lounge');
  const kinds = new Set(empty.props.map((p) => p.kind));
  // The cues that say "this is where you relax" rather than "more desks".
  for (const cue of ['sofa', 'tv', 'coffee_machine', 'fruit_bowl', 'bookshelf', 'rug_round']) {
    assert.ok(kinds.has(cue), `an empty lounge should still have a ${cue}`);
  }

  // Thirty, not twelve: WP-55 lays a games table out when there are more
  // people in the lounge than places to sit, and twelve all fit on the
  // furniture that is there whether anybody is in or not.
  const busy = buildPlan(
    [],
    Array.from({ length: 30 }, (_, i) => ({
      id: `b${i}`,
      ackState: 'benched',
      activityState: 'ended',
    })),
  ).rooms.find((r) => r.kind === 'lounge');
  const busyKinds = new Set(busy.props.map((p) => p.kind));
  for (const game of ['pool_table', 'table_tennis', 'foosball', 'arcade_cabinet']) {
    assert.ok(busyKinds.has(game), `a busy lounge should have a ${game}`);
  }
  assert.ok(busy.props.length > empty.props.length, 'a busy lounge is more furnished');
});

test('every waiting agent is seated ON furniture, not on the floor beside it', () => {
  // The sofas are anchored to the room's walls, so their real coordinates are
  // only known after the room has been sized, tiled and resolved. Seats are
  // therefore derived from the resolved furniture; deriving them from the
  // pre-anchor layout put agents on the floor next to the sofas instead.
  for (const waiting of [1, 5, 14, 25]) {
    const plan = buildPlan([], waitingAgents(waiting));
    const office = plan.rooms.find((r) => r.kind === 'office');
    const sofas = office.props.filter((p) => p.kind === 'sofa');
    const chairs = office.props.filter((p) => p.kind === 'waiting_chair');
    assert.equal(plan.officeSeats.length, waiting);

    for (const seat of plan.officeSeats) {
      const onSofa = sofas.some(
        (f) =>
          seat.x >= f.x - 0.6 &&
          seat.x <= f.x + f.w + 0.6 &&
          seat.y >= f.y - 0.6 &&
          seat.y <= f.y + f.h + 0.6,
      );
      const onChair = chairs.some(
        (c) => Math.hypot(seat.x - (c.x + c.w / 2), seat.y - (c.y + c.h / 2)) < 0.5,
      );
      assert.ok(
        onSofa || onChair,
        `waiting=${waiting}: a seat at (${seat.x.toFixed(1)}, ${seat.y.toFixed(1)}) is on neither a sofa nor a chair`,
      );
    }
  }
});

test('a desk monitor lies across the table rather than standing on end', () => {
  // `angle` is which way a prop FACES; its rect is how it LIES. Rotating a
  // wide, shallow screen by the occupant's facing stood it upright.
  const plan = buildPlan([{ id: 'p', name: 'p', sessionCount: 4, tokens: 1 }], []);
  const room = plan.rooms.find((r) => r.kind === 'project');
  const monitors = room.props.filter((p) => p.kind === 'monitor');
  assert.ok(monitors.length > 0, 'a staffed room has monitors');
  for (const m of monitors) {
    assert.ok(m.w > m.h, 'a screen is wider than it is deep');
    assert.equal(m.angle, 0, 'and must not be rotated off that footprint');
  }
});

test('nobody stands on top of the furniture they are using', () => {
  // Lounge spots were derived from the game's ZONE rather than from the table
  // inside it, so every player stood in the middle of the table they were
  // supposedly playing on — 14 of 23 spots, including all four diners sitting
  // on the dining table. Spots must be positioned relative to the furniture,
  // the same rule that `seatOffice` follows for the reception sofas.
  for (const n of [1, 3, 5, 7, 9, 11, 14, 22]) {
    const plan = buildPlan([makeProject('p', 3)], benchedAgents(n), {});
    const lounge = plan.rooms.find((r) => r.kind === 'lounge');
    const tables = lounge.props.filter((p) =>
      /table|foosball|arcade|tennis|counter/.test(String(p.kind)),
    );
    for (const s of plan.loungeSpots || []) {
      for (const t of tables) {
        const inside = s.x > t.x && s.x < t.x + t.w && s.y > t.y && s.y < t.y + t.h;
        assert.ok(!inside, `n=${n}: a '${s.kind}' spot stands inside the '${t.kind}' it is using`);
      }
    }
  }
});

test('every game player faces the table they are standing at', () => {
  const plan = buildPlan([makeProject('p', 3)], benchedAgents(14), {});
  const lounge = plan.rooms.find((r) => r.kind === 'lounge');
  const byId = new Map(lounge.props.filter((p) => p.id).map((p) => [p.id, p]));
  const pairs = [
    ['lounge-pool-a', 'pool'],
    ['lounge-tt-a', 'tt'],
    ['lounge-eat-t0', 'dining'],
  ];
  for (const [spotId, tableId] of pairs) {
    const spot = (plan.loungeSpots || []).find((s) => s.id === spotId);
    const table = byId.get(tableId);
    if (!spot || !table) continue;
    // Facing vector from bodyAngle must point back at the table centre.
    const fx = Math.cos(spot.angle);
    const fy = Math.sin(spot.angle);
    const dx = table.x + table.w / 2 - spot.x;
    const dy = table.y + table.h / 2 - spot.y;
    const len = Math.hypot(dx, dy) || 1;
    assert.ok(
      (fx * dx + fy * dy) / len > 0.7,
      `${spotId} should face ${tableId}, not away from it`,
    );
  }
});

/** @param {number} n */
function letGoAgents(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `gone-${i}`, ackState: 'let_go' }));
}

test('archived sessions take no floor space at all', () => {
  // They had a room, then a street. Both were the wrong answer: an archived
  // session is one the user has explicitly put away, and the floor is for the
  // ones still in play. Giving them a fifth of the plan took that space from
  // the rooms the product exists to show.
  for (const n of [1, 4, 17, 50]) {
    const plan = buildPlan([makeProject('p', 3)], letGoAgents(n), {});
    assert.equal(
      plan.rooms.find((r) => r.kind === 'let_go'),
      undefined,
      `n=${n}: archived sessions must not get a room`,
    );
    assert.deepEqual(plan.letGoSpots, [], `n=${n}: archived sessions must not get a place`);
  }
});

test('archiving sessions does not change the floor around them', () => {
  // The rooms that are still in play lay out identically whether or not there
  // are archived sessions beside them.
  const without = buildPlan([makeProject('p', 6)], benchedAgents(6), {});
  const with50 = buildPlan([makeProject('p', 6)], [...letGoAgents(50), ...benchedAgents(6)], {});
  const shape = (plan) =>
    plan.rooms
      .filter((r) => r.kind !== 'corridor')
      .map((r) => `${r.id}:${r.x.toFixed(2)},${r.y.toFixed(2)},${r.w.toFixed(2)},${r.h.toFixed(2)}`)
      .sort()
      .join('|');
  assert.equal(shape(without), shape(with50));
  assert.equal(without.width.toFixed(2), with50.width.toFixed(2));
});

test('the service rooms stay on the floor whatever the population', () => {
  const plan = buildPlan([makeProject('p', 6)], [...letGoAgents(20), ...benchedAgents(6)], {});
  for (const kind of ['office', 'lounge']) {
    const room = plan.rooms.find((r) => r.kind === kind);
    assert.ok(room, `${kind} room is missing`);
    assert.ok(room.h > 0 && room.w > 0, `${kind} room collapsed to nothing`);
    assert.ok(
      room.y + room.h <= plan.height + 0.01,
      `${kind} room runs off the bottom of the floor`,
    );
  }
});

/**
 * @param {string} id
 * @param {number} sessions
 * @param {number} active
 * @param {boolean} [archived]
 */
function mkProject(id, sessions, active, archived = false) {
  return {
    id,
    name: id,
    sessionCount: sessions,
    activeCount: active,
    archived,
    tokens: 0,
    needsYou: 0,
  };
}

test('a repo with no active agents gets a directory line, not a room', () => {
  // After a settle, most repos have every agent benched: desks, chairs, a
  // plant and nobody in them. On a real machine that was eleven of thirteen
  // rooms, which is a lot of floor spent on nothing. They are now ONE strip
  // with one line each (`08` B6), and the rooms that remain are the ones
  // somebody is actually in.
  const plan = buildPlan(
    [mkProject('busy', 4, 2), mkProject('idle', 4, 0)],
    [
      { id: 'a', ackState: 'active', activityState: 'working', projectId: 'busy' },
      { id: 'b', ackState: 'benched', activityState: 'ended', projectId: 'idle' },
    ],
    {},
  );
  const busy = plan.rooms.find((r) => r.id === 'busy');
  assert.ok(busy && busy.kind === 'project', 'a repo with an active agent keeps its room');
  assert.equal(
    plan.rooms.find((r) => r.id === 'idle'),
    undefined,
    'an idle repo gets no room of its own',
  );

  const directory = plan.rooms.find((r) => r.kind === 'directory');
  assert.ok(directory, 'the idle repo needs somewhere to be listed');
  assert.deepEqual(
    directory.entries.map((e) => e.id),
    ['idle'],
    'the strip lists exactly the idle repos',
  );
  assert.ok(
    directory.h < busy.h,
    `the strip is ${directory.h.toFixed(1)} U tall and the room ${busy.h.toFixed(1)} U — it is meant to cost a plate, not a room`,
  );
});

test('desks equal the agents at them, not the sessions on disk', () => {
  // `buildProjectRoom(p, p.sessionCount)` gave a repo with twenty benched
  // agents and one working one three benches and one occupant.
  const agents = [
    { id: 'w', ackState: 'active', activityState: 'working', projectId: 'p' },
    ...Array.from({ length: 20 }, (_, i) => ({
      id: `b${i}`,
      ackState: 'benched',
      activityState: 'ended',
      projectId: 'p',
    })),
  ];
  const plan = buildPlan([mkProject('p', 21, 1)], agents, {});
  assert.equal(plan.seats.get('p').length, 1, 'one agent at a desk is one desk');

  // And an acknowledged session still sitting at its own desk counts too.
  const withEnded = [
    ...agents,
    { id: 'e', ackState: 'active', activityState: 'ended', projectId: 'p' },
  ];
  const plan2 = buildPlan([mkProject('p', 22, 2)], withEnded, {});
  assert.equal(plan2.seats.get('p').length, 2);
});

test('the directory strip lists every idle repo and never drops one', () => {
  const projects = Array.from({ length: 24 }, (_, i) => mkProject(`idle-${i}`, i + 1, 0));
  projects.push(mkProject('busy', 2, 1));
  const agents = [{ id: 'a', ackState: 'active', activityState: 'working', projectId: 'busy' }];
  for (const aspect of [1.2, 1.6, 2.2]) {
    const plan = buildPlan(projects, agents, { targetAspect: aspect });
    const directory = plan.rooms.find((r) => r.kind === 'directory');
    assert.equal(directory.entries.length, 24, `24 idle repos, ${aspect}:1`);
    const ids = new Set(directory.entries.map((e) => e.id));
    assert.equal(ids.size, 24, 'every line is a different repo');
    for (const e of directory.entries) {
      assert.ok(
        e.x >= directory.x - 0.01 &&
          e.y >= directory.y - 0.01 &&
          e.x + e.w <= directory.x + directory.w + 0.01 &&
          e.y + e.h <= directory.y + directory.h + 0.01,
        `${e.id}'s line is outside the strip`,
      );
    }
  }
});

test('an archived repo leaves the floor, but only while it is idle', () => {
  const agents = [{ id: 'a', ackState: 'active', activityState: 'working', projectId: 'woken' }];
  const plan = buildPlan(
    [mkProject('gone', 3, 0, true), mkProject('woken', 3, 1, true)],
    agents,
    {},
  );
  assert.equal(
    plan.rooms.find((r) => r.id === 'gone'),
    undefined,
    'archived and idle: off the floor entirely',
  );
  assert.ok(
    !(plan.directory ? plan.directory.entries : []).some((e) => e.id === 'gone'),
    'and not in the directory either — archived is archived',
  );
  const woken = plan.rooms.find((r) => r.id === 'woken');
  assert.ok(woken && woken.kind === 'project', 'archived but working: the room pops back open');
});

test('the directory strip packs, places and gets a door like any other room', () => {
  const plan = buildPlan(
    [mkProject('a', 2, 1), mkProject('b', 3, 0), mkProject('c', 5, 0)],
    [{ id: 'x', ackState: 'active', activityState: 'working', projectId: 'a' }],
    {},
  );
  const directory = plan.rooms.find((r) => r.kind === 'directory');
  assert.ok(directory, 'two idle repos need a strip');
  assert.ok(directory.w > 0 && directory.h > 0, 'the strip collapsed to nothing');
  assert.ok(directory.door, 'the strip is a rectangle in the tiling like any other');
  assert.ok(
    directory.x >= 0 && directory.y >= 0 && directory.x + directory.w <= plan.width + 0.01,
    'the strip escaped the floor',
  );
  assert.deepEqual(directory.entries.map((e) => e.id).sort(), ['b', 'c']);
});
