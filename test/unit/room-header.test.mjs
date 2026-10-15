/**
 * THE ROOM HEADER (`public/render/room-header.js`): a title bar and, under it,
 * a strip of symbols and numbers in fixed places — what replaced the four
 * lines of words in a room's corner (and R-082 with them).
 *
 * Geometry and behaviour over a measuring context: no canvas, no pixels.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HEADER_BAR_H,
  HEADER_SLOTS,
  HEADER_SLOT_SPECS,
  HEADER_STRIP_H,
  compactTokens,
  layoutHeader,
  paintBoardLive,
  paintHeader,
  roomHeaderFor,
} from '../../public/render/room-header.js';
import { SYMBOLS, SYMBOL_NAMES, drawSymbol } from '../../public/render/room-symbols.js';
import { FONT_FAMILIES, DEFAULT_FONT } from '../../public/render/floor-type.js';
import { PLATE_BAND } from '../../public/render/plan-units.js';
import { plateScaleFor } from '../../public/render/scene-labels.js';
import { floorCounts } from '../../public/floor-counts.js';
import { shapeRecorder } from '../helpers/shape-recorder.mjs';

/** A context that measures every glyph at 0.6 em, so a width is a fact. */
const measuring = () => ({
  font: '',
  measureText(/** @type {string} */ text) {
    return { width: String(text).length * parseFloat(/(\d[\d.]*)px/.exec(this.font)[1]) * 0.6 };
  },
});
const camera = (/** @type {number} */ U) => ({ zoom: 1, panX: 0, panY: 0, U });
const ROOM = { id: 'p1', kind: 'project', name: 'orbital-api', x: 2, y: 3, w: 30, h: 20 };
const snapshot = (/** @type {any} */ project = {}, /** @type {any[]} */ agents = []) => ({
  projects: [
    {
      id: 'p1',
      needsYou: 2,
      working: 1,
      todayTokens: 5_800_000,
      todayTokensIsToday: true,
      ...project,
    },
  ],
  agents,
  counts: { handsUp: 2, forReview: 4, benched: 9, drawn: { waiting: 6, lounge: 15, benched: 9 } },
});
const lay = (/** @type {any} */ room, /** @type {any} */ header, /** @type {number} */ U) =>
  layoutHeader(measuring(), room, header, camera(U), plateScaleFor(U));

test('THE SLOTS ARE THE OWNER’S LIST, in his order, and nothing else is on the floor', () => {
  assert.deepEqual([...HEADER_SLOTS.project], ['needs', 'working', 'stalled', 'spend']);
  assert.deepEqual([...HEADER_SLOTS.office], ['needs', 'hands', 'review']);
  assert.deepEqual([...HEADER_SLOTS.lounge], ['resting', 'home']);
  const stalled = { projectId: 'p1', ackState: 'active', activityState: 'stalled' };
  const project = roomHeaderFor(ROOM, snapshot({}, [stalled, stalled]), null, {
    oldest: 3 * 3_600_000,
    state: 'for_review',
  });
  assert.deepEqual(
    project.slots.map((s) => [s.id, s.text, s.on]),
    [
      ['needs', '2', true],
      ['working', '1', true],
      ['stalled', '2', true],
      ['spend', '5.8M', true],
    ],
  );
  // No words on the strip: a slot's text is a number, compact where it is large.
  for (const s of project.slots) assert.match(s.text, /^[\d.]+[kMB]?$/);
  // The bell is the colour of whoever has waited longest; a state's own symbol is its state's.
  assert.equal(project.slots[0].state, 'for_review');
  assert.equal(project.slots[1].state, 'working');
  // The office and the lounge say what the header's own counts say.
  const office = roomHeaderFor({ id: 'o', kind: 'office', name: 'Your Office' }, snapshot());
  assert.deepEqual(
    office.slots.map((s) => s.text),
    ['6', '2', '4'],
  );
  const lounge = roomHeaderFor({ id: 'l', kind: 'lounge', name: 'Lounge' }, snapshot(), {
    goneHome: new Set(['a', 'b']),
  });
  assert.deepEqual(
    lounge.slots.map((s) => s.text),
    [String(floorCounts(snapshot().counts).resting), '2'],
  );
  assert.equal(office.plus || lounge.plus, false, 'only a project room has a +');
});

