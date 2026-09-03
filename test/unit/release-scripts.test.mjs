import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { changelogSection } from '../../scripts/release/changelog-section.mjs';
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
