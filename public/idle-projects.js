/**
 * The idle projects: a chip in the corner of the stage, and the list behind it.
 *
 * WP-60. This used to be drawn ON THE FLOOR — a column of repo names down the
 * bottom-right of the canvas, always there, always as loud as the rooms beside
 * it. On a machine with a long history that strip was the largest single thing
 * on the floor and every line of it said the same thing: nobody is working
 * here. The floor is about who is working; a directory of who is not had taken
 * the corner permanently, which is the clutter the owner asked to be rid of.
 *
 * So the list came off the canvas and became chrome: one quiet chip that says
 * how many there are, and a popover that opens on hover, on click, or on `I`.
 * The count is the part worth glancing at; the names are the part you ask for.
 *
 * WHY IT IS HTML AND NOT CANVAS. Everything the list wants is something a
 * canvas cannot give without being reimplemented: a hover intent, a focus ring,
 * ellipsis on a long repo name, an option a screen reader can walk with the
 * arrow keys. `docs/plan/05-GUI-UX-SPEC.md` §10 says the floor is never the
 * only way to reach anything, and a canvas strip that could only be clicked was
 * the one place in the product where that was not true.
 *
 * DELIBERATELY NOT A `<dialog>`. `showModal()` would trap focus and stand the
 * floor's whole keyboard map down (`app-keys.js` returns early while any modal
 * dialog is open), and the floor is exactly what this list sits over and hands
 * you back to. It is a non-modal `role="dialog"`, the pattern
 * `public/coach-marks.js` and the replay bar already use: it traps nothing, and
 * Escape reaches it because this file asks for Escape rather than because the
 * platform gave it.
 *
 * This module is split the way `public/deck.js` and `public/palette.js` are:
 * the parts worth testing need no DOM. `idleChipLabel`, `idleRowText`,
 * `idleRowLabel` and `renderIdleList` are pure and take their `document` as a
 * parameter — that is what `test/unit/idle-projects.test.mjs` drives, because
 * this repo has no jsdom. `createIdlePopover` is the only function that touches
 * a real element.
 *
 * Every string that reaches the page goes through `textContent`. There is no
 * `innerHTML` here, and the test asserts it by making a write to one throw.
 *
 * `docs/DEVIATIONS.md` §145.
 */

import { idleProjectsOf } from './floor-rule.js';
// The one definition of the elapsed vocabulary — `4m`, `2h 10m`, `2d 4h` — and
// the one the canvas strip's third column was written in, so the popover reads
// in the same units the floor does. This is a STATIC import from `./render/**`,
// which `app.js`'s header otherwise forbids, and the exception is deliberate:
// `rig-metrics.js` is the text-and-numbers half of the rig, with no canvas, no
// DOM and no top-level side effect. `test/unit/idle-projects.test.mjs` loads
// this module in Node, which is the proof rather than the claim. Copying the
// eight lines of `formatElapsed` here instead would be a second implementation
// of a format, which is the drift `floor-rule.js`'s own header is about.
import { formatElapsed } from './render/rig-metrics.js';

/**
 * How long the pointer must rest on the chip before the list opens.
 *
 * The owner asked for less clutter, and a popover that fires the instant the
 * cursor crosses the corner on its way somewhere else is more clutter, not
 * less. 150 ms is long enough to distinguish "I am going there" from "I am
 * passing through" and short enough that a deliberate hover feels immediate.
 */
export const HOVER_OPEN_MS = 150;

/**
 * How long the list waits after the pointer leaves BOTH the chip and the
 * popover before closing.
 *
 * There is a gap between the two elements, and a list that closed on the chip's
 * `mouseleave` could never be reached with the mouse at all. One shared timer,
 * cancelled by an enter on either element, is what makes the trip from the chip
 * into the list survivable.
 */
export const HOVER_CLOSE_MS = 220;

/**
 * The repo's display name, however the record spells it.
 * @param {{name?:string, id?:string}} project
 * @returns {string}
 */
function nameOf(project) {
  return String(project?.name ?? project?.id ?? '');
}

