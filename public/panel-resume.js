/**
 * "Resume in app / in terminal", and the daemon check behind it
 * (WP-22 follow-up).
 *
 * Split out of `createPanel()` unchanged. `loadResumeTargets()` is a GET and
 * purely decorative on failure; `resumeSession()` posts to /api/resume and
 * saves the choice as the next default. Neither reaches /api/ack.
 */

import { currentId, displayedAgent } from './panel-state.js';
import { separator } from './panel-dom.js';

/**
 * Whether the daemon has confirmed a `claude://` handler exists, for the
 * agent currently open — set only from `loadResumeTargets()`, never guessed
 * client-side.
 */
export let resumeAppAvailable = false;
/** @param {boolean} v */
export const setResumeAppAvailable = (v) => {
  resumeAppAvailable = v;
};

/** @typedef {ReturnType<typeof import('./panel-dom.js').buildPanelDom>} PanelDom */

/**
 * @param {PanelDom & {getSnapshot: () => any,
 *          toast: (m:string, o?:{isError?:boolean}) => void}} ctx
 */
export function createResumePart(ctx) {
  const { getSnapshot, toast, resumeEl } = ctx;
  let resumeTargetsToken = 0; // guards against a slow fetch clobbering a newer one

  /**
   * The resume links in the footer. Picking either both resumes right now
   * AND becomes the saved default (see resumeSession()). "resume in app"
   * only appears once the daemon has confirmed a claude:// handler exists —
   * see loadResumeTargets(); it is never guessed on the client.
   */
  function renderResume() {
    resumeEl.textContent = '';
    // WP-41: same rule as the actions. `claude --resume <agentId>` is not a
    // session and would open nothing; a junior is resumed by its parent
    // carrying on, which is not a link this panel can offer.
    if (displayedAgent && displayedAgent.subagent === true) return;
    const preference = getSnapshot()?.settings?.resumeIn === 'app' ? 'app' : 'terminal';
    resumeEl.appendChild(resumeLink('terminal', 'resume in terminal', preference));
    if (resumeAppAvailable) {
      resumeEl.appendChild(separator());
      resumeEl.appendChild(resumeLink('app', 'resume in app', preference));
    }
  }

  /**
   * `aria-pressed` reflects the user's current saved default — not disabled
   * state; both targets stay clickable regardless of which is the default.
   * @param {'app'|'terminal'} target
   * @param {string} label
   * @param {'app'|'terminal'} preference
   */
  function resumeLink(target, label, preference) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'link-btn panel-resume-link';
    btn.textContent = label;
    btn.title =
      'Resuming with the full session, instead of a summary, re-sends its history as context and uses more tokens.';
    btn.setAttribute('aria-pressed', String(target === preference));
    btn.addEventListener('click', () => resumeSession(target));
    return btn;
  }

  /**
   * Resume the current session through POST /api/resume. Picking either
   * target also saves it as the new default for next time (POST
   * /api/settings) — see renderResume() above. The saved-default POST is
   * fire-and-forget: the next snapshot carries the daemon's own copy of the
   * setting regardless, so there is nothing here to await or roll back.
   * @param {'app'|'terminal'} target
   */
  async function resumeSession(target) {
    const id = currentId;
    if (!id) return;
    try {
      const res = await fetch('/api/resume', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, target }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      toast(target === 'app' ? 'Opened in the desktop app' : 'Opened in terminal');
    } catch (err) {
      toast(`Could not resume: ${err.message}`, { isError: true });
      return;
    }

    const preference = getSnapshot()?.settings?.resumeIn === 'app' ? 'app' : 'terminal';
    if (target === preference) return;
    fetch('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resumeIn: target }),
    }).catch((err) => console.debug('[deckhq] could not save resume preference', err));
  }

  /**
   * Whether "resume in app" should be offered for this agent, from the
   * daemon's own registry-backed check (GET /api/resume-targets) — never
   * guessed client-side. Purely decorative on failure: if the check itself
   * fails, the app option just stays hidden, same as if it had reported
   * unavailable.
   * @param {string} id
   */
  async function loadResumeTargets(id) {
    const token = ++resumeTargetsToken;
    let available = false;
    try {
      const res = await fetch(`/api/resume-targets?id=${encodeURIComponent(id)}`);
      const body = await res.json().catch(() => ({}));
      available = Boolean(res.ok && body.appAvailable);
    } catch {
      available = false;
    }
    if (token !== resumeTargetsToken) return; // a newer open() superseded this fetch
    resumeAppAvailable = available;
    if (currentId && displayedAgent) renderResume();
  }

  return { renderResume, loadResumeTargets };
}
