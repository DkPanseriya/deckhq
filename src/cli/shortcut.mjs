/**
 * `deckhq shortcut` and `deckhq autostart` — WP-62.
 *
 *     deckhq shortcut  --install [--yes]     a Desktop and Start Menu icon
 *     deckhq shortcut  --remove  [--yes]     and back out again
 *     deckhq autostart --install [--yes]     the daemon, at login, no window
 *     deckhq autostart --remove  [--yes]
 *
 * Both commands are one runner, because they differ only in which plan they
 * build: they write to the same kind of place, under the same consent
 * discipline, and a second copy of that discipline is a second place for it to
 * be got subtly wrong.
 *
 * THE CONSENT DISCIPLINE (docs/02-ARCHITECTURE.md §6, the same one
 * `deckhq statusline --install` holds):
 *
 *   - Print every path that will be written, and what each one is for, before
 *     writing any of them.
 *   - Write nothing without `--yes`.
 *   - Tag what we write.
 *   - `--remove` deletes only files we created — the record names them and the
 *     files still say so — and leaves anything else exactly where it is.
 *   - Back up nothing we did not create. These are new files in shared
 *     folders; a `DeckHQ.lnk` that is not ours is refused, not replaced.
 *
 * No egress, and no process is started but `powershell.exe -File` on Windows,
 * which is the only way to write a `.lnk` without a dependency.
 */
import process from 'node:process';

import { DATA_DIR } from '../core/paths.mjs';
import {
  RECORD_NAME,
  TAG,
  describePlan,
  planAutostart,
  planShortcut,
  posixFolders,
  resolveLauncher,
  windowsFolders,
} from '../core/launcher.mjs';
import {
  apply,
  icoPathFor,
  iconPngPath,
  probeWindowsFolders,
  recordedPaths,
  remove,
} from '../core/launcher-apply.mjs';
import { BIN } from './app.mjs';
import fs from 'node:fs';

const HELP = {
  shortcut: [
    'deckhq shortcut — DeckHQ on your Desktop and in your Start Menu.',
    '',
    'Usage: deckhq shortcut --install [--yes]',
    '       deckhq shortcut --remove [--yes]',
    '',
    '  --install   write the shortcuts. They run `deckhq app`, which reuses a',
    '              running DeckHQ or starts one, then opens the floor in a',
    '              window of its own.',
    '  --remove    delete them again — only the files DeckHQ wrote.',
    '  --yes       actually write. Without it, every path is printed and',
    '              nothing is changed.',
    '  --help      this message',
    '',
    'Windows is the platform this was run on. The macOS bundle and the Linux',
    'desktop entry are written from documentation and have never been executed;',
    'the plan says so above the file list.',
    '',
  ].join('\n'),
  autostart: [
    'deckhq autostart — start the DeckHQ daemon when you log in.',
    '',
    'Usage: deckhq autostart --install [--yes]',
    '       deckhq autostart --remove [--yes]',
    '',
    'The DAEMON, with no window. Nothing appears on your screen at login: the',
    'point is that your hooks have somewhere to post from the moment you are',
    'logged in, so the queue is right when you do come and look.',
    '',
    '  --install   write the login entry',
    '  --remove    delete it — only the file DeckHQ wrote',
    '  --yes       actually write. Without it, the path is printed and nothing',
    '              is changed.',
    '  --help      this message',
    '',
  ].join('\n'),
};

/**
 * Build the plan for one surface on this machine.
 *
 * @param {'shortcut'|'autostart'} surface
 * @param {{platform?:string, env?:Record<string,any>, dataDir?:string,
 *          binPath?:string, node?:string, probeFolders?:Function}} [deps]
 * @returns {Promise<import('../core/launcher.mjs').Plan>}
 */
export async function buildPlan(surface, deps = {}) {
  const platform = deps.platform || process.platform;
  const env = deps.env || process.env;
  const dataDir = deps.dataDir || DATA_DIR;
  const launcher = resolveLauncher({
    platform,
    env,
    binPath: deps.binPath || BIN,
    node: deps.node,
    exists: (p) => {
      try {
        return fs.statSync(p).isFile();
      } catch {
        return false;
      }
    },
    // The Startup entry runs the daemon, not the window. `08` §1.2: a product
    // whose job is to let you stop watching must not open a floor at you every
    // morning.
    //
    // `app --no-window` rather than a bare `--no-open`, because the two differ
    // in what is left running: `--no-open` IS the daemon, so the login entry's
    // console stays on the taskbar for the whole session; `app --no-window`
    // finds or starts a detached daemon with a hidden console and exits in
    // about a second, which is what somebody asking for autostart means.
    command: surface === 'autostart' ? ['app', '--no-window'] : ['app'],
  });

  let folders;
  if (platform === 'win32') {
    const probe = deps.probeFolders || probeWindowsFolders;
    folders = windowsFolders({ env, probed: await probe() });
  } else {
    folders = posixFolders({ env });
  }

  const opts = {
    platform,
    env,
    launcher,
    folders,
    icoPath: icoPathFor(dataDir),
    iconPngPath: iconPngPath(),
  };
  return surface === 'autostart' ? planAutostart(opts) : planShortcut(opts);
}