/**
 * How long ago this repo last did anything, in the floor's own vocabulary, or
 * `''` when nothing about it is dated.
 *
 * A project with no recorded activity shows its session count alone rather than
 * a `0m` that would claim it was busy a moment ago — the same refusal
 * `isGoneHome` makes: the floor does not date what it cannot date.
 *
 * @param {{lastActivityAt?:number}} project
 * @param {number} now ms epoch
 * @returns {string}
 */
function lastSeen(project, now) {
  const at = Number(project?.lastActivityAt) || 0;
  if (at <= 0) return '';
  return formatElapsed(Math.max(0, now - at));
}

/**
 * What the chip says.
 *
 * The count is the whole of it. "14 idle" is a fact you can take in without
 * reading, which is the entire reason the names are behind it.
 *
 * @param {number} count
 * @returns {string}
 */
export function idleChipLabel(count) {
  const n = Math.max(0, Number(count) || 0);
  return `${n} idle`;
}

/**
 * The two strings one row shows.
 *
 * THE STRIP'S OWN FORMAT, unchanged: the name on the left, and on the right the
 * session count followed by the time since anything happened, joined with the
 * floor's `·`. It is deliberately identical to what the canvas drew, because
 * the list moved off the floor and the reading of a line did not.
 *
 * @param {{name?:string, id?:string, sessionCount?:number, lastActivityAt?:number}} project
 * @param {number} now ms epoch
 * @returns {{name:string, stat:string}}
 */
export function idleRowText(project, now) {
  const sessions = Number(project?.sessionCount) || 0;
  const last = lastSeen(project, now);
  return { name: nameOf(project), stat: `${sessions}${last ? ` · ${last}` : ''}` };
}

/**
 * The one sentence a screen reader hears for a row.
 *
 * The visible row is a name and a terse `3 · 2h`, which is right for the eye
 * and useless read aloud — "three dot two aitch" names nothing. So the row
 * carries a spelled-out label as well, the way `deck.js`'s `rowLabel` does for
 * a chip.
 *
 * @param {{name?:string, id?:string, sessionCount?:number, lastActivityAt?:number}} project
 * @param {number} now ms epoch
 * @returns {string}
 */
export function idleRowLabel(project, now) {
  const sessions = Number(project?.sessionCount) || 0;
  const last = lastSeen(project, now);
  const count = `${sessions} session${sessions === 1 ? '' : 's'}`;
  return `${nameOf(project)}, ${count}, ${last ? `last active ${last} ago` : 'no recorded activity'}`;
}

/**
 * Build the option rows into `listEl`, replacing whatever was there.
 *
 * Takes its `document` rather than reaching for the global one, so the whole of
 * what reaches the DOM can be asserted against a stub — the technique
 * `test/unit/deck-view.test.mjs` and `test/unit/diff-view.test.mjs` use.
 *
 * The created nodes are RETURNED rather than looked up again with a selector.
 * The caller needs them on every arrow key, and a `querySelectorAll` per
 * keystroke is both slower and a second answer to "which rows are there" that
 * can disagree with the first.
 *
 * A long repo name is NOT cut here. It ellipsises in CSS, so the full name is
 * still in the accessibility tree and still what a copy takes — cutting the
 * string would throw the characters away for the sake of a width.
 *
 * @param {Document} doc
 * @param {HTMLElement} listEl the `role="listbox"`
 * @param {{id?:string, name?:string, sessionCount?:number, lastActivityAt?:number}[]} projects
 * @param {number} now ms epoch
 * @returns {HTMLElement[]} the row elements, in the order they were appended
 */
export function renderIdleList(doc, listEl, projects, now) {
  const list = Array.isArray(projects) ? projects : [];
  listEl.textContent = '';
  return list.map((project, index) => {
    const { name, stat } = idleRowText(project, now);

    const row = doc.createElement('li');
    row.className = 'idle-row';
    // An id on every row, because `aria-activedescendant` on the listbox is how
    // a screen reader is told which one is current without focus ever leaving
    // it — the pattern `palette.js` uses, and it addresses rows by id.
    row.id = `idle-row-${index}`;
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.setAttribute('aria-posinset', String(index + 1));
    row.setAttribute('aria-setsize', String(list.length));
    row.setAttribute('aria-label', idleRowLabel(project, now));
    row.dataset.index = String(index);

    const nameEl = doc.createElement('span');
    nameEl.className = 'idle-row-name';
    nameEl.textContent = name;
    row.appendChild(nameEl);

    const statEl = doc.createElement('span');
    statEl.className = 'idle-row-stat';
    statEl.textContent = stat;
    row.appendChild(statEl);

    listEl.appendChild(row);
    return row;
  });
}

