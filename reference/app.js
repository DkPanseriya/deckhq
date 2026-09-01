import * as Studio from './studio.js';
/* DeckHQ — floor renderer and session panel.
 *
 * Placement is a function of where an agent is in its working life, not of a
 * session flag:
 *
 *   owed    -> the waiting room in your office. Only you put them there and
 *              only you take them out. Opening a chat never clears it.
 *   working -> at the bench in their project zone. Live session, burning tokens.
 *   idle    -> the lobby. Acknowledged, no work assigned, available. Free.
 *   fired   -> off the floor entirely.
 */

const COLS = 4;
const CELL_W = 15;
const CELL_H = 13;
const SPEED = 0.17;

const cv = document.getElementById('floor');
const g = cv.getContext('2d');
const tip = document.getElementById('tip');
const dock = document.getElementById('dock');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let state = { agents: [], zones: [], counts: {} };
let layout = null;
const sprites = new Map();
let selectedId = null;
let showFired = false;
let hovered = null;
// Default is 'studio': the architectural render. Its whole backdrop is baked to
// an offscreen bitmap once per layout change, so the texture costs nothing per
// frame. 'blueprint' is the low-ink alternative for triage days; both are one
// click away in the top bar. See README "On skins".
let skin = localStorage.getItem('office.skin') || 'studio';
let plan = null, backdrop = null;

const $ = (id) => document.getElementById(id);
const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1000 ? Math.round(n / 1000) + 'k' : String(n || 0));
function fmtAge(ms) {
  if (!ms || ms < 0) return '—';
  const m = Math.floor(ms / 60000);
  if (m < 60) return m + 'm';
  const h = Math.floor(m / 60);
  if (h < 24) return h + 'h';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
}
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
let C = {};
function readColors() {
  ['--floor', '--floor-alt', '--zone', '--lobby', '--wall', '--part', '--desk', '--board',
   '--ink', '--ink-2', '--muted', '--accent', '--working', '--snoozed', '--live',
   '--surface', '--line', '--bg'].forEach((k) => { C[k] = css(k); });
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------------------------------------------------- placement */
function placementOf(a) {
  if (a.ackState === 'archived') return 'fired';
  if (a.ackState === 'owed' || a.ackState === 'snoozed') return 'owed';
  return a.live ? 'working' : 'idle';
}

/* ------------------------------------------------------------- layout */
function buildLayout(zones) {
  const cells = zones.length + 2;                   // office + lobby + zones
  const rows = Math.max(1, Math.ceil(cells / COLS));
  const GW = COLS * CELL_W + 2;
  const GH = rows * CELL_H + 2;

  const grid = Array.from({ length: GH }, () => new Uint8Array(GW));
  const set = (x, y, v) => { if (x >= 0 && y >= 0 && x < GW && y < GH) grid[y][x] = v; };

  for (let x = 0; x < GW; x++) { set(x, 0, 1); set(x, GH - 1, 1); }
  for (let y = 0; y < GH; y++) { set(0, y, 1); set(GW - 1, y, 1); }

  const boxOf = (i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    return { x: 1 + col * CELL_W, y: 1 + row * CELL_H, w: CELL_W - 1, h: CELL_H - 1 };
  };

  // --- your office, enclosed, top-left
  const mb = boxOf(0);
  const mgr = { ...mb, door: { x: mb.x + Math.floor(mb.w / 2), y: mb.y + mb.h } };
  for (let y = mgr.y; y <= mgr.y + mgr.h; y++) set(mgr.x + mgr.w, y, 1);
  for (let x = mgr.x; x <= mgr.x + mgr.w; x++) set(x, mgr.y + mgr.h, 1);
  set(mgr.door.x, mgr.door.y, 0); set(mgr.door.x + 1, mgr.door.y, 0);

  const queue = [];
  const perRow = Math.max(3, Math.floor((mgr.w - 3) / 2));
  for (let i = 0; i < perRow * 3; i++) {
    queue.push({ x: mgr.x + 2 + (i % perRow) * 2, y: mgr.y + 6 + Math.floor(i / perRow) * 2 });
  }

  // --- lobby: sofas, coffee, games. No walls, just a partition run.
  const lb = boxOf(1);
  const lobby = { ...lb };
  lobby.sofaA = { x: lb.x + 2, y: lb.y + 3, w: 4, h: 1 };
  lobby.sofaB = { x: lb.x + 2, y: lb.y + 7, w: 4, h: 1 };
  lobby.table = { x: lb.x + 8, y: lb.y + 4, r: 2 };
  lobby.coffee = { x: lb.x + 10, y: lb.y + 9, w: 2, h: 1 };
  lobby.arcade = { x: lb.x + 1, y: lb.y + 9, w: 1, h: 1 };
  lobby.spots = [
    { x: lb.x + 2, y: lb.y + 4 }, { x: lb.x + 4, y: lb.y + 4 },
    { x: lb.x + 2, y: lb.y + 8 }, { x: lb.x + 4, y: lb.y + 8 },
    { x: lb.x + 7, y: lb.y + 4 }, { x: lb.x + 10, y: lb.y + 4 },
    { x: lb.x + 8, y: lb.y + 2 }, { x: lb.x + 8, y: lb.y + 6 },
    { x: lb.x + 10, y: lb.y + 8 }, { x: lb.x + 2, y: lb.y + 10 },
    { x: lb.x + 6, y: lb.y + 10 }, { x: lb.x + 11, y: lb.y + 2 },
  ];
  for (let x = lb.x; x <= lb.x + lb.w - 5; x++) set(x, lb.y, 2);
  for (const f of [lobby.sofaA, lobby.sofaB, lobby.coffee]) {
    for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) set(x, y, 3);
  }

  // --- project zones
  const zoneBoxes = zones.map((z, i) => {
    const b = boxOf(i + 2);
    const bench = { x: b.x + 3, y: b.y + 5, w: 8, h: 2 };
    const seats = [];
    for (let k = 0; k < 4; k++) seats.push({ x: bench.x + k * 2, y: bench.y - 1 });
    for (let k = 0; k < 4; k++) seats.push({ x: bench.x + k * 2, y: bench.y + bench.h });
    const partTop = { y: b.y, x0: b.x, x1: b.x + b.w - 5 };
    const partLeft = { x: b.x, y0: b.y, y1: b.y + b.h - 4 };
    for (let x = partTop.x0; x <= partTop.x1; x++) set(x, partTop.y, 2);
    for (let y = partLeft.y0; y <= partLeft.y1; y++) set(partLeft.x, y, 2);
    for (let by = bench.y; by < bench.y + bench.h; by++)
      for (let bx = bench.x; bx < bench.x + bench.w; bx++) set(bx, by, 3);
    return { ...b, zone: z, bench, seats, partTop, partLeft };
  });

  const walk = (x, y) => x >= 0 && y >= 0 && x < GW && y < GH && grid[y][x] === 0;
  return { GW, GH, grid, mgr, queue, lobby, zoneBoxes, walk };
}

