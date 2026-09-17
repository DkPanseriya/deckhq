/**
 * The one-line installers — WP-75.
 *
 * `scripts/install/install.ps1` and `scripts/install/install.sh` are the only
 * two files in this repository a stranger is invited to pipe into a shell, and
 * they are the two nothing else in the suite covers: they are not imported by
 * the product, they are not in the npm tarball, and a syntax error in either
 * is discovered by the person running it rather than by CI.
 *
 * So: both are parsed by their own interpreter, and both are read for the
 * promises the site makes about them. **Neither is executed.** Running them
 * installs software on the machine running the suite, which is not a thing a
 * test may do; what is proved here is that they parse, that they ask before
 * they install, and that they reach no host but the three package managers.
 *
 * A machine with no `bash` and no PowerShell skips the parse and says so,
 * rather than passing quietly — the gap is reported, which is the same rule
 * `docs/plan/08-PLAN-V2-100X.md` §1.1 rule 11 applies to everything else here.
 */
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = path.join(ROOT, 'scripts', 'install');
const SH = path.join(DIR, 'install.sh');
const PS1 = path.join(DIR, 'install.ps1');

const sh = fs.readFileSync(SH, 'utf8');
const ps1 = fs.readFileSync(PS1, 'utf8');

/** Is this command runnable on this machine? */
function runnable(command, args) {
  try {
    const out = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
    return !out.error;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// They parse
// ---------------------------------------------------------------------------

test('install.sh parses', (t) => {
  if (!runnable('bash', ['-c', 'exit 0'])) {
    t.skip('no bash on this machine');
    return;
  }
  const out = spawnSync('bash', ['-n', SH], { encoding: 'utf8', windowsHide: true });
  assert.equal(out.status, 0, `bash -n rejected install.sh:\n${out.stderr}`);
});

test('install.ps1 parses, in the PowerShell the floor is set at', (t) => {
  // Windows PowerShell 5.1 on Windows; `pwsh` anywhere it is installed. The
  // parser is the language's own, so this is the real gate rather than a
  // regular expression pretending to be one.
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  if (!runnable(shell, ['-NoProfile', '-Command', 'exit 0'])) {
    t.skip(`no ${shell} on this machine`);
    return;
  }
  const script = [
    '$errs = $null; $toks = $null;',
    `[System.Management.Automation.Language.Parser]::ParseFile('${PS1.replace(/'/g, "''")}',`,
    '[ref] $toks, [ref] $errs) | Out-Null;',
    'if ($errs -and $errs.Count -gt 0) {',
    '  $errs | ForEach-Object { Write-Output "$($_.Extent.StartLineNumber): $($_.Message)" };',
    '  exit 1',
    '}',
    'exit 0',
  ].join(' ');
  const out = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    windowsHide: true,
  });
  assert.equal(out.status, 0, `the PowerShell parser rejected install.ps1:\n${out.stdout}`);
});

// ---------------------------------------------------------------------------
// What they promise
// ---------------------------------------------------------------------------

