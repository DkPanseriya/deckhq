/**
 * THE FLOOR'S TYPE — every face, weight and size rule the floor's text is set
 * in, in one place, and what each kind of text is painted with.
 *
 * ## Why this file exists
 *
 * The floor used to name two families it does not ship (IBM Plex Sans,
 * JetBrains Mono) at a dozen call sites, so most machines drew whatever came
 * next in each list — and the room plates were bold MONOSPACE with a pale
 * outline round every glyph, which read as a terminal, not as a product. There
 * was no one place to change either.
 *
 * So: a text on the floor has a ROLE. A role says which family role it is set
 * in (`sans`, `numeric` or `mono`), its weight, its tracking, and whether its
 * figures must line up. A FONT is a table of three families, one per family
 * role. Bundling a typeface is one more entry in `FONT_FAMILIES` and nothing
 * else — no call site names a family.
 *
 * ## The three family roles
 *
 *   sans     names and sentences: a room, an agent, a role chip
 *   numeric  anything that is mostly figures and changes while you watch — a
 *            wait, a count, a spend. Canvas text cannot ask for tabular
 *            figures, so this is a family whose default figures ARE tabular
 *            (Segoe UI, Roboto, Helvetica and Arial all are; a UI face whose
 *            default figures are proportional would make a timer shiver)
 *   mono     text that IS code: a command, a path, a tool's line
 *
 * ## The two fonts
 *
 * `deckhq`, the default: the product's own typeface, SHIPPED WITH IT in
 * `public/fonts/` and served from the daemon's own origin like every other
 * file — Inter for names, sentences and figures, JetBrains Mono where the text
 * is code (`public/fonts/PROVENANCE.md` has each file's source, licence and
 * hash). Nothing is fetched from anywhere else, and a machine that has neither
 * installed draws exactly what one that has both does. The three families are
 * declared in `style.css` under the product's own names, by role:
 *
 *   DeckHQ Sans     Inter
 *   DeckHQ Numeric  the same file with its tabular figures switched on in the
 *                   face's own declaration — which is how a CANVAS, which
 *                   cannot ask for a font feature, gets figures that line up
 *   DeckHQ Mono     JetBrains Mono, regular and bold
 *
 * Each list still ends in the machine's own faces: a frame painted before a
 * file has arrived is drawn in them, and `text-metrics.js` hears the file land
 * and has the floor measured and painted again.
 *
 * `system`: the machine's own UI face and nothing of ours, for whoever wants
 * the floor to look like the rest of their desktop.
 *
 * Imports nothing but the palette, so the daemon-side look model can read the
 * ids, and a test can read a role without a canvas.
 */

import { DEFAULT_PALETTE, PALETTE, STATE_COLORS, mixHex, relativeLuminanceOf } from './palette.js';

/**
 * The fonts a look may name. Each is three CSS font-family lists.
 * @type {Readonly<Record<string, Readonly<{label:string, sans:string, numeric:string, mono:string}>>>}
 */
export const FONT_FAMILIES = Object.freeze({
  deckhq: Object.freeze({
    label: 'DeckHQ',
    sans: "'DeckHQ Sans', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    numeric: "'DeckHQ Numeric', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, system-ui, sans-serif",
    mono: "'DeckHQ Mono', ui-monospace, 'Cascadia Mono', SFMono-Regular, Menlo, Consolas, 'Courier New', monospace",
  }),
  system: Object.freeze({
    label: 'System',
    sans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    numeric: "'Segoe UI', Roboto, 'Helvetica Neue', Arial, system-ui, sans-serif",
    mono: "ui-monospace, 'Cascadia Mono', SFMono-Regular, Menlo, Consolas, 'Courier New', monospace",
  }),
});

/** Every font id, in the order a picker would offer them. */
export const FONT_IDS = Object.freeze(Object.keys(FONT_FAMILIES));
export const DEFAULT_FONT = 'deckhq';

/**
 * One CSS font shorthand per FILE the bundled font is made of, for a page to
 * hand to `document.fonts.load` before the floor's first frame — a canvas
 * only asks for a face when it draws with it, which is one frame too late.
 */
