// The page. One template string, no external resources, no build step.
// The data is embedded as a columnar JSON payload (a key list plus rows) so the
// file stays inside its 220 KB budget; the page rehydrates it on load.

/**
 * Turn an array of objects into `{k: [...keys], r: [[...values]]}`, dropping
 * trailing empties: the page fills a short row back out with ''.
 */
export function pack(rows, keys) {
  const k = keys || [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const r = rows.map((row) => {
    const v = k.map((key) => (row[key] === undefined ? '' : row[key]));
    let n = v.length;
    while (n > 0) {
      const last = v[n - 1];
      if (last === '' || (Array.isArray(last) && !last.length)) n -= 1;
      else break;
    }
    return v.slice(0, n);
  });
  return { k, r };
}

export function packData(data) {
  return {
    meta: data.meta,
    principles: pack(data.principles),
    requirements: pack(data.requirements),
    stories: pack(data.stories),
    openRequirements: pack(data.openRequirements),
    untraced: data.untraced,
    workPackages: pack(data.workPackages),
    decisions: pack(data.decisions),
    deviations: pack(data.deviations),
    features: pack(data.features),
    shipped: pack(data.shipped),
    releases: pack(data.releases),
    ownerItems: pack(data.ownerItems),
    studio: { steps: pack(data.studio.steps), packages: pack(data.studio.packages) },
    architecture: {
      layers: pack(data.architecture.layers),
      invariants: pack(data.architecture.invariants),
      findings: pack(data.architecture.findings),
      outline: pack(data.architecture.outline),
      facts: data.architecture.facts,
      cycles: data.architecture.cycles,
      capExemptions: pack(data.architecture.capExemptions),
      boundary: data.architecture.boundary,
    },
  };
}

const LS = String.fromCharCode(0x2028);
const PS = String.fromCharCode(0x2029);
const json = (v) => JSON.stringify(v)
  .replace(/</g, '\\u003c')
  .split(LS).join('\\u2028')
  .split(PS).join('\\u2029');

/**
 * Drop the indentation the template is written with. Every line of the page is
 * either markup, one CSS declaration or one JavaScript statement, and no string
 * literal in it spans a line, so leading whitespace and blank lines are free.
 */
function tighten(html) {
  return html
    .split('\n')
    .map((line) => (line.startsWith('<script type="application/json"') ? line : line.replace(/^\s+/, '')))
    .filter((line) => line !== '')
    .join('\n');
}

export function renderPage(data) {
  return tighten(page(data));
}

function page(data) {
  return `<title>DeckHQ Progress</title>
<style>
:root {
  --bg: #f4f5f7;
  --surface: #ffffff;
  --surface-2: #eceef2;
  --surface-3: #e3e6ec;
  --line: #d9dce4;
  --line-soft: #e6e9ef;
  --ink: #16181d;
  --ink-2: #454a55;
  --muted: #6b7180;
  --faint: #939aa8;
  --accent: #3f4fb8;
  --accent-ink: #ffffff;
  --accent-soft: #e6e9fb;
  --done: #157a4a;
  --done-bg: #dff0e6;
  --prog: #99630a;
  --prog-bg: #f8ecd4;
  --plan: #5f6675;
  --plan-bg: #e6e8ee;
  --dim: #8b91a0;
  --dim-bg: #eceef2;
  --stop: #b02338;
  --stop-bg: #fadfe3;
  --shadow: 0 1px 2px rgba(18, 20, 26, .06), 0 8px 24px rgba(18, 20, 26, .08);
  --r: 6px;
  --mono: ui-monospace, "SFMono-Regular", "Cascadia Mono", "Segoe UI Mono", Menlo, Consolas, monospace;
  --sans: ui-sans-serif, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #0d0f13;
    --surface: #14171d;
    --surface-2: #1a1e26;
    --surface-3: #222732;
    --line: #272c37;
    --line-soft: #1f242d;
    --ink: #e7e9ee;
    --ink-2: #c2c7d2;
    --muted: #949bab;
    --faint: #6f7686;
    --accent: #8b97f0;
    --accent-ink: #0d0f13;
    --accent-soft: #1d2340;
    --done: #48bd82;
    --done-bg: #122b1f;
    --prog: #d9a441;
    --prog-bg: #2d2413;
    --plan: #98a0b0;
    --plan-bg: #1e232c;
    --dim: #767d8d;
    --dim-bg: #1a1e26;
    --stop: #f0707f;
    --stop-bg: #331a20;
    --shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 12px 32px rgba(0, 0, 0, .45);
  }
}
:root[data-theme="dark"] {
  --bg: #0d0f13;
  --surface: #14171d;
  --surface-2: #1a1e26;
  --surface-3: #222732;
  --line: #272c37;
  --line-soft: #1f242d;
  --ink: #e7e9ee;
  --ink-2: #c2c7d2;
  --muted: #949bab;
  --faint: #6f7686;
  --accent: #8b97f0;
  --accent-ink: #0d0f13;
  --accent-soft: #1d2340;
  --done: #48bd82;
  --done-bg: #122b1f;
  --prog: #d9a441;
  --prog-bg: #2d2413;
  --plan: #98a0b0;
  --plan-bg: #1e232c;
  --dim: #767d8d;
  --dim-bg: #1a1e26;
  --stop: #f0707f;
  --stop-bg: #331a20;
  --shadow: 0 1px 2px rgba(0, 0, 0, .5), 0 12px 32px rgba(0, 0, 0, .45);
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 13px/1.5 var(--sans);
  -webkit-font-smoothing: antialiased;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
button, input, select { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 3px; }
code, .mono { font-family: var(--mono); font-size: .92em; }
.num { font-variant-numeric: tabular-nums; }

.wrap { max-width: 1280px; margin: 0 auto; padding: 0 16px 56px; }
header.top {
  position: sticky; top: env(safe-area-inset-top, 0px); z-index: 30;
  background: var(--bg); border-bottom: 1px solid var(--line);
}
.top-in { max-width: 1280px; margin: 0 auto; padding: 14px 16px 0; }
.brandrow { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px 12px; }
h1 { font-size: 17px; font-weight: 650; letter-spacing: -.01em; margin: 0; }
.tagline { color: var(--muted); font-size: 12px; }
.spacer { flex: 1 1 auto; }
.statusline { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; color: var(--muted); font-size: 11.5px; margin-top: 6px; }
.dot { width: 6px; height: 6px; border-radius: 50%; background: var(--done); display: inline-block; }
.dot.red { background: var(--stop); }
.dot.grey { background: var(--dim); }
.ghost {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r);
  padding: 4px 9px; cursor: pointer; color: var(--ink-2); font-size: 12px;
}
.ghost:hover { background: var(--surface-2); }

.tiles { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin: 12px 0 10px; }
.stat { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 9px 11px; }
.stat .k { color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; }
.stat .v { font-size: 20px; font-weight: 640; letter-spacing: -.02em; margin-top: 2px; }
.stat .v small { font-size: 12px; font-weight: 500; color: var(--faint); letter-spacing: 0; }
.stat .s { color: var(--faint); font-size: 11px; margin-top: 1px; }

nav.tabs { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; }
nav.tabs::-webkit-scrollbar { display: none; }
nav.tabs button {
  background: none; border: 0; border-bottom: 2px solid transparent; color: var(--muted);
  padding: 8px 10px; cursor: pointer; white-space: nowrap; font-size: 12.5px; border-radius: 3px 3px 0 0;
}
nav.tabs button:hover { color: var(--ink); }
nav.tabs button[aria-selected="true"] { color: var(--ink); border-bottom-color: var(--accent); font-weight: 600; }
nav.tabs .cnt { color: var(--faint); font-variant-numeric: tabular-nums; margin-left: 5px; font-size: 11px; }

.bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 14px 0 10px; }
.search { position: relative; flex: 1 1 220px; min-width: 0; }
.search input {
  width: 100%; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r);
  padding: 6px 10px 6px 26px;
}
.search::before { content: "⌕"; position: absolute; left: 9px; top: 5px; color: var(--faint); font-size: 14px; }
.search kbd {
  position: absolute; right: 7px; top: 6px; color: var(--faint); font-size: 10px; font-family: var(--mono);
  border: 1px solid var(--line); border-radius: 3px; padding: 0 4px;
}
select.sort { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 6px 8px; }
.seg { display: inline-flex; border: 1px solid var(--line); border-radius: var(--r); overflow: hidden; background: var(--surface); }
.seg button { background: none; border: 0; padding: 6px 10px; cursor: pointer; color: var(--muted); font-size: 12px; }
.seg button[aria-pressed="true"] { background: var(--surface-3); color: var(--ink); }
.chips { display: flex; flex-wrap: wrap; gap: 5px; }
.chip {
  border: 1px solid var(--line); background: var(--surface); border-radius: 99px; padding: 3px 9px;
  font-size: 11.5px; color: var(--muted); cursor: pointer; white-space: nowrap;
}
.chip[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--ink); font-weight: 560; }
.chip.flat { cursor: default; }
.count { color: var(--muted); font-size: 11.5px; margin: 2px 0 10px; }

.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(268px, 1fr)); gap: 8px; }
.card {
  background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 10px 11px;
  cursor: pointer; text-align: left; width: 100%; display: block; position: relative;
  border-left: 3px solid var(--st, var(--line));
}
.card:hover { border-color: var(--accent); }
.card .id { font-family: var(--mono); font-size: 11px; color: var(--muted); }
.card .t { font-weight: 560; margin: 3px 0 5px; line-height: 1.35; }
.card .sub { color: var(--muted); font-size: 11.5px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card .foot { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; align-items: center; }
.rows .card { border-radius: 0; border-left-width: 3px; border-top: 0; display: grid; grid-template-columns: 78px 1fr auto; gap: 10px; align-items: baseline; padding: 7px 10px; }
.rows .card:first-child { border-top: 1px solid var(--line); border-radius: var(--r) var(--r) 0 0; }
.rows .card:last-child { border-radius: 0 0 var(--r) var(--r); }
.rows .card .t { margin: 0; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rows .card .sub, .rows .card .foot { display: none; }
.rows { display: block; }

.tag { font-size: 10.5px; padding: 1px 7px; border-radius: 99px; border: 1px solid transparent; white-space: nowrap; }
.tag.done { color: var(--done); background: var(--done-bg); }
.tag.progress { color: var(--prog); background: var(--prog-bg); }
.tag.planned { color: var(--plan); background: var(--plan-bg); }
.tag.dim { color: var(--dim); background: var(--dim-bg); }
.tag.stop { color: var(--stop); background: var(--stop-bg); }
.tag.unknown { color: var(--dim); background: transparent; border: 1px dashed var(--line); }
.tag.area { color: var(--muted); background: var(--surface-2); }
.tag.ref { font-family: var(--mono); color: var(--accent); background: var(--accent-soft); }
a.tag.ref:hover { text-decoration: none; outline: 1px solid var(--accent); }

.panel { background: var(--surface); border: 1px solid var(--line); border-radius: var(--r); padding: 14px; }
.panel + .panel { margin-top: 10px; }
.panel h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .07em; color: var(--muted); margin: 0 0 10px; font-weight: 600; }
.panel h3 { font-size: 13px; margin: 14px 0 6px; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 10px; align-items: start; }
.lede { color: var(--ink-2); max-width: 68ch; }
ul.feed { list-style: none; margin: 0; padding: 0; }
ul.feed li { padding: 7px 0; border-top: 1px solid var(--line-soft); }
ul.feed li:first-child { border-top: 0; }
ul.feed .t { font-weight: 550; }
ul.feed .d { color: var(--muted); font-size: 11.5px; margin-top: 2px; }

.meter { display: flex; height: 8px; border-radius: 99px; overflow: hidden; background: var(--surface-2); margin: 8px 0 6px; }
.meter i { display: block; height: 100%; }
.legend { display: flex; flex-wrap: wrap; gap: 4px 12px; color: var(--muted); font-size: 11px; }
.legend span { display: inline-flex; align-items: center; gap: 5px; }
.legend i { width: 8px; height: 8px; border-radius: 2px; display: inline-block; }

.scroll-x { overflow-x: auto; }
table.data { border-collapse: collapse; width: 100%; font-size: 12px; min-width: 520px; }
table.data th, table.data td { text-align: left; padding: 6px 10px 6px 0; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
table.data th { color: var(--muted); font-weight: 600; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
svg.arch { width: 100%; height: auto; display: block; min-width: 560px; }

.stepper { display: flex; flex-wrap: wrap; gap: 6px; }
.step { border: 1px solid var(--line); border-radius: var(--r); padding: 7px 10px; min-width: 132px; flex: 1 1 132px; border-top: 3px solid var(--st); }
.step .n { font-family: var(--mono); font-size: 10px; color: var(--faint); }
.step .t { font-weight: 560; font-size: 12.5px; }
.step .d { color: var(--muted); font-size: 11px; margin-top: 3px; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }

#scrim { position: fixed; inset: 0; background: rgba(12, 14, 19, .38); z-index: 40; }
#drawer {
  position: fixed; z-index: 50; top: 0; right: 0; bottom: 0; width: min(520px, 100%);
  background: var(--surface); border-left: 1px solid var(--line); box-shadow: var(--shadow);
  display: flex; flex-direction: column;
}
#drawer header {
  display: flex; gap: 10px; align-items: flex-start; padding: 14px 14px 10px;
  border-bottom: 1px solid var(--line); padding-top: calc(14px + env(safe-area-inset-top, 0px));
}
#drawer h2 { margin: 3px 0 0; font-size: 15px; line-height: 1.35; }
#drawer .body { overflow-y: auto; padding: 12px 14px calc(28px + env(safe-area-inset-bottom, 0px)); }
.field { padding: 8px 0; border-top: 1px solid var(--line-soft); }
.field:first-child { border-top: 0; }
.field .k { font-size: 10.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin-bottom: 3px; }
.field .v { color: var(--ink-2); }
blockquote.owner {
  margin: 0; padding: 8px 12px; background: var(--surface-2); border-left: 2px solid var(--accent);
  border-radius: 0 var(--r) var(--r) 0; color: var(--ink); font-style: italic;
}
blockquote.owner cite { display: block; font-style: normal; color: var(--muted); font-size: 11px; margin-top: 5px; }
.x { background: none; border: 0; color: var(--muted); cursor: pointer; font-size: 16px; line-height: 1; padding: 4px 6px; border-radius: var(--r); }
.x:hover { background: var(--surface-2); color: var(--ink); }
.empty { color: var(--muted); padding: 28px 0; text-align: center; }
footer.foot { color: var(--faint); font-size: 11px; margin-top: 22px; display: flex; flex-wrap: wrap; gap: 4px 14px; }

@media (max-width: 880px) {
  .tiles { grid-template-columns: repeat(2, 1fr); }
  .stat:nth-child(5) { grid-column: span 2; }
  #drawer { width: 100%; border-left: 0; top: 0; }
  .rows .card { grid-template-columns: 70px 1fr; }
  .rows .card .tag { grid-column: 2; }
}
@media (prefers-reduced-motion: no-preference) {
  #drawer { animation: slide .16s ease-out; }
  @keyframes slide { from { transform: translateX(14px); opacity: .4; } to { transform: none; opacity: 1; } }
}
</style>

<header class="top">
  <div class="top-in">
    <div class="brandrow">
      <h1>DeckHQ</h1>
      <span class="tagline" id="tagline"></span>
      <span class="spacer"></span>
      <button class="ghost" id="theme" type="button" aria-label="Switch colour theme">Theme</button>
    </div>
    <div class="statusline" id="statusline"></div>
    <div class="tiles" id="stats"></div>
    <nav class="tabs" id="tabs" role="tablist" aria-label="Sections"></nav>
  </div>
</header>

<main class="wrap" id="main"></main>

<script type="application/json" id="hub-data">${json(packData(data))}</script>
<script>
(function () {
  'use strict';
  var RAW = JSON.parse(document.getElementById('hub-data').textContent);
  var ARRAYS = ['wps', 'devs', 'devsAll', 'requirements', 'stories', 'principles', 'highlights', 'groups', 'modules', 'refs'];
  function hydrate(p) {
    if (!p || !p.k) return [];
    return p.r.map(function (row) {
      var o = {};
      for (var i = 0; i < p.k.length; i += 1) {
        var v = row[i];
        o[p.k[i]] = v === undefined ? (ARRAYS.indexOf(p.k[i]) >= 0 ? [] : '') : v;
      }
      return o;
    });
  }
  var D = {
    meta: RAW.meta,
    principles: hydrate(RAW.principles),
    requirements: hydrate(RAW.requirements),
    stories: hydrate(RAW.stories),
    openRequirements: hydrate(RAW.openRequirements),
    untraced: RAW.untraced || [],
    workPackages: hydrate(RAW.workPackages),
    decisions: hydrate(RAW.decisions),
    deviations: hydrate(RAW.deviations),
    features: hydrate(RAW.features),
    shipped: hydrate(RAW.shipped),
    releases: hydrate(RAW.releases),
    ownerItems: hydrate(RAW.ownerItems),
    studio: { steps: hydrate(RAW.studio.steps), packages: hydrate(RAW.studio.packages) },
    arch: {
      layers: hydrate(RAW.architecture.layers),
      invariants: hydrate(RAW.architecture.invariants),
      findings: hydrate(RAW.architecture.findings),
      outline: hydrate(RAW.architecture.outline),
      facts: RAW.architecture.facts,
      cycles: RAW.architecture.cycles || [],
      capExemptions: hydrate(RAW.architecture.capExemptions),
      boundary: RAW.architecture.boundary || { rule: '', srcToPublic: [] }
    }
  };

  // ── helpers ───────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  var TAGCLASS = {
    done: 'done', 'in progress': 'progress', planned: 'planned', superseded: 'dim',
    declined: 'dim', blocked: 'stop', unknown: 'unknown', open: 'progress'
  };
  var STCOLOR = {
    done: 'var(--done)', 'in progress': 'var(--prog)', planned: 'var(--plan)',
    superseded: 'var(--dim)', declined: 'var(--dim)', blocked: 'var(--stop)', unknown: 'var(--line)'
  };
  function tag(status, label) {
    return '<span class="tag ' + (TAGCLASS[status] || 'planned') + '">' + esc(label || status) + '</span>';
  }
  function md(s) {
    var t = esc(s);
    t = t.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    t = t.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    t = t.replace(/(^|[\\s(])_([^_]{2,60})_(?=[\\s.,;:)]|$)/g, '$1<em>$2</em>');
    t = t.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '$1');
    return t;
  }
  function refLinks(text) {
    return md(text)
      .replace(/\\b(WP-\\d{1,3}[a-z]?)\\b/g, function (m) { return has('wp', m) ? link('wp', m, m) : m; })
      .replace(/\\b(R-\\d{3})\\b/g, function (m) { return has('req', m) ? link('req', m, m) : m; })
      .replace(/\\b(S-\\d{2})\\b/g, function (m) { return has('story', m) ? link('story', m, m) : m; });
  }
  function link(kind, id, label) {
    return '<a class="tag ref" href="#' + kind + '/' + encodeURIComponent(id) + '">' + esc(label) + '</a>';
  }
  var INDEX = {};
  function indexAll() {
    INDEX.req = {}; INDEX.wp = {}; INDEX.dev = {}; INDEX.story = {};
    INDEX.dec = {}; INDEX.feat = {}; INDEX.rel = {}; INDEX.arch = {};
    D.requirements.forEach(function (r) { INDEX.req[r.id] = r; });
    D.workPackages.forEach(function (r) { INDEX.wp[r.id] = r; });
    D.deviations.forEach(function (r) { INDEX.dev[String(r.n)] = r; });
    D.stories.forEach(function (r) { INDEX.story[r.id] = r; });
    D.decisions.forEach(function (r) { INDEX.dec[String(r.n)] = r; });
    featureList().forEach(function (r) { INDEX.feat[r.key] = r; });
    D.releases.forEach(function (r) { INDEX.rel[r.version] = r; });
    D.arch.invariants.forEach(function (r) { INDEX.arch[r.id] = r; });
    D.arch.findings.forEach(function (r) { INDEX.arch[r.id] = r; });
  }
  function has(kind, id) { return !!(INDEX[kind] && INDEX[kind][id]); }
  var FEATS = null;
  function featureList() {
    if (FEATS) return FEATS;
    FEATS = [];
    D.shipped.forEach(function (f, i) {
      FEATS.push({
        key: 'F' + (i + 1), kind: 'shipped', group: f.group, title: f.title, detail: f.detail,
        wps: f.wps || [], devs: f.devs || [], source: 'CHANGELOG ' + f.source, status: 'done'
      });
    });
    D.features.forEach(function (f, i) {
      FEATS.push({
        key: 'P' + (i + 1), kind: 'spec', group: f.group, title: f.title,
        detail: [f.detail, f.extra].filter(Boolean).join(' · '), wps: [], devs: [],
        source: f.source, status: 'planned'
      });
    });
    return FEATS;
  }
  function pct(n, total) { return total ? Math.round((n / total) * 100) : 0; }
  function counts(items, key) {
    var m = {};
    items.forEach(function (i) { var k = i[key] || 'unknown'; m[k] = (m[k] || 0) + 1; });
    return m;
  }
  var ORDER = ['done', 'in progress', 'planned', 'unknown', 'blocked', 'superseded', 'declined'];
  function meter(items) {
    var c = counts(items, 'status');
    var total = items.length;
    var bar = '', legend = '';
    ORDER.forEach(function (s) {
      if (!c[s]) return;
      bar += '<i style="width:' + pct(c[s], total) + '%;background:' + STCOLOR[s] + '" title="' + esc(s + ' ' + c[s]) + '"></i>';
      legend += '<span><i style="background:' + STCOLOR[s] + '"></i>' + esc(s) + ' <b class="num">' + c[s] + '</b></span>';
    });
    return '<div class="meter" role="img" aria-label="' + esc(ORDER.filter(function (s) { return c[s]; })
      .map(function (s) { return c[s] + ' ' + s; }).join(', ')) + '">' + bar + '</div><div class="legend">' + legend + '</div>';
  }

  // ── state ─────────────────────────────────────────────────────────────────
  var TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'packages', label: 'Work packages' },
    { id: 'requirements', label: 'Requirements' },
    { id: 'stories', label: 'User stories' },
    { id: 'features', label: 'Features' },
    { id: 'architecture', label: 'Architecture' },
    { id: 'decisions', label: 'Decisions' },
    { id: 'releases', label: 'Releases' }
  ];
  var S = { tab: 'overview', view: {}, q: {}, status: {}, area: {}, sort: {} };
  function load() {
    try {
      var raw = localStorage.getItem('deckhq-hub');
      if (raw) {
        var v = JSON.parse(raw);
        if (v && typeof v === 'object') {
          S.tab = v.tab || S.tab;
          S.view = v.view || {}; S.q = v.q || {}; S.status = v.status || {};
          S.area = v.area || {}; S.sort = v.sort || {};
        }
      }
    } catch (e) { /* private window, blocked storage: defaults are fine */ }
    if (!TABS.some(function (t) { return t.id === S.tab; })) S.tab = 'overview';
  }
  function save() {
    try { localStorage.setItem('deckhq-hub', JSON.stringify(S)); } catch (e) { /* ignore */ }
  }

  // ── list configuration ────────────────────────────────────────────────────
  var LISTS = {
    packages: {
      kind: 'wp', empty: 'No work package matches.',
      items: function () { return D.workPackages; },
      id: function (i) { return i.id; },
      title: function (i) { return i.title || i.id; },
      sub: function (i) { return i.acceptance || i.statusText; },
      area: function (i) { return i.source; },
      areaLabel: 'Source',
      sorts: [['id', 'Id'], ['status', 'Status'], ['title', 'Title'], ['area', 'Source']],
      search: function (i) { return [i.id, i.title, i.acceptance, i.statusText, i.owner, i.depends].join(' '); }
    },
    requirements: {
      kind: 'req', empty: 'No requirement matches.',
      items: function () { return D.requirements; },
      id: function (i) { return i.id; },
      title: function (i) { return i.title; },
      sub: function (i) { return i.quote || i.interpretation; },
      area: function (i) { return i.area; },
      areaLabel: 'Area',
      sorts: [['id', 'Id'], ['status', 'Status'], ['area', 'Area'], ['title', 'Title']],
      search: function (i) { return [i.id, i.title, i.area, i.quote, i.interpretation, i.why, i.notes, i.implementedBy].join(' '); }
    },
    stories: {
      kind: 'story', empty: 'No story matches.',
      items: function () { return D.stories.map(function (s) { return Object.assign({ status: 'done' }, s, { status: storyStatus(s) }); }); },
      id: function (i) { return i.id; },
      title: function (i) { return i.title; },
      sub: function (i) { return i.body; },
      area: function (i) { return i.date || 'undated'; },
      areaLabel: 'Said',
      sorts: [['id', 'Id'], ['status', 'Status'], ['title', 'Title']],
      search: function (i) { return [i.id, i.title, i.body, (i.requirements || []).join(' ')].join(' '); }
    },
    features: {
      kind: 'feat', empty: 'No feature matches.',
      items: function () { return featureList(); },
      id: function (i) { return i.key; },
      title: function (i) { return i.title; },
      sub: function (i) { return i.detail; },
      area: function (i) { return i.group; },
      areaLabel: 'Group',
      sorts: [['area', 'Group'], ['title', 'Title'], ['status', 'Status']],
      search: function (i) { return [i.title, i.detail, i.group, i.source].join(' '); }
    },
    decisions: {
      kind: 'dev', empty: 'No decision matches.',
      items: function () {
        return D.deviations.map(function (d) {
          return Object.assign({}, d, { status: d.raise ? 'in progress' : 'done', id: String(d.n) });
        });
      },
      id: function (i) { return String(i.n); },
      title: function (i) { return i.title; },
      sub: function (i) { return i.summary; },
      area: function (i) { return (i.wps && i.wps[0]) || 'no package'; },
      areaLabel: 'Package',
      sorts: [['n', 'Number'], ['title', 'Title'], ['status', 'State']],
      search: function (i) { return ['§' + i.n, i.title, i.summary, i.wp].join(' '); }
    }
  };
  function storyStatus(s) {
    var reqs = (s.requirements || []).map(function (id) { return INDEX.req[id]; }).filter(Boolean);
    if (!reqs.length) return 'planned';
    if (reqs.every(function (r) { return r.status === 'done'; })) return 'done';
    if (reqs.some(function (r) { return r.status === 'done' || r.status === 'in progress'; })) return 'in progress';
    return 'planned';
  }

  function tabCount(id) {
    if (LISTS[id]) return LISTS[id].items().length;
    if (id === 'releases') return D.releases.length;
    if (id === 'architecture') return D.arch.findings.length;
    return 0;
  }

  // ── chrome ────────────────────────────────────────────────────────────────
  function renderChrome() {
    var m = D.meta;
    document.getElementById('tagline').textContent = m.tagline;
    var na = function (v) { return (v === null || v === undefined || v === '') ? '<span class="tag dim">not supplied</span>' : '<b class="num">' + esc(v) + '</b>'; };
    var ci = m.ci ? '<span class="dot ' + (m.ci === 'green' ? '' : 'red') + '"></span> CI ' + esc(m.ci)
      : '<span class="dot grey"></span> CI <span class="tag dim">not supplied</span>';
    document.getElementById('statusline').innerHTML = [
      ci,
      'version <b class="num">' + esc(m.version || 'unknown') + '</b>',
      'npm ' + na(m.npm),
      'tests ' + na(m.tests),
      'goldens ' + na(m.goldens),
      'built ' + esc(m.generatedAt),
      'audit map ' + esc(m.auditAt || 'unknown')
    ].join('<span aria-hidden="true">·</span>');

    var reqDone = D.requirements.filter(function (r) { return r.status === 'done'; }).length;
    var wpDone = D.workPackages.filter(function (r) { return r.status === 'done'; }).length;
    var openDec = D.decisions.filter(function (d) { return d.state === 'open'; }).length;
    var stats = [
      ['Requirements', reqDone + '<small>/' + D.requirements.length + '</small>', pct(reqDone, D.requirements.length) + '% done'],
      ['Work packages', wpDone + '<small>/' + D.workPackages.length + '</small>', pct(wpDone, D.workPackages.length) + '% done'],
      ['Decision log', String(D.deviations.length), 'numbered deviations'],
      ['Needs you', String(openDec), 'open owner decisions'],
      ['Modules', String(D.arch.facts.modules || 0), (D.arch.facts.edges || 0) + ' imports · ' + (D.arch.facts.cycles || 0) + ' cycles']
    ];
    document.getElementById('stats').innerHTML = stats.map(function (s) {
      return '<div class="stat"><div class="k">' + esc(s[0]) + '</div><div class="v num">' + s[1] + '</div><div class="s">' + esc(s[2]) + '</div></div>';
    }).join('');

    var tabs = document.getElementById('tabs');
    tabs.innerHTML = TABS.map(function (t) {
      var c = tabCount(t.id);
      return '<button role="tab" type="button" id="tab-' + t.id + '" aria-controls="main" data-tab="' + t.id + '"'
        + ' aria-selected="' + (S.tab === t.id ? 'true' : 'false') + '">' + esc(t.label)
        + (c ? '<span class="cnt num">' + c + '</span>' : '') + '</button>';
    }).join('');
    tabs.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-tab]');
      if (!b) return;
      S.tab = b.dataset.tab; save(); renderChrome(); renderTab();
    });
  }

  // ── tabs ──────────────────────────────────────────────────────────────────
  function renderTab() {
    var main = document.getElementById('main');
    if (LISTS[S.tab]) main.innerHTML = listHtml(S.tab);
    else if (S.tab === 'overview') main.innerHTML = overviewHtml();
    else if (S.tab === 'architecture') main.innerHTML = architectureHtml();
    else if (S.tab === 'releases') main.innerHTML = releasesHtml();
    wireTab();
    document.querySelectorAll('nav.tabs button').forEach(function (b) {
      b.setAttribute('aria-selected', b.dataset.tab === S.tab ? 'true' : 'false');
    });
  }

  function filtered(tab) {
    var cfg = LISTS[tab];
    var items = cfg.items().slice();
    var q = (S.q[tab] || '').toLowerCase().trim();
    var st = S.status[tab] || [];
    var ar = S.area[tab] || [];
    if (q) items = items.filter(function (i) { return cfg.search(i).toLowerCase().indexOf(q) >= 0; });
    if (st.length) items = items.filter(function (i) { return st.indexOf(i.status) >= 0; });
    if (ar.length) items = items.filter(function (i) { return ar.indexOf(cfg.area(i)) >= 0; });
    var sort = S.sort[tab] || cfg.sorts[0][0];
    items.sort(function (a, b) {
      if (sort === 'n') return a.n - b.n;
      if (sort === 'status') return String(a.status).localeCompare(String(b.status)) || String(cfg.id(a)).localeCompare(String(cfg.id(b)), undefined, { numeric: true });
      if (sort === 'title') return String(cfg.title(a)).localeCompare(String(cfg.title(b)));
      if (sort === 'area') return String(cfg.area(a)).localeCompare(String(cfg.area(b))) || String(cfg.id(a)).localeCompare(String(cfg.id(b)), undefined, { numeric: true });
      return String(cfg.id(a)).localeCompare(String(cfg.id(b)), undefined, { numeric: true });
    });
    return items;
  }

  function listHtml(tab) {
    var cfg = LISTS[tab];
    var all = cfg.items();
    var items = filtered(tab);
    var view = S.view[tab] || 'tiles';
    var statuses = Object.keys(counts(all, 'status')).sort(function (a, b) { return ORDER.indexOf(a) - ORDER.indexOf(b); });
    var areas = Object.keys(counts(all.map(function (i) { return { a: cfg.area(i) }; }), 'a')).sort();
    var sel = S.status[tab] || [], selA = S.area[tab] || [];
    var h = '<div class="panel">' + meter(all) + '</div>';
    h += '<div class="bar">'
      + '<label class="search"><span class="sr" hidden>Search</span>'
      + '<input id="q" type="search" placeholder="Search ' + esc(cfg.kind === 'dev' ? 'the decision log' : tab) + '" value="' + esc(S.q[tab] || '') + '" aria-label="Search ' + esc(tab) + '"><kbd>/</kbd></label>'
      + '<select class="sort" id="sort" aria-label="Sort">' + cfg.sorts.map(function (s) {
        return '<option value="' + s[0] + '"' + ((S.sort[tab] || cfg.sorts[0][0]) === s[0] ? ' selected' : '') + '>Sort: ' + esc(s[1]) + '</option>';
      }).join('') + '</select>'
      + '<span class="seg"><button type="button" data-view="tiles" aria-pressed="' + (view === 'tiles') + '">Tiles</button>'
      + '<button type="button" data-view="rows" aria-pressed="' + (view === 'rows') + '">Rows</button></span>'
      + '</div>';
    h += '<div class="chips" id="chips">'
      + statuses.map(function (s) {
        return '<button class="chip" type="button" data-f="status" data-v="' + esc(s) + '" aria-pressed="' + (sel.indexOf(s) >= 0) + '">' + esc(s) + '</button>';
      }).join('')
      + '<span class="chip flat" aria-hidden="true">' + esc(cfg.areaLabel) + '</span>'
      + areas.map(function (a) {
        return '<button class="chip" type="button" data-f="area" data-v="' + esc(a) + '" aria-pressed="' + (selA.indexOf(a) >= 0) + '">' + esc(a) + '</button>';
      }).join('') + '</div>';
    h += '<p class="count" role="status">' + items.length + ' of ' + all.length
      + (sel.length || selA.length || (S.q[tab] || '') ? ' · <button class="ghost" id="clear" type="button">Clear filters</button>' : '') + '</p>';
    if (!items.length) return h + '<p class="empty">' + esc(cfg.empty) + '</p>';
    h += '<div class="' + (view === 'rows' ? 'rows' : 'grid') + '" id="cards" role="list">'
      + items.map(function (i) { return cardHtml(cfg, i); }).join('') + '</div>';
    return h;
  }

  function cardHtml(cfg, i) {
    var id = cfg.id(i);
    return '<button class="card" type="button" role="listitem" data-card data-kind="' + cfg.kind + '" data-id="' + esc(id) + '"'
      + ' style="--st:' + STCOLOR[i.status] + '" tabindex="-1">'
      + '<span class="id">' + esc(cfg.kind === 'dev' ? '§' + id : id) + '</span>'
      + '<span class="t">' + md(cfg.title(i)) + '</span>'
      + '<span class="sub">' + md(cfg.sub(i) || '') + '</span>'
      + '<span class="foot">' + tag(i.status, i.statusText && i.statusText.length < 26 ? i.statusText : i.status)
      + (cfg.area(i) ? '<span class="tag area">' + esc(cfg.area(i)) + '</span>' : '') + '</span>'
      + '</button>';
  }

  function overviewHtml() {
    var latest = D.releases[0] || { version: 'Unreleased', groups: [] };
    var recent = D.shipped.slice(0, 8);
    var inProg = D.requirements.filter(function (r) { return r.status === 'in progress'; });
    var next = D.workPackages.filter(function (w) { return w.status === 'planned'; });
    var open = D.decisions.filter(function (d) { return d.state === 'open'; });
    var owner = D.ownerItems;
    var h = '<div class="panel"><h2>Where the product is</h2>'
      + '<p class="lede">' + esc(D.requirements.filter(function (r) { return r.status === 'done'; }).length)
      + ' of ' + D.requirements.length + ' requirements are done, '
      + D.workPackages.filter(function (w) { return w.status === 'done'; }).length + ' of ' + D.workPackages.length
      + ' work packages have landed, and ' + D.deviations.length + ' departures from the blueprint are on the record. '
      + open.length + ' decisions are waiting on the owner.</p>'
      + '<div class="cols" style="margin-top:12px">'
      + '<div><h3>Requirements by status</h3>' + meter(D.requirements) + '</div>'
      + '<div><h3>Work packages by status</h3>' + meter(D.workPackages) + '</div>'
      + '</div></div>';
    h += '<div class="cols">';
    h += '<div class="panel"><h2>What landed — ' + esc(latest.version) + '</h2><ul class="feed">'
      + recent.map(function (f, ix) {
        return '<li><div class="t">' + md(f.title) + '</div><div class="d">' + esc(f.group)
          + (f.wps && f.wps.length ? ' · ' + f.wps.map(function (w) { return link('wp', w, w); }).join(' ') : '') + '</div></li>';
      }).join('')
      + '</ul><p class="count">' + D.shipped.length + ' entries in the ' + esc(latest.version) + ' section — see Features.</p></div>';
    h += '<div class="panel"><h2>In progress</h2><ul class="feed">'
      + (inProg.length ? inProg.map(function (r) {
        return '<li><div class="t">' + link('req', r.id, r.id) + ' ' + md(r.title) + '</div><div class="d">' + esc(r.statusText || '') + '</div></li>';
      }).join('') : '<li class="d">Nothing is marked in progress.</li>')
      + '</ul></div>';
    h += '</div>';
    h += '<div class="cols">';
    h += '<div class="panel"><h2>Next — planned packages</h2><ul class="feed">'
      + next.slice(0, 10).map(function (w) {
        return '<li><div class="t">' + link('wp', w.id, w.id) + ' ' + md(w.title) + '</div><div class="d">' + md((w.acceptance || '').slice(0, 150)) + '</div></li>';
      }).join('') + '</ul></div>';
    h += '<div class="panel"><h2>Needs you</h2><ul class="feed">'
      + open.slice(0, 10).map(function (d) {
        return '<li><div class="t">' + esc(d.n + '. ') + md(d.title) + '</div><div class="d">' + esc(d.group || '') + '</div></li>';
      }).join('')
      + owner.map(function (o) {
        return '<li><div class="t">' + link('req', o.id, o.id) + ' ' + md(o.title) + '</div><div class="d">owner-side · ' + esc(o.status) + '</div></li>';
      }).join('')
      + '</ul><p class="count">' + open.length + ' open of ' + D.decisions.length + ' owner decisions · ' + owner.length + ' owner-side requirements</p></div>';
    h += '</div>';
    h += '<div class="panel"><h2>Product principles</h2><div class="scroll-x"><table class="data"><thead><tr><th>Id</th><th>Principle</th><th>Source</th></tr></thead><tbody>'
      + D.principles.map(function (p) {
        return '<tr><td class="mono">' + esc(p.id) + '</td><td>' + md(p.text) + '</td><td class="mono">' + esc(p.source) + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    if (D.untraced.length) {
      h += '<div class="panel"><h2>Not traced to a source</h2><ul class="feed">'
        + D.untraced.map(function (u) { return '<li><div class="d">' + refLinks(u) + '</div></li>'; }).join('') + '</ul></div>';
    }
    if (D.meta.warnings && D.meta.warnings.length) {
      h += '<div class="panel"><h2>Build warnings</h2><ul class="feed">'
        + D.meta.warnings.map(function (w) { return '<li><div class="d">' + esc(w) + '</div></li>'; }).join('') + '</ul></div>';
    }
    return h;
  }

  function archSvg() {
    var server = D.arch.layers.filter(function (l) { return l.tier === 'server'; });
    var client = D.arch.layers.filter(function (l) { return l.tier === 'client'; });
    var support = D.arch.layers.filter(function (l) { return l.tier === 'support'; });
    var maxLines = Math.max.apply(null, D.arch.layers.map(function (l) { return l.lines || 0; }).concat([1]));
    var rowH = 30, gap = 6, padTop = 34;
    var rows = Math.max(server.length, client.length);
    var H = padTop + rows * (rowH + gap) + 66;
    var colW = 268, leftX = 8, rightX = 352;
    function band(l, x, y, colour) {
      var w = Math.max(28, Math.round((l.lines / maxLines) * (colW - 96)));
      return '<g><rect x="' + x + '" y="' + y + '" width="' + colW + '" height="' + rowH + '" rx="4" fill="var(--surface-2)" stroke="var(--line)"/>'
        + '<rect x="' + (x + 1) + '" y="' + (y + 1) + '" width="' + w + '" height="' + (rowH - 2) + '" rx="3" fill="' + colour + '" opacity="0.14"/>'
        + '<text x="' + (x + 9) + '" y="' + (y + 19) + '" font-size="11.5" fill="var(--ink)" font-family="var(--mono)">' + esc(l.name) + '</text>'
        + '<text x="' + (x + colW - 9) + '" y="' + (y + 19) + '" font-size="11" text-anchor="end" fill="var(--muted)" font-family="var(--mono)">'
        + l.count + ' mod · ' + l.lines.toLocaleString() + ' ln</text></g>';
    }
    var s = '<svg class="arch" viewBox="0 0 628 ' + H + '" role="img" aria-label="Layered module map: '
      + server.length + ' server layers, ' + client.length + ' client layers, arrows show the allowed import direction">';
    s += '<defs><marker id="ar" markerWidth="7" markerHeight="7" refX="6" refY="3.2" orient="auto">'
      + '<path d="M0,0 L7,3.2 L0,6.4 z" fill="var(--faint)"/></marker></defs>';
    s += '<text x="' + leftX + '" y="16" font-size="11" fill="var(--muted)">src/ — daemon side, imports downward only</text>';
    s += '<text x="' + rightX + '" y="16" font-size="11" fill="var(--muted)">public/ — the floor, no src/ imports</text>';
    server.forEach(function (l, i) {
      var y = padTop + i * (rowH + gap);
      s += band(l, leftX, y, 'var(--accent)');
      if (i) s += '<line x1="' + (leftX + colW / 2) + '" y1="' + (y - gap) + '" x2="' + (leftX + colW / 2) + '" y2="' + (y - 1) + '" stroke="var(--faint)" marker-end="url(#ar)"/>';
    });
    client.forEach(function (l, i) {
      var y = padTop + i * (rowH + gap);
      s += band(l, rightX, y, 'var(--done)');
      if (i) s += '<line x1="' + (rightX + colW / 2) + '" y1="' + (y - gap) + '" x2="' + (rightX + colW / 2) + '" y2="' + (y - 1) + '" stroke="var(--faint)" marker-end="url(#ar)"/>';
    });
    var midY = padTop + rows * (rowH + gap) + 12;
    s += '<line x1="' + (leftX + colW) + '" y1="' + midY + '" x2="' + rightX + '" y2="' + midY + '" stroke="var(--faint)" stroke-dasharray="4 3" marker-end="url(#ar)"/>';
    s += '<text x="' + (leftX + colW + 6) + '" y="' + (midY - 6) + '" font-size="10.5" fill="var(--muted)">'
      + (D.arch.facts.srcToPublic || 0) + ' src→public (pure)</text>';
    s += '<text x="' + (leftX + colW + 6) + '" y="' + (midY + 14) + '" font-size="10.5" fill="var(--stop)">'
      + (D.arch.facts.publicToSrc || 0) + ' public→src (forbidden)</text>';
    if (support.length) {
      s += '<text x="' + leftX + '" y="' + (midY + 40) + '" font-size="10.5" fill="var(--muted)">support: '
        + esc(support.map(function (l) { return l.name + ' ' + l.count; }).join(' · ')) + '</text>';
    }
    s += '</svg>';
    return s;
  }

  function architectureHtml() {
    var f = D.arch.facts;
    var h = '<div class="panel"><h2>The map, as measured ' + esc(f.generatedAt || '') + '</h2>'
      + '<div class="scroll-x">' + archSvg() + '</div>'
      + '<p class="count">' + (f.modules || 0) + ' modules · ' + (f.edges || 0) + ' value imports · '
      + (f.cycles || 0) + ' cycles · ' + (f.capViolators || 0) + ' files over the 900-line cap · '
      + (f.capChecks || 0) + ' of ' + (f.modules || 0) + ' files the cap gate actually checks.</p></div>';
    h += '<div class="cols">';
    h += '<div class="panel"><h2>Cycles</h2><ul class="feed">'
      + (D.arch.cycles.length ? D.arch.cycles.map(function (c) {
        return '<li><div class="d mono">' + esc(c.join(' → ')) + '</div></li>';
      }).join('') : '<li class="d">None.</li>') + '</ul>'
      + '<h3>Cap exemptions</h3><ul class="feed">'
      + (D.arch.capExemptions.length ? D.arch.capExemptions.map(function (c) {
        return '<li><div class="d mono">' + esc(c.file) + (c.lines ? ' · ' + c.lines + ' ln' : '') + '</div></li>';
      }).join('') : '<li class="d">None recorded.</li>') + '</ul></div>';
    h += '<div class="panel"><h2>The static-file boundary</h2><p class="lede">' + md(D.arch.boundary.rule || 'not recorded') + '</p>'
      + '<ul class="feed">' + D.arch.boundary.srcToPublic.map(function (p) {
        return '<li><div class="d mono">' + esc(p[0]) + ' → ' + esc(p[1]) + '</div></li>';
      }).join('') + '</ul></div>';
    h += '</div>';
    h += '<div class="panel"><h2>Invariants — ' + D.arch.invariants.length + '</h2><div class="scroll-x"><table class="data">'
      + '<thead><tr><th>Id</th><th>Invariant</th><th>Enforced in</th><th>Held by</th><th>State</th></tr></thead><tbody>'
      + D.arch.invariants.map(function (i) {
        return '<tr><td class="mono">' + esc(i.id) + '</td><td>' + md(i.text) + '</td><td>' + md(i.enforcedIn || '—')
          + '</td><td>' + md(i.heldBy) + '</td><td>' + tag(i.status, i.status === 'done' ? 'enforced' : 'convention') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    h += '<div class="panel"><h2>Findings</h2><div class="grid">'
      + D.arch.findings.map(function (a) {
        return '<div class="card" style="--st:' + STCOLOR[a.status] + ';cursor:default">'
          + '<span class="id">' + esc(a.id) + ' · ' + esc(a.kind) + ' · ' + esc(a.size) + '</span>'
          + '<span class="t">' + md(a.title) + '</span>'
          + '<span class="sub">' + md(a.summary) + '</span>'
          + '<span class="foot">' + tag(a.status, a.statusText) + (a.wps || []).slice(0, 3).map(function (w) { return link('wp', w, w); }).join('') + '</span></div>';
      }).join('') + '</div></div>';
    h += '<div class="panel"><h2>Studio — the loop</h2><div class="stepper">'
      + D.studio.steps.map(function (s, i) {
        return '<div class="step" style="--st:' + STCOLOR[s.status] + '"><div class="n">' + (i + 1) + ' · ' + esc(s.status) + '</div>'
          + '<div class="t">' + esc(s.name) + '</div><div class="d">' + md(s.text) + '</div></div>';
      }).join('') + '</div></div>';
    h += '<div class="panel"><h2>Blueprint outline — 02-ARCHITECTURE.md</h2><ul class="feed">'
      + D.arch.outline.map(function (o) {
        return '<li style="padding-left:' + ((o.level - 2) * 16) + 'px"><div class="' + (o.level === 2 ? 't' : 'd') + '">' + md(o.title) + '</div></li>';
      }).join('') + '</ul></div>';
    return h;
  }

  function releasesHtml() {
    var h = '<div class="panel"><h2>Releases</h2><p class="lede">Every section of CHANGELOG.md, newest first. '
      + 'The current package version is ' + esc(D.meta.version || 'unknown') + '.</p></div>';
    h += D.releases.map(function (r) {
      return '<div class="panel" id="rel-' + esc(r.version) + '"><h2>' + esc(r.version) + (r.date ? ' — ' + esc(r.date) : '') + '</h2>'
        + '<p class="count">' + r.count + ' entries · ' + esc((r.groups || []).join(' · ')) + '</p>'
        + '<ul class="feed">' + (r.highlights || []).map(function (t) {
          return '<li><div class="t">' + md(t) + '</div></li>';
        }).join('') + '</ul></div>';
    }).join('');
    return h;
  }

  // ── drawer ────────────────────────────────────────────────────────────────
  var lastFocus = null;
  function fieldHtml(k, v) {
    if (!v) return '';
    return '<div class="field"><div class="k">' + esc(k) + '</div><div class="v">' + v + '</div></div>';
  }
  function chipRow(kind, ids, label) {
    if (!ids || !ids.length) return '';
    return fieldHtml(label, ids.map(function (id) {
      return has(kind, String(id)) ? link(kind, String(id), kind === 'dev' ? '§' + id : id)
        : '<span class="tag dim">' + esc(kind === 'dev' ? '§' + id : id) + '</span>';
    }).join(' '));
  }
  function detailHtml(kind, id) {
    var i = INDEX[kind] && INDEX[kind][id];
    if (!i) return null;
    var head, body = '';
    if (kind === 'req') {
      head = { id: i.id, title: i.title, status: i.status, statusText: i.statusText, meta: i.area };
      if (i.quote) body += '<div class="field"><blockquote class="owner">' + md(i.quote)
        + '<cite>the owner' + (i.quoteDate ? ', ' + esc(i.quoteDate) : '') + '</cite></blockquote></div>';
      body += fieldHtml('Interpretation', md(i.interpretation));
      body += fieldHtml('Why', md(i.why));
      body += fieldHtml('Status', esc(i.statusText));
      body += fieldHtml('Implemented by', refLinks(i.implementedBy));
      body += chipRow('wp', i.wps, 'Work packages');
      body += chipRow('dev', i.devs, 'Decision log');
      body += chipRow('story', i.stories, 'User stories');
      body += fieldHtml('Notes', md(i.notes));
    } else if (kind === 'wp') {
      head = { id: i.id, title: i.title, status: i.status, statusText: i.statusText, meta: i.source };
      body += fieldHtml('Accepted when', md(i.acceptance));
      body += fieldHtml('Status', refLinks(i.statusText));
      body += fieldHtml('Owner', esc(i.owner));
      body += fieldHtml('Size', esc(i.size));
      body += fieldHtml('Depends on', refLinks(i.depends));
      body += chipRow('req', i.requirements, 'Requirements served');
      body += chipRow('dev', i.devsAll, 'Decision log');
      body += fieldHtml('Source', esc(i.source));
    } else if (kind === 'dev') {
      head = { id: '§' + i.n, title: i.title, status: i.raise ? 'in progress' : 'done', statusText: i.raise ? 'RAISE — open question' : 'recorded', meta: 'DEVIATIONS.md' };
      body += fieldHtml('What changed, and why', md(i.summary));
      body += chipRow('wp', i.wps || [], 'Work packages');
      var back = D.requirements.filter(function (r) { return (r.devs || []).indexOf(i.n) >= 0; }).map(function (r) { return r.id; });
      body += chipRow('req', back, 'Requirements citing it');
    } else if (kind === 'story') {
      head = { id: i.id, title: i.title, status: storyStatus(i), statusText: storyStatus(i), meta: i.date };
      body += fieldHtml('The case', md(i.body));
      body += chipRow('req', i.requirements, 'Requirements');
      body += fieldHtml('Principles', (i.principles || []).map(function (p) { return '<span class="tag area">' + esc(p) + '</span>'; }).join(' '));
    } else if (kind === 'feat') {
      head = { id: i.key, title: i.title, status: i.status, statusText: i.kind === 'shipped' ? 'shipped' : 'specified', meta: i.group };
      body += fieldHtml('Detail', md(i.detail));
      body += fieldHtml('Source', esc(i.source));
      body += chipRow('wp', i.wps, 'Work packages');
      body += chipRow('dev', i.devs, 'Decision log');
    } else return null;
    return '<header><div style="flex:1 1 auto"><span class="id mono">' + esc(head.id) + '</span>'
      + '<h2>' + md(head.title) + '</h2>'
      + '<div class="foot" style="display:flex;gap:5px;margin-top:7px">' + tag(head.status, head.statusText || head.status)
      + (head.meta ? '<span class="tag area">' + esc(head.meta) + '</span>' : '') + '</div></div>'
      + '<button class="x" id="close" type="button" aria-label="Close">✕</button></header>'
      + '<div class="body">' + body + '</div>';
  }
  function openDetail(kind, id, push) {
    var html = detailHtml(kind, String(id));
    if (!html) return false;
    closeDrawer(true);
    lastFocus = document.activeElement;
    var scrim = document.createElement('div');
    scrim.id = 'scrim';
    scrim.addEventListener('click', function () { closeDrawer(); });
    var d = document.createElement('aside');
    d.id = 'drawer';
    d.setAttribute('role', 'dialog');
    d.setAttribute('aria-modal', 'true');
    d.setAttribute('aria-label', kind + ' ' + id);
    d.innerHTML = html;
    document.body.appendChild(scrim);
    document.body.appendChild(d);
    d.querySelector('#close').addEventListener('click', function () { closeDrawer(); });
    d.addEventListener('keydown', trap);
    d.querySelector('#close').focus();
    if (push !== false && location.hash !== '#' + kind + '/' + id) {
      history.replaceState(null, '', '#' + kind + '/' + encodeURIComponent(id));
    }
    return true;
  }
  function trap(e) {
    if (e.key !== 'Tab') return;
    var d = document.getElementById('drawer');
    var f = d.querySelectorAll('a[href], button, input, select, [tabindex]:not([tabindex="-1"])');
    if (!f.length) return;
    var first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  function closeDrawer(quiet) {
    var d = document.getElementById('drawer');
    var s = document.getElementById('scrim');
    if (d) d.remove();
    if (s) s.remove();
    if (!quiet) {
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
    }
  }
  var TABFOR = { req: 'requirements', wp: 'packages', dev: 'decisions', story: 'stories', feat: 'features' };
  function fromHash(push) {
    var m = /^#([a-z]+)\\/(.+)$/.exec(location.hash || '');
    if (!m) return false;
    var kind = m[1], id = decodeURIComponent(m[2]);
    if (!has(kind, id)) return false;
    if (TABFOR[kind] && S.tab !== TABFOR[kind]) { S.tab = TABFOR[kind]; save(); renderChrome(); renderTab(); }
    return openDetail(kind, id, push);
  }

  // ── wiring ────────────────────────────────────────────────────────────────
  function wireTab() {
    var tab = S.tab;
    var cards = document.getElementById('cards');
    if (cards) {
      var list = cards.querySelectorAll('[data-card]');
      if (list.length) list[0].tabIndex = 0;
      cards.addEventListener('click', function (e) {
        var c = e.target.closest('[data-card]');
        if (c) openDetail(c.dataset.kind, c.dataset.id);
      });
      cards.addEventListener('keydown', function (e) {
        var c = e.target.closest('[data-card]');
        if (!c) return;
        var all = Array.prototype.slice.call(cards.querySelectorAll('[data-card]'));
        var ix = all.indexOf(c);
        var perRow = 1;
        if (cards.classList.contains('grid')) {
          var top = c.getBoundingClientRect().top;
          perRow = all.filter(function (n) { return Math.abs(n.getBoundingClientRect().top - top) < 4; }).length || 1;
        }
        var next = null;
        if (e.key === 'ArrowRight') next = all[ix + 1];
        else if (e.key === 'ArrowLeft') next = all[ix - 1];
        else if (e.key === 'ArrowDown') next = all[ix + perRow] || all[all.length - 1];
        else if (e.key === 'ArrowUp') next = all[ix - perRow] || all[0];
        else if (e.key === 'Home') next = all[0];
        else if (e.key === 'End') next = all[all.length - 1];
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(c.dataset.kind, c.dataset.id); return; }
        if (next) { e.preventDefault(); all.forEach(function (n) { n.tabIndex = -1; }); next.tabIndex = 0; next.focus(); }
      });
    }
    var q = document.getElementById('q');
    if (q) {
      q.addEventListener('input', function () {
        S.q[tab] = q.value; save();
        var pos = q.selectionStart;
        renderTab();
        var nq = document.getElementById('q');
        if (nq) { nq.focus(); try { nq.setSelectionRange(pos, pos); } catch (e) {} }
      });
    }
    var sort = document.getElementById('sort');
    if (sort) sort.addEventListener('change', function () { S.sort[tab] = sort.value; save(); renderTab(); });
    var chips = document.getElementById('chips');
    if (chips) chips.addEventListener('click', function (e) {
      var b = e.target.closest('button[data-f]');
      if (!b) return;
      var bag = S[b.dataset.f];
      var arr = (bag[tab] || []).slice();
      var ix = arr.indexOf(b.dataset.v);
      if (ix >= 0) arr.splice(ix, 1); else arr.push(b.dataset.v);
      bag[tab] = arr; save(); renderTab();
    });
    var clear = document.getElementById('clear');
    if (clear) clear.addEventListener('click', function () {
      S.q[tab] = ''; S.status[tab] = []; S.area[tab] = []; save(); renderTab();
    });
    document.querySelectorAll('[data-view]').forEach(function (b) {
      b.addEventListener('click', function () { S.view[tab] = b.dataset.view; save(); renderTab(); });
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && document.getElementById('drawer')) { e.preventDefault(); closeDrawer(); return; }
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ''))) {
      var q = document.getElementById('q');
      if (q) { e.preventDefault(); q.focus(); q.select(); }
    }
  });
  document.addEventListener('click', function (e) {
    var a = e.target.closest('a[href^="#"]');
    if (!a) return;
    var m = /^#([a-z]+)\\/(.+)$/.exec(a.getAttribute('href'));
    if (!m) return;
    e.preventDefault();
    var kind = m[1], id = decodeURIComponent(m[2]);
    if (!has(kind, id)) return;
    if (TABFOR[kind] && S.tab !== TABFOR[kind]) { S.tab = TABFOR[kind]; save(); renderChrome(); renderTab(); }
    openDetail(kind, id);
  });
  window.addEventListener('hashchange', function () { if (!fromHash(false)) closeDrawer(true); });

  document.getElementById('theme').addEventListener('click', function () {
    var root = document.documentElement;
    var now = root.getAttribute('data-theme');
    var dark = now ? now === 'dark' : window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.setAttribute('data-theme', dark ? 'light' : 'dark');
    try { localStorage.setItem('deckhq-hub-theme', dark ? 'light' : 'dark'); } catch (e) {}
  });
  try {
    var savedTheme = localStorage.getItem('deckhq-hub-theme');
    if (savedTheme === 'light' || savedTheme === 'dark') document.documentElement.setAttribute('data-theme', savedTheme);
  } catch (e) {}

  load();
  indexAll();
  renderChrome();
  renderTab();
  fromHash(false);
  var foot = document.createElement('footer');
  foot.className = 'foot wrap';
  foot.innerHTML = 'Generated from the repository\\u2019s own documents by scripts/dashboard/build.mjs'
    + '<span>Site: <a href="${data.meta.links.site}">${data.meta.links.site}</a></span>'
    + '<span>Repository: <a href="${data.meta.links.repo}">${data.meta.links.repo}</a></span>'
    + '<span>Press / to search, arrows to move, Enter to open, Esc to close</span>';
  document.getElementById('main').appendChild(foot);
}());
</script>
`;
}
