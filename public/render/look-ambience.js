/**
 * THE THREE CHOICES ABOUT THE BUILDING ITSELF — G6a.
 * `docs/plan/graphics/04-options.md` §2, `03-art-direction.md` §1.1, §2.2, §4.
 *
 * A look used to be finishes: what the floor, the furniture and the rugs are
 * made of. These three are about the room the finishes are in — where the light
 * comes from, what stands between two rooms, and how much of a project's own
 * colour its floor carries.
 *
 * ## What paints from this file
 *
 * The light and the partitions are drawn: `backdrop-paint.js` casts along the
 * mood's direction, `backdrop-light.js` lays its daylight, and
 * `backdrop-floor.js` builds the wall between two rooms in the chosen style.
 * The room tint is named, measured and carried, and its picker stays `pending`
 * in `look-options.js` until a painter reads it. **One option of each table is
 * the default** — the `DEFAULT_*` beside it.
 *
 * Every row is a number a painter is held to. They are plan units and plain
 * ratios, so a test can read them and a painter cannot grow a second opinion.
 *
 * Pure data. No DOM, no canvas.
 */

import { CARPET_IDENTITY_WASH, LIGHT_DIR } from './palette-colors.js';
import {
  LIGHT_POOL_ALPHA_DARK,
  LIGHT_POOL_ALPHA_LIGHT,
  LIGHT_POOL_COLOR,
} from './themes-derive.js';

/** A frozen table keyed by `id`. @param {Array<Record<string, any>>} rows */
function table(rows) {
  return Object.freeze(
    /** @type {any} */ (Object.fromEntries(rows.map((r) => [r.id, Object.freeze(r)]))),
  );
}

// ------------------------------------------------------------------ light

/**
 * ONE LIGHT, THREE POSITIONS.
 *
 * `angle` is measured from the +x axis toward +y, so all three point down and
 * to the right and the floor's one-direction rule survives the choice. `dir` is
 * that angle as a unit vector, written in closed form rather than through
 * `Math.cos` so `noon` is `LIGHT_DIR` itself and not a neighbour of it one bit
 * away. `cast` multiplies the length of every shadow a tall thing throws.
 *
 * `patch` is the colour of daylight where it lands, and the two alphas are how
 * much of it a light theme and a dark theme take. **Noon is the desk pool the
 * floor already bakes**, by reference: the three constants are imported, so the
 * shipped light and the option that names it cannot drift apart.
 *
 * @type {Readonly<Record<string, {id:string, label:string, angle:number,
 *   dir:Readonly<{x:number, y:number}>, cast:number, patch:string,
 *   alphaLight:number, alphaDark:number}>>}
 */
export const LIGHT_MOODS = table([
  {
    id: 'morning',
    label: 'Morning',
    angle: 30,
    dir: Object.freeze({ x: Math.sqrt(3) / 2, y: 0.5 }),
    cast: 1.5,
    patch: '#EAF1FF',
    alphaLight: 0.11,
    alphaDark: 0.05,
  },
  {
    id: 'noon',
    label: 'Noon',
    angle: 45,
    dir: LIGHT_DIR,
    cast: 1,
    patch: LIGHT_POOL_COLOR,
    alphaLight: LIGHT_POOL_ALPHA_LIGHT,
    alphaDark: LIGHT_POOL_ALPHA_DARK,
  },
  {
    id: 'evening',
    label: 'Evening',
    angle: 60,
    dir: Object.freeze({ x: 0.5, y: Math.sqrt(3) / 2 }),
    cast: 1.7,
    patch: '#FFD7A0',
    alphaLight: 0.12,
    alphaDark: 0.06,
  },
]);

/** Every mood's id, in the order of a day. @type {ReadonlyArray<string>} */
export const LIGHT_MOOD_IDS = Object.freeze(Object.keys(LIGHT_MOODS));

/** The mood the floor ships in. */
export const DEFAULT_LIGHT = 'noon';

/**
 * How bright a patch of daylight may be against the floor it lands on. A dark
 * theme's desk pool already sits a little under this, and no mood may be the
 * loudest thing on a floor whose loudest thing is supposed to be a person.
 */
export const DAYLIGHT_MAX_CONTRAST = 1.18;

