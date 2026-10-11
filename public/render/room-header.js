/**
 * THE ROOM HEADER — a title bar across the top of every room, and under it a
 * strip of symbols and numbers in fixed places.
 *
 * The owner, 11 October, looking at loose text in a room's corner: "in all
 * rooms make a top bar for title / room name / repo name, with some background
 * to the textbar. And then in 2nd line bar, very short symbolic representation
 * of what is going on in the room, with icons and numbers. Fixed places, slots,
 * fixed length. No texts."
 *
 * THIS REPLACES R-082 ("no background behind the plate"), which was also his.
 * The plate was four lines of words set bare on the floor; it is now two bars
 * with a ground of their own.
 *
 *   LINE 1, THE TITLE BAR   the room's name, bold, cut with an ellipsis and
 *                           never wrapped; a pin where the room is pinned; and
 *                           in a project room the `+` at its right end.
 *   LINE 2, THE STRIP       slots in a FIXED ORDER at FIXED WIDTHS: a symbol
 *                           (`room-symbols.js`) and a number. A slot whose
 *                           number is zero keeps its place, dimmed, so nothing
 *                           ever moves sideways. No words: the words are the
 *                           tooltip's (`header.tooltip`).
 *
 * A room too narrow for every slot loses them FROM THE RIGHT, which is the
 * order they are listed in — the most urgent is first and is the last to go.
 * The title bar is never dropped.
 *
 * THE GROUND is `plateHalo`, the tone the theme derives from its own wall, so
 * the brightest thing in a header is the brightest surface a room is allowed
 * and no brighter (`themes.js`). Both lines stand on it, which is what lets one
 * rule hold every ink: `floor-type.js` says what each is painted with, and
 * `floor-contrast.test.mjs` measures it for every light and style.
 *
 * NOTHING HERE COVERS FURNITURE OR A FIGURE: the header is laid inside the
 * strip the plan keeps clear across the top of every room (`PLATE_BAND`), and
 * is never taller than it.
 *
 * Pure layout and paint: no clock of its own, no DOM.
 */

import { worldToScreen } from './agents.js';
import { PALETTE, STATE_COLORS, mixHex, relativeLuminanceOf } from './palette.js';
import { PLATE_BAND } from './plan-units.js';
import { ellipsise, textWidth } from './text-metrics.js';
import { opaqueOf, textPaint, typeFont } from './floor-type.js';
import { SYMBOLS, drawSymbol } from './room-symbols.js';

/** The two lines' heights and the header's insets, in px at the plate scale. */
export const HEADER_BAR_H = 22;
export const HEADER_STRIP_H = 19;
/** How far inside the room's walls the header starts, in plan units. */
export const HEADER_INSET_U = 0.22;
/** Padding inside a bar, and the gap between a symbol and its number. */
const PAD = 7;
const GAP = 4;

/**
 * THE SLOTS. `w` is the slot's whole width in px at the plate scale — fixed,
 * whatever number is in it, which is what keeps every slot where it was.
 * `state`: the slot is a state's own count, and its symbol takes that state's
 * colour while the count is not zero.
 * @type {Readonly<Record<string, Readonly<{symbol:string, w:number, state?:string, says:string}>>>}
 */
export const HEADER_SLOT_SPECS = Object.freeze({
  needs: slot('bell', 48, 'need you'),
  working: slot('bars', 48, 'working', 'working'),
  stalled: slot('hourglass', 48, 'stalled', 'stalled'),
  spend: slot('coin', 66, 'tokens today'),
  hands: slot('hand', 48, 'hands up', 'needs_input'),
  review: slot('check', 48, 'for review', 'for_review'),
  resting: slot('moon', 48, 'resting'),
  home: slot('home', 48, 'went home'),
});

/** @param {string} symbol @param {number} w @param {string} says @param {string} [state] */
function slot(symbol, w, says, state) {
  return Object.freeze({ symbol, w, says, ...(state ? { state } : {}) });
}

