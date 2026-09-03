#!/usr/bin/env node
/**
 * What `/deckhq:deck` runs. Opens the floor, starting the daemon if the
 * session's `SessionStart` hook could not.
 *
 * The URL is printed as well as opened, because the one machine where opening
 * a browser reliably fails is the one running inside a container or over SSH,
 * and there the printed loopback URL is the whole answer.
 */
import { spawn } from 'node:child_process';
import process from 'node:process';

import { ensureDaemon } from '../lib/start.mjs';

/**
 * Open a URL in the platform's default browser. Argv arrays only, and the URL
 * is one this file built from a port number it read off a loopback socket —
 * no value from a hook payload or a prompt reaches a child process here.
 * @param {string} url
 */
function openUrl(url) {
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

const result = await ensureDaemon({});
if (result.port == null) {
  process.stdout.write(
    result.reason === 'no-deckhq'
      ? 'DeckHQ is not installed on this machine, so there is no floor to open. ' +
          'Install it with `npm i -g deckhq`, then run `deckhq`.\n'
      : 'DeckHQ did not come up in time, so there is no floor to open yet. Try `deckhq` in a ' +
          'terminal to see what it says.\n',
  );
} else {
  const url = `http://127.0.0.1:${result.port}/`;
  openUrl(url);
  process.stdout.write(`Opened the DeckHQ floor at ${url}\n`);
}
process.exitCode = 0;
