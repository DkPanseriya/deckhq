/**
 * A LEADER NEVER CROSSES A FIGURE, AND TWO TAGS ARE NEVER ONE BLOCK (11 October).
 *
 * Two things the product's own picture of a crew showed (`crew`, the golden
 * and the site's): the line tying `Junior / test-engineer` to its junior ran
 * down through that junior's head and body, the line of `Explore ×2` ran
 * across the junior beside it, and two juniors' tags sat one directly on the
 * other on the far side of somebody else.
 *
 * Geometry, asked of the real plan, the real seats and the frame's own label
 * pass (`test/helpers/label-frame.mjs`), through a context that only measures.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { populationFloor } from '../helpers/large-floor.mjs';
import { drawnBox, figuresOf, frameAt, leaderOf } from '../helpers/label-frame.mjs';
import { worldToScreen } from '../../public/render/agents.js';
import { resolveLabelCollisions, TAG_GAP_PX } from '../../public/render/label-spots.js';
import { figureBox, leaderFor, segmentEnters } from '../../public/render/leader-line.js';

/** The owner's CSS stage, the full window's, and the goldens'. */
const STAGES = [
  [1420, 690],
  [2000, 1024],
  [1600, 869],
];

/** The floors the rules are held over; `wide` is `three` in a 1920 × 1080 window. */
const FLOORS = [
  ...['crew', 'demo', 'crowded', 'away', 'three', 'pair'].flatMap((name) =>
    STAGES.map(([w, h]) => [name, w, h]),
  ),
  ['three', 1920, 949],
];

/** A box drawn in by `by` on every side: what is inside a figure, not on its edge. */
const inset = (r, by) => ({ x: r.x + by, y: r.y + by, w: r.w - by * 2, h: r.h - by * 2 });

test('a leader crosses no figure: it ends at the edge of its own and passes over nobody else', () => {
  let leaders = 0;
  for (const [name, w, h] of FLOORS) {
    const f = frameAt(w, h, () => populationFloor(name), { badges: true });
    const figures = figuresOf(f);
    const names = f.labels.labels
      .filter((it) => f.labels.plan.get(it.id))
      .map((it) => drawnBox(it, f.labels.plan.get(it.id)));
    const chrome = f.labels.obstacles.filter((o) => /^(badge|pill|chip|plate):/.test(o.id));
    for (const it of f.labels.labels) {
      const line = leaderOf(it, f.labels.plan.get(it.id));
      if (!line) continue;
      leaders++;
      const who = `${name} ${w}x${h}: the leader of ${f.labels.texts.get(it.id)}`;
      for (let i = 0; i + 3 < line.length; i += 2) {
        const [ax, ay, bx, by] = line.slice(i, i + 4);
        for (const fig of figures) {
          // Touching a figure's edge is not crossing it; a hair inside is.
          const over = segmentEnters(ax, ay, bx, by, inset(fig, 0.25));
          assert.equal(over, null, `${who} crosses ${f.agentsById.get(fig.id).label}`);
        }
        // Nor through anybody else's name, nor a badge or a chip.
        for (const other of [...names, ...chrome]) {
          if (other.id === it.id || other.id === `badge:${it.id}`) continue;
          const over = segmentEnters(ax, ay, bx, by, inset(other, 0.25));
          assert.equal(over, null, `${who} crosses ${f.labels.texts.get(other.id) || other.id}`);
        }
      }
      // It ends ON a figure's edge: its own, or another of the type it names.
      const [ex, ey] = line.slice(-2);
      const ends = figures.filter(
        (b) =>
          ex >= b.x - 0.01 && ex <= b.x + b.w + 0.01 && ey >= b.y - 0.01 && ey <= b.y + b.h + 0.01,
      );
      assert.ok(ends.length > 0, `${who} ends at nobody`);
    }
  }
  assert.ok(leaders >= 10, `these floors draw leaders: ${leaders}`);
});

test('a leader is straight where that is clear, bent round a figure in its way, and cut short last', () => {
  const own = figureBox(100, 100, 10);
  assert.deepEqual(own, { x: 100 - 6.75, y: 100 - 25.2, w: 13.5, h: 25.2 });
  // Over the head: from the name's foot to the crown, not to the feet.
  const over = { x: 80, y: 40, w: 40, h: 12 };
  assert.deepEqual(leaderFor(over, own, []), { line: [100, 52, 100, own.y], clear: true });
  // Down and to the right: corner to corner.
  const aside = { x: 140, y: 110, w: 40, h: 12 };
  assert.deepEqual(leaderFor(aside, own, []).line, [140, 110, own.x + own.w, 100]);
  // Somebody standing on that line: out along one axis, in along the other.
  const far = { x: 200, y: 130, w: 40, h: 12 };
  const between = { x: 140, y: 100, w: 20, h: 25 };
  const bent = leaderFor(far, own, [between]);
  assert.equal(bent.clear, false);
  assert.equal(bent.line.length, 6, 'one bend');
  assert.deepEqual(bent.line.slice(-2), [own.x + own.w, 100], 'and it still reaches its figure');
  for (let i = 0; i + 3 < bent.line.length; i += 2) {
    const [ax, ay, bx, by] = bent.line.slice(i, i + 4);
    assert.equal(segmentEnters(ax, ay, bx, by, between), null);
    assert.equal(segmentEnters(ax, ay, bx, by, own), null);
  }
  // Walled in on both bends: cut short of the first figure, pointing at its own.
  const wall = [between, { x: 120, y: 120, w: 40, h: 20 }, { x: 190, y: 105, w: 20, h: 15 }];
  const cut = leaderFor(far, own, wall);
  assert.equal(cut.clear, false);
  assert.equal(cut.line.length, 4);
  for (const r of wall) assert.equal(segmentEnters(...cut.line.slice(0, 4), r), null);
});

