/**
 * What `deckhq shortcut` and `deckhq autostart` would write, as data — WP-62.
 *
 * Every function here is pure. The platform, the environment, the folders and
 * the "does this file exist" predicate are all injected, so the exact set of
 * paths and the exact argv for each of the three platforms is asserted in
 * `test/unit/launcher.test.mjs` rather than reasoned about — the same
 * discipline the terminals (`docs/DEVIATIONS.md` §91) and the notifier (§101)
 * are held to. **Nothing in this file writes anything**; `launcher-apply.mjs`
 * is the half that touches the disk, and it takes a plan built here.
 *
 * THE CONSENT DISCIPLINE (docs/02-ARCHITECTURE.md §6), which this module
 * exists to make possible:
 *
 *   1. Print every path that will be written, before writing any of them.
 *   2. Write nothing without `--yes`.
 *   3. Tag what we write, so removal can tell ours from somebody else's.
 *   4. `--remove` deletes only files this package created, and it knows which
 *      because it recorded them (`installed.json`, below) *and* because each
 *      one carries the tag.
 *   5. Back up nothing we did not create. These are new files in shared
 *      folders, not edits to a user's config: there is no prior content to
 *      keep, and an existing `DeckHQ.lnk` that is not ours is refused rather
 *      than overwritten.
 *
 * WHAT IS RUN ON A MACHINE AND WHAT IS NOT. The Windows half of this file was
 * run for real on Windows 11 (`docs/DEVIATIONS.md` §144). The macOS bundle and
 * the Linux `.desktop` entry are written from Apple's and freedesktop.org's
 * documentation and **have never been executed**; per
 * `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 11 they are hypotheses, they are
 * labelled as such in the plan this module returns, and `deckhq shortcut`
 * prints that label above the file list.
 */
import path from 'node:path';
import process from 'node:process';

/**
 * The marker every file this package writes carries, and the only thing
 * `--remove` will delete a file for.
 *
 * It is a string rather than a flag in a sidecar because the sidecar can be
 * lost: a user who deletes `~/.deckhq` and then runs `--remove` must not be
 * told there is nothing to remove while a shortcut of ours is still on their
 * desktop, and must not have somebody else's `DeckHQ.lnk` deleted either.
 */
export const TAG = 'deckhq:installed-by-deckhq-shortcut';

/** Where the record of what we wrote lives, under the state directory. */
export const RECORD_NAME = 'installed.json';

/** What each surface is called, in the record and in the printed plan. */
export const SURFACES = /** @type {const} */ ({
  shortcut: 'shortcut',
  autostart: 'autostart',
});

/** The `.lnk` description Explorer shows, carrying the tag. */
export function description(what) {
  return `${what} — ${TAG}`;
}

/**
 * Values that must never reach a PowerShell command line, however it is
 * quoted.
 *
 * Narrower than `src/core/cmdline.mjs`'s rule on purpose. That module refuses
 * `%` because `cmd.exe` expands it *inside double quotes*; PowerShell run with
 * `-File` does not, and a directory called `100% done` is a directory somebody
 * has. What is refused here is the double quote — which cannot appear in a
 * Windows path at all, so this costs nobody anything — and control characters,
 * which would end the command line.
 *
 * @param {unknown} value
 * @returns {boolean} true when it must be refused
 */
export function unsafeForPowerShell(value) {
  for (const ch of String(value)) {
    if (ch === '"' || ch === '`' || ch.codePointAt(0) < 0x20) return true;
  }
  return false;
}

/**
 * The first executable of any of these names on the PATH, or null.
 *
 * @param {string[]} names
 * @param {{platform?:string, env?:Record<string,any>,
 *          exists?:(p:string)=>boolean}} deps
 * @returns {string|null}
 */
