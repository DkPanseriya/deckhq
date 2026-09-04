/**
 * Claude Code runtime adapter. Implements the `RuntimeAdapter` interface from
 * docs/02-ARCHITECTURE.md §2. All transcript parsing is delegated to
 * ./parse.mjs; nothing here reads a `.jsonl` line directly.
 *
 * ============================================================================
 * WP-22 follow-up · this file is the `RuntimeAdapter` object itself — the
 * one place that says which function answers which part of the interface.
 * The functions are five modules, all re-exported from here:
 *
 *   adapter-live.mjs   the liveness probe and the roster
 *   adapter-scan.mjs   the transcript directory, the subagent index, the scan
 *   adapter-send.mjs   one conversation, and sending a turn into it
 *   adapter-watch.mjs  WP-09's tail watch
 *   adapter-open.mjs   resume in a terminal, in the app, or start a new one
 * ============================================================================
 */

import { CLAUDE_DIR, subagentEvent } from './parse.mjs';
import { countCatchphrase } from './catchphrase.mjs';
import * as hooksImpl from './hooks.mjs';
import { RUNTIME_ID, available, liveSessions } from './adapter-live.mjs';
import { scanSessions } from './adapter-scan.mjs';
import { conversation, send } from './adapter-send.mjs';
import { watchConversation } from './adapter-watch.mjs';
import { appAvailable, openInApp, openInTerminal, openNewSession } from './adapter-open.mjs';

export * from './adapter-live.mjs';
export * from './adapter-scan.mjs';
export * from './adapter-send.mjs';
export * from './adapter-watch.mjs';
export * from './adapter-open.mjs';

export const adapter = {
  id: RUNTIME_ID,
  label: 'Claude Code',
  available,
  liveSessions,
  scanSessions,
  conversation,
  // WP-09. `send` streams its events to `opts.onEvent` as they arrive and
  // still resolves to the same SendResult; `watchConversation` is how a reply
  // typed in a terminal reaches the open panel without a poll.
  send,
  watchConversation,
  openInTerminal,
  appAvailable,
  openInApp,
  openNewSession,
  // WP-27, and the debt docs/DEVIATIONS.md §119.2 recorded: Wrapped's phrase
  // count is a read of this runtime's transcripts, so it is adapter work by
  // `08` §1.1 rule 8 — and it belongs HERE, on the adapter object, not in a
  // per-runtime table in the registry. It sat in that table only because this
  // file was held by WP-09 while WP-27 was written. §123 closes it: one line
  // here, one line in `../index.mjs`, no behaviour change. An adapter that
  // cannot count the phrase simply omits this method.
  countCatchphrase,
  hooks: {
    supported: hooksImpl.supported,
    describe: hooksImpl.describe,
    install: hooksImpl.install,
    remove: hooksImpl.remove,
    installed: hooksImpl.installed,
    installedPort: hooksImpl.installedPort,
    // WP-37: the same hooks can arrive as a plugin, which puts nothing in
    // settings.json. Reported separately so the status screen can say which
    // of the two routes is delivering.
    pluginInstalled: hooksImpl.pluginInstalled,
    // WP-52: the runtime's own `PreToolUse` payload shape is this adapter's
    // business, so the HTTP route asks the adapter what the payload says
    // rather than parsing it itself.
    toolSummary: hooksImpl.toolSummary,
    // WP-19: same rule for the `PermissionRequest` payload and for the body
    // that answers it. The route holds the socket; the adapter owns the
    // spelling on both ends of it.
    permissionRequest: hooksImpl.permissionRequest,
    permissionDecisionBody: hooksImpl.permissionDecisionBody,
    // WP-41: and the same rule again for `SubagentStop`. Which junior a stop
    // event is about is a question about Claude Code's payload spelling, so
    // the route asks the adapter rather than guessing at a key name itself.
    subagentEvent,
  },
};

export default adapter;

// Re-exported for tests and tooling that want the raw settings-file path
// without reaching into hooks.mjs directly.
export { CLAUDE_DIR };

// buildAppResumeUri is already a named export at its declaration above —
// tests import it directly (it's the pure half of openInApp, factored out
// so the deep link's shape can be checked without spawning anything).
