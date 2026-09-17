/**
 * ONE CONVERSATION, ONE AGENT (§155).
 *
 * The owner, 14 September 2026: _"I see 'southeast asia trip planning' agent named Greta 2 in the
 * room, and for the same session an agent named Sena 3 chilling in the lounge."_
 *
 * He was looking at one conversation drawn twice. Claude Code gives a resumed conversation a new
 * session id and a new transcript, and the registry keyed an agent by session id — so `--resume`
 * minted a second agent with a second MK number, a second first name, and a body in a second zone.
 *
 * The properties below are what must stay true, in the order they matter:
 *
 *   1. one agent per conversation
 *   2. every agent in exactly one placement zone
 *   3. no two drawn agents wearing the same name
 *   4. the name and the MK number a resume inherits are the EARLIEST ones, never a fresh pair
 *   5. nothing here writes a user-owned field
 *
 * The shapes in section E are the owner's own, read from his machine: the two session ids, the
 * origin record they share, and the four-deep chain in the same room.
 */

// A machine of our own, before anything under `src/` is loaded. `docs/DEVIATIONS.md` §124.
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { collapseResumed, conversationKey } from '../../src/core/resume-chain.mjs';
import { Registry } from '../../src/core/state-machine.mjs';
import { dropRoot, onRoot, storeRoot } from '../helpers/store-root.mjs';
import { Store } from '../../src/core/store.mjs';
import { Identity } from '../../src/core/identity.mjs';
import { agentId } from '../../src/core/model.mjs';
import { placement } from '../../public/floor-rule.js';

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 8, 14, 0, 0, 0);

/** @param {string} id @param {object} over */
function summary(id, over = {}) {
  return {
    id: agentId('claude-code', id),
    runtime: /** @type {const} */ ('claude-code'),
    title: over.title ?? 'Southeast Asia trip planning',
    hasCustomTitle: over.hasCustomTitle ?? true,
    cwd: over.cwd ?? 'C:\\Dk\\Projects\\1_1percent_better',
    gitBranch: null,
    model: 'claude-opus-5',
    lastActivityAt: over.lastActivityAt ?? T0,
    tokens: 10,
    cacheTokens: 0,
    costEstimate: 0.01,
    lastRole: over.lastRole ?? 'assistant',
    lastText: 'hi',
    turnEnded: over.turnEnded ?? true,
    ...(over.originUuid === undefined ? {} : { originUuid: over.originUuid }),
    ...(over.subagent === undefined ? {} : { subagent: over.subagent }),
  };
}

function makeAdapter(summaries, live = []) {
  return {
    id: /** @type {const} */ ('claude-code'),
    label: 'Claude Code',
    async available() {
      return true;
    },
    async scanSessions() {
      return summaries;
    },
    async liveSessions() {
      return live;
    },
    async conversation() {
      return [];
    },
    async send() {
      return { ok: true };
    },
    async openInTerminal() {},
    hooks: {
      supported: true,
      describe: () => ({ file: '', json: '', events: [], note: '' }),
      install: async () => {},
      remove: async () => {},
      installed: async () => false,
    },
  };
}

async function freshStore() {
  const { dir, file } = await storeRoot('resume-chain');
  const store = onRoot(dir, new Store(file));
  await store.load();
  return { store, dir };
}

async function registryOver(summaries, live = []) {
  const { store, dir } = await freshStore();
  const registry = new Registry({
    store,
    adapters: [makeAdapter(summaries, live)],
    identity: new Identity(store),
  });
  await registry.refresh();
  return { registry, store, dir };
}

// ---------------------------------------------------------------- A. the key

test('conversationKey: a summary with no origin record is its own conversation', () => {
  assert.equal(conversationKey(summary('a')), null);
  assert.equal(conversationKey(summary('a', { originUuid: null })), null);
  assert.equal(conversationKey(summary('a', { originUuid: '' })), null);
});

