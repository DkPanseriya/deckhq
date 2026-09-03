/**
 * DeckHQ — the floating mini-floor (WP-39, `docs/plan/08-PLAN-V2-100X.md` B3).
 *
 * A 320x200 always-on-top window holding your office, the corridor beside it,
 * the needs-you numeral and the hands-up count. It answers the one question
 * `08` §1.2 says the product exists to answer — *is anything waiting on me* —
 * without the browser tab being open, in front of the terminal where the work
 * actually happens. Clicking a person takes you back to the full floor with
 * the panel already open on them.
 *
 * TWO RULES SHAPE THIS WHOLE FILE.
 *
 * 1. **It is a second render target of the SAME scene, never a second scene.**
 *    It never calls `buildPlan`, never bakes a backdrop, never owns an
 *    `AgentRuntime`. `Scene#frame()` hands it the live plan, the live baked
 *    bitmap and the live agent records, and it paints them at a different
 *    scale into a different canvas. There is exactly one building and exactly
 *    one answer to where each person is standing; a second copy of either
 *    would drift the first time one of the two windows missed a frame.
 * 2. **No markup is ever built from a string.** The PiP document is assembled
 *    with `createElement` and `textContent` like the rest of the client, and
 *    `test/unit/panel-invariant.test.mjs`'s SECURITY test reads this file to
 *    make sure it stays that way.
 *
 * The composition — which rooms are in the shot, which people are in them, and
 * what the numeral reads — is `composeMiniFrame()`, a pure function over a
 * plan plus agent records, so all of it is asserted in
 * `test/unit/minifloor.test.mjs` with a stub canvas and no browser.
 *
 * Where `documentPictureInPicture` does not exist (Firefox, Safari) there is
 * no floating window to fall back to, so the count goes to the app badge
 * WP-16 already wires (`navigator.setAppBadge`) and one line of toast says so.
 */

import { U } from './render/plan.js';
import { PALETTE, identityFor, appearanceFor } from './render/palette.js';
import { drawCharacter } from './render/rig.js';
import { sampleClip } from './render/clips.js';
import { lodForZoom } from './render/agents.js';
import { characterScaleFor, colorForAgent, iconForAgent } from './render/scene.js';

/**
 * The window `08` B3 specifies. Small enough to sit over a terminal without
 * being in the way, large enough that a 16 px body and a 44 px numeral both
 * fit — which is the whole legibility argument for the size.
 */
export const PIP_SIZE = Object.freeze({ width: 320, height: 200 });

/** Breathing room, in css px, between the shot and the edges of its canvas. */
const VIEW_PAD = 4;

/**
 * Floor, in plan units, kept around the rooms in the shot. See the note where
 * `viewport` is derived: a body standing against a wall is wider than the wall
 * it stands against, and a viewport that stopped at the wall cut it in half.
 */
const SHOT_PAD_U = 1.2;

/**
 * How far, in css px, a click may be from a person and still be that person.
 * Larger than the floor's own 20 px because everything in this window is
 * smaller and a desk widget is aimed at with less care than a full screen.
 */
const HIT_RADIUS_PX = 24;

/** How long the arrival pulse runs. Skipped entirely under reduced motion. */
const PULSE_MS = 900;

/**
 * How far outside the shot a person may be and still be drawn: someone
 * crossing the corridor towards your door is the moment this window exists
 * for, and clipping them at the frame edge would hide it.
 */
const MARGIN_U = 2;

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/**
 * The corridor beside the office.
 *
 * On the plan the service column is the left-hand strip — your office above
 * the lounge — and the spine is the one vertical corridor between it and the
 * working floor (`plan.js`: "The spine: the one vertical corridor, between the
 * service column and the working floor"). That is the corridor a session walks
 * down to reach you, so it is the one in the shot. It is found by geometry
 * rather than by id so a plan that names it something else still works, and
 * `__spine__` only breaks the tie.
 * @param {any} plan
 * @param {{x:number,y:number,w:number,h:number}} office
 */
