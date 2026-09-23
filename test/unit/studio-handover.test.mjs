/**
 * The handover, parsed and quoted — WP-70, `docs/07-STUDIO-DESIGN.md` §6, §7.
 *
 * Everything here is pure. The watch, the flag on a real board and the two
 * presses are `test/integration/studio-handover.test.mjs`; this file holds the
 * three rules that have to be true before any of that is worth having:
 *
 *   1. **A missing section is reported and never invented.** The file is
 *      written by a language model, so a parser that demanded an exact
 *      heading would report nothing the day it wrote `## What Changed:` —
 *      and one that filled a gap in would be inventing the most dangerous
 *      field in this product.
 *   2. **A test count is a QUOTATION.** §7: *"Tests run: quoted verbatim from
 *      the handover"*. The copy test at the bottom is the one WP-70's
 *      acceptance criterion (4) names.
 *   3. **A handover flags a card and never moves it.** The static gate proves
 *      no code path writes a column; this proves the one that writes a flag
 *      leaves everything else where it was, including on a second pass.
 */
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BOUNCE_SUFFIX,
  SECTIONS,
  cardIdForName,
  handoverFlag,
  handoverInstruction,
  parseHandover,
  testsQuote,
} from '../../src/studio/handover.mjs';
import { ACCEPT_COLUMNS, flagHandover } from '../../src/http/routes/studio-handover.mjs';
import { handoverForSession, handoverState } from '../../public/panel-handover.js';

const WHOLE = [
  '# Handover for c7',
  '',
  '## What changed',
  '',
  'Added the watcher and the two presses.',
  '',
  '## Tests run',
  '',
  '- npm test — 43 passed, 0 failed',
  '',
  '## Open questions',
  '',
  'Should a bounce message the session?',
  '',
  '## Next step',
  '',
  'Wire the golden.',
  '',
].join('\n');

// ---------------------------------------------------------------- the parse

test('the four sections are found, in whatever shape they were written', () => {
  const whole = parseHandover(WHOLE);
  assert.deepEqual(whole.missing, []);
  assert.match(whole.sections.changed, /Added the watcher/);
  assert.match(whole.sections.tests, /43 passed/);
  assert.match(whole.sections.questions, /bounce message/);
  assert.equal(whole.sections.next, 'Wire the golden.');

  // The tolerant half: a different heading level, a number in front, a colon
  // after, different capitals, extra words. Every one of these is an agent
  // that did what it was asked, and a reader that refused them would report
  // four missing sections over a file that has all four.
  const loose = parseHandover(
    [
      '### 1. What Changed:',
      'one line',
      '#### 2) Tests run (real counts)',
      '12 passing',
      '## 3 — Open Questions?',
      'none',
      '###### next steps',
      'ship it',
    ].join('\n'),
  );
  assert.deepEqual(loose.missing, []);
  assert.equal(loose.sections.changed, 'one line');
  assert.equal(loose.sections.tests, '12 passing');
  assert.equal(loose.sections.next, 'ship it');
});

test('a missing section is REPORTED and never invented', () => {
  const parsed = parseHandover(
    ['## What changed', 'a thing', '## Next step', 'another'].join('\n'),
  );
  assert.deepEqual(parsed.missing, ['Tests run', 'Open questions']);
  assert.equal(parsed.sections.tests, null, 'a missing section is null, never a guess');
  assert.equal(parsed.sections.questions, null);
  // And the one the four sections exist for: there is no count to quote, so
  // there is no sentence.
  assert.equal(testsQuote(parsed.sections), null);
});

test('an empty section and an absent one are different answers', () => {
  const parsed = parseHandover(['## Tests run', '', '## Next step', 'x'].join('\n'));
  assert.equal(parsed.sections.tests, '', 'the heading is there and nothing is under it');
  assert.equal(parsed.sections.changed, null, 'this heading is not in the file at all');
  assert.deepEqual(parsed.missing, ['What changed', 'Open questions']);
  assert.equal(testsQuote(parsed.sections), null, 'an empty section quotes nothing');
});

