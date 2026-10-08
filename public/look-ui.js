/**
 * THE LOOK SECTION of the settings sheet — WP-88b, redrawn simple-outside,
 * detail-inside.
 *
 * WP-88a shipped the catalogue, the derivation and the guards and no UI. WP-88b
 * built the surface: six preset cards, a live preview, one row per picker in
 * the catalogue, the lounge kit, export and import — all of it at one weight,
 * which is what its owner said of it: *"there are too many options for many
 * details like plants, rug, corridor etc. Hide them under advanced … Keep
 * high-level abstract settings like agent size, theme, etc. on the outside."*
 *
 * So the section is two things now:
 *
 *   OUTSIDE   Agent size · Theme · Style (the presets, as pictures) and, in one
 *             line under the cards, the three ways of turning a style —
 *             Density · Light · Room colours — then the live preview. The same
 *             six the header's Look bar offers, from the same list
 *             (`outsideControls`).
 *   ADVANCED  everything else in the catalogue, under four headings, in a
 *             disclosure that is shut until somebody opens it
 *             (`look-ui-advanced.js`).
 *
 * ============================================================================
 * FIVE RULES THIS FILE IS BUILT AROUND
 *
 * 1. **The catalogue is the section.** Every option on this surface is read out
 *    of `LOOK_PICKERS`, the presets and the themes; nothing here restates one.
 *    A package that adds a floor material gets a chip for it without anybody
 *    editing this file.
 *
 * 2. **A control shows what the daemon last accepted.** It moves on the click
 *    and goes back ONLY on a refusal, with the guard's own sentence under it.
 *    This file holds no look of its own: the look, what is pending and the last
 *    refusal are the store's (`look-ui-store.js`), and the header's bar reads
 *    the same store.
 *
 * 3. **Nothing here imports the renderer.** `settings-ui.js` must stay
 *    importable under `node --test`, and every import from `render/**` in this
 *    product is dynamic and defensive. So the catalogue, the guard and the
 *    painter arrive through a PORT, exactly as the themes and the avatars do.
 *
 * 4. **Every control is operable from the keyboard alone.** Each choice is a
 *    real `radiogroup` on a roving tabindex: one Tab stop per group, arrows
 *    inside it, Home and End to the ends. The lounge kit is four `checkbox`es.
 *    The disclosures are real `<details>`. And a redraw puts the focus back on
 *    the control it took it from.
 *
 * 5. **Simple outside.** A row is on the outside only if somebody arrives
 *    already knowing they want it. "Make them bigger" is a sentence people say;
 *    "change the corridor to loop pile" is not.
 * ============================================================================
 */

import { LOOK_DEBOUNCE_MS, OUTSIDE_PICKER_IDS, createLookStore } from './look-ui-store.js';
import { createLookParts, outsideControls } from './look-ui-parts.js';
import { createAdvanced, dimensionsFor, swatchSpecFor } from './look-ui-advanced.js';

// Named here too, because this is where the bar and the tests have always
// imported them from.
export { LOOK_DEBOUNCE_MS, dimensionsFor, swatchSpecFor };

/** The section's element id, so the palette and the golden can jump to it. */
export const LOOK_SECTION_ID = 'settings-look';

/**
 * The do-nothing port. Absent, or this, means NO LOOK SECTION — the honest
 * answer on a build whose renderer did not load, because there is nothing to
 * paint a swatch with and no guard to refuse with.
 */
export const NO_LOOK = Object.freeze({ catalogue: () => null });

/**
 * Build the Look section.
 *
 * @param {object} opts
 * @param {any} opts.doc                   `document`, or a stub
 * @param {{section:Function, row:Function}} opts.widgets  the sheet's own parts
 * @param {any} opts.look                  the port (see `NO_LOOK`)
 * @param {any} [opts.store]               the look store both surfaces share
 *   (`look-ui-store.js`). The shell hands the sheet and the header's bar the
 *   SAME one; a section given none makes its own, which is one surface with
 *   one store and is what a test of this file alone wants.
 * @param {() => any} [opts.getLook]       what the daemon last said the look
 *   is — read only by a store this section had to make for itself
 * @param {{get?:(key:string) => string|null, set?:(key:string, value:string) => void}} [opts.prefs]
 *   what this browser remembers about which disclosures are open
 * @param {(msg:string, o?:any) => void} opts.toast
 * @param {number} [opts.debounceMs]
 */
