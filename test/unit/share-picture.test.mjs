/**
 * The share picture's frame, its band, and the sheet's promises.
 *
 * `share-redact.test.mjs` proves what the picture is drawn FROM. This file is
 * about the picture: that the band says only what the floor says, that the
 * frame is the shape it claims, that the mark is the mark — and three things
 * about the sheet that are promises rather than behaviour: it opens with
 * everything hidden, it says in one line that nothing is sent, and its modules
 * talk to nothing but the two snapshot routes.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MARK_SHAPES,
  SHARE_FOOTER,
  SHARE_MARGIN,
  SHARE_SCALE,
  SHARE_SHAPES,
  composeSharePicture,
  fitParts,
  shareFooterModel,
  shareLayout,
} from '../../public/share-picture.js';
import { redactForShare } from '../../public/share-redact.js';
import { BADGE_MIN_PX_PER_UNIT } from '../../public/render/scene.js';
import { buildCommandEntries } from '../../public/palette-commands.js';
import { paintRecorder } from '../helpers/paint-recorder.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (file) => readFile(path.join(REPO, file), 'utf8');
const NOW = 1_800_000_000_000;
const HOUR = 3_600_000;

function floor() {
  const agent = (id, extra) => ({
    id: `claude-code:${id}`,
    projectId: 'p-secret-acquisition',
    projectName: 'secret-acquisition',
    title: `Title ${id}`,
    ackState: 'active',
    activityState: 'working',
    reviewSince: null,
    needsInputSince: null,
    ...extra,
  });
  return {
    agents: [
      agent('a'),
      agent('b', { activityState: 'for_review', reviewSince: NOW - 26 * HOUR }),
      agent('c', { activityState: 'needs_input', needsInputSince: NOW - 2 * HOUR }),
      agent('d', { ackState: 'benched', activityState: 'ended', reviewSince: NOW - 90 * HOUR }),
      agent('e', { ackState: 'let_go', activityState: 'ended' }),
      agent('f', { subagent: true, parentId: 'claude-code:a' }),
    ],
    projects: [{ id: 'p-secret-acquisition', name: 'secret-acquisition' }, { id: 'p-two' }],
    counts: { needsYou: 2, handsUp: 1, forReview: 1, working: 2 },
    now: NOW,
  };
}

test('the band is one line of the floor’s own numbers', () => {
  const model = shareFooterModel(floor());
  // Four sessions somebody started and has not fired; the junior is not one.
  assert.equal(model.line, '2 need you · 1 hand up · oldest 1d 2h · 4 sessions, 2 rooms');
  assert.equal(model.wordmark, 'deckhq.dev');
  assert.equal(model.name, 'DeckHQ');
  // The benched agent's 90 hours are not a wait: nobody is waiting on a bench.
  assert.equal(model.line.includes('3d'), false);
  // The rooms the picture draws, where the caller counted them.
  assert.match(shareFooterModel(floor(), { rooms: 1 }).line, /4 sessions, 1 room$/);
});

test('a part with nothing to report is left out, not printed as a zero', () => {
  const quiet = { ...floor(), counts: { needsYou: 0, handsUp: 0 } };
  quiet.agents = quiet.agents.slice(0, 1);
  assert.equal(shareFooterModel(quiet).line, 'nobody waiting · 1 session, 2 rooms');
  assert.equal(shareFooterModel(null).line, 'nobody waiting · 0 sessions, 0 rooms');
  const one = { ...floor(), counts: { needsYou: 1, handsUp: 0 } };
  assert.match(shareFooterModel(one).line, /^1 needs you · oldest 1d 2h · /);
});

test('the band reads the same off the redacted copy, and names nothing', () => {
  const real = floor();
  const safe = redactForShare(real);
  assert.equal(shareFooterModel(safe).line, shareFooterModel(real).line);
  const drawn = JSON.stringify(shareFooterModel(safe));
  assert.equal(drawn.includes('secret'), false);
  assert.equal(drawn.includes('Title'), false);
});

test('the two frames are 16:9 and 1:1, at a whole 2x, with or without the band', () => {
  const wide = shareLayout('wide', true);
  assert.equal(wide.w / wide.h, 16 / 9);
  assert.equal(wide.scale, 2);
  assert.equal(SHARE_SCALE, 2);
  assert.equal(wide.floorH + wide.footerH, wide.h);
  assert.equal(wide.footerH, SHARE_FOOTER.height);
  assert.equal(shareLayout('wide', false).floorH, wide.h);
  const square = shareLayout('square', true);
  assert.equal(square.w, square.h);
  // A slim band: under a tenth of either frame.
  assert.ok(SHARE_FOOTER.height / wide.h < 0.1 && SHARE_FOOTER.height / square.h < 0.1);
  // An unknown shape is the wide one, never a zero-sized canvas.
  assert.deepEqual(shareLayout('hexagon', true), wide);
  assert.deepEqual(Object.keys(SHARE_SHAPES), ['wide', 'square']);
});

test('the wide frame is tall enough that the demo floor keeps its wait badges', async () => {
  // The reason the frame is 1760 x 990 and not 1600 x 900: measured on the demo
  // floor, whose building is 58.2 units tall whatever width it is given.
  const { buildPlan } = await import('../../public/render/plan.js');
  const { computeFill, computeTargetAspect } = await import('../../public/render/scene.js');
  const { populationFloor } = await import('../helpers/large-floor.mjs');
  const { projects, agents } = populationFloor('demo', NOW);
  const scaleIn = (w, h) => {
    const box = { w: w - SHARE_MARGIN * 2, h: h - SHARE_FOOTER.height - SHARE_MARGIN * 2 };
    const plan = buildPlan(projects, agents, {
      now: NOW,
      stage: box,
      targetAspect: computeTargetAspect(box.w, box.h),
    });
    return computeFill(plan.width, plan.height, box.w, box.h).scale;
  };
  assert.ok(scaleIn(SHARE_SHAPES.wide.w, SHARE_SHAPES.wide.h) >= BADGE_MIN_PX_PER_UNIT);
  assert.ok(scaleIn(1600, 900) < BADGE_MIN_PX_PER_UNIT, 'and 1600 x 900 was not');
});

test('the picture is the floor copied pixel for pixel, and the band under it', () => {
  const ctx = paintRecorder();
  const made = [];
  const layout = shareLayout('wide', true);
  const floorCanvas = { width: layout.w * 2, height: layout.floorH * 2 };
  const colors = {
    bg: 'BG',
    surface: 'SURFACE',
    line: 'LINE',
    ink: 'INK',
    ink2: 'INK2',
    muted: 'MUTED',
  };
  const out = composeSharePicture({
    floor: /** @type {any} */ (floorCanvas),
    layout,
    footer: shareFooterModel(floor()),
    colors,
    makeCanvas: (w, h) => {
      made.push([w, h]);
      return /** @type {any} */ ({ width: w, height: h, getContext: () => ctx });
    },
  });
  assert.deepEqual(made, [[3520, 1980]]);
  assert.equal(out.width / out.height, 16 / 9);
  // Never resampled: drawn at its own size, with smoothing off.
  assert.equal(ctx.imageSmoothingEnabled, false);
  assert.equal(ctx.counts.drawImage, 1);
  const texts = ctx.paints.filter((p) => p.op === 'fillText').map((p) => p.args[0]);
  assert.deepEqual(texts, [
    'DeckHQ',
    'deckhq.dev',
    '2 need you · 1 hand up · oldest 1d 2h · 4 sessions, 2 rooms',
  ]);
  // Every colour in the band is one it was handed: a chrome token, not a literal.
  const used = new Set(ctx.paints.map((p) => p.style));
  for (const style of used) assert.ok(Object.values(colors).includes(style), `raw colour ${style}`);

  // Without the band there is no text in the picture at all but the floor's own.
  const bare = paintRecorder();
  composeSharePicture({
    floor: /** @type {any} */ ({ width: 3520, height: 1980 }),
    layout: shareLayout('wide', false),
    footer: null,
    colors,
    makeCanvas: (w, h) => /** @type {any} */ ({ width: w, height: h, getContext: () => bare }),
  });
  assert.equal(bare.paints.filter((p) => p.op === 'fillText').length, 0);
});