/**
 * WHERE THE FLOOR IS DARKER, AWAY FROM ITS WINDOWS.
 *
 * A patch on a pale floor can only be a few per cent brighter than the floor —
 * the wall is the ceiling on brightness — so a room is also allowed to fall
 * away from its light: nothing at the lit wall, this colour at this alpha on
 * the far side. Five per cent is the cap, measured: at seven the far side of a
 * pale floor steps over the value plateau a floor material is held to.
 */
export const DAYLIGHT_FALLOFF = '#20160A';
export const DAYLIGHT_FALLOFF_ALPHA = 0.05;
/** The far side of a room against its own bare floor, at most: 1.10:1 to two places. */
export const DAYLIGHT_FALLOFF_MAX_CONTRAST = 1.105;

/** A window pane and the mullion between two, along the wall. Plan units. */
export const PANE_U = 3.2;
export const MULLION_U = 0.4;
/** Glazing stops this far short of a corner or a partition. */
export const WINDOW_INSET_U = 1.2;

/** A patch of daylight is this long at noon, before the mood's cast. */
export const PATCH_LENGTH_U = 5;
/** …and its far end fades to nothing over this share of its length. */
export const PATCH_FEATHER = 0.4;
/** A room takes at most this many. */
export const PATCHES_PER_ROOM = 3;
/** The corner a room's plate is read in. No patch lies over it. */
export const PLATE_BOX_U = Object.freeze({ w: 14, h: 3 });

/** A windowless room's skylight: its size, its set-off toward the light, its share of a patch. */
export const SKYLIGHT_U = Object.freeze({ w: 6, h: 3.5 });
export const SKYLIGHT_OFFSET_U = 1.5;
export const SKYLIGHT_ALPHA = 0.8;

/** A room with the lights off keeps this much of its daylight. */
export const DAYLIGHT_DIM = 0.5;

/**
 * SHADE AT THE FOOT OF A WALL: a ramp this deep, this dark at the wall, and
 * this much deeper under the two walls the light comes over.
 */
export const AO_DEPTH_U = 0.45;
export const AO_ALPHA = 0.1;
export const AO_LIT_SIDE = 1.6;

// ------------------------------------------------------------- partitions

/**
 * WHAT STANDS BETWEEN TWO ROOMS. The building's outer wall is not a choice.
 *
 * `solid` is a band of the partition colour that casts like a wall.
 * `glass` is two hairlines with a sheet between them
 * and a post at intervals; it throws no shadow. `low` is a
 * waist-high band that stops short of each corner, and it keeps the hairline on
 * both edges — see `LOW_PARTITION_READS_MIN` for why that is not decoration.
 *
 * `bandU` is the thickness, `cast` the shadow length in plan units before the
 * mood multiplies it, `frame` whether the edges carry the frame line, `glazed`
 * whether the band is filled with the glass sheet, `postU` and `postEveryU` the
 * posts, `insetU` how far short of a corner the band stops.
 *
 * @type {Readonly<Record<string, {id:string, label:string, bandU:number,
 *   cast:number, frame:boolean, glazed:boolean, postU:number, postEveryU:number,
 *   insetU:number}>>}
 */
export const PARTITION_STYLES = table([
  {
    id: 'solid',
    label: 'Solid',
    bandU: 0.3,
    cast: 0.22,
    frame: false,
    glazed: false,
    postU: 0,
    postEveryU: 0,
    insetU: 0,
  },
  {
    id: 'glass',
    label: 'Glass',
    bandU: 0.12,
    cast: 0,
    frame: true,
    glazed: true,
    postU: 0.2,
    postEveryU: 4,
    insetU: 0,
  },
  {
    id: 'low',
    label: 'Low',
    bandU: 0.3,
    cast: 0.1,
    frame: true,
    glazed: false,
    postU: 0,
    postEveryU: 0,
    insetU: 1.5,
  },
]);

/** Every style's id, in picker order. @type {ReadonlyArray<string>} */
export const PARTITION_STYLE_IDS = Object.freeze(Object.keys(PARTITION_STYLES));

/** The style the floor ships in. */
export const DEFAULT_PARTITIONS = 'solid';

/** The frame line is the line work, moved this far toward the partition. */
export const GLASS_FRAME_MIX = 0.38;

