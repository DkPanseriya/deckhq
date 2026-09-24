/**
 * `scripts/goldens-import.mjs` — the step between the bake workflow's artifact
 * and a committed linux set.
 *
 * Nothing here runs a browser. The files are fake: a PNG signature and a few
 * bytes, under real capture names, because what is being held is the rule
 * about NAMES and about all-or-nothing — not what a golden looks like.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

import {
  EXIT_NO_INPUT,
  EXIT_REFUSED,
  importGoldens,
  knownCaptures,
  readZip,
} from '../../scripts/goldens-import.mjs';

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(REPO, 'scripts', 'goldens-import.mjs');
const KNOWN = ['demo', 'empty', 'three@selected', 'demo@night-shift'];
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('not really an image, but it starts like one'),
]);

/** @type {string[]} */
const made = [];
test.after(() => {
  for (const dir of made) fs.rmSync(dir, { recursive: true, force: true });
});

/** A fresh temp directory holding `files` ({relative path: bytes}). */
function tempWith(/** @type {Record<string, Buffer|string>} */ files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-goldens-import-'));
  made.push(dir);
  for (const [rel, bytes] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), bytes);
  }
  return dir;
}

/**
 * A minimal zip: each entry stored or deflated, CRC left at 0 (the reader does
 * not check it; each PNG carries its own chunk CRCs).
 * @param {{name:string, bytes:Buffer, deflate?:boolean}[]} entries
 */
function zipOf(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, bytes, deflate } of entries) {
    const data = deflate ? deflateRawSync(bytes) : bytes;
    const nameBytes = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(bytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(deflate ? 8 : 0, 10);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(bytes.length, 24);
    head.writeUInt16LE(nameBytes.length, 28);
    head.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, data);
    central.push(head, nameBytes);
    offset += 30 + nameBytes.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

test('the known captures come from goldens.mjs, and cover every committed golden', () => {
  const known = knownCaptures();
  assert.ok(known.includes('demo') && known.includes('board'), known.join(', '));
  const committed = fs
    .readdirSync(path.join(REPO, 'test', 'goldens', 'win32'))
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.slice(0, -4));
  // Every capture the Windows set has is a name the importer would accept.
  assert.deepEqual(
    committed.filter((name) => !known.includes(name)),
    [],
  );
});

test('a directory of <capture>.png files is placed, and what is still unbaked is named', () => {
  const from = tempWith({ 'demo.png': PNG, 'nested/three@selected.png': PNG });
  const to = tempWith({});
  const { exitCode, lines } = importGoldens({ source: from, to, known: KNOWN });
  assert.equal(exitCode, 0, lines.join('\n'));
  assert.deepEqual(fs.readdirSync(to).sort(), ['demo.png', 'three@selected.png']);
  assert.ok(fs.readFileSync(path.join(to, 'demo.png')).equals(PNG));
  assert.match(lines[0], /placed 2 into/);
  assert.match(lines.join('\n'), /still not baked: empty, demo@night-shift/);
});

test('a complete set says so', () => {
  const from = tempWith(Object.fromEntries(KNOWN.map((n) => [`${n}.png`, PNG])));
  const to = tempWith({});
  const { exitCode, lines } = importGoldens({ source: from, to, known: KNOWN });
  assert.equal(exitCode, 0);
  assert.match(lines.join('\n'), /all 4 captures now have a golden/);
});

test('one file that is not a known capture name refuses the whole import', () => {
  const from = tempWith({ 'demo.png': PNG, 'demo-old.png': PNG, 'README.txt': 'hi' });
  const to = tempWith({});
  const { exitCode, lines } = importGoldens({ source: from, to, known: KNOWN });
  assert.equal(exitCode, EXIT_REFUSED);
  assert.deepEqual(fs.readdirSync(to), [], 'nothing placed, not even the good one');
  const text = lines.join('\n');
  assert.match(text, /refused 2 of 3; nothing placed/);
  assert.match(text, /demo-old\.png: not <capture>\.png/);
  assert.match(text, /README\.txt: not <capture>\.png/);
});

test('a check run’s .actual.png and .diff.png are refused by name', () => {
  const from = tempWith({ 'linux/demo.actual.png': PNG, 'linux/demo.diff.png': PNG });
  const { exitCode, lines } = importGoldens({ source: from, to: tempWith({}), known: KNOWN });
  assert.equal(exitCode, EXIT_REFUSED);
  assert.equal(lines.filter((l) => /not a bake/.test(l)).length, 2, lines.join('\n'));
});

test('a known name that is not a PNG is refused', () => {
  const from = tempWith({ 'demo.png': 'plain text' });
  const { exitCode, lines } = importGoldens({ source: from, to: tempWith({}), known: KNOWN });
  assert.equal(exitCode, EXIT_REFUSED);
  assert.match(lines.join('\n'), /is not a PNG/);
});