export const BUNDLED_FONT_PROBES = Object.freeze([
  "600 12px 'DeckHQ Sans'",
  "700 12px 'DeckHQ Numeric'",
  "400 12px 'DeckHQ Mono'",
  "700 12px 'DeckHQ Mono'",
]);

/**
 * Ask the page for every file of the bundled font, now. Resolves when they
 * have all arrived or failed — and never rejects: a floor without its face is
 * drawn in the machine's own.
 * @param {any} [doc] `document`, or nothing in a test
 * @returns {Promise<void>}
 */
export async function loadBundledFonts(doc) {
  const fonts = doc && doc.fonts;
  if (!fonts || typeof fonts.load !== 'function') return;
  await Promise.all(BUNDLED_FONT_PROBES.map((probe) => fonts.load(probe).catch(() => null)));
}

/**
 * THE ROLES. `family` is a family role; `tracking` is in ems, for a surface
 * that can track (CSS can; canvas text is set untracked, so a measured width
 * and a drawn one can never disagree); `tabular`: its figures must line up.
 * `size` says, in words, which rule sizes it — the rule itself lives with the
 * thing it sizes, because a plate and a name are sized by different facts.
 * @type {Readonly<Record<string, Readonly<{family:'sans'|'numeric'|'mono',
 *   weight:number, tracking:number, tabular:boolean, size:string}>>>}
 */
export const TYPE_ROLES = Object.freeze({
  roomName: role('sans', 700, -0.012, false, 'plate row 0: 12.5 px at the plate scale'),
  roomCount: role('numeric', 700, -0.006, true, 'plate row 1, the hero: 14 px at the plate scale'),
  roomDoing: role('sans', 500, 0, false, 'plate row 2: 11 px at the plate scale'),
  roomTokens: role('numeric', 500, 0, true, 'plate row 3: 11 px at the plate scale'),
  agentName: role('sans', 600, 0, false, '0.62 of the agent scale, held to 11–14 px'),
  badge: role('numeric', 700, 0, true, '0.7 of the agent scale, never under 13 px'),
  chip: role('sans', 600, 0, false, 'the name beside it, or its own floor of 9 px'),
  bubble: role('mono', 500, 0, false, 'half the agent scale, never under 9 px'),
});

/** @returns {Readonly<{family:'sans'|'numeric'|'mono', weight:number, tracking:number, tabular:boolean, size:string}>} */
function role(/** @type {any} */ family, /** @type {number} */ weight, tracking, tabular, size) {
  return Object.freeze({ family, weight, tracking, tabular, size });
}

let current = DEFAULT_FONT;
/** `role|px` → the CSS font string; a floor sets a few dozen. @type {Map<string, string>} */
const FONTS = new Map();

/**
 * Set the floor in a font. An id this build does not have is the default:
 * a look travels between builds, and the floor draws.
 * @param {unknown} id @returns {string} the font now in force
 */
export function setFloorFont(id) {
  const next = FONT_IDS.includes(String(id)) ? String(id) : DEFAULT_FONT;
  if (next !== current) FONTS.clear();
  current = next;
  return current;
}

/** The font the floor is set in. */
export const floorFont = () => current;

/**
 * The canvas `font` for a role at a size. Whole pixels unless `exact`: a name
 * set at 11.4 px and one at 11.6 px are two cache entries and one picture.
 * @param {keyof typeof TYPE_ROLES} name @param {number} px @param {boolean} [exact]
 */
export function typeFont(name, px, exact) {
  const size = exact ? Number(px).toFixed(2) : String(Math.round(px));
  const key = `${name}|${size}`;
  let font = FONTS.get(key);
  if (font === undefined) {
    const r = TYPE_ROLES[name] || TYPE_ROLES.agentName;
    font = `${r.weight} ${size}px ${FONT_FAMILIES[current][r.family]}`;
    FONTS.set(key, font);
  }
  return font;
}

// ------------------------------------------------------------ what it is painted with

/**
 * Every kind of text the floor draws, by what it is read against.
 *
 *   name         an agent's name, under its figure or on a leader line
 *   plateName    a room plate's first line: which room
 *   plateCount   its hero: "6 waiting · oldest 1d 2h"
 *   plateDoing   what the room is doing
 *   plateTokens  the day's spend: "today 5.8M tok · with cache"
 *   chip         the Lounge's "+N resting", a crew's "+N", a worktree's name
 *   roleChip     "Junior", a sub-agent's role, over its name
 *   bubble       a tool's line over a head
 *   badge        a wait, on a pill in the state's colour
 */
