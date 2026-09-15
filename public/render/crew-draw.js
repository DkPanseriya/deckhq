/**
 * PAINTING A CREW — WP-89, `docs/plan/12-MOTION-AND-CREW.md` §3.2.
 *
 * The cables, the laptops, the pulses and the `+N` chip. Everything here is
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
  crewPulseCount,
  pointAlong,
} from './crew.js';
import { PALETTE, STATE_COLORS } from './palette.js';
import { worldToScreen } from './agents.js';
import { sansFont } from './rig-metrics.js';

/** Cable width in plan units, at a junior's own scale. */
const CABLE_W_U = 0.2;
/** Pulse radius in plan units. */
const PULSE_R_U = 0.28;
/** The laptop, in plan units: the base it stands on, and the lid at full open. */
const LAPTOP_W_U = 0.9;
const LAPTOP_D_U = 0.5;
/** Below this many px per unit a cable is a smudge and a pulse is a flicker. */
export const CREW_MIN_PX_PER_UNIT = 10;
/** The same gate the waiting badge uses (§1.3): under it, pulses stop. */
export const PULSE_MIN_PX_PER_UNIT = 14;

/** Module-scope scratch — see the header on why there is one and not one per pulse. */
const _pt = { x: 0, y: 0 };

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
 * Draw every crew's cables, laptops and pulses, then its `+N` chip.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{records:Iterable<any>, agentsById:Map<string,any>, camera:any,
 *   scale:number, charU:number, lod:0|1|2, reduced:boolean,
 *   pinned:number|null, nowMs:number, seatOf:(id:string)=>any,
 *   crewCounts:Map<string,number>}} view
 */
export function drawCrews(ctx, view) {
  const crews = crewRecords(view.records);
  if (!crews.size) return;
  // One gate for the whole pass, asked of the WORLD scale: a cable is a fact
  // about the floor, not about how large the people on it are drawn.
  if (view.scale < CREW_MIN_PX_PER_UNIT) return;
  // `scale` IS px-per-unit: the camera's `U * zoom` is the same number, and
  // `_scale()` is what every other gate on this floor is asked of.
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

/** One member's cable, laptop and pulses. */
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
  ctx.lineWidth = Math.max(1, CABLE_W_U * px);
  strokeFromPort(ctx, view, route, extent);
  ctx.globalAlpha = 1;

  drawLaptop(ctx, view, seat, live, px);

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
 * junior appears and retract the same way when one goes.
 */
function strokeFromPort(ctx, view, route, extent) {
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
  ctx.stroke();
}

/**
 * One laptop, open while its junior is writing and folded once it has stopped.
 * Two rectangles and no rotation matrix: `ctx.save`/`ctx.rotate` per part is
 * what §1.3 forbids, so the lid is drawn as a foreshortened base instead.
 */
function drawLaptop(ctx, view, seat, live, px) {
  const s = worldToScreen(seat.laptop, view.camera);
  const w = LAPTOP_W_U * px;
  const d = LAPTOP_D_U * px;
  // The lid, BEHIND the base so the base reads as the near edge: full height
  // open, nothing at all folded flat. Drawn first for the same reason a monitor
  // is drawn before the desk it stands on.
  const lid = d * 1.15 * live;
  if (lid > 0.5) {
    ctx.fillStyle = PALETTE.monitorBody;
    ctx.fillRect(s.x - w / 2, s.y - d / 2 - lid, w, lid);
    ctx.fillStyle = PALETTE.monitorScreenGlow;
    ctx.fillRect(s.x - w / 2 + 1, s.y - d / 2 - lid + 1, Math.max(1, w - 2), Math.max(1, lid - 2));
  }
  ctx.fillStyle = PALETTE.monitorBody;
  ctx.fillRect(s.x - w / 2, s.y - d / 2, w, d);
}

/**
 * The `+N` chip beside the desk, for the members over `CREW_DRAW_CAP`.
 *
 * It says how many are NOT on the floor, which is the only thing it can honestly
 * say: those juniors have no seat, no record and no body, and they are reachable
 * from the parent's panel and from the deck.
 *
 * Under reduced motion the same chip carries the count of members that are
 * WORKING as well, because the pulses that would otherwise have said so are off.
 */
function drawChip(ctx, view, parentId, members) {
  const total = view.crewCounts.get(parentId) ?? members.length;
  const over = total - members.length;
  const working = view.reduced
    ? members.filter((rec) => {
        const a = view.agentsById.get(rec.id) || rec.agent;
        return a && crewCableLive(a, view.nowMs, { reduced: true }) > 0;
      }).length
    : 0;
  const text = view.reduced
    ? over > 0
      ? `+${over} · ${working}/${total} working`
      : `${working}/${total} working`
    : over > 0
      ? `+${over}`
      : '';
  if (!text || view.lod < 1) return;
  const anchor = view.seatOf(parentId);
  if (!anchor) return;
  const at = worldToScreen(crewChipAt(anchor), view.camera);
  const fontPx = Math.max(10, Math.min(14, view.charU * 0.42));
  ctx.font = sansFont(fontPx);
  const w = ctx.measureText(text).width + fontPx * 0.9;
  const h = fontPx * 1.5;
  ctx.globalAlpha = 1;
  ctx.fillStyle = PALETTE.plateHalo;
  ctx.fillRect(at.x - w / 2, at.y - h / 2, w, h);
  ctx.fillStyle = PALETTE.plateInk;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, at.x, at.y);
  ctx.textAlign = 'start';
  ctx.textBaseline = 'alphabetic';
}
