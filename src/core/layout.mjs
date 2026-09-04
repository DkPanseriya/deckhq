/**
 * The layout document — WP-30's second half.
 *
 *     deckhq layout export > my-floor.json
 *     deckhq layout import my-floor.json
 *
 * A layout is the arrangement of the floor, separated from what is ON it. It
 * carries the theme, the order the rooms are laid out in, which rooms the user
 * has folded into the idle strip, and the two floor preferences that decide
 * what is drawn at all. It carries no session, no transcript, no
 * acknowledgement and no name.
 *
 * ## What is NOT in it, and why
 *
 * **Pinned room positions.** The plan has none to export. Rooms are not placed
 * by coordinate: `public/render/plan.js` deals them into bands and then
 * treemaps each band by area, so a room's position is a function of how many
 * people are in it and how big its neighbours are (`docs/DEVIATIONS.md` §96,
 * §106 — the building is the size of its contents). There is no `x`,`y` a user
 * can set and therefore none to write down. What the plan DOES honour is the
 * ORDER it receives the projects in, which is what `rooms` below is: move a
 * room up the list and it is dealt into an earlier band. When pinning exists,
 * this document grows a `positions` key and the version goes to 2.
 *
 * **Anything a session owns.** An `ack` is a user-owned state and only
 * `act()` may write one (`docs/01-PRODUCT.md` §2). A layout file that could
 * clear an acknowledgement would be a second writer against the invariant.
 *
 * ## Atomicity
 *
 * `validateLayout` returns the whole document or one error, and the applier
 * writes nothing until it has the whole document. A malformed file is refused
 * with the reason and changes NOTHING — not the theme, not one room's order,
 * not one preference. That is the acceptance criterion this module exists for,
 * and `test/unit/layout-io.test.mjs` asserts it against eleven bad files.
 *
 * ## One privacy note, stated rather than discovered
 *
 * A project id is a slug of its working directory (`projectIdFromCwd`), so a
 * layout file names your project folders. It is a file you asked for and it
 * goes where you send it — but it is not anonymous, and `deckhq layout export`
 * says so on stderr rather than letting somebody find out by pasting one.
 */

import { DEFAULT_THEME_NAME, isKnownTheme, themeByName } from './themes.mjs';

/** The document's `kind`. Present so a file dropped on the importer by mistake fails on line one. */
export const LAYOUT_KIND = 'deckhq.layout';

/** The document version this build writes and reads. */
export const LAYOUT_VERSION = 1;

/** More rooms than any machine has ever had; a bound, not a limit anybody meets. */
export const MAX_ROOMS = 512;

/** Longest document we will look at, in bytes. A 512-room layout is under 32 kB. */
export const MAX_LAYOUT_BYTES = 256 * 1024;

/** A project id is a slug of a path — `projectIdFromCwd`'s alphabet, and nothing else. */
const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]{0,127}$/;

/** The floor preferences a layout carries, and the range each is legal in. */
export const LAYOUT_PREFERENCES = Object.freeze({
  /** Days of silence after which a benched agent is not DRAWN (WP-50). 0 draws everybody. */
  goneHomeDays: { min: 0, max: 365 },
  /** The hour the floor dims and the day's card appears (WP-18). */
  lightsOutHour: { min: 0, max: 23 },
});

/**
 * @param {unknown} v
 * @returns {v is Record<string, any>} a type predicate, so the checker narrows
 *   `unknown` the same way the code below already reads
 */
function isPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/**
 * @typedef {object} LayoutDocument
 * @property {string} kind
 * @property {number} version
 * @property {string} theme
 * @property {string[]} rooms          project ids, in the order the floor lays them out
 * @property {string[]} archivedRooms  rooms folded into the idle strip
 * @property {Record<string, number>} floor  the preferences above
 */

/**
 * Build a layout document from a snapshot and the settings that go with it.
 * Pure: it reads, it never writes.
 *
 * @param {{projects?: any[], settings?: any}} snapshot
 * @returns {LayoutDocument}
 */
export function buildLayout(snapshot) {
  const projects = Array.isArray(snapshot?.projects) ? snapshot.projects : [];
  const settings = snapshot?.settings || {};
  /** @type {string[]} */
  const rooms = [];
  /** @type {string[]} */
  const archivedRooms = [];
  for (const p of projects) {
    const id = String(p?.id ?? '');
    if (!PROJECT_ID_RE.test(id) || rooms.includes(id)) continue;
    rooms.push(id);
    if (p?.archived) archivedRooms.push(id);
    if (rooms.length >= MAX_ROOMS) break;
  }
  return {
    kind: LAYOUT_KIND,
    version: LAYOUT_VERSION,
    theme: themeByName(settings.theme)?.name || DEFAULT_THEME_NAME,
    rooms,
    archivedRooms,
    floor: {
      goneHomeDays: clamp(settings.goneHomeDays, LAYOUT_PREFERENCES.goneHomeDays, 7),
      lightsOutHour: clamp(settings.lightsOutHour, LAYOUT_PREFERENCES.lightsOutHour, 22),
    },
  };
}

/**
 * @param {unknown} v
 * @param {{min:number, max:number}} range
 * @param {number} fallback
 */
function clamp(v, range, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(n)));
}