function bfs(sx, sy, tx, ty) {
  if (!layout || (sx === tx && sy === ty)) return [];
  const { GW, GH, walk } = layout;
  const seen = new Uint8Array(GW * GH);
  const prev = new Int32Array(GW * GH).fill(-1);
  const start = sy * GW + sx, target = ty * GW + tx;
  const q = [start]; seen[start] = 1;
  while (q.length) {
    const c = q.shift();
    const cx = c % GW, cy = (c / GW) | 0;
    for (let i = 0; i < 4; i++) {
      const nx = cx + (i === 0 ? 1 : i === 1 ? -1 : 0);
      const ny = cy + (i === 2 ? 1 : i === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const n = ny * GW + nx;
      if (seen[n]) continue;
      if (!walk(nx, ny) && n !== target) continue;
      seen[n] = 1; prev[n] = c;
      if (n === target) {
        const path = []; let cur = n;
        while (cur !== -1 && cur !== start) { path.unshift([cur % GW, (cur / GW) | 0]); cur = prev[cur]; }
        return path;
      }
      q.push(n);
    }
  }
  return [];
}

/* -------------------------------------------------------------- sprites */
function targetFor(a, counters, owedIdx) {
  const place = placementOf(a);
  if (place === 'owed') return layout.queue[Math.min(owedIdx, layout.queue.length - 1)];
  if (place === 'idle') {
    const i = counters.lobby++;
    return layout.lobby.spots[i % layout.lobby.spots.length];
  }
  const zb = layout.zoneBoxes.find((z) => z.zone.id === a.project);
  if (!zb) { const i = counters.lobby++; return layout.lobby.spots[i % layout.lobby.spots.length]; }
  const i = counters.zone.get(a.project) || 0;
  counters.zone.set(a.project, i + 1);
  return zb.seats[i % zb.seats.length];
}

function studioTarget(a, counters, owedIdx) {
  const place = placementOf(a);
  if (place === 'owed') return plan.waiting[Math.min(owedIdx, plan.waiting.length - 1)];
  if (place === 'idle') { const i = counters.lobby++; return plan.lounge[i % plan.lounge.length]; }
  const pod = plan.pods.find((p) => p.zone.id === a.project);
  if (!pod) { const i = counters.lobby++; return plan.lounge[i % plan.lounge.length]; }
  const i = counters.zone.get(a.project) || 0;
  counters.zone.set(a.project, i + 1);
  return pod.seats[i % pod.seats.length];
}

function syncSprites() {
  const visible = state.agents.filter((a) => showFired || placementOf(a) !== 'fired');
  const owed = visible.filter((a) => placementOf(a) === 'owed')
    .sort((a, b) => (a.lastTs || 0) - (b.lastTs || 0));
  const owedIndex = new Map(owed.map((a, i) => [a.id, i]));
  const counters = { lobby: 0, zone: new Map() };

  const seen = new Set();
  for (const a of visible) {
    seen.add(a.id);
    const t = skin === 'studio'
      ? studioTarget(a, counters, owedIndex.get(a.id) ?? 0)
      : targetFor(a, counters, owedIndex.get(a.id) ?? 0);
    let s = sprites.get(a.id);
    if (!s) { s = { px: t.x, py: t.y, path: null, target: t, bob: Math.random() * 6.28 }; sprites.set(a.id, s); }
    s.agent = a;
    s.place = placementOf(a);
    if (!s.target || s.target.x !== t.x || s.target.y !== t.y) {
      s.target = t;
      if (skin === 'studio') { s.path = reduced ? null : [[t.x, t.y]]; if (reduced) { s.px = t.x; s.py = t.y; } }
      else {
        const p = bfs(Math.round(s.px), Math.round(s.py), t.x, t.y);
        if (!p.length || reduced) { s.px = t.x; s.py = t.y; s.path = null; }
        else s.path = p;
      }
    }
  }
  for (const id of [...sprites.keys()]) if (!seen.has(id)) sprites.delete(id);
}

/* ---------------------------------------------------------------- skins */
const SPR = ['..hh..', '.hhhh.', '..ff..', '.ssss.', 'assssa', '.ssss.', '.l..l.', '.l..l.'];

const SKINS = {
  pixel: {
    label: 'Pixel',
    TS: 16,
    size(GW, GH) { return [GW * 16, GH * 16]; },
    project(x, y) { return [x * 16, y * 16]; },
    unproject(sx, sy) { return [sx / 16, sy / 16]; },
    depth() { return 0; },
  },
  iso: {
    label: 'Isometric',
    TS: 16,
    TW: 32, TH: 16, LIFT: 10,
    size(GW, GH) { return [(GW + GH) * 16 + 64, (GW + GH) * 8 + 120]; },
    origin(GW) { return [GH_ORIGIN_X(GW), 60]; },
    project(x, y) {
      const s = SKINS.iso, o = s._o;
      return [(x - y) * (s.TW / 2) + o[0], (x + y) * (s.TH / 2) + o[1]];
    },
    unproject(sx, sy) {
      const s = SKINS.iso, o = s._o;
      const dx = sx - o[0], dy = sy - o[1];
      return [(dx / (s.TW / 2) + dy / (s.TH / 2)) / 2, (dy / (s.TH / 2) - dx / (s.TW / 2)) / 2];
    },
    depth(x, y) { return x + y; },
  },
  blueprint: {
    label: 'Blueprint',
    TS: 16,
    size(GW, GH) { return [GW * 16, GH * 16]; },
    project(x, y) { return [x * 16, y * 16]; },
    unproject(sx, sy) { return [sx / 16, sy / 16]; },
    depth() { return 0; },
  },
};
function GH_ORIGIN_X(GW) { return GW * 16; }

const S = () => SKINS[skin];

/* --------------------------------------------------------------- render */
function tileRect(x, y, w, h, fill, stroke) {
  const s = S();
  if (skin === 'iso') {
    const pts = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]].map(([a, b]) => s.project(a, b));
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < 4; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
  } else {
    const [px, py] = s.project(x, y);
    if (fill) { g.fillStyle = fill; g.fillRect(px, py, w * s.TS, h * s.TS); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.strokeRect(px, py, w * s.TS, h * s.TS); }
  }
}

