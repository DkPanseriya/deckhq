/**
 * THE 3D OFFICE AT FULL QUALITY ON THE SITE (`site/hq.mjs`,
 * `scripts/site-hq.mjs`): heavy clips that are not in the repository, listed
 * by hash, fetched by the deploy, and offered by screen.
 *
 * Nothing here needs the real files or the network: the stand-ins are the
 * 1280-pixel clips the repository does carry, listed under the full-quality
 * names, and the one download is a function handed in.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  BIG,
  HQ_BUDGET,
  HQ_DIR,
  HQ_MANIFEST,
  HQ_OUT,
  HQ_REPO,
  ROOM_CINEMA,
  clipSources,
  hqClip,
  hqHave,
  hqManifest,
  hqStill,
  releaseUrl,
  sha256File,
} from '../../site/hq.mjs';
import { MOTION, NARROW, WIDE, pageWeight } from '../../site/media.mjs';
import { checkHq, fetchHq, filesOf, importHq } from '../../scripts/site-hq.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const siteDir = path.join(root, 'site');
const clips3d = path.join(root, 'docs', 'media', 'site', '3d');
const read = (/** @type {string} */ rel) => fs.readFileSync(path.join(root, rel), 'utf8');

let tmp = '';
/** A folder as a recorder leaves it: `<name>-1440.mp4`, `<name>-2160.mp4`, a first frame. */
let recorded = '';
/** The same, brought in: the files under the site's names, and their list. */
let dir = '';
let manifest = '';
/** The site built without the files, and with them. */
let plain = '';
let full = '';

/** @param {string[]} args */
function build(args) {
  const out = fs.mkdtempSync(path.join(tmp, 'site-'));
  const run = spawnSync(
    process.execPath,
    [path.join(siteDir, 'build.mjs'), '--out', out, ...args],
    {
      cwd: root,
      encoding: 'utf8',
    },
  );
  assert.equal(run.status, 0, `site build failed:\n${run.stderr}`);
  return { out, log: run.stdout };
}

before(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-hq-'));
  recorded = path.join(tmp, 'recorded');
  dir = path.join(tmp, 'hq');
  manifest = path.join(tmp, '3d-hq.json');
  fs.mkdirSync(recorded);
  // Stand-ins: the repository's own clips and first frames, under a recorder's names.
  for (const name of ['rise', 'walkthrough', 'orbit', 'states']) {
    for (const size of name === 'states' ? [1440] : [1440, 2160]) {
      fs.copyFileSync(
        path.join(clips3d, `clip-${name}.mp4`),
        path.join(recorded, `${name}-${size}.mp4`),
      );
    }
  }
  fs.copyFileSync(
    path.join(clips3d, 'clip-rise@2x.png'),
    path.join(recorded, 'rise-first-2560.png'),
  );
  // …and a still at two widths, in a folder of its own, as a recorder leaves those.
  const stills = path.join(tmp, 'stills');
  fs.mkdirSync(stills);
  fs.copyFileSync(path.join(clips3d, 'office.png'), path.join(stills, 'office-2560.png'));
  fs.copyFileSync(path.join(clips3d, 'office@2x.png'), path.join(stills, 'office-3840.png'));
  importHq(recorded, {
    tag: 'site-media-test-1',
    clips: ['rise', 'walkthrough', 'orbit'],
    midOnly: ['states'],
    stills: ['office'],
    stillsFrom: stills,
    dir,
    manifest,
  });
  plain = build(['--hq', 'none']).out;
  full = build(['--hq', dir, '--hq-manifest', manifest]).out;
});

after(() => {
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
});

/** Every `<video>` of a built page, with the picture it lies over. @param {string} out */
function loopsOf(out) {
  const html = fs.readFileSync(path.join(out, '3d.html'), 'utf8');
  return [
    ...html.matchAll(/<span class="loop">(<img\b[^>]*>)(<video\b[^>]*>)([\s\S]*?)<\/video>/g),
  ].map((m) => ({
    img: m[1],
    video: m[2],
    sources: [...m[3].matchAll(/<source\b[^>]*>/g)].map((s) => ({
      src: /\ssrc="([^"]+)"/.exec(s[0])?.[1] ?? '',
      media: /\smedia="([^"]+)"/.exec(s[0])?.[1] ?? '',
      hq: /\sdata-hq\b/.test(s[0]),
    })),
  }));
}

