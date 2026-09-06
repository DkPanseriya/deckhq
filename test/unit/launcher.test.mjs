/**
 * `deckhq shortcut` and `deckhq autostart` — WP-62.
 *
 * The plan for each of the three platforms as data, the ICO the Windows path
 * writes, the consent gate, and the removal that takes ours and only ours.
 *
 * Every platform, every environment and every folder is injected. Nothing in
 * this file writes to a Desktop, a Start Menu or a Startup folder that is not
 * inside the isolated root — which is the point: `test/helpers/isolate.mjs`
 * exists because the suite once read the developer's home directory
 * (`docs/DEVIATIONS.md` §124), and a suite that writes to it would be worse.
 */
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const { ROOT, scratchDir } = await import('../helpers/isolate.mjs');
const {
  TAG,
  RECORD_NAME,
  describePlan,
  desktopEntry,
  infoPlist,
  lnkArguments,
  macExecutable,
  planAutostart,
  planShortcut,
  posixFolders,
  resolveLauncher,
  unsafeForPowerShell,
  whichOnPath,
  windowsFolders,
} = await import('../../src/core/launcher.mjs');
const { ENTRY_BYTES, HEADER_BYTES, pngSize, pngToIco, readIco } =
  await import('../../src/core/ico.mjs');
const {
  ICON_PNGS,
  apply,
  icoPathFor,
  isOurs,
  readRecord,
  recordedPaths,
  remove,
  shortcutSpec,
  writeIco,
  writeRecord,
} = await import('../../src/core/launcher-apply.mjs');
const { buildPlan, runInstaller } = await import('../../src/cli/shortcut.mjs');

const NODE = '/usr/bin/node';
const BIN = '/pkg/bin/deckhq.mjs';

/** A launcher with nothing on the PATH: the `node <bin>` shape. */
const nodeLauncher = (command = ['app']) =>
  resolveLauncher({ platform: 'linux', env: {}, binPath: BIN, node: NODE, command });

// ---------------------------------------------------------------------------
// The ICO
// ---------------------------------------------------------------------------

test('the shipped PNGs are readable, and say the sizes the manifest claims', () => {
  const sizes = ICON_PNGS.map((p) => pngSize(fs.readFileSync(p)));
  assert.deepEqual(sizes, [
    { width: 512, height: 512 },
    { width: 192, height: 192 },
  ]);
});

test('a non-PNG has no size, and cannot become an icon', () => {
  assert.equal(pngSize(Buffer.from('not a png at all, really not')), null);
  assert.equal(pngSize(Buffer.alloc(4)), null);
  assert.throws(() => pngToIco([Buffer.from('nope')]), /no readable PNG/);
  assert.throws(() => pngToIco([]), /no readable PNG/);
});

test('the ICO header is valid, largest first, and every offset lands inside the file', () => {
  const pngs = ICON_PNGS.map((p) => fs.readFileSync(p));
  const ico = pngToIco(pngs);

  assert.equal(ico.readUInt16LE(0), 0, 'reserved');
  assert.equal(ico.readUInt16LE(2), 1, 'type 1 = icon');
  assert.equal(ico.readUInt16LE(4), 2, 'two images');

  const parsed = readIco(ico);
  assert.equal(parsed.count, 2);
  assert.deepEqual(
    parsed.entries.map((e) => [e.width, e.height, e.png]),
    [
      [512, 512, true],
      [192, 192, true],
    ],
  );
  // The 512 cannot be declared in a byte, so its entry carries the format's
  // "256 or larger" sentinel and `readIco` resolves it from the PNG header.
  assert.equal(ico.readUInt8(HEADER_BYTES), 0);
  assert.equal(ico.readUInt8(HEADER_BYTES + ENTRY_BYTES), 192);

  const first = parsed.entries[0];
  assert.equal(first.offset, HEADER_BYTES + ENTRY_BYTES * 2);
  for (const entry of parsed.entries) {
    assert.ok(entry.offset + entry.bytes <= ico.length, 'no entry points past the end');
    assert.ok(entry.bytes > 0);
  }
  assert.equal(ico.length, HEADER_BYTES + ENTRY_BYTES * 2 + pngs[0].length + pngs[1].length);
});

