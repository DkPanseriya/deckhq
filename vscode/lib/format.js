/**
 * Turning a daemon snapshot into the two pieces of text this extension shows:
 * the status bar item, and the rows of the "Show waiting" quick pick.
 *
 * Nothing in this file touches the `vscode` module, the network, or the disk.
 * It is a pure function of a snapshot, which is what makes it testable from
 * the repository's own `node --test` suite without a running editor.
 *
 * **Why the arithmetic is not repeated here.** `counts` comes off the wire
 * exactly as `/api/state` computed it. `docs/DEVIATIONS.md` has five entries
 * on the cost of two representations of the same thing being allowed to
 * disagree, and a status bar that counted the queue itself would be a sixth.
 * The one predicate that is restated — `needsYou` — is asserted against
 * `src/core/model.mjs` by a test, for the same reason.
 */

/** The glyph. The same mark the floor and `deckhq statusline` use. */
const MARK = '▣';

/**
 * The states that put an agent on the user's plate. Mirrors
 * `NEEDS_YOU_STATES` in `src/core/model.mjs`; the test asserts they agree.
 */
const NEEDS_YOU_STATES = ['needs_input', 'stalled', 'for_review'];

/**
 * Is this agent waiting on the user? Mirrors `needsYou()` in
 * `src/core/model.mjs`.
 * @param {any} agent
 * @returns {boolean}
 */
function needsYou(agent) {
  return Boolean(
    agent && agent.ackState === 'active' && NEEDS_YOU_STATES.includes(agent.activityState),
  );
}

/** @param {unknown} v @returns {number} */
function count(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0;
}

/**
 * The status bar label.
 *
 * Four states, and every one of them says something:
 *
 *   - `▣ 3 waiting · 1 hand up` — the queue, the same line the Claude Code
 *     status line renders, so two surfaces on one screen cannot disagree.
 *   - `▣ clear` — a daemon is up and nothing is owed. Worth showing: a blank
 *     would have to be read as either "nothing" or "broken".
 *   - `▣ starting…` — we spawned a daemon and are waiting for it to answer.
 *   - `▣ off` — no daemon on loopback.
 *
 * Never says "you" (`docs/plan/08-PLAN-V2-100X.md` §1.1 rule 6): the queue is
 * the team's and the fault is nobody's.
 *
 * @param {{status?:'connected'|'starting'|'off', counts?:any}} state
 * @returns {string}
 */
function statusBarText(state) {
  const status = state && state.status ? state.status : 'off';
  if (status === 'starting') return `${MARK} starting…`;
  if (status !== 'connected') return `${MARK} off`;
  const c = (state && state.counts) || {};
  const waiting = count(c.needsYou);
  const handsUp = count(c.handsUp);
  const parts = [];
  if (waiting > 0) parts.push(`${waiting} waiting`);
  if (handsUp > 0) parts.push(`${handsUp} hand${handsUp === 1 ? '' : 's'} up`);
  return parts.length ? `${MARK} ${parts.join(' · ')}` : `${MARK} clear`;
}

/**
 * The hover text under the status bar item. Markdown is rendered by VS Code.
 * @param {{status?:string, counts?:any, port?:number|null}} state
 * @returns {string}
 */
function statusBarTooltip(state) {
  const status = state && state.status;
  if (status === 'starting') return 'DeckHQ — starting the daemon on 127.0.0.1…';
  if (status !== 'connected') {
    return 'DeckHQ — no daemon on 127.0.0.1. Run “DeckHQ: Start daemon”.';
  }
  const c = (state && state.counts) || {};
  const lines = [
    `**DeckHQ** — 127.0.0.1:${state.port}`,
    '',
    `${count(c.forReview)} for review · ${count(c.handsUp)} hands up · ${count(c.stalled)} stalled`,
    `${count(c.atDesk)} at a desk · ${count(c.benched)} benched`,
    '',
    'Click to open the floor.',
  ];
  return lines.join('\n');
}

/** @param {number} ms @returns {string} */
function elapsed(ms) {
  if (!(ms > 0)) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** @param {unknown} n @returns {number|null} */
function positive(n) {
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * When this agent started waiting. Same order as `waitStart()` in
 * `src/cli/source.mjs`: the user-owned timestamps first, because they are what
 * the queue is ordered by and what survives a restart.
 * @param {any} agent
 * @returns {number}
 */
function waitStart(agent) {
  return (
    positive(agent && agent.reviewSince) ??
    positive(agent && agent.needsInputSince) ??
    positive(agent && agent.lastOutputAt) ??
    positive(agent && agent.lastActivityAt) ??
    0
  );
}

/** One line of state, in the words the floor uses. @param {any} agent */
function stateWord(agent) {
  if (agent.activityState === 'needs_input') return 'hand up';
  if (agent.activityState === 'stalled') return 'stalled';
  if (agent.activityState === 'for_review') return 'for review';
  return String(agent.activityState || '');
}

/** @param {string} text @param {number} max */
function truncate(text, max) {
  const one = String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
}

/**
 * The rows of "DeckHQ: Show waiting" — the needs-you queue, oldest first,
 * which is the order `deckhq waiting` and the floor's office both use.
 *
 * @param {{agents?:any[]}} snapshot
 * @param {number} [now]
 * @returns {Array<{id:string, label:string, description:string, detail:string}>}
 */
function waitingItems(snapshot, now = Date.now()) {
  const agents = snapshot && Array.isArray(snapshot.agents) ? snapshot.agents : [];
  return agents
    .filter(needsYou)
    .slice()
    .sort((a, b) => (waitStart(a) || now) - (waitStart(b) || now))
    .map((agent) => {
      const since = waitStart(agent);
      const waited = since ? elapsed(now - since) : '';
      const who = agent.displayName || agent.mk || String(agent.id || '').slice(0, 8);
      return {
        id: String(agent.id || ''),
        label: `$(clock) ${waited ? waited.padEnd(4) : ''} ${who}`.replace(/\s+/g, ' ').trim(),
        description: `${agent.projectName || ''} · ${stateWord(agent)}`,
        detail: truncate(agent.lastText || agent.title || '', 140),
      };
    });
}

module.exports = {
  MARK,
  NEEDS_YOU_STATES,
  needsYou,
  statusBarText,
  statusBarTooltip,
  waitingItems,
  waitStart,
  elapsed,
};
