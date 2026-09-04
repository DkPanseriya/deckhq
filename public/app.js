/**
 * DeckHQ client bootstrap.
 *
 * Owns: initial load, the SSE subscription, the header, the global keyboard
 * map, OS notifications + tab badge, and first-run onboarding. The side
 * panel lives in ./panel.js, the hook consent screen in ./hooks-ui.js — this
 * file wires them together but does not own their internals.
 *
 * docs/02-ARCHITECTURE.md §5, §5.1; docs/03-VISUAL-SPEC.md §7 §8 §9 §10.
 *
 * Renderer modules (./render/scene.js, ./render/palette.js) are owned by a
 * different engineer and may not exist yet while this file is being built.
 * Every import from ./render/** is therefore dynamic and defensive: a
 * missing or broken module degrades the shell (no floor, no close-up) but
 * never breaks the header, panel, keyboard map or notifications.
 */

import { createPanel } from './panel.js';
import { createHooksUI } from './hooks-ui.js';
import { createPalette } from './palette.js';
import { createDeckUI } from './deck.js';
import { createSettingsUI } from './settings-ui.js';
import { createCoachMarks } from './coach-marks.js';
import { createClearedTracker } from './office-cleared.js';
import { wrappedDue } from './wrapped.js';
import {
  FALLBACK_STATE_COLORS,
  announce,
  applyThemeSetting,
  deckUI,
  el,
  findAgent,
  latestSnapshot,
  palette,
  panel,
  prefersReducedMotion,
  projectFilter,
  scene,
  selectAgent,
  selectedId,
  setDeckUI,
  setLatestSnapshot,
  setPanel,
  setSelectedId,
  sounds,
  themes,
  toast,
} from './app-state.js';
import {
  filterToProject,
  getNeedsYouQueue,
  renderFloorState,
  renderHeader,
  renderProjectFilterChip,
  setAppBadge,
} from './app-header.js';
import { noteMouse, showTooltip } from './app-tooltip.js';
import { handleKeydown, handlePaletteKey, wireKeyboard } from './app-keys.js';
import { loadRenderModules } from './app-floor.js';
import {
  diffAndNotify,
  saveSetting,
  setNotifications,
  setPrevActivityStates,
} from './app-notify.js';
import { redactSnapshots, takeSnapshot, toggleRedaction } from './app-snapshot.js';
import {
  dismissCard,
  maybeShowNightCard,
  openPostcard,
  openWrapped,
  saveCard,
} from './app-cards.js';
import { openIdentityDialog, openNewAgentDialog, openNewProject } from './app-dialogs.js';
import {
  hideWhiteboard,
  revealProjectFolder,
  runProjectDashboard,
  showWhiteboard,
} from './app-launchers.js';

// -------------------------------------------------------------- app state
/**
 * Whether let-go agents are reachable right now. A VIEW toggle, not a stored
 * setting: the header used to write `settings.showLetGo` and nothing ever
 * read it (docs/DEVIATIONS.md §58). "Am I looking at removed sessions" is a
 * property of this tab, so it lives here and resets on reload. Flipped from
 * the palette (`⌘K` → `l`).
 */
let letGoVisible = false;
/**



/** WP-15's office-cleared moment. One tab's own counters, until WP-17's ledger. */
const clearedTracker = createClearedTracker();
let clearedTimers = [];

/**

/**
 * The Scene reports a hit as `{ kind, id }`. Older call sites passed a bare
 * id, so accept both rather than depending on one shape. `'whiteboard'`
 * (CONTRACTS-WP15.md §4) and `'new-agent'` (§5, the in-room "+") are the two
 * kinds this pass adds; anything unrecognised falls back to `'agent'` so a
 * future kind degrades to the old behaviour instead of throwing.
 * @param {unknown} hit
 * @returns {{kind:'agent'|'project'|'whiteboard'|'new-agent'|'shelf'|'screen',
 *   id:string}|null} `'shelf'` (the project folder) and `'screen'` (the
 *   dashboard) were added to the body and to two call sites without being
 *   added here, so both of those branches were unreachable to a checker (WP-22).
 */
