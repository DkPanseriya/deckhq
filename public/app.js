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

import { boardCostParts, createPanel } from './panel.js';
import { createHooksUI } from './hooks-ui.js';
import { createPalette } from './palette.js';
import { createDeckUI, queueOrder } from './deck.js';
import { applyMotionPreference, createSettingsUI } from './settings-ui.js';
import { availableNames } from './names.js';
import { createCoachMarks } from './coach-marks.js';
import { recordLineFor } from './records.js';
import {
  MAX_PNG_BYTES,
  MIN_SCALE,
  composite,
  compositeCard,
  nextScaleDown,
  pngBytes,
  snapshotModel,
  stripColors,
} from './snapshot.js';
import { createSounds } from './sound.js';
import { createClearedTracker } from './office-cleared.js';
import { lightsOut, postcardCopy, startOfDay } from './postcard.js';
import { wrappedCopy, wrappedDue } from './wrapped.js';

/**
 * Fallback copy of the glyph vocabulary in docs/CONTRACTS-WP15.md §2, used
 * only until ./render/palette.js exports AVATAR_GLYPHS (that module is
 * owned by a different engineer and may not have landed it yet — see the
 * defensive-import note at the top of this file).
 * @type {string[]}
 */
const FALLBACK_AVATAR_GLYPHS = [
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
const FALLBACK_STATE_COLORS = {
  working: '#2E7D63',
  needs_input: '#B87333',
  stalled: '#9A7B4F',
  for_review: '#C0392B',
  benched: '#7B8794',
  let_go: '#BDB7AA',
  ended: '#6E6A63',
};

const STATE_LABELS = {
  working: 'Working',
  needs_input: 'Hands up',
  stalled: 'Stalled',
  for_review: 'For review',
  benched: 'Benched',
  let_go: 'Let go',
  ended: 'Ended',
};

/**
 * States that fire a notification on *entry*, and the setting that governs
 * each. docs/03-VISUAL-SPEC.md §9; the per-state switches are the settings
 * sheet's Notifications section (docs/plan/05-GUI-UX-SPEC.md §5.4).
 */
const NOTIFY_ON_ENTRY = {
  needs_input: 'notifyHandsUp',
  for_review: 'notifyForReview',
};
const NOTIFY_COALESCE_MS = 10_000;

// ---------------------------------------------------------------- DOM refs
const el = {
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
  liveRegion: document.getElementById('live-region'),
  toast: document.getElementById('toast'),
};

// -------------------------------------------------------------- app state
/** @type {any} the latest full snapshot from the daemon */
let latestSnapshot = null;
/** @type {Map<string, string>} agentId -> activityState, from the previous snapshot */
let prevActivityStates = new Map();
/** @type {string|null} currently selected agent id (floor ring + panel) */
let selectedId = null;
/**
 * Whether let-go agents are reachable right now. A VIEW toggle, not a stored
 * setting: the header used to write `settings.showLetGo` and nothing ever
 * read it (docs/DEVIATIONS.md §58). "Am I looking at removed sessions" is a
 * property of this tab, so it lives here and resets on reload. Flipped from
 * the palette (`⌘K` → `l`).
 */
let letGoVisible = false;
/** How much one press of `+` / `-` changes the magnification. */
const ZOOM_KEY_STEP = 1.25;
/**
 * Levels 2 and 3 — the queue strip and the deck (WP-10, docs/plan
 * /05-GUI-UX-SPEC.md §3). Assigned once, below the panel it hands its keys to;
 * declared here so the selection helpers can reach it without a TDZ trap.
 * @type {ReturnType<typeof createDeckUI>|null}
 */
let deckUI = null;

/** @type {any} the Scene instance, once (if) ./render/scene.js loads */
let scene = null;
/** @type {any} the whole ./render/scene.js module namespace, if loaded */
let sceneModule = null;
/** @type {any} the whole ./render/palette.js module namespace, if loaded */
let palette = null;
let toastTimer = null;
let lastAnnounced = '';
/** @type {{id:string,label:string,projectName:string}[]} agents pending in a coalesced notification */
let pendingNotifyBatch = [];
let notifyCoalesceTimer = null;
let lastNotifyAt = 0;
/** Whether the most recent batch actually produced an OS notification (WP-15's §8 rule). */
let lastNotifyShown = false;

/** WP-15's three sounds. Silent until `settings.sound` is on. */
const sounds = createSounds({
  getSettings: () => latestSnapshot?.settings || {},
});

/** WP-15's office-cleared moment. One tab's own counters, until WP-17's ledger. */
const clearedTracker = createClearedTracker();
let clearedTimers = [];

// ------------------------------------------------------------- utilities

/** @param {number} n */
function formatNumber(n) {
  return Number(n || 0).toLocaleString('en-US');
}

/**
 * @param {string} message
 * @param {{isError?:boolean}} [opts]
 */
function toast(message, opts = {}) {
  el.toast.textContent = message;
  el.toast.classList.toggle('is-error', Boolean(opts.isError));
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 4000);
}

/** Push text into the off-screen aria-live region, deduped. @param {string} text */
function announce(text) {
  if (!text || text === lastAnnounced) return;
  lastAnnounced = text;
  el.liveRegion.textContent = text;
}

/** @param {string} id @returns {any|null} */
function findAgent(id) {
  if (!id || !latestSnapshot) return null;
  return latestSnapshot.agents.find((a) => a.id === id) || null;
}

/**
 * Room-plate filter. `null` means the whole floor. VISUAL-SPEC §8: clicking a
 * room plate filters the panel — and with it the J/K queue — to that project.
 * @type {string|null}
 */
let projectFilter = null;

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

/**
 * Scope the queue and the panel to one project, and show a clearable chip in
 * the header so the filter is never invisible.
 * @param {string|null} projectId
 */
function filterToProject(projectId) {
  projectFilter = projectId;
  renderProjectFilterChip();
  // The filter scopes the queue, so the strip and the deck are showing a
  // different list from the one they were a moment ago.
  deckUI?.render();
  if (!projectId) return;
  // Land on the most overdue session in that project, or its first session.
  const queue = getNeedsYouQueue(latestSnapshot);
  const fallback = latestSnapshot?.agents.find(
    (a) => a.projectId === projectId && a.ackState !== 'let_go',
  );
  const target = queue[0] || fallback;
  if (target) selectAgent(target.id);
}

function renderProjectFilterChip() {
  const host = el.projectFilter;
  if (!host) return;
  host.textContent = '';
  if (projectFilter === null) {
    host.hidden = true;
    return;
  }
  const project = latestSnapshot?.projects?.find((p) => p.id === projectFilter);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'filter-chip';
  button.textContent = `${project?.name || projectFilter} · show whole floor`;
  button.setAttribute('aria-label', `Filtered to ${project?.name || projectFilter}. Clear filter.`);
  button.addEventListener('click', () => filterToProject(null));
  host.appendChild(button);

  // Collapse this repo's room off the floor, or bring it back. Only offered
  // once the room is genuinely idle: a repo with an active agent stays open
  // regardless, so the control would be a lie.
  const idle = (project?.activeCount ?? 0) === 0;
  if (project && idle) {
    const archived = project.archived === true;
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'filter-chip';
    toggle.textContent = archived ? 'restore room' : 'archive room';
    toggle.title = archived
      ? 'Put this repo back on the floor'
      : 'Take this idle repo off the floor. It reappears by itself when an agent starts working in it.';
    toggle.addEventListener('click', async () => {
      toggle.disabled = true;
      try {
        await fetch('/api/project-archive', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: project.id, archived: !archived }),
        });
      } catch {
        toggle.disabled = false;
      }
    });
    host.appendChild(toggle);
  }
  host.hidden = false;
}

/**
 * The floor is the product. If the renderer cannot load, say so on screen
 * rather than presenting an empty canvas as if the floor were empty.
 * @param {unknown} err
 */
function showRendererError(err) {
  const host = el.canvas?.parentElement;
  if (!host) return;
  const note = document.createElement('p');
  note.className = 'renderer-error';
  note.setAttribute('role', 'alert');
  note.textContent =
    'The floor renderer failed to load, so the office is not being drawn. The queue, the panel ' +
    'and every action still work. Details are in the browser console.';
  host.appendChild(note);
  console.error('[deckhq] renderer error', err);
}

/**
 * The needs-you queue, oldest first. docs/03-VISUAL-SPEC.md §8: `J`/`K` walk
 * this queue. "Oldest" is the moment the agent entered its current
 * attention-needing state (reviewSince / needsInputSince), falling back to
 * the last time it produced output for `stalled`, which has no dedicated
 * timestamp in the Agent model.
 *
 * WP-10 moved the ordering itself into ./deck.js so the floor's `J`/`K`, the
 * queue strip and the deck cannot disagree about which item is next — and so
 * one test can pin all three against `deckhq ls`. That is also where the
 * grouping came from: `for_review` and `needs_input` now sort above `stalled`
 * (docs/plan/05-GUI-UX-SPEC.md §3.2), which is a change to what `J` lands on
 * next when a stall is the oldest thing on the floor.
 * @param {any} snapshot
 */
