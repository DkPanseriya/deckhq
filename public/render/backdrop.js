/**
 * DeckHQ baked backdrop — floors, walls, doors and furniture, painted once
 * per plan change to an offscreen bitmap. Nothing here runs per frame; the
 * scene blits the result and draws only the (animated) characters on top.
 * docs/03-VISUAL-SPEC.md §6, docs/02-ARCHITECTURE.md §8 (< 400 ms rebake,
 * animation is characters only).
 *
 * Canvas APIs are used only inside `bakeBackdrop` — this module has no DOM
 * access at module scope, so importing it is safe even where OffscreenCanvas
 * does not exist (e.g. under a plain Node test runner), as long as the
 * function itself is never called there.
 */

import { PALETTE } from './palette.js';
import { drawManagerFigure } from './rig.js';

// ---- local colour tokens ------------------------------------------------
// palette.js is owned by another engineer on this build. A colour this file
// needs that PALETTE does not carry lives here instead, as a named constant
// with a comment explaining the gap — never as a bare literal buried in a
// paint case.
//
// LAMP_GLOW: the reception floor lamp needs a warm halo under its shade.
// Every glow PALETTE actually has (monitorScreenGlow, cabinetScreenGlow) is
// the same cool cyan tuned for a screen; reusing it here would make the
// lamp read as another monitor. Checked by hand against the reserved-
// crimson discipline in palette.js: rgb(255,214,140) is nowhere near
// STATE_COLORS.for_review (#C0392B).
const LAMP_GLOW = 'rgba(255, 214, 140, 0.4)';

const U_DEFAULT = 14;

/**
 * Deepest a prop's contact shadow may fall, in baked pixels. Depth says how
 * thick a thing is; without a ceiling, a very large flat prop cast a shadow
 * the size of a room. Roughly a rug's thickness at `U_DEFAULT`.
 */
const CONTACT_SHADOW_MAX_PX = 10;

/**
 * How far past its own rect a prop's paint may reach, in plan units — foliage,
 * a lamp's glow, the soft edge of a shadow. Everything else is clipped.
 */
const PROP_BLEED = 0.6;

/**
 * Small deterministic PRNG (mulberry32) seeded from a string. Re-baking the
 * same plan must be pixel-identical, so no `Math.random()` is used anywhere
 * in this file.
 * @param {string} seedStr
 * @returns {() => number} a function returning floats in [0, 1)
 */
function seededRng(seedStr) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let seed = h >>> 0;
  return function next() {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Create a canvas without touching the document: OffscreenCanvas where
 * available, a detached `<canvas>` element otherwise.
 * @param {number} w
 * @param {number} h
 */
function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(w, h);
  }
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.lineTo(x + w - rad, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rad);
  ctx.lineTo(x + w, y + h - rad);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  ctx.lineTo(x + rad, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rad);
  ctx.lineTo(x, y + rad);
  ctx.quadraticCurveTo(x, y, x + rad, y);
  ctx.closePath();
}

/**
 * Run `fn` with a soft drop/contact shadow applied, then restore. Every
 * furniture item gets one of these — it is what makes the render read as a
 * photograph rather than a diagram (VISUAL-SPEC §6).
 */
function withShadow(ctx, fn, { blur = 8, oy = 3, color = PALETTE.shadowContact } = {}) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetY = oy;
  fn(ctx);
  ctx.restore();
}

// ------------------------------------------------------------- materials

/** 46 px herringbone lattice, four tone variations, 1.6 px seams. */
function paintHerringbone(ctx, x, y, w, h, rng) {
  const CELL = 46;
  const L = CELL * 1.42;
  const W = CELL * 0.48;
  const tones = [
    PALETTE.woodHerringboneA,
    PALETTE.woodHerringboneB,
    PALETTE.woodHerringboneC,
    PALETTE.woodHerringboneD,
  ];
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  ctx.fillStyle = PALETTE.woodHerringboneB;
  ctx.fillRect(x, y, w, h);

  const cols = Math.ceil(w / CELL) + 3;
  const rows = Math.ceil(h / CELL) + 3;
  for (let j = -2; j < rows; j++) {
    for (let i = -2; i < cols; i++) {
      const dir = (i + j) % 2 === 0 ? 1 : -1;
      const toneIdx = Math.floor(rng() * tones.length);
      ctx.save();
      ctx.translate(x + i * CELL, y + j * CELL);
      ctx.rotate((dir * 45 * Math.PI) / 180);
      ctx.fillStyle = tones[toneIdx];
      ctx.fillRect(0, 0, L, W);
      ctx.strokeStyle = PALETTE.woodHerringboneSeam;
      ctx.lineWidth = 1.6;
      ctx.strokeRect(0, 0, L, W);
      ctx.fillStyle = PALETTE.woodHerringboneSheen;
      ctx.fillRect(0, 0, L, W * 0.32);
      ctx.restore();
    }
  }
  ctx.restore();
}

/** Woven carpet, warm grey, fine two-tone noise. */
function paintCarpet(ctx, x, y, w, h, rng) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  ctx.fillStyle = PALETTE.carpetBase;
  ctx.fillRect(x, y, w, h);
  const dots = Math.min(6000, Math.round(w * h * 0.6));
  for (let i = 0; i < dots; i++) {
    ctx.fillStyle = rng() > 0.5 ? PALETTE.carpetNoiseLight : PALETTE.carpetNoiseDark;
    ctx.fillRect(x + rng() * w, y + rng() * h, 1, 1);
  }
  ctx.restore();
}

