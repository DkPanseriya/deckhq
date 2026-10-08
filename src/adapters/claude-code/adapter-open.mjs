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
import { APP_SESSION_ID, appSessionIdFor } from './desktop.mjs';

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
 * Build the Claude desktop app's deep link to ONE session. Pure and
 * side-effect free on purpose, so it can be unit tested directly instead of
 * through a spawned process.
 *
 * `claude://code/continue?session=<the app's own id>`.
 *
 * WHAT IS PROVED, AND HOW (WP-100, Claude desktop 2.26454 on Windows 11).
 * Until this package the link carried the TRANSCRIPT's id, and whether the
 * app honoured it was written here as unverified. It does not:
 *
 *   - the app's handler accepts `last`, or a value matching
 *     `^local_[A-Za-z0-9-]{1,64}$` — its own id for a session — and nothing
 *     else (read from the app's bundle);
 *   - sent a transcript uuid, it logged `claudeURLHandler: code entry link
 *     invalid ?session` and opened nothing (read from the app's own log);
 *   - sent the `local_…` id of another session, it showed that session: the
 *     `lastFocusedAt` the app keeps for it moved into the seconds of the test
 *     (read from the app's own store).
 *
 * There is no `&source=` on it any more. The link is handed to `cmd /c start`
 * on Windows, where an ampersand ends the command — so the tag the earlier
 * form carried was never arriving, and the rest of the line was being run as a
 * command of its own. The id is checked against the app's own pattern first,
 * which leaves nothing in the link `cmd` reads as syntax.
 *
 * So the id this takes is the app's, which `desktop.mjs` joins to a transcript
 * through the store the app writes, and a value that is not one is refused
 * here rather than sent to be refused there.
 *
 * @param {string} appSessionId  `local_…`, from `appSessionIdFor()`
 * @returns {string}
 */
export function buildAppResumeUri(appSessionId) {
  const id = String(appSessionId);
  if (!APP_SESSION_ID.test(id)) {
    throw new Error('Not an id the Claude desktop app opens a session by.');
  }
  return `claude://code/continue?session=${id}`;
}

/**
 * Can the desktop app open THIS session? Only one it has a record of, and has
 * not archived: a session started in a terminal is not the app's, and the
 * app's link opens nothing for it. Asked per session, so the panel offers
 * "in the app" only where the app will actually arrive.
 *
 * @param {string} sessionId
 * @param {{checkAvailable?: () => Promise<boolean>,
 *          appIdFor?: (id:string) => Promise<string|null>}} [opts] test seams
 * @returns {Promise<boolean>}
 */
export async function appAvailableFor(sessionId, opts = {}) {
  const checkAvailable = opts.checkAvailable || appAvailable;
  if (!(await checkAvailable())) return false;
  const appIdFor = opts.appIdFor || appSessionIdFor;
  return Boolean(await appIdFor(splitAgentId(sessionId).sessionId));
}

/**
 * Hand a session to the Claude desktop app via its `claude://` deep link,
 * through the OS URI handler. Always an argv array, never a shell string —
 * the id ends up inside a URL and must never be interpolated into a command
 * line.
 *
 * A session that is RUNNING in the app is shown, not restarted: the link
 * navigates the app to it. This is therefore also how "go to session" puts
 * the app on the right session before its window is raised.
 *
 * @param {string} sessionId
 * @param {string} cwd used only as the launcher process's own cwd; the deep
 *   link itself carries no directory — the app owns that once it opens.
 * @param {{checkAvailable?: () => Promise<boolean>,
 *          appIdFor?: (id:string) => Promise<string|null>,
 *          dispatch?: (uri:string, cwd:string) => Promise<void>}} [opts] test
 *   seams: the availability check in place of the real registry lookup, the
 *   store lookup in place of the app's real store, and `dispatch` in place of
 *   handing the OS a link — so no test ever opens the app on somebody's desk.
 *   Nothing is dispatched when either check says no.
 * @returns {Promise<void>}
 */
export async function openInApp(sessionId, cwd, opts = {}) {
  const checkAvailable = opts.checkAvailable || appAvailable;
  if (!(await checkAvailable())) {
    throw new Error(
      'No claude:// URI handler is registered on this machine — the Claude desktop app does not appear to be installed.',
    );
  }
  const appIdFor = opts.appIdFor || appSessionIdFor;
  const appId = await appIdFor(splitAgentId(sessionId).sessionId);
  if (!appId) {
    throw new Error(
      'The Claude desktop app has no record of this session (it was started in a terminal, or archived in the app), and the app’s link opens only its own sessions. Resume it in a terminal instead.',
    );
  }
  const uri = buildAppResumeUri(appId);
  await (opts.dispatch || dispatchUri)(uri, cwd);
}

/**
 * Hand the OS one URI to open with whatever is registered for its scheme.
 * @param {string} uri @param {string} cwd
 * @returns {Promise<void>}
 */
async function dispatchUri(uri, cwd) {
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
 * The argv a brand-new session is started with. Pure, so the exact array can
 * be asserted element by element rather than reasoned about — WP-67's
 * acceptance criterion (2), and the same discipline `terminals.mjs` rule 4
 * holds for every launch form.
 *
 * Two optional parts, in this order:
 *
 *   `--append-system-prompt-file <path>`  WP-67. A brief is long and a prompt
 *     is an argument (§4), so the brief travels as a FILE and only its path is
 *     on the command line. The flag is not in `claude --help`'s option list on
 *     this machine (2.1.260) — it appears only inside the `--bare` paragraph —
 *     but it is accepted and it validates its argument: a missing file is
 *     `Error: Append system prompt file not found: <path>`, which is how its
 *     existence was established rather than assumed. `docs/DEVIATIONS.md` §159.
 *   the first prompt, as ONE element.
 *
 * Nothing here is ever a shell string. A path and a prompt are user data, and
 * `docs/DEVIATIONS.md` §28 is why that rule is absolute in this area.
 *
 * @param {{instructions?: string, systemPromptFile?: string}} [opts]
 * @returns {string[]}
 */
export function newSessionCommand(opts = {}) {
  /** @type {string[]} */
  const argv = ['claude'];
  const briefFile = String(opts.systemPromptFile || '').trim();
  if (briefFile) argv.push('--append-system-prompt-file', briefFile);
  const prompt = String(opts.instructions || '').trim();
  if (prompt) argv.push(prompt);
  return argv;
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
 * with user data interpolated into it. The macOS wrapper script is the one
 * place a value becomes part of a shell line, and `shQuote` there quotes it
 * whole — the old macOS path dropped the prompt entirely rather than face
 * that, which was a silent difference in behaviour between platforms.
 *
 * @param {string} cwd absolute path to an existing directory
 * @param {{instructions?: string, terminal?: string, systemPromptFile?: string,
 *          launch?: (opts:any) => Promise<any>}} [opts] an optional first
 *   prompt, the user's pinned emulator from settings, an optional brief file
 *   (WP-67), and `launch` — a test seam in place of `launchTerminal`, for the
 *   same reason `launchTerminal` has `spawn`, `detect` and `writeScript`: a
 *   test must never open a real terminal window on somebody's desktop. The
 *   daemon passes none of it in production.
 * @returns {Promise<void>}
 */
export async function openNewSession(cwd, opts = {}) {
  const launch = opts.launch || launchTerminal;
  await launch({
    command: newSessionCommand(opts),
    cwd,
    prefix: 'new',
    pin: opts.terminal,
  });
}
