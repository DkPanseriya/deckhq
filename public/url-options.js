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

/**
 * `?phase=0.25` — PIN THE ANIMATION PHASE WITHOUT STOPPING THE ANIMATION
 * (WP-87, `docs/plan/12-MOTION-AND-CREW.md` §1.1).
 *
 * The floor's goldens were stable for one reason and it was the wrong one:
 * `scripts/goldens.mjs` emulates `prefers-reduced-motion: reduce`, so every
 * committed capture is the reduced-motion render and no animation in the
 * product has ever appeared in one. This is the seam that fixes it. A phase in
 * `[0, 1)` pins every animation to that point of its own cycle — the typing
 * stroke, the wave, the page flip, the power-down frame — while motion stays
 * ON, so `demo@motion` is a photograph of a MOVING floor that is nonetheless
 * byte-identical across two runs.
 *
 * Same rules as `?theme=`, and for the same reason: this tab only, never
 * written back, and a value this code did not write may at worst do nothing.
 * Out of range, not a number, and absent all return `null`, which means "use
 * the clock".
 *
 * @param {string} search e.g. `location.search`
 * @returns {number|null} a phase in [0, 1), or null for the ordinary clock
 */
export function pickSessionPhase(search) {
  const raw = queryValue(search, 'phase');
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value >= 1) return null;
  return value;
}

/**
 * `?look=night-lab` — PAINT ONE TAB IN A PRESET (WP-88a, §4).
 *
 * Same rules as `?theme=`, and one more that is the whole of why this parameter
 * takes a preset NAME rather than a look: **a URL that could set any look is a
 * link a stranger could send.** A look is fifteen option ids, and a query string
 * that carried all fifteen would be a way to hand somebody a floor they did not
 * choose — so what crosses this boundary is one id out of six, every one of them
 * measured on all three themes before this build shipped.
 *
 * `known` is injected rather than imported so this stays pure and so the caller
 * decides what "known" means — in the app it is `presetById`, which is case- and
 * separator-insensitive, so `?look=Night_Lab` finds `night-lab`.
 *
 * For this tab, and for nothing else: never written back through `/api/look`,
 * never the look the picker shows, and closing the tab is the whole of undoing
 * it. An unknown value is IGNORED rather than refused or substituted.
 *
 * @param {string} search        the query string
 * @param {unknown} settingLook  what `settings.look` says
 * @param {(name:string) => unknown} known a preset lookup; falsy for an unknown id
 * @returns {unknown} the look to paint
 */
export function pickSessionLook(search, settingLook, known) {
  const wanted = queryValue(search, 'look');
  if (!wanted) return settingLook;
  let preset = null;
  try {
    preset = known(wanted) || null;
  } catch {
    preset = null;
  }
  return preset || settingLook;
}
