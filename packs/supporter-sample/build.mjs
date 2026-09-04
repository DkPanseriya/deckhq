#!/usr/bin/env node
/**
 * Sign the sample Supporter pack. WP-45.
 *
 *     node packs/supporter-sample/build.mjs --key /path/to/deckhq-publisher.key.pem
 *
 * A thin wrapper over `deckhq pack build` so the pack next to it has a build
 * command of its own, and so the one non-obvious argument — where the output
 * goes — has a default that matches what the repository commits.
 *
 * ## What is committed, and what is not
 *
 * `pack.json` is the SOURCE: unsigned, readable, reviewable in a pull request.
 * `supporter-sample-1.0.0.deckhq-pack.json` beside it is the signed artifact —
 * the file a customer would actually be given, and the file
 * `test/integration/pack-acceptance.test.mjs` installs, so the test exercises
 * the same verification path an install does.
 *
 * The PRIVATE key is neither, and never will be. It lives in the owner's
 * password manager; `--key` names a file the owner puts there for one command
 * and takes away again. `test/unit/packs.test.mjs` fails if a `PRIVATE KEY`
 * block ever appears anywhere under `src/`, `packs/`, `bin/` or `public/`.
 *
 * Re-run this whenever `pack.json` changes: the committed artifact and the
 * source must agree, and a test asserts that they do.
 */
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { runPack } from '../../src/cli/pack.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);

const at = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && i < argv.length - 1 ? argv[i + 1] : null;
};

const key = at('--key');
if (!key) {
  process.stderr.write(
    'usage: node packs/supporter-sample/build.mjs --key <deckhq-publisher.key.pem> [--out <file>]\n' +
      '\nThe signing key is not in this repository. It is the owner’s, and it lives in a\n' +
      'password manager — see src/core/publisher-key.mjs.\n',
  );
  process.exitCode = 2;
} else {
  const out = at('--out') || path.join(HERE, 'supporter-sample-1.0.0.deckhq-pack.json');
  process.exitCode = await runPack(['build', HERE, '--key', key, '--out', out]);
}