test('a truncated or mistyped ICO reads as no ICO at all', () => {
  const ico = pngToIco(ICON_PNGS.map((p) => fs.readFileSync(p)));
  assert.equal(readIco(ico.subarray(0, 4)), null);
  assert.equal(readIco(ico.subarray(0, 40)), null, 'the entries do not fit');
  const wrongType = Buffer.from(ico);
  wrongType.writeUInt16LE(9, 2);
  assert.equal(readIco(wrongType), null);
});

test('writeIco writes a file the reader accepts, and null when it cannot', (t) => {
  const dir = scratchDir('ico-');
  const file = path.join(dir, 'icons', 'deckhq.ico');
  const result = writeIco({ icoPath: file });
  assert.equal(result.entries, 2);
  assert.equal(fs.statSync(file).size, result.bytes);
  assert.equal(readIco(fs.readFileSync(file)).count, 2);
  assert.equal(writeIco({ icoPath: path.join(dir, 'x.ico'), pngs: ['/no/such.png'] }), null);
  t.diagnostic(`ico ${result.bytes} bytes`);
});

// ---------------------------------------------------------------------------
// What runs
// ---------------------------------------------------------------------------

test('a global deckhq on the PATH wins, and is recorded as an absolute path', () => {
  const found = resolveLauncher({
    platform: 'win32',
    env: { PATH: 'C:\\npm;C:\\other' },
    binPath: 'C:/pkg/bin/deckhq.mjs',
    node: 'C:/node.exe',
    exists: (p) => p === path.join('C:\\npm', 'deckhq.cmd'),
  });
  assert.equal(found.kind, 'global');
  assert.equal(found.target, path.join('C:\\npm', 'deckhq.cmd'));
  assert.deepEqual(found.argv, ['app']);
});

test('with nothing on the PATH it is this node and this checkout', () => {
  const found = nodeLauncher();
  assert.equal(found.kind, 'node');
  assert.equal(found.target, NODE);
  assert.deepEqual(found.argv, [BIN, 'app']);
});

test('whichOnPath tries the Windows extensions and only the Windows extensions', () => {
  const seen = [];
  whichOnPath(['deckhq'], {
    platform: 'win32',
    env: { PATH: 'C:\\a' },
    exists: (p) => {
      seen.push(path.extname(p));
      return false;
    },
  });
  assert.deepEqual(seen, ['.cmd', '.exe', '.bat', '']);

  // `path.delimiter` is the host's, not the injected platform's: this is a
  // pure function over strings, and the split is the one thing in it that the
  // machine running the test decides.
  const posix = [];
  whichOnPath(['deckhq'], {
    platform: 'linux',
    env: { PATH: ['/a', '/b'].join(path.delimiter) },
    exists: (p) => {
      posix.push(p);
      return false;
    },
  });
  assert.deepEqual(posix, [path.join('/a', 'deckhq'), path.join('/b', 'deckhq')]);
});

test('SECURITY: a value that could break a shortcut command line is refused', () => {
  assert.equal(unsafeForPowerShell('C:/Program Files/node.exe'), false);
  assert.equal(unsafeForPowerShell('C:/100% done/x'), false, 'a percent is legal under -File');
  assert.equal(unsafeForPowerShell('a"b'), true);
  assert.equal(unsafeForPowerShell('a`b'), true);
  assert.equal(unsafeForPowerShell('a\nb'), true);
  assert.throws(() => lnkArguments(['a"b']), /will not put this value in a shortcut/);
});

test('the shortcut arguments are one quoted string, in argv order', () => {
  assert.equal(lnkArguments(['C:/pkg/bin/deckhq.mjs', 'app']), '"C:/pkg/bin/deckhq.mjs" "app"');
  assert.equal(lnkArguments([]), '');
});

// ---------------------------------------------------------------------------
// The plan, per platform
// ---------------------------------------------------------------------------

