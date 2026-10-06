/**
 * THE SELECTION INVARIANT — a control shows what the daemon last accepted.
 *
 * The owner, using his own floor: *"Option toggles are not working well: the
 * highlight box goes back to the default option although after changing
 * something."* It did, and every existing test passed, because every existing
 * test built the Look section against a stub in which the write and the read
 * were the same variable. In the product they were not: the write went to the
 * shell's snapshot and the section went on reading the copy of the settings the
 * sheet took when it was opened.
 *
 * So this file does what `look-bar-shell.test.mjs` does for the popover, for
 * BOTH surfaces at once: it imports the real wiring — `app-look.js`,
 * `app-lookbar.js`, `settings-ui.js` — under a stub window, stands a recording
 * daemon behind `fetch`, and clicks.
 *
 *   - **INVARIANT.** For every radio group either surface draws, choosing each
 *     option leaves THAT option highlighted once the daemon has answered, and
 *     still highlighted after the next state push. A choice the guard refuses
 *     leaves the previous one highlighted and says why beside the control.
 *   - Every picker in the catalogue is one of those groups — derived from
 *     `LOOK_PICKERS`, never listed here.
 *   - A second change is built on the first, not on the look the sheet opened on.
 *   - The two surfaces are one look: what one wrote is what the other opens on.
 *   - A late answer to an earlier click does not put a later click back.
 *   - The keyboard's focus survives the redraw a choice causes.
 */
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as catalogue from '../../public/render/look-options.js';
import { DEFAULT_LOOK, LOOK_PICKERS, normalizeLook } from '../../public/render/look-options.js';
import * as guards from '../../public/render/look-guards.js';
import { THEMES, themeByName } from '../../public/render/themes.js';

// --------------------------------------------------------------- the window

class StubNode {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.id = '';
    this.type = '';
    this.title = '';
    this.hidden = false;
    this.open = false;
    this.value = '';
    this.dataset = {};
    this.style = { setProperty() {}, removeProperty() {} };
    this.attrs = /** @type {Record<string,string>} */ ({});
    this.listeners = /** @type {Record<string, Function[]>} */ ({});
    this.classList = { add() {}, remove() {}, toggle() {}, contains: () => false };
    this._text = '';
  }
  appendChild(c) {
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  append(...kids) {
    for (const c of kids) this.appendChild(c);
  }
  removeChild(c) {
    this.children = this.children.filter((x) => x !== c);
    return c;
  }
  insertBefore(c) {
    return this.appendChild(c);
  }
  replaceChildren() {
    this.children = [];
  }
  remove() {}
  setAttribute(n, v) {
    this.attrs[n] = String(v);
  }
  getAttribute(n) {
    return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null;
  }
  removeAttribute(n) {
    delete this.attrs[n];
  }
  hasAttribute(n) {
    return Object.prototype.hasOwnProperty.call(this.attrs, n);
  }
  addEventListener(t, fn) {
    (this.listeners[t] ||= []).push(fn);
  }
  removeEventListener(t, fn) {
    this.listeners[t] = (this.listeners[t] || []).filter((f) => f !== fn);
  }
  fire(t, event = {}) {
    for (const fn of [...(this.listeners[t] || [])]) fn(event);
    return event;
  }
  dispatchEvent() {
    return true;
  }
  click() {
    this.fire('click');
  }
  focus() {
    globalThis.document.activeElement = this;
  }
  blur() {}
  scrollIntoView() {}
  setSelectionRange() {}
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
    this.fire('close');
  }
  querySelector() {
    return null;
  }
  querySelectorAll() {
    return [];
  }
  closest() {
    return null;
  }
  contains(node) {
    for (let n = node; n; n = n.parentNode) if (n === this) return true;
    return false;
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 };
  }
  getContext() {
    return null;
  }
  set textContent(v) {
    // What a browser does, and the thing a stub that only cleared its children
    // hid: a focused control that is taken out of the document loses the
    // focus AT ONCE, to the body. The sheet empties itself to redraw, so by
    // the time anything asks, `activeElement` no longer names the old button.
    const doc = globalThis.document;
    const inside = (node) => node === doc.activeElement || node.children.some(inside);
    if (doc.activeElement && this.children.some(inside)) doc.activeElement = doc.body;
    this.children = [];
    this._text = String(v);
  }
  get textContent() {
    if (this.children.length > 0) return this.children.map((c) => c.textContent).join('');
    return this._text;
  }
}

