/**
 * WP-88b — the Look section, and what it is allowed to cost.
 *
 * `docs/plan/11-LOOK-CONTROL-CENTRE.md` §4, and §5's acceptance for this
 * package: *"the section exists with six preset cards, the live preview and ten
 * pickers; a source-reading test proves every swatch and preview is painted by
 * `backdrop-floor.js`; a refusal shows its reason in its row and leaves the
 * control where it was; every control is operable from the keyboard alone"*.
 *
 * NO jsdom, and there is not going to be one: `look-ui.js` takes its `document`
 * as a parameter and is handed the stub below, which is `idle-projects.test.mjs`'s
 * with the three things a form needs that a list did not — real event listeners,
 * `focus()`, and a `type` property. `settings-ui-widgets.js` reaches for the
 * global `document` inside its functions, so the stub is installed there too;
 * that is deliberate, because it means the rows under test are the sheet's own
 * rows rather than a second set written for the test.
 *
 * **The catalogue is never restated here.** Every assertion about what the
 * section contains is derived from `LOOK_PICKERS`, which is the whole point of
 * §4's construction: a package that adds an option gets a chip for it without
 * anybody editing `look-ui.js`, and this suite proves that rather than assuming
 * it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  DEFAULT_LOOK,
  LOOK_PICKERS,
  LOUNGE_KIT_BAYS,
  PRESETS,
  lookForPreset,
  normalizeLook,
  sameLook,
} from '../../public/render/look-options.js';
import * as catalogue from '../../public/render/look-options.js';
import { lookMetrics, validateLook } from '../../public/render/look-guards.js';
import { resolveLook } from '../../public/render/look-derive.js';
import { buildLookDocument, validateLookDocument } from '../../src/core/look.mjs';
import { createLookSection, dimensionsFor, swatchSpecFor } from '../../public/look-ui.js';
import {
  ADVANCED_GROUPS,
  OUTSIDE_PICKER_IDS,
  advancedGroups,
  createLookStore,
  densityLevels,
} from '../../public/look-ui-store.js';
import { THEMES } from '../../public/render/themes.js';
import {
  LOOK_THUMB_DRAW_BUDGET,
  THUMB_H,
  THUMB_W,
  paintLookSwatch,
  paintLookThumbnail,
} from '../../public/look-ui-thumbs.js';
import { createSettingsWidgets } from '../../public/settings-ui-widgets.js';

// --------------------------------------------------------------- DOM stub

class StubNode {
  /** @param {string} tagName */
  constructor(tagName) {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.className = '';
    this.id = '';
    this.type = '';
    this.style = {};
    this.attrs = /** @type {Record<string,string>} */ ({});
    this.listeners = /** @type {Record<string, Function[]>} */ ({});
    this.focused = false;
    this._text = null;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  append(...kids) {
    for (const kid of kids) this.appendChild(kid);
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null;
  }
  addEventListener(name, fn) {
    (this.listeners[name] ||= []).push(fn);
  }
  /** Fire one, the way a browser would. @param {string} name @param {any} [event] */
  fire(name, event = {}) {
    for (const fn of this.listeners[name] || []) fn(event);
  }
  focus() {
    this.focused = true;
  }
  set innerHTML(v) {
    throw new Error(`wrote ${JSON.stringify(String(v))} through innerHTML`);
  }
  set textContent(v) {
    this.children = [];
    this._text = String(v);
  }
  get textContent() {
    if (this.children.length > 0) return this.children.map((c) => c.textContent).join('');
    return this._text === null ? '' : this._text;
  }
}

const doc = { createElement: (/** @type {string} */ tag) => new StubNode(tag) };
// `settings-ui-widgets.js` builds its rows with the global `document`, inside
// its functions rather than at module scope — so this is enough, and the rows
// under test are the sheet's own.
globalThis.document = /** @type {any} */ (doc);

/** Every node in a tree, depth first. */
function all(node, out = []) {
  out.push(node);
  for (const child of node.children) all(child, out);
  return out;
}

/** @param {any} root @param {(n:any) => boolean} match */
const find = (root, match) => all(root).filter(match);
/** @param {any} root @param {string} role */
const byRole = (root, role) => find(root, (n) => n.getAttribute('role') === role);
/** @param {any} root @param {string} cls */
const byClass = (root, cls) => find(root, (n) => String(n.className).split(/\s+/).includes(cls));

// ------------------------------------------------------------- the harness

/**
 * Build the section against the REAL catalogue and the REAL guards, with the
 * post captured rather than sent and every picture declined.
 *
 * `debounceMs: 0` applies synchronously — the debounce is a property of a hand
 * on a keyboard, not of the thing being posted (see `LOOK_DEBOUNCE_MS`).
 *
 * @param {object} [opts]
 * @param {any} [opts.look]   what `settings.look` says
 * @param {boolean} [opts.pictures] hand out stub canvases
 * @param {(next:any) => any} [opts.apply]  what the daemon answers
 */