test('Windows: a Desktop shortcut, a Start Menu shortcut and an icon', () => {
  const plan = planShortcut({
    platform: 'win32',
    launcher: nodeLauncher(),
    folders: { desktop: 'D:\\Desktop', programs: 'D:\\Programs', startup: 'D:\\Startup' },
    icoPath: 'D:\\state\\icons\\deckhq.ico',
  });
  assert.equal(plan.supported, true);
  assert.equal(plan.verified, true, 'Windows is the platform this was run on');
  assert.deepEqual(
    plan.files.map((f) => f.path),
    [
      'D:\\state\\icons\\deckhq.ico',
      path.join('D:\\Desktop', 'DeckHQ.lnk'),
      path.join('D:\\Programs', 'DeckHQ.lnk'),
    ],
  );
  const lnk = plan.files[1].lnk;
  assert.equal(lnk.target, NODE);
  assert.equal(lnk.args, `"${BIN}" "app"`);
  assert.equal(lnk.iconLocation, 'D:\\state\\icons\\deckhq.ico,0');
  assert.equal(
    lnk.windowStyle,
    1,
    'normal: a minimised shortcut minimises the Chrome window it goes on to open',
  );
  assert.ok(lnk.description.includes(TAG));
});

test('Windows autostart starts a detached daemon and opens no window', () => {
  const plan = planAutostart({
    platform: 'win32',
    launcher: nodeLauncher(['app', '--no-window']),
    folders: { desktop: 'D:\\Desktop', programs: 'D:\\Programs', startup: 'D:\\Startup' },
  });
  assert.deepEqual(
    plan.files.map((f) => f.path),
    [path.join('D:\\Startup', 'DeckHQ (daemon).lnk')],
  );
  assert.equal(plan.files[0].lnk.args, `"${BIN}" "app" "--no-window"`);
  assert.equal(plan.files[0].lnk.windowStyle, 7, 'the login console is minimised');
});

test('DOCS-ONLY: the macOS bundle is three files and says it was never run', () => {
  const plan = planShortcut({
    platform: 'darwin',
    launcher: nodeLauncher(),
    folders: { macApplications: '/home/x/Applications' },
    iconPngPath: '/pkg/public/icon-512.png',
  });
  assert.equal(plan.verified, false);
  assert.ok(plan.notes.some((n) => n.startsWith('DOCS-ONLY')));
  assert.deepEqual(
    plan.files.map((f) => f.path.replace(/\\/g, '/')),
    [
      '/home/x/Applications/DeckHQ.app/Contents/Info.plist',
      '/home/x/Applications/DeckHQ.app/Contents/MacOS/DeckHQ',
      '/home/x/Applications/DeckHQ.app/Contents/Resources/DeckHQ.png',
    ],
  );
  assert.equal(plan.files[1].mode, 0o755);
  assert.ok(plan.files[1].contents.includes(`exec '${NODE}' '${BIN}' 'app'`));
  assert.ok(plan.files[0].contents.includes(TAG));
  assert.ok(
    plan.notes.some((n) => n.includes('iconutil')),
    'the icns gap is stated, not hidden',
  );
});

test('DOCS-ONLY: the macOS LaunchAgent is one plist with the argv as an array', () => {
  const plan = planAutostart({
    platform: 'darwin',
    launcher: nodeLauncher(['app', '--no-window']),
    folders: { macLaunchAgents: '/home/x/Library/LaunchAgents' },
  });
  assert.equal(plan.verified, false);
  assert.equal(
    plan.files[0].path.replace(/\\/g, '/'),
    '/home/x/Library/LaunchAgents/dev.deckhq.daemon.plist',
  );
  const plist = plan.files[0].contents;
  assert.ok(plist.includes(`<string>${NODE}</string>`));
  assert.ok(plist.includes('<string>--no-window</string>'));
  assert.ok(plist.includes('<key>RunAtLoad</key>'));
  assert.ok(plist.includes(TAG));
});

