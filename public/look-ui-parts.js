/**
 * THE PARTS BOTH LOOK SURFACES ARE BUILT FROM.
 *
 * The settings sheet's Look section and the header's Look bar draw the same
 * four controls — agent size, theme, style, density — and until this file each
 * had its own radio group, its own refusal row and its own idea of where the
 * keyboard was after a redraw. Two copies of a control is how the two surfaces
 * came to behave differently; this is the one copy.
 *
 * Nothing here knows what a look is. It takes a `document`, a map to register
 * controls in, and a callback for "a hand just used this one".
 *
 * Every string that reaches the page goes through `textContent`.
 */

/**
 * @param {object} ctx
 * @param {any} ctx.doc                 `document`, or a stub
 * @param {Map<string, any>} ctx.stops  every control as drawn, by key — what a
 *   surface uses to put the keyboard back after it redraws
 * @param {(key:string) => void} ctx.onPick  a hand just used the control `key`
 */
export function createLookParts(ctx) {
  const { doc, stops, onPick } = ctx;

  /** @param {string} tag @param {string} [className] @param {string} [text] */
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /**
   * Register a control under a key, so a redraw can find the one that replaced
   * it. @param {string} key @param {any} node
   */
  const stop = (key, node) => {
    stops.set(key, node);
    return node;
  };

  /**
   * ONE RADIO GROUP, ON A ROVING TABINDEX.
   *
   * `role="radiogroup"` with `role="radio"` children: ONE Tab stop with arrows
   * inside it, Home and End to the ends. It selects as it moves — the floor
   * follows the arrow key, and the store's debounce is what keeps a held arrow
   * from re-baking it once per option crossed.
   *
   * A group whose value is none of its options (a density set apart under
   * Advanced, say) has nothing checked, and its first option is the Tab stop —
   * a group with no reachable control would be a group off the keyboard.
   *
   * @param {object} spec
   * @param {string} spec.name       the group's key, for focus across a redraw
   * @param {string} spec.label      its accessible name
   * @param {string} spec.className
   * @param {string} spec.itemClass
   * @param {string} [spec.labelClass]
   * @param {Array<{id:string, label:string, title?:string, parts?:any[]}>} spec.options
   * @param {string} spec.value
   * @param {(next:string) => void} spec.onChange
   * @param {(id:string|null) => void} [spec.onPreview] show an option without
   *   choosing it while the pointer is over it; `null` when it leaves
   */
  function radioGroup(spec) {
    const group = el('div', spec.className);
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', spec.label);
    const known = spec.options.some((o) => o.id === spec.value);
    /** @type {any[]} */
    const buttons = [];
    /** @param {number} index */
    const pick = (index) => {
      const id = spec.options[index].id;
      onPick(`${spec.name}:${id}`);
      if (id !== spec.value) spec.onChange(id);
    };
    spec.options.forEach((option, index) => {
      const btn = el('button', spec.itemClass);
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      const on = option.id === spec.value;
      btn.setAttribute('aria-checked', String(on));
      btn.setAttribute('tabindex', String(on || (index === 0 && !known) ? 0 : -1));
      if (option.title) btn.title = option.title;
      for (const part of option.parts || []) btn.appendChild(part);
      btn.appendChild(el('span', spec.labelClass || 'lookbar-item-label', option.label));
      btn.addEventListener('click', () => pick(index));
      btn.addEventListener('keydown', (/** @type {any} */ event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        let target = null;
        if (step) target = (index + step + buttons.length) % buttons.length;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = buttons.length - 1;
        if (target === null) return;
        event.preventDefault?.();
        buttons[target].focus?.();
        pick(target);
      });
      if (spec.onPreview) {
        btn.addEventListener('pointerenter', () => spec.onPreview?.(option.id));
      }
      stop(`${spec.name}:${option.id}`, btn);
      buttons.push(btn);
      group.appendChild(btn);
    });
    // On the group, not on each button: a fast diagonal exit can leave the
    // group without ever crossing out of a button.
    if (spec.onPreview) group.addEventListener('pointerleave', () => spec.onPreview?.(null));
    return group;
  }

  /**
   * The guard's sentence, in a box under the control that caused it.
   *
   * The guard's own words, plus the one sentence it cannot say because it does
   * not know a person asked: nothing happened.
   * @param {any} problem @param {string} className `settings-look-refusal` or `lookbar-refusal`
   */
  function refusalBox(problem, className) {
    const box = el('div', className);
    box.setAttribute('role', 'status');
    const dot = el('span', `${className}-dot`);
    dot.setAttribute('aria-hidden', 'true');
    box.append(dot, el('span', `${className}-text`, `${problem.reason}. Nothing was changed.`));
    return box;
  }

  /**
   * A theme's three colours as dots: the wood, the carpet, the chrome. Set as
   * data with `style` — a theme's colours are not the stylesheet's to declare.
   * @param {string[]} colours
   */
  function swatchDots(colours) {
    const dots = el('span', 'lookbar-swatch');
    dots.setAttribute('aria-hidden', 'true');
    for (const colour of colours) {
      const dot = el('i');
      dot.style.background = colour;
      dots.appendChild(dot);
    }
    return dots;
  }

  return { el, stop, picked: onPick, radioGroup, refusalBox, swatchDots };
}