function mount(opts = {}) {
  const posted = [];
  const saves = [];
  const painted = [];
  /**
   * What the DAEMON holds, and — separately — what it last PUSHED to this tab.
   * They are two variables on purpose. This harness used to keep one, which the
   * post wrote and the section read, and that is exactly the arrangement the
   * product did not have: the section read a copy nobody updated, the chosen
   * chip went back, and every test here passed. `pushed` moves only when a
   * test says the daemon pushed.
   */
  let stored = opts.look || DEFAULT_LOOK;
  const pushed = { look: stored, theme: 'default' };
  const host = new StubNode('div');
  const widgets = createSettingsWidgets({
    theming: { swatches: () => [] },
    shippedThemes: () => [],
    applyThemeSetting: (/** @type {string} */ n) => n,
    availableAvatarSets: () => [],
  });
  const port = {
    catalogue: () => catalogue,
    validate: validateLook,
    metrics: lookMetrics,
    theme: () => 'default',
    live: () => 9,
    picture: () => (opts.pictures ? new StubNode('canvas') : null),
    apply: async (/** @type {any} */ next) => {
      posted.push(next);
      const answer = opts.apply ? opts.apply(next) : { ok: true };
      if (!answer.ok) return answer;
      stored = normalizeLook(next);
      return { ...answer, look: stored };
    },
    exportLook: () => {},
    importLook: () => {},
  };
  const store = createLookStore({
    port,
    read: () => pushed,
    debounceMs: 0,
    theming: {
      list: () => THEMES,
      apply: (/** @type {string} */ name) => void painted.push(name),
      swatches: () => [],
    },
    saveSetting: async (/** @type {any} */ patch) => {
      saves.push(patch);
      return { ...pushed, ...patch };
    },
  });
  const section = createLookSection({
    doc,
    widgets,
    store,
    look: port,
    prefs: opts.prefs,
    toast: () => {},
  });
  const draw = () => {
    host.children = [];
    section.renderInto(host);
    return host;
  };
  section.wire({ render: draw });
  return { section, store, host, posted, saves, painted, pushed, draw, look: () => stored };
}

/** The Advanced disclosure, as drawn. */
const advancedOf = (root) => byClass(root, 'settings-look-advanced')[0];
/** Is `node` inside `ancestor`? The stub has no `contains`, so: by search. */
const within = (ancestor, node) => all(ancestor).includes(node);

/** The radiogroup for one picker dimension, by its accessible name. */
function groupNamed(root, label) {
  return byRole(root, 'radiogroup').find((g) => g.getAttribute('aria-label') === label);
}

/** The chip in `group` whose label is `text`. */
function chip(group, text) {
  return byRole(group, 'radio').find((b) => b.textContent === text);
}

// ------------------------------------------------------------- the section

test('the section draws one row per picker in the catalogue, and never a list of its own', () => {
  const { draw } = mount();
  const root = draw();

  const labels = byClass(root, 'settings-label').map((n) => n.textContent);
  for (const picker of LOOK_PICKERS) {
    assert.ok(
      labels.includes(picker.label),
      `"${picker.label}" is in the catalogue and has no row in the section`,
    );
  }
  assert.ok(labels.includes('Lounge kit'), '§1.g’s four checkboxes have no row');

  // And every OPTION reaches a chip. This is the assertion that makes the
  // section derived rather than hand-listed: it is written against the tables,
  // so a catalogue that grew a material fails here until the chip exists.
  const chips = byRole(root, 'radio').map((n) => n.textContent);
  for (const picker of LOOK_PICKERS) {
    for (const option of picker.options) {
      assert.ok(
        chips.some((t) => t.endsWith(option.label)),
        `${picker.id} offers "${option.label}" and the section draws no chip for it`,
      );
    }
  }
  for (const bay of LOUNGE_KIT_BAYS) {
    assert.ok(
      byRole(root, 'checkbox').some((n) => n.textContent.toLowerCase() === bayName(bay)),
      `the lounge kit has no checkbox for "${bay}"`,
    );
  }
});

/** A bay as the kit names it, lower-cased: `cafe` is written `café`. */
const bayName = (bay) => (bay === 'cafe' ? 'café' : bay);

// ------------------------------------------- simple outside, detail inside

test('the outside is exactly six controls — agent size, theme, style, density, light, room colours — and nothing else', () => {
  // The owner: "Keep high-level abstract settings like agent size, theme, etc.
  // on the outside." Six, in this order — the four that were there, then the
  // light and the room colours — and every other control on the section is
  // inside the disclosure.
  const { draw } = mount();
  const root = draw();
  const advanced = advancedOf(root);
  assert.ok(advanced, 'there is no Advanced disclosure');

  const outside = byRole(root, 'radiogroup').filter((g) => !within(advanced, g));
  assert.deepEqual(
    outside.map((g) => g.getAttribute('aria-label')),
    ['Agent size', 'Theme', 'Style', 'Density', 'Light'],
  );
  const switches = byRole(root, 'switch');
  assert.deepEqual(
    switches.map((b) => [b.getAttribute('aria-label'), within(advanced, b)]),
    [['Room colours', false]],
    'the one switch is Room colours, and it is on the outside',
  );
  assert.deepEqual(
    byRole(root, 'checkbox').filter((b) => !within(advanced, b)),
    [],
    'a lounge bay is outside the disclosure',
  );
  // The only buttons outside it are the five groups' own options and the switch.
  const options = new Set([...outside.flatMap((g) => byRole(g, 'radio')), ...switches]);
  const loose = find(root, (n) => n.tagName === 'BUTTON').filter(
    (b) => !within(advanced, b) && !options.has(b),
  );
  assert.deepEqual(loose, [], 'something other than the six controls is on the outside');

  // Each list is the catalogue's, the themes' or the presets' own.
  const count = (label) => byRole(groupNamed(root, label), 'radio').length;
  assert.equal(count('Agent size'), LOOK_PICKERS.find((p) => p.id === 'agentSize').options.length);
  assert.equal(count('Theme'), THEMES.length);
  assert.equal(count('Style'), PRESETS.length);
  assert.equal(count('Density'), densityLevels(catalogue).length);
  assert.equal(count('Light'), catalogue.LIGHT_MOOD_IDS.length);
  // And the catalogue pickers out here are the ones the store names. Room
  // colours is not one of them: its whole row is under Advanced, and the
  // switch is two of its three options.
  assert.deepEqual([...OUTSIDE_PICKER_IDS], ['agentSize', 'light']);
  assert.ok(groupNamed(advanced, 'Room colours'), 'the three-way room colours row left Advanced');
  assert.equal(groupNamed(advanced, 'Light'), undefined, 'the light is drawn twice');
});

