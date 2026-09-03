/**
 * OS notifications from the daemon — WP-16, "notifications that survive the
 * closed tab".
 *
 * The browser's `Notification` needs the page alive, which defeats the point:
 * the daemon outlives the tab by design (`docs/plan/08-PLAN-V2-100X.md` §1.2,
 * §14). This module is the daemon's own notifier. It has no dependencies: one
 * process per notification, on a platform command that is already there.
 *
 * THE INTERRUPTION BUDGET (`docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §6)
 * is spent by `notify-watch.mjs`, not here. This module only knows how to put
 * one line in front of someone.
 *
 * TWO RULES GOVERN EVERY COMMAND BELOW.
 *
 * 1. **Argv arrays, never shell strings.** A session's label and its project
 *    name are user data. They travel as individual argv elements to
 *    `spawn()`, and no shell parses them. `docs/DEVIATIONS.md` §28 is why
 *    that rule is absolute in this area; §91 and §95 are what happened the
 *    two times it was bent.
 * 2. **The notifier is optional.** A machine with no `notify-send`, a
 *    PowerShell locked down by policy, a user who said no: every one of them
 *    degrades to the PWA badge in silence. Nothing here throws, logs an
 *    error, or reports a failure to the user.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/**
 * The fixed PowerShell script the Windows path runs. Its text never varies;
 * see the header of the file itself for why `-File` and not `-Command`.
 */
export const WINDOWS_SCRIPT = path.join(HERE, 'notify.ps1');

/** The app name a notification presents itself under, where the platform asks. */
export const APP_NAME = 'DeckHQ';

/** Notification text is one line. Anything longer is a panel, not a toast. */
const MAX_TEXT = 120;

/**
 * Collapse a value to a single tidy line and cap it.
 *
 * Control characters are removed rather than escaped: they cannot break out
 * of an argv element — that is the point of argv elements — but a newline in
 * a toast body is a rendering surprise on three platforms with three
 * different answers, and none of them is useful.
 * @param {unknown} value
 * @param {number} [max]
 * @returns {string}
 */
export function oneLine(value, max = MAX_TEXT) {
  const s = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * The exact argv for one notification on one platform, or `null` where this
 * project knows of no notifier.
 *
 * A pure function on purpose: every array it can produce is asserted in
 * `test/unit/notify.test.mjs` rather than reasoned about, including with a
 * hostile title. Nothing in here spawns anything.
 *
 * @param {NodeJS.Platform|string} platform
 * @param {string} title
 * @param {string} body
 * @param {{scriptPath?: string}} [opts]
 * @returns {{command: string, args: string[]}|null}
 */
export function notifyCommand(platform, title, body, opts = {}) {
  const t = oneLine(title);
  const b = oneLine(body);
  if (!t && !b) return null;

  if (platform === 'win32') {
    return {
      command: 'powershell',
      args: [
        '-NoProfile',
        '-NonInteractive',
        // The script is ours and ships inside the package. Bypass applies to
        // this one invocation and changes no machine policy.
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        opts.scriptPath || WINDOWS_SCRIPT,
        '-Title',
        t,
        '-Body',
        b,
      ],
    };
  }

  if (platform === 'darwin') {
    // `on run argv` is the only form of `display notification` that takes its
    // text as arguments. Written as three `-e` statements whose text is
    // fixed; the title and body are the two trailing argv elements and are
    // never part of any statement.
    return {
      command: 'osascript',
      args: [
        '-e',
        'on run argv',
        '-e',
        'display notification (item 2 of argv) with title (item 1 of argv)',
        '-e',
        'end run',
        t,
        b,
      ],
    };
  }

  // Everything else that has a freedesktop notification daemon. `--` stops
  // GLib's option parser, so a body that begins with a dash is a body.
  if (platform === 'linux' || platform === 'freebsd' || platform === 'openbsd') {
    return { command: 'notify-send', args: [`--app-name=${APP_NAME}`, '--', t, b] };
  }

  return null;
}

/**
 * Put one notification in front of the user, if this machine has a way to.
 *
 * Returns whether a notifier was *launched*, not whether anything appeared:
 * whether the user sees it is between them and their operating system, and
 * DeckHQ deliberately does not find out. Every failure — no such platform, no
 * such binary, a policy refusal, a non-zero exit — is silent, because the
 * badge is already carrying the same count.
 *
 * @param {object} opts
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {NodeJS.Platform|string} [opts.platform]
 * @param {typeof spawn} [opts.spawn] injected by the tests; nothing else passes it
 * @param {string} [opts.scriptPath]
 * @returns {boolean}
 */
export function sendNotification({
  title,
  body,
  platform = process.platform,
  spawn: spawnFn = spawn,
  scriptPath,
}) {
  const cmd = notifyCommand(platform, title, body, { scriptPath });
  if (!cmd) return false;
  try {
    const child = spawnFn(cmd.command, cmd.args, {
      stdio: 'ignore',
      windowsHide: true,
    });
    // A missing notifier arrives as an async 'error' event. Unhandled, it
    // would take the daemon down over a toast.
    if (child && typeof child.on === 'function') child.on('error', () => {});
    if (child && typeof child.unref === 'function') child.unref();
    return true;
  } catch {
    return false;
  }
}

/** Does this platform have a notifier this module knows how to drive? */
export function notifierAvailable(platform = process.platform) {
  return notifyCommand(platform, APP_NAME, 'probe') !== null;
}
