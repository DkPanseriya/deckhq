/**
 * The Usage tab — where the tokens went (WP-83).
 *
 * The owner, 14 September 2026: *"it should help them track their token usage:
 * where are they going, how much, in which sessions, how much input, cached,
 * output, so they can make smart decisions."*
 *
 * This is the deck's second tab. The first one is a queue of debts; this one is
 * a ledger of spend, and they are the same surface because they are the same
 * act — sitting down to look at what the floor has been doing rather than
 * watching it move.
 *
 * ============================================================================
 * FOUR RULES, ALL OF THEM LOAD-BEARING
 *
 * 1. **Every figure here came from a ledger record.** Nothing on this tab is
 *    derived from the live snapshot, because a table that quietly mixed "what
 *    was written down" with "what is on the floor right now" would be
 *    unfalsifiable. The one exception is a NAME: a project key and a session id
 *    are looked up against the snapshot so the reader sees `checkout-flow`
 *    rather than a hash, and a key with no session on the floor stays a hash.
 * 2. **`no data`, never `0`.** A counter that no record in the window named —
 *    Codex writes no cache-write figure, so a Codex-only window has no
 *    cache-write column — prints `no data`. `0` is a measurement, and nobody
 *    made it. This is `src/core/rates.mjs`'s `NO_RATE` rule applied to tokens,
 *    and `src/core/usage.mjs` is where the absence is computed.
 * 3. **Every table is a real `<table>`.** Column headers, `scope`, a row
 *    header, a caption, and `aria-sort` on the column being sorted by. The deck
 *    is the accessible equivalent of the floor (`05-GUI-UX-SPEC.md` §10) and a
 *    grid of divs would take that away from the half of the product that is
 *    only reachable here.
 * 4. **It never fetches.** Same discipline as `deck.js`: the render functions
 *    are pure, take their `document` as an argument, and are handed data. The
 *    controller is given a `loadUsage` by `app.js`. A unit test therefore
 *    asserts the DOM that ships rather than a stub of it.
 * ============================================================================
 *
 * NO CURRENCY LIVES IN THIS FILE, at all, under any setting. The cost surfaces
 * WP-83 put behind `settings.showCost` are the ones that already existed — the
 * panel's bottom line, the board, the room plate, the postcard, Wrapped. This
 * tab is the thing that stands where they were, and a rate card cannot get a
 * token count wrong.
 */

import { cut, groupDigits } from './deck.js';

/** The three windows the picker offers. Mirrors `WINDOWS` in `src/core/usage.mjs`. */
export const USAGE_WINDOWS = Object.freeze([
  Object.freeze({ key: 'today', label: 'Today' }),
  Object.freeze({ key: '7d', label: '7 days' }),
  Object.freeze({ key: '30d', label: '30 days' }),
]);

/**
 * The four counters, in the order a turn actually happens in: what you sent,
 * what was cached off the back of it, what came back free next time, what the
 * model said. Mirrors `COUNTERS` in `src/core/usage.mjs`.
 */
export const COUNTERS = Object.freeze(['input', 'cacheWrite', 'cacheRead', 'output']);

/** What a person calls each counter. */
export const COUNTER_LABELS = Object.freeze({
  input: 'Input',
  cacheWrite: 'Cache write',
  cacheRead: 'Cache read',
  output: 'Output',
});

/** Rule 2, in one string. */
export const NO_DATA = 'no data';

/**
 * A cell for one counter: the number, or `no data` when nothing in the window
 * reported it.
 * @param {any} row a bucket from `src/core/usage.mjs`
 * @param {string} counter
 */
export function counterCell(row, counter) {
  const absent = Array.isArray(row?.absent) && row.absent.includes(counter);
  return absent ? NO_DATA : groupDigits(row?.[counter] || 0);
}

/**
 * The trend line: this seven days against the seven before it.
 *
 * A number only when BOTH windows hold records. A week measured against a week
 * the machine was switched off for is "up 100%", which is true of the
 * arithmetic and false of the work.
 * @param {any} trend
 */
export function trendLine(trend) {
  if (!trend || trend.status !== 'ok' || trend.changePct == null) {
    return `7 days vs the 7 before · ${NO_DATA}`;
  }
  const pct = Number(trend.changePct);
  const sign = pct > 0 ? '+' : '';
  return `7 days vs the 7 before · ${sign}${pct}%`;
}

// --------------------------------------------------------------- the bar

/**
 * The split as one stacked bar.
 *
 * `role="img"` with the whole split spelled out in its label, because the bar
 * carries proportion and the table under it carries the numbers — a screen
 * reader that got four unlabelled boxes would get nothing. A counter nobody
 * reported contributes no segment at all rather than a zero-width one.
 *
 * @param {any} totals
 * @param {{createElement:(tag:string)=>any}} doc
 */
