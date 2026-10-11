/**
 * A PROJECT ROOM'S OWN SETTINGS: the popover its title bar opens
 * (`public/room-menu.js`), and where its choices are kept
 * (`src/core/room-settings.mjs`) — in the daemon's settings, validated on the
 * server, and NEVER in a look document.
 *
 * No browser: the popover is drawn over a stub document, and the store's own
 * sanitiser is asked what it would keep.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ROOM_AUTO,
  ROOM_COLOUR_IDS,
  ROOM_COLOUR_LABELS,
  createRoomMenu,
  roomExtraRows,
} from '../../public/room-menu.js';
import {
  ROOM_COLOUR_IDS as SERVER_COLOURS,
  ROOM_FIELDS,
  roomsProblem,
  sanitizeRooms,
} from '../../src/core/room-settings.mjs';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/core/store-settings.mjs';
import { buildLookDocument, parseLookDocument } from '../../src/core/look.mjs';
import { ZONE_HUES } from '../../public/render/look-ambience.js';
import { DEFAULT_LOOK } from '../../public/render/look-options.js';
import {
  applyLook,
  resetLook,
  roomAccentFor,
  roomSwatchFor,
  setRoomColours,
} from '../../public/render/look-derive.js';
import { StubNode, all, byRole, stubDocument, tick } from '../helpers/look-surfaces.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (/** @type {string} */ file) => fs.readFileSync(path.join(REPO, file), 'utf8');

/** A menu over a stub document, with every action and every write recorded. */
function mount(/** @type {any} */ over = {}) {
  const doc = stubDocument();
  doc.documentElement = { clientWidth: 1600 };
  // The document's own listeners, kept so a test can press Escape or outside.
  /** @type {Record<string, Function[]>} */
  const heard = {};
  doc.addEventListener = (/** @type {string} */ n, /** @type {Function} */ fn) =>
    void (heard[n] ||= []).push(fn);
  doc.removeEventListener = (/** @type {string} */ n, /** @type {Function} */ fn) =>
    void (heard[n] = (heard[n] || []).filter((f) => f !== fn));
  doc.fire = (/** @type {string} */ n, /** @type {any} */ e) => {
    for (const fn of [...(heard[n] || [])]) fn(e);
  };
  const hostEl = new StubNode('div', doc);
  hostEl.hidden = true;
  const snapshot = {
    projects: [
      { id: 'C:/work/orbital-api', name: 'orbital-api', pinned: false },
      { id: 'C:/work/docs', name: 'docs', pinned: true },
    ],
    settings: { rooms: over.rooms || {}, look: DEFAULT_LOOK },
  };
  /** @type {any[]} */
  const calls = [];
  /** @type {any[]} */
  const saves = [];
  const act =
    (/** @type {string} */ name) =>
    (/** @type {any[]} */ ...args) =>
      void calls.push([name, ...args]);
  const menu = createRoomMenu({
    doc,
    hostEl,
    getSnapshot: () => snapshot,
    anchorFor: () => ({ x: 300, y: 140, w: 400, h: 22 }),
    actions: {
      filterToProject: act('filter'),
      newAgent: act('new'),
      pinProject: act('pin'),
      showWhiteboard: act('board'),
      revealFolder: act('folder'),
    },
    saveSetting: async (/** @type {any} */ patch) => {
      saves.push(patch);
      Object.assign(snapshot.settings, patch);
      return snapshot.settings;
    },
    colours: ROOM_COLOUR_IDS,
    extraRows: over.extraRows,
    coloursShown: over.coloursShown,
  });
  const buttons = () =>
    all(hostEl).filter((n) => n.tagName === 'BUTTON' && n.getAttribute('role') !== 'radio');
  const label = (/** @type {any} */ b) => b.children[0].textContent;
  return { doc, hostEl, menu, snapshot, calls, saves, buttons, label };
}

