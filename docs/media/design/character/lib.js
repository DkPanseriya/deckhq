/* DeckHQ character exploration — shared drawing library.
   Plain script (no ES modules: file:// blocks module CORS). No assets, no network.
   Every character is a pure function of (state, seed). All sheets render the
   REDUCED-MOTION form: static poses, static rings. That is the legibility floor.

   Legibility model, applied to all four candidates:
     - the STATE COLOUR owns the whole body mass, including the head shell
       (a light tint of it) and the face glass (a dark tint of it), so a
       character is one coherent hue at 24 px rather than a grey blob with a
       coloured waistcoat;
     - a light rim halo separates the silhouette from carpet, wood and tile;
     - identity rides on accent, silhouette, crown and chest glyph only —
       never on the torso, never on the over-head slot (VISUAL-SPEC §3). */

// ---------------------------------------------------------------- constants

var STATES = ['working', 'needs_input', 'stalled', 'for_review', 'ended', 'benched'];
var STATE_LABEL = {
  working: 'working', needs_input: 'needs input', stalled: 'stalled',
  for_review: 'for review', ended: 'ended', benched: 'benched',
};
var STATE_COLORS = {
  working: '#2E7D63', needs_input: '#B87333', stalled: '#9A7B4F',
  for_review: '#C0392B', ended: '#6E6A63', benched: '#7B8794',
};
// project identity accents, from public/render/palette-identity.js
var ACCENTS = ['#B5BF40', '#8EBF40', '#68BF40', '#41BF40', '#40BF65', '#40BF8B',
  '#40BFB1', '#40A7BF', '#4080BF', '#405ABF', '#4C40BF', '#7240BF', '#9940BF', '#BF40BF'];
var GLYPHS = ['hex', 'triangle', 'square', 'diamond', 'drop', 'star', 'cross', 'ring'];

var INK = '#382F26';
var RIM = 'rgba(255,255,255,0.96)';
var MARK = '#FFF6E6';   // a mark on dark glass
var PANE = '#F7F1E1';   // a lit screen: bright pane, dark mark — the best small-size read
var OFFCOL = '#9A938A'; // an unlit lamp / a dead screen

// ------------------------------------------------------------------ helpers