function normaliseHit(hit) {
  if (!hit) return null;
  if (typeof hit === 'string') return { kind: 'agent', id: hit };
  const h = /** @type {any} */ (hit);
  if (!h.id) return null;
  const kind =
    h.kind === 'project' ||
    h.kind === 'whiteboard' ||
    h.kind === 'new-agent' ||
    h.kind === 'shelf' ||
    h.kind === 'screen'
      ? h.kind
      : 'agent';
  return { kind, id: String(h.id) };
}

// ---------------------------------------------------- the office cleared

/** How long the line stays: §9's "fades in and out over 3 s". */
const CLEARED_LINE_MS = 3000;
/** §9's "ambient light warms 6% over 1.2 s", plus the fall. */
const CLEARED_LIGHT_MS = 2400;

/**
 * The product's one celebration. WP-15, `05` §9.
 *
 * Three things at once: the light warms, the chime plays, one line appears
 * and goes. The light is a CSS overlay on the stage rather than anything in
 * the renderer — it is chrome about the floor, not part of the floor, and
 * `public/render/**` is another package's file.
 *
 * `prefers-reduced-motion` suppresses the light and keeps the line, exactly
 * as §9 asks: the line is information, the warming is decoration, and the
 * person who asked for less motion still wants to know their office is clear.
 *
 * @param {string} line
 */
function celebrateOfficeCleared(line) {
  for (const t of clearedTimers) clearTimeout(t);
  clearedTimers = [];

  sounds.play('chime');

  el.officeCleared.textContent = line;
  el.officeCleared.hidden = false;
  // The line is announced rather than left to a `hidden` attribute flip,
  // because a screen-reader user gets the milestone or they get nothing.
  announce(line);
  // Two frames' worth of delay so the transition has a start state to run
  // from; a `setTimeout(0)` is enough and does not depend on rAF, which a
  // hidden tab would never fire.
  clearedTimers.push(setTimeout(() => el.officeCleared.classList.add('is-shown'), 20));
  clearedTimers.push(
    setTimeout(() => el.officeCleared.classList.remove('is-shown'), CLEARED_LINE_MS - 400),
  );
  clearedTimers.push(
    setTimeout(() => {
      el.officeCleared.hidden = true;
      el.officeCleared.textContent = '';
    }, CLEARED_LINE_MS),
  );

  if (prefersReducedMotion()) return;
  el.stage.classList.add('is-cleared');
  clearedTimers.push(setTimeout(() => el.stage.classList.remove('is-cleared'), CLEARED_LIGHT_MS));
}

// One click on the card dismisses it. The overlay behind it deliberately does
// NOT take the pointer: the floor stays clickable underneath, so a card that
// arrives while somebody is mid-thought costs them nothing.
el.nightcard.addEventListener('click', () => dismissCard());

// ------------------------------------------------------------ networking

/** @param {any} snapshot */
function handleSnapshot(snapshot) {
  const first = latestSnapshot === null;
  // "Your draft" (docs/plan/08 §3.5): an unsent reply held in the composer is
  // client state, so it is stamped onto each agent here for the renderer and
  // the deck to read. The daemon never sees drafts.
  for (const a of snapshot.agents || []) a.hasDraft = panel.hasDraft(a.id);
  // WP-30. The theme is a setting, so it arrives with the snapshot and is
  // applied BEFORE the floor is handed one: `planSignature` counts the theme,
  // so `scene.setState` below re-bakes the backdrop in the new materials as
  // part of the same update rather than a frame later.
  applyThemeSetting((snapshot.settings || {}).theme);
  setLatestSnapshot(snapshot);
  renderHeader(snapshot);
  renderFloorState(snapshot);
  // The chip carries the project's display name, which only arrives with a
  // snapshot, so re-render it whenever one does.
  if (projectFilter !== null) {
    if (snapshot.projects?.some((p) => p.id === projectFilter)) renderProjectFilterChip();
    else filterToProject(null); // the project vanished from the floor
  }
  // The actors never interrupt anybody. They are not real sessions, so an
  // actor "entering" needs_input must not raise an OS notification, play a
  // sound, or count towards the office-cleared moment — the celebration in
  // this product is reserved for real work being really finished (WP-13,
  // WP-15).
  if (!first && !snapshot.demo) diffAndNotify(snapshot);
  else setPrevActivityStates(new Map(snapshot.agents.map((a) => [a.id, a.activityState])));
  deckUI?.render();
  // The office-cleared moment (WP-15). The actor floor is excluded for the
  // same reason it fires no notifications: nothing on it was ever really
  // waiting, so nothing on it can really be cleared.
  if (!snapshot.demo) {
    const cleared = clearedTracker.update(snapshot, Date.now());
    if (cleared.fire) celebrateOfficeCleared(cleared.line);
  }
  // Lights out (WP-18) and Wrapped (WP-27). Checked on every snapshot rather
  // than on a timer of their own: a poll already arrives every few seconds, so
  // a timer would be a second clock with nothing to add.
  maybeShowNightCard();
  panel.refresh();
  if (coachMarks.isRunning()) coachMarks.reposition();
  if (first) maybeShowOnboarding(snapshot.settings);
}

