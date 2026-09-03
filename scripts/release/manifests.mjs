#!/usr/bin/env node
/**
 * Render the package-manager manifests for one release: a Homebrew formula,
 * a three-file winget manifest and a scoop manifest. publish.yml runs this
 * after the npm publish, with the sha256 of the tarball the registry actually
 * serves and of the Windows zip the job built from it, and uploads the output
 * as release assets. packaging/README.md says what a user does with each.
 *
 *   node scripts/release/manifests.mjs \
 *     --version 1.2.0 \
 *     --tarball-url https://registry.npmjs.org/deckhq/-/deckhq-1.2.0.tgz \
 *     --tarball-sha256 <hex> \
 *     --zip-url https://github.com/DkPanseriya/deckhq/releases/download/v1.2.0/deckhq-1.2.0-win.zip \
 *     --zip-sha256 <hex> \
 *     --out dist
 *
 * Every value that lands in YAML goes through JSON.stringify: a JSON string is
 * a valid YAML double-quoted scalar, so an apostrophe or a colon in the
 * description can never break the manifest.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The winget package identifier: publisher segment, then package name. */
export const WINGET_ID = 'DkPanseriya.DeckHQ';
/** Homebrew formula class name, which Homebrew derives from the file name. */
export const FORMULA_CLASS = 'Deckhq';

/**
 * @typedef {object} ReleaseMeta
 * @property {string} version         `1.2.0`
 * @property {string} tarballUrl      the registry tarball
 * @property {string} tarballSha256   its sha256, hex
 * @property {string} zipUrl          the Windows zip attached to the release
 * @property {string} zipSha256       its sha256, hex
 * @property {string} description     package.json description
 * @property {string} homepage        package.json homepage
 * @property {string} repoUrl         https://github.com/<owner>/<repo>
 * @property {string} issuesUrl       package.json bugs.url
 * @property {string} license         `MIT`
 * @property {string} author          package.json author
 * @property {string[]} keywords      package.json keywords
 */

/** @param {any} pkg the parsed package.json */
export function repoUrlOf(pkg) {
  const raw = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url || '';
  return raw.replace(/^git\+/, '').replace(/\.git$/, '');
}

/**
 * Build the metadata block from package.json plus the per-release inputs.
 * @param {any} pkg
 * @param {{version: string, tarballUrl: string, tarballSha256: string, zipUrl: string, zipSha256: string}} release
 * @returns {ReleaseMeta}
 */
export function releaseMeta(pkg, release) {
  for (const key of ['version', 'tarballUrl', 'tarballSha256', 'zipUrl', 'zipSha256']) {
    if (!release[key]) throw new Error(`releaseMeta: ${key} is required`);
  }
  for (const key of ['tarballSha256', 'zipSha256']) {
    if (!/^[0-9a-f]{64}$/i.test(release[key])) {
      throw new Error(`releaseMeta: ${key} must be 64 hex characters, got ${release[key]}`);
    }
  }
  const repoUrl = repoUrlOf(pkg);
  return {
    version: release.version.replace(/^v/, ''),
    tarballUrl: release.tarballUrl,
    tarballSha256: release.tarballSha256.toLowerCase(),
    zipUrl: release.zipUrl,
    zipSha256: release.zipSha256.toLowerCase(),
    description: String(pkg.description || ''),
    homepage: String(pkg.homepage || repoUrl),
    repoUrl,
    issuesUrl: String(pkg.bugs?.url || `${repoUrl}/issues`),
    license: String(pkg.license || 'MIT'),
    author: String(pkg.author || ''),
    keywords: Array.isArray(pkg.keywords) ? pkg.keywords.map(String) : [],
  };
}

/** Homebrew's `desc` is short, one sentence, no trailing period. */
function shortDescription(description) {
  const first = description.split(/(?<=\.)\s/)[0] || description;
  return first.replace(/\.$/, '');
}

/**
 * Homebrew formula over the npm tarball. `std_npm_args` installs into libexec
 * and the bin symlink exposes `deckhq`; `node` is the only dependency, which
 * is the whole point of the package.
 * @param {ReleaseMeta} m
 */
export function renderFormula(m) {
  return `class ${FORMULA_CLASS} < Formula
  desc ${JSON.stringify(shortDescription(m.description))}
  homepage ${JSON.stringify(m.homepage)}
  url ${JSON.stringify(m.tarballUrl)}
  sha256 ${JSON.stringify(m.tarballSha256)}
  license ${JSON.stringify(m.license)}

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/deckhq --version")
  end
end
`;
}

/** @param {string} s */
const y = (s) => JSON.stringify(String(s));

/**
 * winget's multi-file manifest, schema 1.6.0. The installer is the release
 * zip: the npm tarball's contents plus `deckhq.cmd`, which winget exposes as
 * the `deckhq` command. Node is declared as a package dependency rather than
 * bundled — that is what keeps the zip a few hundred kilobytes and the
 * installed tool identical to what `npx deckhq` runs.
 * @param {ReleaseMeta} m
 * @returns {{version: string, installer: string, locale: string}}
 */