test('DOCS-ONLY: Linux is a desktop entry plus a hicolor icon', () => {
  const plan = planShortcut({
    platform: 'linux',
    launcher: nodeLauncher(),
    folders: {
      linuxApplications: '/home/x/.local/share/applications',
      linuxIcons: '/home/x/.local/share/icons/hicolor/512x512/apps',
    },
    iconPngPath: '/pkg/public/icon-512.png',
  });
  assert.equal(plan.verified, false);
  assert.deepEqual(
    plan.files.map((f) => f.path.replace(/\\/g, '/')),
    [
      '/home/x/.local/share/applications/deckhq.desktop',
      '/home/x/.local/share/icons/hicolor/512x512/apps/deckhq.png',
    ],
  );
  const entry = plan.files[0].contents;
  assert.ok(entry.startsWith('[Desktop Entry]'));
  assert.ok(entry.includes(`Exec='${NODE}' '${BIN}' 'app'`));
  assert.ok(entry.includes('Terminal=false'));
  assert.ok(entry.includes(`X-DeckHQ-Tag=${TAG}`));
});

test('DOCS-ONLY: the Linux autostart entry is under ~/.config/autostart', () => {
  const plan = planAutostart({
    platform: 'linux',
    launcher: nodeLauncher(['app', '--no-window']),
    folders: { linuxAutostart: '/home/x/.config/autostart' },
  });
  assert.equal(plan.files[0].path.replace(/\\/g, '/'), '/home/x/.config/autostart/deckhq.desktop');
  assert.ok(plan.files[0].contents.includes('X-GNOME-Autostart-enabled=true'));
});

test('a platform DeckHQ knows nothing about plans nothing at all', () => {
  const plan = planShortcut({ platform: 'aix', launcher: nodeLauncher() });
  assert.equal(plan.supported, false);
  assert.deepEqual(plan.files, []);
});

test('the plist and the desktop entry are well formed enough to be read back', () => {
  assert.ok(infoPlist({ icon: 'DeckHQ.png' }).includes('<key>CFBundleIconFile</key>'));
  assert.ok(!infoPlist({}).includes('CFBundleIconFile'), 'no icon key with no icon');
  assert.ok(macExecutable(nodeLauncher()).startsWith('#!/bin/sh\n'));
  assert.ok(desktopEntry({ name: 'x', comment: 'y', exec: 'z' }).includes('Icon=') === false);
});

test('SECURITY: the shortcut fields travel in a file, not on a command line', () => {
  const plan = planShortcut({
    platform: 'win32',
    launcher: nodeLauncher(),
    folders: { desktop: 'D:\\Desktop', programs: 'D:\\Programs', startup: 'D:\\Startup' },
    icoPath: 'D:\\state\\icons\\deckhq.ico',
  });
  // `arguments` is itself a quoted command line. Node's win32 quoting and
  // `powershell -File`'s parsing do not agree about the quotes in it, and
  // `-File` drops an empty argument outright — so none of this is passed as a
  // parameter at all. docs/DEVIATIONS.md §144.
  assert.deepEqual(shortcutSpec(plan.files[1]), {
    path: path.join('D:\\Desktop', 'DeckHQ.lnk'),
    target: NODE,
    arguments: `"${BIN}" "app"`,
    workingDirectory: path.dirname(NODE),
    iconLocation: 'D:\\state\\icons\\deckhq.ico,0',
    description: `DeckHQ — ${TAG}`,
    windowStyle: 1,
  });
  assert.ok(shortcutSpec(plan.files[1]).arguments.includes('"'), 'the quotes are the reason');
});

// ---------------------------------------------------------------------------
// The folders, and their overrides
// ---------------------------------------------------------------------------

