/**
 * `deckhq look` — WP-88a's export and import.
 *
 *     deckhq look export > my-floor.json
 *     deckhq look show                       the same document, for reading
 *     deckhq look import my-floor.json       apply one
 *     deckhq look presets                    the six, and what each is
 *
 * The two halves are not symmetrical, for `deckhq layout`'s reason exactly:
 *
 * **Export reads.** With a daemon it is exact; without one it is `state.json`,
 * which is where the look lives. It writes nothing.
 *
 * **Import writes**, so it needs a running daemon and there is no offline path.
 * `state.json` is held in memory by a live daemon and saved on a debounce, so a
 * CLI that edited the file underneath it would have its edit overwritten by the
 * next save. With no daemon this prints one line and exits 2.
 *
 * ## One thing this says and `deckhq layout` cannot
 *
 * A LOOK IS ANONYMOUS. A layout names your project folders and its export warns
 * about it on stderr; a look is option ids from a table this build ships, and
 * names no project, no path, no session and nobody. It is a file you can post.
 *
 * A malformed file is refused whole, and so is a legal file whose combination a
 * guard would not paint — with the measured reason, one row per picker, before
 * anything is sent. No egress: the only socket opened is to 127.0.0.1.
 */
import fs from 'node:fs';
import process from 'node:process';

import { DEFAULT_LOOK, PRESETS, buildLookDocument, parseLookDocument } from '../core/look.mjs';
import { findDaemon, readState } from './source.mjs';

/** Longer than the status line's 150 ms: these commands are typed, not polled. */
const READ_TIMEOUT_MS = 1500;

/** What the user sees when a daemon is required and there is not one. */
export const NO_DAEMON = 'start deckhq to import a look';

export const LOOK_HELP = `
  deckhq look — what the building is made of, as a file you own.

  Usage: deckhq look export [--port N]        write it to stdout
         deckhq look show   [--port N]        the same thing, for reading
         deckhq look import <file> [--port N] apply one
         deckhq look presets                  the six starting points

  What a look carries: the floor material in each of the four zones, the colour
  scheme, the furniture set, both rugs, the planting, the prop density, the
  lounge kit and the agent size.

  What it does not: any project, path, session, transcript, acknowledgement or
  name. Unlike a layout, a look is anonymous — it is a file you can post.

  Import needs a running DeckHQ. A file is refused whole, and so is a
  combination the contrast guards will not paint: nothing is applied, and the
  reason is printed.
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
 * The look this machine is painting, from the daemon if one answers and from
 * `state.json` if none does.
 *
 * @param {{port?:number|null, find?:typeof findDaemon, state?:typeof readState}} [opts]
 * @returns {Promise<{look:ReturnType<typeof buildLookDocument>, source:'daemon'|'state'}>}
 */
export async function readLook(opts = {}) {
  const find = opts.find || findDaemon;
  const found = await find({ port: opts.port ?? null, timeoutMs: READ_TIMEOUT_MS });
  if (found) {
    return { look: buildLookDocument(found.snapshot?.settings || {}), source: 'daemon' };
  }
  const state = (opts.state || readState)();
  return { look: buildLookDocument(state.settings || {}), source: 'state' };
}

/**
 * POST `/api/look`. Separate so a test drives the command without a socket.
 * @param {number} port
 * @param {any} body
 */
export async function postLook(port, body) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/look`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', connection: 'close' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
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
 * `deckhq look export|show|import|presets`.
 *
 * @param {string[]} argv
 * @param {{write?:(s:string)=>void, error?:(s:string)=>void, read?:typeof readLook,
 *          find?:typeof findDaemon, post?:typeof postLook,
 *          readFile?:(p:string)=>string}} [deps]
 * @returns {Promise<number>}
 */
export async function runLook(argv = [], deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  const error = deps.error || ((s) => process.stderr.write(s));

  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    write(LOOK_HELP);
    return argv.length === 0 ? 2 : 0;
  }

  const verb = argv[0];
  const rest = argv.slice(1);

  if (verb === 'presets') {
    for (const preset of PRESETS) {
      write(`  ${preset.id.padEnd(15)} ${preset.label}\n      ${preset.blurb}\n`);
    }
    write(`\n  The default is "${DEFAULT_LOOK.preset}", which is the floor as it ships.\n`);
    return 0;
  }

  if (verb === 'export' || verb === 'show') {
    const read = deps.read || readLook;
    const { look, source } = await read({ port: portOf(rest) });
    // The document goes to stdout so `> my-floor.json` is the whole story;
    // everything ABOUT it goes to stderr so the redirect stays clean.
    write(`${JSON.stringify(look, null, 2)}\n`);
    error(
      `  preset "${look.preset}", ${look.scheme} scheme, ${look.furniture} furniture` +
        `${source === 'state' ? ', read from state.json (no daemon running)' : ''}\n` +
        '  A look names no project and no path. It is anonymous.\n',
    );
    return 0;
  }

  if (verb === 'import') {
    const file = firstArg(rest);
    if (!file) {
      error('  a file is required:  deckhq look import my-floor.json\n');
      return 2;
    }

    let text;
    try {
      text = (deps.readFile || ((p) => fs.readFileSync(p, 'utf8')))(file);
    } catch (err) {
      error(`  could not read ${file}: ${/** @type {any} */ (err)?.message || err}\n`);
      return 2;
    }

    // Validated here as well as at the daemon. Not belt and braces: it means a
    // bad file is reported with its reason without a round trip, and that the
    // command says the same thing whether or not a daemon is up.
    const parsed = parseLookDocument(text);
    if ('error' in parsed) {
      error(`  that is not a look this build can paint.\n  ${parsed.error}\n`);
      for (const problem of parsed.problems || []) {
        error(`    ${problem.picker}: ${problem.reason}\n`);
      }
      error('  Nothing was changed.\n');
      return 1;
    }

    const find = deps.find || findDaemon;
    const found = await find({ port: portOf(rest), timeoutMs: READ_TIMEOUT_MS });
    if (!found) {
      error(`  ${NO_DAEMON}\n`);
      return 2;
    }

    const post = deps.post || postLook;
    const res = await post(found.port, parsed.look);
    if (!res.ok) {
      error(
        `  the daemon refused this look: ${(res.body && res.body.error) || `HTTP ${res.status}`}\n` +
          '  Nothing was changed.\n',
      );
      return 1;
    }

    const applied = parsed.look;
    write(
      `  applied: ${applied.scheme} over ${applied.floors.office} / ${applied.floors.corridor} / ` +
        `${applied.floors.rooms} / ${applied.floors.lounge}, ${applied.furniture} furniture\n`,
    );
    return 0;
  }

  error(`  unknown: "${verb}". Try export, show, import or presets.\n`);
  return 2;
}
