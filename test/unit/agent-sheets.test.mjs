/**
 * THE NEW-AGENT SHEET AND THE NAME-AND-BADGE SHEET (`public/app-dialogs.js`,
 * `public/agent-thumb.js`, the two dialogs in `index.html`).
 *
 * The sheets offered an "Avatar" as seven bare outlines. What that choice
 * changes is one real thing — the mark on the badge on a robot's chest — so
 * each choice is now that robot, drawn by the floor's own painter. These hold
 * that the choice is real, that the picture is the floor's, and that the
 * sheets read in the order a person fills them.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AVATAR_GLYPHS, identityFor } from '../../public/render/palette.js';
import { AGENT_THUMB_H, AGENT_THUMB_W, paintAgentThumb } from '../../public/agent-thumb.js';
import { shapeRecorder } from '../helpers/shape-recorder.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (/** @type {string} */ file) => fs.readFileSync(path.join(REPO, file), 'utf8');
const html = read('public/index.html');
const dialog = (/** @type {string} */ id) => {
  const from = html.indexOf(`<dialog id="${id}"`);
  return html.slice(from, html.indexOf('</dialog>', from));
};

/** What one thumbnail paints, as comparable text. */
const painted = (/** @type {string|null} */ glyph, mk = 3) => {
  const ctx = shapeRecorder();
  paintAgentThumb(ctx, { glyph, projectMk: mk });
  return ctx.paints;
};

test('AN AVATAR IS THE BADGE ON A ROBOT’S CHEST: the choice changes what the floor’s painter draws, and nothing else', () => {
  assert.equal(AVATAR_GLYPHS.length >= 7, true);
  for (const glyph of AVATAR_GLYPHS) assert.equal(identityFor(3, glyph).glyph, glyph);
  // A name that is not a badge is the project's own, as on the floor.
  assert.equal(identityFor(3, 'nonsense').glyph, identityFor(3).glyph);
  // Two badges are two pictures; the same badge twice is one.
  const key = (/** @type {any[]} */ paints) =>
    JSON.stringify(paints.map((p) => [p.op, p.style, p.box]));
  const seen = new Set(AVATAR_GLYPHS.map((g) => key(painted(g))));
  assert.equal(seen.size, AVATAR_GLYPHS.length, 'two badges are drawn as the same robot');
  assert.equal(key(painted('star')), key(painted('star')));
  // `Project` (no choice) is the robot wearing its project's own badge.
  assert.equal(key(painted(null)), key(painted(identityFor(3).glyph)));
  // The badge is in the project's colour, and it is inside the picture — the
  // one thing the picture is of must not be cut off by its frame.
  const accent = identityFor(3).accent;
  const marks = painted('square').filter((p) => p.style === accent && p.box);
  assert.ok(marks.length >= 1, 'the badge is not drawn in the project’s colour');
  const badge = marks.at(-1).box;
  assert.ok(
    badge.y1 <= AGENT_THUMB_H && badge.y0 >= 0,
    `the badge runs to ${badge.y1} of ${AGENT_THUMB_H}`,
  );
  assert.ok(badge.x0 >= 0 && badge.x1 <= AGENT_THUMB_W);
});

test('the new-agent sheet reads in the order it is filled: what to do, what to call it, its badge, where it runs', () => {
  const sheet = dialog('new-agent-dialog');
  const order = [
    'new-agent-intro',
    'new-agent-instructions',
    'new-agent-name-picker',
    'new-agent-avatar-picker',
    'new-agent-runtime',
    'new-agent-error',
    'new-agent-go',
  ];
  const at = order.map((id) => sheet.indexOf(`id="${id}"`));
  assert.ok(
    at.every((i) => i > 0),
    'a field of the sheet is missing',
  );
  assert.deepEqual(
    [...at].sort((a, b) => a - b),
    at,
    'the fields are out of order',
  );
  // Said in the product's words: a badge, not an "avatar".
  assert.match(sheet, /What should it start on\? \(optional\)/);
  assert.match(sheet, /Name on the floor \(optional\)/);
  assert.match(sheet, /Chest badge \(optional\)/);
  assert.doesNotMatch(sheet.replace(/id="[^"]*"/g, ''), /[Aa]vatar/);
  // Each picker is named by its own label, and a refusal is announced.
  assert.match(
    sheet,
    /id="new-agent-avatar-picker"\s+role="group"\s+aria-labelledby="new-agent-badge-label"/,
  );
  assert.match(sheet, /id="new-agent-error" role="alert" hidden/);

  const code = read('public/app-dialogs.js');
  // The project is the room whose + was pressed, and the sheet names it.
  assert.match(
    code,
    /el\.newAgentIntro\.textContent = `Starts another session in \$\{project\.name\}\.`/,
  );
  // Which runtime it starts in is said, since the sheet does not ask.
  assert.match(code, /el\.newAgentRuntime\.textContent = `It runs in \$\{NEW_SESSION_LABEL\}/);
  // The keyboard starts in the one field most people fill, and Ctrl+Enter sends it.
  assert.match(
    code,
    /el\.newAgentDialog\.showModal\(\);[\s\S]{0,120}el\.newAgentInstructions\.focus\(\);/,
  );
  assert.match(
    code,
    /e\.key === 'Enter' && \(e\.ctrlKey \|\| e\.metaKey\)[\s\S]{0,80}submitNewAgent\(\)/,
  );
  // A refusal stays in the sheet, with the server's own words, and the button comes back.
  assert.match(
    code,
    /el\.newAgentError\.textContent = err\.message;\s*el\.newAgentError\.hidden = false;/,
  );
  assert.match(code, /finally \{\s*el\.newAgentGo\.disabled = false;/);
});

test('the rename sheet is the same two choices under the same two names', () => {
  const sheet = dialog('identity-dialog');
  assert.match(sheet, /<h2 id="identity-title">Name and badge<\/h2>/);
  assert.ok(sheet.indexOf('identity-name-picker') < sheet.indexOf('identity-avatar-picker'));
  assert.match(sheet, />Name on the floor</);
  assert.match(sheet, />Chest badge</);
  assert.doesNotMatch(sheet.replace(/id="[^"]*"/g, ''), /[Aa]vatar/);
  assert.match(sheet, /id="identity-error" role="alert" hidden/);
  const code = read('public/app-dialogs.js');
  // Both sheets draw a badge with the floor's painter, for that agent's project.
  assert.match(code, /badgePicture\(project\.projectMk\)/);
  assert.match(code, /badgePicture\(agent\.projectMk\)/);
  // What is stored did not change: old state files and the routes are as they were.
  assert.match(code, /avatar: getNewAgentAvatar\(\) \|\| undefined,/);
  assert.match(code, /avatar: getIdentityAvatar\(\),/);
});