test('the Windows folders come from the probe, and an env override beats it', () => {
  const env = { USERPROFILE: 'C:\\Users\\x', APPDATA: 'C:\\Users\\x\\AppData\\Roaming' };
  const guessed = windowsFolders({ env });
  assert.equal(guessed.desktop, path.join('C:\\Users\\x', 'Desktop'));
  assert.ok(guessed.programs.endsWith(path.join('Start Menu', 'Programs')));
  assert.ok(guessed.startup.endsWith(path.join('Start Menu', 'Programs', 'Startup')));

  const probed = windowsFolders({
    env,
    probed: { desktop: 'C:\\OneDrive\\Desktop', programs: 'P', startup: 'S' },
  });
  assert.equal(probed.desktop, 'C:\\OneDrive\\Desktop');

  const overridden = windowsFolders({
    env: { ...env, DECKHQ_DESKTOP_DIR: 'T:\\tmp\\Desktop' },
    probed: { desktop: 'C:\\OneDrive\\Desktop' },
  });
  assert.equal(overridden.desktop, 'T:\\tmp\\Desktop', 'the override outranks the probe');
});

test('the posix folders are all ~-rooted and all overridable', () => {
  const f = posixFolders({ env: {}, home: '/home/x' });
  assert.equal(f.macApplications.replace(/\\/g, '/'), '/home/x/Applications');
  assert.equal(f.linuxAutostart.replace(/\\/g, '/'), '/home/x/.config/autostart');
  const o = posixFolders({ env: { DECKHQ_AUTOSTART_DIR: '/tmp/auto' }, home: '/home/x' });
  assert.equal(o.linuxAutostart, '/tmp/auto');
});

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

test('the record keeps the two surfaces apart and is idempotent', () => {
  const dataDir = scratchDir('record-');
  writeRecord('shortcut', ['/a', '/b', '/a'], { dataDir, now: 1 });
  writeRecord('autostart', ['/c'], { dataDir, now: 2 });
  assert.deepEqual(recordedPaths('shortcut', dataDir), ['/a', '/b']);
  assert.deepEqual(recordedPaths('autostart', dataDir), ['/c']);

  writeRecord('shortcut', ['/a', '/b'], { dataDir, now: 3 });
  assert.deepEqual(
    recordedPaths('shortcut', dataDir),
    ['/a', '/b'],
    'installing twice records once',
  );
  assert.deepEqual(recordedPaths('autostart', dataDir), ['/c'], 'the other surface is untouched');
  assert.equal(readRecord(dataDir).version, 1);
  assert.ok(fs.existsSync(path.join(dataDir, RECORD_NAME)));
});

test('a missing or corrupt record reads as an empty one, and never throws', () => {
  const dataDir = scratchDir('record-bad-');
  assert.deepEqual(readRecord(dataDir).entries, []);
  fs.writeFileSync(path.join(dataDir, RECORD_NAME), 'not json');
  assert.deepEqual(readRecord(dataDir).entries, []);
  fs.writeFileSync(path.join(dataDir, RECORD_NAME), '{"entries":"nope"}');
  assert.deepEqual(readRecord(dataDir).entries, []);
});

// ---------------------------------------------------------------------------
// Writing and removing, on the two file-based platforms
// ---------------------------------------------------------------------------

/** A Linux plan whose folders all live inside the isolated root. */
function linuxPlan(dir) {
  return planShortcut({
    platform: 'linux',
    launcher: nodeLauncher(),
    folders: {
      linuxApplications: path.join(dir, 'applications'),
      linuxIcons: path.join(dir, 'icons'),
    },
    iconPngPath: ICON_PNGS[0],
  });
}

test('apply writes every planned file, tags them, and records them', async () => {
  const dir = scratchDir('apply-');
  const dataDir = path.join(dir, 'state');
  const plan = linuxPlan(dir);
  const result = await apply(plan, { dataDir });

  assert.deepEqual(
    result.written,
    plan.files.map((f) => f.path),
  );
  for (const file of plan.files) assert.ok(fs.existsSync(file.path), file.path);
  assert.ok(fs.readFileSync(plan.files[0].path, 'utf8').includes(TAG));
  assert.deepEqual(recordedPaths('shortcut', dataDir), result.written);
  assert.equal(
    fs.statSync(plan.files[1].path).size,
    fs.statSync(ICON_PNGS[0]).size,
    'the icon is the shipped PNG, copied',
  );
});

