/**
 * The rebuild, the frame loop, and painter order (WP-22 follow-up).
 *
 * Split out of `scene.js` unchanged: the plan signature that decides when the
 * floor is re-planned and the backdrop re-baked, `_rebuildPlan()` itself, the
 * two loop controls, the frame, and every paint call under it.
 *
 * Painter order is the whole point of `_draw()` — backdrop, then fixtures,
 * then plates, then characters, then affordances — and not one line of it
 * moved.
 */

import { buildPlan, floorPopulation, U } from './plan.js';
import { LOOK } from './look-derive.js';
import {
  bakeBackdrop,
  setLightShadow,
  ENVELOPE_SHADOW_BLUR_PX,
  ENVELOPE_SHADOW_DIST_PX,
} from './backdrop.js';
import { badgeBox, drawBadge, drawCharacter, formatElapsed } from './rig.js';
import { sampleClip, clipDuration, makeActivityRotation, makeIdleRotation } from './clips.js';
import { PALETTE, STATE_COLORS, fadedOut, identityFor, appearanceOf } from './palette.js';
import { rigSeatOf, worldToScreen } from './agents.js';
import { JUNIOR_SCALE, BADGE_MIN_PX_PER_UNIT, characterScaleFor } from './scene-lod.js';
import { layoutPlate, resolveBadgeCollisions } from './scene-labels.js';
import { buildingRect, planFrameLabels } from './scene-frame-labels.js';
import { SceneHit, PLUS_SIZE_U, PLUS_MARGIN_U, PLUS_HIT_RADIUS_PX } from './scene-hit.js';
import { colorForAgent, stateForAgent, iconForAgent, frameMs, animMs } from './scene-agent.js';
import { now as clockNow } from '../clock.js';
import { characterLife } from './life.js';
import { CREW_SCALE, crewCableLive } from './crew.js';
import { drawCrews } from './crew-draw.js';

/** How long a re-plan cross-fades for. Skipped under reduced motion. */
export const REPLAN_FADE_MS = 260;

/**
 * Where the ground's falloff starts, as a fraction of the building's own
 * half-diagonal (WP-72). Under 1, so the ramp begins under the floor and the
 * ground beside the building is already descending — at 1 the whole margin
 * beside a wide building sits at full strength and the wash ends in a straight
 * line where the canvas does.
 */
export const GROUND_FALLOFF_INNER = 0.7;

/**
 * How long this agent has been waiting on the user, or `null` where it is not
 * waiting at all — which is the same thing as "has no waiting badge".
 *
 * One copy since WP-60, because two passes now ask it: the collision pass that
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
function waitingBadgeMs(agent) {
  if (agent.ackState !== 'active' || agent.activityState !== 'for_review') return null;
  if (!agent.reviewSince) return null;
  return clockNow() - agent.reviewSince;
}

/**
 * A structural signature of the plan: the project set plus each project's
 * session count. Project rooms are sized from `sessionCount` (docs/03-VISUAL-SPEC.md
 * §2.2), so this is exactly "did the geometry change" — everything else that
 * changes on every push (token counts, needsYou, etc.) is drawn live on the
 * room plates from the snapshot directly, not baked.
 */
