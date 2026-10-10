/**
 * PAINTING A CREW — WP-89, `docs/plan/12-MOTION-AND-CREW.md` §3.2.
 *
 * The cables, the pulses and the `+N` chip. Everything here is
 * drawn BEFORE the bodies and therefore under them — §1.5: *"Everything in this
 * document is drawn before the chrome band — cloud, pulse, cable and dust puff
 * all sit under it"* — so a cable never runs over a face and a pulse never over
 * a raised hand.
 *
 * The geometry is `crew.js`'s and is baked into the seat by `assignSeats`, which
 * runs once per plan. This file walks the records it is given, strokes the
 * polyline it finds on each seat, and puts at most four dots on it. No route is
 * searched, no object is allocated per cable and no `Path2D` per frame (§1.3).
 *
 * THE LAPTOP IS THE RIG'S (WP-97, WP-99). It used to be drawn here, on the
 * floor one `CREW_LAPTOP_GAP` toward the desk from its junior, because the rig
 * had no way to sit. B sits cross-legged and the rig lays the laptop on the
 * carpet in front of it (`rig-laptop.js`) — with this file's own
 * `crewCableLive` as the lid — so the cable's last run goes from the route's
 * end into that laptop's deck.
 *
 * TWO GATES, BOTH OF THEM §1.4's:
 *
 *   - a pulse exists only where `crewPulseCount` says the junior's transcript
 *     actually grew inside the stall window, and it travels junior → parent
 *     only;
 *   - under reduced motion there are **no pulses at all** and a count badge on
 *     the desk says how many are working instead, while the live/finished colour
 *     difference is kept — which is §3.2's own reduced form.
 */

import {
  CREW_PULSE_MAX,
  CREW_PULSE_MS,
  crewCableExtent,
  crewCableLive,
  crewChipAt,
  crewChipText,
  crewNameAt,
  crewPulseCount,
  pointAlong,
} from './crew.js';
import { PALETTE, STATE_COLORS } from './palette.js';
import { worldToScreen } from './agents.js';
import { sansFont } from './rig-metrics.js';
import { textWidth } from './text-metrics.js';
import { laptopBox } from './rig-laptop.js';

/** Cable width in plan units, at a junior's own scale. */
const CABLE_W_U = 0.2;
/** Pulse radius in plan units. */
const PULSE_R_U = 0.28;
/**
 * Below this many px per unit a cable is drawn at its thinnest, one screen px,
 * rather than not at all (audit F1): at the owner's own window the floor sat at
 * 8 px per unit and a 13-member crew drew twelve bodies with no cable, no desk
 * and no chip, so one member simply went missing. The cable IS the crew.
 */
export const CREW_MIN_PX_PER_UNIT = 10;
/** The same gate the waiting badge uses (§1.3): under it, pulses stop. */
export const PULSE_MIN_PX_PER_UNIT = 14;

/** Module-scope scratch — see the header on why there is one and not one per pulse. */
const _pt = { x: 0, y: 0 };
/** The same, for the laptop a cable ends in. */
const _deck = { x: 0, y: 0, w: 0, h: 0 };

/**
 * Every crew on the floor this frame, as `parentId -> members`, from the records
 * themselves. The seat is the source of truth about who is in a formation
 * because the seat is what `assignSeats` decided, and a record whose seat is not
 * a crew seat is a junior standing beside its parent in the old way.
 * @param {Iterable<any>} records
 * @returns {Map<string, any[]>}
 */
export function crewRecords(records) {
  /** @type {Map<string, any[]>} */
  const out = new Map();
  for (const rec of records) {
    const seat = rec && rec.targetSeat;
    if (!seat || seat.crew !== true || !seat.crewOf) continue;
    const list = out.get(seat.crewOf) || [];
    list.push(rec);
    out.set(seat.crewOf, list);
  }
  for (const list of out.values())
    list.sort((a, b) => (a.targetSeat.crewIndex ?? 0) - (b.targetSeat.crewIndex ?? 0));
  return out;
}

/**
 * Draw every crew's cables and pulses, then its `+N` chip.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{records:Iterable<any>, agentsById:Map<string,any>, camera:any,
 *   scale:number, charU:number, juniorU?:number, lod:0|1|2, reduced:boolean,
 *   pinned:number|null, nowMs:number, seatOf:(id:string)=>any,
 *   crewCounts:Map<string,number>}} view
 */
