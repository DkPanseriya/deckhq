/**
 * The share picture is drawn from a copy that holds nothing it should not.
 *
 * `public/share-redact.js` is an allow-list, and an allow-list is only as good
 * as the proof that nothing slips round it. So these tests do not check a list
 * of fields somebody remembered: they walk EVERY string in the snapshot that
 * went in, and assert that none of them is anywhere in the copy that came out
 * unless it is one of DeckHQ's own words — a robot's name, a state, a runtime.
 *
 * Five floors: the `demo`, `crowded` and `crew` demo populations, a worktree
 * floor, and one built to be hostile — a project called `secret-acquisition`,
 * a title with an e-mail address in it, a token-shaped string in what the
 * agent last said, and fields this product does not have yet.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BRANCH_WORD,
  COVER_NAMES,
  coverProjectNames,
  fnv1a,
  hashTwin,
  redactForShare,
} from '../../public/share-redact.js';
import { JUNIOR_MARK, SHORT_NAMES } from '../../public/names.js';
import { crewsFrom } from '../../public/floor-rule.js';
import { buildPlan } from '../../public/render/plan.js';
import { assignSeats, hashString } from '../../public/render/agents.js';
import { appearanceHash, appearanceOf } from '../../public/render/palette.js';
import { counts as countsOf } from '../../src/core/model.mjs';
import { ownerShapedFloor, populationFloor } from '../helpers/large-floor.mjs';

const NOW = 1_800_000_000_000;
const HOME = 'C:\\Users\\dana\\work';

/**
 * A helper floor, dressed as the daemon would publish it: every field a real
 * snapshot carries that could name the machine, the work or the conversation.
 * @param {{projects:any[], agents:any[]}} floor
 */
function dressed(floor) {
  const mkOf = new Map(floor.projects.map((p, i) => [p.id, i + 1]));
  const seat = new Map();
  const agents = floor.agents.map((a, i) => {
    const project = String(a.projectId);
    const n = (seat.get(project) || 0) + 1;
    seat.set(project, n);
    const working = a.activityState === 'working';
    return {
      ...a,
      runtime: 'claude-code',
      title: a.title || `Junior task ${i} for ${project}`,
      hasCustomTitle: i % 2 === 0,
      projectName: project,
      repoId: project,
      repoName: project,
      repoRoot: `${HOME}\\${project}`,
      cwd: `${HOME}\\${project}\\packages\\core`,
      gitBranch: i % 3 === 0 ? 'main' : `feat/${project}-ticket-${i}`,
      model: i % 2 ? 'claude-opus-5-20260501' : 'gpt-5.5-codex-preview',
      identityId: i === 1 ? 'claude-code:resumed-from-0b7e41aa' : a.id,
      supersedes: i === 1 ? ['claude-code:resumed-from-0b7e41aa'] : [],
      tokens: 40_000 + i,
      cacheTokens: 9_000,
      costEstimate: 0.5,
      lastRole: 'assistant',
      lastText: `Finished the pass over ${project}; details in ${project}/NOTES-${i}.md`,
      currentTool: working
        ? { name: 'Bash', summary: `npm test --prefix ${project}-${i}`, since: NOW - 4000 }
        : null,
      pendingPermission:
        a.activityState === 'needs_input'
          ? { id: `toolu_${i}`, tool: 'Bash', summary: `rm -rf ${project}/build-${i}`, since: NOW }
          : null,
      subagentDescription: a.subagent ? `Map the call sites of ${project} number ${i}` : null,
      workflowId: a.subagent ? 'wf_01k9crewdemo0001' : null,
      projectMk: mkOf.get(project),
      agentMk: n,
      mk: a.subagent ? `MK${mkOf.get(project)}.1${JUNIOR_MARK}` : `MK${mkOf.get(project)}.${n}`,
      displayName: null,
      givenName: a.subagent ? null : a.label,
      avatar: i % 5 === 0 ? 'star' : null,
    };
  });
  const projects = floor.projects.map((p) => ({
    ...p,
    cwd: `${HOME}\\${p.id}`,
    agentIds: agents.filter((a) => a.projectId === p.id).map((a) => a.id),
    projectMk: mkOf.get(p.id),
    mk: `MK${mkOf.get(p.id)}`,
  }));
  return {
    agents,
    projects,
    crews: crewsFrom(agents, { now: NOW }),
    counts: countsOf(agents, { now: NOW, goneHomeDays: 7 }),
    settings: { theme: 'night shift', goneHomeDays: 7, showCost: false, look: { preset: 'x' } },
    takenNames: agents.map((a) => a.label),
    hooks: { file: 'C:\\Users\\dana\\.claude\\settings.json' },
    rateCardVersion: '2026-09-04',
    now: NOW,
    nowFixed: true,
  };
}

