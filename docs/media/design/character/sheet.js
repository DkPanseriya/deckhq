/* Sheet composition for one candidate. */

var BG = '#EFEAE0', CARPET = '#DCD5C4', WOOD = '#D8B98A', CARD = '#FBF8F2';
var TXT = '#2C2720', MUTED = '#7A7266';

var SEEDS = ['a7f2', 'k9x1', 'zq04', 'm3rt', 'p81c', 'vv6n'];
var CROWD = [
  ['working', 's01'], ['working', 's02'], ['needs_input', 's03'], ['working', 's04'],
  ['ended', 's05'], ['for_review', 's06'], ['working', 's07'], ['stalled', 's08'],
  ['benched', 's09'], ['working', 's10'], ['ended', 's11'], ['needs_input', 's12'],
];
var NAMES = ['Elif', 'Kobe', 'Ravi', 'Milos', 'Zola', 'Isla', 'Vera', 'Nadir', 'Suki', 'Boris', 'Dov', 'Yara'];

function label(ctx, s, x, y, size, col, weight, align) {
  ctx.font = (weight || 600) + ' ' + size + 'px "Segoe UI", system-ui, sans-serif';
  ctx.fillStyle = col || TXT; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}
function mono(ctx, s, x, y, size, col, align) {
  ctx.font = size + 'px Consolas, "JetBrains Mono", monospace';
  ctx.fillStyle = col || MUTED; ctx.textAlign = align || 'left'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(s, x, y);
}
function panel(ctx, x, y, w, h, fill, r) {
  var p = new Path2D(); p.roundRect(x, y, w, h, r === undefined ? 6 : r);
  ctx.fillStyle = fill; ctx.fill(p);
  ctx.strokeStyle = 'rgba(60,52,40,0.18)'; ctx.lineWidth = 1; ctx.stroke(p);
}
function sectionHead(ctx, s, sub, x, y) {
  label(ctx, s, x, y, 12, '#57503f', 700);
  ctx.font = '700 12px "Segoe UI", system-ui, sans-serif';
  var w = ctx.measureText(s).width;
  if (sub) mono(ctx, sub, x + w + 12, y, 11, MUTED);
}
/** Name label in the floor style: white text, dark halo, under the feet. */
function nameTag(ctx, s, x, y) {
  ctx.font = '600 9px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.lineWidth = 2.6; ctx.strokeStyle = 'rgba(30,26,20,0.75)'; ctx.lineJoin = 'round';
  ctx.strokeText(s, x, y); ctx.fillStyle = '#FFFCF5'; ctx.fillText(s, x, y);
  ctx.textAlign = 'left';
}

/* ---------------------------------------------------------------- in situ */

var CROP = { x: 390, y: 690, w: 860, h: 256 };

/** Where the characters stand, in crop-local pixels. [x, groundY, state, seed, name] */
var PLACE = [
  [96, 162, 'benched', 'a7f2', 'Yara'],
  [134, 166, 'benched', 'm3rt', ''],
  [196, 206, 'working', 'zq04', ''],
  [243, 200, 'stalled', 'p81c', 'Nadir'],
  [345, 138, 'for_review', 'k9x1', ''],
  [452, 118, 'working', 'vv6n', ''],
  [566, 134, 'needs_input', 'q22z', 'Kobe'],
  [648, 215, 'working', 'b4k9', ''],
];

function drawInSitu(img, key, h, crop) {
  var R = crop || CROP;
  var off = document.createElement('canvas');
  off.width = R.w; off.height = R.h;
  var c = off.getContext('2d');
  c.drawImage(img, R.x, R.y, R.w, R.h, 0, 0, R.w, R.h);
  for (var i = 0; i < PLACE.length; i++) {
    var p = PLACE[i];
    if (p[0] > R.w - 8 || p[1] > R.h - 4) continue;
    CHARS[key].draw(c, p[0], p[1], h, p[2], traitsFor(p[3]));
    if (p[4]) nameTag(c, p[4], p[0], p[1] + 10);
  }
  return off;
}

/* ------------------------------------------------------------------ sheet */

