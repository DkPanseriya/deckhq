/**
 * What makes one robot look like itself (WP-22 follow-up; rewritten for WP-79).
 *
 * NOTHING ABOUT THE HASH CHANGED. The project channel is still
 * `palette-identity.js`'s `identityFor(projectMk, avatar)` and the session
 * channel is still `palette.js`'s `appearanceFor(sessionId)`, drawn in the same
 * fixed order from the same two hashes, with the same rarity vocabulary and the
 * same measured colour discipline (docs/DEVIATIONS.md §105: a face is a pure
 * function of the session id). What WP-79 changed is where those draws LAND:
 * the old rig spent them on hair, skin, a waistband and a pair of glasses, and
 * B has no hair, no waistband and no face to put glasses on.
 *
 * `rigIdentity` below is that remap, and it is the whole of it — one table,
 * read once per character:
 *
 * | draw                      | old slot        | B's slot                     |
 * |---------------------------|-----------------|------------------------------|
 * | project `accent`          | collar dot      | **chest badge + collar ring**|
 * | project `glyph`           | shoulder glyph  | **chest glyph**              |
 * | project `hair`            | hair colour     | **boots / base band**        |
 * | session `accent`          | waistband       | **antenna tip + ear cups**   |
 * | session `skin`            | skin            | **mitts**, and the dome size |
 * | session `hairStyle` (6)   | hair silhouette | **crown accessory** (6)      |
 * | session `build` (3)       | torso scale     | **barrel width** (3)         |
 * | session `glasses`         | lens rings      | **brow bar over the visor**  |
 * | session rarity trait      | hat/scarf/…     | the rare marker, unchanged   |
 *
 * THE DISCIPLINE IS UNCHANGED AND IS THE POINT. Not one of these touches the
 * barrel's fill or the visor's tint — the state owns both (VISUAL-SPEC §3, §5)
 * — and every colour above is still at least 70 in sRGB from every state
 * colour, asserted at import time by `palette-avatars.js`. Identity says which
 * session this is; it may never say what the session is doing.
 */

import { PALETTE } from './palette.js';
import { TAU, MANAGER_SHIRT, MANAGER_TIE } from './rig-metrics.js';
import { lCircle, lEllipse, lRoundRect, lx, ly, ln } from './rig-pose.js';

/** How many barrel widths, dome sizes and crown accessories there are. */
export const RIG_SHELLS = 3;
export const RIG_DOMES = 3;
export const RIG_CROWNS = 6;

/** The barrel's half-width per shell index, in local units. */
export const SHELL_W = Object.freeze([0.54, 0.6, 0.47]);
/** The dome's radius per dome index, in local units. */
export const DOME_R = Object.freeze([0.235, 0.26, 0.21]);

/**
 * Every visible choice about one character, resolved once.
 *
 * Total on purpose, exactly as `identityFor` and `appearanceFor` are: an agent
 * whose project has not resolved yet, or whose id has not arrived, still draws
 * a valid robot rather than throwing. Better a plain robot than a blank floor.
 *
 * @param {{hair?:string, accent?:string, glyph?:string}|null} [identity]
 *   the PROJECT's identity, from `palette-identity.js`
 * @param {import('./palette.js').Appearance|null} [appearance]
 *   this SESSION's face, from `palette.js`
 */
export function rigIdentity(identity, appearance) {
  const id = identity || /** @type {any} */ ({});
  const ap = appearance || /** @type {any} */ ({});
  // Indices come from the pools themselves rather than from a fresh draw, so
  // the slot a session lands in is a pure function of the same two hashes it
  // always was. `idxOf` is total: an unknown value lands on 0.
  const hairIdx = HAIR_STYLES.indexOf(ap.hairStyle);
  const skinIdx = SKINS.indexOf(ap.skin);
  const buildIdx = BUILDS.indexOf(ap.build);
  return {
    /** barrel width (silhouette) */
    shell: buildIdx < 0 ? 0 : buildIdx % RIG_SHELLS,
    /** dome size (silhouette) */
    dome: skinIdx < 0 ? 0 : skinIdx % RIG_DOMES,
    /** which of the six crown accessories sits on the dome */
    crown: hairIdx < 0 ? 0 : hairIdx % RIG_CROWNS,
    /** a raised brow bar over the visor, or not */
    brow: ap.glasses === true,
    /** the project's colour: chest badge and collar ring */
    project: id.accent || PALETTE.inkCool,
    /** the project's glyph, on the chest badge */
    glyph: id.glyph || 'hex',
    /** the project's deep tone: boots and base band */
    boot: id.hair || PALETTE.inkWarm,
    /** this session's colour: antenna tip and ear cups */
    accent: ap.accent || PALETTE.inkCool,
    /** this session's warm tone: the mitts */
    mitt: ap.skin || '#E4B98E',
    tier: ap.tier || 'common',
    trait: ap.trait || null,
    traitColor: ap.traitColor || ap.accent || PALETTE.inkCool,
  };
}

