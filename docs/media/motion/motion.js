/* DeckHQ motion exploration — shared drawing library for the three mockups.
   Plain script, loaded AFTER ../design/character/lib.js (no ES modules: file://
   blocks module CORS). No assets, no network, no libraries.

   WP-79's exploration library draws the robot in six STILL poses, one per
   state, and those stills are the reduced-motion form. This file is the other
   half: it drives the same `drawB` through a phase, so a frame of an animation
   can be drawn without a second copy of the figure existing anywhere.

   It does that by replacing the global `skelB` with one that merges a pose
   override onto the state's own skeleton. `lib.js` is a classic script, so
   `drawB` resolves `skelB` through the global object and the swap reaches it.

   Everything here is a pure function of (state, phase, seed). No Date.now(),
   no Math.random(): a frame is reproducible, which is the same discipline
   `public/render/rig-pose.js` holds the real rig to (VISUAL-SPEC §3.7). */

/* ------------------------------------------------- pose override on skelB */

var _skelB = skelB;
var _over = null;
var _beaconOff = false;
var _beacon = beacon;

skelB = function (state) {
  var k = _skelB(state);
  if (_over) for (var key in _over) k[key] = _over[key];
  return k;
};
beacon = function (ctx, cx, topY, state, h) {
  if (_beaconOff) return;
  return _beacon(ctx, cx, topY, state, h);
};

/**
 * Draw the robot at (x, y), `h` px crown-to-sole, in `state`, with `over`
 * merged onto that state's skeleton. `opts.noBeacon` suppresses the over-head
 * icon for frames where the strip is showing the body and nothing else.
 */
function robot(ctx, x, y, h, state, tr, over, opts) {
  _over = over || null;
  _beaconOff = Boolean(opts && opts.noBeacon);
  try {
    drawB(ctx, x, y, h, state, tr);
  } finally {
    _over = null;
    _beaconOff = false;
  }
}

/** The skeleton a state resolves to, with `over` merged — for chrome placement. */
function skelOf(state, over) {
  var k = _skelB(state);
  if (over) for (var key in over) k[key] = over[key];
  return k;
}

/** Where the visor's centre is, in the figure's local frame (y up, 1 = h px). */
function visorLocal(state, tr, over) {
  var k = skelOf(state, over);
  var hr = tr.head === 0 ? 0.235 : tr.head === 1 ? 0.26 : 0.21;
  return { x: k.lean * 1.0, y: k.hy - hr * 0.14 - k.hrot * 0.16, r: hr, hy: k.hy, hrot: k.hrot };
}

/* --------------------------------------------------------------- easings */

function ease(u) {
  return -(Math.cos(Math.PI * clamp01(u)) - 1) / 2;
}
function clamp01(u) {
  return u < 0 ? 0 : u > 1 ? 1 : u;
}
function mix(a, b, u) {
  return a + (b - a) * u;
}
/** Triangle wave in [0,1] — a step and its mirror, with no blend at the ends. */
function tri(p) {
  var q = ((p % 1) + 1) % 1;
  return q < 0.5 ? q * 2 : 2 - q * 2;
}

/* ------------------------------------------------------ per-state motion */

/**
 * THE POSE TABLE. One entry per animation in `12-MOTION-AND-CREW.md` §2:
 * given a phase in [0,1), return the skeleton override for that frame.
 * A frame is a pure function of the phase; that is the whole contract.
 */
