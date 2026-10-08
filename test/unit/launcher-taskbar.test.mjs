/**
 * The taskbar pin: a pinned DeckHQ window keeps the DeckHQ icon.
 *
 * Windows draws a pin of a window from the shortcut that carries the window's
 * AppUserModelID. `src/core/launcher-taskbar.mjs` reads that id off the app
 * window and writes it into the shortcuts this package wrote — and into
 * nothing else, which is most of what is held here:
 *
 *   - the decision per shortcut is pure, and every branch is asserted;
 *   - a shortcut that is not recorded, or has lost the tag, is never in the
 *     list handed to the script;
 *   - no value travels on a command line;
 *   - when the record says the work is done, nothing is run at all.
 *
 * The ids used below are the ones measured on Windows 11 with Chrome 154 and
 * Edge 154. The last test runs the real script, on Windows only, against a
 * shortcut inside the isolated root.
 */
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const { scratchDir } = await import('../helpers/isolate.mjs');
const { TAG, description } = await import('../../src/core/launcher.mjs');
const { createShortcut, readAppFlags, writeRecord } =
  await import('../../src/core/launcher-apply.mjs');
const {
  TASKBAR_FLAG,
  TASKBAR_SCRIPT,
  describeMatch,
  describeTaskbar,
  matchAppWindow,
  matchTaskbar,
  ourShortcutPaths,
  pickAppWindow,
  runTaskbarScript,
  stampDecision,
  taskbarCommand,
  taskbarFingerprint,
  taskbarState,
} = await import('../../src/core/launcher-taskbar.mjs');
const { runApp } = await import('../../src/cli/app.mjs');
const { runInstaller } = await import('../../src/cli/shortcut.mjs');
const { readTaskbar } = await import('../../src/cli/doctor-collect.mjs');
const { renderReport } = await import('../../src/cli/doctor-report.mjs');

/** Measured: what Chrome and Edge call `--app=http://127.0.0.1:<port>/`. */
const CHROME_ID = 'Chrome.127.0.0.1_/.appprofile.Default';
const EDGE_ID = 'MSEdge.127.0.0.1_/.appprofile.Default';
const URL_APP = 'http://127.0.0.1:4317/';

/**
 * A state dir with two recorded shortcuts on disk. The files are placeholders:
 * everything that reads a real `.lnk` is injected, except in the last test.
 */
function installed(prefix = 'taskbar-') {
  const dir = scratchDir(prefix);
  const dataDir = path.join(dir, 'state');
  const desktop = path.join(dir, 'Desktop', 'DeckHQ.lnk');
  const menu = path.join(dir, 'Programs', 'DeckHQ.lnk');
  for (const p of [desktop, menu]) {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, 'placeholder');
  }
  writeRecord(
    'shortcut',
    [
      { path: desktop, proof: 'lnk' },
      { path: menu, proof: 'lnk' },
    ],
    { dataDir },
  );
  const opts = {
    dataDir,
    platform: 'win32',
    browser: path.join(dir, 'chrome.exe'),
    profileDir: path.join(dataDir, 'app-profile'),
    url: URL_APP,
  };
  return { dir, dataDir, desktop, menu, opts };
}

/** What the script says about a shortcut. */
const link = (p, aumid, desc = description('DeckHQ')) => ({
  path: p,
  aumid,
  description: desc,
});

/** A stand-in for the script that records every run. */
function fakeScript(look, calls = []) {
  const run = async (action, spec) => {
    calls.push({ action, spec });
    if (action === 'look') return look;
    return spec.paths.map((p) => link(p, spec.aumid));
  };
  return { run, calls };
}

// ---------------------------------------------------------------------------
// The script
// ---------------------------------------------------------------------------

