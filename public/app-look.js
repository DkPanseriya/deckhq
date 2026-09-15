/**
 * The look, as a write and as a file — WP-88b.
 *
 * `app-layout.js`'s two functions, one document out: a look leaves through a
 * `<a download>` and comes back through an `<input type="file">`, and neither
 * of them touches the network beyond this machine's own daemon.
 *
 * **THE DAEMON IS THE AUTHORITY ON WHAT A LOOK IS**, exactly as it is for a
 * layout. Nothing here validates one. `postLook` sends the document and reports
 * what came back; `importLook` parses the file only far enough to be valid JSON.
 * The refusal the user reads is `src/core/look.mjs`'s own, measured against
 * every shipped theme, and a refused file changes nothing at all.
 *
 * ## Why `/api/look` and not `/api/settings`
 *
 * `/api/settings` SANITISES a look — `sanitizeLook` drops what it does not
 * recognise, because a daemon that would not start over a typo in a floor
 * material is worse than one that paints the default and says so. That is right
 * for a `state.json` somebody hand-edited and wrong for a person moving a
 * picker: a sanitised look would leave them with a floor that matched neither
 * what they chose nor what they had. `/api/look` refuses WHOLE, with the
 * problems list, one row per picker — which is the shape the Look section draws.
 */

import { now as clockNow } from './clock.js';
import { floorPopulation } from './floor-rule.js';
import {
  applyLookSetting,
  latestSnapshot,
  lookGuards,
  lookOptions,
  lookPictures,
  paintedTheme,
  toast,
} from './app-state.js';

/**
 * Apply a look, and say what happened.
 *
 * Resolves rather than throws, because the caller is a picker: it has a row to
 * draw the reason in and nothing to do with a stack trace.
 *
 * @param {unknown} look the look document's body — no `kind`, no `version`
 * @returns {Promise<{ok:boolean, problems?:any[], error?:string}>}
 */
export async function postLook(look) {
  try {
    const res = await fetch('/api/look', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'deckhq.look', version: 1, .../** @type {any} */ (look) }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, problems: body.problems || [], error: body.error };
    // The floor follows the daemon's answer rather than what was clicked, for
    // `save()`'s reason in `settings-ui.js`: the store is the authority on what
    // was stored. `body.look` is the document; the look itself is what is left
    // once `kind` and `version` come off it.
    const { kind: _kind, version: _version, ...applied } = body.look || {};
    applyLookSetting(applied);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: /** @type {any} */ (err).message };
  }
}

/**
 * Write the current look out as a file.
 *
 * The toast says the one thing a person needs to know before sending it to
 * anybody, and for a look it is the OPPOSITE of the layout's: a layout names
 * your project folders, and a look names nothing at all.
 */
export async function exportLook() {
  try {
    const res = await fetch('/api/look');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const look = await res.json();
    const blob = new Blob([`${JSON.stringify(look, null, 2)}\n`], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deckhq-look.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    toast(
      `Look saved: “${look.preset}”. It names no project, no path and no session — ` +
        'it is anonymous, so it is a file you can post.',
    );
  } catch (err) {
    toast(`Could not export the look: ${err.message}`, { isError: true });
  }
}

/**
 * Apply a look from a file.
 *
 * The browser's own file input, so nothing about this is a network read: the
 * file never leaves the machine and the daemon it is posted to is on 127.0.0.1.
 */
export function importLook() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(`that file is not JSON (${err.message}).`);
      }
      const res = await fetch('/api/look', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const { kind: _kind, version: _version, ...applied } = body.look || {};
      applyLookSetting(applied);
      toast(`Look applied: “${applied.preset}”.`);
    } catch (err) {
      toast(`${err.message} Nothing was changed.`, { isError: true });
    }
  });
  input.click();
}

// ------------------------------------------------- what the shell hands over

/**
 * THE LOOK PORT the settings sheet is handed (WP-88b).
 *
 * The same shape and the same reason as WP-30's `theming` and WP-45's
 * `avatars`: the catalogue, the guards and the painter all live under
 * `render/**`, every import from there is dynamic and defensive, and
 * `settings-ui.js` has to stay importable under `node --test`. So the sheet is
 * handed four functions instead of four modules.
 *
 * Every one of them reads its module through `app-state.js` ON EACH CALL rather
 * than capturing it, because the modules arrive after this port is built —
 * `loadRenderModules` is awaited later. `catalogue()` answering `null` is what
 * makes the Look section ABSENT on a build whose renderer did not load, which is
 * the honest answer: there is nothing to paint a swatch with and no guard to
 * refuse with.
 */
export function createLookPort() {
  return {
    catalogue: () => lookOptions,
    validate: (/** @type {any} */ next, /** @type {any} */ theme) =>
      lookGuards ? lookGuards.validateLook(next, theme) : { ok: true, problems: [] },
    metrics: (/** @type {any} */ next, /** @type {any} */ theme) =>
      lookGuards ? lookGuards.lookMetrics(next, theme) : [],
    theme: () => paintedTheme(),
    picture: (/** @type {any} */ spec) => lookPictures?.picture(spec) || null,
    live: liveAgentCount, // WP-88c — the number beside `auto`
    apply: postLook,
    exportLook,
    importLook,
  };
}

/** The six presets the palette offers, or none until the catalogue has loaded. */
export const lookPresets = () =>
  (lookOptions?.PRESETS || []).map((/** @type {any} */ p) => ({
    id: p.id,
    label: p.label,
    blurb: p.blurb,
  }));

/**
 * The four the command palette runs.
 *
 * A preset NAME and never a look, exactly as `?look=` takes one: the palette
 * offers the six the guards measured whole, and the Look section is where
 * anything finer than a preset is chosen. `resetLook` puts every option back to
 * the preset the current look started from — the section's own button, from the
 * keyboard.
 */
export const lookPaletteActions = Object.freeze({
  setLookPreset: (/** @type {string} */ id) => postLook(lookOptions?.lookForPreset(id)),
  resetLook: () =>
    postLook(lookOptions?.lookForPreset((latestSnapshot?.settings?.look || {}).preset)),
  // WP-88c. One key of the stored look rather than a preset, and that is the
  // difference between this and every row above it: a size is not a floor, so
  // choosing one must leave the floor the user chose exactly as it is.
  setAgentSize: (/** @type {string} */ id) =>
    postLook({ ...(latestSnapshot?.settings?.look || {}), agentSize: id }),
  exportLook,
  importLook,
});

/**
 * HOW MANY PEOPLE THE FLOOR IS DRAWING RIGHT NOW (WP-88c).
 *
 * The number beside `auto` in the Look section, and the only thing on that row
 * that is not a word: *"auto · 27 live"* is what makes the setting legible,
 * because `auto` on its own does not say what it decided.
 *
 * Counted with `floorPopulation` — the plan's own rule, from `floor-rule.js` —
 * rather than by adding up the agent list here, so the sheet and the building
 * behind it cannot disagree about who is on the floor.
 */
export function liveAgentCount() {
  const snapshot = latestSnapshot;
  if (!snapshot) return 0;
  const pop = floorPopulation(snapshot.agents || [], {
    now: clockNow(),
    goneHomeDays: (snapshot.settings || {}).goneHomeDays,
  });
  const desks = [...pop.desks.values()].reduce((n, k) => n + k, 0);
  return desks + pop.waiting + pop.benchedDrawn;
}
