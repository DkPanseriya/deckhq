/**
 * Every full-surface view, and the one way out of each of them.
 *
 * ============================================================================
 * THE RULE (WP-84, docs/plan/05-GUI-UX-SPEC.md §3.4, docs/DEVIATIONS.md §156)
 *
 * The owner, having opened the deck:
 *
 *   "Once the user clicks the agents tab, or the list of all who are waiting,
 *    there is literally no button to close that panel or go back to the floor
 *    view."
 *
 * He was right, and it was true of more than the deck. A FULL-SURFACE VIEW —
 * anything that replaces the floor inside the stage, or covers the window with
 * a scrim — must carry two controls, both real `<button>`s in the tab order:
 *
 *   - a visible ✕ at the TOP RIGHT, and
 *   - "Back to floor" at the TOP LEFT,
 *
 * with the keyboard shortcut printed in the view's own title, because a way
 * out nobody can see is not a way out. `Escape` closes each of them too, and
 * `Tab` still toggles the deck.
 *
 * CLOSING CLOSES THE VIEW AND NOTHING ELSE. Not the tab, not the window, not a
 * history entry. §143 is the whole reason that sentence is in this header: a
 * ✕ in this product once resolved to `window.close` and took the browser tab
 * with it, because `close()` written in a module that declares no `close`
 * is `window.close`. `test/unit/panel-close.test.mjs` holds both halves of
 * that gate — a static one over every client module, and a dynamic one that
 * drives every close path against a window whose closing globals are counters
 * — and WP-84 added these buttons to the dynamic half.
 * ============================================================================
 *
 * WHY THE CHROME IS IN `index.html` AND THE WIRING IS HERE. The markup is
 * static so that `test/unit/surfaces.test.mjs` can read it: the test's job is
 * to fail when somebody adds a full-surface view and forgets its way out, and
 * a control that only exists after a render is a control the test would have
 * to guess at. So the buttons ship in the document, `SURFACES` below names
 * them, and `wireSurfaceControls()` is the single place a click on one becomes
 * a close.
 */

/**
 * @typedef {object} Surface
 * @property {string} id       the `data-surface` value on the host element
 * @property {string} hostId   the host's element id in `index.html`
 * @property {string} title    what the view calls itself, shortcut excluded
 * @property {string} owner    the module that opens and closes it
 */

/**
 * Every full-surface view in the product.
 *
 * ADDING ONE: give its host element `data-surface="<id>"` and the chrome block
 * (`.surface-chrome` with `.surface-back`, `.surface-title` and
 * `.surface-close`) in `index.html`, add a row here, and call
 * `wireSurfaceControls()` from whatever owns its close. `surfaces.test.mjs`
 * fails on any of those being missing, and it also fails on a NEW full-surface
 * element that carries no `data-surface` at all — so forgetting this list is
 * itself caught.
 *
 * @type {readonly Surface[]}
 */
export const SURFACES = Object.freeze([
  Object.freeze({
    id: 'deck',
    hostId: 'deck',
    title: 'The deck',
    owner: 'deck.js',
  }),
  Object.freeze({
    id: 'board',
    hostId: 'whiteboard-overlay',
    title: 'Project board',
    owner: 'app.js',
  }),
  Object.freeze({
    id: 'settings',
    hostId: 'settings-dialog',
    title: 'Settings',
    owner: 'app.js',
  }),
]);

/** The classes the chrome uses, named once so the test and the CSS agree. */
export const SURFACE_CHROME_CLASS = 'surface-chrome';
export const SURFACE_BACK_CLASS = 'surface-back';
export const SURFACE_CLOSE_CLASS = 'surface-close';
export const SURFACE_TITLE_CLASS = 'surface-title';

/**
 * Bind a view's ✕ and its "Back to floor" to one close.
 *
 * Both do the same thing on purpose: they are two affordances for one exit,
 * not two different exits. The ✕ is what a mouse reaches for in the corner it
 * expects; "Back to floor" is what somebody reads when they are lost, and it
 * says where they will end up rather than only that this will stop.
 *
 * `onClose` is a function the CALLER owns. Nothing in this module calls
 * anything it did not receive — see the header, and §143.
 *
 * @param {{querySelectorAll: (sel:string) => Iterable<any>}|null|undefined} host
 *   the element carrying `data-surface`
 * @param {() => void} onClose
 * @returns {number} how many controls were wired; 0 means the chrome is missing
 */
export function wireSurfaceControls(host, onClose) {
  if (!host || typeof host.querySelectorAll !== 'function') return 0;
  let wired = 0;
  for (const cls of [SURFACE_BACK_CLASS, SURFACE_CLOSE_CLASS]) {
    for (const button of host.querySelectorAll(`.${cls}`)) {
      button.addEventListener('click', (/** @type {any} */ event) => {
        event?.preventDefault?.();
        onClose();
      });
      wired++;
    }
  }
  return wired;
}