// ------------------------------------------------ two tags are never one block

/** The crews these rules are asked of: an arc of five, one of thirteen, and a small one. */
const CREW_FLOORS = ['crew', 'crew-waiting', 'large', 'demo', 'lead'].flatMap((name) =>
  [...STAGES.map(([w, h]) => [w, h, 1]), [1600, 869, 2.5]].map(([w, h, zoom]) => [
    name,
    w,
    h,
    zoom,
  ]),
);

test('a two-row tag keeps its air: no name is set directly over or under one', () => {
  let tags = 0;
  for (const [name, w, h, zoom] of CREW_FLOORS) {
    const f = frameAt(w, h, () => populationFloor(name), { badges: true, zoom });
    const names = f.labels.labels
      .filter((it) => f.labels.plan.get(it.id))
      .map((it) => ({
        ...drawnBox(it, f.labels.plan.get(it.id)),
        tag: f.labels.roles.has(it.id),
      }));
    tags += names.filter((n) => n.tag).length;
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const [a, b] = [names[i], names[j]];
        if (!a.tag && !b.tag) continue;
        if (a.x >= b.x + b.w || b.x >= a.x + a.w) continue;
        const air = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h));
        const who = `${name} ${w}x${h} x${zoom}: ${f.labels.texts.get(a.id)} and ${f.labels.texts.get(b.id)}`;
        assert.ok(air >= TAG_GAP_PX - 0.01, `${who} are ${air.toFixed(1)} px apart`);
      }
    }
  }
  assert.ok(tags > 40, `these floors draw tags: ${tags}`);
  // The rule itself: a tag whose own place is right under another name steps aside.
  const upper = { id: 'a', x: 60, y: 104, w: 80, h: 24, keep: true };
  const tag = { id: 't', x: 60, y: 129, w: 80, h: 24, keep: true, gap: TAG_GAP_PX };
  assert.deepEqual(resolveLabelCollisions([upper, { ...tag, gap: 0 }]).get('t'), { offsetY: 0 });
  assert.deepEqual(resolveLabelCollisions([upper, tag]).get('t'), { offsetY: 24 }, 'a line down');
  // Whichever of the two is the tag, and whichever was set first.
  const first = resolveLabelCollisions([{ ...tag, y: 79 }, upper]);
  assert.deepEqual(first.get('t'), { offsetY: 0 });
  assert.deepEqual(first.get('a'), { offsetY: 24 });
  // Side by side they are two columns, and nothing moves.
  const beside = resolveLabelCollisions([upper, { ...tag, x: 141, y: 104 }]);
  assert.deepEqual(beside.get('t'), { offsetY: 0 });
});

test('a junior’s tag that has left it is on its own side of the arc, not the desk’s', () => {
  let tied = 0;
  let over = 0;
  let aside = 0;
  for (const [name, w, h, zoom] of CREW_FLOORS) {
    // A preference, held wherever it can be. On the floor of a hundred and
    // fifty a tag is five times the size of the junior it names and the arc is
    // against its room's top wall: there, some tags have no place on their own
    // side at all, and take the one place they have.
    if (name === 'large') continue;
    const f = frameAt(w, h, () => populationFloor(name), { badges: true, zoom });
    const figures = figuresOf(f);
    for (const it of f.labels.labels) {
      const spot = f.labels.plan.get(it.id);
      const line = leaderOf(it, spot);
      const seat = f.records.find((r) => r.id === it.id).targetSeat;
      if (!line || !seat || seat.crew !== true) continue;
      // The junior the line ends at: its own, or another of the type it says.
      const [ex, ey] = line.slice(-2);
      const at = figures
        .filter((b) => f.seats.get(b.id)?.crewOf === seat.crewOf)
        .find(
          (b) =>
            ex >= b.x - 0.01 &&
            ex <= b.x + b.w + 0.01 &&
            ey >= b.y - 0.01 &&
            ey <= b.y + b.h + 0.01,
        );
      if (!at) continue;
      tied++;
      const feet = { x: at.x + at.w / 2, y: at.y + at.h };
      const desk = worldToScreen(seat.crewAnchor || f.seats.get(seat.crewOf), f.camera);
      const away = { x: feet.x - desk.x, y: feet.y - desk.y };
      const far = Math.hypot(away.x, away.y) || 1;
      const box = drawnBox(it, spot);
      const mid = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      const who = `${name} ${w}x${h} x${zoom}: ${f.labels.texts.get(it.id)}`;
      // Above its desk: the tag is over it, not between it and the desk.
      if (away.y < -0.38 * far) {
        over++;
        assert.ok(mid.y < feet.y, `${who} is under a junior that sits above its desk`);
      }
      // To one side of its desk: the tag is not on the desk's side of it.
      if (Math.abs(away.x) > 0.38 * far) {
        aside++;
        assert.ok((mid.x - feet.x) * Math.sign(away.x) > -1, `${who} is on the desk's side`);
      }
    }
  }
  assert.ok(
    tied >= 8 && over >= 4 && aside >= 4,
    `cases: ${tied} tied, ${over} over, ${aside} aside`,
  );
});