test('Advanced is shut by default and holds every other picker in the catalogue — derived, not listed', () => {
  const { draw } = mount();
  const root = draw();
  const advanced = advancedOf(root);
  // The golden that photographs the inside opens it by this id.
  assert.equal(advanced.id, 'settings-look-advanced');
  assert.match(
    readFileSync(new URL('../../scripts/goldens.mjs', import.meta.url), 'utf8'),
    /click: '#settings-look-advanced > summary',\s+scrollTo: 'settings-look-advanced'/,
  );
  // A real disclosure: the browser's own element, so the keyboard, the marker
  // and the expanded state are not this product's to get wrong.
  assert.equal(advanced.tagName, 'DETAILS');
  assert.equal(advanced.children[0].tagName, 'SUMMARY');
  assert.equal(advanced.open, false, 'Advanced is open before anybody opened it');

  // Every picker that is not on the outside has its row in here, and no other.
  const inside = LOOK_PICKERS.filter((p) => !OUTSIDE_PICKER_IDS.includes(p.id));
  const labels = byClass(advanced, 'settings-label').map((n) => n.textContent);
  assert.deepEqual(
    labels.filter((label) => inside.some((p) => p.label === label)).sort(),
    inside.map((p) => p.label).sort(),
  );
  assert.ok(labels.includes('Lounge kit'));
  assert.equal(byRole(advanced, 'checkbox').length, LOUNGE_KIT_BAYS.length);
  for (const picker of inside) {
    const dimensions = dimensionsFor(picker, catalogue);
    for (const d of dimensions) {
      const label = dimensions.length > 1 ? `${picker.label} — ${d.label}` : picker.label;
      const g = groupNamed(advanced, label);
      assert.ok(g, `"${label}" is not under Advanced`);
      assert.equal(byRole(g, 'radio').length, d.ids.length);
    }
  }

  // Four headings, each a disclosure of its own, and between them they hold
  // every inside picker exactly once — the outside and the inside together are
  // the catalogue.
  const subs = byClass(advanced, 'settings-look-sub');
  assert.deepEqual(
    subs.map((d) => [d.tagName, d.children[0].tagName, d.children[0].textContent]),
    ADVANCED_GROUPS.map((g) => ['DETAILS', 'SUMMARY', g.label]),
  );
  // From the largest thing a look decides to the smallest.
  assert.deepEqual(
    ADVANCED_GROUPS.map((g) => g.label),
    ['Walls and room colours', 'Floors', 'Furniture and textiles', 'Plants and props'],
  );
  // The partitions and the room colours are the first heading's, and nothing
  // else is: they are not furniture, which is where the rule used to drop them.
  assert.deepEqual(
    advancedGroups(catalogue)[0].pickers.map((p) => p.id),
    ['partitions', 'roomTint'],
  );
  const grouped = advancedGroups(catalogue).flatMap((g) => g.pickers.map((p) => p.id));
  assert.deepEqual([...grouped].sort(), inside.map((p) => p.id).sort());
  assert.deepEqual(
    [...grouped, ...OUTSIDE_PICKER_IDS].sort(),
    LOOK_PICKERS.map((p) => p.id).sort(),
  );
  // A picker the catalogue grows tomorrow lands under a heading without
  // anybody editing a list.
  const grown = { ...catalogue, LOOK_PICKERS: [...LOOK_PICKERS, { id: 'lighting', path: 'x' }] };
  assert.ok(advancedGroups(grown).some((g) => g.pickers.some((p) => p.id === 'lighting')));
});

test('the closed disclosure says what is in it, and stays the way it was left', () => {
  const clean = mount();
  assert.equal(
    advancedOf(clean.draw()).children[0].textContent,
    'Advanced — no changes from Studio oak',
  );
  const edited = mount({
    look: normalizeLook({ ...DEFAULT_LOOK, scheme: 'cool', props: { density: 'busy' } }),
  });
  const summary = advancedOf(edited.draw()).children[0];
  assert.equal(summary.textContent, 'Advanced — 2 changes from Studio oak');
  // The heading each change is under says so too.
  const subs = byClass(edited.host, 'settings-look-sub').map((d) => d.children[0].textContent);
  assert.deepEqual(subs, [
    'Walls and room colours',
    'Floors — 1 change',
    'Furniture and textiles',
    'Plants and props — 1 change',
  ]);
  // A change made on the OUTSIDE is a change from the preset too, and it is
  // counted under the heading its row would be in.
  const lit = mount({
    look: normalizeLook({ ...DEFAULT_LOOK, light: 'evening', roomTint: 'zoned' }),
  });
  assert.equal(
    advancedOf(lit.draw()).children[0].textContent,
    'Advanced — 2 changes from Studio oak',
  );
  assert.equal(
    byClass(lit.host, 'settings-look-sub')[0].children[0].textContent,
    'Walls and room colours — 1 change',
  );

  // Remembered per browser: opening it writes, and the next sheet reads.
  const kept = new Map();
  const prefs = { get: (k) => kept.get(k) ?? null, set: (k, v) => void kept.set(k, v) };
  const first = mount({ prefs });
  const details = advancedOf(first.draw());
  details.fire('toggle'); // the browser reporting the state it was built with
  assert.equal(kept.size, 0, 'being drawn is not being opened');
  details.open = true;
  details.fire('toggle');
  assert.equal(kept.get('advanced'), 'open');
  // A redraw in this tab keeps it, and so does a new sheet in this browser.
  assert.equal(advancedOf(first.draw()).open, true);
  assert.equal(advancedOf(mount({ prefs }).draw()).open, true);
  // The headings inside start open, and shutting one is remembered the same way.
  const sub = subNamed(first.draw(), 'Floors');
  assert.equal(sub.open, true);
  sub.open = false;
  sub.fire('toggle');
  assert.equal(kept.get('group.floors'), 'closed');
  assert.equal(subNamed(mount({ prefs }).draw(), 'Floors').open, false);
});

