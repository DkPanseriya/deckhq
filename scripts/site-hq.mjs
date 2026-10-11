#!/usr/bin/env node
/**
 * The 3D office's clips at full quality: bring them in, fetch them, check them.
 *
 * They are too heavy for the repository (`site/hq.mjs` says why), so they live
 * as files of a GitHub release and in `site/hq/` on a machine that has them.
 * `site/3d-hq.json` is the list both are held to.
 *
 *   node scripts/site-hq.mjs import <folder> --tag <tag> --clips rise,walkthrough,orbit
 *                                            [--mid-only states]
 *       Copy `<name>-1440.mp4`, `<name>-2160.mp4` and `<name>-first-<width>.png`
 *       from <folder> into site/hq/ under the names the site uses
 *       (`clip-<name>-…`), measure and hash each, and write the list. A clip
 *       named under --mid-only is taken at 1440 only. The folder is then what
 *       a maintainer attaches to the release named by --tag:
 *
 *           gh release create <tag> site/hq/* --latest=false --title … --notes …
 *
 *   node scripts/site-hq.mjs fetch
 *       Download every listed file that is not already here at its listed
 *       hash, from the release. A file whose hash is not the listed one is
 *       deleted and the command fails: what the site serves is what was
 *       reviewed. This is the step the deploy runs.
 *
 *   node scripts/site-hq.mjs check
 *       Hash what is here against the list. Exit 0 only if every file matches.
 *
 * Every command takes `--dir <folder>` and `--manifest <file>` in place of
 * `site/hq/` and `site/3d-hq.json`, for a trial that should not touch either.
 *
 * The only network call in this file is `fetch`'s, to this repository's own
 * release, and it is made by a person or by the deploy — never by the site.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';

import { imageSize } from '../site/media.mjs';
import { HQ_BUDGET, HQ_DIR, HQ_MANIFEST, hqManifest, releaseUrl, sha256File } from '../site/hq.mjs';

const mb = (/** @type {number} */ n) => `${(n / 1048576).toFixed(1)} MB`;

/**
 * The files one clip brings, as `[from, to, kind]`.
 * @param {string} folder @param {string} name @param {boolean} midOnly
 * @returns {Array<[string, string, 'clip' | 'still']>}
 */
export function filesOf(folder, name, midOnly) {
  /** @type {Array<[string, string, 'clip' | 'still']>} */
  const out = [];
  const sizes = midOnly ? [1440] : [1440, 2160];
  for (const size of sizes) {
    const from = path.join(folder, `${name}-${size}.mp4`);
    if (!fs.existsSync(from)) throw new Error(`${from} is not there`);
    out.push([from, `clip-${name}-${size}.mp4`, 'clip']);
  }
  for (const file of fs.readdirSync(folder)) {
    const m = file.match(new RegExp(`^${name}-first-(\\d+)\\.png$`));
    if (m) out.push([path.join(folder, file), `clip-${name}-first-${m[1]}.png`, 'still']);
  }
  return out;
}

/**
 * @param {string} folder
 * @param {{tag: string, clips: string[], midOnly: string[], dir?: string, manifest?: string}} o
 */
export function importHq(folder, o) {
  const dir = o.dir ?? HQ_DIR;
  if (!/^[a-z0-9][a-z0-9.-]*$/.test(o.tag)) throw new Error('--tag names no release');
  fs.mkdirSync(dir, { recursive: true });
  /** @type {import('../site/hq.mjs').HqFile[]} */
  const files = [];
  let total = 0;
  for (const name of [...o.clips, ...o.midOnly]) {
    for (const [from, to, kind] of filesOf(folder, name, o.midOnly.includes(name))) {
      const size = imageSize(from);
      if (!size) throw new Error(`${from} is not a picture or a clip this build can measure`);
      const bytes = fs.statSync(from).size;
      if (bytes > HQ_BUDGET.file)
        throw new Error(`${from} is ${mb(bytes)}, over ${mb(HQ_BUDGET.file)}`);
      fs.copyFileSync(from, path.join(dir, to));
      files.push({
        name: to,
        kind,
        width: size.width,
        height: size.height,
        bytes,
        sha256: sha256File(from),
      });
      total += bytes;
    }
  }
  if (total > HQ_BUDGET.total)
    throw new Error(`${mb(total)} together, over ${mb(HQ_BUDGET.total)}`);
  files.sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(
    o.manifest ?? HQ_MANIFEST,
    `${JSON.stringify({ tag: o.tag, files }, null, 2)}\n`,
  );
  return { files, total };
}