export function renderWinget(m) {
  const head = `PackageIdentifier: ${WINGET_ID}\nPackageVersion: ${y(m.version)}\n`;
  const version =
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.version.1.6.0.schema.json\n` +
    head +
    `DefaultLocale: en-US\n` +
    `ManifestType: version\n` +
    `ManifestVersion: 1.6.0\n`;
  const installer =
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.installer.1.6.0.schema.json\n` +
    head +
    `InstallerType: zip\n` +
    `NestedInstallerType: portable\n` +
    `NestedInstallerFiles:\n` +
    `  - RelativeFilePath: deckhq.cmd\n` +
    `    PortableCommandAlias: deckhq\n` +
    `Dependencies:\n` +
    `  PackageDependencies:\n` +
    `    - PackageIdentifier: OpenJS.NodeJS.LTS\n` +
    `Installers:\n` +
    `  - Architecture: neutral\n` +
    `    InstallerUrl: ${y(m.zipUrl)}\n` +
    `    InstallerSha256: ${m.zipSha256.toUpperCase()}\n` +
    `ManifestType: installer\n` +
    `ManifestVersion: 1.6.0\n`;
  const tags = m.keywords
    .slice(0, 16)
    .map((k) => `  - ${y(k.slice(0, 40))}\n`)
    .join('');
  const locale =
    `# yaml-language-server: $schema=https://aka.ms/winget-manifest.defaultLocale.1.6.0.schema.json\n` +
    head +
    `PackageLocale: en-US\n` +
    `Publisher: ${y(m.author)}\n` +
    `PublisherUrl: ${y(m.repoUrl.replace(/\/[^/]+$/, ''))}\n` +
    `PublisherSupportUrl: ${y(m.issuesUrl)}\n` +
    `PackageName: DeckHQ\n` +
    `PackageUrl: ${y(m.homepage)}\n` +
    `License: ${y(m.license)}\n` +
    `LicenseUrl: ${y(`${m.repoUrl}/blob/main/LICENSE`)}\n` +
    `ShortDescription: ${y(shortDescription(m.description).slice(0, 256))}\n` +
    `Description: ${y(m.description)}\n` +
    (tags ? `Tags:\n${tags}` : '') +
    `ReleaseNotesUrl: ${y(`${m.repoUrl}/releases/tag/v${m.version}`)}\n` +
    `ManifestType: defaultLocale\n` +
    `ManifestVersion: 1.6.0\n`;
  return { version, installer, locale };
}

/**
 * scoop manifest over the same zip. `depends` pulls Node from the main bucket;
 * `bin` shims `deckhq.cmd` as `deckhq`. `checkver`/`autoupdate` let a bucket
 * pick up the next release from GitHub on its own.
 * @param {ReleaseMeta} m
 */
export function renderScoop(m) {
  const manifest = {
    version: m.version,
    description: m.description,
    homepage: m.homepage,
    license: m.license,
    url: m.zipUrl,
    hash: `sha256:${m.zipSha256}`,
    depends: 'nodejs-lts',
    bin: [['deckhq.cmd', 'deckhq']],
    checkver: { github: m.repoUrl },
    autoupdate: {
      url: `${m.repoUrl}/releases/download/v$version/deckhq-$version-win.zip`,
    },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/**
 * Write every manifest under `outDir`. Returns the relative paths written.
 * @param {ReleaseMeta} m
 * @param {string} outDir
 */
export function writeManifests(m, outDir) {
  const winget = renderWinget(m);
  /** @type {Array<[string, string]>} */
  const files = [
    ['Formula/deckhq.rb', renderFormula(m)],
    [`winget/${WINGET_ID}.yaml`, winget.version],
    [`winget/${WINGET_ID}.installer.yaml`, winget.installer],
    [`winget/${WINGET_ID}.locale.en-US.yaml`, winget.locale],
    ['scoop/deckhq.json', renderScoop(m)],
  ];
  for (const [rel, body] of files) {
    const full = path.join(outDir, rel);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, body, 'utf8');
  }
  return files.map(([rel]) => rel);
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {Record<string, string>} */
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument ${a}`);
    const key = a.slice(2).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--'))
      throw new Error(`--${a.slice(2)} needs a value`);
    out[key] = value;
    i++;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const meta = releaseMeta(pkg, {
    version: args.version || pkg.version,
    tarballUrl: args.tarballUrl,
    tarballSha256: args.tarballSha256,
    zipUrl: args.zipUrl,
    zipSha256: args.zipSha256,
  });
  const outDir = path.resolve(args.out || 'dist');
  for (const rel of writeManifests(meta, outDir)) {
    process.stdout.write(`${path.join(outDir, rel)}\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main();
  } catch (err) {
    process.stderr.write(`manifests.mjs: ${err && err.message ? err.message : err}\n`);
    process.exitCode = 1;
  }
}
