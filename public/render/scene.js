/**
 * DeckHQ — the floor scene: frame loop, the fit-to-window camera, hit-testing, painter order.
 *
 * Owns the canvas entirely. All character logic (position, walking, seating,
 * activity rotation) lives in `./agents.js`, which is DOM-free and unit-tested
 * on its own; this file is the thin, untestable-without-a-browser layer that
 * wires that logic to a `<canvas>`.
 *
 * Depends on `./plan.js`, `./backdrop.js`, `./rig.js`, `./clips.js` and
 * `./palette.js` (docs/CONTRACTS.md). Those were being written concurrently
 * by other engineers as this file was authored; they have since landed and
 * this file imports their real exports directly. See the note at the bottom
 * of this file for what that concurrency means for testing this module.
 */

import { buildPlan, U, formatTokens } from './plan.js';
import { bakeBackdrop } from './backdrop.js';
import { drawCharacter, formatElapsed, labelBox } from './rig.js';
import { sampleClip, makeActivityRotation } from './clips.js';
import { STATE_COLORS, PALETTE, identityFor } from './palette.js';
import { AgentRuntime, assignSeats, lodForZoom, worldToScreen, screenToWorld } from './agents.js';

// ---------------------------------------------------------------------------
// The floor's camera: always exactly fit-to-viewport. Zoom and drag-to-pan
// were removed as a feature entirely — there is no user-adjustable
// magnification and nothing to pan to. `_fitScale`/`_camera` below exist
// only to place the fitted floor in the stage and to feed `agents.js`'s
// `worldToScreen`/`screenToWorld` the camera shape they expect. See
// `_recomputeFitScale`, `_centerCamera`, `_cameraParams`.
/**
 * A waiting badge needs roughly 44 px of width and the office seats it sits
 * over are 3.2 U apart, so below ~14 px per unit the badges of adjacent
 * agents cannot help but collide.
 */
const BADGE_MIN_PX_PER_UNIT = 14;

/**
 * The smallest px-per-unit the floor is allowed to shrink to.
 *
 * A room is about 12 units across at its smallest, so below roughly this
 * scale a project room is under 100 px wide and its plate, its agents and its
 * furniture all stop being readable. Rather than keep shrinking, the floor
 * holds this scale and the working side scrolls. Chosen from what a room
 * needs to stay legible, not from a project count.
 */
const MIN_SCALE = 7.5;

// Plan-rebuild policy (CONTRACTS-WP13.md "Rebuild policy (scene.js)"): the
// stage's target aspect (same clamp `plan.js` applies internally, reproduced
// here so scene.js's drift check compares like with like), the drift
// tolerance before a rebuild is worth its ~190ms re-bake, and the resize
// debounce so a window drag doesn't trigger one per pixel.
/**
 * The floor takes the stage's shape. docs/05-LAYOUT-REWORK.md gives two rules
 * that cannot both hold: 2.2 clamps the target aspect to [1.60, 1.78], while
 * 3.1 requires the floor to fill the stage with no letterbox band wider than
 * 8 px at every size from 1280x720 to 2560x1440. Once the header is
 * subtracted those stages are about 1.85-1.93 wide, so the narrow clamp
 * guarantees a 100 px band on almost every real window.
 *
 * 3.1 is stated as the acceptance test and is the point of the rework, so the
 * clamp is widened to a range that still refuses genuinely absurd shapes.
 * Room proportions are protected separately and independently by
 * ROOM_ASPECT_MIN/MAX, so a wider floor cannot turn rooms into corridors.
 * Recorded in docs/DEVIATIONS.md.
 */
const ASPECT_MIN = 1.2;
const ASPECT_MAX = 2.2;
const ASPECT_REBUILD_THRESHOLD = 0.02;
const RESIZE_DEBOUNCE_MS = 150;

// Name-label collision resolution (tech-lead review finding 1,
// docs/DEVIATIONS.md "Findings from review"): how many extra candidate
// positions (each one label-height further down) a non-priority label gets
// before it is dropped rather than drawn overlapping.
const MAX_LABEL_OFFSET_ATTEMPTS = 2;

const HIT_RADIUS_PX = 20;

/**
 * Magnification range (05-LAYOUT-REWORK.md §2.4). 1.0 is exactly
 * fit-to-window and is the floor; there is no zooming out past it.
 */
const ZOOM_MIN = 1;
const ZOOM_MAX = 2.5;
/** Wheel delta to zoom factor. One notch (~100px) is about 10%. */
const ZOOM_WHEEL_RATE = 0.001;
/** Pointer travel past which a press counts as a pan rather than a click. */
const DRAG_SLOP_PX = 4;

/**
 * Smallest canvas box that counts as a real viewport. Below this the element
 * has not been laid out (or the host has collapsed the pane) and its
 * measurement must not be used to shape the floor.
 */
const MIN_CREDIBLE_VIEW = 80;
const DEFAULT_VIEW_W = 1600;
const DEFAULT_VIEW_H = 900;

// Interactive floor fixtures (CONTRACTS-WP15.md §4 whiteboard, §5 the
// in-room "+", and the shelf/screen addendum). Hit-test priority, highest
// first: the "+", the shelf, the screen, the whiteboard, a character, the
// room plate — small targets that sit near furniture must win over the
// character standing behind them, and a click on the "+" must never select
// the agent behind it (see `_hitTest`).
const PLUS_SIZE_U = 1.5; // the "+" glyph's own half-length, plan units
const PLUS_MARGIN_U = 1.7; // inset from the room's north/east walls — "the room's top-right corner area is free"
const PLUS_HIT_RADIUS_PX = 15;
const FIXTURE_HIT_PAD_PX = 6; // generous click padding around shelf/screen/whiteboard rects

const FONT_UI = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', Arial, sans-serif";
// Every number is set in the mono face so tabular-nums-style stability holds on canvas,
// which has no font-variant-numeric of its own (docs/03-VISUAL-SPEC.md §7).
const FONT_MONO =
  "'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, 'Courier New', monospace";

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

// ---------------------------------------------------------------------------
// Pure camera/label maths, exported so `test/unit/scene-math.test.mjs` can
// exercise them without a DOM (this file imports cleanly under plain Node —
// see the note at the bottom — so these are reachable exports, not just
// internal helpers).

/**
 * The floor's target aspect ratio for a given stage box.
 * Clamped to [ASPECT_MIN, ASPECT_MAX] — see the note on those constants.
 * @param {number} stageW @param {number} stageH
 * @returns {number}
 */
export function computeTargetAspect(stageW, stageH) {
  const w = Number(stageW) || 1;
  const h = Number(stageH) || 1;
  return clamp(w / h, ASPECT_MIN, ASPECT_MAX);
}

