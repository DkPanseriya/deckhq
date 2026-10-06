/**
 * The Look bar, wired to the real shell: what it actually sends, and the two
 * keys that reach it.
 *
 * `look-bar.test.mjs` drives `look-ui-bar.js` against captured ports. That
 * proves the popover asks for the right thing; it cannot prove the shell hands
 * it the right ports, and "the port was a stub" is how a control ships that
 * posts to the wrong route. So this file imports the REAL wiring —
 * `app-lookbar.js`, `app-look.js`'s `postLook`, `app-notify.js`'s `saveSetting`
 * and `app-keys.js`'s key map — under a stub window, replaces `fetch` with a
 * recorder, and reads the bodies.
 *
 *   - **Agent size** and **Preset** POST a whole `deckhq.look` document to
 *     `/api/look`, the route that refuses whole rather than sanitising.
 *   - **Theme** POSTs `{theme}` to `/api/settings`.
 *   - **Dismissing the hint** POSTs `{seenLookHint: true}` to `/api/settings`.
 *   - **A refusal** — the real `validateLook` saying no — sends nothing.
 *   - **`L`** and **`,`** reach the bar from the floor, and from nowhere else:
 *     not from a text field, not under a modal, not with a modifier held.
 *
 * None of these routes takes a `runtime` (`runtime-required.test.mjs` owns the
 * list of the ones that do), and this suite pins that the bar calls no other.
 *
 * The stub window is `client-shell-gates.test.mjs`'s: a `document` whose
 * `getElementById` always answers, because the shell looks up sixty elements
 * at module scope and registers listeners on them.
 */
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as catalogue from '../../public/render/look-options.js';
import {
  DEFAULT_LOOK,
  PRESETS,
  lookForPreset,
  normalizeLook,
} from '../../public/render/look-options.js';
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
  showModal() {}
  close() {}
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
/** What `document.querySelector('dialog[open]')` answers: a modal is up, or not. */
let modalOpen = false;
/** Every request the client made, in order. @type {Array<{url:string, method:string, body:any}>} */
const requests = [];
/** What the daemon answers `/api/look` with, when a test wants a refusal. */
let lookAnswer = null;
/** The settings the fake daemon holds. */
let stored = {};

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
  querySelector: (sel) => (sel === 'dialog[open]' && modalOpen ? new StubNode('dialog') : null),
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
// The daemon, as far as this client can tell. It records, and it answers the
// two routes the bar writes to the way the real ones do: `/api/look` echoes
// the document (or refuses it whole), `/api/settings` merges the patch.
set('fetch', async (url, init = {}) => {
  const method = init.method || 'GET';
  const body = init.body ? JSON.parse(init.body) : null;
  requests.push({ url: String(url), method, body });
  if (url === '/api/look' && method === 'POST') {
    if (lookAnswer) return { ok: false, status: 400, json: async () => lookAnswer };
    stored.look = body;
    return { ok: true, status: 200, json: async () => ({ look: body }) };
  }
  if (url === '/api/settings' && method === 'POST') {
    stored = { ...stored, ...body };
    return { ok: true, status: 200, json: async () => ({ ...stored }) };
  }
  return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
});

// The shell, imported once the window exists. Dynamic, because a static import
// is hoisted above every line here and would run with no `document` at all.
const state = await import('../../public/app-state.js');
const { wireLookBar } = await import('../../public/app-lookbar.js');
const { handleKeydown, wireKeyboard } = await import('../../public/app-keys.js');

// What `app-floor.js` does once the renderer has loaded: hand the shell the
// catalogue, the guards and the themes. The catalogue and the guards are the
// real ones; the themes are the real table behind a painter that paints nothing.
state.setLook(null, catalogue, guards, null);
state.setThemes({ THEMES, themeByName, swatchesFor: () => [], applyTheme: (name) => name });

const el = (id) => documentStub.getElementById(id);
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
const all = (node, out = []) => {
  out.push(node);
  for (const child of node.children) all(child, out);
  return out;
};
const radios = () => all(el('look-popover')).filter((n) => n.getAttribute('role') === 'radio');
const radio = (text) => radios().find((b) => b.textContent === text);
const posts = () => requests.filter((r) => r.method === 'POST');