function corridorBeside(plan, office) {
  const rooms = (plan && plan.rooms) || [];
  const touching = rooms.filter((r) => {
    if (!r || r.kind !== 'corridor') return false;
    // Overlaps the office's own band, and starts within a unit of one of its
    // vertical edges — i.e. runs alongside it rather than past its end.
    const overlaps = r.y < office.y + office.h && r.y + r.h > office.y;
    const beside = Math.abs(r.x - (office.x + office.w)) < 1 || Math.abs(r.x + r.w - office.x) < 1;
    return overlaps && beside;
  });
  if (touching.length === 0) return null;
  const spine = touching.find((r) => r.id === '__spine__');
  return spine || touching[0];
}

/**
 * What the mini-floor draws this frame: which rooms are in the shot, where
 * they land in canvas pixels, which people stand in them, and what the numeral
 * reads.
 *
 * Pure — it takes a plan, the runtime's records and a snapshot's counts, and
 * returns plain data. Nothing here touches a canvas, a window or the clock
 * unless `opts.now` is left out.
 *
 * @param {{plan?:any, records?:any[], agentsById?:Map<string,any>|null,
 *   snapshot?:any, selectedId?:string|null, reduced?:boolean}} frame
 *   Exactly the shape `Scene#frame()` returns.
 * @param {{width:number, height:number, now?:number, pad?:number}} view
 *   The canvas box in css px.
 * @returns {{ok:boolean, rooms:{id:string,kind:string,x:number,y:number,w:number,h:number}[],
 *   viewport:{x:number,y:number,w:number,h:number},
 *   shot:{x:number,y:number,w:number,h:number}, scale:number, charScale:number,
 *   lod:0|1, offsetX:number, offsetY:number,
 *   people:{id:string,x:number,y:number,sx:number,sy:number,angle:number,clip:string,
 *     t:number,color:string,icon:'hand'|'hourglass'|'check'|null,
 *     projectMk:number|undefined,avatar:string|undefined,
 *     selected:boolean,inOffice:boolean}[],
 *   officeIds:string[], numeral:number, handsUp:number}}
 */
