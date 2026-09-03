/**
 * DeckHQ levels 2 and 3 — the queue strip and the deck.
 *
 * `docs/plan/05-GUI-UX-SPEC.md` §3, WP-10. The floor answers "is anything
 * waiting on me" from across the room. It is the wrong surface for "let me
 * clear these", and pretending otherwise is the observational-theater failure
 * mode named in `docs/plan/08-PLAN-V2-100X.md` §1.2. So there are three
 * levels, not one:
 *
 *   1. the floor          ambient, spatial, always there
 *   2. the queue strip    a rail of chips under the header, oldest first
 *   3. the deck (`Tab`)   a dense table that replaces the floor
 *
 * The strip gives the queue's shape and length without leaving the floor,
 * which is what makes the floor safe to keep looking at. The deck does the
 * job, and it is the accessible equivalent of the floor (§10): a screen
 * reader gets the same queue, in the same order, with the same actions. **The
 * floor is never the only way to reach anything.**
 *
 * ============================================================================
 * THE INVARIANT (docs/01-PRODUCT.md §2). Nothing in this file calls
 * `/api/ack`, and nothing in it fetches at all. Selecting a chip, moving the
 * deck cursor, opening the deck and closing it are reads. The number keys are
 * handed to `public/panel.js`'s `pressNumberKey()` — the same function the
 * floor uses — which is the only route to `performAction()`, which is the
 * only caller of `/api/ack` in the client.
 * ============================================================================
 *
 * ONE ORDER, THREE SURFACES, TWO PROCESSES. `queueGroups()` below is the same
 * ordering as `groupRows()` in `src/cli/deck.mjs` — the terminal deck, WP-42 —
 * for the same snapshot. They are separate implementations because `src/` is
 * never served to the browser and the browser is never given a Node module,
 * and they are pinned together by `test/unit/deck-view.test.mjs`, which runs
 * both over one fixture and asserts the id sequences are identical. If that
 * test fails, one of the two moved and `deckhq ls` and the GUI now disagree
 * about which item is next.
 *
 * The render functions are pure and take their `document` as an argument, the
 * way `public/diff-view.js` does, so the DOM they build is asserted directly
 * in a unit test against a stub. Everything a session wrote — a name, a
 * title, a project, a last line — is written with `textContent`. There is no
 * `innerHTML` in this file.
 */

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
  const list = (Array.isArray(agents) ? agents : []).filter(
    (a) => needsYou(a) && (filter === null || a.projectId === filter),
  );
  const by = (a, b) => waitStart(a) - waitStart(b) || String(a.id).localeCompare(String(b.id));
  const waiting = list.filter((a) => a.activityState !== 'stalled').sort(by);
  const stalled = list.filter((a) => a.activityState === 'stalled').sort(by);
  return [
    { key: /** @type {const} */ ('waiting'), rows: waiting },
    { key: /** @type {const} */ ('stalled'), rows: stalled },
  ].filter((g) => g.rows.length > 0);
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
  const now = opts.now ?? Date.now();
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
  const now = opts.now ?? Date.now();
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

  for (const group of queueGroups(agents, opts)) {
    const tbody = doc.createElement('tbody');
    tbody.className = 'deck-group';
    tbody.setAttribute('data-group', group.key);
    for (const agent of group.rows) tbody.appendChild(buildRow(agent, opts, doc));
    table.appendChild(tbody);
  }

  return table;
}

// ------------------------------------------------------------- controller
//
// Everything below touches elements. The pure half above is what the unit
// test drives; this half is the wiring, and it holds exactly one piece of
// state of its own — where the deck's cursor is when the panel is shut.