/** A fresh floor: a snapshot, an empty request log, a shut popover. */
function reset(settings = {}) {
  stored = {
    look: DEFAULT_LOOK,
    theme: 'default',
    onboarded: true,
    seenLookHint: true,
    ...settings,
  };
  state.setLatestSnapshot({ agents: [], projects: [], settings: { ...stored } });
  state.setLookSetting(stored.look);
  requests.length = 0;
  lookAnswer = null;
  modalOpen = false;
  bar.close();
  el('look-hint').hidden = true;
}

/** What the settings sheet was asked to open at, in order. */
const sheetOpens = [];
const bar = wireLookBar({
  settingsUI: { open: (section) => void sheetOpens.push(section ?? null) },
  tourRunning: () => false,
  debounceMs: 0,
});

// ------------------------------------------------------------ the bodies

test('Agent size POSTs a whole look document to /api/look, with one key changed', async () => {
  reset();
  el('look-btn').click();
  assert.equal(el('look-popover').hidden, false);
  assert.equal(radios().length, 4 + THEMES.length + PRESETS.length);

  radio('Large').click();
  await tick(5);
  assert.deepEqual(posts(), [
    {
      url: '/api/look',
      method: 'POST',
      body: { kind: 'deckhq.look', version: 1, ...normalizeLook(DEFAULT_LOOK), agentSize: 'large' },
    },
  ]);
  // The floor follows the daemon's answer, and so does the snapshot the next
  // control will read its look out of.
  assert.equal(state.latestSnapshot.settings.look.agentSize, 'large');
  assert.equal(radio('Large').getAttribute('aria-checked'), 'true');
});

test('Theme POSTs {theme} to /api/settings and nothing to /api/look', async () => {
  reset();
  el('look-btn').click();
  assert.deepEqual(
    THEMES.map((t) => t.name),
    ['default', 'night shift', 'blueprint'],
    'the three themes this build ships',
  );
  radio('Night shift').click();
  await tick(5);
  assert.deepEqual(posts(), [
    { url: '/api/settings', method: 'POST', body: { theme: 'night shift' } },
  ]);
  assert.equal(state.latestSnapshot.settings.theme, 'night shift');
  assert.equal(radio('Night shift').getAttribute('aria-checked'), 'true');
});

test('a Preset POSTs that preset’s look to /api/look, by name', async () => {
  const preset = PRESETS.find((p) => p.id === 'night-lab');
  reset();
  el('look-btn').click();
  radio(preset.label).click();
  await tick(5);
  assert.deepEqual(posts(), [
    {
      url: '/api/look',
      method: 'POST',
      body: { kind: 'deckhq.look', version: 1, ...lookForPreset('night-lab') },
    },
  ]);
  assert.equal(posts()[0].body.preset, 'night-lab');
});

test('the bar writes to two routes and no others, and neither of them is asked for a runtime', async () => {
  reset({ seenLookHint: false });
  bar.refresh();
  el('look-hint-dismiss').click();
  el('look-btn').click();
  radio('Small').click();
  await tick(5);
  radio('Blueprint').click();
  await tick(5);
  radio('Workshop').click();
  await tick(5);
  assert.deepEqual(
    posts().map((r) => r.url),
    ['/api/settings', '/api/look', '/api/settings', '/api/look'],
  );
  assert.deepEqual(posts()[0].body, { seenLookHint: true });
  for (const r of posts()) {
    assert.equal('runtime' in r.body, false, `${r.url} is not a route that takes a runtime`);
  }
  assert.deepEqual(
    requests.filter((r) => r.method !== 'POST'),
    [],
    'the popover reads nothing over the network: it is drawn from the snapshot',
  );
});

// ---------------------------------------------------------- the refusal

