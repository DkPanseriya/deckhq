import { createSounds } from './sound.js';

/**
 * The wiring every part of the client shares: the DOM it draws into, the
 * display vocabulary, the handful of values that change over the life of the
 * tab, and three helpers that touch all of them.
 *
 * WP-22 split `app.js` — 2,721 lines — into a composition root and four parts
 * (`app-header`, `app-tooltip`, `app-keys`, `app-floor`). Those parts need to
 * SEE the snapshot, the scene and the panel; they must not own them. So the
 * mutable values live here as live bindings with a setter each, and `app.js`
 * is the only file that calls a setter. A part reads `latestSnapshot` or
 * `scene` by name, exactly as it did when they were locals of one big file,
 * and cannot reassign either — an `import` binding is read-only, so the rule
 * is enforced by the language rather than by review.
 *
 * No imports of its own, so nothing that imports this can create a cycle.
 */

/**
 * Fallback copy of the glyph vocabulary in docs/CONTRACTS-WP15.md §2, used
 * only until ./render/palette.js exports AVATAR_GLYPHS (that module is
 * owned by a different engineer and may not have landed it yet — see the
 * defensive-import note at the top of this file).
 * @type {string[]}
 */
export const FALLBACK_AVATAR_GLYPHS = [
  'hex',
  'triangle',
  'square',
  'diamond',
  'drop',
  'star',
  'cross',
  'ring',
];

/**
 * Fallback copy of docs/03-VISUAL-SPEC.md §5, used only until
 * ./render/palette.js is available. Keep in exact sync with style.css's
 * --state-* custom properties and with render/palette.js's STATE_COLORS.
 * @type {Record<string, string>}
 */
export const FALLBACK_STATE_COLORS = {
  working: '#2E7D63',
  needs_input: '#B87333',
  stalled: '#9A7B4F',
  for_review: '#C0392B',
  benched: '#7B8794',
  let_go: '#BDB7AA',
  ended: '#6E6A63',
};

export const STATE_LABELS = {
  working: 'Working',
  needs_input: 'Hands up',
  stalled: 'Stalled',
  for_review: 'For review',
  benched: 'Benched',
  let_go: 'Let go',
  ended: 'Ended',
};

