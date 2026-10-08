/**
 * G6b — the light, the room colours and the partitions, on the two surfaces a
 * person changes a look from.
 *
 * What the model can paint was proven a package at a time; this is the proof
 * that a hand can reach it, and the acceptance list it is held to:
 *
 *   1. **Light** is a three-way segment and **Room colours** is a switch, on the
 *      outside of both the settings sheet's Look section and the header's Look
 *      bar, each operable from the keyboard alone, and the two surfaces are one
 *      look.
 *   2. **Partitions** and the three-way room tint are rows under Advanced.
 *   3. **A refused combination shows its sentence in its own row and moves
 *      nothing** — the existing rule, on the new rows, in the guard's own
 *      words, and once with nothing stubbed at all.
 *
 * The pictures, `?look=`, the figures and the prose are
 * `look-options-pictures.test.mjs`. Both files stand on
 * `test/helpers/look-surfaces.mjs`: both surfaces over ONE store, which is how
 * the shell builds them.
 *
 * **The catalogue is never restated here.** Every list this file asserts is
 * read out of `look-options.js`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as catalogue from '../../public/render/look-options.js';
import {
  DEFAULT_LOOK,
  LOOK_PICKERS,
  lookForPreset,
  sameLook,
} from '../../public/render/look-options.js';
import { validateLook } from '../../public/render/look-guards.js';
import { resolveLook } from '../../public/render/look-derive.js';
import { outsideControls } from '../../public/look-ui-parts.js';
import { ADVANCED_GROUPS, OUTSIDE_PICKER_IDS, advancedGroups } from '../../public/look-ui-store.js';
import {
  advancedOf,
  all,
  byClass,
  byRole,
  cellOf,
  checked,
  group,
  radio,
  reasons,
  refusing,
  theSwitch,
  tick,
  world,
} from '../helpers/look-surfaces.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const read = (/** @type {string} */ file) => fs.readFileSync(path.join(REPO, file), 'utf8');

// =============================================================== 1 · light

test('Light is a three-way segment on the outside of both surfaces, and it moves one key', async () => {
  const w = world();
  const lights = catalogue.LIGHT_MOOD_IDS.map((id) => catalogue.LIGHT_MOODS[id].label);
  assert.deepEqual(lights, ['Morning', 'Noon', 'Evening'], 'in the order of a day');

  const root = w.sheet();
  const seg = group(root, 'Light');
  assert.ok(seg, 'the sheet has no Light control');
  assert.ok(!advancedOf(root).contains(seg), 'Light is under Advanced, not on the outside');
  assert.deepEqual(
    byRole(seg, 'radio').map((b) => b.textContent),
    lights,
  );
  assert.deepEqual(checked(seg), ['Noon']);
  // It is one of the style's modifiers: a name, and the control under it.
  assert.ok(cellOf(root, 'Light').contains(seg));

  radio(seg, 'Evening').fire('click');
  await tick();
  assert.equal(w.posted.length, 1, 'one click, one post');
  assert.equal(w.posted[0].light, 'evening');
  assert.ok(
    sameLook({ ...w.posted[0], light: DEFAULT_LOOK.light }, DEFAULT_LOOK),
    'more than the light moved',
  );
  assert.ok(validateLook(w.posted[0], 'default').ok);
  assert.deepEqual(checked(group(w.sheet(), 'Light')), ['Evening'], 'the choice did not stay lit');

  // ONE LOOK: the bar opens on what the sheet wrote, and writes back through it.
  w.bar.open();
  assert.deepEqual(checked(group(w.popoverEl, 'Light')), ['Evening']);
  radio(group(w.popoverEl, 'Light'), 'Morning').fire('click');
  await tick();
  assert.equal(w.look().light, 'morning');
  assert.deepEqual(checked(group(w.popoverEl, 'Light')), ['Morning']);
  assert.deepEqual(checked(group(w.sheet(), 'Light')), ['Morning']);
  // Light is a change from the preset like any other, and says so.
  assert.equal(w.store.styleEdited(), true);
  assert.deepEqual(w.store.changedPaths(), ['light']);
});