/**
 * Validate a parsed layout document.
 *
 * Every failure names the field and says what was expected, because the person
 * reading it is holding a file they hand-edited. Nothing is coerced and
 * nothing is dropped: a document with a key this build does not know is
 * refused, so a layout written by a LATER build fails loudly here instead of
 * being applied with half of its meaning missing.
 *
 * @param {unknown} doc
 * @returns {{ok:true, layout:LayoutDocument} | {ok:false, error:string}}
 */
export function validateLayout(doc) {
  if (!isPlainObject(doc)) return { ok: false, error: 'a layout must be a JSON object' };
  if (doc.kind !== LAYOUT_KIND) {
    return {
      ok: false,
      error: `this is not a DeckHQ layout: "kind" is ${JSON.stringify(doc.kind)}, expected "${LAYOUT_KIND}"`,
    };
  }
  if (doc.version !== LAYOUT_VERSION) {
    return {
      ok: false,
      error: `layout version ${JSON.stringify(doc.version)}; this build reads version ${LAYOUT_VERSION}`,
    };
  }

  const known = ['kind', 'version', 'theme', 'rooms', 'archivedRooms', 'floor'];
  const extra = Object.keys(doc).filter((k) => !known.includes(k));
  if (extra.length) {
    return { ok: false, error: `layout carries unknown field(s): ${extra.join(', ')}` };
  }

  if (typeof doc.theme !== 'string' || !isKnownTheme(doc.theme)) {
    return {
      ok: false,
      error: `layout names theme ${JSON.stringify(doc.theme)}, which this build does not have`,
    };
  }

  const rooms = readIdList(doc.rooms, 'rooms');
  if ('error' in rooms) return { ok: false, error: rooms.error };
  const archived = readIdList(doc.archivedRooms, 'archivedRooms');
  if ('error' in archived) return { ok: false, error: archived.error };

  // An archived room the order does not mention is a contradiction, not a
  // detail: applying it would fold a room the document never claimed exists.
  const orphan = archived.ids.find((id) => !rooms.ids.includes(id));
  if (orphan) {
    return { ok: false, error: `archivedRooms names "${orphan}", which is not in rooms` };
  }

  if (!isPlainObject(doc.floor)) return { ok: false, error: 'layout has no "floor" object' };
  /** @type {Record<string, number>} */
  const floor = {};
  for (const [key, value] of Object.entries(doc.floor)) {
    const range = /** @type {any} */ (LAYOUT_PREFERENCES)[key];
    if (!range) {
      return {
        ok: false,
        error: `layout sets floor.${key}, which is not a floor preference. floor takes: ${Object.keys(LAYOUT_PREFERENCES).join(', ')}`,
      };
    }
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
      return {
        ok: false,
        error: `floor.${key} must be a whole number, not ${JSON.stringify(value)}`,
      };
    }
    if (value < range.min || value > range.max) {
      return { ok: false, error: `floor.${key} is ${value}; it must be ${range.min}–${range.max}` };
    }
    floor[key] = value;
  }
  const missing = Object.keys(LAYOUT_PREFERENCES).filter((k) => !(k in floor));
  if (missing.length)
    return { ok: false, error: `layout is missing floor.${missing.join(', floor.')}` };

  return {
    ok: true,
    layout: {
      kind: LAYOUT_KIND,
      version: LAYOUT_VERSION,
      theme: /** @type {any} */ (themeByName(doc.theme)).name,
      rooms: rooms.ids,
      archivedRooms: archived.ids,
      floor,
    },
  };
}

/**
 * @param {unknown} value
 * @param {string} field
 * @returns {{ids:string[]} | {error:string}}
 */
function readIdList(value, field) {
  if (!Array.isArray(value)) return { error: `"${field}" must be an array of project ids` };
  if (value.length > MAX_ROOMS) {
    return { error: `"${field}" has ${value.length} entries; the limit is ${MAX_ROOMS}` };
  }
  /** @type {string[]} */
  const ids = [];
  for (const raw of value) {
    if (typeof raw !== 'string' || !PROJECT_ID_RE.test(raw)) {
      return {
        error: `"${field}" contains ${JSON.stringify(raw)}, which is not a project id (lower-case letters, digits and hyphens)`,
      };
    }
    if (ids.includes(raw)) return { error: `"${field}" lists "${raw}" twice` };
    ids.push(raw);
  }
  return { ids };
}

/**
 * Parse and validate a layout from raw text. The size bound is checked before
 * `JSON.parse` so a hostile file cannot spend the process's memory on the way
 * to being rejected.
 * @param {string} text
 * @returns {{ok:true, layout:LayoutDocument} | {ok:false, error:string}}
 */
export function parseLayout(text) {
  const src = String(text ?? '');
  if (src.length > MAX_LAYOUT_BYTES) {
    return { ok: false, error: `layout is ${src.length} bytes; the limit is ${MAX_LAYOUT_BYTES}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(src);
  } catch (err) {
    return { ok: false, error: `not valid JSON: ${/** @type {Error} */ (err).message}` };
  }
  return validateLayout(parsed);
}

/**
 * The settings patch a validated layout implies. Separated from the applier so
 * the shape of "what a layout changes" is one readable list rather than
 * something spread across a route.
 * @param {LayoutDocument} layout
 */
export function settingsPatchFor(layout) {
  return {
    theme: layout.theme,
    goneHomeDays: layout.floor.goneHomeDays,
    lightsOutHour: layout.floor.lightsOutHour,
  };
}
