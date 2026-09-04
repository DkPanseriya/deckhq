/**
 * WP-09 · the panel's half of the streamed send, checked statically.
 *
 * public/panel.js has no DOM to run against in this suite (there is no
 * jsdom, and there will not be one — rule 3, no runtime dependencies), so
 * these read the source with comments stripped, exactly as
 * test/unit/panel-invariant.test.mjs does. What they hold is the small set of
 * facts about this feature that are easy to break by accident and expensive
 * to notice: the composer is released on acceptance rather than completion,
 * a failed turn puts the text back, the live region is `textContent` only,
 * and nothing on the path acks anything.
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
/**
 * The WP-22 follow-up split the review card into fourteen modules, listed in
 * the order the functions used to appear in the one file. Only this list
 * changed: not one assertion below did.
 */
const PANEL_PARTS = [
  'panel-rules.js',
  'panel-format.js',
  'panel-state.js',
  'panel-dom.js',
  'panel-header.js',
  'panel-permission.js',
  'panel-said.js',
  'panel-changes.js',
  'panel-actions.js',
  'panel-resume.js',
  'panel-records.js',
  'panel-composer.js',
  'panel-live.js',
  'panel.js',
];
const panel = PANEL_PARTS.map((f) =>
  stripComments(fs.readFileSync(path.join(PUBLIC, f), 'utf8')),
).join('\n');

/**
 * The body of a named function declaration, braces balanced. The parameter
 * list is walked first, so a default like `o = {}` is not mistaken for the
 * opening brace of the body.
 */
function bodyOf(src, decl) {
  const start = src.indexOf(decl);
  assert.notEqual(start, -1, `${decl} not found`);
  let i = start + decl.length - 1; // the '(' the declaration ends with
  let parens = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') parens++;
    else if (src[i] === ')' && --parens === 0) break;
  }
  i = src.indexOf('{', i);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) break;
  }
  return src.slice(start, i + 1);
}

test('the composer comes back when the turn is ACCEPTED, not when it completes', () => {
  const send = bodyOf(panel, 'async function sendText(');
  // The send is a POST that is answered immediately; there is no await on a
  // whole conversation reload in the success path any more, and the composer
  // is released in the `finally` that runs the moment that POST returns.
  assert.match(send, /setComposerBusy\(false\)/);
  assert.match(send, /body\.sendId/, 'the send id the stream is keyed on is never read');
  assert.doesNotMatch(
    send,
    /await loadConversation\(/,
    'the composer must not wait on a conversation reload',
  );
});

test('a turn that fails puts the text back where it was typed', () => {
  const restore = bodyOf(panel, 'function restoreComposer(');
  assert.match(restore, /textarea\.value = text/);
  assert.match(restore, /drafts\.save\(/, 'the restored text is not saved as a draft');
  // Both routes to a failure reach it: the request itself, and a `send` event
  // arriving seconds later.
  assert.match(bodyOf(panel, 'async function sendText('), /restoreComposer\(/);
  assert.match(bodyOf(panel, 'function onSendEvent('), /restoreComposer\(/);
});

test('a failure never overwrites something typed since', () => {
  const restore = bodyOf(panel, 'function restoreComposer(');
  assert.match(
    restore,
    /if \(textarea\.value\.trim\(\)\) return/,
    'a slow failure would eat the next reply',
  );
});

test('deltas are appended as text, never as markup', () => {
  const onEvent = bodyOf(panel, 'function onSendEvent(');
  assert.match(onEvent, /liveBody\.textContent \+=/);
  assert.doesNotMatch(onEvent, /renderMarkdown|innerHTML|insertAdjacentHTML/);
  // The whole live region, not just the delta branch.
  const begin = bodyOf(panel, 'function beginLive(');
  const end = bodyOf(panel, 'function endLive(');
  for (const body of [begin, end]) assert.doesNotMatch(body, /innerHTML|renderMarkdown/);
});

test('the agent’s row is in a typing state until the turn ends', () => {
  assert.match(bodyOf(panel, 'function beginLive('), /classList\.add\('is-typing'\)/);
  assert.match(bodyOf(panel, 'function endLive('), /classList\.remove\('is-typing'\)/);
  // And `done` is what ends it — not `result`, which a failed turn also
  // produces, and not a timer.
  const onEvent = bodyOf(panel, 'function onSendEvent(');
  const done = onEvent.slice(onEvent.indexOf("case 'done'"));
  assert.match(done, /endLive\(\)/);
});

test('INVARIANT: nothing in the streaming path acks anything', () => {
  for (const decl of [
    'function onSendEvent(',
    'function onTranscriptChange(',
    'function beginLive(',
    'function endLive(',
    'function watchLive(',
    'function openLive(',
    'function closeLive(',
    'function restoreComposer(',
  ]) {
    assert.doesNotMatch(
      bodyOf(panel, decl),
      /performAction\(|\/api\/ack/,
      `${decl} reaches ack state`,
    );
  }
});

test('the transcript tail re-reads the conversation and nothing else', () => {
  const onChange = bodyOf(panel, 'function onTranscriptChange(');
  assert.match(onChange, /loadConversation\(id\)/);
  assert.match(onChange, /if \(id !== currentId \|\| streaming\) return/);
  // Debounced: a transcript being appended to is not a reason to fetch the
  // conversation once per write.
  assert.match(onChange, /setTimeout\(/);
});

test('the panel subscribes to the send stream, and only to it', () => {
  const open = bodyOf(panel, 'function openLive(');
  assert.match(open, /\/api\/events\?stream=send&watch=/);
  assert.match(open, /addEventListener\('send'/);
  assert.match(open, /addEventListener\('transcript'/);
  assert.doesNotMatch(open, /addEventListener\('state'/, 'app.js owns the snapshot connection');
});

test('the connection is closed with the card, and reconnects with backoff', () => {
  assert.match(bodyOf(panel, 'function close('), /closeLive\(\)/);
  assert.match(bodyOf(panel, 'function open('), /watchLive\(id\)/);
  assert.match(bodyOf(panel, 'function closeLive('), /liveSource\?\.close\(\)/);
  assert.match(bodyOf(panel, 'function openLive('), /liveBackoff = Math\.min/);
});

test('app.js is untouched by this package', () => {
  // WP-57 owns public/app.js and public/render/**. The panel opening its own
  // EventSource is what that constraint bought; this asserts it stayed bought.
  const app = stripComments(fs.readFileSync(path.join(PUBLIC, 'app.js'), 'utf8'));
  assert.doesNotMatch(app, /stream=send/);
  assert.equal((app.match(/new EventSource\(/g) || []).length, 1);
});
