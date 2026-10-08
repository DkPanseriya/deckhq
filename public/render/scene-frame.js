/**
 * WHAT A FRAME HAS TO DO AGAIN, AND WHETHER IT HAS TO BE DRAWN AT ALL.
 *
 * The loop ran `_draw()` on every animation frame, and `_draw()` did all of it
 * every time: measured every wait badge, laid out every room plate, ran the
 * name-collision pass over every body on the floor, and then painted — sixty
 * times a second, on a floor where nobody had moved and the only number that
 * could have changed was a wait that ticks over once a minute. Two questions
 * are asked here instead.
 *
 * 1. IS THE LAYOUT THE SAME ONE? `_layoutFrame` is the badge pass, the plates
 *    and the name pass, lifted out of `_draw()` whole. It is a function of where
 *    everybody is standing, the camera, the snapshot, the selection and which
 *    minute each wait is in, and of nothing else — so those are written down
 *    (`InputTape`) and compared with the last frame's, value for value. The
 *    same inputs get the same answer back without one box being measured.
 *    Somebody walking changes an input and the pass runs, as it always did.
 *
 * 2. IS THE PICTURE THE SAME ONE? `_frameDue` writes down everything the frame
 *    reads — the layout's inputs, every figure's pose and place, the bitmaps,
 *    the hover — and the injected clock as far as the picture depends on it:
 *
 *      - with motion on, the clock itself: every figure breathes, so a clock
 *        that has moved is a new picture. A PINNED clock (`DECKHQ_NOW`, a
 *        golden) has not moved, and the floor is drawn once;
 *      - under `prefers-reduced-motion`, only what the clock can still change:
 *        which minute each wait is in, how many lobes each thought has, which
 *        cables are live. Between two of those the floor is not drawn at all.
 *
 *    The answer is not a prediction of when the next change is due. It is the
 *    same values the draw would read, taken on each tick and compared, so the
 *    frame after any of them moves is drawn — and a tick on which none did
 *    costs a few hundred comparisons and no canvas call.
 *
 * `_draw()` itself stays unconditional: `setState`, a selection and a resize
 * on a stopped loop call it directly, and each such call makes the next tick
 * draw whatever it finds.
 *
 * No clock but the injected one (`animMs`, `clock.js`), and no randomness.
 */

import { badgeBox, characterBox, formatElapsed, formatElapsedShort } from './rig.js';
import { BADGE_MIN_PX_PER_UNIT, JUNIOR_SCALE, characterScaleFor } from './scene-lod.js';
import { layoutPlate, plateLimit, resolveBadgeCollisions } from './scene-labels.js';
import { buildingRect, planFrameLabels } from './scene-frame-labels.js';
import { worldToScreen } from './agents.js';
import { animMs, stateForAgent } from './scene-agent.js';
import { now as clockNow } from '../clock.js';
import { characterLife } from './life.js';
import { CREW_SCALE, crewCableExtent, crewCableLive } from './crew.js';
import { textMetricsEpoch } from './text-metrics.js';
import { SceneStatic } from './scene-static.js';

/**
 * A list of values written down in order and compared, as it is written, with
 * the list written the time before.
 *
 * Numbers and references on separate reels, so nothing is boxed or turned into
 * a string: a tick writes a few thousand of them. `NaN` is the same as `NaN`
 * and a reference is the same when it is the same object — or the same string.
 */
export class InputTape {
  constructor() {
    this._nums = new Float64Array(256);
    this._kept = new Float64Array(256);
    this._n = 0;
    this._keptN = -1;
    /** @type {any[]} */
    this._refs = [];
    /** @type {any[]} */
    this._keptRefs = [];
    this._r = 0;
    this._keptR = -1;
    this._same = false;
  }

  /** Start writing a new list. */
  begin() {
    this._n = 0;
    this._r = 0;
    this._same = this._keptN >= 0;
  }

