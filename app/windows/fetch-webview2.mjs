#!/usr/bin/env node
/**
 * Fetch the one pinned WebView2 SDK package and take four DLLs out of it.
 *
 *   node app/windows/fetch-webview2.mjs            # into dist/app/_build/webview2
 *   node app/windows/fetch-webview2.mjs --print    # download and print hashes; extract nothing
 *
 * `DeckHQ.exe` hosts the floor in WebView2, and the managed half of WebView2
 * is not part of Windows: it is Microsoft's NuGet package
 * `Microsoft.Web.WebView2`. This script is the only way those DLLs enter a
 * build, and it does four things in a fixed order:
 *
 *   1. downloads ONE version, named in `pins.json`, from api.nuget.org;
 *   2. refuses it unless its SHA-512 is the one committed in `pins.json`;
 *   3. extracts only the files `pins.json` lists, each checked against its own
 *      committed SHA-256, into a git-ignored directory;
 *   4. asks Windows (`Get-AuthenticodeSignature`) whether each DLL carries a
 *      valid signature from Microsoft Corporation, and deletes what it
 *      extracted if any one does not.
 *
 * The DLLs are never committed. `--print` is how a new version gets pinned: it
 * prints what the download hashes to, and writes nothing a build would use.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { entryNamed, readZip } from './lib/zip.mjs';
import {
  authenticode,
  download,
  hashOf,
  isMicrosoftSubject,
  readPins,
  requireHash,
} from './lib/verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '..', '..');

/** Where the verified DLLs land. Under `dist/`, which `.gitignore` excludes. */
export const WEBVIEW2_DIR = path.join(REPO, 'dist', 'app', '_build', 'webview2');

/** @param {string} version */
export function webview2Url(version) {
  const id = 'microsoft.web.webview2';
  return `https://api.nuget.org/v3-flatcontainer/${id}/${version}/${id}.${version}.nupkg`;
}

/**
 * @param {{pins?:any, outDir?:string, cacheDir?:string, print?:boolean,
 *          download?:(url:string) => Promise<Buffer>,
 *          signatures?:typeof authenticode,
 *          log?:(line:string) => void}} [opts]
 * @returns {Promise<{version:string, files:string[]}>}
 */
export async function fetchWebView2(opts = {}) {
  const pin = (opts.pins || readPins()).webview2;
  const outDir = opts.outDir || WEBVIEW2_DIR;
  const log = opts.log || ((line) => process.stdout.write(`${line}\n`));
  const url = webview2Url(pin.version);

  log(`WebView2 SDK ${pin.version}  ${url}`);
  // A copy already on disk is used instead of a second download, and is held
  // to exactly the same hash below: the cache saves a request, never a check.
  const cached = opts.cacheDir ? path.join(opts.cacheDir, path.basename(url)) : null;
  let nupkg;
  if (cached && fs.existsSync(cached)) {
    nupkg = fs.readFileSync(cached);
    log(`  from ${cached}`);
  } else {
    nupkg = await (opts.download || download)(url);
    if (cached) {
      fs.mkdirSync(path.dirname(cached), { recursive: true });
      fs.writeFileSync(cached, nupkg);
    }
  }

  if (opts.print) {
    log(`  sha512 ${hashOf(nupkg, 'sha512')}`);
    const entries = readZip(nupkg, 'the WebView2 package');
    for (const name of Object.keys(pin.files)) {
      log(`  sha256 ${hashOf(entryNamed(entries, name).read(), 'sha256')}  ${name}`);
    }
    return { version: pin.version, files: [] };
  }

  // Nothing is opened, let alone extracted, before this line passes.
  requireHash(nupkg, 'sha512', pin.sha512, `Microsoft.Web.WebView2 ${pin.version}`);
  log('  sha512 matches pins.json');

  const entries = readZip(nupkg, 'the WebView2 package');
  /** @type {Array<{to:string, bytes:Buffer}>} */
  const wanted = [];
  for (const [name, spec] of Object.entries(pin.files)) {
    const bytes = entryNamed(entries, name, 'the WebView2 package').read();
    requireHash(bytes, 'sha256', spec.sha256, name);
    wanted.push({ to: spec.to, bytes });
  }

  fs.rmSync(outDir, { recursive: true, force: true });
  const written = [];
  for (const { to, bytes } of wanted) {
    const file = path.join(outDir, to);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes);
    written.push(file);
  }

  const dlls = written.filter((f) => f.toLowerCase().endsWith('.dll'));
  let verdicts;
  try {
    verdicts = (opts.signatures || authenticode)(dlls);
  } catch (err) {
    fs.rmSync(outDir, { recursive: true, force: true });
    throw new Error(`could not check the Authenticode signatures: ${err?.message || err}`);
  }
  for (const v of verdicts) {
    const ok = v.status === 'Valid' && isMicrosoftSubject(v.subject);
    log(
      `  ${ok ? 'signed ' : 'REFUSED'} ${path.relative(outDir, v.file)}  ${v.status}  ${v.subject}`,
    );
  }
  const bad = verdicts.filter((v) => !(v.status === 'Valid' && isMicrosoftSubject(v.subject)));
  if (bad.length || verdicts.length !== dlls.length) {
    fs.rmSync(outDir, { recursive: true, force: true });
    throw new Error(
      'a WebView2 DLL is not validly signed by Microsoft Corporation; nothing was kept: ' +
        (bad.map((v) => `${path.basename(v.file)} (${v.status})`).join(', ') || 'no verdict'),
    );
  }
  fs.writeFileSync(path.join(outDir, 'VERSION'), `${pin.version}\n`, 'utf8');
  return { version: pin.version, files: written };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const done = await fetchWebView2({
      print: process.argv.includes('--print'),
      cacheDir: path.join(REPO, 'dist', 'app', '_build', 'cache'),
    });
    if (done.files.length)
      process.stdout.write(`  ${done.files.length} files in ${WEBVIEW2_DIR}\n`);
  } catch (err) {
    process.stderr.write(`\n  fetch-webview2: ${err?.message || err}\n\n`);
    process.exitCode = 1;
  }
}
