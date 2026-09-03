/**
 * The command palette's table and its ranking.
 *
 * WP-07 is accepted against one measurable promise: **every action that used
 * to be in the header is reachable in ≤ 2 keystrokes from `⌘K`**. The header
 * had six of them — Show let go, Settle floor, New project, Hooks, Refresh,
 * Enable notifications — and moving them into a fuzzy list is only an
 * improvement if they are still one gesture away. That is what the first two
 * tests here measure, against a populated floor rather than an empty one,
 * because "type r for Refresh" is easy when there is nothing else in the list.
 *
 * Everything imported here is pure: public/palette.js touches the DOM only
 * inside `createPalette`, which this file never calls.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACCEL_BONUS,
  buildCommandEntries,
  buildEntries,
  fuzzyScore,
  legalAckActions,
  rankEntries,
} from '../../public/palette.js';

/** Every action callback the palette can invoke, stubbed and recording. */
function stubActions() {
  /** @type {string[]} */
  const called = [];
  const names = [
    'selectAgent',
    'filterToProject',
    'jumpToProject',
    'showWhiteboard',
    'revealFolder',
    'runDashboard',
    'archiveProject',
    'newAgent',
    'newProject',
    'rename',
    'ack',
    'resume',
    'settleFloor',
    'refresh',
    'openSettings',
    'openHooks',
    'openOnboarding',
    'setNotifications',
    'setSound',
    'toggleLetGoVisible',
  ];
  /** @type {Record<string, Function>} */
  const actions = {};
  for (const name of names) {
    actions[name] = (...args) => called.push(`${name}(${args.join(',')})`);
  }
  return { actions, called };
}

/**
 * A floor with enough on it that ranking has to work: two projects, five
 * agents, names and titles that collide with command words on purpose
 * ("Settle", "Rune", "Refactor the notifier").
 */
function fixture() {
  return {
    settings: { notifications: true, sound: false },
    counts: { needsYou: 3 },
    projects: [
      { id: 'p1', name: 'orbital-api', mk: 'P1', activeCount: 2, archived: false },
      { id: 'p2', name: 'checkout-flow', mk: 'P2', activeCount: 0, archived: false },
      { id: 'p3', name: 'old-thing', mk: 'P3', activeCount: 0, archived: true },
    ],
    agents: [
      {
        id: 'claude-code:a1',
        displayName: 'Ada',
        mk: 'MK1.1',
        title: 'Backfill the events table',
        projectId: 'p1',
        projectName: 'orbital-api',
        ackState: 'active',
        activityState: 'for_review',
      },
      {
        id: 'claude-code:a2',
        displayName: 'Rune',
        mk: 'MK5.1',
        title: 'Refactor the notifier',
        projectId: 'p1',
        projectName: 'orbital-api',
        ackState: 'active',
        activityState: 'needs_input',
      },
      {
        id: 'claude-code:a3',
        displayName: 'Sable',
        mk: 'MK3.2',
        title: 'Settle the migration',
        projectId: 'p2',
        projectName: 'checkout-flow',
        ackState: 'benched',
        activityState: 'for_review',
      },
      {
        id: 'claude-code:a4',
        displayName: 'Wren',
        mk: 'MK2.3',
        title: 'Refresh the token cache',
        projectId: 'p2',
        projectName: 'checkout-flow',
        ackState: 'active',
        activityState: 'working',
      },
      {
        id: 'claude-code:a5',
        displayName: 'Juno',
        mk: 'MK1.4',
        title: 'Notifications for hands up',
        projectId: 'p1',
        projectName: 'orbital-api',
        ackState: 'let_go',
        activityState: 'ended',
      },
    ],
  };
}

/** @param {object} [over] */
function ctx(over = {}) {
  const { actions } = stubActions();
  return { snapshot: fixture(), selectedId: null, letGoVisible: false, actions, ...over };
}

// ---------------------------------------------------------------------------
// The ≤ 2 keystrokes promise
// ---------------------------------------------------------------------------

/**
 * The six the header used to carry, and the accelerator each one answers to.
 * docs/plan/05-GUI-UX-SPEC.md §5.1 lists the header as it was.
 */
const FORMER_HEADER_ACTIONS = [
  { was: 'Show let go', id: 'cmd:show-let-go', accel: 'l' },
  { was: 'Settle floor', id: 'cmd:settle', accel: 's' },
  { was: 'New project', id: 'cmd:new-project', accel: 'p' },
  { was: 'Hooks', id: 'cmd:hooks', accel: 'h' },
  { was: 'Refresh', id: 'cmd:refresh', accel: 'r' },
  { was: 'Enable notifications', id: 'cmd:notifications', accel: 'n' },
];

test('WP-07: every former header action is ≤ 2 keystrokes from the palette', () => {
  // One character, then Enter. Measured against the whole list — agents,
  // projects and every other command — not against the commands alone.
  const entries = buildEntries(ctx({ selectedId: 'claude-code:a1' }));
  for (const { was, id, accel } of FORMER_HEADER_ACTIONS) {
    assert.equal(accel.length, 1, `${was} needs a single-character accelerator`);
    const ranked = rankEntries(entries, accel);
    assert.ok(ranked.length > 0, `nothing matches "${accel}"`);
    assert.equal(
      ranked[0].id,
      id,
      `"${was}" is no longer first for "${accel}" — it costs more than two keystrokes now. ` +
        `First was ${ranked[0].id} (${ranked[0].label}).`,
    );
  }
});

