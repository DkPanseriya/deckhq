/**
 * `deckhq statusline` — WP-38, the one line DeckHQ writes inside the runtime.
 *
 *     ▣ 3 waiting · 1 hand up
 *
 * Claude Code renders a user-configurable status line in every session and
 * runs the configured command to fill it. That makes this the cheapest
 * presence surface in the whole plan (`docs/plan/08-PLAN-V2-100X.md` B2): every
 * terminal the user already has open becomes a live badge for the queue, with
 * no interface of ours on screen and nothing for them to keep looking at.
 *
 * Three properties this command has to hold, because it runs inside somebody
 * else's editing loop:
 *
 *   1. **Fast without a daemon.** A daemon is asked first — it is the only
 *      complete answer — but only for 150 ms, and the fallback reads
 *      `state.json` and the scan cache directly. The measured budget for that
 *      path is 20 ms; the test asserts it.
 *   2. **Silent on failure.** Claude Code prints whatever the command prints.
 *      A stack trace has no business in somebody's status bar, so every
 *      failure path prints nothing and exits 0.
 *   3. **It reads.** No `act()`, no ack write, no MK number assigned. The
 *      status line cannot discharge a debt by displaying it.
 *
 * stdin is deliberately never read. Claude Code pipes a JSON blob describing
 * the *current session* (model, cwd, cost, context window); this line is about
 * every session on the machine, so none of it is relevant, and not reading it
 * is one less thing to go wrong on a 20 ms path.
 *
 * `--install` and `--remove` write and unwrite the `statusLine` block in the
 * user's Claude Code settings, under exactly the consent discipline hooks
 * already use (docs/02-ARCHITECTURE.md §6): print the literal JSON and the
 * file it goes in, refuse to write without `--yes`, back the file up first,
 * and tag the entry so removal takes ours and only ours.
 *
 * No egress. The only socket opened is to 127.0.0.1.
 */
import fsp from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { BACKUP_DIR } from '../core/paths.mjs';
import { DAEMON_TIMEOUT_MS, readDeck, readOffline } from './source.mjs';

/** The glyph. The same mark the floor uses for the needs-you numeral. */
export const MARK = '▣';

/**
 * How often Claude Code re-runs the command on its own timer, in seconds.
 *
 * Status lines are event-driven: they refresh when a message arrives in THAT
 * session. The queue this line reports changes in OTHER sessions, so without a
 * timer an idle terminal would show a number frozen at whenever it last spoke.
 * Five seconds is the daemon's own default poll (`DEFAULT_SETTINGS
 * .pollIntervalMs`), which is what makes WP-38's acceptance criterion — the
 * count matches the header within one poll — true rather than hoped for.
 */
export const DEFAULT_REFRESH_SECONDS = 5;

/** What we write into `statusLine.command` unless the user names another. */
export const DEFAULT_COMMAND = 'deckhq statusline';

/**
 * Recognises a `statusLine` block as ours when the `_deckhq` tag is missing —
 * a settings file hand-edited, re-serialised by another tool, or written by a
 * build older than the tag. Matches `deckhq statusline`, `npx deckhq
 * statusline` and `node "…/bin/deckhq.mjs" statusline`.
 */
const OURS_RE = /deckhq(?:\.mjs|\.cmd|\.exe)?["']?\s+statusline\b/i;

/** @param {unknown} v */
function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

// ---------------------------------------------------------------------------
// The line itself
// ---------------------------------------------------------------------------

/**
 * The counts this line is made of.
 *
 * `waiting` is the header's numeral — `counts.needsYou`, everything on the
 * user's plate — and `handsUp` is the subset that is blocked on an answer
 * rather than finished. They overlap on purpose: "3 waiting · 1 hand up" says
 * three things need you and one of them is stuck, which is the shape of the
 * decision, and it is the same arithmetic the header does so the two can never
 * disagree.
 *
 * @param {{counts?:any, source?:string, port?:number|null}} deck
 */
export function statusFrom(deck) {
  const c = deck && deck.counts ? deck.counts : {};
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);
  return {
    waiting: n(c.needsYou),
    handsUp: n(c.handsUp),
    forReview: n(c.forReview),
    stalled: n(c.stalled),
    source: deck?.source === 'daemon' ? 'daemon' : 'state',
    port: deck?.port ?? null,
  };
}

/**
 * Render the line. Zero parts are omitted; nothing waiting reads `▣ clear`,
 * which is a state worth showing rather than a blank the user has to
 * interpret as either "nothing" or "broken".
 *
 * Never says "you". `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 6: the queue is
 * the team's, the fault is nobody's.
 *
 * @param {ReturnType<typeof statusFrom>} status
 * @returns {string}
 */
