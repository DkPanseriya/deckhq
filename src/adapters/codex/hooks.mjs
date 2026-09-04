/**
 * Codex hook support. WP-23a.
 *
 * **`supported: false`, and no longer for §8's reason.**
 *
 * This file used to tell the user that Codex "does not provide a way for
 * DeckHQ to be notified when something happens in a session". In Codex 0.153.1
 * that is **untrue**, and it is untrue in precisely the way `ADAPTERS.md` §5
 * and `08-PLAN-V2-100X.md` §1.1 rule 11 forbid: a false statement about
 * somebody else's product, which is as bad as a false statement about ours.
 *
 * What is actually there, read out of the installed `codex.exe` 0.153.1's own
 * string table rather than from a documentation page (`docs/DEVIATIONS.md`
 * §135.3, `docs/plan/CODEX-VERIFICATION.md` §3.4):
 *
 *   - `~/.codex/hooks.json`, with `failed to parse hooks config` and
 *     `failed to read hooks co…` beside it, plus `[hooks]` tables in
 *     `config.toml` and the same two under a repository's `.codex/`.
 *   - `PermissionRequest` (×51), `hook_event_name` (×26), `hookSpecificOutput`
 *     (×8), and the events `SessionStart`, `SessionEnd`, `PreToolUse`,
 *     `PostToolUse`, `UserPromptSubmit`, `TurnStart`, `TurnEnd` and
 *     `Notification`.
 *   - A `PermissionRequest` response in the OBJECT form —
 *     `hookSpecificOutput.decision.behavior` of `allow`/`deny` — which is
 *     independent corroboration of what §86.3 read out of the Claude Code
 *     binary.
 *   - Hook types **`command` and `mcp_tool` only. There is still no `http`
 *     type**, so §86.6's option 2 — a `command` hook that relays to the daemon
 *     on stdin/stdout — remains Codex's only route, exactly as WP-19's spike
 *     concluded. WP-58 is that package.
 *
 * So Codex is not in §8's position any more; it is in Gemini CLI's (§123.4),
 * and `describe()` says the same kind of thing Gemini CLI's does. The honest
 * report is not "this runtime cannot be observed", it is **"this runtime can
 * be observed and DeckHQ has not wired it up yet"**.
 *
 * WP-23 tried to close that gap without writing anything into the user's
 * `~/.codex`, and could not (`docs/DEVIATIONS.md` §137.7). MEASURED on
 * 0.153.1, from a scratch repository, against the two routes that need no
 * write to somebody else's home:
 *
 *   - a project-local `<repo>/.codex/hooks.json`, and
 *   - the same table injected as a session flag, `-c hooks.SessionStart=[…]`,
 *
 * neither of which delivered a single event to a listener that logs every one
 * it is handed — not `SessionStart`, not `UserPromptSubmit`. The binary
 * explains why and offers a third route this run would not take: hooks carry a
 * `trusted_hash` and a `--dangerously-bypass-hook-trust` flag, so a hook that
 * has not been trusted through the interactive TUI does not run. And
 * `codex exec` prints `approval: never`, so `PermissionRequest` has no trigger
 * in the non-interactive surface at all. Whatever WP-58 turns out to be, it is
 * not "write a hooks.json and poll".
 *
 * `supported: false` **stays**, and it is not a formality:
 *
 *   1. Nobody has written a `hooks.json` on a real install and watched Codex
 *      read it back — WP-23 tried the two routes above and got nothing.
 *      `ADAPTERS.md` §5 is explicit that a documented mechanism you have never
 *      tested is still `supported: false`, and installing hooks **writes to a
 *      file the user owns** — the one class of mistake that breaks a working
 *      install of another product.
 *   2. There is no `http` type, so DeckHQ's existing hook block does not
 *      translate: the daemon's hook route speaks Claude Code's payload
 *      spellings over HTTP, and a `command` hook that reads the daemon's port
 *      and relays is a package with its own tests, not a paragraph in this one.
 *
 * Until then Codex sessions take the daemon's polling path (§4.2), which
 * cannot tell `needs_input` from `stalled`.
 */

/**
 * @returns {import('../../core/model.mjs').HookPlan}
 */
function describe() {
  return {
    file: '(none — DeckHQ does not install Codex hooks yet)',
    json: '',
    events: [],
    note:
      'Codex does have a hooks mechanism — a ~/.codex/hooks.json with events including ' +
      'PermissionRequest, SessionStart, SessionEnd, PreToolUse and PostToolUse — but DeckHQ does ' +
      'not install or read it yet, and will not write into your Codex configuration on the ' +
      'strength of something it has never been able to test. Codex also offers no HTTP hook ' +
      'type, so reaching DeckHQ needs a command hook that relays to it, which is its own piece ' +
      'of work. Until then, DeckHQ periodically re-reads each Codex session’s transcript file to ' +
      'guess its state. Two things it therefore cannot tell apart: a session waiting on your ' +
      'permission (“needs input”) and a session that has simply stopped making progress ' +
      '(“stalled”). Open the conversation to see which applies. Claude Code sessions are not ' +
      'affected.',
  };
}

/**
 * @returns {Promise<void>}
 */
async function install() {
  throw new Error(
    'DeckHQ does not install Codex hooks yet. Codex has a hook mechanism, but it offers no HTTP ' +
      'hook type and DeckHQ has never been able to test writing to it, so it falls back to ' +
      'polling for Codex sessions instead.',
  );
}

/**
 * @returns {Promise<void>}
 */
async function remove() {
  throw new Error('DeckHQ never installs Codex hooks, so there is nothing to remove.');
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
