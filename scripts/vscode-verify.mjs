#!/usr/bin/env node
/**
 * Run `vscode/test/host.js` inside a real VS Code, against the demo floor.
 *
 *     node scripts/vscode-verify.mjs
 *     node scripts/vscode-verify.mjs --keep      leave the workspace behind
 *
 * This runs the **working tree**, not an installed `.vsix`, and it cannot be
 * made to run the installed one: `--extensionTestsPath` is silently ignored
 * unless `--extensionDevelopmentPath` is given too — a `code
 * --extensionTestsPath=C:/nope.js` exits 0 having done nothing, so a run in
 * that mode would report a pass it never earned. The `.vsix` holds the same
 * files byte for byte; an installed build is checked against the extension
 * host log instead. `docs/DEVIATIONS.md` §94.
 *
 * WP-31's acceptance criterion is "it installs the daemon, opens the floor,
 * and adds no telemetry", and the first two of those are claims about an
 * editor, not about a function. `node --test` cannot make them; this can.
 *
 * It starts `scripts/demo-floor.mjs` on a free port, writes a throwaway
 * workspace whose settings point the extension at it, and hands both to
 * `code --extensionDevelopmentPath --extensionTestsPath`. The demo floor
 * matters: this opens a real editor window on a real desktop, and it must
 * never be showing somebody's actual project names while it does.
 *
 * No dependency. `@vscode/test-electron` exists for exactly this and is not
 * worth a dev dependency for one script: `code` is already on the PATH of any
 * machine that can develop the extension, and it takes both flags directly.
 *
 * Exit code is the editor's: 0 when every assertion in the host script passed.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// The extension's own spawn planner, used here for the reason it exists: on
// Windows `code` is `code.cmd`, and Node refuses to spawn a `.cmd` without a
// shell. One implementation, exercised from both sides.
import command from '../vscode/lib/command.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const KEEP = argv.includes('--keep');

/** A free loopback port, well away from the daemon's own 4317–4326 range. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** @param {string} url @param {number} timeoutMs */
async function waitFor(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        const snapshot = await res.json();
        // Wait for the first scan to land, not just for the socket: a floor
        // with nobody on it verifies less than a floor with a queue on it.
        if (Array.isArray(snapshot.agents) && snapshot.agents.length > 0) return snapshot;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return null;
}

const port = await freePort();
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-vscode-verify-'));
fs.mkdirSync(path.join(workspace, '.vscode'));
fs.writeFileSync(
  path.join(workspace, '.vscode', 'settings.json'),
  JSON.stringify({ 'deckhq.port': port, 'deckhq.autoStart': false }, null, 2),
);
fs.writeFileSync(path.join(workspace, 'README.md'), '# DeckHQ verification workspace\n');
// Agreed with `vscode/test/host.js`: the extension host writes its result
// here, because its stdout does not reliably reach this terminal.
const reportFile = path.join(os.tmpdir(), 'deckhq-vscode-verify.txt');
fs.rmSync(reportFile, { force: true });

process.stdout.write(`\n  demo floor on 127.0.0.1:${port}\n`);
const demo = spawn(
  process.execPath,
  [path.join(ROOT, 'scripts', 'demo-floor.mjs'), '--port', String(port)],
  {
    cwd: ROOT,
    stdio: ['ignore', 'ignore', 'inherit'],
  },
);

let code = 1;
try {
  const snapshot = await waitFor(`http://127.0.0.1:${port}/api/state`, 30_000);
  if (!snapshot) throw new Error('the demo floor did not come up');
  process.stdout.write(
    `  ${snapshot.agents.length} agents, ${snapshot.counts.needsYou} waiting\n  opening VS Code…\n`,
  );

  const plan = command.spawnPlan([
    'code',
    `--extensionDevelopmentPath=${path.join(ROOT, 'vscode')}`,
    `--extensionTestsPath=${path.join(ROOT, 'vscode', 'test', 'host.js')}`,
    '--disable-extensions',
    '--new-window',
    workspace,
  ]);
  code = await new Promise((resolve, reject) => {
    const child = spawn(plan.file, plan.args, {
      ...plan.options,
      windowsHide: false,
      stdio: 'inherit',
      env: { ...process.env, DECKHQ_VERIFY_REPORT: reportFile },
    });
    child.on('error', reject);
    child.on('exit', (status) => resolve(status ?? 1));
  });

  // `code` returns as soon as the window is gone; the extension host may still
  // be flushing its result. Give it a moment rather than print nothing.
  for (let i = 0; i < 20 && !fs.existsSync(reportFile); i++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (fs.existsSync(reportFile)) process.stdout.write(fs.readFileSync(reportFile, 'utf8'));
  process.stdout.write(code === 0 ? '\n  verified.\n\n' : `\n  FAILED (exit ${code})\n\n`);
} finally {
  demo.kill();
  if (!KEEP) fs.rmSync(workspace, { recursive: true, force: true });
}

process.exitCode = code;
