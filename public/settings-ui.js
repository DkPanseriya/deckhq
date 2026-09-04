/**
 * DeckHQ settings sheet.
 *
 * docs/plan/05-GUI-UX-SPEC.md §5.4, WP-07. Before this there was no settings
 * surface at all: the stall window, the poll interval, notifications and
 * sound were reachable only by POSTing to `/api/settings` by hand.
 *
 * Opened from the palette (`⌘K` → Settings, or `,`). Six sections — state,
 * notifications, resume, floor, data, hooks — and the hook consent screen is
 * one of them rather than a dialog of its own, because "do I let DeckHQ write
 * to my Claude settings file" is a setting.
 *
 * THE RULE THIS SHEET IS BUILT AROUND: a control ships only if moving it
 * changes something today. The package this file belongs to exists partly to
 * delete a header toggle that wrote a setting nobody read for four months
 * (docs/DEVIATIONS.md §58, §94). Three controls §5.4 lists are therefore
 * absent, each recorded in §94 with the package that owns its reader:
 * "preferred terminal" (the adapter picks the terminal; WP-04), the lounge
 * crowd threshold (the renderer; WP-12), and ledger retention and export
 * (there is no ledger yet; WP-17).
 *
 * Every value the daemon supplies — the state path, a hook's JSON — is
 * written with `textContent`.
 */

/**
 * Exactly the settings keys this sheet and the palette write. Asserted
 * against `DEFAULT_SETTINGS` by test/unit/settings-keys.test.mjs, which is
 * how a key the client writes but the store does not persist gets caught.
 */
export const SETTINGS_KEYS = Object.freeze([
  'stallWindowMs',
  'pollIntervalMs',
  'notifications',
  'notifyHandsUp',
  'notifyForReview',
  'sound',
  'soundVolume',
  'reducedMotion',
  'resumeIn',
  'lightsOutHour',
  'theme',
  'avatarSet',
]);

const MIN_STALL_MIN = 2;
const MAX_STALL_MIN = 120;
const MIN_POLL_S = 1;
const MAX_POLL_S = 60;
/** WP-18. Any hour of the day is legal; the store clamps to this range. */
const MIN_LIGHTS_OUT = 0;
const MAX_LIGHTS_OUT = 23;

const MOTION_LABELS = {
  system: 'Follow the system',
  reduce: 'Always reduce',
  'no-preference': 'Always animate',
};

/**
 * The theming port (WP-30), and its do-nothing default.
 *
 * The themes live in `render/themes.js`, which is a RENDERER module: `app.js`
 * imports every one of those dynamically and defensively, because a build
 * whose renderer failed to load must still show its header, its panel and its
 * settings sheet. This file therefore does not import them at all — it is
 * handed a small port by the composition root instead.
 *
 * That indirection buys a second thing, and it is the one that made it
 * necessary rather than merely tidy: this module stays importable under
 * `node --test`. `test/unit/settings-keys.test.mjs` imports `SETTINGS_KEYS`
 * from here in Node, where there is no `document`, so a static import of
 * anything that touches the DOM at module scope would break that gate.
 *
 * @typedef {object} Theming
 * @property {() => Array<{name:string, blurb?:string}>} list the shipped themes
 * @property {(name:string) => string} apply paint one, and return what landed
 * @property {(theme:any) => string[]} swatches three colours that stand for one
 */
const NO_THEMING = Object.freeze({
  list: () => [],
  apply: (name) => name,
  swatches: () => [],
});

/**
 * The avatar port (WP-45), and its do-nothing default.
 *
 * The same shape and the same reason as `Theming` above: the tables live in
 * `render/palette.js`, this file must stay importable in Node, and a build
 * whose renderer did not load must still show a settings sheet.
 *
 * `list()` returns only the sets an installed pack registered. On an install
 * with no pack it is empty, and the row is not drawn at all — the honest
 * answer, because there is nothing to pick between.
 *
 * @typedef {object} Avatars
 * @property {() => Array<{name:string, blurb?:string, accents:string[], jackets:string[]}>} list
 * @property {(name:string) => string} apply  dress the floor, and return what landed
 * @typedef {Avatars} AvatarsPort
 */
