/**
 * OS notifications, the sounds that go with them, and the one settings write.
 *
 * Split out of `app.js` by WP-22. docs/03-VISUAL-SPEC.md §9's rule is the
 * whole of it: a notification fires when an agent *enters* a state that needs
 * you, never while it stays there, and never on a snapshot that changed
 * nothing. Everything that decides that is here, and nothing here draws.
 */

import { applyMotionPreference } from './settings-ui.js';
import { latestSnapshot, selectAgent, sounds, toast } from './app-state.js';

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

/** @type {Map<string, string>} agentId -> activityState, from the previous snapshot */
let prevActivityStates = new Map();
/**
 * Prime the diff without notifying — what `handleSnapshot` does for the very
 * first snapshot and for the actor floor, so neither can fire for a state
 * every agent was already in when the tab opened.
 * @param {Map<string, string>} v
 */
export function setPrevActivityStates(v) {
  prevActivityStates = v;
}

/** @type {{id:string,label:string,projectName:string}[]} agents pending in a coalesced notification */
let pendingNotifyBatch = [];
let notifyCoalesceTimer = null;
let lastNotifyAt = 0;
/** Whether the most recent batch actually produced an OS notification (WP-15's §8 rule). */
let lastNotifyShown = false;

/**
 * Diff the previous snapshot's per-agent activityState against the new one
 * and fire a notification only for agents that just *entered* needs_input
 * or for_review. Never fires for an agent that was already in one of those
 * states, and never fires on a snapshot that changes nothing for an agent
 * (state refresh with no transition). docs/03-VISUAL-SPEC.md §9.
 * @param {any} snapshot
 */
export function diffAndNotify(snapshot) {
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
export async function setNotifications(next) {
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
export async function saveSetting(patch) {
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