export function createLookSection(opts) {
  const { doc, widgets, look: port, toast } = opts;
  /**
   * THE LOOK, AND EVERYTHING ABOUT IT THAT CHANGES, lives in the store: what
   * the daemon last accepted, what was just chosen and is not answered yet, and
   * the last refusal with the control the hand was on. This section holds no
   * copy of any of it — it held one once, read out of the settings the sheet
   * was opened with, and that is why a chosen chip used to go back.
   *
   * A refusal's `from` is what decides WHERE the reason is drawn, and it is not
   * `problem.picker`. A guard names the row a problem BELONGS to — put terrazzo
   * in the office and the problem is the corridor's — but the control that just
   * refused to move is the office's, and a sentence two rows away from the chip
   * somebody clicked reads as an unrelated complaint.
   */
  const store =
    opts.store ||
    createLookStore({
      port,
      read: () => ({ look: opts.getLook?.() }),
      debounceMs: opts.debounceMs,
    });
  /** Late-bound: the sheet's re-render. @type {() => void} */
  let render = () => {};
  /**
   * WHERE THE KEYBOARD IS, ACROSS A REDRAW. Every choice redraws the sheet, and
   * a redraw replaces the button the hand was on — so an arrow key used to move
   * the choice once and then leave the focus on a button that was no longer in
   * the document. Every control here is registered under a key, and a redraw
   * puts the focus back on the control with the key it had.
   * @type {Map<string, any>}
   */
  const stops = new Map();
  /** The control a hand just used, for a click that did not move the focus. */
  let picked = '';

  const parts = createLookParts({
    doc,
    stops,
    onPick: (key) => {
      picked = key;
    },
  });
  const { el } = parts;
  const cat = () => port.catalogue?.();

  /**
   * A picture, or the honest gap where one would be.
   *
   * The port paints; this only ever asks. On a build with no renderer `picture`
   * returns nothing and the control is its label alone, which is still a
   * working control — the section degrades to words rather than to a broken grid.
   * @param {any} spec
   */
  function picture(spec) {
    const node = port.picture?.(spec) || null;
    if (node && node.setAttribute) node.setAttribute('aria-hidden', 'true');
    return node;
  }

  const advanced = createAdvanced({
    parts,
    widgets,
    store,
    picture,
    prefs: opts.prefs || port.prefs,
  });

  // ------------------------------------------------------------ the outside

  /**
   * One of the six outside controls, as a row of the sheet.
   *
   * Four of them are words and sit beside their label like every other row on
   * this sheet, and so does the one switch. The sixth is the presets as
   * pictures, and a row of pictures gets the full width under its label.
   *
   * @param {any} host @param {any} control one of `outsideControls(store)`
   */
  function renderOutside(host, control) {
    if (control.kind === 'switch') {
      const toggle = parts.switchControl({
        name: control.id,
        label: control.label,
        checked: control.checked,
        state: control.state,
        onChange: control.onToggle,
      });
      widgets.row(host, control.label, toggle, control.help);
    } else if (control.id === 'preset') {
      const strip = parts.radioGroup({
        name: control.id,
        label: control.label,
        className: 'settings-look-presets',
        itemClass: 'settings-look-preset',
        labelClass: 'settings-look-preset-name',
        options: control.options.map((/** @type {any} */ o) => {
          const shot = picture({
            kind: 'thumbnail',
            look: o.preset.look,
            key: `preset:${o.preset.id}`,
          });
          return { id: o.id, label: o.label, title: o.title, parts: shot ? [shot] : [] };
        }),
        value: control.value,
        onChange: control.onChange,
      });
      const row = widgets.row(host, control.label, strip, control.note);
      row.className += ' settings-row--stack';
    } else {
      const seg = parts.radioGroup({
        name: control.id,
        label: control.label,
        className: 'lookbar-seg settings-look-seg',
        itemClass: 'lookbar-seg-btn',
        options: control.options.map((/** @type {any} */ o) => ({
          id: o.id,
          label: o.label,
          title: o.title,
          parts: o.theme ? [parts.swatchDots(store.swatches(o.theme))] : [],
        })),
        value: control.value,
        onChange: control.onChange,
        // A theme is the one choice whose value cannot be read off a label, so
        // pointing at one paints the window in it and leaving puts it back.
        // It never saves: only a click does.
        onPreview: control.id === 'theme' ? (id) => store.previewTheme(id) : undefined,
      });
      widgets.row(host, control.label, seg, control.help);
    }
    for (const problem of store.refusalsFor(control.id)) {
      host.appendChild(parts.refusalBox(problem, 'settings-look-refusal'));
    }
  }

  /**
   * THE STYLE'S MODIFIERS, side by side under the cards.
   *
   * Everything on the outside after Style is a way of turning the style that
   * was just chosen — calmer, later in the day, a colour per room — and each is
   * three words or a switch. As three more rows they were a third of a screen
   * and pushed the live preview, the one picture that shows what they do, off
   * the bottom of the sheet. So they are one line: a name, a quiet note beside
   * it, the control under it. A reason is drawn in the cell of the control
   * that refused, under that control.
   *
   * The name keeps the sheet's own `settings-label`, because it is a row's name
   * in every sense but the layout.
   *
   * @param {any} host @param {any[]} controls the controls after Style
   */
  function renderModifiers(host, controls) {
    if (!controls.length) return;
    const grid = el('div', 'settings-look-mods');
    for (const control of controls) {
      const cell = el('div', 'settings-look-mod');
      if (control.help) cell.title = control.help;
      const head = el('div', 'settings-look-mod-head');
      head.appendChild(el('span', 'settings-label', control.label));
      if (control.note) head.appendChild(el('span', 'settings-look-mod-note', control.note));
      cell.appendChild(head);
      cell.appendChild(
        control.kind === 'switch'
          ? parts.switchControl({
              name: control.id,
              label: control.label,
              checked: control.checked,
              state: control.state,
              onChange: control.onToggle,
            })
          : parts.radioGroup({
              name: control.id,
              label: control.label,
              className: 'lookbar-seg settings-look-seg',
              itemClass: 'lookbar-seg-btn',
              options: control.options,
              value: control.value,
              onChange: control.onChange,
            }),
      );
      // Said only when the control is somewhere its own options do not name.
      if (control.hint) cell.appendChild(el('p', 'settings-note', control.hint));
      for (const problem of store.refusalsFor(control.id)) {
        cell.appendChild(parts.refusalBox(problem, 'settings-look-refusal'));
      }
      grid.appendChild(cell);
    }
    host.appendChild(grid);
  }

  /** @param {any} host @param {any} current */
  function renderPreview(host, current) {
    const shot = picture({ kind: 'preview', look: current, key: 'preview' });
    if (!shot) return;
    const wrap = el('div', 'settings-look-preview');
    wrap.append(shot, el('p', 'settings-look-caption', 'Live preview'));
    host.appendChild(wrap);
  }

  // --------------------------------------------------------------- the whole

  /** The ids of the rows on the outside, as drawn. */
  const outsideIds = () => outsideControls(store).map((c) => c.id);

  /**
   * Draw the section into the sheet, or draw nothing at all.
   * @param {HTMLElement} host
   * @param {any} [focused] the element that had the keyboard BEFORE the sheet
   *   emptied itself to redraw. The sheet has to say, because by the time this
   *   runs the browser has already moved the focus off a button that is no
   *   longer in the document — `activeElement` is the body by then.
   */
  function renderInto(host, focused = doc.activeElement) {
    const c = cat();
    if (!c) return null;
    // Hear the daemon's last word before drawing — quietly, because this IS the
    // redraw a subscriber would have asked for.
    store.refresh({ silent: true });
    // Which control has the keyboard, before every one of them is replaced.
    let keep = picked;
    picked = '';
    if (!keep && focused) for (const [key, node] of stops) if (node === focused) keep = key;
    stops.clear();

    const current = store.look();
    const s = widgets.section('Look', 'How the office looks. A change applies as you click it.');
    s.id = LOOK_SECTION_ID;
    const outside = outsideControls(store);
    // Up to and including Style, a row each; what follows Style modifies it.
    const style = outside.findIndex((control) => control.id === 'preset');
    const lead = style < 0 ? outside : outside.slice(0, style + 1);
    for (const control of lead) renderOutside(s, control);
    renderModifiers(s, outside.slice(lead.length));
    renderPreview(s, current);
    advanced.renderInto(s, c, current);

    // A refusal nobody's hand caused, naming a row this section does not draw —
    // an imported document, or the daemon refusing on a theme this tab is not
    // painted in. It still has to be READ somewhere, so it is read here rather
    // than dropped: a refusal that changed nothing and said nothing would be
    // indistinguishable from a control that silently did not work.
    const rows = new Set([...outside.map((o) => o.id), ...advanced.rowIds(c)]);
    const refusal = store.refusal();
    if (refusal && !rows.has(refusal.from)) {
      const orphans = refusal.from
        ? refusal.problems
        : refusal.problems.filter((/** @type {any} */ p) => !rows.has(p.picker));
      for (const problem of orphans) {
        s.appendChild(parts.refusalBox(problem, 'settings-look-refusal'));
      }
    }

    host.appendChild(s);
    // The redraw replaced the control the hand was on; put the hand back. Only
    // when it WAS on one of these — a redraw caused by another section's save
    // must not pull the focus down here.
    if (keep) stops.get(keep)?.focus?.({ preventScroll: true });
    return s;
  }

  return {
    renderInto,
    store,
    /** Is the theme one of this section's rows on this build? The sheet's Floor
     *  section keeps its own Theme row only when it is not. */
    drawsTheme: () => Boolean(cat()) && outsideIds().includes('theme'),
    /** The catalogue pickers on the outside — the rest are under Advanced. */
    outsidePickers: OUTSIDE_PICKER_IDS,
    wire: (/** @type {{render:() => void}} */ o) => {
      ({ render } = o);
      // The store says when the look moved — a choice here, the daemon's
      // answer to it, or a push that the header's bar or another tab caused.
      store.subscribe(() => render());
    },
    /**
     * The sheet is opening: start from what the daemon has, with no stale
     * reason on screen and the focus wherever the sheet puts it.
     */
    reset: () => {
      store.clearRefusal();
      store.refresh({ silent: true });
      picked = '';
      stops.clear();
    },
    /** The sheet is closing: a change that was shown is sent, not dropped. */
    flush: () => store.flush(),
    toast,
  };
}
