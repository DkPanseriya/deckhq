// A machine of our own, before anything under `src/` is loaded: several of
// those modules resolve a path out of the environment while they evaluate.
// `docs/DEVIATIONS.md` §124.
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { Store } from '../../src/core/store.mjs';
import { Registry } from '../../src/core/state-machine.mjs';
import { agentId } from '../../src/core/model.mjs';
import { buildPlan } from '../../public/render/plan.js';
import { splitProjectsByOccupancy, floorPopulation } from '../../public/floor-rule.js';
import {
  LOUNGE_MIN_H,
  LOUNGE_SHARE_MAX,
  LOUNGE_SHARE_MIN,
  PINNED_AREA_SHARE,
  loungeShareFor,
} from '../../public/render/plan-units.js';

/**
 * WP-77 — the pin, and the lounge that earns its size.
 *
 * The owner, 14 September: _"Pin any particular project room so it is always in
 * a room, so the room does not collapse when agents are not running, maybe
 * downsized according to live agents."_ And: _"The lounge is very big, the
 * whole bottom half."_
 *
 * Two halves, and they meet in the same place: what a floor does with the
 * height it has. `docs/DEVIATIONS.md` §154.
 */

const NOW = 1_800_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

async function tmpStore() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-pins-'));
  const file = path.join(dir, 'state.json');
  const store = new Store(file);
  await store.load();
  return { dir, file, store };
}

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

/** @param {string} id @param {object} over */
function agent(id, over = {}) {
  return {
    id,
    projectId: 'live0',
    activityState: 'working',
    ackState: 'active',
    reviewSince: null,
    lastActivityAt: NOW - 60_000,
    ...over,
  };
}

/**
 * A floor: some live repos, some pinned ones, a lounge population.
 * @param {{live?:number[], pinned?:number[], benched?:number, waiting?:number}} spec
 */
function floor(spec) {
  const live = spec.live ?? [];
  const pinned = spec.pinned ?? [];
  /** @type {any[]} */
  const projects = [];
  /** @type {any[]} */
  const agents = [];
  live.forEach((n, i) => {
    projects.push({ id: `live${i}`, name: `live${i}`, sessionCount: n, tokens: 1000, needsYou: 0 });
    for (let k = 0; k < n; k++) agents.push(agent(`live${i}-${k}`, { projectId: `live${i}` }));
  });
  pinned.forEach((n, i) => {
    projects.push({
      id: `pin${i}`,
      name: `pin${i}`,
      sessionCount: n,
      tokens: 500,
      needsYou: 0,
      pinned: true,
    });
    // Nobody active in a pinned repo — that is the whole case. Their sessions
    // have ENDED, which is what makes the room collapse without the pin.
    for (let k = 0; k < n; k++) {
      agents.push(
        agent(`pin${i}-${k}`, {
          projectId: `pin${i}`,
          activityState: 'ended',
          lastActivityAt: NOW - 2 * DAY,
        }),
      );
    }
  });
  for (let k = 0; k < (spec.benched ?? 0); k++) {
    agents.push(agent(`b${k}`, { ackState: 'benched', activityState: 'ended' }));
  }
  for (let k = 0; k < (spec.waiting ?? 0); k++) {
    agents.push(agent(`w${k}`, { activityState: 'for_review', reviewSince: 1_000_000 + k * 1000 }));
  }
  return { projects, agents };
}

const STAGE = { w: 1600, h: 1000 };

// ------------------------------------------------------------- the pin is kept

