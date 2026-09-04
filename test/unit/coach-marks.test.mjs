/**
 * WP-13's onboarding: the three coach marks, the sequence, and `Escape`
 * skipping all of them forever.
 *
 * The pure half (`markText`, `visibleMarks`, `advance`, `placeCard`,
 * `readingSeconds`) is asserted directly. The DOM half is driven against a
 * minimal stub — the same technique as `markdown.test.mjs` and
 * `diff-view.test.mjs` — which is enough to prove the two things that matter
 * and are invisible to a unit test of the reducer alone: that Escape reaches
 * `onDone` exactly once with `skipped`, and that reading all three reaches it
 * exactly once without.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  COACH_MARKS,
  READING_BUDGET_S,
  advance,
  createCoachMarks,
  initialState,
  markText,
  placeCard,
  readingSeconds,
  visibleMarks,
} from '../../public/coach-marks.js';
// The renderer's own anchor arithmetic, so the two floor marks are checked
// against what the floor actually draws rather than against a stub of it.
import { computeAnchor, computeFitScale, characterScaleFor } from '../../public/render/scene.js';
import { buildPlan, U } from '../../public/render/plan.js';
import { AgentRuntime, assignSeats } from '../../public/render/agents.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');

// ------------------------------------------------------------ the DOM stub

class StubNode {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
    this.dataset = {};
    this.style = {};
    this.hidden = false;
    this.attrs = {};
    this.listeners = new Map();
    this.focused = false;
    this._text = null;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    return child;
  }
  get firstChild() {
    return this.children[0] || null;
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v);
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      list.filter((f) => f !== fn),
    );
  }
  dispatch(type, event = {}) {
    for (const fn of [...(this.listeners.get(type) || [])]) fn(event);
  }
  focus() {
    this.focused = true;
  }
  getBoundingClientRect() {
    return { width: 320, height: 120, left: 0, top: 0 };
  }
  querySelector(sel) {
    const want = sel.replace(/^\./, '');
    const walk = (node) => {
      for (const c of node.children) {
        if (String(c.className).split(/\s+/).includes(want)) return c;
        const found = walk(c);
        if (found) return found;
      }
      return null;
    };
    return walk(this);
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

function stubDoc() {
  const listeners = new Map();
  return {
    createElement: (tag) => new StubNode(tag),
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = listeners.get(type) || [];
      listeners.set(
        type,
        list.filter((f) => f !== fn),
      );
    },
    /** Fire a document-level key, the way the browser would. */
    key(k) {
      let prevented = false;
      const event = {
        key: k,
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation: () => {},
      };
      for (const fn of [...(listeners.get('keydown') || [])]) fn(event);
      return prevented;
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    },
  };
}

/** A running tour over the stub, with the calls it made recorded. */
function mountTour({ needsYou = 3, agents = 5 } = {}) {
  const doc = stubDoc();
  const layer = new StubNode('div');
  layer.hidden = true;
  /** @type {{skipped:boolean}[]} */
  const done = [];
  const marks = createCoachMarks({
    doc,
    layer,
    getSnapshot: () => ({
      counts: { needsYou },
      agents: Array.from({ length: agents }, (_, i) => ({ id: `a${i}` })),
    }),
    anchorFor: () => ({ x: 40, y: 30, w: 60, h: 24 }),
    onDone: (r) => done.push(r),
  });
  marks.start();
  return { doc, layer, marks, done };
}

const card = (layer) => layer.querySelector('.coach-card');
const nextBtn = (layer) => layer.querySelector('.coach-next');
const skipBtn = (layer) => layer.querySelector('.coach-skip');

// ------------------------------------------------------------------ copy

test('the three marks are the three the spec names, in order', () => {
  assert.deepEqual(
    COACH_MARKS.map((m) => m.id),
    ['needs-you', 'office', 'waiting-agent'],
  );
  // Anchored to real things, never to nothing: one chrome element and two
  // regions of the floor.
  assert.deepEqual(
    COACH_MARKS.map((m) => m.anchor.kind),
    ['element', 'floor', 'floor'],
  );
});

test('the copy carries the live count and never puts fault on the reader', () => {
  assert.match(markText('needs-you', { needsYou: 7 }), /^7 sessions are waiting on you\./);
  assert.match(markText('needs-you', { needsYou: 1 }), /^1 session is waiting on you\./);
  assert.match(markText('needs-you', { needsYou: 0 }), /^Nothing is waiting on you right now\./);

  // docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md §5: no second-person fault,
  // anywhere, ever. "waiting on you" is a statement about the sessions;
  // "you've left", "you have not", "still waiting for you to" are not.
  const all = COACH_MARKS.map((m) => markText(m.id, { needsYou: 7 })).join(' ');
  for (const forbidden of [
    /you'?ve left/i,
    /you have left/i,
    /you forgot/i,
    /you failed/i,
    /you still/i,
    /don'?t forget/i,
  ]) {
    assert.doesNotMatch(all, forbidden, `the coach marks blame the reader: ${forbidden}`);
  }
});