export function renderStatusline(status) {
  const parts = [];
  if (status.waiting > 0) parts.push(`${status.waiting} waiting`);
  if (status.handsUp > 0) parts.push(`${status.handsUp} hand${status.handsUp === 1 ? '' : 's'} up`);
  return parts.length ? `${MARK} ${parts.join(' · ')}` : `${MARK} clear`;
}

/**
 * The whole no-daemon path, as one call: read the files, count, render.
 * Exported because it is what the latency test measures.
 * @param {{stateFile?:string, cacheDir?:string}} [opts]
 */
export function statuslineOffline(opts = {}) {
  return statusFrom(readOffline(opts));
}

// ---------------------------------------------------------------------------
// Install / remove
// ---------------------------------------------------------------------------

/** Absolute path to Claude Code's settings file, honouring CLAUDE_CONFIG_DIR. */
async function settingsFile() {
  // Loaded lazily and through the adapter's own public re-export: the reading
  // path above must never pay for the adapter registry, and nothing outside
  // src/adapters/ may decide where a runtime keeps its files.
  const { CLAUDE_DIR } = await import('../adapters/claude-code/adapter.mjs');
  return path.join(CLAUDE_DIR, 'settings.json');
}

/**
 * The block that would be written, and where. The consent screen's whole
 * content — docs/02-ARCHITECTURE.md §6: "the literal JSON that will be written
 * and the file it will be written to".
 *
 * @param {{command?:string, refreshInterval?:number, file?:string}} [opts]
 */
export function describeInstall(opts = {}) {
  const command = opts.command || DEFAULT_COMMAND;
  const refreshInterval = opts.refreshInterval ?? DEFAULT_REFRESH_SECONDS;
  const block = {
    statusLine: {
      type: 'command',
      command,
      ...(refreshInterval > 0 ? { refreshInterval } : {}),
      _deckhq: true,
    },
  };
  return {
    file: opts.file || '',
    json: JSON.stringify(block, null, 2),
    block,
    note:
      'DeckHQ adds one status line to your Claude Code settings. Claude Code runs that command ' +
      'and prints what it says at the bottom of every session. The command reads DeckHQ on your ' +
      'own machine — the state file, or a daemon on 127.0.0.1 — and nothing else. Nothing leaves ' +
      'this computer. `deckhq statusline --remove` takes it out again, and removal deletes only ' +
      'the entry tagged as ours.',
  };
}

/**
 * @param {any} value a `statusLine` value from a settings file
 * @returns {boolean}
 */
export function isOurStatusLine(value) {
  if (!isPlainObject(value)) return false;
  if (value._deckhq === true) return true;
  return OURS_RE.test(String(value.command || ''));
}

/**
 * Read + parse the settings file. Same contract as the hooks module: a
 * malformed file aborts with a clear error and changes nothing.
 * @param {string} file
 * @returns {Promise<{existed:boolean, raw:string|null, parsed:any}>}
 */
async function readSettings(file) {
  let raw = null;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (err) {
    if (err && err.code === 'ENOENT') return { existed: false, raw: null, parsed: {} };
    throw err;
  }
  let parsed;
  try {
    parsed = raw.trim() === '' ? {} : JSON.parse(raw);
  } catch {
    throw new Error(
      `${file} is not valid JSON. Fix or remove it by hand, then try again. Nothing was changed.`,
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `${file} does not contain a JSON object at its top level. Nothing was changed.`,
    );
  }
  return { existed: true, raw, parsed };
}