/**
 * Which slots a kind of room has, left to right — and so the order they are
 * dropped in, from the right, when the room is narrow.
 *
 * THE OWNER FIXED THIS LIST (11 October): "you can only display how many needs
 * you, how many are working, stalled and token counts for today. That's it …
 * In office, how many are waiting, how many hands up, etc and that's it. No
 * detailed analysis." So there is no oldest wait, no juniors and no line of
 * what a room is doing on the floor: those are the tooltip's, in words.
 * @type {Readonly<Record<string, ReadonlyArray<string>>>}
 */
export const HEADER_SLOTS = Object.freeze({
  project: Object.freeze(['needs', 'working', 'stalled', 'spend']),
  office: Object.freeze(['needs', 'hands', 'review']),
  lounge: Object.freeze(['resting', 'home']),
  let_go: Object.freeze(['home']),
});

/** `1.5B`, `248M`, `5.8M`, `12k`: a count of tokens in four characters or fewer. */
export function compactTokens(/** @type {unknown} */ n) {
  const v = Math.max(0, Number(n) || 0);
  const one = (/** @type {number} */ x) => (x >= 10 ? String(Math.round(x)) : x.toFixed(1));
  if (v >= 1e9) return `${one(v / 1e9)}B`;
  if (v >= 1e6) return `${one(v / 1e6)}M`;
  if (v >= 1e3) return `${Math.round(v / 1e3)}k`;
  return String(Math.round(v));
}

/**
 * @typedef {object} HeaderSlot
 * @property {string} id one of `HEADER_SLOT_SPECS`
 * @property {string} text what is written beside the symbol
 * @property {boolean} on false for a zero: the slot is drawn dimmed, in place
 * @property {string|null} state the state whose colour the symbol takes
 *
 * @typedef {object} RoomHeader
 * @property {string} title
 * @property {boolean} pinned
 * @property {boolean} plus a project room: the `+` is at the bar's right end
 * @property {HeaderSlot[]} slots in their fixed order
 * @property {string} tooltip every slot in words, for the hover
 */

/**
 * WHAT ONE ROOM'S HEADER SAYS, from the snapshot. The same facts the plate
 * printed, and the same sources: a project's own counters, the header's
 * counts for the office and the lounge (`floor-counts.js` reads the same
 * `counts.drawn`), and the longest wait the caller measured on its clock.
 *
 * @param {any} room @param {any} snapshot @param {any} [plan]
 * @param {{oldest:number, state:string|null}} [wait] the longest wait in the room:
 *   whose state colours the bell
 * @returns {RoomHeader}
 */
export function roomHeaderFor(room, snapshot, plan, wait) {
  const snap = snapshot || {};
  const c = snap.counts || {};
  const drawn = c.drawn || {};
  const num = (/** @type {unknown} */ v) => Math.max(0, Math.floor(Number(v) || 0));
  const waitState = (wait && wait.state) || 'needs_input';
  /** @type {Record<string, {n:number, text?:string, state?:string}>} */
  let v = {};
  const kind = String(room.kind);
  if (kind === 'project') {
    const p = (snap.projects || []).find((/** @type {any} */ x) => x.id === room.id) || {};
    const mine = (snap.agents || []).filter((/** @type {any} */ a) => a && a.projectId === room.id);
    const needs = num(p.needsYou);
    const today = p.todayTokensIsToday ? num(p.todayTokens) : 0;
    v = {
      needs: { n: needs, state: needs > 0 ? waitState : undefined },
      working: { n: num(p.working) },
      stalled: {
        n: mine.filter((a) => a.ackState === 'active' && a.activityState === 'stalled').length,
      },
      spend: { n: today, text: compactTokens(today) },
    };
  } else if (kind === 'office') {
    const waiting = num(typeof drawn.waiting === 'number' ? drawn.waiting : c.forReview);
    v = {
      needs: { n: waiting, state: waiting > 0 ? waitState : undefined },
      hands: { n: num(c.handsUp) },
      review: { n: num(c.forReview) },
    };
  } else if (kind === 'lounge') {
    const gone = plan && plan.goneHome ? plan.goneHome.size : 0;
    const inside =
      typeof drawn.lounge === 'number' ? drawn.lounge : Math.max(0, num(c.benched) - gone);
    v = { resting: { n: num(inside) }, home: { n: gone } };
  } else if (kind === 'let_go') {
    v = { home: { n: num(c.letGo) } };
  }
  const ids = HEADER_SLOTS[kind] || [];
  const slots = ids.map((id) => {
    const got = v[id] || { n: 0 };
    const spec = HEADER_SLOT_SPECS[id];
    const on = got.n > 0;
    return {
      id,
      text: on ? got.text || String(got.n) : '0',
      on,
      state: on ? got.state || spec.state || null : null,
    };
  });
  const said = slots.map((s) => `${HEADER_SLOT_SPECS[s.id].says} ${s.on ? s.text : 'none'}`);
  const pinned = room.pinned === true;
  return {
    title: String(room.name || ''),
    pinned,
    plus: room.kind === 'project',
    slots,
    tooltip: [`${room.name}${pinned ? ' (pinned)' : ''}`, ...said].join(' · '),
  };
}

