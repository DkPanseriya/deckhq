/**
 * The header, the floor-state banners and the project filter chip.
 *
 * Split out of `app.js` by WP-22. Everything here answers one question — what
 * do the numbers along the top of the window say, and what does the canvas
 * announce to a screen reader — and every one of them is a pure function of
 * the snapshot it is handed plus the shared state in `app-state.js`.
 *
 * It imports nothing from `app.js`, so the dependency runs one way.
 */

import { queueOrder } from './deck.js';
import { applyMotionPreference } from './settings-ui.js';
import {
  announce,
  deckUI,
  el,
  formatNumber,
  latestSnapshot,
  projectFilter,
  scene,
  sceneModule,
  sceneOwner,
  selectAgent,
  setProjectFilter,
} from './app-state.js';

/**
 * Scope the queue and the panel to one project, and show a clearable chip in
 * the header so the filter is never invisible.
 * @param {string|null} projectId
 */
export function filterToProject(projectId) {
  setProjectFilter(projectId);
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

export function renderProjectFilterChip() {
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
export function showRendererError(err) {
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
export function getNeedsYouQueue(snapshot) {
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
export function normalizeDegraded(degraded) {
  if (!degraded) return [];
  if (Array.isArray(degraded)) return degraded.filter(Boolean).map(String);
  if (typeof degraded === 'boolean') return degraded ? ['unknown'] : [];
  if (typeof degraded === 'object') {
    return Object.keys(degraded).filter((k) => Boolean(/** @type {any} */ (degraded)[k]));
  }
  return [];
}

/** What the banner says when the only reason it is up is uninstalled hooks. */
export const DEGRADED_HOOKS_TEXT = 'Install hooks for exact state';

/**
 * The sentences in `snapshot.degraded`, if any.
 *
 * WP-23a. A value in that map is `true` — "state is inferred, install hooks"
 * — or a SPECIFIC thing the runtime could not read, as a sentence the runtime
 * wrote. Today that is Codex's compressed rollouts on a Node with no
 * Zstandard (`docs/DEVIATIONS.md` §136.2): sessions genuinely missing from the
 * floor, which the boolean banner had no way to say and which installing
 * hooks would not fix. So the string is shown as written and the "Install
 * hooks" button is hidden when it is the only reason the banner is up.
 * @param {unknown} degraded
 * @returns {string[]}
 */
export function degradedNotes(degraded) {
  if (!degraded || typeof degraded !== 'object' || Array.isArray(degraded)) return [];
  return Object.values(degraded).filter((v) => typeof v === 'string' && v.trim());
}

/** A short local summary, used as a fallback when Scene.describeFloor is unavailable. @param {any} s */
export function localDescribeFloor(s) {
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
export function describeFloor(snapshot) {
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

export function renderHeader(snapshot) {
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
  const degradedNoted = degradedNotes(snapshot.degraded);
  el.degradedBanner.hidden = degradedRuntimes.length === 0;
  // WP-23a. A runtime that named what it could not read says so in its own
  // words; otherwise the banner keeps the sentence it has always had. The
  // button offers the only fix the banner knows, so it goes away when nothing
  // the banner is reporting would be fixed by installing hooks.
  el.degradedText.textContent = degradedNoted.length
    ? degradedNoted.join(' · ')
    : DEGRADED_HOOKS_TEXT;
  el.degradedLink.hidden =
    degradedNoted.length > 0 && degradedNoted.length === degradedRuntimes.length;

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

export function renderFloorState(snapshot) {
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
  // WP-45. While the floor replay is scrubbing a day out of the ledger, the
  // canvas belongs to it. Everything above this line still ran, so the header
  // count, the queue strip and the deck are live and true the whole time —
  // only the picture is looking at yesterday.
  if (scene && sceneOwner === 'live') {
    try {
      scene.setState(snapshot);
    } catch (err) {
      console.warn('[deckhq] Scene.setState failed', err);
    }
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
export function setAppBadge(count) {
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