test('conversationKey: a junior is never grouped', () => {
  assert.equal(conversationKey(summary('j', { originUuid: 'u1', subagent: true })), null);
});

test('conversationKey: the same origin in two projects is two conversations', () => {
  const a = conversationKey(summary('a', { originUuid: 'u1', cwd: 'C:\\one' }));
  const b = conversationKey(summary('b', { originUuid: 'u1', cwd: 'C:\\two' }));
  assert.notEqual(a, b);
});

test('conversationKey: the same origin in the same project is one conversation', () => {
  const a = conversationKey(summary('a', { originUuid: 'u1' }));
  const b = conversationKey(summary('b', { originUuid: 'u1' }));
  assert.equal(a, b);
  assert.notEqual(a, null);
});

// --------------------------------------------------------- B. the collapse

test('a resume chain collapses to the NEWEST member', () => {
  const out = collapseResumed([
    summary('old', { originUuid: 'u1', lastActivityAt: T0 }),
    summary('new', { originUuid: 'u1', lastActivityAt: T0 + HOUR }),
  ]);
  assert.deepEqual(
    out.summaries.map((s) => s.id),
    [agentId('claude-code', 'new')],
  );
  assert.equal(out.supersededBy.get(agentId('claude-code', 'old')), agentId('claude-code', 'new'));
});

test('the survivor wears the EARLIEST member identity', () => {
  const out = collapseResumed([
    summary('mid', { originUuid: 'u1', lastActivityAt: T0 + HOUR }),
    summary('new', { originUuid: 'u1', lastActivityAt: T0 + 2 * HOUR }),
    summary('old', { originUuid: 'u1', lastActivityAt: T0 }),
  ]);
  assert.equal(out.identityOf.get(agentId('claude-code', 'new')), agentId('claude-code', 'old'));
  assert.deepEqual(out.absorbed.get(agentId('claude-code', 'new')), [
    agentId('claude-code', 'old'),
    agentId('claude-code', 'mid'),
  ]);
});

test('a chain of one is left exactly as it was, and the list is the same array', () => {
  const list = [summary('a', { originUuid: 'u1' }), summary('b', { originUuid: 'u2' })];
  const out = collapseResumed(list);
  assert.equal(out.summaries, list, 'no copy where nothing collapsed');
  assert.equal(out.supersededBy.size, 0);
  assert.equal(out.identityOf.size, 0);
});

test('summaries with no origin are never merged, however alike they look', () => {
  const out = collapseResumed([
    summary('a', { lastActivityAt: T0 }),
    summary('b', { lastActivityAt: T0 + HOUR }),
  ]);
  assert.equal(out.summaries.length, 2);
});

test('juniors are never merged into their parent chain', () => {
  const out = collapseResumed([
    summary('parent', { originUuid: 'u1', lastActivityAt: T0 }),
    summary('junior', { originUuid: 'u1', lastActivityAt: T0 + HOUR, subagent: true }),
  ]);
  assert.equal(out.summaries.length, 2);
});

test('DETERMINISM: a tie on activity picks the same survivor every time', () => {
  const shapes = [
    summary('zzz', { originUuid: 'u1', lastActivityAt: T0 }),
    summary('aaa', { originUuid: 'u1', lastActivityAt: T0 }),
    summary('mmm', { originUuid: 'u1', lastActivityAt: T0 }),
  ];
  const first = collapseResumed(shapes).summaries.map((s) => s.id);
  const reversed = collapseResumed([...shapes].reverse()).summaries.map((s) => s.id);
  assert.deepEqual(first, [agentId('claude-code', 'zzz')]);
  assert.deepEqual(reversed, first);
});

test('two independent chains in one project each keep their own survivor', () => {
  const out = collapseResumed([
    summary('a1', { originUuid: 'u1', lastActivityAt: T0 }),
    summary('a2', { originUuid: 'u1', lastActivityAt: T0 + HOUR }),
    summary('b1', { originUuid: 'u2', lastActivityAt: T0 }),
    summary('b2', { originUuid: 'u2', lastActivityAt: T0 + HOUR }),
  ]);
  assert.deepEqual(
    out.summaries.map((s) => s.id).sort(),
    [agentId('claude-code', 'a2'), agentId('claude-code', 'b2')].sort(),
  );
});

