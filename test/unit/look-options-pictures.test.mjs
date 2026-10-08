/**
 * G6b — eleven preset cards, the pictures they are, and the numbers and words
 * that have to agree with the model.
 *
 *   4. **Eleven preset cards, each its own picture**, painted by the bake's own
 *      painters, with the light, the partitions and the room colours each
 *      visible in a card; and the partition and room-colour chips under
 *      Advanced painted the same way.
 *   5. **`?look=` accepts all eleven names and still nothing else.**
 *   6. **The figures under the preview include the worst daylight.**
 *   7. **The manual and the README count what the model counts.**
 *
 * The controls themselves are `look-options-ui.test.mjs`.
 *
 * **The catalogue is never restated here.** Every number this file asserts is
 * read out of `look-options.js`, including the ones it checks the prose
 * against.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as catalogue from '../../public/render/look-options.js';
import {
  ALL_PRESETS,
  DEFAULT_LOOK,
  LOOK_OFFERED_OPTION_COUNT,
  LOOK_OPTION_COUNT,
  LOOK_PICKERS,
  PRESETS,
  PRESET_IDS,
  lookForPreset,
  presetById,
  sameLook,
} from '../../public/render/look-options.js';
import { daylightOn, lookMetrics, validateLook } from '../../public/render/look-guards.js';
import { DAYLIGHT_MAX_CONTRAST } from '../../public/render/look-ambience.js';
import { resolveLook } from '../../public/render/look-derive.js';
import { THEMES } from '../../public/render/themes.js';
import { swatchSpecFor } from '../../public/look-ui.js';
import { outsideControls } from '../../public/look-ui-parts.js';
import { ADVANCED_GROUPS } from '../../public/look-ui-store.js';
import {
  THUMB_H,
  THUMB_W,
  paintLookSwatch,
  paintLookThumbnail,
} from '../../public/look-ui-thumbs.js';
import { pickSessionLook } from '../../public/url-options.js';
import { advancedOf, byClass, byRole, group, world } from '../helpers/look-surfaces.mjs';
import { paintRecorder } from '../helpers/paint-recorder.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const read = (/** @type {string} */ file) => fs.readFileSync(path.join(REPO, file), 'utf8');

// ============================================================ 5 · pictures

/**
 * A picture, as a string: every fill and stroke a painter issued, in order,
 * with its colour, its arguments and the shadow it fell under. Enough to say
 * whether two pictures are the same picture, which a count of operations
 * cannot — and `paintRecorder` keeps the paint state across `save` and
 * `restore` the way a canvas does, so a shadow is the one the fill really had.
 * @param {(ctx:any) => void} paint
 */
function pictureOf(paint) {
  const ctx = paintRecorder();
  paint(ctx);
  const num = (/** @type {unknown} */ v) => (typeof v === 'number' ? v.toFixed(2) : String(v));
  return ctx.paints
    .map(
      (/** @type {any} */ p) =>
        `${p.op}(${p.args.map(num).join(',')}) ${typeof p.style === 'string' ? p.style : 'gradient'} ` +
        `${num(p.shadowOffsetX)},${num(p.shadowOffsetY)},${num(p.shadowBlur)}`,
    )
    .join('\n');
}

/** One card's picture. @param {any} look @param {string} theme */
const card = (look, theme) =>
  pictureOf((ctx) => paintLookThumbnail(ctx, { look, theme, w: THUMB_W, h: THUMB_H }));