export function drawCrews(ctx, view) {
  const crews = crewRecords(view.records);
  if (!crews.size) return;
  // `scale` IS px-per-unit: the camera's `U * zoom` is the same number, and
  // `_scale()` is what every other gate on this floor is asked of. Under
  // `CREW_MIN_PX_PER_UNIT` the cable thins to one px; it is never dropped.
  const px = view.scale;
  const pulses = !view.reduced && view.scale >= PULSE_MIN_PX_PER_UNIT;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const [parentId, members] of crews) {
    for (const rec of members) {
      drawOne(ctx, view, rec, pulses, px);
    }
    drawChip(ctx, view, parentId, members);
  }
  ctx.restore();
}

/** One member's cable and pulses. The laptop is the rig's (WP-97). */
function drawOne(ctx, view, rec, pulses, px) {
  const seat = rec.targetSeat;
  const route = seat.route;
  if (!Array.isArray(route) || route.length < 2) return;
  const agent = view.agentsById.get(rec.id) || rec.agent;
  const live = agent ? crewCableLive(agent, view.nowMs, { reduced: view.reduced }) : 0;
  const extent = crewCableExtent(view.nowMs, rec, {
    reduced: view.reduced,
    pinned: view.pinned,
  });
  if (extent <= 0) return;

  // The cable. Green while the transcript is moving, the `ended` grey once it
  // has stopped — §3.2's *"the visible, honest difference between working and
  // finished"*, and it survives reduced motion because it is a colour and not a
  // phase.
  ctx.strokeStyle = live > 0 ? STATE_COLORS.working : STATE_COLORS.ended;
  ctx.globalAlpha = 0.35 + 0.45 * live;
  ctx.lineWidth = px < CREW_MIN_PX_PER_UNIT ? 1 : Math.max(1, CABLE_W_U * px);
  strokeFromPort(ctx, view, route, extent, rec);
  ctx.globalAlpha = 1;

  if (!pulses) return;
  const count = agent ? crewPulseCount(agent, view.nowMs) : 0;
  if (count <= 0) return;
  // The loop phase: the injected clock folded into `CREW_PULSE_MS`, or `?phase=`
  // pinning it outright — the seam the `crew` golden photographs the pulses
  // through without turning motion off.
  const phase =
    view.pinned === null
      ? ((view.nowMs % CREW_PULSE_MS) / CREW_PULSE_MS + 1) % 1
      : ((view.pinned % 1) + 1) % 1;
  ctx.fillStyle = STATE_COLORS.working;
  const r = Math.max(1.2, PULSE_R_U * px);
  for (let k = 0; k < Math.min(CREW_PULSE_MAX, count); k++) {
    // Junior -> parent, always: `t` is 0 at the laptop and 1 at the desk.
    const t = (((phase + k / count) % 1) + 1) % 1;
    pointAlong(route, t, _pt);
    const s = worldToScreen(_pt, view.camera);
    // Brightest in the middle of the run, so a pulse arrives and leaves rather
    // than blinking on at the laptop and off at the port.
    ctx.globalAlpha = 0.25 + 0.75 * Math.sin(t * Math.PI);
    ctx.beginPath();
    ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * Stroke the last `extent` of a polyline, measured FROM THE PORT.
 *
 * From the port rather than from the laptop because that is which way a cable
 * arrives and leaves: §3.2 has it *"draw on from the desk outward"* when a
 * junior appears and retract the same way when one goes. Fully drawn, it runs
 * on from the route's last point into the laptop the rig draws in front of
 * the member (WP-99, `rig-laptop.js`).
 */
function strokeFromPort(ctx, view, route, extent, rec) {
  const pts = route;
  let total = 0;
  for (let i = 0; i + 1 < pts.length; i++)
    total += Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  const want = total * Math.max(0, Math.min(1, extent));
  ctx.beginPath();
  const last = worldToScreen(pts[pts.length - 1], view.camera);
  ctx.moveTo(last.x, last.y);
  let used = 0;
  for (let i = pts.length - 1; i > 0; i--) {
    const seg = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (used + seg >= want) {
      const f = seg > 0 ? (want - used) / seg : 0;
      _pt.x = pts[i].x + (pts[i - 1].x - pts[i].x) * f;
      _pt.y = pts[i].y + (pts[i - 1].y - pts[i].y) * f;
      const s = worldToScreen(_pt, view.camera);
      ctx.lineTo(s.x, s.y);
      break;
    }
    used += seg;
    const s = worldToScreen(pts[i - 1], view.camera);
    ctx.lineTo(s.x, s.y);
  }
  if (extent >= 1 && rec && Number.isFinite(rec.x) && Number.isFinite(rec.y)) {
    // Into the laptop itself: the middle of its deck, at the junior's own
    // scale, so the plug moves with the size the junior is drawn at.
    const feet = worldToScreen(rec, view.camera);
    const deck = laptopBox(feet.x, feet.y, view.juniorU ?? view.charU, _deck);
    ctx.lineTo(deck.x + deck.w / 2, deck.y + deck.h / 2);
  }
  ctx.stroke();
}

/**
 * The `+N` chip beside the desk, for the members over `CREW_DRAW_CAP`.
 *
 * It says how many are NOT on the floor, which is the only thing it can honestly
 * say: those juniors have no seat, no record and no body, and they are reachable
 * from the parent's panel and from the deck.
 *
 * Under reduced motion the same chip carries the count of members that are
 * WORKING as well, because the pulses that would otherwise have said so are off
 * — over the whole crew, not the drawn part of it (`crewChipText`).
 */
function drawChip(ctx, view, parentId, members) {
  const seat = members[0] && members[0].targetSeat;
  if (seat && seat.crewAway === true) {
    drawAwayName(ctx, view, parentId, seat.crewAnchor || view.seatOf(parentId));
  }
  const chip = chipOf(view, parentId, members, false);
  if (chip) plate(ctx, view, chip.at, chip.text, chip.lead);
}

/**
 * WHAT ONE CREW'S CHIP SAYS THIS FRAME, AND WHERE: asked by the painter above
 * and by the frame's label pass (`crewChipBoxes`), so the box a name or a
 * thought cloud keeps clear of is the chip that is drawn and no other.
 *
 * `widest` is the label pass's question. Under reduced motion the chip counts
 * the members whose transcripts are moving, which is the clock's to say; a
 * layout is not redone when a transcript goes quiet, so it is given the text
 * at its longest, every member working.
 * @param {any} view @param {string} parentId
 * @param {any[]} all the crew's records, the ones folding away among them
 * @param {boolean} widest
 * @returns {{text:string, at:{x:number, y:number}, lead:{x:number, y:number}|null}|null}
 *   null for a crew with nothing to say: all of it drawn, and its pulses on
 */
function chipOf(view, parentId, all, widest) {
  // ONLY THE MEMBERS WHO ARE THERE. A junior that has left the snapshot is
  // held for the 0.42 s it takes to fold away (`leftAt`), on the seat it was
  // last given, and that seat still says how many were at the desk before it
  // went: one junior folding away alone read `+2`, for the two that had gone
  // ahead of it. Its cable is still drawn, retracting; it is in no count.
  const members = all.filter((rec) => typeof rec.leftAt !== 'number');
  if (!members.length) return null;
  // The desk the crew is cabled to, and how many are AT it — read off the seat
  // `assignSeats` wrote, because since bug 201 neither is the parent's: the
  // parent may be on a reception sofa while its crew works at the room's
  // primary desk, and a junior that finished is resting in the lounge rather
  // than being one of the `+N` this chip stands for.
  const seat = members[0].targetSeat;
  const anchor = (seat && seat.crewAnchor) || view.seatOf(parentId);
  const total = (seat && seat.crewTotal) ?? view.crewCounts.get(parentId) ?? members.length;
  // Audit F10: "working" is over the WHOLE crew at the desk — the seat carries
  // every member's id — not over the twelve that happen to be drawn.
  const ids = (seat && seat.crewIds) || members.map((rec) => rec.id);
  const live = (/** @type {string} */ id) => {
    const a = view.agentsById.get(id) || members.find((rec) => rec.id === id)?.agent;
    return a && crewCableLive(a, view.nowMs, { reduced: true }) > 0;
  };
  const working = !view.reduced ? null : widest ? total : ids.filter(live).length;
  const text = crewChipText(total, members.length, working);
  if (!text || !anchor) return null;
  // With the lead AT this desk the chip keeps off its body: the reduced form,
  // `+1 · 6/13 working`, is wider than the gap the chip stands in, and since
  // WP-99 a lead waiting on its crew sits here rather than on a sofa.
  const lead = seat && seat.crewAway === true ? null : worldToScreen(anchor, view.camera);
  return { text, at: worldToScreen(crewChipAt(anchor), view.camera), lead };
}

/**
 * THE BOX OF EVERY CREW CHIP THIS FRAME DRAWS, for the frame's label pass.
 *
 * A box used to be kept beside every lead that had juniors — 186 x 44 px at a
 * close zoom — chip or no chip. Two juniors are under the cap and draw none,
 * and the second one's thought cloud was withheld by a box with nothing in it.
 * So this asks the painter's own question (`chipOf`) of the painter's own
 * measure (`plateBox`): no chip, no box.
 * @param {{font:string, measureText:(t:string)=>{width:number}}} ctx
 * @param {{records:Iterable<any>, agentsById:Map<string,any>, camera:any, charU:number,
 *   reduced?:boolean, crewCounts:Map<string,number>, seatOf:(id:string)=>any}} view
 * @returns {{id:string, x:number, y:number, w:number, h:number}[]} `chip:<parent id>`
 */
export function crewChipBoxes(ctx, view) {
  const out = [];
  for (const [parentId, members] of crewRecords(view.records)) {
    const chip = chipOf(view, parentId, members, true);
    if (!chip) continue;
    const box = plateBox(ctx, view, chip.at, chip.text, chip.lead);
    out.push({ id: `chip:${parentId}`, x: box.x, y: box.y, w: box.w, h: box.h });
  }
  return out;
}

/** Half the width of a seated lead's body, in plan units, for the chip's clearance. */
const CHIP_CLEAR_U = 0.85;

/**
 * THE PARENT'S NAME ON THE DESK ITS CREW IS CABLED TO, when the parent is not
 * sitting at it (bug 201). The crew works in the project room whatever its
 * parent is doing; the cables say which desk, and this says whose — a small
 * plate on the desk rather than a body in the chair, because the parent is
 * somewhere else on the floor (usually on the reception sofa, waiting on you).
 * Only a name the snapshot carries: none, and nothing is drawn.
 */
function drawAwayName(ctx, view, parentId, anchor) {
  if (!anchor) return;
  const parent = view.agentsById.get(parentId);
  const name = parent && (parent.label ?? parent.displayName);
  if (!name) return;
  plate(ctx, view, worldToScreen(crewNameAt(anchor), view.camera), String(name));
}

/**
 * One small plate — the chip's halo and ink — centred on a screen point, or as
 * near it as leaves `clear` (a body's feet point) its own width.
 */
function plate(ctx, view, at, text, clear) {
  const box = plateBox(ctx, view, at, text, clear);
  ctx.font = sansFont(box.fontPx);
  ctx.globalAlpha = 1;
  ctx.fillStyle = PALETTE.plateHalo;
  ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.fillStyle = PALETTE.plateInk;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, box.cx, box.cy);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}

/**
 * Where `plate` paints, measured and not painted: the same split as
 * `labelBox` and `drawLabel`, so what the label pass keeps clear is the plate.
 * @returns {{x:number, y:number, w:number, h:number, fontPx:number, cx:number, cy:number}}
 */
function plateBox(ctx, view, at, text, clear) {
  const fontPx = Math.max(10, Math.min(14, view.charU * 0.42));
  const w = textWidth(ctx, sansFont(fontPx), text) + fontPx * 0.9;
  const h = fontPx * 1.5;
  let x = at.x;
  if (clear) {
    const need = w / 2 + view.charU * CHIP_CLEAR_U;
    const dx = at.x - clear.x;
    if (dx !== 0 && Math.abs(dx) < need && Math.abs(at.y - clear.y) < view.charU * 2) {
      x = clear.x + Math.sign(dx) * need;
    }
  }
  return { x: x - w / 2, y: at.y - h / 2, w, h, fontPx, cx: x, cy: at.y };
}
