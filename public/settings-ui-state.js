/**
 * The two facts every part of the settings sheet reads (WP-22 follow-up).
 *
 * The settings as the daemon last confirmed them, and what `/api/about`
 * said. Live bindings with a setter each, the way `app-state.js` and
 * `panel-state.js` do (docs/DEVIATIONS.md §122, rule 2): a part reads
 * `current` by name and cannot reassign it, and `settings-ui.js` is the only
 * file that calls a setter.
 *
 * `current` is never what was clicked — it is what the store answered with,
 * because the store clamps the stall window and the volume and a control has
 * to show what actually landed.
 */

/** @type {Record<string, any>} the settings as last confirmed by the daemon */
export let current = {};
/** @param {Record<string, any>} v */
export const setCurrent = (v) => {
  current = v;
};

/** @type {{statePath?:string, rateCardVersion?:string}} */
export let about = {};
/** @param {{statePath?:string, rateCardVersion?:string}} v */
export const setAbout = (v) => {
  about = v;
};