/** GET /api/state once at boot, retrying with backoff if the daemon is unreachable. */
async function loadInitialState() {
  let backoff = 1000;
  for (;;) {
    try {
      const res = await fetch('/api/state');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const snapshot = await res.json();
      handleSnapshot(snapshot);
      return;
    } catch (err) {
      el.floorSkeleton.hidden = true;
      el.errorBanner.hidden = false;
      el.errorBannerText.textContent = `Retrying in ${Math.round(backoff / 1000)}s…`;
      console.debug('[deckhq] initial state load failed, retrying', err);
      await new Promise((resolve) => setTimeout(resolve, backoff));
      backoff = Math.min(backoff * 2, 15000);
    }
  }
}

/** Subscribe to GET /api/events (SSE). Reconnects with exponential backoff, quietly. */
function connectEvents() {
  let es = null;
  let backoff = 1000;
  let backoffTimer = null;
  let connected = false;
  let stopped = false;

  function setConnected(isConnected) {
    if (isConnected === connected) return;
    connected = isConnected;
    el.connectionStatus.hidden = isConnected;
  }

  function open() {
    if (stopped) return;
    es = new EventSource('/api/events');
    es.addEventListener('state', (ev) => {
      backoff = 1000;
      setConnected(true);
      try {
        handleSnapshot(JSON.parse(/** @type {MessageEvent} */ (ev).data));
      } catch (err) {
        console.debug('[deckhq] malformed SSE payload', err);
      }
    });
    es.onopen = () => setConnected(true);
    es.onerror = () => {
      setConnected(false);
      es?.close();
      clearTimeout(backoffTimer);
      backoffTimer = setTimeout(open, backoff);
      backoff = Math.min(backoff * 2, 30000);
    };
  }

  open();
  return () => {
    stopped = true;
    clearTimeout(backoffTimer);
    es?.close();
  };
}

// ----------------------------------------------------------- onboarding

/**
 * Where a coach mark points.
 *
 * Two of the three anchors are regions of the floor, and the floor is one
 * `<canvas>`: there is no element to measure. The renderer owns that geometry
 * and does not expose it — `Scene` has no public "where is the office" or
 * "where is this agent on screen" accessor, and `public/render/**` is another
 * engineer's file this package may not edit. So this asks for one
 * (`scene.anchorFor`), and when it is absent falls back to the canvas's own
 * box with the pointer ring suppressed, which is honest about what it knows
 * rather than drawing an arrow at a guess. `docs/DEVIATIONS.md` §108 records
 * the export this wants.
 *
 * @param {{kind:string, selector?:string, target?:string}} anchor
 * @returns {{x:number,y:number,w:number,h:number,arrow?:boolean}|null}
 */
