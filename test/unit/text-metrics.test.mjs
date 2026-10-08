/**
 * The kept widths of floor text (`public/render/text-metrics.js`).
 *
 * A name, a badge and a plate line are measured before they are drawn, and
 * were measured again on every frame. The width is kept now, so what has to
 * hold is that a kept width is the width `measureText` would have given — for
 * that context, that font and that string — and that it is forgotten when it
 * stops being true.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TEXT_METRICS_MAX,
  forgetTextMetrics,
  textMetricsEpoch,
  textWidth,
} from '../../public/render/text-metrics.js';
import { badgeBox, labelBox } from '../../public/render/rig.js';
import { ellipsise, layoutPlate } from '../../public/render/scene-labels.js';
import { fitOneLine, toolBubbleBox } from '../../public/render/rig-bubble.js';

/** A context that measures by the font it was last given, and counts. */
function ruler(perChar = 0.6) {
  return {
    font: '10px sans-serif',
    measured: 0,
    fontSets: 0,
    _font: '10px sans-serif',
    measureText(text) {
      this.measured++;
      const px = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1] ?? 10);
      return { width: String(text).length * px * perChar };
    },
  };
}

test('a width is measured once per font and string, and is the measured width', () => {
  const ctx = ruler();
  const a = textWidth(ctx, '12px sans-serif', 'Ada');
  assert.equal(a, 3 * 12 * 0.6);
  assert.equal(ctx.measured, 1);
  for (let i = 0; i < 50; i++) assert.equal(textWidth(ctx, '12px sans-serif', 'Ada'), a);
  assert.equal(ctx.measured, 1, 'asked fifty times more, measured not once more');
  // Another font is another width, and another string another.
  assert.equal(textWidth(ctx, '20px sans-serif', 'Ada'), 3 * 20 * 0.6);
  assert.equal(textWidth(ctx, '12px sans-serif', 'Grace'), 5 * 12 * 0.6);
  assert.equal(ctx.measured, 3);
});

test('a kept width leaves the font alone; a measured one sets it', () => {
  const ctx = ruler();
  textWidth(ctx, '12px sans-serif', 'Ada');
  assert.equal(ctx.font, '12px sans-serif');
  ctx.font = '700 9px monospace';
  textWidth(ctx, '12px sans-serif', 'Ada');
  assert.equal(ctx.font, '700 9px monospace', 'a kept answer assigns no font');
});

test('a width belongs to the context that measured it', () => {
  const narrow = ruler(0.5);
  const wide = ruler(0.9);
  assert.equal(textWidth(narrow, '10px sans-serif', 'name'), 4 * 10 * 0.5);
  assert.equal(textWidth(wide, '10px sans-serif', 'name'), 4 * 10 * 0.9);
  assert.equal(textWidth(narrow, '10px sans-serif', 'name'), 4 * 10 * 0.5);
});

test('every width is forgotten when a font finishes loading', () => {
  const ctx = ruler();
  const before = textMetricsEpoch();
  textWidth(ctx, '12px sans-serif', 'Ada');
  forgetTextMetrics();
  assert.equal(textMetricsEpoch(), before + 1);
  textWidth(ctx, '12px sans-serif', 'Ada');
  assert.equal(ctx.measured, 2);
});

test('a context that has measured a great many strings starts over', () => {
  const ctx = ruler();
  for (let i = 0; i < TEXT_METRICS_MAX; i++) textWidth(ctx, '12px sans-serif', `s${i}`);
  assert.equal(ctx.measured, TEXT_METRICS_MAX);
  textWidth(ctx, '12px sans-serif', 's0');
  assert.equal(ctx.measured, TEXT_METRICS_MAX + 1, 'the table was dropped, not grown');
  textWidth(ctx, '12px sans-serif', 's0');
  assert.equal(ctx.measured, TEXT_METRICS_MAX + 1);
});

test('the boxes the floor measures are the same boxes, asked twice or two hundred times', () => {
  const ctx = ruler();
  const fresh = () => ruler();
  const plate = {
    lines: [
      'orbital-api',
      '3 need you · oldest 2h 10m',
      'editing rate-limit.ts, running tests',
      '5.8M today',
    ],
    heroHead: '3 need you',
    doing: ['editing rate-limit.ts', 'running tests'],
    dot: '#C0392B',
    tooltip: '',
  };
  const room = { id: 'r', kind: 'project', x: 2, y: 3, w: 9, h: 12, name: 'orbital-api' };
  const camera = { zoom: 1, panX: 10, panY: 20, U: 14 };
  const ask = (c) => ({
    label: labelBox(c, 100, 200, 14, 'Ada Lovelace the Second'),
    small: labelBox(c, 100, 200, 14, 'Ada', 9),
    badge: badgeBox(c, 100, 200, 14, '2h 10m'),
    bubble: toolBubbleBox(c, 100, 200, 14, 'Edit src/core/a-very-long-file-name-indeed.mjs'),
    plate: layoutPlate(c, room, plate, camera),
    cut: ellipsise(c, 'a room with a long name', 60, '600 11px sans-serif'),
    fit: fitOneLine(c, 'a summary too long for its bubble', 70, '9px sans-serif'),
  });
  const first = ask(ctx);
  const measured = ctx.measured;
  assert.ok(measured > 0);
  for (let i = 0; i < 200; i++) assert.deepEqual(ask(ctx), first);
  assert.equal(ctx.measured, measured, 'two hundred frames measured nothing');
  // And a context that has kept nothing gives the same boxes.
  assert.deepEqual(ask(fresh()), first);
});

test('without a font, the two fitters measure the context as it stands', () => {
  const ctx = ruler();
  ctx.font = '10px sans-serif';
  assert.equal(ellipsise(ctx, 'abcdefghij', 30), 'abcd…');
  assert.equal(fitOneLine(ctx, 'abcdefghij', 30), 'abcd…');
  const n = ctx.measured;
  ellipsise(ctx, 'abcdefghij', 30);
  assert.ok(ctx.measured > n, 'nothing is kept for a font nobody named');
});