test('A ZERO KEEPS ITS PLACE: every slot is where it was whatever the numbers are, and a zero is dimmed', () => {
  const busy = roomHeaderFor(ROOM, snapshot({ needsYou: 128, working: 64, todayTokens: 1.5e9 }));
  const quiet = roomHeaderFor(ROOM, snapshot({ needsYou: 0, working: 0, todayTokens: 0 }));
  const a = lay(ROOM, busy, 17.5);
  const b = lay(ROOM, quiet, 17.5);
  assert.deepEqual(
    a.slots.map((s) => [s.id, s.x, s.w]),
    b.slots.map((s) => [s.id, s.x, s.w]),
    'a number moved a slot',
  );
  assert.deepEqual(
    b.slots.map((s) => [s.text, s.on]),
    [
      ['0', false],
      ['0', false],
      ['0', false],
      ['0', false],
    ],
  );
  // Fixed widths, stated once: a slot is its spec's width at the plate scale.
  for (const s of a.slots) assert.equal(s.w, HEADER_SLOT_SPECS[s.id].w * a.k);
  // Slots do not overlap, and the widest number there is fits its slot.
  for (let i = 1; i < a.slots.length; i++)
    assert.ok(a.slots[i].x >= a.slots[i - 1].x + a.slots[i - 1].w);
  assert.equal(compactTokens(1.5e9), '1.5B');
  assert.equal(compactTokens(248e6), '248M');
  assert.equal(compactTokens(5_800_000), '5.8M');
  assert.equal(compactTokens(12_400), '12k');
});

test('A NARROW ROOM loses slots from the right in the declared order; the title bar is never dropped and never wraps', () => {
  const header = roomHeaderFor(
    { ...ROOM, name: 'a-repository-with-a-very-long-name-indeed' },
    snapshot(),
  );
  let last = HEADER_SLOTS.project.length;
  for (const w of [30, 14, 11, 8.5, 6, 3]) {
    const laid = lay({ ...ROOM, name: header.title, w }, header, 17.5);
    const kept = laid.slots.map((s) => s.id);
    assert.deepEqual(kept, HEADER_SLOTS.project.slice(0, kept.length), `at ${w} units: ${kept}`);
    assert.ok(kept.length <= last, 'a narrower room gained a slot');
    last = kept.length;
    assert.equal(laid.dropped, HEADER_SLOTS.project.length - kept.length);
    // The bar is there at every width, and its name is one line, cut with an ellipsis.
    assert.ok(laid.bar.h > 0 && laid.bar.w > 0);
    assert.ok(!laid.title.text.includes('\n'));
    if (laid.title.text !== header.title)
      assert.ok(laid.title.text === '' || laid.title.text.endsWith('…'));
    // Nothing in the header is outside it.
    for (const s of laid.slots)
      assert.ok(s.x >= laid.rect.x && s.x + s.w <= laid.rect.x + laid.rect.w);
    if (laid.plus) assert.ok(laid.plus.cx + laid.plus.r <= laid.bar.x + laid.bar.w);
  }
  assert.equal(last, 0, 'the narrowest room keeps no slot, and still has its bar');
});

test('THE HEADER STAYS INSIDE THE BAND THE PLAN KEEPS CLEAR, at every scale the floor is drawn at', () => {
  assert.equal(PLATE_BAND, 3.4, 'the band is the plan’s, and this job did not move it');
  const header = roomHeaderFor(ROOM, snapshot());
  for (const U of [7.5, 9, 10.6, 13.2, 17.5, 22, 28.6]) {
    const laid = lay(ROOM, header, U);
    const top = ROOM.y * U;
    const band = PLATE_BAND * U;
    assert.ok(laid.rect.y >= top, `${U}: the header starts above its room`);
    assert.ok(
      laid.rect.y + laid.rect.h <= top + band + 1e-6,
      `${U}: the header is ${(laid.rect.y + laid.rect.h - top).toFixed(1)}px deep in a ${band.toFixed(1)}px band`,
    );
    // Where there is room it is its stated size; where there is not, both
    // lines are set shorter together — never the band taller.
    const k = plateScaleFor(U);
    assert.ok(laid.bar.h <= HEADER_BAR_H * k + 1e-6 && laid.strip.h <= HEADER_STRIP_H * k + 1e-6);
    assert.ok(Math.abs(laid.bar.h / laid.strip.h - HEADER_BAR_H / HEADER_STRIP_H) < 1e-6);
  }
  // At the scale a 1600x900 window draws the demo floor, it is its stated size.
  const usual = lay(ROOM, header, 13.2);
  assert.equal(usual.bar.h, HEADER_BAR_H);
  assert.equal(usual.strip.h, HEADER_STRIP_H);
});

test('the name is the bold sans, every number is in the numeric role, and a pinned room shows its pin', () => {
  const f = FONT_FAMILIES[DEFAULT_FONT];
  const laid = lay(ROOM, roomHeaderFor(ROOM, snapshot()), 17.5);
  assert.match(laid.title.font, /^700 /);
  assert.ok(laid.title.font.endsWith(f.sans));
  assert.ok(
    laid.num.font.endsWith(f.numeric),
    'a count is not in the family whose figures line up',
  );
  assert.equal(laid.pin, null);
  const pinned = { ...ROOM, pinned: true };
  const p = lay(pinned, roomHeaderFor(pinned, snapshot()), 17.5);
  assert.ok(p.pin && p.pin.cx > p.title.x, 'the pin is after the name');
  assert.match(roomHeaderFor(pinned, snapshot()).tooltip, /\(pinned\)/);
});

