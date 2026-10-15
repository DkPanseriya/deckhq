/**
 * SECURITY: WINDOWS' OWN TOOLS ARE STARTED BY THEIR FULL PATH.
 *
 * A bare `cmd` or `powershell` is looked for in the working folder first on
 * Windows, and DeckHQ starts some of them in a session's project folder. So no
 * source file may start one by bare name; `systemExe` is the one place they
 * are named.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { systemExe } from '../../src/core/system-exe.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('systemExe: the Windows folder the system reports, and the bare name elsewhere', () => {
  const env = { SystemRoot: 'D:\\Win' };
  assert.equal(systemExe('cmd', { platform: 'win32', env }), 'D:\\Win\\System32\\cmd.exe');
  assert.equal(
    systemExe('powershell', { platform: 'win32', env }),
    'D:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
  );
  assert.equal(systemExe('explorer', { platform: 'win32', env }), 'D:\\Win\\explorer.exe');
  assert.equal(
    systemExe('where', { platform: 'win32', env: {} }),
    'C:\\Windows\\System32\\where.exe',
  );
  assert.equal(systemExe('cmd', { platform: 'linux' }), 'cmd');
  assert.throws(() => systemExe(/** @type {any} */ ('calc'), { platform: 'win32' }));
});

test('SECURITY: no source file starts a Windows tool by its bare name', () => {
  /** @type {string[]} */
  const files = [];
  const walk = (/** @type {string} */ dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, e.name);
      if (e.isDirectory()) walk(file);
      else if (/\.m?js$/.test(e.name)) files.push(file);
    }
  };
  for (const dir of ['src', 'bin']) walk(path.join(ROOT, dir));
  const BARE =
    /\b(?:spawn|spawnSync|execFile|execFileSync)\(\s*['"](cmd|cmd\.exe|powershell|powershell\.exe|where|where\.exe|reg|reg\.exe|explorer|explorer\.exe)['"]/;
  const hits = files
    .map((f) => [path.relative(ROOT, f), BARE.exec(fs.readFileSync(f, 'utf8'))])
    .filter(([, m]) => m)
    .map(([f, m]) => `${f}: ${/** @type {any} */ (m)[0]}`);
  assert.deepEqual(hits, []);
});
