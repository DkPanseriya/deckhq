/**
 * WP-39 — the floating mini-floor.
 *
 * The window itself needs a Chromium with Document Picture-in-Picture, which
 * no unit test has. What every unit test CAN have is the part that decides
 * what the window says: `composeMiniFrame()` is a pure function over a plan
 * plus the scene's agent records, so which rooms are in the shot, which people
 * stand in them and what the numeral reads are all assertable here, and
 * `drawMiniFrame()` is exercised against a stub canvas that records the calls
 * it receives.
 *
 * The fallback — a browser with no floating window at all — is asserted
 * against a fake `window`, because that path is the only thing a Firefox or
 * Safari user ever sees and it must not be the thing nobody ran.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  composeMiniFrame,
  drawMiniFrame,
  createMiniFloor,
  canFloat,
  PIP_SIZE,
  NO_PIP_MESSAGE,
} from '../../public/minifloor.js';
import { buildPlan, U } from '../../public/render/plan.js';
import { assignSeats, AgentRuntime } from '../../public/render/agents.js';
import { STATE_COLORS } from '../../public/render/palette.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../../public');

const NOW = 1_800_000_000_000;

/** @param {string} id @param {object} over */
function agent(id, over = {}) {
  return {
    id,
    projectId: 'p0',
    projectMk: 'MK1',
    activityState: 'working',
    ackState: 'active',
    reviewSince: null,
    lastActivityAt: NOW - 60_000,
    ...over,
  };
}

/**
 * A real floor: two projects, somebody working at a desk in each, two sessions
 * finished and standing in the office, and one benched in the lounge. Built
 * through `buildPlan` and seated through the real `AgentRuntime`, so the
 * coordinates the composition is asked about are the ones the main floor would
 * actually be drawing.
 */
function floor(agents, opts = {}) {
  const projects = opts.projects || [
    { id: 'p0', name: 'deckhq', sessionCount: 3 },
    { id: 'p1', name: 'other', sessionCount: 1 },
  ];
  const plan = buildPlan(projects, agents, { targetAspect: 1.6, now: NOW });
  const runtime = new AgentRuntime();
  runtime.sync(agents, plan, assignSeats(plan, agents));
  const agentsById = new Map(agents.map((a) => [a.id, a]));
  const counts = {
    needsYou: agents.filter(
      (a) =>
        a.ackState === 'active' &&
        ['for_review', 'needs_input', 'stalled'].includes(a.activityState),
    ).length,
    handsUp: agents.filter((a) => a.ackState === 'active' && a.activityState === 'needs_input')
      .length,
  };
  return {
    plan,
    backdrop: null,
    records: [...runtime.all()],
    agentsById,
    snapshot: { agents, projects, counts },
    selectedId: null,
    reduced: false,
  };
}

const POPULATION = [
  agent('a-desk-0'),
  agent('a-desk-1', { projectId: 'p1' }),
  agent('a-wait-0', { activityState: 'for_review', reviewSince: NOW - 300_000 }),
  agent('a-wait-1', { activityState: 'for_review', reviewSince: NOW - 90_000 }),
  agent('a-hand', { activityState: 'needs_input' }),
  agent('a-bench', { ackState: 'benched' }),
];

const VIEW = { width: PIP_SIZE.width - 110, height: PIP_SIZE.height - 16, now: NOW };

// ------------------------------------------------------- which rooms it shows

test('the shot is the office and the corridor beside it, and nothing else', () => {
  const composed = composeMiniFrame(floor(POPULATION), VIEW);
  assert.equal(composed.ok, true);

  const kinds = composed.rooms.map((r) => r.kind);
  assert.deepEqual(kinds, ['office', 'corridor'], `got ${kinds.join(', ')}`);
  // No lounge, no project room, no directory strip — this window is one
  // question, not a small copy of the floor.
  assert.equal(
    composed.rooms.some((r) => r.kind === 'project' || r.kind === 'lounge'),
    false,
  );
});