function getNeedsYouQueue(snapshot) {
  if (!snapshot) return [];
  return queueOrder(snapshot.agents, { projectFilter });
}

/**
 * Normalise `snapshot.degraded` into a list of degraded runtime ids.
 * CONTRACTS.md documents `snapshot()` returning a `degraded` field but does
 * not pin its exact shape. This accepts a boolean, an array of runtime ids,
 * or a map of runtime id -> boolean, so the header behaves correctly
 * whichever shape the daemon settles on. See the "spec gap" note in the
 * final report.
 * @param {unknown} degraded
 * @returns {string[]}
 */
function normalizeDegraded(degraded) {
  if (!degraded) return [];
  if (Array.isArray(degraded)) return degraded.filter(Boolean).map(String);
  if (typeof degraded === 'boolean') return degraded ? ['unknown'] : [];
  if (typeof degraded === 'object') {
    return Object.keys(degraded).filter((k) => Boolean(/** @type {any} */ (degraded)[k]));
  }
  return [];
}

/** A short local summary, used as a fallback when Scene.describeFloor is unavailable. @param {any} s */
function localDescribeFloor(s) {
  if (!s) return 'Floor loading.';
  const c = s.counts || {};
  const drawn = c.drawn || {};
  return (
    `${formatNumber(c.needsYou)} sessions need you: ` +
    `${formatNumber(c.handsUp)} hands up, ${formatNumber(c.stalled)} stalled, ` +
    `${formatNumber(c.forReview)} for review. ` +
    `${formatNumber(drawn.atDesk ?? c.atDesk)} at their desks, ` +
    `${formatNumber(drawn.benched ?? c.benched)} benched.`
  );
}

/**
 * Ask Scene for a human summary of the floor, for the aria-live
 * announcement and the canvas aria-label. CONTRACTS.md's Scene class
 * listing does not include `describeFloor`, so this tries every plausible
 * shape (a static method on the class, an instance method, or a plain named
 * export alongside Scene in the module) before falling back to a
 * locally-composed summary. See the "spec gap" note in the final report.
 * @param {any} snapshot
 */
function describeFloor(snapshot) {
  try {
    const SceneCtor = scene?.constructor;
    if (SceneCtor && typeof SceneCtor.describeFloor === 'function') {
      return SceneCtor.describeFloor(snapshot);
    }
    if (scene && typeof scene.describeFloor === 'function') {
      return scene.describeFloor(snapshot);
    }
    if (sceneModule && typeof sceneModule.describeFloor === 'function') {
      return sceneModule.describeFloor(snapshot);
    }
  } catch {
    /* fall through to the local summary */
  }
  return localDescribeFloor(snapshot);
}

// ------------------------------------------------------------- rendering

function renderHeader(snapshot) {
  const c = snapshot.counts || {};
  el.needsYou.textContent = formatNumber(c.needsYou);
  el.needsYouTotal.classList.toggle('is-zero', !c.needsYou);
  el.handsUp.textContent = formatNumber(c.handsUp);
  el.stalled.textContent = formatNumber(c.stalled);
  el.forReview.textContent = formatNumber(c.forReview);
  // The floor counts describe what the floor DRAWS (WP-55, docs/DEVIATIONS.md
  // §106). "at desk" was `placement() === 'desk'`, which counts a finished
  // session sitting in a repo nobody is working in — on the reference machine
  // that read "21 at desk" over a floor drawing two. The sessions that are not
  // drawn are named rather than folded in: they are still in the panel, still
  // in the deck, and still one keystroke away. `drawn` is absent from a
  // snapshot pushed by an older daemon, in which case the old numbers stand.
  const drawn = c.drawn || {};
  el.atDesk.textContent = formatNumber(drawn.atDesk ?? c.atDesk);
  el.benched.textContent = formatNumber(drawn.benched ?? c.benched);
  el.finished.textContent = formatNumber(drawn.finished);
  el.finishedWrap.hidden = !drawn.finished;
  el.wentHome.textContent = formatNumber(drawn.wentHome);
  el.wentHomeWrap.hidden = !drawn.wentHome;

  document.title = c.needsYou > 0 ? `(${formatNumber(c.needsYou)}) DeckHQ` : 'DeckHQ';
  // WP-16 · begin — the dock/taskbar badge of an installed DeckHQ. Unsupported
  // or refused degrades to the tab title above, silently.
  setAppBadge(c.needsYou);
  // WP-16 · end

  const degradedRuntimes = normalizeDegraded(snapshot.degraded);
  el.degradedBanner.hidden = degradedRuntimes.length === 0;

  // A store that cannot write is quietly throwing away every acknowledgement
  // as soon as the daemon restarts. Never let that be silent.
  const writeError = snapshot.writeError;
  el.writeErrorBanner.hidden = !writeError;
  if (writeError) {
    el.writeErrorText.textContent =
      `DeckHQ cannot save your acknowledgements to ${writeError.file} ` +
      `(${writeError.message}). They will be lost when it restarts. ` +
      'Set DECKHQ_STATE_DIR to a writable directory and start it again.';
  }

  // The motion override is a setting the stylesheet reads off the root
  // element, so it has to be re-applied whenever settings arrive — including
  // from another tab.
  applyMotionPreference(snapshot.settings?.reducedMotion);

  const summary = describeFloor(snapshot);
  el.canvas.setAttribute('aria-label', `Office floor. ${summary}`);
  announce(summary);
}

function renderFloorState(snapshot) {
  const hasAgents = Array.isArray(snapshot.agents) && snapshot.agents.length > 0;
  el.floorSkeleton.hidden = true;
  el.errorBanner.hidden = true;
  // A machine with no sessions gets the actors from the daemon, so the
  // never-run case is a populated floor with one line under it rather than a
  // blank screen (WP-13). `empty-state` is now only reachable when the
  // renderer has nothing at all to draw — which the demo fixture makes
  // essentially unreachable, and it is kept because "essentially" is not
  // "provably".
  el.emptyState.hidden = hasAgents;
  el.canvas.hidden = !hasAgents;
  el.demoNote.hidden = !snapshot.demo || !hasAgents;
  if (snapshot.demo && snapshot.demoNote) el.demoNote.textContent = snapshot.demoNote;
  if (scene) {
    try {
      scene.setState(snapshot);
    } catch (err) {
      console.warn('[deckhq] Scene.setState failed', err);
    }
  }
}

// ---------------------------------------------------------- notifications

/**
 * Diff the previous snapshot's per-agent activityState against the new one
 * and fire a notification only for agents that just *entered* needs_input
 * or for_review. Never fires for an agent that was already in one of those
 * states, and never fires on a snapshot that changes nothing for an agent
 * (state refresh with no transition). docs/03-VISUAL-SPEC.md §9.
 * @param {any} snapshot
 */
function diffAndNotify(snapshot) {
  const settings = snapshot.settings || {};
  const entered = [];
  // WP-15 §8's two entry sounds. Tracked separately from the notification
  // batch because they answer to different switches: a sound plays for an
  // entry the OS notification is *not* covering, and the per-state
  // notification switches must not silence it. One of each per snapshot at
  // most — three doors closing together is one door.
  let enteredForReview = false;
  let enteredNeedsInput = false;
  for (const agent of snapshot.agents) {
    if (agent.ackState !== 'active') continue;
    const prev = prevActivityStates.get(agent.id);
    if (prev !== agent.activityState) {
      if (agent.activityState === 'for_review') enteredForReview = true;
      if (agent.activityState === 'needs_input') enteredNeedsInput = true;
    }
    // Both the state's own switch and the master switch have to be on. A
    // state whose switch is off is still tracked below, so turning it back on
    // does not then fire for everything that entered while it was off.
    const stateSetting = NOTIFY_ON_ENTRY[agent.activityState];
    const isAttentionState = Boolean(stateSetting) && settings[stateSetting] !== false;
    const justEntered = isAttentionState && prev !== agent.activityState;
    if (justEntered) {
      // A notification title is a compact place, so it carries the label
      // (display name if set, else the MK tag) rather than the full session
      // title — CONTRACTS-WP15.md §1 / WP15 task B.
      entered.push({
        id: agent.id,
        label: agent.label || agent.mk || agent.title,
        projectName: agent.projectName,
      });
    }
  }
  prevActivityStates = new Map(snapshot.agents.map((a) => [a.id, a.activityState]));
  if (entered.length > 0) queueNotification(entered);

  // A hand going up outranks a door closing: both in one snapshot means
  // somebody is blocked *and* somebody finished, and the blocked one is the
  // interrupting event (`04` §6). The scheduler would drop the second anyway;
  // this decides which one it drops.
  if (enteredNeedsInput) sounds.play('knock', { notified: lastNotifyShown });
  else if (enteredForReview) sounds.play('door', { notified: lastNotifyShown });
}

/** @param {{id:string,label:string,projectName:string}[]} enteredAgents */
function queueNotification(enteredAgents) {
  pendingNotifyBatch.push(...enteredAgents);
  const elapsed = Date.now() - lastNotifyAt;
  if (elapsed >= NOTIFY_COALESCE_MS) {
    flushNotification();
  } else if (!notifyCoalesceTimer) {
    notifyCoalesceTimer = setTimeout(flushNotification, NOTIFY_COALESCE_MS - elapsed);
  }
}