export function composeMiniFrame(frame, view) {
  const width = Math.max(1, Number(view && view.width) || 0);
  const height = Math.max(1, Number(view && view.height) || 0);
  const pad = view && view.pad != null ? view.pad : VIEW_PAD;
  const now = view && view.now != null ? view.now : nowMs();

  const plan = (frame && frame.plan) || null;
  const snapshot = (frame && frame.snapshot) || {};
  const counts = snapshot.counts || {};
  const empty = {
    ok: false,
    rooms: [],
    viewport: { x: 0, y: 0, w: 0, h: 0 },
    shot: { x: 0, y: 0, w: 0, h: 0 },
    scale: 0,
    charScale: 0,
    lod: /** @type {0|1} */ (0),
    offsetX: 0,
    offsetY: 0,
    people: [],
    officeIds: [],
    numeral: Number(counts.needsYou) || 0,
    handsUp: Number(counts.handsUp) || 0,
  };

  const office = ((plan && plan.rooms) || []).find((r) => r && r.kind === 'office') || null;
  if (!office) return empty;

  /** @type {{id:string,kind:string,x:number,y:number,w:number,h:number}[]} */
  const rooms = [
    { id: office.id, kind: 'office', x: office.x, y: office.y, w: office.w, h: office.h },
  ];
  const corridor = corridorBeside(plan, office);
  if (corridor) {
    // Only the stretch of it that runs past your door. The spine is the full
    // height of the building; the lounge half of it is not this window's
    // business and would halve the scale everything else is drawn at.
    const top = Math.max(corridor.y, office.y);
    const bottom = Math.min(corridor.y + corridor.h, office.y + office.h);
    if (bottom > top) {
      rooms.push({
        id: corridor.id,
        kind: 'corridor',
        x: corridor.x,
        y: top,
        w: corridor.w,
        h: bottom - top,
      });
    }
  }

  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const r of rooms) {
    x0 = Math.min(x0, r.x);
    y0 = Math.min(y0, r.y);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  // A margin of floor around the shot, because a person is not a point. The
  // waiting chairs stand against the office's own walls, so at a scale where a
  // body is 16 px and the room is 40 units wide, a viewport that stopped at
  // the wall cut the three people nearest it in half against the edge of the
  // canvas. Measured on the demo floor, which is exactly where it showed up.
  const shot = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  const viewport = {
    x: shot.x - SHOT_PAD_U,
    y: shot.y - SHOT_PAD_U,
    w: shot.w + SHOT_PAD_U * 2,
    h: shot.h + SHOT_PAD_U * 2,
  };
  if (!(viewport.w > 0) || !(viewport.h > 0)) return empty;

  // Contain, exactly as the main floor's `computeFitScale` contains the whole
  // building in its stage: this is the same camera, aimed at one corner of the
  // same plan.
  const scale = Math.min((width - pad * 2) / viewport.w, (height - pad * 2) / viewport.h);
  if (!(scale > 0)) return empty;
  const offsetX = (width - viewport.w * scale) / 2 - viewport.x * scale;
  const offsetY = (height - viewport.h * scale) / 2 - viewport.y * scale;
  // People stop shrinking with the plan below the legibility floor, exactly as
  // they do on the main floor (`05` §6.2). In a 320x200 window that clamp is
  // not an edge case, it is the normal state.
  const charScale = characterScaleFor(scale);
  // The floor's own LOD bands — but asked of the CHARACTER scale rather than
  // the world scale, and capped at L1.
  //
  // LOD decides how much of a body to draw, so the scale it must key off is
  // the one the body is drawn at. On the main floor those are the same number
  // whenever the fit is not clamped, so nothing changes there; in a 320x200
  // window they are never the same number, and asking the world scale would
  // pick a level for a floor rather than for a person. In practice this window
  // lands at L0 on any real plan: the office is ~40 units across and 320 px is
  // 8 px per unit, so a body is at the 16 px legibility floor and the simple
  // body is what reads at that size. The state colour and the state icon are
  // drawn at every level, and they are the whole message here. L2's close-up
  // detail is never worth its cost beside a running floor.
  const lod = /** @type {0|1} */ (Math.min(1, lodForZoom(charScale / U)));

  const agentsById = (frame && frame.agentsById) || new Map();
  const selectedId = (frame && frame.selectedId) || null;
  const inside = (px, py) =>
    px >= viewport.x - MARGIN_U &&
    px <= viewport.x + viewport.w + MARGIN_U &&
    py >= viewport.y - MARGIN_U &&
    py <= viewport.y + viewport.h + MARGIN_U;
  const inOfficeRect = (px, py) =>
    px >= office.x && px <= office.x + office.w && py >= office.y && py <= office.y + office.h;

  /** @type {any[]} */
  const people = [];
  /** @type {string[]} */
  const officeIds = [];
  for (const rec of (frame && frame.records) || []) {
    if (!rec || !inside(rec.x, rec.y)) continue;
    const agent = agentsById.get ? agentsById.get(rec.id) : null;
    if (!agent) continue;
    const inOffice = inOfficeRect(rec.x, rec.y);
    if (inOffice) officeIds.push(rec.id);
    people.push({
      id: rec.id,
      x: rec.x,
      y: rec.y,
      sx: rec.x * scale + offsetX,
      sy: rec.y * scale + offsetY,
      angle: rec.angle || 0,
      // Same rule as `scene.js`: mid-walk beats whatever clip the record still
      // names, because `rec.clip` is the PREVIOUS clip until arrival.
      clip: (rec.path && rec.path.length > 0 ? 'walk' : rec.clip) || 'type',
      t: (now - (rec.clipStartedAt || 0)) / 1000,
      color: colorForAgent(agent),
      icon: iconForAgent(agent),
      // Same identity channels as the main floor: the project's hair, accent
      // and glyph, and this session's own face (WP-20). Both are total
      // functions of what the snapshot already carries, so nothing extra is
      // fetched to draw a person here.
      projectMk: agent.projectMk,
      avatar: agent.avatar,
      selected: rec.id === selectedId,
      inOffice,
    });
  }
  // Painter order, same as the floor's: back to front.
  people.sort((a, b) => a.y - b.y || String(a.id).localeCompare(String(b.id)));
  officeIds.sort();

  return {
    ok: true,
    rooms,
    viewport,
    shot,
    scale,
    charScale,
    lod,
    offsetX,
    offsetY,
    people,
    officeIds,
    numeral: Number(counts.needsYou) || 0,
    handsUp: Number(counts.handsUp) || 0,
  };
}

