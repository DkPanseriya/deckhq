/* docs/media/motion/crew.png and crew.gif — a project room whose parent has
   five live juniors, drawn as the crew formation of §3. Illustration only.

   `renderCrew(ctx, p, mode)`: `p` is the animation phase in [0, 1) and it is
   the ONLY input the pulses take, which is what lets the GIF be cut from
   thirty stills and what a golden fixture would pin. */

var KW = 1440,
  KH = 900;

/* The room, in its own pixels. The 2x panel is the same draw at twice the
   scale through a clip — one geometry, two magnifications. */
var ROOM = { x: 34, y: 96, w: 852, h: 424 };

var CARPET = '#E2E8DB';
var CARPET_2 = '#DCE3D3';
var WALL = '#F2EDE2';
var RUG = '#D5DECB';
var WOOD = '#C9A876';
var WOOD_TOP = '#D8B98A';
var GREEN = STATE_COLORS.working;

var PARENT_TR = traitsFor('m3rt');

/** The five juniors, right to left: a seed, the agentType the sidecar
    actually carries, and the observed event rate the pulse cadence is tied
    to. Rate 0 is a junior whose transcript has stopped moving. */
var CREW = [
  { seed: 'j05', type: 'test-engineer', rate: 0, busy: false },
  { seed: 'j02', type: 'general-purpose', rate: 2, busy: true },
  { seed: 'j03', type: 'code-reviewer', rate: 4, busy: true },
  { seed: 'j01', type: 'Explore', rate: 2, busy: true },
  { seed: 'j04', type: 'Explore', rate: 1, busy: true },
];

var PARENT_H = 58;
var JUNIOR_H = 38; // 0.66 of the parent, inside §3's 0.60-0.70 band

/** Geometry shared by the 1x draw and the 2x crop, in room-local pixels. */
function crewGeometry() {
  var cx = ROOM.w * 0.5,
    deskY = 124;
  var deskW = 206,
    deskH = 54;
  var frontY = deskY + deskH / 2;
  var R = 186,
    VF = 0.94;
  var out = { cx: cx, deskY: deskY, deskW: deskW, deskH: deskH, frontY: frontY, seats: [] };
  var angles = [24, 57, 90, 123, 156];
  for (var i = 0; i < 5; i++) {
    var a = (angles[i] * Math.PI) / 180;
    var jx = cx + Math.cos(a) * R,
      jy = frontY + Math.sin(a) * R * VF;
    // the laptop sits between the junior and the desk it feeds
    var lx = cx + Math.cos(a) * (R - 40),
      ly = frontY + Math.sin(a) * (R - 40) * VF + 2;
    var portX = cx + (i - 2) * 34;
    var midR = R - 92;
    var mx = cx + Math.cos(a) * midR,
      my = frontY + Math.sin(a) * midR * VF;
    var pts = [
      [lx, ly - 4],
      [mx, my],
      [portX, my],
      [portX, frontY + 3],
    ];
    // the fourth cable is routed AROUND the corner plant rather than through
    // it: one extra bend, and that is the whole of "routed, not straight"
    if (i === 4) pts.splice(1, 0, [lx + 4, ly + 26], [lx + 54, ly + 26]);
    out.seats.push({ jx: jx, jy: jy, lx: lx, ly: ly, pts: pts, angle: a });
  }
  return out;
}

