/**
 * The header's Look and Settings buttons, the popover, the one-time hint and
 * the settings sheet's section nav.
 *
 * The owner, looking at his own floor: *"I still don't see any bar anywhere, any
 * settings options, to configure floor design, agent sizes, etc."* Every control
 * he meant existed and was reachable only through the palette. This suite holds
 * the fix to what it claims:
 *
 *   1. **The two buttons are in the document**, as real buttons with accessible
 *      names, between the palette hint and `+ New agent`, each naming its key.
 *   2. **The popover's three controls write the right thing.** Agent size and
 *      Preset go to the look port; Theme goes to the settings route.
 *   3. **A refusal shows the guard's reason and sends nothing.**
 *   4. **It is a popover.** Escape closes it and gives focus back, a click
 *      outside closes it, and it is not a full-surface view.
 *   5. **The hint shows once.**
 *   6. **The sheet's nav is derived from the sections drawn**, not from a list.
 *
 * NO jsdom, `look-ui.test.mjs`'s rule: `look-ui-bar.js` and `settings-ui-nav.js`
 * take their document as a parameter and are handed the stub below. The shell
 * half — the real ports, the real `fetch` bodies, the real key map — is
 * `look-bar-shell.test.mjs`.
 *
 * **The catalogue is never restated here.** The four sizes and the six presets
 * are read from `look-options.js`, so a package that adds a preset gets a
 * thumbnail in the popover and this suite proves it rather than assuming it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as catalogue from '../../public/render/look-options.js';
import {
  AGENT_SIZES,
  DEFAULT_LOOK,
  PRESETS,
  lookForPreset,
  normalizeLook,
} from '../../public/render/look-options.js';
import { validateLook } from '../../public/render/look-guards.js';
import { LOOK_HINT_TEXT, LOOK_KEY, SETTINGS_KEY, createLookBar } from '../../public/look-ui-bar.js';
import { buildCommandEntries } from '../../public/palette-commands.js';
import {
  currentSection,
  fillSectionNav,
  markCurrentSection,
  sectionId,
  sectionsOf,
} from '../../public/settings-ui-nav.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../../public');
const RAW_HTML = fs.readFileSync(path.join(PUBLIC, 'index.html'), 'utf8');
/** Comments blanked: several of them explain what this markup deliberately is not. */
const HTML = RAW_HTML.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
const CSS = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');

// --------------------------------------------------------------- DOM stub