// ------------------------------------------------------- C. in the registry

test('INVARIANT: one agent per conversation', async () => {
  const { registry, dir } = await registryOver([
    summary('old', { originUuid: 'u1', lastActivityAt: T0 }),
    summary('new', { originUuid: 'u1', lastActivityAt: T0 + HOUR }),
  ]);
  assert.equal(registry.agents.length, 1);
  assert.equal(registry.agents[0].id, agentId('claude-code', 'new'));
  assert.deepEqual(registry.agents[0].supersedes, [agentId('claude-code', 'old')]);
  await dropRoot(dir);
});

test('INVARIANT: every agent stands in exactly one placement zone', async () => {
  const { registry, dir } = await registryOver([
    summary('old', { originUuid: 'u1', lastActivityAt: T0 }),
    summary('new', { originUuid: 'u1', lastActivityAt: T0 + HOUR }),
    summary('other', { originUuid: 'u2', lastActivityAt: T0, cwd: 'C:\\Dk\\other' }),
  ]);
  const snap = registry.snapshot();
  /** @type {Map<string, string[]>} */
  const zones = new Map();
  for (const a of snap.agents) {
    const where = placement(a);
    assert.ok(['desk', 'office', 'lounge', 'let_go'].includes(where), `unknown zone ${where}`);
    zones.set(a.id, [...(zones.get(a.id) || []), where]);
  }
  for (const [id, list] of zones) assert.equal(list.length, 1, `${id} is in ${list.length} zones`);
  assert.equal(zones.size, snap.agents.length, 'an id appeared twice in one snapshot');
  await dropRoot(dir);
});

test('INVARIANT: no two agents in a snapshot share a name or an MK tag', async () => {
  const shapes = [];
  for (let i = 0; i < 12; i++) {
    shapes.push(summary(`s${i}`, { originUuid: `u${i % 4}`, lastActivityAt: T0 + i * HOUR }));
  }
  const { registry, dir } = await registryOver(shapes);
  const snap = registry.snapshot();
  const names = snap.agents.map((a) => String(a.label).toLowerCase());
  const tags = snap.agents.map((a) => a.mk);
  assert.equal(new Set(names).size, names.length, `duplicate name in ${names.join(', ')}`);
  assert.equal(new Set(tags).size, tags.length, `duplicate MK in ${tags.join(', ')}`);
  // Four origins, twelve transcripts: four people.
  assert.equal(snap.agents.length, 4);
  await dropRoot(dir);
});

test('a suffix appears ONLY where the base name is genuinely taken', async () => {
  // Every agent here is its own conversation, so every one needs its own name. A suffixed name is
  // only ever legitimate when the unsuffixed one is already worn by somebody else.
  const shapes = [];
  for (let i = 0; i < 30; i++) shapes.push(summary(`u${i}`, { lastActivityAt: T0 + i * HOUR }));
  const { registry, dir } = await registryOver(shapes);
  const snap = registry.snapshot();
  const worn = new Set(snap.agents.map((a) => String(a.givenName).toLowerCase()));
  for (const a of snap.agents) {
    const m = /^(.+) (\d+)$/.exec(String(a.givenName));
    if (!m) continue;
    assert.ok(
      worn.has(m[1].toLowerCase()),
      `${a.givenName} is suffixed but nobody wears "${m[1]}"`,
    );
  }
  await dropRoot(dir);
});

