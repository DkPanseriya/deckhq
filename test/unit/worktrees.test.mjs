/**
 * A worktree is not a project — the model and the floor.
 *
 * The owner: _"Sometimes when I start work in a different worktree, it shows on
 * my GUI as a new room. Treat it as the same repository. You could add a table
 * in the corner or something, but do not make a new room for it. Rooms are only
 * for completely new projects, not new worktrees or new branches."_ His floor
 * had rooms called `agent-a0fedbce8c57e1bf9`, `awesome-franklin-2d1495` and
 * `dazzling-dijkstra-657ac8`: Claude Code's own worktrees, each a project.
 *
 * `repo-root.test.mjs` holds the resolver. This holds what is built on it: one
 * repository is one project and one room however many of its worktrees have
 * sessions in them; the sessions in a worktree share a bench in that room; and
 * everything that used to be keyed by a worktree's project — pins, the ledger,
 * Studio, an MK number — is read through to the repository.
 *
 * Every repository here is laid out by hand, a `.git` directory or a `.git`
 * file, and nothing runs git.
 */
import { scratchDir } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { Registry } = await import('../../src/core/state-machine.mjs');
const { Store } = await import('../../src/core/store.mjs');
const { Identity } = await import('../../src/core/identity.mjs');
const {
  agentId,
  projectIdFromCwd,
  projects: projectsOf,
} = await import('../../src/core/model.mjs');
const { projectKeyFor } = await import('../../src/core/ledger-record.mjs');
const { changeKey, todayTokensFor } = await import('../../src/core/state-machine-rules.mjs');
const { aliasesOf, foldByRepo, legacyIdsOf, projectOf, rekeyRecords, resolveProjects } =
  await import('../../src/core/project-of.mjs');
const { clearRepoCache } = await import('../../src/core/repo-root.mjs');
const { resolveProject } = await import('../../src/http/routes/studio.mjs');
const { repoKeys, projectNames } = await import('../../src/cli/stats.mjs');
const { readOffline } = await import('../../src/cli/source.mjs');
const { floorPopulation, homeProjectOf, agentIndex, splitProjectsByOccupancy } =
  await import('../../public/floor-rule.js');
const { benchSeatsIn, clipLabel, whereOf, worktreeBenches, worktreeName, WORKTREE_LABEL_MAX } =
  await import('../../public/floor-worktrees.js');
const { buildPlan } = await import('../../public/render/plan.js');
const { assignSeats } = await import('../../public/render/agents-seats.js');
const { moduleFor } = await import('../../public/render/plan-proportions.js');
const { crewFloorOf, workZoneOf } = await import('../../public/render/plan-interior.js');
const { benchFloorFor, benchRun, doorBoxOf, layWorktreeBenches } =
  await import('../../public/render/plan-worktrees.js');

const NOW = 1_800_000_000_000;
const quiet = { info() {}, warn() {}, error() {}, debug() {} };
const WORKTREES = [
  'agent-a0fedbce8c57e1bf9',
  'awesome-franklin-2d1495',
  'dazzling-dijkstra-657ac8',
];

/** A main checkout with linked worktrees under `.claude/worktrees`, by hand. */
function repoWithWorktrees(name, worktrees) {
  const root = path.join(scratchDir(`wt-${name}-`), name);
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  const at = worktrees.map((wt) => {
    const dir = path.join(root, '.claude', 'worktrees', wt);
    const admin = path.join(root, '.git', 'worktrees', wt);
    fs.mkdirSync(admin, { recursive: true });
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(admin, 'commondir'), '../..\n');
    fs.writeFileSync(path.join(dir, '.git'), `gitdir: ${admin.replace(/\\/g, '/')}\n`);
    return dir;
  });
  return { root, worktrees: at };
}

/** One scanned session. @param {string} id @param {string} cwd @param {object} [over] */
function summary(id, cwd, over = {}) {
  return {
    id: agentId('claude-code', id),
    runtime: 'claude-code',
    title: `title-${id}`,
    hasCustomTitle: false,
    cwd,
    gitBranch: null,
    model: 'claude-opus-5',
    lastActivityAt: NOW - 60_000,
    tokens: 100,
    cacheTokens: 0,
    costEstimate: 0.01,
    lastRole: 'user',
    lastText: 'hi',
    turnEnded: false,
    ...over,
  };
}