test('Light is operable from the keyboard like every other segment', async () => {
  const w = world();
  for (const surface of ['sheet', 'bar']) {
    if (surface === 'bar') w.bar.open();
    const root = () => (surface === 'sheet' ? w.sheet() : w.popoverEl);
    await w.store.choosePath('light', 'noon', 'light');
    const seg = group(root(), 'Light');
    // One Tab stop, on the chosen option.
    const stops = byRole(seg, 'radio').filter((b) => b.getAttribute('tabindex') === '0');
    assert.deepEqual(
      stops.map((b) => b.textContent),
      ['Noon'],
      `${surface}: Light is not one Tab stop on its chosen option`,
    );
    let prevented = 0;
    stops[0].fire('keydown', { key: 'ArrowRight', preventDefault: () => prevented++ });
    await tick();
    assert.equal(prevented, 1, `${surface}: the arrow was left to scroll as well`);
    assert.equal(w.look().light, 'evening', `${surface}: ArrowRight did not move the light`);
    // The redraw replaced the button; the keyboard is on its successor.
    assert.equal(w.doc.activeElement.textContent, 'Evening', `${surface}: the focus was lost`);
    assert.equal(w.doc.activeElement.getAttribute('aria-checked'), 'true');
    // It wraps, and Home goes to the start of the day.
    w.doc.activeElement.fire('keydown', { key: 'ArrowRight', preventDefault: () => {} });
    await tick();
    assert.equal(w.look().light, 'morning', `${surface}: the segment does not wrap`);
    radio(group(root(), 'Light'), 'Morning').fire('keydown', { key: 'End', preventDefault() {} });
    await tick();
    assert.equal(w.look().light, 'evening');
  }
});

// ======================================================== 2 · room colours

test('Room colours is a real switch on both surfaces: Subtle off, Zoned on, and it stays where it was put', async () => {
  const w = world();
  for (const surface of ['sheet', 'bar']) {
    if (surface === 'bar') w.bar.open();
    const root = () => (surface === 'sheet' ? w.sheet() : w.popoverEl);
    await w.store.chooseRoomColours(false);
    const sw = theSwitch(root());
    assert.ok(sw, `${surface}: there is no Room colours switch`);
    assert.equal(byRole(root(), 'switch').length, 1);
    // A real button with the switch role: Tab reaches it and Space or Enter
    // throws it, with no key handler of the product's to get wrong.
    assert.equal(sw.tagName, 'BUTTON');
    assert.equal(sw.type, 'button');
    assert.equal(sw.getAttribute('tabindex'), null, 'a switch taken out of the tab order');
    assert.equal(
      sw.getAttribute('aria-label'),
      'Room colours',
      'its name is the control’s, not its state’s',
    );
    assert.equal(sw.getAttribute('aria-checked'), 'false');
    assert.deepEqual(sw.listeners.keydown || [], [], 'the switch grew a key handler of its own');
    assert.equal(byClass(sw, 'look-switch-state')[0].textContent, 'Subtle');
    assert.equal(byClass(sw, 'look-switch-track')[0].getAttribute('aria-hidden'), 'true');

    const before = w.posted.length;
    sw.fire('click');
    await tick();
    assert.equal(w.posted.length, before + 1, `${surface}: one throw, one post`);
    assert.equal(w.look().roomTint, 'zoned');
    assert.ok(
      sameLook({ ...w.look(), roomTint: 'subtle' }, DEFAULT_LOOK),
      'more than the tint moved',
    );
    const on = theSwitch(root());
    assert.equal(on.getAttribute('aria-checked'), 'true', `${surface}: the switch went back`);
    assert.equal(byClass(on, 'look-switch-state')[0].textContent, 'Zoned');
    // The redraw replaced the button; the keyboard is still on the switch.
    assert.equal(w.doc.activeElement, on, `${surface}: the focus left the switch`);

    on.fire('click');
    await tick();
    assert.equal(w.look().roomTint, 'subtle');
    assert.equal(theSwitch(root()).getAttribute('aria-checked'), 'false');
  }

  // ONE LOOK, three controls: the switch on each surface and the row under
  // Advanced all read the same thing.
  await w.store.chooseRoomColours(true);
  const root = w.sheet();
  assert.equal(theSwitch(root).getAttribute('aria-checked'), 'true');
  assert.equal(theSwitch(w.popoverEl).getAttribute('aria-checked'), 'true');
  assert.deepEqual(checked(group(advancedOf(root), 'Room colours')), ['Zoned']);
});