test('the popover is the room’s: its name, its rows in order, and the old plate’s filter kept as the first of them', () => {
  const m = mount();
  assert.equal(m.menu.open('C:/work/orbital-api'), true);
  assert.equal(m.hostEl.hidden, false);
  assert.equal(m.hostEl.getAttribute('aria-label'), 'Room settings: orbital-api');
  assert.deepEqual(m.buttons().map(m.label), [
    'Show only this room',
    'New agent here',
    'Pin this room',
    'Open the board',
    'Open folder',
  ]);
  // Opening puts the keyboard on the first row, and it is anchored under the bar.
  assert.equal(m.label(m.doc.activeElement), 'Show only this room');
  assert.deepEqual([m.hostEl.style.left, m.hostEl.style.top], ['300px', '168px']);
  // A press on a row does the thing and closes: the filter is not lost.
  m.buttons()[0].fire('click');
  assert.deepEqual(m.calls, [['filter', 'C:/work/orbital-api']]);
  assert.equal(m.menu.isOpen(), false);
  for (const [i, want] of [
    [1, ['new', 'C:/work/orbital-api']],
    [2, ['pin', 'C:/work/orbital-api', true]],
    [3, ['board', 'C:/work/orbital-api']],
    [4, ['folder', 'C:/work/orbital-api']],
  ]) {
    m.calls.length = 0;
    m.menu.open('C:/work/orbital-api');
    m.buttons()[/** @type {number} */ (i)].fire('click');
    assert.deepEqual(m.calls, [want]);
  }
  // A pinned room offers the way out of it, and a room that is not there does not open.
  m.menu.open('C:/work/docs');
  assert.equal(m.label(m.buttons()[2]), 'Unpin');
  m.buttons()[2].fire('click');
  assert.deepEqual(m.calls.at(-1), ['pin', 'C:/work/docs', false]);
  assert.equal(m.menu.open('C:/work/gone'), false);
});

test('ROOM COLOUR is Auto or one of the six hues, for THIS room, and it is written to settings.rooms — never to a look', async () => {
  const m = mount({ rooms: { 'C:/work/docs': { colour: 'mint' } } });
  m.menu.open('C:/work/orbital-api');
  const group = byRole(m.hostEl, 'radiogroup')[0];
  assert.equal(group.getAttribute('aria-label'), 'Room colour');
  const radios = byRole(group, 'radio');
  assert.deepEqual(
    radios.map((r) => r.textContent),
    ['Auto', 'Sage', 'Powder', 'Lilac', 'Mint', 'Straw', 'Rose'],
  );
  assert.equal(radios[0].getAttribute('aria-checked'), 'true', 'a room nobody set is Auto');
  radios[6].fire('click');
  await tick();
  // The WHOLE map goes, with the other room's choice untouched.
  assert.deepEqual(m.saves, [
    { rooms: { 'C:/work/docs': { colour: 'mint' }, 'C:/work/orbital-api': { colour: 'rose' } } },
  ]);
  assert.equal(Object.keys(m.saves[0]).join(), 'rooms', 'a room’s colour touched another setting');
  assert.equal(m.menu.isOpen(), true, 'choosing a colour does not close the popover');
  const now = byRole(byRole(m.hostEl, 'radiogroup')[0], 'radio');
  assert.equal(now[6].getAttribute('aria-checked'), 'true');
  // Auto is not stored: the room leaves the map.
  now[0].fire('click');
  await tick();
  assert.deepEqual(m.saves.at(-1), { rooms: { 'C:/work/docs': { colour: 'mint' } } });
  // Where rooms are not coloured at all, the row says when it will show.
  const off = mount({ coloursShown: () => false });
  off.menu.open('C:/work/orbital-api');
  assert.ok(all(off.hostEl).some((n) => n.textContent === 'shows when Room colours is on'));
});

