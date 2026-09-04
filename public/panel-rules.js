/**
 * The panel's vocabulary and its pure rules (WP-22 follow-up).
 *
 * Split out of `panel.js` unchanged: the label tables, the two constants the
 * card is drawn from, and the four pure functions that decide what an agent
 * looks like, which of the six actions are legal on it, which one the third
 * weighted slot carries, what a keystroke means to a permission card, and
 * what the row looks like the instant after an action.
 *
 * Nothing here touches the DOM, the network or any state. `panel.js`
 * re-exports `permissionKeyDecision` so every existing import still resolves.
 */

export const STATE_LABELS = {
  working: 'Working',
  needs_input: 'Hands up',
  stalled: 'Stalled',
  for_review: 'For review',
  benched: 'Benched',
  let_go: 'Let go',
  ended: 'Ended',
};

export const STATE_ICON_GLYPH = {
  working: '',
  needs_input: '✋',
  stalled: '⏳',
  for_review: '✓',
  benched: '',
  let_go: '',
};

export const DEFAULT_APPROVE_TEXT = 'Yes, go ahead.';

/**
 * What an action on the empty-machine floor says (WP-13). The actors are not
 * sessions and are not addressable, so the refusal is about them rather than
 * about the reader — no second-person fault, per
 * `docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §5.
 */
export const DEMO_REFUSAL =
  "Actors don't take instructions. Run `claude` in any repo and a real one walks in.";
/** The close-up's on-screen size, docs/plan/05-GUI-UX-SPEC.md §4.2. */
export const CLOSEUP_PX = 44;
/** How often the "waiting …" line re-reads the clock while the panel is open. */
export const WAITING_TICK_MS = 30_000;
/** How long a `GET /api/stats` body is reused for the records line (WP-46). */
export const RECORDS_TTL_MS = 5 * 60_000;

/**
 * The state an agent should LOOK like, which is not always its
 * `activityState`. `bench` and `let_go` change only `ackState`, so a benched
 * agent keeps `for_review` — and rendering it crimson would spend the
 * reserved accent on something that is resting in the lounge, not standing
 * in the office. Mirrors `colorForAgent` in render/scene.js.
 * @param {any} agent
 */
export function visualState(agent) {
  if (!agent) return 'ended';
  if (agent.ackState === 'let_go') return 'let_go';
  if (agent.ackState === 'benched') return 'benched';
  return agent.activityState;
}

export const ACTION_LABELS = {
  acknowledge: 'Acknowledge',
  review: 'Mark for review',
  bench: 'Bench',
  recall: 'Recall',
  let_go: 'Let go',
  rehire: 'Rehire',
};

/**
 * Which of the six ACK_ACTIONS are legal from an agent's current state.
 * docs/02-ARCHITECTURE.md §5.1.
 * @param {any} agent
 * @returns {string[]}
 */
export function legalActions(agent) {
  if (!agent) return [];
  // WP-41. A junior has no user-owned state to act on: it is not the user's
  // to bench, let go or acknowledge, and it will be gone before a decision
  // about it could mean anything. `Registry.act()` refuses these outright, so
  // this is the interface agreeing with the daemon rather than guarding it.
  if (agent.subagent === true) return [];
  if (agent.ackState === 'let_go') return ['rehire'];
  if (agent.ackState === 'benched') return ['recall', 'let_go'];
  const acts = [];
  if (
    agent.activityState === 'needs_input' ||
    agent.activityState === 'stalled' ||
    agent.activityState === 'for_review'
  ) {
    acts.push('acknowledge');
  }
  if (agent.activityState !== 'for_review') acts.push('review');
  acts.push('bench', 'let_go');
  return acts;
}

/**
 * The third weighted slot: where this agent goes next. Bench sends an active
 * agent to the lounge; from the lounge the same key brings them back; a
 * let-go agent is rehired.
 * @param {any} agent
 */
export function thirdAction(agent) {
  if (!agent) return 'bench';
  if (agent.ackState === 'let_go') return 'rehire';
  if (agent.ackState === 'benched') return 'recall';
  return 'bench';
}

/**
 * Which permission decision, if any, a keystroke means — and therefore which
 * of the two `S` keys the user just pressed.
 *
 * `A`, `D` and `S` answer WP-19's permission card. `S` is also WP-14's office
 * snapshot, and `Shift+S` is WP-14's redaction toggle, both bound in app.js.
 * Two features cannot own one key by accident, so the precedence is written
 * down here, in one pure function, rather than emerging from the order two
 * listeners happen to be registered in:
 *
 *   1. WP-19 wins `S` only when there is a card to answer — the panel open on
 *      an agent, a `pendingPermission` on it that the runtime did not mark
 *      `requiresUserInteraction`, the composer (or any text control) not
 *      focused, and no modal `<dialog>` over the top. `S` in particular also
 *      needs the runtime to have offered a session-scoped suggestion; with no
 *      suggestion there is no "allow for session" to give.
 *   2. Otherwise this returns null, the listener lets the event through, and
 *      app.js does what it always does: `S` takes the snapshot.
 *
 * `Shift` is never WP-19's. `Shift+S` is the redaction toggle wherever the
 * user is standing, card or no card, so a held shift ends the question here.
 *
 * Pure, so `test/unit/permission-keys.test.mjs` can walk every case without a
 * DOM. It reads nothing and decides nothing on its own — the caller acts.
 *
 * @param {{key:string, shiftKey?:boolean, ctrlKey?:boolean, metaKey?:boolean,
 *          altKey?:boolean}} e
 * @param {{panelOpen:boolean, typing:boolean, dialogOpen:boolean,
 *          pending:any}} ctx
 * @returns {'allow'|'deny'|'session'|null} null means "not ours; let it pass"
 */
export function permissionKeyDecision(e, ctx) {
  if (!e || !ctx) return null;
  if (e.ctrlKey || e.metaKey || e.altKey) return null;
  // Shift+S is WP-14's redaction toggle, always. Shift+A and Shift+D mean
  // nothing to the card either, so one rule covers all three.
  if (e.shiftKey) return null;
  if (!ctx.panelOpen || ctx.typing || ctx.dialogOpen) return null;
  const p = ctx.pending;
  if (!p || p.requiresUserInteraction) return null;
  switch (e.key) {
    case 'a':
    case 'A':
      return 'allow';
    case 'd':
    case 'D':
      return 'deny';
    case 's':
    case 'S':
      // No session-scoped suggestion means no third button, so `S` is not the
      // card's to take and falls through to the office snapshot.
      return Array.isArray(p.suggestions) && p.suggestions.length > 0 ? 'session' : null;
    default:
      return null;
  }
}

/**
 * A locally-computed guess at the agent's shape immediately after an
 * action, used purely for optimistic UI. The daemon's next snapshot
 * (pushed over SSE, typically within 250ms per docs/02-ARCHITECTURE.md §8)
 * is always the source of truth and overwrites this guess via refresh().
 * @param {any} agent
 * @param {string} action
 */
export function optimisticPatch(agent, action) {
  const now = Date.now();
  switch (action) {
    case 'acknowledge':
      return { ...agent, activityState: 'working', reviewSince: null, needsInputSince: null };
    case 'review':
      return { ...agent, activityState: 'for_review', reviewSince: agent.reviewSince ?? now };
    case 'bench':
      return { ...agent, ackState: 'benched' };
    case 'recall':
      return { ...agent, ackState: 'active' };
    case 'let_go':
      return { ...agent, ackState: 'let_go' };
    case 'rehire':
      return { ...agent, ackState: 'active' };
    default:
      return agent;
  }
}
