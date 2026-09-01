/* Studio skin — architectural-render floor plan.
 *
 * Deliberately light and warm whatever the app theme is: this is a rendering of
 * a room, and rooms are lit. The whole backdrop (materials, walls, shadows,
 * furniture) is painted once to an offscreen canvas on layout change; each
 * frame only blits that and draws the people. Expensive-looking, cheap to run.
 */

export const U = 14;                       // px per plan unit

const P = {
  shell:      '#F4F1EB',
  carpet:     '#E9E5DD',
  carpetAlt:  '#E3DED5',
  tile:       '#EDEAE4',
  wallFill:   '#FCFBF8',
  wallEdge:   '#CFC9BE',
  wallShadow: 'rgba(60,50,38,0.13)',
  woodA:      '#CBA87A',
  woodB:      '#BE9868',
  woodC:      '#D6B98A',
  deskTop:    '#D8BD97',
  deskEdge:   '#B29470',
  chair:      '#FBFAF7',
  chairEdge:  '#D2CCC1',
  sofa:       '#EFECE4',
  rugSage:    '#C8D3C5',
  rugCream:   '#E6E0D2',
  plantA:     '#6F8F5E',
  plantB:     '#87A874',
  plantC:     '#587A49',
  ink:        '#4A4438',
  inkSoft:    '#8C8474',
  glass:      'rgba(150,180,190,0.35)',
};

const S = {
  owed:    '#C0392B',
  working: '#2E7D63',
  idle:    '#9A9384',
  fired:   '#BDB7AA',
};

/* --------------------------------------------------------------- patterns */
const cache = new Map();
function pattern(key, w, h, paint) {
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  paint(c.getContext('2d'), w, h);
  const p = c.getContext('2d').createPattern(c, 'repeat');
  cache.set(key, p);
  return p;
}

function herringbonePattern() {
  return pattern('herring', 184, 184, (x) => {
    x.fillStyle = P.woodB; x.fillRect(0, 0, 184, 184);
    const CELL = 46, L = CELL * 1.42, W = CELL * 0.48;
    const tones = [P.woodA, P.woodC, P.woodB, '#C4A074'];
    for (let j = -3; j < 9; j++) {
      for (let i = -3; i < 9; i++) {
        const dir = (i + j) % 2 === 0 ? 1 : -1;
        x.save();
        x.translate(i * CELL, j * CELL);
        x.rotate((dir * 45 * Math.PI) / 180);
        x.fillStyle = tones[Math.abs((i * 3 + j * 5)) % tones.length];
        x.fillRect(0, 0, L, W);
        x.strokeStyle = 'rgba(105,76,44,0.55)'; x.lineWidth = 1.6;
        x.strokeRect(0, 0, L, W);
        x.fillStyle = 'rgba(255,255,255,0.10)';
        x.fillRect(0, 0, L, W * 0.32);
        x.restore();
      }
    }
  });
}

function carpetPattern() {
  return pattern('carpet', 64, 64, (x) => {
    x.fillStyle = P.carpet; x.fillRect(0, 0, 64, 64);
    for (let i = 0; i < 900; i++) {
      x.fillStyle = i % 2 ? 'rgba(255,255,255,0.55)' : 'rgba(150,140,125,0.16)';
      x.fillRect(Math.random() * 64, Math.random() * 64, 1, 1);
    }
  });
}

function tilePattern() {
  return pattern('tile', 48, 48, (x) => {
    x.fillStyle = P.tile; x.fillRect(0, 0, 48, 48);
    x.strokeStyle = 'rgba(140,132,118,0.30)'; x.lineWidth = 1;
    x.strokeRect(0.5, 0.5, 24, 24); x.strokeRect(24.5, 24.5, 24, 24);
    x.strokeRect(24.5, 0.5, 24, 24); x.strokeRect(0.5, 24.5, 24, 24);
  });
}