test('the third level is under Advanced, and the switch says it is neither of its two answers', async () => {
  const w = world();
  const root = w.sheet();
  const row = group(advancedOf(root), 'Room colours');
  assert.deepEqual(
    byRole(row, 'radio').map((b) => b.textContent),
    catalogue.ROOM_TINT_IDS.map((id) => catalogue.ROOM_TINTS[id].label),
  );
  assert.deepEqual(checked(row), ['Subtle']);
  radio(row, 'Off').fire('click');
  await tick();
  assert.equal(w.look().roomTint, 'off');

  const after = w.sheet();
  assert.deepEqual(checked(group(advancedOf(after), 'Room colours')), ['Off']);
  const sw = theSwitch(after);
  assert.equal(sw.getAttribute('aria-checked'), 'false', 'Off is not On');
  assert.equal(byClass(sw, 'look-switch-state')[0].textContent, 'Off');
  assert.match(cellOf(after, 'Room colours').textContent, /Off is set under Advanced/);
  w.bar.open();
  assert.match(w.popoverEl.textContent, /Room coloursset under Advanced/);
  // Thrown from there it goes on, and thrown again it goes to the shipped
  // level — the switch has two answers and Off is not one of them.
  theSwitch(w.popoverEl).fire('click');
  await tick();
  assert.equal(w.look().roomTint, 'zoned');
  theSwitch(w.popoverEl).fire('click');
  await tick();
  assert.equal(w.look().roomTint, DEFAULT_LOOK.roomTint);
});

// ================================================= 3 · outside and inside

test('the outside is six controls on both surfaces, out of one list, and Advanced holds the rest', () => {
  const w = world();
  const controls = outsideControls(w.store);
  assert.deepEqual(
    controls.map((c) => [c.id, c.kind]),
    [
      ['agentSize', 'choice'],
      ['theme', 'choice'],
      ['preset', 'choice'],
      ['density', 'choice'],
      ['light', 'choice'],
      ['roomColours', 'switch'],
    ],
  );
  // The same six on both, in the same order and by the same names.
  const drawn = (root) =>
    all(root).filter((n) => ['radiogroup', 'switch'].includes(n.getAttribute('role') || ''));
  const names = (nodes) => nodes.map((n) => n.getAttribute('aria-label'));
  const root = w.sheet();
  w.bar.open();
  const labels = controls.map((c) => c.label);
  assert.deepEqual(labels, ['Agent size', 'Theme', 'Style', 'Density', 'Light', 'Room colours']);
  assert.deepEqual(names(drawn(root).filter((n) => !advancedOf(root).contains(n))), labels);
  assert.deepEqual(names(drawn(w.popoverEl)), labels);

  // Every catalogue picker is drawn exactly once as its own row: outside if
  // the store says so, under a heading otherwise.
  const inside = advancedGroups(catalogue).flatMap((g) => g.pickers.map((p) => p.id));
  assert.deepEqual([...inside, ...OUTSIDE_PICKER_IDS].sort(), LOOK_PICKERS.map((p) => p.id).sort());
  assert.ok(inside.includes('partitions') && inside.includes('roomTint'));
  assert.ok(!inside.includes('light'), 'the light is drawn twice');
  // …and the two new rows are under the first heading, which is theirs.
  const first = byClass(advancedOf(root), 'settings-look-sub')[0];
  assert.equal(first.children[0].textContent, ADVANCED_GROUPS[0].label);
  assert.ok(group(first, 'Partitions'), 'Partitions is not under the first heading');
  assert.ok(group(first, 'Room colours'), 'Room colours is not under the first heading');
  assert.deepEqual(
    byRole(group(first, 'Partitions'), 'radio').map((b) => b.textContent),
    catalogue.PARTITION_STYLE_IDS.map((id) => catalogue.PARTITION_STYLES[id].label),
  );
});

