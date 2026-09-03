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
import { applyMotionPreference, createSettingsUI } from './settings-ui.js';
import { availableNames } from './names.js';

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
  writeErrorBanner: document.getElementById('write-error-banner'),
  writeErrorText: document.getElementById('write-error-text'),
  degradedBanner: document.getElementById('degraded-banner'),
  degradedText: document.getElementById('degraded-text'),
  degradedLink: document.getElementById('degraded-link'),
  connectionStatus: document.getElementById('connection-status'),
  paletteBtn: document.getElementById('palette-btn'),
  paletteHintKey: document.getElementById('palette-hint-key'),
  newAgentBtn: document.getElementById('new-agent-btn'),
  paletteDialog: document.getElementById('palette'),
  paletteInput: document.getElementById('palette-input'),
  paletteList: document.getElementById('palette-list'),
  paletteEmpty: document.getElementById('palette-empty'),
  settingsDialog: document.getElementById('settings-dialog'),
  settingsBody: document.getElementById('settings-body'),
  settingsClose: document.getElementById('settings-close'),
  newProjectDialog: document.getElementById('new-project-dialog'),
  newProjectPath: document.getElementById('new-project-path'),
  newProjectCreateToggle: document.getElementById('new-project-create-toggle'),
  newProjectGitInitToggle: document.getElementById('new-project-gitinit-toggle'),
  newProjectName: document.getElementById('new-project-name'),
  newProjectInstructions: document.getElementById('new-project-instructions'),
  newProjectGo: document.getElementById('new-project-go'),
  newProjectError: document.getElementById('new-project-error'),
  newAgentDialog: document.getElementById('new-agent-dialog'),
  newAgentIntro: document.getElementById('new-agent-intro'),
  newAgentNamePicker: document.getElementById('new-agent-name-picker'),
  newAgentAvatarPicker: document.getElementById('new-agent-avatar-picker'),
  newAgentInstructions: document.getElementById('new-agent-instructions'),
  newAgentGo: document.getElementById('new-agent-go'),
  newAgentError: document.getElementById('new-agent-error'),
  identityDialog: document.getElementById('identity-dialog'),
  identityIntro: document.getElementById('identity-intro'),
  identityNamePicker: document.getElementById('identity-name-picker'),
  identityAvatarPicker: document.getElementById('identity-avatar-picker'),
  identityGo: document.getElementById('identity-go'),
  identityError: document.getElementById('identity-error'),
  canvas: document.getElementById('floor-canvas'),
  tooltip: document.getElementById('tooltip'),
  whiteboardOverlay: document.getElementById('whiteboard-overlay'),
  floorSkeleton: document.getElementById('floor-skeleton'),
  emptyState: document.getElementById('empty-state'),
  errorBanner: document.getElementById('error-banner'),
  errorBannerText: document.getElementById('error-banner-text'),
  projectFilter: document.getElementById('project-filter'),
  panelRoot: document.getElementById('panel'),
  onboardingDialog: document.getElementById('onboarding-dialog'),
  onboardingDismiss: document.getElementById('onboarding-dismiss'),
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
 * @returns {{kind:'agent'|'project'|'whiteboard'|'new-agent', id:string}|null}
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
 * @param {any} snapshot
 */
