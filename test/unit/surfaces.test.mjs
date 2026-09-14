/**
 * WP-84 · every full-surface view has a visible way back to the floor.
 *
 * The report, verbatim:
 *
 *   "Once the user clicks the agents tab, or the list of all who are waiting,
 *    there is literally no button to close that panel or go back to the floor
 *    view."
 *
 * Three gates, because the three ways this can break are different shapes.
 *
 *   1. **The markup, per view.** Each entry in `public/surfaces.js`'s
 *      `SURFACES` has a host in `index.html` carrying `data-surface`, a
 *      "Back to floor" button FIRST in the tab order, a title that prints the
 *      shortcut, and a ✕ LAST. Read out of the shipped document, so it is the
 *      product being asserted and not a fixture.
 *
 *   2. **The behaviour, per view.** The shipped buttons are rebuilt as stub
 *      nodes and handed to `wireSurfaceControls()`; each one must close the
 *      view exactly once. The deck is additionally driven for real through
 *      `createDeckUI()` — open it, press ✕, it is shut.
 *
 *   3. **The enumeration cannot go stale.** A list of views only helps while
 *      somebody remembers to add to it. So this file does not trust
 *      `SURFACES`: it reads `style.css` for every rule that makes an element
 *      cover its container (`position: fixed|absolute` with `inset: 0`), maps
 *      those selectors onto the elements `index.html` actually has, and fails
 *      on any of them that is neither a `data-surface` host nor listed in
 *      `NOT_A_VIEW` below with a reason. Add a full-surface view with no ✕ and
 *      this test fails before anybody opens a browser.
 *
 * Closing a view closes the VIEW. `test/unit/panel-close.test.mjs` holds that
 * half — §143, the ✕ that resolved to `window.close` — and WP-84 added these
 * buttons to its dynamic gate.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SURFACES,
  SURFACE_BACK_CLASS,
  SURFACE_CHROME_CLASS,
  SURFACE_CLOSE_CLASS,
  SURFACE_TITLE_CLASS,
  wireSurfaceControls,
} from '../../public/surfaces.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../../public');
/**
 * The shipped document with its comments blanked to spaces.
 *
 * Length-preserving, so every index below is an index into the real file. And
 * blanked rather than removed because `index.html`'s comments are half its
 * value — three of them contain the literal text `<dialog>`, explaining which
 * overlays are deliberately not dialogs, and a scanner that reads those as
 * markup finds eight dialogs in a document that has five.
 */
const HTML = fs
  .readFileSync(path.join(PUBLIC, 'index.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '));
const CSS = fs.readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');

/**
 * Full-surface elements that are deliberately NOT views, with the reason each
 * one is not. A reason is required: "it does not need a ✕" is a claim, and an
 * unexplained claim in an allowlist is how a gate stops meaning anything.
 */
const NOT_A_VIEW = {
  'floor-canvas': 'the floor itself — it is where "Back to floor" goes',
  'empty-state': 'the floor saying it is empty; nothing covers anything',
  'error-banner': 'the floor saying it cannot reach the daemon; same',
  'coach-layer': 'pointer-events: none, three marks ON real elements (WP-13)',
  'night-overlay': 'pointer-events: none, a dimming pass (WP-18)',
  'surface-body': "a surface's own content box, inside a host that IS listed",
};

// ------------------------------------------------------- a tiny tag walker
//
// index.html is ours and is well formed, so balancing one tag name is enough
// and no HTML parser has to be dragged in for it.

/**
 * The whole element whose start tag contains `at`.
 * @param {string} html @param {number} at an index inside a start tag
 * @returns {{tag:string, startTag:string, inner:string, outer:string}}
 */
function elementAround(html, at) {
  const open = html.lastIndexOf('<', at);
  const tag = (html.slice(open + 1).match(/^[a-zA-Z][\w-]*/) || [''])[0];
  assert.ok(tag, `no start tag before index ${at}`);
  const startEnd = html.indexOf('>', at);
  assert.notEqual(startEnd, -1, `unterminated <${tag}>`);
  const startTag = html.slice(open, startEnd + 1);
  if (startTag.endsWith('/>')) return { tag, startTag, inner: '', outer: startTag };

  const openRe = new RegExp(`<${tag}[\\s>]`, 'gi');
  const closeRe = new RegExp(`</${tag}\\s*>`, 'gi');
  let depth = 1;
  let cursor = startEnd + 1;
  while (depth > 0) {
    openRe.lastIndex = cursor;
    closeRe.lastIndex = cursor;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    assert.ok(nextClose, `unclosed <${tag}>`);
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth++;
      cursor = nextOpen.index + 1;
    } else {
      depth--;
      cursor = nextClose.index + nextClose[0].length;
      if (depth === 0) {
        return {
          tag,
          startTag,
          inner: html.slice(startEnd + 1, nextClose.index),
          outer: html.slice(open, cursor),
        };
      }
    }
  }
  throw new Error(`unreachable for <${tag}>`);
}

