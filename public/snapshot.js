/**
 * The office snapshot — `S`.
 *
 * WP-14, `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §3.2. One key
 * composites the floor and a stat strip into a PNG, puts it on the clipboard,
 * and saves it to `~/.deckhq/snapshots/`. §8's ranking calls this the highest
 * sharing-value feature in the plan, for a specific reason: every screenshot
 * that spread in this category was one somebody had to crop themselves, and
 * the only repository in it that ships one-click sharing has thirteen stars.
 *
 * ```
 * ┌──────────────────────────────────────────────────────────┐
 * │  [ the floor ]                                            │
 * ├──────────────────────────────────────────────────────────┤
 * │  SAMCO-DESK · 15 rooms · 51 people                        │
 * │  5 working  2 hands up  7 in your office  37 benched      │
 * │  today ≈ $18.40 estimate · 2.4M tok · longest wait 1d 2h  │
 * │                                              deckhq.dev   │
 * └──────────────────────────────────────────────────────────┘
 * ```
 *
 * The split here is the same as everywhere else in this client: the model is
 * pure and is what the tests drive (`snapshotModel`, `redactSnapshot`, and the
 * formatters), and only `drawStrip`/`composite` touch a canvas.
 *
 * **Redaction (`Shift+S`).** Half the audience works on things they cannot
 * show, so project names swap for their MK tags. That has to hold *everywhere
 * in the image*, and the room plates are painted by the renderer from the
 * snapshot it was last given — so the redaction is applied to the snapshot and
 * the renderer is asked to draw that. See `app.js`'s `takeSnapshot`; the
 * alternative, redacting only the strip, would have shipped a control called
 * "redact" that leaves every project name legible on the floor above it.
 */

/** The wordmark. No watermark beyond this (§3.2). */
export const WORDMARK = 'deckhq.dev';

/** Strip metrics, in CSS px before the output scale is applied. */
export const STRIP = Object.freeze({
  height: 96,
  padX: 22,
  padY: 18,
  lineGap: 22,
});

/** §3.2's target: the PNG has to be small enough to paste anywhere. */
export const MAX_PNG_BYTES = 2 * 1024 * 1024;

/**
 * The floor is drawn at whatever the machine's device pixel ratio is; the
 * snapshot is never drawn at less than this. A 1× screenshot of a floor is
 * unreadable at the size these get posted at.
 */
export const MIN_SCALE = 2;

/**
 * Replace every project name in a snapshot with its MK tag.
 *
 * Pure, and total: it returns a whole snapshot rather than a patch, because
 * the redacted copy is handed to the renderer as its state, and a partial one
 * would draw a floor missing whatever was not copied.
 *
 * `cwd` goes too. It never appears on the floor today, but it is the one field
 * that carries a directory tree, and a redaction that depends on nobody ever
 * drawing a field is a redaction with a fuse in it.
 *
 * @param {any} snapshot
 * @returns {any}
 */
export function redactSnapshot(snapshot) {
  if (!snapshot) return snapshot;
  /** @type {Map<string, {name:string, id:string}>} original project id -> its cover */
  const cover = new Map();
  const projects = (snapshot.projects || []).map((p, i) => {
    const mk = p.mk || `MK${p.projectMk ?? i + 1}`;
    // The id goes too. It is a slug of the working directory, so it carries
    // the project's name in it verbatim, and a redaction that depends on
    // nobody ever drawing a particular field is a redaction with a fuse in
    // it. Substituting it is safe because the id is a key, not a seed: the
    // floor plan derives geometry from counts and the array's order, and the
    // only string the renderer hashes is the *agent* id, which is untouched.
    const id = `mk-${p.projectMk ?? i + 1}`;
    cover.set(p.id, { name: mk, id });
    return { ...p, id, name: mk, cwd: '' };
  });
  const agents = (snapshot.agents || []).map((a) => {
    const c = cover.get(a.projectId);
    return {
      ...a,
      projectId: c ? c.id : a.projectId,
      projectName: c ? c.name : a.mk || 'MK',
      cwd: '',
    };
  });
  // A project's `agentIds` points at agent ids, which are session uuids and
  // carry nothing about a project, so it is correct as it stands.
  return { ...snapshot, agents, projects, redacted: true };
}

