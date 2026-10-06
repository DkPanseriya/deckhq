/**
 * THE LOUNGE'S CAP, AND ITS CHIP (`plan-proportions.js` (g)).
 *
 * On the owner's floor seventy-nine resting sessions stood in one row sixty
 * figures long, across a lounge that had grown to 40% of the building to hold
 * them. The lounge now draws its seats and ONE standing row, as many as its
 * width holds; everybody past that is `+N resting` on a chip at the end of the
 * row, and a row each in the deck's Resting tab, which is what the chip opens.
 *
 * Nobody is hidden from the deck, and nobody is lost from a count: the people
 * behind the chip are still on the lounge's plate and in the header.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LARGE_NOW, ownerShapedFloor, populationFloor } from '../helpers/large-floor.mjs';
import { buildPlan } from '../../public/render/plan.js';
import { assignSeats } from '../../public/render/agents.js';
import { buildLounge, LOUNGE_CHIP_ZONE } from '../../public/render/plan-service.js';
import { restingChipLine } from '../../public/render/plan-plate.js';
import { LOUNGE_AREA_MAX, LOUNGE_STANDING_ROWS } from '../../public/render/plan-proportions.js';
import { behindTheChip, restingAgentsOf, restingOrder } from '../../public/floor-resting.js';
import { placement } from '../../public/floor-rule.js';
import { renderRestingTable } from '../../public/deck.js';
import { counts } from '../../src/core/model.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (/** @type {string} */ file) =>
  fs.readFileSync(path.resolve(HERE, '../../public', file), 'utf8');

const STAGE = { w: 2000, h: 1055 };
const planOf = (/** @type {{projects:any[], agents:any[]}} */ floor, stage = STAGE) =>
  buildPlan(floor.projects, floor.agents, { stage, now: LARGE_NOW });

// ------------------------------------------------------------ the room itself

test('the lounge lays one standing row, however many it is asked to hold', () => {
  assert.equal(LOUNGE_STANDING_ROWS, 1);
  for (const count of [0, 5, 20, 79, 300]) {
    const built = buildLounge(count, { w: 60, h: 0 });
    const standing = built.loungeSpots.filter((sp) => sp.kind === 'chat');
    const rows = new Set(standing.map((sp) => sp.y.toFixed(2)));
    assert.ok(rows.size <= 1, `${count} resting: ${rows.size} standing rows`);
    const places = built.loungeSpots.reduce((a, sp) => a + (sp.capacity ?? 1), 0);
    assert.equal(
      places + built.behindChip,
      Math.max(count, places),
      `${count} resting: ${places} places and ${built.behindChip} behind the chip`,
    );
    // The chip has a place exactly where there is somebody behind it.
    const chip = built.room.zones.find((z) => z.id === LOUNGE_CHIP_ZONE);
    assert.equal(Boolean(chip), built.behindChip > 0, `${count} resting`);
    // And it stands inside the room, clear of the people in the row.
    if (chip) {
      assert.ok(chip.x >= 0 && chip.x + chip.w <= built.room.w + 1e-6, 'the chip leaves the room');
      for (const sp of standing) assert.ok(sp.x < chip.x, 'somebody stands under the chip');
    }
  }
});

test('a lounge of three hundred is the size of a lounge of eighty', () => {
  const eighty = buildLounge(80, { w: 60, h: 0 }).room.natural;
  const many = buildLounge(300, { w: 60, h: 0 }).room.natural;
  assert.deepEqual(many, eighty, 'a crowd made the lounge bigger');
});

test('a lounge held to fewer games tables lays fewer, and keeps its sofas', () => {
  const all = buildLounge(79, { w: 60, h: 0 });
  const none = buildLounge(79, { w: 60, h: 0 }, 0, 1, { maxGames: 0 });
  assert.ok(all.games > 0 && none.games === 0);
  const kinds = (/** @type {any} */ b) =>
    new Set(b.room.props.map((/** @type {any} */ p) => p.kind));
  assert.ok(kinds(all).has('pool_table') && !kinds(none).has('pool_table'));
  assert.ok(kinds(none).has('sofa') && kinds(none).has('counter'));
  assert.ok(none.behindChip > all.behindChip, 'the people a table seated are behind the chip');
});

// ------------------------------------------------------------------ the words

test('the chip says how many, and says nothing for nobody', () => {
  assert.equal(restingChipLine(37), '+37 resting');
  assert.equal(restingChipLine(1), '+1 resting');
  assert.equal(restingChipLine(0), '');
  assert.equal(restingChipLine(-3), '');
  assert.equal(restingChipLine(NaN), '');
});

