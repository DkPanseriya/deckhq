/**
 * The panel's close-up holds the whole figure, state icon included
 * (`public/panel-header.js`, `startCloseUp`). The top half of a waiting
 * session's tick was cut off by the canvas's own edge.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { CHROME_TOP_U, ICON_MIN_PX } from '../../public/render/rig-metrics.js';

const SRC = fs.readFileSync(new URL('../../public/panel-header.js', import.meta.url), 'utf8');

test('the close-up is sized so a state icon stands whole inside the canvas', () => {
  // The rule as the panel writes it, read back so the two cannot drift.
  assert.match(SRC, /const cy = closeupCanvas\.height \* 0\.94;/);
  assert.match(SRC, /const iconTop = \(rig\.CHROME_TOP_U \?\? 2\.35\) \+ 0\.9;/);
  assert.match(
    SRC,
    /const u = icon\s*\? \(cy - closeupCanvas\.height \* 0\.03\) \/ iconTop\s*: closeupCanvas\.height \/ 2\.9;/,
  );
  assert.equal(CHROME_TOP_U, 2.35, 'the fallback the panel carries is the rig’s own number');
  // 44 px shown, drawn at twice that; and the 160 px one, for good measure.
  for (const height of [88, 320]) {
    const cy = height * 0.94;
    const u = (cy - height * 0.03) / (CHROME_TOP_U + 0.9);
    const icon = Math.max(ICON_MIN_PX, u * 0.9);
    const top = cy - u * CHROME_TOP_U - icon; // `drawIcon`'s own `topY`
    assert.ok(
      top >= height * 0.03 - 1e-9,
      `${height}: the icon's top is ${top.toFixed(1)} px down`,
    );
    // Without it, at the size a figure with no icon is drawn, it was cut off.
    const was = height / 2.9;
    assert.ok(cy - was * CHROME_TOP_U - Math.max(ICON_MIN_PX, was * 0.9) < 0);
  }
});
