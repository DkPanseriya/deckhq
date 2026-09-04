/**
 * A machine of our own, for one test file.
 *
 * `docs/DEVIATIONS.md` §121.4 recorded the hazard: several tests scanned the
 * developer's real home directory, so the suite's wall clock swung between 5 s
 * and 68 s **on one commit**, and at least one test took a different branch —
 * and therefore asserted something different — depending on whether the host
 * happened to have a session in `for_review` at that moment. A suite whose
 * verdict is a function of the laptop it runs on is not a suite.
 *
 * Importing this module **first**, before anything under `src/`, points every
 * environment variable the product reads at a fresh temp root and removes it
 * on exit. First is not a style preference: `src/adapters/claude-code/parse.mjs`
 * resolves `CLAUDE_CONFIG_DIR` into `CLAUDE_DIR` at module-evaluation time, and
 * `src/core/paths.mjs` resolves `DECKHQ_STATE_DIR` into `DATA_DIR` the same
 * way, so a module imported before this one has already read the host. Static
 * `import` declarations are hoisted and evaluated in source order, which is why
 * the files using this helper import it at the top and then reach for `src/`
 * through `await import()`.
 *
 * The full list, and where each one is read:
 *
 * | variable                       | read by                                     |
 * | ------------------------------ | ------------------------------------------- |
 * | `CLAUDE_CONFIG_DIR`            | `src/adapters/claude-code/parse.mjs`, load  |
 * | `DECKHQ_STATE_DIR`             | `src/core/paths.mjs`, load                  |
 * | `DECKHQ_DESKTOP_SESSIONS_DIR`  | `src/adapters/claude-code/desktop.mjs`      |
 * | `APPDATA`                      | `desktopSessionsDir()`'s Windows fallback   |
 * | `HOME` / `USERPROFILE`         | `os.homedir()` — the Codex adapter and      |
 * |                                | `~/.deckhq` are both derived from it        |
 *
 * `APPDATA` is in that list because the desktop-store override is the one a
 * test is most likely to delete on its way out, and the fallback underneath it
 * on Windows is `%APPDATA%\Claude\claude-code-sessions` — the real one. Moving
 * the home alone does not move that.
 *
 * `DECKHQ_HOSTNAME`, `DECKHQ_PORT`, `DECKHQ_DEBUG` and
 * `DECKHQ_PERMISSION_HOLD_MS` are **deleted** rather than pointed somewhere.
 * None of them is a path; each of them changes behaviour, and a developer who
 * exports one in their shell must not thereby be running a different suite
 * from CI. Deleting rather than setting also keeps one assertion honest:
 * `GET /api/about` is supposed to report the machine's own name, and
 * `test/integration/snapshot-route.test.mjs` asserts it against
 * `os.hostname()`. Pinning the override would have turned that into a test of
 * the override, which the test beside it already is.
 *
 * `node --test` gives every test file its own process, so none of this can
 * leak into another file.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/** Everything this file's test process is allowed to touch. */
export const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-isolate-'));

/** The home directory `os.homedir()` will report from here on. */
export const HOME = path.join(ROOT, 'home');

/** `CLAUDE_CONFIG_DIR` — the Claude Code adapter's whole world. */
export const CLAUDE_DIR = path.join(HOME, '.claude');

/** Where a transcript has to be for the real parser to find it. */
export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

/** `DECKHQ_STATE_DIR` — what `~/.deckhq` resolves to in here. */
export const STATE_DIR = path.join(ROOT, 'state');

/** `DECKHQ_DESKTOP_SESSIONS_DIR` — the desktop app's store, empty. */
export const DESKTOP_SESSIONS_DIR = path.join(ROOT, 'desktop-sessions');

/** The Windows fallback under the override above. */
export const APPDATA = path.join(HOME, 'AppData', 'Roaming');

for (const dir of [PROJECTS_DIR, STATE_DIR, DESKTOP_SESSIONS_DIR, APPDATA]) {
  fs.mkdirSync(dir, { recursive: true });
}

