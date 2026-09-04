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
import { CHROME_KEYS, GROUND_KEYS, THEMES } from '../../public/render/themes.js';
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

/**
 * Selectors that are a state GLYPH and not a word: WP-10's chip and row icons
 * (`✓`, `✋`, `⏳`). A glyph is non-text content under WCAG 1.4.11 and is held
 * to 3:1, not 4.5:1 — and the state word it stands for is always beside it in
 * neutral ink and in the control's `aria-label`. The test below measures the
 * 3:1 rather than taking it on trust, so this list buys an exemption from one
 * floor and an obligation to the other. Nothing may join it that renders a
 * word.
 */
const STATE_GLYPH_SELECTORS = /\.(strip|deck)-icon$/;

test('COLOUR DISCIPLINE: state colours never set small text', () => {
  // The stylesheet's own header rule. Several state colours sit between 3:1
  // and 4.5:1 on the chrome ground — legible as a dot, a border or an icon,
  // not as a nine-pixel word. State is carried by colour PLUS a neutral-ink
  // label, so a `color: var(--state-*)` declaration is the smell.
  const offenders = readRules()
    .filter((r) => /(^|[^-])color:\s*var\(--state-[\w-]+\)/.test(r.body))
    .map((r) => r.selector)
    .filter((selector) => !STATE_GLYPH_SELECTORS.test(selector));
  assert.deepEqual(
    offenders,
    [],
    `these rules set text in a state colour: ${offenders.join(', ')}. ` +
      'Colour the border, the dot or the icon instead and leave the words in --ink.',
  );
});

test('CONTRAST: a CSS state glyph clears 3:1 on every ground it is drawn on', () => {
  // The exemption above, paid for. WP-10 draws the first state icons that are
  // characters in the DOM rather than paint on the canvas, so the grounds they
  // land on became a measurable thing this suite had to start checking.
  //
  // Those grounds are --bg and --surface and no others, which is why the chip
  // is inset into the strip rather than raised off it: crimson measures
  // 2.78:1 on --surface-2 and 2.39:1 on --surface-3. The ground moved.
  const t = readTokens();
  const glyphRules = readRules().filter(
    (r) =>
      STATE_GLYPH_SELECTORS.test(r.selector) &&
      /(^|[^-])color:\s*var\(--state-[\w-]+\)/.test(r.body),
  );
  assert.ok(glyphRules.length >= 3, 'the strip and the deck draw state glyphs; none were found');

  for (const rule of glyphRules) {
    const state = /var\(--state-([\w-]+)\)/.exec(rule.body)[1];
    for (const ground of ['bg', 'surface']) {
      const ratio = contrastRatio(t[`state-${state}`], t[ground]);
      assert.ok(
        ratio >= 3,
        `${rule.selector} draws ${state} at ${ratio.toFixed(2)}:1 on --${ground}; ` +
          'a glyph is non-text content and needs >= 3:1. Move the ground.',
      );
    }
  }

  // And the grounds really are only those two: nothing under the strip or the
  // deck may quietly raise a glyph onto --surface-2 or --surface-3.
  const chipGrounds = readRules()
    .filter((r) => /^\.(strip-chip|deck-row)(:|\.|$)/.test(r.selector))
    .flatMap((r) => [...r.body.matchAll(/background(?:-color)?:\s*var\(--([\w-]+)\)/g)])
    .map((m) => m[1]);
  for (const ground of chipGrounds) {
    assert.ok(
      ground === 'bg' || ground === 'surface',
      `a chip or deck row sits on --${ground}; a state glyph cannot clear 3:1 there`,
    );
  }
});

test('COLOUR DISCIPLINE: the accent sets no text anywhere', () => {
  // Crimson is 3.38:1 on --bg and 2.39:1 on --surface-3 — under the 4.5:1 text
  // floor on every ground in this product. It used to have one licensed
  // exception, the needs-you numeral, which cleared the bar only by being
  // WCAG "large text". WP-07 took that exception away rather than widening it:
  // the numeral is 44px of --ink (GUI/UX spec §2.4), because a headline that
  // turns crimson whenever it is non-zero spends the reserved colour on the
  // SUM of three states — one of which is a stall — instead of on the one
  // thing crimson means. The breakdown's for_review dot still carries it.
  const accentText = readRules().filter((r) => /(^|[^-])color:\s*var\(--accent\)\s*;/.test(r.body));
  assert.deepEqual(
    accentText.map((r) => r.selector),
    [],
    'a rule sets text in the reserved accent. Errors, warnings and the ' +
      'waiting clock carry crimson on a rule, a border or a dot, with the ' +
      'words themselves in --ink.',
  );
});

