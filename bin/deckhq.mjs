#!/usr/bin/env node
/**
 * DeckHQ entry point.
 *
 *   npx deckhq            start the daemon and open the browser
 *   npx deckhq --no-open  start the daemon only
 *   npx deckhq --port N   listen on a different loopback port
 *
 * The daemon binds 127.0.0.1 and nothing else. There is no --host flag and
 * there never will be one; see docs/02-ARCHITECTURE.md §9.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';
import { startDaemon } from '../src/daemon.mjs';

const argv = process.argv.slice(2);

function flag(name) {
  return argv.includes(name);
}

function option(name, fallback) {
  const i = argv.indexOf(name);
  if (i === -1 || i === argv.length - 1) return fallback;
  return argv[i + 1];
}

if (flag('--help') || flag('-h')) {
  process.stdout.write(
    [
      'DeckHQ — command deck for every agent session on your machine.',
      '',
      'Usage: deckhq [options]',
      '',
      '  --port <n>    loopback port (default 4317)',
      '  --no-open     do not open a browser',
      '  --version     print the version',
      '  --help        this message',
      '',
      'The daemon binds 127.0.0.1 only and makes no outbound network calls.',
      '',
    ].join('\n'),
  );
  process.exit(0);
}

if (flag('--version') || flag('-v')) {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
  process.stdout.write(JSON.parse(readFileSync(pkgPath, 'utf8')).version + '\n');
  process.exit(0);
}

const port = Number(option('--port', process.env.DECKHQ_PORT || 4317)) || 4317;

/** Open a URL in the platform's default browser. Best-effort, never fatal. */
function openBrowser(url) {
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
}

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
