/**
 * The room plates, and the labels that must not sit on each other
 * (WP-22 follow-up).
 *
 * Split out of `scene.js` unchanged: what a plate says, how a string too
 * long for its box is cut, the collision pass that nudges overlapping labels
 * apart, and the one method that paints a plate. `plateLinesFor` and
 * `resolveLabelCollisions` are pure and are what `scene-math.test.mjs` and
 * `subagents.test.mjs` read; `scene.js` re-exports them.
 *
 * The two type faces live here because this is the first place text is set on
 * canvas. Every number is set in the mono face, which is how tabular
 * stability is held on a surface with no `font-variant-numeric`
 * (docs/03-VISUAL-SPEC.md §7).
 */

import { formatTokens, payrollLine } from './plan.js';
import { PALETTE } from './palette.js';
import { formatElapsed } from './rig.js';
import { worldToScreen } from './agents.js';
import { SceneCamera } from './scene-camera.js';

// Name-label collision resolution (tech-lead review finding 1,
// docs/DEVIATIONS.md "Findings from review"): how many extra candidate
// positions (each one label-height further down) a non-priority label gets
// before it is dropped rather than drawn overlapping.
export const MAX_LABEL_OFFSET_ATTEMPTS = 2;

export const FONT_UI = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";
// Every number is set in the mono face so tabular-nums-style stability holds on canvas,
// which has no font-variant-numeric of its own (docs/03-VISUAL-SPEC.md §7).
export const FONT_MONO =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, 'Courier New', monospace";

/**
 * Resolve overlapping name labels for one frame (tech-lead review finding 1,
 * docs/DEVIATIONS.md "Findings from review": labels collide with desk
 * furniture and with each other at L1). `items` should already be in the
 * caller's priority/paint order — earlier items get first claim on space.
 *
 * `pin: true` (the selected agent only) is placed unconditionally at
 * their natural position and contribute to what later items must avoid, but
 * are themselves never nudged or dropped — moving or hiding the one label
 * that says "this is the agent waiting on you" would defeat the point of it.
 *
 * Every other item is tried at its natural position, then at up to
 * `MAX_LABEL_OFFSET_ATTEMPTS` positions each one label-height further down;
 * if none of those clear every already-placed label, it is dropped rather
 * than drawn overlapping — the work order is explicit that a missing label
 * beats an unreadable smear.
 *
 * @param {{id:string, x:number, y:number, w:number, h:number, keep?:boolean}[]} items
 *   `x,y,w,h`: the label's un-offset screen-space box (top-left + size).
 * @returns {Map<string, {offsetY:number}|null>} per-id result; `null` means
 *   "do not draw this label this frame".
 */
/**
 * Trim text with an ellipsis until it fits maxW at the context's current
 * font. Binary search rather than character-by-character, so a long room name
 * costs a handful of measureText calls per frame, not dozens.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {number} maxW
 */
export function ellipsise(ctx, text, maxW) {
  if (maxW <= 0) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? text.slice(0, lo) + '…' : '';
}

/**
 * What a room's door plate says, right now.
 *
 * A plate is recomputed from the live snapshot rather than read from
 * `room.plateLines`, because the plan is rebuilt only when the floor's SHAPE
 * changes and these numbers move on every poll. `room.plateLines` is the
 * fallback for a room the snapshot has nothing to say about.
 *
 * **A project room has three lines** (WP-26, `docs/plan/08` §8.1): its name,
 * its session/token/needs-you line, and the payroll meter under them. The
 * third is `''` whenever nothing in that room has a rate — `payrollLine`
 * refuses to put `$0.00` on a wall when what it means is "no rate" — and
 * `_drawRoomPlate` simply draws nothing for an empty line, so a floor of
 * unpriced rooms looks exactly as it did before the meter existed.
 *
 * A plain named export rather than only a method, for the reason the note at
 * the bottom of this file gives: `new Scene(...)` needs a canvas, so anything
 * that must be unit-tested lives out here where a stub snapshot is enough.
 *
 * @param {any} room
 * @param {any} snapshot
 * @param {any} [plan]
 * @returns {string[]} `[title, data]` or `[title, data, payroll]`
 */
