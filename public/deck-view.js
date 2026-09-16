/**
 * The deck's pure half: one order, and the DOM it draws.
 *
 * Split out of `public/deck.js` by WP-92m
 * (`docs/plan/13-ARCHITECTURE-AUDIT.md` A-12 and A-07, `docs/DEVIATIONS.md` §183)
 * at the seam that file already drew for itself — "the pure half above is what
 * the unit test drives; this half is the wiring". Everything below is that pure
 * half, moved whole: not one declaration changed, and the only edit inside one
 * is nothing at all, because every one of them was already exported.
 *
 * NOTHING HERE TOUCHES A LIVE ELEMENT. Every render function is pure and takes
 * its `document` as an argument, so `test/unit/deck-view.test.mjs` drives the
 * whole of it against a stub. The invariant in `deck.js`’s header covers this
 * module unchanged: no `/api/ack`, no fetch, no `innerHTML`.
 *
 * IT IMPORTS NOTHING BUT THE CLOCK, and that is what closes the cycle A-07
 * named. `public/usage.js` needs `cut` and `groupDigits`; it used to reach into
 * `deck.js` for them, and `deck.js` reached back into `usage.js` for the Usage
 * tab's three exports. Both halves of that pair now point here, and this module
 * points at neither.
 */

import { now as clockNow } from './clock.js';

// ---------------------------------------------------------------- ordering

/**
 * Past this, a wait is old enough to be worth the accent (§3.1: "Past 24h
 * they render in --accent").
 */
export const OLD_MS = 24 * 3600 * 1000;

/** Below this the floor is still the efficient surface (§3.2). */
export const DECK_HINT_THRESHOLD = 6;

/**
 * When this agent started waiting on the user. The user-owned timestamps
 * first, because they are the ones the queue is ordered by and the ones that
 * survive a restart. Identical to `waitStart()` in `src/cli/source.mjs`.
 * @param {any} agent
 * @returns {number}
 */
export function waitStart(agent) {
  const pick = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
  return (
    pick(agent?.reviewSince) ??
    pick(agent?.needsInputSince) ??
    pick(agent?.lastOutputAt) ??
    pick(agent?.lastActivityAt) ??
    0
  );
}

/** @param {any} agent */
function needsYou(agent) {
  return (
    agent?.ackState === 'active' &&
    (agent.activityState === 'needs_input' ||
      agent.activityState === 'stalled' ||
      agent.activityState === 'for_review')
  );
}

/**
 * The queue's two groups, in the queue's order.
 *
 * `docs/plan/05-GUI-UX-SPEC.md` §3.2: oldest first, `for_review` and
 * `needs_input` above `stalled`, separated by a rule, "because a raised hand
 * and a finished turn need different responses and a stall is not a debt in
 * the same way". Ties break on the id so the order is total — two sessions
 * can share a timestamp to the millisecond after a restart, and a queue whose
 * order depends on `Array.prototype.sort` stability across engines is a queue
 * whose `J` key lands somewhere different in a different browser.
 *
 * The mirror of `groupRows(agents, { waitingOnly: true })` in
 * `src/cli/deck.mjs`. See the module note.
 *
 * @param {any[]} agents
 * @param {{projectFilter?: string|null}} [opts]
 * @returns {Array<{key:'waiting'|'stalled', rows:any[]}>}
 */
export function queueGroups(agents, opts = {}) {
  const filter = opts.projectFilter ?? null;
  const all = (Array.isArray(agents) ? agents : []).filter(
    (a) => needsYou(a) && (filter === null || a.projectId === filter),
  );
  // WP-89 §3.2: *"the deck shows a crew as ONE expandable group under its parent
  // rather than N sibling rows, so a crew of twelve does not push the floor off
  // the table."* A junior whose parent is in this same queue is therefore not a
  // row of its own — it is a line under the parent's, built by `renderDeckTable`
  // from `crewGroups` below. A junior whose parent is NOT in the queue keeps its
  // own row: folding it under a row that does not exist would hide it.
  const folded = crewGroups(all);
  const list = all.filter((a) => !(a.subagent === true && folded.has(String(a.parentId ?? ''))));
  const by = (a, b) => waitStart(a) - waitStart(b) || String(a.id).localeCompare(String(b.id));
  const waiting = list.filter((a) => a.activityState !== 'stalled').sort(by);
  const stalled = list.filter((a) => a.activityState === 'stalled').sort(by);
  return [
    { key: /** @type {const} */ ('waiting'), rows: waiting },
    { key: /** @type {const} */ ('stalled'), rows: stalled },
  ].filter((g) => g.rows.length > 0);
}

