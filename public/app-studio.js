/**
 * WP-67 · Studio, from the palette.
 *
 * `docs/07-STUDIO-DESIGN.md` §2, Grill. The planner is an ordinary `claude`
 * session in the project directory: the daemon starts it, the ordinary scan
 * finds it, and the interview is answered in the panel's composer like any
 * other reply. There is no second data path, and nothing in this file knows of
 * one — all it does is name a directory, ask, and then open the panel on
 * whatever the scan turned up.
 *
 * Split out of `app.js` by WP-22's 900-line ceiling, and it belongs apart
 * anyway: the rest of `app.js` is the shell every floor has, and Studio is a
 * mode that is off on every project until somebody turns it on.
 */

import {
  findAgent,
  latestSnapshot,
  panel,
  projectFilter,
  selectAgent,
  selectedId,
  toast,
} from './app-state.js';

/** How often the page asks whether the scan has found the planner yet. */
export const PLANNER_POLL_MS = 2500;

/** How many times. Thirty seconds, which is more than a scan interval. */
export const PLANNER_POLL_TRIES = 12;

/** The project the palette's Studio commands act on, or null. */
export function currentProject() {
  const wanted = projectFilter || findAgent(selectedId)?.projectId;
  return (latestSnapshot?.projects || []).find((p) => p.id === wanted) || null;
}

/**
 * Start — or continue — this project's Studio planner.
 *
 * A project that has not enabled Studio gets the daemon's own refusal, which
 * names the command that grants consent. That refusal is not hidden behind a
 * disabled row: Studio is off by default everywhere, so a row that appeared
 * only when it was on would be a row almost nobody could find twice.
 *
 * @param {{sleep?:(ms:number) => Promise<void>}} [opts] a test seam, so the
 *   poll below can be driven without waiting thirty real seconds.
 */
export async function studioPlan(opts = {}) {
  const sleep = opts.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const project = currentProject();
  if (!project?.cwd) {
    toast('Select a session first — a planner needs the project it is planning.', {
      isError: true,
    });
    return;
  }
  let body;
  try {
    const res = await fetch('/api/studio/plan', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: project.cwd }),
    });
    body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  } catch (err) {
    toast(`Studio: ${err.message}`, { isError: true });
    return;
  }
  if (body.agentId) {
    // Already on the floor: continuing the interview is the composer.
    selectAgent(body.agentId);
    toast('The planner is already here — answer it in the panel.');
    return;
  }
  toast('Planner starting. It walks in on the next scan.');
  // Its id is the runtime's to mint and the scan's to find, so this asks the
  // daemon for it rather than inventing one. Giving up is quiet: the session
  // still arrives on the floor, it just is not selected for you.
  for (let tries = 0; tries < PLANNER_POLL_TRIES; tries++) {
    await sleep(PLANNER_POLL_MS);
    try {
      const res = await fetch(`/api/studio?project=${encodeURIComponent(project.cwd)}`);
      const snap = await res.json();
      if (snap?.planner?.agentId && snap.planner.live) {
        selectAgent(snap.planner.agentId);
        panel?.refreshStudio?.();
        return;
      }
    } catch {
      return;
    }
  }
}