test('a pin survives a restart, because it is written to state.json', async () => {
  const { dir, file, store } = await tmpStore();
  try {
    assert.equal(
      store.isProjectPinned('orbital-api'),
      false,
      'nothing is pinned on a fresh install',
    );
    store.setProjectPinned('orbital-api', true);
    await store.flush();

    // The restart: a second Store over the same file, which is exactly what
    // the daemon does on the next start.
    const restarted = new Store(file);
    await restarted.load();
    assert.equal(restarted.isProjectPinned('orbital-api'), true, 'the pin did not survive');
    assert.deepEqual(Object.keys(restarted.pinnedProjects()), ['orbital-api']);
    assert.ok(restarted.pinnedProjects()['orbital-api'].at > 0, 'a pin records when it was made');

    // And unpinning DELETES rather than storing `false`, so the file does not
    // grow a record of every repo ever unpinned.
    restarted.setProjectPinned('orbital-api', false);
    await restarted.flush();
    const again = new Store(file);
    await again.load();
    assert.equal(again.isProjectPinned('orbital-api'), false);
    assert.deepEqual(JSON.parse(await fsp.readFile(file, 'utf8')).pins, {});
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('a hand-edited state.json cannot put anything but a project id in pins', async () => {
  const { dir, file } = await tmpStore();
  try {
    await fsp.writeFile(
      file,
      JSON.stringify({
        version: 1,
        pins: {
          'orbital-api': { at: 5 },
          '../../etc/passwd': { at: 5 },
          'Has Capitals': { at: 5 },
          'no-record': 'yes',
        },
      }),
      'utf8',
    );
    const store = new Store(file);
    await store.load();
    assert.deepEqual(Object.keys(store.pinnedProjects()).sort(), ['no-record', 'orbital-api']);
    assert.equal(store.pinnedProjects()['no-record'].at, 0, 'an undated pin reads as undated');
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('INVARIANT: no observed event clears a pin', async () => {
  // `08` §1.1 rule 1 — no observed event may clear a user-owned state — stated
  // for the other piece of user-owned state in `state.json`. The scan below is
  // the whole life of a repo the user pinned: it runs, it ENDS, its process
  // goes, and finally it is old enough to have GONE HOME. None of that is the
  // user speaking, so none of it may touch the pin.
  const { dir, store } = await tmpStore();
  try {
    let summaries = [
      {
        id: agentId('claude-code', 'a'),
        runtime: 'claude-code',
        title: 'a',
        hasCustomTitle: false,
        cwd: 'C:\\proj',
        gitBranch: null,
        model: 'claude-opus-5',
        lastActivityAt: NOW,
        tokens: 10,
        cacheTokens: 0,
        costEstimate: 0.01,
        lastRole: 'user',
        lastText: 'hi',
        turnEnded: false,
      },
    ];
    let live = [
      {
        id: agentId('claude-code', 'a'),
        runtime: 'claude-code',
        cwd: 'C:\\proj',
        name: null,
        startedAt: NOW,
        pid: 111,
      },
    ];
    const adapter = {
      id: 'claude-code',
      label: 'claude-code',
      async available() {
        return true;
      },
      async scanSessions() {
        return summaries;
      },
      async liveSessions() {
        return live;
      },
      hooks: {
        supported: true,
        describe: () => ({ file: '', json: '', events: [], note: '' }),
        install: async () => {},
        remove: async () => {},
        installed: async () => false,
      },
    };
    const registry = new Registry({ store, adapters: [adapter], log: quiet });
    await registry.refresh();
    const projectId = registry.snapshot().projects[0].id;

    // The user pins it. The ONLY write on this path.
    registry.setProjectPinned(projectId, true);
    assert.equal(store.isProjectPinned(projectId), true);

    // 1. the turn ends.
    summaries = [{ ...summaries[0], lastRole: 'assistant', turnEnded: true }];
    await registry.refresh();
    assert.equal(store.isProjectPinned(projectId), true, 'an ended turn cleared the pin');

    // 2. the process goes: nothing live, nothing active.
    live = [];
    await registry.refresh();
    assert.equal(store.isProjectPinned(projectId), true, 'the session ending cleared the pin');

    // 3. and it goes home — benched, silent past the window.
    await registry.act(agentId('claude-code', 'a'), 'bench');
    summaries = [{ ...summaries[0], lastActivityAt: NOW - 40 * DAY }];
    await registry.refresh();
    assert.equal(store.isProjectPinned(projectId), true, 'going home cleared the pin');

    // The snapshot still says so, which is what the floor reads.
    assert.equal(
      registry.snapshot().projects.find((p) => p.id === projectId).pinned,
      true,
      'the snapshot stopped reporting the pin',
    );

    // And only the user can take it back.
    registry.setProjectPinned(projectId, false);
    assert.equal(store.isProjectPinned(projectId), false);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------ the room a pin keeps

test('a pinned repo is a room, an unpinned one is a line, and never both', () => {
  const { projects, agents } = floor({ live: [2], pinned: [3], benched: 2 });
  projects.push({ id: 'idle0', name: 'idle0', sessionCount: 1, tokens: 0, needsYou: 0 });
  agents.push(
    agent('idle0-0', {
      projectId: 'idle0',
      activityState: 'ended',
      lastActivityAt: NOW - 3 * DAY,
    }),
  );
  const pop = floorPopulation(agents, { now: NOW });
  const split = splitProjectsByOccupancy(projects, pop);
  assert.deepEqual(
    split.active.map((p) => p.id),
    ['live0'],
  );
  assert.deepEqual(
    split.pinned.map((p) => p.id),
    ['pin0'],
  );
  assert.deepEqual(
    split.idle.map((e) => e.id),
    ['idle0'],
  );

  const plan = buildPlan(projects, agents, { stage: STAGE, now: NOW });
  const drawn = plan.rooms.filter((r) => r.kind === 'project').map((r) => r.id);
  assert.ok(drawn.includes('pin0'), 'a pinned repo keeps a room with nobody in it');
  assert.ok(!drawn.includes('idle0'), 'an unpinned idle repo still costs no floor');
});

test('a pinned room is at most a third of a live room, on every floor it shares', () => {
  // "Downsized according to live agents", made a guarantee rather than an aim.
  // Against the NARROWEST live room, because that is the comparison a person
  // makes: the pinned room has to read as the small one beside every room with
  // somebody in it.
  const shapes = [
    { live: [2, 1, 1], pinned: [3], benched: 4 },
    { live: [2, 1, 1], pinned: [3, 2, 1], benched: 4 },
    { live: [1], pinned: [3] },
    { live: [8, 1], pinned: [1, 1, 1, 1, 1, 1, 1, 1], benched: 15 },
    { live: [4, 3, 2], pinned: [2], benched: 15, waiting: 3 },
  ];
  for (const spec of shapes) {
    const { projects, agents } = floor(spec);
    for (const targetAspect of [1.2, 1.6, 2.06, 2.2]) {
      const plan = buildPlan(projects, agents, { targetAspect, now: NOW });
      const rooms = plan.rooms.filter((r) => r.kind === 'project');
      const pinned = rooms.filter((r) => r.pinned === true);
      const live = rooms.filter((r) => r.pinned !== true);
      assert.equal(pinned.length, (spec.pinned ?? []).length, 'a pinned repo lost its room');
      const smallest = Math.min(...live.map((r) => r.w * r.h));
      for (const room of pinned) {
        const ratio = (room.w * room.h) / smallest;
        assert.ok(
          ratio <= PINNED_AREA_SHARE + 1e-6,
          `${room.id} is ${(ratio * 100).toFixed(0)}% of the narrowest live room at ${targetAspect}:1`,
        );
      }
    }
  }
});

test('a pinned room is empty, furnished and labelled as pinned', () => {
  const { projects, agents } = floor({ live: [2, 1], pinned: [3], benched: 2 });
  const plan = buildPlan(projects, agents, { stage: STAGE, now: NOW });
  const room = plan.rooms.find((r) => r.id === 'pin0');
  assert.ok(room, 'the pinned repo has a room');

  // Nobody in it, and nowhere for anybody to be: pinning kept the room, not
  // the people (WP-50's rule, untouched).
  assert.equal(plan.seats.get('pin0'), undefined, 'a pinned room seats nobody');
  assert.equal(
    room.props.filter((p) => p.kind === 'chair').length,
    0,
    'a chair with nobody on it is the oldest defect in the plan',
  );
  for (const a of agents) {
    if (a.projectId !== 'pin0') continue;
    assert.ok(plan.hidden.has(a.id), `${a.id} was drawn in a room that has no seat for it`);
  }

  // One desk, and the plate says why the room is there.
  assert.equal(room.props.filter((p) => p.kind === 'desk').length, 1, 'a pinned room has one desk');
  assert.match(room.plateLines[1], /pinned/, 'the plate carries the badge');
  assert.match(room.plateLines[1], /3 sessions/, 'and still says what is in the repo');

  // And its furniture is inside it, like everything else on the floor.
  for (const prop of room.props) {
    assert.ok(
      prop.x >= room.x - 0.01 &&
        prop.y >= room.y - 0.01 &&
        prop.x + prop.w <= room.x + room.w + 0.01 &&
        prop.y + prop.h <= room.y + room.h + 0.01,
      `${prop.kind} is outside the pinned room`,
    );
  }
});

test('three live rooms, one pinned room and fifteen benched still tile the envelope', () => {
  // The whole floor, held to the properties `floor-integrity.test.mjs` holds
  // every other population to: the rooms cover the building exactly, nothing
  // overlaps, and no label or prop leaves the room it belongs to.
  const { projects, agents } = floor({ live: [4, 3, 2], pinned: [2], benched: 15, waiting: 3 });
  for (const targetAspect of [1.2, 1.6, 1.78, 2.06, 2.2]) {
    const plan = buildPlan(projects, agents, { targetAspect, now: NOW });
    let area = 0;
    for (const r of plan.rooms) {
      area += r.w * r.h;
      assert.ok(
        r.x >= -1e-6 &&
          r.y >= -1e-6 &&
          r.x + r.w <= plan.width + 0.01 &&
          r.y + r.h <= plan.height + 0.01,
        `${r.id} lies outside the envelope at ${targetAspect}:1`,
      );
      for (const prop of r.props || []) {
        assert.ok(
          prop.x >= r.x - 0.01 &&
            prop.y >= r.y - 0.01 &&
            prop.x + prop.w <= r.x + r.w + 0.01 &&
            prop.y + prop.h <= r.y + r.h + 0.01,
          `${r.id}/${prop.kind} is outside its room at ${targetAspect}:1`,
        );
      }
    }
    const envelope = plan.width * plan.height;
    assert.ok(
      Math.abs(area - envelope) / envelope < 0.001,
      `rooms cover ${((area / envelope) * 100).toFixed(2)}% of the floor at ${targetAspect}:1`,
    );
    // Two rooms may share a wall; none may share floor.
    const boxes = plan.rooms.map((r) => r);
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlap =
          Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) *
          Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        assert.ok(overlap < 0.01, `${a.id} and ${b.id} overlap at ${targetAspect}:1`);
      }
    }
  }
});

// ------------------------------------------------------ the lounge's ceiling

test('the lounge ceiling is a ladder in the count and nothing else', () => {
  assert.equal(loungeShareFor(0), LOUNGE_SHARE_MIN);
  assert.equal(loungeShareFor(5), LOUNGE_SHARE_MIN, 'five is still the quiet lounge');
  assert.ok(loungeShareFor(6) > LOUNGE_SHARE_MIN, 'the sixth arrival buys a step');
  assert.equal(loungeShareFor(10), loungeShareFor(6), 'and the ladder is steps, not a slope');
  assert.ok(loungeShareFor(11) > loungeShareFor(10));
  assert.equal(loungeShareFor(200), LOUNGE_SHARE_MAX, 'and it stops at half the building');
  // A pure function of the count: no clock, no stage, no randomness.
  assert.equal(loungeShareFor(7), loungeShareFor(7));
});

test('the lounge is sized by who is in it, on a 1600 x 1000 stage', () => {
  // THE MEASUREMENT THIS PACKAGE EXISTS FOR. Before it, the `three`-shaped
  // floor drew a lounge 27.7 of 57.1 units tall — 49% of the building — with
  // NOBODY IN IT, and the identical 27.7 with fifteen people in it. Its height
  // was `LOUNGE_ROW_ASPECT_MAX` and `ROOM_FILL_MAX` arguing about a ratio.
  const empty = buildPlan(...Object.values(floor({ live: [2, 1, 1], benched: 0 })), {
    stage: STAGE,
    now: NOW,
  });
  const five = buildPlan(...Object.values(floor({ live: [2, 1, 1], benched: 5 })), {
    stage: STAGE,
    now: NOW,
  });
  const loungeOf = (plan) => plan.rooms.find((r) => r.kind === 'lounge');

  // THE FLOOR MINIMUM. An empty lounge still exists, at one sofa group with
  // its margins and its plate — "a cleared queue is the reward and an empty
  // grey box is not much of one".
  assert.ok(
    loungeOf(empty).h >= LOUNGE_MIN_H - 1e-6,
    `an empty lounge is ${loungeOf(empty).h.toFixed(1)} U, under the ${LOUNGE_MIN_H} U minimum`,
  );

  // THE CEILING, and the honest statement of it. It bounds the PADDING and
  // never the contents, so where the two disagree the minimum wins: on a 48.8 U
  // building `LOUNGE_MIN_H` is 40% of the height rather than 25%, and it is the
  // eight units of padding above it that this removed. `docs/DEVIATIONS.md`
  // §154 has the numbers.
  const ceiling = Math.max(LOUNGE_MIN_H, LOUNGE_SHARE_MIN * five.height);
  assert.ok(
    loungeOf(five).h <= ceiling + 1e-6,
    `five benched got a ${loungeOf(five).h.toFixed(1)} U lounge, over its ${ceiling.toFixed(1)} U ceiling`,
  );
  // And the padding is gone: the room is what its furniture needs, not what a
  // proportion wanted.
  assert.ok(
    loungeOf(five).h <= loungeOf(five).natural.h + 1e-6,
    'the lounge is still being padded past its own contents',
  );
});

test('the lounge grows for the people it has to hold, and nothing else does', () => {
  const heightOf = (benched) => {
    const { projects, agents } = floor({ live: [2, 1, 1], benched });
    const plan = buildPlan(projects, agents, { stage: STAGE, now: NOW });
    return plan.rooms.find((r) => r.kind === 'lounge').h;
  };
  const quietHouse = heightOf(0);
  const crowd = heightOf(60);
  assert.ok(crowd > quietHouse, 'sixty people in the lounge must not fit in an empty one');
  assert.equal(heightOf(0), heightOf(0), 'and the answer is a function of the population');
});
