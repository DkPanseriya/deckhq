/**
 * WP-52 — the thought bubble: what an agent is doing, above its head.
 *
 * `rig.js` only ever calls methods on the `ctx` it is handed (see its own
 * file header), so a recording stub is a real enough canvas for everything
 * this file asserts: which of the three above-head things got drawn, and what
 * text — if any — was put on the floor.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { drawCharacter, makePose, toolBubbleBox, toolIconKind } from '../../public/render/rig.js';
import { STATE_COLORS } from '../../public/render/palette.js';

// ---------------------------------------------------------------- fake ctx

/** @returns {{calls: Array<{kind:string, text?:string}>, ctx: any}} */
function makeFakeCtx() {
  /** @type {Array<{kind:string, text?:string, x?:number, y?:number, w?:number, h?:number}>} */
  const calls = [];
  const record =
    (kind) =>
    (...args) =>
      calls.push({ kind, args });
  const ctx = {
    save: record('save'),
    restore: record('restore'),
    translate: record('translate'),
    rotate: record('rotate'),
    scale: record('scale'),
    beginPath: record('beginPath'),
    closePath: record('closePath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    quadraticCurveTo: record('quadraticCurveTo'),
    arc: (x, y, r) => calls.push({ kind: 'arc', x, y, r }),
    ellipse: record('ellipse'),
    rect: record('rect'),
    fill: record('fill'),
    stroke: record('stroke'),
    fillRect: record('fillRect'),
    strokeRect: record('strokeRect'),
    setLineDash: record('setLineDash'),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    fillText: (text, x, y) => calls.push({ kind: 'fillText', text: String(text), x, y }),
    strokeText: (text, x, y) => calls.push({ kind: 'strokeText', text: String(text), x, y }),
    // A stable, monospace-ish metric: every assertion below is about the fit
    // RULE, not about a particular font's metrics.
    measureText: (t) => ({ width: String(t).length * 6 }),
  };
  for (const prop of [
    'fillStyle',
    'strokeStyle',
    'lineWidth',
    'lineCap',
    'lineJoin',
    'globalAlpha',
    'font',
    'textAlign',
    'textBaseline',
  ]) {
    ctx[prop] = null;
  }
  return { calls, ctx };
}

const SUMMARY = 'Bash npm test';
const TOOL = { name: 'Bash', summary: SUMMARY };

/** Every string this frame put on the canvas. */
function textsDrawn(calls) {
  return calls.filter((c) => c.kind === 'fillText' || c.kind === 'strokeText').map((c) => c.text);
}

/**
 * @param {object} over
 * @returns {{calls: Array<any>, texts: string[]}}
 */
function render(over = {}) {
  const { calls, ctx } = makeFakeCtx();
  drawCharacter(ctx, makePose(), {
    x: 200,
    y: 140,
    u: 16,
    lod: 1,
    color: STATE_COLORS.working,
    ...over,
  });
  return { calls, texts: textsDrawn(calls) };
}

// ------------------------------------------------------------ tool classes

test('toolIconKind: file, shell and web tools each get their own class', () => {
  for (const name of ['Read', 'Edit', 'Write', 'MultiEdit', 'Glob', 'Grep']) {
    assert.equal(toolIconKind(name), 'file', name);
  }
  for (const name of ['Bash', 'BashOutput', 'KillShell']) {
    assert.equal(toolIconKind(name), 'shell', name);
  }
  for (const name of ['WebFetch', 'WebSearch']) {
    assert.equal(toolIconKind(name), 'web', name);
  }
});

test('toolIconKind: anything unknown is "other", never nothing', () => {
  // An MCP tool, a runtime that invents its own name, a missing name: the
  // agent IS doing something, and L0 must still say so.
  for (const name of ['mcp__github__create_issue', 'Task', 'TodoWrite', '', null, undefined]) {
    assert.equal(toolIconKind(name), 'other', String(name));
  }
});

// ------------------------------------------------------------- the measure

test('toolBubbleBox: one line, above the head, never wider than its ceiling', () => {
  const { ctx } = makeFakeCtx();
  const box = toolBubbleBox(ctx, 200, 140, 16, SUMMARY);
  assert.equal(box.text, SUMMARY, 'a short summary is not touched');
  assert.ok(box.h < 40, `a one-line bubble, got ${box.h}px tall`);
  assert.ok(box.y + box.h < 140, 'the bubble must sit above the character origin');
  assert.ok(box.w <= 150, `bubble is ${box.w}px wide, past the 150px ceiling`);
  // Centred on the character.
  assert.ok(Math.abs(box.x + box.w / 2 - 200) < 0.001);
});

test('toolBubbleBox: a long summary is truncated to fit, and stays a prefix of the original', () => {
  const long = 'Bash ' + 'npm run build --workspace packages/everything --verbose '.repeat(3);
  const { ctx } = makeFakeCtx();
  const box = toolBubbleBox(ctx, 0, 0, 16, long);
  assert.ok(box.w <= 150, `${box.w}px wide`);
  assert.ok(box.text.endsWith('…'));
  assert.ok(
    long.startsWith(box.text.slice(0, -1).trimEnd()),
    `"${box.text}" is not a prefix of the summary — the floor must never invent text`,
  );
  assert.equal(box.text.includes('\n'), false);
});

test('toolBubbleBox: survives an empty or absent summary without throwing', () => {
  const { ctx } = makeFakeCtx();
  for (const value of ['', null, undefined]) {
    assert.doesNotThrow(() => toolBubbleBox(ctx, 0, 0, 14, value));
  }
});

// ------------------------------------------------------------- the drawing

test('L1: the summary is drawn above the head, as canvas text', () => {
  const { texts } = render({ tool: TOOL });
  assert.ok(texts.includes(SUMMARY), `expected "${SUMMARY}" on the canvas, got ${texts.join('|')}`);
});

test('L0: the tool class is drawn, and the summary is not', () => {
  const withTool = render({ tool: TOOL, lod: 0 });
  const without = render({ lod: 0 });
  assert.equal(withTool.texts.includes(SUMMARY), false, 'no text at L0');
  assert.ok(
    withTool.calls.length > without.calls.length,
    'L0 with a running tool must draw something the same character without one does not',
  );
});

test('reduced motion: the icon only, never the sentence', () => {
  for (const lod of [0, 1, 2]) {
    const { texts } = render({ tool: TOOL, lod, reduced: true, label: 'MK1.1' });
    assert.equal(
      texts.includes(SUMMARY),
      false,
      `lod ${lod} drew the summary under reduced motion`,
    );
  }
});

test('the bubble yields to a raised hand and to a waiting badge', () => {
  // Above the head is one slot, and what the user has to ACT on owns it.
  for (const chrome of [{ icon: 'hand' }, { icon: 'check' }, { badge: '2d 4h' }]) {
    const { texts } = render({ tool: TOOL, ...chrome });
    assert.equal(
      texts.includes(SUMMARY),
      false,
      `the bubble was drawn beside ${JSON.stringify(chrome)}`,
    );
  }
  // ...and the badge itself is still drawn.
  assert.ok(render({ tool: TOOL, badge: '2d 4h' }).texts.includes('2d 4h'));
});

test('no tool means nothing new is drawn: the bubble is opt-in', () => {
  const before = render({});
  const after = render({ tool: null });
  assert.equal(after.calls.length, before.calls.length);
});

test('drawCharacter with a tool does not throw at any LOD, with or without other chrome', () => {
  for (const lod of [0, 1, 2]) {
    for (const extra of [{}, { icon: 'hand' }, { badge: '9m' }, { label: 'MK2.3' }]) {
      assert.doesNotThrow(
        () => render({ tool: { name: 'mcp__x__y', summary: 'x'.repeat(120) }, lod, ...extra }),
        `lod ${lod} ${JSON.stringify(extra)}`,
      );
    }
  }
});
