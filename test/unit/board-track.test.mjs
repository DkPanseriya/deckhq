/**
 * The board's tracking strip and milestone header — WP-71, §7.
 *
 * The copy rules, asserted on the DOM `public/board-track.js` builds: a figure
 * the daemon marked `no data` is drawn as those words and never as a zero; a
 * test count is the handover's own sentence; a cost carries `list price` and
 * the rate card's date, and an unpriceable one prints no number.
 */
import '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NO_DATA,
  buildTrackStrip,
  compactCount,
  milestoneText,
  renderMilestones,
  trackLine,
  trackParts,
  trackSentence,
} from '../../public/board-track.js';
import { buildCard } from '../../public/board-view.js';

/** The smallest document these renderers use. */
function fakeDoc() {
  const make = (tag) => {
    const el = {
      tagName: tag.toUpperCase(),
      children: /** @type {any[]} */ ([]),
      attrs: /** @type {Record<string,string>} */ ({}),
      className: '',
      textContent: '',
      classList: { add: (c) => (el.className = `${el.className} ${c}`.trim()) },
      setAttribute: (k, v) => (el.attrs[k] = String(v)),
      getAttribute: (k) => el.attrs[k] ?? null,
      appendChild: (child) => (el.children.push(child), child),
      append: (...kids) => el.children.push(...kids),
    };
    return el;
  };
  return { createElement: make };
}

/** Every text in a tree, depth first. */
const texts = (el) => [el.textContent, ...(el.children || []).flatMap(texts)].filter(Boolean);

const NOTHING = { status: 'no data' };
const MEASURED = {
  cardId: 'c1',
  status: 'ok',
  tokens: { status: 'ok', total: 1365, scope: 'card' },
  time: { status: 'ok', ms: 1_800_000, minutes: 30, open: false },
  review: NOTHING,
  tests: { status: 'ok', quote: 'the handover says 43 passed', path: '/x/c1.md' },
  acceptance: { status: 'ok', ticked: 1, total: 2 },
};
const EMPTY = {
  cardId: 'c2',
  status: 'no data',
  tokens: NOTHING,
  time: NOTHING,
  review: NOTHING,
  tests: NOTHING,
  acceptance: NOTHING,
};

test('a measured card reads its figures, and its tests as the handover’s sentence', () => {
  assert.deepEqual(
    trackParts(MEASURED).map((p) => p.text),
    ['1,365 tok', '30 min', 'the handover says 43 passed'],
  );
  assert.equal(
    trackSentence(MEASURED),
    'Tokens: 1,365 tok. Time on the card: 30 min. Tests run: the handover says 43 passed.',
  );
});

// WP-96 moved this invariant's picture and kept its rule. It asserted three
// `no data`s, one per figure; the card now has ONE line, and a card with nothing
// measured says `no data` on it once. The rule it holds is unchanged and is
// still asserted: the words, never a digit, and dimmed as absence. What each
// figure lacks is still said, per figure, in the sentence the card is named by.
test('INVARIANT: a card with no data draws the words once, and no digit at all', () => {
  const strip = buildTrackStrip(EMPTY, fakeDoc());
  const all = texts(strip).join(' ');
  assert.equal(all, NO_DATA);
  assert.equal(/\d/.test(all), false);
  assert.match(strip.className, /is-no-data/);
  assert.equal(
    trackSentence(EMPTY),
    'Tokens: no data. Time on the card: no data. Tests run: no data.',
  );
});

test('WP-96: one tracking line per card, and `no data` at most once on it', () => {
  assert.equal(trackLine(MEASURED), '1.4k tok · 30 min · says 43 passed');
  assert.equal(
    trackLine({
      ...MEASURED,
      tokens: { status: 'ok', total: 400_000, scope: 'card' },
      time: { status: 'ok', minutes: 12, open: false },
    }),
    '400k tok · 12 min · says 43 passed',
  );
  // A card with some figures shows those, and does not pad the line with the
  // absent ones — they are in the tooltip's sentence, which says so.
  const partial = { ...EMPTY, tokens: { status: 'ok', total: 1_300_000, scope: 'session' } };
  assert.equal(trackLine(partial), '1.3M tok (session)');
  const strip = buildTrackStrip(partial, fakeDoc());
  assert.equal(strip.attrs.title, trackSentence(partial));
  assert.match(strip.attrs.title, /Time on the card: no data\./);
  for (const entry of [MEASURED, EMPTY, partial, { cardId: 'x' }, null]) {
    const line = texts(buildTrackStrip(entry, fakeDoc())).join(' ');
    assert.ok(line.split(NO_DATA).length - 1 <= 1, `"${line}" says no data more than once`);
  }
  assert.deepEqual(
    [850, 1365, 400_000, 999_499, 999_500, 1_300_000, 12_345_678].map(compactCount),
    ['850', '1.4k', '400k', '999k', '1M', '1.3M', '12M'],
  );
});

test('a cost carries list price and the dated rate card, and an unpriceable one no number', () => {
  const priced = trackParts({
    ...MEASURED,
    cost: { status: 'ok', usd: 0.011, rateCard: '2026-09-01', label: 'list price' },
  });
  assert.equal(priced[2].text, '$0.011 list price · rates 2026-09-01');
  const refused = trackParts({
    ...MEASURED,
    cost: { status: 'no rate', rateCard: '2026-09-01', label: 'list price' },
  });
  assert.equal(refused[2].text, 'no rate · rates 2026-09-01');
  assert.equal(/\$/.test(refused[2].text), false);
  // With showCost off the daemon sends no cost, and there is no part for one.
  assert.equal(
    trackParts(MEASURED).some((p) => p.kind === 'cost'),
    false,
  );
});

test('the milestone header is the burn-down, in words and as a bar', () => {
  const m = {
    milestone: 'm1',
    cards: 8,
    left: 6,
    burnDown: { status: 'ok', ticked: 4, criteria: 12, left: 6 },
    tokens: NOTHING,
  };
  assert.equal(
    milestoneText(m),
    'm1 · 4 of 12 criteria ticked · 6 of 8 cards left · tokens no data',
  );
  const header = renderMilestones([m], fakeDoc());
  assert.ok(header);
  const bar = header.children[0].children[0];
  assert.equal(bar.tagName, 'PROGRESS');
  assert.equal(bar.attrs.max, '12');
  assert.equal(bar.attrs.value, '4');
  assert.equal(renderMilestones([], fakeDoc()), null, 'no milestone, no header');
});

test('a card on the board wears its strip, and says it in its name', () => {
  const card = { id: 'c1', title: 'one', column: 'review', acceptance: [], flags: [] };
  const el = buildCard(card, { trackingFor: (id) => (id === 'c1' ? MEASURED : null) }, fakeDoc());
  assert.ok(el.children.some((c) => c.className === 'board-card-track'));
  assert.match(el.attrs['aria-label'], /Tests run: the handover says 43 passed\.$/);
  const bare = buildCard(card, {}, fakeDoc());
  assert.equal(
    bare.children.some((c) => c.className === 'board-card-track'),
    false,
  );
});
