/**
 * WP-14, the office snapshot.
 *
 * The claim that has to be nailed down is the redaction one: `Shift+S`
 * promises that no project name survives anywhere in the image, and half the
 * point of the feature is that people who cannot show their project names can
 * still post their floor. A redaction that leaves one name behind is worse
 * than no redaction at all, because the control said it was safe.
 *
 * So the assertion here is not "the strip has no names in it" — the strip
 * never had names in it. It is that the whole model, *including the snapshot
 * handed to the renderer to draw the room plates from*, contains none.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_PNG_BYTES,
  MIN_SCALE,
  STRIP,
  WORDMARK,
  compactTokens,
  CARD,
  composite,
  compositeCard,
  drawStrip,
  layoutCard,
  wrapText,
  formatMoney,
  formatWait,
  nextScaleDown,
  redactSnapshot,
  snapshotModel,
} from '../../public/snapshot.js';
import { snapshotFilename } from '../../src/http/routes/snapshot.mjs';

const HOUR = 3_600_000;
const NOW = new Date('2026-09-04T14:22:33').getTime();

/** Project names a person could not show, and would notice surviving. */
const SECRET = ['project-kestrel', 'acme-payments', 'skunkworks'];

function floor(now = NOW) {
  const agent = (i, project, projectMk, state, ack, waitH, cost, tokens) => ({
    id: `claude-code:${i}`,
    projectId: `p-${project}`,
    projectName: project,
    cwd: `C:/secret/${project}`,
    mk: `MK${projectMk}.${i}`,
    activityState: state,
    ackState: ack,
    reviewSince: state === 'for_review' && ack === 'active' ? now - waitH * HOUR : null,
    needsInputSince: state === 'needs_input' && ack === 'active' ? now - waitH * HOUR : null,
    lastActivityAt: now - waitH * HOUR,
    costEstimate: cost,
    tokens,
    cacheTokens: tokens * 2,
  });
  const agents = [
    agent(1, SECRET[0], 1, 'working', 'active', 0.5, 4.2, 300_000),
    agent(2, SECRET[0], 1, 'for_review', 'active', 26, 6.1, 400_000),
    agent(3, SECRET[1], 2, 'needs_input', 'active', 2, 3.3, 120_000),
    agent(4, SECRET[1], 2, 'for_review', 'active', 4, 1.4, 80_000),
    agent(5, SECRET[2], 3, 'ended', 'benched', 50, 9.9, 900_000),
    agent(6, SECRET[2], 3, 'ended', 'let_go', 70, 1.1, 50_000),
  ];
  return {
    agents,
    projects: SECRET.map((name, i) => ({
      id: `p-${name}`,
      name,
      cwd: `C:/secret/${name}`,
      projectMk: i + 1,
      mk: `MK${i + 1}`,
    })),
    counts: { working: 1, handsUp: 1, forReview: 2, benched: 1, needsYou: 3, letGo: 1 },
  };
}

// ---------------------------------------------------------------- redaction

test('redaction leaves no project name anywhere in the model the image is drawn from', () => {
  const model = snapshotModel(floor(), { hostname: 'samco-desk', now: NOW, redact: true });
  const everything = JSON.stringify(model);
  for (const name of SECRET) {
    assert.ok(
      !everything.includes(name),
      `"${name}" survived redaction — it is still somewhere in the snapshot model, ` +
        'which is what the room plates and the strip are both drawn from',
    );
  }
  // And the strip's own text specifically, which is the half this package owns.
  const strip = [model.headline, model.money, ...model.tallies.map((t) => t.text)].join(' ');
  for (const name of SECRET) assert.ok(!strip.includes(name));
});

test('redaction puts the MK tag in the name slot, so the plates still say something', () => {
  const redacted = redactSnapshot(floor());
  assert.deepEqual(
    redacted.projects.map((p) => p.name),
    ['MK1', 'MK2', 'MK3'],
  );
  assert.deepEqual(
    redacted.agents.map((a) => a.projectName),
    ['MK1', 'MK1', 'MK2', 'MK2', 'MK3', 'MK3'],
  );
  assert.equal(redacted.redacted, true);
});

test('redaction takes the working directory and the project id, not just the name', () => {
  // Neither is drawn on the floor today. The cwd is the one field carrying a
  // directory tree; the project id is a slug of it, so it spells the name out
  // verbatim. A redaction that relies on nobody ever drawing a field is a
  // redaction with a fuse in it.
  const redacted = redactSnapshot(floor());
  for (const a of redacted.agents) assert.equal(a.cwd, '');
  for (const p of redacted.projects) assert.equal(p.cwd, '');
  assert.deepEqual(
    redacted.projects.map((p) => p.id),
    ['mk-1', 'mk-2', 'mk-3'],
  );
  // The agents still point at their rooms, or the floor would draw empty ones.
  assert.deepEqual([...new Set(redacted.agents.map((a) => a.projectId))], ['mk-1', 'mk-2', 'mk-3']);
});

