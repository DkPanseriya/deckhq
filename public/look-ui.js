/**
 * THE LOOK SECTION — WP-88b. `docs/plan/11-LOOK-CONTROL-CENTRE.md` §4, and the
 * mockup at `docs/media/look/control-centre.png`.
 *
 * WP-88a shipped the catalogue, the derivation and the guards and **no UI, by
 * design** (docs/DEVIATIONS.md §175). This is the surface: six preset cards, a
 * live preview with the numbers the guards refused on beneath it, one row per
 * picker in the catalogue, the lounge kit, and export / import.
 *
 * ============================================================================
 * FOUR RULES THIS FILE IS BUILT AROUND
 *
 * 1. **The catalogue is the section.** Every row, every chip and every label
 *    below is read out of `LOOK_PICKERS`; nothing here restates an option.
 *    A package that adds a floor material gets a chip for it and a package that
 *    removes one loses the chip, without anybody editing this file — which is
 *    the same construction the option tables themselves use as an allowlist.
 *
 * 2. **A refusal changes nothing and says why.** A change is measured by
 *    `validateLook` BEFORE it is applied. Refused, it draws a row under the
 *    picker with the guard's own sentence in it, leaves the control exactly
 *    where it was, and posts nothing at all. `validateLayout`'s whole-or-one-
 *    error discipline, applied to a picker.
 *
 * 3. **Nothing here imports the renderer.** `settings-ui.js` must stay
 *    importable under `node --test` (`settings-keys.test.mjs`), and every
 *    import from `render/**` in this product is dynamic and defensive. So the
 *    catalogue, the guard and the painter all arrive through a PORT, exactly as
 *    WP-30's themes and WP-45's avatars do — and that is also what lets
 *    `test/unit/look-ui.test.mjs` hand this the real tables and a DOM stub and
 *    assert the section it builds.
 *
 * 4. **Every control is operable from the keyboard alone.** Each picker is a
 *    real `radiogroup` on a roving tabindex: one Tab stop per group, arrows
 *    inside it, Home and End to the ends. The lounge kit is four `checkbox`es,
 *    which are individually tabbable because a kit is not a choice between four
 *    things. `:focus-visible` is the stylesheet's own ring, unchanged.
 * ============================================================================
 */

/**
 * How long a change waits before it is posted.
 *
 * Arrow keys walk a picker, and a user holding one down would otherwise post —
 * and re-bake the floor behind the sheet — once per option crossed. 140 ms is
 * long enough to swallow a walk and short enough that a single click feels
 * immediate; the chips and the preview move on the keystroke either way,
 * because they read the pending look rather than the stored one.
 *
 * Tests pass 0, which applies synchronously — a debounce is a property of a
 * hand on a keyboard, not of the thing being posted.
 */
export const LOOK_DEBOUNCE_MS = 140;

/** The section's element id, so the palette and the golden can jump to it. */
export const LOOK_SECTION_ID = 'settings-look';

/**
 * The do-nothing port. Absent, or this, means NO LOOK SECTION — the honest
 * answer on a build whose renderer did not load, because there is nothing to
 * paint a swatch with and no guard to refuse with.
 */
export const NO_LOOK = Object.freeze({ catalogue: () => null });

/**
 * A row's one-line character, under its name.
 *
 * COPY, and the only hand-written thing in this file. The options are never
 * hand-written; a picker the catalogue grows and this table does not know falls
 * back to counting its own options, which is true of every picker that will ever
 * exist rather than of the ten that exist today.
 */
const PICKER_NOTES = Object.freeze({
  'floor.office': 'the open floor, and the reception on it',
  'floor.corridor': 'circulation, not decoration',
  'floor.rooms': 'a project room — an agent’s name is read on it',
  'floor.lounge': 'hard floors, soft rugs',
  scheme: 'hue and chroma, never lightness — all three themes still apply on top',
  furniture: 'silhouettes only; footprints and anchors do not move',
  'rug.wool': 'reception and lounge',
  'rug.task': 'project rooms and break-out corners',
  plants: 'a ceiling rather than a quota — a small room never reaches lush',
  props: 'clear floor per free-standing prop; anchored props are furniture',
  agentSize: 'the furniture follows the people; the building does not',
});

/** What each sub-group inside a two-dimensional picker is called. */
const DIMENSION_LABELS = Object.freeze({
  tone: 'Tone',
  pattern: 'Pattern',
  family: 'Family',
  density: 'Density',
});