test('the corridor in the shot is the spine, clipped to the office band', () => {
  const frame = floor(POPULATION);
  const composed = composeMiniFrame(frame, VIEW);
  const office = frame.plan.rooms.find((r) => r.kind === 'office');
  const spine = frame.plan.rooms.find((r) => r.id === '__spine__');
  const drawn = composed.rooms.find((r) => r.kind === 'corridor');

  assert.equal(drawn.id, '__spine__');
  // The spine runs the whole height of the building; only the stretch past
  // your door belongs in a 320x200 window.
  assert.ok(spine.h > office.h + 1, 'fixture is not exercising the clip');
  assert.equal(drawn.h, office.h);
  assert.equal(drawn.y, office.y);
  // And it is beside the office, not over it.
  assert.ok(drawn.x >= office.x + office.w - 1e-6);
});

test('the shot is exactly the union of the rooms it drew, and the viewport is that plus a margin', () => {
  const composed = composeMiniFrame(floor(POPULATION), VIEW);
  const x0 = Math.min(...composed.rooms.map((r) => r.x));
  const y0 = Math.min(...composed.rooms.map((r) => r.y));
  const x1 = Math.max(...composed.rooms.map((r) => r.x + r.w));
  const y1 = Math.max(...composed.rooms.map((r) => r.y + r.h));
  assert.deepEqual(composed.shot, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 });

  // The margin is symmetric and non-zero — it is what stops a person standing
  // against the office wall being cut in half by the edge of the canvas.
  const padX = composed.shot.x - composed.viewport.x;
  const padY = composed.shot.y - composed.viewport.y;
  assert.ok(padX > 0 && padY > 0);
  assert.equal(padX, padY);
  assert.ok(Math.abs(composed.viewport.w - (composed.shot.w + padX * 2)) < 1e-9);
  assert.ok(Math.abs(composed.viewport.h - (composed.shot.h + padY * 2)) < 1e-9);
});

test('the shot is contained in the canvas, never cropped by it', () => {
  const composed = composeMiniFrame(floor(POPULATION), VIEW);
  const w = composed.viewport.w * composed.scale;
  const h = composed.viewport.h * composed.scale;
  assert.ok(w <= VIEW.width + 1e-6, `${w} wider than ${VIEW.width}`);
  assert.ok(h <= VIEW.height + 1e-6, `${h} taller than ${VIEW.height}`);
  // Fit means one axis touches, within the padding.
  assert.ok(w >= VIEW.width - 13 || h >= VIEW.height - 13);
});

test('a plan with no office at all composes to nothing rather than throwing', () => {
  for (const frame of [{}, { plan: null }, { plan: { rooms: [] } }]) {
    const composed = composeMiniFrame(frame, VIEW);
    assert.equal(composed.ok, false);
    assert.deepEqual(composed.people, []);
    assert.deepEqual(composed.rooms, []);
  }
});

// ------------------------------------------------------ which agents it shows

test('it draws the people in the office and the corridor, and nobody at a desk or in the lounge', () => {
  const frame = floor(POPULATION);
  const composed = composeMiniFrame(frame, VIEW);
  const ids = composed.people.map((p) => p.id).sort();

  assert.deepEqual(ids, ['a-wait-0', 'a-wait-1']);
  // The two who are waiting on you are exactly the two the office holds.
  assert.deepEqual(composed.officeIds, ['a-wait-0', 'a-wait-1']);
  for (const id of ['a-desk-0', 'a-desk-1', 'a-bench', 'a-hand']) {
    assert.equal(
      ids.includes(id),
      false,
      `${id} is not in the office and must not be in the window`,
    );
  }
});

test('a record with no agent behind it is not drawn', () => {
  const frame = floor(POPULATION);
  frame.agentsById.delete('a-wait-0');
  const composed = composeMiniFrame(frame, VIEW);
  assert.deepEqual(
    composed.people.map((p) => p.id),
    ['a-wait-1'],
  );
});

test('people are given the floor’s own state colour and state icon', () => {
  const composed = composeMiniFrame(floor(POPULATION), VIEW);
  for (const person of composed.people) {
    assert.equal(person.color, STATE_COLORS.for_review);
    assert.equal(person.icon, 'check');
  }
});

test('people come back in painter order, back of the room first', () => {
  const composed = composeMiniFrame(floor(POPULATION), VIEW);
  for (let i = 1; i < composed.people.length; i++) {
    assert.ok(composed.people[i - 1].y <= composed.people[i].y);
  }
});

