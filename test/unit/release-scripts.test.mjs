import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  GITHUB_RELEASE_BODY_LIMIT,
  PRECHECK_MAX_CHARS,
  RELEASE_BODY_BUDGET,
  changelogSection,
  githubAnchor,
  releaseBody,
  sectionChunks,
} from '../../scripts/release/changelog-section.mjs';
import {
  WINGET_ID,
  releaseMeta,
  renderFormula,
  renderScoop,
  renderWinget,
  writeManifests,
} from '../../scripts/release/manifests.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

const HEX_A = 'a'.repeat(64);
const HEX_B = 'B'.repeat(64);
const release = {
  version: '1.2.0',
  tarballUrl: 'https://registry.npmjs.org/deckhq/-/deckhq-1.2.0.tgz',
  tarballSha256: HEX_A,
  zipUrl: 'https://github.com/DkPanseriya/deckhq/releases/download/v1.2.0/deckhq-1.2.0-win.zip',
  zipSha256: HEX_B,
};

const SAMPLE = [
  '# Changelog',
  '',
  '## Unreleased',
  '',
  '- something pending',
  '',
  '## 1.2.0',
  '',
  'The release that can be installed.',
  '',
  '### Packaging',
  '',
  '- `publishConfig.access` is `public`.',
  '',
  '## [1.1.0] - 2026-08-30',
  '',
  '- older',
  '',
].join('\n');

// --- changelog-section ------------------------------------------------------

test('changelogSection() returns the body between a version heading and the next one', () => {
  assert.equal(
    changelogSection(SAMPLE, '1.2.0'),
    'The release that can be installed.\n\n### Packaging\n\n- `publishConfig.access` is `public`.',
  );
});

test('changelogSection() tolerates a leading v and bracketed headings, and matches whole versions only', () => {
  assert.equal(changelogSection(SAMPLE, 'v1.2.0'), changelogSection(SAMPLE, '1.2.0'));
  assert.equal(changelogSection(SAMPLE, '1.1.0'), '- older');
  assert.equal(changelogSection(SAMPLE, '1.2'), null, '1.2 must not match the 1.2.0 heading');
  assert.equal(changelogSection(SAMPLE, '9.9.9'), null);
  assert.equal(changelogSection(SAMPLE.replace(/\n/g, '\r\n'), '1.1.0'), '- older', 'CRLF input');
});