/* ------------------------------------------------------------- primitives */
function roundRect(c, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  c.beginPath();
  c.moveTo(x + rad, y);
  c.lineTo(x + w - rad, y); c.quadraticCurveTo(x + w, y, x + w, y + rad);
  c.lineTo(x + w, y + h - rad); c.quadraticCurveTo(x + w, y + h, x + w - rad, y + h);
  c.lineTo(x + rad, y + h); c.quadraticCurveTo(x, y + h, x, y + h - rad);
  c.lineTo(x, y + rad); c.quadraticCurveTo(x, y, x + rad, y);
  c.closePath();
}
function shadow(c, fn, blur = 10, oy = 3, alpha = 0.22) {
  c.save();
  c.shadowColor = `rgba(55,45,32,${alpha})`;
  c.shadowBlur = blur; c.shadowOffsetY = oy;
  fn(c);
  c.restore();
}

/* ------------------------------------------------------------- furniture */
function chair(c, cx, cy, facing = 0, tone = P.chair) {
  const R = 12;
  c.save(); c.translate(cx, cy); c.rotate(facing);
  shadow(c, (k) => {
    k.fillStyle = tone;
    roundRect(k, -R, -R + 4, R * 2, R * 2 - 4, 5); k.fill();
  }, 8, 3, 0.30);
  c.fillStyle = tone;
  roundRect(c, -R, -R + 4, R * 2, R * 2 - 4, 5); c.fill();
  c.strokeStyle = '#9A9080'; c.lineWidth = 2.2;      // bold outline, reads small
  roundRect(c, -R, -R + 4, R * 2, R * 2 - 4, 5); c.stroke();
  // backrest as a solid darker bar
  c.fillStyle = '#D6CDBD';
  roundRect(c, -R + 1, -R - 4, R * 2 - 2, 8, 3); c.fill();
  c.strokeStyle = '#9A9080'; c.lineWidth = 1.8; c.stroke();
  c.restore();
}

function deskBank(c, x, y, w, h, seatsPerSide) {
  shadow(c, (k) => { k.fillStyle = P.deskTop; roundRect(k, x, y, w, h, 3); k.fill(); }, 14, 5, 0.26);
  c.strokeStyle = P.deskEdge; c.lineWidth = 1.2;
  roundRect(c, x, y, w, h, 3); c.stroke();
  // centre divider
  c.fillStyle = 'rgba(255,255,255,0.85)';
  c.fillRect(x, y + h / 2 - 3, w, 6);
  c.strokeStyle = 'rgba(160,145,120,0.5)';
  c.strokeRect(x + 0.5, y + h / 2 - 2.5, w - 1, 5);
  // monitors + keyboards
  const step = w / seatsPerSide;
  for (let i = 0; i < seatsPerSide; i++) {
    const mx = x + step * (i + 0.5);
    for (const side of [-1, 1]) {
      const my = y + h / 2 + side * (h / 4);
      c.save(); c.translate(mx, my);
      c.fillStyle = '#33333A';
      roundRect(c, -16, side < 0 ? -13 : 6, 32, 7, 1.5); c.fill();   // monitor
      c.fillStyle = 'rgba(150,190,205,0.55)';
      c.fillRect(-14.5, side < 0 ? -11.5 : 7.5, 29, 4);              // screen glow
      c.fillStyle = '#EDEAE3';
      roundRect(c, -12, side < 0 ? 0 : -8, 24, 6, 2); c.fill();      // keyboard
      c.strokeStyle = 'rgba(160,150,132,0.6)'; c.lineWidth = 0.8; c.stroke();
      c.restore();
    }
  }
}

function sofa(c, x, y, w, h) {
  shadow(c, (k) => { k.fillStyle = P.sofa; roundRect(k, x, y, w, h, 6); k.fill(); }, 12, 4, 0.22);
  c.strokeStyle = P.chairEdge; c.lineWidth = 1;
  roundRect(c, x, y, w, h, 6); c.stroke();
  const n = Math.max(2, Math.round(w / 34));
  for (let i = 0; i < n; i++) {
    c.fillStyle = 'rgba(255,255,255,0.75)';
    roundRect(c, x + 4 + i * ((w - 8) / n), y + 5, (w - 8) / n - 4, h - 12, 4); c.fill();
    c.strokeStyle = 'rgba(180,172,158,0.6)'; c.stroke();
  }
}