function coachAnchorFor(anchor) {
  if (anchor.kind === 'element') {
    const node = document.querySelector(anchor.selector || '');
    if (!node) return null;
    const r = node.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  if (anchor.kind === 'floor') {
    if (scene && typeof scene.anchorFor === 'function') {
      try {
        const id =
          anchor.target === 'agent' ? (getNeedsYouQueue(latestSnapshot)[0]?.id ?? null) : null;
        const r = scene.anchorFor(anchor.target, id);
        if (r && (r.w || r.h)) {
          // `anchorFor` answers in the canvas's own frame, which is the frame
          // the renderer works in throughout (`_hitTest` reads
          // `clientX - rect.left`). The coach layer places cards in viewport
          // coordinates, like the `element` branch above, so the canvas's own
          // offset is added here — once, at the boundary between the two.
          const box = el.canvas.getBoundingClientRect();
          return { x: box.left + r.x, y: box.top + r.y, w: r.w, h: r.h };
        }
      } catch (err) {
        console.debug('[deckhq] scene.anchorFor failed', err);
      }
    }
    if (el.canvas.hidden) return null;
    const r = el.canvas.getBoundingClientRect();
    if (!r.width && !r.height) return null;
    return { x: r.left, y: r.top, w: r.width, h: r.height, arrow: false };
  }
  return null;
}

const coachMarks = createCoachMarks({
  layer: el.coachLayer,
  getSnapshot: () => latestSnapshot,
  anchorFor: coachAnchorFor,
  announce,
  onDone: () => {
    // One bit, set by either route — reading all three, or Escape. `onboarded`
    // is the whole of "has this person seen the tour", and the palette's
    // "Onboarding again" is what brings it back on purpose.
    if (latestSnapshot?.settings) latestSnapshot.settings.onboarded = true;
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ onboarded: true }),
    }).catch((err) => console.debug('[deckhq] could not record onboarding as seen', err));
  },
});

/**
 * First run: the three coach marks, once, then never again.
 * docs/plan/05-GUI-UX-SPEC.md §7.
 * @param {any} settings
 */
function maybeShowOnboarding(settings) {
  if (settings && settings.onboarded) return;
  showOnboarding();
}

/** Open it on purpose — the palette's "Onboarding again". */
function showOnboarding() {
  if (coachMarks.isRunning()) return;
  coachMarks.start();
}

// ---------------------------------------------------------------- panel

setPanel(
  createPanel({
    root: el.panelRoot,
    getSnapshot: () => latestSnapshot,
    toast,
    announce,
    onClosed: () => {
      setSelectedId(null);
      if (scene) {
        try {
          scene.select(null);
        } catch {
          /* Scene may not exist yet */
        }
      }
      deckUI?.syncSelection();
    },
    // WP15 task C.2: "New agent in a project ... also from the panel when a
    // project is selected." Every agent shown in the panel belongs to a
    // project, so this is always available for whichever one is open.
    onNewAgent: (projectId) => openNewAgentDialog(projectId),
    // WP15 task C.3: rename / re-avatar an existing agent.
    onRename: (agent) => openIdentityDialog(agent),
    // Keep `hasDraft` on client state current between snapshots.
    onDraftChange: (id, hasDraft) => {
      const a = latestSnapshot?.agents?.find((x) => x.id === id);
      if (a) a.hasDraft = hasDraft;
    },
  }),
);

// -------------------------------------------------------- strip and deck
//
// Levels 2 and 3 (docs/plan/05-GUI-UX-SPEC.md §3). They read the same queue
// this file's J/K walk, they move the same selection, and their number keys
// are handed straight to the panel's own pressNumberKey() — there is no
// second route to /api/ack anywhere in here. THE INVARIANT, 01-PRODUCT §2.

setDeckUI(
  createDeckUI({
    stripEl: el.queueStrip,
    listEl: el.stripList,
    moreEl: el.stripMore,
    hintEl: el.stripHint,
    lastEl: el.stripLast,
    deckEl: el.deck,
    stageEl: el.stage,
    getQueue: () => getNeedsYouQueue(latestSnapshot),
    getSelectedId: () => selectedId,
    onSelect: (id, o) => selectAgent(id, o),
    announce,
  }),
);

// The hook consent screen. It has no dialog of its own any more — it renders
// into the settings sheet's Hooks section (WP-07, GUI/UX spec §5.4).
const hooksUI = createHooksUI({ toast });

// ---------------------------------------------------------------- header