/**
 * Paint one composed frame.
 *
 * The materials come from the main floor's own baked bitmap when there is one
 * — the same herringbone, the same walls, the same door swing and the same
 * furniture, blitted from the region the shot covers. Blitting rather than
 * re-baking is the point: a bake is ~190 ms, and this window repaints every
 * frame. The flat fills below are only for a first frame that arrives before
 * the bake, and they use the same palette tokens either way.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof composeMiniFrame>} composed
 * @param {{width:number, height:number, backdrop?:any, planWidth?:number,
 *   reduced?:boolean}} opts
 */
export function drawMiniFrame(ctx, composed, opts) {
  const { width, height } = opts;
  // Nothing is painted outside the building. The window's own ground is the
  // cold studio the whole product sits in (`05` §2.2), and it is already
  // behind this canvas; filling the slack with floor tone instead put a pale
  // band above and below the office that read as part of the plan.
  ctx.clearRect(0, 0, width, height);
  if (!composed.ok) return;

  const { shot, scale, offsetX, offsetY } = composed;
  const toScreen = (rect) => ({
    x: rect.x * scale + offsetX,
    y: rect.y * scale + offsetY,
    w: rect.w * scale,
    h: rect.h * scale,
  });

  // The building stands ON the ground and casts a shadow onto it, exactly as
  // the main floor's envelope does — that is what makes the slack read as
  // "the floor ends here" rather than as a gap.
  const ground = toScreen(shot);
  ctx.save();
  ctx.shadowColor = PALETTE.floorDropShadow;
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 3;
  ctx.fillStyle = PALETTE.floorGround;
  ctx.fillRect(ground.x, ground.y, ground.w, ground.h);
  ctx.restore();

  const backdrop = opts.backdrop || null;
  let blitted = false;
  if (backdrop && backdrop.canvas && backdrop.wpx > 0) {
    // The bitmap is baked at `U` px per unit times whatever device pixel ratio
    // the main floor baked it at; both are recovered from the bitmap itself
    // rather than assumed, so a change to either cannot silently mis-crop.
    const bakeScale = (backdrop.canvas.width || backdrop.wpx) / backdrop.wpx;
    const spu = U * bakeScale;
    // Clamped to the bitmap. The shot carries a margin of floor around the
    // rooms so nobody is cut off at a wall, and on a plan whose office sits in
    // the building's own corner that margin is off the edge of the bake.
    const planW = backdrop.wpx / U;
    const planH = backdrop.hpx / U;
    const src = {
      x: Math.max(0, shot.x),
      y: Math.max(0, shot.y),
    };
    src.w = Math.min(planW, shot.x + shot.w) - src.x;
    src.h = Math.min(planH, shot.y + shot.h) - src.y;
    if (src.w > 0 && src.h > 0) {
      const dest = toScreen(src);
      ctx.save();
      try {
        ctx.drawImage(
          backdrop.canvas,
          src.x * spu,
          src.y * spu,
          src.w * spu,
          src.h * spu,
          dest.x,
          dest.y,
          dest.w,
          dest.h,
        );
        blitted = true;
      } catch {
        // A bitmap that is not yet decodable is a flat-filled frame, not a
        // broken window.
      } finally {
        ctx.restore();
      }
    }
  }

  if (!blitted) {
    for (const room of composed.rooms) {
      ctx.fillStyle = room.kind === 'corridor' ? PALETTE.circulationBase : PALETTE.woodHerringboneA;
      ctx.fillRect(
        room.x * scale + offsetX,
        room.y * scale + offsetY,
        room.w * scale,
        room.h * scale,
      );
    }
  }

  const reduced = Boolean(opts.reduced);
  for (const person of composed.people) {
    let pose;
    try {
      pose = sampleClip(person.clip, person.t, reduced);
    } catch {
      pose = sampleClip('type', 0, true);
    }
    pose.bodyAngle = person.angle + pose.bodyAngle;
    drawCharacter(ctx, pose, {
      x: person.sx,
      y: person.sy,
      u: composed.charScale,
      lod: composed.lod,
      color: person.color,
      icon: person.icon,
      // No name label and no waiting badge. There is no room for either at
      // this size, and the numeral beside the canvas already says how many
      // are waiting — the body, its state colour and its icon are the whole
      // message. A name is one click away in the full floor.
      identity: identityFor(person.projectMk, person.avatar),
      appearance: appearanceFor(person.id),
      selected: person.selected,
      reduced,
    });
  }
}