export function plateLinesFor(room, snapshot, plan) {
  const snap = snapshot || {};
  const fallback = () => room.plateLines || [room.name, ''];

  if (room.kind === 'project') {
    const project = (snap.projects || []).find((p) => p.id === room.id);
    if (!project) return fallback();
    // WP-41. Juniors are counted apart from the sessions, because they are a
    // different KIND of occupant: the user did not start them, cannot bench
    // them, and they will be gone before the next coffee. "3 sessions ·
    // +2 juniors" says what is in the room; folding them into `sessionCount`
    // would quietly claim the user has five things running.
    const juniors = Number(project.juniors) || 0;
    const juniorPart = juniors > 0 ? ` · +${juniors} junior${juniors === 1 ? '' : 's'}` : '';
    return [
      room.name,
      `${project.sessionCount} sessions${juniorPart} · ${formatTokens(project.tokens)} tok · ${project.needsYou} need you`,
      payrollLine(project),
    ];
  }
  if (room.kind === 'office') {
    const c = snap.counts || {};
    const waiting = c.forReview || 0;
    // The longest wait is the number that makes debt visible. Individual
    // badges cannot fit across a packed waiting area at a tight fit scale,
    // so the plate carries the worst case; per-agent badges reappear once
    // the viewport is wide enough to fit them.
    let oldest = 0;
    for (const a of snap.agents || []) {
      if (a.ackState === 'active' && a.activityState === 'for_review' && a.reviewSince) {
        oldest = Math.max(oldest, Date.now() - a.reviewSince);
      }
    }
    const suffix = waiting > 0 && oldest > 0 ? ` · oldest ${formatElapsed(oldest)}` : '';
    return [room.name, `${waiting} waiting${suffix}`];
  }
  if (room.kind === 'lounge') {
    const c = snap.counts || {};
    // THE DOOR PLATE CARRIES THE PEOPLE WHO ARE NOT IN THE ROOM (`08` B6).
    // The lounge is sized by, and draws, only the benched agents still
    // inside the gone-home window; the rest are on this line and nowhere
    // else on the floor. `counts.benched` is every benched agent, which is
    // what the header reports and what the panel lists — nothing about
    // their state changed, only whether they are drawn.
    const goneHome = plan && plan.goneHome ? plan.goneHome.size : 0;
    const drawn = Math.max(0, (c.benched || 0) - goneHome);
    return [
      room.name,
      goneHome > 0 ? `${drawn} benched · ${goneHome} went home` : `${drawn} benched`,
    ];
  }
  if (room.kind === 'directory') {
    const n = (room.entries || []).length;
    return [room.name, `${n} repo${n === 1 ? '' : 's'} · nobody in`];
  }
  if (room.kind === 'let_go') {
    const c = snap.counts || {};
    const n = c.letGo || 0;
    return [room.name, n === 1 ? '1 let go · archived' : `${n} let go · archived`];
  }
  return fallback();
}

export function resolveLabelCollisions(items) {
  /** @type {{x:number,y:number,w:number,h:number}[]} */
  const placed = [];
  const result = new Map();

  const overlaps = (a, b) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  // `pin` is an exemption and `keep` is only a priority. Making needs-you
  // labels exempt collapsed in the case that matters most: every agent in the
  // waiting area is for_review, so all of them were exempt at once and the
  // office turned into an unreadable band of overlapping names. Exactly one
  // label — the selected agent's — is ever truly exempt.
  const pinned = items.filter((it) => it.pin);
  const kept = items.filter((it) => it.keep && !it.pin);
  const rest = items.filter((it) => !it.keep && !it.pin);

  for (const it of pinned) {
    placed.push({ x: it.x, y: it.y, w: it.w, h: it.h });
    result.set(it.id, { offsetY: 0 });
  }

  for (const it of [...kept, ...rest]) {
    let chosenOffset = null;
    for (let attempt = 0; attempt <= MAX_LABEL_OFFSET_ATTEMPTS; attempt++) {
      const offsetY = attempt * it.h;
      const rect = { x: it.x, y: it.y + offsetY, w: it.w, h: it.h };
      if (!placed.some((p) => overlaps(rect, p))) {
        chosenOffset = offsetY;
        placed.push(rect);
        break;
      }
    }
    result.set(it.id, chosenOffset === null ? null : { offsetY: chosenOffset });
  }

  return result;
}