/** One repository with a main checkout and two linked worktrees in use, and a second repository. */
function worktreeFloor() {
  const row = (id, project, label, extra = {}) => ({
    id: `claude-code:${id}`,
    projectId: project,
    label,
    title: `Session ${id} in ${project}`,
    ackState: 'active',
    activityState: 'working',
    reviewSince: null,
    needsInputSince: null,
    lastActivityAt: NOW - 60_000,
    worktree: null,
    ...extra,
  });
  const at = (name) => `${HOME}\\orbital-api\\.claude\\worktrees\\${name}`;
  const hopper = { name: 'eager-hopper-3f2a1c', path: at('eager-hopper-3f2a1c') };
  const otter = { name: 'calm-otter-77aa10', path: at('calm-otter-77aa10'), branch: null };
  const agents = [
    row('w0', 'orbital-api', SHORT_NAMES[0]),
    row('w1', 'orbital-api', SHORT_NAMES[1], {
      worktree: { ...hopper, branch: 'fix/refund-rows' },
    }),
    row('w2', 'orbital-api', SHORT_NAMES[2], {
      worktree: { ...hopper, branch: 'fix/refund-rows' },
    }),
    row('w3', 'orbital-api', SHORT_NAMES[3], { worktree: otter }),
    row('w4', 'orbital-api', SHORT_NAMES[4], {
      worktree: otter,
      activityState: 'for_review',
      reviewSince: NOW - 26 * 3_600_000,
    }),
    row('w5', 'checkout-flow', SHORT_NAMES[5]),
  ];
  const project = (id, n) => ({ id, name: id, sessionCount: n, activeCount: n, needsYou: 0 });
  return dressed({ agents, projects: [project('orbital-api', 5), project('checkout-flow', 1)] });
}

const EMAIL = 'dana.whitfield@northwind-capital.example';
const TOKEN = 'ghp_x9Yq3LmN8vRt2KpW5sZc7BdF1hJ4gA6eU0oI';

/** A floor in which everything that can be a secret is one. */
function hostileFloor() {
  const base = worktreeFloor();
  const rename = (v) =>
    typeof v === 'string' ? v.replaceAll('orbital-api', 'secret-acquisition') : v;
  const deep = (v) =>
    Array.isArray(v)
      ? v.map(deep)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)]))
        : rename(v);
  const floor = deep(base);
  const [lead, second, third] = floor.agents;
  lead.title = `Email ${EMAIL} about the term sheet`;
  lead.lastText = `Pushed with ${TOKEN}; the key sk-ant-api03-Zq81LrT0vN is in .env.production`;
  lead.currentTool = {
    name: 'mcp__northwind-crm__lookup_customer',
    summary: 'lookup Falcon Holdings',
  };
  // A name somebody typed for a robot, and one they picked from the pool.
  lead.displayName = 'Project Falcon lead';
  lead.label = 'Project Falcon lead';
  second.displayName = SHORT_NAMES[40];
  second.label = SHORT_NAMES[40];
  second.worktree.branch = 'dana/falcon-term-sheet';
  third.gitBranch = 'dana/falcon-term-sheet';
  floor.agents.push({
    ...third,
    id: 'claude-code:w2/agent-a1b2c3',
    subagent: true,
    parentId: third.id,
    label: `${SHORT_NAMES[9]}${JUNIOR_MARK}`,
    juniorName: SHORT_NAMES[9],
    subagentType: 'falcon-due-diligence',
    subagentDescription: 'Read the Northwind data room index',
    worktree: null,
    // Fields this product does not have yet. A copy made by listing what to
    // remove would carry every one of them.
    notes: 'do not share: Falcon closes on the ninth',
    mcpServers: [{ name: 'northwind-crm', status: 'connected' }],
    environment: { AWS_PROFILE: 'northwind-prod' },
  });
  floor.crews = crewsFrom(floor.agents, { now: NOW });
  floor.writeError = 'EACCES: C:\\Users\\dana\\.deckhq\\state.json';
  floor.settings.hostname = 'DANA-THINKPAD';
  floor.demoNote = 'a note nobody should see in a picture';
  return floor;
}

