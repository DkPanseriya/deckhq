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
import { fakeId } from '../../scripts/demo-write.mjs';
import { drawCrews } from '../../public/render/crew-draw.js';
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