export class SceneLabels extends SceneCamera {
  /**
   * The room name and its one data line, as plain text directly on the
   * floor — no card, no fill, no border, no rounded rect (CONTRACTS-WP15.md
   * §3: "do not make white background pop up box, maybe just minimal fonts
   * without background colour"). `PALETTE.plateInk`/`plateInkSecondary` are
   * dark enough to clear 4.5:1 against every floor tone on their own (wood
   * A-D and carpet — see palette.js), so unlike the agent name label this
   * does not need a halo either: plates sit in the room's clear top-left
   * corner rather than over patterned desk furniture, and are already
   * comfortably above the accessibility floor without one.
   */
  _drawRoomPlate(room, camera) {
    const ctx = this.ctx;
    const topLeft = worldToScreen({ x: room.x, y: room.y }, camera);
    const lines = this._plateLinesFor(room);
    // A plate belongs to its room and must not spill over the corridor into
    // the neighbour: clamp it to the room's own width and ellipsise instead.
    const roomW = room.w * camera.zoom * camera.U;
    const maxW = Math.max(60, roomW - 12);
    const x = topLeft.x + 6;
    const titleY = topLeft.y + 16;

    ctx.save();
    // The 2D context is shared with the rig, which can leave textAlign at
    // 'center' after drawing a name label or a badge. Text state is global,
    // so anything that draws text must assert what it needs rather than
    // inherit it.
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // A halo, not a card.
    //
    // The ink already clears 4.5:1 against every floor tone, so this is not a
    // contrast problem — it is a PATTERN problem. Over the herringbone in the
    // office and the lounge, small glyphs sit on top of high-frequency plank
    // seams and simply disappear into them. A pale outline separates the
    // letterforms from whatever is behind them without putting a box back on
    // the floor, which is what the user asked to be rid of.
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    ctx.font = `700 12.5px ${FONT_UI}`;
    const title = ellipsise(ctx, lines[0], maxW);
    const titleW = ctx.measureText(title).width;
    ctx.strokeStyle = PALETTE.plateHalo;
    ctx.lineWidth = 3;
    ctx.strokeText(title, x, titleY);
    ctx.fillStyle = PALETTE.plateInk;
    ctx.fillText(title, x, titleY);

    let dataW = 0;
    let dataY = titleY;
    if (lines[1]) {
      dataY = titleY + 15;
      ctx.font = `600 11px ${FONT_MONO}`;
      const data = ellipsise(ctx, lines[1], maxW);
      dataW = ctx.measureText(data).width;
      ctx.strokeStyle = PALETTE.plateHalo;
      ctx.lineWidth = 2.6;
      ctx.strokeText(data, x, dataY);
      ctx.fillStyle = PALETTE.plateInkSecondary;
      ctx.fillText(data, x, dataY);
    }

    // WP-26's payroll meter, on the same 11 px mono face as the line above it
    // rather than a smaller one: it is the third line on a door plate, so it
    // is already quiet by position, and shrinking it further would put a
    // currency figure under the legibility floor the rest of the plate keeps.
    // Present only for a project room that has a rate — `plateLinesFor`
    // returns `''` rather than an invented `$0.00`.
    let payWidth = 0;
    let payY = dataY;
    if (lines[2]) {
      payY = dataY + 14;
      ctx.font = `600 11px ${FONT_MONO}`;
      const pay = ellipsise(ctx, lines[2], maxW);
      payWidth = ctx.measureText(pay).width;
      ctx.strokeStyle = PALETTE.plateHalo;
      ctx.lineWidth = 2.6;
      ctx.strokeText(pay, x, payY);
      ctx.fillStyle = PALETTE.plateInkSecondary;
      ctx.fillText(pay, x, payY);
    }
    ctx.restore();

    // No card is drawn (above), but a room plate is still click-to-filter
    // (VISUAL-SPEC §8) — the hit rect now wraps the text itself rather than
    // a drawn plate. Every line that was drawn is inside it, the payroll line
    // included: a plate you can read is a plate you can click.
    const top = titleY - 12;
    const bottom = (lines[2] ? payY : lines[1] ? dataY : titleY) + 4;
    this._plateRects.push({
      x,
      y: top,
      w: Math.max(titleW, dataW, payWidth),
      h: bottom - top,
      kind: room.kind === 'project' ? 'project' : room.kind,
      id: room.id,
    });
  }

  _plateLinesFor(room) {
    return plateLinesFor(room, this._snapshot, this._plan);
  }
}
