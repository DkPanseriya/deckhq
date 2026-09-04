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
import { bakeBackdrop } from './backdrop.js';
import { drawCharacter, formatElapsed, labelBox } from './rig.js';
import { sampleClip, makeActivityRotation, makeIdleRotation } from './clips.js';
import { PALETTE, identityFor, appearanceFor } from './palette.js';
import { lodForZoom, worldToScreen } from './agents.js';
import { JUNIOR_SCALE, BADGE_MIN_PX_PER_UNIT, characterScaleFor } from './scene-lod.js';
import { FONT_UI, FONT_MONO, ellipsise, resolveLabelCollisions } from './scene-labels.js';
import { SceneHit, PLUS_SIZE_U, PLUS_MARGIN_U, PLUS_HIT_RADIUS_PX } from './scene-hit.js';
import {
  colorForAgent,
  agentLabelFor,
  iconForAgent,
  isNeedsYouAgent,
  nowMs,
} from './scene-agent.js';

/** How long a re-plan cross-fades for. Skipped under reduced motion. */
export const REPLAN_FADE_MS = 260;

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
      goneHomeDays: (this._snapshot.settings || {}).goneHomeDays,
    });
    this._backdrop = bakeBackdrop(this._plan, this._dpr);
    this._fadeFrom = previous;
    this._fadeStartedAt = previous ? nowMs() : 0;
    this._recomputeFitScale();
    // The pan referred to a floor that no longer exists, so it is discarded;
    // the magnification is the user's and is kept.
    this._centerCamera();
    this.canvas.style.cursor = this._pannable() ? 'grab' : '';
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
      this._runtime.step(dt, {
        reduced: this._reduced,
        plan: this._plan,
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
      ctx.save();
      ctx.shadowColor = PALETTE.floorDropShadow;
      ctx.shadowBlur = 26;
      ctx.shadowOffsetY = 8;
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
        const t = (nowMs() - this._fadeStartedAt) / REPLAN_FADE_MS;
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
    const charU = this._characterScale();
    if (lod >= 1) {
      const items = [];
      for (const rec of records) {
        const agent = this._agentsById.get(rec.id);
        const agentLabel = agent && agentLabelFor(agent);
        if (!agentLabel) continue;
        const s = worldToScreen(rec, camera);
        // The CHARACTER scale, not the world scale — the label hangs off the
        // body and has to be measured in the frame the body is drawn in.
        const box = labelBox(ctx, s.x, s.y, charU, agentLabel);
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
        if (room.kind === 'directory') this._drawDirectory(room, camera);
      }
    }

    ctx.restore();
  }

  _drawCharacterAt(rec, camera, lod, labelPlan) {
    const ctx = this.ctx;
    const agent = this._agentsById.get(rec.id);
    if (!agent) return;
    // People are drawn at their own scale (`_characterScale`), which is the
    // world scale except on a floor small enough that a body would drop below
    // 16 px — 05-GUI-UX-SPEC.md §6.2. A junior is drawn at `JUNIOR_SCALE` of
    // the floor's scale and then through the same floor, so it is smaller
    // than its senior everywhere there is room for it to be (WP-41).
    const u =
      agent.subagent === true
        ? characterScaleFor(this._scale() * JUNIOR_SCALE)
        : this._characterScale();
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
    // rather than a taste call — and it is asked of the WORLD scale, because
    // the pitch between two seats is a fact about the floor, not about how
    // large the people standing on them are drawn.
    const badge =
      lod >= 1 &&
      this._scale() >= BADGE_MIN_PX_PER_UNIT &&
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
    // Per-agent appearance (WP-20): who this particular session is — hair
    // style, skin, an outfit accent, glasses, build, and a rarity trait on a
    // minority of agents. A pure function of the session id, so it needs
    // nothing from the snapshot and nothing persisted, and like `identityFor`
    // it is total: an id that has not resolved yet still draws.
    const appearance = appearanceFor(agent.id);

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

  /**
   * The idle-projects directory (`plan.js`'s `buildDirectory`, `08` B6).
   *
   * One line per repo nobody is in: name, session count, last activity. Drawn
   * live rather than baked, because the last two change on every push and a
   * re-bake is ~190 ms. Each line registers a plate rect, so clicking it does
   * exactly what clicking a room plate does — scope the panel to that project.
   * @param {import('./plan.js').Room} room
   * @param {{zoom:number,panX:number,panY:number,U:number}} camera
   */
  _drawDirectory(room, camera) {
    const ctx = this.ctx;
    const entries = room.entries || [];
    if (!entries.length) return;
    const u = U * camera.zoom;
    const byId = new Map((this._snapshot.projects || []).map((p) => [p.id, p]));

    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    for (const entry of entries) {
      const at = worldToScreen({ x: entry.x, y: entry.y }, camera);
      const lineH = entry.h * u;
      const midY = at.y + lineH / 2;
      const maxW = Math.max(24, entry.w * u - 10);

      // A hairline under each line, so a column of names reads as a list
      // rather than as loose text lying on the floor.
      ctx.strokeStyle = PALETTE.partitionEdge;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(at.x, Math.round(at.y + lineH) - 0.5);
      ctx.lineTo(at.x + maxW, Math.round(at.y + lineH) - 0.5);
      ctx.stroke();

      const project = byId.get(entry.id);
      const sessions = project ? project.sessionCount : entry.sessionCount;
      const last = entry.lastActivityAt
        ? formatElapsed(Math.max(0, Date.now() - entry.lastActivityAt))
        : '';
      const stat = `${sessions}${last ? ` · ${last}` : ''}`;

      ctx.font = `600 11px ${FONT_MONO}`;
      const statW = ctx.measureText(stat).width;
      ctx.font = `600 12px ${FONT_UI}`;
      const name = ellipsise(ctx, entry.name, Math.max(16, maxW - statW - 10));
      const nameW = ctx.measureText(name).width;
      ctx.strokeStyle = PALETTE.plateHalo;
      ctx.lineWidth = 3;
      ctx.strokeText(name, at.x, midY);
      ctx.fillStyle = PALETTE.plateInk;
      ctx.fillText(name, at.x, midY);

      ctx.font = `600 11px ${FONT_MONO}`;
      ctx.strokeStyle = PALETTE.plateHalo;
      ctx.lineWidth = 2.6;
      ctx.strokeText(stat, at.x + maxW - statW, midY);
      ctx.fillStyle = PALETTE.plateInkSecondary;
      ctx.fillText(stat, at.x + maxW - statW, midY);

      this._plateRects.push({
        x: at.x,
        y: at.y,
        w: Math.max(nameW, maxW),
        h: lineH,
        kind: 'project',
        id: entry.id,
      });
    }
    ctx.restore();
  }
}
