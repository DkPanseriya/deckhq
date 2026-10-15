/**
 * WINDOWS' OWN TOOLS, BY THEIR FULL PATH.
 *
 * On Windows a command given by bare name (`cmd`, `powershell`, `where`) is
 * looked for in the WORKING FOLDER before `PATH` — that is how `CreateProcess`
 * searches, and libuv, which Node starts processes with, does the same, in
 * the `cwd` the process is given. DeckHQ starts some of these tools in a
 * session's own project folder (opening a session, running its dashboard), so
 * a `cmd.exe` committed to a repository somebody cloned would have run in
 * place of Windows' own, with their rights (security review, 15 October 2026).
 *
 * Every one of Windows' tools DeckHQ starts is named here once, under the
 * Windows folder the system itself reports (`SystemRoot`). Anywhere other than
 * Windows the bare name is returned: there the search is `PATH` only.
 *
 * Pure: the platform and the environment are arguments, so the rule is tested
 * on every system.
 */

import path from 'node:path';

/** Where each tool lives, under the Windows folder. */
const WINDOWS_TOOLS = Object.freeze({
  cmd: ['System32', 'cmd.exe'],
  powershell: ['System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'],
  where: ['System32', 'where.exe'],
  reg: ['System32', 'reg.exe'],
  explorer: ['explorer.exe'],
});

/**
 * @param {'cmd'|'powershell'|'where'|'reg'|'explorer'} name
 * @param {{platform?: string, env?: Record<string, string|undefined>}} [o]
 * @returns {string} the full path on Windows; the bare name elsewhere
 */
export function systemExe(name, o = {}) {
  const platform = o.platform ?? process.platform;
  if (platform !== 'win32') return name;
  const parts = WINDOWS_TOOLS[name];
  if (!parts) throw new Error(`systemExe: ${name} is not one of Windows' tools`);
  const env = o.env ?? process.env;
  const root = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows';
  return path.win32.join(root, ...parts);
}