test('THE SLOT: this build has no per-room rows; a build that has is drawn between the colour and the room’s places', () => {
  assert.deepEqual(
    roomExtraRows({ project: {}, room: {}, parts: null, setRoom: async () => {} }),
    [],
  );
  const m = mount({
    extraRows: (/** @type {any} */ ctx) => [
      {
        id: 'agentStyle',
        label: 'Agent style',
        node: ctx.parts.radioGroup({
          name: 'agentStyle',
          label: 'Agent style',
          className: 'lookbar-seg',
          itemClass: 'lookbar-seg-btn',
          options: [{ id: 'a', label: 'A' }],
          value: 'a',
          onChange: () => {},
        }),
      },
    ],
  });
  m.menu.open('C:/work/orbital-api');
  assert.deepEqual(
    byRole(m.hostEl, 'radiogroup').map((g) => g.getAttribute('aria-label')),
    ['Room colour', 'Agent style'],
  );
  const bad = mount({
    extraRows: () => {
      throw new Error('a private row fell over');
    },
  });
  assert.doesNotThrow(() => bad.menu.open('C:/work/orbital-api'));
  assert.equal(bad.buttons().length, 5);
});

test('Escape closes it and hands the keyboard back; a press outside closes it; the floor’s keys stand down inside it', () => {
  const m = mount();
  const before = new StubNode('button', m.doc);
  before.focus();
  m.menu.open('C:/work/orbital-api');
  let stopped = 0;
  m.hostEl.fire('keydown', { key: 'b', stopPropagation: () => stopped++ });
  assert.equal(stopped, 1, '`B` with the popover open reached the floor');
  let prevented = 0;
  m.doc.fire('keydown', { key: 'Escape', preventDefault: () => prevented++, stopPropagation() {} });
  assert.equal(m.menu.isOpen(), false);
  assert.equal(prevented, 1);
  assert.equal(m.doc.activeElement, before, 'the keyboard was not handed back');
  m.menu.open('C:/work/orbital-api');
  m.doc.fire('pointerdown', { target: new StubNode('div', m.doc) });
  assert.equal(m.menu.isOpen(), false);
});

// ------------------------------------------------------- where it is kept

test('the store keeps a room’s choices like every setting: known fields at known values, and nothing else', () => {
  assert.deepEqual(DEFAULT_SETTINGS.rooms, {}, 'a floor nobody touched has no rooms set');
  assert.deepEqual(
    [...ROOM_COLOUR_IDS],
    [...SERVER_COLOURS],
    'the popover and the server name different hues',
  );
  assert.deepEqual(
    [...SERVER_COLOURS],
    ZONE_HUES.map((h) => h.id),
    'a room may be a hue the floor does not have',
  );
  for (const id of ROOM_COLOUR_IDS) assert.ok(ROOM_COLOUR_LABELS[id], `${id} has no name`);
  assert.deepEqual(Object.keys(ROOM_FIELDS), ['colour']);
  const dirty = {
    'C:/work/a': { colour: 'rose', agentStyle: 'brick', other: 1 },
    'C:/work/b': { colour: 'chartreuse' },
    'C:/work/c': { colour: ROOM_AUTO },
    'C:/work/d': 'rose',
    '': { colour: 'sage' },
    ['x'.repeat(600)]: { colour: 'sage' },
  };
  assert.deepEqual(sanitizeRooms(dirty), { 'C:/work/a': { colour: 'rose' } });
  assert.deepEqual(sanitizeRooms(null), {});
  assert.deepEqual(sanitizeRooms([{ colour: 'rose' }]), {});
  // Idempotent, and it is the pass a state file read from disk goes through.
  assert.deepEqual(sanitizeRooms(sanitizeRooms(dirty)), sanitizeRooms(dirty));
  assert.deepEqual(sanitizeSettings({ rooms: dirty }).rooms, { 'C:/work/a': { colour: 'rose' } });
  assert.deepEqual(sanitizeSettings({}).rooms, {}, 'an older state file loads with no rooms set');
});

