/**
 * The first-run pin offer — WP-75.
 *
 * One question, asked once, after the window is open, and only on a terminal.
 * What is asserted here is the consent discipline around it rather than the
 * question itself: that the path list is printed before anything is written,
 * that only `y` writes, that a "no" is remembered so the question never comes
 * back, that a machine which already has a shortcut is never asked, and that
 * a run with nobody at the keyboard is neither asked nor recorded as answered.
 *
 * Nothing here spawns PowerShell, writes to a real home, or opens a window:
 * the installer half is injected, and the record is this file's own temp
 * directory.
 */
import '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { PIN_FLAG, PIN_HINT, PIN_QUESTION, isYes, offerPin, shouldOfferPin } =
  await import('../../src/cli/pin.mjs');
const { RECORD_NAME } = await import('../../src/core/launcher.mjs');
const { readAppFlags, readRecord, writeAppFlags, writeRecord } =
  await import('../../src/core/launcher-apply.mjs');

/** A state directory of this test's own. */
function stateDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'deckhq-pin-'));
}

function capture() {
  const io = { stdout: '', stderr: '' };
  io.write = (s) => {
    io.stdout += s;
  };
  io.error = (s) => {
    io.stderr += s;
  };
  return io;
}

// ---------------------------------------------------------------------------
// When it asks at all
// ---------------------------------------------------------------------------

test('the offer is made once, on a machine with no shortcut and no answer yet', () => {
  assert.equal(shouldOfferPin({}), true);
  assert.equal(shouldOfferPin({ installed: true }), false, 'they already have one');
  assert.equal(shouldOfferPin({ offered: true }), false, 'they already answered');
  assert.equal(shouldOfferPin({ argv: ['--no-pin'] }), false);
  assert.equal(
    shouldOfferPin({ argv: ['--no-pin'], installed: false, offered: false }),
    false,
    '--no-pin outranks everything',
  );
  assert.equal(
    shouldOfferPin({ argv: ['--pin'], offered: true, installed: true }),
    true,
    '--pin is the user asking for the question back',
  );
});

test('y and yes are the only answers that mean yes', () => {
  for (const yes of ['y', 'Y', 'yes', 'YES', ' Yes ']) assert.equal(isYes(yes), true, yes);
  for (const no of ['', ' ', 'n', 'N', 'no', 'nope', 'yeah', 'ok', null, undefined]) {
    assert.equal(isYes(no), false, String(no));
  }
});

// ---------------------------------------------------------------------------
// What it does with the answer
// ---------------------------------------------------------------------------

