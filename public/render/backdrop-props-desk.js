/**
 * The props a working floor is furnished with (WP-22 follow-up).
 *
 * Desks and what stands on them, task and tub chairs, whiteboards, art,
 * screens, the manager and the rugs. Shelving is storage and lives with the
 * credenza in `backdrop-props-room.js`.
 *
 * One switch, a `default` that answers `false` so `paintProp` can try the next
 * group. `local` is the caller's — the piece's cast and its contact with the
 * floor (`grounded`) — handed in rather than rebuilt, and nothing here sets a
 * shadow of its own. How much of a piece is drawn depends on the scale of the
 * bake: `detailOf` in `backdrop-props-kit.js`.
 *
 * Coordinates arrive pre-converted to px and already rotated by `angle`, and
 * the caller has already clipped to the prop's own footprint plus
 * `PROP_BLEED`: a prop may not paint outside its own rect.
 */

import { PALETTE, fadedOut } from './palette.js';
import { shade } from './themes.js';
import { drawManagerFigure } from './rig.js';
import { roundRect, contactUnder, unturn, alphaScaled, TABLE_EDGE_U } from './backdrop-paint.js';
import { LOOK, setFrame, setRadius } from './look-derive.js';
import { chairSwivel, detailOf, onePx, taskChair, tones, topEdges } from './backdrop-props-kit.js';

/**
 * A RUG'S BANDS (WP-88a, §1.d).
 *
 * Three bands across the SHORT axis, because a band along the long one reads as
 * a runner and a rug is not a runner. `plain` has none, which is the rug this
 * floor has always laid — so this function returns before it draws anything on
 * the default look, and the goldens cannot see it.
 *
 * @param {any} ctx @param {number} w @param {number} h @param {number} u
 * @param {'wool'|'task'} role @param {number} r the rug's corner radius
 */
function paintRugBands(ctx, w, h, u, role, r) {
  const pattern = LOOK.rugs[role]?.pattern;
  if (!pattern?.bands?.length) return;
  const across = h <= w;
  const span = across ? h : w;
  const band = Math.max(1, pattern.bandU * u);
  ctx.save();
  roundRect(ctx, -w / 2, -h / 2, w, h, r);
  ctx.clip();
  ctx.fillStyle = shade(LOOK.rugs[role].colour, -pattern.bandShade);
  for (const at of pattern.bands) {
    const c = -span / 2 + span * at;
    if (across) ctx.fillRect(-w / 2, c - band / 2, w, band);
    else ctx.fillRect(c - band / 2, -h / 2, band, h);
  }
  ctx.restore();
}

/**
 * The same pattern on a round rug: three concentric rings at the same fractions
 * of the radius. A round rug has no short axis, and a stripe across a disc is a
 * chord rather than a band.
 *
 * @param {any} ctx @param {number} r @param {number} u @param {'wool'|'task'} role
 */
