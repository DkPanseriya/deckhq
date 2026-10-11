/**
 * DeckHQ for Windows — the shell's source, and the workflow that builds it.
 *
 * `DeckHQ.exe` is C#, and nothing here compiles it. What is held is what can
 * be read: that the shell has no way to reach the network of its own, that it
 * stays inside the language the Framework's compiler speaks, and that the
 * three lines of CLI output it reads are the lines the CLI really prints —
 * the shell does not rediscover a running daemon, it asks `deckhq app`, so a
 * reworded message there would otherwise break the app in silence.
 */
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => fs.readFileSync(path.join(REPO, ...parts), 'utf8');

const { cscArgs, fourPartVersion, assemblyInfo, shellSources } =
  await import('../../app/windows/build-shell.mjs');
const { runApp } = await import('../../src/cli/app.mjs');
const { DeckhqAlreadyRunningError } = await import('../../src/daemon.mjs');

const sources = shellSources().map((file) => ({
  name: path.basename(file),
  text: fs.readFileSync(file, 'utf8'),
}));
const source = (name) => sources.find((s) => s.name === name).text;

/** A `const string Name = @"...";` out of the C#, as a JavaScript RegExp. */
function pattern(name) {
  const m = new RegExp(`const string ${name} = @"([^"]+)";`).exec(source('Daemon.cs'));
  assert.ok(m, `Daemon.cs has no ${name}`);
  return new RegExp(m[1], 'm');
}

test('SECURITY: the shell has no network code of its own', () => {
  assert.ok(sources.length >= 5);
  for (const { name, text } of sources) {
    for (const banned of [
      /System\.Net/,
      /HttpClient/,
      /WebClient/,
      /WebRequest/,
      /socket/i,
      /TcpClient/,
      /TcpListener/,
      /UdpClient/,
      /\bDns\./,
      /NamedPipe/,
      /ws2_32|winhttp|wininet|urlmon/i,
    ]) {
      assert.ok(!banned.test(text), `${name} must not use ${banned}`);
    }
  }
  const args = cscArgs({ out: 'o.exe', icon: 'i.ico', info: 'a.cs', webview2: 'wv2', sources: [] });
  const references = args.filter((a) => a.startsWith('/r:')).map((a) => path.basename(a.slice(3)));
  assert.deepEqual(references, [
    'System.dll',
    'System.Core.dll',
    'System.Drawing.dll',
    'System.Windows.Forms.dll',
    'Microsoft.Web.WebView2.Core.dll',
    'Microsoft.Web.WebView2.WinForms.dll',
  ]);
});