function adapterWith(summaries) {
  return {
    id: 'claude-code',
    label: 'Claude Code',
    available: async () => true,
    scanSessions: async () => summaries,
    liveSessions: async () =>
      summaries.map((s) => ({
        id: s.id,
        runtime: 'claude-code',
        cwd: s.cwd,
        name: null,
        startedAt: NOW - 120_000,
        pid: 1,
      })),
    hooks: {
      supported: true,
      describe: () => ({ file: '', json: '', events: [], note: '' }),
      install: async () => {},
      remove: async () => {},
      installed: async () => false,
    },
  };
}

/** The owner's shape: three worktrees and the main checkout of one repo, and another repo. */
async function ownerFloor(opts = {}) {
  clearRepoCache();
  const career = repoWithWorktrees('career-ops', WORKTREES);
  const other = repoWithWorktrees('deckhq', []);
  const summaries = [
    summary('main', career.root, { gitBranch: 'main' }),
    summary('wt0', career.worktrees[0], { gitBranch: 'worktree-agent-a0fedbce8c57e1bf9' }),
    summary('wt1', career.worktrees[1], { gitBranch: 'claude/awesome-franklin-2d1495' }),
    summary('wt2', career.worktrees[2]),
    summary('other', other.root, { gitBranch: 'main' }),
  ];
  const state = path.join(scratchDir('wt-state-'), 'state.json');
  const store = new Store(state);
  await store.load();
  if (opts.before) await opts.before(store, { career, other });
  const identity = opts.identity === false ? undefined : new Identity(store);
  const registry = new Registry({
    store,
    adapters: [adapterWith(summaries)],
    log: quiet,
    identity,
  });
  await registry.refresh();
  return { registry, store, career, other, summaries };
}

// ------------------------------------------------------------------ the model