export function whichOnPath(names, deps = {}) {
  const platform = deps.platform || process.platform;
  const env = deps.env || process.env;
  const exists = deps.exists || (() => false);
  const dirs = String(env.PATH || env.Path || '')
    .split(path.delimiter)
    .map((d) => d.trim())
    .filter(Boolean);
  const exts = platform === 'win32' ? ['.cmd', '.exe', '.bat', ''] : [''];
  for (const dir of dirs) {
    for (const name of names) {
      for (const ext of exts) {
        const file = path.join(dir, name + ext);
        if (exists(file)) return file;
      }
    }
  }
  return null;
}

/**
 * How this machine should invoke DeckHQ, resolved once at install time and
 * written into the shortcut as an absolute path.
 *
 * Resolved rather than left as the bare word `deckhq`, and that is the whole
 * point: a `.lnk` has no shell and therefore no PATH lookup, and a
 * `.desktop` entry's `Exec` is searched against a PATH that is not the login
 * shell's. A shortcut that says `deckhq` works on the developer's machine and
 * silently does nothing on everybody else's.
 *
 * Two shapes, and the plan records which was chosen so `deckhq doctor` and a
 * bug report can tell them apart:
 *
 *   `global`  a `deckhq` / `deckhq.cmd` already on the PATH — npm -g, Homebrew,
 *             winget, scoop. Preferred: it survives this package directory
 *             being replaced on upgrade, which `npx` is free to do.
 *   `node`    this Node, and this checkout's `bin/deckhq.mjs`. The fallback,
 *             and what an `npx`-only machine gets.
 *
 * @param {{platform?:string, env?:Record<string,any>, binPath:string,
 *          node?:string, exists?:(p:string)=>boolean, command?:string[]}} opts
 * @returns {{kind:'global'|'node', target:string, argv:string[], display:string}}
 */
export function resolveLauncher(opts) {
  const node = opts.node || process.execPath;
  const command = opts.command || ['app'];
  // `whichOnPath` reads `opts.platform` itself, and that is where the platform
  // matters: on Windows the global install is `deckhq.cmd`, everywhere else it
  // is an extensionless `deckhq`.
  const global = whichOnPath(['deckhq'], opts);
  if (global) {
    return {
      kind: 'global',
      target: global,
      argv: [...command],
      display: [global, ...command].join(' '),
    };
  }
  return {
    kind: 'node',
    target: node,
    argv: [opts.binPath, ...command],
    display: [node, opts.binPath, ...command].join(' '),
  };
}

/**
 * One Windows command line from an argv array.
 *
 * `WScript.Shell`'s `Arguments` is a string, not an array — the `.lnk` format
 * stores one — so this is the one place a command line is built for a
 * shortcut. Every element is double-quoted; a value carrying a `"` is refused
 * rather than escaped, for the reason `src/core/cmdline.mjs` gives at length:
 * there is nothing to escape with, and a Windows path cannot contain one.
 *
 * @param {string[]} argv
 * @returns {string}
 */
export function lnkArguments(argv) {
  return (argv || [])
    .map((a) => {
      if (unsafeForPowerShell(a)) {
        throw new Error(
          `DeckHQ will not put this value in a shortcut: ${JSON.stringify(String(a))}`,
        );
      }
      return `"${a}"`;
    })
    .join(' ');
}

/**
 * The Windows folders a shortcut goes in.
 *
 * Every one is overridable by an environment variable, and that is not only a
 * test seam: a machine with OneDrive folder backup on keeps its Desktop
 * somewhere `%USERPROFILE%\Desktop` does not name, and these are the escape
 * hatch when the real answer — asked of Windows itself by
 * `src/core/shortcut.ps1 -Action folders` — is not what the user wants either.
 *
 * @param {{env?:Record<string,any>, probed?:{desktop?:string, programs?:string,
 *          startup?:string}|null}} [opts]
 * @returns {{desktop:string, programs:string, startup:string}}
 */
export function windowsFolders(opts = {}) {
  const env = opts.env || process.env;
  const probed = opts.probed || {};
  const home = String(env.USERPROFILE || env.HOME || '');
  const appData = String(env.APPDATA || path.join(home, 'AppData', 'Roaming'));
  const menu = path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs');
  return {
    desktop: String(env.DECKHQ_DESKTOP_DIR || probed.desktop || path.join(home, 'Desktop')),
    programs: String(env.DECKHQ_START_MENU_DIR || probed.programs || menu),
    startup: String(env.DECKHQ_STARTUP_DIR || probed.startup || path.join(menu, 'Startup')),
  };
}