test('a walking agent is sampled as walking, whatever clip its record still names', () => {
  const frame = floor(POPULATION);
  const rec = frame.records.find((r) => r.id === 'a-wait-0');
  rec.clip = 'type';
  rec.path = [{ x: rec.x + 1, y: rec.y }];
  const composed = composeMiniFrame(frame, VIEW);
  assert.equal(composed.people.find((p) => p.id === 'a-wait-0').clip, 'walk');
});

test('screen coordinates are the world coordinates through this frame’s own camera', () => {
  const composed = composeMiniFrame(floor(POPULATION), VIEW);
  for (const person of composed.people) {
    assert.ok(Math.abs(person.sx - (person.x * composed.scale + composed.offsetX)) < 1e-9);
    assert.ok(Math.abs(person.sy - (person.y * composed.scale + composed.offsetY)) < 1e-9);
    // And it lands inside the canvas, which is what makes a click hit it.
    assert.ok(person.sx >= 0 && person.sx <= VIEW.width);
    assert.ok(person.sy >= 0 && person.sy <= VIEW.height);
  }
});

test('a body never drops below the legibility floor, however small the window', () => {
  const composed = composeMiniFrame(floor(POPULATION), { width: 120, height: 70, now: NOW });
  // `characterScaleFor` is the floor's own clamp; the mini-floor uses it
  // rather than a second answer to the same question.
  assert.ok(composed.charScale >= composed.scale);
  assert.ok(composed.charScale > 0);
  // And the LOD is capped at L1: a desk widget never pays for close-up detail.
  assert.ok(composed.lod <= 1);
});

// ------------------------------------------------------------- the numeral

test('the numeral and the hands-up count are the snapshot’s own counts', () => {
  const frame = floor(POPULATION);
  const composed = composeMiniFrame(frame, VIEW);
  assert.equal(composed.numeral, 3); // two for_review plus one needs_input
  assert.equal(composed.numeral, frame.snapshot.counts.needsYou);
  assert.equal(composed.handsUp, 1);
  assert.equal(composed.handsUp, frame.snapshot.counts.handsUp);
});

test('a cleared queue reads zero rather than reading nothing', () => {
  const quiet = [agent('a-desk-0'), agent('a-bench', { ackState: 'benched' })];
  const composed = composeMiniFrame(floor(quiet), VIEW);
  assert.equal(composed.numeral, 0);
  assert.equal(composed.handsUp, 0);
  assert.deepEqual(composed.people, []);
});

test('the numeral survives a floor with no plan yet', () => {
  const composed = composeMiniFrame({ snapshot: { counts: { needsYou: 4, handsUp: 2 } } }, VIEW);
  assert.equal(composed.ok, false);
  assert.equal(composed.numeral, 4);
  assert.equal(composed.handsUp, 2);
});

// ----------------------------------------------------------------- drawing