/** @type {Record<string, () => any>} */
const FLOORS = {
  demo: () => dressed(populationFloor('demo', NOW)),
  crowded: () => dressed(ownerShapedFloor(NOW)),
  worktrees: worktreeFloor,
  crew: () => dressed(populationFloor('crew', NOW)),
  hostile: hostileFloor,
};

/** DeckHQ's own words: the only strings allowed on both sides of the redaction. */
const OURS = new Set([
  ...['claude-code', 'codex', 'gemini-cli', 'opencode'],
  ...['working', 'needs_input', 'stalled', 'for_review', 'ended'],
  ...['active', 'benched', 'let_go', 'user', 'assistant'],
  ...['hex', 'triangle', 'square', 'diamond', 'drop', 'star', 'cross', 'ring'],
  ...['Explore', 'general-purpose', 'Plan', 'Read', 'Bash', 'WebFetch', 'Task'],
]);
const POOL = new Set(SHORT_NAMES);

/** @param {string} value */
function isOurs(value) {
  if (OURS.has(value) || /^MK\d+(\.\d+)?(·jr)?$/.test(value)) return true;
  const bare = value.endsWith(JUNIOR_MARK) ? value.slice(0, -JUNIOR_MARK.length) : value;
  return POOL.has(bare);
}

/**
 * Every string in a value, keys included, with where it was found.
 * @param {any} value @param {string} [at]
 * @param {{at:string, text:string}[]} [out]
 */
function stringsOf(value, at = '$', out = [], keys = false) {
  if (typeof value === 'string') {
    if (value) out.push({ at, text: value });
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => stringsOf(v, `${at}[${i}]`, out, keys));
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (keys) out.push({ at: `${at} (key)`, text: k });
      stringsOf(v, `${at}.${k}`, out, keys);
    }
  }
  return out;
}

/**
 * What of `input` can be read in `output`. A string of five characters or more
 * counts wherever it appears, even inside a longer one; a shorter string only
 * when it is the whole of a value, because `main` is also four letters of
 * `remaining`.
 * @param {any} input @param {any} output
 * @param {(s:{at:string, text:string}) => boolean} [only]
 * @returns {string[]}
 */
function leaks(input, output, only = () => true) {
  const seen = stringsOf(output, '$', [], true);
  /** @type {string[]} */
  const found = [];
  const asked = new Set();
  for (const s of stringsOf(input)) {
    if (isOurs(s.text) || !only(s) || asked.has(s.text)) continue;
    asked.add(s.text);
    for (const o of seen) {
      const hit = o.text === s.text || (s.text.length >= 5 && o.text.includes(s.text));
      if (hit) found.push(`${s.at} = ${JSON.stringify(s.text)} is readable at ${o.at}`);
    }
  }
  return found;
}

for (const [name, make] of Object.entries(FLOORS)) {
  test(`${name}: with both switches on, no string of the floor survives the redaction`, () => {
    const input = make();
    const output = redactForShare(input);
    assert.deepEqual(leaks(input, output), []);
    // And it was a floor worth checking: it had names, paths and text to lose.
    assert.ok(stringsOf(input).filter((s) => !isOurs(s.text)).length > input.agents.length * 8);
  });
}