test('a file with no headings at all loses nothing and claims nothing', () => {
  const parsed = parseHandover('I finished the card. Everything passed.');
  assert.deepEqual(
    parsed.missing,
    SECTIONS.map((s) => s.label),
    'all four are missing, and the user is told all four',
  );
  assert.equal(parsed.preamble, 'I finished the card. Everything passed.');
  assert.equal(testsQuote(parsed.sections), null, '"everything passed" is not a count');
});

test('an empty file, a null and a number are each parsed rather than thrown at', () => {
  for (const input of ['', null, undefined, 12]) {
    const parsed = parseHandover(/** @type {any} */ (input));
    assert.equal(parsed.missing.length, 4);
  }
});

// ------------------------------------------------------------- the filename

test('the filename is the card id, and a bounce note is not a handover', () => {
  assert.equal(cardIdForName('c7.md'), 'c7');
  assert.equal(cardIdForName('notes.md'), 'notes', 'a name no card has is still a card id');
  assert.equal(cardIdForName(`c7${BOUNCE_SUFFIX}`), null, 'our own note is not a handover');
  assert.equal(cardIdForName('c7.txt'), null);
  assert.equal(cardIdForName('sub/c7.md'), null);
  assert.equal(cardIdForName('..\\c7.md'), null);
  assert.equal(cardIdForName('.md'), null);
  assert.equal(cardIdForName(''), null);
});

// ------------------------------------------------- THE COPY TEST (§7, §6)

test('COPY: a test count is a quotation attributed to the handover, never a DeckHQ figure', () => {
  // §10's acceptance criterion (4), and §7's table row, word for word:
  //   Tests run | Quoted verbatim from the handover: "the handover says 43 passed"
  assert.equal(testsQuote({ tests: '43 passed' }), 'the handover says 43 passed');

  // The attribution comes FIRST, before any digit, in every answer this can
  // give. A sentence that began with the number would be DeckHQ saying it.
  for (const body of ['43 passed', '- npm test — 2044 tests, 2043 passing', 'ran 3 suites']) {
    const quote = testsQuote({ tests: body });
    assert.ok(quote.startsWith('the handover says '), quote);
    assert.ok(
      quote.indexOf('the handover says') < quote.search(/\d/),
      `"${quote}" puts a number before it says whose number it is`,
    );
  }

  // The agent's words, not a value re-formatted: the line is carried whole,
  // with its own units and its own punctuation.
  assert.equal(
    testsQuote({ tests: '- npm test — 2044 tests, 2043 passing, 1 skipped' }),
    'the handover says npm test — 2044 tests, 2043 passing, 1 skipped',
  );

  // And there is no path from a handover to a bare figure. Nothing this
  // module exports produces a count without the attribution in front of it.
  const src = ['ran the suite', '', '7 failed'].join('\n');
  const quote = testsQuote({ tests: src });
  assert.equal(quote, 'the handover says 7 failed');
  assert.ok(!/^\d/.test(quote));
});

test('COPY: the state line names the missing sections rather than only their number', () => {
  assert.equal(handoverState({ missing: [] }), 'waiting on you — all four sections are here.');
  assert.equal(
    handoverState({ missing: ['Tests run'] }),
    'waiting on you — one section is missing: Tests run.',
  );
  assert.equal(
    handoverState({ missing: ['Tests run', 'Next step'] }),
    'waiting on you — 2 sections are missing: Tests run, Next step.',
  );
});

test('the instruction the brief carries names the file, the four headings and the rule', () => {
  const text = handoverInstruction('/tmp/p/.deckhq/studio/handovers');
  for (const section of SECTIONS) assert.ok(text.includes(section.label), section.label);
  assert.match(text, /<cardId>\.md/);
  // The two things an agent must not be left to assume.
  assert.match(text, /quotes that line back to the user|QUOTES that line back/i);
  assert.match(text, /does NOT move the card/);
});