/** Atomic write: temp file in the same directory, then rename. */
async function writeFileAtomic(file, content) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.deckhq-${process.pid}-${Date.now()}.tmp`;
  await fsp.writeFile(tmp, content, 'utf8');
  await fsp.rename(tmp, file);
}

/**
 * Keep the exact bytes of the settings file before touching it, in the
 * directory the hooks installer already backs up to and in the same
 * `{existed, raw}` shape — so one place holds every pre-install copy of that
 * file and `remove()` can restore an absence as faithfully as a presence.
 *
 * The filename prefix differs from the hooks backup on purpose: hook removal
 * restores the newest `settings-backup-*.json` verbatim, and a status-line
 * backup taken after the hooks were installed would silently become the file
 * it restores to. See `docs/DEVIATIONS.md` §88.
 *
 * @param {{dir?:string, existed:boolean, raw:string|null, now?:number}} opts
 * @returns {Promise<string>} the backup's path
 */
export async function backupSettings(opts) {
  const dir = opts.dir || BACKUP_DIR;
  await fsp.mkdir(dir, { recursive: true });
  const file = path.join(dir, `statusline-backup-${opts.now ?? Date.now()}.json`);
  await fsp.writeFile(file, JSON.stringify({ existed: opts.existed, raw: opts.raw }, null, 2));
  return file;
}

/** The newest `statusline-backup-*.json`, parsed, or null. */
async function latestBackup(dir = BACKUP_DIR) {
  let names;
  try {
    names = await fsp.readdir(dir);
  } catch {
    return null;
  }
  const backups = names.filter((n) => /^statusline-backup-\d+\.json$/.test(n)).sort();
  if (backups.length === 0) return null;
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, backups[backups.length - 1]), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Write the status line into the settings file.
 *
 * @param {{file:string, command?:string, refreshInterval?:number, backupDir?:string}} opts
 * @returns {Promise<{file:string, backup:string, replaced:any}>}
 */
export async function install(opts) {
  const { existed, raw, parsed } = await readSettings(opts.file);
  const plan = describeInstall({ ...opts, file: opts.file });
  const backup = await backupSettings({ dir: opts.backupDir, existed, raw });
  const next = { ...parsed, statusLine: plan.block.statusLine };
  await writeFileAtomic(opts.file, JSON.stringify(next, null, 2));
  return { file: opts.file, backup, replaced: parsed.statusLine ?? null };
}

/**
 * Take ours back out, and only ours.
 *
 * A `statusLine` that is not ours is left exactly where it is: this command
 * put it nowhere and has no business deleting somebody else's configuration.
 *
 * @param {{file:string, backupDir?:string}} opts
 * @returns {Promise<{removed:boolean, foreign:any}>}
 */
export async function remove(opts) {
  const { existed, parsed } = await readSettings(opts.file);
  if (!('statusLine' in parsed)) return { removed: false, foreign: null };
  if (!isOurStatusLine(parsed.statusLine)) return { removed: false, foreign: parsed.statusLine };

  const next = { ...parsed };
  delete next.statusLine;

  const backup = await latestBackup(opts.backupDir);
  if (backup && backup.existed === false && Object.keys(next).length === 0) {
    // The settings file did not exist before the install, and nothing else has
    // added content since: restore that exact absence.
    try {
      await fsp.unlink(opts.file);
    } catch (err) {
      if (!err || err.code !== 'ENOENT') throw err;
    }
    return { removed: true, foreign: null };
  }
  if (!existed && Object.keys(next).length === 0) {
    return { removed: true, foreign: null };
  }
  await writeFileAtomic(opts.file, JSON.stringify(next, null, 2));
  return { removed: true, foreign: null };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const HELP = [
  'deckhq statusline — one line for the queue, for a status bar.',
  '',
  'Usage: deckhq statusline [--json] [--port <n>]',
  '       deckhq statusline --install [--yes] [--command <s>] [--interval <n>]',
  '       deckhq statusline --remove [--yes]',
  '',
  '  --json          the same counts as a JSON object',
  '  --port <n>      also look for a running DeckHQ on this port',
  '  --install       add the line to your Claude Code status line configuration',
  '  --remove        take it out again; only the entry DeckHQ wrote',
  '  --yes           actually write. Without it, the JSON and the file are printed',
  '                  and nothing is changed',
  '  --command <s>   what to write as the command. Default "deckhq statusline"',
  '  --interval <n>  seconds between refreshes. 0 leaves it event-driven',
  '  --help          this message',
  '',
  'Reads a running DeckHQ if one answers on 127.0.0.1 within 150 ms, and',
  '~/.deckhq/state.json if none does. Makes no outbound network calls.',
  '',
].join('\n');

/**
 * @param {string[]} argv
 * @param {string} name
 * @returns {string|null}
 */
function option(argv, name) {
  const i = argv.indexOf(name);
  if (i === -1 || i === argv.length - 1) return null;
  return argv[i + 1];
}

/**
 * Run the command. Returns the exit code rather than calling `process.exit`,
 * for the reason `doctor` does: exiting hard while a loopback socket is still
 * closing aborts the process inside libuv (`docs/DEVIATIONS.md` §76).
 *
 * @param {string[]} [argv] argv after the `statusline` subcommand
 * @param {{write?:(s:string)=>void, error?:(s:string)=>void, read?:typeof readDeck,
 *          settingsFile?:string, backupDir?:string}} [deps]
 * @returns {Promise<number>}
 */
export async function runStatusline(argv = [], deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  const error = deps.error || ((s) => process.stderr.write(s));

  if (argv.includes('--help') || argv.includes('-h')) {
    write(HELP);
    return 0;
  }

  if (argv.includes('--install') || argv.includes('--remove')) {
    return runConfigure(argv, { ...deps, write, error });
  }

  const portArg = option(argv, '--port');
  const json = argv.includes('--json');

  let status;
  try {
    const read = deps.read || readDeck;
    status = statusFrom(
      await read({
        port: portArg != null ? Number(portArg) || null : null,
        timeoutMs: DAEMON_TIMEOUT_MS,
      }),
    );
  } catch {
    // Property 2 in the header: a status line that prints a stack trace is
    // worse than one that prints nothing.
    return 0;
  }

  try {
    if (json) write(JSON.stringify({ ...status, text: renderStatusline(status) }) + '\n');
    else write(renderStatusline(status) + '\n');
  } catch {
    /* a closed stdout — Claude Code cancels an in-flight script on a new update */
  }
  return 0;
}

/**
 * `--install` / `--remove`, with the consent screen in front of both.
 * @param {string[]} argv
 * @param {{write:(s:string)=>void, error:(s:string)=>void, settingsFile?:string,
 *          backupDir?:string}} deps
 */
async function runConfigure(argv, deps) {
  const { write, error } = deps;
  const file = deps.settingsFile || (await settingsFile());
  const yes = argv.includes('--yes');
  const removing = argv.includes('--remove');

  const commandArg = option(argv, '--command');
  const intervalArg = option(argv, '--interval');
  const refreshInterval =
    intervalArg != null && Number.isFinite(Number(intervalArg))
      ? Math.max(0, Math.trunc(Number(intervalArg)))
      : DEFAULT_REFRESH_SECONDS;

  let current = null;
  try {
    const { parsed } = await readSettings(file);
    current = 'statusLine' in parsed ? parsed.statusLine : null;
  } catch (err) {
    error(`\n  ${err.message}\n\n`);
    return 1;
  }

  if (removing) {
    if (current == null) {
      write(`\n  Nothing to remove: ${file} has no status line.\n\n`);
      return 0;
    }
    if (!isOurStatusLine(current)) {
      error(
        `\n  The status line in ${file} was not written by DeckHQ, so it was left alone:\n\n` +
          indent(JSON.stringify(current, null, 2)) +
          '\n\n  Remove it yourself if you meant to.\n\n',
      );
      return 1;
    }
    if (!yes) {
      write(
        `\n  This would delete the "statusLine" block from:\n\n    ${file}\n\n` +
          indent(JSON.stringify({ statusLine: current }, null, 2)) +
          '\n\n  Nothing was changed. Run it again with --yes to remove it.\n\n',
      );
      return 0;
    }
    try {
      await remove({ file, backupDir: deps.backupDir });
    } catch (err) {
      error(`\n  ${err.message}\n\n`);
      return 1;
    }
    write(`\n  Removed. ${file}\n\n`);
    return 0;
  }

  const plan = describeInstall({ command: commandArg || undefined, refreshInterval, file });
  if (!yes) {
    const lines = [
      '',
      '  This would be written to:',
      '',
      `    ${file}`,
      '',
      indent(plan.json),
      '',
      indent(wrap(plan.note, 78)),
      '',
    ];
    if (current != null && !isOurStatusLine(current)) {
      lines.push(
        indent(
          wrap(
            'You already have a status line configured. Installing this REPLACES it. The exact ' +
              'bytes of your settings file are copied to ~/.deckhq/backups first, and what is ' +
              'there now is:',
            78,
          ),
        ),
        '',
        indent(JSON.stringify(current, null, 2)),
        '',
      );
    }
    if ((commandArg || DEFAULT_COMMAND) === DEFAULT_COMMAND) {
      lines.push(
        indent(
          wrap(
            'This assumes `deckhq` is on your PATH — a global install, Homebrew, winget or ' +
              'scoop. `npx` does not leave one behind. Pass --command to write something else.',
            78,
          ),
        ),
        '',
      );
    }
    lines.push('  Nothing was changed. Run it again with --yes to write it.', '', '');
    write(lines.join('\n'));
    return 0;
  }

  try {
    const result = await install({
      file,
      command: commandArg || undefined,
      refreshInterval,
      backupDir: deps.backupDir,
    });
    write(
      `\n  Installed. ${file}\n` +
        `  Your settings file was copied to ${result.backup} first.\n` +
        '  Open a new Claude Code session to see it.\n\n',
    );
    return 0;
  } catch (err) {
    error(`\n  ${err.message}\n\n`);
    return 1;
  }
}

/** @param {string} text */
function indent(text) {
  return String(text)
    .split('\n')
    .map((line) => (line ? `    ${line}` : line))
    .join('\n');
}

/** @param {string} text @param {number} width */
function wrap(text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export default runStatusline;
