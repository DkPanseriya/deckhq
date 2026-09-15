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
  let stored = opts.look || DEFAULT_LOOK;
  const host = new StubNode('div');
  const widgets = createSettingsWidgets({
    theming: { swatches: () => [] },
    shippedThemes: () => [],
    applyThemeSetting: (/** @type {string} */ n) => n,
    availableAvatarSets: () => [],
  });
  const section = createLookSection({
    doc,
    widgets,
    debounceMs: 0,
    getLook: () => stored,
    toast: () => {},
    look: {
      catalogue: () => catalogue,
      validate: validateLook,
      metrics: lookMetrics,
      theme: () => 'default',
      picture: () => (opts.pictures ? new StubNode('canvas') : null),
      apply: async (/** @type {any} */ next) => {
        posted.push(next);
        const answer = opts.apply ? opts.apply(next) : { ok: true };
        if (answer.ok) stored = normalizeLook(next);
        return answer;
      },
      exportLook: () => {},
      importLook: () => {},
    },
  });
  const draw = () => {
    host.children = [];
    section.renderInto(host);
    return host;
  };
  section.wire({ render: draw });
  return { section, host, posted, draw, look: () => stored };
}

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
    const name = bay === 'cafe' ? 'café' : bay;
    assert.ok(
      byRole(root, 'checkbox').some((n) => n.textContent === name),
      `the lounge kit has no checkbox for "${bay}"`,
    );
  }
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

test('the six preset cards are there, the current one is checked, and it says so', () => {
  const { draw } = mount();
  const strip = byRole(draw(), 'radiogroup').find((g) => g.getAttribute('aria-label') === 'Preset');
  assert.ok(strip, 'the preset strip is gone');
  const cards = byRole(strip, 'radio');
  assert.equal(cards.length, PRESETS.length);
  assert.equal(cards.length, 6, '§3 promises six starting points');
  const checked = cards.filter((c) => c.getAttribute('aria-checked') === 'true');
  assert.equal(checked.length, 1);
  assert.ok(checked[0].textContent.startsWith('Studio oak'));
  // Each card carries its own one-line character, straight off the catalogue.
  for (const preset of PRESETS) {
    assert.ok(
      cards.some((c) => c.textContent === `${preset.label}${preset.blurb}`),
      `the ${preset.id} card lost its name or its blurb`,
    );
  }
});

test('the numbers under the preview are the guard’s own, not a second measurement', () => {
  const { draw } = mount();
  const line = byClass(draw(), 'settings-look-metrics')[0];
  assert.ok(line, 'the live preview reports nothing');
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
  const rows = draw().children[0].children;
  const at = rows.findIndex((n) => String(n.className).includes('settings-look-refusal'));
  assert.ok(at > 0, 'no refusal row was drawn');
  assert.ok(
    rows[at - 1].textContent.startsWith('Office floor'),
    `the refusal sits under "${rows[at - 1].textContent.slice(0, 24)}", not under the office floor`,
  );
});

test('the locked lounge bay is reachable, checked, and accounted for', () => {
  const { draw, posted } = mount();
  const root = draw();
  const sitting = byRole(root, 'checkbox').find((b) => b.textContent === 'sitting');
  // `aria-disabled` rather than `disabled`: still in the tab order, so a
  // keyboard user does not meet a kit of four with three controls in it.
  assert.equal(sitting.getAttribute('aria-disabled'), 'true');
  assert.equal(sitting.getAttribute('aria-checked'), 'true');
  assert.equal(sitting.getAttribute('tabindex'), '0', 'the locked bay is off the keyboard');
  sitting.fire('click');
  assert.deepEqual(posted, [], 'turning the sitting bay off was posted');
  assert.equal(
    byRole(draw(), 'checkbox')
      .find((b) => b.textContent === 'sitting')
      .getAttribute('aria-checked'),
    'true',
  );
  // And the row says WHY, in §1.g's own words, beside the control rather than
  // after it has been pressed.
  const note = find(root, (n) => /sitting is always on/.test(n.textContent || ''))[0];
  assert.ok(note, 'nothing on this row accounts for the bay that will not move');
  assert.match(note.textContent, /a lounge with nowhere to sit is a field again/);

  // The other three do move.
  byRole(draw(), 'checkbox')
    .find((b) => b.textContent === 'games')
    .fire('click');
  assert.equal(posted.length, 1);
  assert.equal(normalizeLook(posted[0]).lounge.games, false);
});

test('reset puts every option back to the preset the look started from', () => {
  const edited = normalizeLook({ ...DEFAULT_LOOK, scheme: 'cool', props: { density: 'busy' } });
  assert.ok(!sameLook(edited, lookForPreset('studio-oak')));
  const { draw, posted } = mount({ look: edited });

  const root = draw();
  assert.match(byClass(root, 'settings-look-state-name')[0].textContent, /Studio oak · edited/);
  const reset = find(root, (n) => n.textContent === 'Reset to preset')[0];
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

test('all six preset thumbnails at 160 x 100 stay inside the draw-call budget', () => {
  let total = 0;
  const perPreset = [];
  for (const preset of PRESETS) {
    const ctx = recorder();
    paintLookThumbnail(ctx, { look: preset.look, theme: 'default', w: THUMB_W, h: THUMB_H });
    assert.ok(ctx.ops.length > 100, `${preset.id} painted almost nothing (${ctx.ops.length} ops)`);
    perPreset.push(`${preset.id} ${ctx.ops.length}`);
    total += ctx.ops.length;
  }
  assert.ok(
    total <= LOOK_THUMB_DRAW_BUDGET,
    `the six cost ${total} operations against a budget of ${LOOK_THUMB_DRAW_BUDGET} — ${perPreset.join(', ')}`,
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
  assert.ok(once.ops.length < LOOK_THUMB_DRAW_BUDGET / 6);
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
  // The three groups with no picture — the furniture set and the two densities —
  // are deliberate and say so; what this catches is a NEW picker silently
  // joining them because nobody taught `swatchSpecFor` about it.
  const without = new Set(['furniture', 'plants', 'props']);
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