/**
 * Hash what is in the folder against the list.
 * @param {{dir?: string, manifest?: string}} [o]
 * @returns {{ok: string[], missing: string[], wrong: string[]}}
 */
export function checkHq(o = {}) {
  const dir = o.dir ?? HQ_DIR;
  const { files } = hqManifest(o.manifest);
  const result = { ok: [], missing: [], wrong: [] };
  for (const entry of files.values()) {
    const file = path.join(dir, entry.name);
    if (!fs.existsSync(file)) result.missing.push(entry.name);
    else if (fs.statSync(file).size !== entry.bytes || sha256File(file) !== entry.sha256) {
      result.wrong.push(entry.name);
    } else result.ok.push(entry.name);
  }
  return result;
}

/**
 * Download what is missing, and keep only what hashes to its listed value.
 * @param {{dir?: string, manifest?: string, get?: (url: string) => Promise<Buffer>,
 *   log?: (line: string) => void}} [o] `get` is the one network call, and a test's stand-in
 */
export async function fetchHq(o = {}) {
  const dir = o.dir ?? HQ_DIR;
  const log = o.log ?? (() => {});
  const get =
    o.get ??
    (async (/** @type {string} */ url) => {
      const res = await fetch(url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`${url} answered ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    });
  const { tag, files } = hqManifest(o.manifest);
  fs.mkdirSync(dir, { recursive: true });
  const state = checkHq(o);
  for (const name of [...state.missing, ...state.wrong]) {
    const entry = /** @type {import('../site/hq.mjs').HqFile} */ (files.get(name));
    const to = path.join(dir, name);
    const bytes = await get(releaseUrl(tag, name));
    fs.writeFileSync(to, bytes);
    if (bytes.length !== entry.bytes || sha256File(to) !== entry.sha256) {
      fs.rmSync(to, { force: true });
      throw new Error(`${name} from release ${tag} is not the file the list names: refused`);
    }
    log(`fetched ${name} (${mb(bytes.length)})`);
  }
  return { fetched: state.missing.length + state.wrong.length, kept: state.ok.length };
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const opt = (/** @type {string} */ name) => {
    const i = rest.indexOf(name);
    return i !== -1 ? rest[i + 1] : undefined;
  };
  const list = (/** @type {string} */ name) => (opt(name) ?? '').split(',').filter(Boolean);
  const say = (/** @type {string} */ line) => process.stdout.write(`site-hq: ${line}\n`);
  // Another folder or another list: a trial, or a test.
  const where = { dir: opt('--dir'), manifest: opt('--manifest') };
  if (command === 'import') {
    const folder = rest[0];
    if (!folder || folder.startsWith('--')) throw new Error('import needs a folder');
    const { files, total } = importHq(folder, {
      tag: opt('--tag') ?? '',
      clips: list('--clips'),
      midOnly: list('--mid-only'),
      ...where,
    });
    for (const f of files) say(`${f.name}  ${f.width} x ${f.height}  ${mb(f.bytes)}`);
    say(
      `${files.length} files, ${mb(total)}, listed in site/3d-hq.json for release ${opt('--tag')}`,
    );
  } else if (command === 'fetch') {
    const { fetched, kept } = await fetchHq({ log: say, ...where });
    say(`${fetched} fetched, ${kept} already here`);
  } else if (command === 'check') {
    const state = checkHq(where);
    for (const name of state.missing) say(`missing  ${name}`);
    for (const name of state.wrong) say(`WRONG    ${name}`);
    say(`${state.ok.length} match, ${state.missing.length} missing, ${state.wrong.length} wrong`);
    if (state.missing.length || state.wrong.length) process.exitCode = 1;
  } else {
    throw new Error(
      'usage: site-hq.mjs import <folder> --tag <tag> --clips a,b [--mid-only c] | fetch | check',
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    process.stderr.write(`site-hq: ${err.message}\n`);
    process.exitCode = 1;
  });
}