test('the shell is C# 5, the language of the compiler that ships with Windows', () => {
  const args = cscArgs({ out: 'o.exe', icon: 'i.ico', info: 'a.cs', webview2: 'wv2', sources: [] });
  assert.ok(args.includes('/langversion:5') && args.includes('/target:winexe'));
  assert.ok(args.includes('/platform:anycpu'), 'one exe, native on x64 and on ARM64');
  for (const { name, text } of sources) {
    // The code only: prose in a comment is allowed to say "is not".
    const code = text.replace(/^\s*\/\/.*$/gm, '');
    for (const later of [
      /(?:^|[\s(,=+])\$@?"/m,
      /\?\./,
      /\?\[/,
      /\bnameof\(/,
      /\bout var\b/,
      /\bis not\b/,
      /\bwhen \(/,
    ]) {
      assert.ok(!later.test(code), `${name} uses ${later}, which is newer than C# 5`);
    }
  }
  assert.equal(fourPartVersion('1.7.1'), '1.7.1.0');
  assert.equal(fourPartVersion('2.0.0-rc.1'), '2.0.0.0');
  assert.match(assemblyInfo('1.7.1'), /AssemblyCompany\("DeckHQ"\)/);
  assert.match(assemblyInfo('1.7.1'), /Copyright \(c\) Darshak Panseriya/);
});

test('the shell reads the lines the CLI really prints', async () => {
  // 1. `deckhq app --dry-run`, with a daemon found and with none.
  const say = async (find) => {
    let out = '';
    const code = await runApp(['--dry-run', '--no-window'], {
      find,
      write: (s) => (out += s),
      error: (s) => (out += s),
      findBrowser: () => null,
    });
    assert.equal(code, 0);
    return out;
  };
  const found = await say(async () => ({ port: 4400, url: 'http://127.0.0.1:4400/' }));
  assert.equal(pattern('ReusedPattern').exec(found)[1], 'http://127.0.0.1:4400/');
  assert.equal(pattern('ReusedPattern').test(await say(async () => null)), false);

  // 2. The daemon's first line, and its "already running" line (bin/deckhq.mjs).
  const bin = read('bin', 'deckhq.mjs');
  assert.ok(bin.includes('process.stdout.write(`\\n  DeckHQ  ${url}\\n\\n`)'));
  assert.equal(
    pattern('ListeningPattern').exec('  DeckHQ  http://127.0.0.1:4318/')[1],
    'http://127.0.0.1:4318/',
  );
  assert.ok(bin.includes('DeckHQ is already running at ${err.url}'));
  const already = new DeckhqAlreadyRunningError(4317, 'Claude Code');
  const line = `  DeckHQ is already running at ${already.url} — the installed Claude Code hooks post there.`;
  assert.equal(pattern('AlreadyPattern').exec(line)[1], 'http://127.0.0.1:4317/');
  assert.equal(pattern('ListeningPattern').test(line), false, 'one is never read as the other');
  assert.equal(pattern('ListeningPattern').test('  DeckHQ  http://example.com:80/'), false);

  // 3. The flags the shell passes exist.
  let help = '';
  await runApp(['--help'], { write: (s) => (help += s) });
  for (const flag of ['--dry-run', '--no-window', '--no-pin', '--port'])
    assert.ok(help.includes(flag), flag);
  assert.ok(source('Daemon.cs').includes('"app --dry-run --no-window"'));
  assert.ok(source('Daemon.cs').includes('"--no-open"') && bin.includes("flag('--no-open')"));
  assert.ok(source('Program.cs').includes('app --no-pin'));
});

test('the window keeps to 127.0.0.1, and its profile is under %LOCALAPPDATA%\\DeckHQ', () => {
  const rules = source('MainForm.Rules.cs');
  assert.ok(
    rules.includes('uri.Scheme == "http" && uri.Host == "127.0.0.1" && uri.Port == home.Port'),
  );
  assert.match(
    rules,
    /NavigationStarting[\s\S]{0,200}if \(IsHome\(e\.Uri\)\) return;\s+e\.Cancel = true;/,
  );
  assert.match(rules, /NewWindowRequested[\s\S]{0,160}e\.Handled = true;/);
  assert.ok(rules.includes('if (uri.Scheme != "http" && uri.Scheme != "https") return;'));

  const paths = source('Paths.cs');
  assert.ok(paths.includes('return Path.Combine(root, "DeckHQ");'));
  assert.ok(paths.includes('Path.Combine(DataDir, "WebView2")'));
  const browser = source('Browser.cs');
  assert.ok(
    browser.includes('CoreWebView2Environment.CreateAsync(null, Paths.WebViewData, environment)'),
  );
  assert.ok(browser.includes('IsReputationCheckingRequired = false'));
  assert.ok(browser.includes('IsCustomCrashReportingEnabled = true'));
  // What the README says is switched off is what the source switches off.
  const readme = read('app', 'windows', 'README.md');
  const switches = /public const string Arguments =([\s\S]*?);/
    .exec(browser)[1]
    .match(/--[a-z-]+(=[A-Za-z]+)?/g);
  assert.ok(switches.length >= 8);
  for (const s of switches) assert.ok(readme.includes(s), `README.md does not list ${s}`);
});

test('the workflow builds on windows-2022, publishes nothing, and downloads nothing itself', () => {
  const yml = read('.github', 'workflows', 'app-windows.yml');
  assert.ok(!yml.includes('\t'), 'YAML takes no tabs');
  const top = yml
    .split(/\r?\n/)
    .filter((l) => /^[A-Za-z]/.test(l))
    .map((l) => l.split(':')[0]);
  assert.deepEqual(top, ['name', 'on', 'permissions', 'jobs']);
  assert.match(yml, /^on:\n {2}workflow_dispatch:\n {2}workflow_call:\n/m);
  assert.match(yml, /^permissions:\n {2}contents: read\n/m);
  assert.ok(!/contents: write|id-token|npm publish|gh release/.test(yml));
  // Pinned: `windows-latest` became an image without NSIS, and the first
  // build that got as far as the installer stopped there.
  assert.match(yml, /runs-on: windows-2022/);

  const steps = yml
    .split(/\r?\n/)
    .filter((l) => !l.trim().startsWith('#'))
    .join('\n');
  for (const script of ['fetch-webview2.mjs', 'fetch-node.mjs', 'build-shell.mjs', 'build.mjs']) {
    assert.ok(steps.includes(`run: node app/windows/${script}`), script);
  }
  // Every byte that arrives comes through the two fetch scripts and their pins.
  for (const fetcher of [
    /https?:\/\//,
    /\bcurl\b/,
    /Invoke-WebRequest|Invoke-RestMethod|\biwr\b|\birm\b/i,
    /\bwget\b/,
    /\bchoco\b/,
    /\bwinget\b/,
    /\bnuget\b/i,
    /npm (install|i|ci)\b/,
    /--local-node/,
  ]) {
    assert.ok(!fetcher.test(steps), `the workflow must not use ${fetcher}`);
  }
  assert.deepEqual([...new Set(steps.match(/uses: \S+/g))].sort(), [
    'uses: actions/checkout@v4',
    'uses: actions/setup-node@v4',
    'uses: actions/upload-artifact@v4',
  ]);
  assert.ok(steps.includes('makensis') && steps.includes('app\\windows\\installer.nsi'));
  assert.ok(steps.includes('Get-FileHash') && steps.includes('SHA256'));
  assert.ok(
    !read('.github', 'workflows', 'publish.yml').includes('app-windows'),
    'not wired to a release yet',
  );
});

test('no file of the app is over the 900-line ceiling', () => {
  const dir = path.join(REPO, 'app', 'windows');
  const walk = (d) =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const file of walk(dir)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n').length;
    assert.ok(lines <= 900, `${path.relative(REPO, file)} is ${lines} lines`);
  }
});