export const TEXT_KINDS = Object.freeze([
  'name',
  'plateName',
  'plateCount',
  'plateDoing',
  'plateTokens',
  'chip',
  'roleChip',
  'bubble',
  'badge',
]);

/** `rgba(r,g,b,a)` as an opaque `#rrggbb`: a backing's own colour, without its alpha. */
export function opaqueOf(/** @type {string} */ colour) {
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(String(colour));
  if (!m) return String(colour);
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`;
}

/** The two inks a badge may be lettered in: the pale one it always was, and the floor's darkest. */
const BADGE_PALE = '#FFFFFF';
// …taken down further: the darkest token is 4.4:1 on the amber, a hair short.
const BADGE_DARK = mixHex(DEFAULT_PALETTE.poolPocket, '#000000', 0.45);

/** WCAG contrast of two opaque colours, 1 to 21. */
function contrast(/** @type {string} */ a, /** @type {string} */ b) {
  const la = relativeLuminanceOf(a);
  const lb = relativeLuminanceOf(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The ink a wait badge is lettered in, for the pill it is on: whichever of the
 * two reads better there. White on the crimson of `for_review`; the dark one
 * on the amber of `needs_input`, where white was 3.8:1 and the wait — the one
 * number on the floor that asks for a person — was the least readable text on
 * it.
 * @param {string} fill the pill's colour
 */
export function badgeInk(fill) {
  return contrast(BADGE_PALE, fill) >= contrast(BADGE_DARK, fill) ? BADGE_PALE : BADGE_DARK;
}

/**
 * WHAT ONE KIND OF TEXT IS PAINTED WITH, from the tokens in force: its ink,
 * and the BACKING that is immediately behind its glyphs — a halo stroked round
 * them, or a chip's own fill — or `null` for text set on the bare floor. Read
 * by the painters, and by `floor-contrast.test.mjs`, which measures the pair
 * for every light and style a person can reach.
 *
 * THE RULE. The ink and its backing are a PAIR, and both come from the theme:
 * `plateInk` and `plateHalo` are derived together (`themes-derive.js`), a dark
 * ink with a pale halo on a light floor and a pale ink with a dark halo on a
 * dark one. Nothing here is a constant — a pale halo that was one, round a
 * name whose ink was the theme's, is how the night shift's names came to be
 * white on white.
 *
 * A ROOM'S PLATE IS SET BARE, all four lines: no outline and no card (R-082,
 * the owner's own words). Two lines bare and two outlined read as two
 * typefaces in one block (the owner, 11 October 2026: "the font styling looks
 * off when some text has outlines and some don't"). So the two quiet lines
 * take the name's ink, which is held to the floor itself in every light and
 * style, and the plate's order is carried by size and weight alone: the count
 * bold and largest, the name bold, the two lines under them medium and small.
 *
 * @param {string} kind one of `TEXT_KINDS`
 * @param {string} [state] for a badge: the state whose colour its pill is
 * @returns {{ink:string, backing:string|null}}
 */
export function textPaint(kind, state) {
  switch (kind) {
    case 'plateName':
      return { ink: PALETTE.plateInkSecondary, backing: null };
    case 'plateCount':
      return { ink: PALETTE.plateInk, backing: null };
    case 'plateDoing':
    case 'plateTokens':
      return { ink: PALETTE.plateInkSecondary, backing: null };
    case 'roleChip':
      return { ink: opaqueOf(PALETTE.plateHalo), backing: PALETTE.plateInkSecondary };
    case 'badge': {
      const fill = STATE_COLORS[/** @type {keyof typeof STATE_COLORS} */ (state || 'for_review')];
      return { ink: badgeInk(fill), backing: fill };
    }
    default:
      // A name, a tool's bubble and every chip: the floor's strongest ink on
      // the halo that was derived with it.
      return { ink: PALETTE.plateInk, backing: PALETTE.plateHalo };
  }
}