test('redaction does not mutate the snapshot it was given', () => {
  // The live snapshot is handed back to the renderer immediately afterwards.
  // If redaction were in-place, the floor would stay redacted for good.
  const original = floor();
  const before = JSON.stringify(original);
  redactSnapshot(original);
  assert.equal(JSON.stringify(original), before, 'redactSnapshot mutated its input');
});

test('an unredacted snapshot keeps the names, which is the default', () => {
  const model = snapshotModel(floor(), { hostname: 'samco-desk', now: NOW });
  assert.equal(model.redacted, false);
  assert.equal(model.source.projects[0].name, SECRET[0]);
});

// ------------------------------------------------------------- the strip

test('the strip says what §3.2 says it says', () => {
  const model = snapshotModel(floor(), { hostname: 'samco-desk', now: NOW });
  // The office is named after the machine, uppercased: people share things
  // with their name on them.
  assert.equal(model.headline, 'SAMCO-DESK · 3 rooms · 5 people');
  assert.deepEqual(
    model.tallies.map((t) => t.text),
    ['1 working', '1 hands up', '2 in your office', '1 benched'],
  );
  assert.equal(model.wordmark, WORDMARK);
  // "people" excludes let-go: they are off the floor.
  assert.ok(!model.headline.includes('6 people'));
});

test('the money line is labelled an estimate, and carries the longest wait', () => {
  const model = snapshotModel(floor(), { hostname: 'x', now: NOW });
  // Standing rule 7: cost is an estimate, never a bill. The word is in the
  // line itself, not in a tooltip nobody screenshots.
  assert.match(model.money, /estimate/);
  assert.match(model.money, /^today ≈ \$/);
  assert.match(model.money, /longest wait 1d 2h/);
  assert.doesNotMatch(model.money, /bill|charged|owe/i);
});

test('an empty floor says "nobody waiting" rather than a wait of zero', () => {
  const model = snapshotModel({ agents: [], projects: [], counts: {} }, { now: NOW });
  assert.match(model.money, /nobody waiting/);
  assert.equal(model.headline, 'THIS MACHINE · 0 rooms · 0 people');
});

test('only today counts towards today', () => {
  const now = NOW;
  const snap = {
    agents: [
      { ackState: 'active', lastActivityAt: now - 60_000, costEstimate: 2, tokens: 1000 },
      // Yesterday's session: on the floor, but not part of today's spend.
      { ackState: 'active', lastActivityAt: now - 40 * HOUR, costEstimate: 500, tokens: 9_000_000 },
    ],
    projects: [],
    counts: {},
  };
  const model = snapshotModel(snap, { now });
  assert.match(model.money, /\$2\.00/);
  assert.doesNotMatch(model.money, /502|500/);
});

// ---------------------------------------------------------- the formatters

test('waits read the way a person says them', () => {
  assert.equal(formatWait(0), 'just now');
  assert.equal(formatWait(30_000), 'just now');
  assert.equal(formatWait(12 * 60_000), '12m');
  assert.equal(formatWait(4 * HOUR), '4h');
  assert.equal(formatWait(4 * HOUR + 10 * 60_000), '4h 10m');
  assert.equal(formatWait(26 * HOUR), '1d 2h');
  assert.equal(formatWait(48 * HOUR), '2d');
  assert.equal(formatWait(-5), 'just now');
});

test('tokens and money are compact, and never lie about precision', () => {
  assert.equal(compactTokens(860), '860');
  assert.equal(compactTokens(241_000), '241k');
  assert.equal(compactTokens(2_400_000), '2.4M');
  assert.equal(formatMoney(18.4), '$18.40');
  assert.equal(formatMoney(0), '$0.00');
  // Nobody reads cents on four figures.
  assert.equal(formatMoney(1240.4), '$1,240');
});

// ------------------------------------------------------------- the output

test('the resolution floor wins over the size budget', () => {
  // §3.2 asks for both "≥ 2× DPR" and "under 2 MB". On a large enough floor
  // they disagree, and the rule is that a blurry picture of an office is not
  // worth shipping to save a few hundred kilobytes.
  assert.equal(MIN_SCALE, 2);
  assert.equal(nextScaleDown(3), 2.4);
  assert.equal(nextScaleDown(2.4), 2);
  assert.equal(nextScaleDown(2), null, 'the step-down went below the resolution floor');
  assert.equal(MAX_PNG_BYTES, 2 * 1024 * 1024);
});

