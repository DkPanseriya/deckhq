#!/usr/bin/env node
/**
 * DeckHQ entry point.
 *
 *   npx deckhq            start the daemon and open the browser
 *   npx deckhq --no-open  start the daemon only
 *   npx deckhq --port N   listen on a different loopback port
 *   npx deckhq doctor     print what DeckHQ can see here, and start nothing
 *
 * The daemon binds 127.0.0.1 and nothing else. There is no --host flag and
 * there never will be one; see docs/02-ARCHITECTURE.md §9.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

const argv = process.argv.slice(2);

// Subcommands are dispatched before anything else is imported. `doctor` must
// not start the server or open a browser, and importing the daemon eagerly
// would pull the whole HTTP stack in for a command that only reads.
const SUBCOMMANDS = new Set(['doctor']);
const subcommand = argv[0] && !argv[0].startsWith('-') ? argv[0] : null;

if (subcommand) {
  if (!SUBCOMMANDS.has(subcommand)) {
    process.stderr.write(`deckhq: unknown command "${subcommand}". Try "deckhq --help".\n`);
    process.exitCode = 2;
  } else {
    const { runDoctor } = await import('../src/cli/doctor.mjs');
    // `process.exitCode`, never `process.exit()`. `doctor` talks to a running
    // daemon over loopback, and exiting hard while that socket is still
    // closing aborts the process inside libuv — measured on Windows as
    // "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\\win\\async.c",
    // which turns a perfectly healthy report into exit code 127. Letting the
    // loop drain costs nothing: the command holds no timers or listeners open.
    process.exitCode = await runDoctor(argv.slice(1));
  }
} else {
  await main();
}

async function main() {
  const { startDaemon } = await import('../src/daemon.mjs');

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
        '       deckhq doctor [--json] [--capture-proof]',
        '',
        '  --port <n>    loopback port (default 4317)',
        '  --no-open     do not open a browser',
        '  --version     print the version',
        '  --help        this message',
        '',
        'Commands:',
        '  doctor        what DeckHQ can see here, and what it cannot.',
        '                Starts nothing. `deckhq doctor --help` for its options.',
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

  const { url, close } = await startDaemon({ port });

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