// ---------------------------------------------------------------- DOM refs
export const el = {
  needsYou: document.getElementById('stat-needs-you'),
  needsYouTotal: document.getElementById('needs-you-total'),
  handsUp: document.getElementById('stat-hands-up'),
  stalled: document.getElementById('stat-stalled'),
  forReview: document.getElementById('stat-for-review'),
  atDesk: document.getElementById('stat-at-desk'),
  benched: document.getElementById('stat-benched'),
  finished: document.getElementById('stat-finished'),
  finishedWrap: document.getElementById('floor-count-finished'),
  wentHome: document.getElementById('stat-went-home'),
  wentHomeWrap: document.getElementById('floor-count-went-home'),
  writeErrorBanner: document.getElementById('write-error-banner'),
  writeErrorText: document.getElementById('write-error-text'),
  degradedBanner: document.getElementById('degraded-banner'),
  degradedText: document.getElementById('degraded-text'),
  degradedLink: document.getElementById('degraded-link'),
  connectionStatus: document.getElementById('connection-status'),
  paletteBtn: document.getElementById('palette-btn'),
  paletteHintKey: document.getElementById('palette-hint-key'),
  newAgentBtn: document.getElementById('new-agent-btn'),
  paletteDialog: /** @type {HTMLDialogElement} */ (document.getElementById('palette')),
  paletteInput: /** @type {HTMLInputElement} */ (document.getElementById('palette-input')),
  paletteList: document.getElementById('palette-list'),
  paletteEmpty: document.getElementById('palette-empty'),
  settingsDialog: /** @type {HTMLDialogElement} */ (document.getElementById('settings-dialog')),
  settingsBody: document.getElementById('settings-body'),
  settingsClose: document.getElementById('settings-close'),
  newProjectDialog: /** @type {HTMLDialogElement} */ (
    document.getElementById('new-project-dialog')
  ),
  newProjectPath: /** @type {HTMLInputElement} */ (document.getElementById('new-project-path')),
  newProjectCreateToggle: /** @type {HTMLButtonElement} */ (
    document.getElementById('new-project-create-toggle')
  ),
  newProjectGitInitToggle: /** @type {HTMLButtonElement} */ (
    document.getElementById('new-project-gitinit-toggle')
  ),
  newProjectName: /** @type {HTMLInputElement} */ (document.getElementById('new-project-name')),
  newProjectInstructions: /** @type {HTMLTextAreaElement} */ (
    document.getElementById('new-project-instructions')
  ),
  newProjectGo: /** @type {HTMLButtonElement} */ (document.getElementById('new-project-go')),
  newProjectError: document.getElementById('new-project-error'),
  newAgentDialog: /** @type {HTMLDialogElement} */ (document.getElementById('new-agent-dialog')),
  newAgentIntro: document.getElementById('new-agent-intro'),
  newAgentNamePicker: document.getElementById('new-agent-name-picker'),
  newAgentAvatarPicker: document.getElementById('new-agent-avatar-picker'),
  newAgentInstructions: /** @type {HTMLTextAreaElement} */ (
    document.getElementById('new-agent-instructions')
  ),
  newAgentGo: /** @type {HTMLButtonElement} */ (document.getElementById('new-agent-go')),
  newAgentError: document.getElementById('new-agent-error'),
  identityDialog: /** @type {HTMLDialogElement} */ (document.getElementById('identity-dialog')),
  identityIntro: document.getElementById('identity-intro'),
  identityNamePicker: document.getElementById('identity-name-picker'),
  identityAvatarPicker: document.getElementById('identity-avatar-picker'),
  identityGo: /** @type {HTMLButtonElement} */ (document.getElementById('identity-go')),
  identityError: document.getElementById('identity-error'),
  queueStrip: document.getElementById('queue-strip'),
  stripList: document.getElementById('strip-list'),
  stripMore: document.getElementById('strip-more'),
  stripHint: document.getElementById('strip-hint'),
  stripLast: document.getElementById('strip-last'),
  deck: document.getElementById('deck'),
  stage: /** @type {HTMLElement} */ (document.querySelector('.stage')),
  canvas: /** @type {HTMLCanvasElement} */ (document.getElementById('floor-canvas')),
  tooltip: document.getElementById('tooltip'),
  whiteboardOverlay: document.getElementById('whiteboard-overlay'),
  floorSkeleton: document.getElementById('floor-skeleton'),
  emptyState: document.getElementById('empty-state'),
  demoNote: document.getElementById('demo-note'),
  errorBanner: document.getElementById('error-banner'),
  errorBannerText: document.getElementById('error-banner-text'),
  projectFilter: document.getElementById('project-filter'),
  panelRoot: document.getElementById('panel'),
  coachLayer: document.getElementById('coach-layer'),
  officeCleared: document.getElementById('office-cleared'),
  nightOverlay: document.getElementById('night-overlay'),
  nightcard: document.getElementById('nightcard'),
  nightcardTitle: document.getElementById('nightcard-title'),
  nightcardSub: document.getElementById('nightcard-sub'),
  nightcardRows: document.getElementById('nightcard-rows'),
  nightcardFoot: document.getElementById('nightcard-foot'),
  nightcardHint: document.getElementById('nightcard-hint'),
  // WP-45. The floor replay's transport bar.
  replay: document.getElementById('replay'),
  replayDay: document.getElementById('replay-day'),
  replayClock: document.getElementById('replay-clock'),
  replayPlay: document.getElementById('replay-play'),
  replayScrub: document.getElementById('replay-scrub'),
  replayClose: document.getElementById('replay-close'),
  replayNote: document.getElementById('replay-note'),
  liveRegion: document.getElementById('live-region'),
  toast: document.getElementById('toast'),
};

// ------------------------------------------------------- what changes over time

/** @type {any} the latest full snapshot from the daemon */
export let latestSnapshot = null;

/** @param {any} v */
export function setLatestSnapshot(v) {
  latestSnapshot = v;
}

/** How much one press of `+` / `-` changes the magnification. */
export const ZOOM_KEY_STEP = 1.25;

/**
 * Levels 2 and 3 — the queue strip and the deck (WP-10, docs/plan
 * /05-GUI-UX-SPEC.md §3). Assigned once, below the panel it hands its keys to;
 * declared here so the selection helpers can reach it without a TDZ trap.
 * @type {ReturnType<typeof import('./deck.js').createDeckUI>|null}
 */
export let deckUI = null;

/** @param {any} v */
export function setDeckUI(v) {
  deckUI = v;
}