test('eleven preset cards on both surfaces, each asked of the real painter under its own key', () => {
  assert.equal(PRESETS.length, 11, 'the six that shipped and the five of the graphics packages');
  assert.deepEqual(
    PRESETS.map((p) => p.id),
    [...PRESET_IDS],
    'a preset is in the catalogue and not on offer',
  );
  const w = world();
  w.bar.open();
  for (const [name, root] of [
    ['sheet', w.sheet()],
    ['bar', w.popoverEl],
  ]) {
    const cards = byRole(group(root, 'Style'), 'radio');
    assert.deepEqual(
      cards.map((c) => c.textContent),
      PRESETS.map((p) => p.label),
      `${name}: the cards are not the catalogue's presets, in its order`,
    );
    cards.forEach((c, i) => {
      const canvas = c.children.find((n) => n.tagName === 'CANVAS');
      assert.ok(canvas, `${name}: ${PRESETS[i].label} has no picture`);
      assert.equal(canvas.spec.kind, 'thumbnail', 'a card with a hand-drawn swatch');
      assert.equal(canvas.spec.key, `preset:${PRESETS[i].id}`);
      assert.ok(sameLook(canvas.spec.look, PRESETS[i].look), 'a card painted in another look');
      assert.equal(c.title, PRESETS[i].blurb);
    });
    // One radio group, so the arrow keys walk all eleven in reading order.
    assert.equal(cards.filter((c) => c.getAttribute('tabindex') === '0').length, 1);
  }

  // In the bar they are a grid of four, every one on screen at once: no
  // sideways scroller hiding eight of them.
  const css = read('public/style.css');
  const grid = /\.lookbar-presets\s*\{([^}]*)\}/.exec(css);
  assert.ok(grid, 'style.css has no .lookbar-presets rule');
  assert.match(grid[1], /grid-template-columns:\s*repeat\(4,/);
  assert.doesNotMatch(grid[1], /overflow/);
  assert.equal(Math.ceil(PRESETS.length / 4), 3, 'three short rows');
});

test('every preset card is its own picture, on every theme, and no card is a swatch', () => {
  for (const theme of THEMES) {
    const seen = new Map();
    for (const preset of PRESETS) {
      const picture = card(preset.look, theme.name);
      assert.ok(picture.length > 2000, `${preset.id} painted almost nothing on ${theme.name}`);
      const twin = seen.get(picture);
      assert.equal(
        twin,
        undefined,
        `on ${theme.name}, ${preset.id} and ${twin} are the same picture: nobody could choose between them`,
      );
      seen.set(picture, preset.id);
    }
    assert.equal(seen.size, PRESETS.length);
  }
});

test('the light, the partitions and the room colours are each IN a card, drawn by the bake’s own painters', () => {
  // Three options that were invisible in a card until this package: a card
  // painted the floors and the furniture and nothing else, so Colour plan was a
  // picture of a grey office. Each of them moved alone changes the picture.
  const base = card(DEFAULT_LOOK, 'default');
  assert.equal(card(DEFAULT_LOOK, 'default'), base, 'a card is not deterministic');
  for (const picker of ['light', 'partitions', 'roomTint']) {
    const options = LOOK_PICKERS.find((p) => p.id === picker).options.map((o) => o.id);
    const pictures = options.map((id) => card({ ...DEFAULT_LOOK, [picker]: id }, 'default'));
    assert.equal(
      new Set(pictures).size,
      options.length,
      `two ${picker} options paint the same card: ${options.join(', ')}`,
    );
  }
  // A zoned room is the floor painter handed `roomGroundFor`'s function, and
  // the card shows the first two projects' colours side by side.
  const plan = resolveLook(lookForPreset('colour-plan'), 'default');
  const zoned = card(lookForPreset('colour-plan'), 'default');
  assert.ok(zoned.includes(plan.roomTint.tints[0]), 'the first room is not in its colour');
  assert.ok(zoned.includes(plan.roomTint.tints[1]), 'the second room is not in its colour');
  assert.ok(!base.includes(plan.roomTint.tints[0]));
  // A glass partition is drawn in the frame colour the guard measures.
  const glass = resolveLook({ ...DEFAULT_LOOK, partitions: 'glass' }, 'default');
  assert.ok(
    card({ ...DEFAULT_LOOK, partitions: 'glass' }, 'default').includes(glass.partitions.glassFrame),
  );
  // And evening's shadows are longer than noon's, on the same desk.
  const reach = (/** @type {string} */ light) =>
    Math.max(
      ...card({ ...DEFAULT_LOOK, light }, 'default')
        .split('\n')
        .map((line) => / (-?[\d.]+),(-?[\d.]+),[\d.]+$/.exec(line))
        .filter(Boolean)
        .map((m) => Math.hypot(Number(m[1]), Number(m[2]))),
    );
  assert.ok(reach('evening') > reach('noon') * 1.5, 'evening casts no further than noon');
  assert.ok(reach('morning') > reach('noon') * 1.3, 'morning casts no further than noon');

  // By the bake's painters and no second set: read, not asserted in prose.
  const src = read('public/look-ui-thumbs.js');
  assert.match(
    src,
    /import \{ paintProp, paintRoomLight, paintWallSegment \} from '\.\/render\/backdrop\.js'/,
  );
  assert.match(src, /roomGroundFor\(LOOK, n, identityFor\(n\)\.accent\)/);
  for (const painter of [
    'paintFloorMaterial(',
    'paintRoomLight(',
    'paintWallSegment(',
    'paintProp(',
  ]) {
    assert.ok(src.includes(painter), `the cards no longer call ${painter})`);
  }
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.equal(
    /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/.test(code),
    false,
    'a card painter holds a colour',
  );
  assert.equal(/Math\.random|Date\.now/.test(code), false);
});