export function planSignature(snapshot) {
  const projects = (snapshot && snapshot.projects) || [];
  const agents = (snapshot && snapshot.agents) || [];
  // WP-50: the plan is a function of active projects and active agents, so the
  // signature has to be too. A project's room exists only while somebody in it
  // is active, its desks are the agents at them, and the lounge is sized by
  // who is DRAWN — so benching the last active agent in a repo, or a benched
  // agent crossing the gone-home window, both change the geometry without
  // changing a single session count.
  const pop = floorPopulation(agents, {
    // WP-63. `floor-rule.js` may import nothing — it is the one module both
    // sides load, and `test/unit/model.test.mjs` enforces that — so the clock
    // is handed IN here rather than read there. It decides who has gone home,
    // which is geometry, so a signature computed against a different instant
    // than the floor it describes would re-bake the backdrop for nothing.
    now: clockNow(),
    goneHomeDays: (snapshot && snapshot.settings && snapshot.settings.goneHomeDays) ?? undefined,
  });
  // The floor's GEOMETRY depends on more than the project set. The lounge
  // grows a games table at three, five, seven, nine and eleven benched agents;
  // the departures room exists only while somebody is in it and is sized from
  // how many; the waiting area lays out loose chairs once the sofas are full.
  // Keying the rebuild on projects alone left all three stale, so a session
  // that was benched or archived was assigned a seat that did not exist — and
  // an agent with no seat is parked at the floor's origin.
  let letGo = 0;
  for (const a of agents) {
    if (a && a.ackState === 'let_go') letGo++;
  }
  return [
    projects
      .map(
        (p) =>
          `${p.id}:${p.sessionCount}:${pop.active.get(String(p.id)) ?? -1}:${
            pop.desks.get(String(p.id)) ?? -1
          }:${p.archived ? 1 : 0}`,
      )
      .sort()
      .join('|'),
    `w${pop.waiting}`,
    `b${pop.benchedDrawn}`,
    `h${pop.goneHome.size}`,
    `g${letGo}`,
    // WP-30. The theme changes no geometry at all — it repaints materials —
    // but the backdrop is BAKED, so the only way a new floor colour reaches
    // the screen is a re-bake, and `_rebuildPlan` is the only thing that
    // bakes. Putting the theme in the signature is therefore not a hack: the
    // signature's job is "does the baked bitmap still describe this
    // snapshot", and after a theme change it does not.
    `t${(snapshot && snapshot.settings && snapshot.settings.theme) || 'default'}`,
    // WP-88b, and the theme's reason with one clause more. A look repaints
    // materials the way a theme does — so the baked bitmap stops describing the
    // snapshot the moment it changes — but a look ALSO moves geometry: the
    // planting and prop densities and the lounge kit are read while the plan is
    // being built (docs/DEVIATIONS.md §175.6), so turning the games bay off
    // changes the building and not only its paint. The whole document, because
    // every key in it is one of those two things.
    `l${JSON.stringify((snapshot && snapshot.settings && snapshot.settings.look) || '')}`,
    // WP-88c, and it is NOT covered by the line above. `?scale=` and `?look=`
    // paint this tab without touching `settings.look`, so the size the floor is
    // actually laid at can differ from the one the snapshot carries — and the
    // resolved look is the authority on which. It also settles the first paint:
    // `applyLook` may land after the first snapshot, and a signature that could
    // not see the difference would keep the medium bake.
    `a${LOOK.agentSize || ''}`,
  ].join('~');
}

export class SceneDraw extends SceneHit {
  /**
   * Rebuild the plan and its baked backdrop for a given target aspect, then
   * bring the camera's fit basis back into a valid state for the new plan
   * dimensions. Used by both the content-driven path in `setState` and the
   * debounced resize-driven path in `_checkAspectRebuild`.
   * @param {number} targetAspect
   */
  _rebuildPlan(targetAspect) {
    const agents = this._snapshot.agents || [];
    // A re-plan is a new building. Walls that pop are the reason for the
    // cross-fade below: the old backdrop is kept and faded out over the new
    // one, so a room appearing or folding into the directory reads as a
    // change rather than as a flicker. Reduced motion gets the cut.
    //
    // So does a stopped loop (a hidden tab). A fade needs frames to run; with
    // none, the single `_draw` that `setState` makes would paint the OLD floor
    // over the new one at full opacity and leave it there until the tab came
    // back — the flicker this exists to remove, held still.
    const previous =
      this._backdrop && this._plan && !this._reduced && this._running
        ? {
            backdrop: this._backdrop,
            plan: this._plan,
            scale: this._scale(),
            camera: { ...this._camera },
          }
        : null;
    this._plan = buildPlan(this._snapshot.projects || [], agents, {
      targetAspect,
      // The stage the floor is about to be drawn on (WP-59). `targetAspect` is
      // this same measurement clamped, and is still what the plan reasons
      // with; handing over the box as well is what lets a caller that has one
      // pass it rather than deriving the ratio itself, and what makes the
      // "does the building fill the window" question askable of `buildPlan`
      // in a test with no canvas.
      stage: { w: this._viewW, h: this._viewH },
      // WP-63, and the same reason as in `planSignature` above: the plan and
      // its signature have to be asking the gone-home question of one clock.
      now: clockNow(),
      goneHomeDays: (this._snapshot.settings || {}).goneHomeDays,
      // WP-88c. Off the RESOLVED look rather than off the snapshot, because
      // `?scale=` and `?look=` paint this tab and write nothing back — the same
      // reason `planSignature` reads it from there too.
      agentSize: LOOK.agentSize,
    });
    this._backdrop = bakeBackdrop(this._plan, this._dpr);
    this._fadeFrom = previous;
    this._fadeStartedAt = previous ? frameMs() : 0;
    this._recomputeFitScale();
    // The pan referred to a floor that no longer exists, so it is discarded;
    // the magnification is the user's and is kept.
    this._centerCamera();
    this.canvas.style.cursor = this._pannable() ? 'grab' : '';
  }