function getNeedsYouQueue(snapshot) {
  if (!snapshot) return [];
  const list = snapshot.agents.filter(
    (a) =>
      a.ackState === 'active' &&
      (projectFilter === null || a.projectId === projectFilter) &&
      (a.activityState === 'needs_input' ||
        a.activityState === 'stalled' ||
        a.activityState === 'for_review'),
  );
  const sortKey = (a) =>
    a.reviewSince ?? a.needsInputSince ?? a.lastOutputAt ?? a.lastActivityAt ?? 0;
  return list.sort((a, b) => sortKey(a) - sortKey(b));
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
  return (
    `${formatNumber(c.needsYou)} sessions need you: ` +
    `${formatNumber(c.handsUp)} hands up, ${formatNumber(c.stalled)} stalled, ` +
    `${formatNumber(c.forReview)} for review. ${formatNumber(c.atDesk)} at their desks, ` +
    `${formatNumber(c.benched)} benched.`
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
  el.atDesk.textContent = formatNumber(c.atDesk);
  el.benched.textContent = formatNumber(c.benched);

  document.title = c.needsYou > 0 ? `(${formatNumber(c.needsYou)}) DeckHQ` : 'DeckHQ';

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
  el.emptyState.hidden = hasAgents;
  el.canvas.hidden = !hasAgents;
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
  for (const agent of snapshot.agents) {
    if (agent.ackState !== 'active') continue;
    const prev = prevActivityStates.get(agent.id);
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

// --------------------------------------------------------------- actions

/** @param {string|null} id */
function selectAgent(id) {
  selectedId = id;
  if (scene) {
    try {
      scene.select(id);
    } catch (err) {
      console.warn('[deckhq] Scene.select failed', err);
    }
  }
  if (id) panel.open(id);
  else panel.close();
}

/** @param {1|-1} direction */
function moveNeedsYouQueue(direction) {
  const queue = getNeedsYouQueue(latestSnapshot);
  if (queue.length === 0) return;
  let idx = queue.findIndex((a) => a.id === selectedId);
  if (idx === -1) {
    idx = direction > 0 ? 0 : queue.length - 1;
  } else {
    idx = Math.max(0, Math.min(queue.length - 1, idx + direction));
  }
  selectAgent(queue[idx].id);
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

// -------------------------------------------------------------- keyboard

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

  switch (e.key) {
    case 'Escape':
      // The whiteboard overlay is the most transient thing on screen — a
      // second Esc still deselects, but the first one only ever closes
      // whatever is topmost. docs' whiteboard note: "closes ... on Esc".
      if (!el.whiteboardOverlay.hidden) {
        hideWhiteboard();
        break;
      }
      selectAgent(null);
      break;
    case 'j':
    case 'J':
      moveNeedsYouQueue(1);
      break;
    case 'k':
    case 'K':
      moveNeedsYouQueue(-1);
      break;
    case 'a':
    case 'A':
      // Explicit keyboard action, equivalent in kind to a button press —
      // routed through panel.performAction(), the single funnel for
      // /api/ack calls. Never wired from render or selection code.
      panel.performAction('acknowledge');
      break;
    case 'b':
    case 'B':
      panel.performAction('bench');
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
    // The review card's weighted actions (docs/plan/05-GUI-UX-SPEC.md §4.2):
    // 1 focuses the composer, 2 approves (a send), 3 benches. The panel
    // ignores them while it is closed, and the `isTyping` guard above keeps
    // them inert while the composer has focus.
    case '1':
    case '2':
    case '3':
      panel.pressNumberKey(e.key);
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
  const cost = onFloor.reduce((a, x) => a + (x.costEstimate || 0), 0);
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
  tile('Est. cost', `$${cost.toFixed(2)}`);
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
  totalValue.textContent = `${formatNumber(tokens)} tok · $${cost.toFixed(2)}`;
  total.append(totalLabel, totalValue);
  board.appendChild(total);

  const hint = document.createElement('p');
  hint.className = 'whiteboard-hint';
  hint.textContent = 'Cost is an estimate at public list prices, not a bill. Esc closes.';
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
  if (!first) diffAndNotify(snapshot);
  else prevActivityStates = new Map(snapshot.agents.map((a) => [a.id, a.activityState]));
  panel.refresh();
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
 * First-run onboarding: shown once, until the user dismisses it, recorded
 * with POST /api/settings {onboarded:true} and never shown again.
 * docs/04-BUILD-PLAN.md WP11.
 * @param {any} settings
 */
function maybeShowOnboarding(settings) {
  if (settings && settings.onboarded) return;
  showOnboarding();
}

/** Open it on purpose — the palette's "Onboarding again". */
function showOnboarding() {
  if (el.onboardingDialog.open) return;
  if (typeof el.onboardingDialog.showModal === 'function') {
    el.onboardingDialog.showModal();
  } else {
    el.onboardingDialog.setAttribute('open', '');
  }
}

el.onboardingDismiss.addEventListener('click', () => {
  el.onboardingDialog.close();
});

// The 'close' event fires however the dialog closed (button, Esc, or a
// future backdrop click), so recording "seen" lives in one place.
el.onboardingDialog.addEventListener('close', async () => {
  try {
    await fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ onboarded: true }),
    });
  } catch (err) {
    console.debug('[deckhq] could not record onboarding as seen', err);
  }
});

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
    setNotifications,
    setSound: (next) => saveSetting({ sound: next }),
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