// The pools, imported by value rather than by reference so this module does not
// have to care that `palette-avatars.js` lets a pack swap the accent table: the
// INDEX is what B uses, and a pack that ships eight accents gives the same
// index to the same session.
const HAIR_STYLES = ['crop', 'short', 'bob', 'tuft', 'bun', 'long'];
const SKINS = ['#F7E0C8', '#E4B98E', '#CE9A6E', '#96543A', '#6E3A22', '#4A2616'];
const BUILDS = [0.92, 1.0, 1.08];

/**
 * The slots two characters are told apart BY, as a plain vector.
 *
 * Exported because "no two of twelve look alike" is a claim that has to be
 * measured rather than asserted, and the thing to measure is the choices, not
 * the pixels. Seven entries: four colours/marks and three silhouette dials.
 * @param {ReturnType<typeof rigIdentity>} r
 * @returns {Array<string|number|boolean>}
 */
export function identitySlots(r) {
  return [r.project, r.glyph, r.accent, r.mitt, r.shell, r.dome, r.crown];
}

/**
 * How many of the seven slots two characters differ in. A plain Hamming
 * distance, because these are categories and not a colour space: two robots
 * that differ in one accent and nothing else DO look alike at 34 px, however
 * far apart the two accents are in sRGB.
 * @param {ReturnType<typeof rigIdentity>} a @param {ReturnType<typeof rigIdentity>} b
 */
export function identityDistance(a, b) {
  const x = identitySlots(a);
  const y = identitySlots(b);
  let d = 0;
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) d++;
  return d;
}

/** The manager is a robot too, and a fixed one: one suit, no project, no state. */
export function managerIdentity() {
  return {
    shell: 1,
    dome: 1,
    crown: 3,
    brow: false,
    project: MANAGER_TIE,
    glyph: 'square',
    boot: PALETTE.inkWarm,
    accent: MANAGER_SHIRT,
    mitt: MANAGER_SHIRT,
    tier: 'common',
    trait: null,
    traitColor: MANAGER_SHIRT,
  };
}

// ---------------------------------------------------------------- the glyph

/**
 * One small vector glyph from CONTRACTS-WP15.md §2's `AVATAR_GLYPHS`
 * vocabulary (`palette.js`). No fonts, no emoji — pure vector paths, drawn
 * small enough to read as a mark rather than an icon. Falls back to the
 * 'hex' shape for any unrecognised name (defensive, per this codebase's
 * "better a plain box than a missing desk" convention in backdrop.js).
 *
 * Screen space, because it is also what the panel and the deck draw.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x @param {number} y @param {number} r
 * @param {string} kind @param {string} color
 */
export function drawGlyph(ctx, x, y, r, kind, color) {
  ctx.fillStyle = color;
  switch (kind) {
    case 'triangle':
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.87, y + r * 0.5);
      ctx.lineTo(x - r * 0.87, y + r * 0.5);
      ctx.closePath();
      ctx.fill();
      break;
    case 'square':
      ctx.fillRect(x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5);
      break;
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r, y);
      ctx.lineTo(x, y + r);
      ctx.lineTo(x - r, y);
      ctx.closePath();
      ctx.fill();
      break;
    case 'drop':
      ctx.beginPath();
      ctx.arc(x, y + r * 0.2, r * 0.7, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(x, y - r);
      ctx.lineTo(x + r * 0.55, y - r * 0.05);
      ctx.lineTo(x - r * 0.55, y - r * 0.05);
      ctx.closePath();
      ctx.fill();
      break;
    case 'star': {
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const outerA = -Math.PI / 2 + (i * TAU) / 5;
        const innerA = outerA + TAU / 10;
        const px = x + Math.cos(outerA) * r,
          py = y + Math.sin(outerA) * r;
        const ix = x + Math.cos(innerA) * r * 0.45,
          iy = y + Math.sin(innerA) * r * 0.45;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
        ctx.lineTo(ix, iy);
      }
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'cross': {
      const t = r * 0.42;
      ctx.fillRect(x - t / 2, y - r, t, r * 2);
      ctx.fillRect(x - r, y - t / 2, r * 2, t);
      break;
    }
    case 'ring':
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(0.6, r * 0.32);
      ctx.beginPath();
      ctx.arc(x, y, r * 0.68, 0, TAU);
      ctx.stroke();
      break;
    case 'hex':
    default:
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = (i * TAU) / 6 - Math.PI / 6;
        const px = x + Math.cos(a) * r,
          py = y + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      break;
  }
}

