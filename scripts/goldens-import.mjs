#!/usr/bin/env node
/**
 * Put a baked set of linux goldens where the gate reads them.
 *
 *   node scripts/goldens-import.mjs <dir-or-zip>
 *
 * The linux goldens cannot be baked the way the Windows ones are — on the
 * maintainer's own machine with `npm run goldens` — because that command only
 * ever writes the HOST platform's set and nobody working on this product has a
 * Linux desktop. So `.github/workflows/goldens-bake.yml` bakes them on an
 * ubuntu runner and uploads them as an artifact, and a person downloads that
 * artifact, runs this, looks at the pictures and commits them. CI never pushes.
 *
 * `<dir-or-zip>` is either the zip GitHub hands you from the run page, or the
 * directory `gh run download` unpacks it into. Every file in it must be
 * `<capture>.png` for a capture `scripts/goldens.mjs --list` names, and must
 * actually be a PNG. One file that is not refuses the WHOLE import and places
 * nothing, because a half-imported set is the state this exists to end.
 *
 * `<name>.actual.png` and `<name>.diff.png` are refused by name: those are what
 * the `goldens` CHECK job uploads, and a check run's capture of a floor that
 * disagreed with its golden is not a bake anybody decided to make.
 *
 * Exit codes: 0 placed; 1 refused, nothing placed; 2 no input, unreadable
 * input, or an input with no files in it.
 *
 * No dependencies: a GitHub artifact zip is read by the small central-directory
 * reader below, over `node:zlib`.
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Where the gate on an ubuntu runner reads its goldens (`test/goldens/<process.platform>/`). */
export const LINUX_GOLDENS = path.join(ROOT, 'test', 'goldens', 'linux');

export const EXIT_REFUSED = 1;
export const EXIT_NO_INPUT = 2;

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @typedef {{name:string, from:string, bytes:Buffer}} InputFile
 *   `name` is the file's own name, `from` where it was found (for messages).
 */

/**
 * Every capture the gate takes, from the gate itself.
 * @returns {string[]}
 */
export function knownCaptures() {
  const out = execFileSync(
    process.execPath,
    [path.join(ROOT, 'scripts', 'goldens.mjs'), '--list'],
    {
      encoding: 'utf8',
    },
  );
  return String(out)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * The files in a zip archive: stored or deflated entries, no encryption, no
 * zip64 — which is every artifact zip GitHub serves for a set of PNGs this size.
 * Anything else is an error rather than a guess.
 * @param {Buffer} zip
 * @param {string} label
 * @returns {InputFile[]}
 */
export function readZip(zip, label = 'zip') {
  // The end-of-central-directory record: 22 bytes plus a comment of at most
  // 65,535, so it is somewhere in the last 65,557 bytes.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error(`${label} is not a zip archive (no end-of-central-directory)`);
  const count = zip.readUInt16LE(eocd + 10);
  let at = zip.readUInt32LE(eocd + 16);
  /** @type {InputFile[]} */ const files = [];
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw new Error(`${label}: bad central directory`);
    const flags = zip.readUInt16LE(at + 8);
    const method = zip.readUInt16LE(at + 10);
    const packed = zip.readUInt32LE(at + 20);
    const size = zip.readUInt32LE(at + 24);
    const nameLength = zip.readUInt16LE(at + 28);
    const extraLength = zip.readUInt16LE(at + 30);
    const commentLength = zip.readUInt16LE(at + 32);
    const local = zip.readUInt32LE(at + 42);
    const entry = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    at += 46 + nameLength + extraLength + commentLength;
    if (entry.endsWith('/')) continue; // a directory
    if (flags & 1) throw new Error(`${label}: ${entry} is encrypted`);
    if (packed === 0xffffffff || size === 0xffffffff)
      throw new Error(`${label}: zip64 is not read`);
    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`${label}: bad entry ${entry}`);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const raw = zip.subarray(start, start + packed);
    let bytes;
    if (method === 0) bytes = Buffer.from(raw);
    else if (method === 8) bytes = inflateRawSync(raw);
    else throw new Error(`${label}: ${entry} uses compression method ${method}`);
    if (bytes.length !== size)
      throw new Error(`${label}: ${entry} is ${bytes.length} bytes, not ${size}`);
    files.push({ name: path.posix.basename(entry), from: `${label}:${entry}`, bytes });
  }
  return files;
}