const NO_AVATARS = Object.freeze({
  list: () => [],
  apply: (name) => name,
});

/** How many override rows the editor will draw. The route's own cap. */
const MAX_RATE_ROWS = 200;

/**
 * Apply the motion preference to the document. `system` removes the attribute
 * and lets the `prefers-reduced-motion` media query decide; the two overrides
 * are read by public/style.css, which is why this is a real setting and not a
 * stored intention. docs/plan/05-GUI-UX-SPEC.md §9.
 * @param {string|undefined} mode
 */
export function applyMotionPreference(mode) {
  const root = document.documentElement;
  if (mode === 'reduce' || mode === 'no-preference') root.dataset.motion = mode;
  else delete root.dataset.motion;
}

/**
 * @param {object} opts
 * @param {HTMLDialogElement} opts.dialogEl
 * @param {HTMLElement} opts.bodyEl
 * @param {() => any} opts.getSnapshot
 * @param {(message:string, opts?:{isError?:boolean}) => void} opts.toast
 * @param {{renderInto:(host:HTMLElement)=>void, refresh?:()=>void}} opts.hooks the hook consent
 *   screen, embedded as this sheet's last section.
 * @param {Theming} [opts.theming] WP-30. Absent means no Theme row, which is the
 *   honest answer when the renderer did not load: there is nothing to pick between.
 * @param {Avatars} [opts.avatars] WP-45. Absent, or empty, means no Avatars row —
 *   which is every install that has not got a pack offering a set.
 */
