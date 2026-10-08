/**
 * THE THEME THE FLOOR IS WEARING IS A NAME.
 *
 * `applyThemeSetting` paints through `applyLook` since the look and the theme
 * became one floor, and `applyLook` answers with the resolved look — one object,
 * the same one on every call. The shell kept that object where it keeps the
 * theme's name, and three things followed, none of which a test saw because
 * every test stubbed `applyThemeSetting` with the identity:
 *
 *   - `paintedTheme()` handed an object to callers that paint a swatch "on the
 *     theme the user is looking at";
 *   - the comparison that decides whether to repaint compared the object with
 *     itself, so the SECOND theme of a session never repainted the floor;
 *   - `applyLookSetting` passed the object on as a theme name, which no theme
 *     has, so choosing a look on Night shift resolved it against the default.
 *
 * So this file runs the real `app-state.js` against the real `look-derive.js`
 * and `themes.js`, with a recording scene behind it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as derive from '../../public/render/look-derive.js';
import * as options from '../../public/render/look-options.js';
import * as themes from '../../public/render/themes.js';

/** The little of a page `app-state.js` touches while it paints. */
function stubPage() {
  const g = /** @type {any} */ (globalThis);
  const props = new Map();
  g.location = { search: '' };
  g.document = {
    // The shell looks its header up by id as it loads; none of it is painted here.
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    documentElement: {
      dataset: {},
      style: {
        setProperty: (/** @type {string} */ k, /** @type {string} */ v) => props.set(k, v),
        removeProperty: (/** @type {string} */ k) => props.delete(k),
      },
    },
  };
}

/** A scene that only counts what it is asked to do. */
function recordingScene() {
  return {
    repaints: 0,
    states: 0,
    repaint() {
      this.repaints++;
    },
    setState() {
      this.states++;
    },
  };
}

stubPage();
const state = await import('../../public/app-state.js');
state.setThemes(themes);
state.setLook(derive, options);

test('the theme the floor wears is reported by name, whichever painter applied it', () => {
  const scene = recordingScene();
  state.setScene(scene);
  derive.resetLook();

  for (const theme of themes.THEMES) {
    const applied = state.applyThemeSetting(theme.name);
    assert.equal(applied, theme.name, 'the function answers with the name it applied');
    assert.equal(typeof state.paintedTheme(), 'string');
    assert.equal(state.paintedTheme(), theme.name);
  }
  // A name no build has is the default, by name.
  assert.equal(state.applyThemeSetting('no such theme'), 'default');
  assert.equal(state.paintedTheme(), 'default');
});

test('a second theme repaints the floor, and the same theme twice does not', () => {
  const scene = recordingScene();
  state.setScene(scene);
  state.applyThemeSetting('default');
  scene.repaints = 0;

  state.applyThemeSetting('night shift');
  assert.equal(scene.repaints, 1, 'the first change repaints');
  state.applyThemeSetting('blueprint');
  assert.equal(
    scene.repaints,
    2,
    'and so does the second — it used to compare an object with itself',
  );
  state.applyThemeSetting('blueprint');
  assert.equal(scene.repaints, 2, 'the same theme again costs one comparison');
});

test('a look chosen on another theme is resolved against that theme, not the default', () => {
  const scene = recordingScene();
  state.setScene(scene);
  state.applyThemeSetting('night shift');
  assert.equal(derive.LOOK.theme, 'night shift');

  const preset = options.PRESETS.find((p) => !options.sameLook(p.look, options.DEFAULT_LOOK));
  assert.ok(preset, 'the catalogue has a look that is not the default');
  scene.repaints = 0;
  scene.states = 0;
  state.applyLookSetting(preset.look);

  assert.equal(derive.LOOK.theme, 'night shift', 'the theme survived the look');
  assert.equal(state.paintedTheme(), 'night shift');
  assert.deepEqual(
    derive.LOOK.tokens,
    derive.resolveLook(preset.look, 'night shift').tokens,
    'painted in the tokens of that look on that theme',
  );
  assert.equal(scene.repaints + scene.states, 1, 'and the floor was told once');

  derive.resetLook();
});