test('a partition is chosen under Advanced, one key moves, and the chip stays lit', async () => {
  const w = world();
  const row = () => group(advancedOf(w.sheet()), 'Partitions');
  assert.deepEqual(checked(row()), ['Solid']);
  radio(row(), 'Glass').fire('click');
  await tick();
  assert.equal(w.posted.length, 1);
  assert.ok(sameLook({ ...w.posted[0], partitions: 'solid' }, DEFAULT_LOOK));
  assert.deepEqual(checked(row()), ['Glass']);
  // The keyboard walks it like any other row of chips.
  radio(row(), 'Glass').fire('keydown', { key: 'ArrowRight', preventDefault() {} });
  await tick();
  assert.equal(w.look().partitions, 'low');
  assert.equal(w.doc.activeElement.textContent, 'Low');
});

// ============================================================ 4 · refusals

test('a refused light shows the guard’s sentence in the Light row of each surface, and moves nothing', async () => {
  // No shipped theme and no mood can be made to fail, so the light is turned up
  // by hand and the guard is asked what it would say — its own words.
  const { daylightProblems } = await import('../../public/render/look-guards.js');
  const lit = resolveLook({ ...DEFAULT_LOOK, light: 'evening' }, 'default');
  const [problem] = daylightProblems({
    ...lit,
    light: { ...lit.light, layer: 'rgba(255,255,255,0.45)' },
  });
  assert.equal(problem.picker, 'light');

  const w = world({ validate: refusing('light', 'evening', problem) });
  radio(group(w.sheet(), 'Light'), 'Evening').fire('click');
  await tick();
  assert.deepEqual(w.posted, [], 'a refused light was posted');
  assert.equal(w.look().light, 'noon');
  const root = w.sheet();
  assert.deepEqual(checked(group(root, 'Light')), ['Noon'], 'the refused option is lit');
  // In its own row: inside the Light cell, under the control, and nowhere else.
  const cell = cellOf(root, 'Light');
  assert.deepEqual(reasons(cell), [`${problem.reason}. Nothing was changed.`]);
  assert.deepEqual(reasons(root), reasons(cell), 'the reason is drawn twice, or somewhere else');
  assert.equal(cell.children.indexOf(byRole(cell, 'status')[0]), cell.children.length - 1);
  assert.equal(advancedOf(root).open, false, 'a refusal on the outside opened Advanced');

  // And the same in the bar, under the Light row.
  w.bar.open();
  radio(group(w.popoverEl, 'Light'), 'Evening').fire('click');
  await tick();
  assert.deepEqual(w.posted, []);
  const row = byClass(w.popoverEl, 'lookbar-row').find((r) => r.textContent.startsWith('Light'));
  assert.deepEqual(reasons(row), [`${problem.reason}. Nothing was changed.`]);
  assert.deepEqual(reasons(w.popoverEl), reasons(row));
  assert.deepEqual(checked(group(w.popoverEl, 'Light')), ['Noon']);
  // The other two lights are still there to be chosen, and choosing one clears it.
  radio(group(w.popoverEl, 'Light'), 'Morning').fire('click');
  await tick();
  assert.equal(w.look().light, 'morning');
  assert.deepEqual(reasons(w.popoverEl), []);
});

test('the REAL guard refuses room colours on ash boards at night, and the switch stays off with the reason under it', async () => {
  // A refusal a shipped theme does make, with nothing stubbed: on Night shift
  // the lilac room on ash boards comes within 60 of the grey a finished
  // session wears, and a room may not wear what a figure standing in it wears.
  const look = { ...DEFAULT_LOOK, floors: { ...DEFAULT_LOOK.floors, rooms: 'wide-ash' } };
  assert.ok(validateLook(look, 'night shift').ok, 'the starting floor is itself refused');
  const refused = validateLook({ ...look, roomTint: 'zoned' }, 'night shift');
  assert.deepEqual(
    refused.problems.map((p) => p.picker),
    ['roomTint'],
  );
  const [problem] = refused.problems;
  assert.match(problem.reason, /a room may not wear what a figure standing in it wears/);

  const w = world({ look, theme: 'night shift' });
  theSwitch(w.sheet()).fire('click');
  await tick();
  assert.deepEqual(w.posted, []);
  let root = w.sheet();
  assert.equal(theSwitch(root).getAttribute('aria-checked'), 'false', 'a refused switch is on');
  const cell = cellOf(root, 'Room colours');
  assert.deepEqual(reasons(cell), [`${problem.reason}. Nothing was changed.`]);
  // Under the switch that was thrown, NOT under the row in Advanced the guard
  // names — a sentence in a shut disclosure is a sentence nobody reads.
  assert.deepEqual(reasons(advancedOf(root)), []);
  assert.equal(advancedOf(root).open, false);

  w.bar.open();
  theSwitch(w.popoverEl).fire('click');
  await tick();
  const row = byClass(w.popoverEl, 'lookbar-row--switch')[0];
  assert.deepEqual(reasons(row), [`${problem.reason}. Nothing was changed.`]);
  assert.equal(theSwitch(w.popoverEl).getAttribute('aria-checked'), 'false');

  // The same option refused from its chip under Advanced is that row's, and
  // the disclosure is opened so it can be read.
  radio(group(advancedOf(w.sheet()), 'Room colours'), 'Zoned').fire('click');
  await tick();
  root = w.sheet();
  assert.deepEqual(reasons(cellOf(root, 'Room colours')), []);
  assert.equal(reasons(advancedOf(root)).length, 1);
  assert.equal(advancedOf(root).open, true);
  assert.deepEqual(checked(group(advancedOf(root), 'Room colours')), ['Subtle']);
});

