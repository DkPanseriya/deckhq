/**
 * What one agent looks like, in the five answers both floors need
 * (WP-22 follow-up).
 *
 * Split out of `scene.js` unchanged. These are the mini-floor's target:
 * `public/minifloor.js` draws the same people at postcard size and asks the
 * same questions — is this one waiting on you, what colour is it, what does
 * its label say, which glyph sits over its head. One set of answers, two
 * surfaces, which is what stops the postcard and the floor disagreeing.
 *
 * `scene.js` re-exports all five, so `minifloor.js` imports what it always
 * imported.
 */

import { STATE_COLORS } from './palette.js';

/** Same three states `src/core/model.mjs`'s `needsYou()` checks, duck-typed
 * here per agents.js's file-header rule: `public/render/*.js` cannot import
 * across the static-file boundary. Selected/needs-you labels are never
 * dropped by `resolveLabelCollisions` (VISUAL-SPEC review finding 1).
 * @param {{ackState?:string, activityState?:string}} agent
 */
export function isNeedsYouAgent(agent) {
  return (
    agent.ackState === 'active' &&
    (agent.activityState === 'needs_input' ||
      agent.activityState === 'stalled' ||
      agent.activityState === 'for_review')
  );
}

export function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/**
 * The state colour a character's torso is filled with (VISUAL-SPEC §5).
 *
 * Exported because the mini-floor (WP-39, `public/minifloor.js`) is a SECOND
 * RENDER TARGET OF THIS SCENE, not a second scene: it draws the same records
 * with the same rig, so it must ask the same function what colour a session
 * is rather than carry a second copy of the rule that could disagree.
 * @param {{ackState?:string, activityState?:string}} agent
 */
export function colorForAgent(agent) {
  if (agent.ackState === 'let_go') return STATE_COLORS.let_go;
  if (agent.ackState === 'benched') return STATE_COLORS.benched;
  return STATE_COLORS[agent.activityState] || STATE_COLORS.working;
}

/**
 * The short string the floor draws under a character (CONTRACTS-WP15.md
 * §1): the MK tag (`MK3.2`), or the user's chosen display name in its
 * place. `agent.label` is the daemon's own `displayName ?? mk`, so it is
 * used as-is; `agent.mk` and then the old full `agent.title` are fallbacks
 * only, for a snapshot from a daemon that predates this field, so the floor
 * still draws something rather than nothing.
 * @param {{label?:string, mk?:string, title?:string}} agent
 * @returns {string|null}
 */
export function agentLabelFor(agent) {
  return agent.label || agent.mk || agent.title || null;
}

// Icon names are rig.js's vocabulary exactly: 'hand' | 'hourglass' | 'check' | null.
/**
 * @see colorForAgent for why this is exported.
 * @param {{ackState?:string, activityState?:string}} agent
 * @returns {'hand'|'hourglass'|'check'|null} rig.js's vocabulary, said in the
 *   signature as well as in the comment above it (WP-22).
 */
export function iconForAgent(agent) {
  if (agent.ackState !== 'active') return null;
  if (agent.activityState === 'needs_input') return 'hand';
  if (agent.activityState === 'stalled') return 'hourglass';
  if (agent.activityState === 'for_review') return 'check';
  return null;
}