/**
 * `1d 2h`, `26h`, `4h 10m`, `12m`, `just now`.
 *
 * Two units at most and never a false precision: "1d 2h" is what someone
 * reads out loud, "1d 2h 14m 3s" is a stopwatch.
 * @param {number} ms
 * @returns {string}
 */
export function formatWait(ms) {
  const s = Math.max(0, Math.floor(Number(ms) || 0) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) {
    const rem = m % 60;
    return rem ? `${h}h ${rem}m` : `${h}h`;
  }
  const d = Math.floor(h / 24);
  const rem = h % 24;
  return rem ? `${d}d ${rem}h` : `${d}d`;
}

/** `2.4M`, `241k`, `860`. The same shape the room plates use. */
export function compactTokens(n) {
  const v = Math.max(0, Number(n) || 0);
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(Math.round(v));
}

/** `$18.40`. Two decimals below a hundred, none above — nobody reads cents on $1,240. */
export function formatMoney(n) {
  const v = Math.max(0, Number(n) || 0);
  return v >= 100 ? `$${Math.round(v).toLocaleString('en-US')}` : `$${v.toFixed(2)}`;
}

/** Local midnight before `now` — the boundary "today" means to a person. */
function startOfDay(now) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Everything the strip says, as text. No canvas, no DOM.
 *
 * The office is named after the hostname (§3.2). "Today" is the local day, and
 * spend is **an estimate over the sessions that were active today**, summed
 * over the whole life of each — until the ledger lands (WP-17) there is no
 * per-day token record to sum, and inventing one would be a number nobody can
 * check. It is labelled `estimate` in the strip for the same reason it is
 * labelled everywhere else (standing rule 7: cost is an estimate, never a
 * bill).
 *
 * @param {any} snapshot
 * @param {{hostname?: string, now?: number, redact?: boolean}} [opts]
 */
export function snapshotModel(snapshot, opts = {}) {
  const now = opts.now ?? Date.now();
  const source = opts.redact ? redactSnapshot(snapshot) : snapshot || {};
  const agents = source.agents || [];
  const counts = source.counts || {};
  const dayStart = startOfDay(now);

  let spend = 0;
  let tokens = 0;
  let longestWait = 0;
  for (const a of agents) {
    if ((a.lastActivityAt || 0) >= dayStart) {
      spend += Number(a.costEstimate) || 0;
      tokens += (Number(a.tokens) || 0) + (Number(a.cacheTokens) || 0);
    }
    if (a.ackState !== 'active') continue;
    const since = a.reviewSince || a.needsInputSince || null;
    if (since) longestWait = Math.max(longestWait, now - since);
  }

  const rooms = (source.projects || []).length;
  const people = agents.filter((a) => a.ackState !== 'let_go').length;
  const office = String(opts.hostname || 'this machine').toUpperCase();

  /** @type {{text:string, state?:string}[]} */
  const tallies = [
    { text: `${counts.working ?? 0} working`, state: 'working' },
    { text: `${counts.handsUp ?? 0} hands up`, state: 'needs_input' },
    { text: `${counts.forReview ?? 0} in your office`, state: 'for_review' },
    { text: `${counts.benched ?? 0} benched`, state: 'benched' },
  ];

  const money = [
    `today ≈ ${formatMoney(spend)} estimate`,
    `${compactTokens(tokens)} tok`,
    longestWait > 0 ? `longest wait ${formatWait(longestWait)}` : 'nobody waiting',
  ];

  return {
    redacted: Boolean(opts.redact),
    headline: [office, `${rooms} room${rooms === 1 ? '' : 's'}`, `${people} people`].join(' · '),
    tallies,
    money: money.join(' · '),
    wordmark: WORDMARK,
    /** The snapshot the floor should be drawn from — redacted, if asked. */
    source,
  };
}

/**
 * Paint the strip into `ctx`, which is expected to be already translated so
 * that (0, 0) is the strip's top-left, and already scaled.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {ReturnType<typeof snapshotModel>} model
 * @param {{width:number, colors:Record<string,string>, fontSans:string, fontMono:string}} opts
 *   `width` is in CSS px (pre-scale), matching STRIP's other metrics.
 */
