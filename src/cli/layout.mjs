/**
 * `deckhq layout` — WP-30's export and import.
 *
 *     deckhq layout export > my-floor.json
 *     deckhq layout import my-floor.json
 *     deckhq layout show                     the same document, on stdout, prettily
 *
 * The two halves are not symmetrical, for the same reason `deck.mjs`'s are
 * not:
 *
 * **Export reads.** With a daemon it is exact; without one it is `state.json`
 * plus the scan cache, which is enough to know the theme, the preferences and
 * which projects exist. It writes nothing.
 *
 * **Import writes**, so it needs a running daemon and there is no offline
 * path. `state.json` is held in memory by a live daemon and saved on a
 * debounce, so a CLI that edited the file underneath it would have its edit
 * overwritten by the next save. With no daemon this prints one line and exits
 * 2.
 *
 * A malformed file is refused whole. `validateLayout` runs before anything is
 * sent, and the daemon validates again before anything is written, so a bad
 * file costs one error message and changes nothing.
 *
 * No egress. The only socket opened is to 127.0.0.1.
 */
import fs from 'node:fs';
import process from 'node:process';

import { projects as projectsOf } from '../core/model.mjs';
import { buildLayout, parseLayout } from '../core/layout.mjs';
import { findDaemon, readOffline, readState } from './source.mjs';

/** Longer than the status line's 150 ms: these commands are typed, not polled. */
const READ_TIMEOUT_MS = 1500;

/** What the user sees when a daemon is required and there is not one. */
export const NO_DAEMON = 'start deckhq to import a layout';

export const LAYOUT_HELP = `
  deckhq layout — the floor's arrangement, as a file you own.

  Usage: deckhq layout export [--port N]        write it to stdout
         deckhq layout show   [--port N]        the same thing, for reading
         deckhq layout import <file> [--port N] apply one

  What a layout carries: the theme, the order the rooms are laid out in, which
  rooms are folded into the idle strip, and the two floor preferences —
  goneHomeDays and lightsOutHour.

  What it does not: any session, transcript, acknowledgement or name, and no
  room COORDINATES — the floor sizes and places rooms from what is in them, so
  there is no position to pin. Order is what a layout can move.

  A layout names your projects by their slugs, which come from your folder
  paths. It is not anonymous. Read one before you send it anywhere.

  Import needs a running DeckHQ. A malformed file is refused whole: nothing is
  applied, and the reason is printed.
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
 * The floor's arrangement, from the daemon if one answers and from the files
 * if none does.
 *
 * The offline path builds `projects` the way the daemon does — `model.js`'s
 * own `projects()` over the agents the scan cache knows about — so an export
 * taken with the daemon down is the same document, not a different one.
 *
 * @param {{port?:number|null, find?:typeof findDaemon, offline?:typeof readOffline,
 *          state?:typeof readState}} [opts]
 * @returns {Promise<{layout:ReturnType<typeof buildLayout>, source:'daemon'|'state'}>}
 */
export async function readLayout(opts = {}) {
  const find = opts.find || findDaemon;
  const found = await find({ port: opts.port ?? null, timeoutMs: READ_TIMEOUT_MS });
  if (found) return { layout: buildLayout(found.snapshot), source: 'daemon' };

  const offline = opts.offline || readOffline;
  const state = (opts.state || readState)();
  const deck = offline({});
  // `readState` does not declare `archivedProjects` — it reads the keys the
  // deck needs — but the file has it, so it is read here and defaulted. A
  // folded room is a view preference; missing one costs an open room in an
  // export, never a wrong one.
  const archived = /** @type {any} */ (state).archivedProjects || {};
  const projects = projectsOf(deck.agents).map((p) => ({
    ...p,
    archived: archived[p.id] === true,
  }));
  return {
    layout: buildLayout({ projects, settings: state.settings || {} }),
    source: 'state',
  };
}

/**
 * POST `/api/layout`. Separate so a test drives the command without a socket.
 * @param {number} port
 * @param {any} body
 */
export async function postLayout(port, body) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/layout`, {
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
 * `deckhq layout export|show|import`.
 *
 * @param {string[]} argv
 * @param {{write?:(s:string)=>void, error?:(s:string)=>void, read?:typeof readLayout,
 *          find?:typeof findDaemon, post?:typeof postLayout,
 *          readFile?:(p:string)=>string}} [deps]
 * @returns {Promise<number>}
 */
export async function runLayout(argv = [], deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  const error = deps.error || ((s) => process.stderr.write(s));

  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) {
    write(LAYOUT_HELP);
    return argv.length === 0 ? 2 : 0;
  }

  const verb = argv[0];
  const rest = argv.slice(1);

  if (verb === 'export' || verb === 'show') {
    const read = deps.read || readLayout;
    const { layout, source } = await read({ port: portOf(rest) });
    // The document goes to stdout so `> my-floor.json` is the whole story;
    // everything ABOUT it goes to stderr so the redirect stays clean.
    write(`${JSON.stringify(layout, null, 2)}\n`);
    error(
      `  ${layout.rooms.length} room(s), theme "${layout.theme}"` +
        `${source === 'state' ? ', read from state.json (no daemon running)' : ''}\n` +
        '  This names your project folders. It is not anonymous.\n',
    );
    return 0;
  }

  if (verb === 'import') {
    const file = firstArg(rest);
    if (!file) {
      error('  a file is required:  deckhq layout import my-floor.json\n');
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
    // `'error' in parsed` rather than `!parsed.ok`: the same idiom `deck.mjs`
    // uses on `resolveId`'s result, and the one the type checker narrows.
    const parsed = parseLayout(text);
    if ('error' in parsed) {
      error(
        `  that is not a layout this build can apply.\n  ${parsed.error}\n  Nothing was changed.\n`,
      );
      return 1;
    }

    const find = deps.find || findDaemon;
    const found = await find({ port: portOf(rest), timeoutMs: READ_TIMEOUT_MS });
    if (!found) {
      error(`  ${NO_DAEMON}\n`);
      return 2;
    }

    const post = deps.post || postLayout;
    const res = await post(found.port, parsed.layout);
    if (!res.ok) {
      error(
        `  the daemon refused this layout: ${(res.body && res.body.error) || `HTTP ${res.status}`}\n` +
          '  Nothing was changed.\n',
      );
      return 1;
    }

    const applied = parsed.layout;
    write(
      `  applied: theme "${applied.theme}", ${applied.rooms.length} room(s)` +
        `${applied.archivedRooms.length ? `, ${applied.archivedRooms.length} folded away` : ''}\n`,
    );
    return 0;
  }

  error(`  unknown: "${verb}". Try export, show or import.\n`);
  return 2;
}