test('the partition and room-colour chips are two rooms and the wall between them, by the same painters', () => {
  const chip = (/** @type {any} */ spec) =>
    pictureOf((ctx) => paintLookSwatch(ctx, { ...spec, theme: 'default' }));
  for (const id of ['partitions', 'roomTint']) {
    const picker = LOOK_PICKERS.find((p) => p.id === id);
    const specs = picker.options.map((o) => swatchSpecFor(picker, o.id, DEFAULT_LOOK, catalogue));
    for (const [i, spec] of specs.entries()) {
      assert.ok(spec && spec.rooms, `${id}/${picker.options[i].id} has no two-room chip`);
      assert.equal(spec.kind, 'swatch');
      // The chip is the look with THIS option, and nothing else moved.
      assert.equal(spec.look[picker.path], picker.options[i].id);
      assert.ok(sameLook({ ...spec.look, [picker.path]: DEFAULT_LOOK[picker.path] }, DEFAULT_LOOK));
    }
    // A canvas is one node and hangs in one chip: no two chips share a key,
    // within a row or across the two rows.
    const pictures = specs.map(chip);
    assert.equal(new Set(pictures).size, specs.length, `two ${id} chips are the same picture`);
  }
  const keys = ['partitions', 'roomTint'].flatMap((id) => {
    const picker = LOOK_PICKERS.find((p) => p.id === id);
    return picker.options.map((o) => swatchSpecFor(picker, o.id, DEFAULT_LOOK, catalogue).key);
  });
  assert.equal(new Set(keys).size, keys.length, 'two chips ask the cache for one canvas');
  // And a key names everything its picture depends on: another rooms' floor,
  // another scheme, the other option of the pair — each is another canvas.
  const key = (/** @type {any} */ look) =>
    swatchSpecFor(
      LOOK_PICKERS.find((p) => p.id === 'partitions'),
      'glass',
      look,
      catalogue,
    ).key;
  const others = [
    { ...DEFAULT_LOOK, scheme: 'cool' },
    { ...DEFAULT_LOOK, roomTint: 'zoned' },
    { ...DEFAULT_LOOK, floors: { ...DEFAULT_LOOK.floors, rooms: 'cork' } },
  ];
  for (const look of others) assert.notEqual(key(look), key(DEFAULT_LOOK));

  // The Zoned chip is the first two projects' colours, one above the other.
  const zoned = resolveLook({ ...DEFAULT_LOOK, roomTint: 'zoned' }, 'default');
  const picture = chip(
    swatchSpecFor(
      LOOK_PICKERS.find((p) => p.id === 'roomTint'),
      'zoned',
      DEFAULT_LOOK,
      catalogue,
    ),
  );
  assert.ok(picture.includes(zoned.roomTint.tints[0]) && picture.includes(zoned.roomTint.tints[1]));

  // On the page: every one of the six chips carries its picture.
  const w = world();
  const advanced = advancedOf(w.sheet());
  for (const label of ['Partitions', 'Room colours']) {
    for (const chipNode of byRole(group(advanced, label), 'radio')) {
      const canvas = chipNode.children.find((n) => n.tagName === 'CANVAS');
      assert.ok(
        canvas && canvas.spec.rooms,
        `${label}/${chipNode.textContent} is a word, not a picture`,
      );
      assert.equal(canvas.getAttribute('aria-hidden'), 'true');
    }
  }
});