function box3d(x, y, w, h, lift, top, side) {
  const s = S();
  if (skin !== 'iso') { tileRect(x, y, w, h, top, C['--wall']); return; }
  const p = (a, b) => s.project(a, b);
  const c = [p(x, y), p(x + w, y), p(x + w, y + h), p(x, y + h)];
  // side faces
  g.fillStyle = side;
  for (const [a, b] of [[c[1], c[2]], [c[2], c[3]]]) {
    g.beginPath();
    g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]);
    g.lineTo(b[0], b[1] - lift); g.lineTo(a[0], a[1] - lift);
    g.closePath(); g.fill();
  }
  g.fillStyle = top;
  g.beginPath(); g.moveTo(c[0][0], c[0][1] - lift);
  for (let i = 1; i < 4; i++) g.lineTo(c[i][0], c[i][1] - lift);
  g.closePath(); g.fill();
  g.strokeStyle = C['--wall']; g.lineWidth = 1; g.stroke();
}

function drawFloorBase() {
  const { GW, GH, mgr, lobby, zoneBoxes } = layout;
  const bp = skin === 'blueprint';
  g.fillStyle = bp ? C['--bg'] : C['--floor'];
  g.fillRect(0, 0, cv.width, cv.height);

  if (skin === 'pixel' || bp) {
    g.strokeStyle = bp ? C['--line'] : C['--floor-alt'];
    g.lineWidth = 1;
    const s = S();
    for (let x = 1; x < GW; x++) { const [px] = s.project(x, 0); g.beginPath(); g.moveTo(px + 0.5, 0); g.lineTo(px + 0.5, GH * s.TS); g.stroke(); }
    for (let y = 1; y < GH; y++) { const [, py] = s.project(0, y); g.beginPath(); g.moveTo(0, py + 0.5); g.lineTo(GW * s.TS, py + 0.5); g.stroke(); }
  } else {
    // iso: draw the slab as one diamond
    tileRect(0, 0, GW, GH, C['--floor'], null);
  }

  // room tints
  for (const z of zoneBoxes) tileRect(z.x, z.y, z.w, z.h, bp ? 'transparent' : C['--zone'], bp ? C['--line'] : null);
  tileRect(mgr.x, mgr.y, mgr.w, mgr.h, bp ? 'transparent' : C['--zone'], bp ? C['--line'] : null);
  tileRect(lobby.x, lobby.y, lobby.w, lobby.h, bp ? 'transparent' : C['--lobby'], bp ? C['--line'] : null);
}