test('the needs-you numeral is the display element, and calm at zero', () => {
  // GUI/UX spec §2.4, the one measurement this package is judged on: 44px of
  // JetBrains Mono in --ink, dropping to --muted and losing its weight at
  // zero, because a cleared queue should not read like a scoreboard.
  const rules = readRules();
  const numeral = rules.find((r) => r.selector === '.numeral-v');
  assert.ok(numeral, '.numeral-v is gone; the display numeral is the product');
  assert.equal(fontSizePx(numeral.body), 44);
  assert.match(numeral.body, /font-family:\s*var\(--font-mono\)/);
  assert.match(numeral.body, /font-variant-numeric:\s*tabular-nums/);
  assert.match(numeral.body, /color:\s*var\(--ink\)/);

  const zero = rules.find((r) => r.selector === '.numeral.is-zero .numeral-v');
  assert.ok(zero, 'the zero state is gone; a cleared queue must look calm');
  assert.match(zero.body, /color:\s*var\(--muted\)/);
  assert.match(zero.body, /font-weight:\s*400/);

  const t = readTokens();
  for (const [ink, floor] of [
    ['ink', 4.5],
    ['muted', 4.5],
  ]) {
    const ratio = contrastRatio(t[ink], t.surface);
    assert.ok(
      ratio >= floor,
      `the numeral in --${ink} is ${ratio.toFixed(2)}:1 on the topbar --surface`,
    );
  }
});

test('CONTRAST: the palette and the settings sheet stay inside the ink and ground sets', () => {
  // WP-07 added two whole surfaces. Rather than re-measuring each rule by
  // hand, hold them to the palette this stylesheet already proves: text is
  // only ever --ink, --ink-2 or --muted, and a ground is only ever --surface
  // or --surface-2 — the exact pairs measured above. Anything else on these
  // surfaces has to be argued for here, deliberately, rather than slipped in.
  const INKS = new Set(['--ink', '--ink-2', '--muted', '--accent-ink', 'inherit', 'currentColor']);
  const GROUNDS = new Set(['--surface', '--surface-2', 'none', 'transparent']);
  // ::backdrop is the scrim over the rest of the window, not a ground any
  // text sits on, so it keeps the same near-black wash as every other overlay.
  const isNew = (sel) =>
    /(^|[\s,>])\.(palette|settings)[\w-]*/.test(sel) && !sel.includes('::backdrop');

  const badInk = [];
  const badGround = [];
  for (const rule of readRules()) {
    if (!isNew(rule.selector)) continue;
    for (const [, value] of rule.body.matchAll(/(?:^|[^-])color:\s*([^;]+);/g)) {
      const token = /var\((--[\w-]+)\)/.exec(value)?.[1] || value.trim();
      if (!INKS.has(token)) badInk.push(`${rule.selector} { color: ${value.trim()} }`);
    }
    for (const [, value] of rule.body.matchAll(/background:\s*([^;]+);/g)) {
      const token = /var\((--[\w-]+)\)/.exec(value)?.[1] || value.trim();
      if (!GROUNDS.has(token)) badGround.push(`${rule.selector} { background: ${value.trim()} }`);
    }
  }
  assert.deepEqual(badInk, [], 'palette/settings text outside the measured ink set');
  assert.deepEqual(badGround, [], 'palette/settings ground outside the measured ground set');

  // And the pairs themselves clear the floors, on both grounds those surfaces
  // actually use.
  const t = readTokens();
  for (const ground of ['surface', 'surface-2']) {
    for (const ink of ['ink', 'ink-2', 'muted']) {
      const ratio = contrastRatio(t[ink], t[ground]);
      assert.ok(
        ratio >= 4.5,
        `--${ink} is ${ratio.toFixed(2)}:1 on --${ground}; the palette and the sheet set text there`,
      );
    }
  }
});

test('the palette and the settings sheet are keyboard and screen-reader shaped', () => {
  // GUI/UX spec §10. The markup half of "fully keyboard-operable and
  // screen-reader-labelled": the palette is a dialog with a combobox over a
  // labelled listbox, and its rows are options. The behaviour half is in
  // test/unit/palette.test.mjs.
  const html = fs.readFileSync(path.join(HERE, '..', '..', 'public', 'index.html'), 'utf8');
  const palette = /<dialog id="palette"[\s\S]*?<\/dialog>/.exec(html);
  assert.ok(palette, 'the palette shell is gone from index.html');
  assert.match(palette[0], /role="dialog"/);
  assert.match(palette[0], /aria-label="Command palette"/);
  assert.match(palette[0], /role="combobox"/);
  assert.match(palette[0], /aria-controls="palette-list"/);
  assert.match(palette[0], /role="listbox"/);
  assert.match(palette[0], /<label class="sr-only" for="palette-input">/);

  const sheet = /<dialog id="settings-dialog"[\s\S]*?<\/dialog>/.exec(html);
  assert.ok(sheet, 'the settings sheet shell is gone from index.html');
  assert.match(sheet[0], /aria-labelledby="settings-title"/);
  assert.match(sheet[0], /id="settings-close"[^>]*aria-label="Close"/);
});

