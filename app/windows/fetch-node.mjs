#!/usr/bin/env node
/**
 * The Node runtime the Windows app carries: one pinned official release.
 *
 *   node app/windows/fetch-node.mjs       # into dist/app/_build/node
 *
 * `pins.json` names the version. This downloads that release's
 * `SHASUMS256.txt` and its Windows x64 zip from nodejs.org, refuses the zip
 * unless its SHA-256 is the one the release lists (and the one committed in
 * `pins.json`, once a hash is committed there), takes `node.exe` and `LICENSE`
 * out of it, and keeps `node.exe` only if Windows says it is validly signed by
 * the OpenJS Foundation — the publisher of every official Node build.
 *
 * It is run by CI. A maintainer's test build copies the machine's own
 * `node.exe` instead (`build.mjs --local-node`) and says so loudly.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { entryNamed, readZip } from './lib/zip.mjs';
import { authenticode, download, hashOf, readPins, requireHash } from './lib/verify.mjs';
import { REPO } from './fetch-webview2.mjs';

export const NODE_DIR = path.join(REPO, 'dist', 'app', '_build', 'node');

/** @param {string} version */
export function nodeUrls(version) {
  const base = `https://nodejs.org/dist/v${version}`;
  const folder = `node-v${version}-win-x64`;
  return { folder, zip: `${base}/${folder}.zip`, shasums: `${base}/SHASUMS256.txt` };
}

/**
 * The hash a `SHASUMS256.txt` lists for one file name, or null.
 * @param {string} text
 * @param {string} name
 */
export function shasumFor(text, name) {
  for (const line of String(text).split(/\r?\n/)) {
    const m = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (m && m[2] === name) return m[1];
  }
  return null;
}

/** True when a certificate subject names the OpenJS Foundation. */
export function isOpenJsSubject(subject) {
  return String(subject || '')
    .split(/,\s*(?=[A-Z]+=)/)
    .includes('O=OpenJS Foundation');
}

/**
 * @param {{pins?:any, outDir?:string, download?:(url:string) => Promise<Buffer>,
 *          signatures?:typeof authenticode, log?:(line:string) => void}} [opts]
 * @returns {Promise<{version:string, exe:string, sha256:string}>}
 */
export async function fetchNode(opts = {}) {
  const pin = (opts.pins || readPins()).node;
  const outDir = opts.outDir || NODE_DIR;
  const get = opts.download || download;
  const log = opts.log || ((line) => process.stdout.write(`${line}\n`));
  const urls = nodeUrls(pin.version);
  const zipName = path.basename(urls.zip);

  log(`Node ${pin.version}  ${urls.zip}`);
  const listed = shasumFor((await get(urls.shasums)).toString('utf8'), zipName);
  if (!listed) throw new Error(`${urls.shasums} lists no hash for ${zipName}; refused`);
  if (pin.sha256 && pin.sha256.toLowerCase() !== listed) {
    throw new Error(
      `SHASUMS256.txt lists ${listed} for ${zipName} but pins.json pins ${pin.sha256}; refused`,
    );
  }
  const zip = await get(urls.zip);
  requireHash(zip, 'sha256', pin.sha256 || listed, zipName);
  log(
    `  sha256 ${hashOf(zip, 'sha256')} matches SHASUMS256.txt${pin.sha256 ? ' and pins.json' : ''}`,
  );
  if (!pin.sha256) {
    log('  NOTE: pins.json holds no sha256 for this zip yet. Commit the value above as');
    log('        node.sha256 so the next build is held to it and not only to nodejs.org.');
  }

  const entries = readZip(zip, zipName);
  const exeBytes = entryNamed(entries, `${urls.folder}/node.exe`, zipName).read();
  const licence = entryNamed(entries, `${urls.folder}/LICENSE`, zipName).read();
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  const exe = path.join(outDir, 'node.exe');
  fs.writeFileSync(exe, exeBytes);
  fs.writeFileSync(path.join(outDir, 'LICENSE'), licence);

  let verdict;
  try {
    [verdict] = (opts.signatures || authenticode)([exe]);
  } catch (err) {
    fs.rmSync(outDir, { recursive: true, force: true });
    throw new Error(`could not check node.exe's Authenticode signature: ${err?.message || err}`);
  }
  const ok = verdict && verdict.status === 'Valid' && isOpenJsSubject(verdict.subject);
  log(`  ${ok ? 'signed ' : 'REFUSED'} node.exe  ${verdict?.status}  ${verdict?.subject}`);
  if (!ok) {
    fs.rmSync(outDir, { recursive: true, force: true });
    throw new Error('node.exe is not validly signed by the OpenJS Foundation; nothing was kept');
  }
  fs.writeFileSync(path.join(outDir, 'VERSION'), `${pin.version}\n`, 'utf8');
  return { version: pin.version, exe, sha256: hashOf(zip, 'sha256') };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await fetchNode();
  } catch (err) {
    process.stderr.write(`\n  fetch-node: ${err?.message || err}\n\n`);
    process.exitCode = 1;
  }
}