class StubNode {
  /** @param {string} tagName @param {any} [doc] */
  constructor(tagName, doc = null) {
    this.tagName = String(tagName).toUpperCase();
    this.doc = doc;
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.id = '';
    this.type = '';
    this.title = '';
    this.hidden = false;
    this.style = {};
    this.attrs = /** @type {Record<string,string>} */ ({});
    this.listeners = /** @type {Record<string, Function[]>} */ ({});
    this.rect = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 };
    this.scrolled = 0;
    this._text = null;
  }
  appendChild(child) {
    child.parentNode = this;
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
  removeAttribute(name) {
    delete this.attrs[name];
  }
  addEventListener(name, fn) {
    (this.listeners[name] ||= []).push(fn);
  }
  removeEventListener(name, fn) {
    this.listeners[name] = (this.listeners[name] || []).filter((f) => f !== fn);
  }
  /** Fire one, the way a browser would. @param {string} name @param {any} [event] */
  fire(name, event = {}) {
    for (const fn of [...(this.listeners[name] || [])]) fn(event);
    return event;
  }
  focus() {
    if (this.doc) this.doc.activeElement = this;
  }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  scrollIntoView() {
    this.scrolled++;
  }
  getBoundingClientRect() {
    return this.rect;
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

/** A document that makes nodes, remembers focus, and can be sent a key or a click. */
function stubDocument() {
  const doc = {
    activeElement: /** @type {any} */ (null),
    listeners: /** @type {Record<string, Function[]>} */ ({}),
    createElement: (/** @type {string} */ tag) => new StubNode(tag, doc),
    addEventListener(name, fn) {
      (doc.listeners[name] ||= []).push(fn);
    },
    removeEventListener(name, fn) {
      doc.listeners[name] = (doc.listeners[name] || []).filter((f) => f !== fn);
    },
    fire(name, event = {}) {
      for (const fn of [...(doc.listeners[name] || [])]) fn(event);
      return event;
    },
  };
  return doc;
}

/** Every node in a tree, depth first. */
function all(node, out = []) {
  out.push(node);
  for (const child of node.children) all(child, out);
  return out;
}
const byRole = (root, role) => all(root).filter((n) => n.getAttribute('role') === role);
const byClass = (root, cls) =>
  all(root).filter((n) => String(n.className).split(/\s+/).includes(cls));
/** The radiogroup with this accessible name. */
const group = (root, label) =>
  byRole(root, 'radiogroup').find((g) => g.getAttribute('aria-label') === label);
/** The radio in `g` labelled `text`. */
const radio = (g, text) => byRole(g, 'radio').find((b) => b.textContent === text);
const checked = (g) =>
  byRole(g, 'radio')
    .filter((b) => b.getAttribute('aria-checked') === 'true')
    .map((b) => b.textContent);
/** An event that records what was done to it. */
const keyEvent = (key, extra = {}) => ({
  key,
  prevented: 0,
  stopped: 0,
  preventDefault() {
    this.prevented++;
  },
  stopPropagation() {
    this.stopped++;
  },
  ...extra,
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

const THEMES = [
  { name: 'default', blurb: 'Warm oak.' },
  { name: 'night shift', blurb: 'Lights down.' },
  { name: 'blueprint', blurb: 'Drafting blue.' },
];

/**
 * Build the bar against the REAL catalogue and the REAL guard, with both writes
 * captured rather than sent.
 *
 * @param {object} [opts]
 * @param {any} [opts.settings]      what the daemon last said
 * @param {any} [opts.validate]      a guard to use instead of the real one
 * @param {(next:any) => any} [opts.apply]  what the daemon answers a look with
 * @param {boolean} [opts.renderer]  false: no catalogue, as on a build with no floor
 * @param {any[]} [opts.themes]
 * @param {() => boolean} [opts.isBusy]
 */
function mount(opts = {}) {
  const doc = stubDocument();
  const buttonEl = new StubNode('button', doc);
  const popoverEl = new StubNode('div', doc);
  popoverEl.hidden = true;
  const hintEl = new StubNode('div', doc);
  hintEl.hidden = true;
  const hintDismissEl = new StubNode('button', doc);
  hintEl.appendChild(hintDismissEl);
  const settingsBtnEl = new StubNode('button', doc);

  const settings = {
    look: DEFAULT_LOOK,
    theme: 'default',
    onboarded: true,
    seenLookHint: true,
    ...(opts.settings || {}),
  };
  const looks = [];
  const saves = [];
  const sheets = [];
  const painted = [];
  const said = [];
  const themes = opts.themes || THEMES;

  const bar = createLookBar({
    doc,
    buttonEl,
    popoverEl,
    hintEl,
    hintDismissEl,
    settingsBtnEl,
    debounceMs: 0,
    look: {
      catalogue: () => (opts.renderer === false ? null : catalogue),
      validate: opts.validate || validateLook,
      theme: () => 'default',
      live: () => 9,
      picture: (/** @type {any} */ spec) => {
        const canvas = new StubNode('canvas', doc);
        canvas.spec = spec;
        return canvas;
      },
      apply: async (/** @type {any} */ next) => {
        looks.push(next);
        const answer = opts.apply ? opts.apply(next) : { ok: true };
        if (answer.ok) settings.look = normalizeLook(next);
        return answer;
      },
    },
    theming: {
      list: () => themes,
      apply: (/** @type {string} */ name) => void painted.push(name),
      swatches: () => ['#111111', '#222222', '#333333'],
    },
    getSettings: () => settings,
    saveSetting: async (/** @type {any} */ patch) => {
      saves.push(patch);
      Object.assign(settings, patch);
      return settings;
    },
    openSheet: (/** @type {any} */ section) => void sheets.push(section),
    isBusy: opts.isBusy,
    announce: (/** @type {string} */ text) => void said.push(text),
  });
  return {
    bar,
    doc,
    buttonEl,
    popoverEl,
    hintEl,
    hintDismissEl,
    settingsBtnEl,
    settings,
    looks,
    saves,
    sheets,
    painted,
    said,
  };
}

// ----------------------------------------------------- 1 · the two buttons

/** The start tag of the element with this id, and where it is. */
function tagOf(id) {
  const at = HTML.indexOf(`id="${id}"`);
  assert.notEqual(at, -1, `index.html has no element with id="${id}"`);
  const start = HTML.lastIndexOf('<', at);
  return { at, tag: HTML.slice(start, HTML.indexOf('>', at) + 1) };
}

test('the header carries a Look button and a Settings button, between the palette hint and New agent', () => {
  const tools = HTML.indexOf('class="tools"');
  const palette = tagOf('palette-btn');
  const look = tagOf('look-btn');
  const gear = tagOf('settings-btn');
  const agent = tagOf('new-agent-btn');
  assert.ok(tools !== -1 && tools < palette.at, 'the palette hint left the header tools');
  assert.ok(
    palette.at < look.at && look.at < gear.at && gear.at < agent.at,
    'the order is: Ctrl K everything else, Look, Settings, + New agent',
  );
  assert.match(HTML, /id="palette-hint-key">Ctrl K<\/kbd>/, '`Ctrl K everything else` must stay');
  assert.match(HTML, /class="palette-hint-label">everything else</);
});

test('both are real buttons with accessible names and a tooltip that names their key', () => {
  const look = tagOf('look-btn').tag;
  assert.match(look, /^<button\b/);
  assert.match(look, /type="button"/);
  assert.match(look, /aria-label="Look"/);
  assert.match(look, /aria-keyshortcuts="L"/);
  assert.match(look, /title="[^"]*\bL"/, 'the Look tooltip must name L');
  assert.match(look, /aria-controls="look-popover"/);
  assert.match(look, /aria-expanded="false"/);
  assert.doesNotMatch(look, /tabindex="-1"/, 'the Look button must be in the tab order');
  // The icon is decoration and the word is the label: both, as the brief asks.
  const lookInner = HTML.slice(
    tagOf('look-btn').at,
    HTML.indexOf('</button>', tagOf('look-btn').at),
  );
  assert.match(lookInner, /<svg[^>]*aria-hidden="true"/);
  assert.match(lookInner, /<span class="tool-label">Look<\/span>/);

  const gear = tagOf('settings-btn').tag;
  assert.match(gear, /^<button\b/);
  assert.match(gear, /type="button"/);
  assert.match(gear, /aria-label="Settings"/);
  assert.match(gear, /aria-keyshortcuts=","/);
  assert.match(gear, /title="[^"]*,"/, 'the Settings tooltip must name ,');
  assert.doesNotMatch(gear, /tabindex="-1"/);
});

test('the popover is a popover: not a <dialog>, not a full-surface view, and never inset over the floor', () => {
  const pop = tagOf('look-popover').tag;
  assert.match(pop, /^<div\b/, 'a <dialog> would stand the floor’s whole key map down');
  assert.match(pop, /role="dialog"/);
  assert.match(pop, /aria-label="Look"/);
  assert.match(pop, /\bhidden\b/);
  assert.doesNotMatch(pop, /data-surface=/, 'it is not a view, so it owes no ✕ and no Back');
  const rule = /\.look-popover\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(rule, 'style.css has no .look-popover rule');
  assert.doesNotMatch(rule[1], /inset:\s*0\b/, 'a popover that covers the floor is a view');
  assert.match(rule[1], /position:\s*absolute/);
});

test('reduced motion is honoured for the popover and the hint, by both of the product’s routes', () => {
  assert.match(
    CSS,
    /@media \(prefers-reduced-motion: reduce\) \{\s*:root:not\(\[data-motion='no-preference'\]\) \.look-popover,\s*:root:not\(\[data-motion='no-preference'\]\) \.look-hint \{\s*animation: none;/,
    'the system preference must stop both animations',
  );
  assert.match(
    CSS,
    /\[data-motion='reduce'\] \.look-popover,\s*\[data-motion='reduce'\] \.look-hint \{\s*animation: none;/,
    'Settings → Motion → Always reduce must stop them too',
  );
});

test('clicking Look opens the popover under it; clicking Settings opens the sheet at the top', () => {
  const m = mount();
  assert.equal(m.popoverEl.hidden, true);
  m.buttonEl.fire('click');
  assert.equal(m.popoverEl.hidden, false);
  assert.equal(m.buttonEl.getAttribute('aria-expanded'), 'true');
  assert.deepEqual(m.sheets, [], 'Look must not open the full sheet when it has a popover to show');

  m.settingsBtnEl.fire('click');
  assert.deepEqual(m.sheets, [null], 'Settings opens the sheet with no section named — its top');
  assert.equal(m.popoverEl.hidden, true, 'the sheet is modal; the popover does not stay under it');
});

test('both keys are listed where keys are looked up: the palette, and the guide’s table', () => {
  // One name for each key: the constant, the button's own attribute, the docs.
  assert.equal(tagOf('look-btn').tag.includes(`aria-keyshortcuts="${LOOK_KEY}"`), true);
  assert.equal(tagOf('settings-btn').tag.includes(`aria-keyshortcuts="${SETTINGS_KEY}"`), true);
  const ran = [];
  const actions = new Proxy({}, { get: (_t, name) => () => void ran.push(String(name)) });
  const presets = PRESETS.map((p) => ({ id: p.id, label: p.label, blurb: p.blurb }));
  const entries = buildCommandEntries({
    snapshot: { settings: {}, projects: [], agents: [] },
    letGoVisible: false,
    lookPresets: presets,
    actions,
  });

  const look = entries.find((e) => e.id === 'cmd:look');
  assert.ok(look, 'the palette has no row for the Look button');
  assert.equal(look.label, 'Look');
  assert.match(
    look.hint,
    /— L$/,
    'the Look row must carry the floor key, as Idle projects carries I',
  );
  look.run();
  assert.deepEqual(ran, ['openLook']);

  const settings = entries.find((e) => e.id === 'cmd:settings');
  assert.equal(settings.accel, SETTINGS_KEY, 'the palette shows , beside Settings as its key');
  settings.run();
  assert.deepEqual(ran, ['openLook', 'openSettings']);

  // Without a renderer there is no Look section to open, and no row offering one.
  const bare = buildCommandEntries({ snapshot: { settings: {} }, letGoVisible: false, actions });
  assert.equal(
    bare.some((e) => e.id === 'cmd:look'),
    false,
  );

  const guide = fs.readFileSync(path.resolve(HERE, '../../docs/GUIDE.md'), 'utf8');
  const keyboard = guide.slice(guide.indexOf('## Keyboard'));
  assert.match(keyboard, /^\| `L` +\| Look\b/m, 'docs/GUIDE.md’s key table has no row for L');
  assert.match(keyboard, /^\| `,` +\| Settings\b/m, 'docs/GUIDE.md’s key table has no row for ,');
});

// ---------------------------------------------- 2 · the three controls

test('the popover holds exactly three controls, read out of the catalogue, and a way to the rest', () => {
  const m = mount();
  m.bar.open();
  const names = byRole(m.popoverEl, 'radiogroup').map((g) => g.getAttribute('aria-label'));
  assert.deepEqual(names, ['Agent size', 'Theme', 'Preset']);

  const sizes = byRole(group(m.popoverEl, 'Agent size'), 'radio').map((b) => b.textContent);
  assert.deepEqual(
    sizes,
    AGENT_SIZES.map((id) => catalogue.AGENT_SIZE_LABELS[id]),
    'the sizes are the catalogue’s, in the catalogue’s order',
  );
  assert.deepEqual(sizes, ['Small', 'Medium', 'Large', 'Auto']);

  assert.deepEqual(
    byRole(group(m.popoverEl, 'Theme'), 'radio').map((b) => b.textContent),
    ['Default', 'Night shift', 'Blueprint'],
  );

  const cards = byRole(group(m.popoverEl, 'Preset'), 'radio');
  assert.equal(cards.length, 6);
  assert.deepEqual(
    cards.map((b) => b.textContent),
    PRESETS.map((p) => p.label),
  );
  // Each card's picture is the Look section's own thumbnail, asked for under
  // the Look section's own cache key — one painter, one cache, two surfaces.
  cards.forEach((card, i) => {
    const canvas = card.children.find((c) => c.tagName === 'CANVAS');
    assert.ok(canvas, `${PRESETS[i].label} has no thumbnail`);
    assert.equal(canvas.spec.kind, 'thumbnail');
    assert.equal(canvas.spec.key, `preset:${PRESETS[i].id}`);
    assert.equal(canvas.getAttribute('aria-hidden'), 'true');
  });

  const link = byClass(m.popoverEl, 'lookbar-all')[0];
  assert.equal(link.textContent, 'All look options…');
  assert.equal(link.tagName, 'BUTTON');
});

test('each group is one Tab stop on the chosen option, and arrows move the choice', async () => {
  const m = mount();
  m.bar.open();
  for (const label of ['Agent size', 'Theme', 'Preset']) {
    const stops = byRole(group(m.popoverEl, label), 'radio').filter(
      (b) => b.getAttribute('tabindex') === '0',
    );
    assert.equal(stops.length, 1, `${label} must be exactly one Tab stop`);
    assert.equal(stops[0].getAttribute('aria-checked'), 'true');
  }
  // Opening puts the keyboard on the chosen size.
  assert.equal(m.doc.activeElement.textContent, 'Medium');

  const event = keyEvent('ArrowRight');
  radio(group(m.popoverEl, 'Agent size'), 'Medium').fire('keydown', event);
  await tick();
  assert.equal(event.prevented, 1);
  assert.equal(m.looks.at(-1).agentSize, 'large');
  // The redraw replaced the button the hand was on; focus is on its successor.
  assert.equal(m.doc.activeElement.textContent, 'Large');
  assert.ok(m.popoverEl.contains(m.doc.activeElement));
});

test('Agent size posts the look the floor has with one key changed, and nothing else', async () => {
  const stored = { ...lookForPreset('night-lab'), agentSize: 'medium' };
  const m = mount({ settings: { look: stored } });
  m.bar.open();
  radio(group(m.popoverEl, 'Agent size'), 'Large').fire('click');
  await tick();
  assert.equal(m.looks.length, 1);
  assert.deepEqual(m.looks[0], { ...normalizeLook(stored), agentSize: 'large' });
  assert.deepEqual(m.saves, [], 'a size is a look, and a look does not go through /api/settings');
  assert.deepEqual(checked(group(m.popoverEl, 'Agent size')), ['Large']);
  // The floor the user chose is exactly where it was.
  assert.deepEqual(checked(group(m.popoverEl, 'Preset')), ['Night lab']);
});

test('Theme goes through the settings route, and the window is painted in what was STORED', async () => {
  const m = mount();
  m.bar.open();
  radio(group(m.popoverEl, 'Theme'), 'Night shift').fire('click');
  await tick();
  assert.deepEqual(m.saves, [{ theme: 'night shift' }]);
  assert.deepEqual(m.painted, ['night shift']);
  assert.deepEqual(m.looks, [], 'a theme is not a look');
  assert.deepEqual(checked(group(m.popoverEl, 'Theme')), ['Night shift']);
});

test('a theme the settings route did not store is not painted', async () => {
  const m = mount();
  // `saveSetting` resolves null on a failure it has already reported.
  const bar = createLookBar({
    doc: m.doc,
    buttonEl: new StubNode('button', m.doc),
    popoverEl: m.popoverEl,
    look: { catalogue: () => null },
    theming: { list: () => THEMES, apply: (n) => void m.painted.push(n), swatches: () => [] },
    getSettings: () => ({ theme: 'default' }),
    saveSetting: async () => null,
    openSheet: () => {},
  });
  bar.open();
  radio(group(m.popoverEl, 'Theme'), 'Blueprint').fire('click');
  await tick();
  assert.deepEqual(m.painted, []);
  assert.deepEqual(checked(group(m.popoverEl, 'Theme')), ['Default']);
});

test('a Preset posts that preset’s whole look — the six the guards measured, by name', async () => {
  for (const preset of PRESETS) {
    if (preset.id === DEFAULT_LOOK.preset) continue;
    const m = mount();
    m.bar.open();
    radio(group(m.popoverEl, 'Preset'), preset.label).fire('click');
    await tick();
    assert.deepEqual(m.looks, [lookForPreset(preset.id)], `${preset.label} posted something else`);
    assert.deepEqual(checked(group(m.popoverEl, 'Preset')), [preset.label]);
  }
});

test('"All look options…" closes the popover and opens the full sheet at Look', () => {
  const m = mount();
  m.bar.open();
  byClass(m.popoverEl, 'lookbar-all')[0].fire('click');
  assert.deepEqual(m.sheets, ['look']);
  assert.equal(m.popoverEl.hidden, true);
  assert.equal(m.buttonEl.getAttribute('aria-expanded'), 'false');
});

test('on a build with no renderer and one theme there is nothing to pop over, so Look opens the sheet', () => {
  const m = mount({ renderer: false, themes: [THEMES[0]] });
  m.buttonEl.fire('click');
  assert.equal(m.popoverEl.hidden, true);
  assert.deepEqual(m.sheets, ['look']);
});

// ------------------------------------------------------- 3 · a refusal

test('a refused combination shows the guard’s reason under the control, and posts nothing', async () => {
  const reason = 'the wool rug would measure 1.02:1 on that floor';
  const m = mount({
    validate: () => ({ ok: false, problems: [{ picker: 'rug.wool', option: 'x', reason }] }),
  });
  m.bar.open();
  radio(group(m.popoverEl, 'Agent size'), 'Large').fire('click');
  await tick();

  assert.deepEqual(m.looks, [], 'a refused look was posted anyway');
  assert.deepEqual(m.saves, []);
  const boxes = byClass(m.popoverEl, 'lookbar-refusal');
  assert.equal(boxes.length, 1);
  assert.equal(boxes[0].getAttribute('role'), 'status');
  assert.equal(boxes[0].textContent, `${reason}. Nothing was changed.`);
  // …under the row the hand was on, not at the foot of the popover.
  const sizeRow = byClass(m.popoverEl, 'lookbar-row').find((r) =>
    all(r).includes(group(m.popoverEl, 'Agent size')),
  );
  assert.ok(all(sizeRow).includes(boxes[0]), 'the reason is not under Agent size');
  // …and the control is exactly where it was.
  assert.deepEqual(checked(group(m.popoverEl, 'Agent size')), ['Medium']);
});

test('a refusal from the daemon is shown the same way, and the control goes back', async () => {
  const reason = 'that look does not read on night shift';
  const m = mount({ apply: () => ({ ok: false, problems: [{ picker: '', option: '', reason }] }) });
  m.bar.open();
  radio(group(m.popoverEl, 'Preset'), 'Night lab').fire('click');
  await tick();
  assert.equal(m.looks.length, 1, 'the real guard passed it, so it was sent — once');
  assert.equal(
    byClass(m.popoverEl, 'lookbar-refusal')[0].textContent,
    `${reason}. Nothing was changed.`,
  );
  assert.deepEqual(checked(group(m.popoverEl, 'Preset')), ['Studio oak']);
});

test('the real guard is what stands in front of the post', async () => {
  // Not a stub this time: whatever `validateLook` says about a size change on
  // the shipped default is what happens, and the shipped default must pass.
  const verdict = validateLook({ ...DEFAULT_LOOK, agentSize: 'large' }, 'default');
  assert.equal(verdict.ok, true, 'the default floor at `large` is refused by its own guard');
  const m = mount();
  m.bar.open();
  radio(group(m.popoverEl, 'Agent size'), 'Small').fire('click');
  await tick();
  assert.equal(m.looks.length, 1);
  assert.equal(byClass(m.popoverEl, 'lookbar-refusal').length, 0);
});

// --------------------------------------------------- 4 · it is a popover

test('Escape closes it, hands focus back to the button, and does not reach the floor', () => {
  const m = mount();
  m.bar.open();
  assert.ok(m.popoverEl.contains(m.doc.activeElement));
  const event = m.doc.fire('keydown', keyEvent('Escape'));
  assert.equal(m.popoverEl.hidden, true);
  assert.equal(m.doc.activeElement, m.buttonEl, 'focus did not return to the Look button');
  assert.equal(event.prevented, 1);
  assert.equal(event.stopped, 1, 'the floor would read this Escape as "deselect"');
  // And it is not listening any more.
  assert.deepEqual(m.doc.listeners.keydown, []);
  assert.deepEqual(m.doc.listeners.pointerdown, []);
});

test('a click outside closes it; a click inside, or on its own button, does not', () => {
  const m = mount();
  m.bar.open();
  m.doc.fire('pointerdown', { target: radio(group(m.popoverEl, 'Theme'), 'Blueprint') });
  assert.equal(m.popoverEl.hidden, false);
  m.doc.fire('pointerdown', { target: m.buttonEl });
  assert.equal(m.popoverEl.hidden, false);
  m.doc.fire('pointerdown', { target: new StubNode('canvas', m.doc) });
  assert.equal(m.popoverEl.hidden, true);
  // An outside click chose somewhere else to be; focus is not dragged back.
  assert.notEqual(m.doc.activeElement, m.buttonEl);
});

test('the button toggles: a second click, or L from inside, closes what the first opened', () => {
  const m = mount();
  m.buttonEl.fire('click');
  m.buttonEl.fire('click');
  assert.equal(m.popoverEl.hidden, true);

  m.bar.toggle();
  assert.equal(m.popoverEl.hidden, false);
  const event = m.popoverEl.fire('keydown', keyEvent('L'));
  assert.equal(m.popoverEl.hidden, true);
  assert.equal(event.prevented, 1);
  assert.equal(m.doc.activeElement, m.buttonEl);
});

test('with focus inside it the floor’s single keys stand down, and the palette’s chord does not', () => {
  const m = mount();
  m.bar.open();
  for (const key of ['b', 'a', 'j', 'k', '1', '2', '3', 'Enter', ' ', ',']) {
    const event = m.popoverEl.fire('keydown', keyEvent(key));
    assert.equal(event.stopped, 1, `"${key}" inside the popover would reach the floor’s key map`);
    assert.equal(m.popoverEl.hidden, false);
  }
  assert.equal(m.popoverEl.fire('keydown', keyEvent('k', { ctrlKey: true })).stopped, 0);
  assert.equal(m.popoverEl.fire('keydown', keyEvent('k', { metaKey: true })).stopped, 0);
  assert.equal(m.popoverEl.fire('keydown', keyEvent('Tab')).stopped, 0, 'Tab is the browser’s');
});

test('tabbing out of the far end closes it; a redraw taking the focused radio away does not', () => {
  const m = mount();
  m.bar.open();
  m.popoverEl.fire('focusout', { relatedTarget: null });
  assert.equal(m.popoverEl.hidden, false);
  m.popoverEl.fire('focusout', { relatedTarget: m.buttonEl });
  assert.equal(m.popoverEl.hidden, false);
  m.popoverEl.fire('focusout', { relatedTarget: m.settingsBtnEl });
  assert.equal(m.popoverEl.hidden, true);
});

test('a snapshot that changed nothing redraws nothing; one that changed the look does', () => {
  const m = mount();
  m.bar.open();
  const before = group(m.popoverEl, 'Agent size');
  m.bar.refresh();
  assert.equal(group(m.popoverEl, 'Agent size'), before, 'an idle snapshot rebuilt the popover');
  // Another tab chose a size; this one follows.
  m.settings.look = { ...DEFAULT_LOOK, agentSize: 'small' };
  m.bar.refresh();
  assert.deepEqual(checked(group(m.popoverEl, 'Agent size')), ['Small']);
});

// ------------------------------------------------------- 5 · the hint

test('the hint is in the document: one line, and one dismiss', () => {
  const hint = tagOf('look-hint');
  assert.match(hint.tag, /role="status"/);
  assert.match(hint.tag, /\bhidden\b/, 'the hint must start hidden, or every load flashes it');
  const inner = HTML.slice(hint.at, HTML.indexOf('</div>', hint.at));
  assert.equal(
    inner
      .slice(inner.indexOf('>') + 1)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
    `${LOOK_HINT_TEXT} Got it`,
  );
  assert.equal(LOOK_HINT_TEXT, 'Change the floor, the furniture and the agent size here.');
  assert.equal((inner.match(/<button\b/g) || []).length, 1, 'one dismiss, not two');
  assert.match(tagOf('look-hint-dismiss').tag, /^<button\b[^>]*type="button"/);
});

test('the hint shows once: dismissed, it records seenLookHint and never comes back', async () => {
  const m = mount({ settings: { seenLookHint: false } });
  assert.equal(m.hintEl.hidden, true, 'nothing shows before the first snapshot is read');
  m.bar.refresh();
  assert.equal(m.hintEl.hidden, false);
  assert.deepEqual(m.said, [LOOK_HINT_TEXT], 'a screen reader was not told');

  m.hintDismissEl.fire('click');
  await tick();
  assert.equal(m.hintEl.hidden, true);
  assert.deepEqual(m.saves, [{ seenLookHint: true }]);
  assert.equal(m.doc.activeElement, m.buttonEl, 'focus went nowhere when its button vanished');

  // The next snapshot, and the one after — including a STALE one that still
  // says false, which is what a poll already in flight looks like.
  m.bar.refresh();
  m.settings.seenLookHint = false;
  m.bar.refresh();
  assert.equal(m.hintEl.hidden, true);
  assert.deepEqual(m.saves, [{ seenLookHint: true }], 'it was recorded twice');
});

test('using the Look button is having read the hint', async () => {
  const m = mount({ settings: { seenLookHint: false } });
  m.bar.refresh();
  assert.equal(m.hintEl.hidden, false);
  m.buttonEl.fire('click');
  await tick();
  assert.equal(m.hintEl.hidden, true, 'the hint and the popover hang from the same anchor');
  assert.deepEqual(m.saves, [{ seenLookHint: true }]);
  m.doc.fire('keydown', keyEvent('Escape'));
  m.bar.refresh();
  assert.equal(m.hintEl.hidden, true);
});

test('somebody who has seen it is never shown it, and nothing is written for them', () => {
  const m = mount({ settings: { seenLookHint: true } });
  m.bar.refresh();
  m.bar.open();
  m.bar.close();
  m.bar.refresh();
  assert.equal(m.hintEl.hidden, true);
  assert.deepEqual(m.saves, []);
});

test('the hint waits its turn: not during the first-run tour, and not over a modal', () => {
  // A first run: the three coach marks have the screen and `onboarded` is false.
  const first = mount({ settings: { seenLookHint: false, onboarded: false } });
  first.bar.refresh();
  assert.equal(first.hintEl.hidden, true);
  // The tour ends, which is what sets `onboarded`; the next snapshot shows it.
  first.settings.onboarded = true;
  first.bar.refresh();
  assert.equal(first.hintEl.hidden, false);

  let busy = true;
  const modal = mount({ settings: { seenLookHint: false }, isBusy: () => busy });
  modal.bar.refresh();
  assert.equal(modal.hintEl.hidden, true);
  busy = false;
  modal.bar.refresh();
  assert.equal(modal.hintEl.hidden, false);
  assert.deepEqual(modal.saves, [], 'waiting is not dismissing');
});

// ------------------------------------------------- 6 · the sheet's nav

/** A sheet body the way `settings-ui.js` draws one: a nav, then sections. */
function sheet(titles, ids = {}) {
  const doc = stubDocument();
  const body = new StubNode('div', doc);
  const nav = body.appendChild(new StubNode('nav', doc));
  const sections = titles.map((title) => {
    const section = new StubNode('section', doc);
    section.className = 'settings-section';
    if (ids[title]) section.id = ids[title];
    const h3 = section.appendChild(new StubNode('h3', doc));
    h3.className = 'settings-heading';
    h3.textContent = title;
    return body.appendChild(section);
  });
  return { doc, body, nav, sections };
}

const SEVEN = ['State', 'Notifications', 'Resume', 'Floor', 'Look', 'Data', 'Hooks'];

test('the nav is derived from the sections drawn: their headings, their order, their ids', () => {
  const s = sheet(SEVEN, { Look: 'settings-look', Hooks: 'settings-hooks' });
  const entries = fillSectionNav(s.doc, s.nav, s.body);
  assert.deepEqual(
    entries.map((e) => e.title),
    SEVEN,
  );
  assert.deepEqual(
    s.nav.children.map((b) => [b.tagName, b.type, b.textContent]),
    SEVEN.map((t) => ['BUTTON', 'button', t]),
  );
  assert.equal(s.nav.getAttribute('aria-label'), 'Settings sections');
  assert.equal(s.nav.hidden, false);
  // The two ids other code already jumps to are kept; the rest are given one.
  assert.deepEqual(
    s.sections.map((n) => n.id),
    SEVEN.map((t) => `settings-${t.toLowerCase()}`),
  );
  assert.equal(sectionId('Rate card'), 'settings-rate-card');
});

test('a build with no Look section has no Look entry, and nobody edited a list', () => {
  const without = SEVEN.filter((t) => t !== 'Look');
  const s = sheet(without);
  assert.deepEqual(
    fillSectionNav(s.doc, s.nav, s.body).map((e) => e.title),
    without,
  );
  // And a section nobody has written yet gets its entry the day it is drawn.
  const more = sheet([...SEVEN, 'Sound', 'About']);
  assert.deepEqual(
    fillSectionNav(more.doc, more.nav, more.body).map((e) => e.title),
    [...SEVEN, 'Sound', 'About'],
  );
  // Things in the body that are not sections are not entries.
  const stray = sheet(['State', 'Floor']);
  stray.body.appendChild(new StubNode('p', stray.doc)).className = 'settings-note';
  assert.equal(sectionsOf(stray.body).length, 2);
  // One section is nowhere to jump to.
  const one = sheet(['State']);
  fillSectionNav(one.doc, one.nav, one.body);
  assert.equal(one.nav.hidden, true);
});

test('Look is one click away: its entry scrolls it to the top, focuses it and marks it', () => {
  const s = sheet(SEVEN, { Look: 'settings-look' });
  const entries = fillSectionNav(s.doc, s.nav, s.body);
  const look = entries.find((e) => e.title === 'Look');
  const section = s.sections[SEVEN.indexOf('Look')];
  look.button.fire('click');
  assert.equal(section.scrolled, 1);
  assert.equal(s.doc.activeElement, section, 'the keyboard is still at the top of the sheet');
  assert.equal(section.getAttribute('tabindex'), '-1', 'a section is not a Tab stop');
  assert.deepEqual(
    entries.filter((e) => e.button.getAttribute('aria-current') === 'true').map((e) => e.title),
    ['Look'],
  );
});

test('the current section is the last one that has reached the nav', () => {
  const s = sheet(SEVEN);
  const entries = fillSectionNav(s.doc, s.nav, s.body);
  s.nav.rect = { ...s.nav.rect, bottom: 44 };
  // Scrolled so that Floor's top is under the nav and Look's is still below.
  const tops = [-900, -640, -380, 30, 420, 1400, 1900];
  s.sections.forEach((n, i) => {
    n.rect = { ...n.rect, top: tops[i] };
  });
  const byId = (id) => s.sections.find((n) => n.id === id);
  assert.equal(currentSection(s.nav, entries, byId), 'settings-floor');
  markCurrentSection(entries, 'settings-floor');
  assert.deepEqual(
    entries.map((e) => e.button.getAttribute('aria-current')),
    [null, null, null, 'true', null, null, null],
  );
  // At the very top nothing has reached the nav yet, and the first one is it.
  s.sections.forEach((n, i) => {
    n.rect = { ...n.rect, top: 60 + i * 300 };
  });
  assert.equal(currentSection(s.nav, entries, byId), 'settings-state');
});

test('the nav sticks, on the sheet’s own ground, and a jump lands clear of it', () => {
  const nav = /\.settings-nav\s*\{([^}]*)\}/.exec(CSS);
  assert.ok(nav, 'style.css has no .settings-nav rule');
  assert.match(nav[1], /position:\s*sticky/);
  assert.match(nav[1], /background:\s*var\(--surface\)/, 'rows would show through a clear nav');
  assert.match(CSS, /\.settings-section\s*\{\s*scroll-margin-top:/);
});