/** The room itself: carpet, wall band, rug, desk, plants. */
function drawRoomShell(ctx, G) {
  var p = new Path2D();
  p.roundRect(0, 0, ROOM.w, ROOM.h, 6);
  ctx.fillStyle = CARPET;
  ctx.fill(p);
  ctx.save();
  ctx.clip(p);
  // a quiet weave, the way WP-85a paints one: two tones, never a 1 px fill
  ctx.fillStyle = CARPET_2;
  for (var wy = 0; wy < ROOM.h; wy += 22) {
    for (var wx = ((wy / 22) % 2) * 11; wx < ROOM.w; wx += 22) ctx.fillRect(wx, wy, 11, 11);
  }
  // the plate band across the top stays furniture-free by construction
  ctx.fillStyle = WALL;
  ctx.fillRect(0, 0, ROOM.w, 40);
  ctx.fillStyle = 'rgba(60,52,40,0.10)';
  ctx.fillRect(0, 40, ROOM.w, 1);

  // the task rug under the crew: the formation's floor, not floor covering
  var rug = new Path2D();
  rug.ellipse(G.cx, G.frontY + 58, 268, 152, 0, 0, Math.PI * 2);
  ctx.fillStyle = RUG;
  ctx.fill(rug);
  ctx.strokeStyle = 'rgba(60,52,40,0.10)';
  ctx.lineWidth = 1.5;
  ctx.stroke(rug);

  // the parent's desk
  var d = new Path2D();
  d.roundRect(G.cx - G.deskW / 2, G.deskY - G.deskH / 2, G.deskW, G.deskH, 5);
  ctx.fillStyle = WOOD;
  ctx.fill(d);
  var dt = new Path2D();
  dt.roundRect(G.cx - G.deskW / 2, G.deskY - G.deskH / 2, G.deskW, G.deskH * 0.34, 5);
  ctx.fillStyle = WOOD_TOP;
  ctx.fill(dt);
  ctx.strokeStyle = 'rgba(56,47,38,0.34)';
  ctx.lineWidth = 1.2;
  ctx.stroke(d);
  var m = new Path2D();
  m.roundRect(G.cx + 46, G.deskY - G.deskH / 2 - 15, 46, 19, 2);
  ctx.fillStyle = '#6E6A63';
  ctx.fill(m);
  ctx.fillStyle = '#F7F1E1';
  ctx.fillRect(G.cx + 50, G.deskY - G.deskH / 2 - 12, 38, 12);

  // plants: two corners, and the one cable five is routed around
  plant(ctx, 46, ROOM.h - 46, 20);
  plant(ctx, ROOM.w - 48, ROOM.h - 50, 22);
  plant(ctx, G.seats[4].lx + 22, G.seats[4].ly + 4, 17);
  ctx.restore();
  ctx.strokeStyle = 'rgba(60,52,40,0.22)';
  ctx.lineWidth = 1.2;
  ctx.stroke(p);
}

