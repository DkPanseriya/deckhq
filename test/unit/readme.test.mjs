/**
 * The README, which is the npm page and the GitHub front page — WP-94a.
 *
 * The owner's ask was one sentence: *"Keep the README not bloated, easy to
 * understand, scannable."* A line budget is the only part of that a machine can
 * hold, so it holds it: everything the README used to carry is in
 * `docs/GUIDE.md`, and this test is what stops it coming back one paragraph at
 * a time.
 *
 * The install commands are checked against `site/build.mjs`'s own array rather
 * than against strings written here, so the README, the site's pages and this
 * test all fail together if the line a stranger pastes ever changes.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { INSTALL_COMMANDS } from '../../site/build.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8').replace(/\r\n/g, '\n');

/**
 * The budget. It is a ceiling rather than a target: the README was 911 lines
 * when this was written, and the number that matters is that a reader reaches
 * "what it never does" without scrolling past a manual.
 */
const MAX_LINES = 250;

test('the README stays scannable', () => {
  const lines = readme.split('\n').length;
  assert.ok(
    lines <= MAX_LINES,
    `README.md is ${lines} lines; the budget is ${MAX_LINES}. ` +
      'Anything longer belongs in docs/GUIDE.md with a link from here.',
  );
});

test('the README prints the install commands exactly as the site does', () => {
  for (const command of INSTALL_COMMANDS) {
    assert.ok(readme.includes(command), `README.md does not carry \`${command}\` verbatim`);
  }
});

test('the README carries the honesty rule, in the words the rule is written in', () => {
  // `docs/ADAPTERS.md` §6 point 3: say it in the README, in a sentence a user
  // will understand. Deleting the warning is allowed — in the same commit as
  // the run that earns it — and quietly softening it is not.
  //
  // Soft wrapping and the `**` around the load-bearing half are the formatter's
  // business, so both are taken out before the sentences are looked for.
  const prose = readme.replace(/\*\*/g, '').replace(/\s+/g, ' ');
  assert.match(prose, /Gemini CLI and OpenCode support is unverified/);
  assert.match(prose, /neither has ever run against real data/);
  assert.match(prose, /Codex is verified for reading and replying, and nothing else/);
});

test('every relative link and image in the README resolves to a file in the tree', () => {
  for (const m of readme.matchAll(/!?\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|#)/i.test(href)) continue;
    const target = path.resolve(root, href.split('#')[0]);
    assert.ok(fs.existsSync(target), `README.md points at ${href}, which is not in the tree`);
  }
  for (const m of readme.matchAll(/<img[^>]*\ssrc="([^"]+)"/g)) {
    const src = m[1];
    if (/^https?:/i.test(src)) continue;
    assert.ok(fs.existsSync(path.resolve(root, src)), `README.md shows ${src}, which is missing`);
  }
});

test('nothing the README cut was thrown away', () => {
  // `docs/GUIDE.md` is where the manual went. These are the headings that were
  // moved out, and a commit that drops one of them from the guide without
  // putting it back in the README loses documentation silently.
  const guide = fs.readFileSync(path.join(root, 'docs', 'GUIDE.md'), 'utf8');
  for (const heading of [
    '## The one rule',
    '## The six states',
    '## More on `deckhq doctor`',
    '## The deck, in your terminal',
    '## `deckhq stats`',
    '## `deckhq statusline`',
    '## Install as a Claude Code plugin',
    '## What it reads from your disk',
    '## What it writes',
    '## Studio',
    '## Hooks are optional and reversible',
    '## Privacy',
    '## Keyboard',
    '## Options',
    '## Per-project actions',
  ]) {
    assert.ok(guide.includes(heading), `docs/GUIDE.md no longer carries "${heading}"`);
  }
  assert.ok(readme.includes('docs/GUIDE.md'), 'the README does not link to the guide');
});

test('every image in the README and the guide says which class it is', () => {
  // `docs/MEDIA.md`: capture, golden render, or design illustration. A picture
  // that does not say which is a claim nobody checked.
  const guide = fs.readFileSync(path.join(root, 'docs', 'GUIDE.md'), 'utf8');
  const classes = /golden render|capture|design illustration/i;
  for (const [name, text] of [
    ['README.md', readme],
    ['docs/GUIDE.md', guide],
  ]) {
    const images = [...text.matchAll(/^!\[[^\]]*\]\(([^)\s]+)\)$/gm)];
    assert.ok(images.length > 0, `${name} shows no images at all`);
    for (const image of images) {
      const after = text.slice(image.index + image[0].length, image.index + image[0].length + 400);
      assert.match(
        after.split('\n\n')[1] ?? '',
        classes,
        `${name} shows ${image[1]} without saying whether it is a capture, a golden or a mockup`,
      );
    }
  }
});