export function createSettingsUI(opts) {
  const { dialogEl, bodyEl, getSnapshot, toast, hooks } = opts;
  const theming = opts.theming || NO_THEMING;
  const avatars = opts.avatars || NO_AVATARS;
  /** @returns {Array<{name:string, blurb?:string}>} */
  const shippedThemes = () => {
    const list = theming.list();
    return Array.isArray(list) ? list : [];
  };
  /** @param {string} name @returns {string} */
  const applyThemeSetting = (name) => theming.apply(name);
  /** @returns {Array<{name:string, blurb?:string, accents:string[], jackets:string[]}>} */
  const availableAvatarSets = () => {
    const list = avatars.list();
    return Array.isArray(list) ? list : [];
  };

  /** @type {Record<string, any>} the settings as last confirmed by the daemon */
  let current = {};
  /** @type {{statePath?:string, rateCardVersion?:string}} */
  let about = {};

  // ------------------------------------------------------------ networking

  /**
   * Write a patch and re-render from the daemon's own answer, never from what
   * we hoped it would be: the store clamps the stall window and the volume,
   * so the control has to show what actually landed.
   * @param {Record<string, unknown>} patch
   */
  async function save(patch) {
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      current = body;
      applyMotionPreference(current.reducedMotion);
      // WP-30. Paint the theme the daemon confirmed, not the one that was
      // clicked: the store is the authority on what was stored, and a preview
      // may currently be on top of a save that was refused.
      applyThemeSetting(current.theme);
      render();
    } catch (err) {
      toast(`Could not save that setting: ${err.message}`, { isError: true });
      render();
    }
  }

  async function loadAbout() {
    try {
      const res = await fetch('/api/about');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      about = await res.json();
    } catch (err) {
      about = {};
      console.debug('[deckhq] could not read /api/about', err);
    }
  }

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

  // --------------------------------------------------------------- sections

  function renderState(host) {
    const s = section(
      'State',
      'How long a silent session waits before DeckHQ calls it stalled, and how often every ' +
        'session is re-read. With hooks installed, state changes arrive the moment they happen ' +
        'and the poll interval barely matters.',
    );
    row(
      s,
      'Stall window',
      numberField({
        label: 'Stall window',
        value: Math.round((current.stallWindowMs ?? 600000) / 60000),
        min: MIN_STALL_MIN,
        max: MAX_STALL_MIN,
        unit: 'minutes',
        onChange: (min) => save({ stallWindowMs: min * 60000 }),
      }),
      `${MIN_STALL_MIN}–${MAX_STALL_MIN} minutes.`,
    );
    row(
      s,
      'Poll interval',
      numberField({
        label: 'Poll interval',
        value: Math.round((current.pollIntervalMs ?? 5000) / 1000),
        min: MIN_POLL_S,
        max: MAX_POLL_S,
        unit: 'seconds',
        onChange: (sec) => save({ pollIntervalMs: sec * 1000 }),
      }),
      `${MIN_POLL_S}–${MAX_POLL_S} seconds. Takes effect at the next daemon start.`,
    );
    host.appendChild(s);
  }

  function renderNotifications(host) {
    const s = section(
      'Notifications',
      'A notification is how DeckHQ reaches you with the tab closed. It fires only when a ' +
        'session enters a state that needs you, never on a refresh, and repeats within ten ' +
        'seconds are coalesced into one.',
    );
    const master = current.notifications !== false;
    row(
      s,
      'Desktop notifications',
      toggle('Desktop notifications', master, (next) => save({ notifications: next })),
    );
    row(
      s,
      'Hands up',
      toggle('Notify on hands up', current.notifyHandsUp !== false, (next) =>
        save({ notifyHandsUp: next }),
      ),
      'A session blocked on a question, mid-task.',
    );
    row(
      s,
      'Finished and waiting',
      toggle('Notify on finished and waiting', current.notifyForReview !== false, (next) =>
        save({ notifyForReview: next }),
      ),
      'A session that finished its turn and is standing in your office.',
    );
    row(
      s,
      'Sounds',
      toggle('Sounds', Boolean(current.sound), (next) => save({ sound: next })),
      'Three, a handful of times a day: a door closing when a session finishes and walks in, ' +
        'two knocks when a hand goes up, and a rising chime when the office clears. ' +
        'Synthesised in the browser — no files, no downloads. Silent while the tab is hidden ' +
        'and the notification has already said it.',
    );

    const volume = document.createElement('input');
    volume.type = 'range';
    volume.className = 'settings-range';
    volume.min = '0';
    volume.max = '100';
    volume.step = '5';
    volume.value = String(Math.round((current.soundVolume ?? 0.3) * 100));
    volume.setAttribute('aria-label', 'Sound volume, percent');
    volume.addEventListener('change', () => save({ soundVolume: Number(volume.value) / 100 }));
    row(s, 'Volume', volume, `${Math.round((current.soundVolume ?? 0.3) * 100)}%`);

    host.appendChild(s);
  }

  function renderResume(host) {
    const s = section(
      'Resume',
      'Where "resume this session" opens. Picking either one in the panel also sets it here.',
    );
    row(
      s,
      'Default target',
      choice(
        'Default resume target',
        [
          { value: 'terminal', label: 'Terminal' },
          { value: 'app', label: 'Desktop app' },
        ],
        current.resumeIn === 'app' ? 'app' : 'terminal',
        (next) => save({ resumeIn: next }),
      ),
      'A terminal always works. The desktop app is offered only when this machine has one.',
    );
    host.appendChild(s);
  }

  function renderFloor(host) {
    const s = section(
      'Floor',
      'The floor animates on purpose — an arrival is the product’s signature moment — but ' +
        'this window can be told to hold still regardless of what the system asks for.',
    );
    // WP-30. Free, and it gates nothing: every theme this build ships is in
    // this row for everybody. The Supporter pack (docs/plan/03 §5) sells MORE
    // themes later; it does not take one away.
    if (shippedThemes().length > 1) {
      row(
        s,
        'Theme',
        themePicker(current.theme || 'default', (next) => save({ theme: next })),
        'Repaints the floor and the window around it. It never touches a state colour — ' +
          'a raised hand is the same amber in every theme, and red still means one thing.',
      );
    }
    // WP-45. Only drawn when an installed pack actually offers a set: a row
    // with one option would be a row that advertises a purchase, and this
    // sheet does not sell anything.
    if (availableAvatarSets().length) {
      row(
        s,
        'Avatars',
        avatarPicker(current.avatarSet || '', (next) => save({ avatarSet: next })),
        'What the agents are wearing. It changes no state colour and no torso — a raised hand ' +
          'is still amber, whoever is wearing what. Choosing “as they come” puts every face back.',
      );
    }
    row(
      s,
      'Motion',
      choice(
        'Motion',
        Object.entries(MOTION_LABELS).map(([value, label]) => ({ value, label })),
        current.reducedMotion || 'system',
        (next) => save({ reducedMotion: next }),
      ),
      'Reduced motion snaps walks to their end, holds one pose per state, and stops the lounge.',
    );
    // WP-18. The one control the daily postcard has, and the only thing about
    // it that is a preference: when the day ends. Whether the card appears at
    // all is not offered as a toggle, because it appears once, it interrupts
    // nothing, and dismissing it costs one keystroke — a switch for that would
    // be a setting for a thing that is already free to ignore.
    row(
      s,
      'Lights out',
      numberField({
        label: 'Lights out hour',
        value: Number.isFinite(Number(current.lightsOutHour)) ? Number(current.lightsOutHour) : 22,
        min: MIN_LIGHTS_OUT,
        max: MAX_LIGHTS_OUT,
        unit: 'o’clock',
        onChange: (hour) => save({ lightsOutHour: hour }),
      }),
      'When the floor dims and the day’s card appears — once a day, at most. It also arrives ' +
        'early if the last live session ends after 18:00. ⌘K → “Today’s card” shows it again.',
    );
    host.appendChild(s);
  }

  function renderData(host) {
    const s = section(
      'Data',
      'Everything DeckHQ keeps is in one file on this machine. Nothing leaves it.',
    );
    row(
      s,
      'State file',
      readOnlyValue(about.statePath || 'unknown'),
      'Your acknowledgements, names and preferences. Set DECKHQ_STATE_DIR to move it.',
    );
    row(
      s,
      'Rate card',
      readOnlyValue(about.rateCardVersion || 'unknown'),
      'The dated list-price table every cost estimate on the floor is computed from. An ' +
        'estimate, never a bill.',
    );
    renderRateEditor(s);
    host.appendChild(s);
  }

  // --------------------------------------------------- the rate-card editor
  //
  // WP-45, and FREE — `src/http/routes/rates.mjs` carries the argument. The
  // short version: `~/.deckhq/rates.json` has existed since WP-26 and anybody
  // can edit it in a text editor, so selling a sheet that edits it would be
  // charging for the removal of an inconvenience we put there. And rule 7 —
  // cost is an estimate, never a bill — only holds if the person looking at a
  // wrong number can correct it.
  //
  // Prices are edited PER MILLION TOKENS in this sheet, whatever `per` the
  // file says, because one unit means one column heading and a table with two
  // scales in it is a table nobody can read. A loaded row quoted per some
  // other unit is converted for display and written back per million; that is
  // arithmetic, not a change of meaning, and it is the only rewriting this
  // editor does.

  /** @type {any} the last `/api/rates` response */
  let rateCard = null;
  /** @type {any[]|null} the rows being edited, kept across re-renders */
  let rateDraft = null;
  /** Has anything been typed since the last load or save? */
  let rateDirty = false;
  /** @type {string} what the last save said, shown under the table */
  let rateStatus = '';

  const PER_MILLION = 1e6;

  /** One override row as the editor holds it: strings, because inputs are. */
  function toDraft(rate) {
    const per = Number(rate.per) > 0 ? Number(rate.per) : PER_MILLION;
    const scale = PER_MILLION / per;
    /** @param {unknown} n */
    const at = (n) =>
      n == null || n === '' ? '' : String(Math.round(Number(n) * scale * 1e6) / 1e6);
    return {
      match: String(rate.match || ''),
      input: at(rate.input),
      output: at(rate.output),
      cacheRead: at(rate.cacheRead),
      cacheWrite: at(rate.cacheWrite),
    };
  }

  async function loadRates() {
    try {
      const res = await fetch('/api/rates');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rateCard = await res.json();
      rateDraft = (rateCard.override.rates || []).map(toDraft);
      rateDirty = false;
    } catch (err) {
      rateCard = null;
      rateDraft = null;
      console.debug('[deckhq] could not read /api/rates', err);
    }
  }

  async function saveRates() {
    const rows = (rateDraft || [])
      // A row with nothing typed in it is not an error, it is a row somebody
      // added and changed their mind about. Dropped, silently, on save.
      .filter((r) => r.match.trim() || r.input.trim() || r.output.trim())
      .map((r) => ({
        match: r.match.trim().toLowerCase(),
        input: r.input.trim() === '' ? null : Number(r.input),
        output: r.output.trim() === '' ? null : Number(r.output),
        cacheRead: r.cacheRead.trim() === '' ? undefined : Number(r.cacheRead),
        cacheWrite: r.cacheWrite.trim() === '' ? undefined : Number(r.cacheWrite),
        per: PER_MILLION,
      }));
    try {
      const res = await fetch('/api/rates', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: rateCard?.override?.version || '', rates: rows }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      rateStatus = body.removed
        ? 'Your overrides were removed. Costs are quoted from the shipped table again.'
        : `Saved. Costs are now quoted from “${body.version}”.`;
      await loadRates();
      // The cost line on the floor and in the panel reads the rate card the
      // daemon holds, and the daemon re-reads the file within a second — so
      // there is nothing to push here, only something to say.
      toast(rateStatus);
      render();
    } catch (err) {
      toast(`That rate card was refused: ${err.message}`, { isError: true });
    }
  }

  /**
   * @param {HTMLElement} host
   */
  function renderRateEditor(host) {
    if (!rateCard) return;
    const wrap = document.createElement('div');
    wrap.className = 'settings-rates';

    const note = document.createElement('p');
    note.className = 'settings-note';
    note.textContent =
      'Your own prices, in US dollars per million tokens. A row here replaces one model’s ' +
      'price and leaves every other one alone; “match” is a model id or the start of one, and ' +
      'the longest match wins. Leave the two cache columns empty to use the published ' +
      'multipliers. This is still an estimate and never a bill.';
    wrap.appendChild(note);

    const path = document.createElement('p');
    path.className = 'settings-note mono';
    path.textContent = rateCard.overrideFile;
    wrap.appendChild(path);

    if (rateCard.override.error) {
      const bad = document.createElement('p');
      bad.className = 'settings-note is-error';
      bad.textContent = `That file could not be read as a rate card (${rateCard.override.error}), so nothing in it is being used. Saving here replaces it.`;
      wrap.appendChild(bad);
    }

    const table = document.createElement('div');
    table.className = 'settings-rate-table';
    table.setAttribute('role', 'group');
    table.setAttribute('aria-label', 'Rate card overrides');

    const head = document.createElement('div');
    head.className = 'settings-rate-row is-head';
    for (const label of ['Model', 'In', 'Out', 'Cache read', 'Cache write', '']) {
      const cell = document.createElement('span');
      cell.textContent = label;
      head.appendChild(cell);
    }
    table.appendChild(head);

    // The shipped table's ids, offered as completions. A user correcting a
    // price almost always wants a model the built-in card already names, and
    // retyping `claude-opus-5` from memory is how a typo becomes a silently
    // unmatched row.
    const list = document.createElement('datalist');
    list.id = 'settings-rate-models';
    for (const rate of rateCard.builtin.rates || []) {
      const opt = document.createElement('option');
      opt.value = rate.match;
      list.appendChild(opt);
    }
    wrap.appendChild(list);

    (rateDraft || []).forEach((draft, i) => {
      const line = document.createElement('div');
      line.className = 'settings-rate-row';

      const match = document.createElement('input');
      match.type = 'text';
      match.className = 'settings-input mono';
      match.value = draft.match;
      match.placeholder = 'claude-opus-5';
      match.setAttribute('aria-label', `Model for row ${i + 1}`);
      match.setAttribute('list', 'settings-rate-models');
      match.addEventListener('input', () => {
        draft.match = match.value;
        rateDirty = true;
      });
      line.appendChild(match);

      for (const key of ['input', 'output', 'cacheRead', 'cacheWrite']) {
        const field = document.createElement('input');
        field.type = 'number';
        field.min = '0';
        field.step = '0.01';
        field.className = 'settings-input';
        field.value = draft[key];
        field.setAttribute('aria-label', `${key} price for row ${i + 1}`);
        if (key === 'cacheRead' || key === 'cacheWrite') {
          const base = Number(draft.input);
          // The placeholder is the number that WILL be used if this is left
          // empty, not a hint: a blank cache column is a real price.
          field.placeholder = Number.isFinite(base)
            ? String(Math.round(base * (key === 'cacheRead' ? 0.1 : 1.25) * 1e4) / 1e4)
            : 'auto';
        }
        field.addEventListener('input', () => {
          draft[key] = field.value;
          rateDirty = true;
        });
        line.appendChild(field);
      }

      const drop = document.createElement('button');
      drop.type = 'button';
      drop.className = 'settings-rate-drop';
      drop.textContent = 'Remove';
      drop.setAttribute('aria-label', `Remove row ${i + 1}`);
      drop.addEventListener('click', () => {
        rateDraft?.splice(i, 1);
        rateDirty = true;
        render();
      });
      line.appendChild(drop);
      table.appendChild(line);
    });

    wrap.appendChild(table);

    const actions = document.createElement('div');
    actions.className = 'settings-rate-actions';

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'settings-btn';
    add.textContent = 'Add a price';
    add.disabled = (rateDraft || []).length >= MAX_RATE_ROWS;
    add.addEventListener('click', () => {
      rateDraft = rateDraft || [];
      rateDraft.push({ match: '', input: '', output: '', cacheRead: '', cacheWrite: '' });
      rateDirty = true;
      render();
    });

    const save = document.createElement('button');
    save.type = 'button';
    save.className = 'settings-btn is-primary';
    save.textContent = rateDirty ? 'Save prices' : 'Saved';
    save.disabled = !rateDirty;
    save.addEventListener('click', () => saveRates());

    actions.append(add, save);
    wrap.appendChild(actions);

    if (rateCard.overridden) {
      const state = document.createElement('p');
      state.className = 'settings-note';
      state.textContent = `Every cost on the floor is currently quoted from “${rateCard.version}”.`;
      wrap.appendChild(state);
    }

    host.appendChild(wrap);
  }

  /**
   * The hook consent screen, built once and re-appended rather than rebuilt:
   * it fetches `/api/hooks` for itself, and every save in a section above it
   * re-renders this sheet. Rebuilding it would flash "Loading…" over the
   * install button because the poll interval changed.
   * @type {HTMLElement|null}
   */
  let hooksSection = null;

  function renderHooks(host) {
    if (!hooksSection) {
      hooksSection = section('Hooks');
      hooksSection.id = 'settings-hooks';
      const mount = document.createElement('div');
      mount.className = 'settings-hooks';
      hooksSection.appendChild(mount);
      // The consent screen renders itself, verbatim file path and JSON block
      // included. It is the same component the degraded banner used to open
      // as a dialog of its own.
      hooks.renderInto(mount);
    }
    host.appendChild(hooksSection);
  }

  function render() {
    bodyEl.textContent = '';
    renderState(bodyEl);
    renderNotifications(bodyEl);
    renderResume(bodyEl);
    renderFloor(bodyEl);
    renderData(bodyEl);
    renderHooks(bodyEl);
  }

  /**
   * @param {'hooks'|null} [focusSection] jump straight to one section, which
   *   is how the palette's "Install hooks" and the degraded banner arrive.
   */
  async function open(focusSection = null) {
    current = { ...(getSnapshot()?.settings || {}) };
    render();
    // Hook status is a live fact — installed, wrong port, events arriving —
    // so it is re-read every time the sheet opens, not once per page load.
    hooks.refresh?.();
    if (typeof dialogEl.showModal === 'function') dialogEl.showModal();
    else dialogEl.setAttribute('open', '');
    if (focusSection === 'hooks') {
      const target = document.getElementById('settings-hooks');
      target?.scrollIntoView({ block: 'start' });
    }
    // Both are facts about disk, both are wanted by the same section, and
    // neither is worth a second round trip's latency in series.
    await Promise.all([loadAbout(), loadRates()]);
    if (dialogEl.open) {
      render();
      if (focusSection === 'hooks') document.getElementById('settings-hooks')?.scrollIntoView();
    }
  }

  function close() {
    dialogEl.close();
  }

  // Whatever a preview left on screen, the stored theme is what the window
  // wears once the sheet is gone. Bound once, on the dialog itself, so it
  // catches Escape and the backdrop as well as the close button — `render()`
  // rebuilds the picker's buttons and would drop a listener bound to one.
  dialogEl.addEventListener('close', () => applyThemeSetting(current.theme));

  return { open, close, isOpen: () => dialogEl.open };
}