/**
 * WHERE EVERYTHING IN ONE HEADER GOES, without drawing anything — so the
 * frame's label pass can treat it as an obstacle, and the hit test and the
 * painter read one answer.
 *
 * Both lines fit inside the band the plan keeps clear (`room.plateBand`): at
 * a scale where they would not, both are set shorter, never the band taller.
 *
 * @param {{font:string, measureText:(t:string)=>{width:number}}} ctx
 * @param {any} room @param {RoomHeader} header
 * @param {{zoom:number, panX:number, panY:number, U:number}} camera
 * @param {number} k the plate scale (`plateScaleFor`)
 */
export function layoutHeader(ctx, room, header, camera, k) {
  const at = worldToScreen({ x: room.x, y: room.y }, camera);
  const scale = camera.zoom * camera.U;
  const inset = HEADER_INSET_U * scale;
  const x = at.x + inset;
  const y = at.y + inset;
  const w = Math.max(0, room.w * scale - inset * 2);
  const band = Math.max(8, (Number(room.plateBand) || PLATE_BAND) * scale - inset);
  const full = (HEADER_BAR_H + HEADER_STRIP_H) * k;
  const fit = Math.min(1, band / full);
  const barH = HEADER_BAR_H * k * fit;
  const stripH = header.slots.length ? HEADER_STRIP_H * k * fit : 0;
  const pad = PAD * k * fit;

  // LINE 1. The `+` takes a square at the right end; the pin sits after the
  // name; the name has what is left, and is cut rather than wrapped.
  const plus = header.plus ? { cx: x + w - barH / 2, cy: y + barH / 2, r: barH * 0.24 } : null;
  const px = barH * 0.6;
  const font = typeFont('roomName', px, true);
  const pinR = header.pinned ? px * 0.42 : 0;
  const room4title = w - pad * 2 - (plus ? barH : 0) - (pinR ? pinR * 2 + GAP * k : 0);
  const title = ellipsise(ctx, header.title, Math.max(0, room4title), font);
  const titleW = title ? textWidth(ctx, font, title) : 0;
  const pin = pinR ? { cx: x + pad + titleW + GAP * k + pinR, cy: y + barH / 2, r: pinR } : null;

  // LINE 2. Fixed widths in a fixed order; whatever does not fit is dropped
  // from the right, and what is left never moves.
  const numPx = stripH * 0.62;
  const numFont = typeFont('roomCount', numPx, true);
  /** @type {Array<HeaderSlot & {x:number, w:number, symbol:string}>} */
  const slots = [];
  let cursor = x + pad;
  for (const s of header.slots) {
    const spec = HEADER_SLOT_SPECS[s.id];
    const sw = spec.w * k * fit;
    if (cursor + sw > x + w - pad * 0.5) break;
    slots.push({ ...s, x: cursor, w: sw, symbol: spec.symbol });
    cursor += sw;
  }
  return {
    k,
    rect: { x, y, w, h: barH + stripH },
    bar: { x, y, w, h: barH },
    strip: { x, y: y + barH, w, h: stripH },
    title: { text: title, font, px, x: x + pad, y: y + barH / 2 },
    pin,
    plus,
    slots,
    num: { font: numFont, px: numPx, symbolR: stripH * 0.3, gap: GAP * k * fit },
    dropped: header.slots.length - slots.length,
  };
}