/**
 * True when the stage's current target aspect has drifted far enough from
 * the baked plan's `targetAspect` to be worth a rebuild (CONTRACTS-WP13.md
 * "Rebuild policy" — rebuild only when the difference exceeds 0.02, which is
 * also acceptance criterion 2's own tolerance).
 * @param {number} currentTargetAspect
 * @param {number} planTargetAspect
 * @returns {boolean}
 */
export function shouldRebuildAspect(currentTargetAspect, planTargetAspect) {
  return Math.abs(currentTargetAspect - planTargetAspect) > ASPECT_REBUILD_THRESHOLD;
}

/**
 * Px-per-unit that makes a `planW x planH` (unit) floor exactly *contain*
 * (fit entirely inside, no scroll/overflow) a `viewW x viewH` (px) stage.
 * This is the one and only scale the floor is ever drawn at — there is no
 * user zoom to multiply it by.
 * @param {number} planW @param {number} planH @param {number} viewW @param {number} viewH
 * @returns {number}
 */
export function computeFitScale(planW, planH, viewW, viewH) {
  const pw = Math.max(1e-6, Number(planW) || 0);
  const ph = Math.max(1e-6, Number(planH) || 0);
  const vw = Math.max(1, Number(viewW) || 0);
  const vh = Math.max(1, Number(viewH) || 0);
  return Math.min(vw / pw, vh / ph);
}

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

/** Same three states `src/core/model.mjs`'s `needsYou()` checks, duck-typed
 * here per agents.js's file-header rule: `public/render/*.js` cannot import
 * across the static-file boundary. Selected/needs-you labels are never
 * dropped by `resolveLabelCollisions` (VISUAL-SPEC review finding 1).
 * @param {{ackState?:string, activityState?:string}} agent
 */
