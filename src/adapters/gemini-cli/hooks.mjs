/**
 * Gemini CLI hook support. WP-24.
 *
 * **`supported: false`, and for a different reason than Codex's.**
 *
 * Codex has no hook mechanism at all (`docs/DEVIATIONS.md` §8). Gemini CLI
 * does: a `hooks` block in `~/.gemini/settings.json`, with `BeforeTool`,
 * `AfterTool`, `BeforeAgent`, `AfterAgent`, `BeforeModel`,
 * `BeforeToolSelection`, `AfterModel`, `SessionStart`, `SessionEnd`,
 * `Notification` and `PreCompress`, each running a command and receiving
 * `session_id`, `transcript_path`, `cwd`, `hook_event_name` and the
 * event-specific fields on stdin. Read from the published reference on
 * 4 September 2026: https://geminicli.com/docs/hooks/reference/
 *
 * So the honest report here is not "this runtime cannot be observed", it is
 * **"this runtime can be observed and DeckHQ has not wired it up yet"**, and
 * `describe()` says exactly that. Claiming the Codex sentence would be a false
 * statement about somebody else's product, which `08` §1.1 rule 11 forbids as
 * firmly as a false statement about our own.
 *
 * Why it is not wired up in this package:
 *
 *   1. Installing hooks **writes to a file the user owns**, behind a consent
 *      screen that shows exactly what will be written. Gemini CLI is not
 *      installed on this machine, so nothing that could be written here has
 *      ever been read back by the runtime it is for. Writing into somebody's
 *      real `settings.json` on the strength of a documentation page, with no
 *      way to check the result, is the one class of mistake this codebase
 *      cannot make quietly — it breaks a working install of another product.
 *   2. The daemon's hook route reads Claude Code's payload spellings
 *      (`hooks.toolSummary`, `hooks.permissionRequest`, `hooks.subagentEvent`
 *      in `src/adapters/claude-code/adapter.mjs`). A second event vocabulary
 *      is a real package with its own event-name mapping and its own tests,
 *      the size of WP-58, not a paragraph in this one.
 *
 * Until then Gemini CLI sessions take the daemon's polling path (§4.2), which
 * cannot tell `needs_input` from `stalled`. `docs/DEVIATIONS.md` §123 records
 * the decision and names the follow-up.
 */

/**
 * @returns {import('../../core/model.mjs').HookPlan}
 */
function describe() {
  return {
    file: '(none — DeckHQ does not install Gemini CLI hooks yet)',
    json: '',
    events: [],
    note:
      'Gemini CLI does have a hooks mechanism — a “hooks” block in ~/.gemini/settings.json, with ' +
      'events including BeforeTool, AfterTool, SessionStart and SessionEnd — but DeckHQ does not ' +
      'install or read it yet, and will not write into your settings file on the strength of a ' +
      'documentation page it has never been able to test. Until it does, DeckHQ periodically ' +
      're-reads each Gemini CLI session’s file to guess its state. Two things it therefore cannot ' +
      'tell apart: a session waiting on your permission (“needs input”) and a session that has ' +
      'simply stopped making progress (“stalled”). Open the conversation to see which applies. ' +
      'Claude Code sessions are not affected.',
  };
}

/**
 * @returns {Promise<void>}
 */
async function install() {
  throw new Error(
    'DeckHQ does not install Gemini CLI hooks yet. Gemini CLI has a hook mechanism, but DeckHQ ' +
      'has never been able to test writing to it, so it falls back to polling for Gemini CLI ' +
      'sessions instead.',
  );
}

/**
 * @returns {Promise<void>}
 */
async function remove() {
  throw new Error('DeckHQ never installs Gemini CLI hooks, so there is nothing to remove.');
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