function drawStructure() {
  const { GW, GH, mgr, lobby, zoneBoxes } = layout;
  const bp = skin === 'blueprint';

  // walls
  if (skin === 'iso') {
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      if (layout.grid[y][x] === 1) box3d(x, y, 1, 1, S().LIFT, C['--wall'], C['--part']);
    }
  } else {
    g.fillStyle = bp ? C['--ink'] : C['--wall'];
    for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) {
      if (layout.grid[y][x] === 1) { const [px, py] = S().project(x, y); g.fillRect(px, py, S().TS, S().TS); }
    }
  }

  // door swing
  const s = S();
  const [dx, dy] = s.project(mgr.door.x, mgr.door.y + 1);
  g.strokeStyle = bp ? C['--ink'] : C['--wall']; g.lineWidth = 1.5;
  g.beginPath(); g.arc(dx, dy, s.TS * (skin === 'iso' ? 1.2 : 2), -Math.PI / 2, 0); g.stroke();

  // partitions
  const th = 0.3;
  for (const z of zoneBoxes) {
    tileRect(z.partTop.x0, z.partTop.y + 0.35, z.partTop.x1 - z.partTop.x0 + 1, th, C['--part'], null);
    tileRect(z.partLeft.x + 0.35, z.partLeft.y0, th, z.partLeft.y1 - z.partLeft.y0 + 1, C['--part'], null);
  }
  tileRect(lobby.x, lobby.y + 0.35, lobby.w - 4, th, C['--part'], null);

  // benches
  for (const z of zoneBoxes) {
    if (skin === 'iso') box3d(z.bench.x, z.bench.y, z.bench.w, z.bench.h, 6, C['--desk'], C['--part']);
    else tileRect(z.bench.x, z.bench.y, z.bench.w, z.bench.h, bp ? 'transparent' : C['--desk'], bp ? C['--ink'] : C['--wall']);
  }

  // lobby furniture
  const L = lobby;
  for (const sofa of [L.sofaA, L.sofaB]) {
    if (skin === 'iso') box3d(sofa.x, sofa.y, sofa.w, sofa.h, 5, C['--desk'], C['--part']);
    else tileRect(sofa.x, sofa.y, sofa.w, sofa.h, bp ? 'transparent' : C['--desk'], bp ? C['--ink'] : C['--wall']);
  }
  // round table
  const [tx, ty] = s.project(L.table.x, L.table.y);
  g.fillStyle = bp ? 'transparent' : C['--desk'];
  g.strokeStyle = bp ? C['--ink'] : C['--wall']; g.lineWidth = 1;
  g.beginPath();
  g.ellipse(tx, ty, s.TS * 1.6, s.TS * (skin === 'iso' ? 0.8 : 1.6), 0, 0, Math.PI * 2);
  if (!bp) g.fill();
  g.stroke();
  // coffee counter + arcade
  if (skin === 'iso') { box3d(L.coffee.x, L.coffee.y, L.coffee.w, L.coffee.h, 8, C['--desk'], C['--part']); box3d(L.arcade.x, L.arcade.y, 1, 1, 12, C['--accent'], C['--part']); }
  else {
    tileRect(L.coffee.x, L.coffee.y, L.coffee.w, L.coffee.h, bp ? 'transparent' : C['--desk'], bp ? C['--ink'] : C['--wall']);
    tileRect(L.arcade.x, L.arcade.y, 1, 1, bp ? 'transparent' : C['--accent'], bp ? C['--ink'] : C['--wall']);
  }
}

function label(text, x, y, color, weight = '600', size = 9) {
  const [px, py] = S().project(x, y);
  g.fillStyle = color; g.textAlign = 'left'; g.textBaseline = 'top';
  g.font = `${weight} ${size}px "JetBrains Mono", monospace`;
  g.fillText(text, px + 4, py + 3);
}

function panel(x, y, wTiles, lines) {
  const s = S();
  const [px, py] = s.project(x, y);
  const w = wTiles * s.TS, h = lines.length * 11 + 9;
  g.fillStyle = skin === 'blueprint' ? C['--bg'] : C['--board'];
  g.fillRect(px, py, w, h);
  g.strokeStyle = skin === 'blueprint' ? C['--ink'] : C['--part'];
  g.lineWidth = 1; g.strokeRect(px, py, w, h);
  g.font = '400 8px "JetBrains Mono", monospace';
  g.textAlign = 'left'; g.textBaseline = 'top';
  lines.forEach((l, i) => { g.fillStyle = l[1] || C['--ink-2']; g.fillText(l[0], px + 5, py + 5 + i * 11); });
}