/**
 * The `~`-rooted directories the other two platforms use.
 * @param {{env?:Record<string,any>, home?:string}} [opts]
 */
export function posixFolders(opts = {}) {
  const env = opts.env || process.env;
  const home = opts.home || String(env.HOME || '');
  return {
    macApplications: String(env.DECKHQ_APPLICATIONS_DIR || path.join(home, 'Applications')),
    macLaunchAgents: String(
      env.DECKHQ_LAUNCH_AGENTS_DIR || path.join(home, 'Library', 'LaunchAgents'),
    ),
    linuxApplications: String(
      env.DECKHQ_APPLICATIONS_DIR || path.join(home, '.local', 'share', 'applications'),
    ),
    linuxIcons: String(
      env.DECKHQ_ICONS_DIR ||
        path.join(home, '.local', 'share', 'icons', 'hicolor', '512x512', 'apps'),
    ),
    linuxAutostart: String(env.DECKHQ_AUTOSTART_DIR || path.join(home, '.config', 'autostart')),
  };
}

// ---------------------------------------------------------------------------
// The plans
// ---------------------------------------------------------------------------

/**
 * @typedef {{
 *   path: string,
 *   why: string,
 *   kind: 'lnk'|'text'|'binary',
 *   lnk?: {target:string, args:string, workingDirectory:string,
 *          iconLocation:string, description:string, windowStyle:number},
 *   contents?: string,
 *   source?: 'ico',
 *   mode?: number
 * }} PlannedFile
 */

/**
 * @typedef {{
 *   surface: 'shortcut'|'autostart',
 *   platform: string,
 *   supported: boolean,
 *   verified: boolean,
 *   launcher: ReturnType<typeof resolveLauncher>,
 *   files: PlannedFile[],
 *   notes: string[]
 * }} Plan
 */

/** The `Info.plist` of a `.app` whose whole executable is a two-line script. */
export function infoPlist({ name = 'DeckHQ', identifier = 'dev.deckhq.app', icon = '' } = {}) {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
      '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    '  <key>CFBundleName</key>',
    `  <string>${name}</string>`,
    '  <key>CFBundleDisplayName</key>',
    `  <string>${name}</string>`,
    '  <key>CFBundleIdentifier</key>',
    `  <string>${identifier}</string>`,
    '  <key>CFBundleExecutable</key>',
    `  <string>${name}</string>`,
    '  <key>CFBundlePackageType</key>',
    '  <string>APPL</string>',
    '  <key>CFBundleInfoDictionaryVersion</key>',
    '  <string>6.0</string>',
    ...(icon ? ['  <key>CFBundleIconFile</key>', `  <string>${icon}</string>`] : []),
    '  <key>LSUIElement</key>',
    '  <false/>',
    `  <key>DeckHQTag</key>`,
    `  <string>${TAG}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/** The shell script inside that bundle. One `exec`, and the tag in a comment. */
export function macExecutable(launcher) {
  const quoted = [launcher.target, ...launcher.argv].map(
    (a) => `'${String(a).replace(/'/g, "'\\''")}'`,
  );
  return ['#!/bin/sh', `# ${TAG}`, `exec ${quoted.join(' ')}`, ''].join('\n');
}

/** A freedesktop.org desktop entry. */
export function desktopEntry({ name, comment, exec, icon, terminal = false, extra = [] }) {
  return [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${name}`,
    `Comment=${comment}`,
    `Exec=${exec}`,
    ...(icon ? [`Icon=${icon}`] : []),
    `Terminal=${terminal ? 'true' : 'false'}`,
    'Categories=Development;Utility;',
    ...extra,
    // Not a standard key, and deliberately so: an `X-` key is the documented
    // place for a vendor's own data, and this is what `--remove` reads.
    `X-DeckHQ-Tag=${TAG}`,
    '',
  ].join('\n');
}

/** A shell command line for `Exec=` / `ProgramArguments`. */
function shQuote(argv) {
  return argv.map((a) => `'${String(a).replace(/'/g, "'\\''")}'`).join(' ');
}

