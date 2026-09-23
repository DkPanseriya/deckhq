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

import { currentProject, panel, selectAgent, toast } from './app-state.js';
import { openStudioBoard } from './board-shell.js';
// WP-69. One name for the runtime a client-side Hire starts a role on, shared
// with the board's hand-off. `board-ui.js` rather than here because that file
// is the one a test can import.
import { HIRE_RUNTIME } from './board-ui.js';

/** How often the page asks whether the scan has found the planner yet. */
export const PLANNER_POLL_MS = 2500;

/** How many times. Thirty seconds, which is more than a scan interval. */
export const PLANNER_POLL_TRIES = 12;

/**
 * The runtime a Hire from the palette starts a role on — WP-68, §4.
 *
 * Sent on every `/api/studio/hire`, rather than left to the route's own
 * default, for WP-92j's reason: which of four runtimes a spawn was about is
 * the caller's to say. It is `claude-code` because that is the one runtime
 * whose launch §4 does not have to mark *unverified*, and the other three are
 * hired from the roster editor, where the choice is a visible one rather than
 * a keystroke.
 *
 * WP-69 gave the board a Hire too, and a second copy of this string is how the
 * two doors end up starting different runtimes. It is declared once, in
 * `board-ui.js`, and re-exported here so the name still reads where WP-68 put
 * it.
 */
export { HIRE_RUNTIME };

/**
 * The last `GET /api/studio` answer, and the directory it was about.
 *
 * One object, not a store: the palette needs the roster's role names to draw a
 * `Studio: hire <role>` row per unhired role, and a row cannot wait on a fetch.
 * It is stamped with the project so a stale answer can never be drawn beside a
 * different project's name — `studioRoles()` returns nothing at all when the
 * floor has moved on.
 * @type {{project:string|null, roles:Array<any>}}
 */
const cache = { project: null, roles: [] };

/**
 * The roster's roles for the project the palette is about, or an empty list.
 *
 * Empty is the honest answer in three cases that look different and read the
 * same from a palette row: no project selected, Studio not enabled here, and
 * the roster not fetched yet. None of them has a role to hire.
 */
export function studioRoles() {
  const project = currentProject();
  if (!project?.cwd || cache.project !== project.cwd) return [];
  return cache.roles;
}

/**
 * Re-read this project's roster into the cache.
 *
 * A GET of files on the user's own disk, made when the palette opens. It
 * writes nothing and it resolves to whether anything changed, so the caller can
 * re-render once instead of on every open.
 *
 * @param {{fetch?:typeof globalThis.fetch}} [opts] a test seam
 * @returns {Promise<boolean>} true when the drawn rows would now differ
 */
export async function refreshStudioRoles(opts = {}) {
  const get = opts.fetch || globalThis.fetch;
  const project = currentProject();
  const cwd = project?.cwd || '';
  const before = JSON.stringify(cache);
  if (!cwd) {
    cache.project = null;
    cache.roles = [];
    return before !== JSON.stringify(cache);
  }
  try {
    const res = await get(`/api/studio?project=${encodeURIComponent(cwd)}`);
    const body = res.ok ? await res.json() : null;
    cache.project = cwd;
    // A project with Studio off has no roster to hire from, and says so by
    // having no rows — not by a row that would refuse when pressed.
    cache.roles = body?.enabled && Array.isArray(body.roles) ? body.roles : [];
  } catch {
    cache.project = cwd;
    cache.roles = [];
  }
  return before !== JSON.stringify(cache);
}

/**
 * Hire one role — `POST /api/studio/hire`, §4.
 *
 * One role per press. `{ roles: […] }` exists for the roster editor, where six
 * checkboxes and one button is the gesture; a palette row is one name, and a
 * row that started six terminals would be a row nobody presses twice.
 *
 * Everything this can refuse is refused by the daemon, in the daemon's own
 * words, and shown as it was written: a role name git will not take, a runtime
 * with no `openNewSession`, a project with no consent. None of it is
 * second-guessed here.
 *
 * @param {string} roleName
 */
export async function studioHire(roleName) {
  const project = currentProject();
  if (!project?.cwd) {
    toast('Select a session first — a role is hired into a project.', { isError: true });
    return;
  }
  let body;
  try {
    const res = await fetch('/api/studio/hire', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cwd: project.cwd, role: roleName, runtime: HIRE_RUNTIME }),
    });
    body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  } catch (err) {
    toast(`Studio: ${err.message}`, { isError: true });
    return;
  }
  const refused = (body.refused || [])[0];
  if (refused) {
    toast(`Studio: ${roleName} — ${refused.error || refused.reason}`, { isError: true });
    return;
  }
  const hired = (body.hired || [])[0];
  if (!hired) {
    toast('Studio: nothing was started.', { isError: true });
    return;
  }
  // The id is the runtime's to mint and the scan's to find, so this says what
  // is true now — a worktree and a brief — and lets the floor say the rest.
  toast(
    hired.unverified
      ? `${roleName} started in ${hired.branch} — ${hired.unverified}`
      : `${roleName} started in ${hired.branch}. It walks in on the next scan.`,
    { isError: Boolean(hired.unverified) },
  );
  // The role is hired now, so its palette row should be gone by the next open.
  await refreshStudioRoles();
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

/**
 * WHAT `app.js` HANDS THE PALETTE — two objects rather than four named fields.
 *
 * Grouped here, at the bottom, where every function they name already exists.
 * Grouping them is not just tidiness: `app.js` stands at WP-22's 900-line
 * ceiling, and two lines of wiring there instead of four is two more lines it
 * can spend on the shell that is its actual job.
 */

/** The two getters `createPalette` takes from Studio. */
export const studioPalette = {
  getStudioRoles: studioRoles,
  onOpen: refreshStudioRoles,
};

/**
 * The palette actions Studio owns: plan a project, hire a role, open the board.
 *
 * `studioBoard` is `board-ui.js`'s own opener, passed through rather than
 * wrapped: the board is a surface with a life of its own — it is also opened
 * from the panel's Studio block — and a wrapper here would be a second door
 * with a second chance to be subtly different from the first.
 */
export const studioActions = { studioPlan, studioHire, studioBoard: openStudioBoard };
