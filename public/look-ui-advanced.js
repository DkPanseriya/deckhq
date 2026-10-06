/**
 * ADVANCED — everything fine-grained about a look, behind one disclosure.
 *
 * The owner, looking at the Look section: *"there are too many options for many
 * details like plants, rug, corridor etc. Hide them under advanced or
 * tailor-made options. Keep high-level abstract settings like agent size, theme,
 * etc. on the outside."* The section drew eleven rows of chips and a lounge kit
 * under six cards and a preview, and every one of them was the same size and
 * the same weight as "make the agents bigger".
 *
 * So the outside of the section is four controls (`look-ui-parts.js`), and this
 * is the inside: every catalogue picker that is not on the outside, under three
 * headings, in a `<details>` that is SHUT until somebody opens it and stays the
 * way they left it.
 *
 * ============================================================================
 * THREE RULES
 *
 * 1. **The catalogue is the list.** Which pickers are in here, and under which
 *    heading, is `advancedGroups(catalogue)` — a rule over the picker's id, not
 *    a list of ids. A picker the catalogue grows lands under a heading without
 *    anybody editing this file, and `look-ui.test.mjs` asserts that the outside
 *    and the inside together are exactly `LOOK_PICKERS`.
 *
 * 2. **Shut by default, and it says what is in it.** A closed disclosure that
 *    only says "Advanced" hides whether anything in it was ever changed, so its
 *    summary line counts: *"Advanced — 2 changes from Studio oak"*.
 *
 * 3. **A reason is never drawn where nobody can read it.** A refusal whose row
 *    is in here opens the disclosure and the heading it is under for that draw,
 *    whatever was remembered.
 *
 * Real `<details>` and `<summary>`: the browser gives them the keyboard, the
 * expanded state and the announcement, and there is nothing here to get wrong.
 * ============================================================================
 */

import { ADVANCED_GROUPS, advancedGroups, at, withPath } from './look-ui-store.js';

/**
 * A row's one line of help, under its name.
 *
 * COPY, and the only hand-written thing in this file — the options never are.
 * A row is given a line only where the choice does not explain itself; a picker
 * with no entry here simply has none.
 */
const PICKER_NOTES = Object.freeze({
  'floor.office': 'The open floor and reception.',
  'floor.rooms': 'Inside each project room.',
  scheme: 'A colour wash over the floors. Your theme still applies on top.',
  'rug.wool': 'In reception and the lounge.',
  'rug.task': 'In project rooms and break-out corners.',
  plants: 'Density is an upper limit — a small room takes fewer.',
  props: 'Free-standing decoration only. Desks, shelves and boards stay.',
});

/** What each sub-group inside a two-dimensional picker is called. */
const DIMENSION_LABELS = Object.freeze({
  tone: 'Tone',
  pattern: 'Pattern',
  family: 'Family',
  density: 'Density',
});

/** The lounge kit's row id — it is not a catalogue picker (§1.g). */
export const LOUNGE_ROW = 'lounge';

/**
 * THE DIMENSIONS INSIDE ONE PICKER, derived from the catalogue.
 *
 * Most pickers are one choice out of a list. Two are two choices out of one
 * list: a rug is a tone AND a pattern, and the planting is a family AND a
 * density — `LOOK_PICKERS` carries both dimensions' options in one `options`
 * array because a picker is a ROW, not a variable.
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
 * The accessible name of one dimension's radio group: the picker's own label,
 * and the dimension's when there is more than one.
 * @param {any} picker @param {{label:string}} dimension @param {number} count
 */
export const groupLabel = (picker, dimension, count) =>
  count > 1 ? `${picker.label} — ${dimension.label}` : picker.label;

/**
 * What a chip for this option should be painted with, or `null` for an option no
 * painter can draw.
 *
 * Some groups have no picture and that is deliberate rather than unfinished: a
 * furniture set, a planting density, a prop density and an agent size are things
 * a 46 x 28 chip cannot show honestly, and a chip that showed *something* for
 * them would be decoration standing where a measurement belongs. They are words,
 * and the preview shows what they do to a floor.
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
    // A rug is shown on the floor it actually lies on: a tone means nothing
    // until it has a floor under it.
    return { ...spec(next, zone, role), key: `rug:${role}:${optionId}:${zone}:${next.scheme}` };
  }
  return null;
}

/** `2 changes` / `1 change`. @param {number} n */
const changes = (n) => `${n} change${n === 1 ? '' : 's'}`;

/**
 * @param {object} ctx
 * @param {any} ctx.parts               `createLookParts`' own answer
 * @param {{row:Function}} ctx.widgets   the sheet's own row
 * @param {any} ctx.store                the look store
 * @param {(spec:any) => any} ctx.picture  a painted canvas, or null
 * @param {{get?:(key:string) => string|null, set?:(key:string, value:string) => void}} [ctx.prefs]
 *   what this browser remembers about which disclosures are open
 */
