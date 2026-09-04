/**
 * WP-30 — layout export and import.
 *
 * The acceptance criterion this file exists for: **a malformed file is refused
 * with a clear message and never partially applied.** Every bad document below
 * is asserted to change nothing, and the CLI's own refusal path is driven with
 * a `post` that records whether it was ever called.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  LAYOUT_KIND,
  LAYOUT_VERSION,
  MAX_ROOMS,
  buildLayout,
  parseLayout,
  settingsPatchFor,
  validateLayout,
} from '../../src/core/layout.mjs';
import { orderRooms } from '../../src/core/state-machine.mjs';
import { Store } from '../../src/core/store.mjs';
import { runLayout } from '../../src/cli/layout.mjs';

/** A snapshot with three rooms, one of them folded away. */
function snapshot() {
  return {
    projects: [
      { id: 'orbital-api', archived: false },
      { id: 'checkout-flow', archived: true },
      { id: 'design-system', archived: false },
    ],
    settings: { theme: 'night shift', goneHomeDays: 14, lightsOutHour: 23 },
  };
}

/** A valid document, deep-copied so a test can spoil it. */
function doc() {
  return JSON.parse(JSON.stringify(buildLayout(snapshot())));
}

// ------------------------------------------------------------------ export

test('a layout is the theme, the room order, the folded rooms and two preferences', () => {
  assert.deepEqual(buildLayout(snapshot()), {
    kind: LAYOUT_KIND,
    version: LAYOUT_VERSION,
    theme: 'night shift',
    rooms: ['orbital-api', 'checkout-flow', 'design-system'],
    archivedRooms: ['checkout-flow'],
    floor: { goneHomeDays: 14, lightsOutHour: 23 },
  });
});

test('a layout carries no session, no acknowledgement and no name', () => {
  // THE INVARIANT (docs/01-PRODUCT.md §2): a file that could clear a
  // user-owned state would be a second writer against `act()`.
  const text = JSON.stringify(
    buildLayout({
      projects: [{ id: 'orbital-api' }],
      settings: { theme: 'blueprint' },
    }),
  );
  for (const forbidden of [
    'ack',
    'reviewSince',
    'needsInputSince',
    'agents',
    'sessions',
    'names',
  ]) {
    assert.ok(!text.includes(forbidden), `a layout carries "${forbidden}"`);
  }
});

test('export defaults every preference it cannot read, and drops a bad project id', () => {
  const layout = buildLayout({
    projects: [{ id: 'ok-repo' }, { id: '../etc' }, { id: 'ok-repo' }, {}],
    settings: {},
  });
  assert.deepEqual(layout.rooms, ['ok-repo']);
  assert.equal(layout.theme, 'default');
  assert.deepEqual(layout.floor, { goneHomeDays: 7, lightsOutHour: 22 });
});

test('an exported layout validates', () => {
  const result = validateLayout(buildLayout(snapshot()));
  assert.equal(result.ok, true, /** @type {any} */ (result).error);
});

// ------------------------------------------------------- refusing bad files

test('eleven malformed layouts are each refused with a reason that names the field', () => {
  const bad = [
    [null, /must be a JSON object/],
    [{ ...doc(), kind: 'deckhq.theme' }, /not a DeckHQ layout/],
    [{ ...doc(), version: 2 }, /layout version 2/],
    [{ ...doc(), theme: 'midnight' }, /this build does not have/],
    [{ ...doc(), theme: 42 }, /this build does not have/],
    [{ ...doc(), rooms: 'orbital-api' }, /"rooms" must be an array/],
    [{ ...doc(), rooms: ['../etc/passwd'] }, /not a project id/],
    [{ ...doc(), rooms: ['a', 'a'] }, /lists "a" twice/],
    [{ ...doc(), archivedRooms: ['not-a-room'] }, /not in rooms/],
    [{ ...doc(), floor: { goneHomeDays: 7, lightsOutHour: 99 } }, /lightsOutHour is 99/],
    [{ ...doc(), floor: { goneHomeDays: 7, lightsOutHour: 22, zoom: 3 } }, /floor\.zoom/],
    [{ ...doc(), floor: { goneHomeDays: 1.5, lightsOutHour: 22 } }, /whole number/],
    [{ ...doc(), rooms: undefined }, /"rooms" must be an array/],
    [{ ...doc(), somethingElse: true }, /unknown field\(s\): somethingElse/],
  ];
  for (const [document, pattern] of bad) {
    const result = validateLayout(/** @type {any} */ (document));
    assert.equal(result.ok, false, `accepted: ${JSON.stringify(document)?.slice(0, 80)}`);
    assert.match(/** @type {any} */ (result).error, /** @type {RegExp} */ (pattern));
  }
});