// ============================================================== 6 · ?look=

test('?look= accepts all eleven names, however they are spelled, and still nothing else', () => {
  const setting = { marker: 'what settings.look says' };
  const pick = (/** @type {string} */ search) => pickSessionLook(search, setting, presetById);
  assert.equal(PRESETS.length, 11);
  for (const preset of PRESETS) {
    for (const spelling of [
      preset.id,
      preset.id.toUpperCase(),
      preset.id.replace(/-/g, '_'),
      encodeURIComponent(preset.label),
      preset.label.replace(/ /g, '+'),
    ]) {
      const got = /** @type {any} */ (pick(`?look=${spelling}`));
      assert.equal(got && got.id, preset.id, `?look=${spelling} did not find ${preset.id}`);
    }
    // What crosses the boundary is the catalogue's own frozen preset: a name
    // chose it, and nothing in the query could have altered it.
    const got = /** @type {any} */ (pick(`?look=${preset.id}&light=evening&roomTint=zoned`));
    assert.equal(got, presetById(preset.id));
    assert.ok(Object.isFrozen(got) && Object.isFrozen(got.look));
    assert.ok(validateLook(got.look, 'default').ok);
  }
  // Nothing else: not an option of one of the new pickers, not a look written
  // out, not two names, not a prototype's key.
  for (const value of [
    'evening',
    'glass',
    'zoned',
    'nordic',
    'daylight-studio,graphite-loft',
    'daylight-studio/../graphite-loft',
    '%7B%22light%22%3A%22evening%22%7D',
    'light=evening',
    '__proto__',
    'constructor',
    'toString',
    'studio-oak%00',
    '',
  ]) {
    assert.equal(pick(`?look=${value}`), setting, `?look=${value} was accepted`);
  }
  assert.equal(pick('?light=evening&partitions=glass&roomTint=zoned'), setting);
  // The names the manual gives are names that work.
  const guide = read('docs/GUIDE.md');
  const named = [...guide.matchAll(/\?look=([a-z-]+)/g)].map((m) => m[1]);
  assert.ok(named.length > 0, 'the manual no longer shows ?look=');
  for (const name of named) assert.ok(presetById(name), `the manual offers ?look=${name}`);
});

// ============================================================ 7 · figures

test('the figures under the preview include the worst daylight on the floor, and it is the guard’s own number', () => {
  for (const [look, theme] of [
    [DEFAULT_LOOK, 'default'],
    [lookForPreset('colour-plan'), 'night shift'],
    [lookForPreset('walnut-executive'), 'blueprint'],
  ]) {
    const metrics = lookMetrics(look, theme);
    const daylight = metrics.find((m) => m.id === 'daylight');
    assert.ok(daylight, 'lookMetrics reports no daylight');
    assert.equal(metrics.at(-1), daylight, 'appended, so no shipped figure changed its place');
    assert.equal(daylight.label, 'daylight on the floor');
    // The number the light is REFUSED on, not a second measurement of it.
    assert.equal(
      daylight.ratio,
      Number(daylightOn(resolveLook(look, theme)).ratio.value.toFixed(2)),
    );
    assert.ok(daylight.ratio >= 1 && daylight.ratio <= DAYLIGHT_MAX_CONTRAST);

    const w = world({ look, theme });
    const line = byClass(w.sheet(), 'settings-look-metrics')[0];
    assert.ok(line.textContent.includes(`daylight on the floor ${daylight.ratio.toFixed(2)}:1`));
  }
  // It is a number about the light: on a dark floor a patch of daylight shows,
  // and on a pale one it is nearly the floor.
  const of = (/** @type {string} */ theme) =>
    lookMetrics(DEFAULT_LOOK, theme).find((m) => m.id === 'daylight').ratio;
  assert.ok(of('night shift') > of('default'));
  // Seven figures: three edges, two rugs, the ink, the daylight.
  assert.equal(lookMetrics(DEFAULT_LOOK, 'default').length, 7);
});