/**
 * Every file under a directory, or every file in a zip.
 * @param {string} source
 * @returns {InputFile[]}
 */
export function readInput(source) {
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    /** @type {InputFile[]} */ const files = [];
    const walk = (/** @type {string} */ dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) {
          files.push({ name: entry.name, from: full, bytes: fs.readFileSync(full) });
        }
      }
    };
    walk(source);
    return files;
  }
  return readZip(fs.readFileSync(source), path.basename(source));
}

/**
 * Decide, before anything is written, which files would be placed and which
 * are refused and why. A plan with any refusal is not carried out at all.
 * @param {InputFile[]} files
 * @param {readonly string[]} known capture names
 * @returns {{place:InputFile[], refused:{from:string, reason:string}[]}}
 */
export function planImport(files, known) {
  const names = new Set(known);
  /** @type {InputFile[]} */ const place = [];
  /** @type {{from:string, reason:string}[]} */ const refused = [];
  /** @type {Map<string, string>} */ const seen = new Map();
  for (const file of files) {
    const match = /^(.+)\.png$/.exec(file.name);
    const capture = match ? match[1] : '';
    if (/\.(actual|diff)$/.test(capture)) {
      refused.push({
        from: file.from,
        reason: 'a check run’s capture or diff, not a bake — use the goldens-bake artifact',
      });
    } else if (!match || !names.has(capture)) {
      refused.push({
        from: file.from,
        reason: 'not <capture>.png for any capture `node scripts/goldens.mjs --list` names',
      });
    } else if (!file.bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
      refused.push({ from: file.from, reason: 'named like a golden but is not a PNG' });
    } else if (seen.has(file.name)) {
      refused.push({
        from: file.from,
        reason: `a second ${file.name} (first: ${seen.get(file.name)})`,
      });
    } else {
      seen.set(file.name, file.from);
      place.push(file);
    }
  }
  return { place, refused };
}

/**
 * Import a baked set: read, plan, and — only if nothing was refused — write.
 * @param {{source:string, to?:string, known?:readonly string[]}} options
 * @returns {{exitCode:number, lines:string[]}}
 */
export function importGoldens({ source, to = LINUX_GOLDENS, known = knownCaptures() }) {
  const shown = path.relative(ROOT, to).split(path.sep).join('/') || to;
  let files;
  try {
    files = readInput(source);
  } catch (err) {
    return {
      exitCode: EXIT_NO_INPUT,
      lines: [`goldens-import: cannot read ${source}: ${err.message}`],
    };
  }
  if (files.length === 0) {
    return {
      exitCode: EXIT_NO_INPUT,
      lines: [`goldens-import: ${source} has no files in it; nothing placed.`],
    };
  }

  const { place, refused } = planImport(files, known);
  if (refused.length) {
    return {
      exitCode: EXIT_REFUSED,
      lines: [
        `goldens-import: refused ${refused.length} of ${files.length}; nothing placed.`,
        ...refused.map((r) => `  refused ${r.from}: ${r.reason}`),
      ],
    };
  }

  fs.mkdirSync(to, { recursive: true });
  const lines = [`goldens-import: placed ${place.length} into ${shown}/`];
  for (const file of [...place].sort((a, b) => a.name.localeCompare(b.name))) {
    fs.writeFileSync(path.join(to, file.name), file.bytes);
    lines.push(`  placed ${file.name.padEnd(24)} ${Math.round(file.bytes.length / 1024)} KB`);
  }
  const unbaked = known.filter((name) => !fs.existsSync(path.join(to, `${name}.png`)));
  lines.push(
    unbaked.length
      ? `goldens-import: still not baked: ${unbaked.join(', ')}`
      : `goldens-import: all ${known.length} captures now have a golden in ${shown}/`,
  );
  lines.push(`goldens-import: look at them, then commit ${shown}/`);
  return { exitCode: 0, lines };
}

const invokedDirectly =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const source = process.argv[2];
  if (!source || source.startsWith('-')) {
    process.stderr.write('usage: node scripts/goldens-import.mjs <dir-or-zip>\n');
    process.exit(EXIT_NO_INPUT);
  }
  const { exitCode, lines } = importGoldens({ source: path.resolve(source) });
  (exitCode ? process.stderr : process.stdout).write(`${lines.join('\n')}\n`);
  process.exitCode = exitCode;
}