// ------------------------------------------------------------------ the list

test('the list is refused whole when it names a file badly, twice, or without a hash', () => {
  const write = (/** @type {unknown} */ body) => {
    const file = path.join(tmp, `bad-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify(body));
    return file;
  };
  const good = {
    name: 'clip-a-1440.mp4',
    kind: 'clip',
    width: 2560,
    height: 1440,
    bytes: 9,
    sha256: 'a'.repeat(64),
  };
  assert.equal(hqManifest(write({ tag: 'site-media-1', files: [good] })).files.size, 1);
  // No list at all is a machine without the files, not an error.
  assert.deepEqual([...hqManifest(path.join(tmp, 'absent.json')).files], []);
  assert.throws(() => hqManifest(write({ tag: 'site-media-1', files: [good, good] })), /twice/);
  assert.throws(
    () => hqManifest(write({ tag: 'site-media-1', files: [{ ...good, sha256: 'abc' }] })),
    /hash/,
  );
  assert.throws(
    () => hqManifest(write({ tag: 'site-media-1', files: [{ ...good, bytes: 0 }] })),
    /size/,
  );
  assert.throws(
    () => hqManifest(write({ tag: 'site-media-1', files: [{ ...good, kind: 'film' }] })),
    /neither/,
  );
  assert.throws(() => hqManifest(write({ files: [good] })), /release tag/);
  // A name a release would rewrite, or one that climbs out of the folder.
  for (const name of [
    'clip-a@2x.png',
    '../clip-a.mp4',
    'clip a.mp4',
    'clip-a.exe',
    '.hidden.mp4',
  ]) {
    assert.throws(
      () => hqManifest(write({ tag: 'site-media-1', files: [{ ...good, name }] })),
      /safe name/,
      name,
    );
  }
});

test('a recorder’s folder is brought in under the site’s names, measured and hashed', () => {
  const { tag, files } = hqManifest(manifest);
  assert.equal(tag, 'site-media-test-1');
  assert.deepEqual(
    [...files.keys()],
    [
      'clip-orbit-1440.mp4',
      'clip-orbit-2160.mp4',
      'clip-rise-1440.mp4',
      'clip-rise-2160.mp4',
      'clip-rise-first-2560.png',
      'clip-states-1440.mp4',
      'clip-walkthrough-1440.mp4',
      'clip-walkthrough-2160.mp4',
      'office-2560.png',
      'office-3840.png',
    ],
  );
  for (const entry of files.values()) {
    const file = path.join(dir, entry.name);
    assert.equal(fs.statSync(file).size, entry.bytes, entry.name);
    assert.equal(sha256File(file), entry.sha256, entry.name);
    assert.ok(entry.width > 0 && entry.height > 0, `${entry.name} was not measured`);
    assert.equal(entry.kind, entry.name.endsWith('.png') ? 'still' : 'clip');
  }
  // A clip taken at 1440 only brings no 2160 file; a missing file is said.
  assert.deepEqual(
    filesOf(recorded, 'states', true).map((f) => f[1]),
    ['clip-states-1440.mp4'],
  );
  assert.throws(() => filesOf(recorded, 'states', false), /states-2160\.mp4 is not there/);
  assert.throws(
    () => importHq(recorded, { tag: 'No Tag', clips: [], midOnly: [], dir, manifest }),
    /--tag/,
  );
  // A still that is asked for and not there is said, and nothing is listed.
  const scratch = { dir: path.join(tmp, 'never'), manifest: path.join(tmp, 'never.json') };
  assert.throws(
    () => importHq(recorded, { tag: 't-1', clips: [], midOnly: [], stills: ['night'], ...scratch }),
    /has no night-<width>\.png/,
  );
  assert.equal(fs.existsSync(scratch.manifest), false);
});

test('INVARIANT: the files are used when every one is here at its listed size, and not otherwise', () => {
  assert.equal(hqHave({ dir, manifest }).size, 10);
  assert.equal(
    hqHave({ dir: null, manifest }).size,
    0,
    'a build asked to do without them used them',
  );
  // One file short, or one file the wrong size: none.
  const partial = path.join(tmp, 'partial');
  fs.cpSync(dir, partial, { recursive: true });
  fs.rmSync(path.join(partial, 'clip-orbit-2160.mp4'));
  assert.equal(hqHave({ dir: partial, manifest }).size, 0, 'a set with a file missing was used');
  fs.writeFileSync(path.join(partial, 'clip-orbit-2160.mp4'), 'short');
  assert.equal(hqHave({ dir: partial, manifest }).size, 0, 'a set with a truncated file was used');
  // And this repository carries the list at most, never the files.
  assert.match(read('.gitignore'), /^site\/hq\/$/m);
  assert.equal(path.relative(siteDir, HQ_DIR), 'hq');
  assert.equal(path.relative(siteDir, HQ_MANIFEST), '3d-hq.json');
  const tracked = spawnSync('git', ['ls-files', 'site/hq'], { cwd: root, encoding: 'utf8' });
  if (tracked.status === 0)
    assert.equal(tracked.stdout.trim(), '', 'a full-quality file is committed');
});

// ----------------------------------------------------------------- the fetch

test('SECURITY: a fetched file is kept only if it hashes to the listed value', async () => {
  const here = path.join(tmp, 'fetched');
  /** @type {string[]} */
  const asked = [];
  const honest = async (/** @type {string} */ url) => {
    asked.push(url);
    return fs.readFileSync(path.join(dir, path.basename(url)));
  };
  const done = await fetchHq({ dir: here, manifest, get: honest });
  assert.deepEqual([done.fetched, done.kept], [10, 0]);
  assert.deepEqual(checkHq({ dir: here, manifest }).ok.length, 10);
  // Every address is this repository's own release, named by the list's tag.
  for (const url of asked) {
    assert.ok(
      url.startsWith(`https://github.com/${HQ_REPO}/releases/download/site-media-test-1/`),
      url,
    );
  }
  assert.equal(
    releaseUrl('t-1', 'a.mp4'),
    `https://github.com/${HQ_REPO}/releases/download/t-1/a.mp4`,
  );
  // A second run asks for nothing.
  asked.length = 0;
  assert.deepEqual(await fetchHq({ dir: here, manifest, get: honest }), { fetched: 0, kept: 10 });
  assert.deepEqual(asked, []);

  // A file that changed on disk is fetched again; one the release serves wrong
  // is REFUSED and removed, so the set is incomplete and no build uses it.
  fs.writeFileSync(path.join(here, 'clip-rise-1440.mp4'), 'tampered');
  assert.deepEqual(checkHq({ dir: here, manifest }).wrong, ['clip-rise-1440.mp4']);
  const forged = async () => Buffer.from('not the clip');
  await assert.rejects(
    fetchHq({ dir: here, manifest, get: forged }),
    /not the file the list names/,
  );
  assert.equal(
    fs.existsSync(path.join(here, 'clip-rise-1440.mp4')),
    false,
    'a forged file was kept',
  );
  assert.equal(hqHave({ dir: here, manifest }).size, 0);
  // Same length, different bytes: the hash is what is compared, not the size.
  const sameSize = async (/** @type {string} */ url) => {
    const bytes = Buffer.from(fs.readFileSync(path.join(dir, path.basename(url))));
    bytes[bytes.length - 1] ^= 0xff;
    return bytes;
  };
  await assert.rejects(fetchHq({ dir: here, manifest, get: sameSize }), /refused/);
  assert.equal(fs.existsSync(path.join(here, 'clip-rise-1440.mp4')), false);
});