/**
 * THE ONE HOVER LANGUAGE for everything on the floor that can be pressed — a
 * room's title bar, its `+`, the board on its wall: a faint wash of the
 * floor's ink and a clear line round it. No animation: under reduced motion
 * it is simply there, and otherwise it is simply there too.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number, y:number, w:number, h:number}} r @param {number} [radius]
 */
export function paintPressable(ctx, r, radius = 3) {
  ctx.fillStyle = PALETTE.plusHoverHalo;
  roundRect(ctx, r.x, r.y, r.w, r.h, radius);
  ctx.fill();
  ctx.strokeStyle = PALETTE.plusHover;
  ctx.lineWidth = 1.5;
  roundRect(ctx, r.x + 0.75, r.y + 0.75, r.w - 1.5, r.h - 1.5, radius);
  ctx.stroke();
}

function roundRect(/** @type {any} */ ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

/**
 * Paint one header. The caller draws the `+` itself (`scene-draw.js`), at
 * `layout.plus`, because the `+` has a hover and a hit circle of its own.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof layoutHeader>} layout
 * @param {{accent?:string|null, hovered?:boolean}} [how] the room's own hue
 *   where rooms are zoned, and whether the pointer is on the title bar
 */
export function paintHeader(ctx, layout, how = {}) {
  const { rect, bar, strip, title, num } = layout;
  if (!(rect.w > 4)) return;
  const ground = /** @type {string} */ (textPaint('barTitle').backing);
  const radius = Math.min(4 * layout.k, bar.h * 0.3);
  ctx.save();
  // The ground of both lines, as one piece.
  ctx.fillStyle = ground;
  roundRect(ctx, rect.x, rect.y, rect.w, rect.h, radius);
  ctx.fill();
  // The rule between them — and, where rooms are zoned, it is the room's hue.
  if (strip.h > 0) {
    ctx.fillStyle = how.accent || PALETTE.plateInkTertiary;
    ctx.globalAlpha = how.accent ? 1 : 0.28;
    const rule = how.accent ? Math.max(1.5, layout.k * 1.5) : 1;
    ctx.fillRect(rect.x, Math.round(strip.y - rule / 2), rect.w, rule);
    ctx.globalAlpha = 1;
  }
  // A hairline round the whole of it: on a floor the wall's own tone, the
  // ground alone would not say where the header ends.
  ctx.strokeStyle = PALETTE.plateInkTertiary;
  ctx.globalAlpha = 0.34;
  ctx.lineWidth = 1;
  roundRect(ctx, rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1, radius);
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (how.hovered) paintPressable(ctx, bar, radius);

  // LINE 1: the name, and the pin after it.
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = title.font;
  ctx.fillStyle = textPaint('barTitle').ink;
  if (title.text) ctx.fillText(title.text, title.x, title.y + title.px * 0.04);
  if (layout.pin)
    drawSymbol(ctx, 'pin', layout.pin.cx, layout.pin.cy, layout.pin.r, textPaint('barDim').ink);

  // LINE 2: a symbol and a number in every slot, dimmed where it is zero.
  const cy = strip.y + strip.h / 2;
  for (const s of layout.slots) {
    const ink = textPaint(s.on ? 'barCount' : 'barDim').ink;
    const mark = s.on && s.state ? barSymbolInk(s.state) : ink;
    drawSymbol(ctx, s.symbol, s.x + num.symbolR, cy, num.symbolR, mark);
    ctx.font = num.font;
    ctx.fillStyle = ink;
    ctx.fillText(s.text, s.x + num.symbolR * 2 + num.gap, cy + num.px * 0.04);
  }
  ctx.restore();
}

/** The contrast a symbol needs against its bar: a graphic that carries meaning. */
export const SYMBOL_MIN_CONTRAST = 3;

/**
 * The colour a state's symbol is drawn in on the bar: the state's own WHERE
 * IT READS THERE, and the bar's ink where it does not. "There" is the bar's
 * ground at its own alpha over the darkest and over the lightest floor there
 * could be under it — black and white — so the answer holds on every floor
 * and does not have to be asked per room. The state palette is mid-tone by
 * design, and on a pale bar `stalled`, a muted brown, is a hair under 3:1: its
 * hourglass is then drawn in ink. Nothing is lost: a state is told by its
 * symbol's shape, and never by colour alone.
 * Exported so the contrast test measures exactly what is painted.
 * @param {string} state
 */
export function barSymbolInk(state) {
  const own = STATE_COLORS[/** @type {keyof typeof STATE_COLORS} */ (state)];
  if (!own) return PALETTE.plateInk;
  const halo = String(PALETTE.plateHalo);
  const m = /,\s*([\d.]+)\s*\)$/.exec(halo);
  const alpha = m ? Number(m[1]) : 1;
  const ink = relativeLuminanceOf(own);
  for (const under of ['#000000', '#ffffff']) {
    const bar = relativeLuminanceOf(mixHex(under, opaqueOf(halo), alpha));
    const ratio = (Math.max(bar, ink) + 0.05) / (Math.min(bar, ink) + 0.05);
    if (ratio < SYMBOL_MIN_CONTRAST) return PALETTE.plateInk;
  }
  return own;
}