export function buildSplitBar(totals, doc) {
  const bar = doc.createElement('div');
  bar.className = 'usage-bar';
  bar.setAttribute('role', 'img');

  const absent = Array.isArray(totals?.absent) ? totals.absent : [];
  const present = COUNTERS.filter((c) => !absent.includes(c));
  const sum = present.reduce((a, c) => a + (Number(totals?.[c]) || 0), 0);

  /** @type {string[]} */
  const spoken = [];
  for (const counter of COUNTERS) {
    if (absent.includes(counter)) {
      spoken.push(`${COUNTER_LABELS[counter]} ${NO_DATA}`);
      continue;
    }
    const n = Number(totals?.[counter]) || 0;
    spoken.push(`${COUNTER_LABELS[counter]} ${groupDigits(n)}`);
    if (sum <= 0 || n <= 0) continue;
    const seg = doc.createElement('span');
    seg.className = 'usage-seg';
    seg.setAttribute('data-counter', counter);
    seg.style.width = `${(n / sum) * 100}%`;
    bar.appendChild(seg);
  }
  bar.setAttribute('aria-label', `Token split: ${spoken.join(', ')}`);
  return bar;
}

/**
 * The legend under the bar: one chip per counter, with its number. The colour
 * is never the only carrier — every chip spells its counter out.
 * @param {any} totals
 * @param {{createElement:(tag:string)=>any}} doc
 */
export function buildSplitLegend(totals, doc) {
  const list = doc.createElement('ul');
  list.className = 'usage-legend';
  list.setAttribute('role', 'list');
  for (const counter of COUNTERS) {
    const item = doc.createElement('li');
    item.className = 'usage-legend-item';
    item.setAttribute('data-counter', counter);
    const swatch = doc.createElement('span');
    swatch.className = 'usage-swatch';
    swatch.setAttribute('aria-hidden', 'true');
    const name = doc.createElement('span');
    name.className = 'usage-legend-k';
    name.textContent = COUNTER_LABELS[counter];
    const value = doc.createElement('span');
    value.className = 'usage-legend-v num';
    value.textContent = counterCell(totals, counter);
    item.append(swatch, name, value);
    list.appendChild(item);
  }
  return list;
}

// ------------------------------------------------------------- the tables

/**
 * Sort rows by a column, stably and totally.
 *
 * Ties break on the row's own key, so two rows that share a token count to the
 * token land in the same place in every browser — the same reason
 * `queueGroups` breaks its ties on the id.
 *
 * @param {any[]} rows
 * @param {string} key the column's `key`
 * @param {'asc'|'desc'} dir
 * @param {(row:any, key:string) => any} valueOf
 */
export function sortRows(rows, key, dir, valueOf) {
  const sign = dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const av = valueOf(a, key);
    const bv = valueOf(b, key);
    if (typeof av === 'number' && typeof bv === 'number') {
      return sign * (av - bv) || String(a.key).localeCompare(String(b.key));
    }
    return (
      sign * String(av).localeCompare(String(bv)) || String(a.key).localeCompare(String(b.key))
    );
  });
}

/**
 * One sortable table.
 *
 * `columns` is `[{key, label, numeric?, width?}]` and `cell(row, key)` returns
 * the text. The FIRST column is the row header (`<th scope="row">`), so a
 * screen reader reading down the Output column still says whose output it is.
 *
 * @param {object} spec
 * @param {string} spec.id
 * @param {string} spec.caption
 * @param {any[]} spec.rows
 * @param {{key:string,label:string,numeric?:boolean}[]} spec.columns
 * @param {(row:any,key:string) => string} spec.cell
 * @param {{key:string, dir:'asc'|'desc'}} [spec.sort]
 * @param {{createElement:(tag:string)=>any}} doc
 */