// ============================================================== 8 · prose

/** `11` → `eleven`: the manual writes its small numbers out. */
const WORDS = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
];
const word = (/** @type {number} */ n) => WORDS[n] ?? String(n);
const Word = (/** @type {number} */ n) => word(n).replace(/^./, (c) => c.toUpperCase());

test('the README and the manual count what the model counts, and name what it names', () => {
  const w = world();
  const controls = outsideControls(w.store);
  const readme = read('README.md');
  const guide = read('docs/GUIDE.md');
  const look = (/** @type {string} */ text) => {
    const from = text.indexOf('## Change the look');
    assert.notEqual(from, -1, 'there is no "Change the look" section');
    const to = text.indexOf('\n## ', from + 4);
    return text.slice(from, to === -1 ? undefined : to).replace(/\s+/g, ' ');
  };
  const short = look(readme);
  const long = look(guide);

  // The counts, every one derived: a number typed into prose is a number that
  // is wrong the day a preset or an option is added.
  assert.equal(
    LOOK_OFFERED_OPTION_COUNT,
    LOOK_OPTION_COUNT,
    'something is catalogued and not offered',
  );
  const counted = `**${LOOK_OFFERED_OPTION_COUNT} options over ${word(LOOK_PICKERS.length)} pickers**`;
  assert.ok(short.includes(counted), `the README does not say ${counted}`);
  assert.ok(
    short.includes(`${word(PRESETS.length)} presets`),
    `the README does not say there are ${word(PRESETS.length)} presets`,
  );
  assert.ok(short.includes(`the ${word(controls.length)} you reach for most`));
  assert.ok(long.includes(`${Word(PRESETS.length)} presets`), 'the manual miscounts the presets');
  assert.ok(
    long.includes(`the same ${word(controls.length)} choices`),
    'the manual miscounts the outside',
  );
  assert.ok(
    long.includes(`${word(ADVANCED_GROUPS.length)} headings`),
    'the manual miscounts the headings under Advanced',
  );
  // No other count of presets or options survives in either, from an older build.
  for (const [name, text] of [
    ['README', short],
    ['manual', long],
  ]) {
    for (const m of text.matchAll(/\b(\w+) (presets|pickers|headings)\b/g)) {
      const n = WORDS.indexOf(m[1].toLowerCase());
      if (n === -1) continue;
      const truth = {
        presets: PRESETS.length,
        pickers: LOOK_PICKERS.length,
        headings: ADVANCED_GROUPS.length,
      };
      assert.equal(n, truth[m[2]], `the ${name} says "${m[0]}"`);
    }
    for (const m of text.matchAll(/\b(\d+) options\b/g)) {
      assert.equal(Number(m[1]), LOOK_OFFERED_OPTION_COUNT, `the ${name} says "${m[0]}"`);
    }
  }

  // The names. Every control on the outside has a row in the manual's table,
  // every preset is named in the manual, and so is every option of the three
  // new pickers and every heading under Advanced.
  for (const control of controls) {
    assert.match(
      guide,
      new RegExp(`^\\| \\*\\*${control.label}\\*\\* +\\|`, 'm'),
      `no row for ${control.label}`,
    );
    assert.ok(
      short.includes(`**${control.label.toLowerCase()}**`),
      `the README does not name ${control.label}`,
    );
  }
  for (const preset of ALL_PRESETS) {
    assert.ok(long.includes(`**${preset.label}**`), `the manual does not name ${preset.label}`);
  }
  for (const id of ['light', 'partitions', 'roomTint']) {
    for (const option of LOOK_PICKERS.find((p) => p.id === id).options) {
      assert.ok(
        long.toLowerCase().includes(option.label.toLowerCase()),
        `the manual does not mention ${id}'s "${option.label}"`,
      );
    }
  }
  for (const heading of ADVANCED_GROUPS) {
    assert.ok(long.includes(`**${heading.label}**`), `the manual has no "${heading.label}"`);
  }
  // And the README's "X to Y" is the first preset to the last.
  assert.ok(short.includes(`${PRESETS[0].label} to ${PRESETS.at(-1).label}`));
});