/** The heading under Advanced whose name is `label`, as drawn. */
const subNamed = (root, label) =>
  byClass(root, 'settings-look-sub').find((d) => d.children[0].children[0].textContent === label);

test('a reason is never drawn inside a shut disclosure', () => {
  const kept = new Map([
    ['advanced', 'closed'],
    ['group.floors', 'closed'],
  ]);
  const prefs = { get: (k) => kept.get(k) ?? null, set: (k, v) => void kept.set(k, v) };
  const { draw } = mount({ prefs });
  assert.equal(advancedOf(draw()).open, false);
  chip(groupNamed(draw(), 'Office floor'), 'Terrazzo').fire('click');
  const root = draw();
  assert.equal(byClass(root, 'settings-look-refusal').length, 1);
  assert.equal(advancedOf(root).open, true, 'the reason is inside a shut Advanced');
  assert.equal(subNamed(root, 'Floors').open, true, 'and inside a shut Floors');
  // Opened for the reason, not for good: nothing was remembered.
  assert.equal(kept.get('advanced'), 'closed');
});

test('a preset is a style: choosing one leaves the agent size alone, and "edited" is about the style', () => {
  // The second way a highlight "went back to the default": choose Large, choose
  // a preset, and Medium was lit again. Workshop ships at `small`.
  assert.equal(lookForPreset('workshop').agentSize, 'small');
  const { draw, posted } = mount({ look: normalizeLook({ ...DEFAULT_LOOK, agentSize: 'large' }) });

  // A size is not an edit: the style is Studio oak's, untouched.
  let root = draw();
  assert.equal(advancedOf(root).children[0].textContent, 'Advanced — no changes from Studio oak');
  assert.equal(
    find(root, (n) => n.textContent === 'Reset to preset')[0].getAttribute('disabled'),
    '',
  );

  chip(groupNamed(root, 'Style'), 'Workshop').fire('click');
  assert.equal(posted.length, 1);
  assert.equal(posted[0].preset, 'workshop');
  assert.equal(posted[0].agentSize, 'large', 'the preset reset the agent size');
  assert.ok(
    sameLook({ ...posted[0], agentSize: 'small' }, lookForPreset('workshop')),
    'the preset did not apply its whole style',
  );
  root = draw();
  assert.equal(chip(groupNamed(root, 'Agent size'), 'Large').getAttribute('aria-checked'), 'true');
  assert.equal(chip(groupNamed(root, 'Style'), 'Workshop').getAttribute('aria-checked'), 'true');
  assert.equal(advancedOf(root).children[0].textContent, 'Advanced — no changes from Workshop');
});

test('Density is one control over two options: plants and props move together', () => {
  const levels = densityLevels(catalogue);
  assert.deepEqual(
    levels.map((l) => l.label),
    ['Calm', 'Normal', 'Lively'],
  );
  // Each step is the pair at that position in the catalogue's own two tables.
  assert.deepEqual(
    levels.map((l) => [l.plants, l.props]),
    catalogue.PLANT_DENSITY_IDS.map((id, i) => [id, catalogue.PROP_DENSITY_IDS[i]]),
  );

  const { draw, posted } = mount();
  assert.equal(chip(groupNamed(draw(), 'Density'), 'Normal').getAttribute('aria-checked'), 'true');
  chip(groupNamed(draw(), 'Density'), 'Lively').fire('click');
  assert.deepEqual(
    [posted[0].plants.density, posted[0].props.density],
    [catalogue.PLANT_DENSITY_IDS.at(-1), catalogue.PROP_DENSITY_IDS.at(-1)],
  );
  // Nothing else about the look moved.
  assert.ok(
    sameLook(
      { ...posted[0], plants: DEFAULT_LOOK.plants, props: DEFAULT_LOOK.props },
      DEFAULT_LOOK,
    ),
  );
  let root = draw();
  assert.equal(chip(groupNamed(root, 'Density'), 'Lively').getAttribute('aria-checked'), 'true');
  // The two pickers under Advanced show the same thing — it is one look.
  assert.equal(
    chip(groupNamed(root, 'Planting — Density'), 'Lush').getAttribute('aria-checked'),
    'true',
  );
  assert.equal(chip(groupNamed(root, 'Prop density'), 'Busy').getAttribute('aria-checked'), 'true');

  // Set apart under Advanced, they are no step at all — and it says where.
  chip(groupNamed(root, 'Prop density'), 'Quiet').fire('click');
  root = draw();
  const density = groupNamed(root, 'Density');
  assert.deepEqual(
    byRole(density, 'radio').map((b) => b.getAttribute('aria-checked')),
    ['false', 'false', 'false'],
  );
  assert.equal(byRole(density, 'radio')[0].getAttribute('tabindex'), '0', 'no way in by Tab');
  assert.ok(find(root, (n) => /set separately, under Advanced/.test(n._text || '')).length > 0);
});