export function createAdvanced(ctx) {
  const { parts, widgets, store, picture } = ctx;
  const { el } = parts;
  const port = store.port;
  const prefs = ctx.prefs || {};

  /**
   * Which disclosures are open, as this tab last saw them. The sheet redraws
   * whole on every choice, so a `<details>` cannot be trusted to remember its
   * own state — the one on screen is replaced several times a minute.
   * @type {Map<string, boolean>}
   */
  const open = new Map();

  /** @param {string} key @param {boolean} fallback */
  function isOpen(key, fallback) {
    if (open.has(key)) return Boolean(open.get(key));
    let stored = null;
    try {
      stored = prefs.get?.(key) ?? null;
    } catch {
      stored = null; // a browser that refuses storage simply remembers nothing
    }
    return stored === 'open' ? true : stored === 'closed' ? false : fallback;
  }

  /** @param {string} key @param {boolean} value */
  function remember(key, value) {
    open.set(key, value);
    try {
      prefs.set?.(key, value ? 'open' : 'closed');
    } catch {
      // nothing to do: it is remembered for this tab, in `open`
    }
  }

  /**
   * One `<details>`, with a two-part summary: its name, and a quieter note.
   *
   * `force` opens it for this draw without remembering that it did — a reason
   * has to be readable, but a refusal is not the person choosing to keep the
   * disclosure open.
   *
   * @param {string} key @param {boolean} fallback @param {string} className
   * @param {string} name @param {string} note @param {boolean} force
   */
  function disclosure(key, fallback, className, name, note, force) {
    const details = el('details', className);
    const shown = force || isOpen(key, fallback);
    details.open = shown;
    const summary = el('summary', `${className}-summary`);
    summary.append(
      el('span', `${className}-name`, name),
      el('span', `${className}-note`, note ? ` — ${note}` : ''),
    );
    parts.stop(`summary:${key}`, summary);
    details.appendChild(summary);
    // The browser fires `toggle` for the state this was BUILT with as well as
    // for a click, so only a state that differs from the one drawn is the
    // person's — and a forced-open disclosure reports nothing at all.
    let drawn = shown;
    details.addEventListener('toggle', () => {
      const now = Boolean(details.open);
      if (now === drawn) return;
      drawn = now;
      remember(key, now);
    });
    return details;
  }

  /** Does this picker's row have a reason under it right now? @param {string} rowId */
  const refused = (rowId) => store.refusalsFor(rowId).length > 0;

  /** @param {any} host @param {string} rowId */
  function drawRefusals(host, rowId) {
    for (const problem of store.refusalsFor(rowId)) {
      host.appendChild(parts.refusalBox(problem, 'settings-look-refusal'));
    }
  }

  /** @param {any} host @param {any} c @param {any} current @param {any} picker */
  function renderPicker(host, c, current, picker) {
    const group = el('div', 'settings-look-group');
    const dimensions = dimensionsFor(picker, c);
    for (const dimension of dimensions) {
      const options = dimension.ids.map((id) => {
        const option = picker.options.find((/** @type {any} */ o) => o.id === id);
        const spec = swatchSpecFor(picker, id, current, c);
        const chip = spec ? picture(spec) : null;
        return { id, label: option ? option.label : id, parts: chip ? [chip] : [] };
      });
      const label = groupLabel(picker, dimension, dimensions.length);
      // Pictures get the chip grid; words get the segmented control the outside
      // of the section uses, because a word in a 4.9rem picture frame is a
      // picture frame with nothing in it.
      const pictured = options.some((o) => o.parts.length > 0);
      const radios = parts.radioGroup({
        name: label,
        label,
        className: pictured ? 'picker settings-choice settings-look-chips' : 'lookbar-seg',
        itemClass: pictured ? 'picker-btn settings-look-chip' : 'lookbar-seg-btn',
        labelClass: pictured ? 'settings-look-chip-label' : 'lookbar-item-label',
        options,
        value: String(at(current, dimension.path)),
        onChange: (next) => void store.choosePath(dimension.path, next, picker.id),
      });
      if (dimensions.length > 1) {
        const dim = el('div', 'settings-look-dim');
        dim.append(el('span', 'settings-look-dim-name', dimension.label), radios);
        group.appendChild(dim);
      } else {
        group.appendChild(radios);
      }
    }
    const note = PICKER_NOTES[/** @type {keyof typeof PICKER_NOTES} */ (picker.id)];
    const row = widgets.row(host, picker.label, group, note);
    row.className += ' settings-row--stack';
    drawRefusals(host, picker.id);
  }

  /** @param {any} host @param {any} c @param {any} current */
  function renderLoungeKit(host, c, current) {
    const group = el('div', 'picker settings-choice settings-look-chips settings-look-bays');
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
      // announced as checked and unavailable, and the row's note carries the
      // reason. Clicking it does nothing, because there is nothing it could
      // honestly do: `normalizeLook` puts the sitting bay back on whatever a
      // document says.
      if (locked) btn.setAttribute('aria-disabled', 'true');
      const name = bay === 'cafe' ? 'café' : bay;
      btn.appendChild(
        el('span', 'settings-look-chip-label', `${name[0].toUpperCase()}${name.slice(1)}`),
      );
      const key = `bay:${bay}`;
      btn.addEventListener('click', () => {
        if (locked) return;
        parts.picked(key);
        void store.choosePath(`lounge.${bay}`, !current.lounge[bay], LOUNGE_ROW);
      });
      parts.stop(key, btn);
      group.appendChild(btn);
    }
    const row = widgets.row(
      host,
      'Lounge kit',
      group,
      'Which corners the lounge has. Sitting is always on.',
    );
    row.className += ' settings-row--stack';
    drawRefusals(host, LOUNGE_ROW);
  }

  /** @param {any} host */
  function renderIo(host) {
    const group = el('div', 'settings-look-io');
    const save = el('button', 'btn', 'Export');
    save.type = 'button';
    save.setAttribute('aria-label', 'Export this look as a file');
    save.addEventListener('click', () => port.exportLook?.());
    const load = el('button', 'btn', 'Import');
    load.type = 'button';
    load.setAttribute('aria-label', 'Import a look from a file');
    load.addEventListener('click', () => port.importLook?.());
    group.append(parts.stop('io:export', save), parts.stop('io:import', load));
    widgets.row(
      host,
      'Save or load this look',
      group,
      'A look file names no project, path or session, so it is safe to share. ' +
        'A file that does not fit is refused whole and changes nothing.',
    );
  }

  /**
   * Every row id this disclosure draws — the picker ids and the lounge kit —
   * so the section can tell a refusal that has a row from one that has not.
   * @param {any} c
   * @returns {string[]}
   */
  function rowIds(c) {
    return [
      ...advancedGroups(c).flatMap((g) => g.pickers.map((/** @type {any} */ p) => p.id)),
      LOUNGE_ROW,
    ];
  }

  /**
   * How many of the changed options are one group's. A group owns the paths of
   * its pickers, and the furniture group owns the lounge kit as well.
   * @param {{id:string, pickers:any[]}} group @param {string[]} paths
   */
  function changedIn(group, paths) {
    const owns = group.pickers.map((/** @type {any} */ p) => p.path);
    if (group.id === 'furniture') owns.push(LOUNGE_ROW);
    return paths.filter((path) => owns.some((o) => path === o || path.startsWith(`${o}.`))).length;
  }

  /**
   * Draw the disclosure under the section's outside controls.
   * @param {any} host @param {any} c @param {any} current
   */
  function renderInto(host, c, current) {
    const groups = advancedGroups(c);
    const paths = store.changedPaths();
    const preset = store.presetLabel();
    /** @param {{id:string, pickers:any[]}} g */
    const groupRefused = (g) =>
      g.pickers.some((/** @type {any} */ p) => refused(p.id)) ||
      (g.id === 'furniture' && refused(LOUNGE_ROW));

    const details = disclosure(
      'advanced',
      false,
      'settings-look-advanced',
      'Advanced',
      paths.length ? `${changes(paths.length)} from ${preset}` : `no changes from ${preset}`,
      groups.some(groupRefused),
    );
    const body = el('div', 'settings-look-advanced-body');

    // What is in here, and the one way back out of it.
    const head = el('div', 'settings-look-state');
    head.appendChild(
      el('span', 'settings-note', 'Every floor, fabric and plant, one choice at a time.'),
    );
    const reset = el('button', 'btn', 'Reset to preset');
    reset.type = 'button';
    if (!paths.length) reset.setAttribute('disabled', '');
    reset.setAttribute('aria-label', `Reset every option to ${preset}`);
    reset.addEventListener('click', () => {
      parts.picked('reset');
      void store.resetStyle();
    });
    head.appendChild(parts.stop('reset', reset));
    body.appendChild(head);

    for (const group of groups) {
      const n = changedIn(group, paths);
      const sub = disclosure(
        `group.${group.id}`,
        true,
        'settings-look-sub',
        group.label,
        n ? `${changes(n)}` : '',
        groupRefused(group),
      );
      const inner = el('div', 'settings-look-sub-body');
      for (const picker of group.pickers) renderPicker(inner, c, current, picker);
      if (group.id === 'furniture') renderLoungeKit(inner, c, current);
      sub.appendChild(inner);
      body.appendChild(sub);
    }

    renderIo(body);

    // The numbers the guard refuses on, for whoever wants them: a detail, and
    // so in here rather than under the preview.
    const measured = port.metrics?.(current, port.theme?.()) || [];
    if (measured.length) {
      body.appendChild(
        el(
          'p',
          'settings-look-metrics mono',
          `measured contrast · ${measured
            .map((/** @type {any} */ m) => `${m.label} ${m.ratio.toFixed(2)}:1`)
            .join('  ·  ')}`,
        ),
      );
    }
    body.appendChild(
      el(
        'p',
        'settings-note settings-look-foot',
        'To try a look in one tab without saving it, add ?look=night-lab or ?scale=large ' +
          'to the address.',
      ),
    );
    details.appendChild(body);
    host.appendChild(details);
    return details;
  }

  return { renderInto, rowIds, headings: ADVANCED_GROUPS };
}