// --------------------------------------------------------- who is behind it

test('resting is most recent first, and the chip takes the longest-rested', () => {
  const at = (/** @type {string} */ id, /** @type {number} */ t, over = {}) => ({
    id,
    ackState: 'active',
    activityState: 'ended',
    lastActivityAt: t,
    ...over,
  });
  const agents = [
    at('c', 300),
    at('a', 100),
    at('working', 900, { activityState: 'working' }),
    at('b2', 200),
    at('b1', 200),
    at('benched', 50, { ackState: 'benched' }),
    at('gone', 999, { ackState: 'let_go' }),
    at('hidden', 500),
  ];
  const order = restingOrder(agents, new Set(['hidden'])).map((a) => a.id);
  assert.deepEqual(order, ['c', 'b1', 'b2', 'a', 'benched']);
  assert.deepEqual([...behindTheChip(agents, new Set(['hidden']), 3)].sort(), ['a', 'benched']);
  assert.equal(behindTheChip(agents, new Set(), 99).size, 0);
});

test('crowded: the lounge draws its seats and a row, and the rest are a number', () => {
  const floor = ownerShapedFloor();
  const plan = planOf(floor);
  const chip = plan.loungeOverflow;
  assert.ok(chip && chip.count > 0, 'seventy-nine resting and no chip');
  const places = plan.loungeSpots.reduce((a, sp) => a + (sp.capacity ?? 1), 0);
  assert.equal(places + chip.count, 79, `${places} drawn and ${chip.count} behind the chip`);
  assert.equal(chip.ids.size, chip.count);

  // Everybody behind it is in the lounge, on the floor's books, and not drawn.
  const seats = assignSeats(plan, floor.agents);
  for (const id of chip.ids) {
    const agent = floor.agents.find((a) => a.id === id);
    assert.equal(placement(agent), 'lounge');
    assert.ok(!plan.hidden.has(id), `${id} is hidden as well as behind the chip`);
    assert.ok(!seats.has(id), `${id} is behind the chip and was given a seat`);
  }
  // Everybody else in the lounge has a place of their own.
  const drawn = floor.agents.filter((a) => seats.has(a.id) && placement(a) === 'lounge');
  assert.equal(drawn.length, places);
  // The ones drawn rested more recently than every one who is not.
  const newest = Math.max(
    ...[...chip.ids].map((id) => floor.agents.find((a) => a.id === id).lastActivityAt),
  );
  const oldest = Math.min(...drawn.map((a) => a.lastActivityAt));
  assert.ok(oldest >= newest, 'somebody behind the chip rested more recently than somebody drawn');

  // The chip stands inside the lounge.
  const lounge = plan.rooms.find((r) => r.kind === 'lounge');
  assert.ok(
    chip.x >= lounge.x &&
      chip.x + chip.w <= lounge.x + lounge.w + 1e-6 &&
      chip.y >= lounge.y &&
      chip.y + chip.h <= lounge.y + lounge.h + 1e-6,
    'the chip is outside the lounge',
  );
});

test('nobody is lost from a count: the plate and the header still say seventy-nine', () => {
  const floor = ownerShapedFloor();
  const plan = planOf(floor);
  const lounge = plan.rooms.find((r) => r.kind === 'lounge');
  assert.equal(lounge.plateLines[1], '79 resting · 28 went home');
  const c = counts(floor.agents, { now: LARGE_NOW, goneHomeDays: 7 });
  assert.equal(c.drawn.lounge, 79, 'the header counts everybody the lounge holds');
  // And the deck's Resting tab lists exactly those seventy-nine.
  const resting = restingAgentsOf(
    { projects: floor.projects, agents: floor.agents },
    { now: LARGE_NOW },
  );
  assert.equal(resting.length, 79);
  const listed = new Set(resting.map((a) => a.id));
  for (const id of plan.loungeOverflow.ids) assert.ok(listed.has(id), `${id} is not in the deck`);
});