test('the scan is not blind: it reads a planted leak, and the hostile strings by name', () => {
  const input = hostileFloor();
  assert.ok(leaks(input, { anything: [`see ${input.agents[0].cwd}`] }).length > 0);
  assert.ok(leaks(input, { [input.agents[0].id]: 1 }).length > 0, 'a real id used as a key');
  // Copying the floor and blanking a list of fields is what this module is
  // not. That copy still carries every title, branch and session id.
  const blanked = {
    ...input,
    agents: input.agents.map((a) => ({ ...a, cwd: '', projectName: 'MK1', repoRoot: '' })),
  };
  assert.ok(leaks(input, blanked).length > 100);
  const text = JSON.stringify(redactForShare(input));
  for (const secret of [
    'secret-acquisition',
    EMAIL,
    TOKEN,
    'sk-ant-',
    'Falcon',
    'northwind',
    'dana',
  ]) {
    assert.equal(text.toLowerCase().includes(secret.toLowerCase()), false, secret);
  }
});

for (const [name, make] of Object.entries(FLOORS)) {
  test(`${name}: names, states, counts and waits are what they were`, () => {
    const input = make();
    const output = redactForShare(input);
    assert.equal(output.agents.length, input.agents.length);
    assert.deepEqual(output.counts, input.counts);
    assert.equal(output.now, input.now);
    input.agents.forEach((a, i) => {
      const b = output.agents[i];
      // A robot's own name stays. The one name a person typed does not.
      if (isOurs(a.label)) assert.equal(b.label, a.label);
      for (const key of ['activityState', 'ackState', 'reviewSince', 'needsInputSince']) {
        assert.equal(b[key], a[key], `${key} of agent ${i}`);
      }
      for (const key of ['lastActivityAt', 'tokens', 'subagent', 'projectMk', 'agentMk', 'mk']) {
        assert.equal(b[key], a[key], `${key} of agent ${i}`);
      }
    });
    input.projects.forEach((p, i) => {
      const q = output.projects[i];
      for (const key of ['sessionCount', 'activeCount', 'needsYou', 'tokens', 'projectMk']) {
        assert.equal(q[key], p[key], `${key} of project ${i}`);
      }
      assert.equal(q.agentIds.length, p.agentIds.length);
    });
    assert.equal(output.crews.length, input.crews.length);
    assert.deepEqual(
      output.crews.map((crew) => crew.count),
      input.crews.map((crew) => crew.count),
    );
  });
}

/** The building a snapshot makes and where everybody in it sits, in snapshot order. */
function seating(snapshot) {
  const plan = buildPlan(snapshot.projects, snapshot.agents, {
    now: NOW,
    stage: { w: 1600, h: 844 },
    goneHomeDays: 7,
  });
  const seats = assignSeats(plan, snapshot.agents);
  return {
    rooms: plan.rooms.map((r) => [r.kind, r.x, r.y, r.w, r.h]),
    benches: (plan.worktreeBenches || []).map((b) => [b.x, b.y, b.w, b.h]),
    seats: snapshot.agents.map((a) => {
      const s = seats.get(a.id);
      return s ? [s.x, s.y] : null;
    }),
  };
}

for (const [name, make] of Object.entries(FLOORS)) {
  test(`${name}: the same building, everybody in the same seat, wearing the same face`, () => {
    const input = make();
    for (const options of [{}, { hideProjects: false }, { hideDetails: false }]) {
      const output = redactForShare(input, options);
      const before = seating(input);
      const after = seating(output);
      assert.deepEqual(after.rooms, before.rooms);
      assert.deepEqual(after.benches, before.benches);
      assert.deepEqual(after.seats, before.seats);
      assert.ok(before.seats.some(Boolean), 'somebody was seated at all');
      input.agents.forEach((a, i) => {
        assert.deepEqual(appearanceOf(output.agents[i]), appearanceOf(a), `face of agent ${i}`);
      });
    }
  });
}