// ---------------------------------------------------------------- the flag

test('a handover FLAGS its card and moves nothing (§5.2)', () => {
  const board = {
    cards: [
      { id: 'c1', column: 'in_progress', flags: [], handover: null, title: 'one' },
      { id: 'c2', column: 'backlog', flags: [], handover: null, title: 'two' },
    ],
  };
  const before = board.cards.map((c) => `${c.id}:${c.column}`).join('|');

  const first = flagHandover(board, 'c1', { path: '/p/c1.md', at: 1700, name: 'c1.md' });
  assert.equal(first.flagged, true);
  assert.deepEqual(board.cards[0].flags, [{ kind: 'handover', at: 1700, path: '/p/c1.md' }]);
  assert.equal(board.cards[0].handover, 'c1.md');
  assert.equal(
    board.cards.map((c) => `${c.id}:${c.column}`).join('|'),
    before,
    'not one column moved',
  );

  // Idempotent: the watch reports every file on its first tick, so a daemon
  // restarted twice must not leave three identical flags behind.
  const again = flagHandover(board, 'c1', { path: '/p/c1.md', at: 1700, name: 'c1.md' });
  assert.equal(again.flagged, false);
  assert.equal(board.cards[0].flags.length, 1);

  // A REWRITTEN handover is a second handover, and is a second flag.
  flagHandover(board, 'c1', { path: '/p/c1.md', at: 1800, name: 'c1.md' });
  assert.equal(board.cards[0].flags.length, 2);

  // And a card nobody has is not invented.
  const unknown = flagHandover(board, 'nope', { path: '/p/nope.md', at: 1, name: 'nope.md' });
  assert.deepEqual(unknown, { flagged: false, card: null });
  assert.equal(board.cards.length, 2);
  assert.equal(board.cards.map((c) => `${c.id}:${c.column}`).join('|'), before);
});

test('the flag is exactly the three fields §6 names, and carries no column', () => {
  const flag = handoverFlag('/p/c1.md', 1700);
  assert.deepEqual(Object.keys(flag).sort(), ['at', 'kind', 'path']);
  assert.equal(flag.kind, 'handover');
  assert.equal(JSON.stringify(flag).includes('column'), false);
});

test('Accept reaches two columns, and `blocked` is not one of them', () => {
  assert.deepEqual([...ACCEPT_COLUMNS], ['review', 'done']);
  assert.equal(ACCEPT_COLUMNS.includes(/** @type {any} */ ('blocked')), false);
});

// ------------------------------------------------- the panel's own join

test('the panel draws a handover on the session whose CARD names it, and never an unattached one', () => {
  const body = {
    enabled: true,
    project: '/p',
    studio: {
      board: {
        board: {
          cards: [
            { id: 'c1', agentId: 'claude-code:aaa', column: 'in_progress' },
            { id: 'c2', agentId: null, column: 'ready' },
          ],
        },
      },
    },
    handovers: [
      { cardId: 'c1', path: '/p/c1.md', sections: {}, missing: [], quote: null, mtime: 5 },
      { cardId: 'c1', path: '/p/c1.md', sections: {}, missing: [], quote: null, mtime: 9 },
      { cardId: null, path: '/p/typo.md', sections: {}, missing: [], quote: null, mtime: 99 },
    ],
  };
  const found = handoverForSession(body, 'claude-code:aaa');
  assert.equal(found.card.id, 'c1');
  assert.equal(found.handover.mtime, 9, 'the newest handover for that card');

  // The unattached one belongs to no session, and drawing it on one would be
  // attaching it (§6, acceptance (3)).
  assert.equal(handoverForSession(body, 'claude-code:bbb'), null);
  assert.equal(handoverForSession(body, null), null);
  assert.equal(handoverForSession({ enabled: true, handovers: [] }, 'claude-code:aaa'), null);
});