test('the lesson each mark exists to teach is in it', () => {
  // The one thing a new user must learn from mark 1 is that the number is
  // theirs, and from mark 2 that reading does not discharge. Both are the
  // product invariant (docs/01-PRODUCT.md §2) in one sentence each.
  assert.match(markText('needs-you', { needsYou: 7 }), /runtime can't clear it/);
  assert.match(markText('office', {}), /Reading a message doesn't send them away/);
  assert.equal(markText('waiting-agent', {}), 'Click anyone.');
});

test('the whole sequence reads in under fifteen seconds', () => {
  // docs/plan/05-GUI-UX-SPEC.md §7: "Total reading time under 15 seconds
  // against the target of 60." Costed at 200 wpm, the slow end of the
  // measured range for screen prose.
  const seconds = readingSeconds(COACH_MARKS, { needsYou: 7 });
  assert.ok(
    seconds < READING_BUDGET_S,
    `the tour takes ${seconds.toFixed(1)}s to read, over the ${READING_BUDGET_S}s budget`,
  );
});

// -------------------------------------------------------------- selection

test('a mark with nothing to point at is dropped rather than shown lying', () => {
  // No waiting agent: the third mark has no agent to point at.
  assert.deepEqual(
    visibleMarks({ needsYou: 0, hasFloor: true }).map((m) => m.id),
    ['needs-you', 'office'],
  );
  // The renderer failed: both floor marks go, the header mark stays.
  assert.deepEqual(
    visibleMarks({ needsYou: 4, hasFloor: false }).map((m) => m.id),
    ['needs-you'],
  );
  assert.equal(visibleMarks({ needsYou: 4, hasFloor: true }).length, 3);
});

// --------------------------------------------------------------- sequence

test('the sequence walks forward and ends after the last mark', () => {
  let s = initialState();
  assert.deepEqual(s, { index: 0, done: false, skipped: false });
  s = advance(s, 'next', 3);
  assert.equal(s.index, 1);
  s = advance(s, 'next', 3);
  assert.equal(s.index, 2);
  s = advance(s, 'next', 3);
  assert.deepEqual(s, { index: 3, done: true, skipped: false });
});

test('skip ends it from anywhere, and a finished sequence ignores everything', () => {
  const skipped = advance({ index: 1, done: false, skipped: false }, 'skip', 3);
  assert.deepEqual(skipped, { index: 3, done: true, skipped: true });
  // A second Escape must not re-fire `onDone` and double-post the setting.
  assert.equal(advance(skipped, 'skip', 3), skipped);
  assert.equal(advance(skipped, 'next', 3), skipped);
});

// ------------------------------------------------------------- placement

test('a card is placed against its anchor and never leaves the window', () => {
  const view = { w: 1000, h: 700 };
  const size = { w: 320, h: 120 };

  const below = placeCard({ x: 400, y: 40, w: 80, h: 30 }, size, view, 'below');
  assert.equal(below.side, 'below');
  assert.ok(below.y > 40 + 30, 'the card overlaps the thing it is pointing at');
  assert.equal(below.x, 280); // centred on the anchor

  // An anchor at the bottom of the window flips the card above it.
  const flipped = placeCard({ x: 400, y: 660, w: 80, h: 30 }, size, view, 'auto');
  assert.equal(flipped.side, 'above');
  assert.ok(flipped.y >= 0);

  // An anchor at the right edge pulls the card back inside.
  const clamped = placeCard({ x: 980, y: 40, w: 20, h: 20 }, size, view, 'below');
  assert.ok(clamped.x + size.w <= view.w, 'the card hangs off the right of the window');
  assert.ok(clamped.x >= 0);
});

test('an anchor the size of the stage takes the card inside it, not beside it', () => {
  // The whole-canvas fallback. "Beside" a 1000x600 rectangle in a 1000x700
  // window means squeezed against the bottom edge, on top of the floor's own
  // quiet line — so it sits inside instead, with no arrow.
  const view = { w: 1000, h: 700 };
  const size = { w: 320, h: 120 };
  const at = placeCard({ x: 0, y: 48, w: 1000, h: 600 }, size, view, 'inside');
  assert.equal(at.side, 'none');
  assert.equal(at.x, 340);
  assert.ok(at.y > 48 && at.y + size.h < view.h - 8, 'the card left the stage');
});

// ----------------------------------------------------------- the DOM half

test('the tour shows one mark at a time and advances on the button', () => {
  const { layer, done } = mountTour();
  assert.equal(layer.hidden, false);
  assert.match(card(layer).textContent, /3 sessions are waiting on you/);
  assert.equal(nextBtn(layer).textContent, 'Next');

  nextBtn(layer).dispatch('click');
  assert.match(card(layer).textContent, /Reading a message doesn't send them away/);

  nextBtn(layer).dispatch('click');
  assert.equal(card(layer).textContent.includes('Click anyone.'), true);
  // The last one says so.
  assert.equal(nextBtn(layer).textContent, 'Got it');
  assert.deepEqual(done, [], 'the tour finished early');

  nextBtn(layer).dispatch('click');
  assert.deepEqual(done, [{ skipped: false }]);
  assert.equal(layer.hidden, true);
  assert.equal(layer.children.length, 0, 'the layer was not emptied');
});

test('Escape skips all three, once, and records it as skipped', () => {
  const { doc, layer, done } = mountTour();
  const prevented = doc.key('Escape');
  assert.equal(prevented, true, 'Escape must not also fall through to the floor map');
  assert.deepEqual(done, [{ skipped: true }]);
  assert.equal(layer.hidden, true);

  // Forever: the listener is gone, so a second Escape cannot re-fire onDone
  // (which is what POSTs `onboarded`).
  doc.key('Escape');
  assert.deepEqual(done, [{ skipped: true }], 'Escape fired onDone twice');
  assert.equal(doc.listenerCount('keydown'), 0, 'the tour left a keydown listener behind');
});

test('the Skip link ends the tour the same way Escape does', () => {
  const { layer, done } = mountTour();
  skipBtn(layer).dispatch('click');
  assert.deepEqual(done, [{ skipped: true }]);
});

test('a floor with nothing to point at finishes immediately rather than showing an empty card', () => {
  const doc = stubDoc();
  const layer = new StubNode('div');
  layer.hidden = true;
  const done = [];
  const marks = createCoachMarks({
    doc,
    layer,
    // No agents at all AND no waiting: `visibleMarks` keeps the header mark,
    // so this asserts the other end — a caller that supplies no marks.
    getSnapshot: () => ({ counts: { needsYou: 0 }, agents: [] }),
    anchorFor: () => null,
    onDone: (r) => done.push(r),
  });
  marks.start();
  // The header mark still has something to say, so the tour runs with one.
  assert.equal(marks.isRunning(), true);
  assert.equal(layer.querySelector('.coach-count').textContent, '1 / 1');
  nextBtn(layer).dispatch('click');
  assert.deepEqual(done, [{ skipped: false }]);
});

test('an anchor the renderer cannot place drops the pointer instead of guessing', () => {
  const doc = stubDoc();
  const layer = new StubNode('div');
  const marks = createCoachMarks({
    doc,
    layer,
    getSnapshot: () => ({ counts: { needsYou: 2 }, agents: [{ id: 'a' }] }),
    // What app.js's canvas fallback returns: a box, with no honest pointer.
    anchorFor: () => ({ x: 0, y: 0, w: 1200, h: 800, arrow: false }),
    onDone: () => {},
  });
  marks.start();
  assert.equal(card(layer).dataset.side, 'none');
  assert.equal(layer.querySelector('.coach-ring').hidden, true);
  marks.stop();
});

// ----------------------------------------------- the two floor marks, for real
//
// WP-13 shipped with marks 2 and 3 pointing at the WHOLE CANVAS, because the
// renderer exposed no geometry and `public/render/**` was another engineer's
// file (DEVIATIONS §108.1). `Scene.anchorFor` has since landed. These tests
// close the raise: they resolve the marks' own anchor descriptors through the
// renderer's real arithmetic over a real plan, and assert the answer is a room
// and a person rather than the fallback.

test('mark 2 points at the office and mark 3 at one person, not at the whole canvas', () => {
  const now = 1_800_000_000_000;
  const projects = [{ id: 'p0', name: 'deckhq', sessionCount: 2 }];
  const agents = [
    {
      id: 'a-wait',
      projectId: 'p0',
      ackState: 'active',
      activityState: 'for_review',
      reviewSince: now - 60_000,
      lastActivityAt: now - 60_000,
    },
    {
      id: 'a-desk',
      projectId: 'p0',
      ackState: 'active',
      activityState: 'working',
      lastActivityAt: now,
    },
  ];
  const plan = buildPlan(projects, agents, { targetAspect: 1.6, now });
  const runtime = new AgentRuntime();
  runtime.sync(agents, plan, assignSeats(plan, agents));

  const stage = { w: 1600, h: 900 };
  const scale = computeFitScale(plan.width, plan.height, stage.w, stage.h);
  const view = {
    plan,
    camera: { zoom: scale / U, panX: 0, panY: 0, U },
    scale,
    charScale: characterScaleFor(scale),
  };

  // Resolved exactly as `coachAnchorFor` resolves them: the mark names a
  // target, the agent mark names the head of the needs-you queue.
  const resolve = (mark) =>
    computeAnchor(mark.anchor.target, mark.anchor.target === 'agent' ? 'a-wait' : undefined, {
      ...view,
      record: mark.anchor.target === 'agent' ? runtime.get('a-wait') : null,
    });

  const [, officeMark, agentMark] = COACH_MARKS;
  assert.equal(officeMark.anchor.target, 'office');
  assert.equal(agentMark.anchor.target, 'agent');

  const office = resolve(officeMark);
  const person = resolve(agentMark);
  assert.ok(office, 'mark 2 fell through to the canvas fallback');
  assert.ok(person, 'mark 3 fell through to the canvas fallback');

  // Neither is the stage. The fallback returns the canvas's own box, so "is
  // this the whole canvas" is the exact question that separates a mark that
  // points from a mark that shrugs.
  for (const box of [office, person]) {
    assert.ok(box.w < stage.w && box.h < stage.h, 'an anchor is the size of the whole canvas');
    assert.ok(box.x >= -0.001 && box.y >= -0.001);
    assert.ok(box.x + box.w <= stage.w + 0.001 && box.y + box.h <= stage.h + 0.001);
  }
  // Mark 2 is the office room as the plan draws it, plate band and all.
  const room = plan.rooms.find((r) => r.kind === 'office');
  assert.ok(Math.abs(office.w - room.w * scale) < 1e-6);
  assert.ok(Math.abs(office.h - room.h * scale) < 1e-6);
  // Mark 3 is a body, and the person it names is standing in the office —
  // "Click anyone" has to be pointing at somebody the reader can see.
  assert.ok(person.w < office.w && person.h < office.h);
  assert.ok(person.x >= office.x - 1 && person.x + person.w <= office.x + office.w + 1);
  assert.ok(person.y >= office.y - 1 && person.y + person.h <= office.y + office.h + 1);
});

test('app.js asks the renderer first, and only falls back when it cannot answer', () => {
  const app = fs
    .readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
  const start = app.indexOf('function coachAnchorFor(');
  assert.notEqual(start, -1, 'coachAnchorFor() not found in app.js');
  const body = app.slice(start, app.indexOf('\nfunction ', start + 1));

  // The scene is asked before the canvas is measured, and the fallback is
  // still there for a renderer that failed to load.
  assert.match(body, /scene\.anchorFor\(anchor\.target, id\)/);
  assert.ok(
    body.indexOf('scene.anchorFor') < body.indexOf('arrow: false'),
    'the canvas fallback is reached before the renderer is asked',
  );
  assert.match(body, /arrow: false/);
  // And `Scene` really does export it, so the preferred path is not dead code.
  // WP-22 follow-up: `anchorFor` is on `SceneHit`, one link of the chain
  // `Scene` extends. The file list grew; the assertion did not.
  const scene = fs.readFileSync(path.join(ROOT, 'public', 'render', 'scene-hit.js'), 'utf8');
  assert.match(scene, /\n {2}anchorFor\(target, id\) \{/);
});

// --------------------------------------------------------------- security

test('SECURITY: the module never touches innerHTML or any HTML-parsing API', () => {
  const src = fs
    .readFileSync(path.join(ROOT, 'public', 'coach-marks.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');
  for (const forbidden of [
    'innerHTML',
    'outerHTML',
    'insertAdjacentHTML',
    'DOMParser',
    'eval(',
    'Function(',
  ]) {
    assert.ok(!src.includes(forbidden), `coach-marks.js uses ${forbidden}`);
  }
});

test('the modal it replaces is gone from the page', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
  assert.ok(!html.includes('id="onboarding-dialog"'), 'the first-run modal is still in index.html');
  assert.ok(html.includes('id="coach-layer"'), 'the coach-mark layer is missing');
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  assert.ok(!/onboardingDialog/.test(app), 'app.js still drives the first-run modal');
});