test('the lounge is never past a quarter of the building, with five resting or three hundred', () => {
  const floor = ownerShapedFloor();
  const extra = Array.from({ length: 220 }, (_, i) => ({
    ...floor.agents.find((a) => a.activityState === 'ended'),
    id: `more-${i}`,
    lastActivityAt: LARGE_NOW - (i + 5) * 60_000,
  }));
  const crowd = { projects: floor.projects, agents: [...floor.agents, ...extra] };
  for (const [name, f] of [
    ['crowded', floor],
    ['three hundred', crowd],
    ['demo', populationFloor('demo')],
  ]) {
    for (const stage of [STAGE, { w: 1366, h: 638 }, { w: 1600, h: 870 }]) {
      const plan = planOf(/** @type {any} */ (f), stage);
      const lounge = plan.rooms.find((r) => r.kind === 'lounge');
      const share = (lounge.w * lounge.h) / (plan.width * plan.height);
      assert.ok(
        share <= LOUNGE_AREA_MAX + 1e-6,
        `${name} at ${stage.w}x${stage.h}: the lounge is ${(share * 100).toFixed(1)}%`,
      );
    }
  }
  // Two hundred and twenty more people in the lounge do not move a wall.
  const a = planOf(floor);
  const b = planOf(crowd);
  assert.equal(b.width, a.width);
  assert.equal(b.height, a.height);
  assert.equal(b.loungeOverflow.count, a.loungeOverflow.count + 220);
});

test('a floor whose lounge seats everybody has no chip', () => {
  for (const name of ['demo', 'three', 'crew']) {
    const plan = planOf(populationFloor(name));
    assert.equal(plan.loungeOverflow, null, `${name} drew a chip`);
  }
});

// -------------------------------------------------------------- the deck's tab

class StubNode {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    /** @type {StubNode[]} */
    this.children = [];
    this.className = '';
    /** @type {Record<string,string>} */
    this.attrs = {};
    /** @type {string|null} */
    this._text = null;
  }
  appendChild(/** @type {StubNode} */ child) {
    this.children.push(child);
    return child;
  }
  setAttribute(/** @type {string} */ name, /** @type {unknown} */ value) {
    this.attrs[name] = String(value);
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }
  get textContent() {
    if (this._text !== null) return this._text;
    return this.children.map((c) => c.textContent).join('');
  }
}
const doc = { createElement: (/** @type {string} */ tag) => new StubNode(tag) };
const all = (/** @type {StubNode} */ node, /** @type {StubNode[]} */ out = []) => {
  out.push(node);
  for (const c of node.children) all(c, out);
  return out;
};

test('the Resting tab is a row a person, in the order it is handed, and says "Resting"', () => {
  const floor = ownerShapedFloor();
  const resting = restingAgentsOf(
    { projects: floor.projects, agents: floor.agents },
    { now: LARGE_NOW },
  );
  const table = renderRestingTable(resting, { now: LARGE_NOW, selectedId: null }, doc);
  const rows = all(table).filter((n) => n.className.split(' ').includes('deck-row'));
  assert.equal(rows.length, 79);
  assert.deepEqual(
    rows.map((r) => r.attrs['data-id']),
    resting.map((a) => String(a.id)),
  );
  const heads = all(table)
    .filter((n) => n.tagName === 'TH' && n.attrs.scope === 'col')
    .map((n) => n.textContent);
  assert.equal(heads[0], 'Resting');
  assert.ok(!heads.includes('Waiting'));
  assert.equal(renderRestingTable([], { now: LARGE_NOW }, doc).children.length, 3);
});

test('a click on the chip opens the deck on the people resting', () => {
  // The chip is canvas, so its route is read off the source it runs through:
  // the scene reports it, the app routes it, the deck opens on its tab.
  const hit = read('render/scene-hit.js');
  assert.match(hit, /'whiteboard',\s*'resting',/, 'the chip is not hit-tested');
  assert.match(read('render/scene-labels.js'), /kind: 'resting', id: '__lounge__'/);
  assert.match(read('render/scene-draw.js'), /this\._drawLoungeChip\(camera\);/);
  const app = read('app.js');
  assert.match(app, /'screen', 'resting'\]/, 'the app drops the chip as an unknown hit');
  assert.match(app, /openResting: \(\) => deckUI\?\.openResting\(\)/);
  assert.match(app, /getResting: \(\) => restingAgentsOf\(latestSnapshot/);
  assert.match(read('app-floor.js'), /if \(sel\.kind === 'resting'\) return openResting\(\);/);
  const deck = read('deck.js');
  assert.match(deck, /function openResting\(\) \{\s*setTab\('resting'\);\s*open\(\);/);
  assert.match(read('index.html'), /id="deck-tab-resting"[\s\S]*?data-tab="resting"/);
  // And the tab is a read like the queue: a row opens a session, nothing more.
  const paint = deck.slice(
    deck.indexOf('function paintResting()'),
    deck.indexOf('function setTab('),
  );
  assert.match(paint, /onSelect\(id, \{ openPanel: true \}\)/);
  assert.doesNotMatch(paint, /fetch\(/);
});