test('the composite is the floor at scale with the strip under it', () => {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'measureText') return (t) => ({ width: String(t).length * 6 });
        if (prop === 'canvas') return undefined;
        return (...args) => calls.push([String(prop), ...args]);
      },
      set() {
        return true;
      },
    },
  );
  const made = [];
  const out = composite({
    floor: { clientWidth: 1200, clientHeight: 700, width: 2400, height: 1400 },
    dpr: 2,
    model: snapshotModel(floor(), { hostname: 'samco-desk', now: NOW }),
    scale: 2,
    colors: { bg: '#000', surface: '#111', line: '#222', ink: '#fff', ink2: '#eee', muted: '#999' },
    makeCanvas: (w, h) => {
      made.push([w, h]);
      return { width: w, height: h, getContext: () => ctx };
    },
  });

  // 1200x700 CSS at 2x, plus the strip.
  assert.deepEqual(made, [[2400, (700 + STRIP.height) * 2]]);
  assert.equal(out.width, 2400);
  const drawn = calls.find((c) => c[0] === 'drawImage');
  assert.ok(drawn, 'the floor was never drawn into the composite');
  assert.deepEqual(drawn.slice(2), [0, 0, 2400, 1400]);
  // And the strip's text went in, headline first.
  const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.ok(texts.includes('SAMCO-DESK · 3 rooms · 5 people'));
  assert.ok(texts.includes(WORDMARK));
});

/** A context that records nothing and throws at nothing. */
function nullCanvas(made) {
  return (w, h) => {
    made.push([w, h]);
    const ctx = {
      fillRect() {},
      drawImage() {},
      save() {},
      restore() {},
      translate() {},
      scale() {},
      beginPath() {},
      arc() {},
      fill() {},
      fillText() {},
      measureText: () => ({ width: 10 }),
    };
    return { width: w, height: h, getContext: () => ctx };
  };
}

const emptyModel = () => snapshotModel({ agents: [], projects: [], counts: {} }, { now: NOW });

test('a scale below the floor is raised rather than honoured', () => {
  const made = [];
  composite({
    floor: { clientWidth: 100, clientHeight: 100, width: 100, height: 100 },
    dpr: 1,
    model: emptyModel(),
    scale: 1,
    colors: {},
    makeCanvas: nullCanvas(made),
  });
  assert.equal(made[0][0], 200, 'a 1x request produced a 1x image');
});

test('a backgrounded tab, which reports no layout at all, still sizes the image right', () => {
  // Measured in Chrome with the tab hidden: clientWidth, innerWidth and
  // getBoundingClientRect().width are all 0, while clientHeight holds a stale
  // value. §3.2's acceptance is explicitly "works with the tab backgrounded",
  // and the first version of this compositor produced a 6400x672 sliver here.
  const made = [];
  composite({
    floor: { clientWidth: 0, clientHeight: 240, width: 3200, height: 480 },
    dpr: 2,
    model: emptyModel(),
    scale: 2,
    colors: {},
    makeCanvas: nullCanvas(made),
  });
  // 3200/2 = 1600 CSS px wide, 480/2 = 240 tall, both at 2x, plus the strip.
  assert.deepEqual(made, [[3200, (240 + STRIP.height) * 2]]);
});

test('a floor with no backing store at all falls back to layout rather than dividing by nothing', () => {
  const made = [];
  composite({
    floor: { clientWidth: 800, clientHeight: 600, width: 0, height: 0 },
    dpr: 2,
    model: emptyModel(),
    scale: 2,
    colors: {},
    makeCanvas: nullCanvas(made),
  });
  assert.deepEqual(made, [[1600, (600 + STRIP.height) * 2]]);
});

test('drawStrip never touches the DOM and needs nothing but a 2d context', () => {
  const seen = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'measureText') return () => ({ width: 40 });
        return (...a) => seen.push(String(prop) + ':' + a.join(','));
      },
      set() {
        return true;
      },
    },
  );
  drawStrip(ctx, snapshotModel(floor(), { hostname: 'h', now: NOW, redact: true }), {
    width: 900,
    colors: {},
  });
  const text = seen.filter((s) => s.startsWith('fillText:')).join(' ');
  for (const name of SECRET) assert.ok(!text.includes(name));
  // Every line the strip draws is one of the four the model names, so a new
  // one cannot appear here without appearing in `snapshotModel` first.
  assert.equal(seen.filter((s) => s.startsWith('fillText:')).length, 7);
});

// ------------------------------------------------------------ the filename