test('Theme is stored first and painted second, and a pointer over one only previews it', async () => {
  const { draw, saves, painted, store } = mount();
  const theme = () => groupNamed(draw(), 'Theme');
  assert.equal(chip(theme(), 'Default').getAttribute('aria-checked'), 'true');

  chip(theme(), 'Blueprint').fire('pointerenter');
  assert.deepEqual(painted, ['blueprint'], 'pointing at a theme did not show it');
  assert.deepEqual(saves, [], 'pointing at a theme saved it');
  theme().fire('pointerleave');
  assert.deepEqual(painted, ['blueprint', 'default'], 'leaving did not put the stored one back');

  chip(theme(), 'Night shift').fire('click');
  assert.equal(chip(theme(), 'Night shift').getAttribute('aria-checked'), 'true');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(saves, [{ theme: 'night shift' }]);
  assert.equal(painted.at(-1), 'night shift');
  assert.equal(store.storedTheme(), 'night shift');
  assert.equal(chip(theme(), 'Night shift').getAttribute('aria-checked'), 'true');
});

test('every picker’s dimensions partition its own options exactly', () => {
  // The two-dimensional pickers — a rug is a tone AND a pattern — are split by
  // membership in the catalogue's own id tables. If a third dimension were ever
  // added to one, this is where the missing chips would be caught.
  for (const picker of LOOK_PICKERS) {
    const dimensions = dimensionsFor(picker, catalogue);
    const covered = dimensions.flatMap((d) => [...d.ids]).sort();
    const offered = picker.options.map((o) => o.id).sort();
    assert.deepEqual(covered, offered, `${picker.id}’s dimensions lose or repeat an option`);
    for (const d of dimensions) assert.ok(d.ids.length > 0, `${d.path} is an empty group`);
  }
});

test('the preset cards are there, the current one is checked, and it says so', () => {
  const { draw } = mount();
  const strip = byRole(draw(), 'radiogroup').find((g) => g.getAttribute('aria-label') === 'Style');
  assert.ok(strip, 'the preset strip is gone');
  const cards = byRole(strip, 'radio');
  assert.equal(cards.length, PRESETS.length);
  assert.equal(
    cards.length,
    11,
    'the six that shipped, and the five whose light, partitions and room colours are painted',
  );
  const checked = cards.filter((c) => c.getAttribute('aria-checked') === 'true');
  assert.equal(checked.length, 1);
  assert.equal(checked[0].textContent, 'Studio oak');
  // Each card is its name, straight off the catalogue, and its one-line
  // character is the card's tooltip rather than six sentences on the sheet.
  for (const preset of PRESETS) {
    assert.ok(
      cards.some((c) => c.textContent === preset.label && c.title === preset.blurb),
      `the ${preset.id} card lost its name or its blurb`,
    );
  }
});

test('the measured numbers are the guard’s own, not a second measurement — and they are a detail', () => {
  const { draw } = mount();
  const root = draw();
  const line = byClass(root, 'settings-look-metrics')[0];
  assert.ok(line, 'the section reports nothing the guard measured');
  // Contrast ratios are not what somebody choosing a floor came for: they are
  // under Advanced, with the rest of the detail.
  assert.ok(within(advancedOf(root), line), 'the contrast figures are on the outside');
  for (const m of lookMetrics(DEFAULT_LOOK, 'default')) {
    assert.ok(
      line.textContent.includes(`${m.label} ${m.ratio.toFixed(2)}:1`),
      `the preview does not report "${m.label}"`,
    );
  }
  // The shipped floor, as §4's mockup prints it.
  assert.ok(line.textContent.includes('office | corridor 1.02:1'));
  assert.ok(line.textContent.includes('worst floor ink 8.93:1'));
});

// ------------------------------------------------------------- the writing

test('changing a picker posts a valid look, and the floor re-derives from it', () => {
  const { draw, posted } = mount();
  const group = groupNamed(draw(), 'Rooms floor');
  chip(group, 'Cork').fire('click');

  assert.equal(posted.length, 1, 'one change, one post');
  const next = normalizeLook(posted[0]);
  assert.equal(next.floors.rooms, 'cork');
  assert.ok(validateLook(next, 'default').ok, 'the section posted a look the guard refuses');
  // "The floor re-derives": the resolved material for the rooms zone is the one
  // that was chosen, and everything else is untouched.
  const resolved = resolveLook(next, 'default');
  assert.equal(resolved.zones.rooms.id, 'cork');
  assert.equal(resolved.zones.office.id, DEFAULT_LOOK.floors.office);

  // And the section now shows it, because the daemon confirmed it.
  const after = groupNamed(draw(), 'Rooms floor');
  assert.equal(chip(after, 'Cork').getAttribute('aria-checked'), 'true');
});

