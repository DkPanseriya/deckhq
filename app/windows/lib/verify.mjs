/**
 * Hashes, the one kind of download this build makes, and Authenticode.
 *
 * The Windows app carries exactly two things DeckHQ did not write: Microsoft's
 * WebView2 SDK DLLs and the Node runtime. Each arrives over HTTPS from the host
 * its publisher names, and each is refused unless its bytes match a hash —
 * `pins.json` says which. Nothing here extracts, runs or trusts a byte before
 * that comparison has been made.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The committed pins: versions and hashes. */
export const PINS_FILE = path.join(HERE, '..', 'pins.json');

/** The only hosts this build may fetch from. */
export const ALLOWED_HOSTS = ['api.nuget.org', 'nodejs.org'];

/** @returns {any} */
export function readPins(file = PINS_FILE) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** @param {Buffer} bytes @param {'sha256'|'sha512'} algorithm */
export function hashOf(bytes, algorithm) {
  return createHash(algorithm).update(bytes).digest('hex');
}

/**
 * Throw unless `bytes` hash to `expected`. The message names both, so a
 * failed build log is enough to see whether the pin or the download moved.
 * @param {Buffer} bytes
 * @param {'sha256'|'sha512'} algorithm
 * @param {string} expected hex
 * @param {string} what
 */
export function requireHash(bytes, algorithm, expected, what) {
  const want = String(expected || '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(want)) {
    throw new Error(`${what}: no ${algorithm} is pinned for it, so it is refused`);
  }
  const have = hashOf(bytes, algorithm);
  if (have !== want) {
    throw new Error(
      `${what}: ${algorithm.toUpperCase().replace('SHA', 'SHA-')} mismatch, refused.\n` +
        `  pinned:     ${want}\n  downloaded: ${have}`,
    );
  }
}

/**
 * GET one URL as bytes. HTTPS only, and only from `ALLOWED_HOSTS`, after
 * redirects as well as before them.
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
export async function download(url) {
  const allowed = (/** @type {string} */ u) => {
    const parsed = new URL(u);
    return parsed.protocol === 'https:' && ALLOWED_HOSTS.includes(parsed.hostname);
  };
  if (!allowed(url)) throw new Error(`refusing to download ${url}: not a pinned host`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
  if (res.url && !allowed(res.url)) throw new Error(`${url} redirected to ${res.url}, refused`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * The environment Windows PowerShell 5.1 is started with.
 *
 * `PSModulePath` is left out. A step that runs under PowerShell 7 (GitHub's
 * default shell on Windows) hands its own module path down to every child, and
 * 5.1 started with 7's path finds `Microsoft.PowerShell.Security` and cannot
 * load it: the first build in CI stopped there, with a signature check that
 * never ran. Without the variable 5.1 uses its own, on any shell.
 *
 * @param {NodeJS.ProcessEnv} env @param {string[]} files
 * @returns {NodeJS.ProcessEnv}
 */
export function authenticodeEnv(env, files) {
  /** @type {NodeJS.ProcessEnv} */
  const out = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.toLowerCase() !== 'psmodulepath') out[key] = value;
  }
  out.DECKHQ_AUTHENTICODE_FILES = JSON.stringify(files);
  return out;
}

/**
 * What Windows says about each file's Authenticode signature.
 *
 * `Get-AuthenticodeSignature` is the operating system's own verdict: the chain
 * is built against the machine's trusted roots and the file's hash is checked
 * against the signed one. Windows PowerShell 5.1 ships with every supported
 * Windows, so this needs nothing installed.
 *
 * @param {string[]} files absolute paths
 * @returns {Array<{file:string, status:string, subject:string}>}
 */
export function authenticode(files) {
  // The paths travel in the environment, as JSON, so no path is ever part of
  // the command text; the script itself holds no double quote for the same
  // reason, and is one argv element.
  const script =
    "$ErrorActionPreference = 'Stop'; " +
    '$out = foreach ($f in (ConvertFrom-Json $env:DECKHQ_AUTHENTICODE_FILES)) { ' +
    '$s = Get-AuthenticodeSignature -LiteralPath $f; ' +
    '[pscustomobject]@{ file = $f; status = [string]$s.Status; ' +
    'subject = [string]$s.SignerCertificate.Subject } }; ' +
    'ConvertTo-Json -InputObject @($out) -Compress';
  const out = execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: authenticodeEnv(process.env, files),
    },
  );
  return JSON.parse(out.trim());
}

/** True when a certificate subject names Microsoft Corporation as CN and O. */
export function isMicrosoftSubject(subject) {
  const parts = String(subject || '')
    .split(/,\s*(?=[A-Z]+=)/)
    .map((p) => p.trim());
  return parts.includes('CN=Microsoft Corporation') && parts.includes('O=Microsoft Corporation');
}
