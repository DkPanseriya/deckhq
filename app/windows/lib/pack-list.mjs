/**
 * The files `npm pack` would publish, asked of npm itself.
 *
 * The Windows app's `core\` folder is the npm package, file for file. The list
 * is therefore not written down anywhere in `app/`: `package.json`'s `files`
 * is the one place that decides what ships, and npm is the one program that
 * knows how to read it (its always-included files, its ignore rules, its
 * negations). This runs `npm pack --dry-run --json` and returns what it says.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

/**
 * This Node running `npm-cli.js` — never the `npm.cmd` on the PATH, which
 * would need a shell (`test/integration/tarball.test.mjs` has the long form of
 * the reason). Null when this machine has no npm beside its Node.
 * @returns {{command:string, args:string[]}|null}
 */
export function npmRunner() {
  const beside = path.dirname(process.execPath);
  const candidates = [
    process.env.npm_execpath,
    path.join(beside, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.join(path.dirname(beside), 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ];
  for (const candidate of candidates) {
    if (!candidate || !/\.(c|m)?js$/i.test(candidate)) continue;
    try {
      if (fs.statSync(candidate).isFile()) return { command: process.execPath, args: [candidate] };
    } catch {
      // Not there; try the next layout.
    }
  }
  return null;
}

/**
 * Every path in the package, relative to the repository, forward slashes,
 * sorted. Nothing is written: `--dry-run` packs to nowhere.
 * @param {string} repo
 * @returns {string[]}
 */
export function packFiles(repo) {
  const npm = npmRunner();
  if (!npm)
    throw new Error('no npm was found beside this Node, so the package list cannot be read');
  const out = execFileSync(
    npm.command,
    [...npm.args, 'pack', '--dry-run', '--json', '--ignore-scripts'],
    {
      cwd: repo,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
      env: {
        ...process.env,
        npm_config_update_notifier: 'false',
        npm_config_fund: 'false',
        npm_config_audit: 'false',
        npm_config_loglevel: 'error',
      },
    },
  );
  const [report] = JSON.parse(out);
  return report.files.map((f) => String(f.path).replace(/\\/g, '/')).sort();
}