export function buildUsageTable(spec, doc) {
  const table = doc.createElement('table');
  table.className = 'usage-table';
  table.setAttribute('data-table', spec.id);

  const caption = doc.createElement('caption');
  caption.className = 'usage-caption';
  caption.textContent = spec.caption;
  table.appendChild(caption);

  const thead = doc.createElement('thead');
  const headRow = doc.createElement('tr');
  for (const col of spec.columns) {
    const th = doc.createElement('th');
    th.setAttribute('scope', 'col');
    th.className = col.numeric ? 'usage-col num' : 'usage-col';
    th.setAttribute('data-column', col.key);
    // `aria-sort` on the sorted column and nowhere else — the attribute means
    // "this is the column the table is ordered by", and putting `none` on the
    // other four says it four more times for no information.
    if (spec.sort && spec.sort.key === col.key) {
      th.setAttribute('aria-sort', spec.sort.dir === 'asc' ? 'ascending' : 'descending');
    }
    const button = doc.createElement('button');
    button.setAttribute('type', 'button');
    button.className = 'usage-sort';
    button.setAttribute('data-column', col.key);
    button.textContent = col.label;
    th.appendChild(button);
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = doc.createElement('tbody');
  if (spec.rows.length === 0) {
    const tr = doc.createElement('tr');
    const td = doc.createElement('td');
    td.className = 'usage-empty';
    td.setAttribute('colspan', String(spec.columns.length));
    td.textContent = NO_DATA;
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
  for (const row of spec.rows) {
    const tr = doc.createElement('tr');
    tr.className = 'usage-row';
    tr.setAttribute('data-key', String(row.key));
    for (const [i, col] of spec.columns.entries()) {
      const cell = doc.createElement(i === 0 ? 'th' : 'td');
      if (i === 0) cell.setAttribute('scope', 'row');
      cell.className = col.numeric ? 'usage-cell num' : 'usage-cell';
      cell.textContent = spec.cell(row, col.key);
      tr.appendChild(cell);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

/**
 * How each table arrives before anybody clicks a column.
 *
 * Biggest first everywhere except BY DAY, which arrives as a calendar. A table
 * of days ranked by size is not a picture of a week — it is the one table here
 * whose row order carries meaning of its own, and ranking it would throw that
 * away before the reader ever saw it. Clicking `Total` still ranks it; this is
 * only where it starts.
 */
const DEFAULT_SORTS = Object.freeze({
  default: Object.freeze({ key: 'total', dir: /** @type {const} */ ('desc') }),
  'by-day': Object.freeze({ key: 'day', dir: /** @type {const} */ ('asc') }),
});

/**
 * Where one table starts. Exported because `deck.js` has to know it too: the
 * first click on a column has to reverse the order the reader is looking at,
 * and it can only do that if both files agree on what that order was.
 * @param {string} id the table's `data-section`
 * @returns {{key:string, dir:'asc'|'desc'}}
 */
export function defaultSortFor(id) {
  return { ...(DEFAULT_SORTS[id] || DEFAULT_SORTS.default) };
}

/**
 * The name a project key or a session id is shown under.
 *
 * A lookup and never a reverse: the ledger holds hashes by design (WP-48), so
 * a project with no session on the floor stays a shortened hash, which is
 * honest about the fact that we do not know what it was called. Identical in
 * spirit to `projectNames()` in `src/cli/stats.mjs`.
 *
 * @param {Record<string,string>|null|undefined} names
 * @param {string} key
 */
export function nameFor(names, key) {
  const found = names && names[key];
  return found || String(key || '').slice(0, 8);
}

/**
 * The whole tab, built from one `usage` payload.
 *
 * @param {any} usage `GET /api/stats`'s `usage`
 * @param {object} opts
 * @param {string} [opts.window]        which picker button is pressed
 * @param {Record<string,string>} [opts.projectNames]
 * @param {Record<string,string>} [opts.sessionNames]
 * @param {Record<string,{key:string,dir:'asc'|'desc'}>} [opts.sorts] per table
 * @param {{createElement:(tag:string)=>any}} doc
 */
export function renderUsageView(usage, opts, doc) {
  const root = doc.createElement('div');
  root.className = 'usage';

  // -------------------------------------------------------- window picker
  const picker = doc.createElement('div');
  picker.className = 'usage-windows';
  picker.setAttribute('role', 'group');
  picker.setAttribute('aria-label', 'Usage window');
  const active = opts.window || usage?.window || '7d';
  for (const win of USAGE_WINDOWS) {
    const button = doc.createElement('button');
    button.setAttribute('type', 'button');
    button.className = win.key === active ? 'usage-window is-selected' : 'usage-window';
    button.setAttribute('data-window', win.key);
    button.setAttribute('aria-pressed', win.key === active ? 'true' : 'false');
    button.textContent = win.label;
    picker.appendChild(button);
  }
  root.appendChild(picker);

  if (!usage || usage.empty) {
    const empty = doc.createElement('p');
    empty.className = 'usage-nodata';
    empty.textContent = `${NO_DATA} — nothing was written to the ledger in this window.`;
    root.appendChild(empty);
    return root;
  }

  // --------------------------------------------------------------- totals
  const head = doc.createElement('div');
  head.className = 'usage-head';
  const total = doc.createElement('p');
  total.className = 'usage-total';
  const totalValue = doc.createElement('span');
  totalValue.className = 'usage-total-v num';
  totalValue.textContent = groupDigits(usage.totals.total);
  const totalKey = doc.createElement('span');
  totalKey.className = 'usage-total-k';
  totalKey.textContent = `tokens · ${usage.label || ''}`.trim();
  total.append(totalValue, totalKey);
  head.appendChild(total);

  const trend = doc.createElement('p');
  trend.className = 'usage-trend';
  trend.textContent = trendLine(usage.trend);
  head.appendChild(trend);
  root.appendChild(head);

  root.appendChild(buildSplitBar(usage.totals, doc));
  root.appendChild(buildSplitLegend(usage.totals, doc));

  // --------------------------------------------------------------- tables
  const sorts = opts.sorts || {};
  const counterColumns = COUNTERS.map((c) => ({
    key: c,
    label: COUNTER_LABELS[c],
    numeric: true,
  }));

  /** @param {any} row @param {string} key */
  const counterOrTotal = (row, key) =>
    key === 'total' ? groupDigits(row.total) : counterCell(row, key);

  const tables = [
    {
      id: 'by-project',
      caption: 'Where the tokens went, by project',
      rows: usage.byProject,
      columns: [
        { key: 'name', label: 'Project' },
        ...counterColumns,
        { key: 'total', label: 'Total', numeric: true },
      ],
      cell: (/** @type {any} */ row, /** @type {string} */ key) =>
        key === 'name'
          ? cut(nameFor(opts.projectNames, row.projectKey), 28)
          : counterOrTotal(row, key),
    },
    {
      id: 'by-session',
      caption: 'Where the tokens went, by session',
      rows: usage.bySession,
      columns: [
        { key: 'name', label: 'Session' },
        { key: 'project', label: 'Project' },
        { key: 'model', label: 'Model' },
        ...counterColumns,
        { key: 'total', label: 'Total', numeric: true },
      ],
      cell: (/** @type {any} */ row, /** @type {string} */ key) => {
        if (key === 'name') return cut(nameFor(opts.sessionNames, row.sessionId), 24);
        if (key === 'project') return cut(nameFor(opts.projectNames, row.projectKey), 20);
        // A record that never named a model is not filed under a made-up one.
        if (key === 'model') return row.model ? cut(row.model, 22) : NO_DATA;
        return counterOrTotal(row, key);
      },
    },
    {
      id: 'by-model',
      caption: 'By model',
      rows: usage.byModel,
      columns: [
        { key: 'model', label: 'Model' },
        ...counterColumns,
        { key: 'total', label: 'Total', numeric: true },
      ],
      cell: (/** @type {any} */ row, /** @type {string} */ key) =>
        key === 'model' ? cut(row.model, 28) : counterOrTotal(row, key),
    },
    {
      id: 'by-day',
      caption: 'By day',
      rows: usage.byDay,
      columns: [
        { key: 'day', label: 'Day' },
        ...counterColumns,
        { key: 'total', label: 'Total', numeric: true },
      ],
      cell: (/** @type {any} */ row, /** @type {string} */ key) =>
        key === 'day' ? String(row.key) : counterOrTotal(row, key),
    },
    {
      id: 'by-tool',
      caption: 'By tool, where a record named one',
      rows: usage.byTool,
      columns: [
        { key: 'tool', label: 'Tool' },
        ...counterColumns,
        { key: 'total', label: 'Total', numeric: true },
      ],
      cell: (/** @type {any} */ row, /** @type {string} */ key) =>
        key === 'tool' ? cut(row.tool, 28) : counterOrTotal(row, key),
    },
  ];

  for (const spec of tables) {
    const section = doc.createElement('section');
    section.className = 'usage-section';
    section.setAttribute('data-section', spec.id);
    const scroller = doc.createElement('div');
    scroller.className = 'usage-scroll';
    const sort = sorts[spec.id] || DEFAULT_SORTS[spec.id] || DEFAULT_SORTS.default;
    scroller.appendChild(
      buildUsageTable(
        {
          ...spec,
          sort,
          rows: sortRows(spec.rows, sort.key, sort.dir, (row, key) =>
            key === 'total'
              ? Number(row.total) || 0
              : COUNTERS.includes(key)
                ? Number(row[key]) || 0
                : spec.cell(row, key),
          ),
        },
        doc,
      ),
    );
    section.appendChild(scroller);
    root.appendChild(section);
  }

  // How much of the window the two optional dimensions could account for. A
  // table that covers a fifth of the tokens has to be able to say so, or a
  // reader adds its column up and believes it.
  const attributed = usage.attributed || {};
  const foot = doc.createElement('p');
  foot.className = 'usage-foot';
  foot.textContent =
    `Every figure here is a sum of ledger records. ` +
    `${groupDigits(attributed.model || 0)} of ${groupDigits(usage.totals.total)} tokens name a model, ` +
    `${groupDigits(attributed.tool || 0)} name a tool.`;
  root.appendChild(foot);

  return root;
}
