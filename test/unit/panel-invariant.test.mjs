/**
 * The client half of THE INVARIANT (docs/01-PRODUCT.md §2), checked
 * statically. `performAction()` in public/panel.js is the only code in the
 * browser client that may call POST /api/ack, and it may only be reached from
 * an explicit button or an explicit key. These tests read the source, with
 * comments stripped, and fail the moment a second caller appears — including
 * a well-meaning one in a render path.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(HERE, '../../public');

/** @param {string} src */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/.*$/gm, '$1');

/** Every .js file under public/, recursively. */
function clientFiles(dir = PUBLIC, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) clientFiles(full, out);
    else if (name.endsWith('.js')) out.push(full);
  }
  return out;
}

const read = (file) => stripComments(fs.readFileSync(file, 'utf8'));

/** The body of a top-level-in-createPanel `async function name(...) { ... }`. */
function functionBody(src, name) {
  const start = src.indexOf(`async function ${name}(`);
  assert.notEqual(start, -1, `${name}() not found`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

/** The body of a plain (non-async) `function name(...) { ... }`. */
function functionBodyOf(src, name) {
  const start = src.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name}() not found`);
  let i = src.indexOf('{', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

test('INVARIANT: /api/ack is called from exactly one place in the client, performAction()', () => {
  const offenders = [];
  for (const file of clientFiles()) {
    const src = read(file);
    const hits = src.match(/\/api\/ack\b/g) || [];
    const rel = path.relative(PUBLIC, file).replace(/\\/g, '/');
    if (rel === 'panel.js') {
      assert.equal(hits.length, 1, `panel.js mentions /api/ack ${hits.length} times in code`);
      const body = functionBody(src, 'performAction');
      assert.match(body, /fetch\(\s*'\/api\/ack'/, 'the one call is inside performAction()');
    } else if (hits.length) {
      offenders.push(rel);
    }
  }
  assert.deepEqual(offenders, [], 'these client files reach /api/ack outside panel.js');
});

test('INVARIANT: performAction() is reached only from explicit clicks and explicit keys', () => {
  const panel = read(path.join(PUBLIC, 'panel.js'));
  // Every call site in panel.js sits inside an addEventListener('click') arrow
  // or inside pressNumberKey(). Render, open, refresh and load paths call none.
  for (const fn of [
    'open',
    'close',
    'refresh',
    'renderChrome',
    'renderSaid',
    'renderThread',
    'renderChanges',
  ]) {
    const start = panel.indexOf(`function ${fn}(`);
    assert.notEqual(start, -1, `${fn}() not found`);
    const end = panel.indexOf('\n  function ', start + 1);
    const body = panel.slice(start, end === -1 ? undefined : end);
    assert.doesNotMatch(body, /performAction\(/, `${fn}() must not call performAction()`);
  }
  for (const fn of ['loadConversation', 'loadChanges', 'loadResumeTargets', 'sendText']) {
    assert.doesNotMatch(
      functionBody(panel, fn),
      /performAction\(|\/api\/ack/,
      `${fn}() is passive`,
    );
  }
  const calls = panel.match(/performAction\((?!\))[^)]*\)/g) || [];
  assert.ok(calls.length >= 3, `expected the button and key call sites, found ${calls.length}`);

  // app.js reaches it from the keyboard map and, since WP-07, from the
  // command palette's action table — where an entry runs only on an explicit
  // Enter or click on a highlighted row. Three call sites, all explicit.
  const app = read(path.join(PUBLIC, 'app.js'));
  const appCalls = app.match(/panel\.performAction\(/g) || [];
  assert.equal(appCalls.length, 3, 'app.js: the A and B shortcuts and the palette, nothing else');
  const keydownStart = app.indexOf('function handleKeydown(');
  const keydownEnd = app.indexOf('\nfunction ', keydownStart + 1);
  const keydown = app.slice(keydownStart, keydownEnd);
  assert.equal((keydown.match(/panel\.performAction\(/g) || []).length, 2);

  // The third is the palette's `ack:` action and nothing else. It is declared
  // inside createPalette's options object, so a call added anywhere outside
  // that object fails this.
  const paletteStart = app.indexOf('createPalette({');
  assert.notEqual(paletteStart, -1, 'createPalette({ ... }) not found in app.js');
  const paletteEnd = app.indexOf('\n});', paletteStart);
  const paletteOpts = app.slice(paletteStart, paletteEnd);
  assert.equal(
    (paletteOpts.match(/panel\.performAction\(/g) || []).length,
    1,
    'the palette reaches performAction() exactly once, through its ack action',
  );
  assert.match(paletteOpts, /ack:\s*\(action\)\s*=>\s*panel\.performAction\(action\)/);
});

test('INVARIANT: the palette never reaches /api/ack itself', () => {
  // public/palette.js offers the six acknowledgement actions as entries, but
  // running one calls back into panel.js. A fetch here would be a second
  // funnel, which is exactly what the first test in this file forbids — this
  // one says so at the palette, where the temptation lives.
  const palette = read(path.join(PUBLIC, 'palette.js'));
  assert.doesNotMatch(palette, /\/api\/ack/);
  assert.doesNotMatch(palette, /fetch\(/, 'the palette asks app.js to act; it makes no requests');
});

test('INVARIANT: the permission card never reaches /api/ack, and answering is its own funnel', () => {
  // WP-19. Allowing or denying one tool call says nothing about whether the
  // user is done with the session. Routing a permission decision through
  // performAction() would let it clear a review debt — an observed event
  // moving a user-owned state, which is the whole thing the invariant forbids.
  const panel = read(path.join(PUBLIC, 'panel.js'));

  // Rendering a question is not answering it.
  const render = functionBodyOf(panel, 'renderPermission');
  assert.doesNotMatch(render, /performAction\(|\/api\/ack|\/api\/permission/);

  // The one funnel, and it touches nothing user-owned.
  const answerFn = functionBody(panel, 'answerPermission');
  assert.match(answerFn, /fetch\(\s*'\/api\/permission\/decide'/);
  assert.doesNotMatch(answerFn, /performAction\(|\/api\/ack|acknowledge|reviewSince/);

  // Exactly one caller of the decide endpoint in the whole client.
  for (const file of clientFiles()) {
    const src = read(file);
    const hits = src.match(/\/api\/permission\/decide/g) || [];
    const rel = path.relative(PUBLIC, file).replace(/\\/g, '/');
    if (rel === 'panel.js') assert.equal(hits.length, 1);
    else assert.equal(hits.length, 0, `${rel} answers permission prompts`);
  }
});

test('INVARIANT: A / D / S only ever answer a card that is actually up', () => {
  // `A` is app.js's acknowledge shortcut. The panel's own listener runs first
  // and takes the key ONLY while a permission card is showing; with no card it
  // must fall through untouched, or acknowledging by keyboard would break.
  const panel = read(path.join(PUBLIC, 'panel.js'));
  const start = panel.indexOf("document.addEventListener('keydown'");
  assert.notEqual(start, -1, 'the panel registers no keydown listener');
  let i = panel.indexOf('{', start);
  let depth = 0;
  for (; i < panel.length; i++) {
    if (panel[i] === '{') depth++;
    else if (panel[i] === '}' && --depth === 0) break;
  }
  const handler = panel.slice(start, i + 1);

  // Every guard that has to be there before the key is claimed.
  assert.match(handler, /root\.hidden/, 'it acts while the panel is closed');
  assert.match(handler, /TEXTAREA/, 'it acts while the composer has focus');
  assert.match(handler, /isContentEditable/);
  assert.match(handler, /dialog\[open\]/);
  assert.match(handler, /pendingPermission\(\)/);
  assert.match(handler, /requiresUserInteraction/);
  // It never acknowledges, benches or sends.
  assert.doesNotMatch(handler, /performAction\(|\/api\/ack|sendText\(/);
  // The key is only swallowed after a decision has been settled on.
  const claim = handler.indexOf('stopImmediatePropagation');
  assert.ok(claim > handler.indexOf("case 'a'"), 'the key is claimed before the card is checked');
});

test('SECURITY: no client module assigns innerHTML or builds HTML from strings', () => {
  const offenders = [];
  for (const file of clientFiles()) {
    if (
      /innerHTML|outerHTML|insertAdjacentHTML|DOMParser|createContextualFragment/.test(read(file))
    ) {
      offenders.push(path.relative(PUBLIC, file).replace(/\\/g, '/'));
    }
  }
  assert.deepEqual(offenders, []);
});

test('2 Approve is a send, never an ack', () => {
  const panel = read(path.join(PUBLIC, 'panel.js'));
  const approve = panel.slice(
    panel.indexOf('function approve('),
    panel.indexOf('function approve(') + 200,
  );
  assert.match(approve, /sendText\(/);
  assert.doesNotMatch(approve, /performAction|\/api\/ack/);
  // `1` and `2` never reach performAction; only `3` does.
  const press = panel.slice(
    panel.indexOf('function pressNumberKey('),
    panel.indexOf('function focusComposer('),
  );
  const caseOne = press.slice(press.indexOf("case '1'"), press.indexOf("case '2'"));
  const caseTwo = press.slice(press.indexOf("case '2'"), press.indexOf("case '3'"));
  assert.doesNotMatch(caseOne + caseTwo, /performAction/);
  assert.match(press.slice(press.indexOf("case '3'")), /performAction\(thirdAction/);
});