/** The chest glyph, in the figure's own frame. */
export function drawChestGlyph(ctx, cx, cy, r, kind, color) {
  drawGlyph(ctx, lx(cx), ly(cy), ln(r), kind, color);
}

// ------------------------------------------------------------ the crown slot

/**
 * The six crown accessories — the identity slot with the most silhouette in it,
 * which is why it gets the six-way draw rather than the three-way ones.
 *
 * Drawn as a path only; the caller owns fill and stroke, so the same six shapes
 * serve the halo pass and the paint pass without a second copy.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} which 0-5
 * @param {number} hx @param {number} hy the dome centre, local
 * @param {number} hr the dome radius, local
 * @param {number} droop 0 upright, 1 fully drooped (stalled / ended)
 */
export function crownPath(ctx, which, hx, hy, hr, droop) {
  const lift = 1 - 0.55 * droop;
  const tilt = droop * 0.5;
  switch (which) {
    case 0: {
      // An antenna with a finial: the tallest of the six, and the one the
      // idle bob moves.
      const tipY = hy + hr * (0.92 + 0.63 * lift);
      ctx.beginPath();
      ctx.moveTo(lx(hx), ly(hy + hr * 0.92));
      ctx.lineTo(lx(hx + 0.02 + tilt * 0.1), ly(tipY));
      ctx.lineTo(lx(hx + 0.055 + tilt * 0.1), ly(tipY + 0.012));
      ctx.lineTo(lx(hx + 0.035), ly(hy + hr * 0.92));
      ctx.closePath();
      break;
    }
    case 1:
      lRoundRect(ctx, hx, hy + hr * 1.06 * lift, hr * 1.5, hr * 0.3, hr * 0.14, -tilt);
      break;
    case 2:
      // Two ear flaps, splayed.
      lEllipse(ctx, hx - hr * 0.52, hy + hr * 1.02 * lift, hr * 0.28, hr * 0.5, -0.4 - tilt);
      break;
    case 3:
      lRoundRect(ctx, hx, hy + hr * 1.14 * lift, hr * 0.92, hr * 0.46, hr * 0.1, 0.15 - tilt);
      break;
    case 4:
      lCircle(ctx, hx, hy + hr * 1.24 * lift, hr * 0.3);
      break;
    default:
      // A low crest along the crown: the quietest of the six, for the sessions
      // that should not shout.
      lEllipse(ctx, hx, hy + hr * 0.94 * lift, hr * 0.78, hr * 0.26, -tilt);
      break;
  }
}

/** The second half of the two-part accessories (a mirror), or nothing. */
export function crownPathB(ctx, which, hx, hy, hr, droop) {
  const lift = 1 - 0.55 * droop;
  const tilt = droop * 0.5;
  if (which === 2) {
    lEllipse(ctx, hx + hr * 0.52, hy + hr * 1.02 * lift, hr * 0.28, hr * 0.5, 0.4 - tilt);
    return true;
  }
  return false;
}

/**
 * Where the crown accessory's tip is, in local units — what the over-head
 * badge hangs off, so a tall antenna never has a badge drawn through it.
 * @param {number} which @param {number} hy @param {number} hr @param {number} droop
 */
export function crownTop(which, hy, hr, droop) {
  const lift = 1 - 0.55 * droop;
  if (which === 0) return hy + hr * (0.92 + 0.63 * lift) + 0.02;
  if (which === 4) return hy + hr * 1.24 * lift + hr * 0.3;
  if (which === 3) return hy + hr * 1.14 * lift + hr * 0.23;
  if (which === 2) return hy + hr * 1.02 * lift + hr * 0.5;
  if (which === 1) return hy + hr * 1.06 * lift + hr * 0.15;
  return hy + hr * 0.94 * lift + hr * 0.26;
}

// ------------------------------------------------------------ rarity markers