function plant(ctx, x, y, r) {
  var pot = new Path2D();
  pot.roundRect(x - r * 0.4, y - r * 0.3, r * 0.8, r * 0.5, 2);
  ctx.fillStyle = '#B08B63';
  ctx.fill(pot);
  var f = new Path2D();
  f.ellipse(x, y - r * 0.5, r * 0.78, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#6F8C63';
  ctx.fill(f);
  ctx.strokeStyle = 'rgba(56,47,38,0.28)';
  ctx.lineWidth = 1;
  ctx.stroke(f);
}

/** A name under a figure, in the floor's own style: light halo, dark ink. */
function nameUnder(ctx, s, x, y, size) {
  ctx.font = '600 ' + (size || 9) + 'px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.lineWidth = 2.8;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(253,250,243,0.92)';
  ctx.strokeText(s, x, y);
  ctx.fillStyle = 'rgba(44,39,32,0.92)';
  ctx.fillText(s, x, y);
  ctx.textAlign = 'left';
}

/** A room plate, in the floor's own idiom: name, then one line of counts. */
function roomPlate(ctx, title, line) {
  txt(ctx, title, 12, 18, 13, SHEET_TXT, 700);
  code(ctx, line, 12, 33, 10.5, SHEET_MUTED);
}

/** The whole crew formation, at phase `p`. */
function drawCrew(ctx, G, p) {
  var i, s;
  // 1. the cables, under everybody
  for (i = 0; i < 5; i++) {
    s = G.seats[i];
    cable(ctx, s.pts, CREW[i].busy ? 'rgba(46,125,99,0.7)' : 'rgba(123,135,148,0.55)', 2.6);
  }

  // 2. the parent at its desk, its visor brightened by the crew it holds
  var parentY = G.deskY - G.deskH / 2 - 2;
  var pose = MOTION.type(p * 3);
  robot(ctx, G.cx - 52, parentY, PARENT_H, 'working', PARENT_TR, pose, { noBeacon: true });
  visorFlash(ctx, G.cx - 52, parentY, PARENT_H, 'working', PARENT_TR, pose, 0.3);
  nameUnder(ctx, 'Boris', G.cx - 52, parentY + 13, 10);

  // 3. the juniors, seated on the floor, each with a laptop
  for (i = 0; i < 5; i++) {
    s = G.seats[i];
    var tr = traitsFor(CREW[i].seed);
    var over = CREW[i].busy
      ? { lean: 0.16, by: 0.2, aR: [0.3, 0.26], aL: [-0.29, 0.27] }
      : { lean: 0.22, by: 0.17, aR: [0.26, 0.12], aL: [-0.25, 0.13] };
    robot(ctx, s.jx, s.jy, JUNIOR_H, CREW[i].busy ? 'working' : 'ended', tr, over, {
      noBeacon: true,
    });
    laptop(ctx, s.lx, s.ly, JUNIOR_H * 0.62, s.jx > G.cx);
    nameUnder(ctx, CREW[i].type, s.jx, s.jy + 12, 9);
  }

  // 4. the pulses, junior -> parent, at the junior's own observed rate
  for (i = 0; i < 5; i++) {
    s = G.seats[i];
    var n = CREW[i].rate;
    for (var k = 0; k < n; k++) pulse(ctx, s.pts, (p + k / n) % 1, GREEN, 2.5);
  }
}

/** The room, drawn at (x, y) with its plate and its crew chip. */
function renderRoom(ctx, x, y, p) {
  var G = crewGeometry();
  ctx.save();
  ctx.translate(x, y);
  drawRoomShell(ctx, G);
  var clip = new Path2D();
  clip.roundRect(0, 0, ROOM.w, ROOM.h, 6);
  ctx.save();
  ctx.clip(clip);
  drawCrew(ctx, G, p);
  ctx.restore();
  roomPlate(ctx, 'design-system', '1 session · crew of 5 · 540k tok · 0 need you');
  var w = 86;
  var cp = new Path2D();
  cp.roundRect(ROOM.w - w - 12, 10, w, 20, 10);
  ctx.fillStyle = 'rgba(46,125,99,0.15)';
  ctx.fill(cp);
  ctx.strokeStyle = 'rgba(46,125,99,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke(cp);
  code(ctx, 'crew · 5', ROOM.w - w / 2 - 12, 24, 10, shade(GREEN, -0.22), 'center');
  ctx.restore();
  return G;
}

/* ------------------------------------------- below the threshold, and at it */

/** A small panel showing what N juniors look like. */
function thresholdPanel(ctx, x, y, w, h, n, title, note) {
  card(ctx, x, y, w, h, '#EDEFE8', 7);
  txt(ctx, title, x + 14, y + 22, 12.5, SHEET_TXT, 700);
  code(ctx, note, x + 14, y + 38, 9.5, SHEET_MUTED);
  var g = new Path2D();
  g.roundRect(x + 12, y + 48, w - 24, h - 60, 6);
  ctx.fillStyle = CARPET;
  ctx.fill(g);
  ctx.save();
  ctx.clip(g);
  var cx = x + w / 2,
    gy = y + h - 58;
  // the desk
  var d = new Path2D();
  d.roundRect(cx - 62, gy - 52, 124, 30, 4);
  ctx.fillStyle = WOOD;
  ctx.fill(d);
  ctx.strokeStyle = 'rgba(56,47,38,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke(d);
  robot(ctx, cx, gy - 18, 44, 'working', PARENT_TR, MOTION.type(0.2), { noBeacon: true });
  if (n <= 2) {
    // WP-41's rule, unchanged: alternating sides, one seat pitch apart
    for (var i = 0; i < n; i++) {
      var dx = i === 0 ? -48 : 48;
      robot(ctx, cx + dx, gy - 12, 30, 'working', traitsFor('t' + i), MOTION.type(0.5), {
        noBeacon: true,
      });
    }
  } else {
    for (var j = 0; j < 5; j++) {
      var a = ((26 + j * 32) * Math.PI) / 180;
      var jx = cx + Math.cos(a) * 92,
        jy = gy - 30 + Math.sin(a) * 36;
      cable(
        ctx,
        [
          [jx - 4, jy - 8],
          [jx - 4, gy - 40],
          [cx + (j - 2) * 14, gy - 40],
          [cx + (j - 2) * 14, gy - 22],
        ],
        'rgba(46,125,99,0.6)',
        1.8,
      );
      robot(ctx, jx, jy, 24, 'working', traitsFor('c' + j), MOTION.type(0.4), { noBeacon: true });
    }
  }
  ctx.restore();
}

function renderCrew(ctx, p, mode) {
  var G;
  if (mode === 'gif') {
    // the GIF is the formation and nothing else, so a reader sees the pulses
    ctx.fillStyle = SHEET_BG;
    ctx.fillRect(0, 0, 760, 470);
    ctx.save();
    ctx.translate(380, 235);
    ctx.scale(0.87, 0.87);
    ctx.translate(-ROOM.w / 2, -ROOM.h / 2);
    G = crewGeometry();
    drawRoomShell(ctx, G);
    var gclip = new Path2D();
    gclip.roundRect(0, 0, ROOM.w, ROOM.h, 6);
    ctx.save();
    ctx.clip(gclip);
    drawCrew(ctx, G, p);
    ctx.restore();
    roomPlate(ctx, 'design-system', '1 session · crew of 5 · 540k tok · 0 need you');
    ctx.restore();
    return;
  }

  ctx.fillStyle = SHEET_BG;
  ctx.fillRect(0, 0, KW, KH);
  txt(ctx, 'DeckHQ — the crew', 30, 40, 22, SHEET_TXT, 700);
  code(
    ctx,
    'WP-89 · a parent with five juniors · 1× on the left, a 2× crop on the right · pulses run junior → parent, and only while it is writing · illustration',
    30,
    60,
    11.5,
    SHEET_MUTED,
  );
  rule(ctx, 30, 74, KW - 30);

  G = renderRoom(ctx, ROOM.x, ROOM.y, 0.16);

  code(
    ctx,
    'Every junior here is a real transcript under `subagents/`: its own file, its own parent,',
    ROOM.x,
    ROOM.y + ROOM.h + 22,
    10.5,
    SHEET_MUTED,
  );
  code(
    ctx,
    'its own spawn time. The far-right one has stopped writing — grey cable, no pulses.',
    ROOM.x,
    ROOM.y + ROOM.h + 38,
    10.5,
    SHEET_MUTED,
  );

  // ------------------------------------------------------------- the 2x crop
  var px = 906,
    py = 96,
    pw = 504,
    ph = 356;
  card(ctx, px, py, pw, ph, '#E9E5D9', 7);
  ctx.save();
  var cl = new Path2D();
  cl.roundRect(px + 1, py + 1, pw - 2, ph - 2, 6);
  ctx.clip(cl);
  ctx.translate(px + pw / 2, py + ph / 2);
  ctx.scale(1.78, 1.78);
  ctx.translate(-(G.cx + 4), -(G.frontY + 74));
  drawRoomShell(ctx, G);
  drawCrew(ctx, G, 0.16);
  ctx.restore();
  ctx.strokeStyle = SHEET_RULE;
  ctx.lineWidth = 1;
  ctx.strokeRect(px + 0.5, py + 0.5, pw - 1, ph - 1);
  code(
    ctx,
    '2× crop — three seats, three cables, the ports on the desk’s front edge',
    px + 2,
    py + ph + 16,
    10,
    SHEET_MUTED,
  );

  // ---------------------------------------------------------------- the rules
  var ry = py + ph + 30;
  card(ctx, px, ry, pw, KH - ry - 30, '#F6F3EC', 7);
  txt(ctx, 'what the picture is allowed to claim', px + 16, ry + 24, 14, SHEET_TXT, 700);
  var lines = [
    'threshold  3 or more juniors live at once turn the parent’s',
    '           desk into a crew. One or two keep WP-41’s seat',
    '           beside the parent, unchanged (panels below).',
    'scale      junior at 0.66 of the parent — §3’s 0.60-0.70',
    '           band — through characterScaleFor, so the 16 px',
    '           legibility floor still binds at a tight fit.',
    'cable      one per junior, routed: axis-aligned runs, rounded',
    '           corners, no prop crossed. Cable five bends round',
    '           the plant rather than through it.',
    'pulse      junior → parent ONLY, and only while that junior’s',
    '           transcript is moving. Rate is its own observed',
    '           events per minute, quantised to 1 / 2 / 4 per loop',
    '           and capped. The stopped junior has a grey cable',
    '           and no pulse at all — that is the honest difference',
    '           between working and finished.',
    'cap        12 drawn, then a "+N" chip beside the desk.',
    'reduced    cables drawn, no pulses, a count badge on the desk.',
  ];
  var ly = ry + 46;
  for (var i = 0; i < lines.length; i++) {
    code(ctx, lines[i], px + 16, ly, 9.5, SHEET_MUTED);
    ly += 12.4;
  }

  // ------------------------------------------------------ the threshold strip
  var sy = 590,
    sw = 272,
    sh = 252;
  thresholdPanel(ctx, ROOM.x, sy, sw, sh, 1, '1 junior', 'seat beside the parent · WP-41, unchanged');
  thresholdPanel(
    ctx,
    ROOM.x + sw + 18,
    sy,
    sw,
    sh,
    2,
    '2 juniors',
    'both sides, one seat pitch · still no cables',
  );
  thresholdPanel(
    ctx,
    ROOM.x + (sw + 18) * 2,
    sy,
    sw,
    sh,
    5,
    '3+ juniors — the crew',
    'arc on the floor, laptops, cables, pulses',
  );
}
