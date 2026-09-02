/**
 * The contract between the model's states and what appears on the floor.
 *
 * docs/03-VISUAL-SPEC.md §5 is the table this guards. It is worth its own
 * suite because a state that falls through to a default here does not throw —
 * it silently shows the user the wrong thing, which is the one failure mode
 * this product cannot afford.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STATE_COLORS } from '../../public/render/palette.js';
import { CLIPS, clipForState } from '../../public/render/clips.js';
import { ACTIVITY_STATES, ACK_STATES } from '../../src/core/model.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STYLESHEET = path.join(HERE, '..', '..', 'public', 'style.css');

test('every ActivityState and AckState has its own colour', () => {
  for (const state of [...ACTIVITY_STATES, ...ACK_STATES]) {
    if (state === 'active') continue; // `active` is rendered by its activityState
    assert.ok(
      STATE_COLORS[state],
      `${state} has no colour, so it would inherit another state's meaning`,
    );
  }
});

test('the spec colours are exact', () => {
  // docs/03-VISUAL-SPEC.md §5, verbatim.
  assert.equal(STATE_COLORS.working, '#2E7D63');
  assert.equal(STATE_COLORS.needs_input, '#B87333');
  assert.equal(STATE_COLORS.stalled, '#9A7B4F');
  assert.equal(STATE_COLORS.for_review, '#C0392B');
  assert.equal(STATE_COLORS.benched, '#7B8794');
  assert.equal(STATE_COLORS.let_go, '#BDB7AA');
});

test('COLOUR DISCIPLINE: crimson belongs to for_review alone', () => {
  const crimson = STATE_COLORS.for_review.toLowerCase();
  for (const [state, colour] of Object.entries(STATE_COLORS)) {
    if (state === 'for_review') continue;
    assert.notEqual(
      colour.toLowerCase(),
      crimson,
      `${state} reuses the reserved accent; red on the floor must mean "in your office"`,
    );
  }
});

test('every state colour is distinguishable from every other', () => {
  // Colour-blind users rely on the icon, but a duplicate colour would also
  // make two states indistinguishable for everyone at L0.
  const seen = new Map();
  for (const [state, colour] of Object.entries(STATE_COLORS)) {
    const key = colour.toLowerCase();
    assert.ok(!seen.has(key), `${state} and ${seen.get(key)} share ${colour}`);
    seen.set(key, state);
  }
});

test('an ended session must not appear to be typing', () => {
  // `ended` sits at its project desk (only an explicit bench moves it), so it
  // is on screen and needs a still pose. Playing `type` would tell the user a
  // dead session is producing output.
  const clip = clipForState('ended');
  assert.ok(clip, 'ended has no clip');
  assert.notEqual(clip, 'type');
  assert.ok(CLIPS[clip], `ended maps to "${clip}", which is not a real clip`);
  assert.notEqual(
    STATE_COLORS.ended,
    STATE_COLORS.working,
    'ended must not wear the working colour',
  );
});

test('clipForState covers every activity state with a real clip', () => {
  for (const state of ACTIVITY_STATES) {
    const clip = clipForState(state);
    assert.ok(clip, `${state} has no clip`);
    assert.ok(CLIPS[clip], `${state} maps to "${clip}", which is not a real clip`);
  }
  assert.ok(CLIPS[clipForState('benched')]);
  assert.equal(clipForState('let_go'), null, 'a let-go agent is off the floor and draws nothing');
});

test('the attention states map to their spec clips', () => {
  assert.equal(clipForState('working'), 'type');
  assert.equal(clipForState('needs_input'), 'hand_raise');
  assert.equal(clipForState('stalled'), 'slump');
  assert.equal(clipForState('for_review'), 'stand_wait');
});

// ---------------------------------------------------------------------------
// CONTRAST. docs/03-VISUAL-SPEC.md §10, and docs/DEVIATIONS.md §69-71 for what
// the WP-06 repalette moved and why.
//
// The chrome neutrals moved from a warm ~355deg tint to a cold ~230deg one so
// the warm floor would read as lit rather than as one more brown rectangle.
// That is a change to the ground under every state colour and every piece of
// text, so it has to be measured rather than eyeballed. These tests recompute
// WCAG 2.x relative luminance from the literal hex values in public/style.css.
//
// The binding rule when something fails: **the ground moves, not the state
// colour.** The state colours are a contract with palette.js and the floor's
// baked materials; the neutrals are ours to push around.
//
// No dependency: the whole formula is eleven lines.
// ---------------------------------------------------------------------------

/**
 * WCAG 2.x relative luminance of an sRGB hex colour.
 * https://www.w3.org/TR/WCAG22/#dfn-relative-luminance
 * @param {string} hex `#rrggbb`
 * @returns {number} 0 (black) to 1 (white)
 */