test('a session id is replaced by a twin: another string, the same hash, the same order', () => {
  const real = 'claude-code:3f2a1c9e-1111-4222-8333-444455556666';
  const twin = hashTwin('s0001-', real);
  assert.notEqual(twin, real);
  assert.ok(twin.startsWith('s0001-'));
  assert.equal(twin.length, 's0001-'.length + 5);
  assert.equal(twin.includes('3f2a1c9e'), false);
  // The floor's two hashes are this hash, so the seat and the face follow.
  assert.equal(fnv1a(twin), fnv1a(real));
  assert.equal(hashString(twin), hashString(real));
  assert.equal(appearanceHash(twin), appearanceHash(real));
  // And so does everything hashed from the id with something appended.
  assert.equal(hashString(`${twin}:bay:3`), hashString(`${real}:bay:3`));
  assert.equal(hashTwin('s0001-', real), twin, 'the same twin every time');

  const input = FLOORS.crowded();
  const output = redactForShare(input);
  const order = (list) =>
    list.map((a, i) => [a.id, i]).sort((x, y) => String(x[0]).localeCompare(String(y[0])));
  assert.deepEqual(
    order(output.agents).map((x) => x[1]),
    order(input.agents).map((x) => x[1]),
  );
  assert.equal(new Set(output.agents.map((a) => a.id)).size, input.agents.length);

  // The control: numbering the agents instead moves people, which is why a twin.
  const numbered = {
    ...input,
    agents: input.agents.map((a, i) => ({ ...a, id: `agent-${String(i).padStart(4, '0')}` })),
  };
  assert.notDeepEqual(seating(numbered).seats, seating(input).seats);
});