function drawChrome() {
  const { mgr, lobby, zoneBoxes } = layout;
  const dim = C['--muted'];
  for (const z of zoneBoxes) {
    const name = z.zone.name.length > 20 ? z.zone.name.slice(0, 19) + '…' : z.zone.name;
    label(name.toUpperCase(), z.x, z.y, dim);
    const working = state.agents.filter((a) => a.project === z.zone.id && placementOf(a) === 'working').length;
    panel(z.x + z.w - 6, z.y + 0.5, 5.6, [
      [`at bench  ${working}`, working ? C['--working'] : C['--muted']],
      [`tokens  ${fmtTok(z.zone.tokens)}`],
      [`owes you  ${z.zone.owed}`, z.zone.owed ? C['--accent'] : C['--muted']],
    ]);
  }

  label('LOBBY — ON THE BENCH', lobby.x, lobby.y, dim);
  const idle = state.agents.filter((a) => placementOf(a) === 'idle').length;
  panel(lobby.x + lobby.w - 6, lobby.y + 0.5, 5.6, [
    [`idle  ${idle}`, idle ? C['--ink-2'] : C['--muted']],
    ['free to assign', C['--muted']],
  ]);

  label("YOUR OFFICE", mgr.x, mgr.y, dim);
  const owed = state.agents.filter((a) => placementOf(a) === 'owed');
  const oldest = owed.reduce((m, a) => Math.max(m, Date.now() - (a.lastTs || Date.now())), 0);
  panel(mgr.x + mgr.w - 6.5, mgr.y + 0.5, 6.2, [
    [`waiting  ${owed.length}`, owed.length ? C['--accent'] : C['--working']],
    [`oldest  ${owed.length ? fmtAge(oldest) : '—'}`, owed.length ? C['--accent'] : C['--muted']],
    [`working  ${state.agents.filter((a) => placementOf(a) === 'working').length}`, C['--working']],
  ]);

  // waiting-room marking
  const s = S();
  const [wx, wy] = s.project(mgr.x + 1, mgr.y + 5.4);
  g.strokeStyle = owed.length ? C['--accent'] : C['--part'];
  g.setLineDash([3, 3]); g.lineWidth = 1;
  if (skin === 'iso') {
    tileRect(mgr.x + 1, mgr.y + 5.4, mgr.w - 2, 5.4, null, owed.length ? C['--accent'] : C['--part']);
  } else {
    g.strokeRect(wx, wy, (mgr.w - 2) * s.TS, 5.4 * s.TS);
  }
  g.setLineDash([]);
  g.fillStyle = owed.length ? C['--accent'] : C['--muted'];
  g.font = '700 8px "JetBrains Mono", monospace';
  const [lx, ly] = s.project(mgr.x + 1, mgr.y + 4.6);
  g.fillText('WAITING ON YOU', lx, ly);
}

function colorFor(s) {
  if (s.place === 'owed') return C['--accent'];
  if (s.place === 'working') return C['--working'];
  if (s.place === 'fired') return C['--snoozed'];
  return C['--muted'];                       // idle, on the bench
}

function drawSprite(s) {
  const a = s.agent;
  const col = colorFor(s);
  const sk = S();
  const [bx, by] = sk.project(s.px + 0.5, s.py + 0.5);
  const bob = s.place === 'working' ? Math.sin(Date.now() / 380 + s.bob) * 1.1 : 0;
  const scale = 3;
  const ox = bx - 3 * scale, oy = by - (skin === 'iso' ? 8 * scale - 4 : 4 * scale) + bob;

  if (skin === 'blueprint') {
    // technical drawing: a ringed plan symbol, not a figure
    g.strokeStyle = col; g.lineWidth = 1.4;
    g.beginPath(); g.arc(bx, by, 5.5, 0, Math.PI * 2); g.stroke();
    g.beginPath(); g.moveTo(bx, by - 5.5); g.lineTo(bx, by - 9); g.stroke();
    if (s.place === 'owed') { g.fillStyle = col; g.beginPath(); g.arc(bx, by, 2.4, 0, Math.PI * 2); g.fill(); }
  } else {
    const pal = { h: C['--ink'], f: '#D9A06B', s: col, a: col, l: C['--muted'] };
    for (let r = 0; r < 8; r++) for (let q = 0; q < 6; q++) {
      const ch = SPR[r][q]; if (ch === '.') continue;
      g.fillStyle = pal[ch] || col;
      g.fillRect(ox + q * scale, oy + r * scale, scale, scale);
    }
  }

  if (a.live) { g.fillStyle = C['--live']; g.beginPath(); g.arc(ox + 6 * scale + 2, oy - 1, 2, 0, Math.PI * 2); g.fill(); }
  if (a.id === selectedId) { g.strokeStyle = C['--accent']; g.lineWidth = 1.5; g.strokeRect(ox - 4, oy - 4, 6 * scale + 8, 8 * scale + 8); }
  else if (a === hovered) { g.strokeStyle = C['--line']; g.lineWidth = 1; g.strokeRect(ox - 4, oy - 4, 6 * scale + 8, 8 * scale + 8); }

  if (s.place === 'owed') {
    g.fillStyle = C['--accent']; g.font = '700 8px "JetBrains Mono", monospace';
    g.textAlign = 'center';
    g.fillText(fmtAge(Date.now() - (a.lastTs || Date.now())), bx, oy - 7);
    g.textAlign = 'left';
  }
}