function paintRugRings(ctx, r, u, role) {
  const pattern = LOOK.rugs[role]?.pattern;
  if (!pattern?.bands?.length) return;
  ctx.save();
  ctx.strokeStyle = shade(LOOK.rugs[role].colour, -pattern.bandShade);
  ctx.lineWidth = Math.max(1, pattern.bandU * u);
  for (const at of pattern.bands) {
    const rr = r * at;
    if (rr <= 0) continue;
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * @param {any} ctx @param {any} prop @param {number} u
 * @param {number} w @param {number} h @param {(fn:(k:any)=>void)=>void} local
 * @returns {boolean} whether this group recognised the kind
 */
export function paintDeskProps(ctx, prop, u, w, h, local) {
  switch (prop.kind) {
    case 'desk':
    case 'user_desk': {
      // Its rect is its footprint: see `unturn`.
      unturn(ctx, prop);
      // WP-88a, §1.c: the SET decides the corner and whether there is a frame
      // line on it. Scandi is what ships, `setRadius` hands back the 3 px this
      // desk has always had, and `setFrame` is null — so the default look paints
      // exactly the desk the goldens hold.
      local((k) => {
        const frame = setFrame(u);
        k.fillStyle = PALETTE.deskTop;
        roundRect(k, -w / 2, -h / 2, w, h, setRadius(3));
        k.fill();
        k.strokeStyle = frame ? frame.colour : PALETTE.deskEdge;
        k.lineWidth = frame ? frame.width : 1.2;
        k.stroke();
      });
      // §3.4: EVERY TABLE SHOWS ITS EDGE — a 0.15 U band of the darker timber
      // on the side the light travels toward, and a sheen on the side it comes
      // from. `LIGHT_DIR` is (+1, +1)/√2 (palette-colors.js), so the band is
      // south and east and the sheen north and west.
      //
      // It replaces a 6 px `rgba(255,255,255,0.85)` divider down the middle of
      // every desk on the floor: near-white, brighter than the default theme's
      // wall, and the thing the eye landed on instead of the person sitting at
      // it. A desk that shows its edge is a desk you can see is a desk; a white
      // line down the middle is a desk with a line down the middle.
      const band = Math.max(1, TABLE_EDGE_U * u);
      const t = tones();
      const lod = detailOf(ctx, u);
      if (lod === 0) {
        // The silhouette's own three strokes of edge, and nothing a small bake
        // would have to draw a clip for.
        ctx.fillStyle = t.deskBand;
        ctx.fillRect(-w / 2, h / 2 - band, w, band);
        ctx.fillRect(w / 2 - band, -h / 2, band, h - band);
        ctx.fillStyle = PALETTE.deskSheen;
        ctx.fillRect(-w / 2, -h / 2, w, Math.max(0.8, band * 0.7));
        break;
      }
      // Both shaded edges and both lit ones, inside the top's own corners.
      topEdges(ctx, -w / 2, -h / 2, w, h, setRadius(3), band, t.deskBand, PALETTE.deskSheen);
      if (lod >= 2 && prop.kind === 'desk') {
        // THE SPINE OF A BENCH. Two rows of people face each other across it,
        // and the groove between them is where the cables go: it is what makes
        // a bench a bench and not a long table.
        const inset = Math.min(w, h) * 0.18;
        ctx.strokeStyle = t.deskSpine;
        ctx.lineWidth = Math.max(onePx(ctx), 0.05 * u);
        ctx.beginPath();
        if (w >= h) {
          ctx.moveTo(-w / 2 + inset, 0);
          ctx.lineTo(w / 2 - inset, 0);
        } else {
          ctx.moveTo(0, -h / 2 + inset);
          ctx.lineTo(0, h / 2 - inset);
        }
        ctx.stroke();
      }
      break;
    }
    case 'desk_tray': {
      unturn(ctx, prop);
      // The in-tray on the manager's desk (§3.4). Two stacked leaves of paper
      // in a shallow wire frame: a small rectangle with a lighter rectangle
      // just inside it, offset, so it reads as a thing ON the desk rather than
      // as part of the desk's own top.
      local((k) => {
        k.fillStyle = PALETTE.furnitureMetal;
        roundRect(k, -w / 2, -h / 2, w, h, 1.5);
        k.fill();
      });
      const lip = Math.max(0.8, Math.min(w, h) * 0.14);
      ctx.fillStyle = PALETTE.whiteboardSurface;
      roundRect(ctx, -w / 2 + lip, -h / 2 + lip, w - lip * 2, h - lip * 2, 1);
      ctx.fill();
      ctx.fillStyle = PALETTE.chairFill;
      roundRect(ctx, -w / 2 + lip * 2, -h / 2 + lip * 0.5, w - lip * 3.2, h - lip * 2.4, 1);
      ctx.fill();
      break;
    }
    case 'tub_chair': {
      // THE RECEPTION'S TUB CHAIR (§3.4), 2.4 U across.
      //
      // It reads by SHAPE and not by tone, which is the whole of §3.4's
      // silhouette rule: a task chair is a rounded square with two arms down
      // its sides, and this is a circle with one continuous wrap-around back —
      // the two cannot be confused at 34 px even though they are upholstered in
      // the same cloth. The back is on the far side from `angle`, exactly as a
      // sofa's is, so a row of three facing a desk shows three open seats.
      //
      // Drawn with the back at -y and the seat toward +y, and turned so that +y
      // is the way it faces — the task chair's turn, and for its reason.
      ctx.rotate(-Math.PI / 2);
      const R = Math.min(w, h) / 2;
      const lod = detailOf(ctx, u);
      const t = tones();
      // THE TUB IS THE FRAME, and the cushion is the small bright part inside
      // it. Drawn the other way round — a pale disc with a thin darker arc —
      // the chair is the brightest object in its room and the person in it is
      // not, which is §1.2's inversion re-introduced one prop at a time.
      local((k) => {
        k.fillStyle = PALETTE.sofaFrame;
        k.beginPath();
        k.arc(0, 0, R, 0, Math.PI * 2);
        k.fill();
      });
      if (lod >= 1) {
        // THE BACK WRAPS 200 DEGREES: one upholstered band from one arm round
        // behind the occupant to the other, open at the front.
        const half = (100 * Math.PI) / 180;
        ctx.strokeStyle = t.sofaArm;
        ctx.lineWidth = R * 0.3;
        ctx.beginPath();
        ctx.arc(0, 0, R * 0.78, -Math.PI / 2 - half, -Math.PI / 2 + half);
        ctx.stroke();
      }
      // The seat pan: forward of centre, so the wrap reads thicker behind the
      // occupant than in front of them — a back, in a shape with no corners.
      ctx.fillStyle = lod >= 1 ? t.sofaCushion : PALETTE.chairFill;
      ctx.beginPath();
      ctx.arc(0, R * 0.2, R * 0.6, 0, Math.PI * 2);
      ctx.fill();
      if (lod >= 2) {
        // The cushion's own seam, just inside its edge.
        ctx.strokeStyle = t.sofaSeam;
        ctx.lineWidth = onePx(ctx);
        ctx.beginPath();
        ctx.arc(0, R * 0.2, R * 0.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    case 'pinboard': {
      unturn(ctx, prop);
      // A cork board on the east wall, under the shelf (§3.4). Short and
      // papered where the shelf above it is long and full of book tops: the
      // second silhouette §1.6 said the wall did not have.
      local((k) => {
        k.fillStyle = PALETTE.deskEdge;
        roundRect(k, -w / 2, -h / 2, w, h, 1);
        k.fill();
      });
      const inset = Math.max(0.8, Math.min(w, h) * 0.1);
      ctx.fillStyle = PALETTE.tableWood;
      ctx.fillRect(-w / 2 + inset, -h / 2 + inset, w - inset * 2, h - inset * 2);
      // Pinned paper: three small leaves at fixed offsets — no random source
      // anywhere in this file, since the same plan must re-bake pixel-identical.
      const notes = [
        [-0.16, -0.28, 0.5, 0.2],
        [0.14, -0.02, 0.44, 0.22],
        [-0.1, 0.26, 0.52, 0.18],
      ];
      ctx.fillStyle = PALETTE.whiteboardSurface;
      for (const [nx, ny, nw, nh] of notes) {
        ctx.fillRect(
          nx * w - (nw * w) / 2,
          ny * h - (nh * h) / 2,
          Math.max(1, nw * w),
          Math.max(1, nh * h),
        );
      }
      break;
    }
    case 'monitor': {
      unturn(ctx, prop);
      const lod = detailOf(ctx, u);
      if (lod === 0) {
        ctx.fillStyle = PALETTE.monitorBody;
        roundRect(ctx, -w / 2, -h / 2, w, h, 1.5);
        ctx.fill();
        ctx.fillStyle = PALETTE.monitorScreenGlow;
        ctx.fillRect(-w / 2 + 1, -h / 2 + 1, w - 2, Math.max(1, h - 2));
        break;
      }
      // A WORKSTATION, IN THE STRIP OF DESK THE PLAN GIVES IT. The rect lies
      // along the edge its occupant sits at, so from that edge inward: the
      // keyboard, then the screen — a thin dark bar seen from above, lit on the
      // side that faces the person — standing on its foot.
      //
      // WHICH EDGE. A bench monitor is attached to the edge it stands on; the
      // one on the user's desk is not, and the manager sits to the north of it
      // (to the west, where the reception is laid on its side).
      const edge = (prop.anchor && prop.anchor.edge) || (h > w ? 'W' : 'N');
      const turn = { N: 0, S: Math.PI, W: -Math.PI / 2, E: Math.PI / 2 }[edge] || 0;
      ctx.rotate(turn);
      const run = Math.max(w, h);
      const deep = Math.min(w, h);
      const t = tones();
      const barW = run * 0.8;
      const barD = deep * 0.3;
      const far = deep / 2;
      if (lod >= 2) {
        ctx.fillStyle = t.monitorFoot;
        ctx.beginPath();
        ctx.ellipse(0, far - barD * 0.3, run * 0.16, deep * 0.24, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = t.monitorBezel;
      roundRect(ctx, -barW / 2, far - barD, barW, barD, 1);
      ctx.fill();
      ctx.fillStyle = PALETTE.monitorScreenGlow;
      ctx.fillRect(-barW / 2 + 1, far - barD, barW - 2, Math.max(onePx(ctx), barD * 0.34));
      // The keyboard, a fifth of a unit clear of the screen.
      const keyW = run * 0.62;
      const keyD = deep * 0.54;
      const keyY = -deep / 2 + deep * 0.04;
      ctx.fillStyle = t.keyboard;
      roundRect(ctx, -keyW / 2, keyY, keyW, keyD, 0.06 * u);
      ctx.fill();
      if (lod >= 2) {
        // Three rows of keys, and the mouse beside them.
        ctx.strokeStyle = t.keyRow;
        ctx.lineWidth = onePx(ctx);
        ctx.beginPath();
        for (let i = 1; i <= 3; i++) {
          const y = keyY + (keyD * i) / 4;
          ctx.moveTo(-keyW / 2 + 1, y);
          ctx.lineTo(keyW / 2 - 1, y);
        }
        ctx.stroke();
        ctx.fillStyle = t.keyboard;
        roundRect(ctx, -keyW / 2 - run * 0.14, keyY + keyD * 0.1, run * 0.09, keyD * 0.72, 1);
        ctx.fill();
      }
      break;
    }
    // THE TASK CHAIR, and it is now the only thing drawn this way.
    //
    // The reception's visitor chair used to share this painter — "a waiting
    // chair is drawn like any other task chair; it is a distinct kind only
    // because it obeys a different placement rule" — and §3.4 ended that: no
    // two seat kinds in one room may share a footprint, and two seat kinds
    // anywhere that share a silhouette are one seat kind with two names. The
    // reception's is a `tub_chair` above, at 2.4 U and round.
    case 'chair': {
      // FACING. `prop.angle` is in the plan's convention — 0 is +x, east — and
      // the outer wrapper has already rotated by it, so +x here is the way the
      // seat faces. `taskChair` draws a chair facing +y with its back at -y, so
      // a quarter turn back puts the back BEHIND whoever sits in it. (It used
      // to go the other way, and every backrest on the floor stood between its
      // occupant and the desk.)
      //
      // And then a few degrees more, either way, where nobody is in it: an
      // empty swivel chair is never left square to its desk, and one that is
      // reads as a tile. An occupied one is square (`chairSwivel`).
      ctx.rotate(-Math.PI / 2 + chairSwivel(prop));
      taskChair(ctx, w, local, detailOf(ctx, u));
      break;
    }
    case 'whiteboard': {
      // A BOARD SEEN FROM ABOVE, WITH A LITTLE PERSPECTIVE.
      //
      // Straight down, a wall-mounted board is a line — true, and useless. The
      // floor is an orthographic top-down plan (VISUAL-SPEC §1) and everything
      // else on it obeys that, so this is the one deliberate exception: the
      // board's face is drawn foreshortened into the room, the way an
      // architectural plan draws an elevation of something it wants you to
      // read. It is the only object on the floor that carries writing, and
      // writing you cannot see is not worth drawing.
      //
      // The face projects along the prop's own long axis, so a board on a west
      // wall leans east into its room and one on a north wall leans south. It
      // stays inside the prop's rect, which is why the rect is deeper than a
      // board is.
      const vertical = h > w;
      const len = vertical ? h : w;
      const depth = vertical ? w : h;
      if (vertical) ctx.rotate(Math.PI / 2);
      const mount = Math.max(2, depth * 0.22);
      const faceD = depth - mount;

      // The mount: the board's own thickness against the wall.
      ctx.fillStyle = PALETTE.furnitureMetal;
      roundRect(ctx, -len / 2, -depth / 2, len, mount, 1);
      ctx.fill();

      // The face, foreshortened: a trapezium that narrows with distance.
      const near = len / 2;
      const far = near * 0.9;
      const y0 = -depth / 2 + mount;
      const y1 = depth / 2;
      local((k) => {
        k.fillStyle = PALETTE.whiteboardSurface;
        k.beginPath();
        k.moveTo(-far, y0);
        k.lineTo(far, y0);
        k.lineTo(near, y1);
        k.lineTo(-near, y1);
        k.closePath();
        k.fill();
      });
      // Gloss down the face, brightest at the top where the light is.
      const sheen = ctx.createLinearGradient(0, y0, 0, y1);
      sheen.addColorStop(0, PALETTE.whiteboardSheen);
      sheen.addColorStop(0.55, fadedOut(PALETTE.whiteboardSheen));
      ctx.fillStyle = sheen;
      ctx.beginPath();
      ctx.moveTo(-far, y0);
      ctx.lineTo(far, y0);
      ctx.lineTo(near, y1);
      ctx.lineTo(-near, y1);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = PALETTE.chairEdge;
      ctx.lineWidth = 0.8;
      ctx.stroke();

      // Writing on it, in the same proportions every board on the floor
      // carries — legible as WRITING at a glance without being readable, which
      // is what tells the user there is something to open.
      const inkTop = y0 + faceD * 0.22;
      const lineH = Math.max(1.4, faceD * 0.16);
      const inks = [PALETTE.whiteboardMarkerBlue, PALETTE.whiteboardMarkerRed];
      for (let i = 0; i < 3; i++) {
        const t = inkTop + i * lineH;
        const spread = far + ((near - far) * (t - y0)) / Math.max(1, faceD);
        ctx.strokeStyle = inks[i % inks.length];
        ctx.lineWidth = Math.max(0.7, lineH * 0.22);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(-spread * 0.68, t);
        ctx.lineTo(spread * (i === 2 ? 0.1 : 0.55), t);
        ctx.stroke();
      }

      // Marker tray along the near edge.
      const trayH = Math.max(1.2, faceD * 0.16);
      ctx.fillStyle = PALETTE.furnitureMetal;
      roundRect(ctx, -near, y1 - trayH, near * 2, trayH, 1);
      ctx.fill();
      break;
    }
    case 'art': {
      unturn(ctx, prop);
      // Framed wall art, seen edge-on from above: a thin rectangle against
      // a wall (as little as 4 x 0.4 U), so every stroke below has a
      // Math.max floor rather than a fraction of h that could round to
      // nothing. Frame, mat, then a couple of flat colour blocks stand in
      // for the print itself — the same "flat colour reads as content"
      // trick magazine_table's magazines and whiteboard's marker dashes
      // use.
      local((k) => {
        k.fillStyle = PALETTE.furnitureMetal;
        roundRect(k, -w / 2, -h / 2, w, h, 1);
        k.fill();
      });
      const inset = Math.max(0.8, h * 0.22);
      ctx.fillStyle = PALETTE.chairFill;
      ctx.fillRect(
        -w / 2 + inset,
        -h / 2 + inset * 0.6,
        w - inset * 2,
        Math.max(1, h - inset * 1.2),
      );
      const accentW = Math.max(2, w * 0.18);
      const accentH = Math.max(1, h * 0.5);
      ctx.fillStyle = PALETTE.whiteboardMarkerPlum;
      ctx.fillRect(-w * 0.28, -accentH / 2, accentW, accentH);
      ctx.fillStyle = PALETTE.whiteboardMarkerBlue;
      ctx.fillRect(w * 0.08, -accentH / 2, accentW, accentH);
      break;
    }
    case 'screen': {
      // "The terminal box": a wall-mounted dashboard display — the same
      // "thin dark body + lit face" language as the desk `monitor` case,
      // with a visible bezel and a small bright status dot so it reads as
      // active, not decorative.
      //
      // Drawn larger than its own footprint, same rationale as the
      // `shelf`/`bookshelf` overdraw above: at the w/h a wall screen is
      // actually given (as little as 2.6 x 0.7 U) a body sized exactly to
      // the rect reads as a bar, not a box. Placement/anchoring use
      // prop.w/h untouched — only the paint is bigger.
      const bw = w * 1.3;
      const bh = h * 1.45;
      local((k) => {
        k.fillStyle = PALETTE.monitorBody;
        roundRect(k, -bw / 2, -bh / 2, bw, bh, 1.5);
        k.fill();
      });
      ctx.strokeStyle = PALETTE.inkCool;
      ctx.globalAlpha = 0.3;
      ctx.lineWidth = 1;
      roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 1.5);
      ctx.stroke();
      ctx.globalAlpha = 1;
      const inset = Math.max(1.2, Math.min(bw, bh) * 0.16);
      ctx.fillStyle = PALETTE.monitorScreenGlow;
      roundRect(ctx, -bw / 2 + inset, -bh / 2 + inset, bw - inset * 2, bh - inset * 2, 1);
      ctx.fill();
      ctx.fillStyle = PALETTE.whiteboardSurface;
      ctx.beginPath();
      ctx.arc(
        bw / 2 - inset * 0.7,
        -bh / 2 + inset * 0.7,
        Math.max(0.6, inset * 0.32),
        0,
        Math.PI * 2,
      );
      ctx.fill();
      break;
    }
    case 'tv': {
      // Wall-mounted screen, thin, with a dark face — same monitor
      // language as `screen`/`monitor`, sized for a consumer TV: a
      // minimal bezel so the glow runs almost edge to edge, and no status
      // dot (that belongs to `screen`'s dashboard specifically).
      local((k) => {
        k.fillStyle = PALETTE.monitorBody;
        roundRect(k, -w / 2, -h / 2, w, h, 1.2);
        k.fill();
      });
      const inset = Math.max(0.8, Math.min(w, h) * 0.1);
      ctx.fillStyle = PALETTE.monitorScreenGlow;
      roundRect(ctx, -w / 2 + inset, -h / 2 + inset, w - inset * 2, h - inset * 2, 0.8);
      ctx.fill();
      break;
    }
    case 'manager': {
      // The user's own avatar, not furniture — drawn with the same rig as
      // every agent (rig.js's `drawManagerFigure`) so it is unmistakably the
      // same species, just bigger and in a suit. `drawManagerFigure` bakes
      // facing into its own coordinates exactly like `drawCharacter` does,
      // so the ambient rotation this `case` block inherited from the switch's
      // outer `ctx.translate/rotate` wrapper (above) must be cancelled first
      // — otherwise the figure would be turned twice.
      ctx.rotate(-(prop.angle || 0));
      drawManagerFigure(ctx, { x: 0, y: 0, u, angle: prop.angle || 0 });
      break;
    }
    case 'rug': {
      unturn(ctx, prop);
      // A rug sits ON the floor: it needs a contact shadow and a pile, or it
      // reads as a painted rectangle. Its corners are the furniture set's.
      const lod = detailOf(ctx, u);
      const r = setRadius(5);
      contactUnder(ctx, -w / 2, -h / 2, w, h, r, false, u);
      // THE WOOL AND THE TASK RUG ARE TWO TEXTILES (§3.1, owner decision 2), and
      // the prop says which. The reception's is `rugCream` — a slate wool, *"the
      // one textile on this floor with a hue of its own, and the thing that
      // tells you the waiting area is not the corridor"* — and a project room's
      // is `rugSage`, carried by that room's own carpet.
      ctx.fillStyle = prop.tone === 'wool' ? PALETTE.rugCream : PALETTE.rugSage;
      roundRect(ctx, -w / 2, -h / 2, w, h, r);
      ctx.fill();
      // WP-88a, §1.d: the PATTERN. `plain` is the field and its border;
      // `banded` adds three 0.5 U bands at a sixth, a half and five sixths of
      // the short axis, each 0.02 off the field — a step small enough to stay
      // inside the rug's own value plateau, which is what a name drawn on it is
      // measured against.
      paintRugBands(ctx, w, h, u, prop.tone === 'wool' ? 'wool' : 'task', r);
      // Pile direction: a soft cross-wise sheen, the way a woven rug catches
      // light along the weave. The border's own highlight at the lit end, the
      // edge's own dark at the other.
      const pile = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      pile.addColorStop(0, alphaScaled(PALETTE.rugBorder, 0.8));
      pile.addColorStop(0.5, fadedOut(PALETTE.rugBorder));
      pile.addColorStop(1, alphaScaled(PALETTE.rugEdge, 0.18));
      ctx.fillStyle = pile;
      roundRect(ctx, -w / 2, -h / 2, w, h, r);
      ctx.fill();
      // The border inset is what makes a rectangle read as a RUG, so it scales
      // with the rug: a fixed 6 px inset is right on a desk cluster's mat and
      // invisible on the room-sized rug a large project room now gets.
      const inset = Math.min(Math.max(6, Math.min(w, h) * 0.05), 26);
      const borderW = Math.min(6, Math.max(2.5, inset * 0.22));
      ctx.strokeStyle = PALETTE.rugBorder;
      ctx.lineWidth = borderW;
      roundRect(
        ctx,
        -w / 2 + inset,
        -h / 2 + inset,
        Math.max(0, w - inset * 2),
        Math.max(0, h - inset * 2),
        Math.max(3, r - inset * 0.5),
      );
      ctx.stroke();
      if (lod >= 1) {
        // One device pixel of the rug's own edge, just inside the border: the
        // line a woven border is bound with.
        const inner = inset + borderW / 2 + 1.5;
        ctx.strokeStyle = PALETTE.rugEdge;
        ctx.lineWidth = onePx(ctx);
        roundRect(
          ctx,
          -w / 2 + inner,
          -h / 2 + inner,
          Math.max(0, w - inner * 2),
          Math.max(0, h - inner * 2),
          2,
        );
        ctx.stroke();
      }
      ctx.strokeStyle = PALETTE.rugEdge;
      ctx.lineWidth = 1.2;
      roundRect(ctx, -w / 2, -h / 2, w, h, r);
      ctx.stroke();
      break;
    }
    case 'rug_round': {
      // The round rug takes the same tone and the same pattern as its
      // rectangular companion in the same role; its bands are rings.
      {
        const d = Math.min(w, h);
        contactUnder(ctx, -d / 2, -d / 2, d, d, d / 2, false, u);
      }

      // Same border-inset language as `rug`, circular — the round
      // companion VISUAL-SPEC §6 already lists ("rugs (rectangular and
      // round, with a border inset)").
      //
      // WHICH TEXTILE, AND WHY THE PROP SAYS SO. The lounge's round rug lies on
      // BOARDS and is the wool; a project room's break-out rug lies on that
      // room's own CARPET and is the task textile, because a slate disc on a
      // washed carpet is the highest-contrast object in a room whose subject is
      // the person at the desk. A painter cannot ask what room it is in, so the
      // plan declares it — the same seam `prop.tall` uses (`backdrop-paint.js`).
      const r = Math.min(w, h) / 2;
      ctx.fillStyle = prop.tone === 'task' ? PALETTE.rugSage : PALETTE.rugCream;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = PALETTE.rugBorder;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(0, r - 5), 0, Math.PI * 2);
      ctx.stroke();
      paintRugRings(ctx, r, u, prop.tone === 'task' ? 'task' : 'wool');
      if (detailOf(ctx, u) >= 1) {
        ctx.strokeStyle = PALETTE.rugEdge;
        ctx.lineWidth = onePx(ctx);
        ctx.beginPath();
        ctx.arc(0, 0, Math.max(0, r - 8), 0, Math.PI * 2);
        ctx.stroke();
      }
      break;
    }
    default:
      return false;
  }
  return true;
}
