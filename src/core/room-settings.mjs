/**
 * WHAT ONE PROJECT ROOM IS SET TO — the per-project choices behind the room's
 * title bar: today, which of the six zone hues the room is painted in.
 *
 * THEY ARE SETTINGS, AND NOT PART OF THE LOOK. A look document names no
 * project, no path and no session, which is what makes it safe to export and
 * post (`look.mjs`); a room's own colour is keyed by a project's id, which is
 * derived from a path on this machine. So it lives in the daemon's settings
 * under `rooms`, a map of project id to that room's choices, and
 * `look-io.test.mjs` holds that nothing here ever reaches a look.
 *
 * ONE TABLE, so a build that carries more per-room choices adds a field here
 * and nowhere else: `ROOM_FIELDS` says which fields a room may carry and what
 * each may be. A field left at its automatic answer is not stored at all, and
 * a room with nothing stored is not in the map — so a floor nobody has
 * touched has `rooms: {}`.
 *
 * Validated like every setting: the store runs `sanitizeRooms` on everything
 * it reads or is handed (a hand-edited state.json included), and the settings
 * route asks `roomsProblem` first so a caller is told rather than silently
 * corrected.
 */

import { ZONE_HUES } from '../../public/render/look-ambience.js';

/** The word for "let the floor decide": never stored. */
export const ROOM_AUTO = 'auto';

/** The six hues a room may be painted in, by id, in the floor's own order. */
export const ROOM_COLOUR_IDS = Object.freeze(ZONE_HUES.map((h) => h.id));

/**
 * The fields one room may carry, and the values each may take.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const ROOM_FIELDS = Object.freeze({
  colour: ROOM_COLOUR_IDS,
});

/** How many rooms may carry choices, and how long a project id may be. */
export const MAX_ROOMS_SET = 500;
export const MAX_ROOM_ID = 512;

const plain = (/** @type {unknown} */ v) =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Why a `rooms` value cannot be stored, or `''` when it can. For the route.
 * @param {unknown} v
 * @returns {string}
 */
export function roomsProblem(v) {
  if (!plain(v)) return 'rooms must be an object of project id to that room’s choices';
  const entries = Object.entries(/** @type {Record<string, unknown>} */ (v));
  if (entries.length > MAX_ROOMS_SET) return `rooms may carry at most ${MAX_ROOMS_SET} rooms`;
  for (const [id, room] of entries) {
    if (!id || id.length > MAX_ROOM_ID) return 'rooms: a project id is empty or too long';
    if (!plain(room)) return `rooms: the choices for ${id} must be an object`;
    for (const [field, value] of Object.entries(/** @type {Record<string, unknown>} */ (room))) {
      const allowed = ROOM_FIELDS[field];
      if (!allowed) return `rooms: ${field} is not something a room can be set to`;
      if (value !== ROOM_AUTO && !allowed.includes(String(value))) {
        return `rooms: ${field} must be ${ROOM_AUTO} or one of ${allowed.join(', ')}`;
      }
    }
  }
  return '';
}

/**
 * Coerce a `rooms` value into what the store keeps: known fields at known
 * values, automatic answers and empty rooms dropped. Total and idempotent.
 * @param {unknown} v
 * @returns {Record<string, Record<string, string>>}
 */
export function sanitizeRooms(v) {
  /** @type {Record<string, Record<string, string>>} */
  const out = {};
  if (!plain(v)) return out;
  let kept = 0;
  for (const [id, room] of Object.entries(/** @type {Record<string, unknown>} */ (v))) {
    if (!id || id.length > MAX_ROOM_ID || !plain(room) || kept >= MAX_ROOMS_SET) continue;
    /** @type {Record<string, string>} */
    const clean = {};
    for (const [field, allowed] of Object.entries(ROOM_FIELDS)) {
      const value = /** @type {Record<string, unknown>} */ (room)[field];
      if (typeof value === 'string' && allowed.includes(value)) clean[field] = value;
    }
    if (Object.keys(clean).length) {
      out[id] = clean;
      kept++;
    }
  }
  return out;
}