test('the settings route tells a caller what is wrong with a room’s choice instead of quietly dropping it', () => {
  assert.equal(roomsProblem({ 'C:/work/a': { colour: 'rose' } }), '');
  assert.equal(roomsProblem({ 'C:/work/a': { colour: ROOM_AUTO } }), '');
  assert.equal(roomsProblem({}), '');
  assert.match(roomsProblem([]), /must be an object/);
  assert.match(roomsProblem({ a: 'rose' }), /must be an object/);
  assert.match(roomsProblem({ a: { colour: 'chartreuse' } }), /colour must be auto or one of sage/);
  assert.match(roomsProblem({ a: { tint: 'rose' } }), /tint is not something a room can be set to/);
  const route = read('src/http/routes/settings.mjs');
  assert.match(
    route,
    /if \(k === 'rooms'\) \{\s*const problem = roomsProblem\(v\);\s*if \(problem\) return sendError\(res, 400, problem\);/,
  );
});

test('A LOOK NAMES NO PROJECT: a room’s choices never reach a look document, in or out', () => {
  const doc = buildLookDocument({
    look: DEFAULT_LOOK,
    rooms: { 'C:/work/orbital-api': { colour: 'rose' } },
  });
  const text = JSON.stringify(doc);
  assert.ok(!('rooms' in doc), 'the look document carries a rooms key');
  assert.doesNotMatch(text, /orbital-api|C:\/work|rose/);
  // And one handed a `rooms` key is not a look this build will import as one.
  const back = parseLookDocument(JSON.stringify({ ...doc, rooms: { a: { colour: 'rose' } } }));
  assert.ok(!('ok' in back) || !('rooms' in (back.look || {})), 'a look import carried rooms in');
  // The client writes it through the settings route and nowhere else.
  const menu = read('public/room-menu.js');
  assert.match(menu, /saveSetting\(\{ rooms \}\)/);
  assert.doesNotMatch(menu, /api\/look|choosePath|lookStore/);
});

test('the floor paints a room in the hue it was given, and every other room as its number deals it', () => {
  try {
    const resolved = applyLook({ ...DEFAULT_LOOK, roomTint: 'zoned' }, 'default');
    const dealt = [1, 2, 3].map((n) => roomAccentFor(resolved, n));
    assert.equal(setRoomColours([{ projectMk: 2, colour: 'rose' }]), true);
    assert.equal(
      setRoomColours([{ projectMk: 2, colour: 'rose' }]),
      false,
      'the same answer re-bakes the floor',
    );
    const rose = resolved.roomTint.accents[ZONE_HUES.findIndex((h) => h.id === 'rose')];
    assert.deepEqual(
      [1, 2, 3].map((n) => roomAccentFor(resolved, n)),
      [dealt[0], rose, dealt[2]],
    );
    assert.equal(
      roomSwatchFor('rose'),
      rose,
      'the popover’s dot is not the colour the room is painted',
    );
    assert.equal(roomSwatchFor('chartreuse'), '');
    // A hue the floor does not have is no override at all.
    setRoomColours([{ projectMk: 2, colour: 'chartreuse' }]);
    assert.equal(roomAccentFor(resolved, 2), dealt[1]);
  } finally {
    setRoomColours([]);
    resetLook();
  }
});

test('the room is reachable from the keys: the palette has its settings and its board, and the floor routes the bar to the popover', () => {
  const palette = read('public/palette.js');
  assert.match(palette, /label: `Room settings: \$\{name\}`/);
  assert.match(palette, /run: \(\) => actions\.roomSettings\(p\.id\)/);
  assert.match(palette, /label: `Open the board: \$\{name\}`/);
  assert.match(
    read('public/app-floor.js'),
    /if \(sel\.kind === 'project'\) return openRoomSettings\(sel\.id\);/,
  );
  assert.match(read('public/index.html'), /id="room-popover" role="dialog" hidden/);
});