  /**
   * The ground's radial falloff, as a paint (WP-72).
   *
   * Darker away from the building: transparent at the envelope's own corner
   * radius, `PALETTE.groundFalloff` at whichever corner of the window is
   * furthest from the building's centre — so the darkest point of the wash is
   * always as far from the floor as the window goes, whatever shape the
   * building came out and wherever it is sitting.
   *
   * MEMOISED, because everything it depends on changes on a resize or a
   * re-plan and on nothing else. A `CanvasGradient` is an object the context
   * compiles once; rebuilding it sixty times a second to describe a picture
   * that has not moved is the per-frame cost this package promised not to add.
   * The key carries the palette token as well as the geometry, so a theme
   * change repaints it — the theme is what `groundFalloff` comes from.
   *
   * @param {number} viewW @param {number} viewH
   * @param {number} x @param {number} y @param {number} w @param {number} h
   * @returns {CanvasGradient|null}
   */
  _groundFalloff(viewW, viewH, x, y, w, h) {
    const colour = PALETTE.groundFalloff;
    const key = `${Math.round(viewW)}x${Math.round(viewH)}|${Math.round(x)},${Math.round(
      y,
    )},${Math.round(w)},${Math.round(h)}|${colour}`;
    if (this._groundWash && this._groundWash.key === key) return this._groundWash.paint;
    const ctx = this.ctx;
    if (!ctx || !colour) return null;
    const cx = x + w / 2;
    const cy = y + h / 2;
    // The furthest corner of the window from the building's centre. Using the
    // window's own diagonal instead would put the darkest stop off-screen on
    // an off-centre floor and flatten the whole wash.
    const outer = Math.max(
      1,
      Math.hypot(cx, cy),
      Math.hypot(viewW - cx, cy),
      Math.hypot(cx, viewH - cy),
      Math.hypot(viewW - cx, viewH - cy),
    );
    // The ramp starts INSIDE the building, at `GROUND_FALLOFF_INNER` of its
    // half-diagonal, so the ground beside it is already part-way down the
    // gradient rather than sitting at full strength in a flat band that ends
    // in a seam at the edge of the canvas. Everything before that point is
    // covered by the envelope anyway.
    const inner = Math.min((Math.hypot(w, h) / 2) * GROUND_FALLOFF_INNER, outer * 0.98);
    const paint = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
    paint.addColorStop(0, colour);
    paint.addColorStop(1, fadedOut(colour));
    this._groundWash = { key, paint };
    return paint;
  }

  // -------------------------------------------------------------- frame loop