function drawAll() {
  if (skin === 'studio') return drawStudio();
  if (!layout) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  drawFloorBase();
  drawStructure();
  drawChrome();
  const list = [...sprites.values()];
  if (skin === 'iso') list.sort((a, b) => (a.px + a.py) - (b.px + b.py));
  for (const s of list) drawSprite(s);
}

let zoom = Number(localStorage.getItem('office.zoom') || 0) || 0;   // 0 = fit
function fitStudio() {
  const stage = document.querySelector('.stage');
  const avail = stage.clientWidth - 32;
  const scale = zoom || Math.min(1, avail / cv.width);
  cv.style.width = Math.round(cv.width * scale) + 'px';
  cv.style.height = 'auto';
}
addEventListener('resize', () => { if (skin === 'studio') fitStudio(); });

function drawStudio() {
  if (!plan || !backdrop) return;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, cv.width, cv.height);
  g.drawImage(backdrop, 0, 0);
  const owed = state.agents.filter((a) => placementOf(a) === 'owed');
  const oldest = owed.reduce((m, a) => Math.max(m, Date.now() - (a.lastTs || Date.now())), 0);
  Studio.drawLabels(g, plan, {
    owed: owed.length, oldest: owed.length ? fmtAge(oldest) : '—',
    idle: state.agents.filter((a) => placementOf(a) === 'idle').length,
  });
  const list = [...sprites.values()].sort((p, q) => p.py - q.py);
  for (const s of list) {
    Studio.drawPerson(g, s.px, s.py, s.place, {
      live: s.agent.live,
      bob: s.place === 'working' ? Math.sin(Date.now() / 420 + s.bob) * 1.6 : 0,
      selected: s.agent.id === selectedId,
      hovered: s.agent === hovered,
      badge: s.place === 'owed' ? fmtAge(Date.now() - (s.agent.lastTs || Date.now())) : null,
    });
  }
}

function frame() {
  if (skin === 'studio') { moveSprites(0.32); drawStudio(); return requestAnimationFrame(frame); }
  if (layout) {
    moveSprites(SPEED);
    drawAll();
  }
  requestAnimationFrame(frame);
}

function moveSprites(speed) {
    for (const s of sprites.values()) {
      if (s.path && s.path.length) {
        const n = s.path[0], dx = n[0] - s.px, dy = n[1] - s.py, d = Math.hypot(dx, dy);
        if (d <= SPEED) { s.px = n[0]; s.py = n[1]; s.path.shift(); if (!s.path.length) s.path = null; }
        else { s.px += (dx / d) * SPEED; s.py += (dy / d) * SPEED; }
      } else if (skin !== 'studio' && s.target && (Math.round(s.px) !== s.target.x || Math.round(s.py) !== s.target.y)) {
        const p = bfs(Math.round(s.px), Math.round(s.py), s.target.x, s.target.y);
        if (p.length) s.path = p; else { s.px = s.target.x; s.py = s.target.y; }
      }
    }
}
window.__office = { drawAll, get state() { return state; }, get sprites() { return sprites; }, get skin() { return skin; } };

/* ---------------------------------------------------------- interaction */
function hitAt(ev) {
  const r = cv.getBoundingClientRect();
  const sx = (ev.clientX - r.left) * (cv.width / r.width);
  const sy = (ev.clientY - r.top) * (cv.height / r.height);
  let tx, ty, bd;
  if (skin === 'studio') { tx = sx / Studio.U; ty = sy / Studio.U; bd = 1.4; }
  else { [tx, ty] = S().unproject(sx, sy); bd = skin === 'iso' ? 1.6 : 1.1; }
  let best = null;
  for (const s of sprites.values()) {
    const d = Math.hypot(s.px + (skin === "studio" ? 0 : 0.5) - tx, s.py + (skin === "studio" ? 0 : 0.5) - ty);
    if (d < bd) { bd = d; best = s.agent; }
  }
  return best;
}