/**
 * THE JUNIORS THAT FOLD UNDER A PARENT ALREADY IN THIS LIST (WP-89).
 *
 * Keyed by parent id, ordered by junior id — the order the arc seats them in and
 * the order `describeJunior` numbers them in, so the floor, the deck and the
 * panel all agree about which junior is the first one.
 *
 * Only over the rows it is handed: a junior is folded because its PARENT IS
 * VISIBLE, never because it has one. That is what stops a junior disappearing
 * out of a filtered deck whose parent the filter removed.
 *
 * @param {any[]} rows the queue rows, already filtered
 * @returns {Map<string, any[]>}
 */
export function crewGroups(rows) {
  const present = new Set((rows || []).map((a) => String(a.id)));
  /** @type {Map<string, any[]>} */
  const out = new Map();
  for (const a of rows || []) {
    if (!a || a.subagent !== true) continue;
    const parentId = String(a.parentId ?? '');
    if (!parentId || !present.has(parentId)) continue;
    const list = out.get(parentId) || [];
    list.push(a);
    out.set(parentId, list);
  }
  for (const list of out.values()) list.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return out;
}

/**
 * The queue as one flat list — what `J`/`K` walk, what the strip lays out
 * left to right, and what the deck reads top to bottom. One order, three
 * surfaces.
 * @param {any[]} agents
 * @param {{projectFilter?: string|null}} [opts]
 */
export function queueOrder(agents, opts = {}) {
  return queueGroups(agents, opts).flatMap((g) => g.rows);
}

/**
 * Where the user actually is in the queue, or `null` if they are nowhere in
 * it yet. The panel's selection wins while it is still in the queue; the
 * deck's own cursor is the fallback for a panel that is shut.
 *
 * Kept separate from `queueCursor()` below because "nowhere yet" is a real
 * answer with real consequences: the first `J` must land on the OLDEST item,
 * not on the second one, and it only can if `move()` can tell "nothing is
 * selected" apart from "the oldest is selected".
 *
 * @param {any[]} queue in queue order
 * @param {string|null|undefined} selectedId what the panel and the floor ring
 * @param {string|null|undefined} [fallbackId] where the deck's cursor was
 * @returns {string|null}
 */
export function queueAnchor(queue, selectedId, fallbackId) {
  const has = (id) => Boolean(id) && queue.some((a) => a.id === id);
  if (has(selectedId)) return selectedId ?? null;
  if (has(fallbackId)) return fallbackId ?? null;
  return null;
}

/**
 * The row every key acts on, on all three levels.
 *
 * WP-10 is accepted on "`J`/`K`/`1`/`2`/`3` work identically in strip, deck
 * and floor", and the only way to mean that is for one function to decide
 * what "the selected one" is, everywhere. Where the user is if they are
 * somewhere, and the oldest item if they are not — so a queue on screen
 * always has something the number keys can act on.
 *
 * @param {any[]} queue in queue order
 * @param {string|null|undefined} selectedId
 * @param {string|null|undefined} [fallbackId]
 * @returns {string|null}
 */
export function queueCursor(queue, selectedId, fallbackId) {
  return queueAnchor(queue, selectedId, fallbackId) ?? (queue.length ? queue[0].id : null);
}

/**
 * Where `J` (`+1`) or `K` (`-1`) lands from here. Clamped, not wrapped: the
 * queue is a list of debts in age order, and wrapping from the newest back to
 * the oldest makes "keep pressing J" silently start again.
 *
 * @param {any[]} queue @param {string|null} from @param {1|-1} direction
 * @returns {string|null}
 */
export function queueStep(queue, from, direction) {
  if (queue.length === 0) return null;
  let index = queue.findIndex((a) => a.id === from);
  if (index === -1) index = direction > 0 ? 0 : queue.length - 1;
  else index = Math.max(0, Math.min(queue.length - 1, index + direction));
  return queue[index].id;
}

// --------------------------------------------------------------- formatting

/**
 * "1d 2h", "4h 12m", "40m", "7m" — the spec's own waiting column, which shows
 * two units while the wait is long enough for the second one to matter.
 * Identical to `waited()` in `src/cli/deck.mjs`; pinned by the same test.
 * @param {number} ms
 */