/**
 * `deckhq shortcut --install`, as a list of files.
 *
 * @param {{platform?:string, env?:Record<string,any>, launcher:any,
 *          folders?:any, icoPath?:string, iconPngPath?:string,
 *          home?:string}} opts
 * @returns {Plan}
 */
export function planShortcut(opts) {
  const platform = opts.platform || process.platform;
  const launcher = opts.launcher;
  /** @type {PlannedFile[]} */
  const files = [];
  /** @type {string[]} */
  const notes = [];

  if (platform === 'win32') {
    const folders = opts.folders || windowsFolders({ env: opts.env });
    const args = lnkArguments(launcher.argv);
    if (opts.icoPath) {
      files.push({
        path: opts.icoPath,
        why: 'the icon, wrapped from the PNG DeckHQ already ships',
        kind: 'binary',
        source: 'ico',
      });
    }
    const lnk = {
      target: launcher.target,
      args,
      workingDirectory: path.dirname(launcher.target),
      iconLocation: opts.icoPath ? `${opts.icoPath},0` : '',
      description: description('DeckHQ'),
      // 1 = normal, and it has to be. A `.lnk`'s window style becomes
      // `wShowWindow` in the launched process's STARTUPINFO, and **that is
      // inherited down the whole process tree**: with 7 (minimised), the
      // console `deckhq app` runs in was minimised — and so was the Chrome
      // window it went on to open. Measured on the reference machine, and
      // confirmed with `IsIconic` on the resulting HWND. The cost is that the
      // console is visible for the second or so the command lives.
      // `docs/DEVIATIONS.md` §144.
      windowStyle: 1,
    };
    files.push(
      {
        path: path.join(folders.desktop, 'DeckHQ.lnk'),
        why: 'the Desktop icon',
        kind: 'lnk',
        lnk,
      },
      {
        path: path.join(folders.programs, 'DeckHQ.lnk'),
        why: 'the Start Menu entry — this is what the Start search finds',
        kind: 'lnk',
        lnk,
      },
    );
    notes.push(
      'That command reuses a DeckHQ that is already running, and starts one if none is.',
      'A console window is visible for the second or so it takes. It cannot be hidden: a ' +
        "shortcut's window style is inherited by everything the command starts, so hiding " +
        'the console hides the app window with it.',
    );
    return {
      surface: 'shortcut',
      platform,
      supported: true,
      verified: true,
      launcher,
      files,
      notes,
    };
  }

  const folders = opts.folders || posixFolders({ env: opts.env, home: opts.home });

  if (platform === 'darwin') {
    const app = path.join(folders.macApplications, 'DeckHQ.app');
    const iconName = opts.iconPngPath ? 'DeckHQ.png' : '';
    files.push(
      {
        path: path.join(app, 'Contents', 'Info.plist'),
        why: 'the bundle Finder reads',
        kind: 'text',
        contents: infoPlist({ icon: iconName }),
      },
      {
        path: path.join(app, 'Contents', 'MacOS', 'DeckHQ'),
        why: 'the executable — one `exec` line',
        kind: 'text',
        contents: macExecutable(launcher),
        mode: 0o755,
      },
    );
    if (opts.iconPngPath) {
      files.push({
        path: path.join(app, 'Contents', 'Resources', 'DeckHQ.png'),
        why: 'the icon, as a PNG',
        kind: 'binary',
        contents: opts.iconPngPath,
      });
    }
    notes.push(
      'DOCS-ONLY: this bundle is written from Apple documentation and has never been run on a ' +
        'Mac. docs/plan/08-PLAN-V2-100X.md §1.1 rule 11 — treat it as a hypothesis.',
      'The icon is a PNG, not an `.icns`. Converting one needs `iconutil`, which is a shell-out ' +
        'to a tool this package will not depend on, so Finder may show the generic application ' +
        'icon until somebody runs `iconutil -c icns` themselves.',
    );
    return {
      surface: 'shortcut',
      platform,
      supported: true,
      verified: false,
      launcher,
      files,
      notes,
    };
  }

  if (platform === 'linux') {
    files.push({
      path: path.join(folders.linuxApplications, 'deckhq.desktop'),
      why: 'the application menu entry',
      kind: 'text',
      contents: desktopEntry({
        name: 'DeckHQ',
        comment: 'Every AI coding session on your machine, on one office floor.',
        exec: shQuote([launcher.target, ...launcher.argv]),
        icon: 'deckhq',
      }),
    });
    if (opts.iconPngPath) {
      files.push({
        path: path.join(folders.linuxIcons, 'deckhq.png'),
        why: 'the icon the entry names',
        kind: 'binary',
        contents: opts.iconPngPath,
      });
    }
    notes.push(
      'DOCS-ONLY: written from the freedesktop.org Desktop Entry Specification and never run ' +
        'on a Linux desktop. docs/plan/08-PLAN-V2-100X.md §1.1 rule 11.',
      'Some desktops cache the menu; `update-desktop-database ~/.local/share/applications` if ' +
        'the entry does not appear. DeckHQ does not run it for you.',
    );
    return {
      surface: 'shortcut',
      platform,
      supported: true,
      verified: false,
      launcher,
      files,
      notes,
    };
  }

  return {
    surface: 'shortcut',
    platform,
    supported: false,
    verified: false,
    launcher,
    files: [],
    notes: [`DeckHQ has no shortcut to offer on ${platform}.`],
  };
}

