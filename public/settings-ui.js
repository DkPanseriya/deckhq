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
 *
 * ============================================================================
 * WP-22 follow-up · this file is the sheet itself: the one write path, the
 * section order, and open/close. Three modules carry the rest:
 *
 *   settings-ui-state.js    the settings the daemon confirmed, and /api/about
 *   settings-ui-widgets.js  the controls: section, row, toggle, number,
 *                           choice, theme picker, avatar picker
 *   settings-ui-rates.js    WP-45's rate-card editor
 * ============================================================================
 */

import { current, about, setCurrent, setAbout } from './settings-ui-state.js';
import { createSettingsWidgets } from './settings-ui-widgets.js';
import { createRatesSection } from './settings-ui-rates.js';

export { current, about } from './settings-ui-state.js';

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

export const MIN_STALL_MIN = 2;
export const MAX_STALL_MIN = 120;
export const MIN_POLL_S = 1;
export const MAX_POLL_S = 60;
/** WP-18. Any hour of the day is legal; the store clamps to this range. */
export const MIN_LIGHTS_OUT = 0;
export const MAX_LIGHTS_OUT = 23;

export const MOTION_LABELS = {
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
export const NO_THEMING = Object.freeze({
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
export const NO_AVATARS = Object.freeze({
  list: () => [],
  apply: (name) => name,
});

/** How many override rows the editor will draw. The route's own cap. */
export const MAX_RATE_ROWS = 200;

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
      setCurrent(body);
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
      setAbout(await res.json());
    } catch (err) {
      setAbout({});
      console.debug('[deckhq] could not read /api/about', err);
    }
  }

  // ------------------------------------------------------------ small parts

  const widgets = createSettingsWidgets({
    theming,
    shippedThemes,
    applyThemeSetting,
    availableAvatarSets,
  });
  const { section, row, toggle, numberField, choice, themePicker, avatarPicker, readOnlyValue } =
    widgets;
  const rates = createRatesSection({ toast });
  const { renderRateEditor, loadRates } = rates;
  widgets.wire({ render });
  rates.wire({ render });

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
    setCurrent({ ...(getSnapshot()?.settings || {}) });
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