test('three worktrees and the main checkout of one repo are ONE project; another repo is a second', async () => {
  const { registry, career, other } = await ownerFloor();
  const snap = registry.snapshot();
  const repoId = projectIdFromCwd(career.root);

  assert.deepEqual(snap.projects.map((p) => p.name).sort(), ['career-ops', 'deckhq']);
  const room = snap.projects.find((p) => p.name === 'career-ops');
  assert.equal(room.id, repoId);
  assert.equal(room.sessionCount, 4, "the plate's count includes the worktree sessions");
  assert.equal(room.cwd, career.root, "the room's directory is the repository's");
  assert.equal(snap.projects.find((p) => p.name === 'deckhq').id, projectIdFromCwd(other.root));

  const inRepo = snap.agents.filter((a) => a.projectId === repoId);
  assert.equal(inRepo.length, 4);
  for (const a of inRepo) {
    assert.equal(a.repoId, repoId);
    assert.equal(a.repoName, 'career-ops');
    assert.equal(a.projectName, 'career-ops');
    assert.equal(a.repoRoot, career.root);
  }
  const byTitle = Object.fromEntries(snap.agents.map((a) => [a.title, a]));
  assert.equal(byTitle['title-main'].worktree, null, 'the main checkout is not a worktree');
  assert.deepEqual(byTitle['title-wt0'].worktree, {
    name: WORKTREES[0],
    path: career.worktrees[0].replace(/\//g, path.sep),
    branch: 'worktree-agent-a0fedbce8c57e1bf9',
  });
  // The branch is the session's own `gitBranch`, and null where it gave none.
  assert.equal(byTitle['title-wt1'].worktree.branch, 'claude/awesome-franklin-2d1495');
  assert.equal(byTitle['title-wt2'].worktree.branch, null);
  assert.equal(byTitle['title-wt2'].worktree.name, WORKTREES[2]);
  // Nobody is named for a worktree any more.
  assert.equal(
    snap.projects.some((p) => WORKTREES.includes(p.name)),
    false,
  );
});

test('the change key moves when a session moves to another worktree', async () => {
  const { registry } = await ownerFloor();
  const agents = registry.agents;
  const base = changeKey(agents);
  const i = agents.findIndex((a) => a.worktree);
  const moved = (/** @type {object} */ worktree) =>
    changeKey(agents.map((a, k) => (k === i ? { ...a, worktree } : a)));
  assert.notEqual(moved(null), base);
  assert.notEqual(moved({ ...agents[i].worktree, name: 'another' }), base);
  assert.notEqual(moved({ ...agents[i].worktree, path: `${agents[i].worktree.path}-2` }), base);
  assert.notEqual(moved({ ...agents[i].worktree, branch: 'feat/other' }), base);
});

test('homeProjectOf agrees: a worktree session, and a junior in a worktree, are home in the repository', async () => {
  const { registry, career } = await ownerFloor();
  const repoId = projectIdFromCwd(career.root);
  const agents = registry.snapshot().agents;
  const byId = agentIndex(agents);
  for (const a of agents.filter((x) => x.repoName === 'career-ops')) {
    assert.equal(homeProjectOf(a, byId), repoId);
    assert.equal(homeProjectOf(a, byId), a.repoId);
  }
  // A junior isolated in a worktree, with its parent gone from the snapshot.
  const junior = {
    id: 'j1',
    subagent: true,
    parentId: 'not-on-the-snapshot',
    ...projectOf(career.worktrees[0]),
    activityState: 'working',
    ackState: 'active',
  };
  assert.equal(homeProjectOf(junior, agentIndex([junior])), repoId);
});

test("a pin made on a worktree's old room holds the repository's, and unpinning takes it back", async () => {
  const legacy = [];
  const { registry, store, career } = await ownerFloor({
    before: async (s, { career: c }) => {
      legacy.push(projectIdFromCwd(c.worktrees[1]));
      assert.equal(s.setProjectPinned(legacy[0], true), true);
    },
  });
  const repoId = projectIdFromCwd(career.root);
  assert.notEqual(legacy[0], repoId);
  assert.equal(store.isProjectPinned(repoId), false, 'nothing was rewritten on disk');
  assert.equal(registry.snapshot().projects.find((p) => p.id === repoId).pinned, true);
  assert.deepEqual(
    legacyIdsOf(registry.projectAliases().ids, repoId).sort(),
    [
      ...WORKTREES.map((wt) =>
        projectIdFromCwd(path.join(career.root, '.claude', 'worktrees', wt)),
      ),
    ].sort(),
  );

  // The user unpins the room they can see: the pin that was holding it goes.
  assert.equal(registry.setProjectPinned(repoId, false), false);
  assert.equal(store.isProjectPinned(legacy[0]), false);
  assert.equal(registry.snapshot().projects.find((p) => p.id === repoId).pinned, false);

  // And a new pin is written under the repository, where it belongs.
  registry.setProjectPinned(repoId, true);
  assert.deepEqual(Object.keys(store.pinnedProjects()), [repoId]);
});

test('usage is counted by repository: new records carry its key, old ones are read through to it', async () => {
  const { registry, career } = await ownerFloor();
  const repoKey = projectKeyFor(career.root);
  const oldKeys = career.worktrees.map((wt) => projectKeyFor(wt));
  for (const cwd of [career.root, ...career.worktrees]) {
    assert.equal(registry._projectKeyOf(cwd), repoKey);
  }
  const { keys } = registry.projectAliases();
  for (const old of oldKeys) assert.equal(keys[old], repoKey);
  assert.equal(Object.keys(keys).length, 3, 'the main checkout needs no alias');

  // Ledger records already on disk under a worktree's key: aggregated by the
  // repository when they are read, and the records themselves left alone.
  const records = [
    { t: 1, kind: 'tokens', projectKey: oldKeys[0], delta: 10 },
    { t: 2, kind: 'tokens', projectKey: repoKey, delta: 5 },
    { t: 3, kind: 'tokens', projectKey: 'ffffffffffffffff', delta: 1 },
  ];
  const read = rekeyRecords(records, keys);
  assert.deepEqual(
    read.map((r) => r.projectKey),
    [repoKey, repoKey, 'ffffffffffffffff'],
  );
  assert.equal(records[0].projectKey, oldKeys[0], 'the record that was read is not rewritten');
  assert.equal(rekeyRecords(records, {}), records, 'no aliases, no copies');

  // Today's tally, the room plate's third line.
  const today = foldByRepo(
    {
      [oldKeys[0]]: { tokens: 10, cache: 1 },
      [oldKeys[1]]: { tokens: 20, cache: 2 },
      [repoKey]: { tokens: 5, cache: 0 },
    },
    keys,
  );
  assert.deepEqual(today[repoKey], { tokens: 35, cache: 3 });
  const room = registry.snapshot().projects.find((p) => p.name === 'career-ops');
  assert.deepEqual(todayTokensFor(room, today), { todayTokens: 38, todayTokensIsToday: true });

  // The offline CLI reads the same way, from the scan cache alone.
  const cached = [career.root, ...career.worktrees].map((cwd) => ({ cwd }));
  assert.deepEqual(repoKeys(cached), keys);
  assert.equal(projectNames(cached)[repoKey], 'career-ops');
  const offline = readOffline({
    state: { ack: {}, identity: { projects: {}, agents: {}, projectOf: {}, names: {} } },
    summaries: [summary('wt0', career.worktrees[0])],
    stateFile: path.join(scratchDir('wt-offline-'), 'state.json'),
  });
  assert.equal(offline.agents[0].projectId, projectIdFromCwd(career.root));
  assert.equal(offline.agents[0].projectName, 'career-ops');
  assert.equal(offline.agents[0].worktree.name, WORKTREES[0]);
});

test("Studio's project key is the repository's, from any of its worktrees", async () => {
  const { career } = await ownerFloor();
  const fromRoot = resolveProject(career.root);
  const fromWorktree = resolveProject(career.worktrees[2]);
  assert.equal(fromRoot.projectKey, projectKeyFor(career.root));
  assert.equal(fromWorktree.projectKey, fromRoot.projectKey);
  assert.equal(fromWorktree.root, fromRoot.root);
  const sub = path.join(career.root, 'packages', 'api');
  fs.mkdirSync(sub, { recursive: true });
  assert.equal(resolveProject(sub).projectKey, fromRoot.projectKey);
});

test('a session numbered while its worktree was a project keeps its tag; a new one counts in the repository', async () => {
  const { registry, career } = await ownerFloor({
    before: async (store, { career: c }) => {
      // What an older build wrote: the worktree was project 7, and this session MK7.1.
      const identity = new Identity(store);
      const legacy = projectIdFromCwd(c.worktrees[0]);
      identity._state().projects[legacy] = 7;
      identity._state().nextProject = 8;
      identity.agentMk(agentId('claude-code', 'wt0'), legacy);
    },
  });
  const snap = registry.snapshot();
  const repoMk = snap.projects.find((p) => p.name === 'career-ops').projectMk;
  const mk = Object.fromEntries(snap.agents.map((a) => [a.title, a.mk]));
  assert.equal(mk['title-wt0'], 'MK7.1', 'the tag the user learned is not reassigned');
  assert.match(mk['title-wt1'], new RegExp(`^MK${repoMk}\\.\\d+$`));
  assert.match(mk['title-main'], new RegExp(`^MK${repoMk}\\.\\d+$`));
  assert.equal(new Set(Object.values(mk)).size, snap.agents.length, 'no two sessions share a tag');
  assert.equal(career.worktrees.length, 3);
});

test('a removed Studio worktree is placed with the repository the same scan found', () => {
  clearRepoCache();
  const { root } = repoWithWorktrees('career-ops', []);
  const stateDir = scratchDir('wt-studio-state-');
  const gone = path.join(stateDir, 'worktrees', 'career-ops-backend-dev');
  const placed = resolveProjects([root, gone], { stateDir });
  assert.equal(placed.get(gone).projectId, projectIdFromCwd(root));
  assert.equal(placed.get(gone).worktree.name, 'backend-dev');
  // With nobody in the repository on this scan, it stays what it was.
  clearRepoCache();
  const alone = resolveProjects([gone], { stateDir });
  assert.equal(alone.get(gone).projectId, projectIdFromCwd(gone));
  assert.equal(alone.get(gone).worktree, null);
  assert.deepEqual(aliasesOf([{ cwd: root, ...placed.get(root) }]), { ids: {}, keys: {} });
});

// ------------------------------------------------------------------ the floor

/** A floor agent in `career-ops`, in a worktree or not. */
function floorAgent(id, wt = null, over = {}) {
  return {
    id,
    projectId: 'career-ops',
    projectName: 'career-ops',
    repoId: 'career-ops',
    repoName: 'career-ops',
    worktree: wt ? { name: wt, path: `/w/career-ops/.claude/worktrees/${wt}`, branch: null } : null,
    activityState: 'working',
    ackState: 'active',
    lastActivityAt: NOW - 60_000,
    tokens: 0,
    cacheTokens: 0,
    ...over,
  };
}

const overlaps = (a, b) =>
  a.x < b.x + b.w - 1e-6 &&
  a.x + a.w > b.x + 1e-6 &&
  a.y < b.y + b.h - 1e-6 &&
  a.y + a.h > b.y + 1e-6;

test('ONE room: three benches and one desk for the repository, and a second room for the other', async () => {
  const { registry, career } = await ownerFloor();
  const snap = registry.snapshot();
  const repoId = projectIdFromCwd(career.root);
  const plan = buildPlan(snap.projects, snap.agents, { now: NOW, stage: { w: 1600, h: 1000 } });

  const rooms = plan.rooms.filter((r) => r.kind === 'project');
  assert.deepEqual(rooms.map((r) => r.name).sort(), ['career-ops', 'deckhq']);
  assert.equal(plan.worktreeBenches.length, 3, 'one bench per worktree');
  assert.ok(plan.worktreeBenches.every((b) => b.projectId === repoId));
  assert.equal(plan.seats.get(repoId).length, 1, 'one desk: the main checkout');
  assert.deepEqual(plan.proportions.faults, []);

  const seats = assignSeats(plan, snap.agents);
  const room = rooms.find((r) => r.id === repoId);
  const byTitle = Object.fromEntries(snap.agents.map((a) => [a.title, a]));
  assert.equal(seats.get(byTitle['title-main'].id), plan.seats.get(repoId)[0]);
  const benchSeats = ['wt0', 'wt1', 'wt2'].map((t) => seats.get(byTitle[`title-${t}`].id));
  for (const [i, seat] of benchSeats.entries()) {
    assert.equal(seat, plan.worktreeSeats.get(byTitle[`title-wt${i}`].id), 'a bench seat');
    assert.ok(seat.x > room.x && seat.x < room.x + room.w, 'inside the repository room');
    assert.ok(seat.y > room.y && seat.y < room.y + room.h, 'inside the repository room');
    assert.equal(plan.seats.get(repoId).includes(seat), false, 'not one of the desks');
  }
  assert.equal(new Set(benchSeats).size, 3);

  // Named for the branch where the session reported one, else the directory.
  const labels = plan.worktreeBenches.map((b) => b.label).sort();
  assert.deepEqual(
    labels,
    [
      clipLabel('claude/awesome-franklin-2d1495'),
      clipLabel(WORKTREES[2]),
      clipLabel('worktree-agent-a0fedbce8c57e1bf9'),
    ].sort(),
  );
  for (const label of labels) assert.ok(label.length <= WORKTREE_LABEL_MAX);
});

test('the room grows by the rulebook: bench seats count toward its module', () => {
  const one = [floorAgent('a')];
  const five = [
    floorAgent('a'),
    ...['w1', 'w1', 'w2', 'w3'].map((wt, i) => floorAgent(`b${i}`, wt)),
  ];
  const planOf = (agents) =>
    buildPlan(projectsOf(agents), agents, { now: NOW, stage: { w: 1600, h: 1000 } });
  const small = planOf(one).rooms.find((r) => r.kind === 'project');
  const big = planOf(five).rooms.find((r) => r.kind === 'project');
  assert.equal(small.module, moduleFor({ desks: 1 }));
  assert.equal(
    big.module,
    moduleFor({ desks: 5 }),
    'one desk and four bench seats are five people',
  );
  assert.equal(big.module, 'L');
  const pop = { benches: worktreeBenches(five, floorPopulation(five, { now: NOW })) };
  assert.equal(benchSeatsIn(pop, 'career-ops'), 4);
  assert.ok(big.natural.w >= benchFloorFor(pop.benches.get('career-ops')).w);
});

test("a bench never stands in the door, under the plate, in the work zone or on a crew's floor", () => {
  let checked = 0;
  for (const stage of [
    { w: 1600, h: 1000 },
    { w: 1366, h: 768 },
    { w: 2000, h: 1185 },
    { w: 1000, h: 1400 },
  ]) {
    for (const others of [0, 1, 4]) {
      for (const [benches, perBench, desks, crew] of [
        [1, 1, 1, 0],
        [3, 1, 1, 0],
        [2, 3, 4, 0],
        [6, 1, 2, 0],
        [2, 2, 1, 5],
      ]) {
        const agents = [];
        for (let d = 0; d < desks; d++) agents.push(floorAgent(`d${d}`));
        for (let b = 0; b < benches; b++) {
          for (let k = 0; k < perBench; k++) agents.push(floorAgent(`w${b}-${k}`, `tree-${b}`));
        }
        for (let j = 0; j < crew; j++) {
          agents.push(floorAgent(`j${j}`, null, { subagent: true, parentId: 'd0' }));
        }
        for (let o = 0; o < others; o++) {
          agents.push(
            floorAgent(`o${o}`, null, { projectId: `other-${o}`, projectName: `other-${o}` }),
          );
        }
        const plan = buildPlan(projectsOf(agents), agents, { now: NOW, stage });
        const room = plan.rooms.find((r) => r.id === 'career-ops');
        const mine = plan.worktreeBenches.filter((b) => b.projectId === 'career-ops');
        assert.equal(mine.length, benches);
        const door = doorBoxOf(room);
        const work = workZoneOf(room);
        const crewFloor = crewFloorOf(room);
        const zones = room.zones.filter((z) => /^worktree-\d+$/.test(z.id));
        assert.equal(zones.length, benches);
        for (const z of zones) {
          const where = `${stage.w}x${stage.h} others=${others} benches=${benches}x${perBench} desks=${desks} crew=${crew}`;
          assert.ok(
            z.x >= room.x - 1e-6 && z.x + z.w <= room.x + room.w + 1e-6,
            `inside the walls: ${where}`,
          );
          assert.ok(z.y >= room.y + room.plateBand - 1e-6, `under the plate band: ${where}`);
          assert.ok(z.y + z.h <= room.y + room.h + 1e-6, `inside the foot wall: ${where}`);
          if (door) assert.equal(overlaps(z, door), false, `clear of the door: ${where}`);
          assert.equal(overlaps(z, work), false, `clear of the desks: ${where}`);
          if (crew) assert.ok(crewFloor, 'the room has a crew floor');
          if (crewFloor) assert.equal(overlaps(z, crewFloor), false, `clear of the crew: ${where}`);
          for (const other of zones)
            if (other !== z) assert.equal(overlaps(z, other), false, where);
          // Nothing the room was furnished with afterwards stands on a bench.
          for (const p of room.props) {
            const own = p.anchor && p.anchor.type === 'zone' && p.anchor.of === z.id;
            if (!own && p.kind !== 'rug')
              assert.equal(overlaps(z, p), false, `${p.kind} on a bench: ${where}`);
          }
          checked++;
        }
        // Everybody at a desk has a seat of their own, and nobody shares one.
        const seats = assignSeats(plan, agents);
        const working = agents.filter((a) => a.projectId === 'career-ops');
        const taken = working.map((a) => seats.get(a.id));
        assert.ok(taken.every(Boolean));
        assert.equal(
          new Set(taken.map((s) => `${s.x.toFixed(3)},${s.y.toFixed(3)}`)).size,
          taken.length,
        );
        assert.deepEqual(plan.proportions.faults, []);
      }
    }
  }
  assert.ok(checked > 100);
});

test('a bench with nobody working at it is not drawn, and the panel still says the worktree', () => {
  const waiting = floorAgent('w', 'quiet-tree', {
    activityState: 'for_review',
    reviewSince: NOW - 5000,
  });
  const ended = floorAgent('e', 'quiet-tree', { activityState: 'ended' });
  const agents = [floorAgent('a'), waiting, ended];
  const plan = buildPlan(projectsOf(agents), agents, { now: NOW, stage: { w: 1600, h: 1000 } });
  assert.deepEqual(plan.worktreeBenches, []);
  assert.equal(plan.worktreeSeats.size, 0);
  const room = plan.rooms.find((r) => r.kind === 'project');
  assert.equal(
    room.zones.some((z) => /^worktree-/.test(z.id)),
    false,
  );
  const seats = assignSeats(plan, agents);
  assert.equal(plan.officeSeats.includes(seats.get('w')), true, 'waiting: on the office sofa');
  assert.deepEqual(whereOf(waiting), ['career-ops', 'quiet-tree']);
  assert.deepEqual(whereOf(agents[0]), ['career-ops']);
  assert.equal(worktreeName({ name: 'quiet-tree', branch: 'feat/x' }), 'feat/x');
  assert.equal(worktreeName({ name: 'quiet-tree', branch: 'HEAD' }), 'quiet-tree');
  assert.equal(worktreeName({ name: 'quiet-tree', branch: null }), 'quiet-tree');

  // It comes back, with its bench, the moment it works again.
  const back = [agents[0], { ...waiting, activityState: 'working', reviewSince: null }, ended];
  const again = buildPlan(projectsOf(back), back, { now: NOW, stage: { w: 1600, h: 1000 } });
  assert.equal(again.worktreeBenches.length, 1);
  assert.equal(again.worktreeBenches[0].seats, 1);
});

test('the main checkout keeps the desks, a junior is placed as a junior, and a session leading juniors keeps a desk', () => {
  const lead = floorAgent('lead', 'busy-tree');
  const agents = [
    floorAgent('a'),
    lead,
    floorAgent('solo', 'busy-tree'),
    floorAgent('j1', 'agent-0001', { subagent: true, parentId: 'lead' }),
    floorAgent('j2', 'agent-0002', { subagent: true, parentId: 'a' }),
  ];
  const pop = floorPopulation(agents, { now: NOW });
  assert.equal(pop.leading.has('lead'), true);
  const benches = worktreeBenches(agents, pop);
  assert.deepEqual(
    benches.get('career-ops').map((b) => b.ids),
    [['solo']],
    'only the session with no helpers',
  );
  const plan = buildPlan(projectsOf(agents), agents, { now: NOW, stage: { w: 1600, h: 1000 } });
  const seats = assignSeats(plan, agents);
  assert.equal(plan.worktreeSeats.has('lead'), false);
  assert.equal(plan.worktreeSeats.has('j1'), false, 'a junior never takes a bench seat');
  assert.equal(plan.seats.get('career-ops').includes(seats.get('lead')), true);
  assert.equal(plan.seats.get('career-ops').includes(seats.get('a')), true);
  assert.equal(seats.get('j1').junior, true);
  assert.equal(seats.get('solo'), plan.worktreeSeats.get('solo'));
  // One room for the lot, whichever directory a junior ran in.
  assert.equal(plan.rooms.filter((r) => r.kind === 'project').length, 1);
  assert.equal(splitProjectsByOccupancy(projectsOf(agents), pop).active.length, 1);
});

test('a bench is at least a shared one, and a room with no worktree in it is laid exactly as before', () => {
  assert.equal(benchRun(1), benchRun(3));
  assert.ok(benchRun(5) > benchRun(3));
  assert.equal(benchFloorFor([]), undefined);
  const plain = [floorAgent('a'), floorAgent('b')];
  const plan = buildPlan(projectsOf(plain), plain, { now: NOW, stage: { w: 1600, h: 1000 } });
  assert.deepEqual(plan.worktreeBenches, []);
  const room = plan.rooms.find((r) => r.kind === 'project');
  assert.deepEqual(layWorktreeBenches(room, []), { seatOf: new Map(), benches: [] });
});