function isNeedsYouAgent(agent) {
  return (
    agent.ackState === 'active' &&
    (agent.activityState === 'needs_input' ||
      agent.activityState === 'stalled' ||
      agent.activityState === 'for_review')
  );
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function colorForAgent(agent) {
  if (agent.ackState === 'let_go') return STATE_COLORS.let_go;
  if (agent.ackState === 'benched') return STATE_COLORS.benched;
  return STATE_COLORS[agent.activityState] || STATE_COLORS.working;
}

/**
 * The short string the floor draws under a character (CONTRACTS-WP15.md
 * §1): the MK tag (`MK3.2`), or the user's chosen display name in its
 * place. `agent.label` is the daemon's own `displayName ?? mk`, so it is
 * used as-is; `agent.mk` and then the old full `agent.title` are fallbacks
 * only, for a snapshot from a daemon that predates this field, so the floor
 * still draws something rather than nothing.
 * @param {{label?:string, mk?:string, title?:string}} agent
 * @returns {string|null}
 */
function agentLabelFor(agent) {
  return agent.label || agent.mk || agent.title || null;
}

// Icon names are rig.js's vocabulary exactly: 'hand' | 'hourglass' | 'check' | null.
function iconForAgent(agent) {
  if (agent.ackState !== 'active') return null;
  if (agent.activityState === 'needs_input') return 'hand';
  if (agent.activityState === 'stalled') return 'hourglass';
  if (agent.activityState === 'for_review') return 'check';
  return null;
}

/**
 * A structural signature of the plan: the project set plus each project's
 * session count. Project rooms are sized from `sessionCount` (docs/03-VISUAL-SPEC.md
 * §2.2), so this is exactly "did the geometry change" — everything else that
 * changes on every push (token counts, needsYou, etc.) is drawn live on the
 * room plates from the snapshot directly, not baked.
 */
function planSignature(snapshot) {
  const projects = (snapshot && snapshot.projects) || [];
  const agents = (snapshot && snapshot.agents) || [];
  // The floor's GEOMETRY depends on more than the project set. The lounge
  // grows a games table at three, five, seven, nine and eleven benched agents;
  // the departures room exists only while somebody is in it and is sized from
  // how many; the waiting area lays out loose chairs once the sofas are full.
  // Keying the rebuild on projects alone left all three stale, so a session
  // that was benched or archived was assigned a seat that did not exist — and
  // an agent with no seat is parked at the floor's origin.
  let waiting = 0;
  let benched = 0;
  let letGo = 0;
  for (const a of agents) {
    if (!a) continue;
    if (a.ackState === 'let_go') letGo++;
    else if (a.ackState === 'benched') benched++;
    else if (a.activityState === 'for_review') waiting++;
  }
  return [
    projects
      .map((p) => `${p.id}:${p.sessionCount}`)
      .sort()
      .join('|'),
    `w${waiting}`,
    `b${benched}`,
    `g${letGo}`,
  ].join('~');
}

export class Scene {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{onSelect?: (sel:{kind:'agent'|'project', id:string})=>void, onHover?: (sel:{kind:'agent'|'project', id:string}|null)=>void}} [handlers]
   */
  constructor(canvas, { onSelect, onHover } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this._onSelect = onSelect || (() => {});
    this._onHover = onHover || (() => {});

    // Centring offset that places the always-fitted floor in the stage —
    // non-zero only on the slack axis, when the floor's aspect isn't an
    // exact match for the viewport's (see `_centerCamera`). There is no user
    // pan any more; this is not camera state a person can move.
    this._camera = { panX: 0, panY: 0 };
    // Px-per-unit that exactly fits the current plan into the current
    // viewport — recomputed on plan change and on every resize
    // (`_recomputeFitScale`). This is the only scale the floor is ever drawn
    // at.
    this._fitScale = 1;
    /**
     * Magnification on top of the fit scale. 1.0 IS fit-to-window and is the
     * minimum — there is no zooming out past the floor.
     */
    this._zoom = 1;
    /** Pointer id of an in-progress drag-to-pan, and where it last was. */
    this._dragPointer = null;
    this._dragFrom = null;
    this._dragMoved = 0;
    this._viewW = 0;
    this._viewH = 0;
    this._resizeDebounceTimer = null;
    this._plan = null;
    this._planSignature = null;
    this._backdrop = null;
    this._snapshot = { agents: [], projects: [], counts: {} };
    this._agentsById = new Map();
    this._plateRects = []; // screen-space rects for hit-testing, refreshed each draw
    // The "+" (circle) and the shelf/screen/whiteboard (rect) hit regions,
    // screen-space, refreshed each draw — see `_drawRoomFixtures`/`_hitTest`.
    this._fixtureRects = [];

    this._runtime = new AgentRuntime();
    this._selectedId = null;
    // The last hit reported through onHover — `{kind, id}` or null. Tracks
    // every hoverable kind (agent, whiteboard, shelf, screen, the "+"), not
    // just agents, both to de-duplicate onHover calls and so the "+" can
    // render its own hover state (see `_drawPlusAffordance`).
    this._hoveredTarget = null;

    this._running = false;
    this._frameErrorLogged = false;
    this._wantRunning = false;
    this._raf = null;
    this._lastT = 0;

    this._dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

    this._reducedMotionQuery =
      typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
    this._reduced = this._reducedMotionQuery ? this._reducedMotionQuery.matches : false;

    // A back-reference from the element to its scene. The floor is a single
    // canvas, so there is otherwise no way to reach the camera or the baked
    // backdrop from the console when something on screen does not match the
    // plan that produced it.
    canvas.__deckhqScene = this;

    if (canvas.setAttribute) {
      canvas.setAttribute('role', 'img');
      if (canvas.tabIndex == null || canvas.tabIndex < 0) canvas.tabIndex = 0;
    }

    this._bind();
    this._resizeCanvasBacking();
    this._recomputeFitScale();
  }

  // ------------------------------------------------------------- lifecycle

  /** Push a fresh state snapshot ({agents, projects, counts, ...}). */
  setState(snapshot) {
    const previousAgents = (this._snapshot && this._snapshot.agents) || [];
    this._snapshot = snapshot || { agents: [], projects: [], counts: {} };
    const agents = this._snapshot.agents || [];
    this._agentsById = new Map(agents.map((a) => [a.id, a]));

    // Content-driven rebuild: the project/session-count signature changed
    // (room sizes and furniture counts are derived from it, per
    // 05-LAYOUT-REWORK.md §2.1). This is independent of, and not debounced
    // like, the resize-driven aspect rebuild in `_checkAspectRebuild` — a
    // genuine new snapshot is not a per-pixel window-drag event. `_rebuildPlan`
    // itself keeps the floor centred at its one fit scale, so there is no
    // separate first-fit step to do here.
    const signature = planSignature(this._snapshot);
    if (signature !== this._planSignature) {
      this._rebuildPlan(computeTargetAspect(this._viewW, this._viewH));
      this._planSignature = signature;
      // The signature counts who is waiting, benched and let go, so the very
      // change that should be seen as a walk — a turn ends and the agent
      // heads for your office — is also a rebuild, and the runtime snaps the
      // whole floor on a rebuilt plan (see `sync`). Bridge it: seat everybody
      // in the new building where they *were*, as one snap, and only then
      // apply the new snapshot, so the agents whose own state changed walk
      // from their old seat to their new one and nobody else moves.
      if (this._plan) {
        this._runtime.sync(previousAgents, this._plan, assignSeats(this._plan, previousAgents));
      }
    }

    if (this._plan) {
      const seatMap = assignSeats(this._plan, agents);
      this._runtime.sync(agents, this._plan, seatMap);
    }

    if (this.canvas.setAttribute) {
      this.canvas.setAttribute('aria-label', Scene.describeFloor(this._snapshot));
    }

    if (!this._running) this._draw(); // keep the floor current even if the loop is paused (hidden tab)
  }

  /**
   * Rebuild the plan and its baked backdrop for a given target aspect, then
   * bring the camera's fit basis back into a valid state for the new plan
   * dimensions. Used by both the content-driven path in `setState` and the
   * debounced resize-driven path in `_checkAspectRebuild`.
   * @param {number} targetAspect
   */
  _rebuildPlan(targetAspect) {
    const agents = this._snapshot.agents || [];
    this._plan = buildPlan(this._snapshot.projects || [], agents, { targetAspect });
    this._backdrop = bakeBackdrop(this._plan, this._dpr);
    this._recomputeFitScale();
    // The pan referred to a floor that no longer exists, so it is discarded;
    // the magnification is the user's and is kept.
    this._centerCamera();
    this.canvas.style.cursor = this._pannable() ? 'grab' : '';
  }

  /**
   * Summarise the floor for the canvas `aria-label` / the off-screen live
   * region app.js owns. docs/03-VISUAL-SPEC.md §10.
   * @param {{projects?: any[], counts?: Record<string, number>}} snapshot
   */
  static describeFloor(snapshot) {
    const projectsCount = ((snapshot && snapshot.projects) || []).length;
    const c = (snapshot && snapshot.counts) || {};
    const needsYou = c.needsYou || 0;
    const parts = [];
    if (c.handsUp) parts.push(`${c.handsUp} hand${c.handsUp === 1 ? '' : 's'} up`);
    if (c.forReview) parts.push(`${c.forReview} for review`);
    if (c.stalled) parts.push(`${c.stalled} stalled`);
    const breakdown = parts.length ? `: ${parts.join(', ')}` : '';
    return `${projectsCount} project${projectsCount === 1 ? '' : 's'}, ${needsYou} session${
      needsYou === 1 ? '' : 's'
    } need you${breakdown}`;
  }

  /** Programmatic selection (e.g. keyboard queue navigation in app.js). */
  select(agentId) {
    this._selectedId = agentId || null;
  }

  start() {
    this._wantRunning = true;
    if (this._running) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    this._startLoop();
  }

  stop() {
    this._wantRunning = false;
    this._stopLoop();
  }

  destroy() {
    this._stopLoop();
    if (this._resizeDebounceTimer != null) {
      clearTimeout(this._resizeDebounceTimer);
      this._resizeDebounceTimer = null;
    }
    this.canvas.removeEventListener('wheel', this._onWheel);
    this.canvas.removeEventListener('pointerdown', this._onPointerDown);
    this.canvas.removeEventListener('pointermove', this._onPointerMove);
    this.canvas.removeEventListener('pointerleave', this._onPointerLeave);
    this.canvas.removeEventListener('pointerup', this._onPointerUp);
    if (typeof window !== 'undefined') {
      window.removeEventListener('resize', this._onResize);
    }
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this._onVisibilityChange);
    }
    if (this._reducedMotionQuery) {
      if (this._reducedMotionQuery.removeEventListener) {
        this._reducedMotionQuery.removeEventListener('change', this._onReducedMotionChange);
      } else if (this._reducedMotionQuery.removeListener) {
        this._reducedMotionQuery.removeListener(this._onReducedMotionChange);
      }
    }
  }

  // ---------------------------------------------------------------- camera

  /**
   * Recompute the px-per-unit that exactly fits the current plan into the
   * current viewport (`_fitScale`) — the only scale the floor is ever drawn
   * at. Call on construction, on every resize, and after any plan rebuild;
   * never caches across those, so the floor stays exactly fitted everywhere
   * without special-casing that anywhere else.
   */
  _recomputeFitScale() {
    const rect = this.canvas.getBoundingClientRect();
    // A canvas that measures zero is not a viewport, it is a canvas that has
    // not been laid out yet — a hidden tab, a panel mid-transition, a pane the
    // host has collapsed. Taking that measurement at face value builds the
    // whole floor for a one-pixel stage: the target aspect clamps to its
    // minimum and the plan comes out nearly square, which then survives until
    // something happens to resize the window. Keep the last credible size.
    if (rect.width >= MIN_CREDIBLE_VIEW && rect.height >= MIN_CREDIBLE_VIEW) {
      this._viewW = rect.width;
      this._viewH = rect.height;
    } else if (!this._viewW || !this._viewH) {
      this._viewW = DEFAULT_VIEW_W;
      this._viewH = DEFAULT_VIEW_H;
    }
    const viewW = this._viewW;
    const viewH = this._viewH;
    const fit = this._plan ? computeFitScale(this._plan.width, this._plan.height, viewW, viewH) : U;

    // Fitting is preferred and is what happens for any normal number of
    // projects. But a floor can only be shrunk so far before a room stops
    // being readable, and past that point squeezing more projects in serves
    // nobody. Below MIN_SCALE the floor stops shrinking and the user pans
    // instead.
    this._fitScale = Math.max(fit, MIN_SCALE);
    this._clampCamera();
  }

  /** The px-per-unit the floor is actually drawn at: fit scale times zoom. */
  _scale() {
    return this._fitScale * this._zoom;
  }

  /**
   * Keep the floor inside the stage.
   *
   * On an axis where the floor is smaller than the viewport there is nothing
   * to pan to, so it is centred and the offset is not a degree of freedom. On
   * an axis where it is larger, the pan is clamped so an edge of the floor can
   * never come inside the corresponding edge of the stage — the viewport can
   * never leave the building (05-LAYOUT-REWORK.md §2.4).
   */
  _clampCamera() {
    if (!this._plan) return;
    const scale = this._scale();
    const floorW = this._plan.width * scale;
    const floorH = this._plan.height * scale;
    const viewW = this._viewW || 1;
    const viewH = this._viewH || 1;
    this._camera.panX =
      floorW <= viewW ? (viewW - floorW) / 2 : clamp(this._camera.panX, viewW - floorW, 0);
    this._camera.panY =
      floorH <= viewH ? (viewH - floorH) / 2 : clamp(this._camera.panY, viewH - floorH, 0);
  }

  /** True when the floor is larger than the stage on either axis. */
  _pannable() {
    if (!this._plan) return false;
    const scale = this._scale();
    return (
      this._plan.width * scale > (this._viewW || 0) + 0.5 ||
      this._plan.height * scale > (this._viewH || 0) + 0.5
    );
  }

  /**
   * Centre the floor in the viewport, discarding any pan. Used on a plan
   * rebuild, where the old pan refers to a floor that no longer exists.
   */
  _centerCamera() {
    if (!this._plan) return;
    const scale = this._scale();
    this._camera.panX = ((this._viewW || 1) - this._plan.width * scale) / 2;
    this._camera.panY = ((this._viewH || 1) - this._plan.height * scale) / 2;
    this._clampCamera();
  }

  /**
   * Set the magnification, keeping the world point under `anchor` (screen px,
   * defaulting to the centre of the stage) under it afterwards.
   *
   * Zoom is MAGNIFICATION ONLY: 1.0 is exactly the fit scale and is the
   * minimum, so there is no state in which the user can lose the floor by
   * zooming out past it (05-LAYOUT-REWORK.md §2.4). Detail is what zoom is
   * for — VISUAL-SPEC §1.1's L1 and L2 bands, and every clip in WP7, are only
   * visible above the fit scale on a floor with more than a few projects.
   * @param {number} next
   * @param {{x:number,y:number}} [anchor]
   */
  setZoom(next, anchor) {
    const target = clamp(Number(next) || 1, ZOOM_MIN, ZOOM_MAX);
    if (Math.abs(target - this._zoom) < 1e-4) return;
    const ax = anchor ? anchor.x : (this._viewW || 1) / 2;
    const ay = anchor ? anchor.y : (this._viewH || 1) / 2;
    const before = this._scale();
    const worldX = (ax - this._camera.panX) / before;
    const worldY = (ay - this._camera.panY) / before;
    this._zoom = target;
    const after = this._scale();
    this._camera.panX = ax - worldX * after;
    this._camera.panY = ay - worldY * after;
    this._clampCamera();
    if (!this._running) this._draw();
  }

  /** Current magnification, for a caller that wants to render a control. */
  get zoom() {
    return this._zoom;
  }

  /** Back to fit-to-window (VISUAL-SPEC §1: the `0` key). */
  resetZoom() {
    this._zoom = 1;
    this._centerCamera();
    if (!this._running) this._draw();
  }

  /** Step the magnification (the `+` / `-` keys). */
  zoomBy(factor) {
    this.setZoom(this._zoom * factor);
  }

  /** Pan by a screen-space delta, clamped to the floor. */
  panBy(dx, dy) {
    if (!this._pannable()) return;
    this._camera.panX += dx;
    this._camera.panY += dy;
    this._clampCamera();
    if (!this._running) this._draw();
  }

  /**
   * The camera in the shape `agents.js`'s `worldToScreen`/`screenToWorld`
   * expect: `camera.U * camera.zoom` must equal the actual px-per-unit.
   *
   * There is ONE camera. An earlier revision pinned the office and the lounge
   * to the left edge and scrolled the working floor under them, which meant
   * two cameras, two clipped backdrop passes, and a seam down the middle of a
   * building that is supposed to read as one.
   */
  _cameraParams() {
    return {
      zoom: this._scale() / U,
      panX: this._camera.panX,
      panY: this._camera.panY,
      U,
    };
  }

  // -------------------------------------------------------------- pointer

  _bind() {
    this._onWheel = this._onWheel.bind(this);
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerLeave = this._onPointerLeave.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._onResize = this._onResize.bind(this);
    this._onVisibilityChange = this._onVisibilityChange.bind(this);
    this._onReducedMotionChange = this._onReducedMotionChange.bind(this);
    this._frame = this._frame.bind(this);

    // Hover and click-to-select only — there is no drag gesture to
    // distinguish a click from any more, so all three listen on the canvas
    // alone (pointermove no longer needs to track a drag past the canvas
    // edge, so unlike the old pan-era binding this does not need `window`).
    this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
    this.canvas.addEventListener('pointerdown', this._onPointerDown);
    this.canvas.addEventListener('pointermove', this._onPointerMove);
    this.canvas.addEventListener('pointerleave', this._onPointerLeave);
    this.canvas.addEventListener('pointerup', this._onPointerUp);
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', this._onResize);
    }
    // The canvas box changes without the window ever resizing — opening the
    // side panel is the common case. Left unobserved, the backing store keeps
    // its old size, the browser squeezes it into the narrower element, and
    // the previous frame's pixels stay on screen outside the cleared region.
    if (typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(this._onResize);
      this._resizeObserver.observe(this.canvas);
    }
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this._onVisibilityChange);
    }
    if (this._reducedMotionQuery) {
      if (this._reducedMotionQuery.addEventListener) {
        this._reducedMotionQuery.addEventListener('change', this._onReducedMotionChange);
      } else if (this._reducedMotionQuery.addListener) {
        this._reducedMotionQuery.addListener(this._onReducedMotionChange);
      }
    }
  }

  /** Hover only — there is no camera drag any more, so every move is a hover check. */
  /**
   * Scroll the working floor sideways, but only when it actually overflows.
   *
   * While everything fits there is nothing to scroll to, so the wheel is left
   * alone and the page behaves normally — the floor is not a scroll trap.
   */
  /**
   * `Ctrl`/`Cmd` + wheel magnifies about the cursor (VISUAL-SPEC §8); a plain
   * wheel pans, but only while the floor is actually bigger than the stage, so
   * a fitted floor is never a scroll trap.
   */
  _onWheel(e) {
    const rect = this.canvas.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * ZOOM_WHEEL_RATE);
      this.setZoom(this._zoom * factor, { x: e.clientX - rect.left, y: e.clientY - rect.top });
      return;
    }
    if (!this._pannable()) return;
    if (!e.deltaX && !e.deltaY) return;
    e.preventDefault();
    // Shift+wheel is the conventional horizontal pan on a mouse with one wheel.
    const dx = e.shiftKey ? -e.deltaY : -e.deltaX;
    const dy = e.shiftKey ? 0 : -e.deltaY;
    this.panBy(dx, dy);
  }

  _onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    if (!this._pannable()) return;
    this._dragPointer = e.pointerId ?? 0;
    this._dragFrom = { x: e.clientX, y: e.clientY };
    this._dragMoved = 0;
    if (this.canvas.setPointerCapture && e.pointerId != null) {
      this.canvas.setPointerCapture(e.pointerId);
    }
  }

  _onPointerMove(e) {
    if (this._dragFrom && (e.pointerId ?? 0) === this._dragPointer) {
      const dx = e.clientX - this._dragFrom.x;
      const dy = e.clientY - this._dragFrom.y;
      this._dragMoved += Math.hypot(dx, dy);
      this._dragFrom = { x: e.clientX, y: e.clientY };
      this.panBy(dx, dy);
      this.canvas.style.cursor = 'grabbing';
      return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = this._hitTest(x, y);
    const key = hit ? `${hit.kind}:${hit.id}` : null;
    const prevKey = this._hoveredTarget
      ? `${this._hoveredTarget.kind}:${this._hoveredTarget.id}`
      : null;
    if (key !== prevKey) {
      this._hoveredTarget = hit;
      this._onHover(hit);
    }
  }

  /** Clear hover when the pointer leaves the canvas — pointermove is scoped
   * to the canvas itself (see `_bind`), so nothing else would ever tell the
   * tooltip to go away once the cursor has moved off it. */
  _onPointerLeave() {
    this._dragFrom = null;
    this._dragPointer = null;
    if (this._hoveredTarget !== null) {
      this._hoveredTarget = null;
      this._onHover(null);
    }
  }

  /** Click-to-select a character or a room plate (VISUAL-SPEC §8). */
  _onPointerUp(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const dragged = this._dragMoved > DRAG_SLOP_PX;
    if (this._dragFrom) {
      this._dragFrom = null;
      this._dragPointer = null;
      this._dragMoved = 0;
      this.canvas.style.cursor = this._pannable() ? 'grab' : '';
      // A drag is a camera move, not a selection. Without this, panning the
      // floor selects whatever happened to be under the finger when it lifted.
      if (dragged) return;
    }
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const hit = this._hitTest(x, y);
    if (hit) this._onSelect(hit);
  }

  /**
   * @param {number} sx screen-space (CSS px) x
   * @param {number} sy screen-space (CSS px) y
   */
  _hitTest(sx, sy) {
    if (!this._plan) return null;

    // Highest priority, in order: the "+", the shelf, the screen, the
    // whiteboard — each tested as its own pass over `_fixtureRects` (built
    // fresh every draw by `_drawRoomFixtures`) rather than by array push
    // order, so the priority holds regardless of how that array was filled.
    // A click on the "+" (or any of these) must never fall through to the
    // character or room plate that might sit behind or near it.
    for (const kind of ['new-agent', 'shelf', 'screen', 'whiteboard']) {
      const hit = this._hitTestFixtureKind(sx, sy, kind);
      if (hit) return hit;
    }

    const camera = this._cameraParams();
    const world = screenToWorld({ x: sx, y: sy }, this._cameraParams());
    // `camera.zoom` here is the U-normalised fit scale from `_cameraParams()`
    // — hit-testing needs the real px-per-unit, which is all that number is.
    const hitRadiusWorld = HIT_RADIUS_PX / (U * camera.zoom);
    let best = null;
    let bestDist = Infinity;
    for (const rec of this._runtime.all()) {
      const d = Math.hypot(rec.x - world.x, rec.y - world.y);
      if (d <= hitRadiusWorld && d < bestDist) {
        bestDist = d;
        best = rec;
      }
    }
    if (best) return { kind: 'agent', id: best.id };

    for (const plate of this._plateRects) {
      if (sx >= plate.x && sx <= plate.x + plate.w && sy >= plate.y && sy <= plate.y + plate.h) {
        if (plate.kind === 'project') return { kind: 'project', id: plate.id };
      }
    }
    return null;
  }

  /**
   * Hit-test just one fixture kind within `_fixtureRects` — a circle for the
   * "+", a padded rect for shelf/screen/whiteboard. Kept as its own pass
   * (called once per kind, in priority order, from `_hitTest`) rather than
   * one generic scan so priority is explicit and independent of paint order.
   * @param {number} sx @param {number} sy
   * @param {'new-agent'|'shelf'|'screen'|'whiteboard'} kind
   */
  _hitTestFixtureKind(sx, sy, kind) {
    for (const f of this._fixtureRects) {
      if (f.kind !== kind) continue;
      if (f.circle) {
        if (Math.hypot(sx - f.cx, sy - f.cy) <= f.r) return { kind: f.kind, id: f.id };
      } else {
        const pad = FIXTURE_HIT_PAD_PX;
        if (sx >= f.x - pad && sx <= f.x + f.w + pad && sy >= f.y - pad && sy <= f.y + f.h + pad) {
          return { kind: f.kind, id: f.id };
        }
      }
    }
    return null;
  }

  _onResize() {
    this._resizeCanvasBacking();
    // Cheap on every resize event, however many fire during a window drag:
    // recompute the fit basis for the new box. A user sitting at zoom 1.0
    // stays exactly fitted (05-LAYOUT-REWORK.md §2.4); a zoomed-in user keeps
    // their magnification and has their pan re-clamped to the new stage.
    this._recomputeFitScale();
    if (this._zoom <= ZOOM_MIN + 1e-6) this._centerCamera();
    else this._clampCamera();
    this.canvas.style.cursor = this._pannable() ? 'grab' : '';
    if (!this._running) this._draw();
    // The expensive part — re-baking the backdrop for a new room layout — is
    // debounced separately; see `_scheduleAspectRecheck`.
    this._scheduleAspectRecheck();
  }

  /**
   * Debounce the resize-driven plan rebuild by 150ms (CONTRACTS-WP13.md
   * "Rebuild policy") so a window drag re-bakes the backdrop (~190ms for 12
   * projects) at most once, after the drag settles, rather than once per
   * pixel.
   */
  _scheduleAspectRecheck() {
    if (this._resizeDebounceTimer != null) clearTimeout(this._resizeDebounceTimer);
    this._resizeDebounceTimer = setTimeout(() => {
      this._resizeDebounceTimer = null;
      this._checkAspectRebuild();
    }, RESIZE_DEBOUNCE_MS);
  }

  /** Rebuild the plan only if the settled aspect drifted past the 0.02 tolerance. */
  _checkAspectRebuild() {
    if (!this._plan) return;
    const target = computeTargetAspect(this._viewW, this._viewH);
    if (!shouldRebuildAspect(target, this._plan.targetAspect)) return;
    this._rebuildPlan(target);
    if (!this._running) this._draw();
  }

  _resizeCanvasBacking() {
    const rect = this.canvas.getBoundingClientRect();
    const previousDpr = this._dpr;
    this._dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    // The backdrop is baked once, at the device pixel ratio it was baked for.
    // Drag the window to a display with a different one and it stays at the
    // old resolution — soft on the sharper screen, oversized on the other.
    if (this._plan && previousDpr && this._dpr !== previousDpr) {
      this._backdrop = bakeBackdrop(this._plan, this._dpr);
    }
    const w = Math.max(1, Math.round((rect.width || this._viewW || DEFAULT_VIEW_W) * this._dpr));
    const h = Math.max(1, Math.round((rect.height || this._viewH || DEFAULT_VIEW_H) * this._dpr));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
  }

  _onVisibilityChange() {
    if (typeof document === 'undefined') return;
    if (document.visibilityState === 'hidden') {
      this._stopLoop();
    } else if (this._wantRunning) {
      this._startLoop();
    }
  }

  _onReducedMotionChange(e) {
    this._reduced = !!e.matches;
    if (!this._running) this._draw();
  }

  // -------------------------------------------------------------- frame loop

  _startLoop() {
    if (this._running) return;
    this._running = true;
    this._lastT = nowMs();
    this._raf = requestAnimationFrame(this._frame);
  }

  _stopLoop() {
    this._running = false;
    if (this._raf != null && typeof cancelAnimationFrame === 'function')
      cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _frame(t) {
    if (!this._running) return;
    const dt = Math.min(0.25, Math.max(0, (t - this._lastT) / 1000 || 0));
    this._lastT = t;
    // The loop must survive a bad frame. An exception escaping here — an
    // unknown clip name, a prop the painter has no case for — used to take the
    // next `requestAnimationFrame` with it, so one bad frame froze the floor
    // permanently and the user's only signal was that nothing moved any more.
    try {
      this._runtime.step(dt, { reduced: this._reduced, plan: this._plan, makeActivityRotation });
      this._draw();
    } catch (err) {
      if (!this._frameErrorLogged) {
        this._frameErrorLogged = true;
        console.error('[deckhq] render frame failed; the floor keeps running', err);
      }
    }
    this._raf = requestAnimationFrame(this._frame);
  }

  // ------------------------------------------------------------------ draw

  _draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    const viewW = rect.width || this.canvas.width / this._dpr;
    const viewH = rect.height || this.canvas.height / this._dpr;

    ctx.save();
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    ctx.clearRect(0, 0, viewW, viewH);

    // Computed once per frame: `camera.zoom` is the U-normalised fit scale,
    // used for both the backdrop transform below and every world<->screen
    // conversion this frame.
    const camera = this._cameraParams();

    if (this._plan && this._backdrop) {
      // Two clipped passes over ONE baked bitmap: the pinned half and the
      // scrolling half. Re-baking on scroll would cost ~190 ms a frame, so
      // the bitmap never changes — only where it is drawn from.
      const paint = (cam, clipX, clipW) => {
        if (clipW <= 0) return;
        ctx.save();
        ctx.beginPath();
        ctx.rect(clipX, 0, clipW, viewH);
        ctx.clip();
        ctx.translate(cam.panX, cam.panY);
        ctx.scale(cam.zoom, cam.zoom);
        ctx.drawImage(this._backdrop.canvas, 0, 0, this._plan.width * U, this._plan.height * U);
        ctx.restore();
      };
      // The building sits ON a ground rather than being cut out of the
      // background. The floor takes the shape its contents want (see plan.js's
      // ASPECT_PAD_MAX), so on most windows there is slack on one axis; a soft
      // drop shadow under the envelope makes that slack read as "the floor
      // ends here" instead of as a gap in an unfinished plan.
      const shadowX = camera.panX;
      const shadowY = camera.panY;
      const shadowW = this._plan.width * U * camera.zoom;
      const shadowH = this._plan.height * U * camera.zoom;
      ctx.save();
      ctx.shadowColor = PALETTE.floorDropShadow;
      ctx.shadowBlur = 26;
      ctx.shadowOffsetY = 8;
      ctx.fillStyle = PALETTE.floorGround;
      ctx.fillRect(shadowX, shadowY, shadowW, shadowH);
      ctx.restore();

      paint(camera, 0, viewW);
    }

    // LOD keys off the effective px-per-unit, which is now simply the fit
    // scale — there is no user zoom multiplier any more. VISUAL-SPEC 1.1's
    // bands (0.7 / 1.4) were written against an absolute world-to-pixel
    // ratio, so this must keep reading the real px-per-unit rather than a
    // fixed band: a big floor's fit scale can land in any of the three
    // bands depending on the viewport it happens to be fitted to.
    const lod = lodForZoom(this._scale() / U);
    const records = [...this._runtime.all()].filter((rec) => {
      const s = worldToScreen(rec, camera);
      return s.x > -60 && s.x < viewW + 60 && s.y > -60 && s.y < viewH + 60;
    });

    // Floor rings (hand-raise pulse, selection ring) are drawn by `drawCharacter` itself,
    // right before that character's body (rig.js's documented draw order: "floor ring ->
    // selection ring -> contact shadow -> ..."), driven by `pose.ring`/`pose.ringPhase`
    // (set by `sampleClip('hand_raise', ...)`) and `opts.selected`. Sorting by y first and
    // calling `drawCharacter` once per character, in that order, is what makes the overall
    // painter order (docs/03-VISUAL-SPEC.md §8 scene section) come out right without scene.js
    // needing a separate global ring pass.
    records.sort((a, b) => a.y - b.y);

    // Name-label collision pass (tech-lead review finding 1): measure every
    // label that will actually be drawn this frame, in the same order
    // characters paint in, and resolve overlaps before any of them are
    // drawn — a label can only be nudged away from one already placed if it
    // knows that one exists yet.
    let labelPlan = null;
    if (lod >= 1) {
      const items = [];
      for (const rec of records) {
        const agent = this._agentsById.get(rec.id);
        const agentLabel = agent && agentLabelFor(agent);
        if (!agentLabel) continue;
        const s = worldToScreen(rec, camera);
        const u = U * camera.zoom;
        const box = labelBox(ctx, s.x, s.y, u, agentLabel);
        items.push({
          id: rec.id,
          x: box.x,
          y: box.y,
          w: box.w,
          h: box.h,
          pin: rec.id === this._selectedId,
          keep: isNeedsYouAgent(agent),
        });
      }
      labelPlan = resolveLabelCollisions(items);
    }

    for (const rec of records) {
      this._drawCharacterAt(rec, camera, lod, labelPlan);
    }

    this._plateRects = [];
    this._fixtureRects = [];
    if (this._plan) {
      for (const room of this._plan.rooms) {
        // A corridor has no name and no data line. It used to be measured,
        // ellipsised and hit-registered every frame anyway, which on the
        // current plan is two thirds of the rooms on the floor.
        if (room.kind === 'corridor') continue;
        this._drawRoomPlate(room, camera);
        // The whiteboard/shelf/screen/"+" are project-room fixtures only —
        // the office and lounge have neither a project to launch nor a
        // whiteboard.
        if (room.kind === 'project') this._drawRoomFixtures(room, camera);
      }
    }

    ctx.restore();
  }

  _drawCharacterAt(rec, camera, lod, labelPlan) {
    const ctx = this.ctx;
    const agent = this._agentsById.get(rec.id);
    if (!agent) return;
    const u = U * camera.zoom;
    // Look up this frame's label-collision resolution (built once, before
    // any character is drawn — see `_draw`). `labelPlan` is null at lod 0,
    // where no label is gated to draw anyway (VISUAL-SPEC §7: "shown at L1
    // and above").
    let label = null;
    let labelOffsetY = 0;
    const agentLabel = agentLabelFor(agent);
    if (lod >= 1 && agentLabel) {
      const plan = labelPlan ? labelPlan.get(rec.id) : { offsetY: 0 };
      if (plan) {
        label = agentLabel;
        labelOffsetY = plan.offsetY;
      }
      // `plan === undefined` (id absent from the map) never happens for a
      // title-bearing agent — every such record was added to `items` in
      // `_draw` — but `plan === null` (dropped by collision resolution)
      // means: draw the character, not the label.
    }
    const s = worldToScreen(rec, camera);
    // While mid-walk, sample `walk` regardless of `rec.clip` (which still names the
    // *previous* clip until arrival — see agents.js `stepAgent`). `t` is deliberately not
    // reset when this switches: `walk` loops, so `sampleClip` just wraps it, and a
    // continuously-increasing `t` is all a looping clip needs for smooth playback.
    const clipName = rec.path.length > 0 ? 'walk' : rec.clip || 'type';
    const t = (nowMs() - rec.clipStartedAt) / 1000;
    const pose = sampleClip(clipName, t, this._reduced);
    // `pose.bodyAngle` from a clip is a small relative sway (e.g. arcade's lean), not an
    // absolute facing — every clip except `arcade` leaves it at 0. The character's actual
    // facing (seat orientation, or direction of travel while walking) is `rec.angle`.
    pose.bodyAngle = rec.angle + pose.bodyAngle;

    const icon = iconForAgent(agent);
    // The waiting badge is crimson, and crimson means "standing in your
    // office" (VISUAL-SPEC section 5). A benched agent keeps its for_review
    // activityState — bench only moves ackState — so without the ackState
    // guard the badge would follow it into the lounge and put red on the
    // floor where nothing is waiting on the user.
    //
    // It is also suppressed until a badge can actually be read: across a
    // packed waiting area at a tight fit scale, a dozen crimson pills overlap
    // into an unreadable smear. The office plate carries the count and the
    // longest wait instead, and the per-agent badges return as soon as there
    // is room for them. BADGE_MIN_PX_PER_UNIT is the office seat pitch (3.2 U)
    // measured against a badge's width, so the gate is a real fit test
    // rather than a taste call.
    const badge =
      lod >= 1 &&
      u >= BADGE_MIN_PX_PER_UNIT &&
      agent.ackState === 'active' &&
      agent.activityState === 'for_review' &&
      agent.reviewSince
        ? formatElapsed(Date.now() - agent.reviewSince)
        : null;

    // Project identity (CONTRACTS-WP15.md §2): hair, a small clothing accent
    // and a shoulder/back glyph, all derived from the agent's project (never
    // the torso, which stays `color` — the state colour, unconditionally).
    // `identityFor` is tolerant of a missing/unresolved `projectMk`, so this
    // is safe to call for every agent without a guard.
    const identity = identityFor(agent.projectMk, agent.avatar);

    drawCharacter(ctx, pose, {
      x: s.x,
      y: s.y,
      u,
      lod,
      color: colorForAgent(agent),
      // `label`/`labelOffsetY` were resolved once for the whole frame above
      // (`_draw`'s collision pass) — drawCharacter still truncates to 18
      // chars and gates on lod >= 1 itself, this only decides *whether* and
      // *where* to draw it.
      label,
      labelOffsetY,
      icon,
      badge,
      identity,
      selected: rec.id === this._selectedId,
      reduced: this._reduced,
    });
  }

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
    ctx.restore();

    // No card is drawn (above), but a room plate is still click-to-filter
    // (VISUAL-SPEC §8) — the hit rect now wraps the text itself rather than
    // a drawn plate.
    const top = titleY - 12;
    const bottom = (lines[1] ? dataY : titleY) + 4;
    this._plateRects.push({
      x,
      y: top,
      w: Math.max(titleW, dataW),
      h: bottom - top,
      kind: room.kind === 'project' ? 'project' : room.kind,
      id: room.id,
    });
  }

  /**
   * A `Prop`'s (plan.js) top-left plan-unit rect, converted to a screen-space
   * rect at the current camera. Props this file cares about (whiteboard,
   * shelf, screen) are all axis-aligned (`angle: 0`), so this ignores
   * rotation — consistent with `_plateRects` also being simple axis-aligned
   * rects.
   * @param {{x:number,y:number,w:number,h:number}} prop
   * @param {{zoom:number,panX:number,panY:number,U:number}} camera
   */
  _propRectScreen(prop, camera) {
    const topLeft = worldToScreen({ x: prop.x, y: prop.y }, camera);
    const u = U * camera.zoom;
    return { x: topLeft.x, y: topLeft.y, w: prop.w * u, h: prop.h * u };
  }

  /**
   * A project room's interactive fixtures beyond its characters: hit regions
   * for the whiteboard/shelf/screen props (already baked into the backdrop
   * bitmap by `backdrop.js` — this only records where they ended up on
   * screen, for `_hitTest`) plus the live-drawn in-room "+"
   * (CONTRACTS-WP15.md §4, §5, and the shelf/screen addendum). `screen` is
   * only emitted by `plan.js` for a project that actually has a dashboard,
   * so it is looked up the same defensive way as the other two rather than
   * assumed present.
   * @param {import('./plan.js').Room} room
   * @param {{zoom:number,panX:number,panY:number,U:number}} camera
   */
  _drawRoomFixtures(room, camera) {
    const props = room.props || [];
    for (const kind of ['whiteboard', 'shelf', 'screen']) {
      const prop = props.find((p) => p.kind === kind);
      if (!prop) continue;
      this._fixtureRects.push({ ...this._propRectScreen(prop, camera), kind, id: room.id });
    }
    this._drawPlusAffordance(room, camera);
  }

  /**
   * The in-room "+" (CONTRACTS-WP15.md §5): a thin quiet vector cross, not a
   * button — no fill plate, no rounded rect. Sits in the room's top-right
   * corner, clear of the room plate (top-left) and of the furniture the
   * anchor system packs toward the room's centre and walls. Brightens and
   * grows slightly on hover so it stays discoverable; reports
   * `{kind:'new-agent', id: projectId}` through onHover/onSelect via
   * `_hitTest`/`_hitTestFixtureKind` — this only draws it and records its
   * hit circle.
   * @param {import('./plan.js').Room} room
   * @param {{zoom:number,panX:number,panY:number,U:number}} camera
   */
  _drawPlusAffordance(room, camera) {
    const ctx = this.ctx;
    const spotWorld = { x: room.x + room.w - PLUS_MARGIN_U, y: room.y + PLUS_MARGIN_U };
    const s = worldToScreen(spotWorld, camera);
    const u = U * camera.zoom;
    const hovered =
      !!this._hoveredTarget &&
      this._hoveredTarget.kind === 'new-agent' &&
      this._hoveredTarget.id === room.id;
    const armLen = u * PLUS_SIZE_U * 0.5 * (hovered ? 1.15 : 1);

    ctx.save();
    if (hovered) {
      ctx.fillStyle = PALETTE.plusHoverHalo;
      ctx.beginPath();
      ctx.arc(s.x, s.y, armLen * 1.7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = hovered ? PALETTE.plusHover : PALETTE.plusRest;
    ctx.lineWidth = Math.max(1.4, u * 0.11);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(s.x - armLen, s.y);
    ctx.lineTo(s.x + armLen, s.y);
    ctx.moveTo(s.x, s.y - armLen);
    ctx.lineTo(s.x, s.y + armLen);
    ctx.stroke();
    ctx.restore();

    this._fixtureRects.push({
      kind: 'new-agent',
      id: room.id,
      circle: true,
      cx: s.x,
      cy: s.y,
      r: Math.max(PLUS_HIT_RADIUS_PX, armLen * 1.7),
    });
  }

  _plateLinesFor(room) {
    if (room.kind === 'project') {
      const project = (this._snapshot.projects || []).find((p) => p.id === room.id);
      if (!project) return room.plateLines || [room.name, ''];
      return [
        room.name,
        `${project.sessionCount} sessions · ${formatTokens(project.tokens)} tok · ${project.needsYou} need you`,
      ];
    }
    if (room.kind === 'office') {
      const c = this._snapshot.counts || {};
      const waiting = c.forReview || 0;
      // The longest wait is the number that makes debt visible. Individual
      // badges cannot fit across a packed waiting area at a tight fit scale,
      // so the plate carries the worst case; per-agent badges reappear once
      // the viewport is wide enough to fit them.
      let oldest = 0;
      for (const a of this._snapshot.agents || []) {
        if (a.ackState === 'active' && a.activityState === 'for_review' && a.reviewSince) {
          oldest = Math.max(oldest, Date.now() - a.reviewSince);
        }
      }
      const suffix = waiting > 0 && oldest > 0 ? ` · oldest ${formatElapsed(oldest)}` : '';
      return [room.name, `${waiting} waiting${suffix}`];
    }
    if (room.kind === 'lounge') {
      const c = this._snapshot.counts || {};
      return [room.name, `${c.benched || 0} benched`];
    }
    if (room.kind === 'let_go') {
      const c = this._snapshot.counts || {};
      const n = c.letGo || 0;
      return [room.name, n === 1 ? '1 let go · archived' : `${n} let go · archived`];
    }
    return room.plateLines || [room.name, ''];
  }
}

// ---------------------------------------------------------------------------
// A note on testing this file: `new Scene(...)` needs a `<canvas>` (2D
// context), `document` and `window`, none of which are available under
// `node --test`, so the class itself is not exercised there. But every
// import in this module's chain (`plan.js`, `backdrop.js`, `rig.js`,
// `clips.js`, `palette.js`, `agents.js`) is side-effect-free at module scope,
// which is why the pure camera/label functions above (`computeTargetAspect`,
// `shouldRebuildAspect`, `computeFitScale`, `resolveLabelCollisions`) are
// plain named exports rather than methods: `test/unit/scene-math.test.mjs`
// imports this file directly (alongside `./agents.js` and `./rig.js`) and
// exercises them with no DOM at all. Everything that genuinely needs a live
// canvas — the constructor, event wiring, `_draw`'s actual paint calls — was
// verified with `node --check` (syntax) and by importing the module under
// Node to confirm every sibling export it consumes exists with the shape
// used here. Full interactive verification (hit-testing/reduced-motion on
// screen) still needs a browser.