/** @type {any} the side panel (./panel.js), once `app.js` has built it */
export let panel = null;
/** @param {any} v */
export function setPanel(v) {
  panel = v;
}

/** @type {{kind:'postcard'|'wrapped', model:any, name:string}|null} */
export let openCard = null;
/** @param {any} v */
export function setOpenCard(v) {
  openCard = v;
}

/** @type {any} the Scene instance, once (if) ./render/scene.js loads */
export let scene = null;
/** @type {any} the whole ./render/scene.js module namespace, if loaded */
export let sceneModule = null;
/** @type {any} the whole ./render/palette.js module namespace, if loaded */
export let palette = null;
/**
 * The whole ./render/themes.js module namespace, if loaded (WP-30). Held here
 * for the same reason `palette` is: it is a renderer module, its import is
 * dynamic and defensive, and a build without it must still show a floor — in
 * the default theme, which is what the stylesheet already paints.
 * @type {any}
 */
export let themes = null;
let toastTimer = null;
let lastAnnounced = '';

/** @param {any} v */
export function setScene(v) {
  scene = v;
}
/** @param {any} v */
export function setSceneModule(v) {
  sceneModule = v;
}
/** @param {any} v */
export function setPalette(v) {
  palette = v;
}
/** @param {any} v */
export function setThemes(v) {
  themes = v;
}

/**
 * What `/api/packs` said, once it has been asked (WP-45). `null` until then,
 * so a caller can tell "no packs" from "not looked yet".
 * @type {{packs:any[], avatarSets:any[]}|null}
 */
export let packs = null;

/**
 * Who is currently deciding what the canvas paints (WP-45).
 *
 * `'live'` — the snapshot stream, which is every second of every normal
 * session. `'replay'` — the floor replay is scrubbing a day out of the
 * ledger, and the arriving snapshots must NOT overwrite what it is drawing.
 *
 * A flag rather than unsubscribing from the stream, deliberately: the deck,
 * the panel, the queue strip, the header count and the notifications go on
 * being live and go on being true while you are watching yesterday. The only
 * thing replay takes over is the picture.
 * @type {'live'|'replay'}
 */
export let sceneOwner = 'live';

/** @param {'live'|'replay'} v */
export function setSceneOwner(v) {
  sceneOwner = v;
}

/** @param {any} v */
export function setPacks(v) {
  packs = v;
}

/** The theme currently painted, so a repeat application costs one comparison. */
let appliedTheme = 'default';

/** The avatar set currently applied. `''` is the tables the product ships. */
let appliedAvatarSet = '';

/**
 * Dress the floor from a named avatar set, or from the shipped tables (WP-45).
 *
 * The floor is re-baked on a CHANGE, and only on a change, for the same
 * reason `applyThemeSetting` re-bakes: the floor is push-driven, so with
 * nobody starting or finishing a session the new clothes would not appear
 * until the next thing happened. A repeat application costs one comparison.
 *
 * Safe before (or without) `render/palette.js`: with no module there is
 * nothing to dress, and the shipped tables are what the renderer would use
 * anyway. A set that fails its colour discipline is reported and the floor
 * stays in the shipped tables — the one thing this must never do is put an
 * agent in a colour that could be read as a state.
 *
 * @param {unknown} name
 * @returns {string} the set actually applied
 */
export function applyAvatarSetting(name) {
  if (!palette?.applyAvatarSet) return '';
  /** @type {string} */
  let next = '';
  try {
    next = palette.applyAvatarSet(name);
  } catch (err) {
    console.error('[deckhq] that avatar set was refused; keeping the shipped faces', err);
    try {
      next = palette.applyAvatarSet('');
    } catch {
      next = '';
    }
  }
  if (next !== appliedAvatarSet) {
    appliedAvatarSet = next;
    scene?.repaint?.();
  }
  return next;
}

/**
 * Paint a theme, floor and chrome together, and say which one landed.
 *
 * Safe before (or without) `render/themes.js`: with no module there is nothing
 * to repaint and the stylesheet's own `:root` is already the default theme, so
 * this is a no-op rather than a failure. A theme that throws its contrast
 * guard is reported and the floor stays on the default — the one thing this
 * must never do is leave the window painted in a theme nobody measured.
 *
 * The floor is re-baked here, on the change, rather than left to the next
 * snapshot. `planSignature` does count the theme, so a snapshot would
 * eventually do it — but the floor is push-driven, and with nobody starting or
 * finishing a session no snapshot arrives. Before this, choosing a theme
 * repainted the chrome instantly and left the floor on the old paint until the
 * next thing happened, which was measured on the demo floor and is exactly the
 * kind of defect a unit test cannot see.
 *
 * @param {unknown} name
 * @returns {string} the theme actually applied
 */
