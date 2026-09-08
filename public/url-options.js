/**
 * Options the floor takes from its own URL — WP-64.
 *
 *     http://127.0.0.1:4317/?theme=night%20shift
 *
 * FOR THIS TAB, AND FOR NOTHING ELSE. A query parameter never reaches
 * `state.json`: it is not written back through `/api/settings`, it does not
 * change the setting the picker shows, and closing the tab is the whole of
 * undoing it. That is the point of it — a screenshot, a capture run, a second
 * window in a different paint — and a URL that quietly rewrote a user's stored
 * preferences would be a link anybody could send them.
 *
 * An unknown value is IGNORED, not refused and not substituted: the floor
 * paints the theme the settings actually name. A URL is a thing strangers
 * write, and the worst it may do here is nothing.
 *
 * Everything in this file is pure — it is handed a query string rather than
 * reading `location` — so the rules are unit-testable without a browser.
 */

/**
 * One query parameter's value, or null.
 *
 * `URLSearchParams` does the decoding, so `?theme=night%20shift` arrives as
 * `night shift`. A malformed query string is null rather than a throw: a URL
 * this code did not write must never be able to stop the floor loading.
 *
 * @param {string} search e.g. `location.search`
 * @param {string} key
 * @returns {string|null}
 */
export function queryValue(search, key) {
  try {
    const value = new URLSearchParams(String(search ?? '')).get(String(key));
    if (value === null) return null;
    const trimmed = value.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}

/**
 * Which theme this tab should paint: the URL's, when it names one this build
 * actually has, and otherwise the setting's.
 *
 * `known` is injected rather than imported so this stays pure and so the
 * caller decides what "known" means — in the app it is `themeByName`, which
 * covers the shipped themes AND any a pack has registered, and which is
 * case- and separator-insensitive so `?theme=night-shift` finds `night shift`.
 *
 * @param {string} search        the query string
 * @param {unknown} settingTheme what `settings.theme` says
 * @param {(name:string) => unknown} known truthy for a theme that exists
 * @returns {unknown} the name to paint
 */
export function pickSessionTheme(search, settingTheme, known) {
  const wanted = queryValue(search, 'theme');
  if (!wanted) return settingTheme;
  let ok = false;
  try {
    ok = Boolean(known(wanted));
  } catch {
    ok = false;
  }
  return ok ? wanted : settingTheme;
}