test('the accelerators are unique, so none of them is ambiguous', () => {
  const entries = buildCommandEntries(ctx());
  const accels = entries.map((e) => e.accel).filter(Boolean);
  assert.equal(new Set(accels).size, accels.length, `duplicate accelerator in ${accels.join(' ')}`);
  // Every former header action still has one at all.
  for (const { was, id, accel } of FORMER_HEADER_ACTIONS) {
    const entry = entries.find((e) => e.id === id);
    assert.ok(entry, `${was} has no command entry any more`);
    assert.equal(entry.accel, accel, `${was}'s accelerator moved`);
  }
});

test('an accelerator outranks any fuzzy match, by construction', () => {
  // The bonus has to dominate outright or the promise above is luck. The
  // best conceivable fuzzy score is far below it.
  const entries = buildEntries(ctx());
  const best = Math.max(...entries.map((e) => fuzzyScore('r', e.label) ?? 0));
  assert.ok(best < ACCEL_BONUS / 1000, `a fuzzy score reached ${best}; the accel bonus is thin`);
});

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

test('fuzzyScore matches subsequences and rejects non-matches', () => {
  assert.equal(fuzzyScore('', 'anything'), 0);
  assert.equal(fuzzyScore('zzz', 'orbital-api'), null);
  assert.ok(fuzzyScore('oa', 'orbital-api') !== null);
  assert.ok(fuzzyScore('ORB', 'orbital-api') !== null, 'matching is case-insensitive');
  assert.ok(fuzzyScore('or bit', 'orbital-api') !== null, 'spaces in the query are not literal');
});

test('a contiguous, word-starting match beats a scattered one', () => {
  const tight = fuzzyScore('orb', 'orbital-api');
  const loose = fuzzyScore('orb', 'other rendering barn');
  assert.ok(tight > loose, `${tight} should beat ${loose}`);
});

test('typing a name finds that agent first', () => {
  const entries = buildEntries(ctx());
  const ranked = rankEntries(entries, 'rune');
  assert.equal(ranked[0].id, 'agent:claude-code:a2');
});

test('an agent is findable by MK tag, title and project', () => {
  const entries = buildEntries(ctx());
  for (const query of ['mk5.1', 'refactor', 'notifier']) {
    const ranked = rankEntries(entries, query);
    assert.equal(ranked[0].id, 'agent:claude-code:a2', `"${query}" did not find Rune first`);
  }
  const byProject = rankEntries(entries, 'checkout').map((e) => e.id);
  assert.ok(
    byProject.some((id) => id === 'agent:claude-code:a4'),
    'a project name does not reach its agents',
  );
});

test('an empty query keeps the section order: selection, commands, agents, projects', () => {
  const entries = buildEntries(ctx({ selectedId: 'claude-code:a1' }));
  const groups = [];
  for (const e of entries) if (groups[groups.length - 1] !== e.group) groups.push(e.group);
  assert.deepEqual(groups, ['selection', 'command', 'agent', 'project']);
  assert.deepEqual(rankEntries(entries, '').slice(0, 3), entries.slice(0, 3));
});

// ---------------------------------------------------------------------------
// What the table actually offers
// ---------------------------------------------------------------------------

test('let-go agents are out of the list until the view toggle is on', () => {
  const hidden = buildEntries(ctx()).map((e) => e.id);
  assert.ok(!hidden.includes('agent:claude-code:a5'), 'a let-go agent is listed by default');
  const shown = buildEntries(ctx({ letGoVisible: true })).map((e) => e.id);
  assert.ok(
    shown.includes('agent:claude-code:a5'),
    'the view toggle does not reveal let-go agents',
  );
});

test('the show-let-go command is a view toggle, and says which way it is', () => {
  const off = buildCommandEntries(ctx()).find((e) => e.id === 'cmd:show-let-go');
  const on = buildCommandEntries(ctx({ letGoVisible: true })).find(
    (e) => e.id === 'cmd:show-let-go',
  );
  assert.equal(off.label, 'Show let-go agents');
  assert.equal(on.label, 'Hide let-go agents');
  const { actions, called } = stubActions();
  buildCommandEntries({ ...ctx(), actions })
    .find((e) => e.id === 'cmd:show-let-go')
    .run();
  assert.deepEqual(called, ['toggleLetGoVisible()']);
});

test('the notification and sound commands name the state they will move to', () => {
  const soundOff = buildCommandEntries(ctx()).find((e) => e.id === 'cmd:sound');
  assert.equal(soundOff.label, 'Sound — turn on');
  const soundOn = buildCommandEntries({
    ...ctx(),
    snapshot: { ...fixture(), settings: { sound: true, notifications: false } },
  });
  assert.equal(soundOn.find((e) => e.id === 'cmd:sound').label, 'Sound — turn off');
  assert.equal(soundOn.find((e) => e.id === 'cmd:notifications').label, 'Notifications — turn on');
});