test('apply refuses to overwrite a file it did not write, and writes nothing at all', async () => {
  const dir = scratchDir('apply-foreign-');
  const dataDir = path.join(dir, 'state');
  const plan = linuxPlan(dir);
  fs.mkdirSync(path.dirname(plan.files[0].path), { recursive: true });
  fs.writeFileSync(plan.files[0].path, '[Desktop Entry]\nName=somebody else\n');

  await assert.rejects(() => apply(plan, { dataDir }), /was not written by DeckHQ/);
  assert.equal(fs.existsSync(plan.files[1].path), false, 'nothing else was written either');
  assert.deepEqual(recordedPaths('shortcut', dataDir), []);
});

test('installing twice over our own files is fine', async () => {
  const dir = scratchDir('apply-twice-');
  const dataDir = path.join(dir, 'state');
  const plan = linuxPlan(dir);
  await apply(plan, { dataDir });
  const second = await apply(plan, { dataDir });
  assert.deepEqual(
    second.written,
    plan.files.map((f) => f.path),
  );
  assert.deepEqual(recordedPaths('shortcut', dataDir), second.written);
});

test('remove deletes exactly what was recorded, and empties the record', async () => {
  const dir = scratchDir('remove-');
  const dataDir = path.join(dir, 'state');
  const plan = linuxPlan(dir);
  await apply(plan, { dataDir });

  const result = await remove('shortcut', { dataDir });
  assert.deepEqual(
    result.removed,
    plan.files.map((f) => f.path),
  );
  assert.deepEqual(result.foreign, []);
  for (const file of plan.files) assert.equal(fs.existsSync(file.path), false);
  assert.deepEqual(recordedPaths('shortcut', dataDir), []);

  const again = await remove('shortcut', { dataDir });
  assert.deepEqual(again.removed, [], 'removing twice removes nothing the second time');
});

test('remove leaves a recorded path that has lost the tag exactly where it is', async () => {
  const dir = scratchDir('remove-foreign-');
  const dataDir = path.join(dir, 'state');
  const plan = linuxPlan(dir);
  await apply(plan, { dataDir });

  // Somebody replaced our desktop entry with their own.
  fs.writeFileSync(plan.files[0].path, '[Desktop Entry]\nName=mine now\n');

  const result = await remove('shortcut', { dataDir });
  assert.deepEqual(result.foreign, [plan.files[0].path]);
  assert.equal(fs.existsSync(plan.files[0].path), true, 'not ours, not deleted');
  assert.equal(fs.existsSync(plan.files[1].path), false, 'ours, deleted');
  assert.deepEqual(
    recordedPaths('shortcut', dataDir),
    [plan.files[0].path],
    'the file we could not take back stays in the record so it is still reported',
  );
});

test('remove takes the whole macOS bundle down, directories and all', async () => {
  const dir = scratchDir('remove-bundle-');
  const dataDir = path.join(dir, 'state');
  const plan = planShortcut({
    platform: 'darwin',
    launcher: nodeLauncher(),
    folders: { macApplications: path.join(dir, 'Applications') },
    iconPngPath: ICON_PNGS[0],
  });
  await apply(plan, { dataDir });
  assert.ok(fs.existsSync(path.join(dir, 'Applications', 'DeckHQ.app', 'Contents', 'Info.plist')));

  await remove('shortcut', { dataDir });
  assert.equal(fs.existsSync(path.join(dir, 'Applications', 'DeckHQ.app')), false);
});

test('a directory that already existed is never removed, however empty it ends up', async () => {
  const dir = scratchDir('remove-dirs-');
  const dataDir = path.join(dir, 'state');
  const applications = path.join(dir, 'applications');
  // A real Desktop, or a real ~/.local/share/applications: it was here first.
  fs.mkdirSync(applications, { recursive: true });

  const plan = planShortcut({
    platform: 'linux',
    launcher: nodeLauncher(),
    folders: { linuxApplications: applications, linuxIcons: path.join(dir, 'icons') },
    iconPngPath: ICON_PNGS[0],
  });
  const result = await apply(plan, { dataDir });
  assert.ok(
    !result.dirs.includes(applications),
    'a directory that already existed is not one we created',
  );

  await remove('shortcut', { dataDir });
  assert.equal(fs.existsSync(applications), true, 'left standing, and empty');
  assert.equal(fs.existsSync(path.join(dir, 'icons')), false, 'this one we did create');
});