/**
 * @param {'shortcut'|'autostart'} surface
 * @param {string[]} argv
 * @param {{write?:(s:string)=>void, error?:(s:string)=>void, dataDir?:string,
 *          platform?:string, env?:Record<string,any>, binPath?:string,
 *          node?:string, probeFolders?:Function, applyFn?:typeof apply,
 *          removeFn?:typeof remove, exec?:Function, powershell?:string}} [deps]
 * @returns {Promise<number>}
 */
export async function runInstaller(surface, argv = [], deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  const error = deps.error || ((s) => process.stderr.write(s));
  const dataDir = deps.dataDir || DATA_DIR;

  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    write(HELP[surface]);
    return argv.length === 0 ? 1 : 0;
  }

  const removing = argv.includes('--remove');
  const installing = argv.includes('--install');
  if (removing === installing) {
    error(`\n  Say one of --install or --remove. \`deckhq ${surface} --help\`.\n\n`);
    return 2;
  }
  const yes = argv.includes('--yes');

  if (removing) {
    const paths = recordedPaths(surface, dataDir);
    if (paths.length === 0) {
      write(
        `\n  Nothing to remove: <state dir>/${RECORD_NAME} records no ${surface} written by ` +
          'DeckHQ on this machine.\n\n',
      );
      return 0;
    }
    if (!yes) {
      write(
        '\n  This would delete:\n\n' +
          paths.map((p) => `    ${p}`).join('\n') +
          `\n\n  Each is checked for the tag "${TAG}" first; one that has lost it, or that was\n` +
          '  replaced by somebody else, is left where it is.\n\n' +
          '  Nothing was changed. Run it again with --yes to remove them.\n\n',
      );
      return 0;
    }
    let result;
    try {
      result = await (deps.removeFn || remove)(surface, deps);
    } catch (err) {
      error(`\n  ${err?.message || err}\n\n`);
      return 1;
    }
    write(
      '\n' +
        (result.removed.length
          ? `  Removed ${result.removed.length}:\n` +
            result.removed.map((p) => `    ${p}`).join('\n') +
            '\n'
          : '  Removed nothing.\n') +
        (result.missing.length
          ? `\n  Already gone:\n` + result.missing.map((p) => `    ${p}`).join('\n') + '\n'
          : '') +
        (result.foreign.length
          ? '\n  Left alone — no longer carries the DeckHQ tag, so it is not ours to delete:\n' +
            result.foreign.map((p) => `    ${p}`).join('\n') +
            '\n'
          : '') +
        '\n',
    );
    return result.foreign.length ? 1 : 0;
  }

  let plan;
  try {
    plan = await buildPlan(surface, deps);
  } catch (err) {
    error(`\n  ${err?.message || err}\n\n`);
    return 1;
  }

  if (!plan.supported) {
    error(`\n  DeckHQ has no ${surface} to offer on ${plan.platform}.\n\n`);
    return 1;
  }

  if (!plan.verified) {
    write(
      '\n  NOT RUN ON THIS PLATFORM. Everything below is written from the platform vendor\n' +
        '  documentation and has never been executed on a machine. It may not work. That is\n' +
        '  said here rather than found out later.\n',
    );
  }

  write('\n' + describePlan(plan));

  if (!yes) {
    write('  Nothing was changed. Run it again with --yes to write it.\n\n');
    return 0;
  }

  let result;
  try {
    result = await (deps.applyFn || apply)(plan, { ...deps, dataDir });
  } catch (err) {
    error(`  ${err?.message || err}\n\n`);
    return 1;
  }

  write(
    `  Written:\n` +
      result.written.map((p) => `    ${p}`).join('\n') +
      '\n' +
      (result.skipped.length
        ? '\n  Could not be written, and the rest went in anyway:\n' +
          result.skipped.map((p) => `    ${p}`).join('\n') +
          '\n'
        : '') +
      (result.icon
        ? `\n  The icon holds ${result.icon.entries} image(s), ${result.icon.bytes} bytes.\n`
        : '') +
      `\n  Recorded in <state dir>/${RECORD_NAME}. \`deckhq ${surface} --remove\` takes them out.\n\n`,
  );
  return 0;
}

/** @param {string[]} [argv] @param {any} [deps] */
export function runShortcut(argv = [], deps = {}) {
  return runInstaller('shortcut', argv, deps);
}

/** @param {string[]} [argv] @param {any} [deps] */
export function runAutostart(argv = [], deps = {}) {
  return runInstaller('autostart', argv, deps);
}

export default runShortcut;
