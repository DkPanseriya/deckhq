/**
 * Opening a session somewhere the user can type in it (WP-22 follow-up).
 *
 * Split out of `adapter.mjs` unchanged: resume in a terminal, resume in the
 * desktop app — including whether a `claude://` handler exists at all, which
 * is checked rather than guessed — and starting a new session in a project.
 */

import { execFile, spawn } from 'node:child_process';
import { splitAgentId } from '../../core/model.mjs';
import { launchTerminal, trySpawnDetached } from '../../core/terminals.mjs';

/**
 * Spawn an interactive terminal attached to this session.
 *
 * Which terminal, and the exact argv each one needs, is
 * `../../core/terminals.mjs`'s
 * job — this function's is only to name the command. The rule it enforces is
 * the one from `docs/DEVIATIONS.md` §28: the session id travels as one argv
 * element of `command` and nothing here builds a shell string out of it.
 *
 * @param {string} id
 * @param {string} cwd
 * @param {{terminal?: string}} [opts] `terminal` is the user's pinned
 *   emulator from settings (`auto` when they have not pinned one). The HTTP
 *   route passes it; a caller that does not gets detection.
 * @returns {Promise<void>}
 */
export async function openInTerminal(id, cwd, opts = {}) {
  const { sessionId } = splitAgentId(id);
  await launchTerminal({
    command: ['claude', '--resume', sessionId],
    cwd,
    sessionId,
    prefix: 'resume',
    pin: opts.terminal,
  });
}

export let appAvailableCache = null;

/**
 * Is a `claude://` URI handler registered on this machine — i.e. is the
 * Claude desktop app installed? Cached for the process lifetime, like
 * `available()` above.
 *
 * Checked via the Windows registry (`HKCU\SOFTWARE\Classes\claude`), which
 * is where a per-user protocol handler registration lives. macOS
 * (LaunchServices) and Linux (xdg-mime) detection has not been implemented
 * or verified on any machine this has run on, so both report false rather
 * than guess — a false negative here only hides the "Open in app" option;
 * a false positive would hand the user off to an app that cannot actually
 * receive the link.
 * @returns {Promise<boolean>}
 */
export async function appAvailable() {
  if (appAvailableCache !== null) return appAvailableCache;
  appAvailableCache = await computeAppAvailable();
  return appAvailableCache;
}

/** @returns {Promise<boolean>} */
export function computeAppAvailable() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', 'HKCU\\SOFTWARE\\Classes\\claude'],
      { windowsHide: true, timeout: 5000 },
      (err) => resolve(!err),
    );
  });
}

/**
 * Build the Claude desktop app's deep link to resume one session. Pure and
 * side-effect free on purpose, so it can be unit tested directly instead of
 * through a spawned process.
 *
 * Route found by reading the app's `app.asar`:
 * `claude://code/continue?session=<id>&source=<tag>`. `session=last` is
 * confirmed — it is what the app's own OS-launcher entry sends itself.
 * Whether `session=<uuid>` resolves *this specific* session is UNVERIFIED:
 * the route was found, not the code that consumes the parameter. If the app
 * does not honour an unrecognised session value, this still does no harm —
 * it just opens to whatever the app does by default, same as if no session
 * had been requested at all.
 * @param {string} sessionId
 * @returns {string}
 */
export function buildAppResumeUri(sessionId) {
  return `claude://code/continue?session=${encodeURIComponent(String(sessionId))}&source=deckhq`;
}

/**
 * Hand a session to the Claude desktop app via its `claude://` deep link,
 * through the OS URI handler. Always an argv array, never a shell string —
 * the session id ends up inside a URL and must never be interpolated into a
 * command line.
 *
 * Whether the app actually resumes the requested session, rather than just
 * opening to its own default view, is UNVERIFIED — see `buildAppResumeUri`.
 * This function's job ends at handing the OS a well-formed URI to dispatch.
 *
 * @param {string} sessionId
 * @param {string} cwd used only as the launcher process's own cwd; the deep
 *   link itself carries no directory — the app owns that once it opens.
 * @param {{checkAvailable?: () => Promise<boolean>}} [opts] test seam:
 *   override the availability check in place of the real registry lookup.
 *   Defaults to the real `appAvailable()`. Never spawns anything when the
 *   override reports unavailable, which is what makes this branch testable
 *   without touching the registry or a real process.
 * @returns {Promise<void>}
 */
export async function openInApp(sessionId, cwd, opts = {}) {
  const checkAvailable = opts.checkAvailable || appAvailable;
  if (!(await checkAvailable())) {
    throw new Error(
      'No claude:// URI handler is registered on this machine — the Claude desktop app does not appear to be installed.',
    );
  }
  const uri = buildAppResumeUri(sessionId);

  if (process.platform === 'win32') {
    const child = spawn('cmd', ['/c', 'start', '', uri], { cwd, detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }

  if (process.platform === 'darwin') {
    const child = spawn('open', [uri], { cwd, detached: true, stdio: 'ignore' });
    child.unref();
    return;
  }

  // Linux: appAvailable() always reports false above, so this branch cannot
  // be reached yet — written now so nothing further is needed here once
  // detection is added for this platform too.
  const ok = await trySpawnDetached('xdg-open', [uri], cwd);
  if (!ok) throw new Error('xdg-open was not found; cannot hand off to the desktop app.');
}

/**
 * Open a terminal running a BRAND NEW session in `cwd`.
 *
 * This is how a new room appears on the floor: point DeckHQ at a project
 * directory, it starts a session there, and the next scan discovers it and
 * lays out a room with a table sized to the team. There is deliberately no
 * "create project" concept in the daemon beyond this — the project is the
 * directory, and the session is Claude Code's to own.
 *
 * Same discipline as `openInTerminal`: argv arrays only, never a shell string
 * with user data interpolated into it.
 *
 * @param {string} cwd absolute path to an existing directory
 * @param {{instructions?: string, terminal?: string}} [opts] an optional first
 *   prompt, and the user's pinned emulator from settings
 * @returns {Promise<void>}
 */
export async function openNewSession(cwd, opts = {}) {
  // An initial prompt is passed as one argv element. It is user text and must
  // never reach a shell as part of a command string. The macOS wrapper script
  // is the one place it becomes part of a shell line, and `shQuote` there
  // quotes it whole — the old macOS path dropped the prompt entirely rather
  // than face that, which was a silent difference in behaviour between
  // platforms.
  const prompt = String(opts.instructions || '').trim();
  await launchTerminal({
    command: prompt ? ['claude', prompt] : ['claude'],
    cwd,
    prefix: 'new',
    pin: opts.terminal,
  });
}