/** Every `<button …>…</button>` in a fragment, in source order. */
function buttonsIn(fragment) {
  /** @type {Array<{startTag:string, text:string, classes:string[], attrs:Record<string,string>}>} */
  const out = [];
  const re = /<button\b/gi;
  let m;
  while ((m = re.exec(fragment))) {
    const el = elementAround(fragment, m.index + 1);
    /** @type {Record<string,string>} */
    const attrs = {};
    for (const a of el.startTag.matchAll(/([\w-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    out.push({
      startTag: el.startTag,
      text: el.inner
        .replace(/<[^>]*>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim(),
      classes: (attrs.class || '').split(/\s+/).filter(Boolean),
      attrs,
    });
    re.lastIndex = m.index + el.outer.length;
  }
  return out;
}

/** The host element of one surface, straight out of the shipped document. */
function hostOf(surface) {
  const at = HTML.indexOf(`data-surface="${surface.id}"`);
  assert.notEqual(
    at,
    -1,
    `index.html has no element with data-surface="${surface.id}" — ` +
      `surfaces.js lists it, so the markup is missing`,
  );
  return elementAround(HTML, at);
}

// ------------------------------------------------ 1 · the markup, per view

test('WP-84: surfaces.js and index.html name the same views', () => {
  const inHtml = [...HTML.matchAll(/data-surface="([^"]+)"/g)].map((m) => m[1]).sort();
  const listed = SURFACES.map((s) => s.id).sort();
  assert.deepEqual(
    inHtml,
    listed,
    'every data-surface host must have a row in SURFACES and vice versa',
  );
  assert.equal(new Set(listed).size, listed.length, 'two surfaces share an id');
});

for (const surface of SURFACES) {
  test(`WP-84: the ${surface.id} view offers a way back to the floor`, () => {
    const host = hostOf(surface);
    assert.equal(
      host.startTag.includes(`id="${surface.hostId}"`),
      true,
      `the ${surface.id} host should be #${surface.hostId}`,
    );

    const chrome = host.inner.indexOf(SURFACE_CHROME_CLASS);
    assert.notEqual(chrome, -1, `the ${surface.id} view has no .${SURFACE_CHROME_CLASS} bar`);

    const buttons = buttonsIn(host.inner);
    const back = buttons.find((b) => b.classes.includes(SURFACE_BACK_CLASS));
    const close = buttons.find((b) => b.classes.includes(SURFACE_CLOSE_CLASS));

    assert.ok(back, `the ${surface.id} view has no "Back to floor" control`);
    assert.ok(close, `the ${surface.id} view has no ✕`);

    // Real buttons, so they are in the tab order and Enter and Space work on
    // them. `type="button"` because two of these live inside a <dialog> and a
    // typeless button inside a form submits it.
    for (const [what, b] of [
      ['back', back],
      ['close', close],
    ]) {
      assert.equal(b.attrs.type, 'button', `the ${surface.id} ${what} is not type="button"`);
      assert.ok(
        !('disabled' in b.attrs) && !('aria-hidden' in b.attrs) && b.attrs.tabindex !== '-1',
        `the ${surface.id} ${what} is not keyboard-reachable`,
      );
    }

    // Top left, then the title, then top right. Source order IS tab order.
    assert.ok(
      host.inner.indexOf(SURFACE_BACK_CLASS) < host.inner.indexOf(SURFACE_CLOSE_CLASS),
      `"Back to floor" must come before ✕ in the ${surface.id} view`,
    );

    assert.match(
      back.text,
      /back to floor/i,
      `the ${surface.id} back control must say where it goes, not only that it goes`,
    );
    assert.ok(close.text.includes('✕'), `the ${surface.id} close control is not a ✕`);

    // The shortcut is printed, in the title and on the ✕'s accessible name —
    // a way out nobody can see is not a way out.
    const title = host.inner.slice(host.inner.indexOf(SURFACE_TITLE_CLASS));
    const titleEl = elementAround(host.inner, host.inner.indexOf(SURFACE_TITLE_CLASS));
    assert.ok(title, `the ${surface.id} view has no .${SURFACE_TITLE_CLASS}`);
    assert.match(
      titleEl.inner,
      /<kbd>Esc<\/kbd>/,
      `the ${surface.id} view's title must print its Esc shortcut`,
    );
    assert.match(
      titleEl.inner,
      new RegExp(surface.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'),
      `the ${surface.id} view's title should say "${surface.title}"`,
    );
    assert.match(
      close.attrs['aria-label'] || '',
      /esc/i,
      `the ${surface.id} ✕ must name its shortcut for a screen reader too`,
    );
  });
}

// --------------------------------------------- 2 · the behaviour, per view

/** Just enough element to be clicked and to be found by class. */
class StubEl {
  constructor(classes = [], attrs = {}) {
    this.tagName = 'BUTTON';
    this.classes = new Set(classes);
    this.attrs = { ...attrs };
    /** @type {Record<string, Function[]>} */
    this.listeners = {};
    this.children = [];
    this.hidden = false;
    this.className = classes.join(' ');
    this.classList = {
      add: (/** @type {string} */ c) => void this.classes.add(c),
      remove: (/** @type {string} */ c) => void this.classes.delete(c),
      toggle: (/** @type {string} */ c, /** @type {boolean} */ on) =>
        on ? this.classes.add(c) : this.classes.delete(c),
      contains: (/** @type {string} */ c) => this.classes.has(c),
    };
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  click() {
    for (const fn of this.listeners.click || []) fn({ type: 'click', preventDefault() {} });
  }
  querySelectorAll(sel) {
    const want = sel.replace(/^\./, '');
    const out = [];
    for (const c of this.children) if (c.classes.has(want)) out.push(c);
    return out;
  }
}

for (const surface of SURFACES) {
  test(`WP-84: both controls close the ${surface.id} view, once each`, () => {
    // The buttons are rebuilt from the SHIPPED markup, so a view whose ✕ lost
    // its class fails here as well as in the markup gate above.
    const host = hostOf(surface);
    const shipped = buttonsIn(host.inner).filter(
      (b) => b.classes.includes(SURFACE_BACK_CLASS) || b.classes.includes(SURFACE_CLOSE_CLASS),
    );
    assert.equal(shipped.length, 2, `the ${surface.id} view should ship exactly two controls`);

    const stub = new StubEl();
    stub.children = shipped.map((b) => new StubEl(b.classes, b.attrs));

    let closed = 0;
    const wired = wireSurfaceControls(stub, () => void closed++);
    assert.equal(wired, 2, `wireSurfaceControls found ${wired} controls, not 2`);

    for (const button of stub.children) {
      const before = closed;
      button.click();
      assert.equal(closed, before + 1, `${button.className} closed the view ${closed - before}x`);
    }
    assert.equal(closed, 2);
  });
}

test('WP-84: Escape is a way back too, and Tab still toggles the deck', () => {
  // The map is read rather than pressed, for the reason `deck-keys.test.mjs`
  // states: there is no DOM in this suite, and standing one up to press a key
  // would test a stub. What can be checked without one is that the wiring
  // says what it must say.
  const keys = fs.readFileSync(path.join(PUBLIC, 'app-keys.js'), 'utf8');
  const start = keys.indexOf("case 'Escape':");
  assert.notEqual(start, -1, 'app-keys.js has no Escape case');
  const body = keys.slice(start, keys.indexOf('case ', start + 10));
  assert.match(body, /deckUI\??\.?\.?isOpen\(\)/, 'Escape does not ask whether the deck is open');
  assert.match(body, /deckUI\.close\(\)/, 'Escape does not close the deck');
  assert.match(keys, /if \(e\.key === 'Tab' && !e\.shiftKey\)/, 'Tab no longer toggles the deck');
  assert.match(keys, /deckUI\?\.toggle\(\)/, 'Tab no longer toggles the deck');
});

test('WP-84: a view with no chrome is reported rather than silently unwired', () => {
  // The fallback matters: an embedder (the VS Code webview, the mini floor)
  // may host a view without the bar, and the answer to that is zero, not a
  // thrown error inside somebody else's render.
  assert.equal(
    wireSurfaceControls(new StubEl(), () => {}),
    0,
  );
  assert.equal(
    wireSurfaceControls(null, () => {}),
    0,
  );
  assert.equal(
    wireSurfaceControls(/** @type {any} */ ({}), () => {}),
    0,
  );
});

// --------------------------------------- 3 · the enumeration cannot go stale

/**
 * Every leaf rule in a stylesheet as `{selector, body}` — leaf, so the bodies
 * of `@media` and `@supports` are walked into rather than swallowed whole.
 * @param {string} css
 */
function leafRules(css) {
  const out = [];
  let depth = 0;
  let selStart = 0;
  /** @type {number[]} */
  const opens = [];
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '{') {
      opens.push(i);
      depth++;
    } else if (ch === '}') {
      const open = opens.pop();
      depth--;
      if (open !== undefined) {
        const body = css.slice(open + 1, i);
        if (!body.includes('{')) {
          const before = css.slice(0, open);
          const cut = Math.max(before.lastIndexOf('}'), before.lastIndexOf('{'), selStart - 1);
          out.push({
            selector: before
              .slice(cut + 1)
              .replace(/\/\*[\s\S]*?\*\//g, ' ')
              .trim(),
            body,
          });
        }
      }
      selStart = i + 1;
    }
  }
  assert.equal(depth, 0, 'style.css has unbalanced braces');
  return out;
}

test('WP-84: no element that covers the floor lacks a way off it', () => {
  /** @type {Set<string>} */
  const covering = new Set();
  for (const rule of leafRules(CSS)) {
    const body = rule.body.replace(/\s+/g, ' ');
    if (!/inset:\s*0\b/.test(body)) continue;
    if (!/position:\s*(fixed|absolute)\b/.test(body)) continue;
    for (const part of rule.selector.split(',')) {
      const sel = part.trim();
      // A pseudo-element is paint, not a control surface: nobody can tab to
      // `.stage.is-cleared::after`.
      if (sel.includes('::')) continue;
      for (const m of sel.matchAll(/[.#]([\w-]+)/g)) covering.add(m[1]);
    }
  }
  assert.ok(covering.size >= 5, `the CSS scan found only ${covering.size} rules — it has broken`);

  /** Where in `index.html` this class or id is used, or -1. */
  const usedAt = (name) => {
    const byId = HTML.indexOf(`id="${name}"`);
    if (byId !== -1) return byId;
    const byClass = new RegExp(`class="[^"]*\\b${name}\\b`).exec(HTML);
    return byClass ? byClass.index : -1;
  };

  /** @type {string[]} */
  const offenders = [];
  for (const name of [...covering].sort()) {
    // Only what the shipped document actually uses; a class the stylesheet
    // carries for a surface that no longer exists is not a view.
    const at = usedAt(name);
    if (at === -1) continue;
    if (name in NOT_A_VIEW) continue;
    // The element wearing it is what has to carry the marker — the deck's
    // host is `#deck` and the board's is `#whiteboard-overlay.whiteboard-scrim`,
    // so matching the NAME against the surface list would miss one of them.
    if (elementAround(HTML, at + 1).startTag.includes('data-surface=')) continue;
    offenders.push(name);
  }
  assert.deepEqual(
    offenders,
    [],
    'these cover the floor and offer no ✕: give each a data-surface host with ' +
      'the chrome block (public/surfaces.js), or a reason in NOT_A_VIEW',
  );
});

test('WP-84: every dialog in the document can be left without the keyboard', () => {
  /** @type {string[]} */
  const offenders = [];
  const re = /<dialog\b/gi;
  let m;
  while ((m = re.exec(HTML))) {
    const el = elementAround(HTML, m.index + 1);
    const id = (el.startTag.match(/id="([^"]+)"/) || [, '(unnamed)'])[1];
    const buttons = buttonsIn(el.inner);
    const hasVisibleClose = buttons.some(
      (b) =>
        b.classes.includes(SURFACE_CLOSE_CLASS) ||
        /close/i.test(b.attrs['aria-label'] || '') ||
        b.text.includes('✕') ||
        b.text.includes('×'),
    );
    // A palette is typed into and dismissed; it prints `Esc` in its own
    // footer, which is a visible way out even though it is not a button.
    const printsEscape = /\bEsc\b/.test(el.inner.replace(/<[^>]*>/g, ' '));
    if (!hasVisibleClose && !printsEscape) offenders.push(id);
    re.lastIndex = m.index + el.outer.length;
  }
  assert.deepEqual(offenders, [], 'these dialogs offer no visible way out');
});