/**
 * `deckhq autostart --install`, as a list of files.
 *
 * The daemon only. No window: something that opened a browser window at every
 * login would be the opposite of `docs/plan/08-PLAN-V2-100X.md` §1.2 — the
 * product's job is to let you *stop* watching, and a floor that puts itself in
 * front of you every morning is a floor that demands to be watched. What
 * autostart buys is that the hooks have somewhere to post from the moment you
 * log in, so the queue is right when you do come and look.
 *
 * @param {{platform?:string, env?:Record<string,any>, launcher:any,
 *          folders?:any, icoPath?:string, home?:string, logPath?:string}} opts
 * @returns {Plan}
 */
export function planAutostart(opts) {
  const platform = opts.platform || process.platform;
  const launcher = opts.launcher;
  /** @type {PlannedFile[]} */
  const files = [];
  /** @type {string[]} */
  const notes = [
    'This starts the DAEMON, with no window. Nothing appears on your screen at login; the ' +
      'floor is there when you ask for it, and the hooks have somewhere to post before then.',
  ];

  if (platform === 'win32') {
    const folders = opts.folders || windowsFolders({ env: opts.env });
    files.push({
      path: path.join(folders.startup, 'DeckHQ (daemon).lnk'),
      why: 'the Startup folder entry Windows runs at login',
      kind: 'lnk',
      lnk: {
        target: launcher.target,
        args: lnkArguments(launcher.argv),
        workingDirectory: path.dirname(launcher.target),
        iconLocation: opts.icoPath ? `${opts.icoPath},0` : '',
        description: description('DeckHQ daemon'),
        // 7 = minimised, and here it is right. This entry runs
        // `deckhq app --no-window`, which finds or starts a **detached**
        // daemon and exits; the daemon it leaves behind is spawned with
        // `windowsHide`, which sets SW_HIDE explicitly and therefore beats the
        // inherited style. So the only thing minimised is a console that lives
        // for a second at login, and the daemon that outlives it has no window
        // at all. `docs/DEVIATIONS.md` §144.
        windowStyle: 7,
      },
    });
    notes.push('Remove it again with `deckhq autostart --remove`.');
    return {
      surface: 'autostart',
      platform,
      supported: true,
      verified: true,
      launcher,
      files,
      notes,
    };
  }

  const folders = opts.folders || posixFolders({ env: opts.env, home: opts.home });

  if (platform === 'darwin') {
    const args = [launcher.target, ...launcher.argv];
    files.push({
      path: path.join(folders.macLaunchAgents, 'dev.deckhq.daemon.plist'),
      why: 'the LaunchAgent launchd loads at login',
      kind: 'text',
      contents: [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
          '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
        '<plist version="1.0">',
        '<dict>',
        '  <key>Label</key>',
        '  <string>dev.deckhq.daemon</string>',
        '  <key>ProgramArguments</key>',
        '  <array>',
        ...args.map((a) => `    <string>${a}</string>`),
        '  </array>',
        '  <key>RunAtLoad</key>',
        '  <true/>',
        '  <key>KeepAlive</key>',
        '  <false/>',
        '  <key>DeckHQTag</key>',
        `  <string>${TAG}</string>`,
        '</dict>',
        '</plist>',
        '',
      ].join('\n'),
    });
    notes.push(
      'DOCS-ONLY: written from Apple documentation and never loaded by a real launchd. ' +
        'docs/plan/08-PLAN-V2-100X.md §1.1 rule 11.',
      'launchd reads the directory at login. `launchctl load ~/Library/LaunchAgents/' +
        'dev.deckhq.daemon.plist` starts it now; DeckHQ does not run that for you.',
    );
    return {
      surface: 'autostart',
      platform,
      supported: true,
      verified: false,
      launcher,
      files,
      notes,
    };
  }

  if (platform === 'linux') {
    files.push({
      path: path.join(folders.linuxAutostart, 'deckhq.desktop'),
      why: 'the XDG autostart entry your desktop session runs at login',
      kind: 'text',
      contents: desktopEntry({
        name: 'DeckHQ daemon',
        comment: 'Start the DeckHQ daemon at login. No window.',
        exec: shQuote([launcher.target, ...launcher.argv]),
        icon: '',
        extra: ['X-GNOME-Autostart-enabled=true'],
      }),
    });
    notes.push(
      'DOCS-ONLY: written from the freedesktop.org Autostart Specification and never run on a ' +
        'Linux desktop. docs/plan/08-PLAN-V2-100X.md §1.1 rule 11.',
    );
    return {
      surface: 'autostart',
      platform,
      supported: true,
      verified: false,
      launcher,
      files,
      notes,
    };
  }

  return {
    surface: 'autostart',
    platform,
    supported: false,
    verified: false,
    launcher,
    files: [],
    notes: [`DeckHQ has no autostart to offer on ${platform}.`],
  };
}