function flushNotification() {
  clearTimeout(notifyCoalesceTimer);
  notifyCoalesceTimer = null;
  if (pendingNotifyBatch.length === 0) return;
  lastNotifyAt = Date.now();
  const batch = pendingNotifyBatch;
  pendingNotifyBatch = [];
  showNotification(batch);
}

/**
 * Show exactly one OS notification for a (possibly coalesced) batch.
 * Denied or unavailable permission degrades silently to the tab badge —
 * the title/badge is kept current elsewhere regardless of permission.
 * @param {{id:string,label:string,projectName:string}[]} batch
 */
function showNotification(batch) {
  // Whether the OS actually said it is what WP-15's §8 rule turns on: a
  // hidden tab is silent only when the notification is doing the work.
  // Declining permission, or turning notifications off, is exactly when the
  // sound is the only signal there is — so this is recorded from what
  // happened, never assumed from what was requested.
  lastNotifyShown = false;
  if (!('Notification' in window)) return;
  // The master switch in the settings sheet. Off means the tab badge and the
  // floor carry the signal and the OS is left alone.
  if (latestSnapshot?.settings?.notifications === false) return;
  if (Notification.permission !== 'granted') return;
  try {
    let notification;
    if (batch.length === 1) {
      const a = batch[0];
      notification = new Notification(a.label, { body: `${a.projectName} · needs you` });
    } else {
      notification = new Notification('DeckHQ', { body: `${batch.length} sessions need you` });
    }
    lastNotifyShown = true;
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        /* some embedders disallow this; ignore */
      }
      selectAgent(batch[0].id);
      notification.close();
    };
  } catch (err) {
    // Never let a notification failure surface as a console error the user
    // has to puzzle over — it degrades to the tab badge, silently.
    console.debug('[deckhq] notification suppressed', err);
  }
}

/**
 * Turn OS notifications on or off. Turning them on while the browser has
 * never been asked also requests permission — from the palette, which is an
 * explicit user gesture, never unprompted on load. Denied permission is not
 * an error to shout about: the tab badge and the floor still carry the count,
 * so the setting is saved either way and the toast says what happened.
 * @param {boolean} next
 */
async function setNotifications(next) {
  if (next && 'Notification' in window && Notification.permission === 'default') {
    try {
      await Notification.requestPermission();
    } catch (err) {
      console.debug('[deckhq] notification permission request failed', err);
    }
  }
  await saveSetting({ notifications: next });
  if (!next) {
    toast('Notifications off. The tab badge and the floor still show the count.');
  } else if (!('Notification' in window)) {
    toast('This browser has no notifications. The tab badge still shows the count.');
  } else if (Notification.permission === 'granted') {
    toast('Notifications on.');
  } else {
    toast('Notifications on, but this browser has them blocked for DeckHQ.');
  }
}

/**
 * The one place the client writes settings outside the settings sheet: the
 * palette's toggles.
 * @param {Record<string, unknown>} patch
 */
async function saveSetting(patch) {
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const settings = await res.json();
    if (latestSnapshot) latestSnapshot.settings = settings;
    applyMotionPreference(settings.reducedMotion);
    return settings;
  } catch (err) {
    toast(`Could not save that setting: ${err.message}`, { isError: true });
    return null;
  }
}

// WP-16 · begin ------------------------------------------------------- PWA
//
// Three things, and nothing else lives in this file for this package: the
// manifest link (index.html), the badge call (renderHeader above), and the
// registration below. The service worker itself is public/sw.js and caches
// nothing; the daemon's own OS notifications are src/core/notify-watch.mjs.
//
// The point of all of it: an installed DeckHQ keeps the needs-you count on
// the dock icon when the tab, and the window, are gone.
// docs/plan/08-PLAN-V2-100X.md §1.2, §14.

/**
 * Put the needs-you count on the app icon. Every browser that lacks the
 * Badging API, and every window that is not installed, silently does nothing
 * — the tab title carries the same number either way.
 * @param {number} count
 */
function setAppBadge(count) {
  try {
    const n = Number(count) || 0;
    if (n > 0) navigator.setAppBadge?.(n);
    else navigator.clearAppBadge?.();
  } catch {
    /* an unsupported or refused badge is not an error the user can act on */
  }
}

/** Register the service worker. Failure costs installability and nothing else. */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js', { scope: '/' }).catch((err) => {
    console.debug('[deckhq] service worker not registered', err);
  });
}

registerServiceWorker();
// WP-16 · end ---------------------------------------------------------------