  _startLoop() {
    if (this._running) return;
    this._running = true;
    this._lastT = frameMs();
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
      this._runtime.step(dt, {
        reduced: this._reduced,
        plan: this._plan,
        // WP-87. The runtime writes clip phases and rotation holds, and every
        // one of them is now an instant on the INJECTED clock rather than
        // `Date.now()` — see `animMs()`. `dt` stays the frame clock's, because
        // an interval is a fact about this tab and nothing else.
        now: animMs(),
        makeActivityRotation,
        makeIdleRotation,
      });
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

      // THE GROUND FALLS AWAY FROM THE BUILDING (WP-72). One radial gradient,
      // transparent where the floor ends and `groundFalloff` at the furthest
      // corner of the window, painted BEFORE the envelope so the building and
      // its shadow land on top of it. It is what makes the ground a surface
      // the building is standing on rather than a backing colour it happens to
      // be cut out of.
      //
      // The gradient object is built once per camera and reused (see
      // `_groundFalloff`), so what this costs per frame is one composite of a
      // cached paint — the same class of cost as the envelope fill below,
      // which has always been here. It cannot be baked: the bake IS the
      // envelope, and this is by definition the part outside it.
      const wash = this._groundFalloff(viewW, viewH, shadowX, shadowY, shadowW, shadowH);
      if (wash) {
        ctx.save();
        ctx.fillStyle = wash;
        ctx.fillRect(0, 0, viewW, viewH);
        ctx.restore();
      }

      ctx.save();
      setLightShadow(ctx, {
        blur: ENVELOPE_SHADOW_BLUR_PX,
        dist: ENVELOPE_SHADOW_DIST_PX,
        color: PALETTE.floorDropShadow,
      });
      ctx.fillStyle = PALETTE.floorGround;
      ctx.fillRect(shadowX, shadowY, shadowW, shadowH);
      ctx.restore();

      paint(camera, 0, viewW);

      // A RE-PLAN IS ANIMATED, NOT POPPED (`08` B6).
      //
      // A room appears when its first agent sits down and folds into the
      // directory when its last one leaves, and the whole envelope resizes
      // with it. Sliding individual walls would mean interpolating between two
      // different buildings — different room counts, different bands, a
      // different width — which the plan has no representation for; the floor
      // is one baked bitmap by design (re-baking is ~190 ms). So the old floor
      // is drawn OVER the new one and faded out. Recorded as a deviation.
      const fade = this._fadeFrom;
      if (fade) {
        const t = (frameMs() - this._fadeStartedAt) / REPLAN_FADE_MS;
        if (t >= 1 || this._reduced) {
          this._fadeFrom = null;
        } else {
          ctx.save();
          ctx.globalAlpha = 1 - t;
          ctx.translate(fade.camera.panX, fade.camera.panY);
          ctx.scale(fade.scale / U, fade.scale / U);
          ctx.drawImage(fade.backdrop.canvas, 0, 0, fade.plan.width * U, fade.plan.height * U);
          ctx.restore();
        }
      }
    }