// ---------------------------------------------------------------- the UI

/**
 * The wired thing: the chip, the popover, and everything that opens or closes
 * them. Untested by design, exactly as `createPalette` is — every decision
 * worth pinning is in the pure functions above.
 *
 * @param {object} opts
 * @param {HTMLElement} opts.chipEl        the corner button
 * @param {HTMLElement} opts.popoverEl     the non-modal `role="dialog"`
 * @param {HTMLElement} opts.listEl        the `role="listbox"` inside it
 * @param {Document} [opts.doc]
 * @param {() => any} opts.getSnapshot     the app's current snapshot
 * @param {(projectId:string) => void} opts.onActivate  what a row click does
 * @param {() => boolean} [opts.isSuppressed] true while something else owns
 *   this corner of the stage — see `refresh`
 * @returns {{refresh:() => void, open:() => void, close:() => void,
 *   toggle:() => void, isOpen:() => boolean}}
 */
export function createIdlePopover(opts) {
  const doc = opts.doc || document;
  const { chipEl, popoverEl, listEl, getSnapshot, onActivate } = opts;
  const isSuppressed = opts.isSuppressed || (() => false);

  /** @type {any[]} the records the rows were built from, same order */
  let projects = [];
  /** @type {HTMLElement[]} */
  let rows = [];
  let active = 0;
  let shown = false;
  /**
   * Opened on purpose — by click, or by `I` — rather than by the pointer
   * resting on the chip. A pinned list ignores the leave timer: somebody who
   * clicked to keep it open did not mean "until I move the mouse".
   */
  let pinned = false;
  /** @type {any} */
  let hoverTimer = null;
  /** @type {any} */
  let leaveTimer = null;

  /**
   * Re-read the snapshot and repaint the chip.
   *
   * The count and the rows come from ONE call to `idleProjectsOf` with one
   * clock, so the chip can never say a different number from the list under it.
   * @param {number} now
   * @returns {boolean} whether the chip is on screen at all
   */
  function readProjects(now) {
    projects = idleProjectsOf(getSnapshot(), { now });
    chipEl.textContent = idleChipLabel(projects.length);
    // Two reasons to be gone. Nothing to list is the obvious one — a chip
    // reading "0 idle" is the clutter this feature exists to remove. The other
    // is the replay bar: `.replay` is bottom-centred at `min(38rem, 100% - 2rem)`
    // wide, so on a narrow stage its right edge arrives within a rem of this
    // corner. Two overlapping boxes is worse than a chip that waits.
    chipEl.hidden = projects.length === 0 || isSuppressed();
    return !chipEl.hidden;
  }

  /** @param {number} now */
  function paint(now) {
    rows = renderIdleList(doc, listEl, projects, now);
    if (active >= rows.length) active = Math.max(0, rows.length - 1);
    paintActive();
  }

  function paintActive() {
    rows.forEach((node, i) => {
      const on = i === active;
      node.classList.toggle('is-active', on);
      node.setAttribute('aria-selected', String(on));
    });
    const current = rows[active] || null;
    listEl.setAttribute('aria-activedescendant', current ? current.id : '');
    current?.scrollIntoView?.({ block: 'nearest' });
  }

  function cancelTimers() {
    clearTimeout(hoverTimer);
    clearTimeout(leaveTimer);
    hoverTimer = null;
    leaveTimer = null;
  }

  /** @param {boolean} pin */
  function show(pin) {
    cancelTimers();
    const now = Date.now();
    if (!readProjects(now)) return;
    active = 0;
    paint(now);
    popoverEl.hidden = false;
    chipEl.setAttribute('aria-expanded', 'true');
    shown = true;
    pinned = pin;
    doc.addEventListener('keydown', onKeydown, true);
    doc.addEventListener('pointerdown', onPointerDown, true);
    // Focus only when the person asked for the list. A hover that stole focus
    // would move the caret out from under somebody who was only passing.
    if (pin && typeof listEl.focus === 'function') listEl.focus();
  }

  function close() {
    cancelTimers();
    if (!shown) return;
    shown = false;
    pinned = false;
    popoverEl.hidden = true;
    chipEl.setAttribute('aria-expanded', 'false');
    doc.removeEventListener('keydown', onKeydown, true);
    doc.removeEventListener('pointerdown', onPointerDown, true);
  }

  /** @param {number} delta */
  function move(delta) {
    if (rows.length === 0) return;
    active = (active + delta + rows.length) % rows.length;
    paintActive();
  }

  /** @param {number} index */
  function activate(index) {
    const project = projects[index];
    if (!project) return;
    // Close first: the route below scopes the whole app to that project, and a
    // list left hanging over the result is the noise this feature removes.
    close();
    try {
      onActivate(String(project.id));
    } catch (err) {
      console.error('[deckhq] opening an idle project failed', err);
    }
  }

  /** @param {KeyboardEvent} e */
  function onKeydown(e) {
    if (!shown) return;
    const target = /** @type {HTMLElement|null} */ (e.target);
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(target?.isContentEditable)) return;
    switch (e.key) {
      case 'ArrowDown':
        move(1);
        break;
      case 'ArrowUp':
        move(-1);
        break;
      case 'Home':
        active = 0;
        paintActive();
        break;
      case 'End':
        active = Math.max(0, rows.length - 1);
        paintActive();
        break;
      case 'Enter':
        activate(active);
        break;
      case 'Escape':
        close();
        break;
      default:
        return;
    }
    // Captured, and stopped. The floor's own map reads Escape as "deselect"
    // and would clear the panel on the same press that closed this list, which
    // is the defect `coach-marks.js` documents for its own Escape.
    e.preventDefault();
    e.stopPropagation();
  }

  /** @param {Event} e */
  function onPointerDown(e) {
    const node = /** @type {Node|null} */ (e.target);
    if (node && (chipEl.contains(node) || popoverEl.contains(node))) return;
    close();
  }

  /** The row under a pointer event, or null. @param {Event} e */
  function rowAt(e) {
    const node = /** @type {HTMLElement|null} */ (e.target);
    return node?.closest ? /** @type {HTMLElement|null} */ (node.closest('.idle-row')) : null;
  }

  chipEl.addEventListener('click', () => (shown ? close() : show(true)));

  chipEl.addEventListener('mouseenter', () => {
    clearTimeout(leaveTimer);
    leaveTimer = null;
    if (shown) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => show(false), HOVER_OPEN_MS);
  });

  // ONE leave timer, shared by the chip and the popover, cancelled by an enter
  // on either. There is a gap between the two boxes, so a list that closed on
  // the chip's own `mouseleave` could not be reached with the mouse at all.
  const cancelLeave = () => {
    clearTimeout(leaveTimer);
    leaveTimer = null;
  };
  const scheduleLeave = () => {
    clearTimeout(hoverTimer);
    hoverTimer = null;
    if (!shown || pinned) return;
    clearTimeout(leaveTimer);
    leaveTimer = setTimeout(close, HOVER_CLOSE_MS);
  };
  chipEl.addEventListener('mouseleave', scheduleLeave);
  popoverEl.addEventListener('mouseenter', cancelLeave);
  popoverEl.addEventListener('mouseleave', scheduleLeave);

  // Delegated, so a re-render on every new snapshot does not have to re-bind a
  // listener per row.
  listEl.addEventListener('click', (e) => {
    const row = rowAt(e);
    if (row) activate(Number(row.dataset.index));
  });
  listEl.addEventListener('mousemove', (e) => {
    const row = rowAt(e);
    if (!row) return;
    const index = Number(row.dataset.index);
    if (index !== active) {
      active = index;
      paintActive();
    }
  });

  return {
    /** A new snapshot arrived, or the replay bar opened or closed. */
    refresh() {
      const now = Date.now();
      if (!readProjects(now)) return close();
      if (shown) paint(now);
    },
    /** The `I` key and the palette's "Idle projects". */
    open: () => show(true),
    close,
    toggle: () => (shown ? close() : show(true)),
    isOpen: () => shown,
  };
}
