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
import { badgeBox, drawBadge, drawCharacter, formatElapsed, formatElapsedShort } from './rig.js';
import { sampleClip, clipDuration, makeActivityRotation, makeIdleRotation } from './clips.js';
import { PALETTE, STATE_COLORS, fadedOut, identityFor, appearanceOf } from './palette.js';
import { rigSeatOf, worldToScreen } from './agents.js';
import { BADGE_MIN_PX_PER_UNIT, juniorScaleFor } from './scene-lod.js';
import { PLUS_SIZE_U, PLUS_MARGIN_U, PLUS_HIT_RADIUS_PX } from './scene-hit.js';
import { SceneFrame, waitingBadgeMs } from './scene-frame.js';
import { colorForAgent, stateForAgent, iconForAgent, frameMs, animMs } from './scene-agent.js';
import { now as clockNow } from '../clock.js';
import { characterLife } from './life.js';
import { crewCableLive } from './crew.js';
import { drawCrews } from './crew-draw.js';
import { drawWorktreeLabels } from './worktree-draw.js';

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
 * A structural signature of the plan: the project set plus each project's
 * session count. Project rooms are sized from `sessionCount` (docs/03-VISUAL-SPEC.md
 * §2.2), so this is exactly "did the geometry change" — everything else that
 * changes on every push (token counts, needsYou, etc.) is drawn live on the
 * room plates from the snapshot directly, not baked.
 */
export function planSignature(snapshot) {
  return joinPlanSignature(planSignatureParts(snapshot));
}

/** The two halves as the one string `planSignature` has always been. */
export function joinPlanSignature({ geometry, theme }) {
  return [...geometry.slice(0, 5), theme, ...geometry.slice(5)].join('~');
}

/**
 * `planSignature`, in the two halves it is made of: what the BUILDING is a
 * function of, and the theme, which is paint.
 *
 * A theme repaints materials and moves no wall (WP-30), and nothing the plan
 * reads comes from it: the planting, the prop density, the lounge kit and the
 * body size are all the look document's (`resolveLook`), which is in the
 * geometry. So a snapshot whose only news is its theme needs a bake and not a
 * plan — and on a floor of three hundred people the plan is the expensive one.
 * @returns {{geometry:string[], theme:string}}
 */
export function planSignatureParts(snapshot) {
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
  const geometry = [
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
  ];
  return {
    geometry,
    // WP-30. The theme changes no geometry at all — it repaints materials —
    // but the backdrop is BAKED, so the only way a new floor colour reaches
    // the screen is a re-bake. It is in the signature because the signature's
    // job is "does the baked bitmap still describe this snapshot", and after a
    // theme change it does not; `setState` reads the two halves apart and
    // bakes without planning where this is the only one that moved.
    theme: `t${(snapshot && snapshot.settings && snapshot.settings.theme) || 'default'}`,
  };
}

