/**
 * Starting and stopping a DeckHQ daemon from the editor.
 *
 * **A daemon we start outlives the window that started it.** That is not an
 * oversight; it is the product. DeckHQ exists because debts accumulate while
 * you are not looking, and a daemon that died with the last VS Code window
 * would stop counting exactly when the counting matters. So the child is
 * detached and unreferenced, `npx deckhq` behaves the same way from a
 * terminal, and `DeckHQ: Stop daemon` is the way to take it down.
 *
 * **We can only stop what we started.** The daemon has no shutdown endpoint
 * and this extension is not going to add one — an HTTP route that kills the
 * process would be reachable by any page in any tab the CSRF guard let
 * through, for the sake of a menu item. So `stop()` kills the child in this
 * process's own table and says plainly when there is nothing of ours to kill.
 */
const { spawn } = require('node:child_process');
const process = require('node:process');

const { spawnPlan, portFromOutput } = require('./command');

/**
 * Start a daemon.
 *
 * Resolves as soon as the child is spawned — not when the daemon answers.
 * Discovery is `Monitor`'s job, and it is the more trustworthy of the two:
 * `npx` may print nothing for a minute while it downloads, and a daemon that
 * was already running prints a different line entirely.
 *
 * @param {{argv:string[], cwd?:string, log?:(s:string) => void,
 *          spawn?:typeof spawn, platform?:string}} opts
 * @returns {{child:any, argv:string[], port:Promise<number|null>}}
 */
function start(opts) {
  const log = opts.log || (() => {});
  const spawnFn = opts.spawn || spawn;
  const plan = spawnPlan(opts.argv, opts.platform || process.platform);

  log(`starting: ${opts.argv.join(' ')}`);
  const child = spawnFn(plan.file, plan.args, {
    ...plan.options,
    cwd: opts.cwd,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // The daemon prints its URL on stdout. Reading it is a shortcut, not the
  // route: it saves a discovery sweep when it works, and nothing depends on it
  // when it does not.
  const port = new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const read = (stream) => {
      if (!stream || typeof stream.setEncoding !== 'function') return;
      stream.setEncoding('utf8');
      let buffer = '';
      stream.on('data', (chunk) => {
        buffer = (buffer + chunk).slice(-4096);
        log(String(chunk).trimEnd());
        const found = portFromOutput(buffer);
        if (found != null) done(found);
      });
      stream.on('error', () => {});
    };
    read(child.stdout);
    read(child.stderr);
    child.on('error', (err) => {
      log(`could not start: ${err && err.message ? err.message : String(err)}`);
      done(null);
    });
    child.on('exit', (code) => {
      log(`start command exited with ${code}`);
      done(null);
    });
  });

  if (typeof child.unref === 'function') child.unref();
  return { child, argv: opts.argv, port };
}

/**
 * Kill a child started by `start()`, and the process tree under it.
 *
 * On Windows the child is `cmd.exe`, which is waiting on `npx`, which is
 * waiting on `node`; killing the first alone leaves the daemon running, so
 * `taskkill /T` takes the tree. Its arguments are a literal flag list and one
 * integer — nothing a setting can reach.
 *
 * @param {{child:any, log?:(s:string) => void, spawn?:typeof spawn,
 *          platform?:string}} opts
 * @returns {boolean} whether a kill was attempted
 */
function stop(opts) {
  const log = opts.log || (() => {});
  const spawnFn = opts.spawn || spawn;
  const platform = opts.platform || process.platform;
  const child = opts.child;
  if (!child || child.exitCode != null || child.signalCode != null || !child.pid) return false;

  try {
    if (platform === 'win32') {
      spawnFn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      // Detached, so the child is its own process group leader; the negative
      // pid takes `npx` and the `node` under it as well.
      try {
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        child.kill('SIGTERM');
      }
    }
    log(`stopped the daemon started from this window (pid ${child.pid})`);
    return true;
  } catch (err) {
    log(`could not stop pid ${child.pid}: ${err && err.message ? err.message : String(err)}`);
    return false;
  }
}

module.exports = { start, stop };
