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
import { drawnBox, frameAt, hits, measuringCtx } from '../helpers/label-frame.mjs';
import { paintRecorder } from '../helpers/paint-recorder.mjs';
import { fakeId } from '../../scripts/demo-write.mjs';
import { AgentRuntime, assignSeats, worldToScreen } from '../../public/render/agents.js';
import { BUBBLE_CLEAR_PX, BUBBLE_STEP, placeBubbles } from '../../public/render/bubble-spots.js';
import { toolBubbleBox } from '../../public/render/rig-bubble.js';
import { drawCrews } from '../../public/render/crew-draw.js';
import { LIFE } from '../../public/render/life.js';
import { drawCharacter, drawLabel } from '../../public/render/rig.js';
import { sampleClip } from '../../public/render/clips.js';
import { planFrameLabels } from '../../public/render/scene-frame-labels.js';
import { PALETTE, STATE_COLORS } from '../../public/render/palette.js';

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

// ------------------------------------------ 3 · a tool bubble yields to a name

/** What a cloud or a bubble may not cover: every name set, every badge, pill and chip. */
function takenOf(f) {
  const names = f.labels.labels
    .filter((it) => f.labels.plan.get(it.id))
    .map((it) => drawnBox(it, f.labels.plan.get(it.id)));
  return [...names, ...f.labels.obstacles.filter((o) => /^(badge|pill|chip):/.test(o.id))];
}

/** The box a figure's bubble is drawn in, where the pass set it. */
function bubbleAt(f, rec, spot) {
  const s = worldToScreen(rec, f.camera);
  const box = toolBubbleBox(f.ctx, s.x, s.y, f.uOf(rec), spot.text);
  return { ...box, x: box.x + spot.dx };
}

/** A demo floor with every working session in the middle of a tool call. */
function busyFloor(name, summary = 'Bash npm test') {
  const floor = demoFloor(name);
  for (const a of floor.agents) {
    if (a.ackState === 'active' && a.activityState === 'working')
      a.currentTool = { name: 'Bash', summary };
  }
  return floor;
}

test('`need.office`: the bubble over the session running `npm test` is clear of its neighbour’s name', () => {
  const f = frameAt(1600, 900, () => busyFloor('pair'), { badges: true });
  const rec = f.records.find((r) => r.agent.title === 'Rate limiter for the public API');
  const s = worldToScreen(rec, f.camera);
  const taken = takenOf(f);
  const natural = toolBubbleBox(f.ctx, s.x, s.y, f.uOf(rec), 'Bash npm test');
  const under = taken.find((t) => hits(natural, t));
  assert.ok(under && under.id !== rec.id, 'centred over its head, it is over somebody else’s name');
  const spot = f.labels.bubbles.get(rec.id);
  assert.ok(spot, 'it is drawn: there is room beside the name');
  assert.equal(spot.text, 'Bash npm test', 'and whole: a step aside was enough');
  assert.notEqual(spot.dx, 0);
  const box = bubbleAt(f, rec, spot);
  assert.equal(taken.find((t) => hits(box, t))?.id, undefined);
  // Still over its own head: the head's centre line is under the bubble.
  assert.ok(box.x <= s.x + 0.01 && box.x + box.w >= s.x - 0.01, 'the bubble left its figure');
});

test('no tool bubble is over a name, a role chip, a wait badge or a crew chip', () => {
  const seen = { natural: 0, aside: 0, shorter: 0, none: 0, wouldCover: 0 };
  for (const name of ['pair', 'crew', 'demo', 'crowded']) {
    for (const [w, h, zoom] of [
      [1420, 690, 1],
      [1600, 900, 1],
      [2000, 1024, 1],
      [1600, 900, 2.5],
    ]) {
      const long = 'Edit src/render/scene-frame-labels.js';
      for (const summary of ['Bash npm test', long]) {
        const f = frameAt(w, h, () => busyFloor(name, summary), { badges: true, zoom });
        if (f.lod < 1) continue;
        const taken = takenOf(f);
        for (const rec of f.records) {
          const s = worldToScreen(rec, f.camera);
          const spot = f.labels.bubbles.get(rec.id);
          if (!rec.agent.currentTool) {
            assert.equal(spot, undefined, `${rec.id} has no tool and is given a bubble`);
            continue;
          }
          const natural = toolBubbleBox(f.ctx, s.x, s.y, f.uOf(rec), summary);
          // "In its way" is on it or within the floor a bubble keeps clear.
          const c = BUBBLE_CLEAR_PX;
          const reach = { x: natural.x - c, y: natural.y - c, w: natural.w + c * 2 };
          const covers = taken.some((t) => hits({ ...reach, h: natural.h + c * 2 }, t));
          if (covers) seen.wouldCover++;
          const where = `${name} ${w}x${h} x${zoom}: ${rec.agent.label}`;
          if (spot === null) {
            assert.ok(covers, `${where} has no bubble and nothing in its way`);
            seen.none++;
            continue;
          }
          // Where nothing is in its way, nothing about it changes.
          if (!covers) assert.deepEqual(spot, { dx: 0, text: natural.text }, where);
          const box = bubbleAt(f, rec, spot);
          const over = taken.find((t) => hits(box, t));
          assert.equal(over, undefined, `${where}: its bubble is over ${over?.id}`);
          // Never farther than the other side of the head, and never a longer line.
          assert.ok(box.x <= s.x + 0.01 && box.x + box.w >= s.x - 0.01, `${where} left its head`);
          assert.ok(box.w <= natural.w + 0.01, where);
          if (spot.text !== natural.text) seen.shorter++;
          else if (spot.dx !== 0) seen.aside++;
          else seen.natural++;
        }
      }
    }
  }
  assert.ok(seen.wouldCover > 0, 'unplaced, a bubble covers a name on these floors');
  assert.ok(seen.aside > 0, `some step aside: ${JSON.stringify(seen)}`);
  assert.ok(seen.natural > seen.none * 4, `and few have none: ${JSON.stringify(seen)}`);
  assert.equal(seen.wouldCover, seen.aside + seen.shorter + seen.none);
});

