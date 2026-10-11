/**
 * A junior's tag is in its lead's room, and says only who is drawn there.
 *
 * "A name is always inside its own room" (`floor-labels.test.mjs`) asks it of
 * the room a figure stands in. A junior's own room is its LEAD's, so this asks
 * it of that one: the owner's picture had `Junior / general-purpose ×4` in the
 * Lounge with a leader into the corridor, under a junior that was neither in
 * the formation nor one of the four.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { worldToScreen } from '../../public/render/agents.js';
import { frameLabelTexts, planFrameLabels } from '../../public/render/scene-frame-labels.js';
import { drawnBox, frameAt } from '../helpers/label-frame.mjs';
import { populationFloor } from '../helpers/large-floor.mjs';
import { crewFloor, jid, roomOf } from '../helpers/junior-floor.mjs';

const STAGES = [
  [1600, 1000],
  [1280, 800],
  [1920, 949],
];

/** Every junior's drawn tag in a frame, and the room its lead's desk is in. */
function juniorTags(f, labels = f.labels) {
  const out = [];
  for (const it of labels.labels) {
    const rec = f.view.records.find((r) => r.id === it.id);
    const spot = labels.plan.get(it.id);
    if (!spot || rec.agent.subagent !== true) continue;
    const lead = f.agentsById.get(rec.agent.parentId);
    const room = roomOf(f.plan, 'project', lead ? lead.projectId : rec.agent.projectId);
    const a = worldToScreen({ x: room.x, y: room.y }, f.camera);
    const b = worldToScreen({ x: room.x + room.w, y: room.y + room.h }, f.camera);
    const box = drawnBox(it, spot);
    out.push({ id: it.id, text: labels.texts.get(it.id), box, room: { a, b } });
  }
  return out;
}

const within = (box, room) =>
  box.x > room.a.x && box.y > room.a.y && box.x + box.w < room.b.x && box.y + box.h < room.b.y;

test('every junior’s tag is inside its lead’s room', () => {
  let tags = 0;
  const floors = [
    ...['crew', 'crew-waiting', 'lead', 'juniors'].map((name) => [
      name,
      () => populationFloor(name),
    ]),
    ...[3, 5, 13].map((n) => [`crew of ${n}`, () => crewFloor(n)]),
  ];
  for (const [name, floor] of floors) {
    for (const [w, h] of STAGES) {
      const f = frameAt(w, h, floor, { badges: true });
      for (const tag of juniorTags(f)) {
        tags++;
        assert.ok(within(tag.box, tag.room), `${name} ${w}x${h}: "${tag.text}" is outside`);
      }
    }
  }
  assert.ok(tags > 20, `the floors have juniors on them: ${tags} tags`);
});

test('a member shuffling along its arc keeps its tag in the room', () => {
  const f = frameAt(1600, 1000, () => crewFloor(5));
  const carrier = f.view.records.find((r) => f.labels.texts.has(r.id) && r.agent.subagent);
  // Mid-walk: a path in hand, a step from its seat. A walker has no room of
  // its own; a member of a formation has its formation's.
  carrier.path = [{ x: carrier.x, y: carrier.y }];
  carrier.x += 0.6;
  const labels = planFrameLabels(f.ctx, f.view);
  const [tag] = juniorTags(f, labels).filter((t) => t.id === carrier.id);
  assert.ok(tag, 'it still carries its crew’s tag');
  assert.equal(tag.text, 'general-purpose ×5');
  assert.ok(within(tag.box, tag.room));
  const item = labels.labels.find((it) => it.id === carrier.id);
  assert.ok(item.room, 'and the floor it is held to is its lead’s room');
});

test('the tag counts only the members drawn in the formation, and is never hung elsewhere', () => {
  const f = frameAt(1600, 1000, () => crewFloor(4));
  const texts = () => frameLabelTexts(f.view.records, f.agentsById);
  assert.deepEqual(
    [...texts().values()].filter((t) => /×/.test(t)),
    ['general-purpose ×4'],
  );

  // The owner's picture: the first member is in the Lounge, on its seat's word.
  const astray = f.view.records.find((r) => r.id === jid(0));
  const lounge = roomOf(f.plan, 'lounge');
  Object.assign(astray, { x: lounge.x + lounge.w / 2, y: lounge.y + lounge.h / 2 });
  const now = texts();
  assert.deepEqual(
    [...now.values()].filter((t) => /×/.test(t)),
    ['general-purpose ×3'],
  );
  assert.ok(!/×/.test(now.get(jid(0)) ?? ''), 'the one in the Lounge does not carry the tag');
  const a = worldToScreen({ x: lounge.x, y: lounge.y }, f.camera);
  const b = worldToScreen({ x: lounge.x + lounge.w, y: lounge.y + lounge.h }, f.camera);
  const labels = planFrameLabels(f.ctx, f.view);
  for (const tag of juniorTags(f, labels)) {
    if (!/×/.test(tag.text)) continue;
    assert.ok(within(tag.box, tag.room), 'the crew’s tag is in the lead’s room');
    assert.ok(!within(tag.box, { a, b }), 'and not in the Lounge');
  }

  // One that has been fired and is folding away is not one of them either.
  const leaving = f.view.records.find((r) => r.id === jid(1));
  leaving.leftAt = 1;
  const after = texts();
  assert.deepEqual(
    [...after.values()].filter((t) => /×/.test(t)),
    ['general-purpose ×2'],
  );
  assert.equal(after.get(jid(1)), undefined, 'and carries no name while it goes');
});
