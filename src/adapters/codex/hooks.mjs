/**
 * Codex hook support.
 *
 * Codex exposes no hook / callback mechanism equivalent to Claude Code's
 * settings-driven hooks (docs/02-ARCHITECTURE.md §2, §4.1). There is nothing
 * to install, nothing to write to disk, and nothing to remove. The daemon
 * degrades to polling for Codex sessions only (§4.2) — Claude Code sessions
 * are unaffected, per docs/04-BUILD-PLAN.md WP2: "disabling either adapter
 * leaves the other fully working."
 */

/**
 * @returns {import('../../core/model.mjs').HookPlan}
 */
function describe() {
  return {
    file: '(none — Codex has no hook mechanism)',
    json: '',
    events: [],
    note:
      'Codex does not provide a way for DeckHQ to be notified when something happens in a ' +
      'session. Instead, DeckHQ periodically re-reads each Codex session’s transcript file ' +
      'to guess its state. This means two things Codex cannot tell DeckHQ apart: a session ' +
      'waiting on your permission ("needs input") and a session that has simply stopped making ' +
      'progress ("stalled") look the same from the outside — both just show as an assistant ' +
      'turn having ended. Open the conversation to see which one actually applies. Claude Code ' +
      'sessions are not affected by this limitation.',
  };
}

/**
 * @returns {Promise<void>}
 */
async function install() {
  throw new Error(
    'Codex does not support hook installation — there is no hook mechanism to write to. ' +
      'DeckHQ falls back to polling for Codex sessions instead.',
  );
}

/**
 * @returns {Promise<void>}
 */
async function remove() {
  throw new Error('Codex does not support hook installation, so there is nothing to remove.');
}

/**
 * @returns {Promise<boolean>}
 */
async function installed() {
  return false;
}

export const hooks = {
  supported: false,
  describe,
  install,
  remove,
  installed,
};

export default hooks;