/** `night shift` → `Night shift`: a theme's name, as a label beside "Small". */
export const sentence = (/** @type {string} */ s) => (s ? `${s[0].toUpperCase()}${s.slice(1)}` : s);

/**
 * THE FOUR CONTROLS ON THE OUTSIDE, as data — what each surface then draws in
 * its own classes. One list, so the sheet and the bar cannot offer different
 * things or word them differently.
 *
 * Agent size, theme, style, density: the choices somebody arrives already
 * knowing they want. Everything finer is under Advanced, in the sheet.
 *
 * @param {any} store the look store
 * `note` is a few words for beside the label; `help` is the sentence the sheet
 * has room for, and is empty wherever the choice explains itself.
 *
 * @returns {Array<{id:string, label:string, note:string, help:string, value:string,
 *   options:Array<{id:string, label:string, title?:string, theme?:any, preset?:any}>,
 *   onChange:(next:string) => void}>}
 */
export function outsideControls(store) {
  const c = store.catalogue();
  /** @type {any[]} */
  const out = [];
  const look = c ? store.look() : null;
  if (c) {
    const size = (c.LOOK_PICKERS || []).find((/** @type {any} */ p) => p.id === 'agentSize');
    if (size) {
      const live = store.port.live?.();
      out.push({
        id: 'agentSize',
        label: size.label,
        note: Number.isFinite(live) ? `${live} on the floor` : '',
        // The one outside control with a word that needs explaining: `Auto` has
        // already decided something, and without the count nobody can see what.
        help: Number.isFinite(live)
          ? `Auto picks a size that fits everyone — ${live} on the floor now.`
          : 'Auto picks a size that fits everyone on the floor.',
        value: String(look.agentSize),
        options: size.options.map((/** @type {any} */ o) => ({ id: o.id, label: o.label })),
        onChange: (/** @type {string} */ next) =>
          void store.choosePath('agentSize', next, 'agentSize'),
      });
    }
  }
  const themes = store.themes();
  if (themes.length > 1) {
    out.push({
      id: 'theme',
      label: 'Theme',
      note: '',
      help: '',
      value: store.theme(),
      options: themes.map((/** @type {any} */ theme) => ({
        id: theme.name,
        label: sentence(theme.name),
        title: theme.blurb,
        theme,
      })),
      onChange: (/** @type {string} */ next) => void store.chooseTheme(next),
    });
  }
  if (c && (c.PRESETS || []).length) {
    out.push({
      id: 'preset',
      label: 'Style',
      note: `${store.presetLabel()}${store.styleEdited() ? ' · edited' : ''}`,
      help: '',
      value: String(look.preset),
      options: c.PRESETS.map((/** @type {any} */ preset) => ({
        id: preset.id,
        label: preset.label,
        title: preset.blurb,
        preset,
      })),
      onChange: (/** @type {string} */ next) => void store.choosePreset(next),
    });
  }
  const levels = c ? store.densityLevels() : [];
  if (levels.length) {
    const value = store.density();
    out.push({
      id: 'density',
      label: 'Density',
      note: value ? 'plants and props' : 'custom',
      help: value
        ? 'How many plants and props.'
        : 'Plants and props are set separately, under Advanced.',
      value,
      options: levels.map((/** @type {any} */ l) => ({ id: l.id, label: l.label })),
      onChange: (/** @type {string} */ next) => void store.chooseDensity(next),
    });
  }
  return out;
}