test('a line too long for the band loses parts from the back, never the headline', () => {
  const ctx = { measureText: (t) => ({ width: t.length * 10 }) };
  const parts = ['7 need you', '2 hands up', 'oldest 1d 2h', '21 sessions, 5 rooms'];
  assert.equal(fitParts(ctx, parts, 10_000), parts.join(' · '));
  assert.equal(fitParts(ctx, parts, 400), '7 need you · 2 hands up · oldest 1d 2h');
  assert.equal(fitParts(ctx, parts, 20), '7 need you');
  assert.equal(fitParts(ctx, [], 20), '');
});

test('the mark in the band is the mark: shape for shape, public/brand/deckhq-mark.svg', async () => {
  const svg = await read('public/brand/deckhq-mark.svg');
  const num = (tag, name) => Number((new RegExp(`\\s${name}="([\\d.]+)"`).exec(tag) || [0, 0])[1]);
  /** @type {number[][]} */
  const drawn = [];
  for (const [tag] of svg.matchAll(/<(rect|circle)\b[^>]*>/g)) {
    if (tag.startsWith('<circle')) {
      const r = num(tag, 'r');
      drawn.push([num(tag, 'cx') - r, num(tag, 'cy') - r, r * 2, r * 2, r]);
    } else {
      drawn.push([
        num(tag, 'x'),
        num(tag, 'y'),
        num(tag, 'width'),
        num(tag, 'height'),
        num(tag, 'rx'),
      ]);
    }
  }
  assert.equal(drawn.length, 6);
  assert.deepEqual(
    MARK_SHAPES.map((shape) => shape.slice(0, 5)),
    drawn,
  );
});

