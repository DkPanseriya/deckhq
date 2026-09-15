/* docs/media/motion/lounge-activities.png — what a benched agent does in the
   lounge, per bay. Illustration only; the periods are §2's. */

var LW = 1320,
  LH = 912;

var CW = 622, // card
  CH = 238,
  CX = 30,
  CY = 92,
  CGAP = 16;

var BENCH = STATE_COLORS.benched;
var TA = traitsFor('a7f2'),
  TB = traitsFor('m3rt'),
  TC = traitsFor('zq04'),
  TD = traitsFor('p81c'),
  TE = traitsFor('vv6n');

var FH = 64;

/** One activity card: a heading, two lines of numbers, then three frames. */
function bay(ctx, col, row, title, meta, ground, fn) {
  var x = CX + col * (CW + CGAP),
    y = CY + row * (CH + CGAP);
  card(ctx, x, y, CW, CH, '#EFF1F3');
  txt(ctx, title, x + 18, y + 25, 14.5, shade(BENCH, -0.34), 700);
  code(ctx, meta[0], x + 18, y + 43, 9.5, SHEET_MUTED);
  code(ctx, meta[1], x + 18, y + 56, 9.5, SHEET_MUTED);
  // the bay's own ground: a pale slab, the way WP-85c gives each bay one
  var g = new Path2D();
  g.roundRect(x + 14, y + 68, CW - 28, CH - 84, 8);
  ctx.fillStyle = ground || '#E4E7E2';
  ctx.fill(g);
  ctx.save();
  ctx.clip(g);
  fn(ctx, x + 14, y + 68, CW - 28, CH - 84);
  ctx.restore();
}

/** Three ticks under a bay's ground. */
function ticks(ctx, x, y, w, labels) {
  var n = labels.length;
  for (var i = 0; i < n; i++) {
    code(ctx, labels[i], x + (w / n) * (i + 0.5), y - 8, 9, 'rgba(80,72,62,0.75)', 'center');
  }
}