export class SceneDraw extends SceneFrame {
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
            camera: this._cameraParams(),
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
      // The rooms the page is holding furniture in (`plan-hold.js`), decided by
      // `setState` before it asked for this plan; none, on most snapshots.
      held: this._held || undefined,
    });
    // The fit scale first: the floor is baked at the scale it is drawn at, so
    // the bake has to know it (`scene-bake.js`).
    this._recomputeFitScale();
    this._bakeFloor();
    this._fadeFrom = previous;
    this._fadeStartedAt = previous ? frameMs() : 0;
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
    // A loop that starts draws its first frame whatever it finds: a tab that
    // was hidden may have had its canvas dropped while nobody was looking.
    this._drawnDirect = true;
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
      // A room held back for a walker, or for five minutes, is laid now if it
      // is due (`plan-hold.js`); on any other frame this asks two numbers.
      this._settleHold();
      // Drawn only where it would be a different picture from the one on the
      // canvas (`scene-frame.js`): a floor where nobody moved and no minute
      // turned over is left exactly as it is.
      if (this._frameDue()) {
        this._draw();
        this._drawnDirect = false;
      }
    } catch (err) {
      // A frame that failed is not the frame on the canvas: the next one is drawn.
      this._drawnDirect = true;
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
    // Whoever called, the loop's next tick draws what it finds (`_frameDue`).
    this._drawnDirect = true;
    const rect = this.canvas.getBoundingClientRect();
    const viewW = rect.width || this.canvas.width / this._dpr;
    const viewH = rect.height || this.canvas.height / this._dpr;

    ctx.save();
    // Cleared in the backing store's own pixels, all of it: the store is the
    // box the browser snapped the canvas to, which can be a device pixel more
    // than the CSS box times the ratio, and a row that is never cleared keeps
    // every frame ever drawn on it.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);

    // Computed once per frame: `camera.zoom` is the U-normalised fit scale,
    // used for both the backdrop transform below and every world<->screen
    // conversion this frame.
    const camera = this._cameraParams();

    if (this._plan && this._backdrop) {
      // The ground's falloff, the building's shadow and the floor's bitmap:
      // one layer, composed once per camera (`scene-static.js`).
      this._drawGround(ctx, viewW, viewH, camera);

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
          // The outgoing bitmap, at the size it was on screen: its own pixels
          // over the scale it was baked at, times the scale it was drawn at.
          const old = fade.backdrop;
          const k = fade.scale / old.ppu;
          ctx.translate(fade.camera.panX, fade.camera.panY);
          ctx.drawImage(old.canvas, 0, 0, old.canvas.width * k, old.canvas.height * k);
          ctx.restore();
        }
      }
    }

    // LOD is the drawn figure's height (`scene-lod.js`), and it only ever
    // takes detail off a body: names, plate lines and crews draw at every tier.
    const lod = this._lod();
    const records = this._frameRecords(camera, viewW, viewH);

    // The wait badges, the room plates and where every name goes round them:
    // measured only when somebody moved or a minute turned over, and handed
    // back as they were otherwise (`scene-frame.js`).
    const { charU, badgePlan, plates, labels } = this._layoutFrame(ctx, records, camera);

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
      juniorU: juniorScaleFor(this._scale()),
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

    // The name on each worktree's bench, under the bodies like the cables.
    drawWorktreeLabels(ctx, { benches: this._plan && this._plan.worktreeBenches, camera, charU });

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
      // The lounge's `+N resting`, where it holds more people than it draws.
      this._drawLoungeChip(camera);
    }

    ctx.restore();
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
    // 16 px — 05-GUI-UX-SPEC.md §6.2. A junior is drawn one step of the
    // agent-size ladder under that, at every fit (`juniorScaleFor`, WP-99).
    const u = this._figureScale(agent);
    // This frame's name and where it goes, resolved once before any character
    // is drawn (`planFrameLabels` in `_draw`). No text is a crew member whose
    // type another member of its formation carries; a `null` placement is a
    // resting figure's name the lounge had no room for.
    const text = labels ? labels.texts.get(rec.id) : null;
    const spot = text ? labels.plan.get(rec.id) : null;
    // A name the pass shrank or abbreviated carries its own text and size.
    const label = spot ? spot.text || text : null;
    // WP-99 · a sub-agent's first row: its role, on a chip over the name.
    const labelRole = label && labels.roles ? labels.roles.get(rec.id) || null : null;
    const labelOffsetY = spot ? spot.offsetY : 0;
    const labelOffsetX = spot ? spot.offsetX || 0 : 0;
    const labelPx = spot ? spot.px : undefined;
    const labelLeader = spot ? spot.leader === true : false;
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
        ? badgePlan && badgePlan.short.has(rec.id)
          ? formatElapsedShort(waitingMs)
          : formatElapsed(waitingMs)
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
      // WP-97 · sitting where the seat says: a desk, a sofa, or — a junior at
      // work on the floor, in an arc or beside its lead — the carpet, with its
      // laptop's lid open exactly as far as its transcript is moving (WP-99).
      seat: rigSeatOf(rec, pose),
      laptop: rec.targetSeat?.junior ? crewCableLive(agent, now, { reduced: this._reduced }) : null,
      // Resolved once per frame by `_draw`'s collision pass; the rig gates it.
      label,
      labelRole,
      labelOffsetY,
      labelOffsetX,
      labelPx,
      labelLeader,
      // Beside the head, on whichever side no name is (`cloud-spots.js`).
      cloudSide: labels && labels.clouds ? labels.clouds.get(rec.id) : undefined,
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