function roundTable(c, cx, cy, r, seats) {
  shadow(c, (k) => {
    k.fillStyle = P.woodA; k.beginPath(); k.arc(cx, cy, r, 0, Math.PI * 2); k.fill();
  }, 14, 5, 0.26);
  c.strokeStyle = P.deskEdge; c.lineWidth = 1.2;
  c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
  c.strokeStyle = 'rgba(255,255,255,0.35)'; c.stroke();
  for (let i = 0; i < seats; i++) {
    const a = (i / seats) * Math.PI * 2;
    chair(c, cx + Math.cos(a) * (r + 13), cy + Math.sin(a) * (r + 13), a + Math.PI / 2);
  }
}

function rug(c, x, y, w, h, tone, round = false) {
  c.save();
  shadow(c, (k) => {
    k.fillStyle = tone;
    if (round) { k.beginPath(); k.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); k.fill(); }
    else { roundRect(k, x, y, w, h, 4); k.fill(); }
  }, 8, 2, 0.14);
  c.strokeStyle = 'rgba(255,255,255,0.6)'; c.lineWidth = 3;
  if (round) { c.beginPath(); c.ellipse(x + w / 2, y + h / 2, w / 2 - 5, h / 2 - 5, 0, 0, Math.PI * 2); c.stroke(); }
  else { roundRect(c, x + 5, y + 5, w - 10, h - 10); c.stroke(); }
  c.restore();
}

function plant(c, cx, cy, scale = 1) {
  shadow(c, (k) => {
    k.fillStyle = '#D9D2C4';
    k.beginPath(); k.arc(cx, cy + 4 * scale, 9 * scale, 0, Math.PI * 2); k.fill();
  }, 8, 3, 0.22);
  const blobs = [[0, -6, 13], [-9, -1, 10], [9, -2, 10], [-4, -12, 8], [6, -11, 9]];
  blobs.forEach(([dx, dy, r], i) => {
    c.fillStyle = [P.plantA, P.plantB, P.plantC][i % 3];
    c.beginPath(); c.arc(cx + dx * scale, cy + dy * scale, r * scale, 0, Math.PI * 2); c.fill();
  });
}

function counter(c, x, y, w, h) {
  shadow(c, (k) => { k.fillStyle = '#F0EDE6'; roundRect(k, x, y, w, h, 2); k.fill(); }, 10, 3, 0.2);
  c.strokeStyle = P.chairEdge; c.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  c.fillStyle = '#3B3B40';
  c.fillRect(x + w * 0.18, y + h * 0.3, w * 0.2, h * 0.4);   // hob
  c.fillStyle = '#D8D3C8';
  roundRect(c, x + w * 0.6, y + h * 0.28, w * 0.24, h * 0.44, 2); c.fill();  // sink
}

