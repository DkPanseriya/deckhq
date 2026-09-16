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

import { now as clockNow } from './clock.js';
import { wireSurfaceControls } from './surfaces.js';
import { COUNTERS, defaultSortFor, renderUsageView } from './usage.js';
import {
  buildChip,
  cut,
  DECK_HINT_THRESHOLD,
  queueAnchor,
  queueCursor,
  queueStep,
  renderDeckTable,
  rowLabel,
} from './deck-view.js';

// WP-92m. The pure half — one order, and the DOM it draws — is
// `./deck-view.js` now. Every importer of `deck.js` still sees it from here,
// so the split is invisible to `app.js`, `app-header.js` and the three test
// files that read this module.
export * from './deck-view.js';

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
 * @param {HTMLElement} [opts.deckBodyEl] where the table goes; the host's own
 *   `.surface-body`. Separate from the host because the host also carries the
 *   chrome — the ✕ and "Back to floor" — and a repaint must not wipe the one
 *   control the user is reaching for (WP-84, `public/surfaces.js`).
 * @param {HTMLElement} opts.stageEl      the stage, so the floor can stand down
 * @param {() => any[]} opts.getQueue     the needs-you queue, already scoped
 * @param {() => string|null} opts.getSelectedId
 * @param {(id:string, o?:{openPanel?:boolean}) => void} opts.onSelect
 * @param {(text:string) => void} [opts.announce]
 * @param {HTMLElement} [opts.tabsEl]  the `role="tablist"` above the body (WP-83)
 * @param {(window:string) => Promise<any>} [opts.loadUsage]  fetches one
 *   window's usage. INJECTED rather than done here, because nothing in this
 *   module fetches — see the header — and because a test can then drive the
 *   whole Usage tab from a fixture.
 * @param {() => {projectNames:Record<string,string>, sessionNames:Record<string,string>}}
 *   [opts.getUsageNames] the two lookups that turn a ledger hash into a name.
 *   A key with nothing on the floor stays a hash, which is honest.
 */
