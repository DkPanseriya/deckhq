/**
 * WP-19's permission card (WP-22 follow-up).
 *
 * Split out of `createPanel()` unchanged. The card is its own funnel and its
 * own endpoint: `answerPermission()` posts to `/api/permission/decide` and
 * NOTHING here reaches `/api/ack` or `performAction()`. Allowing or denying
 * one tool call says nothing about whether the user is done with the session,
 * so it may not move a user-owned state — docs/01-PRODUCT.md §2, and an
 * `INVARIANT:` test in `test/unit/panel-invariant.test.mjs` that reads this
 * file.
 */

import { displayedAgent } from './panel-state.js';
import { textNode } from './panel-dom.js';

/** WP-19: an answer is in flight, so the buttons are held. */
export let answering = false;
/** @param {boolean} v */
export const setAnswering = (v) => {
  answering = v;
};
/** The permission request id the card last announced, so it is said once. */
export let announcedPermissionId = null;
/** @param {string|null} v */
export const setAnnouncedPermissionId = (v) => {
  announcedPermissionId = v;
};

/** @typedef {ReturnType<typeof import('./panel-dom.js').buildPanelDom>} PanelDom */

/**
 * @param {PanelDom & {toast: (m:string, o?:{isError?:boolean}) => void,
 *          announce: (t:string) => void}} ctx
 */
export function createPermissionPart(ctx) {
  const {
    toast,
    announce,
    permissionSection,
    permissionTool,
    permissionInput,
    permissionActions,
    permissionNote,
  } = ctx;

  /**
   * The pending permission on the displayed agent, or null. Read-only.
   * @returns {any|null}
   */
  function pendingPermission() {
    const p = displayedAgent && displayedAgent.pendingPermission;
    return p && typeof p === 'object' && p.id ? p : null;
  }

  /**
   * WP-19 · the permission card. A read of `pendingPermission` off the
   * snapshot, rendered as text. It writes nothing: rendering a question is
   * not answering it, and this function must never reach performAction(),
   * /api/ack or /api/permission/decide — only an explicit button or its
   * explicit key does that, through answerPermission().
   *
   * Four states, per `docs/DEVIATIONS.md` §86.5: waiting with three buttons,
   * waiting with two when the runtime offered no rule to add, "answer in the
   * terminal" for the tools whose approval card IS the interaction surface,
   * and — by simply disappearing — answered or withdrawn, which the daemon
   * reports by clearing the field.
   */
  function renderPermission() {
    const p = pendingPermission();
    if (!p) {
      permissionSection.hidden = true;
      permissionActions.textContent = '';
      permissionInput.textContent = '';
      announcedPermissionId = null;
      return;
    }
    permissionSection.hidden = false;
    permissionTool.textContent = String(p.tool || 'A tool');
    permissionInput.textContent = String(p.summary || '');
    permissionActions.textContent = '';

    if (p.requiresUserInteraction) {
      // A hook allow is discarded for these, so offering a button would be
      // offering something that does not work.
      permissionNote.textContent =
        `${p.tool} has to be answered in the session itself — this one cannot be answered ` +
        'from here. Open the terminal running it and answer there.';
      maybeAnnouncePermission(p, `${p.tool}: answer in the terminal`);
      return;
    }

    const suggestions = Array.isArray(p.suggestions) ? p.suggestions : [];
    permissionActions.append(
      permissionButton('A', 'Allow', 'btn btn--primary', 'allow'),
      permissionButton('D', 'Deny', 'btn', 'deny'),
    );
    if (suggestions.length > 0) {
      const btn = permissionButton('S', 'Allow for session', 'btn', 'session');
      const label = suggestions
        .map((s) => (s && typeof s.label === 'string' ? s.label : ''))
        .filter(Boolean)
        .join(', ');
      btn.title = label
        ? `Adds ${label} for this session only — nothing is written to your settings files`
        : 'For this session only — nothing is written to your settings files';
      permissionActions.appendChild(btn);
    }
    permissionNote.textContent =
      'The same prompt is open in the terminal. Whichever answers first wins, and DeckHQ ' +
      'never answers on its own.';
    maybeAnnouncePermission(p, `${p.tool} is asking permission: ${p.summary || ''}`);
  }

  /**
   * Say a new permission card once, for a screen reader. Guarded on the
   * request id so a snapshot per second does not repeat it.
   * @param {any} p @param {string} text
   */
  function maybeAnnouncePermission(p, text) {
    if (announcedPermissionId === p.id) return;
    announcedPermissionId = p.id;
    announce(text);
  }

  /**
   * @param {string} key @param {string} label @param {string} className
   * @param {'allow'|'deny'|'session'} decision
   */
  function permissionButton(key, label, className, decision) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `${className} btn--weighted`;
    const kbd = document.createElement('kbd');
    kbd.textContent = key;
    btn.append(kbd, textNode(label));
    btn.setAttribute('aria-keyshortcuts', key);
    btn.disabled = answering;
    btn.addEventListener('click', () => answerPermission(decision));
    return btn;
  }

  /**
   * WP-19 · answer the permission prompt this daemon is holding open.
   *
   * The single funnel for POST /api/permission/decide, and deliberately NOT
   * part of performAction(): a permission decision says something about one
   * tool call, and `ackState` says whether the user is done with the session.
   * Routing one through the other would let a tool approval clear a review
   * debt, which is the `08` §1.1 rule 1 invariant. Nothing in this function
   * touches ack state, the review queue, or the agent's activity state, and
   * there is an `INVARIANT:` test that says so.
   *
   * Reached only from an explicit button built in renderPermission() or from
   * its explicit A / D / S key. Never from a render, a refresh or a timer.
   * @param {'allow'|'deny'|'session'} decision
   */
  async function answerPermission(decision) {
    const p = pendingPermission();
    if (!p || answering) return;
    if (p.requiresUserInteraction) return;
    if (decision === 'session' && !(Array.isArray(p.suggestions) && p.suggestions.length > 0)) {
      return;
    }
    answering = true;
    for (const b of permissionActions.querySelectorAll('button')) b.disabled = true;
    try {
      const res = await fetch('/api/permission/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: p.id, decision }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      // A control says what happens (docs/plan/05 §11).
      toast(
        decision === 'deny'
          ? `Denied. ${p.tool} did not run.`
          : decision === 'session'
            ? `Allowed for this session. ${p.tool} may run again without asking, until this session ends.`
            : `Allowed. ${p.tool} is running.`,
      );
      announce(`${p.tool}: ${decision === 'session' ? 'allowed for this session' : decision}ed`);
    } catch (err) {
      toast(`Could not answer: ${err.message}`, { isError: true });
      answering = false;
      renderPermission();
      return;
    }
    answering = false;
    // The daemon clears `pendingPermission` as it answers the socket, so the
    // card goes on the next snapshot. Re-render now so the buttons do not sit
    // there looking live in the meantime.
    renderPermission();
  }

  return { pendingPermission, renderPermission, answerPermission };
}