/** A canvas context that draws nothing and remembers everything. */
function stubCtx() {
  const calls = [];
  const record =
    (name) =>
    (...args) => {
      calls.push({ name, args });
    };
  const ctx = {
    calls,
    canvas: { width: 0, height: 0 },
    save: record('save'),
    restore: record('restore'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    clip: record('clip'),
    rect: record('rect'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    arc: record('arc'),
    ellipse: record('ellipse'),
    quadraticCurveTo: record('quadraticCurveTo'),
    bezierCurveTo: record('bezierCurveTo'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    clearRect: record('clearRect'),
    fillText: record('fillText'),
    strokeText: record('strokeText'),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
    setTransform: record('setTransform'),
    drawImage: record('drawImage'),
    setLineDash: record('setLineDash'),
    createLinearGradient: () => ({ addColorStop() {} }),
    createRadialGradient: () => ({ addColorStop() {} }),
    measureText: (text) => ({ width: String(text).length * 6 }),
  };
  return ctx;
}

test('drawMiniFrame paints the rooms, then one character per person', () => {
  const composed = composeMiniFrame(floor(POPULATION), VIEW);
  assert.equal(composed.people.length, 2);
  const ctx = stubCtx();
  drawMiniFrame(ctx, composed, { width: VIEW.width, height: VIEW.height });

  // The canvas is cleared before anything else, and the slack around the
  // building is left transparent so the window's own cold ground shows.
  assert.equal(ctx.calls[0].name, 'clearRect');
  // With no baked bitmap it falls back to flat fills: the building's ground
  // plus one per room, in the palette's own tokens — never a hard-coded colour.
  const fills = ctx.calls.filter((c) => c.name === 'fillRect');
  assert.ok(fills.length >= composed.rooms.length + 1);
  // The ground is exactly the building, not the whole canvas.
  const ground = fills[0].args;
  assert.ok(Math.abs(ground[2] - composed.shot.w * composed.scale) < 1e-6);
  assert.ok(ground[2] < VIEW.width);

  // The people cost something, and each one costs the same as the last: draw
  // the identical composition with nobody in it, then with one, then with two.
  const cost = (n) => {
    const c = stubCtx();
    drawMiniFrame(
      c,
      { ...composed, people: composed.people.slice(0, n) },
      {
        width: VIEW.width,
        height: VIEW.height,
      },
    );
    return c.calls.length;
  };
  const none = cost(0);
  const one = cost(1);
  const both = cost(2);
  assert.ok(one > none, 'a person left no mark on the canvas');
  assert.equal(both - one, one - none, 'the two characters did not cost the same');
  assert.equal(both, ctx.calls.length);
});

test('drawMiniFrame blits the main floor’s baked bitmap when there is one', () => {
  const frame = floor(POPULATION);
  const composed = composeMiniFrame(frame, VIEW);
  const ctx = stubCtx();
  const wpx = Math.ceil(frame.plan.width * U);
  const hpx = Math.ceil(frame.plan.height * U);
  // A 2x bake, exactly as a retina main window would have produced.
  const backdrop = { canvas: { width: wpx * 2, height: hpx * 2 }, wpx, hpx };
  drawMiniFrame(ctx, composed, { width: VIEW.width, height: VIEW.height, backdrop });

  const blit = ctx.calls.find((c) => c.name === 'drawImage');
  assert.ok(blit, 'the baked floor was not blitted');
  const [, sx, sy, sw, sh, dx, dy, dw, dh] = blit.args;
  const spu = U * 2;
  // The source rectangle is the shot CLAMPED to the bitmap: the office sits in
  // the building's own top-left corner, so the shot's margin runs off the edge
  // of the bake and asking for it would be asking for pixels that do not exist.
  const src = {
    x: Math.max(0, composed.shot.x),
    y: Math.max(0, composed.shot.y),
  };
  src.w = Math.min(frame.plan.width, composed.shot.x + composed.shot.w) - src.x;
  src.h = Math.min(frame.plan.height, composed.shot.y + composed.shot.h) - src.y;
  assert.ok(Math.abs(sx - src.x * spu) < 1e-6);
  assert.ok(Math.abs(sy - src.y * spu) < 1e-6);
  assert.ok(Math.abs(sw - src.w * spu) < 1e-6);
  assert.ok(Math.abs(sh - src.h * spu) < 1e-6);
  // And it lands where that same rectangle lands under this frame's camera, so
  // the blit is to scale and in register with the people drawn over it.
  assert.ok(Math.abs(dw - src.w * composed.scale) < 1e-6);
  assert.ok(Math.abs(dh - src.h * composed.scale) < 1e-6);
  assert.ok(Math.abs(dx - (src.x * composed.scale + composed.offsetX)) < 1e-6);
  assert.ok(Math.abs(dy - (src.y * composed.scale + composed.offsetY)) < 1e-6);
  assert.equal(
    ctx.calls.filter((c) => c.name === 'save').length,
    ctx.calls.filter((c) => c.name === 'restore').length,
  );
});

test('drawMiniFrame on an empty composition clears the canvas and paints nothing', () => {
  const ctx = stubCtx();
  const composed = composeMiniFrame({}, VIEW);
  drawMiniFrame(ctx, composed, { width: VIEW.width, height: VIEW.height });
  assert.deepEqual(
    ctx.calls.map((c) => c.name),
    ['clearRect'],
  );
});

test('reduced motion reaches the rig: a walking body holds a pose instead of cycling', () => {
  const frame = floor(POPULATION);
  const rec = frame.records.find((r) => r.id === 'a-wait-0');
  rec.path = [{ x: rec.x + 1, y: rec.y }];
  const composed = composeMiniFrame(frame, { ...VIEW, now: NOW });
  const still = stubCtx();
  drawMiniFrame(still, composed, { width: VIEW.width, height: VIEW.height, reduced: true });
  const later = composeMiniFrame(frame, { ...VIEW, now: NOW + 400 });
  const stillLater = stubCtx();
  drawMiniFrame(stillLater, later, { width: VIEW.width, height: VIEW.height, reduced: true });
  assert.deepEqual(
    JSON.stringify(still.calls),
    JSON.stringify(stillLater.calls),
    'a reduced-motion frame moved between two clock readings',
  );
});

// ---------------------------------------------------------- the fallback

/** A browser with no floating window: Firefox, Safari. */
function fakeWindow({ pip = false } = {}) {
  const win = {
    document: { querySelectorAll: () => [] },
    matchMedia: () => ({ matches: false }),
    focus() {},
  };
  if (pip) win.documentPictureInPicture = { requestWindow: async () => null };
  return win;
}

test('canFloat is false in a browser with no Document Picture-in-Picture', () => {
  assert.equal(canFloat(fakeWindow()), false);
  assert.equal(canFloat(fakeWindow({ pip: true })), true);
  assert.equal(canFloat(null), false);
});

test('with no floating window, the count goes to the app badge and one line says so', async () => {
  const toasted = [];
  const badged = [];
  const mini = createMiniFloor({
    win: fakeWindow(),
    getScene: () => ({ frame: () => floor(POPULATION) }),
    onSelect: () => assert.fail('nothing was clicked'),
    onFallback: (n) => badged.push(n),
    toast: (m) => toasted.push(m),
  });

  const opened = await mini.open();
  assert.equal(opened, false);
  assert.equal(mini.isOpen(), false);
  // The badge carries the real count, not a placeholder.
  assert.deepEqual(badged, [3]);
  assert.deepEqual(toasted, [NO_PIP_MESSAGE]);
});

test('the fallback message names no fault and asks for nothing', () => {
  assert.match(NO_PIP_MESSAGE, /cannot float a window/);
  // `04` §5 / `05` §10: never a second-person fault.
  assert.doesNotMatch(NO_PIP_MESSAGE, /\byou(r|'ve| have)? (need|must|should|forgot|left)\b/i);
  assert.equal(NO_PIP_MESSAGE.split('\n').length, 1);
});

test('a fallback with no scene at all still degrades to a zero badge', async () => {
  const badged = [];
  const mini = createMiniFloor({
    win: fakeWindow(),
    getScene: () => null,
    onSelect: () => {},
    onFallback: (n) => badged.push(n),
    toast: () => {},
  });
  assert.equal(await mini.open(), false);
  assert.deepEqual(badged, [0]);
});

test('toggle on a closed mini-floor with no PiP is the fallback, not a throw', async () => {
  const mini = createMiniFloor({
    win: fakeWindow(),
    getScene: () => ({ frame: () => floor(POPULATION) }),
    onSelect: () => {},
    toast: () => {},
  });
  assert.equal(await mini.toggle(), false);
  // Closing something that was never opened is a no-op, not an error.
  mini.close();
  assert.equal(mini.isOpen(), false);
});

// ----------------------------------------------------------------- wiring

test('the window it asks for is the size `08` B3 specifies', () => {
  assert.deepEqual({ ...PIP_SIZE }, { width: 320, height: 200 });
  const src = fs.readFileSync(path.join(PUBLIC, 'minifloor.js'), 'utf8');
  assert.match(src, /requestWindow\(\{\s*width: PIP_SIZE\.width,\s*height: PIP_SIZE\.height,/);
});

test('SECURITY: the mini-floor builds its document without innerHTML or any HTML parser', () => {
  const src = fs.readFileSync(path.join(PUBLIC, 'minifloor.js'), 'utf8');
  assert.doesNotMatch(
    src,
    /innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment/,
  );
  // And it builds the document it does need the long way round.
  assert.match(src, /createElement\(/);
  assert.match(src, /textContent =/);
});

test('EGRESS: the mini-floor opens no network connection of its own', () => {
  const src = fs.readFileSync(path.join(PUBLIC, 'minifloor.js'), 'utf8');
  // The PiP document links the page's OWN stylesheet and nothing else; there
  // is no fetch, no EventSource and no second SSE subscription in here.
  assert.doesNotMatch(src, /\bfetch\(|EventSource|XMLHttpRequest|WebSocket/);
});

test('the mini-floor never acknowledges anything — clicking a person only selects', () => {
  const src = fs.readFileSync(path.join(PUBLIC, 'minifloor.js'), 'utf8');
  // THE INVARIANT, docs/01-PRODUCT.md §2: no second route to /api/ack.
  assert.doesNotMatch(src, /\/api\/|performAction|ackState =/);
  assert.match(src, /deps\.onSelect\(best\.id\)/);
});

test('reduced motion follows the setting as well as the OS, in both documents', () => {
  const src = fs.readFileSync(path.join(PUBLIC, 'minifloor.js'), 'utf8');
  // `settings-ui.js` stamps an explicit choice on the main document's root and
  // the shared stylesheet reads it. The floating window is a document of its
  // own, so the attribute has to be carried across or every
  // `[data-motion='reduce']` rule would stop applying once the page floated.
  assert.match(src, /prefers-reduced-motion: reduce/);
  assert.match(src, /dataset\.motion/);
  assert.match(src, /function syncMotionAttribute/);
  // And the pulse is gated on the answer, not on the media query alone.
  assert.match(src, /arrived && !reduced\(\)/);
});

test('it is a second render target, not a second scene', () => {
  const src = fs.readFileSync(path.join(PUBLIC, 'minifloor.js'), 'utf8');
  // No second plan, no second bake, no second runtime — those are the three
  // things that would give the two windows two answers to the same question.
  assert.doesNotMatch(src, /buildPlan\(|bakeBackdrop\(|new AgentRuntime\(/);
  assert.match(src, /scene\.frame\(\)/);
});

test('the palette command and the P key are the only two ways in', () => {
  // WP-22: the keyboard map lives in app-keys.js now, the palette wiring and
  // the listeners still in app.js. Both are read; the rules are unchanged.
  const app =
    fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8') +
    fs.readFileSync(path.join(PUBLIC, 'app-keys.js'), 'utf8');
  const palette = fs.readFileSync(path.join(PUBLIC, 'palette.js'), 'utf8');
  assert.match(palette, /id: 'cmd:float-office'/);
  assert.match(palette, /label: 'Float the office'/);
  assert.match(palette, /run: \(\) => actions\.floatOffice\(\)/);
  assert.match(app, /floatOffice, \/\/ WP-39/);

  // `P` is a case in the floor's own keyboard map, not a listener of its own.
  // It was registered separately while three packages were editing that
  // switch (DEVIATIONS §113.5); the duplicate guards it carried are the class
  // of thing that drifts out of step with the map it was copied from, so the
  // duplication is asserted gone rather than left to be noticed.
  const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
  const bare = stripComments(app);
  const start = bare.indexOf('function handleKeydown(');
  assert.notEqual(start, -1, 'handleKeydown() not found in app.js');
  const map = bare.slice(start, bare.indexOf('\nfunction ', start + 1));
  assert.match(map, /case 'p':\s*case 'P':\s*floatOffice\(\);/);
  assert.doesNotMatch(bare, /e\.key !== 'p' && e\.key !== 'P'/);
  // Every document-level `keydown` listener is a named handler — the map, the
  // palette accelerator, the audio unlock — and none of them is an anonymous
  // block claiming one key for one feature.
  const documentKeyListeners =
    bare.match(/document\.addEventListener\('keydown', ([^)]*)\)/g) || [];
  assert.ok(documentKeyListeners.length >= 3);
  for (const line of documentKeyListeners) {
    assert.match(
      line,
      /keydown', [A-Za-z_$][\w$]*\)/,
      `a keydown listener was added outside the keyboard map: ${line}`,
    );
  }
  // `05` §5.2's header is a headline: no control for this was added to it.
  const html = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /minifloor|float-office|Float the office/i);
});