test('a look the real guard refuses is not sent, and its reason is in the popover', async () => {
  // A REAL refusal, not an invented verdict: a floor the guard would never have
  // offered — one material swapped under the default rugs — standing in
  // `settings.look`, which is what a hand-edited state.json looks like. The
  // popover's size control then asks for that same floor at another size, and
  // `validateLook` says what it would have said about the floor.
  let refused = null;
  for (const picker of catalogue.LOOK_PICKERS.filter((p) => p.id.startsWith('floor.'))) {
    const zone = picker.id.slice('floor.'.length);
    for (const option of picker.options) {
      const next = { ...DEFAULT_LOOK, floors: { ...DEFAULT_LOOK.floors, [zone]: option.id } };
      if (!refused && !guards.validateLook(next, 'default').ok) refused = normalizeLook(next);
    }
  }
  assert.ok(
    refused,
    'no single floor swap on the default look is refused any more — this test needs ' +
      'another way to reach a look the real guard says no to',
  );
  reset({ look: refused });
  el('look-btn').click();
  radio('Large').click();
  await tick(5);

  assert.deepEqual(posts(), [], 'a refused look reached the daemon');
  const verdict = guards.validateLook({ ...refused, agentSize: 'large' }, 'default');
  assert.equal(verdict.ok, false);
  const said = all(el('look-popover'))
    .filter((n) => n.className === 'lookbar-refusal')
    .map((n) => n.textContent);
  assert.deepEqual(
    said,
    verdict.problems.map((p) => `${p.reason}. Nothing was changed.`),
    'the popover must show the guard’s own sentences',
  );
  assert.equal(radio('Medium').getAttribute('aria-checked'), 'true', 'the control moved anyway');
});

test('a look the DAEMON refuses changes nothing here either, and says why', async () => {
  reset();
  lookAnswer = {
    error: 'look refused',
    problems: [
      { picker: 'rug.wool', option: 'sage', reason: 'wool rug reads 1.04:1 on night shift' },
    ],
  };
  el('look-btn').click();
  radio('Garden floor').click();
  await tick(5);
  assert.equal(posts().length, 1);
  const said = all(el('look-popover'))
    .filter((n) => n.className === 'lookbar-refusal')
    .map((n) => n.textContent);
  assert.deepEqual(said, ['wool rug reads 1.04:1 on night shift. Nothing was changed.']);
  assert.equal(state.latestSnapshot.settings.look.preset, DEFAULT_LOOK.preset);
  assert.equal(radio('Studio oak').getAttribute('aria-checked'), 'true');
});

// ------------------------------------------------------------- the keys

wireKeyboard({
  dismissCard: () => false,
  hideWhiteboard() {},
  toggleRedaction() {},
  saveCard() {},
  takeSnapshot() {},
  floatOffice() {},
  toggleIdleProjects() {},
  paletteUI: { isOpen: () => false, open() {}, close() {} },
  lookBar: bar,
});

/** A keydown on the floor, or wherever `target` says. */
function press(key, extra = {}) {
  const event = {
    key,
    target: documentStub.body,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    prevented: 0,
    preventDefault() {
      this.prevented++;
    },
    ...extra,
  };
  handleKeydown(/** @type {any} */ (event));
  return event;
}

test('L opens the Look popover from the floor, and L again closes it', () => {
  reset();
  const open = press('L');
  assert.equal(el('look-popover').hidden, false);
  assert.equal(open.prevented, 1);
  press('l');
  assert.equal(el('look-popover').hidden, true);
  // Lower case is the same key: caps lock must not decide whether it works.
  press('l');
  assert.equal(el('look-popover').hidden, false);
  bar.close();
});

test(', opens the settings sheet at the top', () => {
  reset();
  sheetOpens.length = 0;
  const event = press(',');
  assert.deepEqual(sheetOpens, [null]);
  assert.equal(event.prevented, 1);
  assert.equal(el('look-popover').hidden, true);
});

test('neither key fires while typing: an input, a textarea, anything editable', () => {
  reset();
  sheetOpens.length = 0;
  for (const target of [
    { tagName: 'INPUT' },
    { tagName: 'TEXTAREA' },
    { tagName: 'DIV', isContentEditable: true },
  ]) {
    for (const key of ['L', 'l', ',']) {
      const event = press(key, { target });
      assert.equal(event.prevented, 0, `"${key}" was taken from a ${target.tagName}`);
    }
  }
  assert.equal(el('look-popover').hidden, true, 'typing an "l" opened the Look popover');
  assert.deepEqual(sheetOpens, [], 'typing a comma opened the settings sheet');
});

test('neither key fires under a modal, or with a modifier held', () => {
  reset();
  sheetOpens.length = 0;
  modalOpen = true;
  press('L');
  press(',');
  modalOpen = false;
  for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
    press('l', { [modifier]: true });
    press(',', { [modifier]: true });
  }
  assert.equal(el('look-popover').hidden, true);
  assert.deepEqual(sheetOpens, []);
});