cv.addEventListener('mousemove', (ev) => {
  const a = hitAt(ev);
  hovered = a;
  cv.classList.toggle('is-hit', Boolean(a));
  if (!a) { tip.dataset.show = '0'; return; }
  const place = placementOf(a);
  const age = Date.now() - (a.lastTs || Date.now());
  tip.innerHTML =
    `<div class="tip-t">${esc(a.title)}</div>` +
    `<div class="tip-dim">${esc(a.project)}${a.model ? ' · ' + esc(a.model.replace('claude-', '')) : ''}</div>` +
    `<div class="tip-dim">${fmtTok(a.tokens)} tokens</div>` +
    (place === 'owed' ? `<div class="tip-owed">waiting on you ${fmtAge(age)}</div>`
      : place === 'working' ? `<div class="tip-work">at the bench · running</div>`
      : `<div class="tip-dim">on the bench · idle ${fmtAge(age)}</div>`);
  tip.dataset.show = '1';
  const w = tip.offsetWidth, h = tip.offsetHeight;
  let lx = ev.clientX + 14, ly = ev.clientY + 14;
  if (lx + w > innerWidth - 8) lx = ev.clientX - w - 14;
  if (ly + h > innerHeight - 8) ly = ev.clientY - h - 14;
  tip.style.left = lx + 'px'; tip.style.top = ly + 'px';
});
cv.addEventListener('mouseleave', () => { tip.dataset.show = '0'; hovered = null; });
cv.addEventListener('click', (ev) => { const a = hitAt(ev); if (a) openDock(a.id); });

/* ------------------------------------------------------------------ dock */
const agentById = (id) => state.agents.find((a) => a.id === id);

async function openDock(id) {
  selectedId = id;
  const a = agentById(id);
  if (!a) return;
  dock.hidden = false;
  renderDockHead(a);
  $('d-thread').innerHTML = '<div class="skeleton">' + '<div class="sk-line"></div>'.repeat(6) + '</div>';
  try {
    const r = await fetch('/api/conversation?id=' + encodeURIComponent(id));
    const data = await r.json();
    renderThread(data.messages || [], data.note);
  } catch (e) {
    $('d-thread').innerHTML = `<p class="msg-more">Could not load this conversation: ${esc(e.message)}</p>`;
  }
}

const PLACE_LABEL = { owed: 'waiting on you', working: 'at the bench', idle: 'on the bench', fired: 'let go' };

function renderDockHead(a) {
  const place = placementOf(a);
  $('d-title').textContent = a.title;
  const age = Date.now() - (a.lastTs || Date.now());
  $('d-meta').innerHTML =
    `<span class="chip chip--${place}">${PLACE_LABEL[place]}</span>` +
    (a.live ? '<span class="chip chip--live">running</span>' : '') +
    `<span>${esc(a.project)}</span>` +
    (a.model ? `<span>${esc(a.model.replace('claude-', ''))}</span>` : '') +
    (a.gitBranch ? `<span>${esc(a.gitBranch)}</span>` : '');

  $('d-facts').innerHTML =
    `<div class="fact"><div class="fact-v">${fmtTok(a.tokens)}</div><div class="fact-k">tokens</div></div>` +
    `<div class="fact${place === 'owed' ? ' fact--owed' : ''}"><div class="fact-v">${fmtAge(age)}</div><div class="fact-k">${place === 'owed' ? 'waiting' : 'idle for'}</div></div>` +
    `<div class="fact"><div class="fact-v">${fmtTok(a.cacheTokens || 0)}</div><div class="fact-k">cache</div></div>`;

  const acts = [];
  if (place === 'owed') acts.push('<button class="btn btn--primary" data-act="acknowledge">Acknowledge &amp; send to lobby</button>');
  else if (place !== 'fired') acts.push('<button class="btn" data-act="owe">Mark for follow-up</button>');
  if (place === 'fired') acts.push('<button class="btn" data-act="restore">Re-hire</button>');
  else acts.push('<button class="btn btn--danger" data-act="archive">Let go</button>');
  acts.push('<button class="btn" data-act="open">Open in terminal</button>');
  $('d-actions').innerHTML = acts.join('');

  const hint = $('d-hint');
  if (a.live) { hint.textContent = 'Running now — sending starts a second turn. Prefer the terminal.'; hint.classList.add('is-warn'); }
  else { hint.textContent = place === 'idle' ? 'Sending assigns new work and puts them back at the bench.' : 'Resumes the session with your message.'; hint.classList.remove('is-warn'); }
}

function renderThread(messages, note) {
  const el = $('d-thread');
  if (!messages.length) { el.innerHTML = `<p class="msg-more">${esc(note || 'No conversation recorded yet.')}</p>`; return; }
  el.innerHTML = `<div class="msg-more">last ${messages.length} messages</div>` +
    messages.map((m) => {
      const body = m.text.length > 4000 ? m.text.slice(0, 4000) + '\n\n[…truncated]' : m.text;
      return `<div class="msg msg--${m.role === 'user' ? 'user' : 'assistant'}">
        <div class="msg-who">${m.role === 'user' ? 'you' : 'claude'}</div>
        <div class="msg-body">${esc(body)}</div></div>`;
    }).join('');
  el.scrollTop = el.scrollHeight;
}