test('a directory we created but that somebody else has filled is left alone', async () => {
  const dir = scratchDir('remove-dirs-busy-');
  const dataDir = path.join(dir, 'state');
  const icons = path.join(dir, 'icons');
  const plan = planShortcut({
    platform: 'linux',
    launcher: nodeLauncher(),
    folders: { linuxApplications: path.join(dir, 'applications'), linuxIcons: icons },
    iconPngPath: ICON_PNGS[0],
  });
  await apply(plan, { dataDir });
  fs.writeFileSync(path.join(icons, 'somebody-elses.png'), 'x');

  await remove('shortcut', { dataDir });
  assert.equal(fs.existsSync(icons), true);
  assert.equal(fs.existsSync(path.join(icons, 'somebody-elses.png')), true);
});

test('anything inside the state directory counts as ours; anything outside needs the tag', async () => {
  const dir = scratchDir('ours-');
  const dataDir = path.join(dir, 'state');
  fs.mkdirSync(dataDir, { recursive: true });
  const inside = path.join(dataDir, 'icons', 'deckhq.ico');
  fs.mkdirSync(path.dirname(inside), { recursive: true });
  fs.writeFileSync(inside, 'binary, untagged, and still ours');
  assert.equal(await isOurs(inside, { dataDir }), true);

  const outside = path.join(dir, 'elsewhere.desktop');
  fs.writeFileSync(outside, 'no tag here');
  assert.equal(await isOurs(outside, { dataDir }), false);
  fs.writeFileSync(outside, `X-DeckHQ-Tag=${TAG}\n`);
  assert.equal(await isOurs(outside, { dataDir }), true);

  assert.equal(await isOurs(path.join(dir, 'nope'), { dataDir }), false);
  assert.equal(await isOurs(dir, { dataDir }), false, 'a directory is never a file we wrote');
});

// ---------------------------------------------------------------------------
// The consent gate
// ---------------------------------------------------------------------------

function capture() {
  const out = [];
  const err = [];
  return {
    write: (s) => out.push(s),
    error: (s) => err.push(s),
    get stdout() {
      return out.join('');
    },
    get stderr() {
      return err.join('');
    },
  };
}