export function drawStrip(ctx, model, opts) {
  const { width, colors } = opts;
  const sans = opts.fontSans || 'system-ui, sans-serif';
  const mono = opts.fontMono || 'ui-monospace, monospace';

  ctx.save();
  ctx.fillStyle = colors.surface;
  ctx.fillRect(0, 0, width, STRIP.height);
  // One hairline between the floor and the numbers, in the chrome's own line
  // colour. The floor is a picture and the strip is a caption; the rule is
  // what says so.
  ctx.fillStyle = colors.line;
  ctx.fillRect(0, 0, width, 1);

  let y = STRIP.padY;
  ctx.textBaseline = 'top';

  ctx.font = `600 15px ${sans}`;
  ctx.fillStyle = colors.ink;
  ctx.fillText(model.headline, STRIP.padX, y);
  y += STRIP.lineGap;

  // The tallies: a state dot, then a neutral-ink label. State is never colour
  // alone (`05` §10) — the words carry it and the dot is the accent.
  ctx.font = `13px ${sans}`;
  let x = STRIP.padX;
  for (const t of model.tallies) {
    const dot = colors[`state-${t.state}`] || colors.muted;
    ctx.fillStyle = dot;
    ctx.beginPath();
    ctx.arc(x + 4, y + 7, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colors.ink2;
    ctx.fillText(t.text, x + 14, y);
    x += 14 + ctx.measureText(t.text).width + 22;
  }
  y += STRIP.lineGap;

  ctx.font = `12px ${mono}`;
  ctx.fillStyle = colors.muted;
  ctx.fillText(model.money, STRIP.padX, y);

  // The wordmark, right-aligned on the last line. No "share to X" button, no
  // watermark over the floor — §3.2 is explicit that the PNG goes on the
  // clipboard and the product then gets out of the way.
  ctx.font = `12px ${mono}`;
  ctx.fillStyle = colors.muted;
  ctx.textAlign = 'right';
  ctx.fillText(model.wordmark, width - STRIP.padX, y);
  ctx.restore();
}

/**
 * Composite a floor canvas and a strip into one canvas at `scale`.
 *
 * `scale` is output pixels per CSS pixel and is never below `MIN_SCALE`. The
 * floor half is drawn from the live canvas's backing store, which is sized at
 * the machine's own device pixel ratio; on a 1× display that means the floor
 * is resampled up to 2× while the strip is drawn natively at 2×. The renderer
 * offers no draw-at-scale entry point, and this package may not add one — see
 * `docs/DEVIATIONS.md` §97.
 *
 * @param {object} o
 * @param {HTMLCanvasElement} o.floor
 * @param {ReturnType<typeof snapshotModel>} o.model
 * @param {number} o.scale
 * @param {number} [o.dpr]  device pixels per CSS pixel in the floor's backing store
 * @param {Record<string,string>} o.colors
 * @param {string} [o.fontSans]
 * @param {string} [o.fontMono]
 * @param {(w:number,h:number)=>HTMLCanvasElement} [o.makeCanvas]
 * @returns {HTMLCanvasElement}
 */
export function composite(o) {
  const make =
    o.makeCanvas ||
    ((w, h) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      return c;
    });

  // The floor's size in CSS pixels, derived from its backing store and the
  // device pixel ratio — NOT from layout.
  //
  // This looks like the long way round and it is the only correct one: a
  // backgrounded tab reports no layout. Measured in Chrome with the tab
  // hidden, `clientWidth`, `innerWidth` and `getBoundingClientRect().width`
  // are all **0** while `clientHeight` is stale, and the first version of this
  // function fell back to `canvas.width` for the width — a device-pixel number
  // in a CSS-pixel slot — and produced a 6400x672 sliver of a floor. The
  // backing store is the one thing that is always right, because it is what
  // the renderer actually drew into.
  const dpr = o.dpr || 1;
  const cssW = (o.floor.width || 0) / dpr || o.floor.clientWidth || 0;
  const cssH = (o.floor.height || 0) / dpr || o.floor.clientHeight || 0;
  const scale = Math.max(MIN_SCALE, o.scale || MIN_SCALE);

  const outW = Math.round(cssW * scale);
  const outH = Math.round((cssH + STRIP.height) * scale);
  const out = make(outW, outH);
  // `alpha: false` is worth asking for: the composite is opaque everywhere,
  // and a context that knows it lets the encoder drop the alpha channel — a
  // quarter of the raw bytes, on the one image in this product with a size
  // budget. Browsers that ignore the hint are no worse off.
  const ctx = out.getContext('2d', { alpha: false }) || out.getContext('2d');

  ctx.fillStyle = o.colors.bg;
  ctx.fillRect(0, 0, outW, outH);

  // How the floor is resampled, and why it is not the obvious choice.
  //
  // On a 1× display the floor's backing store is 1× and the snapshot is 2×, so
  // this is an upscale. Smooth (bilinear) interpolation invents a new
  // intermediate colour at almost every output pixel, and the floor's
  // materials — herringbone, woven carpet, poured screed — are deliberately
  // high-entropy, so that wrecks PNG's row prediction: measured on the demo
  // floor at 1600x1000, smooth upscaling produced **4.05 MB** against **900 KB**
  // for the same floor captured at 1x. Nearest-neighbour instead emits four
  // identical pixels per source pixel, which compresses close to the original,
  // and it is also the *sharper* result — a 2x pixel-doubled screenshot viewed
  // at 1x on a dense display is crisp, where a blurred one is permanently
  // blurred. So: smooth only when we are genuinely downsampling.
  const upscaling = scale > dpr + 0.001;
  ctx.imageSmoothingEnabled = !upscaling;
  if (!upscaling) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(o.floor, 0, 0, Math.round(cssW * scale), Math.round(cssH * scale));

  ctx.save();
  ctx.translate(0, Math.round(cssH * scale));
  ctx.scale(scale, scale);
  drawStrip(ctx, o.model, {
    width: cssW,
    colors: o.colors,
    fontSans: o.fontSans,
    fontMono: o.fontMono,
  });
  ctx.restore();
  return out;
}

