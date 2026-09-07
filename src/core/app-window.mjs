/**
 * The floor in a window of its own — WP-62.
 *
 * `deckhq` opens the default browser, and the floor arrives as one more tab in
 * a row of forty. That is the wrong container for a thing whose whole job is
 * to be glanceable: it has no icon in the taskbar, it loses its size the
 * moment the tab is dragged, and it sits behind whatever the user was reading.
 * A Chromium browser will open a URL as an application window instead —
 * `--app=<url>` — with no tab strip, no omnibox, its own taskbar button, and a
 * title taken from the page.
 *
 * This module is the pure half: given a platform, a browser executable and a
 * URL, it returns the exact argv. Nothing here spawns anything, reads a disk
 * or asks an OS a question, so every array it can produce is asserted in
 * `test/unit/app-window.test.mjs` against an injected platform rather than
 * reasoned about — the discipline `docs/DEVIATIONS.md` §91 and §98 exist to
 * enforce.
 *
 * TWO RULES, the same two the notifier holds (`src/core/notify.mjs`):
 *
 *  1. **Argv arrays, never shell strings.** The URL carries a port this
 *     process chose and the profile path carries the user's home directory.
 *     Neither is user data in the hostile sense, and both travel as individual
 *     argv elements anyway, because the one time this project bent that rule
 *     it cost §98.
 *  2. **The window is optional.** A machine with no Chromium-family browser
 *     falls back to the default browser and says so in one line. Nothing here
 *     throws because a browser is missing.
 *
 * No egress: the URL is always loopback, and the caller asserts it.
 */
import path from 'node:path';
import process from 'node:process';

/** The app window's size on a first run, before Chrome remembers its own. */
export const DEFAULT_WIDTH = 1600;
export const DEFAULT_HEIGHT = 1000;

/**
 * The profile directory, under the state dir rather than beside the user's own.
 *
 * An `--app` window sharing the default profile inherits every extension, every
 * logged-in session and every open tab of the user's real browser, and — the
 * part that actually bites — Chrome then treats the app window as one more
 * window of an already-running instance, which means the process exits
 * immediately and the window's geometry is stored in a profile the user's own
 * browsing is rewriting. Its own profile makes the window remember its size and
 * position, keeps DeckHQ out of the user's browsing, and keeps the user's
 * browsing out of DeckHQ.
 *
 * @param {string} dataDir
 * @returns {string}
 */
export function appProfileDir(dataDir) {
  return path.join(dataDir, 'app-profile');
}

/**
 * `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` →
 * `/Applications/Google Chrome.app`.
 *
 * macOS needs the bundle, not the executable inside it: `open -na` takes an
 * application, and handing it the Mach-O binary launches a second, unmanaged
 * copy with no dock identity. Returns null when the path is not inside a
 * bundle, which is how a Homebrew-linked binary degrades to the direct spawn.
 *
 * @param {string} exe
 * @returns {string|null}
 */
export function macAppBundle(exe) {
  const marker = '.app/Contents/MacOS/';
  const i = String(exe || '').indexOf(marker);
  if (i === -1) return null;
  return String(exe).slice(0, i + 4);
}

/**
 * The exact argv for one app window, or null when this platform is not one
 * this module knows how to ask.
 *
 * The flags, and why each is there:
 *
 *   --app=<url>            no tab strip, no omnibox, its own taskbar button.
 *   --window-size=W,H      only honoured on a profile's first run; after that
 *                          Chrome restores what the user left, which is the
 *                          point of giving it a profile.
 *   --user-data-dir=<dir>  see `appProfileDir`.
 *   --no-first-run         a fresh profile otherwise opens a welcome tab in
 *                          front of the floor.
 *   --no-default-browser-check  and otherwise a modal asking to be the default.
 *
 * macOS is `open -na <bundle> --args …` — **written from Apple's documentation
 * and not run on a Mac.** Per `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 11 that
 * makes it a hypothesis; it is asserted as an argv array and nothing more, the
 * same standing gap `docs/DEVIATIONS.md` §91 and §101 record for the terminals
 * and the notifier.
 *
 * @param {{platform?:NodeJS.Platform|string, browser:string, url:string,
 *          profileDir:string, width?:number, height?:number}} opts
 * @returns {{command:string, args:string[]}|null}
 */
export function appWindowCommand(opts) {
  const platform = opts.platform || process.platform;
  const browser = String(opts.browser || '');
  const url = String(opts.url || '');
  if (!browser || !url) return null;

  const width = Math.trunc(opts.width ?? DEFAULT_WIDTH);
  const height = Math.trunc(opts.height ?? DEFAULT_HEIGHT);
  const flags = [
    `--app=${url}`,
    `--window-size=${width},${height}`,
    `--user-data-dir=${opts.profileDir}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];

  if (platform === 'darwin') {
    const bundle = macAppBundle(browser);
    if (bundle) return { command: 'open', args: ['-na', bundle, '--args', ...flags] };
    // Not in a bundle — a Homebrew symlink, or a Chromium built from source.
    // Spawning it directly is what every other platform does anyway.
    return { command: browser, args: flags };
  }

  // win32 and linux both take the executable and the flags directly. `.exe`
  // and an ELF binary are both programs, so no shell is involved on either —
  // which is the difference between this and `src/core/editor.mjs`, where the
  // target is a `.cmd` (docs/DEVIATIONS.md §90).
  if (platform === 'win32' || platform === 'linux') {
    return { command: browser, args: flags };
  }
  return null;
}

/**
 * Open a URL in the platform's default browser. The fallback for a machine
 * with no Chromium-family browser on it, and the same three commands
 * `bin/deckhq.mjs` already uses.
 *
 * @param {{platform?:NodeJS.Platform|string, url:string}} opts
 * @returns {{command:string, args:string[]}|null}
 */
export function defaultBrowserCommand(opts) {
  const platform = opts.platform || process.platform;
  const url = String(opts.url || '');
  if (!url) return null;
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

/** Loopback, or nothing. `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 2. */
export function isLoopbackUrl(url) {
  try {
    const u = new URL(String(url));
    return u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '[::1]';
  } catch {
    return false;
  }
}