test('a yes installs, through `deckhq shortcut --install` and its printed path list', async () => {
  const dataDir = stateDir();
  const io = capture();
  const asked = [];
  let consented = null;

  const result = await offerPin([], {
    ...io,
    dataDir,
    tty: true,
    ask: async (q) => {
      asked.push(q);
      return 'y';
    },
    install: async (confirm) => {
      io.write('  This would put DeckHQ on this machine by writing 3 file(s):\n');
      consented = await confirm();
      return 0;
    },
  });

  assert.equal(result.installed, true);
  assert.equal(consented, true, 'the answer is what the installer was given as consent');
  assert.equal(asked.length, 1, 'exactly one question');
  assert.match(asked[0], /Put DeckHQ on your Desktop and Start Menu\? \[y\/N\]/);
  assert.ok(
    io.stdout.indexOf('writing 3 file(s)') !== -1,
    'the path list is printed by the installer, before the write',
  );
  assert.equal(readAppFlags(dataDir)[PIN_FLAG].answer, 'yes');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('anything but y writes nothing and is never asked again', async () => {
  const dataDir = stateDir();
  const io = capture();
  let consented = null;

  const first = await offerPin([], {
    ...io,
    dataDir,
    tty: true,
    ask: async () => '',
    install: async (confirm) => {
      consented = await confirm();
      return 0;
    },
  });
  assert.equal(first.asked, true);
  assert.equal(first.installed, false);
  assert.equal(consented, false, 'the installer was told no, so it wrote nothing');
  assert.match(io.stdout, /not asked again/);
  assert.equal(readAppFlags(dataDir)[PIN_FLAG].answer, 'no');

  // And the second run asks nothing at all.
  const io2 = capture();
  const second = await offerPin([], {
    ...io2,
    dataDir,
    tty: true,
    ask: async () => assert.fail('the question was already answered'),
    install: async () => assert.fail('nothing may be installed on a second run'),
  });
  assert.deepEqual(second, { asked: false, answered: false, installed: false, hinted: false });
  assert.equal(io2.stdout, '');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('a machine that already has a shortcut is not asked', async () => {
  const dataDir = stateDir();
  writeRecord('shortcut', [{ path: path.join(dataDir, 'Desktop', 'DeckHQ.lnk'), proof: 'lnk' }], {
    dataDir,
  });
  const io = capture();
  const result = await offerPin([], {
    ...io,
    dataDir,
    tty: true,
    ask: async () => assert.fail('they already have a shortcut'),
    install: async () => assert.fail('they already have a shortcut'),
  });
  assert.equal(result.asked, false);
  assert.equal(io.stdout, '');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('off a terminal there is no question, one line, and nothing recorded', async () => {
  const dataDir = stateDir();
  const io = capture();
  const result = await offerPin([], {
    ...io,
    dataDir,
    tty: false,
    ask: async () => assert.fail('a prompt nobody can answer hangs a login script'),
    install: async () => assert.fail('nothing is installed without an answer'),
  });
  assert.deepEqual(result, { asked: false, answered: false, installed: false, hinted: true });
  assert.equal(io.stdout, PIN_HINT);
  assert.match(io.stdout, /deckhq shortcut --install --yes/);
  assert.deepEqual(readAppFlags(dataDir), {}, 'an unanswered offer is not an answer');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('--pin asks again even after a no, and --no-pin never asks', async () => {
  const dataDir = stateDir();
  writeAppFlags({ [PIN_FLAG]: { at: 1, answer: 'no' } }, { dataDir });

  let asked = 0;
  await offerPin(['--pin'], {
    write() {},
    dataDir,
    tty: true,
    ask: async () => {
      asked++;
      return 'n';
    },
    install: async (confirm) => {
      await confirm();
      return 0;
    },
  });
  assert.equal(asked, 1);

  await offerPin(['--no-pin'], {
    write() {},
    dataDir,
    tty: true,
    ask: async () => assert.fail('--no-pin asked'),
    install: async () => assert.fail('--no-pin installed'),
  });
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

test('the answer and the installed paths live in one file without erasing each other', () => {
  const dataDir = stateDir();

  writeAppFlags({ [PIN_FLAG]: { at: 7, answer: 'yes' } }, { dataDir });
  writeRecord('shortcut', ['/desktop/DeckHQ.lnk'], { dataDir });
  assert.equal(readAppFlags(dataDir)[PIN_FLAG].at, 7, 'installing forgot the answer');

  writeAppFlags({ other: true }, { dataDir });
  assert.deepEqual(
    readRecord(dataDir).entries.map((e) => e.path),
    ['/desktop/DeckHQ.lnk'],
    'answering forgot the install',
  );

  const raw = JSON.parse(fs.readFileSync(path.join(dataDir, RECORD_NAME), 'utf8'));
  assert.equal(raw.version, 1);
  assert.equal(raw.app.other, true);
  assert.equal(raw.app[PIN_FLAG].answer, 'yes');
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('an unreadable record costs the offer and nothing else', async () => {
  const dataDir = stateDir();
  fs.writeFileSync(path.join(dataDir, RECORD_NAME), '{ not json', 'utf8');
  const io = capture();
  // A corrupt record reads as an empty one, so the offer is still made; what
  // must never happen is a throw reaching the caller, which has already opened
  // a window.
  const result = await offerPin([], {
    ...io,
    dataDir,
    tty: false,
  });
  assert.equal(result.hinted, true);
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('the question is the one word for word in the documentation', () => {
  assert.equal(PIN_QUESTION.trim(), 'Put DeckHQ on your Desktop and Start Menu? [y/N]');
});