test('every project carries jump, filter, whiteboard, reveal, run and a new agent', () => {
  const ids = buildEntries(ctx()).map((e) => e.id);
  for (const verb of ['jump', 'filter', 'board', 'reveal', 'run', 'new-agent']) {
    assert.ok(ids.includes(`proj:${verb}:p1`), `orbital-api has no "${verb}" entry`);
  }
});

test('"+ New agent" with nothing selected lands on the project picker, not on itself', () => {
  // The header button opens the palette pre-typed with this query when it has
  // no project in context. If the generic "New agent" command out-ranked the
  // per-project rows, pressing Enter would re-open the palette on the same
  // query for ever.
  const ranked = rankEntries(buildEntries(ctx()), 'new agent in ');
  assert.match(ranked[0].id, /^proj:new-agent:/, `first row was ${ranked[0].id}`);
  assert.match(ranked[1].id, /^proj:new-agent:/, `second row was ${ranked[1].id}`);
});

test('a room is archivable only when nobody is working in it', () => {
  const ids = buildEntries(ctx()).map((e) => e.id);
  // p1 has two active agents: archiving it would be a lie, so it is not offered.
  assert.ok(!ids.includes('proj:archive:p1'));
  assert.ok(ids.includes('proj:archive:p2'), 'an idle room cannot be archived');
  assert.ok(ids.includes('proj:restore:p3'), 'an archived room cannot be restored');
});

test('with nothing selected there are no actions on the selection', () => {
  assert.equal(buildEntries(ctx()).filter((e) => e.group === 'selection').length, 0);
});

test('the selection offers its legal ack actions, resume, rename and a new agent', () => {
  const entries = buildEntries(ctx({ selectedId: 'claude-code:a1' })).filter(
    (e) => e.group === 'selection',
  );
  const ids = entries.map((e) => e.id);
  // a1 is for_review and active: acknowledge, bench, let go — never "mark for
  // review", which it already is.
  assert.deepEqual(ids.filter((id) => id.startsWith('sel:')).slice(0, 3), [
    'sel:acknowledge',
    'sel:bench',
    'sel:let_go',
  ]);
  for (const id of ['sel:resume-terminal', 'sel:resume-app', 'sel:rename', 'sel:new-agent-here']) {
    assert.ok(ids.includes(id), `${id} is missing`);
  }
  // The label names the agent, so a row read out of context still says who.
  assert.match(entries[0].label, /Ada/);
});

test('a benched agent is offered recall and let go, and nothing that would be illegal', () => {
  const ids = buildEntries(ctx({ selectedId: 'claude-code:a3' }))
    .filter((e) => e.id.startsWith('sel:') && !e.id.startsWith('sel:resume'))
    .map((e) => e.id);
  assert.deepEqual(ids, ['sel:recall', 'sel:let_go', 'sel:rename', 'sel:new-agent-here']);
});

test('legalAckActions matches docs/02-ARCHITECTURE.md §5.1, the same table panel.js uses', () => {
  // palette.js keeps its own copy of this rule (it cannot import panel.js,
  // which reaches localStorage at module scope). Pinning the table here is
  // what stops the two copies drifting in silence.
  assert.deepEqual(legalAckActions(null), []);
  assert.deepEqual(legalAckActions({ ackState: 'let_go' }), ['rehire']);
  assert.deepEqual(legalAckActions({ ackState: 'benched' }), ['recall', 'let_go']);
  assert.deepEqual(legalAckActions({ ackState: 'active', activityState: 'working' }), [
    'review',
    'bench',
    'let_go',
  ]);
  assert.deepEqual(legalAckActions({ ackState: 'active', activityState: 'needs_input' }), [
    'acknowledge',
    'review',
    'bench',
    'let_go',
  ]);
  assert.deepEqual(legalAckActions({ ackState: 'active', activityState: 'for_review' }), [
    'acknowledge',
    'bench',
    'let_go',
  ]);
});

test('running an entry calls exactly one action, and the ack action goes through the panel', () => {
  const { actions, called } = stubActions();
  const entries = buildEntries({
    snapshot: fixture(),
    selectedId: 'claude-code:a1',
    letGoVisible: false,
    actions,
  });
  entries.find((e) => e.id === 'sel:acknowledge').run();
  entries.find((e) => e.id === 'cmd:settle').run();
  entries.find((e) => e.id === 'proj:reveal:p1').run();
  assert.deepEqual(called, ['ack(acknowledge)', 'settleFloor()', 'revealFolder(p1)']);
});

test('the palette survives an empty machine', () => {
  const entries = buildEntries({
    snapshot: null,
    selectedId: null,
    letGoVisible: false,
    actions: stubActions().actions,
  });
  assert.ok(entries.length > 0, 'the commands must still be there with no floor');
  assert.ok(entries.every((e) => e.group === 'command'));
  assert.equal(rankEntries(entries, 'zzzzz').length, 0);
});