/** Square tile with grout lines. */
function paintTile(ctx, x, y, w, h) {
  // Grout is a hairline, not a rule. At full contrast on a 24px pitch the grid
  // outweighed everything standing on it and the room read as graph paper.
  const CELL = 30;
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  ctx.fillStyle = PALETTE.tileBase;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = PALETTE.tileGrout;
  ctx.lineWidth = 0.75;
  for (let gy = y; gy <= y + h + CELL; gy += CELL) {
    ctx.beginPath();
    ctx.moveTo(x, gy + 0.5);
    ctx.lineTo(x + w, gy + 0.5);
    ctx.stroke();
  }
  for (let gx = x; gx <= x + w + CELL; gx += CELL) {
    ctx.beginPath();
    ctx.moveTo(gx + 0.5, y);
    ctx.lineTo(gx + 0.5, y + h);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * Circulation floor: the corridors and the spine.
 *
 * Poured, seamless and almost featureless on purpose. Corridors are now most
 * of the space between rooms, and painting them as 24px tile drew a hard grid
 * over a third of the building — the plan read as graph paper rather than as a
 * floor. A long, very soft sheen down the length of the run is enough to say
 * "polished surface" without competing with anything in a room.
 */
function paintCirculation(ctx, x, y, w, h) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = PALETTE.circulationBase;
  ctx.fillRect(x, y, w, h);
  const along = w >= h;
  const g = along
    ? ctx.createLinearGradient(x, y, x, y + h)
    : ctx.createLinearGradient(x, y, x + w, y);
  g.addColorStop(0, PALETTE.circulationSheen);
  g.addColorStop(0.45, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.03)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Wall drop shadow + ambient-occlusion band where wall meets floor, inset from a room's edges. */
function paintRoomAmbientOcclusion(ctx, x, y, w, h) {
  ctx.save();
  roundRect(ctx, x, y, w, h, 2);
  ctx.clip();
  const bandH = 26;
  const top = ctx.createLinearGradient(x, y, x, y + bandH);
  top.addColorStop(0, PALETTE.wallAmbientOcclusion);
  top.addColorStop(1, 'rgba(70,58,42,0)');
  ctx.fillStyle = top;
  ctx.fillRect(x, y, w, bandH);
  const left = ctx.createLinearGradient(x, y, x + bandH, y);
  left.addColorStop(0, PALETTE.wallAmbientOcclusion);
  left.addColorStop(1, 'rgba(70,58,42,0)');
  ctx.fillStyle = left;
  ctx.fillRect(x, y, bandH, h);
  ctx.restore();
}

// -------------------------------------------------------------- walls/doors

/**
 * Paint one wall segment.
 *
 * Walls belong to the floor, not to a room, so this draws a segment rather
 * than a room outline: an exterior wall is thick and casts a shadow inward, a
 * solid interior wall (the user's office) is the same but thinner, and a
 * partition is waist height — a subordinate line that divides the open plan
 * without closing it off.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {{x1:number,y1:number,x2:number,y2:number,kind:string,door?:{at:number,width:number}}} wall
 * @param {number} u
 */
function paintWallSegment(ctx, wall, u) {
  const x1 = wall.x1 * u;
  const y1 = wall.y1 * u;
  const x2 = wall.x2 * u;
  const y2 = wall.y2 * u;
  const horizontal = Math.abs(y2 - y1) < 0.5;

  const thickness = wall.kind === 'exterior' ? 6 : wall.kind === 'solid' ? 5 : 2.5;
  const half = thickness / 2;

  ctx.save();
  if (wall.kind === 'partition') {
    // Waist height: no shadow, and a softer fill, so it stays visually
    // subordinate to the real walls (VISUAL-SPEC section 6).
    ctx.fillStyle = PALETTE.partitionFill;
    ctx.strokeStyle = PALETTE.partitionEdge;
  } else {
    ctx.fillStyle = PALETTE.wallFill;
    ctx.strokeStyle = PALETTE.wallEdge;
    ctx.shadowColor = 'rgba(60,52,44,0.28)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetY = 2;
  }

  /** @param {number} a @param {number} b */
  const span = (a, b) => {
    if (horizontal) ctx.fillRect(a, y1 - half, b - a, thickness);
    else ctx.fillRect(x1 - half, a, thickness, b - a);
  };

  const start = horizontal ? x1 : y1;
  const end = horizontal ? x2 : y2;
  if (wall.door) {
    const at = start + wall.door.at * u;
    const w = wall.door.width * u;
    span(start, Math.max(start, at - w / 2));
    span(Math.min(end, at + w / 2), end);
  } else {
    span(start, end);
  }
  ctx.restore();

  // A hairline on the wall face reads as the plaster edge and keeps the line
  // crisp once the whole floor is scaled down to fit the window.
  ctx.save();
  ctx.strokeStyle = wall.kind === 'partition' ? PALETTE.partitionEdge : PALETTE.wallEdge;
  ctx.lineWidth = 0.75;
  ctx.beginPath();
  if (horizontal) {
    ctx.moveTo(x1, y1 - half);
    ctx.lineTo(x2, y1 - half);
    ctx.moveTo(x1, y1 + half);
    ctx.lineTo(x2, y1 + half);
  } else {
    ctx.moveTo(x1 - half, y1);
    ctx.lineTo(x1 - half, y2);
    ctx.moveTo(x1 + half, y1);
    ctx.lineTo(x1 + half, y2);
  }
  ctx.stroke();
  ctx.restore();
}

/** Gap in the wall plus a quarter-circle swing arc — reads instantly as a door. */
function paintDoorSwing(ctx, door, u) {
  const cx = door.x * u;
  const cy = door.y * u;
  const r = door.width * u;
  ctx.save();
  ctx.strokeStyle = PALETTE.doorSwingArc;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(cx, cy - r / 2, r, door.angle, door.angle + Math.PI / 2);
  ctx.stroke();
  ctx.restore();
}

// ------------------------------------------------------------------ props

function drawContactShadow(ctx, x, y, w, h) {
  ctx.save();
  ctx.fillStyle = PALETTE.shadowContact;
  ctx.beginPath();
  ctx.ellipse(
    x + w / 2 + 2,
    y + h + 2,
    Math.max(w / 2, 4),
    // A contact shadow is the dark line where a thing meets the floor, and its
    // depth is a property of how THICK the thing is, not of how big it is.
    // Unbounded, a room-sized rug (WP-50 gives one to a room much larger than
    // its desk cluster) cast a 380 px ellipse across half the room.
    Math.min(CONTACT_SHADOW_MAX_PX, Math.max(h * 0.22, 3)),
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  ctx.restore();
}

/**
 * Paint one furniture prop. All props share a soft contact shadow
 * (VISUAL-SPEC §6: "every furniture item carries a soft contact shadow").
 * Coordinates arrive pre-converted to px, already rotated by `angle`.
 */
function paintProp(ctx, prop, u) {
  const w = prop.w * u;
  const h = prop.h * u;
  // A Prop is a top-left rect, exactly like Room and Zone — that is the one
  // convention the whole geometry layer, the anchor resolver and the tests
  // all share. Every shape below is drawn about its own centre, so translate
  // to the centre of that rect. Treating x,y as the centre here (as this did
  // originally) offset every desk, chair, monitor, rug and whiteboard by half
  // its own size up and to the left.
  ctx.save();
  ctx.translate(prop.x * u + w / 2, prop.y * u + h / 2);

  // A prop may not paint outside its own footprint.
  //
  // Every rectangle on this floor is anchored, tested and reasoned about as
  // `x, y, w, h`; a painter that strays outside that puts furniture on the
  // floor plan where the plan says there is none, and no amount of checking
  // the GEOMETRY will ever find it. The allowance is for the parts of a prop
  // that are deliberately bigger than their anchor footprint — a plant's
  // foliage over its pot, a lamp's pool of light — and for the soft edge of a
  // shadow; it is not enough to hide a misplaced piece of furniture.
  ctx.beginPath();
  ctx.rect(
    -w / 2 - PROP_BLEED * u,
    -h / 2 - PROP_BLEED * u,
    w + 2 * PROP_BLEED * u,
    h + 2 * PROP_BLEED * u,
  );
  ctx.clip();

  // The clip is set in the prop's OWN, axis-aligned footprint — the rectangle
  // the plan reasons about — and only then is the prop's facing applied. Doing
  // it the other way round clips an unrotated drawing to a rotated box, which
  // is how a thirty-two unit sofa run came out as a single cushion.
  ctx.rotate(prop.angle || 0);

  const local = (fn) => {
    withShadow(ctx, () => fn(ctx), { blur: 8, oy: 3 });
    fn(ctx);
  };

  switch (prop.kind) {
    case 'desk':
    case 'user_desk': {
      local((k) => {
        k.fillStyle = PALETTE.deskTop;
        roundRect(k, -w / 2, -h / 2, w, h, 3);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1.2;
        k.stroke();
      });
      // centre divider
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.fillRect(-w / 2, -3, w, 6);
      break;
    }
    case 'monitor': {
      ctx.fillStyle = PALETTE.monitorBody;
      roundRect(ctx, -w / 2, -h / 2, w, h, 1.5);
      ctx.fill();
      ctx.fillStyle = PALETTE.monitorScreenGlow;
      ctx.fillRect(-w / 2 + 1, -h / 2 + 1, w - 2, Math.max(1, h - 2));
      break;
    }
    // A waiting-area chair is drawn like any other task chair; it is a
    // distinct kind only because it obeys a different placement rule (a
    // 3.2 U row pitch facing the user's desk, not a 0.15 U desk gap).
    case 'waiting_chair':
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
      const tones = [
        PALETTE.plantLeafA,
        PALETTE.whiteboardMarkerBlue,
        PALETTE.cabinetBody,
        PALETTE.whiteboardMarkerPlum,
        PALETTE.boardGameFelt,
        PALETTE.plantLeafC,
      ];
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
    case 'plant': {
      const scale = Math.max(w, h) / 2;
      local((k) => {
        k.fillStyle = PALETTE.plantPot;
        k.beginPath();
        k.arc(0, scale * 0.3, scale * 0.7, 0, Math.PI * 2);
        k.fill();
      });
      const blobs = [
        [0, -0.4, 1],
        [-0.65, -0.05, 0.78],
        [0.65, -0.1, 0.78],
        [-0.3, -0.85, 0.62],
        [0.4, -0.8, 0.68],
      ];
      const tones = [PALETTE.plantLeafA, PALETTE.plantLeafB, PALETTE.plantLeafC];
      blobs.forEach(([dx, dy, r], i) => {
        ctx.fillStyle = tones[i % tones.length];
        ctx.beginPath();
        ctx.arc(dx * scale, dy * scale, r * scale, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    }
    case 'plant_large': {
      // A bigger version of `plant`: more of a statement piece, so the
      // canopy gets a fuller rosette of blobs rather than a linear
      // scale-up of the same five, plus a visible pot rim so the base
      // reads as a real container rather than a flat disc.
      const scale = Math.max(w, h) / 2;
      local((k) => {
        k.fillStyle = PALETTE.plantPot;
        k.beginPath();
        k.arc(0, scale * 0.32, scale * 0.76, 0, Math.PI * 2);
        k.fill();
      });
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(1, scale * 0.06);
      ctx.beginPath();
      ctx.arc(0, scale * 0.32, scale * 0.6, 0, Math.PI * 2);
      ctx.stroke();
      const bigBlobs = [
        [0, -0.45, 1.05],
        [-0.68, -0.1, 0.82],
        [0.68, -0.12, 0.82],
        [-0.36, -0.88, 0.66],
        [0.42, -0.84, 0.7],
        [-0.1, -1.05, 0.5],
        [0.15, -0.62, 0.6],
      ];
      const bigTones = [PALETTE.plantLeafA, PALETTE.plantLeafB, PALETTE.plantLeafC];
      bigBlobs.forEach(([dx, dy, r], i) => {
        ctx.fillStyle = bigTones[i % bigTones.length];
        ctx.beginPath();
        ctx.arc(dx * scale, dy * scale, r * scale, 0, Math.PI * 2);
        ctx.fill();
      });
      break;
    }
    case 'rug': {
      // A rug sits ON the floor: it needs a contact shadow and a pile, or it
      // reads as a painted rectangle. At reception size (the office rug is the
      // largest single surface in the building) a flat fill dominated the room
      // more than the furniture on it did.
      drawContactShadow(ctx, -w / 2, -h / 2, w, h);
      ctx.fillStyle = PALETTE.rugSage;
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
      // round, with a border inset)"). rugCream instead of rugSage so the
      // two rug shapes are also tonally distinct where they appear near
      // each other.
      const r = Math.min(w, h) / 2;
      ctx.fillStyle = PALETTE.rugCream;
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
    case 'sofa': {
      // A sofa's RECT is the truth about how it lies: a run wider than it is
      // deep is horizontal, a run deeper than it is wide is vertical. The
      // cushion loop below divides along the length, so a taller-than-wide
      // sofa is drawn in a quarter-turned frame with its dimensions swapped.
      //
      // Rotating the prop instead was tried and is wrong: `angle` also has to
      // mean which way the sofa FACES, and the layout rect used for bounds and
      // anchors is the unrotated box — so a rotated sofa rendered across its
      // own footprint. That is what turned the reception's back run upright.
      // A sofa's RECT is its footprint and must NOT turn with `angle`. The
      // switch's wrapper has already applied `prop.angle`, so cancel it here
      // exactly as `manager` does: a 32 x 2.6 back run rotated by its own
      // facing renders as a 2.6 x 32 band straight across the room it is
      // supposed to sit at the back of.
      const a = prop.angle || 0;
      ctx.rotate(-a);
      const vertical = h > w;
      const len = vertical ? h : w;
      const depth = vertical ? w : h;
      if (vertical) ctx.rotate(Math.PI / 2);
      // WHICH SIDE THE BACK IS ON. The rect says how a sofa LIES; `angle` says
      // which way it FACES, in the plan's convention (0 is +x, east). The back
      // is the far side from that. Without this every sofa in the building had
      // its back to the room and its seat to the wall.
      const backAtStart = vertical ? Math.cos(a) < 0 : Math.sin(a) > 0;
      local((k) => {
        k.fillStyle = PALETTE.sofaFrame;
        roundRect(k, -len / 2, -depth / 2, len, depth, 6);
        k.fill();
        k.strokeStyle = PALETTE.chairEdge;
        k.stroke();
      });
      // Arms at each end and a back along one long side, so a sofa reads as a
      // sofa from directly above instead of as a white slab with lines on it.
      const arm = Math.min(depth * 0.34, 7);
      const back = Math.min(depth * 0.3, 6);
      const backY = backAtStart ? -depth / 2 : depth / 2 - back;
      ctx.fillStyle = PALETTE.sofaFrame;
      roundRect(ctx, -len / 2, backY, len, back, 4);
      ctx.fill();
      roundRect(ctx, -len / 2, -depth / 2, arm, depth, 4);
      ctx.fill();
      roundRect(ctx, len / 2 - arm, -depth / 2, arm, depth, 4);
      ctx.fill();
      // Seat cushions between the arms, each with its own soft seam.
      const seatX = -len / 2 + arm;
      const seatW = Math.max(2, len - arm * 2);
      const seatY = backAtStart ? -depth / 2 + back : -depth / 2 + 1.5;
      const seatH = Math.max(2, depth - back - 1.5);
      // A cushion is about as wide as the sofa is deep, and the seams between
      // them are seams — a 2.4px gap on every one turned a long reception run
      // into a row of separate white tiles.
      const n = Math.max(1, Math.round(seatW / Math.max(24, depth)));
      const cw = seatW / n;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = PALETTE.sofaCushion;
        roundRect(ctx, seatX + i * cw + 0.8, seatY + 1, cw - 1.6, seatH - 2, 3);
        ctx.fill();
        ctx.strokeStyle = PALETTE.sofaSeam;
        ctx.lineWidth = 0.9;
        roundRect(ctx, seatX + i * cw + 0.8, seatY + 1, cw - 1.6, seatH - 2, 3);
        ctx.stroke();
      }
      break;
    }
    case 'coffee_table': {
      // Low table in front of a sofa group. Same wood tone and soft ring
      // highlight as the dining and board-game tables so the lounge reads as
      // one furniture set, but rectangular rather than round: a coffee table
      // is a low rectangle, and the shape is what keeps the two apart from
      // above now that the tone no longer does.
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        roundRect(k, -w / 2, -h / 2, w, h, 5);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1.2;
        k.stroke();
      });
      const inset = Math.min(w, h) * 0.22;
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = Math.max(0.6, u / 22);
      roundRect(ctx, -w / 2 + inset, -h / 2 + inset, w - inset * 2, h - inset * 2, 3);
      ctx.stroke();
      break;
    }
    case 'fruit_bowl': {
      // A bowl of fruit on a counter: the small domestic cue that makes a
      // room read as a kitchen rather than as more office furniture.
      const r = Math.min(w, h) / 2;
      local((k) => {
        k.fillStyle = PALETTE.deskTop;
        k.beginPath();
        k.arc(0, 0, r, 0, Math.PI * 2);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.stroke();
      });
      const fruit = [
        [-0.3, -0.2, '#C0563B'],
        [0.3, -0.15, '#D98F2E'],
        [0, 0.25, '#7C9A4A'],
        [-0.15, 0.05, '#C9A227'],
      ];
      for (const [fx, fy, tone] of fruit) {
        ctx.fillStyle = tone;
        ctx.beginPath();
        ctx.arc(fx * r, fy * r, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'sofa_corner': {
      // The corner unit of the reception's C-shaped sectional. Same
      // fill/edge tokens as `sofa` so it reads as one continuous run
      // where they abut; one large seat cushion instead of a row of small
      // ones is what marks it as the turning corner rather than another
      // straight length.
      local((k) => {
        k.fillStyle = PALETTE.sofaFill;
        roundRect(k, -w / 2, -h / 2, w, h, 6);
        k.fill();
        k.strokeStyle = PALETTE.chairEdge;
        k.stroke();
      });
      const cushionPad = Math.min(w, h) * 0.16;
      ctx.fillStyle = PALETTE.sofaCushion;
      roundRect(
        ctx,
        -w / 2 + cushionPad,
        -h / 2 + cushionPad,
        w - cushionPad * 2,
        h - cushionPad * 2,
        5,
      );
      ctx.fill();
      break;
    }
    case 'side_table': {
      // Small square table beside the sofa — same wood tokens as the desk
      // family, just square and low, with a soft corner sheen instead of
      // the desk's centre divider.
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        roundRect(k, -w / 2, -h / 2, w, h, 3);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1;
        k.stroke();
      });
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      roundRect(ctx, -w / 2 + 1, -h / 2 + 1, w * 0.5, h * 0.5, 2);
      ctx.fill();
      break;
    }
    case 'magazine_table': {
      // Low rectangular coffee table with a couple of magazines fanned
      // across it — small flat rects at a slight angle read as "in use",
      // the same trick the whiteboard's marker dashes use.
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        roundRect(k, -w / 2, -h / 2, w, h, 4);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1.2;
        k.stroke();
      });
      const mags = [
        { dx: -0.16, dy: -0.06, rot: -0.16, tone: PALETTE.whiteboardMarkerBlue },
        { dx: 0.1, dy: 0.1, rot: 0.22, tone: PALETTE.whiteboardMarkerPlum },
      ];
      const mw = Math.max(3, w * 0.26);
      const mh = Math.max(2, h * 0.38);
      mags.forEach((m) => {
        ctx.save();
        ctx.translate(m.dx * w, m.dy * h);
        ctx.rotate(m.rot);
        ctx.fillStyle = m.tone;
        roundRect(ctx, -mw / 2, -mh / 2, mw, mh, 1);
        ctx.fill();
        ctx.restore();
      });
      break;
    }
    case 'lamp': {
      // Floor lamp: a small base point, with a wider shade ring above it
      // and a warm glow escaping under its rim. LAMP_GLOW (top of file)
      // is a colour palette.js does not carry — its only glows are the
      // cool monitor/arcade cyan, and a floor lamp needs to read as warm
      // light.
      const r = Math.min(w, h) / 2;
      ctx.fillStyle = LAMP_GLOW;
      ctx.beginPath();
      ctx.arc(0, 0, r * 1.1, 0, Math.PI * 2);
      ctx.fill();
      local((k) => {
        k.strokeStyle = PALETTE.chairFill;
        k.lineWidth = Math.max(1.5, r * 0.5);
        k.beginPath();
        k.arc(0, 0, r * 0.62, 0, Math.PI * 2);
        k.stroke();
      });
      ctx.fillStyle = PALETTE.furnitureMetal;
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(1, r * 0.2), 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'water_cooler': {
      // A small cylinder with a bottle on top, seen from above: the base
      // is the wider circle, the inverted bottle a smaller one nested
      // inside it.
      const r = Math.min(w, h) / 2;
      local((k) => {
        k.fillStyle = PALETTE.furnitureMetal;
        k.beginPath();
        k.arc(0, 0, r, 0, Math.PI * 2);
        k.fill();
      });
      ctx.fillStyle = PALETTE.monitorScreenGlow;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.62, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.beginPath();
      ctx.arc(-r * 0.18, -r * 0.18, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'dining_table':
    case 'board_game_table': {
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        k.beginPath();
        k.arc(0, 0, w / 2, 0, Math.PI * 2);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1.2;
        k.stroke();
      });
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.beginPath();
      ctx.arc(0, 0, w * 0.28, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'pool_table': {
      // A pool table is only recognisable from above by its furniture: a
      // deep cloth bed, a heavy rail frame around it, and six pockets. Drawn
      // as a plain filled rectangle with a hairline border it reads as an
      // ordinary wooden side table, which is exactly what it looked like.
      const rail = Math.max(3, Math.min(w, h) * 0.1);
      const bw = w - rail * 2;
      const bh = h - rail * 2;
      const pocket = rail * 0.62;
      const alongX = w >= h;

      local((k) => {
        // Rail frame, with a lighter top edge so it reads as a raised cushion.
        k.fillStyle = PALETTE.poolRail;
        roundRect(k, -w / 2, -h / 2, w, h, rail * 0.5);
        k.fill();
        k.fillStyle = PALETTE.poolRailTop;
        roundRect(k, -w / 2, -h / 2, w, rail * 0.5, rail * 0.35);
        k.fill();

        // The cloth bed.
        k.fillStyle = PALETTE.poolFelt;
        roundRect(k, -bw / 2, -bh / 2, bw, bh, 2);
        k.fill();
      });

      // Baulk line across the short axis, a quarter of the way down the bed.
      ctx.strokeStyle = PALETTE.poolFeltLine;
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (alongX) {
        const bx = -bw / 2 + bw * 0.25;
        ctx.moveTo(bx, -bh / 2);
        ctx.lineTo(bx, bh / 2);
      } else {
        const by = -bh / 2 + bh * 0.25;
        ctx.moveTo(-bw / 2, by);
        ctx.lineTo(bw / 2, by);
      }
      ctx.stroke();

      // Six pockets: four corners, two at the middle of the long rails.
      const pockets = [
        [-bw / 2, -bh / 2],
        [bw / 2, -bh / 2],
        [-bw / 2, bh / 2],
        [bw / 2, bh / 2],
      ];
      if (alongX) pockets.push([0, -bh / 2], [0, bh / 2]);
      else pockets.push([-bw / 2, 0], [bw / 2, 0]);
      ctx.fillStyle = PALETTE.poolPocket;
      for (const [px, py] of pockets) {
        ctx.beginPath();
        ctx.arc(px, py, pocket, 0, Math.PI * 2);
        ctx.fill();
      }

      // A racked triangle of balls at the far end, cue ball at the other, so
      // the table is legible as mid-game even when nobody is standing at it.
      const ball = Math.max(1.1, pocket * 0.46);
      const rackAt = alongX ? bw * 0.22 : bh * 0.22;
      const BALLS = ['#C4622F', '#3B5E8C', '#B03A3A', '#6E4E96', '#D8A73C'];
      let n = 0;
      for (let row = 0; row < 3; row++) {
        for (let i = 0; i <= row; i++) {
          const along = rackAt + row * ball * 1.9;
          const across = (i - row / 2) * ball * 2.1;
          ctx.fillStyle = BALLS[n % BALLS.length];
          ctx.beginPath();
          ctx.arc(alongX ? along : across, alongX ? across : along, ball, 0, Math.PI * 2);
          ctx.fill();
          n++;
        }
      }
      ctx.fillStyle = PALETTE.chairFill;
      ctx.beginPath();
      ctx.arc(alongX ? -bw * 0.28 : 0, alongX ? 0 : -bh * 0.28, ball, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'table_tennis': {
      // Bed, painted boundary lines, the doubles line down the LENGTH, and a
      // net across the middle with posts overhanging both edges. The net is
      // what distinguishes this from any other rectangular table from above.
      const alongX = w >= h;
      local((k) => {
        k.fillStyle = PALETTE.ttBed;
        roundRect(k, -w / 2, -h / 2, w, h, 1);
        k.fill();
      });

      ctx.strokeStyle = PALETTE.ttLine;
      ctx.lineWidth = 1.2;
      const inset = Math.max(1.5, Math.min(w, h) * 0.05);
      ctx.strokeRect(-w / 2 + inset, -h / 2 + inset, w - inset * 2, h - inset * 2);

      // Doubles line, running the long way.
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      if (alongX) {
        ctx.moveTo(-w / 2 + inset, 0);
        ctx.lineTo(w / 2 - inset, 0);
      } else {
        ctx.moveTo(0, -h / 2 + inset);
        ctx.lineTo(0, h / 2 - inset);
      }
      ctx.stroke();

      // Net across the short way, overhanging so the posts are visible.
      const over = Math.max(2, Math.min(w, h) * 0.07);
      ctx.fillStyle = PALETTE.ttNet;
      if (alongX) ctx.fillRect(-1.5, -h / 2 - over, 3, h + over * 2);
      else ctx.fillRect(-w / 2 - over, -1.5, w + over * 2, 3);
      break;
    }
    case 'foosball': {
      // A table with visible rods across it — same body language as
      // `pool_table`/`table_tennis`: a felt bed inside a wood cabinet,
      // plus a row of thin metal rods carrying small alternating-colour
      // players that stand in for the two teams. Orientation-adaptive
      // (rods run across whichever axis is shorter) since this kind has
      // no fixed w/h yet in plan.js.
      local((k) => {
        k.fillStyle = PALETTE.tableWood;
        roundRect(k, -w / 2, -h / 2, w, h, 2);
        k.fill();
      });
      ctx.fillStyle = PALETTE.boardGameFelt;
      roundRect(ctx, -w / 2 + 2, -h / 2 + 2, Math.max(0, w - 4), Math.max(0, h - 4), 1);
      ctx.fill();

      const long = w >= h;
      const span = long ? h : w;
      const across = long ? w : h;
      const rods = 5;
      const dot = Math.max(0.8, Math.min(w, h) * 0.045);
      ctx.strokeStyle = PALETTE.furnitureMetal;
      ctx.lineWidth = Math.max(0.8, Math.min(w, h) * 0.02);
      const teamTones = [PALETTE.whiteboardMarkerBlue, PALETTE.whiteboardMarkerPlum];
      for (let i = 0; i < rods; i++) {
        const a = ((i + 0.5) / rods - 0.5) * across;
        ctx.beginPath();
        if (long) {
          ctx.moveTo(a, -span / 2 + 1);
          ctx.lineTo(a, span / 2 - 1);
        } else {
          ctx.moveTo(-span / 2 + 1, a);
          ctx.lineTo(span / 2 - 1, a);
        }
        ctx.stroke();
        ctx.fillStyle = teamTones[i % 2];
        [-0.28, 0.28].forEach((p) => {
          ctx.beginPath();
          if (long) ctx.arc(a, p * span, dot, 0, Math.PI * 2);
          else ctx.arc(p * span, a, dot, 0, Math.PI * 2);
          ctx.fill();
        });
      }
      break;
    }
    case 'arcade_cabinet': {
      local((k) => {
        k.fillStyle = PALETTE.cabinetBody;
        roundRect(k, -w / 2, -h / 2, w, h, 2);
        k.fill();
      });
      ctx.fillStyle = PALETTE.cabinetScreenGlow;
      ctx.fillRect(-w * 0.3, -h * 0.3, w * 0.6, h * 0.35);
      break;
    }
    case 'counter': {
      local((k) => {
        k.fillStyle = PALETTE.counterTop;
        roundRect(k, -w / 2, -h / 2, w, h, 2);
        k.fill();
      });
      ctx.strokeStyle = PALETTE.chairEdge;
      ctx.strokeRect(-w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1);
      ctx.fillStyle = PALETTE.hob;
      ctx.fillRect(-w * 0.32, -h * 0.2, w * 0.2, h * 0.4);
      ctx.fillStyle = PALETTE.sink;
      roundRect(ctx, w * 0.1, -h * 0.22, w * 0.24, h * 0.44, 2);
      ctx.fill();
      break;
    }
    case 'fridge': {
      local((k) => {
        k.fillStyle = PALETTE.fridgeFill;
        roundRect(k, -w / 2, -h / 2, w, h, 2);
        k.fill();
        k.strokeStyle = PALETTE.chairEdge;
        k.stroke();
      });
      break;
    }
    case 'coffee_machine': {
      local((k) => {
        k.fillStyle = PALETTE.furnitureMetal;
        roundRect(k, -w / 2, -h / 2, w, h, 1);
        k.fill();
      });
      break;
    }
    case 'reception_desk': {
      // A low counter, distinct from `user_desk`: no centre divider (that
      // is what makes user_desk read as "a desk to sit at") — instead a
      // raised front lip the way a real reception counter presents to the
      // room, plus a small nameplate/monitor accent so it reads as a
      // staffed counter rather than a plain plinth.
      local((k) => {
        k.fillStyle = PALETTE.counterTop;
        roundRect(k, -w / 2, -h / 2, w, h, 2.5);
        k.fill();
        k.strokeStyle = PALETTE.deskEdge;
        k.lineWidth = 1.2;
        k.stroke();
      });
      const lip = Math.max(1.5, h * 0.22);
      ctx.fillStyle = PALETTE.furnitureMetal;
      ctx.fillRect(-w / 2, h / 2 - lip, w, lip);
      ctx.fillStyle = PALETTE.monitorBody;
      roundRect(ctx, w * 0.28, -h / 2 + h * 0.16, w * 0.16, h * 0.3, 1);
      ctx.fill();
      break;
    }
    case 'bar_counter': {
      // A long counter with a worktop edge — same body language as
      // `counter` (kitchen) but without fittings: the darker front band
      // and the thin highlight above it are what say "bar", the overhang
      // lip a drinker would lean on.
      local((k) => {
        k.fillStyle = PALETTE.counterTop;
        roundRect(k, -w / 2, -h / 2, w, h, 2);
        k.fill();
      });
      ctx.strokeStyle = PALETTE.chairEdge;
      ctx.lineWidth = 1;
      roundRect(ctx, -w / 2 + 0.5, -h / 2 + 0.5, w - 1, h - 1, 1.5);
      ctx.stroke();
      const edge = Math.max(1.2, h * 0.18);
      ctx.fillStyle = PALETTE.furnitureMetal;
      ctx.fillRect(-w / 2, h / 2 - edge, w, edge);
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillRect(-w / 2, h / 2 - edge - 1, w, 1);
      break;
    }
    case 'bar_stool': {
      // Small round stool, drawn as a disc with a footring: the ring is
      // drawn first and slightly wider than the seat, so it peeks out
      // from beneath the seat's edge the way a real stool's metal
      // footring does when seen from directly above.
      const r = Math.min(w, h) / 2;
      ctx.strokeStyle = PALETTE.furnitureMetal;
      ctx.lineWidth = Math.max(1, r * 0.14);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
      ctx.stroke();
      local((k) => {
        k.fillStyle = PALETTE.chairFill;
        k.beginPath();
        k.arc(0, 0, r * 0.75, 0, Math.PI * 2);
        k.fill();
        k.strokeStyle = PALETTE.chairEdge;
        k.lineWidth = 1.4;
        k.stroke();
      });
      break;
    }
    case 'box': {
      // A packing carton, seen from above: four flaps folded back, taped
      // down the middle. The joke and the affordance at once — the room
      // reads as somewhere people are leaving from.
      local((k) => {
        k.fillStyle = PALETTE.boxFill;
        roundRect(k, -w / 2, -h / 2, w, h, 1.5);
        k.fill();
      });
      ctx.strokeStyle = PALETTE.boxFlap;
      ctx.lineWidth = 1;
      ctx.strokeRect(-w / 2 + 2, -h / 2 + 2, w - 4, h - 4);
      ctx.fillStyle = PALETTE.boxTape;
      ctx.fillRect(-1.5, -h / 2, 3, h);
      break;
    }
    case 'exit_sign': {
      local((k) => {
        k.fillStyle = PALETTE.exitGreen;
        roundRect(k, -w / 2, -h / 2, w, h, 1.5);
        k.fill();
      });
      break;
    }
    default:
      // Unknown prop kinds still get a neutral block rather than being
      // silently dropped — better a plain box than a missing desk.
      ctx.fillStyle = PALETTE.furnitureMetal;
      roundRect(ctx, -w / 2, -h / 2, w, h, 2);
      ctx.fill();
  }

  ctx.restore();

  // Contact shadow beneath the whole footprint, in un-rotated plan space —
  // simpler and close enough at this scale for a soft ambient blob. Skipped
  // for 'manager': `drawManagerFigure` already draws a character-shaped
  // contact shadow sized to the figure's actual stance (rig.js's SHADOW_*
  // proportions), not to the padded anchor footprint — stacking this
  // bounding-box blob under it as well would just muddy the one that is
  // already correctly shaped and placed.
  if (prop.kind !== 'manager') drawContactShadow(ctx, prop.x * u, prop.y * u, w, h);
}

// -------------------------------------------------------------------- bake

/**
 * Bake the whole floor (materials, walls, doors, furniture) to an offscreen
 * bitmap. Called once per plan change — never per frame
 * (docs/02-ARCHITECTURE.md §8).
 *
 * @param {import('./plan.js').Plan} plan
 * @param {number} [dpr] device pixel ratio; the returned canvas is `wpx*dpr`
 *   by `hpx*dpr` physical pixels, pre-scaled so callers can blit 1:1.
 * @returns {{ canvas: OffscreenCanvas | HTMLCanvasElement, wpx: number, hpx: number }}
 */
export function bakeBackdrop(plan, dpr = 1) {
  const u = U_DEFAULT;
  const wpx = Math.ceil(plan.width * u);
  const hpx = Math.ceil(plan.height * u);
  const scale = Math.max(1, dpr || 1);

  const canvas = makeCanvas(Math.ceil(wpx * scale), Math.ceil(hpx * scale));
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  // Zone floors. The zones tile the whole envelope, so there is no separate
  // "circulation" surface to paint under them — the plan is one continuous
  // floor whose material changes where the use changes.
  for (const room of plan.rooms) {
    const rx = room.x * u;
    const ry = room.y * u;
    const rw = room.w * u;
    const rh = room.h * u;
    const rng = seededRng(room.id);

    if (room.kind === 'corridor') {
      // Circulation is not a room and gets neither a room's ambient occlusion
      // nor a room's plate — there are no walls above it to occlude. A route
      // (the spine, a cross corridor) is poured circulation; a lobby, which is
      // just the open floor beside a room, takes that room's own material so
      // the two read as one space.
      if (room.floor === 'wood') paintHerringbone(ctx, rx, ry, rw, rh, rng);
      else if (room.floor === 'carpet') paintCarpet(ctx, rx, ry, rw, rh, rng);
      else if (room.floor === 'tile') paintTile(ctx, rx, ry, rw, rh);
      else paintCirculation(ctx, rx, ry, rw, rh);
      continue;
    }

    if (room.floor === 'wood') paintHerringbone(ctx, rx, ry, rw, rh, rng);
    else if (room.floor === 'tile') paintTile(ctx, rx, ry, rw, rh);
    else if (room.floor === 'circulation') paintCirculation(ctx, rx, ry, rw, rh);
    else paintCarpet(ctx, rx, ry, rw, rh, rng);

    if (room.kitchenZone) {
      const kz = room.kitchenZone;
      paintTile(ctx, kz.x * u, kz.y * u, kz.w * u, kz.h * u);
    }

    paintRoomAmbientOcclusion(ctx, rx, ry, rw, rh);

    // The idle-projects directory is a board on the floor, not a room with the
    // lights off: nobody is in any of the repos it lists, so it is dimmed as a
    // whole rather than given the ambient light a room in use gets.
    if (room.kind === 'directory') {
      ctx.save();
      ctx.fillStyle = PALETTE.roomDimmed;
      ctx.fillRect(rx, ry, rw, rh);
      ctx.restore();
    }
  }

  // Walls, from the floor's own wall list. Two zones either side of a
  // partition share one segment, which is what makes this read as a single
  // building that has been divided rather than a row of separate huts.
  for (const wall of plan.walls || []) {
    paintWallSegment(ctx, wall, u);
  }
  for (const door of plan.doors) {
    paintDoorSwing(ctx, door, u);
  }

  // Furniture, each with its own contact shadow. Room plates are NOT drawn
  // here — they are live text drawn every frame by the scene, so a stat
  // change never forces a re-bake. Space for the plate is simply left
  // empty at each room's top-left.
  for (const room of plan.rooms) {
    for (const prop of room.props || []) {
      paintProp(ctx, prop, u);
    }
  }

  return { canvas, wpx, hpx };
}