// --------------------------------------------------------------- actions

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
function selectAgent(id, opts = {}) {
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
function selectNextGoneHome() {
  const ids = scene && typeof scene.goneHomeAgentIds === 'function' ? scene.goneHomeAgentIds() : [];
  if (ids.length === 0) return;
  const at = ids.indexOf(selectedId);
  selectAgent(ids[(at + 1) % ids.length]);
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

/**
 * The same three-way rule the stylesheet uses (`05` §5.4, §9): an explicit
 * setting wins, otherwise the OS decides.
 */
function prefersReducedMotion() {
  const mode = latestSnapshot?.settings?.reducedMotion;
  if (mode === 'reduce') return true;
  if (mode === 'no-preference') return false;
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ------------------------------------------------------ the office snapshot

/**
 * Whether `S` redacts. A property of this tab, not of the machine — the same
 * reasoning as `letGoVisible`: "am I about to screenshot this for people who
 * cannot see my project names" is a decision about the next keystroke, not a
 * preference to persist. `Shift+S` toggles it and says so.
 */
let redactSnapshots = false;

/** Cached `/api/about`. The hostname is the only field `S` needs, and it never changes. */
let aboutCache = null;
async function about() {
  if (aboutCache) return aboutCache;
  try {
    const res = await fetch('/api/about');
    if (res.ok) aboutCache = await res.json();
  } catch (err) {
    console.debug('[deckhq] /api/about unavailable', err);
  }
  return aboutCache || {};
}

/** True while a capture is running, so holding `S` down cannot start twenty. */
let capturing = false;

/**
 * `S` — composite the floor and a stat strip into a PNG, put it on the
 * clipboard, and save it. WP-14 /
 * `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §3.2.
 *
 * The redaction path is the interesting part. Project names are on the room
 * plates, which the renderer paints from the snapshot it was last given — and
 * `public/render/**` belongs to another package, so there is no "give me a
 * redacted frame" entry point to call. There is, however, `Scene.setState`,
 * which is public and is exactly "draw this". So: stop the loop, hand the
 * renderer the redacted snapshot (which it draws synchronously while stopped),
 * capture, hand back the real one, restart. Redaction therefore covers the
 * plates as well as the strip, which is what §3.2 asks for and what a control
 * called "redact" has to mean.
 *
 * Stopping the loop first is also what makes this work in a backgrounded tab:
 * a stopped Scene draws on `setState` rather than on the next frame, and
 * `pngBytes` is synchronous, so no part of the capture waits for a
 * `requestAnimationFrame` that a hidden tab will never fire.
 */
async function takeSnapshot() {
  if (capturing) return;
  if (!latestSnapshot) return;
  if (el.canvas.hidden) {
    toast('There is no floor to photograph yet.', { isError: true });
    return;
  }
  capturing = true;
  const wasRunning = Boolean(scene) && !document.hidden;
  try {
    const { hostname } = await about();
    const model = snapshotModel(latestSnapshot, { hostname, redact: redactSnapshots });

    if (scene && redactSnapshots) {
      try {
        scene.stop();
        scene.setState(model.source);
      } catch (err) {
        console.warn('[deckhq] could not redact the floor for the snapshot', err);
        // Never ship a picture that claims to be redacted and is not.
        toast('Could not redact the floor, so nothing was captured.', { isError: true });
        return;
      }
    }

    const colors = stripColors(document);
    // The floor's own backing scale. Read here rather than inside the
    // compositor because a hidden tab reports no layout at all, so the
    // backing store plus this ratio is the only description of the floor's
    // size that survives being backgrounded.
    const dpr = window.devicePixelRatio || 1;
    let scale = Math.max(MIN_SCALE, Math.round(dpr));
    let bytes = null;
    for (;;) {
      const out = composite({ floor: el.canvas, model, scale, dpr, colors, ...snapshotFonts() });
      bytes = pngBytes(out);
      if (bytes.length <= MAX_PNG_BYTES) break;
      const next = nextScaleDown(scale);
      if (next === null || next === scale) break;
      scale = next;
    }

    const oversize = bytes.length > MAX_PNG_BYTES;
    const copied = await copyPng(bytes);
    const saved = await saveSnapshot(bytes);
    reportSnapshot({ copied, saved, oversize, bytes: bytes.length });
  } finally {
    // Whatever happened, the floor goes back to showing the truth.
    if (scene && redactSnapshots) {
      try {
        scene.setState(latestSnapshot);
        if (wasRunning) scene.start();
      } catch (err) {
        console.warn('[deckhq] could not restore the floor after a snapshot', err);
      }
    }
    capturing = false;
  }
}

/** The two faces the strip uses, taken from the stylesheet rather than restated. */
function snapshotFonts() {
  let style;
  try {
    style = getComputedStyle(document.documentElement);
  } catch {
    return {};
  }
  return {
    fontSans: style.getPropertyValue('--font-sans').trim() || undefined,
    fontMono: style.getPropertyValue('--font-mono').trim() || undefined,
  };
}

/**
 * Put the PNG on the clipboard. Refused permission, an unfocused tab and a
 * browser without `ClipboardItem` all degrade to `false` rather than throwing:
 * the file on disk is the durable half, and the toast says which half landed.
 * `Uint8Array<ArrayBuffer>` rather than a bare `Uint8Array`: a `Blob` cannot be
 * built from a view over a `SharedArrayBuffer`, and the PNG encoder never
 * produces one (WP-22).
 * @param {Uint8Array<ArrayBuffer>} bytes
 */
async function copyPng(bytes) {
  try {
    if (!navigator.clipboard || typeof ClipboardItem !== 'function') return false;
    const blob = new Blob([bytes], { type: 'image/png' });
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch (err) {
    console.debug('[deckhq] clipboard write refused', err);
    return false;
  }
}

/**
 * POST the bytes to the daemon, which names the file and writes it.
 * @param {Uint8Array<ArrayBuffer>} bytes
 * @returns {Promise<string|null>} the path written, or null
 */
async function saveSnapshot(bytes) {
  try {
    const res = await fetch('/api/snapshot', {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: bytes,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    return body.file || null;
  } catch (err) {
    console.debug('[deckhq] snapshot save failed', err);
    return null;
  }
}

/** One toast that says exactly what happened, in the order the user cares about. */
function reportSnapshot({ copied, saved, oversize, bytes }) {
  const mb = (bytes / (1024 * 1024)).toFixed(1);
  const what = redactSnapshots ? 'Redacted snapshot' : 'Snapshot';
  if (!copied && !saved) {
    toast(`${what} could not be copied or saved.`, { isError: true });
    return;
  }
  const parts = [];
  if (copied) parts.push('on the clipboard');
  if (saved) parts.push(`saved to ${saved}`);
  const tail = oversize ? ` It is ${mb} MB, over the 2 MB target.` : '';
  toast(`${what} ${parts.join(' and ')}.${tail}`);
}

// -------------------------------------------- lights out: the day's card
//
// WP-18 (the daily postcard) and WP-27 (Wrapped). One surface, two fillings;
// `public/postcard.js` and `public/wrapped.js` decide *what* it says and this
// file decides *when* and paints it.
//
// The whole design constraint is in `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md`
// §3.3: Stardew Valley's day-end save, "an ending, not a demand". So: once per
// local day at most, one keystroke or one click to dismiss, and it never comes
// back on its own. §6's interruption budget already counts this as an in-app
// event with no notification and no sound attached, and nothing here plays one.

/** @type {{kind:'postcard'|'wrapped', model:any, name:string}|null} */
let openCard = null;
/** True while a card is being fetched, so two snapshots cannot race one open. */
let cardLoading = false;
/** After a failed fetch, do not hammer the daemon on every snapshot. */
let cardRetryAfter = 0;

/**
 * Project names replaced by their MK tags, for the redacted card.
 *
 * The ledger holds project *hashes* and the route resolves them to names by
 * hashing the cwds the registry holds — so a card's `projects` map is
 * `{hash: name}`. Redaction here is therefore a second lookup, name to MK,
 * through the floor this tab already has. A key the floor cannot name stays
 * unresolved and the copy falls back to six characters of the hash, which
 * carries nothing (`docs/DEVIATIONS.md` §100 decision 5).
 *
 * @param {Record<string,string>|undefined} projects
 * @returns {Record<string,string>}
 */
function redactProjectNames(projects) {
  /** @type {Record<string,string>} */
  const out = {};
  const byName = new Map();
  for (const p of latestSnapshot?.projects || []) {
    if (p.name) byName.set(p.name, p.mk || `MK${p.projectMk ?? ''}` || 'MK');
  }
  for (const [key, name] of Object.entries(projects || {})) {
    out[key] = byName.get(name) || 'MK';
  }
  return out;
}

/**
 * Paint a card and dim the floor behind it.
 *
 * `announce` carries the whole card to a screen reader in one string, because
 * a region that appears silently is a card that half the audience never gets.
 *
 * @param {'postcard'|'wrapped'} kind
 * @param {{title:string, subtitle?:string, rows:{label?:string|null, value:string}[], footer?:string}} model
 * @param {string} name what a saved PNG is about, for the toast
 */
function showCard(kind, model, name) {
  openCard = { kind, model, name };

  el.nightcardTitle.textContent = model.title;
  el.nightcardSub.textContent = model.subtitle || '';
  el.nightcardSub.hidden = !model.subtitle;

  el.nightcardRows.textContent = '';
  for (const row of model.rows || []) {
    const line = document.createElement('div');
    line.className = row.label ? 'nightcard-row has-label' : 'nightcard-row';
    if (row.label) {
      const label = document.createElement('span');
      label.className = 'nightcard-label';
      label.textContent = row.label;
      line.appendChild(label);
    }
    const value = document.createElement('span');
    value.textContent = row.value;
    line.appendChild(value);
    el.nightcardRows.appendChild(line);
  }

  el.nightcardFoot.textContent = model.footer || '';
  el.nightcardFoot.hidden = !model.footer;
  el.nightcardHint.textContent = 'Esc or click to dismiss · S saves it as a PNG';

  el.nightcard.hidden = false;
  el.nightOverlay.hidden = false;
  // Two frames' worth of delay so the fade has a start state, exactly as the
  // office-cleared line does. Reduced motion neutralises the transition in
  // the stylesheet and the dim simply arrives.
  setTimeout(() => el.nightOverlay.classList.add('is-shown'), 20);

  announce(
    [
      model.title,
      model.subtitle,
      ...(model.rows || []).map((r) => `${r.label ? `${r.label}: ` : ''}${r.value}`),
    ]
      .filter(Boolean)
      .join('. '),
  );
}

/** One keystroke, one click, and it is gone. Dismissing costs nothing (§3.3). */
function dismissCard() {
  if (!openCard) return false;
  openCard = null;
  el.nightcard.hidden = true;
  el.nightOverlay.classList.remove('is-shown');
  el.nightOverlay.hidden = true;
  return true;
}

/**
 * The daily postcard. `manual` is the palette's "Today's card", which shows it
 * again without changing whether the automatic one has been spent — asking for
 * something is not the same as being interrupted by it.
 * @param {{manual?:boolean, day?:string}} [opts]
 */
async function openPostcard(opts = {}) {
  if (cardLoading) return;
  cardLoading = true;
  try {
    const now = Date.now();
    // The card is about the local day, so the window starts at local midnight
    // — the same boundary the ledger rolls on (`docs/DEVIATIONS.md` §100
    // decision 2), which is what makes the two agree.
    const res = await fetch(`/api/stats?since=${startOfDay(now)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const stats = await res.json();
    if (redactSnapshots) stats.projects = redactProjectNames(stats.projects);
    const copy = postcardCopy({ stats, snapshot: latestSnapshot, now });
    showCard(
      'postcard',
      {
        title: `${copy.weekday}.`,
        subtitle: '',
        rows: copy.lines.map((value) => ({ label: null, value })),
        footer: '',
      },
      'card',
    );
    if (!opts.manual) await saveSetting({ postcardDay: opts.day || copy.day });
  } catch (err) {
    console.debug('[deckhq] the day’s card could not be built', err);
    cardRetryAfter = Date.now() + 60_000;
    if (opts.manual) toast('Could not read the ledger for today’s card.', { isError: true });
  } finally {
    cardLoading = false;
  }
}

/**
 * Wrapped, weekly or annual.
 * @param {'week'|'annual'} kind
 * @param {{manual?:boolean, key?:string}} [opts]
 */
async function openWrapped(kind, opts = {}) {
  if (cardLoading) return;
  cardLoading = true;
  try {
    const res = await fetch(`/api/wrapped?kind=${encodeURIComponent(kind)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (redactSnapshots) body.projects = redactProjectNames(body.projects);
    showCard('wrapped', wrappedCopy(body), 'wrapped');
    // The server's key wins: it is the one that computed the window.
    if (!opts.manual) await saveSetting({ wrappedShown: body.key || opts.key || '' });
  } catch (err) {
    console.debug('[deckhq] Wrapped could not be built', err);
    cardRetryAfter = Date.now() + 60_000;
    if (opts.manual) toast('Could not read the ledger for Wrapped.', { isError: true });
  } finally {
    cardLoading = false;
  }
}

/**
 * Is a card due? Called once per snapshot, which is every poll.
 *
 * Wrapped outranks the postcard on a Monday evening: one card a day is the
 * budget, and the week is the bigger thing to have missed.
 */
function maybeShowNightCard() {
  if (openCard || cardLoading || !latestSnapshot) return;
  // The actors are not real sessions, so their day is not a day (WP-13).
  if (latestSnapshot.demo) return;
  const now = Date.now();
  if (now < cardRetryAfter) return;
  const settings = latestSnapshot.settings || {};

  const wrapped = wrappedDue({ now, shownKey: settings.wrappedShown });
  if (wrapped.kind) {
    openWrapped(wrapped.kind, { key: wrapped.key });
    return;
  }

  const out = lightsOut({
    now,
    lightsOutHour: settings.lightsOutHour,
    shownDay: settings.postcardDay,
    liveCount: (latestSnapshot.agents || []).filter((a) => a.live).length,
  });
  if (out.show) openPostcard({ day: out.day });
}

/**
 * `S` while a card is up: the card, plus a small photograph of the floor it is
 * about, as one PNG — on the clipboard and saved beside every other snapshot.
 *
 * It goes through the same compositor and the same route as `S` on the floor
 * (WP-14), so redaction, the size budget, the resolution floor and the
 * daemon-names-the-file rule are all the ones already tested in
 * `docs/DEVIATIONS.md` §109 rather than a second implementation of each.
 */
async function saveCard() {
  if (!openCard || capturing) return;
  capturing = true;
  const wasRunning = Boolean(scene) && !document.hidden;
  try {
    if (scene && redactSnapshots) {
      try {
        scene.stop();
        scene.setState(snapshotModel(latestSnapshot, { redact: true }).source);
      } catch (err) {
        console.warn('[deckhq] could not redact the floor for the card', err);
        toast('Could not redact the floor, so nothing was captured.', { isError: true });
        return;
      }
    }
    const colors = stripColors(document);
    const dpr = window.devicePixelRatio || 1;
    let scale = Math.max(MIN_SCALE, Math.round(dpr));
    let bytes = null;
    for (;;) {
      const out = compositeCard({
        floor: el.canvas.hidden ? null : el.canvas,
        model: openCard.model,
        scale,
        dpr,
        colors,
        ...snapshotFonts(),
      });
      bytes = pngBytes(out);
      if (bytes.length <= MAX_PNG_BYTES) break;
      const next = nextScaleDown(scale);
      if (next === null || next === scale) break;
      scale = next;
    }
    const oversize = bytes.length > MAX_PNG_BYTES;
    const copied = await copyPng(bytes);
    const saved = await saveSnapshot(bytes);
    reportSnapshot({ copied, saved, oversize, bytes: bytes.length });
  } finally {
    if (scene && redactSnapshots) {
      try {
        scene.setState(latestSnapshot);
        if (wasRunning) scene.start();
      } catch (err) {
        console.warn('[deckhq] could not restore the floor after a card', err);
      }
    }
    capturing = false;
  }
}

// One click on the card dismisses it. The overlay behind it deliberately does
// NOT take the pointer: the floor stays clickable underneath, so a card that
// arrives while somebody is mid-thought costs them nothing.
el.nightcard.addEventListener('click', () => dismissCard());

/** `Shift+S`. A toggle that says which way it went, because the next `S` acts on it. */
function toggleRedaction() {
  redactSnapshots = !redactSnapshots;
  toast(
    redactSnapshots
      ? 'Redaction on. S swaps every project name for its MK tag, on the floor and in the strip.'
      : 'Redaction off. S shows project names.',
  );
}

// -------------------------------------------------------------- keyboard

/**
 * Which agent the action keys act on.
 *
 * On the floor that is the panel's own selection and the panel decides for
 * itself, so this passes nothing. In the deck it is the row under the cursor,
 * which is very often not the row the panel is showing: WP-10's whole point is
 * that `1`, `2` and `3` clear an item without opening it first
 * (docs/plan/05-GUI-UX-SPEC.md §3.2).
 * @returns {string|null}
 */
function keyTarget() {
  return deckUI?.isOpen() ? deckUI.cursor() : null;
}

/**
 * The whole floor keyboard map, docs/03-VISUAL-SPEC.md §8. Deliberately
 * inert whenever focus is inside a text control (the composer or any
 * `<input>`/`<textarea>`/contenteditable), or while a modal `<dialog>` is
 * open, so typing "j" into a message never benches an agent.
 * @param {KeyboardEvent} e
 */
function handleKeydown(e) {
  const target = /** @type {HTMLElement|null} */ (e.target);
  const tag = target?.tagName;
  const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || Boolean(target?.isContentEditable);
  if (isTyping) return;
  if (document.querySelector('dialog[open]')) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  // `Tab` toggles the floor and the deck (§3.2) — but Tab is also how a
  // keyboard user moves between controls, and taking it globally would strand
  // them. It is claimed only while focus is on the floor itself (the canvas,
  // the stage, the deck) or on nothing in particular, and never with Shift
  // held, so tabbing out of the deck, the strip, the header or the panel keeps
  // working exactly as it did. Shift+Tab is always the browser's.
  if (e.key === 'Tab' && !e.shiftKey) {
    const active = /** @type {HTMLElement|null} */ (document.activeElement);
    const onFloor = !active || active === document.body || Boolean(active.closest?.('.stage'));
    if (!onFloor) return;
    deckUI?.toggle();
    e.preventDefault();
    return;
  }

  // In the deck, `Enter` is what opens a row; `J`/`K` only move the cursor.
  if (e.key === 'Enter' && deckUI?.isOpen()) {
    deckUI.openCursor();
    e.preventDefault();
    return;
  }

  switch (e.key) {
    case 'Escape':
      // The day's card is the topmost thing there is (WP-18): §3.3 promises
      // that dismissing it costs one keystroke, so it takes Escape ahead of
      // everything, and a second Escape does whatever it would have done.
      if (dismissCard()) break;
      // The whiteboard overlay is the most transient thing on screen — a
      // second Esc still deselects, but the first one only ever closes
      // whatever is topmost. docs' whiteboard note: "closes ... on Esc".
      if (!el.whiteboardOverlay.hidden) {
        hideWhiteboard();
        break;
      }
      selectAgent(null);
      break;
    // One queue, walked the same way on all three levels (§3): the floor's
    // ring, the strip's chip and the deck's row are the same selection, in
    // the same oldest-first order, moved by the same code.
    case 'j':
    case 'J':
      deckUI?.move(1);
      break;
    case 'k':
    case 'K':
      deckUI?.move(-1);
      break;
    case 'a':
    case 'A':
      // Explicit keyboard action, equivalent in kind to a button press —
      // routed through panel.performAction(), the single funnel for
      // /api/ack calls. Never wired from render or selection code. In the
      // deck it names the cursor row, which is where the user is looking.
      panel.performAction('acknowledge', keyTarget());
      break;
    case 'b':
    case 'B':
      panel.performAction('bench', keyTarget());
      break;
    // The floor stops drawing a benched agent that has been quiet for longer
    // than `settings.goneHomeDays` (WP-50 / `08` B6, "N went home" on the
    // lounge plate). Nothing about their state changed — only whether they are
    // drawn — so they stay reachable: `g` selects them one at a time, newest
    // activity first, and opens the panel on each exactly as a click would.
    case 'g':
    case 'G':
      selectNextGoneHome();
      break;
    // The office snapshot (WP-14). `Shift+S` decides what the next `S`
    // contains; the shift key is read explicitly rather than inferred from
    // the case of `e.key`, so caps lock does not silently swap them.
    case 's':
    case 'S':
      if (e.shiftKey) toggleRedaction();
      // With the day's card up, `S` saves the card — the card plus a small
      // photograph of the floor it is about — rather than the floor alone.
      // It is the thing on the screen, so it is the thing the key is about.
      else if (openCard) saveCard();
      else takeSnapshot();
      break;
    // The review card's weighted actions (docs/plan/05-GUI-UX-SPEC.md §4.2):
    // 1 focuses the composer, 2 approves (a send), 3 benches. On the floor
    // the panel ignores them while it is closed; in the deck they act on the
    // cursor row without opening it (§3.2). The `isTyping` guard above keeps
    // them inert while the composer has focus.
    case '1':
    case '2':
    case '3':
      panel.pressNumberKey(e.key, keyTarget());
      break;
    // Magnification (VISUAL-SPEC §1, 05-LAYOUT-REWORK.md §2.4). `0` returns
    // to fit, which is also the minimum — there is no zooming out past the
    // whole floor.
    case '+':
    case '=':
      if (scene) scene.zoomBy(ZOOM_KEY_STEP);
      break;
    case '-':
    case '_':
      if (scene) scene.zoomBy(1 / ZOOM_KEY_STEP);
      break;
    case '0':
      if (scene) scene.resetZoom();
      break;
    // WP-39's floating mini-floor: the office, the corridor beside it and the
    // count, over the terminal (`08` B3). The palette's "Float the office" is
    // the other way in. Not awaited — the module is loaded on demand and a
    // slow import must not hold the key map.
    case 'p':
    case 'P':
      floatOffice();
      break;
    default:
      return;
  }
  e.preventDefault();
}

// ---------------------------------------------------------------- hover

let lastMouse = { x: 0, y: 0 };

/**
 * Position a floating overlay (tooltip or whiteboard) near the cursor,
 * clamped to stay inside the viewport. Shared so both read the same mouse
 * tracking and clamp the same way.
 * @param {HTMLElement} node
 * @param {number} maxW approx overlay width budget, for the right/bottom clamp
 */
function placeNearCursor(node, maxW) {
  const x = Math.min(lastMouse.x + 14, window.innerWidth - maxW);
  const y = Math.min(lastMouse.y + 14, window.innerHeight - 90);
  node.style.left = `${Math.max(0, x)}px`;
  node.style.top = `${Math.max(0, y)}px`;
}

/**
 * The rarity word for one agent, or null — for a common agent (most of them),
 * and for as long as `render/palette.js` has not loaded, since that import is
 * dynamic and defensive (see the file header). Absent rather than wrong is the
 * right failure: the word is a grace note, not information the user needs.
 * @param {any} agent
 * @returns {string|null}
 */
function rarityWordFor(agent) {
  if (!agent || !palette?.appearanceFor || !palette?.rarityWord) return null;
  try {
    return palette.rarityWord(palette.appearanceFor(agent.id).tier);
  } catch (err) {
    console.debug('[deckhq] rarityWord failed', err);
    return null;
  }
}

/** @param {string} text */
function tooltipLine(text) {
  const line = document.createElement('div');
  line.className = 'tooltip-line';
  line.textContent = text;
  return line;
}

/**
 * The hover tooltip is where identity detail lives (CONTRACTS-WP15.md §1,
 * WP15 task B): the answer to "what is MK3.2?" is the full session title,
 * project, model, branch, state, elapsed and tokens — all in one place, all
 * still minimal (no card, see the halo treatment in style.css).
 * @param {string|null} agentId
 */
function showTooltip(agentId) {
  if (!agentId) {
    el.tooltip.hidden = true;
    return;
  }
  const agent = findAgent(agentId);
  if (!agent) {
    el.tooltip.hidden = true;
    return;
  }
  el.tooltip.textContent = '';

  const title = document.createElement('div');
  title.className = 'tooltip-title';
  title.textContent = agent.title;
  el.tooltip.appendChild(title);

  // The MK tag always identifies the session; the name — the user's, or the
  // one the daemon gave on first sight (WP-20) — is what actually replaced it
  // on the floor, so both belong here. Then, for the minority of agents that
  // have one, the rarity word: one quiet adjective, never a number and never
  // a count of what the user has collected (docs/plan/08 §1.1 rule 6).
  const mk = agent.mk || agent.id;
  const name = agent.displayName || agent.givenName || null;
  const tag = document.createElement('div');
  tag.className = 'tooltip-tag';
  if (name) {
    const b = document.createElement('b');
    b.textContent = name;
    tag.appendChild(b);
    tag.appendChild(document.createTextNode(` · ${mk}`));
  } else {
    tag.textContent = mk;
  }
  const word = rarityWordFor(agent);
  if (word) {
    const rare = document.createElement('span');
    rare.className = 'tooltip-rarity';
    rare.dataset.tier = word;
    rare.textContent = word;
    // A real space, not only the CSS margin: a screen reader reads the text,
    // and "MK2.2rare" is one word to it.
    tag.append(' ', rare);
  }
  el.tooltip.appendChild(tag);

  el.tooltip.appendChild(
    tooltipLine(
      [agent.projectName, agent.model || 'unknown model', agent.gitBranch]
        .filter(Boolean)
        .join(' · '),
    ),
  );

  const elapsedMs =
    Date.now() - (agent.reviewSince ?? agent.needsInputSince ?? agent.lastActivityAt ?? Date.now());
  const elapsedMin = Math.max(0, Math.round(elapsedMs / 60000));
  el.tooltip.appendChild(
    tooltipLine(
      `${STATE_LABELS[agent.activityState] || agent.activityState} · ` +
        `${formatNumber(agent.tokens)} tokens · ${elapsedMin}m`,
    ),
  );

  // WP-46's grace note: the team's record, when this session or this room
  // holds one. Last, and in the same position the panel puts it in — a record
  // is context, never a call to action, and it never scores the reader
  // (`docs/plan/08` §1.1 rule 6, asserted in `records.test.mjs`).
  //
  // The stats body comes from the panel's own five-minute cache rather than a
  // second fetch, so the card and the panel cannot disagree about a record
  // while both are on screen. It is `null` until the first one resolves and
  // `recordLineFor` reads that as "no line", so a hover never waits on the
  // network. `docs/DEVIATIONS.md` §107 asked for exactly this.
  const record = recordLineFor(agent, panel.teamRecords());
  if (record) el.tooltip.appendChild(tooltipLine(record));

  el.tooltip.hidden = false;
  placeNearCursor(el.tooltip, 320);
}

// ------------------------------------------------------------- whiteboard
//
// ------------------------------------------------------- floor launchers
//
// Furniture is a verb. The shelf opens the project's folder; the screen runs
// its dashboard. The client sends only a project id and an action id — what
// that resolves to is decided by the daemon from the project's own directory,
// so a page can never hand the daemon a command to run.

/** @param {string} projectId */
async function revealProjectFolder(projectId) {
  try {
    const res = await fetch('/api/reveal', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    toast('Opened ' + body.cwd);
  } catch (err) {
    toast('Could not open that folder: ' + err.message, { isError: true });
  }
}

/** @param {string} projectId */
async function runProjectDashboard(projectId) {
  try {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, actionId: 'dashboard' }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    toast(body.ran ? body.ran : 'Started the dashboard');
  } catch (err) {
    toast('Could not run that: ' + err.message, { isError: true });
  }
}

// The floor's whiteboard prop reports { kind: 'whiteboard', id: projectId }
// through Scene's onHover/onSelect (CONTRACTS-WP15.md §4). This is purely a
// read of the current snapshot — never a fetch, never anything that could
// touch ackState (THE INVARIANT, docs/01-PRODUCT.md §2).

/** @param {string|null} projectId */
/**
 * The project board: the whiteboard on a project room's wall, opened.
 *
 * The floor answers "is anything waiting on me". This answers "what is this
 * project actually doing" — the numbers a team keeps written up where everyone
 * can see them, and the one place in the product that changes plane from
 * looking down at a room to standing in front of the thing on its wall.
 *
 * @param {string} projectId
 */
/**
 * Token counts as a board would have them written: `2.4M`, `840k`, `500`.
 * @param {number} n
 */
function compactTokens(n) {
  const v = Number(n) || 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${Math.round(v / 1000)}k`;
  return String(Math.round(v));
}

function showWhiteboard(projectId) {
  if (!projectId || !latestSnapshot) {
    hideWhiteboard();
    return;
  }
  const project = latestSnapshot.projects?.find((p) => p.id === projectId);
  if (!project) {
    hideWhiteboard();
    return;
  }

  const all = (latestSnapshot.agents || []).filter((a) => a.projectId === projectId);
  const count = (fn) => all.filter(fn).length;
  const stats = {
    total: all.length,
    working: count((a) => a.ackState === 'active' && a.activityState === 'working'),
    // The two "needs you" signals are deliberately separate on the floor
    // (a raised hand at a desk vs somebody standing in your office), so they
    // stay separate here.
    handsUp: count(
      (a) =>
        a.ackState === 'active' &&
        (a.activityState === 'needs_input' || a.activityState === 'stalled'),
    ),
    inOffice: count((a) => a.ackState === 'active' && a.activityState === 'for_review'),
    ended: count((a) => a.ackState === 'active' && a.activityState === 'ended'),
    benched: count((a) => a.ackState === 'benched'),
    archived: count((a) => a.ackState === 'let_go'),
  };
  const onFloor = all.filter((a) => a.ackState !== 'let_go');
  const tokens = onFloor.reduce((a, x) => a + (x.tokens || 0), 0);
  const cache = onFloor.reduce((a, x) => a + (x.cacheTokens || 0), 0);
  // `costEstimate` is `number|null`, and null means "the rate card has no row
  // for this model" (WP-26). Summing it with `|| 0` turned a room nobody can
  // price into a confident `$0.00` — a claim about the money that nothing in
  // the product had made. A room with no priceable session at all sums to
  // null and says "no rate"; one with some says what it can price, which is
  // the same rule `projects()` keeps with `costRated`.
  const rated = onFloor.some((a) => a.costEstimate != null && Number.isFinite(a.costEstimate));
  const cost = rated ? onFloor.reduce((a, x) => a + (x.costEstimate ?? 0), 0) : null;
  const money = boardCostParts(cost, latestSnapshot.rateCardVersion);
  const models = [...new Set(onFloor.map((a) => a.model).filter(Boolean))];

  const board = document.createElement('div');
  board.className = 'whiteboard-board';

  const head = document.createElement('div');
  head.className = 'whiteboard-head';
  const title = document.createElement('div');
  title.className = 'whiteboard-title';
  title.textContent = project.name;
  const sub = document.createElement('div');
  sub.className = 'whiteboard-sub';
  sub.textContent = [project.mk, models.join(', ')].filter(Boolean).join(' · ');
  head.append(title, sub);
  board.appendChild(head);

  const tiles = document.createElement('div');
  tiles.className = 'whiteboard-tiles';
  /** @param {string} label @param {string|number} value @param {string} [tone] */
  const tile = (label, value, tone) => {
    const el2 = document.createElement('div');
    el2.className = 'whiteboard-tile';
    if (tone) el2.dataset.tone = tone;
    const b = document.createElement('b');
    b.textContent = String(value);
    const span = document.createElement('span');
    span.textContent = label;
    el2.append(b, span);
    tiles.appendChild(el2);
  };
  tile('Sessions', stats.total);
  tile('Working', stats.working, 'working');
  tile('Hands up', stats.handsUp, stats.handsUp ? 'needs' : undefined);
  tile('In your office', stats.inOffice, stats.inOffice ? 'needs' : undefined);
  tile('Benched', stats.benched);
  tile('Finished', stats.ended);
  if (stats.archived) tile('Archived', stats.archived);
  // Compact on the tiles: a nine-digit cache figure does not fit one, and the
  // exact number is not what a board is for. The per-session rows below carry
  // the full figures.
  tile('Tokens', compactTokens(tokens));
  tile('Cache tokens', compactTokens(cache));
  tile('Est. cost', money.tile);
  board.appendChild(tiles);

  const heading = document.createElement('p');
  heading.className = 'whiteboard-section';
  heading.textContent = `Per session · ${onFloor.length} on the floor`;
  board.appendChild(heading);

  const sessions = [...onFloor].sort((a, b) => (b.tokens || 0) - (a.tokens || 0));
  for (const a of sessions) {
    const row = document.createElement('div');
    row.className = 'whiteboard-row';
    const left = document.createElement('span');
    left.textContent = a.label || a.mk || a.title || a.id;
    const state = document.createElement('em');
    state.textContent = ` ${STATE_LABELS[a.ackState === 'active' ? a.activityState : a.ackState] || ''}`;
    left.appendChild(state);
    const right = document.createElement('span');
    right.textContent = `${formatNumber(a.tokens || 0)} tok`;
    row.append(left, right);
    board.appendChild(row);
  }
  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'whiteboard-row';
    empty.textContent = 'No sessions on the floor';
    board.appendChild(empty);
  }

  const total = document.createElement('div');
  total.className = 'whiteboard-total';
  const totalLabel = document.createElement('span');
  totalLabel.textContent = 'Project total';
  const totalValue = document.createElement('span');
  totalValue.textContent = `${formatNumber(tokens)} tok · ${money.total}`;
  total.append(totalLabel, totalValue);
  board.appendChild(total);

  const hint = document.createElement('p');
  hint.className = 'whiteboard-hint';
  // The board's figures are only checkable if the table they came from is
  // named on the board. `rateCardVersion` rides in on every snapshot for
  // exactly this, so no surface has to fetch `/api/about` for a string.
  hint.textContent = money.note;
  board.appendChild(hint);

  el.whiteboardOverlay.textContent = '';
  el.whiteboardOverlay.appendChild(board);
  el.whiteboardOverlay.hidden = false;
}

function hideWhiteboard() {
  el.whiteboardOverlay.hidden = true;
}

// ------------------------------------------------------------ networking

/** @param {any} snapshot */
function handleSnapshot(snapshot) {
  const first = latestSnapshot === null;
  // "Your draft" (docs/plan/08 §3.5): an unsent reply held in the composer is
  // client state, so it is stamped onto each agent here for the renderer and
  // the deck to read. The daemon never sees drafts.
  for (const a of snapshot.agents || []) a.hasDraft = panel.hasDraft(a.id);
  latestSnapshot = snapshot;
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
  else prevActivityStates = new Map(snapshot.agents.map((a) => [a.id, a.activityState]));
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

const panel = createPanel({
  root: el.panelRoot,
  getSnapshot: () => latestSnapshot,
  toast,
  announce,
  onClosed: () => {
    selectedId = null;
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
});

// -------------------------------------------------------- strip and deck
//
// Levels 2 and 3 (docs/plan/05-GUI-UX-SPEC.md §3). They read the same queue
// this file's J/K walk, they move the same selection, and their number keys
// are handed straight to the panel's own pressNumberKey() — there is no
// second route to /api/ack anywhere in here. THE INVARIANT, 01-PRODUCT §2.

deckUI = createDeckUI({
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
});

// The hook consent screen. It has no dialog of its own any more — it renders
// into the settings sheet's Hooks section (WP-07, GUI/UX spec §5.4).
const hooksUI = createHooksUI({ toast });

// -------------------------------------------------------- creation flows
//
// The three flows in CONTRACTS-WP15.md §6 / WP15 task C, all in the GUI, all
// keyboard-usable. None of them ever touch /api/ack — creating or renaming
// an agent is not a review action.

/** @param {HTMLButtonElement} button @param {boolean} pressed */
function setToggle(button, pressed) {
  button.setAttribute('aria-pressed', String(pressed));
  button.textContent = pressed ? 'On' : 'Off';
}

/** @param {HTMLButtonElement} button */
function toggleIsOn(button) {
  return button.getAttribute('aria-pressed') === 'true';
}

el.newProjectCreateToggle.addEventListener('click', () => {
  setToggle(el.newProjectCreateToggle, !toggleIsOn(el.newProjectCreateToggle));
});
el.newProjectGitInitToggle.addEventListener('click', () => {
  setToggle(el.newProjectGitInitToggle, !toggleIsOn(el.newProjectGitInitToggle));
});

function openNewProject() {
  el.newProjectError.hidden = true;
  el.newProjectPath.value = '';
  el.newProjectName.value = '';
  el.newProjectInstructions.value = '';
  setToggle(el.newProjectCreateToggle, false);
  setToggle(el.newProjectGitInitToggle, false);
  el.newProjectDialog.showModal();
  el.newProjectPath.focus();
}

async function submitNewProject() {
  const path = el.newProjectPath.value.trim();
  if (!path) {
    el.newProjectError.textContent = 'Give it a directory to start in.';
    el.newProjectError.hidden = false;
    return;
  }
  el.newProjectGo.disabled = true;
  try {
    // CONTRACTS-WP15.md §6 names this endpoint /api/project, but
    // src/http/routes/actions.mjs — the real endpoint this client
    // consumes — kept the original /api/new-project URL and extended its
    // body to accept `path` (as well as the old `cwd`), `create`,
    // `gitInit`, `name` and `instructions`. The live route wins over the
    // doc; see the WP15 report for this note.
    const res = await fetch('/api/new-project', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        path,
        create: toggleIsOn(el.newProjectCreateToggle),
        gitInit: toggleIsOn(el.newProjectGitInitToggle),
        name: el.newProjectName.value.trim() || undefined,
        instructions: el.newProjectInstructions.value.trim() || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    el.newProjectDialog.close();
    toast(`Opening a session in ${body.cwd || path}`);
  } catch (err) {
    el.newProjectError.textContent = err.message;
    el.newProjectError.hidden = false;
  } finally {
    el.newProjectGo.disabled = false;
  }
}

el.newProjectGo.addEventListener('click', submitNewProject);
el.newProjectPath.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitNewProject();
  }
});

// -------------------------------------------------------- name/avatar pickers
//
// Shared by "New agent" and "Rename / re-avatar" (WP15 task C.2, C.3). A
// row of toggle buttons rather than a <select>: a native select's popup is
// OS-drawn, and on several platforms that is an unavoidable white box —
// exactly what the restraint pass (task A) removes everywhere else.

/**
 * @param {HTMLElement} host
 * @param {{value:string|null, label:string, node?:Node}[]} options
 * @param {string|null} initial
 * @returns {() => string|null} reads the currently selected value
 */
function buildPicker(host, options, initial) {
  host.textContent = '';
  /** @type {string|null} */
  let selected = initial;
  /** @type {HTMLButtonElement[]} */
  const buttons = [];

  function paint() {
    for (const btn of buttons) {
      btn.setAttribute('aria-pressed', String(btn.dataset.value === String(selected)));
    }
  }

  for (const opt of options) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'picker-btn';
    btn.dataset.value = String(opt.value);
    if (opt.node) btn.appendChild(opt.node);
    const label = document.createElement('span');
    label.textContent = opt.label;
    btn.appendChild(label);
    btn.addEventListener('click', () => {
      selected = opt.value;
      paint();
    });
    buttons.push(btn);
    host.appendChild(btn);
  }
  paint();
  return () => selected;
}

/**
 * @param {HTMLElement} host
 * @param {Iterable<string>} taken names already in use elsewhere on the floor
 * @param {string|null} current the agent's own current name, always offered
 */
function buildNamePicker(host, taken, current) {
  const names = availableNames(taken);
  if (current && !names.includes(current)) names.unshift(current);
  const options = [
    { value: null, label: 'No name (MK tag)' },
    ...names.map((n) => ({ value: n, label: n })),
  ];
  return buildPicker(host, options, current);
}

/** Minimal line-icon per glyph name, text-labelled so an unmapped name is
 * still identifiable — the vocabulary is render/palette.js's, not ours to
 * pin down further than "draw something recognisable". */
const GLYPH_PATHS = {
  hex: 'M10 1 L18 5.5 L18 14.5 L10 19 L2 14.5 L2 5.5 Z',
  triangle: 'M10 2 L18 17 L2 17 Z',
  square: 'M3 3 H17 V17 H3 Z',
  diamond: 'M10 1 L19 10 L10 19 L1 10 Z',
  drop: 'M10 1 C14 6 17 10 17 13.5 A7 7 0 0 1 3 13.5 C3 10 6 6 10 1 Z',
  star: 'M10 1 L12.4 7.2 L19 7.6 L13.8 11.9 L15.6 18.3 L10 14.6 L4.4 18.3 L6.2 11.9 L1 7.6 L7.6 7.2 Z',
  cross: 'M8 1 H12 V8 H19 V12 H12 V19 H8 V12 H1 V8 H8 Z',
};
const SVG_NS = 'http://www.w3.org/2000/svg';

/** @param {string} name */
function glyphIcon(name) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('aria-hidden', 'true');
  const d = GLYPH_PATHS[name];
  if (d) {
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
  } else {
    // 'ring' and anything not in the hand-authored set above: an unfilled
    // circle, since every icon in this picker is stroke-only already.
    const circle = document.createElementNS(SVG_NS, 'circle');
    circle.setAttribute('cx', '10');
    circle.setAttribute('cy', '10');
    circle.setAttribute('r', '8');
    svg.appendChild(circle);
  }
  return svg;
}

/**
 * @param {HTMLElement} host
 * @param {string[]} glyphs the known vocabulary (render/palette.js's AVATAR_GLYPHS)
 * @param {string|null} current the agent's own current avatar, always offered
 *   even if it falls outside `glyphs` (e.g. a stale value from before the
 *   vocabulary changed) — same defensiveness as buildNamePicker.
 */
function buildAvatarPicker(host, glyphs, current) {
  const list = current && !glyphs.includes(current) ? [current, ...glyphs] : glyphs;
  const options = [
    { value: null, label: 'Default' },
    ...list.map((name) => ({ value: name, label: name, node: glyphIcon(name) })),
  ];
  const getValue = buildPicker(host, options, current);
  for (const btn of host.querySelectorAll('.picker-btn')) btn.classList.add('avatar-btn');
  return getValue;
}

// ------------------------------------------------------------- new agent
//
// Opened from the floor's in-room "+" ({ kind: 'new-agent', id: projectId }
// via Scene's onSelect, CONTRACTS-WP15.md §5) and from the panel when an
// agent — and so a project — is in view (WP15 task C.2).

let newAgentProjectId = null;
let getNewAgentName = () => null;
let getNewAgentAvatar = () => null;

/** @param {string} projectId */
function openNewAgentDialog(projectId) {
  const project = latestSnapshot?.projects?.find((p) => p.id === projectId);
  if (!project) {
    toast('That project is not on the floor', { isError: true });
    return;
  }
  newAgentProjectId = projectId;
  el.newAgentIntro.textContent = `Starts another session in ${project.name}.`;
  el.newAgentInstructions.value = '';
  el.newAgentError.hidden = true;

  const taken = (latestSnapshot.agents || []).map((a) => a.displayName).filter(Boolean);
  getNewAgentName = buildNamePicker(el.newAgentNamePicker, taken, null);
  getNewAgentAvatar = buildAvatarPicker(
    el.newAgentAvatarPicker,
    palette?.AVATAR_GLYPHS || FALLBACK_AVATAR_GLYPHS,
    null,
  );

  el.newAgentDialog.showModal();
}

async function submitNewAgent() {
  const project = latestSnapshot?.projects?.find((p) => p.id === newAgentProjectId);
  if (!project) {
    el.newAgentError.textContent = 'That project is no longer on the floor.';
    el.newAgentError.hidden = false;
    return;
  }
  // "Take cwd from any agent already in that project, or from project.cwd"
  // (WP15 task C.2) — project.cwd is always present (src/core/model.mjs's
  // projects() sets it from the first agent seen), so that alone suffices.
  const cwd = project.cwd || latestSnapshot.agents.find((a) => a.projectId === project.id)?.cwd;
  if (!cwd) {
    el.newAgentError.textContent = 'Could not find a working directory for that project.';
    el.newAgentError.hidden = false;
    return;
  }
  el.newAgentGo.disabled = true;
  try {
    const res = await fetch('/api/agent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        cwd,
        name: getNewAgentName() || undefined,
        avatar: getNewAgentAvatar() || undefined,
        instructions: el.newAgentInstructions.value.trim() || undefined,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    el.newAgentDialog.close();
    toast(`Starting a new agent in ${project.name}`);
  } catch (err) {
    el.newAgentError.textContent = err.message;
    el.newAgentError.hidden = false;
  } finally {
    el.newAgentGo.disabled = false;
  }
}

el.newAgentGo.addEventListener('click', submitNewAgent);

// -------------------------------------------------- rename / re-avatar

let identityAgentId = null;
let getIdentityName = () => null;
let getIdentityAvatar = () => null;

/** @param {any} agent */
function openIdentityDialog(agent) {
  identityAgentId = agent.id;
  el.identityIntro.textContent = `Sets what ${agent.mk || agent.title} is called on the floor.`;
  el.identityError.hidden = true;

  // Every OTHER agent's name is taken; this agent's own current name stays
  // offered so picking "the same name" is not treated as unavailable.
  const taken = (latestSnapshot?.agents || [])
    .filter((a) => a.id !== agent.id)
    .map((a) => a.displayName)
    .filter(Boolean);
  getIdentityName = buildNamePicker(el.identityNamePicker, taken, agent.displayName ?? null);
  getIdentityAvatar = buildAvatarPicker(
    el.identityAvatarPicker,
    palette?.AVATAR_GLYPHS || FALLBACK_AVATAR_GLYPHS,
    agent.avatar ?? null,
  );

  el.identityDialog.showModal();
}

async function submitIdentity() {
  if (!identityAgentId) return;
  el.identityGo.disabled = true;
  try {
    const res = await fetch('/api/identity', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Explicit null, not omission: /api/identity treats null as "clear
      // this field" (CONTRACTS-WP15.md §6), which is exactly what choosing
      // "No name" / "Default" in the picker means.
      body: JSON.stringify({
        id: identityAgentId,
        name: getIdentityName(),
        avatar: getIdentityAvatar(),
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
    el.identityDialog.close();
    toast('Saved');
  } catch (err) {
    el.identityError.textContent = err.message;
    el.identityError.hidden = false;
  } finally {
    el.identityGo.disabled = false;
  }
}

el.identityGo.addEventListener('click', submitIdentity);

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

/**
 * The palette's own accelerator, handled before the floor map because that
 * map deliberately ignores anything with a modifier held. `⌘K` on a Mac,
 * `Ctrl+K` everywhere else — and both are accepted on both, because a person
 * on a Mac with an external PC keyboard should not have to care.
 * @param {KeyboardEvent} e
 */
function handlePaletteKey(e) {
  if (e.key !== 'k' && e.key !== 'K') return;
  if (!e.ctrlKey && !e.metaKey) return;
  if (e.altKey) return;
  e.preventDefault();
  if (paletteUI.isOpen()) paletteUI.close();
  else paletteUI.open();
}

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
  lastMouse = { x: e.clientX, y: e.clientY };
});

// -------------------------------------------------------------------- boot

async function loadRenderModules() {
  try {
    palette = await import('./render/palette.js');
  } catch (err) {
    console.debug('[deckhq] render/palette.js not available yet, using fallback colours', err);
  }
  try {
    sceneModule = await import('./render/scene.js');
    const { Scene } = sceneModule;
    scene = new Scene(el.canvas, {
      // Scene reports hits as { kind, id }. A project hit is a room plate:
      // filter the panel to that project (VISUAL-SPEC §8). 'new-agent' is
      // the in-room "+" (CONTRACTS-WP15.md §5); 'whiteboard' is the wall
      // prop (§4) and responds to both select and hover.
      onSelect: (hit) => {
        const sel = normaliseHit(hit);
        if (!sel) return selectAgent(null);
        if (sel.kind === 'project') return filterToProject(sel.id);
        if (sel.kind === 'new-agent') return openNewAgentDialog(sel.id);
        if (sel.kind === 'whiteboard') return showWhiteboard(sel.id);
        if (sel.kind === 'shelf') return revealProjectFolder(sel.id);
        if (sel.kind === 'screen') return runProjectDashboard(sel.id);
        selectAgent(sel.id);
      },
      onHover: (hit) => {
        const sel = normaliseHit(hit);
        // The board is a modal now, not a hover card: it opens on a CLICK
        // (see onSelect) and stays until it is dismissed. Opening it on hover
        // meant a modal appearing under the cursor as it crossed the floor.
        showTooltip(sel && sel.kind === 'agent' ? sel.id : null);
      },
    });
    if (latestSnapshot) scene.setState(latestSnapshot);
    scene.start();
  } catch (err) {
    // The floor is the product. A failure here is loud, not a debug line.
    console.error('[deckhq] the floor renderer failed to load', err);
    showRendererError(err);
  }
}

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
  await Promise.all([loadInitialState(), loadRenderModules()]);
  connectEvents();
}

main();
