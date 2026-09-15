/* docs/media/motion/life-sheet.png — the robot's animation frames per state,
   laid out as strips. Illustration only; every number printed on a strip is
   the one `docs/plan/12-MOTION-AND-CREW.md` §2 states.

   The over-head state icon is suppressed on every strip. It is unchanged by
   WP-87 and it is drawn last of all so nothing can occlude it; a sheet about
   BODY motion that redrew it would be making a claim it is not making. */

var W = 1340,
  H = 1910;

var TR = traitsFor('a7f2');
var TR2 = traitsFor('k9x1');
var TR3 = traitsFor('zq04');

var GUT = 396; // left column: the name and the numbers
var FX = GUT + 36; // first frame's centre
var FP = 122; // frame pitch
var FH = 74; // figure height, px crown to sole
var ROW = 152; // default strip height

var STATE_TINT = {
  working: '#EDF2EB',
  thinking: '#EDF2EB',
  'needs input': '#F7F0E7',
  'for review': '#F8EEEC',
  stalled: '#F5F1E8',
  ended: '#F1F0EC',
  walking: '#F0F1EE',
  running: '#F7F0E7',
  spawn: '#EDF2EB',
  despawn: '#EFF1F2',
};
function tintFor(name) {
  var key = name.split(' ·')[0].toLowerCase();
  return STATE_TINT[key] || SHEET_CARD;
}
function headFor(name) {
  var key = name.split(' ·')[0].toLowerCase().replace(' ', '_');
  return STATE_COLORS[key] ? shade(STATE_COLORS[key], -0.28) : SHEET_TXT;
}

/** One strip: a heading block on the left, then `n` frames drawn by `fn`. */
function strip(ctx, y, name, meta, n, fn, rowH, tickFn) {
  var h = rowH || ROW;
  card(ctx, 26, y, W - 52, h, tintFor(name));
  txt(ctx, name, 44, y + 25, 14.5, headFor(name), 700);
  var ly = y + 45;
  for (var i = 0; i < meta.length; i++) {
    code(ctx, meta[i], 44, ly, 9.5, SHEET_MUTED);
    ly += 13.5;
  }
  ctx.beginPath();
  ctx.moveTo(GUT, y + 12);
  ctx.lineTo(GUT, y + h - 12);
  ctx.strokeStyle = SHEET_RULE;
  ctx.lineWidth = 1;
  ctx.stroke();
  var gy = y + h - 36;
  for (var f = 0; f < n; f++) {
    var cx = FX + f * FP;
    tile(ctx, cx - 50, y + 12, 100, h - 34, '#E7E3D7');
    fn(ctx, cx, gy, f, n);
    code(ctx, tickFn ? tickFn(f) : String(f + 1), cx, y + h - 11, 9.5, SHEET_MUTED, 'center');
  }
  return y + h + 12;
}

