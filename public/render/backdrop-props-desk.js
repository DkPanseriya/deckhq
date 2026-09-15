/**
 * The props a working floor is furnished with (WP-22 follow-up).
 *
 * Split out of `backdrop.js`'s `paintProp` unchanged. Desks, monitors, chairs, whiteboards, art, shelves, screens, the manager, the plants and the rugs.
 *
 * The switch is the original's, case for case and line for line, including
 * every `break`. What is new is only the wrapper: a `default` that answers
 * `false` so `paintProp` can try the next group, and the `true` after the
 * switch that says this group drew it. `local` is the caller's — the
 * two-pass shadow-then-fill it built around `withShadow` — handed in rather
 * than rebuilt, so no prop's shadow changed.
 *
 * Coordinates arrive pre-converted to px and already rotated by `angle`, and
 * the caller has already clipped to the prop's own footprint plus
 * `PROP_BLEED`: a prop may not paint outside its own rect.
 */

import { PALETTE } from './palette.js';
import { drawManagerFigure } from './rig.js';
import { roundRect, drawContactShadow, unturn, TABLE_EDGE_U } from './backdrop-paint.js';

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
      local((k) => {
        k.fillStyle = PALETTE.deskTop;
        roundRect(k, -w / 2, -h / 2, w, h, 3);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1.2;
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
      ctx.fillStyle = PALETTE.deskEdge;
      ctx.fillRect(-w / 2, h / 2 - band, w, band);
      ctx.fillRect(w / 2 - band, -h / 2, band, h - band);
      ctx.fillStyle = PALETTE.deskSheen;
      ctx.fillRect(-w / 2, -h / 2, w, Math.max(0.8, band * 0.7));
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
      ctx.rotate(Math.PI / 2);
      const R = Math.min(w, h) / 2;
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
      // The seat pan: forward of centre, so the wrap reads thicker behind the
      // occupant than in front of them — a back, in a shape with no corners.
      ctx.fillStyle = PALETTE.chairFill;
      ctx.beginPath();
      ctx.arc(0, R * 0.2, R * 0.62, 0, Math.PI * 2);
      ctx.fill();
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
      ctx.fillStyle = PALETTE.monitorBody;
      roundRect(ctx, -w / 2, -h / 2, w, h, 1.5);
      ctx.fill();
      ctx.fillStyle = PALETTE.monitorScreenGlow;
      ctx.fillRect(-w / 2 + 1, -h / 2 + 1, w - 2, Math.max(1, h - 2));
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
      // the outer wrapper has already rotated by it. This sprite is drawn
      // "looking up the page", so it needs the same quarter turn `rig.js`
      // applies to the character that sits in it (`facingRot = bodyAngle +
      // PI/2`). Without it every backrest on the floor was ninety degrees out
      // from the person leaning on it: chairs on the north side of a desk had
      // their backs to the east.
      ctx.rotate(Math.PI / 2);
      const R = w / 2;
      const seat = R * 0.86;
      local((k) => {
        k.fillStyle = PALETTE.chairFill;
        roundRect(k, -seat, -seat + 2.5, seat * 2, seat * 2 - 2.5, 4);
        k.fill();
        k.strokeStyle = PALETTE.chairEdge;
        k.lineWidth = 1.4;
        k.stroke();
      });
      // Arms, down each side and clear of the backrest (VISUAL-SPEC §6: "task
      // chairs with backrest and arms").
      ctx.fillStyle = PALETTE.chairEdge;
      roundRect(ctx, -R, -R + 4, R * 0.34, R * 1.5, 2);
      ctx.fill();
      roundRect(ctx, R - R * 0.34, -R + 4, R * 0.34, R * 1.5, 2);
      ctx.fill();
      // A soft cushion highlight, so the seat reads as upholstered rather than
      // as a flat tile at L1.
      ctx.fillStyle = PALETTE.chairCushion;
      roundRect(ctx, -seat + 2.5, -seat + 5.5, seat * 2 - 5, seat * 1.5 - 5, 3);
      ctx.fill();
      // The back, across the top: the side the occupant leans against.
      ctx.fillStyle = PALETTE.chairBackrest;
      roundRect(ctx, -R + 1, -R - 2.5, R * 2 - 2, 6, 2.5);
      ctx.fill();
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
      sheen.addColorStop(0.55, 'rgba(255,255,255,0)');
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
    case 'shelf':
    case 'bookshelf': {
      // A bookshelf viewed from directly above reads as its top-of-carcass
      // frame plus rows of book-tops packed side by side — spines aren't
      // visible from top-down, but a row of differently-toned strips reads
      // as "books" the same way herringbone reads as "wood floor": texture
      // standing in for the thing itself at this scale. `shelf` (a project
      // room's repo-folder launcher) and `bookshelf` (lounge furniture) are
      // the same piece of furniture wearing two different placement rules,
      // so they share one painter.
      //
      // Drawn ~14% larger than its own footprint, the same deliberate
      // overdraw `drawContactShadow` already does for every prop below:
      // the note back was that this read "too small to be real furniture"
      // at the w/h it is actually given (as little as 3.2 x 1.1 U for the
      // office's launcher shelf). Placement/anchoring use prop.w/h
      // untouched — only the paint is bigger.
      const bw = w * 1.14;
      const bh = h * 1.14;
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        roundRect(k, -bw / 2, -bh / 2, bw, bh, 1.5);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1.4;
        k.stroke();
      });
      // Vertical carcass dividers: the "visible shelf lines" that turn a
      // plain wood rect into a shelving unit with cubbies, independent of
      // the book-top texture inside them.
      const sections = bw > 60 ? 3 : 2;
      ctx.strokeStyle = PALETTE.deskEdge;
      ctx.lineWidth = 1;
      for (let s = 1; s < sections; s++) {
        const dx = -bw / 2 + (bw / sections) * s;
        ctx.beginPath();
        ctx.moveTo(dx, -bh / 2 + 1);
        ctx.lineTo(dx, bh / 2 - 1);
        ctx.stroke();
      }
      // Book-tops: one row, or two on a shelf deep enough to draw both
      // without the strips turning to noise. Book count scales with width
      // so books stay roughly book-sized instead of stretching to fill a
      // wide case.
      // §3.5: *"book spines lose their saturation — `bookA/B/C` derive from
      // the desk timber mixed halfway to three muted neutrals, so a shelf
      // never competes with an identity ring"*. These were the marker blue,
      // the marker plum, the cabinet body and the board-game felt: four of the
      // most saturated tokens on the floor, tiled twenty to a shelf, on the
      // one piece of furniture that is meant to read as TEXTURE. Three tones
      // now, a step of value apart, and the variation between spines is their
      // height rather than their hue.
      const tones = [PALETTE.bookA, PALETTE.bookB, PALETTE.bookC];
      const pad = Math.min(bw, bh) * 0.12;
      const rows = bh > 32 ? 2 : 1;
      const rowH = (bh - pad * 2) / rows;
      const count = Math.max(5, Math.round(bw / 9));
      const bookW = (bw - pad * 2) / count;
      for (let r = 0; r < rows; r++) {
        for (let i = 0; i < count; i++) {
          const idx = i + r * count;
          // Deterministic per-book height variation — no Math.random
          // anywhere in this file, since the same plan must re-bake
          // pixel-identical — so the row reads as loose books rather than
          // a printed stripe.
          const bucket = (idx * 37) % 5;
          const varH = rowH * (0.72 + (0.28 * bucket) / 4);
          ctx.fillStyle = tones[idx % tones.length];
          ctx.fillRect(
            -bw / 2 + pad + i * bookW,
            -bh / 2 + pad + r * rowH + (rowH - varH),
            Math.max(1, bookW - 0.6),
            varH,
          );
        }
      }
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
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      roundRect(ctx, -bw / 2, -bh / 2, bw, bh, 1.5);
      ctx.stroke();
      const inset = Math.max(1.2, Math.min(bw, bh) * 0.16);
      ctx.fillStyle = PALETTE.monitorScreenGlow;
      roundRect(ctx, -bw / 2 + inset, -bh / 2 + inset, bw - inset * 2, bh - inset * 2, 1);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
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
      // reads as a painted rectangle. At reception size (the office rug is the
      // largest single surface in the building) a flat fill dominated the room
      // more than the furniture on it did.
      drawContactShadow(ctx, -w / 2, -h / 2, w, h);
      // THE WOOL AND THE TASK RUG ARE TWO TEXTILES (§3.1, owner decision 2), and
      // the prop says which. The reception's is `rugCream` — a slate wool, *"the
      // one textile on this floor with a hue of its own, and the thing that
      // tells you the waiting area is not the corridor"* — and a project room's
      // is `rugSage`, carried by that room's own carpet. Both were painted sage
      // before, so WP-85a's slate existed in the derivation, in the guards and in
      // the document, and on no floor.
      ctx.fillStyle = prop.tone === 'wool' ? PALETTE.rugCream : PALETTE.rugSage;
      roundRect(ctx, -w / 2, -h / 2, w, h, 5);
      ctx.fill();
      // Pile direction: a soft cross-wise sheen, the way a woven rug catches
      // light along the weave.
      const pile = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      pile.addColorStop(0, 'rgba(255,255,255,0.30)');
      pile.addColorStop(0.5, 'rgba(255,255,255,0.02)');
      pile.addColorStop(1, 'rgba(0,0,0,0.05)');
      ctx.fillStyle = pile;
      roundRect(ctx, -w / 2, -h / 2, w, h, 5);
      ctx.fill();
      // The border inset is what makes a rectangle read as a RUG, so it scales
      // with the rug: a fixed 6 px inset is right on a desk cluster's mat and
      // invisible on the room-sized rug a large project room now gets.
      const inset = Math.min(Math.max(6, Math.min(w, h) * 0.05), 26);
      ctx.strokeStyle = PALETTE.rugBorder;
      ctx.lineWidth = Math.min(6, Math.max(2.5, inset * 0.22));
      roundRect(
        ctx,
        -w / 2 + inset,
        -h / 2 + inset,
        Math.max(0, w - inset * 2),
        Math.max(0, h - inset * 2),
        3,
      );
      ctx.stroke();
      ctx.strokeStyle = PALETTE.rugEdge;
      ctx.lineWidth = 1.2;
      roundRect(ctx, -w / 2, -h / 2, w, h, 5);
      ctx.stroke();
      break;
    }
    case 'rug_round': {
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
      break;
    }
    default:
      return false;
  }
  return true;
}
