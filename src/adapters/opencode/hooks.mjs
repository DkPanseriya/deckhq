/**
 * OpenCode hook support. WP-25.
 *
 * **`supported: false`.** OpenCode has no settings-driven, shell-command hook
 * mechanism of the kind `describe()`/`install()` exist to write — there is no
 * `hooks` block in `opencode.json` that names a command per event.
 *
 * What it has instead is a **plugin API**: a JavaScript or TypeScript module
 * dropped in `.opencode/plugin/` or `~/.config/opencode/plugin/`, exporting
 * functions that receive typed events (`tool.execute.before`,
 * `tool.execute.after`, `event`, and the rest). Read from the plugin
 * documentation on 4 September 2026: https://opencode.ai/docs/plugins/
 *
 * That is a real integration point and a good one — it is how DeckHQ would
 * eventually get exact events out of OpenCode instead of polling. It is not
 * this interface. The distance is not cosmetic:
 *
 *   1. Installing it means **writing executable code into the user's config
 *      directory**, not a JSON block. The consent screen this interface is
 *      built around shows the user exactly what will be written
 *      (`HookPlan.json`); "a JavaScript file that will run inside your agent"
 *      is a different consent conversation, and it deserves a package that
 *      designs it rather than a paragraph that assumes it.
 *   2. It could never be tested here. OpenCode is not installed on this
 *      machine, so a plugin written on the strength of a documentation page
 *      would be shipped into somebody's working install having never once been
 *      loaded by the runtime it targets.
 *
 * So this reports unsupported and says so honestly — naming the plugin API
 * rather than claiming, as the Codex adapter truthfully can, that there is no
 * mechanism at all. Until it exists, OpenCode sessions take the daemon's
 * polling path (§4.2) and cannot distinguish `needs_input` from `stalled`.
 *
 * One consolation, recorded because it is genuinely better than Codex's
 * position: OpenCode stamps `time.completed` on an assistant message, so
 * `turnEnded` is READ rather than inferred from "the assistant spoke last"
 * (see ./parse.mjs `messageFromData`). Polling costs this adapter the
 * needs-input/stalled distinction; it does not cost it the turn boundary.
 *
 * `docs/DEVIATIONS.md` §123 records the decision and names the follow-up.
 */

/**
 * @returns {import('../../core/model.mjs').HookPlan}
 */
function describe() {
  return {
    file: '(none — DeckHQ does not install an OpenCode plugin)',
    json: '',
    events: [],
    note:
      'OpenCode has no shell-command hooks in its config file. It does have a plugin API — a ' +
      'JavaScript file in .opencode/plugin/ that receives tool and session events — but DeckHQ ' +
      'does not install one, and will not write executable code into your config directory on ' +
      'the strength of a documentation page it has never been able to test. Until it does, ' +
      'DeckHQ re-reads each OpenCode session periodically to follow its state. It can still tell ' +
      'exactly when a turn ended, because OpenCode records that itself — but it cannot tell a ' +
      'session waiting on your permission (“needs input”) from one that has simply stopped ' +
      '(“stalled”). Open the conversation to see which applies. Claude Code sessions are not ' +
      'affected.',
  };
}

/**
 * @returns {Promise<void>}
 */
async function install() {
  throw new Error(
    'DeckHQ does not install an OpenCode plugin. OpenCode has no shell-command hook mechanism, ' +
      'and DeckHQ falls back to polling for OpenCode sessions instead.',
  );
}

/**
 * @returns {Promise<void>}
 */
async function remove() {
  throw new Error('DeckHQ never installs OpenCode hooks, so there is nothing to remove.');
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