$('d-close').addEventListener('click', () => { dock.hidden = true; selectedId = null; });

$('d-actions').addEventListener('click', async (ev) => {
  const btn = ev.target.closest('[data-act]');
  if (!btn || !selectedId) return;
  const act = btn.dataset.act;
  btn.disabled = true;
  try {
    if (act === 'open') {
      await fetch('/api/open', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: selectedId }) });
      toast('Opening a terminal for this session…');
    } else {
      await fetch('/api/ack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: selectedId, action: act, hours: 24 }) });
      toast({ acknowledge: 'Acknowledged — off to the lobby.', archive: 'Let go.', owe: 'Moved to your waiting room.', restore: 'Re-hired.' }[act] || 'Updated.');
      await refresh(true);
      const a = agentById(selectedId);
      if (a) renderDockHead(a); else { dock.hidden = true; selectedId = null; }
    }
  } catch (e) { toast('That did not work: ' + e.message, true); }
  finally { btn.disabled = false; }
});

$('d-form').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const input = $('d-input'), text = input.value.trim();
  if (!text || !selectedId) return;
  const a = agentById(selectedId);
  if (a?.live && !confirm('This session is running in a terminal right now. Sending starts a second turn on it. Continue?')) return;
  const send = $('d-send');
  send.disabled = true; send.textContent = 'Sending…'; input.disabled = true;
  try {
    const r = await fetch('/api/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: selectedId, text }) });
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || 'send failed');
    input.value = '';
    toast('Sent. Reloading the thread.');
    await refresh(true); await openDock(selectedId);
  } catch (e) { toast('Send failed: ' + e.message, true); }
  finally { send.disabled = false; send.textContent = 'Send'; input.disabled = false; }
});

/* ----------------------------------------------------------------- misc */
let toastTimer;
function toast(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg; t.classList.toggle('is-error', isError); t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 4200);
}

function renderStats() {
  const owed = state.agents.filter((a) => placementOf(a) === 'owed');
  const oldest = owed.reduce((m, a) => Math.max(m, Date.now() - (a.lastTs || Date.now())), 0);
  $('s-owed').textContent = owed.length;
  $('s-oldest').textContent = owed.length ? fmtAge(oldest) : '—';
  $('s-floor').textContent = state.agents.filter((a) => placementOf(a) === 'working').length;
  $('s-live').textContent = state.agents.filter((a) => placementOf(a) === 'idle').length;
  $('s-owed').closest('.stat').classList.toggle('is-zero', owed.length === 0);
  $('s-oldest').closest('.stat').classList.toggle('is-zero', owed.length === 0);
  document.title = owed.length ? `(${owed.length}) DeckHQ` : 'DeckHQ';
}

async function refresh(force = false) {
  try {
    const r = await fetch('/api/state' + (force ? '?force=1' : ''));
    state = await r.json();
  } catch { toast('Lost the daemon. Is it still running?', true); return; }
  const zones = state.zones.filter((z) => z.agents > 0);
  if (skin === 'studio') {
    const sig = zones.map((z) => z.id).join('|');
    if (!plan || plan._sig !== sig) {
      plan = Studio.buildPlan(zones); plan._sig = sig;
      backdrop = Studio.renderBackdrop(plan);
    }
    cv.width = plan.W * Studio.U; cv.height = plan.H * Studio.U;
    fitStudio();
    layout = { GW: plan.W, GH: plan.H };
  } else {
    cv.style.width = ''; cv.style.height = '';
    layout = buildLayout(zones);
    const [w, h] = S().size(layout.GW, layout.GH);
    cv.width = w; cv.height = h;
    if (skin === 'iso') SKINS.iso._o = [layout.GH * 16, 50];
  }
  document.querySelector('.stage').classList.toggle('is-studio', skin === 'studio');
  syncSprites(); renderStats(); drawAll();
  $('stage-empty').hidden = sprites.size > 0;
  if (selectedId) { const a = agentById(selectedId); if (a) renderDockHead(a); }
}

$('b-refresh').addEventListener('click', async (ev) => {
  const b = ev.currentTarget; b.disabled = true; await refresh(true); b.disabled = false;
});
$('b-fired').addEventListener('click', (ev) => {
  showFired = !showFired;
  ev.currentTarget.setAttribute('aria-pressed', String(showFired));
  ev.currentTarget.textContent = showFired ? 'Hide let go' : 'Show let go';
  syncSprites(); drawAll();
});
$('skin-picker').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-skin]'); if (!b) return;
  skin = b.dataset.skin;
  localStorage.setItem('office.skin', skin);
  plan = null; backdrop = null; sprites.clear();
  [...$('skin-picker').querySelectorAll('[data-skin]')].forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.skin === skin)));
  refresh();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !dock.hidden) { dock.hidden = true; selectedId = null; }
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); drawAll(); });

readColors();
[...$('skin-picker').querySelectorAll('[data-skin]')].forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.skin === skin)));
refresh();
setInterval(() => refresh(), 8000);
requestAnimationFrame(frame);