process.env.HOME = HOME;
process.env.USERPROFILE = HOME;
process.env.APPDATA = APPDATA;
process.env.CLAUDE_CONFIG_DIR = CLAUDE_DIR;
process.env.DECKHQ_STATE_DIR = STATE_DIR;
process.env.DECKHQ_DESKTOP_SESSIONS_DIR = DESKTOP_SESSIONS_DIR;
delete process.env.DECKHQ_HOSTNAME;
delete process.env.DECKHQ_PORT;
delete process.env.DECKHQ_DEBUG;
delete process.env.DECKHQ_PERMISSION_HOLD_MS;

process.on('exit', () => {
  try {
    fs.rmSync(ROOT, { recursive: true, force: true });
  } catch {
    // A Windows handle still open on a file inside is not worth failing a
    // green suite over; the directory is under the OS temp root either way.
  }
});

/**
 * A scratch directory inside the isolated root, for a state file, a public
 * dir, a snapshot dir — anything a test wants to hand a daemon. It goes away
 * with the root, so a test that forgets to clean up still leaks nothing.
 *
 * @param {string} [prefix]
 * @returns {string}
 */
export function scratchDir(prefix = 'case-') {
  return fs.mkdtempSync(path.join(ROOT, prefix));
}

/**
 * Everything a daemon needs to be started against this machine and nothing
 * else: its own state file and its own `public/` with an index in it.
 *
 * @param {string} [prefix]
 * @returns {{dir:string, stateFile:string, publicDir:string}}
 */
export function daemonScratch(prefix = 'daemon-') {
  const dir = scratchDir(prefix);
  const publicDir = path.join(dir, 'public');
  fs.mkdirSync(publicDir, { recursive: true });
  fs.writeFileSync(path.join(publicDir, 'index.html'), '<!doctype html>floor', 'utf8');
  return { dir, stateFile: path.join(dir, 'state.json'), publicDir };
}

/**
 * Write a Claude Code transcript the real parser will read: one user turn and,
 * unless `turnEnded` is false, one finished assistant turn after it. A
 * finished turn is what puts somebody on the floor in `for_review`.
 *
 * This exists so that a test which needs a session in a particular state can
 * plant one instead of hoping the host has one. §121.4 is exactly the cost of
 * hoping.
 *
 * @param {object} [opts]
 * @param {string} [opts.sessionId]
 * @param {string} [opts.title]
 * @param {string} [opts.project]  directory name under the isolated home
 * @param {boolean} [opts.turnEnded]  false leaves the user turn last
 * @param {number} [opts.ageMs]  how long ago the turn happened
 * @returns {{id:string, cwd:string, dir:string, file:string, title:string, remove:() => void}}
 */
export function writeClaudeSession(opts = {}) {
  const {
    sessionId = '11111111-1111-1111-1111-111111111111',
    title = 'The planted one',
    project = 'planted',
    turnEnded = true,
    ageMs = 60_000,
  } = opts;

  const cwd = path.join(HOME, 'code', project);
  const slug = cwd.replace(/[\\/:]+/g, '-');
  const dir = path.join(PROJECTS_DIR, slug);
  fs.mkdirSync(dir, { recursive: true });

  const at = (s) => new Date(Date.now() - ageMs + s * 1000).toISOString();
  const lines = [
    { type: 'custom-title', customTitle: title, sessionId },
    {
      parentUuid: null,
      isSidechain: false,
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: 'Ship the thing.' }] },
      uuid: 'u1',
      timestamp: at(1),
      cwd,
      gitBranch: 'main',
      sessionId,
      version: '2.1.0',
    },
  ];
  if (turnEnded) {
    lines.push({
      parentUuid: 'u1',
      isSidechain: false,
      type: 'assistant',
      message: {
        id: 'msg_a',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: 'Shipped. Want me to open the PR?' }],
        usage: {
          input_tokens: 120,
          output_tokens: 64,
          cache_read_input_tokens: 8,
          cache_creation_input_tokens: 4,
        },
      },
      uuid: 'a1',
      timestamp: at(2),
      cwd,
      gitBranch: 'main',
      sessionId,
    });
  }

  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n', 'utf8');

  return {
    id: `claude:${sessionId}`,
    cwd,
    dir,
    file,
    title,
    remove: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
