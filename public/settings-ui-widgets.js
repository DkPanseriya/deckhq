/**
 * The controls the settings sheet is built from (WP-22 follow-up).
 *
 * Split out of `createSettingsUI()` unchanged: a section, a row, a toggle, a
 * number field, a choice, WP-30's theme picker, WP-45's avatar picker, and a
 * read-only value.
 *
 * Every control writes through `save`, which posts the patch and re-renders
 * from the daemon's own answer. None of them writes to `current` itself.
 */

/**
 * The controls take their `onChange` as a parameter, which is why this whole
 * module needs nothing from the sheet but the three theme/avatar lookups and
 * a re-render.
 * @param {{theming: any, shippedThemes: () => any[], applyThemeSetting: (name:string) => string,
 *          availableAvatarSets: () => any[]}} ctx
 */
export function createSettingsWidgets(ctx) {
  const { theming, shippedThemes, applyThemeSetting, availableAvatarSets } = ctx;
  /** Late-bound: the sheet's re-render (docs/DEVIATIONS.md §122, rule 3). */
  let render;

  // ------------------------------------------------------------ small parts

  /** @param {string} title @param {string} [note] */
  function section(title, note) {
    const wrap = document.createElement('section');
    wrap.className = 'settings-section';
    const h3 = document.createElement('h3');
    h3.className = 'settings-heading';
    h3.textContent = title;
    wrap.appendChild(h3);
    if (note) {
      const p = document.createElement('p');
      p.className = 'settings-note';
      p.textContent = note;
      wrap.appendChild(p);
    }
    return wrap;
  }

  /**
   * One labelled row. The label is a real `<label>` bound to its control
   * wherever the control is a native input; toggle rows use a button with
   * `aria-pressed` and carry the label as its accessible name.
   * @param {HTMLElement} host
   * @param {string} label
   * @param {HTMLElement} control
   * @param {string} [note]
   */
  function row(host, label, control, note) {
    const div = document.createElement('div');
    div.className = 'settings-row';
    const text = document.createElement('div');
    text.className = 'settings-row-text';
    const name = document.createElement('span');
    name.className = 'settings-label';
    name.textContent = label;
    text.appendChild(name);
    if (note) {
      const n = document.createElement('span');
      n.className = 'settings-note';
      n.textContent = note;
      text.appendChild(n);
    }
    div.append(text, control);
    host.appendChild(div);
    return div;
  }

  /**
   * @param {string} label the accessible name, since the visible label is a
   *   sibling rather than a wrapper
   * @param {boolean} on
   * @param {(next:boolean) => void} onChange
   */
  function toggle(label, on, onChange) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn settings-toggle';
    btn.setAttribute('aria-pressed', String(on));
    btn.setAttribute('aria-label', label);
    btn.textContent = on ? 'On' : 'Off';
    btn.addEventListener('click', () => onChange(!on));
    return btn;
  }

  /**
   * @param {object} spec
   * @param {string} spec.label
   * @param {number} spec.value
   * @param {number} spec.min
   * @param {number} spec.max
   * @param {string} spec.unit
   * @param {(next:number) => void} spec.onChange
   */
  function numberField(spec) {
    const wrap = document.createElement('div');
    wrap.className = 'settings-number';
    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'field-input';
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = '1';
    input.value = String(spec.value);
    input.setAttribute('aria-label', `${spec.label}, in ${spec.unit}`);
    // 'change', not 'input': one write when the field is done, not one per
    // keystroke, each of which would be clamped and re-rendered under the
    // caret.
    input.addEventListener('change', () => {
      const n = Number(input.value);
      if (!Number.isFinite(n)) return render();
      spec.onChange(Math.min(spec.max, Math.max(spec.min, Math.round(n))));
    });
    const unit = document.createElement('span');
    unit.className = 'settings-unit';
    unit.textContent = spec.unit;
    wrap.append(input, unit);
    return wrap;
  }

  /**
   * A row of `aria-pressed` buttons rather than a `<select>`: a native
   * select's popup is OS-drawn and on several platforms an unavoidable white
   * box, which is the one thing this interface refuses everywhere else.
   * @param {string} label
   * @param {{value:string,label:string}[]} options
   * @param {string} value
   * @param {(next:string) => void} onChange
   */
  function choice(label, options, value, onChange) {
    const group = document.createElement('div');
    group.className = 'picker settings-choice';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', label);
    for (const opt of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'picker-btn';
      btn.setAttribute('aria-pressed', String(opt.value === value));
      btn.textContent = opt.label;
      btn.addEventListener('click', () => {
        if (opt.value !== value) onChange(opt.value);
      });
      group.appendChild(btn);
    }
    return group;
  }

  /**
   * The theme picker (WP-30).
   *
   * A row of `aria-pressed` buttons, like every other choice in this sheet,
   * with two differences that earn their code:
   *
   *   1. **Swatches.** Three dots per theme — the wood, the carpet, the
   *      chrome. Drawn with `element.style`, deliberately NOT with a CSS rule:
   *      `test/unit/state-visuals.test.mjs` holds every `.settings*` rule to
   *      the measured ink and ground sets, and a stylesheet full of theme
   *      colours would either break that test or force it to be relaxed. A
   *      swatch is data, so it is set as data.
   *   2. **Live preview.** Hovering or focusing a theme paints the whole
   *      window in it and leaving puts it back, because a theme is the one
   *      setting whose value you cannot read off a label. Preview NEVER
   *      saves: leaving the sheet, or the row, restores what is stored.
   *
   * @param {string} value the stored theme
   * @param {(next:string) => void} onChange
   */
  function themePicker(value, onChange) {
    const list = shippedThemes();
    const group = document.createElement('div');
    group.className = 'picker settings-choice settings-themes';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Floor theme');

    /** Put the window back on the theme that is actually stored. */
    const restore = () => applyThemeSetting(value);

    for (const theme of list) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'picker-btn settings-theme';
      btn.setAttribute('aria-pressed', String(theme.name === value));
      if (theme.blurb) btn.title = theme.blurb;

      const dots = document.createElement('span');
      dots.className = 'settings-theme-swatch';
      dots.setAttribute('aria-hidden', 'true');
      const colours = theming.swatches(theme) || [];
      for (const colour of colours) {
        const dot = document.createElement('i');
        dot.style.background = colour;
        dots.appendChild(dot);
      }
      const label = document.createElement('span');
      label.textContent = theme.name;
      btn.append(dots, label);

      // Preview on the way in, the stored theme back on the way out. Pointer
      // and keyboard both, so a keyboard user sees the same thing.
      btn.addEventListener('pointerenter', () => applyThemeSetting(theme.name));
      btn.addEventListener('focus', () => applyThemeSetting(theme.name));
      btn.addEventListener('pointerleave', restore);
      btn.addEventListener('blur', restore);
      btn.addEventListener('click', () => {
        if (theme.name !== value) onChange(theme.name);
      });
      group.appendChild(btn);
    }
    // A pointer that leaves the whole group without passing over a button —
    // fast diagonal exits do this — would otherwise leave the preview on.
    group.addEventListener('pointerleave', restore);
    return group;
  }

  /**
   * The avatar-set picker (WP-45).
   *
   * A theme's swatch is three dots because a theme is a building; a set's
   * swatch is its accents, because a set is what the people in it are
   * wearing. There is deliberately NO live preview here, and that is the one
   * way this row differs from the theme row above it: previewing a set would
   * re-roll every face on the floor twice a second as the pointer moved, and
   * a face that flickers is precisely what `appearanceRng`'s fixed draw order
   * exists to prevent. A set is applied when it is chosen.
   *
   * The first row is always "As they come" — the tables DeckHQ ships. It is
   * not a downgrade and it is never taken away: removing the pack that
   * brought a set puts everybody back in it.
   *
   * @param {string} value
   * @param {(next:string) => void} onChange
   */
  function avatarPicker(value, onChange) {
    const group = document.createElement('div');
    group.className = 'picker settings-choice settings-themes';
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Avatar set');

    const options = [
      { name: '', blurb: 'The faces DeckHQ ships.', accents: [] },
      ...availableAvatarSets(),
    ];
    for (const set of options) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'picker-btn settings-theme';
      btn.setAttribute('aria-pressed', String(set.name === value));
      if (set.blurb) btn.title = set.blurb;

      const dots = document.createElement('span');
      dots.className = 'settings-theme-swatch';
      dots.setAttribute('aria-hidden', 'true');
      // Three, like a theme's, so the two rows read as the same kind of
      // control rather than one of them being a colour chart.
      for (const colour of (set.accents || []).slice(0, 3)) {
        const dot = document.createElement('i');
        dot.style.background = colour;
        dots.appendChild(dot);
      }
      const label = document.createElement('span');
      label.textContent = set.name || 'as they come';
      btn.append(dots, label);
      btn.addEventListener('click', () => {
        if (set.name !== value) onChange(set.name);
      });
      group.appendChild(btn);
    }
    return group;
  }

  /** @param {string} text */
  function readOnlyValue(text) {
    const span = document.createElement('span');
    span.className = 'settings-readonly mono';
    span.textContent = text;
    return span;
  }

  return {
    section,
    row,
    toggle,
    numberField,
    choice,
    themePicker,
    avatarPicker,
    readOnlyValue,
    wire: (o) => {
      ({ render } = o);
    },
  };
}