test('IDENTITY: a resume keeps the name and the MK number the user learned', async () => {
  // The first scan sees the original alone and names it.
  const { store, dir } = await freshStore();
  const identity = new Identity(store);
  const first = [summary('old', { originUuid: 'u1', lastActivityAt: T0 })];
  const second = [
    summary('old', { originUuid: 'u1', lastActivityAt: T0 }),
    summary('new', { originUuid: 'u1', lastActivityAt: T0 + HOUR }),
  ];

  let scan = first;
  const adapter = makeAdapter([]);
  adapter.scanSessions = async () => scan;
  const registry = new Registry({ store, adapters: [adapter], identity });
  await registry.refresh();
  const before = registry.snapshot().agents[0];
  assert.ok(before.givenName, 'the first scan names the original');

  // Then the user resumes it.
  scan = second;
  await registry.refresh();
  const after = registry.snapshot().agents;
  assert.equal(after.length, 1);
  assert.equal(after[0].id, agentId('claude-code', 'new'), 'the live transcript is the agent');
  assert.equal(after[0].givenName, before.givenName, 'the first name survived the resume');
  assert.equal(after[0].mk, before.mk, 'the MK number survived the resume');
  assert.equal(after[0].identityId, agentId('claude-code', 'old'));
  await dropRoot(dir);
});

test('IDENTITY: a resume spends no new name from the pool', async () => {
  const { store, dir } = await freshStore();
  const identity = new Identity(store);
  let scan = [summary('old', { originUuid: 'u1', lastActivityAt: T0 })];
  const adapter = makeAdapter([]);
  adapter.scanSessions = async () => scan;
  const registry = new Registry({ store, adapters: [adapter], identity });
  await registry.refresh();
  const spentBefore = identity.takenNames().length;

  scan = [
    summary('old', { originUuid: 'u1', lastActivityAt: T0 }),
    summary('new', { originUuid: 'u1', lastActivityAt: T0 + HOUR }),
    summary('newer', { originUuid: 'u1', lastActivityAt: T0 + 2 * HOUR }),
  ];
  await registry.refresh();
  assert.equal(identity.takenNames().length, spentBefore, 'a resume must cost the pool nothing');
  await dropRoot(dir);
});

test('INVARIANT: collapsing writes no user-owned field, on either member', async () => {
  const { store, dir } = await freshStore();
  const identity = new Identity(store);
  const oldId = agentId('claude-code', 'old');
  // The user benched the original before resuming it. That is his word about that session and it
  // must still be there afterwards, untouched, ready for the day it is seen alone again.
  store.setAck(oldId, { state: 'benched', reviewSince: 4242 });
  const beforeAck = store.getAck(oldId);

  let scan = [summary('old', { originUuid: 'u1', lastActivityAt: T0 })];
  const adapter = makeAdapter([]);
  adapter.scanSessions = async () => scan;
  const registry = new Registry({ store, adapters: [adapter], identity });
  await registry.refresh();

  scan = [
    summary('old', { originUuid: 'u1', lastActivityAt: T0 }),
    summary('new', { originUuid: 'u1', lastActivityAt: T0 + HOUR }),
  ];
  await registry.refresh();

  const afterAck = store.getAck(oldId);
  assert.deepEqual(afterAck, beforeAck, 'the superseded session kept the state the user gave it');
  // And the live one is the user's to bench or not, on its own terms.
  assert.equal(registry.agents[0].ackState, 'active');
  await dropRoot(dir);
});

test('a superseded session reported alive does not walk back onto the floor', async () => {
  const { registry, dir } = await registryOver(
    [
      summary('old', { originUuid: 'u1', lastActivityAt: T0 }),
      summary('new', { originUuid: 'u1', lastActivityAt: T0 + HOUR }),
    ],
    [
      {
        id: agentId('claude-code', 'old'),
        runtime: 'claude-code',
        cwd: 'C:\\Dk\\Projects\\1_1percent_better',
        name: null,
        startedAt: T0,
        pid: 7,
      },
    ],
  );
  assert.deepEqual(
    registry.agents.map((a) => a.id),
    [agentId('claude-code', 'new')],
  );
  await dropRoot(dir);
});