  /** @param {number} v */
  num(v) {
    const i = this._n++;
    if (i >= this._nums.length) {
      const grown = new Float64Array(this._nums.length * 2);
      grown.set(this._nums);
      this._nums = grown;
    }
    if (this._same && (i >= this._keptN || !Object.is(this._kept[i], v))) this._same = false;
    this._nums[i] = v;
  }

  /** @param {any} o an object, a string, null or undefined */
  ref(o) {
    const i = this._r++;
    if (this._same && (i >= this._keptR || this._keptRefs[i] !== o)) this._same = false;
    this._refs[i] = o;
  }

  /**
   * Finish the list.
   * @returns {boolean} whether it is, value for value, the one written before
   */
  end() {
    const same = this._same && this._n === this._keptN && this._r === this._keptR;
    if (!same) {
      const nums = this._kept.length >= this._n ? this._kept : new Float64Array(this._nums.length);
      nums.set(this._nums.subarray(0, this._n));
      this._kept = nums;
      this._keptN = this._n;
      const refs = this._keptRefs;
      for (let i = 0; i < this._r; i++) refs[i] = this._refs[i];
      refs.length = this._r;
      this._keptR = this._r;
    }
    // Nothing the list pointed at is held past the next one being written.
    this._refs.length = 0;
    return same;
  }

  /** Forget the list written before: the next one is a new one whatever it says. */
  forget() {
    this._keptN = -1;
    this._keptR = -1;
    this._keptRefs.length = 0;
  }
}

/**
 * Which minute a wait is in, as the draw reads it: `formatElapsed` is a
 * function of the whole minutes waited and of nothing finer, and the plates
 * ask whether a wait is over zero. `-1` at no wait at all, `-2` for a clock
 * that is behind the timestamp, `-3` where there is no timestamp.
 * @param {number} now ms epoch @param {unknown} since
 * @returns {number}
 */
export function waitMinute(now, since) {
  if (typeof since !== 'number' || !Number.isFinite(since)) return -3;
  const waited = now - since;
  return waited > 0 ? Math.floor(waited / 60000) : waited === 0 ? -1 : -2;
}

/**
 * How long this agent has been waiting on the user, or `null` where it is not
 * waiting at all — which is the same thing as "has no waiting badge".
 *
 * One copy since WP-60, because two passes ask it: the collision pass that
 * measures every badge in the frame, and the character draw that paints one.
 * Two copies of this condition is how a badge comes to be measured and not
 * drawn, or drawn and not measured.
 *
 * The badge is crimson, and crimson means "standing in your office"
 * (VISUAL-SPEC section 5). A benched agent keeps its `for_review`
 * activityState — bench only moves `ackState` — so without the `ackState`
 * guard the badge would follow it into the lounge and put red on the floor
 * where nothing is waiting on the user.
 *
 * @param {{ackState?:string, activityState?:string, reviewSince?:number|null}} agent
 * @returns {number|null} milliseconds waited
 */
export function waitingBadgeMs(agent) {
  if (agent.ackState !== 'active' || agent.activityState !== 'for_review') return null;
  if (!agent.reviewSince) return null;
  return clockNow() - agent.reviewSince;
}

/** Reduced motion, said to the two crew questions `_frameDue` asks. */
const STILL = Object.freeze({ reduced: true });

/** What `_frameDue` asks `characterLife`, written over for each figure: one object a tick, not one a figure. */
const STILL_LIFE = {
  nowMs: 0,
  state: 'working',
  lod: /** @type {0|1|2} */ (0),
  reduced: true,
  pinned: /** @type {number|null} */ (null),
  flickerAt: /** @type {number|null} */ (null),
  spawnAt: /** @type {number|null} */ (null),
  leftAt: /** @type {number|null} */ (null),
  walking: false,
  running: false,
};