test('the version in package.json has a CHANGELOG.md section — the publish refuses without one', () => {
  const md = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  const body = changelogSection(md, pkg.version);
  assert.ok(
    body && body.length > 0,
    `CHANGELOG.md needs a "## ${pkg.version}" section before ${pkg.version} can be released`,
  );
  assert.ok(!/^## /m.test(body), 'the section must stop at the next version heading');
});

test('changelog-section.mjs CLI prints the section and exits 1 when it is missing', () => {
  const script = path.join(ROOT, 'scripts', 'release', 'changelog-section.mjs');
  const ok = spawnSync(process.execPath, [script, pkg.version], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.ok(ok.stdout.trim().length > 0);

  const missing = spawnSync(process.execPath, [script, '99.0.0'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /no "## 99\.0\.0" section/);
});

// --- the release body that always fits (docs/DEVIATIONS.md §138) ------------

const SCRIPT = path.join(ROOT, 'scripts', 'release', 'changelog-section.mjs');
const CHANGELOG = fs.readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8');

/** A changelog with a Highlights paragraph and, after it, 300 kB of bullets. */
function hugeChangelog() {
  const headings = [
    'Added',
    'Changed',
    'Fixed',
    'Performance',
    'Testing',
    'Packaging',
    'Repository',
  ];
  const lines = [
    '# Changelog',
    '',
    '## 9.9.9 — 2026-01-02',
    '',
    '### Highlights',
    '',
    'The paragraph a stranger reads. It is short, and it is never cut.',
    '',
  ];
  let n = 0;
  for (const heading of headings) {
    lines.push(`### ${heading}`, '');
    for (let i = 0; i < 15; i++) {
      n += 1;
      lines.push(
        `- **${heading} ${n}.** ${`the body of bullet ${n}. `.padEnd(2800, 'x')}`,
        `  a continuation line under bullet ${n}, indented as prettier leaves it.`,
        // The shape prettier produces when a wrapped line starts with a code
        // span: a continuation that is not indented at all.
        `\`a continuation wrapped back to column 0\` under bullet ${n}.`,
      );
    }
    lines.push('');
  }
  lines.push('## 1.0.0', '', '- the release before it', '');
  return { markdown: lines.join('\n'), bullets: n };
}

test('githubAnchor() slugs a heading the way GitHub does', () => {
  // The heading 1.3.0 actually ships under: the dots go, the em dash goes, and
  // the two spaces around it become two hyphens.
  assert.equal(githubAnchor('1.3.0 — 2026-09-04'), '130--2026-09-04');
  assert.equal(githubAnchor('1.2.0'), '120');
  assert.equal(githubAnchor('[1.1.0] - 2026-08-30'), '110---2026-08-30');
  assert.equal(githubAnchor('Known gaps'), 'known-gaps');
  assert.equal(githubAnchor('  Mixed CASE, punctuation!  '), 'mixed-case-punctuation');
  assert.equal(githubAnchor('a_b'), 'a_b', 'underscores survive');

  // And it is the anchor the real section's heading gets.
  const heading = CHANGELOG.split('\n').find((l) => /^## 1\.3\.0/.test(l));
  assert.ok(heading, 'CHANGELOG.md has a 1.3.0 heading');
  assert.equal(githubAnchor(heading.replace(/^##\s+/, '')), '130--2026-09-04');
});

test('a section already inside the budget is passed through whole, with no link', () => {
  const body = releaseBody(SAMPLE, '1.2.0');
  assert.equal(body, changelogSection(SAMPLE, '1.2.0'));
  assert.ok(!/Full notes for this release/.test(body), 'nothing to link to: it is all here');
  assert.equal(releaseBody(SAMPLE, '9.9.9'), null, 'a missing section is still null');
});

test('a 300 kB section becomes a body inside the budget, cut between bullets, ending in the link', () => {
  const { markdown, bullets } = hugeChangelog();
  const full = changelogSection(markdown, '9.9.9');
  assert.ok(full.length > 300_000, `the fixture is only ${full.length} characters`);

  const body = releaseBody(markdown, '9.9.9', { repoUrl: 'https://github.com/DkPanseriya/deckhq' });
  assert.ok(
    body.length <= RELEASE_BODY_BUDGET,
    `${body.length} characters is over the ${RELEASE_BODY_BUDGET} budget`,
  );
  assert.ok(body.length < GITHUB_RELEASE_BODY_LIMIT);

  const link =
    'Full notes for this release: ' +
    'https://github.com/DkPanseriya/deckhq/blob/v9.9.9/CHANGELOG.md#999--2026-01-02';
  assert.ok(body.endsWith(`\n\n${link}`), `body ends with:\n${body.slice(-200)}`);

  // The Highlights block, whole and first.
  assert.match(
    body,
    /^### Highlights\n\nThe paragraph a stranger reads\. It is short, and it is never cut\.\n/,
  );

  // Every bullet that made it is a whole bullet from the source, and they are
  // a prefix of the source's bullets in the order the headings appear.
  const kept = sectionChunks(body.slice(0, body.length - link.length - 2)).filter(
    (c) => c.kind === 'bullet',
  );
  assert.ok(kept.length > 0 && kept.length < bullets, `${kept.length} of ${bullets} bullets kept`);
  for (const chunk of kept)
    assert.ok(full.includes(chunk.text), `a bullet was cut:\n${chunk.text}`);
  const sourceBullets = sectionChunks(full).filter((c) => c.kind === 'bullet');
  assert.deepEqual(
    kept.map((c) => c.text),
    sourceBullets.slice(0, kept.length).map((c) => c.text),
    'the bullets kept are the first ones, in heading order',
  );

  // And the headings above them came too, in order, with none left dangling.
  const rows = body.split('\n');
  const headings = rows.filter((l) => /^### /.test(l));
  assert.equal(headings[0], '### Highlights');
  assert.deepEqual(headings, [...new Set(headings)], 'no heading appears twice');
  assert.ok(headings.length > 1 && headings.length < 8, `${headings.length} headings kept`);
  for (let i = 0; i < rows.length; i++) {
    if (!/^### /.test(rows[i])) continue;
    const next = rows.slice(i + 1).find((line) => line.trim() !== '');
    assert.ok(
      next && !/^### /.test(next) && !next.startsWith('Full notes'),
      `${rows[i]} was kept with nothing under it`,
    );
  }
});

test('the real 1.3.0 release body fits, and the pre-check the publish job runs says so', () => {
  const body = releaseBody(CHANGELOG, '1.3.0');
  const full = changelogSection(CHANGELOG, '1.3.0');
  console.log(
    `[release body] 1.3.0: section ${full.length} chars -> body ${body.length} chars ` +
      `(budget ${RELEASE_BODY_BUDGET}, pre-check ${PRECHECK_MAX_CHARS}, GitHub ${GITHUB_RELEASE_BODY_LIMIT})`,
  );
  assert.ok(body.length <= RELEASE_BODY_BUDGET, `${body.length} characters is over budget`);
  assert.match(
    body,
    /\nFull notes for this release: https:\/\/github\.com\/DkPanseriya\/deckhq\/blob\/v1\.3\.0\/CHANGELOG\.md#130--2026-09-04$/,
  );

  // The exact command .github/workflows/publish.yml runs before `npm publish`.
  const precheck = spawnSync(
    process.execPath,
    [SCRIPT, '--release-body', '--max-chars', String(PRECHECK_MAX_CHARS), pkg.version],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  assert.equal(precheck.status, 0, precheck.stderr);
  assert.ok(precheck.stdout.length <= PRECHECK_MAX_CHARS);
});

test('the pre-check exits 1 on an oversize body, and 1 on a missing section', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-notes-'));
  try {
    const file = path.join(dir, 'CHANGELOG.md');
    fs.writeFileSync(file, hugeChangelog().markdown);

    // A body over the limit fails the job, and says by how much.
    const over = spawnSync(
      process.execPath,
      [SCRIPT, '--release-body', '--max-chars', '1000', '9.9.9', file],
      { cwd: ROOT, encoding: 'utf8' },
    );
    assert.equal(over.status, 1, 'an oversize release body must fail the publish job');
    assert.match(over.stderr, /release body for 9\.9\.9 is \d+ characters, over the 1000/);
    assert.equal(over.stdout, '', 'and nothing is written for a caller to redirect into a file');

    // Under it, the same command is quiet and successful.
    const under = spawnSync(
      process.execPath,
      [SCRIPT, '--release-body', '--max-chars', String(PRECHECK_MAX_CHARS), '9.9.9', file],
      { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
    );
    assert.equal(under.status, 0, under.stderr);
    assert.ok(under.stdout.length <= PRECHECK_MAX_CHARS);

    // A missing section is still the older failure, with the older message.
    const missing = spawnSync(process.execPath, [SCRIPT, '--release-body', '4.5.6', file], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /no "## 4\.5\.6" section/);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('publish.yml runs the capped command before the publish, and for the notes', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'publish.yml'), 'utf8');
  const precheck = yml.indexOf('--release-body --max-chars 120000');
  const publish = yml.indexOf('run: npm publish --access public');
  assert.ok(precheck > 0, 'the publish job pre-checks the release body');
  assert.ok(precheck < publish, 'and it does so BEFORE npm publish');
  assert.match(
    yml,
    /changelog-section\.mjs --release-body "\$\{GITHUB_REF_NAME#v\}" > dist\/notes\.md/,
  );
  assert.match(yml, /--notes-file dist\/notes\.md/);
  assert.equal(
    PRECHECK_MAX_CHARS,
    120_000,
    'the number in the workflow and the number here are one number',
  );
});

// --- manifests --------------------------------------------------------------

test('releaseMeta() derives the repository URL and rejects malformed digests', () => {
  const m = releaseMeta(pkg, release);
  assert.equal(m.repoUrl, 'https://github.com/DkPanseriya/deckhq');
  assert.equal(m.issuesUrl, pkg.bugs.url);
  assert.equal(m.zipSha256, HEX_B.toLowerCase(), 'digests are normalised to lower case');
  assert.throws(() => releaseMeta(pkg, { ...release, tarballSha256: 'nope' }), /64 hex/);
  assert.throws(() => releaseMeta(pkg, { ...release, zipUrl: '' }), /zipUrl is required/);
  assert.equal(releaseMeta(pkg, { ...release, version: 'v1.2.0' }).version, '1.2.0');
});

test('the Homebrew formula points at the registry tarball and depends on node alone', () => {
  const rb = renderFormula(releaseMeta(pkg, release));
  assert.match(rb, /^class Deckhq < Formula$/m);
  assert.match(rb, new RegExp(`^  url "${release.tarballUrl.replace(/[./]/g, '\\$&')}"$`, 'm'));
  assert.match(rb, new RegExp(`^  sha256 "${HEX_A}"$`, 'm'));
  assert.match(rb, /^  license "MIT"$/m);
  assert.match(rb, /^  depends_on "node"$/m);
  assert.equal((rb.match(/depends_on/g) || []).length, 1, 'one dependency, and it is node');
  assert.match(rb, /std_npm_args/);
  const desc = /^  desc "(.*)"$/m.exec(rb);
  assert.ok(desc, 'formula has a desc');
  assert.ok(!desc[1].endsWith('.'), 'Homebrew desc has no trailing period');
});

test('the winget manifest is three documents over the Windows zip with Node as a dependency', () => {
  const { version, installer, locale } = renderWinget(releaseMeta(pkg, release));
  for (const doc of [version, installer, locale]) {
    assert.match(doc, new RegExp(`^PackageIdentifier: ${WINGET_ID}$`, 'm'));
    assert.match(doc, /^PackageVersion: "1\.2\.0"$/m);
    assert.match(doc, /^ManifestVersion: 1\.6\.0$/m);
    assert.ok(!/\t/.test(doc), 'YAML must not contain tabs');
    for (const line of doc.split('\n')) {
      if (line === '' || line.startsWith('#')) continue;
      const keyValue = /^( {2,})?(- )?[A-Za-z][A-Za-z0-9]*: ?/.test(line);
      const scalarItem = /^ {2,}- ".*"$/.test(line);
      assert.ok(keyValue || scalarItem, `not a key/value or list line: ${line}`);
    }
  }
  assert.match(version, /^ManifestType: version$/m);
  assert.match(installer, /^ManifestType: installer$/m);
  assert.match(locale, /^ManifestType: defaultLocale$/m);

  assert.match(installer, /^InstallerType: zip$/m);
  assert.match(installer, /^NestedInstallerType: portable$/m);
  assert.match(installer, /^  - RelativeFilePath: deckhq\.cmd$/m);
  assert.match(installer, /^    PortableCommandAlias: deckhq$/m);
  assert.match(installer, /^    - PackageIdentifier: OpenJS\.NodeJS\.LTS$/m);
  assert.match(
    installer,
    new RegExp(`^    InstallerUrl: "${release.zipUrl.replace(/[./]/g, '\\$&')}"$`, 'm'),
  );
  assert.match(installer, new RegExp(`^    InstallerSha256: ${HEX_B.toUpperCase()}$`, 'm'));

  const short = /^ShortDescription: "(.*)"$/m.exec(locale);
  assert.ok(short && short[1].length > 0 && short[1].length <= 256);
  assert.match(locale, /^License: "MIT"$/m);
  assert.match(locale, /^Publisher: "Darshak Panseriya"$/m);
  assert.match(
    locale,
    /^ReleaseNotesUrl: "https:\/\/github\.com\/DkPanseriya\/deckhq\/releases\/tag\/v1\.2\.0"$/m,
  );
});

test('the scoop manifest is valid JSON over the same zip and shims deckhq.cmd as deckhq', () => {
  const scoop = JSON.parse(renderScoop(releaseMeta(pkg, release)));
  assert.equal(scoop.version, '1.2.0');
  assert.equal(scoop.url, release.zipUrl);
  assert.equal(scoop.hash, `sha256:${HEX_B.toLowerCase()}`);
  assert.equal(scoop.depends, 'nodejs-lts');
  assert.deepEqual(scoop.bin, [['deckhq.cmd', 'deckhq']]);
  assert.equal(scoop.license, 'MIT');
  assert.match(
    scoop.autoupdate.url,
    /\/releases\/download\/v\$version\/deckhq-\$version-win\.zip$/,
  );
  assert.equal(scoop.checkver.github, 'https://github.com/DkPanseriya/deckhq');
});

test('writeManifests() lays out the five files the release job uploads', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'deckhq-manifests-'));
  try {
    const written = writeManifests(releaseMeta(pkg, release), dir);
    assert.deepEqual(written, [
      'Formula/deckhq.rb',
      `winget/${WINGET_ID}.yaml`,
      `winget/${WINGET_ID}.installer.yaml`,
      `winget/${WINGET_ID}.locale.en-US.yaml`,
      'scoop/deckhq.json',
    ]);
    for (const rel of written) {
      const stat = fs.statSync(path.join(dir, rel));
      assert.ok(stat.size > 0, `${rel} is empty`);
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
});

test('the Windows launcher runs the bin the package actually ships', () => {
  const cmd = fs.readFileSync(path.join(ROOT, 'packaging', 'deckhq.cmd'), 'utf8');
  // The zip is the tarball's contents (a `package/` directory) plus this file
  // beside it, so the launcher's path has to agree with package.json's bin.
  assert.equal(pkg.bin.deckhq, 'bin/deckhq.mjs');
  assert.match(cmd, /"%~dp0package\\bin\\deckhq\.mjs" %\*/);
  assert.ok(pkg.files.includes('bin'), 'bin/ must be in the tarball for the launcher to find it');
});