test('the deploy fetches them before it builds, and a failed fetch builds the site without them', () => {
  const workflow = read('.github/workflows/pages.yml');
  const fetchAt = workflow.indexOf('node scripts/site-hq.mjs fetch');
  const buildAt = workflow.indexOf('run: node site/build.mjs');
  assert.ok(fetchAt > 0 && buildAt > fetchAt, 'the clips are not fetched before the site is built');
  // Never a reason the site does not ship: the pages are whole without them.
  assert.match(workflow, /node scripts\/site-hq\.mjs fetch \|\| echo "::warning::/);
});

// ------------------------------------------------------------ what is offered

test('a clip’s sources are in the order a browser tries them: phone, dense wide stage, wide, small', () => {
  const o = { base: 'media/3d/clip-x.mp4', narrow: NARROW, motion: MOTION };
  // Not at full quality in this build: the one source it always had.
  assert.equal(
    clipSources({ ...o, mid: null, big: null, cinema: true }),
    `<source src="media/3d/clip-x.mp4" type="video/mp4" media="${MOTION}" />`,
  );
  const sources = (/** @type {string} */ html) =>
    [
      ...html.matchAll(/<source src="([^"]+)" type="video\/mp4" media="([^"]+)"( data-hq)? \/>/g),
    ].map((m) => [m[1], m[2], Boolean(m[3])]);
  const mid = `${HQ_OUT}/clip-x-1440.mp4`;
  const big = `${HQ_OUT}/clip-x-2160.mp4`;
  assert.deepEqual(sources(clipSources({ ...o, mid, big, cinema: true })), [
    ['media/3d/clip-x.mp4', `${NARROW} and ${MOTION}`, false],
    [big, BIG.map((q) => `${q} and ${MOTION}`).join(', '), true],
    [mid, MOTION, true],
    ['media/3d/clip-x.mp4', MOTION, false],
  ]);
  // Not in the wide stage: its box is never 2560 device pixels, so no 3840 file.
  assert.deepEqual(
    sources(clipSources({ ...o, mid, big, cinema: false })).map((s) => s[0]),
    ['media/3d/clip-x.mp4', mid, 'media/3d/clip-x.mp4'],
  );
  // EVERY source asks that the reader did not ask for less motion: a reader
  // who did is offered none, so nothing is fetched and the still is all there is.
  for (const [, media] of sources(clipSources({ ...o, mid, big, cinema: true }))) {
    for (const query of String(media).split(', ')) assert.ok(query.endsWith(MOTION), query);
  }
  // The dense queries are the widths at which the stage passes 2560 device pixels.
  assert.deepEqual(BIG, [
    '(min-width: 1800px) and (min-resolution: 1.5dppx)',
    '(min-width: 1400px) and (min-resolution: 2dppx)',
  ]);
});

test('built without the files, the 3D page is what it was: one source a clip, and no address under hq/', () => {
  const html = fs.readFileSync(path.join(plain, '3d.html'), 'utf8');
  assert.ok(!html.includes(HQ_OUT), 'a page names a full-quality file this build does not have');
  assert.equal(fs.existsSync(path.join(plain, HQ_OUT)), false);
  const loops = loopsOf(plain);
  assert.ok(loops.length >= 4);
  for (const loop of loops) {
    assert.equal(loop.sources.length, 1);
    assert.equal(loop.sources[0].hq, false);
  }
  assert.ok(!/data-stage/.test(html), 'an authoring attribute reached the page');
});

test('built with them, each clip is offered by screen, and every file a page names is published', () => {
  const html = fs.readFileSync(path.join(full, '3d.html'), 'utf8');
  assert.ok(!/data-stage/.test(html), 'an authoring attribute reached the page');
  const loops = loopsOf(full);
  const by = (/** @type {string} */ name) =>
    loops.find((l) => l.sources.some((s) => s.src === `media/3d/clip-${name}.mp4`));
  for (const name of ['rise', 'walkthrough', 'orbit']) {
    const loop = by(name);
    assert.ok(loop, `${name} is not on the page`);
    assert.deepEqual(
      loop.sources.map((s) => [s.src, s.hq]),
      [
        [`media/3d/clip-${name}.mp4`, false],
        [`${HQ_OUT}/clip-${name}-2160.mp4`, true],
        [`${HQ_OUT}/clip-${name}-1440.mp4`, true],
        [`media/3d/clip-${name}.mp4`, false],
      ],
    );
    // In the wide stage, and told so: its picture is offered for that room.
    assert.ok(loop.img.includes(`sizes="${ROOM_CINEMA}"`), `${name}: ${loop.img}`);
  }
  // The states are shown at half the column: 2560 is every pixel they can use.
  assert.deepEqual(
    by('states')?.sources.map((s) => s.src),
    ['media/3d/clip-states.mp4', `${HQ_OUT}/clip-states-1440.mp4`, 'media/3d/clip-states.mp4'],
  );
  // The first frame at full quality is one more width of the picture under the clip.
  assert.match(
    by('rise')?.img ?? '',
    /srcset="[^"]*media\/3d\/hq\/clip-rise-first-2560\.png \d+w"/,
  );
  // A STILL at full quality: every screen wider than a phone is offered its
  // two widths in place of the 256-colour pair, which stays for a phone.
  const office =
    /<picture>(<source\b[^>]*>)(<img\b[^>]*src="media\/3d\/office\.png"[^>]*>)<\/picture>/.exec(
      html,
    );
  assert.ok(office, 'the still that has full-quality files is not offered them');
  assert.ok(office[1].includes(`media="${WIDE}"`), office[1]);
  assert.match(
    office[1],
    /srcset="media\/3d\/hq\/office-2560\.png \d+w, media\/3d\/hq\/office-3840\.png \d+w"/,
  );
  assert.match(office[1], /\ssizes="[^"]+"/);
  assert.match(office[2], /srcset="media\/3d\/office\.png \d+w, media\/3d\/office@2x\.png \d+w"/);
  assert.match(office[2], /loading="lazy"/);
  assert.deepEqual(
    hqStill('office', hqHave({ dir, manifest })).map((s) => path.basename(s.src)),
    ['office-2560.png', 'office-3840.png'],
  );
  // A clip's first frame is not one of a still's files, and no name is a prefix of another's.
  assert.deepEqual(hqStill('clip-rise', hqHave({ dir, manifest })), []);
  assert.deepEqual(hqStill('off', hqHave({ dir, manifest })), []);
  // Only the first clip plays before a reader scrolls; the rest are not fetched until then.
  assert.match(loops[0].video, /\sautoplay\s/);
  for (const loop of loops.slice(1)) assert.match(loop.video, /preload="none"/);

  // Every address under hq/ is a file of the site, byte for byte the listed one.
  const named = new Set([...html.matchAll(/media\/3d\/hq\/[\w.-]+/g)].map((m) => m[0]));
  assert.equal(named.size, 10);
  const listed = hqManifest(manifest).files;
  for (const address of named) {
    const entry = listed.get(path.basename(address));
    assert.ok(entry, `${address} is not in the list`);
    assert.equal(sha256File(path.join(full, address)), entry.sha256, address);
  }
  assert.deepEqual(fs.readdirSync(path.join(full, HQ_OUT)).sort(), [...listed.keys()].sort());
  // No other page names one.
  for (const name of fs.readdirSync(full).filter((f) => f.endsWith('.html') && f !== '3d.html')) {
    assert.ok(!fs.readFileSync(path.join(full, name), 'utf8').includes(HQ_OUT), name);
  }
});

