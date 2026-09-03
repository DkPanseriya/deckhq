#!/usr/bin/env node
/**
 * DeckHQ entry point.
 *
 *   npx deckhq            start the daemon and open the browser
 *   npx deckhq --no-open  start the daemon only
 *   npx deckhq --port N   listen on a different loopback port
 *   npx deckhq doctor     print what DeckHQ can see here, and start nothing
 *   npx deckhq ls         the deck, as a table
 *   npx deckhq waiting    only what needs you
 *   npx deckhq ack ID     this one is dealt with
 *   npx deckhq bench ID   park it in the lounge
 *   npx deckhq open ID    open the floor at that agent
 *   npx deckhq statusline one line for a status bar
 *
 * With no --port, the daemon prefers the port the installed hooks already
 * post to, so a daemon and its hooks cannot drift apart by accident; if a
 * DeckHQ daemon is already on that port, this prints one line naming it and
 * starts nothing. An explicit --port is honoured as given.
 *
 * The daemon binds 127.0.0.1 and nothing else. There is no --host flag and
 * there never will be one; see docs/02-ARCHITECTURE.md §9.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const argv = process.argv.slice(2);

// Subcommands are dispatched before anything else is imported, and each one
// imports only its own module. `doctor` must not start the server or open a
// browser; `statusline` runs inside somebody else's editing loop and has a
// 20 ms budget on its no-daemon path, which a static import of the daemon (or
// of the adapter registry) would spend before it read anything.
//
// Every handler returns an exit code rather than calling `process.exit()`.
// These commands talk to a daemon over loopback, and exiting hard while that
// socket is still closing aborts the process inside libuv — measured on
// Windows as "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING),
// src\\win\\async.c", which turned a perfectly healthy report into exit code
// 127 (docs/DEVIATIONS.md §76). Letting the loop drain costs nothing: none of
// them holds a timer or a listener open.
/** @type {Record<string, (rest: string[]) => Promise<number>>} */
const SUBCOMMANDS = {
  doctor: async (rest) => (await import('../src/cli/doctor.mjs')).runDoctor(rest),
  statusline: async (rest) => (await import('../src/cli/statusline.mjs')).runStatusline(rest),
  ls: async (rest) => (await import('../src/cli/deck.mjs')).runLs(rest),
  waiting: async (rest) => (await import('../src/cli/deck.mjs')).runWaiting(rest),
  ack: async (rest) => (await import('../src/cli/deck.mjs')).runAct('acknowledge', rest),
  bench: async (rest) => (await import('../src/cli/deck.mjs')).runAct('bench', rest),
  open: async (rest) => (await import('../src/cli/deck.mjs')).runOpen(rest),
};

const subcommand = argv[0] && !argv[0].startsWith('-') ? argv[0] : null;

if (subcommand) {
  const handler = SUBCOMMANDS[subcommand];
  if (!handler) {
    process.stderr.write(`deckhq: unknown command "${subcommand}". Try "deckhq --help".\n`);
    process.exitCode = 2;
  } else {
    process.exitCode = await handler(argv.slice(1));
  }
} else {
  await main();
}

async function main() {
  const { startDaemon, DeckhqAlreadyRunningError } = await import('../src/daemon.mjs');

  const flag = (name) => argv.includes(name);

  const option = (name, fallback) => {
    const i = argv.indexOf(name);
    if (i === -1 || i === argv.length - 1) return fallback;
    return argv[i + 1];
  };

  if (flag('--help') || flag('-h')) {
    process.stdout.write(
      [
        'DeckHQ — command deck for every agent session on your machine.',
        '',
        'Usage: deckhq [options]',
        '       deckhq doctor [--json] [--share] [--capture-proof]',
        '       deckhq ls | waiting [--json] [--all]',
        '       deckhq ack | bench | open <id>',
        '       deckhq statusline [--json] [--install] [--remove]',
        '',
        '  --port <n>    loopback port (default 4317, or wherever installed hooks post)',
        '  --no-open     do not open a browser',
        '  --version     print the version',
        '  --help        this message',
        '',
        'Commands:',
        '  doctor        what DeckHQ can see here, and what it cannot.',
        '                Starts nothing. `deckhq doctor --help` for its options.',
        '  ls            the deck as a table: who is waiting, on what, for how long.',
        '  waiting       the same table, only what needs you.',
        '  ack <id>      this one is dealt with. Needs a running DeckHQ.',
        '  bench <id>    park it in the lounge. Needs a running DeckHQ.',
        '  open <id>     open the floor at that agent.',
        '  statusline    one line — "▣ 3 waiting · 1 hand up" — for a status bar.',
        '                --install writes it into your Claude Code settings.',
        '',
        'Every command takes an id: the MK tag the deck prints, a name you gave,',
        'or any prefix of the session id.',
        '',
        'The daemon binds 127.0.0.1 only and makes no outbound network calls.',
        '',
      ].join('\n'),
    );
    return;
  }

  if (flag('--version') || flag('-v')) {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
    process.stdout.write(JSON.parse(readFileSync(pkgPath, 'utf8')).version + '\n');
    return;
  }

  // A port named on the command line or in the environment is a request to
  // be on that port, and is honoured as given. Only when neither names one may
  // the daemon prefer the port the installed hooks already post to.
  const explicitPort = flag('--port') || Boolean(process.env.DECKHQ_PORT);
  const port = Number(option('--port', process.env.DECKHQ_PORT || 4317)) || 4317;

  /** Open a URL in the platform's default browser. Best-effort, never fatal. */
  const openBrowser = (url) => {
    try {
      if (process.platform === 'win32') {
        spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
      } else if (process.platform === 'darwin') {
        spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
      } else {
        spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
      }
    } catch {
      /* the URL is printed anyway */
    }
  };

  let daemon;
  try {
    daemon = await startDaemon({ port, adoptHooksPort: !explicitPort });
  } catch (err) {
    if (err instanceof DeckhqAlreadyRunningError) {
      // The hooks already deliver to a DeckHQ on that port. A second daemon
      // beside it would run degraded and steal nothing, so: name it, stop.
      process.stdout.write(
        `\n  DeckHQ is already running at ${err.url} — the installed ${err.label} hooks post ` +
          'there. Nothing was started.\n\n',
      );
      return;
    }
    throw err;
  }
  const { url, close } = daemon;

  process.stdout.write(`\n  DeckHQ  ${url}\n\n`);
  if (!flag('--no-open')) openBrowser(url);

  let closing = false;
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      if (closing) process.exit(0);
      closing = true;
      process.stdout.write('\n  shutting down\n');
      close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }
}
