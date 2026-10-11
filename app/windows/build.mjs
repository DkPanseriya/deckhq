#!/usr/bin/env node
/**
 * Assemble the Windows app as a folder that runs from anywhere.
 *
 *   node app/windows/build.mjs                # the real thing: official Node, by hash
 *   node app/windows/build.mjs --local-node   # a TEST build: this machine's own node.exe
 *
 * The result is `dist/app/DeckHQ/`:
 *
 *   DeckHQ.exe                       the shell (build-shell.mjs)
 *   Microsoft.Web.WebView2.*.dll     the WebView2 SDK's managed half
 *   runtimes\win-*\native\           its native loader, x64 and arm64
 *   node\node.exe                    the Node runtime
 *   core\                            exactly what `npm pack` would publish
 *   licenses\                        the licences of what DeckHQ did not write
 *   LICENSE.txt, VERSION
 *
 * Nothing in it is installed, registered or written outside the folder, so
 * running it is double-clicking `DeckHQ.exe` wherever the folder is. The
 * installer (`installer.nsi`) is this folder plus shortcuts; the two lists it
 * installs and removes by are written here, from the folder as it was built.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { BUILD_DIR, SHELL_EXE, buildShell } from './build-shell.mjs';
import { NODE_DIR, fetchNode } from './fetch-node.mjs';
import { REPO, WEBVIEW2_DIR, fetchWebView2 } from './fetch-webview2.mjs';
import { nsisFileLists } from './lib/nsis-lists.mjs';
import { packFiles } from './lib/pack-list.mjs';
import { readPins } from './lib/verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const APP_DIR = path.join(REPO, 'dist', 'app', 'DeckHQ');

/** The WebView2 files that travel with the exe, relative to both folders. */
export const WEBVIEW2_FILES = [
  'Microsoft.Web.WebView2.Core.dll',
  'Microsoft.Web.WebView2.WinForms.dll',
  'runtimes/win-x64/native/WebView2Loader.dll',
  'runtimes/win-arm64/native/WebView2Loader.dll',
];

/**
 * Every file of the app folder that is a copy of something: where it comes
 * from and where it goes. Pure, so the test can hold `core\` to npm's list.
 * @param {{pack:string[], nodeLicence?:boolean}} o
 * @returns {Array<{from:string, to:string}>}
 */
export function layout(o) {
  const plan = [
    { from: SHELL_EXE, to: 'DeckHQ.exe' },
    ...WEBVIEW2_FILES.map((rel) => ({ from: path.join(WEBVIEW2_DIR, rel), to: rel })),
    { from: path.join(WEBVIEW2_DIR, 'LICENSE.txt'), to: 'licenses/WebView2-LICENSE.txt' },
    { from: path.join(HERE, 'THIRD-PARTY.md'), to: 'licenses/THIRD-PARTY.md' },
    { from: path.join(REPO, 'LICENSE'), to: 'LICENSE.txt' },
    ...o.pack.map((rel) => ({ from: path.join(REPO, rel), to: `core/${rel}` })),
  ];
  if (o.nodeLicence) {
    plan.push({ from: path.join(NODE_DIR, 'LICENSE'), to: 'licenses/Node-LICENSE.txt' });
  }
  return plan;
}

/** Every file under a directory, relative, forward slashes, sorted. */
export function listFiles(dir, prefix = '') {
  /** @type {string[]} */
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out.sort();
}

function commit() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** The Node this build carries: the machine's own (a test build) or the pinned release. */
async function chooseNode(localNode, pins, log) {
  if (!localNode) {
    const got = await fetchNode({ pins, log });
    return {
      exe: got.exe,
      line: `node ${got.version} (win-x64, official, zip sha256 ${got.sha256})`,
    };
  }
  const bar = '!'.repeat(72);
  log(bar);
  log("!! TEST BUILD. node\\node.exe is a copy of THIS MACHINE'S OWN Node:");
  log(`!!   ${process.execPath}  (v${process.versions.node}, ${process.arch})`);
  log('!! It was not downloaded, not verified against a hash, and is not the');
  log('!! runtime a release carries. Do not publish this folder.');
  log(bar);
  const { node: v } = process.versions;
  return {
    exe: process.execPath,
    line: `node ${v} (${process.arch}) TEST BUILD: the build machine's own node.exe`,
  };
}

/**
 * @param {{localNode?:boolean, log?:(line:string) => void}} [opts]
 * @returns {Promise<{dir:string, files:string[], bytes:number, test:boolean}>}
 */
export async function build(opts = {}) {
  const log = opts.log || ((line) => process.stdout.write(`${line}\n`));
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  const pins = readPins();

  if (!WEBVIEW2_FILES.every((rel) => fs.existsSync(path.join(WEBVIEW2_DIR, rel)))) {
    await fetchWebView2({ cacheDir: path.join(BUILD_DIR, 'cache'), log });
  }
  buildShell({ version: pkg.version, log });
  const node = await chooseNode(Boolean(opts.localNode), pins, log);

  const pack = packFiles(REPO);
  log(`core\\  ${pack.length} files, the list npm pack reports`);

  fs.rmSync(APP_DIR, { recursive: true, force: true });
  const plan = [
    ...layout({ pack, nodeLicence: !opts.localNode }),
    { from: node.exe, to: 'node/node.exe' },
  ];
  for (const { from, to } of plan) {
    const target = path.join(APP_DIR, to);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(from, target);
  }
  const version = [
    `DeckHQ ${pkg.version}`,
    `commit ${commit()}`,
    node.line,
    `webview2-sdk ${pins.webview2.version}`,
    '',
  ];
  fs.writeFileSync(path.join(APP_DIR, 'VERSION'), version.join('\r\n'), 'utf8');

  const files = listFiles(APP_DIR);
  const lists = nsisFileLists(files);
  fs.writeFileSync(path.join(BUILD_DIR, 'install-files.nsh'), lists.install, 'utf8');
  fs.writeFileSync(path.join(BUILD_DIR, 'uninstall-files.nsh'), lists.uninstall, 'utf8');

  const bytes = files.reduce((sum, rel) => sum + fs.statSync(path.join(APP_DIR, rel)).size, 0);
  log(`${APP_DIR}`);
  log(`  ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB`);
  return { dir: APP_DIR, files, bytes, test: Boolean(opts.localNode) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await build({ localNode: process.argv.includes('--local-node') });
  } catch (err) {
    process.stderr.write(`\n  build: ${err?.stdout || ''}${err?.message || err}\n\n`);
    process.exitCode = 1;
  }
}
