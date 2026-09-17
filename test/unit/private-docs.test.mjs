/**
 * The public tree stands on its own — WP-95b.
 *
 * The owner's ask: *"The website is purely public marketing. Do not put
 * requirements and architecture docs. We only put the product public and its
 * features. Although it is public on GitHub, I would not give the blueprint so
 * anybody can build it."* WP-95a took the blueprint off the site and the
 * README; this package took it out of the repository. The planning documents
 * now live in their own git repository, mounted at `internal/` on a
 * maintainer's machine and absent everywhere else.
 *
 * Two things have to stay true, and this file is what holds them.
 *
 *  1. **No blueprint document is in the public tree.** A path that comes back
 *     is either a document that was never moved or one that has come back.
 *  2. **Nothing public depends on `internal/`.** Every gate — lint, format,
 *     typecheck, the suite, the site build, the tarball — passes on a clone
 *     that has never seen the private repository. The one test that reads
 *     those documents lives inside `internal/` and runs only when it is
 *     mounted; the check below says so out loud rather than passing silently.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const internal = path.join(root, 'internal');
const hasInternal = fs.existsSync(internal);

/** Every path WP-95b moved out. None of them may be in the public tree again. */
const MOVED = [
  'docs/00-REQUIREMENTS.md',
  'docs/01-PRODUCT.md',
  'docs/02-ARCHITECTURE.md',
  'docs/03-VISUAL-SPEC.md',
  'docs/04-BUILD-PLAN.md',
  'docs/05-LAYOUT-REWORK.md',
  'docs/06-RELAY-DESIGN.md',
  'docs/07-STUDIO-DESIGN.md',
  'docs/DEVIATIONS.md',
  'docs/MEDIA.md',
  'docs/README.md',
  'docs/plan',
  'docs/media/design',
  'docs/media/interior',
  'docs/media/look',
  'docs/media/motion',
  'scripts/dashboard',
  'test/unit/dashboard.test.mjs',
];

/** What the public tree keeps: the product, its manual and its contract. */
const KEPT = [
  'README.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'SECURITY.md',
  'docs/GUIDE.md',
  'docs/ADAPTERS.md',
  'docs/media/floor.png',
  'docs/media/hero.gif',
  'docs/media/site',
];

test('no blueprint document is in the public tree', () => {
  for (const rel of MOVED) {
    assert.ok(
      !fs.existsSync(path.join(root, rel)),
      `${rel} is in the public repository. It belongs in the private one, at internal/${rel}.`,
    );
  }
});

test('the product, its manual and its contract stay public', () => {
  for (const rel of KEPT) {
    assert.ok(fs.existsSync(path.join(root, rel)), `${rel} has gone missing from the public tree`);
  }
});

test('the adapter contract names no internal document', () => {
  const adapters = fs.readFileSync(path.join(root, 'docs', 'ADAPTERS.md'), 'utf8');
  for (const pattern of [/DEVIATIONS/, /docs\/plan/, /0\d-[A-Z]{3}/, /WP-\d/]) {
    const hit = pattern.exec(adapters);
    assert.equal(
      hit,
      null,
      `docs/ADAPTERS.md names ${hit && hit[0]}, which a reader of the public repository cannot open`,
    );
  }
});

test('CLAUDE.md gives contributor instructions, not the blueprint', () => {
  const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
  for (const pattern of [/docs\/plan/, /00-REQUIREMENTS/, /DEVIATIONS/]) {
    assert.equal(pattern.exec(claude), null, `CLAUDE.md still points at ${pattern}`);
  }
  assert.match(
    claude,
    /planning documents live in a private repository mounted at `internal\/`/,
    'CLAUDE.md no longer tells a maintainer where the planning documents went',
  );
});

test('the private repository is ignored, never committed', () => {
  const gitignore = fs.readFileSync(path.join(root, '.gitignore'), 'utf8');
  assert.match(gitignore, /^\/internal\/$/m, '.gitignore does not exclude /internal/');
  const prettierignore = fs.readFileSync(path.join(root, '.prettierignore'), 'utf8');
  assert.match(prettierignore, /^internal\/$/m, '.prettierignore does not exclude internal/');
});

test('the private repository carries the hub generator and its test', (t) => {
  if (!hasInternal) {
    t.skip(
      'internal/ is not mounted — the private planning repository is absent, ' +
        'so the hub generator and the documents it parses are not here to check',
    );
    return;
  }
  for (const rel of ['scripts/dashboard/build.mjs', 'test/unit/dashboard.test.mjs']) {
    assert.ok(fs.existsSync(path.join(internal, rel)), `internal/${rel} is missing`);
  }
});