/** Is the shell being asked to hold still? §9, and WP-07's own override. */
function motionReduced() {
  try {
    const mode = document.documentElement.dataset.motion;
    if (mode === 'reduce') return true;
    if (mode === 'no-preference') return false;
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
}

/** How long a chip takes to slide in, and to collapse out. §9. */
const CHIP_MOTION_MS = 180;
/** How often elapsed times re-render. They are minute-precision; 30 s is enough. */
const TICK_MS = 30_000;
/** The flex gap between chips, in px — kept in step with `.strip-list` in style.css. */
const CHIP_GAP = 8;

/**
 * Wire the strip and the deck to a live snapshot.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.stripEl      the strip's outer bar
 * @param {HTMLElement} opts.listEl       the `role="list"` inside it
 * @param {HTMLElement} opts.moreEl       the `+N` overflow button
 * @param {HTMLElement} opts.hintEl       "7 waiting · press Tab for the deck"
 * @param {HTMLElement} opts.lastEl       the hover line under the strip
 * @param {HTMLElement} opts.deckEl       the deck's host inside the stage
 * @param {HTMLElement} opts.stageEl      the stage, so the floor can stand down
 * @param {() => any[]} opts.getQueue     the needs-you queue, already scoped
 * @param {() => string|null} opts.getSelectedId
 * @param {(id:string, o?:{openPanel?:boolean}) => void} opts.onSelect
 * @param {(text:string) => void} [opts.announce]
 */
export function createDeckUI(opts) {
  const { stripEl, listEl, moreEl, hintEl, lastEl, deckEl, stageEl } = opts;
  const { getQueue, getSelectedId, onSelect, announce } = opts;

  /** @type {Map<string, HTMLElement>} id -> the live `<li>` for that chip */
  const chips = new Map();
  let deckOpen = false;
  /** Where the keys act when the panel is shut and has no selection to lend. */
  let cursorId = null;

  /** @param {string} id */
  function findInQueue(id) {
    return getQueue().find((a) => a.id === id) || null;
  }

  /** @param {any[]} queue */
  function cursorFor(queue) {
    return queueCursor(queue, getSelectedId(), cursorId);
  }

  // ------------------------------------------------------------- the strip

  /**
   * Fit the chips, oldest-first, and collapse the rest into `+N`.
   *
   * There is no scroller here, on purpose: §3.1 says the oldest chip is
   * always leftmost and never scrolls out, and the only way to keep that
   * unconditionally on a narrow window is to have nowhere for it to scroll to.
   */
  function fitStrip() {
    if (stripEl.hidden) return;
    const items = /** @type {HTMLElement[]} */ ([...listEl.children]).filter(
      (n) => !n.classList.contains('is-leaving'),
    );
    for (const item of items) item.hidden = false;
    moreEl.hidden = true;
    if (items.length === 0) return;

    const avail = listEl.clientWidth;
    if (avail <= 0) return; // not laid out yet; the ResizeObserver calls back
    const widths = items.map((n) => n.offsetWidth);
    const total = widths.reduce((a, w) => a + w, 0) + CHIP_GAP * (items.length - 1);
    if (total <= avail) return;

    // Showing `+N` takes width away from the list, so re-read the box rather
    // than guessing at the reservation.
    moreEl.hidden = false;
    const room = listEl.clientWidth;
    let used = 0;
    let shown = 0;
    for (let i = 0; i < items.length; i++) {
      const next = used + (shown ? CHIP_GAP : 0) + widths[i];
      if (next > room) break;
      used = next;
      shown++;
    }
    // A strip whose first item can vanish is a strip that lies about the
    // queue, so the oldest chip stays even on a window too narrow to hold it.
    if (shown === 0) shown = 1;
    for (let i = shown; i < items.length; i++) items[i].hidden = true;
    const hiddenCount = items.length - shown;
    moreEl.textContent = `+${hiddenCount}`;
    moreEl.setAttribute('aria-label', `${hiddenCount} more waiting. Open the deck.`);
  }

  /** The hover line: what this agent last said. §3.1. */
  function showLast(agent) {
    const text = agent ? cut(agent.lastText || '', 220) : '';
    lastEl.textContent = text;
    lastEl.hidden = !text;
  }

  /** @param {HTMLElement} item @param {string} id */
  function bindChip(item, id) {
    const button = /** @type {HTMLElement} */ (item.firstChild);
    button.addEventListener('click', () => onSelect(id, { openPanel: true }));
    button.addEventListener('mouseenter', () => showLast(findInQueue(id)));
    button.addEventListener('focus', () => showLast(findInQueue(id)));
    button.addEventListener('mouseleave', () => showLast(null));
    button.addEventListener('blur', () => showLast(null));
  }

  /**
   * Collapse a departing chip's width to zero rather than letting it vanish,
   * so the queue is seen to shorten. §9.
   * @param {string} id
   */
  function removeChip(id) {
    const item = chips.get(id);
    if (!item) return;
    chips.delete(id);
    if (motionReduced()) {
      item.remove();
      return;
    }
    item.style.width = `${item.offsetWidth}px`;
    void item.offsetWidth; // one forced reflow, so the transition has a start
    item.classList.add('is-leaving');
    item.style.width = '0px';
    setTimeout(() => item.remove(), CHIP_MOTION_MS + 40);
  }

  /**
   * Reconcile the strip against the queue, by id. Chips are not rebuilt from
   * scratch each tick: a chip that is merely a minute older must not restart
   * its entry animation, and a chip the user has tabbed to must not lose
   * focus thirty seconds later.
   * @param {any[]} queue @param {number} now @param {string|null} selectedId
   */
  function syncChips(queue, now, selectedId) {
    const wanted = new Set(queue.map((a) => a.id));
    for (const id of [...chips.keys()]) if (!wanted.has(id)) removeChip(id);

    /** @type {HTMLElement|null} */
    let previous = null;
    for (const agent of queue) {
      const fresh = /** @type {HTMLElement} */ (buildChip(agent, { now, selectedId }, document));
      const freshButton = /** @type {HTMLElement} */ (fresh.firstChild);
      let item = chips.get(agent.id);
      if (item) {
        const button = /** @type {HTMLElement} */ (item.firstChild);
        const changed =
          button.textContent !== freshButton.textContent ||
          button.className !== freshButton.className ||
          button.getAttribute('aria-label') !== freshButton.getAttribute('aria-label');
        if (changed) {
          item.replaceChild(freshButton, button);
          bindChip(item, agent.id);
        }
      } else {
        item = fresh;
        chips.set(agent.id, item);
        if (!motionReduced()) {
          item.classList.add('is-entering');
          const node = item;
          setTimeout(() => node.classList.remove('is-entering'), CHIP_MOTION_MS + 40);
        }
        bindChip(item, agent.id);
      }
      // DOM order must equal queue order: a wait that overtakes its neighbour
      // moves the chip, or the strip stops being oldest-first.
      const anchor = previous ? previous.nextSibling : listEl.firstChild;
      if (item !== anchor) listEl.insertBefore(item, anchor);
      previous = item;
    }
  }

  // -------------------------------------------------------------- the deck

  /** @param {any[]} queue @param {number} now @param {string|null} selectedId */
  function paintDeck(queue, now, selectedId) {
    deckEl.textContent = '';
    if (queue.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'deck-empty';
      empty.textContent = 'Nothing is waiting on you.';
      deckEl.appendChild(empty);
      return;
    }
    const scroller = document.createElement('div');
    scroller.className = 'deck-scroll';
    scroller.appendChild(renderDeckTable(queue, { now, selectedId }, document));
    deckEl.appendChild(scroller);

    for (const row of deckEl.querySelectorAll('.deck-row')) {
      const id = row.getAttribute('data-id');
      if (id) row.addEventListener('click', () => onSelect(id, { openPanel: true }));
    }
  }

  /**
   * Move the ring and the cursor without rebuilding anything. Selection
   * changes far more often than the queue does, and a rebuild on every `J`
   * would throw away focus and restart the chip animations.
   *
   * The chip's ring and the deck's cursor are deliberately not the same
   * thing. §3.1 rings a chip "at the same moment" the floor rings the same
   * person — so a chip may only be ringed when somebody actually is, or the
   * two surfaces are saying different things and the mapping between them
   * stops being teachable. The deck is a table and a table has a cursor row
   * whether or not anything is open; that row is where its keys act, so
   * showing it is honest rather than a claim about the floor.
   */
  function syncSelection() {
    const queue = getQueue();
    const ringed = getSelectedId();
    for (const [id, item] of chips) {
      const button = /** @type {HTMLElement} */ (item.firstChild);
      const on = Boolean(ringed) && id === ringed;
      button.classList.toggle('is-selected', on);
      if (on) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    }
    const cursorRow = cursorFor(queue);
    for (const row of deckEl.querySelectorAll('.deck-row')) {
      const on = row.getAttribute('data-id') === cursorRow;
      row.classList.toggle('is-selected', on);
      if (on) {
        row.setAttribute('aria-current', 'true');
        row.scrollIntoView({ block: 'nearest' });
      } else {
        row.removeAttribute('aria-current');
      }
    }
  }

  // -------------------------------------------------------------- painting

  function render() {
    const queue = getQueue();
    const now = Date.now();

    stripEl.hidden = queue.length === 0;
    syncChips(queue, now, getSelectedId());
    if (!stripEl.hidden) fitStrip();
    else showLast(null);

    // §3.2: past six items the floor stops being the efficient surface. It
    // still opens on the floor — the aha is spatial — but the deck says so.
    const showHint = !deckOpen && queue.length >= DECK_HINT_THRESHOLD;
    hintEl.hidden = !showHint;
    if (showHint) hintEl.textContent = `${queue.length} waiting · press Tab for the deck`;

    if (deckOpen) paintDeck(queue, now, cursorFor(queue));
  }

  // ------------------------------------------------------------- behaviour

  /** @param {1|-1} direction */
  function move(direction) {
    const queue = getQueue();
    // The anchor, not the cursor: from nowhere, the first `J` lands on the
    // oldest item rather than skipping past it to the second.
    const from = queueAnchor(queue, getSelectedId(), cursorId);
    const nextId = queueStep(queue, from, direction);
    if (!nextId) return;
    const next = queue.find((a) => a.id === nextId);
    cursorId = next.id;
    // Moving in the deck must not open the panel — `Enter` does that (§3.2),
    // and a panel opening on `J` would reflow the column the deck sits beside
    // on every keystroke. A panel already open follows the cursor.
    onSelect(next.id, { openPanel: !deckOpen });
    announce?.(rowLabel(next, Date.now()));
    syncSelection();
  }

  /** `Enter` in the deck. */
  function openCursor() {
    const id = cursorFor(getQueue());
    if (id) onSelect(id, { openPanel: true });
  }

  function isOpen() {
    return deckOpen;
  }

  function open() {
    if (deckOpen) return;
    deckOpen = true;
    stageEl.classList.add('is-deck');
    deckEl.hidden = false;
    render();
    deckEl.focus();
    const n = getQueue().length;
    announce?.(
      n === 0 ? 'The deck. Nothing is waiting on you.' : `The deck. ${n} waiting, oldest first.`,
    );
  }

  function close() {
    if (!deckOpen) return;
    deckOpen = false;
    stageEl.classList.remove('is-deck');
    deckEl.hidden = true;
    deckEl.textContent = '';
    render();
    announce?.('The floor.');
  }

  function toggle() {
    if (deckOpen) close();
    else open();
  }

  /** The id every key in the strip and the deck acts on. */
  function cursor() {
    return cursorFor(getQueue());
  }

  // Elapsed times are the only live thing in the strip. §9 gives the number
  // the right to draw the eye, and gives nothing else in the chrome that right.
  const tickTimer = setInterval(() => {
    if (!stripEl.hidden || deckOpen) render();
  }, TICK_MS);

  const observer =
    typeof ResizeObserver === 'function' ? new ResizeObserver(() => fitStrip()) : null;
  observer?.observe(stripEl);
  moreEl.addEventListener('click', () => open());

  function destroy() {
    clearInterval(tickTimer);
    observer?.disconnect();
  }

  return {
    render,
    syncSelection,
    move,
    openCursor,
    open,
    close,
    toggle,
    isOpen,
    cursor,
    destroy,
  };
}