function relativeLuminance(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  assert.ok(m, `${hex} is not a #rrggbb colour`);
  const channels = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * WCAG contrast ratio between two opaque colours, 1:1 to 21:1.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Read the `--token: #hex` custom properties out of style.css's `:root`. */
function readTokens() {
  const css = fs.readFileSync(STYLESHEET, 'utf8');
  const root = /:root\s*\{([\s\S]*?)\n\}/.exec(css);
  assert.ok(root, 'could not find the :root block in public/style.css');
  /** @type {Record<string,string>} */
  const tokens = {};
  for (const [, name, value] of root[1].matchAll(/--([\w-]+)\s*:\s*(#[0-9a-f]{6})\s*;/gi)) {
    tokens[name] = value.toLowerCase();
  }
  return tokens;
}

/**
 * Split the stylesheet into `{ selector, body }` rules. The stylesheet is
 * hand-written and flat apart from a handful of media queries, so a split on
 * braces is enough — and being approximate is safe here, because every test
 * below uses it to *find more* things to check, never to excuse one.
 */
function readRules() {
  const css = fs.readFileSync(STYLESHEET, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    rules.push({ selector: selector.trim().replace(/\s+/g, ' '), body });
  }
  return rules;
}

/** Root font size. `body` sets 0.875rem, so unstyled text is 14px. */
const ROOT_PX = 16;
const BODY_PX = 0.875 * ROOT_PX;

/**
 * WCAG "large scale" text is >= 18pt (24px), or >= 14pt (18.66px) bold.
 * Large text may sit at 3:1; everything else needs 4.5:1.
 */
function isLargeText(px, bold) {
  return px >= 24 || (bold && px >= 18.66);
}

/** Font size of a declaration body in px, or the inherited body size. */
function fontSizePx(body) {
  const m = /font-size:\s*([\d.]+)(rem|px)/.exec(body);
  if (!m) return BODY_PX;
  return m[2] === 'rem' ? Number(m[1]) * ROOT_PX : Number(m[1]);
}

test('the contrast helper agrees with the WCAG worked examples', () => {
  // Anchors, so a silently broken formula cannot quietly pass everything else.
  assert.equal(Number(contrastRatio('#000000', '#ffffff').toFixed(2)), 21);
  assert.equal(Number(contrastRatio('#ffffff', '#ffffff').toFixed(2)), 1);
  assert.equal(Number(contrastRatio('#777777', '#ffffff').toFixed(2)), 4.48);
});

test('the stylesheet state tokens are the same contract as palette.js', () => {
  // Two files hold these seven values and nothing used to check that they
  // agreed. A drift here means the floor and the chrome disagree about what
  // "for_review" looks like, which is the one thing the user reads fastest.
  const tokens = readTokens();
  for (const [state, colour] of Object.entries(STATE_COLORS)) {
    assert.equal(
      tokens[`state-${state}`],
      colour.toLowerCase(),
      `--state-${state} in style.css has drifted from palette.js`,
    );
  }
});

test('CONTRAST: every state colour clears 3:1 against the chrome ground', () => {
  // The WP-06 brief, verbatim: "If any state colour fails against the
  // new ground, the ground moves, not the state colour."
  const t = readTokens();
  for (const ground of ['bg', 'surface']) {
    for (const [state, colour] of Object.entries(STATE_COLORS)) {
      const ratio = contrastRatio(colour, t[ground]);
      assert.ok(
        ratio >= 3,
        `${state} (${colour}) is ${ratio.toFixed(2)}:1 on --${ground} (${t[ground]}); ` +
          'needs >= 3:1. Move --' +
          ground +
          ', never the state colour.',
      );
    }
  }
});

test('CONTRAST: body ink clears 4.5:1 against the chrome ground', () => {
  const t = readTokens();
  for (const ground of ['bg', 'surface']) {
    for (const ink of ['ink', 'ink-2']) {
      const ratio = contrastRatio(t[ink], t[ground]);
      assert.ok(
        ratio >= 4.5,
        `--${ink} (${t[ink]}) is ${ratio.toFixed(2)}:1 on --${ground} (${t[ground]}); needs >= 4.5:1`,
      );
    }
  }
});

test('--muted is normal-size text somewhere, so it is held to 4.5:1', () => {
  // The threshold is not assumed. Find every rule that sets text in --muted
  // and ask whether any of them is normal-size; if one is, 4.5:1 is the floor
  // for all of them.
  const smallUses = readRules().filter(
    (r) =>
      /(^|[^-])color:\s*var\(--muted\)/.test(r.body) && !isLargeText(fontSizePx(r.body), false),
  );
  assert.ok(
    smallUses.length > 0,
    'no rule sets normal-size text in --muted any more; if that is deliberate, ' +
      'this test should be relaxed to the 3:1 non-text floor on purpose',
  );

  const t = readTokens();
  // The three grounds --muted text actually lands on:
  //   --bg        the panel, the composer hint, .empty-state p, .field-label
  //   --surface   the topbar (.stat-k, .connection-status) and dialog bodies
  //   --surface-2 .tooltip-line, .btn.is-busy, .filter-chip::after
  for (const ground of ['bg', 'surface', 'surface-2']) {
    const ratio = contrastRatio(t.muted, t[ground]);
    assert.ok(
      ratio >= 4.5,
      `--muted (${t.muted}) is ${ratio.toFixed(2)}:1 on --${ground} (${t[ground]}); ` +
        `needs >= 4.5:1 because it sets normal-size text there (e.g. "${smallUses[0].selector}")`,
    );
  }
});

test('CONTRAST: the focus ring clears 3:1 on every surface it can land on', () => {
  // :focus-visible uses outline-offset, so a ring can sit on the page ground,
  // on any raised surface, or — for .btn--primary — on the accent itself.
  const t = readTokens();
  for (const ground of ['bg', 'surface', 'surface-2', 'surface-3', 'accent']) {
    const ratio = contrastRatio(t.focus, t[ground]);
    assert.ok(
      ratio >= 3,
      `--focus (${t.focus}) is ${ratio.toFixed(2)}:1 on --${ground} (${t[ground]}); needs >= 3:1`,
    );
  }
});

test('CONTRAST: the primary button label clears 4.5:1 on the accent', () => {
  const t = readTokens();
  const ratio = contrastRatio(t['accent-ink'], t.accent);
  assert.ok(
    ratio >= 4.5,
    `--accent-ink (${t['accent-ink']}) is ${ratio.toFixed(2)}:1 on --accent (${t.accent})`,
  );
});

test('COLOUR DISCIPLINE: state colours never set small text', () => {
  // The stylesheet's own header rule. Several state colours sit between 3:1
  // and 4.5:1 on the chrome ground — legible as a dot, a border or an icon,
  // not as a nine-pixel word. State is carried by colour PLUS a neutral-ink
  // label, so a `color: var(--state-*)` declaration is the smell.
  const offenders = readRules()
    .filter((r) => /(^|[^-])color:\s*var\(--state-[\w-]+\)/.test(r.body))
    .map((r) => r.selector);
  assert.deepEqual(
    offenders,
    [],
    `these rules set text in a state colour: ${offenders.join(', ')}. ` +
      'Colour the border, the dot or the icon instead and leave the words in --ink.',
  );
});

test('COLOUR DISCIPLINE: the accent sets text in exactly one place, and it is large', () => {
  // Crimson is 3.38:1 on --bg and 2.39:1 on --surface-3 — under the text floor
  // everywhere. The single exception is the needs-you numeral, which survives
  // only because 1.3rem at weight 700 is WCAG "large text" (3:1), and which is
  // always paired with its "NEEDS YOU" label so colour is never the carrier.
  const accentText = readRules().filter((r) => /(^|[^-])color:\s*var\(--accent\)\s*;/.test(r.body));
  assert.deepEqual(
    accentText.map((r) => r.selector),
    ['.needs-you-total .stat-v'],
    'a new rule sets text in the reserved accent. Errors and warnings carry ' +
      'crimson on a rule, a border or a dot, with the message itself in --ink.',
  );

  const t = readTokens();
  const px = fontSizePx(accentText[0].body);
  assert.ok(isLargeText(px, true), `the needs-you numeral is ${px}px, no longer WCAG large text`);
  const ratio = contrastRatio(t.accent, t.surface);
  assert.ok(
    ratio >= 3,
    `--accent (${t.accent}) is ${ratio.toFixed(2)}:1 on the topbar --surface (${t.surface})`,
  );
});

test('the chrome ground is cold, and colder than every state colour', () => {
  // The whole point of the repalette (WP-06, docs/DEVIATIONS.md §69): the
  // floor is warm, so the studio around it must not be. A regression to the
  // old pink-black would pass every contrast test above and undo the change,
  // so assert the temperature directly: every neutral's blue channel leads.
  const t = readTokens();
  for (const name of ['bg', 'surface', 'surface-2', 'surface-3', 'line', 'line-2', 'muted']) {
    const [r, , b] = [0, 2, 4].map((i) => parseInt(t[name].slice(1 + i, 3 + i), 16));
    assert.ok(
      b > r,
      `--${name} (${t[name]}) is warm (r=${r} >= b=${b}). The chrome neutrals carry a ` +
        'violet-blue bias so the warm floor reads as lit rather than as more brown.',
    );
  }
});