test('a room list longer than the bound is refused rather than truncated', () => {
  const tooMany = doc();
  tooMany.rooms = Array.from({ length: MAX_ROOMS + 1 }, (_, i) => `repo-${i}`);
  const result = validateLayout(tooMany);
  assert.equal(result.ok, false);
  assert.match(/** @type {any} */ (result).error, new RegExp(`limit is ${MAX_ROOMS}`));
});

test('parseLayout refuses non-JSON, and an oversized file before it parses it', () => {
  assert.match(/** @type {any} */ (parseLayout('{oops')).error, /not valid JSON/);
  const huge = `{"pad":"${'x'.repeat(300_000)}"}`;
  const result = parseLayout(huge);
  assert.equal(result.ok, false);
  assert.match(/** @type {any} */ (result).error, /the limit is/);
});

// -------------------------------------------------------------- the applier

test('the settings patch a layout implies is exactly three keys', () => {
  // A layout that could write any setting would be a config file with a
  // different name. Three, and they are the three the document states.
  assert.deepEqual(settingsPatchFor(/** @type {any} */ (doc())), {
    theme: 'night shift',
    goneHomeDays: 14,
    lightsOutHour: 23,
  });
});

test('a validated layout applies to a store, and a refused one changes nothing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-layout-'));
  const store = new Store(path.join(dir, 'state.json'));
  await store.load();

  const before = { ...store.settings, rooms: store.roomOrder() };
  assert.equal(before.theme, 'default');
  assert.deepEqual(before.rooms, []);

  // The refusal first, so nothing has moved when it is checked.
  const refused = validateLayout({ ...doc(), theme: 'midnight' });
  assert.equal(refused.ok, false);
  assert.equal(store.settings.theme, before.theme);
  assert.deepEqual(store.roomOrder(), []);

  const good = validateLayout(doc());
  assert.equal(good.ok, true);
  store.setSettings(settingsPatchFor(/** @type {any} */ (good).layout));
  store.setRoomOrder(/** @type {any} */ (good).layout.rooms);
  assert.equal(store.settings.theme, 'night shift');
  assert.equal(store.settings.goneHomeDays, 14);
  assert.equal(store.settings.lightsOutHour, 23);
  assert.deepEqual(store.roomOrder(), ['orbital-api', 'checkout-flow', 'design-system']);

  // And it survives a round trip through the file.
  await store.flush();
  const reopened = new Store(path.join(dir, 'state.json'));
  await reopened.load();
  assert.equal(reopened.settings.theme, 'night shift');
  assert.deepEqual(reopened.roomOrder(), ['orbital-api', 'checkout-flow', 'design-system']);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a hand-edited room order is sanitised the way every other stored value is', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-layout-'));
  const file = path.join(dir, 'state.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 1,
      layout: { rooms: ['ok-repo', '../etc/passwd', 'ok-repo', 42, null, 'other-repo'] },
      settings: { theme: '../../etc' },
    }),
  );
  const store = new Store(file);
  await store.load();
  assert.deepEqual(store.roomOrder(), ['ok-repo', 'other-repo']);
  assert.equal(store.settings.theme, 'default');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the store bounds the room order the same way the document does', () => {
  // Two constants, one meaning. `store.mjs` restates it rather than importing
  // it (the store is the bottom of the graph); this is what stops them
  // drifting.
  const src = fs.readFileSync(new URL('../../src/core/store.mjs', import.meta.url), 'utf8');
  const m = /const MAX_ROOM_ORDER = (\d+);/.exec(src);
  assert.ok(m, 'MAX_ROOM_ORDER is gone from store.mjs');
  assert.equal(Number(m[1]), MAX_ROOMS);
});

// ------------------------------------------------------------ the ordering

test('a room order moves the rooms it names and loses none of the others', () => {
  const projects = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.deepEqual(
    orderRooms(projects, ['c', 'a']).map((p) => p.id),
    ['c', 'a', 'b', 'd'],
    'named rooms lead, and the rest keep the order the scan produced',
  );
  // A room the order has never heard of is not dropped.
  assert.deepEqual(
    orderRooms(projects, ['zzz']).map((p) => p.id),
    ['a', 'b', 'c', 'd'],
  );
});

test('an empty order leaves the floor exactly as it was — which is why the goldens hold', () => {
  const projects = [{ id: 'a' }, { id: 'b' }];
  assert.equal(orderRooms(projects, []), projects, 'the array itself should come back');
  assert.equal(orderRooms(projects, /** @type {any} */ (null)), projects);
});

// --------------------------------------------------------------- the CLI