/** What a sheet of glass is tinted toward, how far, and how much of it shows. */
export const GLASS_TINT = '#9DB6C6';
export const GLASS_TINT_MIX = 0.5;
export const GLASS_FILL_ALPHA = 0.22;

/** A window pane: the wall, moved this far toward the glass tint. */
export const WINDOW_PANE_MIX = 0.6;

/** A doorway: how much wall stops for it, and how long the leaf is. Plan units. */
export const DOOR_OPENING_U = 2.4;
export const DOOR_LEAF_U = 2.2;
/** How far open a leaf is drawn, in degrees, and how faint its swing is. */
export const DOOR_OPEN_DEG = 30;
export const DOOR_SWING_ALPHA = 0.25;

/** A baseboard is its own floor, this much darker. */
export const BASEBOARD_SHADE = -0.1;

/** A frame line has to be a visible line on both floors it divides. */
export const FRAME_ON_FLOOR_MIN = 3;

/**
 * …and it may not compete with a name. The line work stays the strongest mark
 * on a floor by at least this much over a frame.
 */
export const INK_OVER_FRAME_MIN = 1.5;

/**
 * A low partition's top is the partition colour, and on some floors that is
 * very nearly the floor's own value. Under this ratio the top alone does not
 * read, so a style without a frame line would be a divider nobody can see.
 */
export const LOW_PARTITION_READS_MIN = 1.04;

// --------------------------------------------------------------- room tint

/**
 * HOW MUCH OF A PROJECT'S COLOUR ITS ROOM CARRIES.
 *
 * `subtle` is the identity wash the floor already paints — the same ceiling,
 * by reference. `zoned` gives each project room one of six calm hues at the
 * floor's own luminance; `off` leaves the bare material.
 *
 * @type {Readonly<Record<string, {id:string, label:string, wash:number,
 *   zoned:boolean}>>}
 */
export const ROOM_TINTS = table([
  { id: 'subtle', label: 'Subtle', wash: CARPET_IDENTITY_WASH, zoned: false },
  { id: 'zoned', label: 'Zoned', wash: 0, zoned: true },
  { id: 'off', label: 'Off', wash: 0, zoned: false },
]);

/** Every level's id, in picker order. @type {ReadonlyArray<string>} */
export const ROOM_TINT_IDS = Object.freeze(Object.keys(ROOM_TINTS));

/** The level the floor ships in. */
export const DEFAULT_ROOM_TINT = 'subtle';

/**
 * THE SIX ZONE HUES, in the order rooms take them.
 *
 * Ordered so two projects next to each other are far apart on the wheel, and
 * with nothing between 330° and 50°: no room can drift toward the crimson that
 * means "standing in your office" or the amber of a session that needs input.
 * A room's hue is `ZONE_HUES[(n - 1) mod 6]` for the n-th project.
 *
 * @type {ReadonlyArray<{id:string, hue:number}>}
 */
export const ZONE_HUES = Object.freeze(
  [
    { id: 'sage', hue: 95 },
    { id: 'powder', hue: 215 },
    { id: 'lilac', hue: 280 },
    { id: 'mint', hue: 170 },
    { id: 'straw', hue: 55 },
    { id: 'rose', hue: 320 },
  ].map((h) => Object.freeze(h)),
);

/** The tint: the room's floor mixed this far toward `hsl(hue, S, L)`, then re-locked. */
export const ZONE_TINT_MIX = 0.42;
export const ZONE_TINT_SATURATION = 0.5;
export const ZONE_TINT_LIGHTNESS = 0.6;

/** The room's accent, for small objects only: `hsl(hue, S, L)` held under the wall. */
export const ZONE_ACCENT_SATURATION = 0.35;
export const ZONE_ACCENT_LIGHTNESS = 0.5;

/** A tint is locked to its floor's luminance, and this is how far it may miss. */
export const ZONE_TINT_MAX_LUMINANCE_DRIFT = 0.01;

/** Two rooms side by side have to be different rooms: RGB distance, at least. */
export const ZONE_TINT_MIN_SEPARATION = 12;

/** A tint keeps this far, in RGB, from every colour a figure on the floor wears. */
export const ZONE_TINT_MIN_STATE_DISTANCE = 60;