function renderLounge(ctx) {
  ctx.fillStyle = SHEET_BG;
  ctx.fillRect(0, 0, LW, LH);

  txt(ctx, 'DeckHQ — the lounge', 30, 40, 22, SHEET_TXT, 700);
  code(
    ctx,
    'WP-87 · what a benched agent does · the activity is a hash of the session id and the bay it is in, never a roll of the dice · illustration',
    30,
    60,
    11.5,
    SHEET_MUTED,
  );
  rule(ctx, 30, 74, LW - 30);

  // ------------------------------------------------------------------ pool
  bay(
    ctx,
    0,
    0,
    'pool · the shot',
    ['frames 3 · period 4.50 s · paired: two agents alternate turns', 'reduced  addressed, cue level, ball still'],
    '#E2E7DF',
    function (c, bx, by, bw, bh) {
      var gy = by + bh - 30;
      poolTable(c, bx + bw * 0.5, gy - 26, bw * 0.56, 54);
      var frames = [0, 0.55, 1];
      for (var i = 0; i < 3; i++) {
        var px = bx + bw * (0.18 + i * 0.32);
        var over = { lean: 0.28 + frames[i] * 0.06, aR: [0.3, 0.2 + frames[i] * 0.05] };
        robot(c, px, gy, FH, 'benched', i === 1 ? TB : TA, over, { noBeacon: true });
        cueProp(c, mittAt('benched', over, px, gy, FH), FH, i === 1 ? 1 : 0.1);
      }
      ballAt(c, bx + bw * 0.62, gy - 30, 4);
      ticks(c, bx, by + bh, bw, ['address', 'draw back', 'strike']);
    },
  );

  // ---------------------------------------------------------- table tennis
  bay(
    ctx,
    1,
    0,
    'table tennis · the rally',
    ['frames 3 · period 1.60 s · PAIRED, antiphase 0.5 — needs a partner', 'reduced  both bats level, ball on the net'],
    '#E1E5E9',
    function (c, bx, by, bw, bh) {
      var gy = by + bh - 30;
      tennisTable(c, bx + bw * 0.5, gy - 22, bw * 0.46, 46);
      var phases = [0, 0.5, 1];
      for (var i = 0; i < 3; i++) {
        var u = phases[i];
        var lx = bx + bw * 0.22,
          rx = bx + bw * 0.78;
        if (i > 0) continue;
        // one frame drawn large, the rally shown as three ball positions
        var oL = { lean: 0.06, aR: [0.32, 0.5] };
        var oR = { lean: 0.06, aR: [0.32, 0.26] };
        robot(c, lx, gy, FH, 'benched', TC, oL, { noBeacon: true });
        paddleProp(c, mittAt('benched', oL, lx, gy, FH), FH, -0.5);
        robot(c, rx, gy, FH, 'benched', TD, oR, { noBeacon: true });
        paddleProp(c, mittAt('benched', oR, rx, gy, FH), FH, 0.4);
        for (var b = 0; b < 3; b++) {
          var t = b / 2;
          ballAt(
            c,
            lx + (rx - lx) * mix(0.18, 0.82, t),
            gy - 44 - Math.sin(t * Math.PI) * 18,
            b === 1 ? 4.5 : 3.2,
          );
        }
        void u;
      }
      ticks(c, bx, by + bh, bw, ['serve', 'over the net', 'return']);
    },
  );

  // ---------------------------------------------------------------- arcade
  bay(
    ctx,
    0,
    1,
    'arcade · the lean',
    ['frames 3 · period 2.20 s · solo · the screen flickers with the lean', 'reduced  upright, both mitts on the controls, screen lit'],
    '#E5E3E8',
    function (c, bx, by, bw, bh) {
      var gy = by + bh - 30;
      for (var i = 0; i < 3; i++) {
        var px = bx + bw * (0.18 + i * 0.32);
        arcadeCab(c, px - 22, gy - 6, 44, 76, i !== 1);
        var lean = [-0.06, 0.04, 0.14][i];
        robot(c, px + 14, gy, FH, 'benched', TE, { lean: lean, aR: [0.1, 0.44], recline: 0 }, {
          noBeacon: true,
        });
      }
      ticks(c, bx, by + bh, bw, ['lean left', 'square', 'lean right']);
    },
  );

  // ---------------------------------------------------------------- coffee
  bay(
    ctx,
    1,
    1,
    'coffee · the café bay',
    ['frames 3 · 6.00 s · ONE-SHOT, then the agent sits with the mug', 'reduced  seated, mug held, no trip'],
    '#E7E4DC',
    function (c, bx, by, bw, bh) {
      var gy = by + bh - 30;
      counter(c, bx + bw * 0.5, gy - 2, bw * 0.72, 30);
      machine(c, bx + bw * 0.24, gy - 30, 30, 44);
      for (var i = 0; i < 3; i++) {
        var px = bx + bw * (0.18 + i * 0.32);
        var over = [
          { lean: 0.1, aR: [0.32, 0.56] },
          { lean: 0.02, aR: [0.28, 0.3] },
          { lean: -0.04, aR: [0.26, 0.6] },
        ][i];
        robot(c, px, gy, FH, 'benched', TA, over, { noBeacon: true });
        if (i > 0) mugProp(c, mittAt('benched', over, px, gy, FH), FH);
      }
      ticks(c, bx, by + bh, bw, ['press', 'wait 1.5 s', 'take the mug']);
    },
  );

  // --------------------------------------------------------------- reading
  bay(
    ctx,
    0,
    2,
    'reading · the quiet corner',
    ['frames 3 · page turn 0.60 s every 20 s · the calmest thing here', 'reduced  seated, book open, never turned'],
    '#E6E8E3',
    function (c, bx, by, bw, bh) {
      var gy = by + bh - 26;
      sofa(c, bx + bw * 0.5, gy - 8, bw * 0.74, 34);
      for (var i = 0; i < 3; i++) {
        var px = bx + bw * (0.18 + i * 0.32);
        robot(c, px, gy, FH, 'benched', [TB, TC, TB][i], { lean: -0.2, aR: [0.22, 0.46] }, {
          noBeacon: true,
        });
        bookProp(c, px + 4, gy, FH, [0, 0.6, 0][i]);
      }
      ticks(c, bx, by + bh, bw, ['open', 'turning', 'open']);
    },
  );

  // ------------------------------------------------------------- the rule
  var x = CX + 1 * (CW + CGAP),
    y = CY + 2 * (CH + CGAP);
  card(ctx, x, y, CW, CH, '#F6F3EC');
  txt(ctx, 'how an activity is chosen', x + 18, y + 25, 14.5, SHEET_TXT, 700);
  var lines = [
    'activity  BAY_ACTIVITIES[bay][ hash(sessionId) % n ]',
    'cycle     held 45-90 s, then a walk to another bay. The hold is',
    '          hash(sessionId, cycleIndex) — never Math.random — so two',
    '          tabs open on one floor show the same lounge.',
    'paired    table tennis and the board game need a partner in the same',
    '          bay. None free -> that bay’s solo activity, and nobody',
    '          ever stands there doing nothing.',
    'hidden    the rotation stops when the tab is hidden, and resumes',
    '          from the clock rather than from where it paused.',
    'reduced   one frame per agent, chosen by the same hash. A still',
    '          lounge still says who is benched, and with whom.',
    'honesty   none of this is a claim about the session. A benched agent',
    '          is doing nothing, and the lounge says so in the one',
    '          register that makes a cleared queue read as a reward.',
  ];
  var ly = y + 48;
  for (var i = 0; i < lines.length; i++) {
    code(ctx, lines[i], x + 18, ly, 9.5, SHEET_MUTED);
    ly += 12.6;
  }

  rule(ctx, 30, LH - 40, LW - 30);
  code(
    ctx,
    'The lounge is the one place on this floor where motion is decoration. It is allowed there because nothing in it is waiting on anybody.',
    30,
    LH - 22,
    11,
    SHEET_MUTED,
  );
}