test('WEIGHT: the full-quality files are counted on their own, and a phone’s page does not change', () => {
  // What `pageWeight` counts is the page without them: the same clips, so the
  // same bytes but for the markup that names the extra sources.
  for (const opts of [{ all: true }, { all: false }, { all: true, narrow: true }]) {
    const a = pageWeight(plain, '3d.html', opts);
    const b = pageWeight(full, '3d.html', opts);
    assert.ok(b >= a && b - a < 8 * 1024, `${JSON.stringify(opts)}: ${a} without, ${b} with`);
  }
  // Their own ceilings: one file, and all of them.
  assert.ok(HQ_BUDGET.file <= 80 * 1024 * 1024, 'the ceiling on one full-quality file was raised');
  assert.ok(HQ_BUDGET.total <= 600 * 1024 * 1024, 'the ceiling on all of them was raised');
  const over = path.join(tmp, 'over.json');
  const { tag, files } = hqManifest(manifest);
  const heavy = [...files.values()].map((f, i) => (i ? f : { ...f, bytes: HQ_BUDGET.file + 1 }));
  fs.writeFileSync(over, JSON.stringify({ tag, files: heavy }));
  // (A list that lies about a size is a set that is not all here, so it is not used at all.)
  assert.equal(hqHave({ dir, manifest: over }).size, 0);
});