function hash32(s) {
  var h = 2166136261 >>> 0;
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
function rngFrom(seed) {
  var s = (seed >>> 0) || 1;
  return function () {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}
function hex2rgb(h) {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function shade(h, f) {
  var c = hex2rgb(h), t = f > 0 ? 255 : 0, a = Math.abs(f);
  return 'rgb(' + c.map(function (v) { return Math.round(v + (t - v) * a); }).join(',') + ')';
}
function alpha(h, a) { var c = hex2rgb(h); return 'rgba(' + c.join(',') + ',' + a + ')'; }

/** Deterministic identity from a session id. Nothing persisted, nothing earned. */
function traitsFor(seedStr) {
  var r = rngFrom(hash32(String(seedStr)));
  var u = r();
  return {
    seed: seedStr,
    accent: ACCENTS[Math.floor(r() * ACCENTS.length)],
    accent2: ACCENTS[Math.floor(r() * ACCENTS.length)],
    glyph: GLYPHS[Math.floor(r() * GLYPHS.length)],
    shape: Math.floor(r() * 3),   // body silhouette
    head: Math.floor(r() * 3),    // head silhouette
    acc: Math.floor(r() * 5),     // crown accessory
    eye: Math.floor(r() * 3),     // eye/visor shape
    rarity: u < 0.736 ? 'common' : u < 0.939 ? 'uncommon' : u < 0.992 ? 'rare' : 'legendary',
  };
}

// ---- path helpers (all take a Path2D; drawn under a y-up CTM) --------------

function rrot(p, cx, cy, w, h, r, ang) {
  var q = new Path2D();
  q.roundRect(-w / 2, -h / 2, w, h, r);
  p.addPath(q, new DOMMatrix().translateSelf(cx, cy).rotateSelf(ang * 180 / Math.PI));
}
function cap(p, a, b, w) {
  var dx = b[0] - a[0], dy = b[1] - a[1], an = Math.atan2(dy, dx);
  p.arc(a[0], a[1], w / 2, an + Math.PI / 2, an - Math.PI / 2);
  p.arc(b[0], b[1], w / 2, an - Math.PI / 2, an + Math.PI / 2);
  p.closePath();
}
function ell(p, cx, cy, rx, ry, rot) { p.ellipse(cx, cy, rx, ry, rot || 0, 0, Math.PI * 2); }
function circ(p, cx, cy, r) { p.arc(cx, cy, r, 0, Math.PI * 2); }
function rot2(x, y, a) { var c = Math.cos(a), s = Math.sin(a); return [x * c - y * s, x * s + y * c]; }

function glyphPath(p, kind, cx, cy, r) {
  var i, a, X, Y;
  switch (kind) {
    case 'hex':
      for (i = 0; i < 6; i++) { a = Math.PI / 6 + i * Math.PI / 3; X = cx + Math.cos(a) * r; Y = cy + Math.sin(a) * r; i ? p.lineTo(X, Y) : p.moveTo(X, Y); }
      p.closePath(); break;
    case 'triangle':
      p.moveTo(cx, cy + r); p.lineTo(cx + r * 0.87, cy - r * 0.5); p.lineTo(cx - r * 0.87, cy - r * 0.5); p.closePath(); break;
    case 'square': p.rect(cx - r * 0.78, cy - r * 0.78, r * 1.56, r * 1.56); break;
    case 'diamond': p.moveTo(cx, cy + r); p.lineTo(cx + r, cy); p.lineTo(cx, cy - r); p.lineTo(cx - r, cy); p.closePath(); break;
    case 'drop': p.moveTo(cx, cy + r); p.quadraticCurveTo(cx + r, cy, cx, cy - r); p.quadraticCurveTo(cx - r, cy, cx, cy + r); break;
    case 'star':
      for (i = 0; i < 10; i++) { a = -Math.PI / 2 + i * Math.PI / 5; var rr = i % 2 ? r * 0.44 : r; X = cx + Math.cos(a) * rr; Y = cy + Math.sin(a) * rr; i ? p.lineTo(X, Y) : p.moveTo(X, Y); }
      p.closePath(); break;
    case 'cross': p.rect(cx - r * 0.3, cy - r, r * 0.6, r * 2); p.rect(cx - r, cy - r * 0.3, r * 2, r * 0.6); break;
    case 'ring': p.arc(cx, cy, r, 0, Math.PI * 2); p.arc(cx, cy, r * 0.48, Math.PI * 2, 0, true); break;
  }
}

/** The mark on a screen / visor. `tiny` is the sub-30 px fallback: one bold form. */
function drawStateMark(ctx, state, cx, cy, r, color, lw, tiny) {
  ctx.save();
  ctx.fillStyle = color; ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(lw * 1.5, r * 0.36); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  var p = new Path2D();
  switch (state) {
    case 'working':
      if (tiny) { p.rect(cx - r * 0.85, cy - r * 0.22, r * 1.7, r * 0.44); ctx.fill(p); }
      else {
        p.rect(cx - r * 0.95, cy + r * 0.34, r * 1.10, r * 0.32);
        p.rect(cx - r * 0.95, cy - r * 0.16, r * 1.90, r * 0.32);
        p.rect(cx - r * 0.95, cy - r * 0.66, r * 0.80, r * 0.32);
        ctx.fill(p);
      }
      break;
    case 'needs_input':
      p.roundRect(cx - r * 0.26, cy - r * 0.04, r * 0.52, r * 1.02, r * 0.2);
      p.roundRect(cx - r * 0.26, cy - r * 0.78, r * 0.52, r * 0.42, r * 0.2);
      ctx.fill(p); break;
    case 'stalled':
      p.moveTo(cx - r * 0.72, cy + r * 0.80); p.lineTo(cx + r * 0.72, cy + r * 0.80);
      p.lineTo(cx - r * 0.72, cy - r * 0.80); p.lineTo(cx + r * 0.72, cy - r * 0.80); p.closePath();
      ctx.fill(p);
      if (!tiny) {
        var q = new Path2D();
        q.roundRect(cx - r * 0.95, cy + r * 0.80, r * 1.9, r * 0.28, r * 0.14);
        q.roundRect(cx - r * 0.95, cy - r * 1.08, r * 1.9, r * 0.28, r * 0.14);
        ctx.fill(q);
      }
      break;
    case 'for_review':
      p.moveTo(cx - r * 0.78, cy + r * 0.06); p.lineTo(cx - r * 0.18, cy - r * 0.58); p.lineTo(cx + r * 0.84, cy + r * 0.72);
      ctx.stroke(p); break;
    case 'ended':
      p.roundRect(cx - r * 0.85, cy - r * 0.18, r * 1.7, r * 0.36, r * 0.18); ctx.fill(p); break;
    case 'benched':
      if (tiny) { p.roundRect(cx - r * 0.75, cy - r * 0.18, r * 1.5, r * 0.36, r * 0.18); ctx.fill(p); }
      else {
        p.moveTo(cx - r * 0.66, cy + r * 0.62); p.lineTo(cx + r * 0.54, cy + r * 0.62);
        p.lineTo(cx - r * 0.66, cy - r * 0.58); p.lineTo(cx + r * 0.54, cy - r * 0.58);
        ctx.stroke(p);
      }
      break;
  }
  ctx.restore();
}

/** Contact shadow on the floor plane — the only part that touches the plan. */
function contactShadow(ctx, rx, ry, ox) {
  var p = new Path2D(); ell(p, ox || 0, ry * 0.75, rx, ry);
  ctx.fillStyle = 'rgba(50,42,32,0.32)'; ctx.fill(p);
}

/**
 * The over-head badge. Screen-space clamped (never under 10 px across,
 * VISUAL-SPEC §1.1) and drawn last of all, so no furniture can hide it.
 */
function beacon(ctx, cx, topY, state, h) {
  if (state === 'working' || state === 'ended' || state === 'benched') return;
  var col = STATE_COLORS[state];
  var r = Math.max(5.4 / h, 0.155);
  var cy = topY + r * 1.45;
  var lw = Math.max(0.9 / h, 0.022);
  if (state === 'needs_input') {                       // static form of the pulse
    var ring = new Path2D(); circ(ring, cx, cy, r * 1.66);
    ctx.strokeStyle = alpha(col, 0.5); ctx.lineWidth = lw * 2.4; ctx.stroke(ring);
  }
  var p = new Path2D(); circ(p, cx, cy, r);
  ctx.strokeStyle = RIM; ctx.lineWidth = lw * 3.6; ctx.stroke(p);
  ctx.fillStyle = col; ctx.fill(p);
  ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.stroke(p);
  if (state === 'needs_input') {                       // a hand, not a bang
    var hd = new Path2D();
    hd.roundRect(cx - r * 0.36, cy - r * 0.56, r * 0.72, r * 0.88, r * 0.26);
    hd.roundRect(cx - r * 0.36, cy + r * 0.08, r * 0.21, r * 0.52, r * 0.1);
    hd.roundRect(cx - r * 0.10, cy + r * 0.08, r * 0.21, r * 0.60, r * 0.1);
    hd.roundRect(cx + r * 0.16, cy + r * 0.08, r * 0.21, r * 0.48, r * 0.1);
    ctx.fillStyle = MARK; ctx.fill(hd);
  } else {
    drawStateMark(ctx, state, cx, cy, r * 0.70, MARK, lw, h < 34);
  }
}

// ---- rig plumbing: one light halo pass, then back-to-front fills -----------

function Rig(ctx, h) {
  this.ctx = ctx; this.h = h;
  this.lw = Math.max(0.95 / h, 0.023);
  this.parts = [];
}
Rig.prototype.add = function (fill, o) {
  var p = new Path2D();
  this.parts.push({ p: p, fill: fill, ink: !o || o.ink !== false, halo: !o || o.halo !== false, a: (o && o.a) || 1 });
  return p;
};
Rig.prototype.flush = function () {
  var c = this.ctx, i, q;
  c.lineJoin = 'round'; c.lineCap = 'round';
  c.strokeStyle = RIM; c.lineWidth = this.lw * 4.2;
  for (i = 0; i < this.parts.length; i++) { q = this.parts[i]; if (q.halo) c.stroke(q.p); }
  for (i = 0; i < this.parts.length; i++) {
    q = this.parts[i];
    c.globalAlpha = q.a; c.fillStyle = q.fill; c.fill(q.p);
    if (q.ink) { c.strokeStyle = INK; c.lineWidth = this.lw; c.stroke(q.p); }
    c.globalAlpha = 1;
  }
  this.parts.length = 0;
};

/** Enter a character's local frame: origin at ground contact, y up, 1 unit = h px. */
function inFrame(ctx, x, y, h, fn) {
  ctx.save(); ctx.translate(x, y); ctx.scale(h, -h);
  fn();
  ctx.restore();
}

/** The four tints every candidate derives from the state colour. */
function tints(state) {
  var col = STATE_COLORS[state];
  return {
    col: col,
    shell: shade(col, 0.58),      // head / chassis: light, but still the state hue
    lite: shade(col, 0.24),
    dark: shade(col, -0.20),
    deep: shade(col, -0.34),
    glass: shade(col, -0.60),     // screen / visor: dark, still the state hue
    dead: state === 'ended',
  };
}

// ===========================================================================
// A — SIDE-VIEW ROBOT. A standee: pure profile, facing +x.
// Mixed projection is handled by declaring it. The sprite never rotates with
// the body angle, it is always drawn last, and a hard contact ellipse is the
// only thing that sits in the floor's own plane.
// ===========================================================================

function skelA(state) {
  switch (state) {
    case 'working': return {
      hip: [-0.06, 0.30], knee: [0.18, 0.32], foot: [0.20, 0.045],
      sh: [0.05, 0.66], elb: [0.22, 0.52], hand: [0.38, 0.44],
      elbB: [0.18, 0.50], handB: [0.34, 0.415], head: [0.13, 0.87], rot: 0.16,
    };
    case 'needs_input': return {
      hip: [-0.05, 0.30], knee: [0.18, 0.32], foot: [0.20, 0.045],
      sh: [0.02, 0.68], elb: [0.08, 0.84], hand: [0.11, 1.01],
      elbB: [0.14, 0.52], handB: [0.28, 0.44], head: [0.045, 0.89], rot: -0.08,
    };
    case 'stalled': return {
      hip: [-0.03, 0.28], knee: [0.19, 0.30], foot: [0.21, 0.04],
      sh: [0.06, 0.60], elb: [0.16, 0.43], hand: [0.20, 0.26],
      elbB: [0.11, 0.42], handB: [0.15, 0.25], head: [0.18, 0.79], rot: 0.50,
    };
    case 'for_review': return {
      stand: 1, hip: [0, 0.39], knee: [0.02, 0.20], foot: [0.03, 0.038],
      sh: [0.01, 0.74], elb: [0.16, 0.63], hand: [0.31, 0.60],
      elbB: [0.13, 0.62], handB: [0.27, 0.585], head: [0.04, 0.94], rot: -0.05, card: 1,
    };
    case 'ended': return {
      hip: [-0.02, 0.26], knee: [0.17, 0.28], foot: [0.19, 0.035],
      sh: [0.08, 0.53], elb: [0.18, 0.38], hand: [0.24, 0.23],
      elbB: [0.13, 0.37], handB: [0.19, 0.22], head: [0.23, 0.69], rot: 0.80,
    };
    case 'benched': return {
      recline: 1, hip: [-0.09, 0.25], knee: [0.22, 0.28], foot: [0.42, 0.13],
      sh: [-0.17, 0.53], elb: [-0.32, 0.67], hand: [-0.16, 0.77],
      elbB: [0.01, 0.44], handB: [0.19, 0.38], head: [-0.11, 0.78], rot: -0.35,
    };
  }
}

function drawA(ctx, x, y, h, state, tr) {
  inFrame(ctx, x, y, h, function () {
    var k = skelA(state), T = tints(state), rig = new Rig(ctx, h), tiny = h < 34;
    contactShadow(ctx, 0.31, 0.078, 0.10);

    // far leg + far arm, desaturated: the only depth cue a profile gets
    var far = rig.add(T.deep, { ink: false, halo: false });
    cap(far, [k.hip[0] - 0.03, k.hip[1]], [k.knee[0] - 0.04, k.knee[1] - 0.02], 0.12);
    cap(far, [k.knee[0] - 0.04, k.knee[1] - 0.02], [k.foot[0] - 0.05, k.foot[1]], 0.11);
    cap(far, k.sh, k.elbB, 0.11); cap(far, k.elbB, k.handB, 0.10);

    // near leg + foot
    var leg = rig.add(T.dark);
    cap(leg, k.hip, k.knee, 0.13); cap(leg, k.knee, k.foot, 0.12);
    var foot = rig.add(T.deep);
    rrot(foot, k.foot[0] + 0.04, k.foot[1] + 0.005, 0.21, 0.08, 0.036, 0);

    // torso — a chassis box slung between hip and shoulder
    var ang = Math.atan2(k.sh[1] - k.hip[1], k.sh[0] - k.hip[0]) - Math.PI / 2;
    var tcx = (k.hip[0] + k.sh[0]) / 2, tcy = (k.hip[1] + k.sh[1]) / 2;
    var tlen = Math.hypot(k.sh[0] - k.hip[0], k.sh[1] - k.hip[1]) + 0.11;
    var tw = tr.shape === 0 ? 0.39 : tr.shape === 1 ? 0.45 : 0.34;
    var torso = rig.add(T.col);
    rrot(torso, tcx, tcy, tw, tlen, tw * 0.30, ang);
    var off = rot2(tw * 0.28, tlen * 0.08, ang);
    var plate = rig.add(tr.accent, { halo: false });
    rrot(plate, tcx + off[0], tcy + off[1], tw * 0.44, tlen * 0.42, tw * 0.13, ang);
    if (!tiny) {
      var g = rig.add(shade(tr.accent, -0.58), { ink: false, halo: false });
      glyphPath(g, tr.glyph, tcx + off[0], tcy + off[1], tw * 0.15);
    }

    // near arm + hand
    var arm = rig.add(T.lite);
    cap(arm, k.sh, k.elb, 0.11); cap(arm, k.elb, k.hand, 0.095);
    var hnd = rig.add(T.shell); circ(hnd, k.hand[0], k.hand[1], 0.066);
    if (k.card) { var cd = rig.add('#FBF7EE'); rrot(cd, k.hand[0] + 0.10, k.hand[1] + 0.02, 0.22, 0.16, 0.025, -0.2); }

    // neck + head
    var neck = rig.add(T.dark, { halo: false });
    cap(neck, k.sh, [k.head[0], k.head[1] - 0.11], 0.09);
    // head: the full state colour, so the whole character is one colour mass
    var hw = tr.head === 0 ? 0.48 : tr.head === 1 ? 0.53 : 0.43;
    var hh = tr.head === 2 ? 0.38 : 0.34;
    var head = rig.add(T.col);
    rrot(head, k.head[0], k.head[1], hw, hh, hw * (tr.head === 1 ? 0.32 : 0.15), -k.rot);
    rig.flush();

    // screen face: a BRIGHT pane with a dark mark. A lit screen on a coloured
    // head survives 24 px; a dark screen with a light mark does not.
    ctx.save();
    ctx.translate(k.head[0], k.head[1]); ctx.rotate(-k.rot);
    var sw = hw * 0.60, sh = hh * 0.58;
    var scx = hw * 0.10, scy = -hh * 0.02;
    var sp = new Path2D(); sp.roundRect(scx - sw / 2, scy - sh / 2, sw, sh, sh * 0.24);
    ctx.fillStyle = T.dead ? '#CFC9BD' : PANE; ctx.fill(sp);
    ctx.strokeStyle = INK; ctx.lineWidth = rig.lw * 0.9; ctx.stroke(sp);
    drawStateMark(ctx, state, scx, scy, sh * 0.40, T.dead ? OFFCOL : T.glass, rig.lw, tiny);
    ctx.restore();

    // antenna + crown accessory
    var top = k.head[1] + hh * 0.5;
    var r2 = new Rig(ctx, h);
    var ax = k.head[0] - 0.07, ay = top - 0.01;
    var droop = T.dead || state === 'stalled';
    var bx = ax + (droop ? 0.08 : 0.015), by = ay + (droop ? 0.055 : 0.11);
    var ant = r2.add(T.shell);
    cap(ant, [ax, ay], [bx, by], 0.038);
    var bulb = r2.add(T.dead ? OFFCOL : tr.accent);
    if (tr.acc === 0) circ(bulb, bx, by, 0.055);
    else if (tr.acc === 1) rrot(bulb, bx + 0.04, by, 0.14, 0.08, 0.022, 0.1);
    else if (tr.acc === 2) { circ(bulb, bx - 0.05, by, 0.042); circ(bulb, bx + 0.05, by, 0.042); }
    else if (tr.acc === 3) rrot(bulb, bx, by, 0.08, 0.08, 0.014, 0.78);
    else ell(bulb, bx, by, 0.08, 0.045, 0);
    r2.flush();
    if (tr.rarity === 'legendary') {
      var au = new Path2D(); circ(au, k.head[0], k.head[1] + 0.02, hw * 0.90);
      ctx.strokeStyle = alpha(tr.accent, 0.5); ctx.lineWidth = rig.lw * 2.4; ctx.stroke(au);
    }
    beacon(ctx, k.head[0], by + 0.06, state, h);
  });
}

// ===========================================================================
// B — 45° THREE-QUARTER ROBOT. Chunky barrel, dome head, wrap visor, halo.
// The 3/4 read is the cheat every top-down RPG already uses: floor near-plan,
// actor tilted toward the camera. Top-plane ellipses sell the tilt.
// ===========================================================================

function skelB(state) {
  switch (state) {
    case 'working': return { lean: 0.12, by: 0.21, hy: 0.755, hrot: 0.18, aR: [0.30, 0.27], aL: [-0.29, 0.28], sq: 1 };
    case 'needs_input': return { lean: -0.02, by: 0.22, hy: 0.775, hrot: -0.05, aR: [0.27, 0.97], aL: [-0.30, 0.26], sq: 1 };
    case 'stalled': return { lean: 0.20, by: 0.17, hy: 0.665, hrot: 0.46, aR: [0.26, 0.12], aL: [-0.25, 0.13], sq: 0.93 };
    case 'for_review': return { lean: -0.03, by: 0.27, hy: 0.855, hrot: -0.04, aR: [0.15, 0.44], aL: [-0.15, 0.44], sq: 1, stand: 1, card: 1 };
    case 'ended': return { lean: 0.27, by: 0.14, hy: 0.595, hrot: 0.66, aR: [0.24, 0.07], aL: [-0.23, 0.08], sq: 0.87 };
    case 'benched': return { lean: -0.26, by: 0.18, hy: 0.665, hrot: -0.30, aR: [0.40, 0.40], aL: [-0.34, 0.56], sq: 1, recline: 1 };
  }
}

function drawB(ctx, x, y, h, state, tr) {
  inFrame(ctx, x, y, h, function () {
    var k = skelB(state), T = tints(state), rig = new Rig(ctx, h), tiny = h < 34;
    contactShadow(ctx, 0.35, 0.098, 0.05);

    var bw = tr.shape === 0 ? 0.54 : tr.shape === 1 ? 0.60 : 0.47;
    var bh = 0.44 * k.sq;
    var bx = k.lean * 0.35, by = k.by + bh / 2;

    // base: two stubby feet, or a tread skirt
    var base = rig.add(T.deep);
    if (tr.shape === 2) rrot(base, 0, k.by * 0.60, bw * 0.90, k.by * 1.35, k.by * 0.5, 0);
    else {
      rrot(base, -bw * 0.22, k.by * 0.55, bw * 0.34, k.by * 1.3, bw * 0.14, k.recline ? -0.55 : 0);
      rrot(base, bw * 0.24, k.by * 0.55 + (k.recline ? 0.03 : 0), bw * 0.34, k.by * 1.3, bw * 0.14, k.recline ? -0.65 : 0);
    }
    // far arm
    var far = rig.add(T.deep, { ink: false, halo: false });
    cap(far, [bx - bw * 0.40, by + bh * 0.20], [k.aL[0], k.aL[1]], 0.12);

    // barrel body, its lit top plane, and the identity collar
    var body = rig.add(T.col);
    rrot(body, bx, by, bw, bh, bw * 0.28, k.lean * 0.5);
    var topc = rig.add(T.lite, { halo: false, ink: false });
    ell(topc, bx + k.lean * 0.12, by + bh * 0.38, bw * 0.44, bh * 0.15, 0);
    var coll = rig.add(tr.accent, { halo: false });
    ell(coll, bx + k.lean * 0.18, by + bh * 0.44, bw * 0.30, bh * 0.10, 0);
    var pl = rig.add(T.dark, { halo: false });
    rrot(pl, bx, by - bh * 0.10, bw * 0.52, bh * 0.42, bw * 0.11, k.lean * 0.5);
    if (!tiny) { var g = rig.add(tr.accent, { ink: false, halo: false }); glyphPath(g, tr.glyph, bx, by - bh * 0.10, bw * 0.15); }

    // near arm + mitt
    var arm = rig.add(T.lite);
    cap(arm, [bx + bw * 0.40, by + bh * 0.20], [k.aR[0], k.aR[1]], 0.13);
    var mitt = rig.add(T.shell); circ(mitt, k.aR[0], k.aR[1], 0.075);
    if (k.card) { var cd = rig.add('#FBF7EE'); rrot(cd, 0, k.aR[1] + 0.02, 0.32, 0.20, 0.03, 0); }

    // head dome + ear cups (identity-coloured)
    var hx = k.lean * 1.0, hy = k.hy;
    var hr = tr.head === 0 ? 0.235 : tr.head === 1 ? 0.26 : 0.21;
    var ears = rig.add(T.deep);
    circ(ears, hx - hr * 1.04, hy - hr * 0.14, hr * 0.34);
    circ(ears, hx + hr * 1.04, hy - hr * 0.14, hr * 0.34);
    var earc = rig.add(tr.accent, { halo: false, ink: false });
    circ(earc, hx - hr * 1.04, hy - hr * 0.14, hr * 0.15);
    circ(earc, hx + hr * 1.04, hy - hr * 0.14, hr * 0.15);
    var head = rig.add(T.col);
    ell(head, hx, hy, hr * 1.06, hr * (tr.head === 2 ? 1.14 : 0.98), 0);
    rig.flush();

    // lit top plane of the dome, then a bright wide visor
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(-k.hrot * 0.5);
    var hl = new Path2D(); ell(hl, 0, hr * 0.52, hr * 0.62, hr * 0.22, 0);
    ctx.fillStyle = T.lite; ctx.fill(hl);
    var vy = -hr * 0.14 - k.hrot * 0.16;
    var vp = new Path2D();
    vp.roundRect(-hr * 0.80, vy - hr * 0.40, hr * 1.60, hr * 0.80, hr * 0.32);
    ctx.fillStyle = T.dead ? '#CFC9BD' : PANE; ctx.fill(vp);
    ctx.strokeStyle = INK; ctx.lineWidth = rig.lw * 0.9; ctx.stroke(vp);
    drawStateMark(ctx, state, 0, vy, hr * 0.34, T.dead ? OFFCOL : T.glass, rig.lw, tiny);
    ctx.restore();

    // crown accessory, then the un-occludable badge
    var r2 = new Rig(ctx, h);
    var ac = r2.add(tr.accent);
    if (tr.acc === 0) { cap(ac, [hx, hy + hr * 0.92], [hx + 0.02, hy + hr * 1.55], 0.034); circ(ac, hx + 0.02, hy + hr * 1.62, 0.05); }
    else if (tr.acc === 1) rrot(ac, hx, hy + hr * 1.06, hr * 1.5, hr * 0.30, hr * 0.14, 0);
    else if (tr.acc === 2) { ell(ac, hx - hr * 0.52, hy + hr * 1.02, hr * 0.28, hr * 0.5, -0.4); ell(ac, hx + hr * 0.52, hy + hr * 1.02, hr * 0.28, hr * 0.5, 0.4); }
    else if (tr.acc === 3) rrot(ac, hx, hy + hr * 1.14, hr * 0.92, hr * 0.46, hr * 0.10, 0.15);
    else circ(ac, hx, hy + hr * 1.24, hr * 0.30);
    r2.flush();
    if (tr.rarity === 'legendary') {
      var au = new Path2D(); ell(au, hx, hy + hr * 1.52, hr * 1.25, hr * 0.36, 0);
      ctx.strokeStyle = alpha(tr.accent, 0.65); ctx.lineWidth = rig.lw * 2.2; ctx.stroke(au);
    }
    beacon(ctx, hx, hy + hr * 1.72, state, h);
  });
}

// ===========================================================================
// C — 45° CREW FIGURE. Helmet + visor, hoodie in the state colour.
// ===========================================================================

function skelC(state) {
  switch (state) {
    case 'working': return { hip: 0.30, lean: 0.11, hy: 0.845, hrot: 0.20, aR: [0.30, 0.19], aL: [-0.28, 0.20], sq: 1 };
    case 'needs_input': return { hip: 0.31, lean: -0.02, hy: 0.865, hrot: -0.05, aR: [0.245, 1.01], aL: [-0.29, 0.21], sq: 1 };
    case 'stalled': return { hip: 0.27, lean: 0.20, hy: 0.745, hrot: 0.48, aR: [0.26, 0.09], aL: [-0.25, 0.10], sq: 0.92 };
    case 'for_review': return { hip: 0.40, lean: -0.03, hy: 0.945, hrot: -0.04, aR: [0.16, 0.47], aL: [-0.16, 0.47], stand: 1, card: 1, sq: 1 };
    case 'ended': return { hip: 0.25, lean: 0.27, hy: 0.675, hrot: 0.66, aR: [0.24, 0.05], aL: [-0.23, 0.06], sq: 0.87 };
    case 'benched': return { hip: 0.27, lean: -0.27, hy: 0.745, hrot: -0.32, aR: [0.42, 0.40], aL: [-0.36, 0.60], recline: 1, sq: 1 };
  }
}

function drawC(ctx, x, y, h, state, tr) {
  inFrame(ctx, x, y, h, function () {
    var k = skelC(state), T = tints(state), rig = new Rig(ctx, h), tiny = h < 34;
    var sq = k.sq || 1;
    contactShadow(ctx, 0.30, 0.080, 0.05);

    var bw = tr.shape === 0 ? 0.44 : tr.shape === 1 ? 0.49 : 0.39;
    var shy = k.hip + 0.30 * sq;
    var bx = k.lean * 0.30;

    // legs + boots
    var legs = rig.add(T.deep);
    if (k.stand) { cap(legs, [-0.11, k.hip], [-0.11, 0.075], 0.145); cap(legs, [0.11, k.hip], [0.12, 0.075], 0.145); }
    else if (k.recline) { cap(legs, [-0.05, k.hip - 0.03], [0.30, 0.155], 0.145); cap(legs, [0.10, k.hip - 0.05], [0.44, 0.10], 0.135); }
    else { cap(legs, [-0.12, k.hip], [-0.16, 0.09], 0.155); cap(legs, [0.12, k.hip], [0.17, 0.09], 0.155); }
    // secondary identity is MUTED on purpose: only the hood lining and the
    // crest carry accent at full strength, or the figure turns into confetti
    var boots = rig.add(shade(tr.accent2, -0.52), { halo: false });
    if (k.recline) { rrot(boots, 0.34, 0.135, 0.17, 0.095, 0.038, -0.5); rrot(boots, 0.47, 0.08, 0.17, 0.095, 0.038, -0.5); }
    else { rrot(boots, k.stand ? -0.11 : -0.165, 0.048, 0.17, 0.09, 0.038, 0); rrot(boots, k.stand ? 0.12 : 0.175, 0.048, 0.17, 0.09, 0.038, 0); }

    // far arm, then the identity backpack peeking past a shoulder
    var far = rig.add(T.deep, { ink: false, halo: false });
    cap(far, [bx + k.aL[0] * 0.60, shy - 0.03], [k.aL[0], k.aL[1]], 0.11);
    var bp = rig.add(shade(tr.accent, -0.46));
    rrot(bp, bx - bw * 0.54, shy - 0.10, 0.16, 0.26, 0.055, k.lean * 0.6 - 0.1);

    // hoodie torso, hood lining, pocket
    var torso = rig.add(T.col);
    rrot(torso, bx, (k.hip + shy) / 2, bw, (shy - k.hip) + 0.16, bw * 0.28, k.lean * 0.5);
    var hood = rig.add(shade(tr.accent, -0.22), { halo: false });
    ell(hood, bx + k.lean * 0.16, shy + 0.04, bw * 0.44, 0.08, 0);
    var pk = rig.add(T.dark, { halo: false });
    rrot(pk, bx, k.hip + 0.09, bw * 0.62, 0.12, 0.045, k.lean * 0.5);
    if (!tiny) { var g = rig.add(tr.accent, { ink: false, halo: false }); glyphPath(g, tr.glyph, bx + bw * 0.24, shy - 0.11, 0.05); }

    // near arm + cuff
    var arm = rig.add(T.lite);
    cap(arm, [bx + k.aR[0] * 0.60, shy - 0.03], [k.aR[0], k.aR[1]], 0.12);
    var cuff = rig.add(T.shell, { halo: false });
    circ(cuff, k.aR[0], k.aR[1], 0.068);
    if (k.card) { var cd = rig.add('#FBF7EE'); rrot(cd, 0, k.aR[1] + 0.02, 0.30, 0.20, 0.03, 0); }

    // helmet
    var hx = bx + k.lean * 0.9, hy = k.hy;
    var hr = tr.head === 0 ? 0.255 : tr.head === 1 ? 0.275 : 0.235;
    var neck = rig.add(T.dark, { halo: false }); cap(neck, [bx + k.lean * 0.3, shy], [hx, hy - hr * 0.78], 0.10);
    var helm = rig.add(T.shell);
    ell(helm, hx, hy, hr * 1.08, hr, 0);
    rig.flush();

    // visor: a wide dark band across the lower half, carrying the state mark
    ctx.save(); ctx.translate(hx, hy); ctx.rotate(-k.hrot * 0.45);
    ctx.save();
    var clip = new Path2D(); ell(clip, 0, 0, hr * 1.07, hr * 0.99, 0); ctx.clip(clip);
    var vp = new Path2D(); vp.roundRect(-hr * 1.3, -hr * 0.72, hr * 2.6, hr * 0.86, hr * 0.26);
    ctx.fillStyle = T.glass; ctx.fill(vp);
    ctx.restore();
    var vo = new Path2D(); vo.roundRect(-hr * 0.94, -hr * 0.70, hr * 1.88, hr * 0.84, hr * 0.28);
    ctx.strokeStyle = INK; ctx.lineWidth = rig.lw * 0.85; ctx.stroke(vo);
    drawStateMark(ctx, state, 0, -hr * 0.28, hr * 0.37, T.dead ? OFFCOL : MARK, rig.lw, tiny);
    // helmet stripe in the full state colour
    var st = new Path2D(); st.roundRect(-hr * 0.16, hr * 0.16, hr * 0.32, hr * 0.84, hr * 0.12);
    ctx.fillStyle = T.col; ctx.fill(st);
    ctx.restore();

    // crest, then the headlamp: a second cue that nothing on the floor can hide
    var r2 = new Rig(ctx, h);
    var ac = r2.add(tr.accent);
    if (tr.acc === 0) rrot(ac, hx, hy + hr * 1.02, hr * 0.26, hr * 0.52, hr * 0.1, 0);
    else if (tr.acc === 1) ell(ac, hx, hy + hr * 0.90, hr * 0.78, hr * 0.28, 0);
    else if (tr.acc === 2) { cap(ac, [hx - 0.01, hy + hr * 0.86], [hx + 0.03, hy + hr * 1.46], 0.032); circ(ac, hx + 0.03, hy + hr * 1.52, 0.047); }
    else if (tr.acc === 3) { circ(ac, hx - hr * 0.62, hy + hr * 0.74, hr * 0.23); circ(ac, hx + hr * 0.62, hy + hr * 0.74, hr * 0.23); }
    else rrot(ac, hx, hy + hr * 0.96, hr * 1.12, hr * 0.36, hr * 0.16, 0.12);
    r2.flush();
    var lamp = new Path2D(); circ(lamp, hx, hy + hr * 0.72, hr * 0.19);
    ctx.strokeStyle = RIM; ctx.lineWidth = rig.lw * 3.2; ctx.stroke(lamp);
    ctx.fillStyle = T.dead ? OFFCOL : T.col; ctx.fill(lamp);
    ctx.strokeStyle = INK; ctx.lineWidth = rig.lw; ctx.stroke(lamp);
    if (tr.rarity === 'legendary') {
      var au = new Path2D(); ell(au, hx, hy + hr * 1.56, hr * 1.2, hr * 0.34, 0);
      ctx.strokeStyle = alpha(tr.accent, 0.65); ctx.lineWidth = rig.lw * 2.2; ctx.stroke(au);
    }
    beacon(ctx, hx, hy + hr * 1.72, state, h);
  });
}

// ===========================================================================
// D — CAPSULE BOT. Hovers, so it has no ground-plane orientation to contradict.
// State lives in the eyes and the top light; the body is one clean colour mass.
// ===========================================================================

function skelD(state) {
  switch (state) {
    case 'working': return { tilt: 0.11, lift: 0.10, sq: 1, eye: 'focus', nub: [0.33, -0.02, -0.32, -0.03], light: 'on' };
    case 'needs_input': return { tilt: -0.03, lift: 0.13, sq: 1, eye: 'wide', nub: [0.34, 0.56, -0.33, -0.01], light: 'ring' };
    case 'stalled': return { tilt: 0.24, lift: 0.05, sq: 0.93, eye: 'flat', nub: [0.31, -0.11, -0.30, -0.12], light: 'dim' };
    case 'for_review': return { tilt: -0.04, lift: 0.17, sq: 1, eye: 'happy', nub: [0.31, 0.16, -0.31, 0.16], light: 'on', card: 1 };
    case 'ended': return { tilt: 0.30, lift: 0.015, sq: 0.85, eye: 'shut', nub: [0.28, -0.16, -0.28, -0.17], light: 'off' };
    case 'benched': return { tilt: -0.40, lift: 0.055, sq: 1, eye: 'rest', nub: [0.38, 0.06, -0.30, 0.20], light: 'off' };
  }
}

function drawD(ctx, x, y, h, state, tr) {
  inFrame(ctx, x, y, h, function () {
    var k = skelD(state), T = tints(state), rig = new Rig(ctx, h), tiny = h < 34;
    contactShadow(ctx, 0.29 - k.lift * 0.22, 0.075 - k.lift * 0.05, 0.04);

    var bw = tr.shape === 0 ? 0.58 : tr.shape === 1 ? 0.64 : 0.52;
    var bh = (tr.shape === 2 ? 0.70 : 0.76) * k.sq;
    var cy = k.lift + bh / 2;

    // nubs
    var nb = rig.add(T.dark);
    cap(nb, [k.nub[2] * bw * 0.76, cy - bh * 0.05], [k.nub[2], cy + k.nub[3]], 0.105);
    var nb2 = rig.add(T.lite);
    cap(nb2, [k.nub[0] * bw * 0.76, cy - bh * 0.05], [k.nub[0], cy + k.nub[1]], 0.11);

    // capsule body + a lit crown + a thin identity ring near the base
    var body = rig.add(T.col);
    rrot(body, 0, cy, bw, bh, bw * 0.5, k.tilt);
    var hi = rot2(0, bh * 0.26, k.tilt);
    var crown = rig.add(T.lite, { halo: false, ink: false });
    ell(crown, hi[0], cy + hi[1], bw * 0.34, bh * 0.14, k.tilt);
    // identity badge on the chest — small and quiet, so the state colour
    // still owns the body mass at 24 px
    var bo = rot2(0, -bh * 0.25, k.tilt);
    var badge = rig.add(shade(tr.accent, -0.10), { halo: false });
    rrot(badge, bo[0], cy + bo[1], bw * 0.30, bh * 0.17, bh * 0.055, k.tilt);
    if (!tiny) {
      var gl = rig.add(shade(tr.accent, -0.62), { halo: false, ink: false });
      glyphPath(gl, tr.glyph, bo[0], cy + bo[1], bh * 0.052);
    }
    if (k.card) { var cd = rig.add('#FBF7EE'); rrot(cd, 0, cy + k.nub[1] + 0.015, 0.31, 0.19, 0.03, 0); }
    rig.flush();

    // face plate + eyes — the whole state read
    ctx.save(); ctx.translate(0, cy); ctx.rotate(k.tilt);
    var fo = bh * 0.17;
    var fp = new Path2D(); ell(fp, 0, fo, bw * 0.355, bh * 0.215, 0);
    ctx.fillStyle = T.glass; ctx.fill(fp);
    ctx.strokeStyle = INK; ctx.lineWidth = rig.lw * 0.8; ctx.stroke(fp);

    var ew = tr.eye === 0 ? 1 : tr.eye === 1 ? 1.14 : 0.88;
    var ex = bw * 0.165, er = bh * 0.115 * ew;
    var col = T.dead ? OFFCOL : MARK;
    ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineCap = 'round';
    var e = new Path2D();
    if (k.eye === 'wide') {
      ell(e, -ex, fo, er * 1.02, er * 1.12, 0); ell(e, ex, fo, er * 1.02, er * 1.12, 0); ctx.fill(e);
      var pu = new Path2D(); circ(pu, -ex, fo - er * 0.12, er * 0.44); circ(pu, ex, fo - er * 0.12, er * 0.44);
      ctx.fillStyle = T.glass; ctx.fill(pu);
    } else if (k.eye === 'focus') {
      e.roundRect(-ex - er * 0.88, fo - er * 0.78, er * 1.76, er * 1.20, er * 0.46);
      e.roundRect(ex - er * 0.88, fo - er * 0.78, er * 1.76, er * 1.20, er * 0.46);
      ctx.fill(e);
    } else if (k.eye === 'flat') {
      e.roundRect(-ex - er * 0.95, fo - er * 0.22, er * 1.9, er * 0.46, er * 0.23);
      e.roundRect(ex - er * 0.95, fo - er * 0.22, er * 1.9, er * 0.46, er * 0.23);
      ctx.fill(e);
      if (!tiny) {
        var br = new Path2D();
        br.moveTo(-ex - er, fo + er * 1.0); br.lineTo(-ex + er, fo + er * 0.52);
        br.moveTo(ex + er, fo + er * 1.0); br.lineTo(ex - er, fo + er * 0.52);
        ctx.lineWidth = er * 0.42; ctx.stroke(br);
      }
    } else if (k.eye === 'happy') {
      e.moveTo(-ex - er, fo - er * 0.28); e.quadraticCurveTo(-ex, fo + er * 1.20, -ex + er, fo - er * 0.28);
      e.moveTo(ex - er, fo - er * 0.28); e.quadraticCurveTo(ex, fo + er * 1.20, ex + er, fo - er * 0.28);
      ctx.lineWidth = er * 0.74; ctx.stroke(e);
    } else { // shut / rest
      e.moveTo(-ex - er, fo + er * 0.32); e.quadraticCurveTo(-ex, fo - er * 0.80, -ex + er, fo + er * 0.32);
      e.moveTo(ex - er, fo + er * 0.32); e.quadraticCurveTo(ex, fo - er * 0.80, ex + er, fo + er * 0.32);
      ctx.lineWidth = er * 0.70; ctx.stroke(e);
    }
    ctx.restore();

    // top light + the identity accessory around it
    var to = rot2(0, bh * 0.50, k.tilt);
    var lx = to[0], ly = cy + to[1];
    var r2 = new Rig(ctx, h);
    var ac = r2.add(tr.accent);
    if (tr.acc === 0) { ell(ac, lx - bw * 0.32, ly - bh * 0.04, bw * 0.15, bh * 0.14, -0.3); ell(ac, lx + bw * 0.32, ly - bh * 0.04, bw * 0.15, bh * 0.14, 0.3); }
    else if (tr.acc === 1) rrot(ac, lx, ly + 0.025, bw * 0.11, bh * 0.22, bw * 0.045, k.tilt);
    else if (tr.acc === 2) rrot(ac, lx, ly - 0.005, bw * 0.88, bh * 0.075, bh * 0.037, k.tilt);
    else if (tr.acc === 3) { circ(ac, lx - bw * 0.31, ly - bh * 0.02, bw * 0.105); circ(ac, lx + bw * 0.31, ly - bh * 0.02, bw * 0.105); }
    else { rrot(ac, lx, ly + 0.02, bw * 0.34, bh * 0.10, bh * 0.05, k.tilt + 0.5); }
    r2.flush();
    var lw = Math.max(0.95 / h, 0.023);
    var dome = new Path2D(); circ(dome, lx, ly + bh * 0.035, bw * 0.155);
    ctx.strokeStyle = RIM; ctx.lineWidth = lw * 3.4; ctx.stroke(dome);
    ctx.fillStyle = k.light === 'off' ? OFFCOL : k.light === 'dim' ? T.dark : T.lite;
    ctx.fill(dome);
    ctx.strokeStyle = INK; ctx.lineWidth = lw; ctx.stroke(dome);
    if (k.light === 'ring') {
      var rg = new Path2D(); circ(rg, lx, ly + bh * 0.035, bw * 0.27);
      ctx.strokeStyle = alpha(T.col, 0.6); ctx.lineWidth = lw * 2.3; ctx.stroke(rg);
    }
    if (tr.rarity === 'legendary') {
      var au = new Path2D(); ell(au, lx, ly + bh * 0.24, bw * 0.44, bh * 0.10, 0);
      ctx.strokeStyle = alpha(tr.accent, 0.65); ctx.lineWidth = lw * 2.2; ctx.stroke(au);
    }
    beacon(ctx, 0, ly + bh * 0.13, state, h);
  });
}

// ---------------------------------------------------------------- registry

var CHARS = {
  A: { key: 'A', name: 'Side-view robot', draw: drawA, tag: 'Silhouette first. A profile standee with a screen face — the most graphic read, and the least like any piece of furniture.' },
  B: { key: 'B', name: '45° three-quarter robot', draw: drawB, tag: 'Volume first. Chunky barrel, dome head, wrap visor — the projection cheat every top-down RPG already uses.' },
  C: { key: 'C', name: '45° crew figure', draw: drawC, tag: 'Warmth first. A person in a helmet: hoodie in the state colour, state on the visor, a lamp nothing can hide.' },
  D: { key: 'D', name: 'Capsule bot', draw: drawD, tag: 'Cheapest to read and to animate. Hovers, so there is no ground plane to contradict; state lives in the eyes and the top light.' },
};

// ---------------------------------------------------------- furniture cues

function deskCue(ctx, x, y, w) {
  ctx.save();
  ctx.fillStyle = '#D9CDB4'; ctx.strokeStyle = 'rgba(70,60,46,0.35)'; ctx.lineWidth = 1;
  var p = new Path2D(); p.roundRect(x - w / 2, y - w * 0.17, w, w * 0.34, 3);
  ctx.fill(p); ctx.stroke(p);
  var m = new Path2D(); m.roundRect(x - w * 0.26, y - w * 0.12, w * 0.52, w * 0.12, 2);
  ctx.fillStyle = '#BFD3CE'; ctx.fill(m); ctx.stroke(m);
  ctx.restore();
}
function sofaCue(ctx, x, y, w) {
  ctx.save();
  ctx.fillStyle = '#E9E4DA'; ctx.strokeStyle = 'rgba(70,60,46,0.32)'; ctx.lineWidth = 1;
  var p = new Path2D(); p.roundRect(x - w / 2, y - w * 0.30, w, w * 0.46, 5);
  ctx.fill(p); ctx.stroke(p);
  var c = new Path2D();
  c.roundRect(x - w * 0.46, y - w * 0.26, w * 0.28, w * 0.22, 3);
  c.roundRect(x + w * 0.18, y - w * 0.26, w * 0.28, w * 0.22, 3);
  ctx.fillStyle = '#F5F1E8'; ctx.fill(c); ctx.stroke(c);
  ctx.restore();
}