/** Read `a.b.c` off a look. @param {any} obj @param {string} path */
function at(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

/**
 * A look with one path set — a copy, never a mutation.
 *
 * The look the section is showing is `current.look`, which came from the
 * daemon's own answer; writing into it would make a refused change permanent in
 * the one place the refusal was supposed to leave alone.
 *
 * @param {any} look @param {string} path @param {unknown} value
 */
function withPath(look, path, value) {
  const keys = path.split('.');
  const out = Array.isArray(look) ? look.slice() : { ...look };
  let node = out;
  for (let i = 0; i < keys.length - 1; i++) {
    node[keys[i]] = { ...node[keys[i]] };
    node = node[keys[i]];
  }
  node[keys[keys.length - 1]] = value;
  return out;
}

/**
 * THE DIMENSIONS INSIDE ONE PICKER, derived from the catalogue.
 *
 * Eight of the ten pickers are one choice out of a list. Two are two choices out
 * of one list: a rug is a tone AND a pattern, and the planting is a family AND a
 * density — §1.d and §1.e say so, and `LOOK_PICKERS` carries both dimensions'
 * options in one `options` array because a picker is a ROW, not a variable.
 *
 * The split is by membership in the catalogue's own id tables rather than by a
 * list written here, and `look-ui.test.mjs` asserts that the dimensions of every
 * picker partition that picker's options exactly — so a catalogue that grew a
 * third rug dimension would fail there rather than silently lose a chip.
 *
 * @param {any} picker
 * @param {any} cat the catalogue namespace
 * @returns {Array<{path:string, label:string, ids:ReadonlyArray<string>}>}
 */
export function dimensionsFor(picker, cat) {
  /** @param {string} key @param {ReadonlyArray<string>} ids */
  const dim = (key, ids) => ({
    path: `${picker.path}.${key}`,
    label: DIMENSION_LABELS[/** @type {keyof typeof DIMENSION_LABELS} */ (key)] || key,
    ids: picker.options
      .map((/** @type {any} */ o) => o.id)
      .filter((/** @type {string} */ id) => ids.includes(id)),
  });
  if (picker.id.startsWith('rug.')) {
    return [dim('tone', cat.RUG_TONE_IDS), dim('pattern', cat.RUG_PATTERN_IDS)];
  }
  if (picker.id === 'plants') {
    return [dim('family', cat.PLANT_FAMILY_IDS), dim('density', cat.PLANT_DENSITY_IDS)];
  }
  return [
    {
      path: picker.path,
      label: picker.label,
      ids: picker.options.map((/** @type {any} */ o) => o.id),
    },
  ];
}

/**
 * What a chip for this option should be painted with, or `null` for an option no
 * painter can draw.
 *
 * Three of the eleven groups have no picture and that is deliberate rather than
 * unfinished: a furniture set, a planting density and a prop density are things
 * a 46 x 28 chip cannot show honestly, and a chip that showed *something* for
 * them would be decoration standing where a measurement belongs. They are words,
 * and the preview above shows what they do to a floor.
 *
 * @param {any} picker @param {string} optionId @param {any} look @param {any} cat
 * @returns {{kind:'swatch', look:any, zone:string, rug:string|null, key:string}|null}
 */
export function swatchSpecFor(picker, optionId, look, cat) {
  /** @param {any} next @param {string} zone @param {string|null} rug */
  const spec = (next, zone, rug) => ({
    kind: /** @type {'swatch'} */ ('swatch'),
    look: next,
    zone,
    rug,
    key: `${picker.id}:${optionId}:${zone}:${rug || '-'}:${next.scheme}`,
  });
  if (picker.id.startsWith('floor.')) {
    const zone = picker.id.slice('floor.'.length);
    return spec(withPath(look, picker.path, optionId), zone, null);
  }
  if (picker.id === 'scheme') {
    // The office floor under that scheme: a scheme is a temperature over the
    // floor the user already has, so the honest chip is their own floor in it.
    return spec(withPath(look, 'scheme', optionId), 'office', null);
  }
  if (picker.id.startsWith('rug.')) {
    const role = picker.id.slice('rug.'.length);
    const key = cat.RUG_TONE_IDS.includes(optionId) ? 'tone' : 'pattern';
    const zone = role === 'wool' ? 'office' : 'rooms';
    const next = withPath(look, `${picker.path}.${key}`, optionId);
    // A rug is shown on the floor it actually lies on, which is §1.d's whole
    // finding: a tone means nothing until it has a floor under it.
    return { ...spec(next, zone, role), key: `rug:${role}:${optionId}:${zone}:${next.scheme}` };
  }
  return null;
}

/**
 * Build the Look section.
 *
 * @param {object} opts
 * @param {any} opts.doc                   `document`, or a stub
 * @param {{section:Function, row:Function}} opts.widgets  the sheet's own parts
 * @param {any} opts.look                  the port (see `NO_LOOK`)
 * @param {() => any} opts.getLook         what `settings.look` says
 * @param {(msg:string, o?:any) => void} opts.toast
 * @param {number} [opts.debounceMs]
 */
export function createLookSection(opts) {
  const { doc, widgets, look: port, getLook, toast } = opts;
  const debounceMs = opts.debounceMs ?? LOOK_DEBOUNCE_MS;

  /**
   * The look the section is SHOWING, which is not always the look the daemon has
   * confirmed: a chip moves on the keystroke and the post follows. `null` means
   * "whatever the daemon last said", which is the state after every reconcile.
   * @type {any}
   */
  let pending = null;
  /**
   * The last refusal: the guard's problems, and which control the person was
   * holding when it happened.
   *
   * `from` is what decides WHERE the reason is drawn, and it is not
   * `problem.picker`. A guard names the row a problem BELONGS to — put terrazzo
   * in the office and the problem is the corridor's, because the corridor is the
   * zone that lost its edge — but the control that just refused to move is the
   * office's, and a sentence that appears two rows away from the chip somebody
   * clicked reads as an unrelated complaint. The reason names both zones and
   * both materials, so nothing is lost by putting it where the hand is.
   *
   * `from` is `null` for a refusal nobody's hand caused — an import, or the
   * daemon refusing on a theme this tab is not painted in — and then each
   * problem goes to the row the guard named.
   * @type {{from:string|null, problems:any[]}}
   */
  let refusals = { from: null, problems: [] };
  /** @type {any} */
  let timer = null;
  /** Late-bound: the sheet's re-render. @type {() => void} */
  let render = () => {};

  const cat = () => port.catalogue?.();
  const shown = () => {
    const c = cat();
    return c ? c.normalizeLook(pending ?? getLook()) : null;
  };

  // --------------------------------------------------------------- applying

  /**
   * Measure a candidate, then either show it and post it, or refuse it and
   * change nothing.
   *
   * The order is the whole of rule 2: the guard runs first, on the theme the
   * floor is actually painted in, and only a look that passes is ever shown.
   * @param {any} next
   * @param {string|null} [from] the picker the person was holding, if any
   */
  function choose(next, from = null) {
    const c = cat();
    if (!c) return;
    const verdict = port.validate(next, port.theme());
    if (!verdict.ok) {
      refusals = { from, problems: verdict.problems };
      pending = null;
      render();
      return;
    }
    refusals = { from: null, problems: [] };
    pending = next;
    render();
    if (timer) clearTimeout(timer);
    const post = async () => {
      timer = null;
      const result = await port.apply(next);
      if (!result || result.ok) {
        // The daemon's answer is the authority; drop the optimistic copy and
        // let the next render read what actually landed.
        pending = null;
        render();
        return;
      }
      // Refused by the daemon — which measures against EVERY shipped theme, so
      // this is the look that reads here and would not on night shift. No
      // `from`: the hand that caused it moved some time ago.
      refusals = {
        from: null,
        problems: result.problems?.length
          ? result.problems
          : [{ picker: '', option: '', reason: result.error || 'that look was refused' }],
      };
      pending = null;
      render();
    };
    if (debounceMs <= 0) return void post();
    timer = setTimeout(post, debounceMs);
  }

  // ---------------------------------------------------------------- pieces

  /** @param {string} tag @param {string} [className] */
  const el = (tag, className) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    return node;
  };

  /**
   * A picture, or the honest gap where one would be.
   *
   * The port paints; this only ever asks. On a build with no renderer `picture`
   * returns nothing and the chip is its label alone, which is still a working
   * control — the section degrades to words rather than to a broken grid.
   * @param {any} spec
   */
  function picture(spec) {
    const node = port.picture?.(spec) || null;
    if (node && node.setAttribute) node.setAttribute('aria-hidden', 'true');
    return node;
  }

  /**
   * ONE RADIO GROUP, ON A ROVING TABINDEX.
   *
   * `role="radiogroup"` with `role="radio"` children rather than the sheet's
   * `aria-pressed` buttons, and the difference is the one §4 asks for: a
   * radiogroup is ONE Tab stop with arrows inside it, so a keyboard user crosses
   * this section in eleven stops rather than in fifty-two.
   *
   * @param {object} spec
   * @param {string} spec.label
   * @param {Array<{id:string, label:string, chip?:any}>} spec.options
   * @param {string} spec.value
   * @param {(next:string) => void} spec.onChange
   */
  function radioGroup(spec) {
    const group = el('div', 'picker settings-choice settings-look-chips');
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', spec.label);
    /** @type {any[]} */
    const buttons = [];

    spec.options.forEach((option, index) => {
      const btn = el('button', 'picker-btn settings-look-chip');
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      const on = option.id === spec.value;
      btn.setAttribute('aria-checked', String(on));
      // The roving stop: the chosen chip is the group's Tab stop, and if the
      // look somehow holds an option this group does not offer, the first chip
      // is — a group with no reachable control would be a group off the keyboard.
      btn.setAttribute(
        'tabindex',
        String(on || (index === 0 && !spec.options.some((o) => o.id === spec.value)) ? 0 : -1),
      );
      if (option.chip) btn.appendChild(option.chip);
      const text = el('span', 'settings-look-chip-label');
      text.textContent = option.label;
      btn.appendChild(text);
      btn.addEventListener('click', () => {
        if (option.id !== spec.value) spec.onChange(option.id);
      });
      btn.addEventListener('keydown', (/** @type {any} */ event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        let target = null;
        if (step) target = (index + step + buttons.length) % buttons.length;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = buttons.length - 1;
        if (target === null) return;
        event.preventDefault?.();
        // Move the focus, then the choice: a radiogroup selects as it moves, so
        // the floor follows the arrow key and the debounce swallows the walk.
        buttons[target].focus?.();
        const id = spec.options[target].id;
        if (id !== spec.value) spec.onChange(id);
      });
      buttons.push(btn);
      group.appendChild(btn);
    });
    return group;
  }

  /**
   * The problems that belong under one row, and the ids they were claimed by.
   *
   * With a `from`, EVERY problem goes under the control the hand was on, so a
   * refusal is one row and it is the one the person is looking at. Without one,
   * each problem goes to the row the guard named.
   * @param {string} rowId
   */
  function refusalsFor(rowId) {
    if (refusals.from) return refusals.from === rowId ? refusals.problems : [];
    return refusals.problems.filter((p) => p.picker === rowId);
  }

  /**
   * The guard's sentence, in its own row under the control that caused it.
   * @param {any} problem
   */
  function refusalRow(problem) {
    const box = el('div', 'settings-look-refusal');
    box.setAttribute('role', 'status');
    const dot = el('span', 'settings-look-refusal-dot');
    dot.setAttribute('aria-hidden', 'true');
    const text = el('span', 'settings-look-refusal-text');
    // The guard's own words, plus the one sentence the guard cannot say because
    // it does not know it was a person who asked: nothing happened.
    text.textContent = `${problem.reason}. Nothing was changed.`;
    box.append(dot, text);
    return box;
  }

  // --------------------------------------------------------------- the rows

  /** @param {HTMLElement} host @param {any} c @param {any} current */
  function renderPresets(host, c, current) {
    const strip = el('div', 'settings-look-presets');
    strip.setAttribute('role', 'radiogroup');
    strip.setAttribute('aria-label', 'Preset');
    /** @type {any[]} */
    const cards = [];
    c.PRESETS.forEach((/** @type {any} */ preset, /** @type {number} */ index) => {
      const card = el('button', 'settings-look-preset');
      card.type = 'button';
      card.setAttribute('role', 'radio');
      const on = preset.id === current.preset;
      card.setAttribute('aria-checked', String(on));
      card.setAttribute('tabindex', String(on ? 0 : -1));
      const shot = picture({ kind: 'thumbnail', look: preset.look, key: `preset:${preset.id}` });
      if (shot) card.appendChild(shot);
      const name = el('span', 'settings-look-preset-name');
      name.textContent = preset.label;
      const blurb = el('span', 'settings-look-preset-blurb');
      blurb.textContent = preset.blurb;
      card.append(name, blurb);
      card.addEventListener('click', () => choose(c.lookForPreset(preset.id)));
      card.addEventListener('keydown', (/** @type {any} */ event) => {
        const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        let target = null;
        if (step) target = (index + step + cards.length) % cards.length;
        else if (event.key === 'Home') target = 0;
        else if (event.key === 'End') target = cards.length - 1;
        if (target === null) return;
        event.preventDefault?.();
        cards[target].focus?.();
        choose(c.lookForPreset(c.PRESETS[target].id));
      });
      cards.push(card);
      strip.appendChild(card);
    });
    host.appendChild(strip);
  }

  /** @param {HTMLElement} host @param {any} c @param {any} current */
  function renderState(host, c, current) {
    const line = el('div', 'settings-look-state');
    const preset = c.PRESETS.find((/** @type {any} */ p) => p.id === current.preset);
    const edited = !c.sameLook(current, c.lookForPreset(current.preset));
    const name = el('span', 'settings-look-state-name');
    name.textContent = `${preset ? preset.label : current.preset}${edited ? ' · edited' : ''}`;
    const reset = el('button', 'btn');
    reset.type = 'button';
    reset.textContent = 'Reset to preset';
    if (!edited) reset.setAttribute('disabled', '');
    reset.setAttribute(
      'aria-label',
      `Reset every option to ${preset ? preset.label : current.preset}`,
    );
    reset.addEventListener('click', () => choose(c.lookForPreset(current.preset)));
    line.append(name, reset);
    host.appendChild(line);
  }

  /** @param {HTMLElement} host @param {any} current */
  function renderPreview(host, current) {
    const wrap = el('div', 'settings-look-preview');
    const shot = picture({ kind: 'preview', look: current, key: 'preview' });
    if (shot) wrap.appendChild(shot);
    const metrics = el('p', 'settings-look-metrics mono');
    const measured = port.metrics?.(current, port.theme()) || [];
    metrics.textContent = measured.length
      ? `live preview · ${measured.map((m) => `${m.label} ${m.ratio.toFixed(2)}:1`).join('  ·  ')}`
      : 'live preview';
    wrap.appendChild(metrics);
    host.appendChild(wrap);
  }

  /** @param {HTMLElement} host @param {any} c @param {any} current @param {any} picker */
  function renderPicker(host, c, current, picker) {
    const group = el('div', 'settings-look-group');
    const dimensions = dimensionsFor(picker, c);
    for (const dimension of dimensions) {
      const options = dimension.ids.map((id) => {
        const option = picker.options.find((/** @type {any} */ o) => o.id === id);
        const spec = swatchSpecFor(picker, id, current, c);
        return { id, label: option ? option.label : id, chip: spec ? picture(spec) : null };
      });
      group.appendChild(
        radioGroup({
          label: dimensions.length > 1 ? `${picker.label} — ${dimension.label}` : picker.label,
          options,
          value: String(at(current, dimension.path)),
          onChange: (next) => choose(withPath(current, dimension.path, next), picker.id),
        }),
      );
    }
    const note = PICKER_NOTES[/** @type {keyof typeof PICKER_NOTES} */ (picker.id)];
    // WP-88c. The one row whose note carries a NUMBER, and it is the number
    // `auto` is a rule about: *"auto · 27 live"*. Without it `auto` is a word
    // that has already decided something the user cannot see. `port.live` is
    // absent on a build with no snapshot yet, and then the row is words alone.
    const live = picker.id === 'agentSize' ? port.live?.() : null;
    const count = Number.isFinite(live) ? ` · auto is ${live} live right now` : '';
    widgets.row(
      host,
      picker.label,
      group,
      `${picker.options.length} options${note ? ` · ${note}` : ''}${count}`,
    );
    for (const problem of refusalsFor(picker.id)) host.appendChild(refusalRow(problem));
  }

  /** @param {HTMLElement} host @param {any} c @param {any} current */
  function renderLoungeKit(host, c, current) {
    const group = el('div', 'picker settings-choice settings-look-chips');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Lounge kit');
    for (const bay of c.LOUNGE_KIT_BAYS) {
      const locked = bay === c.LOUNGE_KIT_REQUIRED;
      const btn = el('button', 'picker-btn settings-look-chip settings-look-bay');
      btn.type = 'button';
      btn.setAttribute('role', 'checkbox');
      btn.setAttribute('aria-checked', String(Boolean(current.lounge[bay])));
      btn.setAttribute('tabindex', '0');
      // THE LOCKED BAY IS `aria-disabled`, NOT `disabled`, and the difference is
      // the one thing this row has to get right. A `disabled` button is out of
      // the tab order, so a keyboard user meets a kit of four with three
      // controls in it and no account of the fourth; this one is reachable,
      // announced as checked and unavailable, and the row's own note beside it
      // carries §1.g's reason — *"a lounge with no place to sit is a field
      // again"*. Clicking it does nothing, because there is nothing it could
      // honestly do: `normalizeLook` puts the sitting bay back on whatever a
      // document says, so a post would be a round trip that returned the look
      // it was given and called it a change.
      if (locked) btn.setAttribute('aria-disabled', 'true');
      const text = el('span', 'settings-look-chip-label');
      text.textContent = bay === 'cafe' ? 'café' : bay;
      btn.appendChild(text);
      btn.addEventListener('click', () => {
        if (locked) return;
        choose(withPath(current, `lounge.${bay}`, !current.lounge[bay]), 'lounge');
      });
      group.appendChild(btn);
    }
    widgets.row(
      host,
      'Lounge kit',
      group,
      `${c.LOUNGE_KIT_BAYS.length} bays · sitting is always on — a lounge with nowhere to sit is a field again`,
    );
    for (const problem of refusalsFor('lounge')) host.appendChild(refusalRow(problem));
  }

  /** @param {HTMLElement} host */
  function renderIo(host) {
    const group = el('div', 'settings-look-io');
    const save = el('button', 'btn');
    save.type = 'button';
    save.textContent = 'Export';
    save.setAttribute('aria-label', 'Export this look as a file');
    save.addEventListener('click', () => port.exportLook?.());
    const load = el('button', 'btn');
    load.type = 'button';
    load.textContent = 'Import';
    load.setAttribute('aria-label', 'Import a look from a file');
    load.addEventListener('click', () => port.importLook?.());
    group.append(save, load);
    widgets.row(
      host,
      'This look, as a file',
      group,
      'It names no project, no path and no session — a look is anonymous, so it is a file you ' +
        'can post. A bad one is refused whole and changes nothing.',
    );
  }

  // --------------------------------------------------------------- the whole

  /**
   * Draw the section into the sheet, or draw nothing at all.
   * @param {HTMLElement} host
   */
  function renderInto(host) {
    const c = cat();
    if (!c) return null;
    const current = shown();
    const s = widgets.section(
      'Look',
      'Start from a preset, then change anything. Every combination is measured before it is ' +
        'offered, and one that would leave a rug unreadable on the floor under it is refused ' +
        'with the reason. All three themes still apply on top.',
    );
    s.id = LOOK_SECTION_ID;
    renderPresets(s, c, current);
    renderState(s, c, current);
    renderPreview(s, current);
    const rows = new Set([...c.LOOK_PICKERS.map((/** @type {any} */ p) => p.id), 'lounge']);
    for (const picker of c.LOOK_PICKERS) renderPicker(s, c, current, picker);
    renderLoungeKit(s, c, current);
    // A refusal nobody's hand caused, naming a row this section does not draw —
    // an imported document, or the daemon refusing on a theme this tab is not
    // painted in. It still has to be READ somewhere, so it is read here rather
    // than dropped: a refusal that changed nothing and said nothing would be
    // indistinguishable from a control that silently did not work.
    if (!refusals.from) {
      for (const problem of refusals.problems.filter((p) => !rows.has(p.picker))) {
        s.appendChild(refusalRow(problem));
      }
    }
    renderIo(s);
    // WP-88c. The agent size is a row now — the eleventh picker, drawn by the
    // loop above like every other, because it finally passes this sheet's
    // founding rule: a control ships only if moving it changes something today
    // (docs/DEVIATIONS.md §58, §94). The foot says what a URL can do instead.
    const foot = el('p', 'settings-note settings-look-foot');
    foot.textContent =
      '?look=night-lab and ?scale=large paint one tab and write nothing. Agent size moves the ' +
      'furniture with the people — the corridors, the room padding and every label stay put.';
    s.appendChild(foot);
    host.appendChild(s);
    return s;
  }

  return {
    renderInto,
    wire: (/** @type {{render:() => void}} */ o) => {
      ({ render } = o);
    },
    /** For tests and for the sheet's close: drop an unposted change. */
    reset: () => {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
      refusals = { from: null, problems: [] };
    },
    toast,
  };
}