function renderSheet(ctx, key, img) {
  var C = CHARS[key];
  ctx.fillStyle = BG; ctx.fillRect(0, 0, 1400, 1052);

  // header
  ctx.fillStyle = '#25211C'; ctx.fillRect(0, 0, 1400, 76);
  label(ctx, key, 36, 50, 34, '#E8C15A', 800);
  label(ctx, C.name, 74, 42, 22, '#FBF8F2', 700);
  label(ctx, C.tag, 74, 62, 12.5, 'rgba(251,248,242,0.62)', 500);
  mono(ctx, 'DeckHQ character study · reduced-motion (static) render · canvas 2D, no assets', 1364, 47, 11, 'rgba(251,248,242,0.45)', 'right');

  // ---- sizes
  sectionHead(ctx, 'SIZES', '24 / 40 / 64 px tall on project-room carpet', 36, 104);
  panel(ctx, 36, 116, 470, 152, CARPET);
  var base = 250;
  [[24, 92], [40, 178], [64, 320]].forEach(function (s) {
    C.draw(ctx, s[1], base, s[0], 'needs_input', traitsFor('a7f2'));
    mono(ctx, s[0] + ' px', s[1], base + 14, 10, '#6b6250', 'center');
  });
  mono(ctx, 'current rig ≈ 22 px', 424, base + 14, 10, '#6b6250', 'center');
  ctx.globalAlpha = 0.9;
  drawLegacyBlob(ctx, 424, base, 22);
  ctx.globalAlpha = 1;

  // ---- crowd
  sectionHead(ctx, 'OVERVIEW CROWD', '26 px, mixed states, 1:1 — the L0 glance test', 520, 104);
  panel(ctx, 520, 116, 844, 152, CARPET);
  for (var i = 0; i < CROWD.length; i++) {
    var cx = 556 + i * 69, cy = 212;
    C.draw(ctx, cx, cy, 26, CROWD[i][0], traitsFor(CROWD[i][1]));
    if (i % 4 === 0) nameTag(ctx, NAMES[i], cx, cy + 11);
  }
  mono(ctx, 'no two neighbours share a colour-and-icon pair', 556, 254, 10, '#6b6250');

  // ---- states
  sectionHead(ctx, 'STATES', 'six poses, 44 px, with the furniture each one sits at', 36, 296);
  for (var s = 0; s < STATES.length; s++) {
    var st = STATES[s], x = 36 + s * 222, y = 308, w = 214, hgt = 200;
    panel(ctx, x, y, w, hgt, st === 'for_review' ? WOOD : CARPET);
    var gx = x + w / 2, gy = y + 148;
    if (st === 'benched') sofaCue(ctx, gx + 4, gy + 6, 120);
    else if (st !== 'for_review') deskCue(ctx, gx + 42, gy - 6, 96);
    C.draw(ctx, gx - (st === 'benched' ? 10 : 18), gy, 44, st, traitsFor('k9x1'));
    // footer strip
    ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.fillRect(x + 1, y + hgt - 31, w - 2, 30);
    var sw = new Path2D(); sw.roundRect(x + 10, y + hgt - 22, 12, 12, 3);
    ctx.fillStyle = STATE_COLORS[st]; ctx.fill(sw);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 1; ctx.stroke(sw);
    label(ctx, STATE_LABEL[st], x + 30, y + hgt - 12, 12, TXT, 700);
    mono(ctx, STATE_COLORS[st], x + w - 10, y + hgt - 12, 9.5, MUTED, 'right');
  }

  // ---- identity
  sectionHead(ctx, 'IDENTITY', 'six session ids, one state (working) — colour, silhouette, crown, chest glyph', 36, 536);
  for (var v = 0; v < 6; v++) {
    var vx = 36 + v * 222, vy = 548, vw = 214, vh = 148;
    panel(ctx, vx, vy, vw, vh, CARPET);
    var tr = traitsFor(SEEDS[v]);
    C.draw(ctx, vx + vw / 2, vy + 108, 42, 'working', tr);
    ctx.fillStyle = 'rgba(255,255,255,0.82)'; ctx.fillRect(vx + 1, vy + vh - 29, vw - 2, 28);
    mono(ctx, 'sess-' + SEEDS[v], vx + 10, vy + vh - 11, 10, TXT);
    mono(ctx, tr.glyph + ' · ' + tr.rarity, vx + vw - 10, vy + vh - 11, 9.5, MUTED, 'right');
  }

  // ---- in situ
  sectionHead(ctx, 'IN SITU', 'real floor crop (goldens/win32/empty.png, 1:1), characters at 34 px', 36, 716);
  var off = drawInSitu(img, key, 34);
  ctx.drawImage(off, 36, 728);
  ctx.strokeStyle = 'rgba(60,52,40,0.35)'; ctx.lineWidth = 1; ctx.strokeRect(36.5, 728.5, CROP.w, CROP.h);
  mono(ctx, 'the one small figure on the right sofa is the CURRENT rig, left in for comparison', 36, 1026, 10.5, MUTED);

  // 2x detail
  var dsx = 60, dsy = 60, dw = 220, dh = 140;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(off, dsx, dsy, dw, dh, 920, 728, dw * 2, dh * 2);
  ctx.imageSmoothingEnabled = true;
  ctx.strokeStyle = 'rgba(60,52,40,0.35)'; ctx.strokeRect(920.5, 728.5, dw * 2, dh * 2);
  ctx.strokeStyle = '#C0392B'; ctx.lineWidth = 1.5;
  ctx.strokeRect(36 + dsx, 728 + dsy, dw, dh);
  mono(ctx, '2× detail of the marked region — nearest-neighbour, no resampling', 920, 1026, 10.5, MUTED);
}

/** A rough stand-in for the current top-down rig, for scale comparison only. */
function drawLegacyBlob(ctx, x, y, h) {
  ctx.save(); ctx.translate(x, y); ctx.scale(h, -h);
  var p = new Path2D(); ell(p, 0, 0.07, 0.10, 0.05); ctx.fillStyle = 'rgba(52,44,34,0.3)'; ctx.fill(p);
  var b = new Path2D(); ell(b, 0, 0.36, 0.40, 0.30);
  ctx.fillStyle = STATE_COLORS.working; ctx.fill(b);
  ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 0.05; ctx.stroke(b);
  var hd = new Path2D(); circ(hd, 0, 0.62, 0.26);
  ctx.fillStyle = '#E4B98E'; ctx.fill(hd);
  var hr = new Path2D(); ell(hr, 0, 0.70, 0.26, 0.18); ctx.fillStyle = '#3C2A1C'; ctx.fill(hr);
  ctx.restore();
}
