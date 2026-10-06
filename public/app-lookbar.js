/**
 * The header's Look and Settings buttons, wired to this shell.
 *
 * `look-ui-bar.js` is the whole behaviour and takes everything it touches as a
 * parameter; this is the one place those parameters are the real ones — the
 * four elements in `index.html`, the look port, the themes, the settings route
 * and the sheet. It is its own module rather than twenty lines of `app.js`
 * because `app.js` stands at WP-22's 900-line ceiling, and because a header
 * control that nothing but the composition root can reach is a header control
 * nothing can test.
 *
 * The elements are looked up here, by id, and not added to `app-state.js`'s
 * table: nothing else in the shell has any business holding the popover.
 */

import { createLookBar } from './look-ui-bar.js';
import { createLookPort, createThemingPort } from './app-look.js';
import { saveSetting } from './app-notify.js';
import { announce, applyThemeSetting, latestSnapshot, sessionTheme } from './app-state.js';

/**
 * @param {object} deps
 * @param {{open:(section?:any) => any}} deps.settingsUI  the settings sheet
 * @param {() => boolean} deps.tourRunning  the first-run coach marks are up
 * @param {number} [deps.debounceMs]  tests pass 0 — see `LOOK_DEBOUNCE_MS`
 */
export function wireLookBar(deps) {
  const { settingsUI, tourRunning } = deps;
  const theming = createThemingPort();
  return createLookBar({
    doc: document,
    buttonEl: document.getElementById('look-btn'),
    popoverEl: document.getElementById('look-popover'),
    hintEl: document.getElementById('look-hint'),
    hintDismissEl: document.getElementById('look-hint-dismiss'),
    settingsBtnEl: document.getElementById('settings-btn'),
    look: createLookPort(),
    theming: {
      ...theming,
      // `?theme=` paints one tab and writes nothing (WP-64), so what is painted
      // after a save is the stored theme seen through that override — exactly
      // what the next snapshot would paint anyway.
      apply: (name) => applyThemeSetting(sessionTheme(name)),
    },
    getSettings: () => latestSnapshot?.settings || null,
    saveSetting,
    announce,
    debounceMs: deps.debounceMs,
    openSheet: (section) => void settingsUI.open(section),
    // The hint waits for the screen: three coach marks on a first run, or
    // whatever modal is up. It is one line and it can afford to be late.
    isBusy: () => tourRunning() || Boolean(document.querySelector('dialog[open]')),
  });
}