/**
 * Bench every idle agent at once. The first run on a real machine inherits a
 * long backlog of finished sessions; benching them one at a time is not a
 * reasonable ask. It touches only sessions that are not running.
 */
async function settleFloor() {
  try {
    const res = await fetch('/api/settle', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    const n = data.benched ?? 0;
    toast(
      n === 1 ? 'Benched 1 agent. They are in the lounge.' : `Benched ${n}. All in the lounge.`,
    );
  } catch (err) {
    toast(`Could not settle the floor: ${err.message}`, { isError: true });
  }
}

/**
 * WP-30. Write the floor's arrangement to a file the user owns.
 *
 * A local download and nothing else: the daemon builds the document, the
 * browser saves it, and no byte leaves the machine. The object URL is revoked
 * on the next task so a long-lived tab does not accumulate blobs.
 */
async function exportLayout() {
  try {
    const res = await fetch('/api/layout');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const layout = await res.json();
    const blob = new Blob(
      [
        `${JSON.stringify(layout, null, 2)}
`,
      ],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'deckhq-layout.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    toast(
      `Layout saved: theme “${layout.theme}”, ${layout.rooms.length} room(s). ` +
        'It names your project folders — it is not anonymous.',
    );
  } catch (err) {
    toast(`Could not export the layout: ${err.message}`, { isError: true });
  }
}

/**
 * Apply a layout file.
 *
 * The file is parsed here only far enough to be valid JSON; the daemon is the
 * one authority on whether it is a LAYOUT, so its refusal is what the user
 * reads. A refused file changes nothing at all — see `src/http/routes/layout.mjs`.
 */
function importLayout() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'application/json,.json';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch (err) {
        throw new Error(`that file is not JSON (${err.message})`);
      }
      const res = await fetch('/api/layout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      const layout = body.layout || {};
      toast(`Layout applied: theme “${layout.theme}”, ${(layout.rooms || []).length} room(s).`);
    } catch (err) {
      toast(`${err.message} Nothing was changed.`, { isError: true });
    }
  });
  input.click();
}