export function applyThemeSetting(name) {
  if (!themes) return 'default';
  /** @returns {string} */
  const paint = () => {
    try {
      return themes.applyTheme(name, document.documentElement);
    } catch (err) {
      console.error('[deckhq] that theme was refused; staying on the default', err);
      try {
        return themes.applyTheme('default', document.documentElement);
      } catch {
        return 'default';
      }
    }
  };
  const next = paint();
  if (next !== appliedTheme) {
    appliedTheme = next;
    scene?.repaint?.();
  }
  return next;
}

/**
 * Room-plate filter. `null` means the whole floor. VISUAL-SPEC §8: clicking a
 * room plate filters the panel — and with it the J/K queue — to that project.
 * @type {string|null}
 */
export let projectFilter = null;

/** @param {string|null} v */
export function setProjectFilter(v) {
  projectFilter = v;
}

// ------------------------------------------------------------- utilities

/** @param {number} n */
export function formatNumber(n) {
  return Number(n || 0).toLocaleString('en-US');
}

/**
 * @param {string} message
 * @param {{isError?:boolean}} [opts]
 */
export function toast(message, opts = {}) {
  el.toast.textContent = message;
  el.toast.classList.toggle('is-error', Boolean(opts.isError));
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 4000);
}

/** Push text into the off-screen aria-live region, deduped. @param {string} text */
export function announce(text) {
  if (!text || text === lastAnnounced) return;
  lastAnnounced = text;
  el.liveRegion.textContent = text;
}

/** @param {string} id @returns {any|null} */
export function findAgent(id) {
  if (!id || !latestSnapshot) return null;
  return latestSnapshot.agents.find((a) => a.id === id) || null;
}

/** @type {string|null} currently selected agent id (floor ring + panel) */
export let selectedId = null;

/** @param {string|null} v */
export function setSelectedId(v) {
  selectedId = v;
}

// ---------------------------------------------------------- the selection
//
// One selection, moved from four places — the floor, the strip, the deck and
// the panel — so it lives with the values it reads rather than in any one of
// them. WP-22.

/**
 * Select an agent everywhere at once: the ring on the floor, the ringed chip
 * in the strip, the current row in the deck, and the panel.
 *
 * `openPanel: false` moves the selection without opening the panel — the
 * deck's `J`/`K`, which must not reflow the column the deck sits beside on
 * every keystroke (docs/plan/05-GUI-UX-SPEC.md §3.2: `Enter` opens). A panel
 * that is already open follows the selection regardless, because it is
 * already occupying its column and nothing moves.
 *
 * @param {string|null} id
 * @param {{openPanel?:boolean}} [opts]
 */
export function selectAgent(id, opts = {}) {
  selectedId = id;
  if (scene) {
    try {
      scene.select(id);
    } catch (err) {
      console.warn('[deckhq] Scene.select failed', err);
    }
  }
  if (!id) panel.close();
  else if (opts.openPanel !== false || !el.panelRoot.hidden) panel.open(id);
  deckUI?.syncSelection();
}

/**
 * Step through the agents the floor is not drawing because they went home.
 *
 * The list comes from the Scene, which got it from the plan — one answer to
 * "who went home", not a second copy of the rule living here. Selecting one
 * opens the panel on it, which is the same surface a click on the floor
 * would have reached.
 */
export function selectNextGoneHome() {
  const ids = scene && typeof scene.goneHomeAgentIds === 'function' ? scene.goneHomeAgentIds() : [];
  if (ids.length === 0) return;
  const at = ids.indexOf(selectedId);
  selectAgent(ids[(at + 1) % ids.length]);
}

/** WP-15's three sounds. Silent until `settings.sound` is on. */
export const sounds = createSounds({
  getSettings: () => latestSnapshot?.settings || {},
});

/**
 * The same three-way rule the stylesheet uses (`05` §5.4, §9): an explicit
 * setting wins, otherwise the OS decides.
 */
export function prefersReducedMotion() {
  const mode = latestSnapshot?.settings?.reducedMotion;
  if (mode === 'reduce') return true;
  if (mode === 'no-preference') return false;
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