var MOTION = {
  /** `type` — 4 strokes per 0.9 s cycle, alternating mitts, torso bob. */
  type: function (p) {
    var s = tri(p * 2);
    return {
      lean: 0.12 + s * 0.02,
      by: 0.21 + s * 0.008,
      aR: [0.30 + (p % 0.5 < 0.25 ? 0.02 : -0.01), 0.27 + (p % 0.5 < 0.25 ? -0.025 : 0.015)],
      aL: [-0.29 + (p % 0.5 < 0.25 ? 0.01 : -0.02), 0.28 + (p % 0.5 < 0.25 ? 0.015 : -0.025)],
    };
  },
  /** `think` — head turns, near mitt up to the chin, cloud grows separately. */
  think: function (p) {
    return {
      lean: -0.06,
      hrot: Math.sin(p * Math.PI * 2) * 0.16,
      aR: [0.22, 0.52],
      aL: [-0.28, 0.24],
    };
  },
  /** `hand_raise` — the mitt is already high; the wave is a lateral sweep. */
  wave: function (p) {
    var s = Math.sin(p * Math.PI * 2);
    return { aR: [0.36 + s * 0.055, 1.03 + Math.abs(s) * 0.02], hrot: -0.05 + s * 0.05 };
  },
  /** `stand_wait` with a page — the flip is a one-shot on a long period. */
  page: function (p) {
    return { aR: [0.15, 0.44 + Math.sin(p * Math.PI * 2) * 0.012], lean: -0.03 };
  },
  /** `slump` — barely moves, on purpose. */
  slump: function (p) {
    return { lean: 0.20 + Math.sin(p * Math.PI * 2) * 0.012, by: 0.17 };
  },
  /** Power-down — one-shot: the barrel settles, the dome drops, the visor dies. */
  power: function (p) {
    var u = ease(p);
    return {
      lean: mix(0.20, 0.27, u),
      by: mix(0.17, 0.14, u),
      hy: mix(0.665, 0.595, u),
      hrot: mix(0.46, 0.66, u),
      sq: mix(0.93, 0.87, u),
      aR: [mix(0.26, 0.24, u), mix(0.12, 0.07, u)],
      aL: [mix(-0.25, -0.23, u), mix(0.13, 0.08, u)],
    };
  },
  /** Walk — two frames and no blend: a step and its mirror. */
  walk: function (p) {
    var f = p % 1 < 0.5 ? 0 : 1;
    var d = f ? 1 : -1;
    return {
      lean: 0.04,
      by: 0.235,
      stride: d * 0.16,
      bobUp: f ? 0.012 : 0,
      aR: [0.30 * (f ? 0.72 : 1.18), 0.29],
      aL: [-0.30 * (f ? 1.18 : 0.72), 0.29],
    };
  },
  /** Run — four frames. Deeper lean, a longer stride, both mitts up and in. */
  run: function (p) {
    var f = Math.floor(((p % 1) + 1) * 4) % 4;
    var d = f === 0 ? -1 : f === 1 ? -0.4 : f === 2 ? 1 : 0.4;
    var air = f === 1 || f === 3;
    return {
      lean: 0.19,
      by: 0.235 + (air ? 0.03 : 0),
      hy: 0.775 + (air ? 0.03 : 0),
      hrot: 0.12,
      stride: d * 0.26,
      aR: [0.24 + d * 0.06, 0.44 - d * 0.06],
      aL: [-0.24 + d * 0.06, 0.44 + d * 0.06],
    };
  },
};

/* ---------------------------------------------------------------- chrome */

var CLOUD = 'rgba(253,250,243,0.95)';
var CLOUD_INK = 'rgba(56,47,38,0.45)';

/**
 * The thought cloud, growing with `g` in [0,1]: `g` is how long the model has
 * been between tool calls, not a loop. Three lobes and two trailing dots; the
 * lobes arrive in order, so the cloud has a size a reader can compare.
 */
function thoughtCloud(ctx, x, y, s, g) {
  var n = g < 0.34 ? 1 : g < 0.67 ? 2 : 3;
  ctx.save();
  ctx.lineJoin = 'round';
  var lobes = [
    [0, 0, 0.62],
    [-0.62, 0.16, 0.48],
    [0.60, 0.20, 0.44],
  ];
  var p = new Path2D();
  for (var i = 0; i < n; i++) {
    p.arc(x + lobes[i][0] * s, y - lobes[i][1] * s, lobes[i][2] * s * (0.7 + 0.3 * ease(g)), 0, Math.PI * 2);
  }
  p.arc(x - s * 0.62, y + s * 0.84, s * 0.19, 0, Math.PI * 2);
  p.arc(x - s * 0.86, y + s * 1.22, s * 0.12, 0, Math.PI * 2);
  ctx.fillStyle = CLOUD;
  ctx.fill(p);
  ctx.strokeStyle = CLOUD_INK;
  ctx.lineWidth = Math.max(1, s * 0.055);
  ctx.stroke(p);
  ctx.restore();
}

