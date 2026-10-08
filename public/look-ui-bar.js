/**
 * THE LOOK BAR — the header's Look button, the popover under it, the one-line
 * hint that points at it once, and the Settings button beside it.
 *
 * The owner, looking at his own floor: *"I still don't see any bar anywhere, any
 * settings options, to configure floor design, agent sizes, etc."* Everything he
 * was asking for existed — six presets, a floor material per zone, a colour
 * scheme, a furniture set, rugs, planting, props, the lounge kit, four agent
 * sizes, three themes — and every one of them was behind `Ctrl K`, a word typed
 * into a palette, and a scroll. A setting nobody can find is a setting the
 * product does not have.
 *
 * So the header carries two buttons, and this is what they do:
 *
 *   - **Look** opens a small popover with the six high-level choices — agent
 *     size, theme, style, density, light and room colours — and a link to the
 *     whole section.
 *   - **Settings** opens the sheet at the top.
 *
 * The six are the same six the top of the sheet's Look section draws, out of
 * the same list (`outsideControls`) and the same store. Nothing finer is here:
 * a floor material per zone belongs under Advanced, in the sheet.
 *
 * ============================================================================
 * FOUR RULES, AND THE FIRST THREE ARE `look-ui.js`'s
 *
 * 1. **The catalogue is the popover.** The sizes, the presets and the density
 *    steps are read out of the catalogue the Look section reads; nothing here
 *    restates one. The themes come from the theming port for the same reason.
 *
 * 2. **A control shows what the daemon last accepted.** It moves on the click
 *    and goes back only on a refusal, with the guard's own sentence under the
 *    control that was touched. The look, what is pending and the refusal are
 *    the store's (`look-ui-store.js`) — the settings sheet reads the same one.
 *
 * 3. **Nothing here imports the renderer**, and nothing here touches a global.
 *    The document, the elements, the ports and the two writes all arrive as
 *    parameters, which is what lets `test/unit/look-bar.test.mjs` drive every
 *    control with a stub and no browser.
 *
 * 4. **It is a popover, not a view.** Not a `<dialog>`, no scrim, nothing that
 *    covers the floor: `idle-projects.js`'s pattern. Escape closes it and hands
 *    focus back to the button; a click anywhere else closes it; and while focus
 *    is inside it the floor's single-letter keys stand down, exactly as they do
 *    in a text field — `B` with the popover open must not bench somebody.
 * ============================================================================
 *
 * Every string that reaches the page goes through `textContent`.
 */

import { createLookStore } from './look-ui-store.js';
import { createLookParts, outsideControls } from './look-ui-parts.js';

/** The hint's one line. In `index.html` too, where a test can read it. */
export const LOOK_HINT_TEXT = 'Change the floor, the furniture and the agent size here.';

/** The floor keys the two buttons answer to, named once for the tooltips. */
export const LOOK_KEY = 'L';
export const SETTINGS_KEY = ',';

/**
 * @param {object} opts
 * @param {any} opts.doc                 `document`, or a stub
 * @param {any} opts.buttonEl            the header's Look button
 * @param {any} opts.popoverEl           the empty popover shell beside it
 * @param {any} [opts.hintEl]            the one-line hint under the button
 * @param {any} [opts.hintDismissEl]     its one dismiss
 * @param {any} [opts.settingsBtnEl]     the header's Settings button
 * @param {any} opts.look                the look port (`createLookPort`)
 * @param {{list:() => any[], apply:(name:string) => any,
 *   swatches:(theme:any) => string[]}} opts.theming
 * @param {() => any} opts.getSettings   what the daemon last said, or null
 * @param {(patch:Record<string, unknown>) => Promise<any>} opts.saveSetting
 *   the settings route; resolves to the stored settings, or null on a failure
 *   it has already reported
 * @param {(section:string|null) => void} opts.openSheet  the full settings sheet
 * @param {() => boolean} [opts.isBusy]  true while a tour or a modal has the
 *   screen, so the hint waits its turn
 * @param {(text:string) => void} [opts.announce]
 * @param {any} [opts.store]             the look store both surfaces share
 * @param {number} [opts.debounceMs]     read only by a store made here
 */
