/**
 * WHAT HANGS ROUND A FIGURE BELONGS TO SOMEBODY WHO IS THERE (11 October).
 *
 * Three things the product's own captures showed, each on the population that
 * showed it (`scripts/capture-posts.mjs`):
 *
 *   - `crew.juniors-laptops`: a junior's thought cloud was withheld by the box
 *     kept for its lead's `+N` chip, on a crew that draws no chip;
 *   - `crew.lead-supervises`: after the juniors had gone, a `+2` and one
 *     junior's name stayed over the empty desk until the next snapshot;
 *   - `need.office`: a tool bubble was set across the name of the figure
 *     sitting beside it.
 *
 * Asked of the real plan, the real seats and the frame's own label pass
 * (`test/helpers/label-frame.mjs`), through a context that only measures.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { LARGE_NOW, populationFloor } from '../helpers/large-floor.mjs';
import { frameAt } from '../helpers/label-frame.mjs';
import { paintRecorder } from '../helpers/paint-recorder.mjs';
import { fakeId } from '../../scripts/demo-write.mjs';
import { AgentRuntime, assignSeats } from '../../public/render/agents.js';
import { drawCrews } from '../../public/render/crew-draw.js';
import { LIFE } from '../../public/render/life.js';
import { drawLabel } from '../../public/render/rig.js';
import { planFrameLabels } from '../../public/render/scene-frame-labels.js';
import { PALETTE } from '../../public/render/palette.js';

/**
 * A demo population under the ids the demo floor gives it (`fakeId`, counted
 * from one). A chair is dealt by the session's id, so only under its own id
 * does somebody sit where the capture shows them.
 * @param {string} name a key of `POPULATIONS`
 */
function demoFloor(name) {
  const floor = populationFloor(name);
  const ids = new Map();
  floor.agents.forEach((a, i) => {
    if (a.subagent !== true) ids.set(a.id, `claude-code:${fakeId(i + 1)}`);
  });
  for (const a of floor.agents) {
    if (ids.has(a.id)) a.id = ids.get(a.id);
    if (a.parentId && ids.has(a.parentId)) a.parentId = ids.get(a.parentId);
  }
  return floor;
}

/**
 * Every plate `drawCrews` paints for this frame — a crew's chip, or the name of
 * a lead that is away from its desk — as the rectangle it filled and its text.
 * @param {any} f a frame from `frameAt` @param {boolean} reduced
 * @returns {{x:number, y:number, w:number, h:number, text:string}[]}
 */
function platesDrawn(f, reduced) {
  /** @type {any[]} */
  const plates = [];
  const target = { globalAlpha: 1, fillStyle: '', font: f.ctx.font };
  const ctx = new Proxy(target, {
    get(t, key) {
      if (key in t) return t[key];
      if (key === 'measureText') return (text) => f.ctx.measureText.call(t, text);
      if (key === 'fillRect')
        return (x, y, w, h) => {
          if (t.fillStyle === PALETTE.plateHalo) plates.push({ x, y, w, h, text: '' });
        };
      if (key === 'fillText')
        return (text) => {
          if (plates.length && !plates[plates.length - 1].text)
            plates[plates.length - 1].text = String(text);
        };
      return () => {};
    },
    set(t, key, value) {
      t[key] = value;
      return true;
    },
  });
  drawCrews(ctx, {
    records: f.records,
    agentsById: f.agentsById,
    camera: f.camera,
    scale: f.scale,
    charU: f.charU,
    lod: f.lod,
    reduced,
    pinned: 0,
    nowMs: LARGE_NOW,
    crewCounts: f.crewCounts,
    seatOf: (id) => f.seats.get(id) || null,
  });
  return plates;
}

// ----------------------------------------- 1 · a box is kept for what is drawn

test('two juniors beside their lead both have a thought cloud: no box is kept for a chip nobody draws', () => {
  // `crew.juniors-laptops`: 1600 x 1000, closed in two and a half times.
  for (const zoom of [1, 2.5]) {
    const f = frameAt(1600, 869, () => demoFloor('juniors'), { badges: true, zoom });
    const lead = f.records.find((rec) => rec.agent.subagent !== true);
    const juniors = f.records.filter((rec) => rec.agent.subagent === true);
    assert.equal(juniors.length, 2);
    // The capture's arrangement: the lead on the near side of its desk, with
    // its back to the two on the carpet behind it.
    assert.ok(
      juniors.every((rec) => rec.y > lead.y),
      'the juniors sit below their lead',
    );
    assert.deepEqual(platesDrawn(f, false), [], 'two juniors are under the cap: no chip');
    assert.deepEqual(
      f.labels.obstacles.filter((o) => /^chip:/.test(o.id)).map((o) => o.id),
      [],
      'and so no box is kept for one',
    );
    for (const rec of juniors) {
      assert.notEqual(f.labels.clouds.get(rec.id), 0, `zoom ${zoom}: ${rec.agent.label} has none`);
    }
  }
});