/** Collect what a `runLayout` run wrote. */
function recorder() {
  const out = [];
  const err = [];
  return {
    out,
    err,
    write: (s) => out.push(s),
    error: (s) => err.push(s),
    stdout: () => out.join(''),
    stderr: () => err.join(''),
  };
}

test('`layout export` writes the document to stdout and everything else to stderr', async () => {
  const rec = recorder();
  const code = await runLayout(['export'], {
    write: rec.write,
    error: rec.error,
    read: async () => ({ layout: buildLayout(snapshot()), source: 'daemon' }),
  });
  assert.equal(code, 0);
  // `deckhq layout export > my-floor.json` has to produce a parseable file.
  const parsed = JSON.parse(rec.stdout());
  assert.equal(validateLayout(parsed).ok, true);
  assert.match(rec.stderr(), /3 room\(s\), theme "night shift"/);
  assert.match(rec.stderr(), /not anonymous/);
});

test('`layout export` says so when it read from state.json instead of a daemon', async () => {
  const rec = recorder();
  await runLayout(['export'], {
    write: rec.write,
    error: rec.error,
    read: async () => ({ layout: buildLayout(snapshot()), source: 'state' }),
  });
  assert.match(rec.stderr(), /no daemon running/);
});

test('`layout import` refuses a malformed file without ever contacting the daemon', async () => {
  const rec = recorder();
  let posted = false;
  const code = await runLayout(['import', 'bad.json'], {
    write: rec.write,
    error: rec.error,
    readFile: () => JSON.stringify({ ...doc(), theme: 'midnight' }),
    find: async () => ({ port: 4317, snapshot: snapshot() }),
    post: async () => {
      posted = true;
      return { ok: true, status: 200, body: {} };
    },
  });
  assert.equal(code, 1);
  assert.equal(posted, false, 'a malformed layout was sent to the daemon anyway');
  assert.match(rec.stderr(), /this build does not have/);
  assert.match(rec.stderr(), /Nothing was changed/);
});

test('`layout import` needs a daemon, and says which one it needs', async () => {
  const rec = recorder();
  const code = await runLayout(['import', 'good.json'], {
    write: rec.write,
    error: rec.error,
    readFile: () => JSON.stringify(doc()),
    find: async () => null,
  });
  assert.equal(code, 2);
  assert.match(rec.stderr(), /start deckhq to import a layout/);
});

test("`layout import` reports the daemon's own refusal and changes nothing", async () => {
  const rec = recorder();
  const code = await runLayout(['import', 'good.json'], {
    write: rec.write,
    error: rec.error,
    readFile: () => JSON.stringify(doc()),
    find: async () => ({ port: 4317, snapshot: snapshot() }),
    post: async () => ({ ok: false, status: 400, body: { error: 'rooms lists "a" twice' } }),
  });
  assert.equal(code, 1);
  assert.match(rec.stderr(), /rooms lists "a" twice/);
  assert.match(rec.stderr(), /Nothing was changed/);
});

test('`layout import` applies a good file and says what landed', async () => {
  const rec = recorder();
  let sent = null;
  const code = await runLayout(['import', 'good.json'], {
    write: rec.write,
    error: rec.error,
    readFile: () => JSON.stringify(doc()),
    find: async () => ({ port: 4317, snapshot: snapshot() }),
    post: async (_port, body) => {
      sent = body;
      return { ok: true, status: 200, body: { ok: true, layout: body } };
    },
  });
  assert.equal(code, 0);
  assert.equal(validateLayout(sent).ok, true, 'the CLI sent something it had not validated');
  assert.match(rec.stdout(), /applied: theme "night shift", 3 room\(s\)/);
});

test('`layout` with no verb, a bad verb or --help explains itself', async () => {
  const none = recorder();
  assert.equal(await runLayout([], { write: none.write, error: none.error }), 2);
  assert.match(none.stdout(), /deckhq layout export/);

  const help = recorder();
  assert.equal(await runLayout(['--help'], { write: help.write, error: help.error }), 0);
  // The one thing the help has to say that nothing else does.
  assert.match(help.stdout(), /room COORDINATES/);

  const wrong = recorder();
  assert.equal(await runLayout(['frobnicate'], { write: wrong.write, error: wrong.error }), 2);
  assert.match(wrong.stderr(), /unknown: "frobnicate"/);

  const noFile = recorder();
  assert.equal(await runLayout(['import'], { write: noFile.write, error: noFile.error }), 2);
  assert.match(noFile.stderr(), /a file is required/);
});

test('`deckhq layout` is reachable from the CLI entry point and its help', () => {
  const bin = fs.readFileSync(new URL('../../bin/deckhq.mjs', import.meta.url), 'utf8');
  assert.match(bin, /layout: async \(rest\) =>/);
  assert.match(bin, /deckhq layout export \| show \| import/);
});
