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
 * (docs/DEVIATIONS.md §58, §88). Three controls §5.4 lists are therefore
 * absent, each recorded in §88 with the package that owns its reader:
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
]);

const MIN_STALL_MIN = 2;
const MAX_STALL_MIN = 120;
const MIN_POLL_S = 1;
const MAX_POLL_S = 60;

const MOTION_LABELS = {
  system: 'Follow the system',
  reduce: 'Always reduce',
  'no-preference': 'Always animate',
};

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
 * @param {{renderInto:(host:HTMLElement)=>void}} opts.hooks the hook consent
 *   screen, embedded as this sheet's last section.
 */
export function createSettingsUI(opts) {
  const { dialogEl, bodyEl, getSnapshot, toast, hooks } = opts;

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
      'Stored now; the three office sounds are synthesised by their own package and no sound ' +
        'plays yet.',
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
    host.appendChild(s);
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
    await loadAbout();
    if (dialogEl.open) {
      render();
      if (focusSection === 'hooks') document.getElementById('settings-hooks')?.scrollIntoView();
    }
  }

  function close() {
    dialogEl.close();
  }

  return { open, close, isOpen: () => dialogEl.open };
}