export function createLookBar(opts) {
  const { doc, buttonEl, popoverEl, hintEl, hintDismissEl, settingsBtnEl } = opts;
  const { look: port, theming, getSettings, saveSetting, openSheet } = opts;
  const isBusy = opts.isBusy || (() => false);
  const announce = opts.announce || (() => {});
  /**
   * The look, the theme, what is pending and the last refusal all live in the
   * store (`look-ui-store.js`), and the shell hands this bar the SAME store it
   * hands the settings sheet — so the two cannot show different floors. A bar
   * given none makes its own out of the same ports.
   */
  const store =
    opts.store ||
    createLookStore({
      port,
      theming,
      read: getSettings,
      saveSetting,
      debounceMs: opts.debounceMs,
    });

  let shown = false;
  /** What the popover was last drawn from, so a snapshot that changed nothing redraws nothing. */
  let drawn = '';
  /** The radio to put focus back on after a redraw: `group:id`. */
  let focusKey = '';
  /** Every radio in the popover as drawn, by `group:id`. @type {Map<string, any>} */
  const stops = new Map();
  /** The "All look options…" link as drawn, the fallback place for focus. @type {any} */
  let allLink = null;
  /** Dismissed in this tab; the daemon may not have answered yet. */
  let hintDismissed = false;

  const parts = createLookParts({
    doc,
    stops,
    onPick: (key) => {
      focusKey = key;
    },
  });
  const { el } = parts;
  const cat = () => port?.catalogue?.() || null;
  const themes = () => store.themes();
  /** Is there anything to put in a popover? Without a renderer there is not. */
  const hasControls = () => Boolean(cat()) || themes().length > 1;

  // ---------------------------------------------------------------- pieces

  /**
   * One of the six controls: its name, a quiet note beside it, the control,
   * and under it the reason if it just refused.
   *
   * Four are words in a segmented control and one is a switch. The sixth is
   * the presets as thumbnails — the settings sheet's own, out of the same cache
   * and under the same key, so opening the sheet after this paints nothing
   * twice.
   *
   * @param {any} host @param {any} control one of `outsideControls(store)`
   */
  function drawControl(host, control) {
    const pictures = control.id === 'preset';
    const wrap = el('div', 'lookbar-row');
    const head = el('div', 'lookbar-row-head');
    head.appendChild(el('span', 'lookbar-label', control.label));
    if (control.note) head.appendChild(el('span', 'lookbar-note', control.note));
    if (control.kind === 'switch') {
      // A decision, not a list: its name, and the switch on the same line.
      wrap.className += ' lookbar-row--switch';
      wrap.append(
        head,
        parts.switchControl({
          name: control.id,
          label: control.label,
          checked: control.checked,
          state: control.state,
          onChange: control.onToggle,
        }),
      );
      for (const problem of store.refusalsFor(control.id)) {
        wrap.appendChild(parts.refusalBox(problem, 'lookbar-refusal'));
      }
      host.appendChild(wrap);
      return;
    }
    const group = parts.radioGroup({
      name: control.id,
      label: control.label,
      className: pictures ? 'lookbar-presets' : 'lookbar-seg',
      itemClass: pictures ? 'lookbar-preset' : 'lookbar-seg-btn',
      options: control.options.map((/** @type {any} */ o) => {
        /** @type {any[]} */
        const before = [];
        if (o.theme) before.push(parts.swatchDots(store.swatches(o.theme)));
        if (o.preset) {
          const shot = port.picture?.({
            kind: 'thumbnail',
            look: o.preset.look,
            key: `preset:${o.preset.id}`,
          });
          if (shot?.setAttribute) shot.setAttribute('aria-hidden', 'true');
          if (shot) before.push(shot);
        }
        return { id: o.id, label: o.label, title: o.title, parts: before };
      }),
      value: control.value,
      onChange: control.onChange,
    });
    wrap.append(head, group);
    for (const problem of store.refusalsFor(control.id)) {
      wrap.appendChild(parts.refusalBox(problem, 'lookbar-refusal'));
    }
    host.appendChild(wrap);
  }

  /** Everything the popover is drawn from, as one comparable string. */
  function signature() {
    return JSON.stringify([
      Boolean(cat()),
      store.look(),
      store.theme(),
      themes().map((/** @type {any} */ t) => t.name),
      port?.theme?.() ?? '',
      port?.live?.() ?? '',
      store.refusal(),
    ]);
  }

  function render() {
    if (!shown) return;
    // Hear the daemon's last word before drawing — quietly, because this IS
    // the redraw a subscriber would have asked for.
    store.refresh({ silent: true });
    drawn = signature();
    stops.clear();
    popoverEl.textContent = '';
    for (const control of outsideControls(store)) drawControl(popoverEl, control);
    const foot = el('div', 'lookbar-foot');
    const all = el('button', 'link-btn lookbar-all', 'All look options…');
    all.type = 'button';
    all.addEventListener('click', () => openLook());
    allLink = all;
    foot.append(all, el('span', 'lookbar-foot-keys', 'Esc to close'));
    popoverEl.appendChild(foot);
    // A redraw replaced the button the hand was on; put the hand back.
    if (focusKey) stops.get(focusKey)?.focus?.();
  }

  // ------------------------------------------------------------ open, close

  /** @param {any} e */
  function onDocKeydown(e) {
    if (e.key !== 'Escape') return;
    // Captured, and stopped: the floor's own map reads Escape as "deselect" and
    // would clear the panel on the press that closed this.
    e.preventDefault?.();
    e.stopPropagation?.();
    close({ focus: true });
  }

  /** @param {any} e */
  function onDocPointerDown(e) {
    const node = e.target;
    if (node && (buttonEl.contains?.(node) || popoverEl.contains?.(node))) return;
    close();
  }

  function open() {
    if (shown) return;
    // The button is the hint's whole subject, so using it is having read it.
    dismissHint();
    if (!hasControls()) return openLook();
    shown = true;
    store.clearRefusal();
    focusKey = '';
    popoverEl.hidden = false;
    buttonEl.setAttribute('aria-expanded', 'true');
    render();
    doc.addEventListener('keydown', onDocKeydown, true);
    doc.addEventListener('pointerdown', onDocPointerDown, true);
    // Into the popover, on the chosen size if there is one: the person asked
    // for these controls, by a click or by a key, and the next key is theirs.
    const first = [...stops.values()].find((b) => b.getAttribute('tabindex') === '0');
    (first || allLink)?.focus?.();
  }

  /** @param {{focus?:boolean}} [how] */
  function close(how = {}) {
    if (!shown) return;
    shown = false;
    // A change that was shown but not yet sent is sent on the way out rather
    // than dropped: the person saw the control move.
    void store.flush();
    store.clearRefusal();
    focusKey = '';
    popoverEl.hidden = true;
    popoverEl.textContent = '';
    stops.clear();
    allLink = null;
    buttonEl.setAttribute('aria-expanded', 'false');
    doc.removeEventListener('keydown', onDocKeydown, true);
    doc.removeEventListener('pointerdown', onDocPointerDown, true);
    if (how.focus) buttonEl.focus?.();
  }

  function toggle() {
    if (shown) close({ focus: true });
    else open();
  }

  /** The whole Look section, in the sheet. */
  function openLook() {
    close();
    dismissHint();
    openSheet('look');
  }

  /** The sheet, from the top. */
  function openSettings() {
    close();
    openSheet(null);
  }

  // ------------------------------------------------------------- the hint

  function hintWanted() {
    const s = getSettings();
    if (!s || !hintEl || hintDismissed || shown) return false;
    // `onboarded` first: on a first run the three coach marks have the screen,
    // and this is the line that follows them rather than a fourth voice.
    return s.seenLookHint !== true && s.onboarded === true && !isBusy();
  }

  function paintHint() {
    if (!hintEl) return;
    const want = hintWanted();
    if (hintEl.hidden === !want) return;
    hintEl.hidden = !want;
    if (want) announce(LOOK_HINT_TEXT);
  }

  /** One dismiss, recorded, and never again — in this tab at once, everywhere on the next read. */
  function dismissHint() {
    if (hintEl) hintEl.hidden = true;
    const s = getSettings();
    if (hintDismissed || !s || s.seenLookHint === true) return;
    hintDismissed = true;
    void saveSetting({ seenLookHint: true });
  }

  // ------------------------------------------------------------- listeners

  buttonEl.addEventListener('click', () => toggle());
  settingsBtnEl?.addEventListener('click', () => openSettings());
  hintDismissEl?.addEventListener('click', () => {
    dismissHint();
    // The dismiss button has just gone; land on the thing it was describing.
    buttonEl.focus?.();
  });
  popoverEl.addEventListener('keydown', (/** @type {any} */ e) => {
    // A chord is the palette's, Tab is the browser's, and Escape was taken on
    // the way down. Everything else stops here.
    if (e.ctrlKey || e.metaKey || e.altKey || e.key === 'Tab' || e.key === 'Escape') return;
    e.stopPropagation?.();
    if (e.key === 'l' || e.key === 'L') {
      e.preventDefault?.();
      close({ focus: true });
    }
  });
  popoverEl.addEventListener('focusout', (/** @type {any} */ e) => {
    // Tabbed out the far end. `relatedTarget` is null when a redraw removed the
    // focused radio, and that is not leaving.
    const to = e.relatedTarget;
    if (!to || to === buttonEl || popoverEl.contains?.(to)) return;
    close();
  });

  // The store says when the look or the theme moved: a choice here, the
  // daemon's answer to it, or a push the settings sheet or another tab caused.
  store.subscribe(() => render());

  return {
    open,
    close,
    toggle,
    isOpen: () => shown,
    openLook,
    openSettings,
    dismissHint,
    store,
    /** A snapshot arrived: the hint may be due, and an open popover may be stale. */
    refresh() {
      paintHint();
      // Loud, not silent: the settings sheet subscribes to the same store, and
      // this is the one place the shell says "the daemon pushed".
      store.refresh();
      if (shown && signature() !== drawn) render();
    },
  };
}