export function waited(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return h < 10 ? `${h}h ${String(m % 60).padStart(2, '0')}m` : `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

/** Thousands separators without depending on the machine's ICU build. */
export function groupDigits(n) {
  const s = String(Math.trunc(Math.abs(Number(n) || 0)));
  const parts = [];
  for (let i = s.length; i > 0; i -= 3) parts.unshift(s.slice(Math.max(0, i - 3), i));
  return (Number(n) < 0 ? '-' : '') + parts.join(',');
}

/**
 * Cut to width on character count, with an ellipsis. Newlines and runs of
 * whitespace collapse first: a table row is one line by definition.
 * @param {string} s @param {number} width
 */
export function cut(s, width) {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= width) return t;
  return t.slice(0, Math.max(0, width - 1)) + '…';
}

/**
 * The state glyphs, from the deck spec's own table (§3.2). They are a second
 * carrier beside the colour, never the only one: every chip and every row
 * also spells the state out for a screen reader, per §10 ("state is never
 * carried by colour alone").
 */
export const STATE_ICONS = {
  for_review: '✓',
  needs_input: '✋',
  stalled: '⏳',
  working: '·',
  ended: '',
};

/** What the person calls each state (§11: "Hands up", never "needs_input"). */
export const STATE_WORDS = {
  for_review: 'For review',
  needs_input: 'Hands up',
  stalled: 'Stalled',
  working: 'Working',
  ended: 'Ended',
};

/** Display name, else the MK tag, else the session's own title. */
function who(agent) {
  return agent?.displayName || agent?.label || agent?.mk || agent?.title || 'this session';
}

/** @param {any} agent */
function projectOf(agent) {
  return agent?.projectName || agent?.projectId || '';
}

/**
 * The one sentence a screen reader hears for a queue item, in the order a
 * sighted reader takes the chip in: what state, how long, who, where.
 * @param {any} agent @param {number} now
 */
export function rowLabel(agent, now) {
  const start = waitStart(agent);
  const elapsed = start ? waited(now - start) : '';
  return [
    STATE_WORDS[agent?.activityState] || agent?.activityState || '',
    elapsed ? `waiting ${elapsed}` : '',
    who(agent),
    projectOf(agent),
  ]
    .filter(Boolean)
    .join(', ');
}

// ------------------------------------------------------------- the strip
//
// §3.1. One chip per needs-you item, oldest first. Each chip: state icon,
// elapsed in mono, agent name, project. Nothing else. The oldest chip is
// always leftmost and never scrolls out — there is no scroller here at all,
// which is the only way to keep that promise on a narrow window; overflow
// collapses on the right into `+N`.

/**
 * One chip, as a real `<button>` inside a real list item. Pure: it builds
 * nodes and attaches no behaviour, so the controller below and the unit test
 * are looking at exactly the same DOM.
 *
 * @param {any} agent
 * @param {{now?:number, selectedId?:string|null}} opts
 * @param {{createElement:(tag:string)=>any}} doc
 */
export function buildChip(agent, opts, doc) {
  const now = opts.now ?? clockNow();
  const start = waitStart(agent);
  const elapsedMs = start ? Math.max(0, now - start) : 0;

  const item = doc.createElement('li');
  item.className = 'strip-item';
  item.setAttribute('role', 'listitem');
  item.setAttribute('data-id', String(agent.id));

  const button = doc.createElement('button');
  button.setAttribute('type', 'button');
  button.className = 'strip-chip';
  button.setAttribute('data-id', String(agent.id));
  button.setAttribute('data-state', String(agent.activityState));
  button.setAttribute('aria-label', rowLabel(agent, now));
  if (opts.selectedId && opts.selectedId === agent.id) {
    button.className = 'strip-chip is-selected';
    button.setAttribute('aria-current', 'true');
  }

  const icon = doc.createElement('span');
  icon.className = 'strip-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = STATE_ICONS[agent.activityState] ?? '';
  button.appendChild(icon);

  const when = doc.createElement('span');
  when.className = start && elapsedMs > OLD_MS ? 'strip-when is-old' : 'strip-when';
  when.textContent = start ? waited(elapsedMs) : '';
  button.appendChild(when);

  const name = doc.createElement('span');
  name.className = 'strip-who';
  name.textContent = cut(who(agent), 18);
  button.appendChild(name);

  const sep = doc.createElement('span');
  sep.className = 'strip-sep';
  sep.setAttribute('aria-hidden', 'true');
  sep.textContent = '·';
  button.appendChild(sep);

  const project = doc.createElement('span');
  project.className = 'strip-project';
  project.textContent = cut(projectOf(agent), 22);
  button.appendChild(project);

  item.appendChild(button);
  return item;
}

/**
 * The whole strip list, built from scratch. The controller below diffs by id
 * instead so chips can slide in and collapse out (§9), but both go through
 * `buildChip()`, so what the test asserts is what ships.
 *
 * @param {any[]} agents already in queue order, or not — this re-orders
 * @param {{now?:number, selectedId?:string|null, projectFilter?:string|null}} opts
 * @param {{createElement:(tag:string)=>any}} doc
 */
export function renderStrip(agents, opts, doc) {
  const list = doc.createElement('ul');
  list.className = 'strip-list';
  list.setAttribute('role', 'list');
  list.setAttribute('aria-label', 'Waiting on you, oldest first');
  for (const agent of queueOrder(agents, opts)) list.appendChild(buildChip(agent, opts, doc));
  return list;
}

// --------------------------------------------------------------- the deck
//
// §3.2. A genuine table, because it is a table: five columns, a header row
// that names them, a row header per session, and two row groups separated by
// a rule. A screen-reader user traverses it in queue order with ordinary
// table navigation and gets the same actions as the floor.

/** The five columns, in the spec's order. `right` is the mono, tabular pair. */
const COLUMNS = [
  { key: 'waiting', label: 'Waiting', className: 'deck-col-waiting' },
  { key: 'who', label: 'Who', className: 'deck-col-who' },
  { key: 'project', label: 'Project', className: 'deck-col-project' },
  { key: 'last', label: 'Last word', className: 'deck-col-last' },
  { key: 'tokens', label: 'Tokens', className: 'deck-col-tokens' },
];

/**
 * One row. WHO is the row header, so a screen reader reading down the LAST
 * WORD column still says whose last word it is.
 *
 * @param {any} agent
 * @param {{now?:number, selectedId?:string|null}} opts
 * @param {{createElement:(tag:string)=>any}} doc
 */
function buildRow(agent, opts, doc) {
  const now = opts.now ?? clockNow();
  const start = waitStart(agent);
  const elapsedMs = start ? Math.max(0, now - start) : 0;

  const tr = doc.createElement('tr');
  tr.className = 'deck-row';
  tr.setAttribute('data-id', String(agent.id));
  tr.setAttribute('data-state', String(agent.activityState));
  if (opts.selectedId && opts.selectedId === agent.id) {
    tr.className = 'deck-row is-selected';
    tr.setAttribute('aria-current', 'true');
  }

  // WAITING. The elapsed time, then the state glyph, then the state word for
  // anything that is not looking at the glyph. Same visual order as §3.2's
  // sketch, and state is never colour alone.
  const waitingCell = doc.createElement('td');
  waitingCell.className = 'deck-waiting';
  const when = doc.createElement('span');
  when.className = start && elapsedMs > OLD_MS ? 'deck-when is-old' : 'deck-when';
  when.textContent = start ? waited(elapsedMs) : '';
  waitingCell.appendChild(when);
  const icon = doc.createElement('span');
  icon.className = 'deck-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = STATE_ICONS[agent.activityState] ?? '';
  waitingCell.appendChild(icon);
  const word = doc.createElement('span');
  word.className = 'sr-only';
  word.textContent = STATE_WORDS[agent.activityState] || String(agent.activityState || '');
  waitingCell.appendChild(word);
  tr.appendChild(waitingCell);

  // WHO. The name the user gave, and the MK tag beside it — the spec draws
  // them as two columns; five labelled columns read better than six of which
  // one has no name, so the tag rides quietly in this cell.
  const whoCell = doc.createElement('th');
  whoCell.setAttribute('scope', 'row');
  whoCell.className = 'deck-who';
  const whoName = doc.createElement('span');
  whoName.className = 'deck-name';
  whoName.textContent = cut(who(agent), 20);
  whoCell.appendChild(whoName);
  if (agent.mk) {
    const mk = doc.createElement('span');
    mk.className = 'deck-mk';
    mk.textContent = String(agent.mk);
    whoCell.appendChild(mk);
  }
  tr.appendChild(whoCell);

  const projectCell = doc.createElement('td');
  projectCell.className = 'deck-project';
  projectCell.textContent = cut(projectOf(agent), 24);
  tr.appendChild(projectCell);

  const lastCell = doc.createElement('td');
  lastCell.className = 'deck-last';
  // A stalled session has said nothing since it went quiet, and an empty cell
  // reads as missing data rather than as the fact it is.
  lastCell.textContent =
    cut(agent.lastText || '', 90) ||
    (agent.activityState === 'stalled' ? '(silent since it last spoke)' : '');
  tr.appendChild(lastCell);

  const tokensCell = doc.createElement('td');
  tokensCell.className = 'deck-tokens';
  tokensCell.textContent = agent.tokens ? groupDigits(agent.tokens) : '';
  tr.appendChild(tokensCell);

  return tr;
}

/**
 * The deck table. One `<tbody>` per group, which is what draws the rule
 * between a raised hand and a stall without inventing a fake row for a
 * screen reader to read out.
 *
 * @param {any[]} agents
 * @param {{now?:number, selectedId?:string|null, projectFilter?:string|null}} opts
 * @param {{createElement:(tag:string)=>any}} doc
 */
export function renderDeckTable(agents, opts, doc) {
  const table = doc.createElement('table');
  table.className = 'deck-table';

  const caption = doc.createElement('caption');
  caption.className = 'sr-only';
  caption.textContent =
    'Waiting on you, oldest first. Finished turns and raised hands, then sessions that have gone quiet.';
  table.appendChild(caption);

  const thead = doc.createElement('thead');
  const headRow = doc.createElement('tr');
  for (const col of COLUMNS) {
    const th = doc.createElement('th');
    th.setAttribute('scope', 'col');
    th.className = col.className;
    th.textContent = col.label;
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  table.appendChild(thead);

  // WP-89. The crews, computed once over the same rows `queueGroups` filtered,
  // so the two cannot disagree about which juniors were folded away.
  const filter = opts.projectFilter ?? null;
  const crews = crewGroups(
    (Array.isArray(agents) ? agents : []).filter(
      (a) => needsYou(a) && (filter === null || a.projectId === filter),
    ),
  );

  for (const group of queueGroups(agents, opts)) {
    const tbody = doc.createElement('tbody');
    tbody.className = 'deck-group';
    tbody.setAttribute('data-group', group.key);
    for (const agent of group.rows) {
      tbody.appendChild(buildRow(agent, opts, doc));
      const crew = crews.get(String(agent.id));
      if (crew && crew.length) tbody.appendChild(buildCrewRow(agent, crew, doc));
    }
    table.appendChild(tbody);
  }

  return table;
}

/**
 * ONE CREW, AS ONE ROW UNDER ITS PARENT (WP-89 §3.2).
 *
 * A `<details>` whose summary is the count and whose body is one line per
 * junior: its type where the runtime reported one — the one fact a sidecar
 * reliably carries — and its name. Expandable rather than always open, because
 * a crew of twelve under every waiting parent is the table the fold exists to
 * prevent; present rather than hidden, because a junior nobody can see is a
 * session somebody has to go looking for.
 *
 * @param {any} parent @param {any[]} crew
 * @param {{createElement:(tag:string)=>any}} doc
 */
function buildCrewRow(parent, crew, doc) {
  const tr = doc.createElement('tr');
  tr.className = 'deck-crew';
  tr.setAttribute('data-crew-of', String(parent.id));
  const td = doc.createElement('td');
  td.setAttribute('colspan', String(COLUMNS.length));
  const details = doc.createElement('details');
  const summary = doc.createElement('summary');
  summary.textContent = crew.length === 1 ? '1 junior' : `${crew.length} juniors`;
  details.appendChild(summary);
  const list = doc.createElement('ul');
  list.className = 'deck-crew-list';
  for (const junior of crew) {
    const li = doc.createElement('li');
    li.setAttribute('data-id', String(junior.id));
    const type = junior.subagentType ? `${junior.subagentType} · ` : '';
    li.textContent = `${type}${cut(who(junior), 28)}`;
    list.appendChild(li);
  }
  details.appendChild(list);
  td.appendChild(details);
  tr.appendChild(td);
  return tr;
}