export class SceneFrame extends SceneStatic {
  /**
   * HOW BIG THIS JUNIOR IS DRAWN, as a fraction of its parent (WP-89).
   *
   * A member of a FORMATION is `CREW_SCALE`; a junior standing beside its parent
   * in WP-41's old way keeps `JUNIOR_SCALE`. Read off the SEAT rather than off
   * the agent, because the seat is what `assignSeats` decided and a junior whose
   * room could not hold an arc is drawn at the old size in the old rows.
   *
   * That split is also what keeps every committed golden at 0 px: the `demo`
   * floor's senior has two juniors, which is not a crew.
   * @param {any} rec
   */
  _juniorScaleOf(rec) {
    const seat = rec && rec.targetSeat;
    return seat && seat.crew === true ? CREW_SCALE : JUNIOR_SCALE;
  }

  /**
   * The figures this frame draws, in painter order: everybody on the canvas or
   * within a body of it, nearest the top first.
   * @param {{zoom:number, panX:number, panY:number, U:number}} camera
   * @param {number} viewW @param {number} viewH
   * @returns {any[]}
   */
  _frameRecords(camera, viewW, viewH) {
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
    return records;
  }

  /**
   * Write down the settings a plate is written from. The application replaces
   * `snapshot.settings` in place when one is saved, with no new snapshot, so
   * the snapshot being the same object does not mean these are.
   * @param {InputTape} tape
   */
  _tapeSettings(tape) {
    const settings = this._snapshot && this._snapshot.settings;
    tape.ref(settings);
    tape.ref(settings ? settings.showCost : undefined);
  }