    // LOD is the drawn figure's height (`scene-lod.js`), and it only ever
    // takes detail off a body: names, plate lines and crews draw at every tier.
    const lod = this._lod();
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
    const charU = this._characterScale();
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
        items.push({ id: rec.id, x: box.x, y: box.y, w: box.w, h: box.h, ms });
      }
      badgePlan = resolveBadgeCollisions(items);
      for (const it of items) {
        if (badgePlan.drawn.has(it.id)) badgeBoxes.push({ ...it, id: `badge:${it.id}` });
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
    // is handed to `_drawRoomPlate` below.
    /** @type {Map<string, any>} */
    const plates = new Map();
    for (const room of this._plan ? this._plan.rooms : []) {
      // A corridor has no name and no data line.
      if (room.kind === 'corridor') continue;
      plates.set(room.id, layoutPlate(ctx, room, this._platePlanFor(room), camera));
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

    // WP-89 · THE CREWS, UNDER THE BODIES. §1.5: everything this design draws
    // sits under the chrome band, and a cable that ran over a face would be the
    // clearest possible way of breaking that. The routes were baked into the
    // seats by `assignSeats` when the plan was built; this walks them.
    drawCrews(ctx, {
      records,
      agentsById: this._agentsById,
      camera,
      scale: this._scale(),
      charU,
      lod,
      reduced: this._reduced,
      pinned: this._phase,
      nowMs: animMs(),
      crewCounts: this._crewCounts,
      seatOf: (id) => {
        const parent = this._runtime.get(id);
        return parent ? parent.targetSeat : null;
      },
    });

    for (const rec of records) {
      this._drawCharacterAt(rec, camera, lod, labels, badgePlan);
    }

    // The aggregate pills, over the characters whose own badges they replace.
    // After the loop rather than inside it: a pill stands for a whole row, so
    // it belongs to no one character and must not be painted under the next
    // body along.
    if (badgePlan) {
      for (const pill of badgePlan.pills) {
        const text = `${pill.count} waiting · oldest ${formatElapsed(pill.oldest)}`;
        // `drawBadge` centres its pill on `ox` and hangs it a fixed distance
        // ABOVE `oy`, because that is what a badge over a character is. This
        // pill's box is already decided, so both are inverted through the same
        // measurement rather than re-derived — one copy of the offset.
        const probe = badgeBox(ctx, 0, 0, charU, text);
        drawBadge(
          ctx,
          pill.x + probe.w / 2,
          pill.y - probe.y,
          charU,
          text,
          STATE_COLORS.for_review,
        );
      }
    }

    this._plateRects = [];
    this._fixtureRects = [];
    if (this._plan) {
      for (const room of this._plan.rooms) {
        // A corridor has no name and no data line. It used to be measured,
        // ellipsised and hit-registered every frame anyway, which on the
        // current plan is two thirds of the rooms on the floor.
        if (room.kind === 'corridor') continue;
        this._drawRoomPlate(room, camera, plates.get(room.id));
        // The whiteboard/shelf/screen/"+" are project-room fixtures only —
        // the office and lounge have neither a project to launch nor a
        // whiteboard.
        if (room.kind === 'project') this._drawRoomFixtures(room, camera);
      }
    }

    ctx.restore();
  }

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

  _drawCharacterAt(rec, camera, lod, labels, badgePlan) {
    const ctx = this.ctx;
    // WP-87: a record whose id has LEFT the snapshot is kept for `despawn`'s
    // 0.42 s so the figure can fold away, and for those few frames the only
    // agent there is to draw is the one the record was last synced against.
    const agent = this._agentsById.get(rec.id) || rec.agent;
    if (!agent) return;
    // People are drawn at their own scale (`_characterScale`), which is the
    // world scale except on a floor small enough that a body would drop below
    // 16 px — 05-GUI-UX-SPEC.md §6.2. A junior is drawn at `JUNIOR_SCALE` of
    // the floor's scale and then through the same floor, so it is smaller
    // than its senior everywhere there is room for it to be (WP-41).
    const u =
      agent.subagent === true
        ? characterScaleFor(this._scale() * this._juniorScaleOf(rec))
        : this._characterScale();
    // This frame's name and where it goes, resolved once before any character
    // is drawn (`planFrameLabels` in `_draw`). No text is a crew member whose
    // type another member of its formation carries; a `null` placement is a
    // resting figure's name the lounge had no room for.
    const text = labels ? labels.texts.get(rec.id) : null;
    const spot = text ? labels.plan.get(rec.id) : null;
    const label = spot ? text : null;
    const labelOffsetY = spot ? spot.offsetY : 0;
    const labelOffsetX = spot ? spot.offsetX || 0 : 0;
    const s = worldToScreen(rec, camera);
    // While mid-walk, sample `walk` — or `run`, on the one trip that runs
    // (WP-87, `12-MOTION-AND-CREW.md` §2) — regardless of `rec.clip`, which
    // still names the *previous* clip until arrival (see agents.js
    // `stepAgent`). `t` is deliberately not reset when this switches: both
    // loop, so `sampleClip` just wraps, and a continuously-increasing `t` is
    // all a looping clip needs for smooth playback.
    const walking = rec.path.length > 0;
    const running = walking && rec.running === true;
    const clipName = walking ? (running ? 'run' : 'walk') : rec.clip || 'type';
    // WP-87. THE ANIMATION CLOCK, and it is an epoch instant now rather than
    // `performance.now()` — see `animMs()`. `rec.clipStartedAt` is a real
    // timestamp on the agent wherever the agent carries one, so two tabs draw
    // the same frame and a reload does not restart a cycle. `?phase=` pins the
    // phase of every clip without disabling motion, which is the seam the
    // `demo@motion` golden is taken through.
    const now = animMs();
    const pinned = this._phase;
    const t = pinned === null ? (now - rec.clipStartedAt) / 1000 : pinned * clipDuration(clipName);
    // WP-87 · everything this figure is doing beyond its pose, from the snapshot
    // and the clock (`life.js`); a shared scratch `drawCharacter` reads at once.
    // Asked BEFORE the pose, because an ended figure whose power-down has run
    // is STILL (`life.still`): it holds the clip's still frame, as under
    // reduced motion, rather than breathing through the slump for ever.
    const life = characterLife(agent, {
      nowMs: now,
      state: stateForAgent(agent),
      lod,
      reduced: this._reduced,
      pinned,
      flickerAt: rec.flickerAt ?? null,
      spawnAt: rec.spawnAt ?? null,
      leftAt: rec.leftAt ?? null,
      walking,
      running,
    });
    const pose = sampleClip(clipName, t, this._reduced || life.still);
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
    // rather than a taste call — and it is asked of the WORLD scale, because
    // the pitch between two seats is a fact about the floor, not about how
    // large the people standing on them are drawn.
    //
    // AND ONLY WHERE IT CAN BE READ BESIDE ITS NEIGHBOURS (WP-60). The gate
    // above is about the floor's scale and this one is about the row: a badge
    // that collides with the badge next to it is replaced by one aggregate
    // pill for the whole row, drawn once in `_draw`. The icon and the name are
    // untouched — suppressing a badge says "the times are on the plate and in
    // the panel", never "this person is not waiting".
    const waitingMs = this._scale() >= BADGE_MIN_PX_PER_UNIT ? waitingBadgeMs(agent) : null;
    const badge =
      waitingMs !== null && (!badgePlan || badgePlan.drawn.has(rec.id))
        ? formatElapsed(waitingMs)
        : null;

    // Project identity (CONTRACTS-WP15.md §2): hair, a small clothing accent
    // and a shoulder/back glyph, all derived from the agent's project (never
    // the torso, which stays `color` — the state colour, unconditionally).
    // `identityFor` is tolerant of a missing/unresolved `projectMk`, so this
    // is safe to call for every agent without a guard.
    const identity = identityFor(agent.projectMk, agent.avatar);
    // Per-agent appearance (WP-20): who this particular session is — hair
    // style, skin, an outfit accent, glasses, build, and a rarity trait on a
    // minority of agents. A pure function of the session id, so it needs
    // nothing from the snapshot and nothing persisted, and like `identityFor`
    // it is total: an id that has not resolved yet still draws.
    const appearance = appearanceOf(agent);

    drawCharacter(ctx, pose, {
      x: s.x,
      y: s.y,
      u,
      lod,
      color: colorForAgent(agent),
      // WP-79: which of the six B is posed in, and whether it is mid-walk.
      // Both are the scene's to say — `rec.clip` still names the PREVIOUS clip
      // until a walk arrives, so the rig cannot work it out from the pose.
      state: stateForAgent(agent),
      walking,
      // The idle micro-motion's clock, and the only one: `animMs()` IS the
      // injected clock now — `public/clock.js`, pinned when the daemon's is —
      // so a golden is a golden and `prefers-reduced-motion` freezes the figure
      // outright (WP-87; the comment that used to sit here said this of
      // `performance.now()`, which nothing could pin).
      seconds: now / 1000,
      phase: pinned,
      life,
      // WP-97 · sitting where the seat says: a desk, a sofa, or a crew's floor
      // with the laptop's lid open exactly as far as its cable is live.
      seat: rigSeatOf(rec, pose),
      laptop: rec.targetSeat?.crew ? crewCableLive(agent, now, { reduced: this._reduced }) : null,
      // Resolved once per frame by `_draw`'s collision pass; the rig gates it.
      label,
      labelOffsetY,
      labelOffsetX,
      icon,
      badge,
      // WP-52: what this session is doing right now, straight off the
      // snapshot. `rig.js` decides how much of it fits — the bubble at L1+,
      // the tool class alone at L0 or under reduced motion — and yields the
      // slot entirely to `icon`/`badge` when either is present. A snapshot
      // from a daemon that predates the field simply has none, and nothing is
      // drawn.
      tool: agent.currentTool || null,
      identity,
      appearance,
      selected: rec.id === this._selectedId,
      reduced: this._reduced,
    });
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
}