test('a refused combination shows the guard’s reason and posts nothing at all', () => {
  const { draw, posted, look } = mount();
  const before = look();
  const group = groupNamed(draw(), 'Office floor');
  // Terrazzo in the office leaves the poured-screed corridor at 1.00:1 against
  // it — §1 rule 3's second clause, and one of the refusals WP-88a measured.
  chip(group, 'Terrazzo').fire('click');

  assert.deepEqual(posted, [], 'a refused combination was posted');
  assert.equal(look(), before, 'a refused combination changed the stored look');

  const root = draw();
  const refusal = byClass(root, 'settings-look-refusal')[0];
  assert.ok(refusal, 'the refusal says nothing');
  const expected = validateLook(
    { ...DEFAULT_LOOK, floors: { ...DEFAULT_LOOK.floors, office: 'terrazzo' } },
    'default',
  ).problems[0];
  assert.ok(
    refusal.textContent.includes(expected.reason),
    `the row does not carry the guard's own sentence: ${refusal.textContent}`,
  );
  assert.ok(refusal.textContent.includes('Nothing was changed.'));

  // AND THE CONTROL IS WHERE IT WAS. This is the half of rule 2 that a reason
  // alone does not prove: the chip that was refused is not checked.
  const after = groupNamed(root, 'Office floor');
  assert.equal(chip(after, 'Terrazzo').getAttribute('aria-checked'), 'false');
  assert.equal(chip(after, 'Herringbone oak').getAttribute('aria-checked'), 'true');
});

test('the refusal is drawn under the control the hand was on, not two rows away', () => {
  // The guard says this problem is the CORRIDOR's — the corridor is the zone
  // that lost its edge — but the chip that refused to move is the office's.
  const { draw } = mount();
  chip(groupNamed(draw(), 'Office floor'), 'Terrazzo').fire('click');
  const root = draw();
  const refusal = byClass(root, 'settings-look-refusal')[0];
  assert.ok(refusal, 'no refusal row was drawn');
  const rows = find(root, (n) => n.children.includes(refusal))[0].children;
  const at = rows.indexOf(refusal);
  assert.ok(
    rows[at - 1].textContent.startsWith('Office floor'),
    `the refusal sits under "${rows[at - 1].textContent.slice(0, 24)}", not under the office floor`,
  );
});

test('a refusal on the outside is drawn under the outside control that was touched', () => {
  // A guard that refuses every look but the shipped one, so a preset is refused.
  const { draw, posted, store } = mount();
  store.port.validate = (next) =>
    sameLook(next, DEFAULT_LOOK)
      ? { ok: true, problems: [] }
      : { ok: false, problems: [{ picker: 'floor.office', reason: 'not on this floor' }] };
  chip(groupNamed(draw(), 'Style'), 'Night lab').fire('click');
  assert.deepEqual(posted, []);
  const root = draw();
  const refusal = byClass(root, 'settings-look-refusal')[0];
  assert.match(refusal.textContent, /not on this floor\. Nothing was changed\./);
  const rows = find(root, (n) => n.children.includes(refusal))[0].children;
  assert.ok(rows[rows.indexOf(refusal) - 1].textContent.startsWith('Style'));
  assert.ok(!within(advancedOf(root), refusal), 'the reason was put under the guard’s row instead');
  assert.equal(chip(groupNamed(root, 'Style'), 'Studio oak').getAttribute('aria-checked'), 'true');
});

test('the locked lounge bay is reachable, checked, and accounted for', () => {
  const { draw, posted } = mount();
  const root = draw();
  const sitting = byRole(root, 'checkbox').find((b) => b.textContent === 'Sitting');
  // `aria-disabled` rather than `disabled`: still in the tab order, so a
  // keyboard user does not meet a kit of four with three controls in it.
  assert.equal(sitting.getAttribute('aria-disabled'), 'true');
  assert.equal(sitting.getAttribute('aria-checked'), 'true');
  assert.equal(sitting.getAttribute('tabindex'), '0', 'the locked bay is off the keyboard');
  sitting.fire('click');
  assert.deepEqual(posted, [], 'turning the sitting bay off was posted');
  assert.equal(
    byRole(draw(), 'checkbox')
      .find((b) => b.textContent === 'Sitting')
      .getAttribute('aria-checked'),
    'true',
  );
  // And the row says so beside the control rather than after it was pressed.
  const note = find(root, (n) => /Sitting is always on/.test(n._text || ''))[0];
  assert.ok(note, 'nothing on this row accounts for the bay that will not move');

  // The other three do move.
  byRole(draw(), 'checkbox')
    .find((b) => b.textContent === 'Games')
    .fire('click');
  assert.equal(posted.length, 1);
  assert.equal(normalizeLook(posted[0]).lounge.games, false);
});

test('reset puts every option back to the preset the look started from', () => {
  const edited = normalizeLook({ ...DEFAULT_LOOK, scheme: 'cool', props: { density: 'busy' } });
  assert.ok(!sameLook(edited, lookForPreset('studio-oak')));
  const { draw, posted } = mount({ look: edited });

  const root = draw();
  assert.ok(
    find(root, (n) => n._text === 'Studio oak · edited').length > 0,
    'the Style row does not say the style was edited',
  );
  const reset = find(root, (n) => n.textContent === 'Reset to preset')[0];
  assert.ok(within(advancedOf(root), reset), 'the reset is not with the options it resets');
  assert.ok(reset, 'there is no way back to the preset');
  assert.equal(reset.getAttribute('disabled'), null, 'the way back is disabled on an edited look');
  reset.fire('click');

  assert.equal(posted.length, 1);
  assert.ok(sameLook(posted[0], lookForPreset('studio-oak')));
  // And on an unedited look there is nothing to go back to, and it says so.
  const clean = mount();
  const button = find(clean.draw(), (n) => n.textContent === 'Reset to preset')[0];
  assert.equal(button.getAttribute('disabled'), '');
});