/**
 * The consent screen, as text. Every path that would be written, what each one
 * is for, what runs, and how to take it back out.
 *
 * @param {Plan} plan
 * @returns {string}
 */
export function describePlan(plan) {
  const lines = [];
  const what =
    plan.surface === 'autostart' ? 'start DeckHQ at login' : 'put DeckHQ on this machine';
  if (!plan.supported) return `  DeckHQ cannot ${what} on ${plan.platform}.\n`;

  lines.push(`  This would ${what} by writing ${plan.files.length} file(s):`, '');
  for (const file of plan.files) lines.push(`    ${file.path}`, `      ${file.why}`);
  lines.push('', '  Each of them runs:', '', `    ${plan.launcher.target}`);
  for (const arg of plan.launcher.argv) lines.push(`    ${arg}`);
  lines.push(
    '',
    ...wrap(
      `Every file carries the tag "${TAG}", and a record of exactly these paths is kept in ` +
        `<state dir>/${RECORD_NAME}. \`--remove\` deletes those paths and nothing else: a file ` +
        'of the same name that no longer proves it is ours is left where it is.',
    ),
    '',
  );
  for (const note of plan.notes) lines.push(...wrap(note), '');
  return lines.join('\n');
}

/** Two-space-indented lines of at most 78 characters. */
function wrap(text, width = 76) {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      out.push(`  ${line}`);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) out.push(`  ${line}`);
  return out;
}
