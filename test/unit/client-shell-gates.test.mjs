/**
 * The seven client modules nothing was looking at — WP-92k,
 * `docs/plan/13-ARCHITECTURE-AUDIT.md` A-13.
 *
 * `app-dialogs.js`, `app-cards.js`, `app-launchers.js`, `app-look.js`,
 * `app-snapshot.js`, `app-floor.js` and `look-ui-pictures.js`: about 1,700
 * lines of the shell that no test imported and no test read. §143's bug — a ✕
 * button whose listener resolved `close` to `window.close` and shut the user's
 * tab — lived in exactly this region, and the whole toolchain was happy with
 * it: `tsc` because `close(): void` is in `lib.dom.d.ts`, eslint because
 * `close` is a browser global, the goldens because the floor is a canvas, and
 * the suite because nobody built the card and pressed the button.
 *
 * This is A-13's first half: not a rewrite, and not the headless harness the
 * second half would need. Two things, over each of the seven.
 *
 * **They are imported.** Once each, under a DOM stub whose `document`,
 * `window` and the seven window-closing globals are stand-ins, with the
 * closing ones replaced by counters. That is more than a syntax check: every
 * one of these modules does real work at module scope — `app-dialogs.js`
 * registers eleven listeners on elements it looks up by id — and until now
 * none of that had ever been executed anywhere but a browser. The counters
 * must all be zero afterwards.
 *
 * **They are parsed**, for three properties a reader would otherwise have to
 * re-establish by reading 1,700 lines:
 *
 *   1. §143's shape. No window-closing global is called, by any name, bound to
 *      a click or anywhere else.
 *   2. Every `fetch` goes to this daemon. A same-origin path, written as a
 *      literal, and never an absolute URL — P-05's no-egress promise is a
 *      property of the client as much as of the daemon, and this is the half
 *      of it nothing was checking.
 *   3. No `Date.now()`, `Math.random()` or `performance.now()`. These modules
 *      draw ages, dismiss cards on a date and lay out a floor; the client's
 *      clock is `public/clock.js`, which a pinned snapshot moves (WP-63), and
 *      a module reading the wall clock instead is how a golden stops being a
 *      function of its fixture. `character-life.test.mjs` holds the same rule
 *      over `public/render/`; these seven were outside both.
 *
 * The gate is proved to fail rather than trusted: the last test plants §143's
 * line into a TEMP COPY and asserts the gate names it. Nothing in the tree is
 * broken to see it.
 */
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../../public');

/**
 * The seven, by name, from A-13. A list rather than a walk, deliberately: this
 * is a named debt with a second package behind it, and the list going quiet
 * because a file was renamed would be the debt disappearing without being
 * paid. A rename fails the first test here, on the missing file.
 */
const SEVEN = [
  'app-dialogs.js',
  'app-cards.js',
  'app-launchers.js',
  'app-look.js',
  'app-snapshot.js',
  'app-floor.js',
  'look-ui-pictures.js',
];

// ---------------------------------------------------------------------------
// The static gates
// ---------------------------------------------------------------------------

/**
 * Source with comments and string literals blanked, newlines kept.
 *
 * The same device `panel-close.test.mjs` uses, and for the reason its header
 * gives: half these modules explain §143 in prose, and a static check that
 * reads an explanation as an offence is a static check somebody deletes.
 * Blanked rather than deleted so an offence still lands on its own line.
 * @param {string} src
 */
