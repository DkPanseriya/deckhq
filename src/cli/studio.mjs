/**
 * `deckhq studio` — WP-66's command-line half.
 *
 *     deckhq studio enable  <dir> [--yes]
 *     deckhq studio disable <dir> [--yes]
 *
 * The consent discipline is `deckhq shortcut`'s, word for word
 * (`src/cli/shortcut.mjs`, `docs/02-ARCHITECTURE.md` §6): print every path
 * that would be written and what each one is for, write nothing without
 * `--yes`, tag what is written, record it, and remove only what still proves
 * it is ours — naming everything left behind.
 *
 * **It needs a running DeckHQ**, and that is `deckhq layout import`'s reason
 * rather than a new one: the grant is recorded in `state.json`, a live daemon
 * holds that file in memory and saves it on a debounce, and a CLI that edited
 * it underneath would have its edit overwritten by the next save. With no
 * daemon this prints one line and exits 2.
 *
 * No egress. The only socket opened is to 127.0.0.1. Nothing is spawned.
 */
import path from 'node:path';
import process from 'node:process';

import { findDaemon } from './source.mjs';

/** Longer than the status line's budget: these commands are typed, not polled. */
const TIMEOUT_MS = 2000;

/** What the user sees when a daemon is required and there is not one. */
export const NO_DAEMON = 'start deckhq to enable or disable Studio';

export const STUDIO_HELP = `
  deckhq studio — the opt-in "idea to office" mode, per project.

  Usage: deckhq studio enable  <dir> [--yes] [--port N]
         deckhq studio disable <dir> [--yes] [--port N]

  enable    lets DeckHQ write inside <dir>/.deckhq/studio/ — a plan, a roster,
            a board, your coding rules, one brief per role and one handover per
            finished card. Without --yes it prints every path, what each one is
            for, and changes nothing.
  disable   deletes only the files that still carry the DeckHQ marker, and
            names everything else it left alone. Without --yes it prints what
            it would do.

  Consent is per project and is never inferred from another. After this
  package NOTHING RUNS: enabling creates a directory and a record. The planner,
  the roster editor and Hire land in later packages.

  Needs a running DeckHQ, because the grant is recorded in state.json and a
  live daemon owns that file.
`;

/** @param {string[]} argv @param {string} name */
function option(argv, name) {
  const i = argv.indexOf(name);
  return i !== -1 && i < argv.length - 1 ? argv[i + 1] : null;
}

/** @param {string[]} argv */
function portOf(argv) {
  const v = option(argv, '--port');
  return v != null ? Number(v) || null : null;
}

/** The first bare word in argv, skipping flag values. @param {string[]} argv */
function firstArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('-')) {
      if (argv[i] === '--port') i++;
      continue;
    }
    return argv[i];
  }
  return null;
}

/**
 * POST one of the two endpoints. Separate so a test drives the command without
 * a socket.
 * @param {number} port
 * @param {'enable'|'disable'} verb
 * @param {any} body
 */
export async function postStudio(port, verb, body) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/studio/${verb}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    let parsed = null;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return { ok: res.ok, status: res.status, body: parsed };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      body: { error: /** @type {any} */ (err)?.message || String(err) },
    };
  }
}

/**
 * `deckhq studio enable|disable`.
 *
 * @param {string[]} argv
 * @param {{write?:(s:string)=>void, error?:(s:string)=>void,
 *          find?:typeof findDaemon, post?:typeof postStudio, cwd?:string}} [deps]
 * @returns {Promise<number>}
 */
export async function runStudio(argv = [], deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  const error = deps.error || ((s) => process.stderr.write(s));

  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    write(STUDIO_HELP);
    return argv.length === 0 ? 2 : 0;
  }

  const verb = argv[0];
  if (verb !== 'enable' && verb !== 'disable') {
    error(`\n  unknown: "${verb}". Try enable or disable.\n\n`);
    return 2;
  }

  const rest = argv.slice(1);
  const named = firstArg(rest);
  if (!named) {
    error('\n  a project directory is required:  deckhq studio enable .\n\n');
    return 2;
  }
  // Resolved here as well as at the daemon: the two must agree about which
  // directory is meant, and `.` is what somebody standing in the project types.
  const dir = path.resolve(deps.cwd || process.cwd(), named);
  const yes = rest.includes('--yes');

  const found = await (deps.find || findDaemon)({ port: portOf(rest), timeoutMs: TIMEOUT_MS });
  if (!found) {
    error(`\n  ${NO_DAEMON}\n\n`);
    return 2;
  }

  const post = deps.post || postStudio;
  const res = await post(found.port, verb, { cwd: dir, ...(yes ? { confirm: true } : {}) });
  if (!res.ok) {
    error(
      `\n  ${(res.body && res.body.error) || `HTTP ${res.status}`}\n  Nothing was changed.\n\n`,
    );
    return 1;
  }
  const body = res.body || {};

  if (verb === 'enable') {
    if (!yes) {
      write(
        '\n' +
          (body.enabled ? `  Studio is already enabled for ${dir}.\n\n` : '') +
          String(body.describe || '') +
          '  Nothing was changed. Run it again with --yes to write it.\n\n',
      );
      return 0;
    }
    if (body.already) {
      write(`\n  Studio was already enabled for ${dir}. Nothing was changed.\n\n`);
      return 0;
    }
    write(
      '\n  Written:\n' +
        (body.written || []).map((p) => `    ${p}`).join('\n') +
        `\n\n  Studio is enabled for ${dir}. Nothing is running: this package writes the\n` +
        '  directory and the record, and the planner, the roster and Hire come later.\n' +
        '  `deckhq studio disable` takes it back out.\n\n',
    );
    return 0;
  }

  if (!yes) {
    const would = body.wouldRemove || [];
    write(
      '\n' +
        (would.length
          ? '  This would delete:\n\n' + would.map((p) => `    ${p}`).join('\n') + '\n'
          : '  There is nothing DeckHQ wrote here to delete.\n') +
        (body.wouldKeep && body.wouldKeep.length
          ? '\n  And would LEAVE, because they are yours:\n\n' +
            body.wouldKeep.map((p) => `    ${p}`).join('\n') +
            '\n'
          : '') +
        '\n  Nothing was changed. Run it again with --yes to remove them.\n\n',
    );
    return 0;
  }

  write(
    '\n' +
      (body.removed && body.removed.length
        ? `  Removed ${body.removed.length}:\n` +
          body.removed.map((p) => `    ${p}`).join('\n') +
          '\n'
        : '  Removed nothing.\n') +
      (body.missing && body.missing.length
        ? '\n  Already gone:\n' + body.missing.map((p) => `    ${p}`).join('\n') + '\n'
        : '') +
      (body.foreign && body.foreign.length
        ? '\n  Left alone — no longer carries the DeckHQ marker, so it is not ours to delete:\n' +
          body.foreign.map((p) => `    ${p}`).join('\n') +
          '\n'
        : '') +
      (body.kept && body.kept.length
        ? '\n  Left alone — yours:\n' + body.kept.map((p) => `    ${p}`).join('\n') + '\n'
        : '') +
      `\n  Studio is disabled for ${dir}.\n\n`,
  );
  return body.foreign && body.foreign.length ? 1 : 0;
}

export default runStudio;