test('the daemon names the file from its own clock, in local time', () => {
  assert.equal(
    snapshotFilename(new Date('2026-09-04T14:22:33')),
    'deckhq-20260904-142233.png',
    'the snapshot filename changed shape; it is what a person sorts a folder by',
  );
  // Seconds are in it because `S` is one keystroke and two in a minute is normal.
  assert.notEqual(
    snapshotFilename(new Date('2026-09-04T14:22:33')),
    snapshotFilename(new Date('2026-09-04T14:22:34')),
  );
  assert.match(snapshotFilename(new Date('2026-01-02T03:04:05')), /^deckhq-20260102-030405\.png$/);
});

// ---------------------------------------------------- WP-18 / WP-27 · the card

/**
 * The card image goes through the same compositor, the same size budget and
 * the same resampling rule as the floor snapshot — deliberately, because
 * §3.2's acceptance was measured against those and a second implementation
 * would have to be measured again. What differs is the shape: the floor is a
 * band at the top rather than the picture, and the words are the subject.
 */
const CARD_MODEL = {
  title: 'Tuesday.',
  subtitle: '1 Sep – 8 Sep',
  rows: [
    { label: null, value: '14 turns across 4 rooms.' },
    { label: 'Longest wait', value: 'Longest wait today: 1d 2h → cleared.' },
  ],
  footer: 'Generated on this machine, from this machine. Nothing left it.',
};

test('the card wraps its own text, and never breaks a word to do it', () => {
  const ctx = { measureText: (t) => ({ width: String(t).length * 10 }) };
  assert.deepEqual(wrapText(ctx, 'one two three four', 100), ['one two', 'three four']);
  assert.deepEqual(wrapText(ctx, '', 100), []);
  // A word wider than the box is left long: a truncated project name is worse
  // than a line that overhangs.
  assert.deepEqual(wrapText(ctx, 'supercalifragilistic', 50), ['supercalifragilistic']);
});

test('the card is measured before it is drawn, and its height follows its copy', () => {
  const ctx = { measureText: (t) => ({ width: String(t).length * 8 }), font: '' };
  const opts = { fontSans: 'x', fontMono: 'y', thumb: false };
  const short = layoutCard(ctx, { title: 'Tuesday.', rows: [] }, opts);
  const long = layoutCard(ctx, CARD_MODEL, opts);
  assert.equal(short.width, CARD.width);
  assert.ok(long.height > short.height, 'more copy did not make a taller card');
  // The thumbnail band is added to the height, not overlaid on the text.
  const withThumb = layoutCard(ctx, CARD_MODEL, { ...opts, thumb: true });
  assert.equal(withThumb.height - long.height, CARD.thumbHeight);
});

test('the card composite draws the floor as a band and the words under it', () => {
  const calls = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'measureText') return (t) => ({ width: String(t).length * 6 });
        return (...args) => calls.push([String(prop), ...args]);
      },
      set() {
        return true;
      },
    },
  );
  const made = [];
  const out = compositeCard({
    floor: { width: 2400, height: 1400 },
    dpr: 2,
    model: CARD_MODEL,
    scale: 2,
    colors: { bg: '#000', surface: '#111', line: '#222', ink: '#fff', ink2: '#eee', muted: '#999' },
    makeCanvas: (w, h) => {
      made.push([w, h]);
      return { width: w, height: h, getContext: () => ctx };
    },
  });
  // A 1x1 scratch canvas to measure with, then the real one at CARD.width x 2.
  assert.deepEqual(made[0], [1, 1]);
  assert.equal(out.width, CARD.width * 2);
  const drawn = calls.find((c) => c[0] === 'drawImage');
  assert.ok(drawn, 'the floor was never drawn into the card');
  const texts = calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
  assert.ok(texts.includes('Tuesday.'));
  assert.ok(texts.includes('Longest wait'), 'a labelled row lost its label');
  assert.ok(texts.includes(WORDMARK), 'the card lost the wordmark');
});

test('a card with no floor to photograph is still a card', () => {
  // `S` from a tab whose canvas is hidden — the empty machine, or a renderer
  // that failed to load. The words are the point; the picture is evidence.
  const made = [];
  const out = compositeCard({
    floor: null,
    model: CARD_MODEL,
    scale: 2,
    colors: {},
    makeCanvas: nullCanvas(made),
  });
  assert.equal(out.width, CARD.width * 2);
  assert.ok(out.height > 0);
});

test('the card honours the same resolution floor as the office snapshot', () => {
  const made = [];
  compositeCard({
    floor: null,
    model: CARD_MODEL,
    scale: 1,
    colors: {},
    makeCanvas: nullCanvas(made),
  });
  // made[0] is the 1x1 scratch canvas; made[1] is the image.
  assert.equal(made[1][0], CARD.width * MIN_SCALE, 'a 1x request produced a 1x card');
});
