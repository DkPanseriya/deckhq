/**
 * SECURITY: THE WINDOWS APP'S BUILD RUNS THE RELEASE GATES `npm publish` RUNS.
 *
 * The app's folder is "exactly what `npm pack` would publish", and `npm pack`
 * never runs `prepublishOnly`. So a gate that only lived there (a pinned test
 * key, on a branch that has one) was skipped by every installer build. The
 * build runs each gate the repository has and stops on the first refusal; a
 * test build may skip them only by saying so, and says so in its log.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RELEASE_GATES, runReleaseGates } from '../../app/windows/build.mjs';

/** A repository folder holding the gates named, and nothing else. */
function repoWith(/** @type {string[]} */ gates) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-gates-'));
  for (const rel of gates) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), '// a gate\n');
  }
  return dir;
}

test('the release key check is a gate', () => {
  assert.ok(RELEASE_GATES.includes('scripts/check-release-keys.mjs'));
});

test('a repository with no gates has nothing to run', () => {
  const repo = repoWith([]);
  const ran = [];
  runReleaseGates({ repo, log: () => {}, run: (f) => ran.push(f) });
  assert.deepEqual(ran, []);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('every gate the repository has is run, and the first refusal stops the build', () => {
  const repo = repoWith(RELEASE_GATES);
  const ran = [];
  runReleaseGates({ repo, log: () => {}, run: (f) => ran.push(path.relative(repo, f)) });
  assert.deepEqual(
    ran.map((f) => f.replace(/\\/g, '/')),
    [...RELEASE_GATES],
  );
  assert.throws(
    () =>
      runReleaseGates({
        repo,
        log: () => {},
        run: () => {
          throw new Error('exit 1');
        },
      }),
    /refused this build/,
  );
  fs.rmSync(repo, { recursive: true, force: true });
});

test('a test build may skip a gate only by saying so, loudly', () => {
  const repo = repoWith(RELEASE_GATES);
  const lines = [];
  const ran = [];
  runReleaseGates({ repo, testKeys: true, log: (l) => lines.push(l), run: (f) => ran.push(f) });
  assert.deepEqual(ran, []);
  assert.ok(lines.some((l) => /NOT run/.test(l) && /never publish/.test(l)));
  fs.rmSync(repo, { recursive: true, force: true });
});