  /**
   * Write down which minute every wait on the floor is in.
   * @param {InputTape} tape @param {number} now
   */
  _tapeWaits(tape, now) {
    const agents = (this._snapshot && this._snapshot.agents) || [];
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      tape.num(a ? waitMinute(now, a.reviewSince) : -3);
      tape.num(a ? waitMinute(now, a.needsInputSince) : -3);
    }
  }

  /**
   * THE FRAME'S LAYOUT: every wait badge and the pills that stand for the ones
   * that collide, every room plate, and where every name goes round all of
   * them. Nothing is painted. The same inputs as the frame before get the same
   * layout back, unmeasured.
   *
   * @param {CanvasRenderingContext2D} ctx
   * @param {any[]} records `_frameRecords`
   * @param {{zoom:number, panX:number, panY:number, U:number}} camera
   * @returns {{charU:number, badgePlan:any, plates:Map<string, any>, labels:any}}
   */
  _layoutFrame(ctx, records, camera) {
    const charU = this._characterScale();
    const tape = this._layoutTape || (this._layoutTape = new InputTape());
    tape.begin();
    tape.num(this._stateGen);
    tape.num(this._paintGen);
    tape.num(textMetricsEpoch());
    tape.num(camera.panX);
    tape.num(camera.panY);
    tape.num(camera.zoom);
    tape.num(this._scale());
    tape.num(charU);
    tape.ref(this._plan);
    tape.ref(this._selectedId);
    this._tapeSettings(tape);
    tape.num(records.length);
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      tape.ref(rec);
      tape.ref(rec.targetSeat);
      tape.ref(rec.agent);
      tape.num(rec.x);
      tape.num(rec.y);
    }
    this._tapeWaits(tape, clockNow());
    if (tape.end() && this._layout) return this._layout;
    return (this._layout = this._measureFrame(ctx, records, camera, charU));
  }

  /**
   * `_layoutFrame`, measured: the three passes as `_draw()` always ran them.
   * @param {CanvasRenderingContext2D} ctx @param {any[]} records
   * @param {{zoom:number, panX:number, panY:number, U:number}} camera
   * @param {number} charU
   */
  _measureFrame(ctx, records, camera, charU) {
    // WAITING-BADGE COLLISION PASS (WP-60), the same shape as the label pass
    // below and for the same reason: seven crimson pills along one office wall
    // overlapped into a band of digits, and a pill can only stay out of its
    // neighbour's way if something measured both before either was drawn.
    //
    // IT RUNS FIRST SINCE WP-79, and the order is the point: a waiting badge
    // is the loudest thing this floor draws and it never moves, so everything
    // else has to know where it landed. It used to run second because nothing
    // else needed the answer.
    //
    // The gate is the one `_drawCharacterAt` uses, asked once here so the two
    // cannot disagree about which badges exist this frame.
    let badgePlan = null;
    /** @type {{id:string,x:number,y:number,w:number,h:number}[]} */
    const badgeBoxes = [];
    if (this._scale() >= BADGE_MIN_PX_PER_UNIT) {
      const items = [];
      for (const rec of records) {
        const agent = this._agentsById.get(rec.id);
        const ms = agent ? waitingBadgeMs(agent) : null;
        if (ms === null) continue;
        const s = worldToScreen(rec, camera);
        // A junior is drawn smaller, so its badge is a smaller box. Measured
        // at the scale it will be drawn at, exactly as the label pass does.
        const u =
          agent.subagent === true
            ? characterScaleFor(this._scale() * this._juniorScaleOf(rec))
            : charU;
        const box = badgeBox(ctx, s.x, s.y, u, formatElapsed(ms));
        // And the box of its short form, which it is drawn in where the badge
        // beside it leaves no room for the whole wait.
        const cut = badgeBox(ctx, s.x, s.y, u, formatElapsedShort(ms));
        const short = cut.w < box.w ? { x: cut.x, w: cut.w } : undefined;
        items.push({ id: rec.id, x: box.x, y: box.y, w: box.w, h: box.h, ms, short });
      }
      const bodies = records.map((rec) => {
        const s = worldToScreen(rec, camera);
        return { id: rec.id, ...characterBox(s.x, s.y, charU) };
      });
      badgePlan = resolveBadgeCollisions(items, bodies);
      for (const it of items) {
        if (!badgePlan.drawn.has(it.id)) continue;
        const at = badgePlan.short.has(it.id) && it.short ? it.short : it;
        badgeBoxes.push({ ...it, x: at.x, w: at.w, id: `badge:${it.id}` });
      }
      for (const [i, pill] of badgePlan.pills.entries()) {
        const probe = badgeBox(ctx, 0, 0, charU, `${pill.count} waiting · oldest 00h 00m`);
        badgeBoxes.push({ id: `pill:${i}`, x: pill.x, y: pill.y, w: probe.w, h: probe.h });
      }
    }

    // THE PLATES ARE LAID OUT BEFORE ANY NAME IS SET (audit F7). They are still
    // painted last, over the characters, but a name that hangs below an
    // office row into the lounge's band has to know the plate is there, so
    // each plate's rows and rect are measured here, once, and the same layout
    // is handed to `_drawRoomPlate` — with the plate's own lines, so the room
    // is not asked for them a second time when it is painted.
    /** @type {Map<string, any>} */
    const plates = new Map();
    for (const room of this._plan ? this._plan.rooms : []) {
      // A corridor has no name and no data line.
      if (room.kind === 'corridor') continue;
      const limit = plateLimit(room, badgeBoxes, camera);
      const plate = this._platePlanFor(room);
      plates.set(room.id, { ...layoutPlate(ctx, room, plate, camera, limit), plate });
    }

    // Name-label collision pass (tech-lead review finding 1), at EVERY level
    // of detail since the 24 September audit: every body, badge, crew hand and
    // chip and every room plate is a pinned obstacle, and every name is placed
    // around them — `scene-frame-labels.js` has the rule and its test.
    const labels = planFrameLabels(ctx, {
      records,
      agentsById: this._agentsById,
      camera,
      charU,
      crewCounts: this._crewCounts,
      badgeBoxes,
      plateBoxes: [...plates.values()].map((p) => p.rect),
      selectedId: this._selectedId,
      bounds: this._plan ? buildingRect(this._plan, camera) : undefined,
      uOf: (rec) => {
        const a = this._agentsById.get(rec.id) || rec.agent;
        return a && a.subagent === true
          ? characterScaleFor(this._scale() * this._juniorScaleOf(rec))
          : charU;
      },
    });
    return { charU, badgePlan, plates, labels };
  }

  /**
   * IS THERE A NEW PICTURE TO DRAW? Everything a frame reads, written down and
   * compared with what was written before the last frame the loop drew.
   *
   * @returns {boolean} false only where the frame would be, pixel for pixel,
   *   the one already on the canvas
   */
  _frameDue() {
    const tape = this._frameTape || (this._frameTape = new InputTape());
    // A frame somebody drew directly is not the one the last list describes.
    // So is every frame of a re-plan's cross-fade, which is a new picture each time.
    if (this._drawnDirect || this._fadeFrom) tape.forget();
    this._drawnDirect = false;
    tape.begin();
    tape.num(this._stateGen);
    tape.num(this._paintGen);
    tape.num(textMetricsEpoch());
    tape.num(this.canvas.width);
    tape.num(this.canvas.height);
    tape.num(this._dpr);
    tape.num(this._camera.panX);
    tape.num(this._camera.panY);
    tape.num(this._fitScale);
    tape.num(this._zoom);
    tape.num(this._reduced ? 1 : 0);
    tape.num(this._phase === null ? -1 : this._phase);
    tape.ref(this._snapshot);
    this._tapeSettings(tape);
    tape.ref(this._plan);
    tape.ref(this._backdrop);
    tape.ref(this._detail);
    tape.ref(this._selectedId);
    const hover = this._hoveredTarget;
    tape.ref(hover ? hover.kind : null);
    tape.ref(hover ? hover.id : null);

    const now = animMs();
    const reduced = this._reduced;
    const lod = this._lod();
    let figures = 0;
    for (const rec of this._runtime.all()) {
      figures++;
      tape.ref(rec);
      tape.ref(rec.targetSeat);
      tape.ref(rec.agent);
      tape.ref(rec.clip);
      tape.ref(rec.placement);
      tape.num(rec.x);
      tape.num(rec.y);
      tape.num(rec.angle);
      tape.num(rec.path ? rec.path.length : 0);
      tape.num(rec.running === true ? 1 : 0);
      tape.num(rec.seated ? 1 : 0);
      tape.num(rec.clipStartedAt);
      tape.num(rec.flickerAt ?? -1);
      tape.num(rec.spawnAt ?? -1);
      tape.num(rec.leftAt ?? -1);
      if (!reduced) continue;
      // Under reduced motion a figure is its still frame, and the clock
      // reaches it only through these: what `characterLife` makes of it, and
      // whether its crew cable is live and drawn.
      const agent = this._agentsById.get(rec.id) || rec.agent;
      if (!agent) continue;
      const walking = !!rec.path && rec.path.length > 0;
      const ask = STILL_LIFE;
      ask.nowMs = now;
      ask.state = stateForAgent(agent);
      ask.lod = lod;
      ask.pinned = this._phase;
      ask.flickerAt = rec.flickerAt ?? null;
      ask.spawnAt = rec.spawnAt ?? null;
      ask.leftAt = rec.leftAt ?? null;
      ask.walking = walking;
      ask.running = walking && rec.running === true;
      const life = characterLife(agent, ask);
      tape.num(life.flicker);
      tape.num(life.lobes);
      tape.num(life.cloud);
      tape.num(life.card);
      tape.num(life.dots);
      tape.num(life.power);
      tape.num(life.scale);
      tape.num(life.fade);
      tape.num(life.still ? 1 : 0);
      if (rec.targetSeat && rec.targetSeat.crew) {
        tape.num(crewCableLive(agent, now, STILL));
        tape.num(crewCableExtent(now, rec, STILL));
      }
    }
    if (reduced || figures === 0) {
      // The waits on the badges and the plates, and — for a crew's chip, which
      // counts who is working over the whole crew — every junior's cable.
      this._tapeWaits(tape, now);
      const agents = (this._snapshot && this._snapshot.agents) || [];
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i];
        if (a && a.subagent === true) tape.num(crewCableLive(a, now, STILL));
      }
    } else {
      // Motion on, and somebody to move: the clock is the picture.
      tape.num(now);
    }
    return !tape.end();
  }
}