export function createDeckUI(opts) {
  const { stripEl, listEl, moreEl, hintEl, lastEl, deckEl, stageEl } = opts;
  const { getQueue, getSelectedId, onSelect, announce } = opts;
  // The table's own container. Falls back to the host for an embedder that
  // built a deck without the chrome — the deck still works, it simply has no
  // buttons, which is the state WP-84 found the product in.
  const bodyEl = opts.deckBodyEl || deckEl;

  /** @type {Map<string, HTMLElement>} id -> the live `<li>` for that chip */
  const chips = new Map();
  let deckOpen = false;
  /** Where the keys act when the panel is shut and has no selection to lend. */
  let cursorId = null;

  // WP-83's state, and all of it. Which tab is showing, which window the Usage
  // tab is asking for, what the last fetch came back with, and how each of its
  // five tables is sorted. Deliberately in memory rather than in `state.json`:
  // "which column am I sorting the model table by" is a property of this
  // reading, not of the machine — the same call `cmd:show-let-go` makes.
  let tab = 'queue';
  let usageWindow = '7d';
  /** @type {any} */
  let usageData = null;
  let usageLoading = false;
  /** @type {Record<string, {key:string, dir:'asc'|'desc'}>} */
  const usageSorts = {};

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

  // ------------------------------------------------------ the Usage tab
  //
  // WP-83. Everything below is a read: it fetches through a function `app.js`
  // handed in, paints a table, and touches no ack state and no setting. The
  // module invariant at the top of this file is unchanged.

  /** Paint whatever the last fetch came back with. */
  function paintUsage() {
    bodyEl.textContent = '';
    if (usageLoading && !usageData) {
      const loading = document.createElement('p');
      loading.className = 'deck-empty';
      loading.textContent = 'Reading the ledger…';
      bodyEl.appendChild(loading);
      return;
    }
    const names = opts.getUsageNames?.() || { projectNames: {}, sessionNames: {} };
    const view = renderUsageView(
      usageData,
      {
        window: usageWindow,
        projectNames: names.projectNames,
        sessionNames: names.sessionNames,
        sorts: usageSorts,
      },
      document,
    );
    bodyEl.appendChild(view);

    for (const button of bodyEl.querySelectorAll('.usage-window')) {
      button.addEventListener('click', () => {
        const next = button.getAttribute('data-window');
        if (!next || next === usageWindow) return;
        usageWindow = next;
        usageData = null;
        void loadUsage();
      });
    }
    for (const section of bodyEl.querySelectorAll('.usage-section')) {
      const id = section.getAttribute('data-section');
      if (!id) continue;
      for (const button of section.querySelectorAll('.usage-sort')) {
        button.addEventListener('click', () => {
          const key = button.getAttribute('data-column');
          if (!key) return;
          const was = usageSorts[id] || defaultSortFor(id);
          // Clicking the column already sorted by reverses it; clicking a new
          // one starts where a reader expects — biggest first for a number,
          // A to Z for a name.
          usageSorts[id] =
            was.key === key
              ? { key, dir: was.dir === 'desc' ? 'asc' : 'desc' }
              : { key, dir: COUNTERS.includes(key) || key === 'total' ? 'desc' : 'asc' };
          paintUsage();
        });
      }
    }
  }

  async function loadUsage() {
    if (!opts.loadUsage) {
      usageData = null;
      paintUsage();
      return;
    }
    usageLoading = true;
    paintUsage();
    try {
      usageData = await opts.loadUsage(usageWindow);
    } catch {
      // A ledger that cannot be read is a window with no records, which is
      // exactly what the view already knows how to say. It is measurement,
      // not state: nothing here is worth an error banner over the deck.
      usageData = null;
    } finally {
      usageLoading = false;
    }
    if (deckOpen && tab === 'usage') paintUsage();
  }

  /** @param {'queue'|'usage'} next */
  function setTab(next) {
    if (tab === next) return;
    tab = next;
    if (opts.tabsEl) {
      for (const button of opts.tabsEl.querySelectorAll('.deck-tab')) {
        const on = button.getAttribute('data-tab') === tab;
        button.classList.toggle('is-selected', on);
        button.setAttribute('aria-selected', on ? 'true' : 'false');
      }
    }
    if (tab === 'usage') {
      if (usageData) paintUsage();
      else void loadUsage();
      announce?.('Usage. Where the tokens went.');
    } else {
      render();
      announce?.('The queue.');
    }
  }

  /** @param {any[]} queue @param {number} now @param {string|null} selectedId */
  function paintDeck(queue, now, selectedId) {
    bodyEl.textContent = '';
    if (queue.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'deck-empty';
      empty.textContent = 'Nothing is waiting on you.';
      bodyEl.appendChild(empty);
      return;
    }
    const scroller = document.createElement('div');
    scroller.className = 'deck-scroll';
    scroller.appendChild(renderDeckTable(queue, { now, selectedId }, document));
    bodyEl.appendChild(scroller);

    for (const row of bodyEl.querySelectorAll('.deck-row')) {
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
    // WP-83. The Usage tab has no queue cursor and no rows to ring; a
    // selection change while it is showing must not wipe the table under the
    // reader's hand.
    if (tab !== 'queue') return;
    const cursorRow = cursorFor(queue);
    for (const row of bodyEl.querySelectorAll('.deck-row')) {
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
    const now = clockNow();

    stripEl.hidden = queue.length === 0;
    syncChips(queue, now, getSelectedId());
    if (!stripEl.hidden) fitStrip();
    else showLast(null);

    // §3.2: past six items the floor stops being the efficient surface. It
    // still opens on the floor — the aha is spatial — but the deck says so.
    const showHint = !deckOpen && queue.length >= DECK_HINT_THRESHOLD;
    hintEl.hidden = !showHint;
    if (showHint) hintEl.textContent = `${queue.length} waiting · press Tab for the deck`;

    if (deckOpen && tab === 'queue') paintDeck(queue, now, cursorFor(queue));
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
    announce?.(rowLabel(next, clockNow()));
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
    if (tab === 'usage') {
      if (usageData) paintUsage();
      else void loadUsage();
    } else {
      render();
    }
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
    // The body, not the host: the host carries the chrome, and emptying it
    // would delete the ✕ that was just clicked (WP-84).
    bodyEl.textContent = '';
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

  // WP-84 · the way back. `close` is this closure's own function, named in the
  // same scope as the call — which is the one thing §143 proves must be true
  // of a ✕'s listener, because an unqualified `close()` in a module that
  // declares none resolves to `window.close` and takes the tab with it.
  wireSurfaceControls(deckEl, () => close());

  // WP-83. The tabs are static markup (the reason `surfaces.js` gives for the
  // chrome being static), so this is only their wiring.
  if (opts.tabsEl) {
    for (const button of opts.tabsEl.querySelectorAll('.deck-tab')) {
      button.addEventListener('click', () => {
        const next = button.getAttribute('data-tab');
        if (next === 'queue' || next === 'usage') setTab(next);
      });
    }
  }

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
    setTab,
    activeTab: () => tab,
    destroy,
  };
}