test('the list in the repository, when there is one, is a set this site can serve', () => {
  const { tag, files } = hqManifest();
  if (!files.size) return;
  assert.match(tag, /^site-media-3d-\d+$/);
  let total = 0;
  const page = read('site/pages/3d.html');
  for (const entry of files.values()) {
    assert.ok(entry.bytes <= HQ_BUDGET.file, `${entry.name} is over the ceiling for one file`);
    total += entry.bytes;
    const clip = /^(clip-[a-z]+)-/.exec(entry.name)?.[1];
    const still = /^([a-z-]+)-\d+\.png$/.exec(entry.name)?.[1];
    assert.ok(
      (clip && page.includes(clip)) || (still && page.includes(`media/3d/${still}.png`)),
      `${entry.name} is of a picture the 3D page does not show`,
    );
    if (!clip) assert.equal(entry.kind, 'still', entry.name);
    if (entry.kind === 'clip') {
      const height = Number(/-(\d+)\.mp4$/.exec(entry.name)?.[1]);
      assert.equal(entry.height, height, `${entry.name} is not ${height} pixels tall`);
      assert.equal(entry.width * 9, entry.height * 16, `${entry.name} is not sixteen to nine`);
    }
  }
  assert.ok(total <= HQ_BUDGET.total, `the set is ${total} bytes, over the ceiling`);
  // A clip offered at 2160 is one the page shows in the wide stage.
  for (const name of files.keys()) {
    const clip = /^(clip-[a-z]+)-2160\.mp4$/.exec(name)?.[1];
    if (!clip) continue;
    const tagOf =
      new RegExp(`<img\\b[^>]*(?:${clip}\\.png|data-clip="${clip}")[^>]*>`).exec(page)?.[0] ?? '';
    assert.match(
      tagOf,
      /data-stage="cinema"/,
      `${clip} has a 3840 file and is not in the wide stage`,
    );
    assert.ok(hqClip(clip, files).big, clip);
  }
});