/** @type {Map<string, StubNode>} */
const byId = new Map();
/** Every request the client made, in order. @type {Array<{url:string, method:string, body:any}>} */
const requests = [];
/** The settings the fake daemon holds. */
let stored = {};
/**
 * Answers to `/api/look` that a test is holding back, oldest first. `null`
 * means the daemon answers at once, which is every test but one.
 * @type {Array<() => void>|null}
 */
let held = null;

/** Globals a browser has and Node does not — or has, read-only. */
function set(name, value) {
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
}

const documentStub = {
  createElement: (t) => new StubNode(t),
  createElementNS: (_ns, t) => new StubNode(t),
  createTextNode: () => new StubNode('#text'),
  createDocumentFragment: () => new StubNode('#fragment'),
  getElementById: (id) => {
    if (!byId.has(id)) {
      const node = new StubNode('div');
      node.id = String(id);
      byId.set(id, node);
    }
    return byId.get(id);
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  listeners: /** @type {Record<string, Function[]>} */ ({}),
  addEventListener(t, fn) {
    (documentStub.listeners[t] ||= []).push(fn);
  },
  removeEventListener(t, fn) {
    documentStub.listeners[t] = (documentStub.listeners[t] || []).filter((f) => f !== fn);
  },
  body: new StubNode('body'),
  documentElement: new StubNode('html'),
  hidden: false,
  activeElement: null,
  visibilityState: 'visible',
};
const win = {
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  location: { href: 'http://127.0.0.1:4317/', search: '', origin: 'http://127.0.0.1:4317' },
  devicePixelRatio: 1,
  innerWidth: 1600,
  innerHeight: 1000,
};
set('document', documentStub);
set('window', win);
set('location', win.location);
set('matchMedia', win.matchMedia);
set('localStorage', { getItem: () => null, setItem() {}, removeItem() {} });
set('navigator', { userAgent: 'node', language: 'en', clipboard: { writeText: async () => {} } });
set('requestAnimationFrame', () => 0);
set('cancelAnimationFrame', () => {});
set('getComputedStyle', () => ({ getPropertyValue: () => '' }));
set('Image', class {});
set(
  'EventSource',
  class {
    addEventListener() {}
    close() {}
  },
);
// The daemon, as far as this client can tell. `/api/look` stores the document
// and echoes it, `/api/settings` merges the patch and answers with the whole —
// which is what the two real routes do.
set('fetch', async (url, init = {}) => {
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  requests.push({ url: String(url), method, body });
  if (url === '/api/look' && method === 'POST') {
    const { kind: _kind, version: _version, ...look } = body;
    stored.look = look;
    if (held) await new Promise((resolve) => held.push(() => resolve(undefined)));
    return { ok: true, status: 200, json: async () => ({ look: body }) };
  }
  if (url === '/api/settings' && method === 'POST') {
    stored = { ...stored, ...body };
    return { ok: true, status: 200, json: async () => ({ ...stored }) };
  }
  return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
});

// The shell, imported once the window exists.
const state = await import('../../public/app-state.js');
const { wireLookBar } = await import('../../public/app-lookbar.js');
const { createLookPort, createThemingPort } = await import('../../public/app-look.js');
const { createSettingsUI } = await import('../../public/settings-ui.js');
const { dimensionsFor } = await import('../../public/look-ui.js');

state.setLook(null, catalogue, guards, null);
state.setThemes({ THEMES, themeByName, swatchesFor: () => [], applyTheme: (name) => name });

const el = (id) => documentStub.getElementById(id);
// The sheet reads `/api/about` and `/api/rates` when it opens and says so, at
// debug level, when this daemon has neither. Eighty openings of that is noise.
console.debug = () => {};
/**
 * Long enough for the daemon's answer. The debounce is 0 here — `wireLookBar`
 * below sets it on the store both surfaces share — because a debounce is a
 * property of a hand on a keyboard, not of the thing being posted.
 */
const SETTLE_MS = 5;
const tick = (ms = SETTLE_MS) => new Promise((resolve) => setTimeout(resolve, ms));
const all = (node, out = []) => {
  out.push(node);
  for (const child of node.children) all(child, out);
  return out;
};
const role = (root, name) => all(root).filter((n) => n.getAttribute('role') === name);

// The two surfaces, built the way `app.js` builds them.
const settingsUI = createSettingsUI({
  dialogEl: /** @type {any} */ (el('settings-dialog')),
  bodyEl: /** @type {any} */ (el('settings-body')),
  getSnapshot: () => state.latestSnapshot,
  toast: () => {},
  hooks: { renderInto() {}, refresh() {} },
  theming: createThemingPort(),
  look: createLookPort(),
});
const bar = wireLookBar({ settingsUI, tourRunning: () => false, debounceMs: 0 });

/** The Look section in the open sheet. */
const sheetLook = () => el('settings-body').children.find((n) => n.id === 'settings-look');
const SURFACES = {
  sheet: {
    open: () => settingsUI.open('look'),
    close: () => el('settings-dialog').close(),
    root: () => sheetLook(),
  },
  bar: {
    open: () => bar.open(),
    close: () => bar.close(),
    root: () => el('look-popover'),
  },
};

/** The radio group with this accessible name, as it is drawn right now. */
const group = (root, label) =>
  role(root, 'radiogroup').find((g) => g.getAttribute('aria-label') === label);
/** Which of a group's radios is checked: its index, or -1. */
const checkedIndex = (g) =>
  role(g, 'radio').findIndex((b) => b.getAttribute('aria-checked') === 'true');
/** The reasons a surface is showing. */
const reasons = (root) => role(root, 'status').map((n) => n.textContent);

/** What the daemon would push next: the settings it holds. */
function push() {
  state.setLatestSnapshot({ agents: [], projects: [], settings: structuredClone(stored) });
  state.setLookSetting(stored.look);
  bar.refresh();
}

/** A fresh floor, both surfaces shut. */
function reset(settings = {}) {
  SURFACES.sheet.close();
  SURFACES.bar.close();
  stored = {
    look: normalizeLook(DEFAULT_LOOK),
    theme: 'default',
    onboarded: true,
    seenLookHint: true,
    ...settings,
  };
  held = null;
  requests.length = 0;
  push();
}

// ------------------------------------------------------------- the invariant

for (const [name, surface] of Object.entries(SURFACES)) {
  test(`INVARIANT: in the ${name}, the option chosen is the option highlighted — after the answer, and after the next push`, async () => {
    reset();
    await surface.open();
    const labels = role(surface.root(), 'radiogroup').map((g) => g.getAttribute('aria-label'));
    assert.ok(labels.length >= 3, `the ${name} draws ${labels.length} radio groups`);

    let chosen = 0;
    for (const label of labels) {
      const count = role(group(surface.root(), label), 'radio').length;
      for (let index = 0; index < count; index++) {
        // From the shipped look every time, so one option's refusal is never
        // another option's starting point.
        reset();
        await surface.open();
        const before = checkedIndex(group(surface.root(), label));
        if (index === before) continue;
        const sent = requests.length;
        role(group(surface.root(), label), 'radio')[index].click();
        await tick();
        const where = `${name} · ${label} · option ${index}`;

        if (requests.length === sent) {
          // Refused by the guard: nothing was sent, nothing moved, and it says so.
          assert.equal(checkedIndex(group(surface.root(), label)), before, `${where}: refused`);
          assert.ok(
            reasons(surface.root()).some((t) => t.includes('Nothing was changed')),
            `${where}: refused without a reason beside it`,
          );
          continue;
        }
        chosen++;
        assert.equal(
          checkedIndex(group(surface.root(), label)),
          index,
          `${where}: the highlight went back once the daemon answered`,
        );
        push();
        assert.equal(
          checkedIndex(group(surface.root(), label)),
          index,
          `${where}: the highlight went back on the next state push`,
        );
        // And it survives the surface being shut and opened again.
        surface.close();
        await surface.open();
        assert.equal(checkedIndex(group(surface.root(), label)), index, `${where}: reopened`);
      }
    }
    assert.ok(chosen >= 6, `only ${chosen} choices were accepted in the ${name}`);
  });
}

test('every picker in the catalogue is a radio group in the sheet, by its own name', async () => {
  reset();
  await SURFACES.sheet.open();
  for (const picker of LOOK_PICKERS) {
    const dimensions = dimensionsFor(picker, catalogue);
    for (const dimension of dimensions) {
      const label = dimensions.length > 1 ? `${picker.label} — ${dimension.label}` : picker.label;
      const g = group(sheetLook(), label);
      assert.ok(g, `"${label}" is in the catalogue and the sheet draws no group for it`);
      assert.equal(role(g, 'radio').length, dimension.ids.length, label);
    }
  }
});

// ------------------------------------------------------ one look, not three

test('a second change is built on the first, not on the look the sheet was opened with', async () => {
  reset();
  await SURFACES.sheet.open();
  const pick = async (label, text) => {
    role(group(sheetLook(), label), 'radio')
      .find((b) => b.textContent === text)
      .click();
    await tick();
  };
  await pick('Agent size', 'Large');
  await pick('Colour scheme', 'Cool');
  await pick('Furniture set', 'Soft');
  assert.deepEqual(
    [stored.look.agentSize, stored.look.scheme, stored.look.furniture],
    ['large', 'cool', 'soft'],
    'a later change undid an earlier one',
  );
});

test('the sheet and the quick bar are one look: what one wrote is what the other opens on', async () => {
  reset();
  SURFACES.bar.open();
  role(group(el('look-popover'), 'Agent size'), 'radio')[0].click();
  await tick();
  SURFACES.bar.close();

  // No push in between: the sheet opens on what the bar was just told.
  await SURFACES.sheet.open();
  assert.equal(checkedIndex(group(sheetLook(), 'Agent size')), 0);
  role(group(sheetLook(), 'Agent size'), 'radio')[2].click();
  role(group(sheetLook(), 'Theme'), 'radio')[1].click();
  await tick();
  SURFACES.sheet.close();

  SURFACES.bar.open();
  assert.equal(checkedIndex(group(el('look-popover'), 'Agent size')), 2);
  assert.equal(checkedIndex(group(el('look-popover'), 'Theme')), 1);
});

test('a late answer to an earlier click does not put a later click back', async () => {
  reset();
  await SURFACES.sheet.open();
  held = [];
  const size = () => group(sheetLook(), 'Agent size');
  role(size(), 'radio')[0].click(); // Small
  await tick();
  role(size(), 'radio')[2].click(); // Large, while Small is still unanswered
  await tick();
  assert.equal(held.length, 2, 'both were sent');
  held.shift()(); // the daemon answers the FIRST
  await tick(5);
  assert.equal(checkedIndex(size()), 2, 'the answer to Small put Large back');
  held.shift()();
  await tick(5);
  assert.equal(checkedIndex(size()), 2);
  assert.equal(stored.look.agentSize, 'large');
});

test('an arrow key moves the choice, and the focus is still on it after the redraw', async () => {
  reset();
  await SURFACES.sheet.open();
  const set = () => group(sheetLook(), 'Furniture set');
  const from = checkedIndex(set());
  const start = role(set(), 'radio')[from];
  start.focus();
  start.fire('keydown', { key: 'ArrowRight', preventDefault() {} });
  await tick();
  const now = role(set(), 'radio');
  assert.equal(checkedIndex(set()), from + 1);
  assert.equal(
    now.indexOf(documentStub.activeElement),
    from + 1,
    'the focus was left on a button the redraw threw away',
  );
});