// --------------------------------------------------- D. the untouched cases

test('an adapter that reports no origin at all behaves exactly as before', async () => {
  const { registry, dir } = await registryOver([
    summary('a', { lastActivityAt: T0 }),
    summary('b', { lastActivityAt: T0 + HOUR }),
    summary('c', { lastActivityAt: T0 + 2 * HOUR }),
  ]);
  assert.equal(registry.agents.length, 3);
  for (const a of registry.agents) {
    assert.equal(a.identityId, a.id);
    assert.deepEqual(a.supersedes, []);
  }
  await dropRoot(dir);
});

// ------------------------------------------------------ E. the owner's data

test("REGRESSION: the owner's own two sessions are one agent, one name, one zone", async () => {
  // Read from his machine on 14 September 2026: two transcripts in
  // `~/.claude/projects/C--Dk-Projects-1-1percent-better/`, 1300 shared message uuids, and the
  // same first message record — `3625bd2e-ade5-49dd-96c1-18203ebeab0c`, an `isCompactSummary`
  // user turn timestamped 2026-08-29T05:10:45.063Z. He saw "Greta 2" at a desk and "Sena 3" in
  // the lounge, both titled "Southeast Asia trip planning".
  const ORIGIN = '3625bd2e-ade5-49dd-96c1-18203ebeab0c';
  const GRETA = '5a03e0ea-877e-46f5-bffa-01e258b6a6a9'; // stalled, live, at a desk
  const SENA = '155a04b4-7fea-42e4-8ca2-3587c7b32543'; // ended, in the lounge

  const { registry, dir } = await registryOver([
    summary(SENA, { originUuid: ORIGIN, lastActivityAt: Date.parse('2026-09-14T03:56:56.164Z') }),
    summary(GRETA, {
      originUuid: ORIGIN,
      lastActivityAt: Date.parse('2026-09-14T10:18:27.923Z'),
      lastRole: 'user',
      turnEnded: false,
    }),
  ]);

  const snap = registry.snapshot();
  assert.equal(snap.agents.length, 1, 'one conversation, one agent');
  assert.equal(snap.agents[0].id, agentId('claude-code', GRETA), 'the live transcript wins');
  assert.deepEqual(snap.agents[0].supersedes, [agentId('claude-code', SENA)]);
  assert.equal(new Set(snap.agents.map((a) => placement(a))).size, 1, 'one zone');
  await dropRoot(dir);
});

test("REGRESSION: the owner's four-deep chain in the same room is one agent", async () => {
  // The second chain in `1_1percent_better`, origin `1a0c9e2d-6b47-4ef4-adde-09134fe0e3d9`,
  // timestamped 2026-08-19T17:17:02.899Z: four transcripts, four MK numbers, four names.
  const ORIGIN = '1a0c9e2d-6b47-4ef4-adde-09134fe0e3d9';
  const chain = [
    ['c8ead7c8-158b-410a-8325-7ed7e1ee9b69', '2026-08-19T19:50:29.430Z'], // Otto
    ['cacc0dd3-a20e-48bb-a28c-46d3c0474589', '2026-08-21T18:47:40.783Z'], // Kobe
    ['618d825b-de9e-492e-9301-0ad39cd48e4d', '2026-08-28T07:12:59.229Z'], // Petra
    ['c3a9e7ba-0d41-4898-aef3-e170c4ae0400', '2026-09-10T03:10:15.959Z'], // Tai
  ];
  const { registry, dir } = await registryOver(
    chain.map(([id, at]) => summary(id, { originUuid: ORIGIN, lastActivityAt: Date.parse(at) })),
  );
  assert.equal(registry.agents.length, 1);
  assert.equal(registry.agents[0].id, agentId('claude-code', chain[3][0]));
  assert.equal(registry.agents[0].identityId, agentId('claude-code', chain[0][0]));
  assert.equal(registry.agents[0].supersedes.length, 3);
  await dropRoot(dir);
});