test('install.ps1 is Windows PowerShell 5.1, not 7', () => {
  // 5.1 is what a Windows machine has before anybody installs anything, so it
  // is the floor. Each of these is a parse error there, and `pwsh` would
  // accept every one of them — which is exactly how this regresses.
  const forbidden = [
    [/&&/, '`&&` — a pipeline chain operator, and 7 only'],
    [/\|\|/, '`||` — the same'],
    [/\?\?/, '`??` — null-coalescing, 7 only'],
    [/\$\w+\?\./, '`?.` — null-conditional, 7 only'],
  ];
  // The comment block at the top names each of them in order to forbid it, so
  // it is not part of what is scanned.
  const code = ps1.replace(/<#[\s\S]*?#>/g, '');
  for (const [pattern, why] of forbidden) {
    assert.ok(!pattern.test(code), `install.ps1 carries ${why}`);
  }

  // A `param()` block as the script's FIRST statement is the one that breaks
  // `irm … | iex`: the script arrives as a string, and a param block is not
  // allowed at the top of one. A `param()` inside a function is ordinary and
  // every function here has one.
  const first = code.split('\n').find((line) => line.trim() !== '') || '';
  assert.ok(
    !/^\s*param\s*\(/i.test(first),
    'install.ps1 opens with a param() block, which `iex` cannot run',
  );
});

test('install.sh is POSIX sh: no bashism in the shebang, and no `local`', () => {
  assert.match(sh, /^#!\/bin\/sh\n/, 'the shebang is not /bin/sh');
  assert.ok(!/\blocal\s+\w+=/.test(sh), '`local` is not in POSIX sh');
  assert.ok(!/\[\[/.test(sh), '`[[` is not in POSIX sh');
  assert.ok(!/\bfunction\s+\w+\s*\(/.test(sh), '`function name()` is not in POSIX sh');
});

test('SECURITY: neither installer reaches a host that is not a package manager', () => {
  // Every absolute URL in either file, and where each one is allowed to point.
  // `nodejs.org` and `brew.sh` are printed for a human to visit; nothing here
  // fetches either. Anything else is a host this project did not agree to.
  const allowed = new Set(['nodejs.org', 'brew.sh', 'dkpanseriya.github.io']);
  for (const [name, text] of [
    ['install.sh', sh],
    ['install.ps1', ps1],
  ]) {
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = m[1].toLowerCase();
      assert.ok(allowed.has(host), `${name} names ${host}`);
    }
    assert.ok(
      !/curl\s+[^\n]*\|\s*(sudo\s+)?(ba)?sh/.test(text.replace(/^#.*$/gm, '')),
      `${name} pipes something else into a shell`,
    );
  }
});

test('SECURITY: neither installer installs anything without asking', () => {
  // The package itself is what the user ran the script for, so it goes in.
  // Node is a second program on their machine, and the shortcut writes files
  // in shared folders: both are behind the question.
  assert.match(sh, /ask 'Install Node with/);
  assert.match(sh, /ask 'Put DeckHQ on your Desktop/);
  assert.match(ps1, /Read-YesNo 'Install Node with/);
  assert.match(ps1, /Read-YesNo 'Put DeckHQ on your Desktop/);

  // And the no-terminal branch: a run with nobody to ask answers no.
  assert.match(sh, /if \[ ! -r \/dev\/tty \]/, 'install.sh asks on stdin, which is the script');
  assert.match(ps1, /UserInteractive/, 'install.ps1 would prompt a session with no console');
});

test('both installers are idempotent by construction: nothing is deleted or overwritten', () => {
  for (const [name, text] of [
    ['install.sh', sh],
    ['install.ps1', ps1],
  ]) {
    const code = text.replace(/^\s*#.*$/gm, '').replace(/<#[\s\S]*?#>/g, '');
    assert.ok(!/\brm\s+-rf\b/.test(code), `${name} removes a tree`);
    assert.ok(!/Remove-Item/.test(code), `${name} removes something`);
    assert.ok(!/\bsudo\s+(rm|mv|cp)\b/.test(code), `${name} moves files about as root`);
  }
});

// ---------------------------------------------------------------------------
// The double-click launchers — WP-76
// ---------------------------------------------------------------------------

/**
 * `Install-DeckHQ.cmd` and `Install-DeckHQ.command` are the two files a person
 * downloads from the Release page and double-clicks. Each one carries the
 * matching one-liner and nothing else, so there is exactly one installer per
 * platform and the launcher cannot drift away from it.
 */
const CMD = path.join(DIR, 'Install-DeckHQ.cmd');
const COMMAND = path.join(DIR, 'Install-DeckHQ.command');

test('both double-click launchers exist', () => {
  assert.ok(fs.existsSync(CMD), 'scripts/install/Install-DeckHQ.cmd is missing');
  assert.ok(fs.existsSync(COMMAND), 'scripts/install/Install-DeckHQ.command is missing');
});

test('SECURITY: a launcher reaches the Pages origin and no other host', () => {
  // A file a stranger runs by double-clicking it, with no shell in front of
  // them to read it in. The only URL either may name is the one the README and
  // the site already print.
  for (const [name, file] of [
    ['Install-DeckHQ.cmd', CMD],
    ['Install-DeckHQ.command', COMMAND],
  ]) {
    const text = fs.readFileSync(file, 'utf8');
    const hosts = [...text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase());
    assert.ok(hosts.length > 0, `${name} names no URL at all`);
    for (const host of hosts) {
      assert.equal(host, 'dkpanseriya.github.io', `${name} names ${host}`);
    }
  }

  assert.match(
    fs.readFileSync(CMD, 'utf8'),
    /irm https:\/\/dkpanseriya\.github\.io\/deckhq\/install\.ps1 \| iex/,
    'Install-DeckHQ.cmd does not run the published PowerShell installer',
  );
  assert.match(
    fs.readFileSync(COMMAND, 'utf8'),
    /curl -fsSL https:\/\/dkpanseriya\.github\.io\/deckhq\/install\.sh \| sh/,
    'Install-DeckHQ.command does not run the published shell installer',
  );
});

test('Install-DeckHQ.cmd is CRLF, and waits before the window closes', () => {
  // `cmd.exe` reads a `.cmd` line by line and a lone LF ending can leave a
  // trailing character on the last token of a line. `.gitattributes` carries
  // `*.cmd text eol=crlf`, so this holds on a Linux checkout too — which is
  // where the release job packs it.
  const bytes = fs.readFileSync(CMD);
  const text = bytes.toString('utf8');
  const lf = (text.match(/\n/g) ?? []).length;
  const crlf = (text.match(/\r\n/g) ?? []).length;
  assert.equal(crlf, lf, `Install-DeckHQ.cmd has ${lf - crlf} bare LF line ending(s)`);
  assert.match(text, /^@echo off\r\n/, 'Install-DeckHQ.cmd does not open with @echo off');
  // Double-clicked, the window disappears on the last line and takes the
  // installer's own output with it.
  assert.match(text, /\r\npause\r?\n?$/, 'Install-DeckHQ.cmd does not pause at the end');
});

test('Install-DeckHQ.command is executable in git, or macOS will not run it', (t) => {
  // The download from a Release keeps the mode the tar carried; a 100644 here
  // means a double-click on macOS opens the file in a text editor instead.
  const out = spawnSync('git', ['ls-files', '-s', '--', 'scripts/install/Install-DeckHQ.command'], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });
  if (out.error || out.status !== 0 || !out.stdout.trim()) {
    t.skip('no git, or the file is not tracked yet');
    return;
  }
  assert.match(
    out.stdout,
    /^100755 /,
    `Install-DeckHQ.command is ${out.stdout.split(' ')[0]}; run \`git update-index --chmod=+x\``,
  );
});

test('each launcher says, in words, what it is about to do', () => {
  // The person running this one has no terminal open and did not read a README
  // to get here. The first thing the window prints is a sentence.
  assert.match(fs.readFileSync(CMD, 'utf8'), /^echo DeckHQ: this installs DeckHQ/m);
  assert.match(fs.readFileSync(COMMAND, 'utf8'), /^echo "DeckHQ: this installs DeckHQ/m);
});

test('neither installer is in the npm tarball', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(
    !pkg.files.some((entry) => String(entry).replace(/^!/, '').startsWith('scripts')),
    'package.json ships `scripts/`, so the installers would be inside the package they install',
  );
});