test('taskbar.ps1 parses', (t) => {
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const probe = spawnSync(shell, ['-NoProfile', '-Command', 'exit 0'], { windowsHide: true });
  if (probe.error) {
    t.skip(`no ${shell} on this machine`);
    return;
  }
  const script = [
    '$errs = $null; $toks = $null;',
    `[System.Management.Automation.Language.Parser]::ParseFile('${TASKBAR_SCRIPT.replace(/'/g, "''")}',`,
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
  assert.equal(out.status, 0, `the PowerShell parser rejected taskbar.ps1:\n${out.stdout}`);
});

test('taskbar.ps1 writes one property, and only to a shortcut that carries the tag', () => {
  const text = fs.readFileSync(TASKBAR_SCRIPT, 'utf8');
  // The property key Windows documents for System.AppUserModel.ID.
  assert.match(text, /9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3/);
  // One SetValue in the whole script, and the tag is checked before it.
  assert.equal(text.match(/\.SetValue\(/g).length, 1);
  assert.ok(text.indexOf('not a shortcut DeckHQ wrote') < text.indexOf('.SetValue('));
  // It takes values from a spec file and never builds a command from one.
  assert.doesNotMatch(text, /Invoke-Expression|\biex\b|Start-Process|Remove-Item/);
});

test('the script runs with -File and named parameters: the exact argv', () => {
  assert.deepEqual(taskbarCommand('look', 'C:/state/taskbar-1.json'), {
    command: 'powershell.exe',
    args: [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      TASKBAR_SCRIPT,
      '-Action',
      'look',
      '-SpecFile',
      'C:/state/taskbar-1.json',
    ],
  });
  assert.equal(taskbarCommand('stamp', 'x', 'pwsh').command, 'pwsh');
  assert.ok(!taskbarCommand('stamp', 'x').args.includes('-Command'));
});

test('SECURITY: every value travels in a spec file under the state dir, never on the command line', async () => {
  const dataDir = path.join(scratchDir('taskbar-spec-'), 'state');
  const hostile = 'C:\\Users\\a "b" `c` $(calc)\\app-profile';
  let seen = null;
  const exec = (command, args, _options, done) => {
    const specFile = args[args.indexOf('-SpecFile') + 1];
    seen = { command, args, specFile, spec: JSON.parse(fs.readFileSync(specFile, 'utf8')) };
    done(null, '{"windows":[],"links":[]}', '');
  };
  const out = await runTaskbarScript(
    'look',
    { profileDir: hostile, waitMs: 0, paths: [] },
    { dataDir, exec },
  );
  assert.deepEqual(out, { windows: [], links: [] });
  assert.deepEqual(seen.args, taskbarCommand('look', seen.specFile).args);
  assert.equal(seen.spec.profileDir, hostile);
  assert.ok(!seen.args.join(' ').includes('calc'), 'the value is not on the command line');
  assert.equal(path.dirname(seen.specFile), dataDir);
  assert.equal(fs.existsSync(seen.specFile), false, 'the spec file is deleted afterwards');
});

test('a script that fails reports its own reason, and still leaves no spec file behind', async () => {
  const dataDir = path.join(scratchDir('taskbar-fail-'), 'state');
  const exec = (_c, _a, _o, done) => done(new Error('exit 1'), '', 'not a shortcut DeckHQ wrote\n');
  await assert.rejects(
    runTaskbarScript('stamp', { paths: [] }, { dataDir, exec }),
    /not a shortcut DeckHQ wrote/,
  );
  assert.deepEqual(
    fs.readdirSync(dataDir).filter((f) => f.startsWith('taskbar-')),
    [],
  );
});

// ---------------------------------------------------------------------------
// The decisions
// ---------------------------------------------------------------------------

test('the app window is the one whose id names the host, in either browser', () => {
  const ordinary = { aumid: 'Chrome.UserData.Default', title: 'New Tab' };
  assert.equal(
    pickAppWindow([ordinary, { aumid: CHROME_ID, title: 'DeckHQ' }], URL_APP).aumid,
    CHROME_ID,
  );
  assert.equal(pickAppWindow([{ aumid: EDGE_ID }], 'http://127.0.0.1:50954/').aumid, EDGE_ID);
  // No window carrying the host is no answer, not the nearest one.
  assert.equal(pickAppWindow([ordinary, { aumid: null }, {}], URL_APP), null);
  assert.equal(pickAppWindow([], URL_APP), null);
  assert.equal(pickAppWindow(undefined, URL_APP), null);
  assert.equal(pickAppWindow([{ aumid: CHROME_ID }], 'not a url'), null);
});

test('stampDecision: ours and different is rewritten, ours and the same is left, not ours is refused', () => {
  const ours = { recorded: true, description: description('DeckHQ') };
  assert.equal(stampDecision({ ...ours, current: null, wanted: CHROME_ID }), 'rewrite');
  assert.equal(stampDecision({ ...ours, current: EDGE_ID, wanted: CHROME_ID }), 'rewrite');
  assert.equal(stampDecision({ ...ours, current: CHROME_ID, wanted: CHROME_ID }), 'same');
  // No window id to compare with: nothing is decided, so nothing is written.
  assert.equal(stampDecision({ ...ours, current: null, wanted: null }), 'unknown');

  // Not ours, in each of the ways a file can fail to be ours.
  const wanted = CHROME_ID;
  assert.equal(stampDecision({ ...ours, recorded: false, wanted }), 'refuse');
  assert.equal(stampDecision({ recorded: true, description: 'DeckHQ', wanted }), 'refuse');
  assert.equal(stampDecision({ recorded: true, description: null, wanted }), 'refuse');
  assert.equal(stampDecision({ recorded: true, wanted }), 'refuse');
  // Refusal comes first: a file that is not ours is refused even when its id
  // already matches, so it is never counted as one of our shortcuts.
  assert.equal(
    stampDecision({ recorded: false, description: 'x', current: wanted, wanted }),
    'refuse',
  );
});

test('the fingerprint follows the browser, the profile folder and the shortcut files', () => {
  const stats = { 'C:/chrome.exe': { mtimeMs: 10, size: 1 }, 'C:/a.lnk': { mtimeMs: 20, size: 2 } };
  const stat = (over = {}) => {
    const all = { ...stats, ...over };
    return (p) => all[p] || null;
  };
  const what = { browser: 'C:/chrome.exe', profileDir: 'C:/s/app-profile', paths: ['C:/a.lnk'] };
  const base = taskbarFingerprint(what, stat());
  assert.match(base, /^[0-9a-f]{24}$/);
  assert.equal(taskbarFingerprint(what, stat()), base);
  assert.notEqual(taskbarFingerprint({ ...what, browser: 'C:/msedge.exe' }, stat()), base);
  assert.notEqual(taskbarFingerprint({ ...what, profileDir: 'D:/s/app-profile' }, stat()), base);
  // The browser was updated; the shortcut was rewritten.
  assert.notEqual(
    taskbarFingerprint(what, stat({ 'C:/chrome.exe': { mtimeMs: 11, size: 1 } })),
    base,
  );
  assert.notEqual(taskbarFingerprint(what, stat({ 'C:/a.lnk': { mtimeMs: 21, size: 2 } })), base);
  assert.notEqual(taskbarFingerprint(what, stat({ 'C:/a.lnk': null })), base);
  // The order the record lists them in is not part of it.
  const two = { ...what, paths: ['C:/a.lnk', 'C:/b.lnk'] };
  assert.equal(
    taskbarFingerprint(two, stat()),
    taskbarFingerprint({ ...two, paths: ['C:/b.lnk', 'C:/a.lnk'] }, stat()),
  );
});

// ---------------------------------------------------------------------------
// The match
// ---------------------------------------------------------------------------

test('only the recorded .lnk files that are still on disk are ours to look at', () => {
  const { dataDir, desktop, menu } = installed('taskbar-ours-');
  assert.deepEqual(ourShortcutPaths(dataDir), [desktop, menu]);
  fs.unlinkSync(desktop);
  assert.deepEqual(ourShortcutPaths(dataDir), [menu]);
  // The Startup entry belongs to `autostart`, and the icon is not a shortcut.
  writeRecord('autostart', [{ path: menu, proof: 'lnk' }], { dataDir });
  writeRecord('shortcut', [{ path: menu, proof: 'statedir' }], { dataDir });
  assert.deepEqual(ourShortcutPaths(dataDir), []);
});

test('a shortcut with no id gets the id the window has, and that is recorded', async () => {
  const { dataDir, desktop, menu, opts } = installed();
  const { run, calls } = fakeScript({
    windows: [{ aumid: 'Chrome.UserData.Default' }, { aumid: CHROME_ID }],
    links: [link(desktop, null), link(menu, null)],
  });

  const result = await matchTaskbar({ ...opts, waitMs: 8000 }, { run, now: 42 });

  assert.equal(result.state, 'matched');
  assert.equal(result.aumid, CHROME_ID);
  assert.deepEqual(result.stamped, [desktop, menu]);
  assert.deepEqual(result.refused, []);
  // One look, one stamp; the stamp carries the tag and exactly those paths.
  assert.deepEqual(calls, [
    { action: 'look', spec: { profileDir: opts.profileDir, waitMs: 8000, paths: [desktop, menu] } },
    { action: 'stamp', spec: { paths: [desktop, menu], aumid: CHROME_ID, tag: TAG } },
  ]);
  const flag = readAppFlags(dataDir)[TASKBAR_FLAG];
  assert.equal(flag.aumid, CHROME_ID);
  assert.equal(flag.at, 42);
  assert.deepEqual(flag.paths, [desktop, menu]);
  assert.equal(taskbarState(opts).state, 'matched');
  // The note names every path that was written, and what to do about an old pin.
  const note = describeMatch(result);
  assert.ok(note.includes(`    ${desktop}\n`) && note.includes(`    ${menu}\n`));
  assert.match(note, /unpin it, and pin the window again, once/);
});

test('SECURITY: a shortcut that has lost the tag is never handed to the script', async () => {
  const { dataDir, desktop, menu, opts } = installed('taskbar-foreign-');
  // Somebody replaced the Desktop shortcut with their own.
  const { run, calls } = fakeScript({
    windows: [{ aumid: CHROME_ID }],
    links: [link(desktop, null, 'My own DeckHQ'), link(menu, null)],
  });

  const result = await matchTaskbar(opts, { run });

  assert.deepEqual(result.refused, [desktop]);
  assert.deepEqual(result.stamped, [menu]);
  assert.deepEqual(calls[1].spec.paths, [menu]);
  assert.deepEqual(readAppFlags(dataDir)[TASKBAR_FLAG].paths, [menu]);

  // And one the script could not read at all is refused the same way.
  const blind = fakeScript({ windows: [{ aumid: CHROME_ID }], links: [] });
  const none = await matchTaskbar({ ...opts, force: true }, { run: blind.run });
  assert.deepEqual(none.refused, [desktop, menu]);
  assert.equal(none.state, 'no-shortcut');
  assert.equal(blind.calls.length, 1, 'no stamp was run');
});

test('a shortcut that already carries the id is not written again', async () => {
  const { desktop, menu, opts } = installed('taskbar-same-');
  const { run, calls } = fakeScript({
    windows: [{ aumid: EDGE_ID }],
    links: [link(desktop, EDGE_ID), link(menu, EDGE_ID)],
  });
  const result = await matchTaskbar(opts, { run });
  assert.equal(result.state, 'matched');
  assert.deepEqual(result.same, [desktop, menu]);
  assert.deepEqual(
    calls.map((c) => c.action),
    ['look'],
  );
  assert.equal(describeMatch(result), '', 'nothing changed, so nothing is said');
});

test('once matched, an ordinary launch runs nothing — until something it depends on changes', async () => {
  const { desktop, menu, opts } = installed('taskbar-fast-');
  const first = fakeScript({
    windows: [{ aumid: CHROME_ID }],
    links: [link(desktop, null), link(menu, null)],
  });
  await matchTaskbar(opts, { run: first.run });

  const never = async () => assert.fail('the script must not run when nothing has changed');
  const again = await matchTaskbar(opts, { run: never });
  assert.deepEqual(
    { state: again.state, checked: again.checked, aumid: again.aumid },
    { state: 'matched', checked: false, aumid: CHROME_ID },
  );
  assert.equal(describeMatch(again), '');

  // The browser changed: the id was measured to start with its name.
  const edge = fakeScript({
    windows: [{ aumid: EDGE_ID }],
    links: [link(desktop, CHROME_ID), link(menu, CHROME_ID)],
  });
  const moved = { ...opts, browser: path.join(path.dirname(opts.browser), 'msedge.exe') };
  assert.equal(taskbarState(moved).state, 'stale');
  const healed = await matchTaskbar(moved, { run: edge.run });
  assert.deepEqual(healed.stamped, [desktop, menu]);
  assert.equal(edge.calls[1].spec.aumid, EDGE_ID);
  assert.equal(taskbarState(moved).state, 'matched');
});

test('with no window open nothing is written, and the note says what will happen', async () => {
  const { dataDir, desktop, menu, opts } = installed('taskbar-nowindow-');
  const { run, calls } = fakeScript({
    windows: [],
    links: [link(desktop, null), link(menu, null)],
  });
  const result = await matchTaskbar({ ...opts, force: true }, { run });
  assert.equal(result.state, 'no-window');
  assert.equal(calls.length, 1);
  assert.equal(readAppFlags(dataDir)[TASKBAR_FLAG], undefined);
  assert.equal(taskbarState(opts).state, 'unmatched');
  assert.match(describeMatch(result), /no DeckHQ window is open/);
  assert.match(describeMatch(result), /`deckhq app` sets that/);
});

test('an id is never written from memory: no window, one shortcut without it, nothing stamped', async () => {
  const { desktop, menu, opts } = installed('taskbar-memory-');
  const first = fakeScript({
    windows: [{ aumid: CHROME_ID }],
    links: [link(desktop, null), link(menu, null)],
  });
  await matchTaskbar(opts, { run: first.run });

  // Reinstalled with no window open: both still carry the id (measured — a
  // rewrite through WScript.Shell keeps it), so the record is simply renewed.
  const kept = fakeScript({
    windows: [],
    links: [link(desktop, CHROME_ID), link(menu, CHROME_ID)],
  });
  const renewed = await matchTaskbar({ ...opts, force: true }, { run: kept.run });
  assert.equal(renewed.state, 'matched');
  assert.equal(kept.calls.length, 1);

  // One of them lost it. There is no window to read, so it is not put back.
  const lost = fakeScript({ windows: [], links: [link(desktop, null), link(menu, CHROME_ID)] });
  const waiting = await matchTaskbar({ ...opts, force: true }, { run: lost.run });
  assert.equal(waiting.state, 'no-window');
  assert.equal(lost.calls.length, 1, 'no stamp was run');
});

test('a stamp that does not read back is not counted as done', async () => {
  const { dataDir, desktop, menu, opts } = installed('taskbar-readback-');
  const run = async (action, spec) =>
    action === 'look'
      ? { windows: [{ aumid: CHROME_ID }], links: [link(desktop, null), link(menu, null)] }
      : [link(spec.paths[0], spec.aumid), link(spec.paths[1], 'something else')];
  const result = await matchTaskbar(opts, { run });
  assert.deepEqual(result.stamped, [desktop]);
  assert.deepEqual(readAppFlags(dataDir)[TASKBAR_FLAG].paths, [desktop]);
});

test('off Windows, and with no shortcut of ours, nothing is run', async () => {
  const { opts } = installed('taskbar-posix-');
  const never = async () => assert.fail('nothing may be run');
  for (const platform of ['linux', 'darwin']) {
    assert.equal(taskbarState({ ...opts, platform }), null);
    assert.equal((await matchTaskbar({ ...opts, platform }, { run: never })).state, 'unsupported');
  }
  const empty = { ...opts, dataDir: path.join(scratchDir('taskbar-empty-'), 'state') };
  assert.equal(taskbarState(empty).state, 'no-shortcut');
  assert.equal((await matchTaskbar(empty, { run: never })).state, 'no-shortcut');
  assert.equal(await matchAppWindow({ ...empty, url: URL_APP }, { run: never }), '');
});

test('matchAppWindow never throws: a failed script costs the note and nothing else', async () => {
  const { opts } = installed('taskbar-throw-');
  const run = async () => {
    throw new Error('powershell is not on this machine');
  };
  assert.equal(await matchAppWindow({ ...opts, force: true }, { run }), '');
});

// ---------------------------------------------------------------------------
// The two commands, and doctor
// ---------------------------------------------------------------------------

function capture() {
  const out = [];
  return {
    write: (s) => out.push(s),
    error: (s) => out.push(s),
    get stdout() {
      return out.join('');
    },
  };
}

const spawned = () => ({ unref() {} });
const appDeps = {
  platform: 'win32',
  dataDir: 'C:/state',
  find: async () => ({ port: 4400, url: 'http://127.0.0.1:4400/' }),
  findBrowser: () => 'C:/chrome.exe',
  spawnFn: spawned,
  offerPin: async () => {},
};

test('deckhq app matches the window it opened, after opening it', async () => {
  const io = capture();
  const seen = [];
  const code = await runApp([], {
    ...io,
    ...appDeps,
    matchTaskbar: async (opts) => {
      seen.push(opts);
      return '  Taskbar: noted.\n\n';
    },
  });
  assert.equal(code, 0);
  assert.deepEqual(seen, [
    {
      dataDir: 'C:/state',
      platform: 'win32',
      browser: 'C:/chrome.exe',
      url: 'http://127.0.0.1:4400/',
      waitMs: 8000,
    },
  ]);
  assert.ok(io.stdout.indexOf('Opened as an app window') < io.stdout.indexOf('Taskbar: noted.'));
});

test('deckhq app: a window that was not really opened is not matched, and a failure is not fatal', async () => {
  // An injected spawn opened nothing, so by default there is nothing to read —
  // which is also what keeps this suite off the machine it runs on.
  const quiet = capture();
  assert.equal(await runApp([], { ...quiet, ...appDeps }), 0);
  assert.doesNotMatch(quiet.stdout, /Taskbar/);

  const never = async () => assert.fail('there is no app window to match');
  assert.equal(await runApp(['--no-window'], { ...capture(), ...appDeps, matchTaskbar: never }), 0);
  assert.equal(
    await runApp([], { ...capture(), ...appDeps, findBrowser: () => null, matchTaskbar: never }),
    0,
    'the default browser is a tab, not an app window',
  );

  const broken = async () => {
    throw new Error('no powershell');
  };
  assert.equal(await runApp([], { ...capture(), ...appDeps, matchTaskbar: broken }), 0);
});

const installDeps = (dir) => ({
  platform: 'win32',
  env: { USERPROFILE: dir },
  dataDir: path.join(dir, 'state'),
  binPath: 'C:/pkg/bin/deckhq.mjs',
  node: 'C:/node.exe',
  probeFolders: async () => null,
  findBrowser: () => 'C:/chrome.exe',
  applyFn: async (plan) => ({
    written: plan.files.map((f) => f.path),
    skipped: [],
    icon: null,
    dirs: [],
  }),
});

test('deckhq shortcut --install matches the shortcuts it wrote, and only on Windows', async () => {
  const dir = scratchDir('taskbar-install-');
  const io = capture();
  const seen = [];
  const matchTaskbar = async (opts) => {
    seen.push(opts);
    return '  Taskbar: noted.\n\n';
  };
  const deps = { ...installDeps(dir), matchTaskbar };
  assert.equal(await runInstaller('shortcut', ['--install', '--yes'], { ...io, ...deps }), 0);
  assert.deepEqual(seen, [
    {
      dataDir: deps.dataDir,
      platform: 'win32',
      browser: 'C:/chrome.exe',
      url: 'http://127.0.0.1/',
      force: true,
    },
  ]);
  assert.ok(io.stdout.indexOf('Recorded in') < io.stdout.indexOf('Taskbar: noted.'));

  // Nothing is matched before consent, for the login entry, or off Windows.
  const never = async () => assert.fail('nothing to match');
  const off = { ...deps, matchTaskbar: never };
  assert.equal(await runInstaller('shortcut', ['--install'], { ...capture(), ...off }), 0);
  assert.equal(
    await runInstaller('autostart', ['--install', '--yes'], { ...capture(), ...off }),
    0,
  );
  const linux = { ...off, platform: 'linux', env: { HOME: dir } };
  assert.equal(
    await runInstaller('shortcut', ['--install', '--yes'], { ...capture(), ...linux }),
    0,
  );

  // And a match that throws does not fail an install that succeeded.
  const broken = async () => {
    throw new Error('no powershell');
  };
  const after = capture();
  assert.equal(
    await runInstaller('shortcut', ['--install', '--yes'], {
      ...after,
      ...deps,
      matchTaskbar: broken,
    }),
    0,
  );
  assert.match(after.stdout, /Recorded in/);
});

test('doctor: one row on Windows saying which of the four states this machine is in', async () => {
  const { dataDir, desktop, menu, opts } = installed('taskbar-doctor-');
  assert.match(describeTaskbar(taskbarState(opts)), /does not carry the window's id yet/);
  assert.match(describeTaskbar(taskbarState(opts)), /run `deckhq app` once, then pin/);

  const { run } = fakeScript({
    windows: [{ aumid: CHROME_ID }],
    links: [link(desktop, null), link(menu, null)],
  });
  await matchTaskbar(opts, { run });
  const matched = describeTaskbar(taskbarState(opts));
  assert.match(matched, /a pinned window keeps the DeckHQ icon/);
  assert.ok(matched.includes(CHROME_ID));

  fs.writeFileSync(menu, 'rewritten by something else, and longer');
  assert.match(
    describeTaskbar(taskbarState(opts)),
    /has changed since the window was last matched/,
  );

  const none = taskbarState({ ...opts, dataDir: path.join(scratchDir('taskbar-none-'), 'state') });
  assert.match(describeTaskbar(none), /no DeckHQ shortcut/);
  assert.match(describeTaskbar(none), /`deckhq shortcut --install`/);
  assert.equal(describeTaskbar(null), null);

  // The collector: null off Windows, so the row does not exist there.
  assert.equal(await readTaskbar(dataDir, 'linux'), null);
  assert.equal(await readTaskbar(dataDir, 'darwin'), null);
  const row = await readTaskbar(dataDir, 'win32');
  assert.deepEqual(Object.keys(row).sort(), ['at', 'aumid', 'state', 'text']);
  assert.equal(row.aumid, CHROME_ID);
});

test('doctor: the row is printed when there is one and absent when there is not', () => {
  const report = {
    generatedAt: 0,
    runtimes: [],
    hooks: [],
    deck: { running: false },
    health: null,
    state: { path: '/s/state.json', writable: true },
    terminal: { id: null, label: null, reason: null, present: false, pinned: false },
    names: null,
    egress: { note: 'none.' },
    problems: [],
    notes: [],
  };
  const text = 'a pinned window keeps the DeckHQ icon';
  const withRow = renderReport({ ...report, taskbar: { state: 'matched', text } });
  assert.match(withRow, /^ {2}taskbar pin +a pinned window keeps the DeckHQ icon$/m);
  assert.doesNotMatch(renderReport({ ...report, taskbar: null }), /taskbar pin/);
  assert.doesNotMatch(renderReport(report), /taskbar pin/);
});

// ---------------------------------------------------------------------------
// The real thing, on the one platform that has it
// ---------------------------------------------------------------------------

test('WINDOWS: the real script stamps a tagged shortcut, reads it back, and refuses an untagged one', async (t) => {
  if (process.platform !== 'win32') {
    t.skip('a .lnk and an AppUserModelID exist on Windows only');
    return;
  }
  const dir = scratchDir('taskbar-real-');
  const dataDir = path.join(dir, 'state');
  const ours = path.join(dir, 'Programs', 'DeckHQ.lnk');
  const theirs = path.join(dir, 'Programs', 'Theirs.lnk');
  const lnk = (desc) => ({
    target: process.execPath,
    args: '"app"',
    workingDirectory: dir,
    iconLocation: '',
    description: desc,
    windowStyle: 1,
  });
  await createShortcut(
    { path: ours, why: '', kind: 'lnk', lnk: lnk(description('DeckHQ')) },
    { dataDir },
  );
  await createShortcut(
    { path: theirs, why: '', kind: 'lnk', lnk: lnk('Somebody else') },
    { dataDir },
  );

  // No browser was started with this profile directory, so no window answers.
  const profileDir = path.join(dataDir, 'app-profile');
  const before = await runTaskbarScript(
    'look',
    { profileDir, waitMs: 0, paths: [ours, theirs, path.join(dir, 'absent.lnk')] },
    { dataDir },
  );
  assert.deepEqual(before.windows, []);
  assert.equal(before.links.length, 2, 'a path that is not there is simply not reported');
  assert.equal(before.links[0].aumid, null, 'a shortcut written today carries no id');
  assert.ok(before.links[0].description.includes(TAG));
  assert.equal(before.links[0].arguments, '"app"');

  const after = await runTaskbarScript(
    'stamp',
    { paths: [ours], aumid: CHROME_ID, tag: TAG },
    { dataDir },
  );
  assert.equal(after[0].aumid, CHROME_ID);
  // One property changed and the rest of the shortcut is as it was.
  for (const key of ['target', 'arguments', 'description', 'iconLocation']) {
    assert.equal(after[0][key], before.links[0][key], key);
  }

  const bytes = fs.readFileSync(theirs);
  await assert.rejects(
    runTaskbarScript('stamp', { paths: [theirs], aumid: CHROME_ID, tag: TAG }, { dataDir }),
    /not a shortcut DeckHQ wrote/,
  );
  assert.deepEqual(fs.readFileSync(theirs), bytes, 'the refused file is byte for byte what it was');
});