test('a box is kept for every crew chip that is drawn, where it is drawn, and for no other', () => {
  const holds = (box, p) =>
    box.x <= p.x + 0.01 &&
    box.y <= p.y + 0.01 &&
    box.x + box.w >= p.x + p.w - 0.01 &&
    box.y + box.h >= p.y + p.h - 0.01;
  let chips = 0;
  for (const name of ['juniors', 'lead', 'demo', 'crew', 'crew-waiting', 'large']) {
    for (const reduced of [false, true]) {
      const f = frameAt(1600, 869, () => populationFloor(name), { badges: true, reduced });
      const boxes = f.labels.obstacles.filter((o) => /^chip:/.test(o.id));
      // A chip is `+N`, or under reduced motion `W/T working`; the other plate
      // this painter draws is the name of a lead away from its desk.
      const drawn = platesDrawn(f, reduced).filter((p) => /^\+\d+|working$/.test(p.text));
      const where = `${name}${reduced ? ', reduced motion' : ''}`;
      assert.equal(boxes.length, drawn.length, `${where}: boxes kept and chips drawn`);
      for (const p of drawn) {
        const box = boxes.find((b) => holds(b, p));
        assert.ok(box, `${where}: no box holds the chip "${p.text}"`);
        // Never more than the chip at its longest: every member working.
        assert.ok(box.h <= p.h + 0.01 && box.w <= p.w * 1.5, `${where}: the box is a chip's`);
      }
      chips += drawn.length;
      // Reduced motion gives every formation a chip; with motion, only a crew
      // over the cap has one.
      if (!reduced)
        assert.ok(
          drawn.every((p) => /^\+\d+$/.test(p.text)),
          where,
        );
    }
  }
  assert.ok(chips >= 6, `these floors draw chips: ${chips}`);
});

// ------------------------------------- 2 · nothing is left of somebody who went

/** The `lead` floor's four records, held by a runtime the way the scene holds them. */
function leadRuntime() {
  const f = frameAt(1600, 869, () => demoFloor('lead'), { badges: true });
  const runtime = new AgentRuntime();
  runtime.sync(f.agents, f.plan, f.seats, { now: LARGE_NOW });
  const stay = f.agents.filter((a) => a.subagent !== true);
  return { f, runtime, stay, seats: assignSeats(f.plan, stay) };
}

test('a figure that has folded away is gone when the clock says so, with no snapshot to say it', () => {
  // `crew.lead-supervises`: the three juniors end, and nothing else on the
  // floor changes afterwards, so no snapshot follows the one they left in.
  const { f, runtime, stay, seats } = leadRuntime();
  assert.equal(runtime.size, f.agents.length);
  const left = LARGE_NOW + 100;
  runtime.sync(stay, f.plan, seats, { now: left });
  assert.equal(runtime.size, f.agents.length, 'three figures folding away');
  const fold = LIFE.despawn.period * 1000;
  runtime.step(0.04, { plan: f.plan, now: left + fold - 1 });
  assert.equal(runtime.size, f.agents.length, 'kept for the whole of the fold');
  runtime.step(0.04, { plan: f.plan, now: left + fold });
  assert.deepEqual(
    [...runtime.all()].map((rec) => rec.id).sort(),
    stay.map((a) => a.id).sort(),
    'a record outlived its figure',
  );
  // A caller with no clock to give collects nothing here, as it never did.
  const other = leadRuntime();
  other.runtime.sync(other.stay, other.f.plan, other.seats, { now: left });
  other.runtime.step(0.04, { plan: other.f.plan });
  assert.equal(other.runtime.size, other.f.agents.length);
});

test('a crew’s chip counts the members who are there: none left, no chip, and no box for one', () => {
  const { f, runtime, stay, seats } = leadRuntime();
  runtime.sync(stay, f.plan, seats, { now: LARGE_NOW + 100 });
  // The frame while they fold: every junior's record is still held, on the
  // crew seat it was last given, and that seat still says "three at this desk".
  const records = [...runtime.all()].sort((a, b) => a.y - b.y);
  const going = records.filter((rec) => typeof rec.leftAt === 'number');
  assert.equal(going.length, 3);
  assert.ok(going.every((rec) => rec.targetSeat.crew === true && rec.targetSeat.crewTotal === 3));
  const agentsById = new Map(stay.map((a) => [a.id, a]));
  const crewCounts = new Map();
  // One of the three alone, as the capture had it: `+2` over an empty desk.
  for (const some of [going, going.slice(0, 1)]) {
    const frame = { ...f, records: [...records.filter((r) => !going.includes(r)), ...some] };
    const drawn = platesDrawn({ ...frame, agentsById, crewCounts }, false);
    assert.deepEqual(drawn, [], `${some.length} folding away: ${drawn.map((p) => p.text)}`);
    const labels = planFrameLabels(f.ctx, { ...f.view, records: frame.records, agentsById });
    assert.deepEqual(
      labels.obstacles.filter((o) => /^chip:/.test(o.id)),
      [],
    );
  }
});

test('a name on a leader fades with the figure it names', () => {
  const ctx = paintRecorder();
  ctx.globalAlpha = 0.25;
  drawLabel(ctx, 100, 100, 20, 'Femi', 0, -40, { leader: true, role: 'Junior' });
  const line = ctx.paints.find((p) => p.op === 'stroke');
  assert.ok(line, 'the leader is drawn');
  assert.ok(Math.abs(line.alpha - 0.25 * 0.55) < 1e-9, `the leader at ${line.alpha}`);
  const after = ctx.paints.slice(ctx.paints.indexOf(line) + 1);
  assert.ok(after.some((p) => p.op === 'fillText' && p.args[0] === 'Femi'));
  for (const p of after) assert.equal(p.alpha, 0.25, `${p.op} ${p.args[0]} at ${p.alpha}`);
  assert.equal(ctx.globalAlpha, 0.25, 'and the context is handed back as it came');
});
