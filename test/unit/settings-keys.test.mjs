/**
 * No orphaned settings keys.
 *
 * WP-07's acceptance criterion, and the defect that motivated it: the header
 * carried a "Show let go" toggle that POSTed `settings.showLetGo`, the route
 * accepted it, the store persisted it, and **no code ever read it**. It was
 * live for four months and flagged as a loose end (docs/DEVIATIONS.md §58)
 * before anyone deleted it. `zoom` was the same shape and went with it (§94).
 *
 * A settings key has three places it has to line up: the store's defaults
 * (what is persisted), the HTTP route's allowlist (what can be written), and
 * some code that actually reads it. This suite asserts all three, so the next
 * key that changes nothing fails here instead of shipping.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { DEFAULT_SETTINGS, MOTION_MODES, RESUME_TARGETS } from '../../src/core/store.mjs';
import { SETTINGS_KEYS } from '../../public/settings-ui.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const SETTINGS_ROUTE = path.join(ROOT, 'src', 'http', 'routes', 'settings.mjs');

/** Every source file that could read a setting. */
function sourceFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(mjs|js)$/.test(name)) out.push(full);
  }
  return out;
}

const CODE = [
  ...sourceFiles(path.join(ROOT, 'src')),
  ...sourceFiles(path.join(ROOT, 'public')),
  ...sourceFiles(path.join(ROOT, 'scripts')),
];

/**
 * Files that define a settings key rather than read one. A mention in either
 * is not evidence that anything consumes it — that is precisely how the dead
 * toggle stayed alive.
 */
const DEFINERS = new Set([path.join(ROOT, 'src', 'core', 'store.mjs'), SETTINGS_ROUTE]);

test('the route accepts exactly the settings the store persists', () => {
  // Derived in the route from DEFAULT_SETTINGS, so this is really a guard
  // against someone re-hardcoding the list.
  const src = fs.readFileSync(SETTINGS_ROUTE, 'utf8');
  assert.match(
    src,
    /const ALLOWED = new Set\(Object\.keys\(DEFAULT_SETTINGS\)\)/,
    'the allowlist has been hand-written again; it must be derived from DEFAULT_SETTINGS',
  );
});

test('every persisted setting is read by something', () => {
  const orphans = [];
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    const pattern = new RegExp(`\\b${key}\\b`);
    const readers = CODE.filter(
      (file) => !DEFINERS.has(file) && pattern.test(fs.readFileSync(file, 'utf8')),
    );
    if (readers.length === 0) orphans.push(key);
  }
  assert.deepEqual(
    orphans,
    [],
    `these settings are written and never read: ${orphans.join(', ')}. ` +
      'A setting that changes nothing is the "Show let go" toggle again — delete it, ' +
      'or wire it to the thing it claims to control.',
  );
});

test('the client only writes settings the store knows about', () => {
  for (const key of SETTINGS_KEYS) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(DEFAULT_SETTINGS, key),
      `the settings sheet writes "${key}", which the store does not persist`,
    );
  }
});

test('the settings sheet offers every setting a person can meaningfully change', () => {
  // The six it does not: `approveText` belongs to the panel's `2 Approve`
  // and is edited there; `onboarded` is a fact, not a preference; and
  // `editor` (WP-47) and `terminal` (WP-04) both default to "work it out",
  // which is the right answer on nearly every machine — the sheet's own rule
  // is that a control ships only when moving it changes something, and both
  // are pinned by POSTing to /api/settings until a package owns their row
  // (docs/DEVIATIONS.md §94.3). They are exempt from HAVING a control, not
  // from being real settings: both are persisted, sanitized and validated.
  //
  // `goneHomeDays` (WP-50, docs/DEVIATIONS.md §96) is the fifth, and it is
  // exempt for the same reason and only for now: the gone-home window arrived
  // with the dynamic floor, is read by the renderer's filter in
  // `public/render/plan.js`, and is pinned by POSTing to /api/settings until
  // the sheet's floor section grows a row for it.
  //
  // `ledgerRetentionDays` (WP-17, docs/DEVIATIONS.md §100) is the sixth, and
  // exempt on the same terms: the ledger's retention window is read at daemon
  // start by `ledger.prune()`, ninety days is right on nearly every machine,
  // and it is pinned by POSTing to /api/settings until the sheet's data
  // section grows a row for it.
  // `osNotify` (WP-16, §101) is the seventh, and it is exempt for a sharper
  // reason: it decides whether a background process may interrupt this
  // machine's user, it ships OFF, and who gets to turn it on — and what the
  // row says when they do — is an open decision for the owner. Until that is
  // answered it is `deckhq --notify` and a POST to /api/settings, not a
  // toggle somebody flips without reading it.
  const sheetOwned = new Set(SETTINGS_KEYS);
  const exempt = new Set([
    'approveText',
    'onboarded',
    'editor',
    'terminal',
    'goneHomeDays',
    'ledgerRetentionDays',
    'osNotify',
  ]);
  const missing = Object.keys(DEFAULT_SETTINGS).filter((k) => !sheetOwned.has(k) && !exempt.has(k));
  assert.deepEqual(
    missing,
    [],
    `these settings have no control anywhere: ${missing.join(', ')}. ` +
      'Before WP-07 that was every one of them — the only way to change the stall ' +
      'window was to POST to /api/settings by hand.',
  );
});

test('showLetGo is gone from the whole tree', () => {
  // Comments are stripped first: several files explain in prose why the key
  // was deleted and what replaced it, and that history is worth keeping. It
  // is a `showLetGo` in *code* that would mean it had come back.
  const stripComments = (src) =>
    src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');
  const offenders = [];
  for (const file of [...CODE, path.join(ROOT, 'public', 'index.html')]) {
    if (/showLetGo|show-letgo/.test(stripComments(fs.readFileSync(file, 'utf8')))) {
      offenders.push(path.relative(ROOT, file).replace(/\\/g, '/'));
    }
  }
  assert.deepEqual(offenders, [], 'the dead "Show let go" setting is back');
});

test('the enumerated settings are constrained to their sets', () => {
  assert.deepEqual([...RESUME_TARGETS], ['app', 'terminal']);
  assert.deepEqual([...MOTION_MODES], ['system', 'reduce', 'no-preference']);
  assert.ok(RESUME_TARGETS.includes(DEFAULT_SETTINGS.resumeIn));
  assert.ok(MOTION_MODES.includes(DEFAULT_SETTINGS.reducedMotion));
});

test('the defaults are the quiet ones', () => {
  // A product that sits beside a terminal at 11pm does not arrive making
  // noise, and it does not arrive having decided the OS is wrong about motion.
  assert.equal(DEFAULT_SETTINGS.sound, false);
  assert.equal(DEFAULT_SETTINGS.reducedMotion, 'system');
  assert.ok(DEFAULT_SETTINGS.soundVolume <= 0.5, 'the default volume is not low');
  assert.equal(DEFAULT_SETTINGS.onboarded, false);
});