/**
 * Read the chrome's own colours off the document, so the strip is the same
 * palette as the window it came out of rather than a second hard-coded copy
 * that drifts. Falls back to the literals in `style.css` when there is no
 * computed style to read (a stub, or a detached document).
 * @param {Document} [doc]
 */
export function stripColors(doc = document) {
  const fallback = {
    bg: '#131419',
    surface: '#1a1c23',
    line: '#333846',
    ink: '#eceef3',
    ink2: '#b8bdc9',
    muted: '#8a92a3',
    'state-working': '#2e7d63',
    'state-needs_input': '#b87333',
    'state-for_review': '#c0392b',
    'state-benched': '#7b8794',
  };
  let style;
  try {
    style = getComputedStyle(doc.documentElement);
  } catch {
    return fallback;
  }
  const read = (prop, key) => {
    const v = style.getPropertyValue(prop).trim();
    return v || fallback[key];
  };
  return {
    bg: read('--bg', 'bg'),
    surface: read('--surface', 'surface'),
    line: read('--line', 'line'),
    ink: read('--ink', 'ink'),
    ink2: read('--ink-2', 'ink2'),
    muted: read('--muted', 'muted'),
    'state-working': read('--state-working', 'state-working'),
    'state-needs_input': read('--state-needs_input', 'state-needs_input'),
    'state-for_review': read('--state-for_review', 'state-for_review'),
    'state-benched': read('--state-benched', 'state-benched'),
  };
}

/**
 * PNG bytes from a canvas, without waiting for anything the browser might
 * throttle.
 *
 * §3.2's acceptance includes "works with the tab backgrounded", and a
 * background tab is exactly where callback- and frame-driven APIs stop being
 * dependable. `toDataURL` is synchronous and returns before this function
 * does, so the capture cannot be deferred into a frame that never comes.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns {Uint8Array}
 */
export function pngBytes(canvas) {
  const url = canvas.toDataURL('image/png');
  const base64 = url.slice(url.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * How much smaller to draw when a snapshot comes out over the size budget,
 * and where to stop.
 *
 * §3.2 asks for both "≥ 2× device pixel ratio" and "under 2 MB", and on a very
 * large floor those two can disagree. The rule is that the resolution floor
 * wins: a 2.3 MB snapshot at 2× is a snapshot; a 1.9 MB one at 1.4× is a
 * blurry picture of an office, which is the thing this feature exists to stop.
 * So it steps down towards `MIN_SCALE` and stops there, and the caller says
 * plainly if what it got is still over.
 *
 * @param {number} scale
 * @returns {number|null} the next scale to try, or null when there is none
 */
export function nextScaleDown(scale) {
  const next = Math.round(scale * 0.8 * 100) / 100;
  return next >= MIN_SCALE ? next : scale > MIN_SCALE ? MIN_SCALE : null;
}