test('CONSENT: --install without --yes prints every path and writes nothing', async () => {
  const dir = scratchDir('consent-');
  const dataDir = path.join(dir, 'state');
  const io = capture();
  const code = await runInstaller('shortcut', ['--install'], {
    ...io,
    platform: 'linux',
    env: { HOME: dir },
    dataDir,
    binPath: BIN,
    node: NODE,
    applyFn: () => assert.fail('nothing may be written without --yes'),
  });
  assert.equal(code, 0);
  assert.match(io.stdout, /Nothing was changed\. Run it again with --yes/);
  assert.match(io.stdout, /deckhq\.desktop/);
  assert.match(io.stdout, new RegExp(TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(fs.existsSync(path.join(dataDir, RECORD_NAME)), false);
});

test('CONSENT: a docs-only platform says so before the file list', async () => {
  const dir = scratchDir('consent-docs-');
  const io = capture();
  await runInstaller('shortcut', ['--install'], {
    ...io,
    platform: 'darwin',
    env: { HOME: dir },
    dataDir: path.join(dir, 'state'),
    binPath: BIN,
    node: NODE,
  });
  assert.match(io.stdout, /NOT RUN ON THIS PLATFORM/);
  assert.ok(
    io.stdout.indexOf('NOT RUN ON THIS PLATFORM') < io.stdout.indexOf('Info.plist'),
    'the warning comes before the paths it is about',
  );
});

test('CONSENT: --remove without --yes lists what would go and deletes nothing', async () => {
  const dir = scratchDir('consent-remove-');
  const dataDir = path.join(dir, 'state');
  const plan = linuxPlan(dir);
  await apply(plan, { dataDir });

  const io = capture();
  const code = await runInstaller('shortcut', ['--remove'], { ...io, dataDir });
  assert.equal(code, 0);
  assert.match(io.stdout, /This would delete/);
  assert.equal(fs.existsSync(plan.files[0].path), true);
});

test('--remove with nothing recorded says so and exits 0', async () => {
  const io = capture();
  const code = await runInstaller('shortcut', ['--remove', '--yes'], {
    ...io,
    dataDir: scratchDir('nothing-'),
  });
  assert.equal(code, 0);
  assert.match(io.stdout, /Nothing to remove/);
});

test('--install --yes writes, and --remove --yes takes it back', async () => {
  const dir = scratchDir('roundtrip-');
  const dataDir = path.join(dir, 'state');
  const deps = {
    platform: 'linux',
    env: {
      HOME: dir,
      DECKHQ_APPLICATIONS_DIR: path.join(dir, 'applications'),
      DECKHQ_ICONS_DIR: path.join(dir, 'icons'),
    },
    dataDir,
    binPath: BIN,
    node: NODE,
  };

  const install = capture();
  assert.equal(await runInstaller('shortcut', ['--install', '--yes'], { ...install, ...deps }), 0);
  const entry = path.join(dir, 'applications', 'deckhq.desktop');
  assert.ok(fs.existsSync(entry));
  assert.match(install.stdout, /Written:/);

  const removal = capture();
  assert.equal(await runInstaller('shortcut', ['--remove', '--yes'], { ...removal, ...deps }), 0);
  assert.equal(fs.existsSync(entry), false);
  assert.match(removal.stdout, /Removed 2/);
});

test('neither flag, or both, is a usage error that changes nothing', async () => {
  const io = capture();
  assert.equal(await runInstaller('shortcut', ['--yes'], { ...io, dataDir: ROOT }), 2);
  assert.equal(
    await runInstaller('shortcut', ['--install', '--remove', '--yes'], { ...io, dataDir: ROOT }),
    2,
  );
  assert.match(io.stderr, /Say one of --install or --remove/);
});

test('no arguments prints the help and exits non-zero', async () => {
  const io = capture();
  assert.equal(await runInstaller('autostart', [], io), 1);
  assert.match(io.stdout, /deckhq autostart/);
  const help = capture();
  assert.equal(await runInstaller('autostart', ['--help'], help), 0);
});

test('describePlan names every file, what it is for, and what runs', () => {
  const text = describePlan(linuxPlan('/tmp/x'));
  assert.match(text, /deckhq\.desktop/);
  assert.match(text, /the application menu entry/);
  assert.match(text, new RegExp(NODE));
  assert.match(text, /--remove` deletes those paths and nothing else/);
});

test('buildPlan on this machine resolves a launcher and a state-dir icon path', async () => {
  const dataDir = scratchDir('build-');
  const plan = await buildPlan('shortcut', {
    platform: 'linux',
    env: { HOME: dataDir },
    dataDir,
    binPath: BIN,
    node: NODE,
  });
  assert.equal(plan.surface, 'shortcut');
  assert.equal(plan.launcher.kind, 'node');
  assert.equal(icoPathFor(dataDir), path.join(dataDir, 'icons', 'deckhq.ico'));
});

test('autostart never plans the window, on any platform', async () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    const dir = scratchDir(`auto-${platform}-`);
    const plan = await buildPlan('autostart', {
      platform,
      env: { HOME: dir, USERPROFILE: dir, APPDATA: dir, DECKHQ_STARTUP_DIR: dir },
      dataDir: path.join(dir, 'state'),
      binPath: BIN,
      node: NODE,
      probeFolders: async () => null,
    });
    assert.deepEqual(plan.launcher.argv, [BIN, 'app', '--no-window'], platform);
    assert.equal(plan.files.length, 1, platform);
  }
});