/* ------------------------------------------------------------------ plan */
export function buildPlan(zones) {
  const podCols = 3;
  const rows = Math.max(2, Math.ceil(zones.length / podCols));
  const POD_W = 26, POD_H = 21;

  const office = { x: 2, y: 2, w: 32, h: 27 };
  const work = { x: 37, y: 2, w: podCols * POD_W + 4, h: rows * POD_H + 4 };
  const W = Math.max(work.x + work.w + 2, 116);
  const lobby = { x: 2, y: 33, w: 32, h: 30 };
  const cafe = { x: 37, y: work.y + work.h + 2, w: 42, h: 26 };
  const kitchen = { x: cafe.x + cafe.w + 3, y: cafe.y, w: 28, h: 26 };
  const H = Math.max(lobby.y + lobby.h, cafe.y + cafe.h) + 3;

  const pods = zones.map((z, i) => {
    const col = i % podCols, row = Math.floor(i / podCols);
    const x = work.x + 2 + col * POD_W, y = work.y + 2 + row * POD_H;
    const bank = { x: x + 3, y: y + 6, w: POD_W - 10, h: 9 };
    const seats = [];
    const per = 4, step = bank.w / per;
    for (let k = 0; k < per; k++) seats.push({ x: bank.x + step * (k + 0.5), y: bank.y - 6 });
    for (let k = 0; k < per; k++) seats.push({ x: bank.x + step * (k + 0.5), y: bank.y + bank.h + 6 });
    return { zone: z, x, y, w: POD_W - 4, h: POD_H - 4, bank, seats };
  });

  // waiting chairs along the office wall
  const waiting = [];
  for (let i = 0; i < 7; i++) waiting.push({ x: office.x + 4 + i * 3.6, y: office.y + 20 });
  for (let i = 0; i < 7; i++) waiting.push({ x: office.x + 4 + i * 3.6, y: office.y + 24 });

  // lobby seats: sofas, round rug armchairs, cafe tables
  const lounge = [];
  for (let i = 0; i < 3; i++) lounge.push({ x: lobby.x + 6 + i * 6, y: lobby.y + 7 });
  for (let i = 0; i < 3; i++) lounge.push({ x: lobby.x + 6 + i * 6, y: lobby.y + 24 });
  lounge.push({ x: lobby.x + 24, y: lobby.y + 13 }, { x: lobby.x + 24, y: lobby.y + 18 });
  const t1 = { cx: cafe.x + 11, cy: cafe.y + 13, r: 5 };
  const t2 = { cx: cafe.x + 30, cy: cafe.y + 13, r: 5 };
  for (const t of [t1, t2]) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      lounge.push({ x: t.cx + Math.cos(a) * (t.r + 2.6), y: t.cy + Math.sin(a) * (t.r + 2.6) });
    }
  }

  return { W, H, office, lobby, cafe, kitchen, work, pods, waiting, lounge, tables: [t1, t2] };
}