test('THE WORDS ARE THE TOOLTIP’S: every slot is said in words, zero or not', () => {
  const header = roomHeaderFor(ROOM, snapshot({ working: 0 }));
  assert.equal(
    header.tooltip,
    'orbital-api · need you 2 · working none · stalled none · tokens today 5.8M',
  );
  // Idle sessions have no slot of their own; the hover says them where there are any.
  assert.equal(
    roomHeaderFor(ROOM, snapshot({ working: 0, idle: 2 })).tooltip,
    'orbital-api · need you 2 · working none · stalled none · tokens today 5.8M · idle 2',
  );
  for (const kind of Object.keys(HEADER_SLOTS)) {
    for (const id of HEADER_SLOTS[kind]) {
      const spec = HEADER_SLOT_SPECS[id];
      assert.ok(spec.says.length > 3 && SYMBOLS[spec.symbol], `${kind}.${id}`);
    }
  }
});

test('ONE SMALL DRAWN SET: every symbol is a different shape, drawn inside its own square', () => {
  const shapes = new Set();
  for (const name of SYMBOL_NAMES) {
    const ctx = shapeRecorder();
    drawSymbol(ctx, name, 100, 100, 10, '#123456');
    assert.ok(ctx.paints.length >= 1, `${name} draws nothing`);
    for (const p of ctx.paints) {
      assert.equal(p.style, '#123456', `${name} is drawn in one colour`);
      // Inside the square, give or take the weight of its own stroke.
      for (const v of [p.box.x0, p.box.y0, p.box.x1, p.box.y1])
        assert.ok(v >= 88 && v <= 112, name);
    }
    shapes.add(JSON.stringify(ctx.paints.map((p) => [p.op, p.box])));
  }
  assert.equal(shapes.size, SYMBOL_NAMES.length, 'two symbols are the same drawing');
  // The states' own marks are four different symbols: never colour alone.
  const marks = Object.entries(SYMBOLS).filter(([, s]) => s.state);
  assert.equal(new Set(marks.map(([, s]) => s.state)).size, 4);
});

test('the header paints its own ground, and the board is lit by the states the room really has', () => {
  const ctx = shapeRecorder();
  ctx.fillText = () => {};
  const laid = lay(ROOM, roomHeaderFor(ROOM, snapshot()), 17.5);
  paintHeader(ctx, laid, { accent: '#445566', hovered: false });
  const ground = ctx.paints[0];
  assert.equal(ground.op, 'fill');
  assert.ok(
    Math.abs(ground.box.x1 - ground.box.x0 - laid.rect.w) < 1e-6,
    'the ground is the whole header',
  );
  assert.ok(
    ctx.paints.some((p) => p.style === '#445566'),
    'a zoned room’s hue is the rule between the lines',
  );
  // Hovered, the bar is outlined: one more stroke than at rest, and nothing moves.
  const hot = shapeRecorder();
  hot.fillText = () => {};
  paintHeader(hot, laid, { hovered: true });
  const strokes = (/** @type {any} */ c) =>
    c.paints.filter((/** @type {any} */ p) => p.op === 'stroke').length;
  const rest = shapeRecorder();
  rest.fillText = () => {};
  paintHeader(rest, laid, { hovered: false });
  assert.equal(strokes(hot), strokes(rest) + 1);

  const board = { x: 10, y: 10, w: 20, h: 80 };
  const lines = (/** @type {string[]} */ states, hovered = false) => {
    const c = shapeRecorder();
    paintBoardLive(c, board, { states, hovered });
    return c.paints;
  };
  assert.equal(lines([]).length, 1, 'an empty room’s board is lit and has no lines');
  assert.equal(lines(['working']).length, 2);
  assert.equal(lines(['for_review', 'needs_input', 'working']).length, 4);
  assert.equal(lines(['working'], true).length, 4, 'under the pointer: the wash and the line');
  for (const p of lines(['for_review', 'working'], true)) {
    assert.ok(
      p.box.x0 >= board.x - 1 && p.box.x1 <= board.x + board.w + 1,
      'the light spills off the board',
    );
  }
});

test('ONE RHYTHM: every count slot is one width on every bar, and only the token count is wider', () => {
  const widths = new Map(Object.entries(HEADER_SLOT_SPECS).map(([id, s]) => [id, s.w]));
  const counts = [...widths].filter(([id]) => id !== 'spend').map(([, w]) => w);
  assert.equal(new Set(counts).size, 1, `count slots are ${[...new Set(counts)]} wide`);
  assert.ok(widths.get('spend') > counts[0], 'four characters need more room than three');
  // So the second slot starts at the same place in a project room and the office.
  const project = lay(ROOM, roomHeaderFor(ROOM, snapshot()), 17.5);
  const officeRoom = { ...ROOM, id: 'o', kind: 'office', name: 'Your Office' };
  const office = lay(officeRoom, roomHeaderFor(officeRoom, snapshot()), 17.5);
  assert.deepEqual(
    office.slots.map((s) => s.x),
    project.slots.slice(0, 3).map((s) => s.x),
  );
});
