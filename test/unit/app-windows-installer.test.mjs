/**
 * DeckHQ for Windows — what the installer and its workflow may do.
 *
 * NSIS is not run here (it is not on a developer's machine, and the suite runs
 * on three operating systems). The script is read as text and held to the
 * promises a user is made: no administrator prompt, only what was written is
 * removed, and `~\.deckhq` is never deleted without a question whose default
 * is to keep it. The workflow is held to making no download of its own.
 */
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => fs.readFileSync(path.join(REPO, ...parts), 'utf8');

const { nsisFileLists } = await import('../../app/windows/lib/nsis-lists.mjs');
const { PUBLISHER } = await import('../../app/windows/build-shell.mjs');

const nsi = read('app', 'windows', 'installer.nsi');
/** The script without its `;` comments, so a rule in prose is not mistaken for code. */
const code = nsi
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith(';'))
  .join('\n');

test('the file lists install and remove every file by name, and no directory by force', () => {
  const files = [
    'DeckHQ.exe',
    'core/bin/deckhq.mjs',
    'core/src/a$b.mjs',
    'node/node.exe',
    'VERSION',
  ];
  const lists = nsisFileLists(files);

  for (const rel of files) {
    const win = rel.replace(/\//g, '\\').replace(/\$/g, '$$$$');
    assert.ok(lists.install.includes(`File "\${APP_SRC}\\${win}"`), `install: ${rel}`);
    assert.ok(lists.uninstall.includes(`Delete "$INSTDIR\\${win}"`), `uninstall: ${rel}`);
  }
  assert.ok(lists.install.includes('SetOutPath "$INSTDIR\\core\\bin"'));
  assert.ok(!/RMDir\s+\/r/i.test(lists.uninstall), 'a generated list never removes a tree');
  assert.deepEqual(lists.dirs, ['core/bin', 'core/src', 'core', 'node']);
  const order = lists.dirs.map((d) =>
    lists.uninstall.indexOf(`RMDir "$INSTDIR\\${d.replace(/\//g, '\\')}"`),
  );
  assert.deepEqual(
    [...order].sort((a, b) => a - b),
    order,
    'children before parents',
  );
  assert.ok(order.every((at) => at > lists.uninstall.lastIndexOf('Delete ')));

  for (const bad of ['../outside.txt', 'C:/Windows/x', '/abs', 'a/../../b', 'q"uote']) {
    assert.throws(() => nsisFileLists([bad]), /not a plain relative path/, bad);
  }
});

test('SECURITY: the installer is per-user and never asks for an administrator', () => {
  assert.match(code, /^RequestExecutionLevel user$/m);
  assert.equal(code.match(/RequestExecutionLevel/g).length, 1);
  assert.match(code, /^InstallDir "\$LOCALAPPDATA\\Programs\\DeckHQ"$/m);
  for (const elevated of [
    /HKLM/i,
    /HKEY_LOCAL_MACHINE/i,
    /SetShellVarContext\s+all/i,
    /\$PROGRAMFILES/i,
    /\$COMMONFILES/i,
    /\$WINDIR/i,
    /\$SYSDIR/i,
    /UAC::/i,
    /runas/i,
  ]) {
    assert.ok(!elevated.test(code), `the installer must not use ${elevated}`);
  }
  // Every registry write is under HKCU.
  for (const line of code.split('\n').filter((l) => /^\s*(Write|Delete)Reg/.test(l))) {
    assert.match(
      line,
      /^\s*(WriteRegStr|WriteRegDWORD|DeleteRegKey) HKCU "\$\{UNINSTALL_KEY\}"/,
      line,
    );
  }
  const manifest = read('app', 'windows', 'shell', 'app.manifest');
  assert.match(manifest, /requestedExecutionLevel level="asInvoker"/);
  assert.ok(!/requireAdministrator|highestAvailable/.test(manifest));
});

test('the installer writes the Start Menu entry, the asked-for Desktop one, and Installed apps', () => {
  assert.match(
    code,
    /!define UNINSTALL_KEY "Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\DeckHQ"/,
  );
  assert.ok(code.includes(`!define PUBLISHER "${PUBLISHER}"`));
  assert.equal(PUBLISHER, 'Darshak Panseriya');
  for (const value of [
    'DisplayName',
    'DisplayVersion',
    'Publisher',
    'DisplayIcon',
    'InstallLocation',
    'UninstallString',
    'QuietUninstallString',
    'EstimatedSize',
  ]) {
    assert.match(code, new RegExp(`HKCU "\\$\\{UNINSTALL_KEY\\}" "${value}"`), value);
  }
  assert.ok(code.includes('"DisplayIcon" "$INSTDIR\\DeckHQ.exe,0"'));
  assert.ok(code.includes('CreateShortcut "$SMPROGRAMS\\DeckHQ.lnk" "$INSTDIR\\DeckHQ.exe"'));
  assert.match(
    code,
    /Section "Desktop shortcut" SecDesktop\s+CreateShortcut "\$DESKTOP\\DeckHQ\.lnk"/,
  );
  assert.match(code, /!insertmacro MUI_PAGE_COMPONENTS/, 'the Desktop shortcut is asked about');
  assert.ok(code.includes('!define MUI_FINISHPAGE_RUN "$INSTDIR\\DeckHQ.exe"'));
  assert.ok(code.includes('!define MUI_FINISHPAGE_RUN_TEXT "Start DeckHQ"'));
  assert.ok(code.includes('!include "${BUILD_DIR}\\install-files.nsh"'));
});

test('the uninstaller removes by list, and asks before the user\u2019s data with No as the default', () => {
  const uninstall = code.slice(code.indexOf('Section "Uninstall"'));
  assert.ok(uninstall.includes('!include "${BUILD_DIR}\\uninstall-files.nsh"'));
  assert.ok(!/RMDir\s+\/r\s+"?\$INSTDIR/i.test(code), 'never the install folder as a tree');
  for (const remove of [
    'Delete "$SMPROGRAMS\\DeckHQ.lnk"',
    'Delete "$DESKTOP\\DeckHQ.lnk"',
    'Delete "$INSTDIR\\Uninstall.exe"',
    'DeleteRegKey HKCU "${UNINSTALL_KEY}"',
  ]) {
    assert.ok(uninstall.includes(remove), remove);
  }
  // The only two trees removed: the window's own cache, and the data after the question.
  const trees = [...code.matchAll(/RMDir\s+\/r\s+"([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(trees, ['$LOCALAPPDATA\\DeckHQ', '$PROFILE\\.deckhq']);
  const question = uninstall.indexOf('MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2');
  const data = uninstall.indexOf('RMDir /r "$PROFILE\\.deckhq"');
  assert.ok(question !== -1 && question < data, 'the question comes before the delete');
  assert.match(uninstall.slice(question, data), /\/SD IDNO IDNO done/, 'No, and silent means No');
  assert.ok(
    uninstall.indexOf('IfSilent done') < uninstall.indexOf('RMDir /r "$LOCALAPPDATA\\DeckHQ"'),
  );
});

test('the installer waits for the name DeckHQ.exe holds while it is open', () => {
  const name = /!define RUNNING_MUTEX "([^"]+)"/.exec(code)[1];
  assert.ok(read('app', 'windows', 'shell', 'Paths.cs').includes(`return "${name}";`));
  assert.equal(code.match(/!insertmacro RefuseWhileRunning/g).length, 2, 'install and uninstall');
});