/* --------------------------------------------------------------- backdrop */
export function renderBackdrop(plan) {
  const c = document.createElement('canvas');
  c.width = plan.W * U; c.height = plan.H * U;
  const x = c.getContext('2d');
  const u = (n) => n * U;

  // ground
  x.fillStyle = P.shell; x.fillRect(0, 0, c.width, c.height);

  const room = (r, fill) => {
    x.save();
    roundRect(x, u(r.x), u(r.y), u(r.w), u(r.h), 2); x.clip();
    x.fillStyle = fill; x.fillRect(u(r.x), u(r.y), u(r.w), u(r.h));
    // ambient occlusion at the walls
    const gr = x.createLinearGradient(u(r.x), u(r.y), u(r.x), u(r.y) + 28);
    gr.addColorStop(0, 'rgba(70,58,42,0.16)'); gr.addColorStop(1, 'rgba(70,58,42,0)');
    x.fillStyle = gr; x.fillRect(u(r.x), u(r.y), u(r.w), 28);
    const gl = x.createLinearGradient(u(r.x), 0, u(r.x) + 24, 0);
    gl.addColorStop(0, 'rgba(70,58,42,0.13)'); gl.addColorStop(1, 'rgba(70,58,42,0)');
    x.fillStyle = gl; x.fillRect(u(r.x), u(r.y), 24, u(r.h));
    x.restore();
  };

  room(plan.work, carpetPattern());
  room(plan.cafe, carpetPattern());
  room(plan.office, herringbonePattern());
  room(plan.lobby, herringbonePattern());
  room(plan.kitchen, tilePattern());

  // walls
  const wall = (rx, ry, rw, rh, open) => {
    x.save();
    x.shadowColor = P.wallShadow; x.shadowBlur = 14; x.shadowOffsetY = 4;
    x.fillStyle = P.wallFill;
    const t = 5;
    const segs = [
      [u(rx) - t, u(ry) - t, u(rw) + t * 2, t],
      [u(rx) - t, u(ry) + u(rh), u(rw) + t * 2, t],
      [u(rx) - t, u(ry), t, u(rh)],
      [u(rx) + u(rw), u(ry), t, u(rh)],
    ];
    segs.forEach((s, i) => { if (open !== i) x.fillRect(...s); });
    x.restore();
    x.strokeStyle = P.wallEdge; x.lineWidth = 1;
    segs.forEach((s, i) => { if (open !== i) x.strokeRect(s[0] + 0.5, s[1] + 0.5, s[2] - 1, s[3] - 1); });
  };
  wall(plan.office.x, plan.office.y, plan.office.w, plan.office.h, 1);
  wall(plan.kitchen.x, plan.kitchen.y, plan.kitchen.w, plan.kitchen.h, 2);

  // office: desk + rug + plant
  rug(x, u(plan.office.x + 3), u(plan.office.y + 17), u(plan.office.w - 6), u(9), P.rugSage);
  deskBank(x, u(plan.office.x + 9), u(plan.office.y + 5), u(14), u(6), 1);
  chair(x, u(plan.office.x + 16), u(plan.office.y + 13), Math.PI);
  plant(x, u(plan.office.x + plan.office.w - 4), u(plan.office.y + 4), 1.1);

  // waiting chairs
  for (const s of plan.waiting) chair(x, u(s.x), u(s.y), 0, '#F6F2EA');

  // lobby
  rug(x, u(plan.lobby.x + 16), u(plan.lobby.y + 9), u(14), u(14), P.rugCream, true);
  sofa(x, u(plan.lobby.x + 3), u(plan.lobby.y + 4), u(20), u(5));
  sofa(x, u(plan.lobby.x + 3), u(plan.lobby.y + 21), u(20), u(5));
  chair(x, u(plan.lobby.x + 24), u(plan.lobby.y + 13), -Math.PI / 2);
  chair(x, u(plan.lobby.x + 24), u(plan.lobby.y + 18), -Math.PI / 2);
  plant(x, u(plan.lobby.x + 28), u(plan.lobby.y + 3), 1.2);
  plant(x, u(plan.lobby.x + 3), u(plan.lobby.y + 28), 0.9);

  // cafe tables
  for (const t of plan.tables) roundTable(x, u(t.cx), u(t.cy), u(t.r), 5);
  plant(x, u(plan.cafe.x + plan.cafe.w - 3), u(plan.cafe.y + 3), 1);

  // kitchen
  counter(x, u(plan.kitchen.x + 2), u(plan.kitchen.y + 3), u(plan.kitchen.w - 4), u(6));
  counter(x, u(plan.kitchen.x + 2), u(plan.kitchen.y + plan.kitchen.h - 9), u(plan.kitchen.w - 4), u(6));

  // pods
  for (const pod of plan.pods) {
    deskBank(x, u(pod.bank.x), u(pod.bank.y), u(pod.bank.w), u(pod.bank.h), 4);
    for (const s of pod.seats) chair(x, u(s.x), u(s.y), s.y < pod.bank.y ? Math.PI : 0);
    plant(x, u(pod.x + pod.w - 2), u(pod.y + pod.h - 2), 0.75);
  }

  return c;
}