test('the same capture twice in one input is refused', () => {
  const from = tempWith({ 'a/demo.png': PNG, 'b/demo.png': PNG });
  const { exitCode, lines } = importGoldens({ source: from, to: tempWith({}), known: KNOWN });
  assert.equal(exitCode, EXIT_REFUSED);
  assert.match(lines.join('\n'), /a second demo\.png/);
});

test('an empty input, or a path that is not there, exits non-zero and places nothing', () => {
  const to = tempWith({});
  const empty = importGoldens({ source: tempWith({}), to, known: KNOWN });
  assert.equal(empty.exitCode, EXIT_NO_INPUT);
  assert.match(empty.lines[0], /has no files in it/);
  const gone = importGoldens({
    source: path.join(os.tmpdir(), 'deckhq-no-such-artifact'),
    to,
    known: KNOWN,
  });
  assert.equal(gone.exitCode, EXIT_NO_INPUT);
  assert.deepEqual(fs.readdirSync(to), []);
});

test('a zip, stored or deflated, is read the same as the directory it came from', () => {
  const big = Buffer.concat([PNG, Buffer.alloc(4096, 7)]);
  const zip = zipOf([
    { name: 'demo.png', bytes: PNG },
    { name: 'three@selected.png', bytes: big, deflate: true },
  ]);
  const read = readZip(zip);
  assert.deepEqual(
    read.map((f) => f.name),
    ['demo.png', 'three@selected.png'],
  );
  assert.ok(read[1].bytes.equals(big));

  const file = path.join(tempWith({}), 'goldens-linux-abc123.zip');
  fs.writeFileSync(file, zip);
  const to = tempWith({});
  const { exitCode, lines } = importGoldens({ source: file, to, known: KNOWN });
  assert.equal(exitCode, 0, lines.join('\n'));
  assert.deepEqual(fs.readdirSync(to).sort(), ['demo.png', 'three@selected.png']);
});

test('a file that is neither a directory nor a zip is refused as unreadable', () => {
  const file = path.join(tempWith({ 'x.png': PNG }), 'x.png');
  const { exitCode, lines } = importGoldens({ source: file, to: tempWith({}), known: KNOWN });
  assert.equal(exitCode, EXIT_NO_INPUT);
  assert.match(lines[0], /not a zip archive/);
});

test('the command line exits non-zero with no argument and on an empty directory', () => {
  const bare = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(bare.status, EXIT_NO_INPUT);
  assert.match(bare.stderr, /usage/);
  const empty = spawnSync(process.execPath, [SCRIPT, tempWith({})], { encoding: 'utf8' });
  assert.equal(empty.status, EXIT_NO_INPUT, empty.stderr);
  assert.match(empty.stderr, /has no files in it/);
});

// ----------------------------------------------- the workflows around it

/** @param {string} name */
const workflow = (name) => fs.readFileSync(path.join(REPO, '.github', 'workflows', name), 'utf8');

test('the bake workflow is manual, read-only, never pushes, and uploads goldens-linux-<sha>', () => {
  const yml = workflow('goldens-bake.yml').replace(/\r\n/g, '\n');
  assert.match(yml, /^on:\n {2}workflow_dispatch:/m);
  assert.match(yml, /^permissions:\n {2}contents: read$/m);
  assert.doesNotMatch(yml, /: write\b|git push|git commit/);
  assert.match(yml, /npm run goldens -- /);
  assert.doesNotMatch(yml, /goldens:check|--check/);
  assert.match(yml, /name: goldens-linux-\$\{\{ github\.sha \}\}/);
  assert.match(yml, /path: test\/goldens\/linux\/\n/);
  assert.match(yml, /retention-days: 7\n/);
  // The input reaches the shell through the environment, never the script text.
  assert.doesNotMatch(yml, /run: [^\n]*\$\{\{ inputs\./);
  assert.match(yml, /POPULATIONS: \$\{\{ inputs\.populations \}\}/);
});

test('--strict runs on a v* tag only once a linux PNG exists, and never on a push', () => {
  const ci = workflow('ci.yml').replace(/\r\n/g, '\n');
  assert.match(ci, /run: npm run goldens:check -- --verbose\n/);
  assert.doesNotMatch(ci.replace(/^\s*#.*$/gm, ''), /--strict/);

  const publish = workflow('publish.yml').replace(/\r\n/g, '\n');
  assert.match(publish, /^on:\n {2}push:\n {4}tags: \['v\*'\]/m);
  assert.match(publish, /find test\/goldens\/linux -maxdepth 1 -name '\*\.png'/);
  assert.match(publish, /npm run goldens:check -- --verbose --strict\n/);
  assert.match(publish, /npm run goldens:check -- --verbose\n/);
  assert.match(publish, /needs: \[verify, goldens\]/);
});