/** Every symbol's meaning, for a sheet or a legend: `[symbol, words]` pairs. */
export const HEADER_LEGEND = Object.freeze(
  Object.entries(SYMBOLS).map(([name, s]) => Object.freeze([name, s.means])),
);

/**
 * THE BOARD ON A ROOM'S WALL, LIT. The board itself is furniture, baked into
 * the floor once; this is the little that is drawn live over it each frame so
 * it reads as a screen that can be pressed and not as a cabinet: a faint wash
 * of the wall's own tone (never brighter than the wall, so it cannot glare on
 * the night shift), one short line for each state the room has somebody in,
 * and — under the pointer — the floor's one hover language.
 *
 * A handful of fills per room: nothing is re-baked for a hover.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x:number, y:number, w:number, h:number}} r the board, on screen
 * @param {{states:string[], hovered:boolean}} how
 */
export function paintBoardLive(ctx, r, how) {
  if (!(r.w > 3 && r.h > 3)) return;
  const upright = r.h > r.w;
  // The face: the board less the mount against its wall.
  const mount = Math.max(2, (upright ? r.w : r.h) * 0.22);
  const face = upright
    ? { x: r.x + mount, y: r.y + r.h * 0.05, w: r.w - mount, h: r.h * 0.9 }
    : { x: r.x + r.w * 0.05, y: r.y + mount, w: r.w * 0.9, h: r.h - mount };
  ctx.save();
  ctx.fillStyle = PALETTE.plateHalo;
  ctx.globalAlpha = 0.5;
  ctx.fillRect(face.x, face.y, face.w, face.h);
  ctx.globalAlpha = 1;
  // One line for each state, along the board, in that state's colour.
  const across = upright ? face.w : face.h;
  const along = upright ? face.h : face.w;
  const thick = Math.max(1.5, across * 0.14);
  how.states.slice(0, 3).forEach((state, i) => {
    ctx.fillStyle = barSymbolInk(state);
    const at = across * (0.26 + i * 0.26) - thick / 2;
    const len = along * (0.62 - i * 0.14);
    if (upright) ctx.fillRect(face.x + at, face.y + along * 0.12, thick, len);
    else ctx.fillRect(face.x + along * 0.12, face.y + at, len, thick);
  });
  if (how.hovered) paintPressable(ctx, r, 2);
  ctx.restore();
}
