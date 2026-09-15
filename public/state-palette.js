/**
 * The client's one copy of the state palette (WP-92d, audit finding A-04).
 *
 * `public/render/palette-colors.js` is canonical: it is the module
 * `docs/03-VISUAL-SPEC.md` §5 is transcribed into, and `style.css`'s
 * `--state-*` tokens restate the same seven values for the chrome.
 * `test/unit/state-visuals.test.mjs` holds all three together.
 *
 * The shell cannot import the canonical module statically. Every import from
 * `./render/**` is dynamic and defensive (see the header of `app.js`): a
 * missing or broken renderer must degrade the floor and the close-up without
 * taking the header, the panel, the keyboard map or the notifications with
 * it. So the shell needs a literal it can read before — or instead of — the
 * renderer, and this file is that literal.
 *
 * It used to be three literals: `app-state.js` carried one, `panel-header.js`
 * carried a second, private, six-key copy that no test named, and the fourth
 * place the palette lives is the stylesheet. The private copy could drift
 * alone, so it is gone and both consumers read this module instead. The test
 * asserts there is exactly one such literal under `public/` and that it agrees
 * with `STATE_COLORS` key for key.
 *
 * No imports, no DOM, no side effects — so importing it can neither create a
 * cycle nor move anything's evaluation order.
 *
 * @type {Record<string, string>}
 */
export const FALLBACK_STATE_COLORS = {
  working: '#2E7D63',
  needs_input: '#B87333',
  stalled: '#9A7B4F',
  for_review: '#C0392B',
  benched: '#7B8794',
  let_go: '#BDB7AA',
  ended: '#6E6A63',
};
