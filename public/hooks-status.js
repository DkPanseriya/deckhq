/**
 * What `snapshot.hooks` says about the hooks, read for the header. Pure, so
 * a test can ask it without a page.
 */

/** What the banner says when the hooks are installed twice over. */
export const DOUBLED_HOOKS_TEXT = 'Hooks are installed twice, so every event runs twice';

/**
 * Is any runtime's hook set in its settings file more than once? Then every
 * event starts two processes posting the same thing, and the hooks screen's
 * Tidy writes one set back (25 October 2026: a re-saving tool left the
 * owner's file that way).
 * @param {unknown} hooks `snapshot.hooks`
 */
export function hooksDoubled(hooks) {
  if (!hooks || typeof hooks !== 'object') return false;
  return Object.values(hooks).some((h) => Boolean(h && h.installed && h.doubled));
}