/* ---------------------------------------------------------------- labels */
export function drawLabels(x, plan, info) {
  x.save();
  x.textAlign = 'left'; x.textBaseline = 'top';
  const plate = (rx, ry, text, sub, tone) => {
    x.font = '700 11px "IBM Plex Sans", system-ui, sans-serif';
    const w = Math.max(x.measureText(text).width, sub ? x.measureText(sub).width : 0) + 18;
    const h = sub ? 32 : 20;
    x.save();
    x.shadowColor = 'rgba(55,45,32,0.20)'; x.shadowBlur = 8; x.shadowOffsetY = 2;
    x.fillStyle = 'rgba(255,253,249,0.94)';
    roundRect(x, rx, ry, w, h, 4); x.fill();
    x.restore();
    x.fillStyle = P.ink; x.fillText(text, rx + 9, ry + 5);
    if (sub) { x.font = '500 10px "JetBrains Mono", monospace'; x.fillStyle = tone || P.inkSoft; x.fillText(sub, rx + 9, ry + 18); }
  };
  const u = (n) => n * U;
  plate(u(plan.office.x + 1), u(plan.office.y + 1), 'YOUR OFFICE',
    info.owed ? `${info.owed} waiting · oldest ${info.oldest}` : 'nobody waiting',
    info.owed ? S.owed : S.working);
  plate(u(plan.lobby.x + 1), u(plan.lobby.y + 1), 'LOBBY', `${info.idle} on the bench`);
  plate(u(plan.cafe.x + 1), u(plan.cafe.y + 1), 'BREAK AREA', 'free to assign');
  plate(u(plan.kitchen.x + 1), u(plan.kitchen.y + 1), 'KITCHEN', '');
  for (const pod of plan.pods) {
    const z = pod.zone;
    plate(u(pod.x + 1), u(pod.y + 0.5), z.name.length > 18 ? z.name.slice(0, 17) + '…' : z.name,
      `${z.tokens >= 1e6 ? (z.tokens / 1e6).toFixed(1) + 'M' : Math.round(z.tokens / 1000) + 'k'} tokens${z.owed ? ` · ${z.owed} waiting` : ''}`,
      z.owed ? S.owed : P.inkSoft);
  }
  x.restore();
}

/* ---------------------------------------------------------------- people */
export function drawPerson(x, px, py, place, opts = {}) {
  const col = S[place] || S.idle;
  const cx = px * U, cy = py * U;
  const bob = opts.bob || 0;

  x.save();
  x.translate(cx, cy + bob);
  // contact shadow
  x.fillStyle = 'rgba(55,45,32,0.26)';
  x.beginPath(); x.ellipse(2, 9, 12, 5.4, 0, 0, Math.PI * 2); x.fill();
  // shoulders
  x.fillStyle = col;
  x.beginPath(); x.ellipse(0, 2.5, 11.5, 8.6, 0, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(255,255,255,0.22)';
  x.beginPath(); x.ellipse(-3.2, 0.4, 5.8, 4.2, 0, 0, Math.PI * 2); x.fill();
  // head
  x.fillStyle = '#E4B98E';
  x.beginPath(); x.arc(0, -4.6, 7, 0, Math.PI * 2); x.fill();
  x.fillStyle = 'rgba(60,42,28,0.85)';
  x.beginPath(); x.arc(0, -6.1, 6.7, Math.PI * 0.06, Math.PI * 0.94, true); x.fill();

  if (opts.live) {
    x.fillStyle = '#2E7D63';
    x.beginPath(); x.arc(11.5, -10, 3.2, 0, Math.PI * 2); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.9)'; x.lineWidth = 1; x.stroke();
  }
  if (opts.selected || opts.hovered) {
    x.strokeStyle = opts.selected ? S.owed : 'rgba(90,80,66,0.5)';
    x.lineWidth = opts.selected ? 2 : 1.2;
    x.beginPath(); x.arc(0, 0, 19, 0, Math.PI * 2); x.stroke();
  }
  x.restore();

  if (opts.badge) {
    x.save();
    x.font = '700 10px "JetBrains Mono", monospace';
    const w = x.measureText(opts.badge).width + 10;
    x.shadowColor = 'rgba(55,45,32,0.25)'; x.shadowBlur = 6; x.shadowOffsetY = 2;
    x.fillStyle = S.owed;
    roundRect(x, cx - w / 2, cy - 30, w, 15, 4); x.fill();
    x.shadowColor = 'transparent';
    x.fillStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(opts.badge, cx, cy - 22);
    x.restore();
  }
}

export const STATE_COLORS = S;