/** Three dots over a stalled head: one, two, three, then none. */
function stallDots(ctx, x, y, s, p) {
  var lit = Math.floor(((p % 1) + 1) * 4) % 4;
  for (var i = 0; i < 3; i++) {
    var a = i < lit ? 0.8 : 0.16;
    ctx.beginPath();
    ctx.arc(x + (i - 1) * s * 0.9, y, s * 0.26, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(154,123,79,' + a + ')';
    ctx.fill();
  }
}

/** A visor flicker: a brighter pane laid over the rig's own, for one tool call. */
function visorFlash(ctx, x, y, h, state, tr, over, k) {
  var v = visorLocal(state, tr, over);
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(h, -h);
  ctx.translate(v.x, v.hy);
  ctx.rotate(-v.hrot * 0.5);
  var vy = -v.r * 0.14 - v.hrot * 0.16;
  var p = new Path2D();
  p.roundRect(-v.r * 0.8, vy - v.r * 0.4, v.r * 1.6, v.r * 0.8, v.r * 0.32);
  ctx.fillStyle = 'rgba(255,255,255,' + 0.82 * k + ')';
  ctx.fill(p);
  ctx.restore();
}

/**
 * The page a `for_review` figure holds, at flip width `k` in [0,1]: 1 is the
 * page flat to the reader, 0.1 is the page edge-on halfway through the turn.
 * It narrows about its own centre, so the hand keeps hold of the same corner.
 */
function pageFlip(ctx, x, y, h, k) {
  var w = h * 0.34 * Math.max(0.1, k),
    ph = h * 0.22;
  ctx.save();
  ctx.translate(x, y - h * 0.46);
  var p = new Path2D();
  p.roundRect(-w / 2, -ph / 2, w, ph, h * 0.02);
  ctx.fillStyle = k > 0.8 ? '#FBF7EE' : '#EDE6D8';
  ctx.fill(p);
  ctx.strokeStyle = 'rgba(56,47,38,0.6)';
  ctx.lineWidth = 1;
  ctx.stroke(p);
  if (k > 0.55) {
    ctx.beginPath();
    for (var i = 0; i < 3; i++) {
      ctx.moveTo(-w * 0.34, -ph * 0.2 + i * ph * 0.2);
      ctx.lineTo(w * 0.34, -ph * 0.2 + i * ph * 0.2);
    }
    ctx.strokeStyle = 'rgba(56,47,38,0.3)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

/** Spawn: a ring that expands and fades, plus the figure arriving under-scale. */
function spawnBurst(ctx, x, y, h, p, color) {
  var u = ease(p);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y, h * (0.16 + u * 0.42), h * (0.05 + u * 0.13), 0, 0, Math.PI * 2);
  ctx.strokeStyle = alpha(color, 0.75 * (1 - u));
  ctx.lineWidth = Math.max(1.2, h * 0.035 * (1 - u * 0.6));
  ctx.stroke();
  ctx.restore();
}

/** Despawn: the figure folds into its own contact ellipse. */
function foldAway(ctx, x, y, h, p) {
  var u = ease(p);
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(x, y, h * 0.34 * (0.6 + 0.4 * (1 - u)), h * 0.09, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(50,42,32,' + (0.32 * (1 - u) + 0.08) + ')';
  ctx.fill();
  ctx.restore();
}

/** Two dust puffs trailing a running figure, on the floor and behind it. */
function dust(ctx, x, y, h, p) {
  for (var i = 0; i < 2; i++) {
    var u = clamp01(((p + i * 0.5) % 1) * 1.5);
    ctx.beginPath();
    ctx.ellipse(
      x - h * (0.26 + u * 0.36),
      y - h * 0.02,
      h * (0.07 + u * 0.07),
      h * (0.035 + u * 0.03),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = 'rgba(126,114,96,' + 0.34 * (1 - u) + ')';
    ctx.fill();
  }
}

/* --------------------------------------------------------- held props */

/** Where the near mitt is, in page pixels, for a figure drawn at (x, y, h). */
function mittAt(state, over, x, y, h) {
  var k = skelOf(state, over);
  return [x + k.aR[0] * h, y - k.aR[1] * h];
}

/** A cue, held at the mitt and running back over the shoulder. */
function cueProp(ctx, m, h, draw) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(m[0] - h * (0.62 + draw * 0.2), m[1] - h * 0.1);
  ctx.lineTo(m[0] + h * (0.58 - draw * 0.2), m[1] + h * 0.06);
  ctx.strokeStyle = 'rgba(253,250,243,0.85)';
  ctx.lineWidth = h * 0.07;
  ctx.stroke();
  ctx.strokeStyle = '#C0A176';
  ctx.lineWidth = h * 0.045;
  ctx.stroke();
  ctx.restore();
}

/** A bat: a rounded blade on a short handle, at the mitt. */
function paddleProp(ctx, m, h, tilt) {
  ctx.save();
  ctx.translate(m[0], m[1]);
  ctx.rotate(tilt);
  var p = new Path2D();
  p.ellipse(h * 0.2, -h * 0.06, h * 0.14, h * 0.17, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#B5503F';
  ctx.fill(p);
  ctx.strokeStyle = 'rgba(56,47,38,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke(p);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(h * 0.11, -h * 0.04);
  ctx.strokeStyle = '#8D7A5E';
  ctx.lineWidth = h * 0.05;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
}

/** A mug at the mitt. */
function mugProp(ctx, m, h) {
  var w = h * 0.15;
  var p = new Path2D();
  p.roundRect(m[0] - w / 2, m[1] - w * 0.9, w, w * 1.1, w * 0.18);
  ctx.fillStyle = '#FBF7EE';
  ctx.fill(p);
  ctx.strokeStyle = 'rgba(56,47,38,0.6)';
  ctx.lineWidth = 1;
  ctx.stroke(p);
  ctx.beginPath();
  ctx.arc(m[0] + w * 0.62, m[1] - w * 0.35, w * 0.28, -1.2, 1.2);
  ctx.stroke();
}

/** An open book held in both mitts. `k` is how far through a page turn. */
function bookProp(ctx, x, y, h, k) {
  ctx.save();
  ctx.translate(x, y - h * 0.44);
  var w = h * 0.19,
    ph = h * 0.2;
  for (var s = -1; s <= 1; s += 2) {
    var kk = s < 0 ? 1 : Math.max(0.12, 1 - k);
    var p = new Path2D();
    p.roundRect(s < 0 ? -w : 0, -ph / 2, w * kk, ph, h * 0.015);
    ctx.fillStyle = s < 0 ? '#FBF7EE' : '#F0E9DA';
    ctx.fill(p);
    ctx.strokeStyle = 'rgba(56,47,38,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke(p);
  }
  ctx.restore();
}

/** A ball, wherever the rally has got to. */
function ballAt(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#FBF7EE';
  ctx.fill();
  ctx.strokeStyle = 'rgba(56,47,38,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/* --------------------------------------------------------- lounge props */

function poolTable(ctx, x, y, w, hgt) {
  var p = new Path2D();
  p.roundRect(x - w / 2, y - hgt / 2, w, hgt, hgt * 0.12);
  ctx.fillStyle = '#7E8F76';
  ctx.fill(p);
  ctx.strokeStyle = 'rgba(56,47,38,0.4)';
  ctx.lineWidth = 1.2;
  ctx.stroke(p);
  var q = new Path2D();
  q.roundRect(x - w / 2 + 5, y - hgt / 2 + 5, w - 10, hgt - 10, hgt * 0.08);
  ctx.fillStyle = '#8EA085';
  ctx.fill(q);
}

function tennisTable(ctx, x, y, w, hgt) {
  var p = new Path2D();
  p.roundRect(x - w / 2, y - hgt / 2, w, hgt, 3);
  ctx.fillStyle = '#6E8798';
  ctx.fill(p);
  ctx.strokeStyle = 'rgba(56,47,38,0.4)';
  ctx.lineWidth = 1.2;
  ctx.stroke(p);
  ctx.beginPath();
  ctx.moveTo(x, y - hgt / 2);
  ctx.lineTo(x, y + hgt / 2);
  ctx.strokeStyle = 'rgba(251,247,238,0.85)';
  ctx.lineWidth = 2;
  ctx.stroke();
}

function arcadeCab(ctx, x, y, w, hgt, lit) {
  var p = new Path2D();
  p.roundRect(x - w / 2, y - hgt, w, hgt, 4);
  ctx.fillStyle = '#5E5548';
  ctx.fill(p);
  var s = new Path2D();
  s.roundRect(x - w * 0.34, y - hgt * 0.86, w * 0.68, hgt * 0.36, 2);
  ctx.fillStyle = lit ? '#F7F1E1' : '#B7AFA1';
  ctx.fill(s);
}

function counter(ctx, x, y, w, hgt) {
  var p = new Path2D();
  p.roundRect(x - w / 2, y - hgt, w, hgt, 3);
  ctx.fillStyle = '#C9A876';
  ctx.fill(p);
  ctx.strokeStyle = 'rgba(56,47,38,0.35)';
  ctx.lineWidth = 1.2;
  ctx.stroke(p);
  var t = new Path2D();
  t.roundRect(x - w / 2, y - hgt, w, hgt * 0.22, 3);
  ctx.fillStyle = '#D8B98A';
  ctx.fill(t);
}

function machine(ctx, x, y, w, hgt) {
  var p = new Path2D();
  p.roundRect(x - w / 2, y - hgt, w, hgt, 3);
  ctx.fillStyle = '#6E6A63';
  ctx.fill(p);
  ctx.fillStyle = '#F7F1E1';
  ctx.fillRect(x - w * 0.22, y - hgt * 0.84, w * 0.44, hgt * 0.2);
}

function sofa(ctx, x, y, w, hgt) {
  var p = new Path2D();
  p.roundRect(x - w / 2, y - hgt / 2, w, hgt, hgt * 0.3);
  ctx.fillStyle = '#C0B9A8';
  ctx.fill(p);
  ctx.strokeStyle = 'rgba(56,47,38,0.32)';
  ctx.lineWidth = 1.2;
  ctx.stroke(p);
}

/* ------------------------------------------------------ crew: the cables */

/** A laptop seen from the same 45° the robot is: a base plate and a lit lid. */
function laptop(ctx, x, y, s, flip) {
  var d = flip ? -1 : 1;
  ctx.save();
  ctx.translate(x, y);
  var base = new Path2D();
  base.moveTo(-s * 0.62, 0);
  base.lineTo(s * 0.62, 0);
  base.lineTo(s * 0.46, -s * 0.2);
  base.lineTo(-s * 0.46, -s * 0.2);
  base.closePath();
  ctx.fillStyle = '#9B958B';
  ctx.fill(base);
  ctx.strokeStyle = 'rgba(56,47,38,0.55)';
  ctx.lineWidth = Math.max(0.8, s * 0.05);
  ctx.stroke(base);
  var lid = new Path2D();
  lid.moveTo(-s * 0.46 + d * s * 0.04, -s * 0.2);
  lid.lineTo(s * 0.46 + d * s * 0.04, -s * 0.2);
  lid.lineTo(s * 0.5 + d * s * 0.08, -s * 0.78);
  lid.lineTo(-s * 0.42 + d * s * 0.08, -s * 0.78);
  lid.closePath();
  ctx.fillStyle = '#7E786F';
  ctx.fill(lid);
  ctx.stroke(lid);
  var pane = new Path2D();
  pane.moveTo(-s * 0.36 + d * s * 0.05, -s * 0.26);
  pane.lineTo(s * 0.38 + d * s * 0.05, -s * 0.26);
  pane.lineTo(s * 0.41 + d * s * 0.08, -s * 0.7);
  pane.lineTo(-s * 0.33 + d * s * 0.08, -s * 0.7);
  pane.closePath();
  ctx.fillStyle = '#F7F1E1';
  ctx.fill(pane);
  ctx.restore();
}

/** Cumulative arc lengths along a polyline, for pulse placement. */
function arcLengths(pts) {
  var acc = [0];
  for (var i = 1; i < pts.length; i++) {
    acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  }
  return acc;
}

/** The point at arc-length fraction `u` along a polyline. */
function alongPath(pts, u) {
  var acc = arcLengths(pts);
  var total = acc[acc.length - 1];
  var want = clamp01(u) * total;
  for (var i = 1; i < pts.length; i++) {
    if (acc[i] >= want) {
      var t = (want - acc[i - 1]) / Math.max(1e-6, acc[i] - acc[i - 1]);
      return [mix(pts[i - 1][0], pts[i][0], t), mix(pts[i - 1][1], pts[i][1], t)];
    }
  }
  return pts[pts.length - 1];
}

/** Draw a routed cable: straight runs with rounded corners, never a diagonal. */
function cable(ctx, pts, color, w) {
  var r = 7;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  var p = new Path2D();
  p.moveTo(pts[0][0], pts[0][1]);
  for (var i = 1; i < pts.length - 1; i++) {
    var a = pts[i - 1],
      b = pts[i],
      c = pts[i + 1];
    var d1 = Math.hypot(b[0] - a[0], b[1] - a[1]),
      d2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    var rr = Math.min(r, d1 / 2, d2 / 2);
    p.lineTo(b[0] + ((a[0] - b[0]) / d1) * rr, b[1] + ((a[1] - b[1]) / d1) * rr);
    p.quadraticCurveTo(
      b[0],
      b[1],
      b[0] + ((c[0] - b[0]) / d2) * rr,
      b[1] + ((c[1] - b[1]) / d2) * rr,
    );
  }
  p.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  ctx.strokeStyle = 'rgba(253,250,243,0.8)';
  ctx.lineWidth = w + 2.4;
  ctx.stroke(p);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke(p);
  ctx.restore();
}

/** One data pulse travelling junior -> parent. `u` is 0 at the laptop, 1 at the desk. */
function pulse(ctx, pts, u, color, s) {
  var q = alongPath(pts, u);
  var g = ctx.createRadialGradient(q[0], q[1], 0, q[0], q[1], s * 2.6);
  g.addColorStop(0, alpha(color, 0.95));
  g.addColorStop(1, alpha(color, 0));
  ctx.beginPath();
  ctx.arc(q[0], q[1], s * 2.6, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(q[0], q[1], s, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFBF2';
  ctx.fill();
}

/* ------------------------------------------------------------ sheet furniture */

var SHEET_BG = '#EFEAE0';
var SHEET_CARD = '#FBF8F2';
var SHEET_TXT = '#2C2720';
var SHEET_MUTED = '#7A7266';
var SHEET_RULE = 'rgba(60,52,40,0.16)';

function txt(ctx, s, x, y, size, col, weight, align) {
  ctx.font = (weight || 600) + ' ' + size + 'px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = col || SHEET_TXT;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}
function code(ctx, s, x, y, size, col, align) {
  ctx.font = size + 'px Consolas, "JetBrains Mono", monospace';
  ctx.fillStyle = col || SHEET_MUTED;
  ctx.textAlign = align || 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}
function card(ctx, x, y, w, h, fill, r) {
  var p = new Path2D();
  p.roundRect(x, y, w, h, r === undefined ? 7 : r);
  ctx.fillStyle = fill || SHEET_CARD;
  ctx.fill(p);
  ctx.strokeStyle = SHEET_RULE;
  ctx.lineWidth = 1;
  ctx.stroke(p);
}
function rule(ctx, x1, y, x2) {
  ctx.beginPath();
  ctx.moveTo(x1, y);
  ctx.lineTo(x2, y);
  ctx.strokeStyle = SHEET_RULE;
  ctx.lineWidth = 1;
  ctx.stroke();
}
/** A floor tile to stand a frame on, so a strip reads as a place and not a void. */
function tile(ctx, x, y, w, h, fill) {
  var p = new Path2D();
  p.roundRect(x, y, w, h, 4);
  ctx.fillStyle = fill || '#E4E0D4';
  ctx.fill(p);
}

/* ------------------------------------------------------------ the stride */

/**
 * The leading boot of a walk or a run.
 *
 * `drawB` draws a fixed pair of stubby feet under the barrel, which is right
 * for the six seated and standing poses and says nothing at all about a step.
 * The real rig gains a `stride` term on the pose (§2's walking and running
 * rows); here it is an overlay, drawn in the same deep tint under the same
 * rim, so a strip can show a step and its mirror without a second figure
 * existing anywhere.
 */
function strideFoot(ctx, x, y, h, state, tr, over) {
  var k = skelOf(state, over);
  var s = Number(k.stride) || 0;
  if (!s) return;
  var T = tints(state);
  var bw = tr.shape === 0 ? 0.54 : tr.shape === 1 ? 0.6 : 0.47;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(h, -h);
  var p = new Path2D();
  rrot(p, s, k.by * 0.42, bw * 0.36, k.by * 1.15, bw * 0.15, s > 0 ? 0.18 : -0.18);
  ctx.lineJoin = 'round';
  ctx.strokeStyle = RIM;
  ctx.lineWidth = Math.max(0.95 / h, 0.023) * 4.2;
  ctx.stroke(p);
  ctx.fillStyle = T.deep;
  ctx.fill(p);
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(0.95 / h, 0.023);
  ctx.stroke(p);
  ctx.restore();
}
