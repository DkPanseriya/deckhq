#!/usr/bin/env node
/**
 * Portable test entry point.
 *
 * `node --test <dir>` is not portable across the Node versions we support —
 * 18 wants a directory, 24 wants explicit files or a glob — so we enumerate
 * the files ourselves and hand them to the runner. Extra argv is forwarded,
 * which is how you run one file:  npm test -- test/unit/model.test.mjs
 *
 * It also decides what "home" means for the run. `docs/DEVIATIONS.md` §121.4:
 * tests that scanned the developer's real home made the suite's wall clock
 * swing between 5 s and 68 s on one commit, and made at least one test assert
 * something different depending on what the host happened to have open. So the
 * run gets a **canary home** — an empty temp directory holding one transcript
 * whose title is a sentinel nobody should ever see — and `test/helpers/
 * canary.cjs` is preloaded into every process in it. Reaching outside the temp
 * roots now reaches the canary instead of the laptop, and says so: the run
 * fails on any access, naming the function, the path and the frame.
 *
 * The per-file half of this is `test/helpers/isolate.mjs`, which each test file
 * imports for a temp root of its own. The canary is the floor under that: it
 * catches the file that has not been isolated yet, including one added
 * tomorrow. Pass `--no-canary` to run without it.
 */
import { spawn } from 'node:child_process';
// The default import rather than named ones: `types/node.d.ts` is a
// hand-written stub and does not name every function used here.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string} dir @returns {string[]} */
function collect(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...collect(full));
    else if (name.endsWith('.test.mjs') || name.endsWith('.test.js')) out.push(full);
  }
  return out.sort();
}

const argv = process.argv.slice(2);
const explicit = argv.filter((a) => !a.startsWith('-'));
const flags = argv.filter((a) => a.startsWith('-') && a !== '--no-canary');
const canaryOn = !argv.includes('--no-canary');
const files = explicit.length ? explicit : collect(path.join(root, 'test'));

if (files.length === 0) {
  process.stderr.write('no test files found under test/\n');
  process.exit(1);
}

/**
 * The title on the canary transcript. If a test scans the canary home this
 * string ends up on a floor, in a snapshot, in a status line — so it is
 * deliberately unmistakable, and `test/integration/isolation-guard.test.mjs`
 * asserts it reaches none of those.
 */
const CANARY_TITLE = 'DECKHQ-CANARY-HOME-DO-NOT-READ';

/**
 * An empty machine with one transcript on it, somewhere the suite has no
 * business looking.
 *
 * @returns {{root:string, home:string, log:string, env:Record<string,string>}}
 */
function plantCanary() {
  const canaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-canary-'));
  const home = path.join(canaryRoot, 'home');
  const cwd = path.join(home, 'code', 'canary-project');
  const projects = path.join(home, '.claude', 'projects', cwd.replace(/[\\/:]+/g, '-'));
  fs.mkdirSync(projects, { recursive: true });

  const sessionId = 'cacacaca-caca-4aca-8aca-cacacacacaca';
  const at = (s) => new Date(Date.now() - 60_000 + s * 1000).toISOString();
  const lines = [
    { type: 'custom-title', customTitle: CANARY_TITLE, sessionId },
    {
      parentUuid: null,
      isSidechain: false,
      type: 'user',
      message: { role: 'user', content: [{ type: 'text', text: CANARY_TITLE }] },
      uuid: 'u1',
      timestamp: at(1),
      cwd,
      gitBranch: 'main',
      sessionId,
      version: '2.1.0',
    },
    {
      parentUuid: 'u1',
      isSidechain: false,
      type: 'assistant',
      message: {
        id: 'msg_a',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [{ type: 'text', text: CANARY_TITLE }],
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      uuid: 'a1',
      timestamp: at(2),
      cwd,
      gitBranch: 'main',
      sessionId,
    },
  ];
  fs.writeFileSync(
    path.join(projects, `${sessionId}.jsonl`),
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
    'utf8',
  );

  const log = path.join(canaryRoot, 'reads.jsonl');
  fs.writeFileSync(log, '', 'utf8');

  const preload = path.join(root, 'test', 'helpers', 'canary.cjs');
  const env = {
    // The home itself, and the two derivations of it the product makes that
    // do not go through `os.homedir()`.
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, 'AppData', 'Roaming'),
    DECKHQ_CANARY_HOME: home,
    DECKHQ_CANARY_LOG: log,
    DECKHQ_CANARY_TITLE: CANARY_TITLE,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require ${JSON.stringify(preload)}`]
      .filter(Boolean)
      .join(' '),
  };
  return { root: canaryRoot, home, log, env };
}

const canary = canaryOn ? plantCanary() : null;
const env = { ...process.env, ...(canary ? canary.env : {}) };
if (canary) {
  // Unset rather than pointed somewhere: each of these is derived from the
  // home when it is absent, so leaving them out is what puts the derivation
  // itself under the tripwire.
  delete env.CLAUDE_CONFIG_DIR;
  delete env.DECKHQ_STATE_DIR;
  delete env.DECKHQ_DESKTOP_SESSIONS_DIR;
  // Not a path, and not pinned to a value: `GET /api/about` is supposed to
  // report the machine's own name, and one test asserts exactly that. What is
  // removed is the developer's shell — an exported override must not decide
  // what the suite asserts.
  delete env.DECKHQ_HOSTNAME;
  delete env.DECKHQ_PORT;
  delete env.DECKHQ_DEBUG;
  delete env.DECKHQ_PERMISSION_HOLD_MS;
}

/** @returns {{count:number, lines:string[]}} what the run touched, if anything. */
function auditCanary() {
  if (!canary) return { count: 0, lines: [] };
  let raw = '';
  try {
    raw = fs.readFileSync(canary.log, 'utf8');
  } catch {
    return { count: 0, lines: [] };
  }
  const seen = new Map();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    const where =
      (rec.argv || []).find((a) => String(a).includes('.test.')) ||
      `${(rec.argv || []).join(' ').slice(0, 160)} | ${rec.frame}`;
    const key = `${where} :: ${rec.fn} :: ${rec.path}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return {
    count: raw.split('\n').filter((l) => l.trim()).length,
    lines: [...seen.entries()].map(([k, n]) => `  ${n}x  ${k}`),
  };
}

const child = spawn(process.execPath, ['--test', ...flags, ...files], {
  stdio: 'inherit',
  cwd: root,
  env,
});

child.on('exit', (code, signal) => {
  const verdict = signal ? 1 : (code ?? 1);
  const audit = auditCanary();
  if (canary) {
    try {
      fs.rmSync(canary.root, { recursive: true, force: true });
    } catch {
      // Temp directory; the OS gets it back either way.
    }
  }
  if (audit.count > 0) {
    process.stderr.write(
      `\nthe suite read outside its temp roots: ${audit.count} access(es) to the canary home.\n` +
        'a test that needs a home must import test/helpers/isolate.mjs first; ' +
        'docs/DEVIATIONS.md §123.\n' +
        audit.lines.join('\n') +
        '\n',
    );
    process.exit(1);
  }
  process.exit(verdict);
});
