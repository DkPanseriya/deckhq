/**
 * How the CDP driver starts a browser, and what it does when it cannot.
 *
 * `docs/DEVIATIONS.md` §87 promised that the goldens job degrades to a SKIPPED
 * line and exit 0 when the machine cannot give it a browser; §113 is the entry
 * about the run where it did not. The promise has two halves, and both are
 * asserted here without launching anything:
 *
 *   1. a launch failure is *labelled* — `CHROME_UNAVAILABLE` — so the caller
 *      can forgive it without also forgiving a real capture failure;
 *   2. the extra flags a Linux runner needs are added on Linux and **nowhere
 *      else**, because the committed win32 goldens were captured against an
 *      exact argv and a flag added to it is a regeneration.
 *
 * No test here spawns a real Chrome: the ones that would are the goldens gate
 * itself, which is a separate npm script for exactly that reason.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import {
  CHROME_PATH_NAMES,
  CHROME_UNAVAILABLE,
  chromeUnavailable,
  platformLaunchArgs,
  waitForPageTarget,
  withChrome,
} from '../../src/cli/chrome.mjs';

// ------------------------------------------------------------- launch flags

test('a linux launch gets the sandbox and /dev/shm flags a CI runner needs', () => {
  const args = platformLaunchArgs('linux');
  assert.deepEqual(args, ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']);
});

test('no other platform gets them, so the committed goldens stay valid', () => {
  // The win32 goldens were captured against an exact command line. Adding a
  // flag to it on the platform that has a committed set is a regeneration, not
  // a fix, so the guarantee is asserted rather than left to a code reading.
  assert.deepEqual(platformLaunchArgs('win32'), []);
  assert.deepEqual(platformLaunchArgs('darwin'), []);
});

// ------------------------------------------------------- the failure label

test('a launch failure is labelled so a caller can forgive it by kind', () => {
  const err = chromeUnavailable('nope');
  assert.equal(err.code, CHROME_UNAVAILABLE);
  assert.equal(err.message, 'nope');
  assert.ok(err instanceof Error);
});

test('waiting past the budget names the port and carries the label', async () => {
  // Port 1 on loopback: nothing is listening, and nothing is going to be.
  await assert.rejects(
    () => waitForPageTarget(1, 60),
    (err) => {
      assert.equal(err.code, CHROME_UNAVAILABLE);
      assert.match(err.message, /127\.0\.0\.1:1/);
      return true;
    },
  );
});

test('a browser that has already died is reported at once, not at the deadline', async () => {
  const started = Date.now();
  await assert.rejects(
    // A 60 s budget that must not be waited out: the process is gone, and
    // spending the whole timeout to say so is what turned a missing browser
    // into a job the runner killed.
    () => waitForPageTarget(1, 60_000, () => 'exited with 127'),
    (err) => {
      assert.equal(err.code, CHROME_UNAVAILABLE);
      assert.match(err.message, /exited with 127/);
      return true;
    },
  );
  assert.ok(Date.now() - started < 5_000, 'a dead browser was waited out rather than reported');
});

test('a browser that is not there at all ends as CHROME_UNAVAILABLE, not a stack trace', async () => {
  const missing = path.join(path.sep, 'nonexistent-deckhq', 'not-a-browser');
  await assert.rejects(
    () =>
      withChrome({ chromePath: missing, width: 100, height: 100, attempts: 1 }, async () => {
        throw new Error('the callback must never run');
      }),
    (err) => {
      assert.equal(err.code, CHROME_UNAVAILABLE);
      assert.match(err.message, /could not be started in 1 attempt/);
      return true;
    },
  );
});

// -------------------------------------------------------------- finding one

test('the PATH pass looks for the names a runner image actually installs', () => {
  // CHROME_BIN is the variable CI images and Puppeteer set; the bare names are
  // what an apt or snap install of Chrome or Chromium leaves on PATH.
  for (const name of ['google-chrome', 'chromium-browser']) {
    assert.ok(CHROME_PATH_NAMES.includes(name), `${name} is not looked for`);
  }
});

test('CHROME_BIN is honoured beside CHROME_PATH', async () => {
  // Read at import time, so this needs its own module instance. Each test file
  // is its own process under `node --test`, but the module is already loaded
  // above, hence the cache-busting query.
  process.env.CHROME_BIN = path.join(path.sep, 'opt', 'chrome-from-the-runner');
  const fresh = await import(`../../src/cli/chrome.mjs?chrome-bin=${Date.now()}`);
  delete process.env.CHROME_BIN;
  assert.ok(
    fresh.CHROME_CANDIDATES.includes(path.join(path.sep, 'opt', 'chrome-from-the-runner')),
    'CHROME_BIN is not among the candidates',
  );
});