async function refreshNow() {
  try {
    const res = await fetch('/api/refresh', { method: 'POST' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    toast('Rescanned.');
  } catch {
    toast('Refresh failed', { isError: true });
  }
}

/** @param {string} projectId @param {boolean} archived */
async function setProjectArchived(projectId, archived) {
  try {
    const res = await fetch('/api/project-archive', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: projectId, archived }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    toast(`Could not change that room: ${err.message}`, { isError: true });
  }
}

/**
 * Resume the selected session. The panel owns the footer links and the
 * preference they save; this is the palette's route to the same endpoint, for
 * a keyboard user who never opened the footer.
 * @param {'app'|'terminal'} target
 */
async function resumeSelected(target) {
  if (!selectedId) return;
  try {
    const res = await fetch('/api/resume', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: selectedId, target }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    toast(target === 'app' ? 'Resuming in the desktop app' : 'Resuming in a terminal');
  } catch (err) {
    toast(`Could not resume: ${err.message}`, { isError: true });
  }
  saveSetting({ resumeIn: target });
}

/**
 * "Jump to" a project: look at that room without scoping the queue to it.
 * "Filter to" is the other half and is what the room plate does.
 * @param {string} projectId
 */
function jumpToProject(projectId) {
  const agents = (latestSnapshot?.agents || []).filter(
    (a) => a.projectId === projectId && (letGoVisible || a.ackState !== 'let_go'),
  );
  if (agents.length === 0) {
    toast('Nobody is in that room right now');
    return;
  }
  selectAgent(agents[0].id);
}

/**
 * The header's one primary action. A new agent needs a project, so: use the
 * project already in view if there is one, otherwise hand the choice to the
 * palette rather than guessing, and on a machine with no projects at all fall
 * back to creating one.
 */
function startNewAgent(projectId) {
  const inView = projectId || projectFilter || findAgent(selectedId)?.projectId;
  if (inView) return openNewAgentDialog(inView);
  if ((latestSnapshot?.projects || []).length === 0) return openNewProject();
  paletteUI.open('new agent in ');
}

// Clicking the scrim — anywhere but the board itself — closes the board.
el.whiteboardOverlay.addEventListener('click', (e) => {
  if (e.target === el.whiteboardOverlay) hideWhiteboard();
});

// WP-39 · the floating mini-floor — begin -----------------------------------
//
// A 320x200 Document Picture-in-Picture window holding your office, the
// corridor beside it and the needs-you numeral, always on top of the terminal.
// Everything about it lives in `public/minifloor.js`; this is the whole of its
// wiring, kept as one block on purpose because two other packages are editing
// this file at the same time.
//
// The module is warmed on load but never awaited on load, for two reasons.
// Statically importing it would make `./render/*` a hard dependency of the
// shell, which the note at the top of this file forbids — a broken renderer
// must cost the floor and nothing else. And `requestWindow()` needs transient
// user activation, so the import must already be settled by the time the key
// is pressed rather than fetched inside the handler.
const miniFloorModule = import('./minifloor.js').catch((err) => {
  console.error('[deckhq] the mini-floor failed to load', err);
  return null;
});
/** @type {any} the controller, built on first use */
let miniFloor = null;

async function floatOffice() {
  const mod = await miniFloorModule;
  if (!mod) {
    toast('The floating window could not be loaded.', { isError: true });
    return;
  }
  if (!miniFloor) {
    miniFloor = mod.createMiniFloor({
      // The mini-floor is a second render target of the SAME Scene, so it is
      // handed the live one rather than a snapshot to build its own from.
      getScene: () => scene,
      onSelect: (id) => selectAgent(id),
      // Firefox and Safari expose no floating window. WP-16 already puts the
      // count on the app icon, so that is where it goes, and the toast says
      // as much in one line rather than pretending nothing was asked for.
      onFallback: (count) => setAppBadge(count),
      toast,
    });
  }
  await miniFloor.toggle();
}

// `P` floats the office, as a case in `handleKeydown`'s switch. It was a
// standalone listener with the map's guards copied into it, because three
// packages were editing that switch at once (DEVIATIONS §113.5); they have
// merged, so the duplicate guards are gone and the key is in the map with
// every other key on the floor.
// WP-39 · the floating mini-floor — end -------------------------------------

// ---------------------------------------------------------- palette + sheet

const settingsUI = createSettingsUI({
  dialogEl: el.settingsDialog,
  bodyEl: el.settingsBody,
  getSnapshot: () => latestSnapshot,
  toast,
  hooks: hooksUI,
  // WP-30. The sheet is handed the themes rather than importing them: they
  // live in `render/`, every import from there is dynamic and defensive, and
  // the sheet has to stay importable in Node for `settings-keys.test.mjs`.
  // Read through `themes` on each call, because the module arrives after this
  // line runs — `loadRenderModules` is awaited later.
  theming: {
    list: () => (themes && Array.isArray(themes.THEMES) ? themes.THEMES : []),
    apply: (name) => applyThemeSetting(name),
    swatches: (theme) => (themes?.swatchesFor ? themes.swatchesFor(theme) : []),
  },
});

el.settingsClose.addEventListener('click', () => el.settingsDialog.close());

const paletteUI = createPalette({
  dialogEl: el.paletteDialog,
  inputEl: el.paletteInput,
  listEl: el.paletteList,
  emptyEl: el.paletteEmpty,
  getSnapshot: () => latestSnapshot,
  getSelectedId: () => selectedId,
  getLetGoVisible: () => letGoVisible,
  getRedactSnapshots: () => redactSnapshots,
  actions: {
    selectAgent,
    filterToProject,
    jumpToProject,
    showWhiteboard,
    revealFolder: revealProjectFolder,
    runDashboard: runProjectDashboard,
    archiveProject: setProjectArchived,
    newAgent: startNewAgent,
    newProject: openNewProject,
    floatOffice, // WP-39
    rename: openIdentityDialog,
    // The palette never calls /api/ack itself: it hands the action to the
    // panel's performAction(), the single funnel in the client. THE
    // INVARIANT, docs/01-PRODUCT.md §2.
    ack: (action) => panel.performAction(action),
    resume: resumeSelected,
    settleFloor,
    refresh: refreshNow,
    exportLayout,
    importLayout,
    openSettings: () => settingsUI.open(),
    openHooks: () => settingsUI.open('hooks'),
    openOnboarding: showOnboarding,
    // WP-18 / WP-27. Both are `manual: true`: asking for the card does not
    // spend the automatic one, and being shown it on purpose does not mark a
    // day or a week as delivered.
    showPostcard: () => openPostcard({ manual: true }),
    showWrapped: () => {
      const due = wrappedDue({ now: Date.now(), shownKey: '' });
      openWrapped(due.kind === 'annual' ? 'annual' : 'week', { manual: true });
    },
    setNotifications,
    // One keystroke from the palette mutes globally, and it persists
    // (WP-15, `05` §8). Turning it *on* plays the chime once, because a
    // sound setting you cannot hear the result of is a setting you cannot
    // judge — and this is the one place where a sound is a direct answer to
    // something the user just did, so the coalescing window is bypassed.
    setSound: async (next) => {
      const saved = await saveSetting({ sound: next });
      if (!saved) return;
      if (next) {
        sounds.unlock();
        sounds._state.lastPlayedAt = -Infinity;
        sounds.play('chime');
        toast('Sound on. A door closes, two knocks, and a chime when the office clears.');
      } else {
        toast('Sound off, on this machine, until you turn it back on.');
      }
    },
    snapshot: takeSnapshot,
    toggleRedaction,
    toggleLetGoVisible: () => {
      letGoVisible = !letGoVisible;
      toast(letGoVisible ? 'Let-go agents are reachable from ⌘K' : 'Let-go agents hidden again');
    },
  },
});

el.paletteBtn.addEventListener('click', () => paletteUI.open());
el.newAgentBtn.addEventListener('click', () => startNewAgent());
el.degradedLink.addEventListener('click', () => settingsUI.open('hooks'));

wireKeyboard({
  dismissCard,
  hideWhiteboard,
  toggleRedaction,
  saveCard,
  takeSnapshot,
  floatOffice,
  paletteUI,
});
document.addEventListener('keydown', handlePaletteKey);
document.addEventListener('keydown', handleKeydown);

// A browser will not start an AudioContext until the page has had a real
// gesture, so WP-15's first door would otherwise be swallowed. One listener,
// removed the moment it has done its job — the context is created here and
// lives for the tab.
function unlockAudioOnce() {
  document.removeEventListener('pointerdown', unlockAudioOnce);
  document.removeEventListener('keydown', unlockAudioOnce);
  sounds.unlock();
}
document.addEventListener('pointerdown', unlockAudioOnce);
document.addEventListener('keydown', unlockAudioOnce);

document.addEventListener('visibilitychange', () => {
  if (!scene) return;
  try {
    if (document.hidden) scene.stop();
    else scene.start();
  } catch (err) {
    console.debug('[deckhq] Scene start/stop failed', err);
  }
});

el.canvas.addEventListener('mousemove', (e) => {
  noteMouse(e.clientX, e.clientY);
});

// -------------------------------------------------------------------- boot

/** State colours, preferring the real palette module once it exists. */
export function stateColor(state) {
  return palette?.STATE_COLORS?.[state] || FALLBACK_STATE_COLORS[state] || '#888888';
}

/**
 * The palette hint in the header names the key this machine actually uses.
 * Both accelerators work everywhere (see handlePaletteKey); this is only
 * about which one to advertise.
 */
function paintPaletteHint() {
  const mac = /mac|iphone|ipad/i.test(navigator.userAgent || '');
  el.paletteHintKey.textContent = mac ? '⌘ K' : 'Ctrl K';
  el.paletteBtn.setAttribute(
    'aria-label',
    `Open the command palette. ${mac ? 'Command' : 'Control'} K.`,
  );
}

async function main() {
  paintPaletteHint();
  await Promise.all([
    loadInitialState(),
    loadRenderModules({
      normaliseHit,
      selectAgent,
      filterToProject,
      openNewAgentDialog,
      showWhiteboard,
      revealProjectFolder,
      runProjectDashboard,
      showTooltip,
    }),
  ]);
  connectEvents();
}

main();