function blanked(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:\\])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
    .replace(/(['"`])(?:\\.|(?!\1)[^\\\n])*\1/g, (m) => m[0] + ' '.repeat(m.length - 2) + m[0]);
}

/** Line number of an index into a source, 1-based. */
function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

/** The globals that end a tab, a print job or a load. None belongs in the shell. */
const CLOSING = ['close', 'open', 'print', 'stop'];

/**
 * Does this module declare a binding of its own called `name`?
 *
 * Generous on purpose: a false "yes" only means the gate stays quiet about a
 * call a module genuinely owns, and the offence being hunted is a call no
 * module owns at all.
 * @param {string} code @param {string} name
 */
function declares(code, name) {
  return new RegExp(
    [
      `(?:function|class)\\s+${name}\\b`,
      `(?:const|let|var)\\s+[^=;\\n]*\\b${name}\\b[^=;\\n]*[=;]`,
      `\\b${name}\\s*[,}]\\s*=`,
      `\\(\\s*(?:[^)]*,\\s*)?${name}\\s*(?:[,)])`,
      `\\b${name}\\s*:\\s*(?:function|\\(|async)`,
      `^\\s*${name}\\s*\\(`,
    ].join('|'),
    'm',
  ).test(code);
}

/**
 * Every offence in one module, as lines a person can act on.
 *
 * Takes a path rather than reading `PUBLIC` itself, so the same function runs
 * over a temp copy with something planted in it. That is what makes the last
 * test in this file a proof rather than a claim.
 *
 * @param {string} file absolute path to a client module
 * @returns {string[]}
 */
export function offences(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const code = blanked(raw);
  const name = path.basename(file);
  /** @type {string[]} */
  const found = [];
  const at = (index) => `${name}:${lineOf(code, index)}`;

  // 1 · §143. The explicit forms first — `window.close()` and the two history
  //     navigations are never right here: the shell is a region of a page the
  //     user owns, and nothing in it navigates the tab.
  for (const forbidden of [
    'window.close(',
    'window.open(',
    'window.print(',
    'window.stop(',
    'history.back(',
    'history.forward(',
    'history.go(',
  ]) {
    let from = 0;
    for (;;) {
      const i = code.indexOf(forbidden, from);
      if (i === -1) break;
      found.push(`${at(i)}: calls ${forbidden})`);
      from = i + forbidden.length;
    }
  }
  // ...and the implicit one, which is the shape §143 actually had: a bare
  // `close()` in a module that declares no `close`, so the identifier resolves
  // on the global object and the tab dies.
  for (const global of CLOSING) {
    if (declares(code, global)) continue;
    const bare = new RegExp(`(^|[^.\\w$?])${global}\\s*\\(`, 'g');
    let m;
    while ((m = bare.exec(code)) !== null) {
      const start = m.index + m[0].length - global.length - 1;
      const before = code.slice(Math.max(0, start - 40), start);
      if (/(?:function|class|async)\s*$/.test(before)) continue;
      found.push(
        `${at(start)}: bare ${global}() with no binding of that name — window.${global}()`,
      );
    }
  }

  // 2 · Every fetch is a path on this daemon. A literal, so it can be read:
  //     these seven call `fetch` eleven times and every one is a literal
  //     today, and a computed target is a target this gate cannot vouch for.
  const fetches = /\bfetch\s*\(\s*([^),]*)/g;
  let f;
  while ((f = fetches.exec(raw)) !== null) {
    const arg = f[1].trim();
    const literal = arg.match(/^(['"`])(.*)$/s);
    if (!literal) {
      found.push(`${at(f.index)}: fetch() target is not a literal, so it cannot be checked`);
      continue;
    }
    const target = literal[2];
    if (!target.startsWith('/') || target.startsWith('//')) {
      found.push(`${at(f.index)}: fetch("${target.slice(0, 40)}") is not a path on this daemon`);
    }
  }

  // 3 · No wall clock and no randomness. `public/clock.js` is what a client
  //     module reads, because a pinned snapshot moves it and the wall clock.
  const wall = /\b(Date\.now|Math\.random|performance\.now)\s*\(\)/g;
  let w;
  while ((w = wall.exec(code)) !== null) {
    found.push(`${at(w.index)}: calls ${w[1]}() — the client clock is ./clock.js`);
  }

  return found;
}

test('the seven modules A-13 named are all still there', () => {
  for (const name of SEVEN) {
    assert.ok(
      fs.existsSync(path.join(PUBLIC, name)),
      `public/${name} is gone — if it was renamed or split, move its row here rather than ` +
        'deleting it: A-13 is a debt, and a list that goes quiet is a debt that vanished.',
    );
  }
});

test('A-13: none of the seven reaches a window-closing global (§143)', () => {
  /** @type {string[]} */
  const all = [];
  for (const name of SEVEN) {
    for (const line of offences(path.join(PUBLIC, name))) {
      if (/close|open\(|print|stop/.test(line)) all.push(line);
    }
  }
  assert.deepEqual(all, []);
});

test('A-13: every fetch in the seven is a path on this daemon', () => {
  /** @type {string[]} */
  const all = [];
  for (const name of SEVEN) {
    for (const line of offences(path.join(PUBLIC, name))) {
      if (line.includes('fetch(')) all.push(line);
    }
  }
  assert.deepEqual(all, []);
});

test('A-13: none of the seven reads the wall clock or a random source', () => {
  /** @type {string[]} */
  const all = [];
  for (const name of SEVEN) {
    for (const line of offences(path.join(PUBLIC, name))) {
      if (line.includes('client clock')) all.push(line);
    }
  }
  assert.deepEqual(all, []);
});

// ---------------------------------------------------------------------------
// The smoke import
// ---------------------------------------------------------------------------

/** Enough of an element to be looked up, listened to and appended to. */
class StubNode {
  constructor(tag = 'div') {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parentNode = null;
    this.className = '';
    this.id = '';
    this.hidden = false;
    this.value = '';
    this.textContent = '';
    this.dataset = {};
    this.style = {};
    this.attrs = /** @type {Record<string,string>} */ ({});
    this.listeners = /** @type {Record<string, Function[]>} */ ({});
    this.classList = {
      add: () => {},
      remove: () => {},
      toggle: () => {},
      contains: () => false,
    };
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
  removeEventListener() {}
  dispatchEvent() {
    return true;
  }
  click() {}
  focus() {}
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
  contains() {
    return false;
  }
  getBoundingClientRect() {
    return { top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 };
  }
  getContext() {
    return null;
  }
}

/** The globals that end a tab, and how many times each was reached. */
const TRAPPED = ['close', 'open', 'print', 'stop', 'back', 'forward', 'go'];

/**
 * A document whose `getElementById` always answers.
 *
 * That is the one thing that makes these modules importable at all: the shell
 * looks up about sixty elements by id at module scope (`app-state.js`) and
 * then registers listeners on them, so a stub that answers `null` fails on the
 * first `addEventListener`. Every id gets a node, and the same node each time.
 */
function installStubWindow() {
  /** @type {Record<string, number>} */
  const reached = Object.fromEntries(TRAPPED.map((k) => [k, 0]));
  /** @type {Map<string, StubNode>} */
  const byId = new Map();
  const body = new StubNode('body');
  const document = {
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
    addEventListener: () => {},
    removeEventListener: () => {},
    body,
    documentElement: new StubNode('html'),
    hidden: false,
    activeElement: null,
    visibilityState: 'visible',
  };

  /** @type {Map<string, {had:boolean, value:any}>} */
  const saved = new Map();
  const set = (name, value) => {
    saved.set(name, { had: name in globalThis, value: globalThis[name] });
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };

  const win = {
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
    location: { href: 'http://127.0.0.1:4317/', search: '', origin: 'http://127.0.0.1:4317' },
    devicePixelRatio: 1,
    innerWidth: 1600,
    innerHeight: 1000,
  };

  set('document', document);
  set('window', win);
  set('location', win.location);
  set('matchMedia', win.matchMedia);
  set('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} });
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
  // A fetch that never leaves the process. Nothing imported here should call
  // one at module scope; if something does, it gets an empty answer rather
  // than a socket.
  set('fetch', async () => ({
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => '',
  }));
  set('close', () => void reached.close++);
  set('open', () => {
    reached.open++;
    return null;
  });
  set('print', () => void reached.print++);
  set('stop', () => void reached.stop++);
  set('history', {
    length: 1,
    back: () => void reached.back++,
    forward: () => void reached.forward++,
    go: () => void reached.go++,
    pushState: () => {},
    replaceState: () => {},
  });

  const undo = () => {
    for (const [name, prev] of saved) {
      if (prev.had) {
        Object.defineProperty(globalThis, name, {
          value: prev.value,
          configurable: true,
          writable: true,
        });
      } else {
        delete globalThis[name];
      }
    }
  };
  return { reached, undo };
}

test('A-13: each of the seven can be imported, and its module scope closes nothing', async () => {
  const { reached, undo } = installStubWindow();
  try {
    for (const name of SEVEN) {
      const mod = await import(pathToFileURL(path.join(PUBLIC, name)).href);
      assert.ok(
        Object.keys(mod).length > 0,
        `public/${name} exported nothing — it is imported for its effects only?`,
      );
    }
  } finally {
    undo();
  }
  for (const [global, count] of Object.entries(reached)) {
    assert.equal(count, 0, `importing the shell reached window.${global}() ${count} time(s)`);
  }
});

// ---------------------------------------------------------------------------
// The gate, proved to fail
// ---------------------------------------------------------------------------

test('the gate fails when §143 line is put back — in a temp copy, not in the tree', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-a13-'));
  try {
    // §143's line, verbatim, in a module that declares no `close`.
    const planted = path.join(dir, 'app-dialogs.js');
    fs.writeFileSync(
      planted,
      [
        "import { el } from './app-state.js';",
        'const closeBtn = el.someButton;',
        "closeBtn.addEventListener('click', () => close());",
      ].join('\n'),
      'utf8',
    );
    const said = offences(planted);
    assert.equal(said.length, 1, said.join('\n'));
    assert.match(said[0], /bare close\(\) with no binding/);
    assert.match(said[0], /^app-dialogs\.js:3:/, 'the offence must name the file and the line');

    // And the other two rules, each planted on its own line.
    const other = path.join(dir, 'app-cards.js');
    fs.writeFileSync(
      other,
      [
        "const a = fetch('https://example.com/telemetry');",
        'const b = Date.now();',
        "const c = fetch('/api/stats');",
        'window.close();',
      ].join('\n'),
      'utf8',
    );
    const lines = offences(other);
    assert.equal(lines.length, 3, lines.join('\n'));
    assert.match(lines.join('\n'), /is not a path on this daemon/);
    assert.match(lines.join('\n'), /Date\.now\(\) — the client clock/);
    assert.match(lines.join('\n'), /calls window\.close\(\)/);
    assert.equal(
      lines.some((l) => l.includes('/api/stats')),
      false,
      'a same-origin path is not an offence',
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
