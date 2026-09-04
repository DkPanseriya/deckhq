/**
 * The two facts every part of the review card needs (WP-22 follow-up).
 *
 * Which session the panel is on, and the agent object it is currently
 * showing — which is not always the snapshot's, because `performAction()`
 * patches it optimistically and the next snapshot overwrites the guess.
 *
 * Live bindings with a setter each, exactly as `app-state.js` does for the
 * floor (docs/DEVIATIONS.md §122, rule 2): a part reads `currentId` by name,
 * as it did when it was a local of one 2,422-line closure, and **cannot**
 * reassign it — an import binding is read-only, so "the parts see the state,
 * the lifecycle owns it" is enforced by the language rather than by review.
 *
 * `panel.js` is the only file that calls `setCurrentId`; `panel.js` and
 * `panel-actions.js` are the only two that call `setDisplayedAgent`, the
 * second because the optimistic patch and its rollback are the whole of
 * `performAction()`.
 *
 * Every other piece of the panel's state lives in the one part that owns it —
 * the diffs in `panel-changes.js`, the answer-in-flight flag in
 * `panel-permission.js`, and so on — and is exported from there the same way.
 *
 * Module state rather than per-instance state because the panel is a
 * singleton by construction: `createPanel()` registers a `document` keydown
 * listener and gives its composer the fixed id `panel-input`, so a second one
 * was never possible.
 */

/** @type {string|null} */
export let currentId = null;
/** @param {string|null} v */
export const setCurrentId = (v) => {
  currentId = v;
};

/** @type {any} the agent object currently displayed, possibly optimistic */
export let displayedAgent = null;
/** @param {any} v */
export const setDisplayedAgent = (v) => {
  displayedAgent = v;
};