/**
 * The rarity marker (WP-20; docs/plan/08 §7), one per agent and never two.
 *
 * The vocabulary is untouched — `hat`, `scarf`, `jacket`, `hair`, `crown`,
 * `glow` — and so is the rule that made it safe: every one of them is OFF the
 * barrel. On B they are a cap over the dome, a band at the collar, a yoke
 * across the shoulders, a recoloured antenna tip, a gold crown and an aura.
 * The state colour keeps its area and the slot above the head stays the state
 * icon's.
 *
 * `glow` is the exception to "drawn last": it goes behind the whole figure, and
 * `drawCharacter` calls `drawGlow` separately and early.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} trait @param {string} colour
 * @param {number} hx @param {number} hy @param {number} hr the dome, local
 * @param {number} bw the barrel's width, local
 * @param {number} by the barrel's centre y, local
 * @param {string} ink the figure's line colour
 */
export function drawRarityTrait(ctx, trait, colour, hx, hy, hr, bw, by, ink) {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (trait) {
    case 'hat':
      // A cap over the dome: a brim wider than the skull, so it is a
      // silhouette rather than a decal.
      ctx.fillStyle = colour;
      lEllipse(ctx, hx, hy + hr * 0.62, hr * 1.16, hr * 0.34, 0);
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(0.5, ln(0.012));
      ctx.stroke();
      lRoundRect(ctx, hx, hy + hr * 0.92, hr * 0.86, hr * 0.44, hr * 0.16, 0);
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.stroke();
      break;
    case 'scarf':
      // A band at the collar plus one short tail off a shoulder.
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(1, ln(0.075));
      ctx.beginPath();
      ctx.moveTo(lx(hx - bw * 0.34), ly(hy - hr * 1.02));
      ctx.lineTo(lx(hx + bw * 0.34), ly(hy - hr * 1.02));
      ctx.stroke();
      ctx.lineWidth = Math.max(0.8, ln(0.05));
      ctx.beginPath();
      ctx.moveTo(lx(hx + bw * 0.28), ly(hy - hr * 1.02));
      ctx.lineTo(lx(hx + bw * 0.46), ly(hy - hr * 1.5));
      ctx.stroke();
      break;
    case 'jacket':
      // A yoke across the shoulders: tailoring drawn as an edge, so the
      // barrel's fill — the state — is untouched underneath.
      ctx.strokeStyle = colour;
      ctx.lineWidth = Math.max(1, ln(0.07));
      ctx.beginPath();
      ctx.moveTo(lx(-bw * 0.46), ly(by + 0.1));
      ctx.lineTo(lx(bw * 0.46), ly(by + 0.1));
      ctx.stroke();
      break;
    case 'hair':
      // The rare tip colour. `drawRig` has already drawn the crown in the
      // session accent; this repaints only its finial.
      ctx.fillStyle = colour;
      lCircle(ctx, hx + 0.02, hy + hr * 1.62, 0.055);
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(0.5, ln(0.012));
      ctx.stroke();
      break;
    case 'crown': {
      // Three points on a band, above the dome — outside the dome's circle so
      // it changes the silhouette.
      const base = hy + hr * 1.0;
      const w = hr * 0.72;
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.moveTo(lx(hx - w), ly(base));
      ctx.lineTo(lx(hx + w), ly(base));
      ctx.lineTo(lx(hx + w * 0.7), ly(base + hr * 0.62));
      ctx.lineTo(lx(hx + w * 0.34), ly(base + hr * 0.28));
      ctx.lineTo(lx(hx), ly(base + hr * 0.7));
      ctx.lineTo(lx(hx - w * 0.34), ly(base + hr * 0.28));
      ctx.lineTo(lx(hx - w * 0.7), ly(base + hr * 0.62));
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = Math.max(0.5, ln(0.012));
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}

/**
 * The legendary `glow`: a soft aura behind the whole figure.
 *
 * Deliberately STATIC and deliberately not a floor ring. The two rings this
 * rig already draws on the floor mean specific things — a pulsing one is a
 * raised hand, a still one is the current selection — and a third would
 * dilute both. An aura sits behind the body instead, reads at a glance, and
 * says nothing about state.
 */
export function drawGlow(ctx, ox, oy, u, colour) {
  const prevAlpha = ctx.globalAlpha;
  ctx.fillStyle = colour;
  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  ctx.ellipse(ox, oy - 0.8 * u, 1.25 * u, 1.5 * u, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = 0.12;
  ctx.beginPath();
  ctx.ellipse(ox, oy - 0.8 * u, 0.95 * u, 1.15 * u, 0, 0, TAU);
  ctx.fill();
  ctx.globalAlpha = prevAlpha;
}