// ------------------------------------------------------------- stage, script

test('the wide stage is wider than the column only on a wide window, and adds no sideways scroll', () => {
  const css = read('site/three-d.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const block = /@media \(min-width: 88rem\) \{\s*\.shot--cinema \{([^}]*)\}/.exec(css);
  assert.ok(block, 'the wide stage is not held to a wide window');
  assert.match(block[1], /--stage:\s*max\(\s*100%,/, 'the stage can be narrower than its column');
  assert.match(block[1], /120rem/);
  assert.match(block[1], /100vh/, 'the stage can be taller than the window');
  assert.match(block[1], /margin-inline:\s*calc\(\(100% - var\(--stage\)\) \/ 2\)/);
  // Centred with margins: a transform or an offset would widen the page.
  assert.doesNotMatch(block[1], /transform|left:/);
  assert.equal(
    css.split('.shot--cinema').length - 1,
    1,
    'the wide stage is styled outside its query',
  );
  // The three clips made to be seen large are in it; the states are not.
  const page = read('site/pages/3d.html');
  assert.equal(page.split('shot--cinema').length - 1, 3);
  assert.equal(page.split('data-stage="cinema"').length - 1, 3);
  assert.match(ROOM_CINEMA, /^\(min-width: 88rem\) min\(calc\(100vw - 6rem\), 120rem\), /);
});

test('the script steps a reader down only when their browser is set to save data', () => {
  const js = read('site/site.js');
  const code = js.replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(code, /link && link\.saveData/);
  assert.match(code, /source\[data-hq\]/);
  // The browser's guess at the connection is not used: it was measured wrong.
  assert.doesNotMatch(code, /effectiveType|downlink/);
  // And it still makes no network call of its own.
  assert.doesNotMatch(code, /\bfetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
});