test('no author rule can force a closed <dialog> on screen', () => {
  // A <dialog> is hidden by the UA rule `dialog:not([open]) { display: none }`,
  // and ANY author rule that sets `display` on the element beats a UA rule
  // whatever its specificity. `.palette { display: flex }` therefore left the
  // command palette permanently drawn over the floor, in the page flow — a
  // defect no unit test could see and the goldens caught in one screenshot
  // (docs/DEVIATIONS.md §94.11). Every dialog class must gate `display` on
  // [open].
  const dialogClasses = ['.palette', '.dialog'];
  const offenders = [];
  for (const rule of readRules()) {
    if (!/(^|[^-\w])display\s*:/.test(rule.body)) continue;
    for (const cls of dialogClasses) {
      const bare = new RegExp(`(^|[\\s,>])\\${cls}\\s*(,|$)`);
      if (bare.test(rule.selector)) offenders.push(rule.selector);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    'these rules set display on a <dialog> without [open], so it is drawn while closed',
  );
});

test('the header is a headline, not a toolbar', () => {
  // GUI/UX spec §5.2. Six buttons left the header; only the palette hint and
  // one primary action remain. A regression here is someone quietly putting
  // a button back "just this once".
  const html = fs.readFileSync(path.join(HERE, '..', '..', 'public', 'index.html'), 'utf8');
  const header = /<header class="topbar"[\s\S]*?<\/header>/.exec(html);
  assert.ok(header, 'the header is gone');
  const buttons = header[0].match(/<button\b/g) || [];
  assert.equal(
    buttons.length,
    3,
    'the header carries the palette hint, one primary action and the degraded ' +
      "banner's link, and nothing else. Everything else belongs in ⌘K.",
  );
  assert.match(header[0], /id="new-agent-btn"[^>]*>\s*\+ New agent/);
  assert.match(header[0], /id="palette-btn"/);
  for (const gone of ['show-letgo-toggle', 'settle-btn', 'hook-status-btn', 'refresh-btn']) {
    assert.doesNotMatch(header[0], new RegExp(gone), `${gone} is back in the header`);
  }
});

// ---------------------------------------------------------------------------
// WP-30. THE SAME FLOORS, FOR EVERY THEME.
//
// Every measurement above is taken against `public/style.css`'s `:root`, which
// is the DEFAULT theme and nothing else. A theme moves those grounds, and it
// moves every ratio measured above with them — a theme that shipped unmeasured
// would be the one way this feature could undo the product's accessibility
// promise.
//
// The rule from WP-06 is unchanged and now applies per theme: **the ground
// moves, never the state colour.** A theme cannot reach a state colour at all
// (none is in `FLOOR_KEYS` or `CHROME_KEYS`), so the only thing a failing
// theme can do about a failure is move its own neutrals.
//
// These re-run the assertions above against each theme's own tokens rather
// than calling `assertThemeContrast`: that function is the PRODUCT's guard and
// this is the check on it, and a test that called the thing it was testing
// would pass whatever either of them did.
// ---------------------------------------------------------------------------

/**
 * One theme's tokens, with the default's filled in behind it.
 * @param {any} theme
 */
function themeTokens(theme) {
  const base = THEMES.find((t) => t.name === 'default');
  return {
    chrome: { ...base.chrome, ...theme.chrome },
    floor: { ...base.floor, ...theme.floor },
  };
}

test('WP-30: more than one theme ships, and the default is one of them', () => {
  // Without this, every parametrised test below would pass vacuously the day
  // somebody emptied the table.
  assert.ok(THEMES.length >= 3, `only ${THEMES.length} theme(s) ship`);
  assert.ok(
    THEMES.some((t) => t.name === 'default'),
    'the default theme is gone from the table',
  );
});

test("WP-30: the default theme is public/style.css's :root, exactly", () => {
  // The picker's "default" row must select the chrome that actually ships. If
  // these drift, choosing "default" would repaint the window in something
  // nobody wrote down.
  const t = readTokens();
  const base = THEMES.find((theme) => theme.name === 'default');
  for (const key of CHROME_KEYS) {
    assert.equal(
      base.chrome[key].toLowerCase(),
      t[key],
      `the default theme's --${key} has drifted from style.css`,
    );
  }
});

for (const theme of THEMES) {
  test(`CONTRAST [${theme.name}]: every state colour clears 3:1 on the chrome ground`, () => {
    const { chrome } = themeTokens(theme);
    for (const ground of ['bg', 'surface']) {
      for (const [state, colour] of Object.entries(STATE_COLORS)) {
        const ratio = contrastRatio(colour, chrome[ground]);
        assert.ok(
          ratio >= 3,
          `${state} (${colour}) is ${ratio.toFixed(2)}:1 on --${ground} (${chrome[ground]}) ` +
            `in "${theme.name}"; needs >= 3:1. Move the theme's ground, never the state colour.`,
        );
      }
    }
  });

  test(`CONTRAST [${theme.name}]: text clears 4.5:1 on every ground it lands on`, () => {
    const { chrome } = themeTokens(theme);
    for (const ground of ['bg', 'surface']) {
      for (const ink of ['ink', 'ink-2']) {
        const ratio = contrastRatio(chrome[ink], chrome[ground]);
        assert.ok(
          ratio >= 4.5,
          `--${ink} is ${ratio.toFixed(2)}:1 on --${ground} in "${theme.name}"`,
        );
      }
    }
    // `--muted` sets normal-size text on three grounds — the test above proves
    // that is still true of the stylesheet, and this holds every theme to it.
    for (const ground of ['bg', 'surface', 'surface-2']) {
      const ratio = contrastRatio(chrome.muted, chrome[ground]);
      assert.ok(ratio >= 4.5, `--muted is ${ratio.toFixed(2)}:1 on --${ground} in "${theme.name}"`);
    }
  });

  test(`CONTRAST [${theme.name}]: the focus ring and the accent are untouched and still clear`, () => {
    // `--focus`, `--accent` and `--accent-ink` are NOT themeable, which is the
    // point of this test: their literals come from the stylesheet, and it is
    // the theme's grounds that have to accommodate them.
    const t = readTokens();
    const { chrome } = themeTokens(theme);
    for (const ground of ['bg', 'surface', 'surface-2', 'surface-3']) {
      const ratio = contrastRatio(t.focus, chrome[ground]);
      assert.ok(ratio >= 3, `--focus is ${ratio.toFixed(2)}:1 on --${ground} in "${theme.name}"`);
    }
    assert.ok(contrastRatio(t.focus, t.accent) >= 3);
    assert.ok(contrastRatio(t['accent-ink'], t.accent) >= 4.5);
  });

  test(`CONTRAST [${theme.name}]: the floor's line work clears 4.5:1 on every ground`, () => {
    // `palette.js`'s `plateInk` comment claimed ">= 4.68:1 against every wood
    // tone and carpetBase", hand-verified. WP-30 makes that a measurement, and
    // makes it one every theme has to pass: a theme that darkened the floor
    // without lightening its ink would leave every room plate unreadable and
    // nothing else in this suite would have noticed.
    const { floor } = themeTokens(theme);
    for (const ground of GROUND_KEYS) {
      const ratio = contrastRatio(floor.ink, floor[ground]);
      assert.ok(
        ratio >= 4.5,
        `the ${theme.name} floor's ink (${floor.ink}) is ${ratio.toFixed(2)}:1 on the ` +
          `${ground} (${floor[ground]}); a room plate has to be readable`,
      );
    }
  });

  test(`COLOUR DISCIPLINE [${theme.name}]: no themed colour is, or approaches, the accent`, () => {
    // Crimson means "standing in your office" and a theme may not spend it, in
    // either table. 60 in sRGB distance is the bar `palette.js` holds a
    // material to; the chrome is held to it too, because a surface that read
    // as red would be the same failure one layer out.
    const { chrome, floor } = themeTokens(theme);
    /** @param {string} h */
    const channels = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const crimson = channels(STATE_COLORS.for_review);
    for (const [table, tokens] of Object.entries({ floor, chrome })) {
      for (const [key, colour] of Object.entries(tokens)) {
        const c = channels(colour);
        const d = Math.hypot(c[0] - crimson[0], c[1] - crimson[1], c[2] - crimson[2]);
        assert.ok(
          d >= 60,
          `"${theme.name}" sets ${table}.${key} to ${colour}, which is ${d.toFixed(1)} from the ` +
            'reserved crimson. Nothing decorative may approach it.',
        );
      }
    }
  });

  test(`[${theme.name}] the state colours, the accent and the identities are not themeable`, () => {
    // The structural half of the promise: it is not that a theme is checked
    // for these, it is that a theme has nowhere to put them.
    const named = [...Object.keys(theme.floor), ...Object.keys(theme.chrome)];
    for (const key of named) {
      assert.ok(
        !/^(state|accent|focus|identity|hair|skin)/i.test(key),
        `"${theme.name}" has a key called ${key}, which is not a themeable surface`,
      );
    }
  });
}

test('the state colours, the accent and the focus ring are outside every allowlist', () => {
  for (const key of CHROME_KEYS) {
    assert.ok(!key.startsWith('state-'), `a state token (${key}) is in the chrome allowlist`);
    assert.notEqual(key, 'accent');
    assert.notEqual(key, 'accent-ink');
    assert.notEqual(key, 'focus');
    assert.notEqual(key, 'line-2');
  }
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