test('a look the daemon refuses is reported, and the section falls back to what is stored', async () => {
  // The daemon measures against EVERY shipped theme; this tab measured one. A
  // look that passes here and fails there is the whole reason the answer is
  // reconciled rather than assumed.
  const { draw, look } = mount({
    apply: () => ({
      ok: false,
      problems: [{ picker: 'floor.rooms', reason: 'on night shift that rug would not read' }],
    }),
  });
  chip(groupNamed(draw(), 'Rooms floor'), 'Cork').fire('click');
  await new Promise((r) => setImmediate(r));
  assert.equal(look().floors.rooms, DEFAULT_LOOK.floors.rooms);
  const root = draw();
  assert.match(
    byClass(root, 'settings-look-refusal')[0].textContent,
    /on night shift that rug would not read/,
  );
  assert.equal(chip(groupNamed(root, 'Rooms floor'), 'Cork').getAttribute('aria-checked'), 'false');
});

// ------------------------------------------------------------- the keyboard

test('every control in the section is on a keyboard path', () => {
  const { draw } = mount({ pictures: true });
  const root = draw();

  // One Tab stop per radiogroup — the roving tabindex — and it is on the chip
  // that is actually chosen, so Tab lands where the eye already is.
  for (const group of byRole(root, 'radiogroup')) {
    const radios = byRole(group, 'radio');
    assert.ok(radios.length > 0, `${group.getAttribute('aria-label')} has no options`);
    const stops = radios.filter((r) => r.getAttribute('tabindex') === '0');
    assert.equal(
      stops.length,
      1,
      `${group.getAttribute('aria-label')} has ${stops.length} Tab stops; a radiogroup has one`,
    );
    assert.equal(stops[0].getAttribute('aria-checked'), 'true');
    assert.ok(group.getAttribute('aria-label'), 'a radiogroup with no accessible name');
  }

  // Nothing else is hidden from Tab: every remaining button is either native
  // (no tabindex at all) or explicitly at 0. A `-1` outside a radiogroup would
  // be a control only a mouse can reach.
  const inGroup = new Set(byRole(root, 'radiogroup').flatMap((g) => byRole(g, 'radio')));
  for (const node of find(root, (n) => n.tagName === 'BUTTON')) {
    if (inGroup.has(node)) continue;
    const tabindex = node.getAttribute('tabindex');
    assert.ok(tabindex === null || tabindex === '0', `a button sits at tabindex ${tabindex}`);
  }

  // And every canvas is hidden from the screen reader, because it is the
  // picture of a control that already has a name.
  const canvases = find(root, (n) => n.tagName === 'CANVAS');
  assert.ok(canvases.length > 0, 'no pictures were asked for');
  for (const c of canvases) assert.equal(c.getAttribute('aria-hidden'), 'true');
});

test('arrow keys move inside a picker, and wrap', () => {
  const { draw, posted } = mount();
  const group = groupNamed(draw(), 'Colour scheme');
  const radios = byRole(group, 'radio');
  assert.equal(radios[0].textContent, 'Warm');

  let prevented = 0;
  radios[0].fire('keydown', { key: 'ArrowRight', preventDefault: () => prevented++ });
  assert.ok(radios[1].focused, 'ArrowRight did not move the focus');
  assert.equal(normalizeLook(posted.at(-1)).scheme, 'cool');
  assert.equal(prevented, 1, 'the arrow key was left to scroll the sheet as well');

  // Home and End reach the ends; ArrowLeft from the first wraps to the last.
  const next = groupNamed(draw(), 'Colour scheme');
  byRole(next, 'radio')[0].fire('keydown', { key: 'ArrowLeft', preventDefault: () => {} });
  assert.equal(normalizeLook(posted.at(-1)).scheme, 'ink');
  const last = groupNamed(draw(), 'Colour scheme');
  byRole(last, 'radio')[5].fire('keydown', { key: 'Home', preventDefault: () => {} });
  assert.equal(normalizeLook(posted.at(-1)).scheme, 'warm');
  // A key that is not navigation is left alone.
  const idle = posted.length;
  byRole(draw(), 'radio')[0].fire('keydown', { key: 'a', preventDefault: () => {} });
  assert.equal(posted.length, idle);
});

// ------------------------------------------------------------ the pictures