/**
 * One line of copy, in the product's voice (`05` §11: name things as the
 * person experiences them, never imply fault).
 */
export const NO_PIP_MESSAGE =
  'This browser cannot float a window. The count stays on the app badge and the tab.';

/** Is a floating window available at all in this browser? */
export function canFloat(win) {
  const w = win || (typeof window !== 'undefined' ? window : null);
  return Boolean(w && 'documentPictureInPicture' in w && w.documentPictureInPicture);
}

/**
 * Build the mini-floor controller.
 *
 * Everything it needs from the app arrives as a function so this module never
 * reaches into `app.js` — it does not know what a snapshot request looks like,
 * how selection works, or where the toast lives.
 *
 * @param {{
 *   getScene: () => any,
 *   onSelect: (id:string) => void,
 *   onFallback?: (count:number) => void,
 *   toast?: (msg:string) => void,
 *   win?: any,
 * }} deps
 */
export function createMiniFloor(deps) {
  const win = deps.win || (typeof window !== 'undefined' ? window : null);
  /** @type {any} */
  let pip = null;
  /** @type {HTMLCanvasElement|null} */
  let canvas = null;
  /** @type {CanvasRenderingContext2D|null} */
  let ctx = null;
  /** @type {any} */
  let els = null;
  let raf = null;
  let lastT = 0;
  /** @type {Set<string>} who was standing in the office on the previous frame */
  let officeWas = new Set();
  let pulseUntil = 0;
  let lastNumeral = null;
  let lastHands = null;
  let frameErrorLogged = false;
  /** @type {ReturnType<typeof composeMiniFrame>|null} the frame a click hits */
  let lastComposed = null;

  const reducedQuery =
    win && typeof win.matchMedia === 'function'
      ? win.matchMedia('(prefers-reduced-motion: reduce)')
      : null;

  /**
   * This window's motion decision, which is the main window's motion decision.
   *
   * Two inputs, in the order `style.css` reads them: the OS preference, and
   * the explicit setting `settings-ui.js` stamps on the main document's root
   * as `data-motion`, which overrules it in both directions. The PiP document
   * is a document of its own, so that attribute has to be carried across or
   * every `[data-motion='reduce']` rule in the shared stylesheet would stop
   * applying the moment the page was floated.
   * @returns {'reduce'|'no-preference'}
   */
  function motionMode() {
    const stamped = stampedMotion();
    if (stamped === 'reduce' || stamped === 'no-preference') return stamped;
    return reducedQuery && reducedQuery.matches ? 'reduce' : 'no-preference';
  }

  /** `data-motion` on the main document's root, or '' when it is not set. */
  function stampedMotion() {
    const root = win && win.document && win.document.documentElement;
    return (root && root.dataset && root.dataset.motion) || '';
  }
  const reduced = () => motionMode() === 'reduce';

  /** Mirror `data-motion` onto the floating document. Cheap enough per frame. */
  function syncMotionAttribute() {
    if (!pip) return;
    const stamped = stampedMotion();
    const root = pip.document.documentElement;
    if ((root.dataset.motion || '') === stamped) return;
    if (stamped) root.dataset.motion = stamped;
    else delete root.dataset.motion;
  }

  function snapshotOf() {
    const scene = deps.getScene && deps.getScene();
    if (!scene || typeof scene.frame !== 'function') return null;
    return scene.frame();
  }

  /** The needs-you count, for the badge fallback and the numeral alike. */
  function needsYouNow() {
    const frame = snapshotOf();
    return Number(frame && frame.snapshot && frame.snapshot.counts?.needsYou) || 0;
  }

  function buildDocument() {
    const doc = pip.document;
    doc.documentElement.lang = 'en';
    doc.title = 'DeckHQ — your office';
    // The same stylesheet the main window uses, so the mini-floor's chrome is
    // literally the product's chrome: same tokens, same numeral, same
    // contrast measurements (`05` §2.2, §10). Copied as a link rather than
    // inlined so it stays one file to change.
    for (const link of Array.from(win.document.querySelectorAll('link[rel="stylesheet"]'))) {
      const copy = doc.createElement('link');
      copy.rel = 'stylesheet';
      copy.href = link.href;
      doc.head.appendChild(copy);
    }

    const root = doc.createElement('div');
    root.className = 'minifloor';

    canvas = doc.createElement('canvas');
    canvas.className = 'minifloor-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Your office and the corridor beside it');
    root.appendChild(canvas);

    const side = doc.createElement('div');
    side.className = 'minifloor-side';

    const numeral = doc.createElement('div');
    numeral.className = 'numeral';
    const numeralV = doc.createElement('span');
    numeralV.className = 'numeral-v num';
    numeralV.textContent = '0';
    const numeralK = doc.createElement('span');
    numeralK.className = 'numeral-k';
    numeralK.textContent = 'needs you';
    numeral.appendChild(numeralV);
    numeral.appendChild(numeralK);
    side.appendChild(numeral);

    // State is never carried by colour alone (`05` §10): a dot, a number and a
    // neutral-ink word, the same three parts as the header's breakdown.
    const hands = doc.createElement('p');
    hands.className = 'minifloor-hands';
    const dot = doc.createElement('span');
    dot.className = 'state-dot dot--needs_input';
    dot.setAttribute('aria-hidden', 'true');
    const handsV = doc.createElement('span');
    handsV.className = 'minifloor-hands-v num';
    handsV.textContent = '0';
    const handsK = doc.createElement('span');
    handsK.className = 'minifloor-hands-k';
    handsK.textContent = 'hands up';
    hands.appendChild(dot);
    hands.appendChild(handsV);
    hands.appendChild(handsK);
    side.appendChild(hands);

    root.appendChild(side);
    doc.body.appendChild(root);

    els = { root, numeral, numeralV, handsV };
    ctx = canvas.getContext('2d');

    canvas.addEventListener('click', onCanvasClick);
    root.addEventListener('click', (e) => {
      if (e.target !== canvas) focusMain();
    });
  }

  function focusMain() {
    try {
      win.focus();
    } catch {
      /* a browser that refuses the focus still got the click */
    }
  }

  function onCanvasClick(e) {
    const composed = lastComposed;
    focusMain();
    if (!composed || !composed.ok) return;
    const rect = canvas.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    let best = null;
    let bestD = HIT_RADIUS_PX;
    for (const person of composed.people) {
      const d = Math.hypot(person.sx - cx, person.sy - cy);
      if (d <= bestD) {
        bestD = d;
        best = person;
      }
    }
    if (best && deps.onSelect) deps.onSelect(best.id);
  }

  function resizeBacking() {
    const dpr = (pip && pip.devicePixelRatio) || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    return { w, h, dpr };
  }

  function paint(t) {
    if (!pip || !ctx) return;
    const dt = Math.min(0.25, Math.max(0, (t - lastT) / 1000 || 0));
    lastT = t;
    try {
      const scene = deps.getScene && deps.getScene();
      // Keep the people moving while the main floor's own loop is stopped —
      // a hidden tab, which is precisely when this window is the only one on
      // screen. A no-op while that loop runs, so nobody is stepped twice.
      if (scene && typeof scene.stepIfPaused === 'function') scene.stepIfPaused(dt);

      const frame = snapshotOf();
      const { w, h, dpr } = resizeBacking();
      const composed = composeMiniFrame(frame || {}, { width: w, height: h });
      lastComposed = composed;

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawMiniFrame(ctx, composed, {
        width: w,
        height: h,
        backdrop: frame && frame.backdrop,
        reduced: (frame && frame.reduced) || reduced(),
      });
      ctx.restore();

      paintCounts(composed);
      syncMotionAttribute();
      pulseOnArrival(composed);
    } catch (err) {
      if (!frameErrorLogged) {
        frameErrorLogged = true;
        console.error('[deckhq] the mini-floor failed a frame; the window keeps running', err);
      }
    }
    raf = pip.requestAnimationFrame(paint);
  }

  function paintCounts(composed) {
    if (composed.numeral !== lastNumeral) {
      lastNumeral = composed.numeral;
      els.numeralV.textContent = String(composed.numeral);
      // A cleared queue looks calm rather than like a scoreboard reading zero
      // (`05` §2.4) — the same class the header's numeral uses.
      els.numeral.classList.toggle('is-zero', composed.numeral === 0);
      // The same phrasing the floor's own `aria-label` uses, so the two
      // windows say the same sentence about the same number. It is the
      // needs-you count, which is not the same as "in the office" — a raised
      // hand stays at its desk — so the label must not say "in your office".
      canvas.setAttribute(
        'aria-label',
        `${composed.numeral} session${composed.numeral === 1 ? '' : 's'} need you`,
      );
    }
    if (composed.handsUp !== lastHands) {
      lastHands = composed.handsUp;
      els.handsV.textContent = String(composed.handsUp);
    }
  }

  /**
   * The signature moment (`05` §9: "a person walking into your office is the
   * product's signature moment"), in a window the size of a desk widget:
   * somebody who was not in the office is, so the frame flashes once. Reduced
   * motion gets nothing at all — the numeral has already changed, which is the
   * information.
   */
  function pulseOnArrival(composed) {
    const now = nowMs();
    const ids = new Set(composed.officeIds);
    let arrived = false;
    for (const id of ids) {
      if (!officeWas.has(id)) arrived = true;
    }
    officeWas = ids;
    if (arrived && !reduced() && now > pulseUntil) {
      pulseUntil = now + PULSE_MS;
      els.root.classList.remove('is-arriving');
      // Reading offsetWidth is what restarts a CSS animation that is already
      // on the element; without it a second arrival inside the same window
      // would not re-run it.
      void els.root.offsetWidth;
      els.root.classList.add('is-arriving');
    } else if (now > pulseUntil && els.root.classList.contains('is-arriving')) {
      els.root.classList.remove('is-arriving');
    }
  }

  function teardown() {
    if (raf != null && pip) {
      try {
        pip.cancelAnimationFrame(raf);
      } catch {
        /* the window is already gone */
      }
    }
    raf = null;
    pip = null;
    canvas = null;
    ctx = null;
    els = null;
    lastComposed = null;
    lastNumeral = null;
    lastHands = null;
    officeWas = new Set();
  }

  return {
    isOpen: () => Boolean(pip),

    /**
     * Open the window, or say why it cannot be opened.
     * @returns {Promise<boolean>} whether a floating window is now up
     */
    async open() {
      if (pip) {
        try {
          pip.focus();
        } catch {
          /* already up is already up */
        }
        return true;
      }
      if (!canFloat(win)) {
        const count = needsYouNow();
        if (deps.onFallback) deps.onFallback(count);
        if (deps.toast) deps.toast(NO_PIP_MESSAGE);
        return false;
      }
      try {
        pip = await win.documentPictureInPicture.requestWindow({
          width: PIP_SIZE.width,
          height: PIP_SIZE.height,
        });
      } catch (err) {
        pip = null;
        // The commonest cause is a call with no user activation behind it,
        // which is a thing the person can simply do again.
        console.debug('[deckhq] the floating window was refused', err);
        if (deps.toast) deps.toast('The floating window was refused. Try the command again.');
        return false;
      }
      buildDocument();
      pip.addEventListener('pagehide', teardown, { once: true });
      lastT = nowMs();
      raf = pip.requestAnimationFrame(paint);
      return true;
    },

    close() {
      if (!pip) return;
      const w = pip;
      teardown();
      try {
        w.close();
      } catch {
        /* a window that closed itself is closed */
      }
    },

    /** The palette command and the `P` key both land here. */
    toggle() {
      if (pip) {
        this.close();
        return Promise.resolve(false);
      }
      return this.open();
    },
  };
}