function renderLifeSheet(ctx) {
  ctx.fillStyle = SHEET_BG;
  ctx.fillRect(0, 0, W, H);

  txt(ctx, 'DeckHQ — character life', 30, 40, 22, SHEET_TXT, 700);
  code(
    ctx,
    'WP-87 · one strip per state · every frame a pure function of the injected clock · illustration, not a render of the product',
    30,
    60,
    11.5,
    SHEET_MUTED,
  );
  rule(ctx, 30, 74, W - 30);

  var y = 88;

  // ---------------------------------------------------------------- working
  y = strip(
    ctx,
    y,
    'working · type',
    [
      'trigger  activityState = working, no tool call open',
      'frames   4 · period 0.90 s · loops',
      'LOD      2+ full · 1 bob only · 0 static',
      'reduced  hands on the keys, no bob',
    ],
    4,
    function (c, x, gy, f) {
      robot(c, x, gy, FH, 'working', TR, MOTION.type(f / 4), { noBeacon: true });
    },
  );

  // ------------------------------------------------- working · visor flicker
  y = strip(
    ctx,
    y,
    'working · visor flicker',
    [
      'trigger  a REAL tool call opening: currentTool.since moves',
      'frames   3 · 0.24 s · one-shot, never a loop',
      'LOD      all — the visor is in no drop list',
      'reduced  the lit visor, no flash',
    ],
    3,
    function (c, x, gy, f) {
      var over = MOTION.type(0.2);
      robot(c, x, gy, FH, 'working', TR, over, { noBeacon: true });
      var k = [1, 0.45, 0][f];
      if (k > 0) visorFlash(c, x, gy, FH, 'working', TR, over, k);
    },
    ROW,
    function (f) {
      return ['Bash opens', '0.12 s', '0.24 s'][f];
    },
  );

  // --------------------------------------------------------------- thinking
  y = strip(
    ctx,
    y,
    'thinking · the cloud grows',
    [
      'trigger  turn open, no tool call, > 2.0 s since the last event',
      'cloud    1 lobe at 2 s · 2 at 6 s · 3 at 15 s · stops there',
      'frames   4 · head sway 3.20 s loop · the growth is not a loop',
      'reduced  the cloud at its current size, no sway',
    ],
    4,
    function (c, x, gy, f) {
      robot(c, x, gy, FH, 'working', TR, MOTION.think(f / 4), { noBeacon: true });
      thoughtCloud(c, x + FH * 0.16, gy - FH * 1.22, FH * 0.16, [0.08, 0.4, 0.72, 1][f]);
    },
    162,
    function (f) {
      return ['2 s', '6 s', '15 s', '40 s'][f];
    },
  );

  // ------------------------------------------------------------ needs_input
  y = strip(
    ctx,
    y,
    'needs input · hand raised, waving',
    [
      'trigger  activityState = needs_input. The hand IS the state',
      'frames   4 · period 1.40 s · loops, with the floor ring',
      'LOD      all. The raised hand is in no drop list, and',
      '         nothing may be drawn over it — the wave included',
      'reduced  hand up, ring static at half phase',
    ],
    4,
    function (c, x, gy, f) {
      var rr = FH * (0.3 + 0.16 * (f / 4));
      c.beginPath();
      c.ellipse(x, gy, rr, rr * 0.3, 0, 0, Math.PI * 2);
      c.strokeStyle = alpha(STATE_COLORS.needs_input, 0.55 * (1 - f / 5));
      c.lineWidth = 2.2;
      c.stroke();
      robot(c, x, gy, FH, 'needs_input', TR, MOTION.wave(f / 4), { noBeacon: true });
    },
  );

  // ------------------------------------------------------------- for_review
  y = strip(
    ctx,
    y,
    'for review · page held up, occasional flip',
    [
      'trigger  activityState = for_review, standing in Your Office',
      'hold     static. Flip: 4 frames · 0.50 s · once every 12 s',
      'the flip is idle only. It carries no meaning, and it stops the',
      'instant the state changes — an idle beat is never a signal',
      'reduced  page held flat, never flipped',
    ],
    4,
    function (c, x, gy, f) {
      var over = MOTION.page(f / 4);
      robot(c, x, gy, FH, 'for_review', TR, over, { noBeacon: true });
      pageFlip(c, x, gy - FH * 0.02, FH, [1, 0.45, 0.1, 1][f]);
    },
    ROW,
    function (f) {
      return ['held', 'turning', 'edge on', 'held'][f];
    },
  );

  // ---------------------------------------------------------------- stalled
  y = strip(
    ctx,
    y,
    'stalled · slump, dim visor, dots',
    [
      'trigger  activityState = stalled — observed, never inferred',
      'frames   3 · period 4.00 s · loops, deliberately low energy',
      'the dots count 1 · 2 · 3 · none, so "gone quiet" stays legible',
      'reduced  slumped, two dots lit, visor at 50%',
    ],
    3,
    function (c, x, gy, f) {
      robot(c, x, gy, FH, 'stalled', TR, MOTION.slump(f / 3), { noBeacon: true });
      stallDots(c, x + FH * 0.44, gy - FH * 0.86, FH * 0.095, f / 3.99);
    },
  );

  // ------------------------------------------------------------------ ended
  y = strip(
    ctx,
    y,
    'ended · power-down, once',
    [
      'trigger  the session ends. ONE pass, then still for ever',
      'frames   5 · 1.60 s · never loops, never replays on a re-render',
      'a re-render after the pass draws frame 5 and nothing else',
      'reduced  frame 5, straight away',
    ],
    5,
    function (c, x, gy, f) {
      var u = f / 4;
      robot(c, x, gy, FH, u < 0.75 ? 'stalled' : 'ended', TR, MOTION.power(u), { noBeacon: true });
    },
    ROW,
    function (f) {
      return ['0.0 s', '0.4 s', '0.8 s', '1.2 s', '1.6 s'][f];
    },
  );

  // ----------------------------------------------------------- walk and run
  y = strip(
    ctx,
    y,
    'walking · two frames, no blend',
    [
      'trigger  any trip that is not to Your Office for needs_input',
      'frames   2 · period 0.80 s · 2.6 U/s',
      'a chunky robot walks as a waddle: a step and its mirror',
      'reduced  no trip is animated — the figure is at its seat',
    ],
    2,
    function (c, x, gy, f) {
      var over = MOTION.walk(f / 2);
      strideFoot(c, x, gy, FH, 'working', TR, over);
      robot(c, x, gy, FH, 'working', TR, over, { noBeacon: true });
    },
  );

  y = strip(
    ctx,
    y,
    'running · to Your Office, needs_input only',
    [
      'trigger  destination is Your Office AND state is needs_input',
      'frames   4 · period 0.52 s · 4.6 U/s · two dust puffs behind',
      'running is a claim: something is waiting on YOU. Nothing',
      'else on this floor ever runs, so the claim stays readable',
      'reduced  no trip is animated at all',
    ],
    4,
    function (c, x, gy, f) {
      var over = MOTION.run(f / 4);
      dust(c, x, gy, FH, f / 4);
      strideFoot(c, x, gy, FH, 'needs_input', TR2, over);
      robot(c, x, gy, FH, 'needs_input', TR2, over, { noBeacon: true });
    },
  );

  // ----------------------------------------------------------- spawn/despawn
  y = strip(
    ctx,
    y,
    'spawn · pop-in flash',
    [
      'trigger  an id in this snapshot that was not in the last one',
      'frames   3 · 0.32 s · once. A ring in the state colour,',
      '         under the feet, never over the head',
      'reduced  the figure is simply there, no ring',
    ],
    3,
    function (c, x, gy, f) {
      var u = f / 2;
      spawnBurst(c, x, gy, FH, u, STATE_COLORS.working);
      c.save();
      c.globalAlpha = 0.55 + 0.45 * u;
      robot(c, x, gy, FH * (0.78 + 0.22 * ease(u)), 'working', TR3, MOTION.type(0), {
        noBeacon: true,
      });
      c.restore();
    },
    ROW,
    function (f) {
      return ['0.00 s', '0.16 s', '0.32 s'][f];
    },
  );

  y = strip(
    ctx,
    y,
    'despawn · fold-away',
    [
      'trigger  an id leaves the snapshot. A junior finishing is',
      '         the common one (WP-89)',
      'frames   3 · 0.42 s · once, then the spot is empty',
      'NEVER used for `ended`: an ended session stays on the floor',
      'reduced  the figure is gone on the next frame',
    ],
    3,
    function (c, x, gy, f) {
      var u = f / 2;
      foldAway(c, x, gy, FH, u);
      c.save();
      c.globalAlpha = 1 - u * 0.8;
      robot(
        c,
        x,
        gy,
        FH * (1 - 0.42 * ease(u)),
        'benched',
        TR2,
        { sq: 0.95 - u * 0.32 },
        { noBeacon: true },
      );
      c.restore();
    },
    ROW,
    function (f) {
      return ['0.00 s', '0.21 s', '0.42 s'][f];
    },
  );

  rule(ctx, 30, y + 6, W - 30);
  code(
    ctx,
    'Nothing here animates that is not backed by a real observed event or state. Frames read left to right; the tick under a frame is its place in the cycle.',
    30,
    y + 26,
    11,
    SHEET_MUTED,
  );
}
