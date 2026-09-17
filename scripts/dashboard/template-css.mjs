// The page stylesheet. Moved verbatim out of template.mjs to keep each file
// under the 900-line ceiling; template.mjs drops it between its <style> tags.

export const CSS = `:root {
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
}`;