test('a bubble is whole over its head, then a step aside, then shorter, then not drawn', () => {
  const ctx = measuringCtx();
  const fig = { id: 'a', x: 200, y: 300, u: 20, text: 'Bash npm test' };
  const whole = toolBubbleBox(ctx, fig.x, fig.y, fig.u, fig.text);
  const place = (taken) => placeBubbles(ctx, [fig], taken).get('a');
  const name = (x, w) => ({ x, y: whole.y, w, h: whole.h });
  assert.deepEqual(place([]), { dx: 0, text: 'Bash npm test' });

  // A name at its right-hand end: one step to the left, and the whole line.
  const right = name(whole.x + whole.w - 3, 30);
  assert.deepEqual(place([right]), { dx: -BUBBLE_STEP * whole.w, text: 'Bash npm test' });
  // At its left-hand end: one step to the right, which is tried first.
  const left = name(whole.x - 27, 30);
  assert.deepEqual(place([left]), { dx: BUBBLE_STEP * whole.w, text: 'Bash npm test' });

  // A name on each side and less than the line's width between them: every
  // place is tried for the whole line, and then the line is cut.
  const narrow = [name(whole.x - 22, 30), name(whole.x + whole.w - 8, 30)];
  const cut = place(narrow);
  assert.equal(cut.text, 'Bash npm…');
  const box = toolBubbleBox(ctx, fig.x, fig.y, fig.u, cut.text);
  for (const t of narrow) assert.ok(!hits({ ...box, x: box.x + cut.dx }, t));
  // Closer still, and it is cut to half.
  const tight = [name(whole.x - 12, 30), name(whole.x + whole.w - 18, 30)];
  assert.equal(place(tight).text, 'Bash…');

  // A name across the whole of its head: neither side is clear, at any length.
  assert.equal(place([name(whole.x - 60, whole.w + 120)]), null);
  // Never farther than the other side of the head.
  const over = name(fig.x - 20, 40);
  assert.equal(place([over]), null, 'a name over the head itself is not stepped round');
});

test('the rig draws the bubble where the pass set it, and none where the pass found no room', () => {
  const tool = { name: 'Bash', summary: 'Bash npm test' };
  const draw = (toolSpot) => {
    const ctx = paintRecorder();
    ctx.canvas = {};
    /** @type {number[]} */
    const beats = [];
    const seen = new Proxy(ctx, {
      get: (t, key) => (key === 'arc' ? (x) => beats.push(x) : t[key]),
      set: (t, key, value) => Reflect.set(t, key, value),
    });
    const opts = { x: 100, y: 100, u: 20, lod: 2, color: STATE_COLORS.working, state: 'working' };
    drawCharacter(seen, sampleClip('type', 0, false), { ...opts, tool, toolSpot });
    const line = ctx.paints.find((p) => p.op === 'fillText' && /^Bash/.test(p.args[0]));
    return { line, beats: beats.slice(-2) };
  };
  // Nobody said where (a caller with no label pass): centred, whole, as it was.
  const natural = draw(undefined);
  assert.deepEqual(natural.line.args.slice(0, 2), ['Bash npm test', 100]);
  assert.ok(
    natural.beats.every((x) => x > 100),
    'its trail rises on the right',
  );
  // A step to the left and a shorter line: the text, its plate and the trail go with it.
  const aside = draw({ dx: -12, text: 'Bash npm…' });
  assert.deepEqual(aside.line.args.slice(0, 2), ['Bash npm…', 88]);
  assert.ok(
    aside.beats.every((x) => x < 100),
    'and the trail is mirrored to that side',
  );
  // No room on either side of the head: no bubble, and no cloud in its place.
  const none = draw(null);
  assert.equal(none.line, undefined);
  assert.ok(
    none.beats.every((x) => !natural.beats.includes(x)),
    'nor its trail',
  );
});

test('under reduced motion, or at L0, a tool is an icon and nobody is given a bubble', () => {
  const still = frameAt(1600, 900, () => busyFloor('pair'), { badges: true, reduced: true });
  assert.equal(still.labels.bubbles.size, 0);
  const small = frameAt(1420, 690, () => busyFloor('large'), { badges: true });
  assert.equal(small.lod, 0);
  assert.equal(small.labels.bubbles.size, 0);
});
