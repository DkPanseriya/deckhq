// A machine of our own, before anything under `src/` is loaded.
// `docs/DEVIATIONS.md` §124.
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { pickSessionTheme, queryValue } from '../../public/url-options.js';
import { themeByName, themeNames } from '../../src/core/themes.mjs';

test('a query value is decoded, trimmed, and null when absent or empty', () => {
  assert.equal(queryValue('?theme=night%20shift', 'theme'), 'night shift');
  assert.equal(queryValue('theme=paper', 'theme'), 'paper');
  assert.equal(queryValue('?a=1&theme=paper&b=2', 'theme'), 'paper');
  assert.equal(queryValue('?theme=%20%20', 'theme'), null);
  assert.equal(queryValue('?other=1', 'theme'), null);
  assert.equal(queryValue('', 'theme'), null);
  assert.equal(queryValue(/** @type {any} */ (null), 'theme'), null);
});

test('a known theme id wins over the setting, for this tab', () => {
  // Against the REAL registry, so this test breaks if a shipped theme is
  // renamed rather than passing on a name nobody has.
  const names = themeNames();
  assert.ok(names.length > 1, 'the build ships more than one theme');
  const other = names.find((n) => n !== 'default') || names[0];
  assert.equal(
    pickSessionTheme(`?theme=${encodeURIComponent(other)}`, 'default', themeByName),
    other,
  );
});

test('an unknown id is IGNORED — the setting is painted, never the default', () => {
  assert.equal(pickSessionTheme('?theme=not-a-theme', 'night shift', themeByName), 'night shift');
  assert.equal(pickSessionTheme('?theme=<script>', 'night shift', themeByName), 'night shift');
  assert.equal(pickSessionTheme('?theme=', 'night shift', themeByName), 'night shift');
  // No parameter at all changes nothing.
  assert.equal(pickSessionTheme('', 'night shift', themeByName), 'night shift');
});

test('`themeByName` is what decides, so separators and case in the URL still resolve', () => {
  const target = themeNames().find((n) => n.includes(' '));
  if (target) {
    const hyphenated = target.replace(/ /g, '-');
    assert.equal(pickSessionTheme(`?theme=${hyphenated}`, 'default', themeByName), hyphenated);
    assert.ok(themeByName(hyphenated), 'themeByName resolves the hyphenated spelling');
  }
});

test('a validator that throws is treated as "unknown", never as a crash', () => {
  assert.equal(
    pickSessionTheme('?theme=paper', 'default', () => {
      throw new Error('registry not loaded');
    }),
    'default',
  );
});