test('every swatch and every preview is painted by the floor’s own painters', async () => {
  // §5's *"a source-reading test proves every swatch and preview is painted by
  // `backdrop-floor.js`"*. Read rather than asserted in prose, because the way
  // this promise breaks is somebody writing a second, simpler herringbone here
  // to save an import — and then fixing only one of the two.
  const fs = await import('node:fs/promises');
  const url = new URL('../../public/look-ui-thumbs.js', import.meta.url);
  const src = await fs.readFile(url, 'utf8');
  assert.match(src, /from '\.\/render\/backdrop-floor-look\.js'/);
  assert.match(src, /paintFloorMaterial\(/);
  assert.match(src, /paintProp\(/);
  // No colour of its own, and no second source of randomness: both are how a
  // swatch would start to drift from the floor it stands for. Comments are
  // stripped first — this file EXPLAINS why it has no `Math.random()`, and the
  // explanation is worth keeping (`settings-keys.test.mjs` strips them for the
  // same reason).
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.equal(/#[0-9a-fA-F]{3,8}\b/.test(code), false, 'a swatch painter holds a colour');
  assert.equal(/Math\.random|Date\.now/.test(code), false);
});

test('every preset thumbnail at 160 x 100 stays inside the draw-call budget', () => {
  let total = 0;
  const perPreset = [];
  for (const preset of PRESETS) {
    const ctx = recorder();
    paintLookThumbnail(ctx, { look: preset.look, theme: 'default', w: THUMB_W, h: THUMB_H });
    assert.ok(ctx.ops.length > 100, `${preset.id} painted almost nothing (${ctx.ops.length} ops)`);
    perPreset.push(`${preset.id} ${ctx.ops.length}`);
    total += ctx.ops.length;
  }
  // The budget is per card, so the ceiling follows the number of presets and
  // nobody has to remember to raise it when a twelfth is drawn.
  const budget = LOOK_THUMB_DRAW_BUDGET * PRESETS.length;
  console.log(
    `  [look] ${PRESETS.length} cards cost ${total} operations, ${Math.round(total / PRESETS.length)} each ` +
      `against ${LOOK_THUMB_DRAW_BUDGET} — ${perPreset.join(', ')}`,
  );
  assert.ok(
    total <= budget,
    `the ${PRESETS.length} cost ${total} operations against a budget of ${budget} — ${perPreset.join(', ')}`,
  );
});

test('a swatch is cheaper than a thumbnail, and a repaint of one is byte-identical', () => {
  const once = recorder();
  paintLookSwatch(once, { look: DEFAULT_LOOK, theme: 'default', zone: 'office', rug: 'wool' });
  const twice = recorder();
  paintLookSwatch(twice, { look: DEFAULT_LOOK, theme: 'default', zone: 'office', rug: 'wool' });
  // Deterministic: terrazzo and cork scatter, and a swatch that moved between
  // two paints of the same option could never be a golden.
  assert.deepEqual(once.ops, twice.ops);
  assert.ok(once.ops.length < LOOK_THUMB_DRAW_BUDGET);
});

test('painting a swatch leaves the live look exactly as it found it', async () => {
  const { LOOK } = await import('../../public/render/look-derive.js');
  const before = JSON.stringify(LOOK.look);
  const theme = LOOK.theme;
  const field = LOOK.zones.office.field;
  for (const preset of PRESETS) {
    paintLookThumbnail(recorder(), { look: preset.look, theme: 'night shift' });
  }
  assert.equal(JSON.stringify(LOOK.look), before, 'a thumbnail left the floor in another look');
  assert.equal(LOOK.theme, theme);
  assert.equal(LOOK.zones.office.field, field);
});

test('every option the section can offer is a swatch spec the painter understands', () => {
  // The five groups with no picture — the furniture set, the two densities,
  // WP-88c's agent size and the light — are deliberate and say so; what this
  // catches is a NEW picker silently joining them because nobody taught
  // `swatchSpecFor` about it. The partitions and the room colours left that
  // list when the section learned to draw two rooms and the wall between them.
  const without = new Set(['furniture', 'plants', 'props', 'agentSize', 'light']);
  for (const picker of LOOK_PICKERS) {
    for (const option of picker.options) {
      const spec = swatchSpecFor(picker, option.id, DEFAULT_LOOK, catalogue);
      if (without.has(picker.id)) {
        assert.equal(spec, null, `${picker.id} grew a swatch without a decision`);
        continue;
      }
      assert.ok(spec, `${picker.id}/${option.id} has no swatch`);
      const ctx = recorder();
      paintLookSwatch(ctx, { ...spec, theme: 'default' });
      assert.ok(ctx.ops.length > 0, `${picker.id}/${option.id} painted nothing`);
    }
  }
});

// ------------------------------------------------------------ the file out

test('what Export writes is what Import reads', () => {
  // §5: *"export | import is a fixed point"*. The document the route hands the
  // download is the document the route accepts back, for every preset and for
  // a look the section itself produced.
  const { draw, posted } = mount();
  chip(groupNamed(draw(), 'Lounge floor'), 'Terrazzo').fire('click');
  const edited = normalizeLook(posted[0]);

  for (const look of [DEFAULT_LOOK, edited, ...PRESETS.map((p) => p.look)]) {
    const doc = buildLookDocument({ look });
    assert.equal(doc.kind, 'deckhq.look');
    assert.equal(doc.version, 1);
    const result = validateLookDocument(JSON.parse(JSON.stringify(doc)));
    assert.ok(!('error' in result), `a look this section can produce is refused on import`);
    const { kind: _k, version: _v, ...back } = result.look;
    assert.ok(sameLook(back, look), 'the round trip painted a different floor');
    assert.deepEqual(
      buildLookDocument({ look: back }),
      doc,
      'export | import is not a fixed point',
    );
  }
});

// ------------------------------------------------------------- the recorder

/**
 * A 2D context that counts what it was told to do.
 *
 * `lighting.test.mjs`'s device, kept to a count rather than a transcript: what
 * this suite asks is *how much*, and a painter that draws the wrong thing is a
 * question for the goldens.
 */
function recorder() {
  const ops = [];
  const noop = (/** @type {string} */ name) => () => void ops.push(name);
  const gradient = () => ({ addColorStop: () => {} });
  const ctx = {
    ops,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineCap: '',
    lineJoin: '',
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    font: '',
    textAlign: '',
    textBaseline: '',
    measureText: (/** @type {string} */ t) => ({ width: String(t).length * 6 }),
    createLinearGradient: gradient,
    createRadialGradient: gradient,
    createPattern: () => null,
  };
  for (const name of [
    'save',
    'restore',
    'translate',
    'rotate',
    'scale',
    'beginPath',
    'closePath',
    'moveTo',
    'lineTo',
    'quadraticCurveTo',
    'bezierCurveTo',
    'arc',
    'arcTo',
    'ellipse',
    'rect',
    'roundRect',
    'clip',
    'fill',
    'stroke',
    'setLineDash',
    'strokeRect',
    'fillRect',
    'clearRect',
    'fillText',
    'strokeText',
    'drawImage',
  ]) {
    ctx[name] = noop(name);
  }
  return ctx;
}