/** Every leaf of a value by its path, list positions written `[]`. */
function leaves(value, at = '', out = new Map()) {
  if (Array.isArray(value)) value.forEach((v, i) => leaves(v, `${at}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) leaves(v, at ? `${at}.${k}` : k, out);
  } else out.set(at, value);
  return out;
}

/** The fields two copies disagree on, with list positions folded away. */
function differing(one, other) {
  const a = leaves(one);
  const b = leaves(other);
  const out = new Set();
  for (const key of new Set([...a.keys(), ...b.keys()])) {
    if (a.get(key) !== b.get(key)) out.add(key.replace(/\[\d+\]/g, '[]'));
  }
  return [...out].sort();
}

/** What each switch governs: the fields it lets through, and nothing else. */
const CLASSES = {
  hideProjects: [
    'agents[].gitBranch',
    'agents[].projectName',
    'agents[].repoName',
    'agents[].worktree.branch',
    'agents[].worktree.name',
    'projects[].name',
  ],
  hideDetails: [
    'agents[].currentTool.name',
    'agents[].currentTool.summary',
    'agents[].displayName',
    'agents[].givenName',
    'agents[].juniorName',
    'agents[].label',
    'agents[].lastText',
    'agents[].model',
    'agents[].subagentDescription',
    'agents[].subagentType',
    'agents[].title',
    'crews[].members[].agentType',
    'crews[].members[].name',
    'shared.hideDetails',
  ],
};
CLASSES.hideProjects.push('shared.hideProjects');

/** A copy with the named fields taken out, so what is left can be scanned on its own. */
function withoutFields(value, fields, at = '') {
  if (Array.isArray(value)) return value.map((v) => withoutFields(v, fields, `${at}[]`));
  if (!value || typeof value !== 'object') return value;
  /** @type {Record<string, any>} */
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    const path = at ? `${at}.${k}` : k;
    if (!fields.includes(path)) out[k] = withoutFields(v, fields, path);
  }
  return out;
}

for (const [flag, fields] of Object.entries(CLASSES)) {
  for (const [name, make] of Object.entries(FLOORS)) {
    test(`${name}: ${flag} off lets its own fields through, and only those`, () => {
      const input = make();
      const closed = redactForShare(input);
      const open = redactForShare(input, { [flag]: false });

      // Nothing outside the class is any different for the switch being off.
      const moved = differing(closed, open);
      assert.deepEqual(
        moved.filter((field) => !fields.includes(field)),
        [],
      );
      assert.ok(moved.length > 2, 'and the switch did do something');

      // Inside it, the picture says what the floor says.
      const real = leaves(input);
      let compared = 0;
      for (const [key, value] of leaves(open)) {
        const field = key.replace(/\[\d+\]/g, '[]');
        if (!fields.includes(field) || !field.startsWith('agents') || !real.has(key)) continue;
        assert.equal(value ?? null, real.get(key) ?? null, key);
        compared++;
      }
      assert.ok(compared >= input.agents.length);
      input.projects.forEach((p, i) => {
        if (flag === 'hideProjects') assert.equal(open.projects[i].name, p.name);
        else assert.notEqual(open.projects[i].name, p.name);
      });

      // And with those fields set aside, the copy is as empty of the floor as before.
      assert.deepEqual(leaks(input, withoutFields(open, fields)), []);
    });
  }
}

test('with both switches off, a directory, an id and an unknown field still do not pass', () => {
  const input = hostileFloor();
  const open = redactForShare(input, { hideProjects: false, hideDetails: false });
  const everything = [...CLASSES.hideProjects, ...CLASSES.hideDetails];
  assert.deepEqual(leaks(input, withoutFields(open, everything)), []);
  const text = JSON.stringify(open);
  for (const never of [
    'C:\\\\Users',
    'claude-code:w',
    'northwind-prod',
    'DANA-THINKPAD',
    'rm -rf',
  ]) {
    assert.equal(text.includes(never), false, never);
  }
  for (const a of open.agents) {
    assert.equal(a.cwd, '');
    assert.equal(a.repoRoot, undefined);
    assert.equal(a.supersedes, undefined);
    assert.equal(a.pendingPermission ?? null, null);
  }
  assert.deepEqual(Object.keys(open).sort(), [
    'agents',
    'counts',
    'crews',
    'now',
    'nowFixed',
    'projects',
    'settings',
    'shared',
  ]);
  assert.deepEqual(open.settings, { goneHomeDays: 7, showCost: false });
});

test('a room keeps its cover between pictures, and no two rooms share one', () => {
  for (const make of Object.values(FLOORS)) {
    const input = make();
    const output = redactForShare(input);
    const covers = output.projects.map((p) => p.name);
    assert.equal(new Set(covers).size, covers.length);
    const real = new Set(input.projects.map((p) => p.name));
    for (const cover of covers) {
      assert.equal(real.has(cover), false, `${cover} is a real name on this floor`);
      assert.ok(COVER_NAMES.includes(cover), `${cover} is from the pool`);
    }
    // Taken again, a second later, with a session gone and a number changed.
    const later = { ...input, agents: input.agents.slice(1), now: NOW + 1000 };
    assert.deepEqual(
      redactForShare(later).projects.map((p) => p.name),
      covers,
    );
    // An agent is in the room its project became.
    input.agents.forEach((a, i) => {
      const room = input.projects.findIndex((p) => p.id === a.projectId);
      assert.equal(output.agents[i].projectName, covers[room]);
      assert.equal(output.agents[i].projectId, output.projects[room].id);
    });
  }
});

test('a cover belongs to the project id: other projects coming and going do not move it', () => {
  const none = new Set();
  const p = (id, projectMk) => ({ id, projectMk });
  const alone = coverProjectNames([p('c--work-ledger', 4)], none).get('c--work-ledger');
  const crowd = [
    p('c--work-api', 1),
    p('c--work-site', 2),
    p('c--work-ledger', 4),
    p('c--work-app', 9),
  ];
  assert.equal(coverProjectNames(crowd, none).get('c--work-ledger'), alone);
  assert.equal(coverProjectNames([...crowd].reverse(), none).get('c--work-ledger'), alone);
  assert.notEqual(coverProjectNames(crowd, none).get('c--work-api'), alone);

  // Two projects that start at the same name: the older one (lower MK) keeps it.
  const start = (id) => fnv1a(id) % COVER_NAMES.length;
  const ids = Array.from({ length: 400 }, (_, i) => `repo-${i}`);
  const first = ids[0];
  const rival = ids.slice(1).find((id) => start(id) === start(first));
  assert.ok(rival, 'the fixture has a collision in it');
  const both = coverProjectNames([p(rival, 2), p(first, 1)], none);
  assert.equal(both.get(first), COVER_NAMES[start(first)]);
  assert.notEqual(both.get(rival), both.get(first));

  // More projects than names: still one each.
  const many = coverProjectNames(
    ids.map((id, i) => p(id, i + 1)),
    none,
  );
  assert.equal(new Set(many.values()).size, ids.length);

  // A real project called what a cover is called: that cover is not used here.
  const real = new Set([COVER_NAMES[start(first)]]);
  assert.notEqual(coverProjectNames([p(first, 1)], real).get(first), COVER_NAMES[start(first)]);
});

test('what is drawn instead: the class of a tool, a bench number, a robot’s own name', () => {
  const input = hostileFloor();
  const output = redactForShare(input);
  const [lead, second, third] = output.agents;

  // An MCP tool is a server somebody named. The bubble says `tool`.
  assert.deepEqual(lead.currentTool, { name: 'Task', summary: 'tool', since: null });
  // `npm test --prefix …` is a shell command; the bubble says so and no more.
  assert.equal(third.currentTool.name, 'Bash');
  assert.equal(third.currentTool.summary, 'shell');
  assert.equal(third.currentTool.since, input.agents[2].currentTool.since);

  // A name somebody typed gives way to the one DeckHQ gave; a pool name stays.
  assert.equal(lead.label, input.agents[0].givenName);
  assert.equal(lead.displayName, null);
  assert.equal(second.label, SHORT_NAMES[40]);

  // The two worktrees in use are `branch 1` and `branch 2`, and stay two.
  const benches = new Set(output.agents.filter((a) => a.worktree).map((a) => a.worktree.name));
  assert.deepEqual([...benches].sort(), [`${BRANCH_WORD} 1`, `${BRANCH_WORD} 2`]);
  for (const a of output.agents) {
    assert.equal(a.gitBranch, null);
    assert.equal(a.title, '');
    assert.equal(a.lastText, '');
    assert.equal(a.model, null);
  }

  // A junior of a type somebody defined wears its own name; a built-in type is kept.
  const junior = output.agents.at(-1);
  assert.equal(junior.subagentType, null);
  assert.equal(junior.label, `${SHORT_NAMES[9]}${JUNIOR_MARK}`);
  assert.equal(junior.parentId, third.id);
  const crew = redactForShare(FLOORS.crew());
  assert.ok(crew.agents.some((a) => a.subagentType === 'Explore'));
});

test('the redaction is a pure function: the floor is not touched, and twice is the same', () => {
  const freeze = (v) => {
    if (v && typeof v === 'object') Object.values(Object.freeze(v)).forEach(freeze);
    return v;
  };
  for (const make of Object.values(FLOORS)) {
    const input = freeze(make());
    const before = JSON.stringify(input);
    const once = redactForShare(input);
    assert.deepEqual(redactForShare(input), once);
    assert.equal(JSON.stringify(input), before);
  }
  // INVARIANT-adjacent: a picture is a read. Nobody's ack state is different
  // in the copy, and there is no way from the copy back to a session.
  const input = FLOORS.demo();
  const output = redactForShare(input);
  assert.deepEqual(
    output.agents.map((a) => a.ackState),
    input.agents.map((a) => a.ackState),
  );
  assert.equal(redactForShare(null).agents.length, 0);
  assert.equal(redactForShare({ agents: [null, 7, 'x'], projects: 'no' }).agents.length, 0);
});