test('the sheet opens with everything hidden, and says where the picture goes', async () => {
  const sheet = await read('public/share-sheet.js');
  const defaults = /SHARE_DEFAULTS = Object\.freeze\(\{([^}]*)\}\)/.exec(sheet);
  assert.ok(defaults, 'SHARE_DEFAULTS is a literal this test can read');
  assert.match(defaults[1], /hideProjects: true/);
  assert.match(defaults[1], /hideDetails: true/);
  assert.match(defaults[1], /footer: true/);
  assert.match(defaults[1], /shape: 'wide'/);
  // Reset on every open, so a switch turned off once is not off next week.
  assert.match(sheet, /options = \{ \.\.\.SHARE_DEFAULTS \};\s+ui\.reveal\.hidden = true;/);
  for (const label of ['Hide project names', 'Hide session details', 'Add the footer']) {
    assert.ok(sheet.includes(`label: '${label}'`), label);
  }
  for (const word of ['Copy image', 'Reveal file', 'Save picture']) assert.ok(sheet.includes(word));
  const note = /SHARE_NOTE =\s+([^;]+);/.exec(sheet);
  assert.ok(note && /Nothing is uploaded/.test(note[1]) && /no network call/.test(note[1]));
});

test('INVARIANT: making a share picture reaches no session — the routes it can call are two', async () => {
  const files = ['public/share-sheet.js', 'public/share-picture.js', 'public/share-redact.js'];
  for (const file of files) {
    const source = await read(file);
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    // No acknowledgement, no send, no panel: nothing that changes a session.
    for (const never of [
      '/api/ack',
      '/api/send',
      '/api/settle',
      'performAction',
      'XMLHttpRequest',
    ]) {
      assert.equal(code.includes(never), false, `${file} mentions ${never}`);
    }
    // No address but this daemon's own, and of its routes only "reveal".
    assert.equal(/https?:\/\//.test(code), false, `${file} names a URL`);
    assert.equal(/WebSocket|sendBeacon|EventSource/.test(code), false, file);
    const routes = [...code.matchAll(/fetch\(\s*(['"`])([^'"`]+)\1/g)].map((m) => m[2]);
    assert.deepEqual(routes, file.endsWith('share-sheet.js') ? ['/api/snapshot/reveal'] : []);
  }
  // The save goes through the function `S` saves with, handed in by its module.
  const snapshot = await read('public/app-snapshot.js');
  assert.match(snapshot, /sheet\.openShareSheet\(\{\s+copyPng,\s+saveSnapshot,/);
});

test('the redaction is used by the share sheet and by nothing else', async () => {
  const { readdir } = await import('node:fs/promises');
  const users = [];
  for (const name of await readdir(path.join(REPO, 'public'))) {
    if (!name.endsWith('.js') || name === 'share-redact.js') continue;
    // An import of it, not a mention in a comment.
    if ((await read(`public/${name}`)).includes("from './share-redact.js'")) users.push(name);
  }
  assert.deepEqual(users, ['share-sheet.js']);
});

test('the palette has the row, and it has no accelerator to collide with', () => {
  let ran = 0;
  const entries = buildCommandEntries({
    snapshot: { settings: {}, agents: [], projects: [] },
    letGoVisible: false,
    actions: { sharePicture: () => ran++ },
  });
  const row = entries.find((e) => e.id === 'cmd:share-picture');
  assert.ok(row);
  assert.equal(row.label, 'Share picture of the floor…');
  assert.equal(row.accel, undefined);
  assert.ok(row.keywords.includes('share'));
  row.run();
  assert.equal(ran, 1);
});