test('the REAL guard refuses glass on a pale pack theme, in the Partitions row, and nothing moves', async () => {
  // The three shipped themes cannot produce this refusal and a theme from a
  // pack can: the sample pack's garden has dark-green line work on pale floors,
  // so a frame mixed from it is a soft line on cork. Nothing here is a stub.
  const pack = JSON.parse(read('packs/supporter-sample/pack.json'));
  const garden = pack.themes.find((/** @type {any} */ t) => t.name === 'garden');
  assert.ok(garden, 'the sample pack no longer carries its garden theme');
  const look = lookForPreset('garden-floor');
  assert.ok(validateLook(look, garden).ok, 'the starting floor is itself refused');

  const w = world({ look, theme: garden });
  const row = () => group(advancedOf(w.sheet()), 'Partitions');
  radio(row(), 'Glass').fire('click');
  await tick();
  assert.deepEqual(w.posted, [], 'a look the guard refuses was posted');
  assert.equal(w.look().partitions, 'solid');
  const root = w.sheet();
  assert.deepEqual(checked(group(advancedOf(root), 'Partitions')), ['Solid']);
  const expected = validateLook({ ...look, partitions: 'glass' }, garden).problems;
  assert.ok(expected.length > 0 && expected.every((p) => p.picker === 'partitions'));
  assert.deepEqual(
    reasons(root),
    expected.map((p) => `${p.reason}. Nothing was changed.`),
  );
  assert.match(reasons(root)[0], /:1 on Cork in the rooms; the line that draws the divider/);
  // In its own row: straight after the Partitions row, before the next one.
  const box = byRole(root, 'status')[0];
  const siblings = box.parentNode.children;
  assert.ok(siblings[siblings.indexOf(box) - 1].textContent.startsWith('Partitions'));
  // Readable: the disclosure and its heading are open for this draw.
  assert.equal(advancedOf(root).open, true);
  assert.equal(byClass(root, 'settings-look-sub')[0].open, true);
  // Low carries the same frame line on the same floor, and is refused as well.
  radio(row(), 'Low').fire('click');
  await tick();
  assert.deepEqual(w.posted, []);
  assert.equal(w.look().partitions, 'solid');
  assert.ok(reasons(w.sheet()).length > 0);
});

test('the switch honours reduced motion by both of the product’s routes', () => {
  const css = read('public/style.css');
  assert.match(
    css,
    /@media \(prefers-reduced-motion: reduce\) \{\s*:root:not\(\[data-motion='no-preference'\]\) \.look-switch-track,\s*:root:not\(\[data-motion='no-preference'\]\) \.look-switch-thumb \{\s*transition: none;/,
  );
  assert.match(
    css,
    /\[data-motion='reduce'\] \.look-switch-track,\s*\[data-motion='reduce'\] \.look-switch-thumb \{\s*transition: none;/,
  );
  // No colour of its own: the ink and ground sets, like the rest of the sheet.
  const rules = [...css.matchAll(/\.look-switch[^{]*\{([^}]*)\}/g)].map((m) => m[1]).join('\n');
  assert.ok(rules.length > 0);
  assert.equal(
    /#[0-9a-fA-F]{3,8}\b|rgba?\(/.test(rules),
    false,
    'the switch declares a raw colour',
  );
});
