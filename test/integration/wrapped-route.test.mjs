/**
 * `GET /api/wrapped` — WP-27's server half, against a real daemon.
 *
 * Two things this asserts that the unit suite cannot:
 *
 *   1. **The numbers on the wire are the numbers in the ledger directory.** A
 *      day file is written by hand, the daemon reads it back through its own
 *      `readAll`, and the response is compared against what the file says.
 *   2. **Nothing the ledger holds reaches the response as a word.** The ledger
 *      holds hashes by design (`docs/DEVIATIONS.md` §100 decision 5) and a card
 *      is a thing people post, so the `PRIVACY:` assertion here is the same one
 *      the ledger's own suite makes, applied to the surface that actually
 *      leaves the machine. The one place names are allowed is the route's
 *      `projects` lookup, and §119.6 is precise about where those come from:
 *      the **live floor**, hashed, never the ledger. That is the invariant
 *      below, stated rather than assumed.
 *
 * The daemon is started against a scratch state directory, so nothing touches
 * the real `~/.deckhq`.
 *
 * **The machine is pinned before `src/` is imported**, exactly as
 * `test/integration/demo-floor.test.mjs` pins it and for the same reason: the
 * registry scans the host, and whether the floor comes back with the
 * developer's own projects on it, or with the actor floor an empty machine
 * gets, decided what this file asserted. §121. That pin is now
 * `test/helpers/isolate.mjs`, which covers the two variables this file left on
 * the host — the desktop-app store and `~/.deckhq` — as well as the three it
 * already set. §123. `node --test` gives every file its own process, so this
 * cannot leak into another suite.
 */
// First, and before anything under `src/`: it moves the machine.
import { HOME as SANDBOX, scratchDir } from '../helpers/isolate.mjs';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const { startDaemon } = await import('../../src/daemon.mjs');
const { dayKey, projectKeyFor } = await import('../../src/core/ledger.mjs');

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A Monday 09:00 local, so `?kind=week` has a full week behind it. */
function mondayAt(ms = Date.now()) {
  const d = new Date(ms);
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday.getTime();
}

async function withDaemon(seed, fn) {
  const dir = scratchDir('wrapped-');
  const publicDir = path.join(dir, 'public');
  const ledgerDir = path.join(dir, 'ledger');
  await fs.mkdir(publicDir);
  await fs.mkdir(ledgerDir);
  await fs.writeFile(path.join(publicDir, 'index.html'), 'floor');
  await seed(ledgerDir);
  const d = await startDaemon({
    port: 0,
    stateFile: path.join(dir, 'state.json'),
    publicDir,
    ledgerDir,
  });
  try {
    await fn(d, ledgerDir);
  } finally {
    await d.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
}

/**
 * The project the ledger fixture is about — a directory, and the word at the
 * end of it.
 *
 * The word has to be one **the daemon cannot produce on its own**. It was
 * `orbital-api`, and `orbital-api` is one of the actor floor's three rooms
 * (`src/core/demo-fixture.mjs`). Every CI runner is a machine with no sessions,
 * an empty scan serves the actors, and the route's live-project lookup then put
 * that exact word in the response — so the `PRIVACY:` assertion below failed on
 * the daemon's own fiction rather than on anything the ledger leaked. The
 * fixture guard in that test is what keeps this from being re-learned. §121.
 */
const LEDGER_PROJECT_NAME = 'wrapped-fixture-only';
const LEDGER_PROJECT_CWD = `/code/${LEDGER_PROJECT_NAME}`;

/** One week of records ending at the Monday the card is about. */
async function seedWeek(ledgerDir) {
  const monday = mondayAt();
  // Local midnight seven days before the Monday the card is about, so
  // "+ 10 hours" is 10:00 and the busiest-hour assertion means what it says.
  const m = new Date(monday);
  const start = new Date(m.getFullYear(), m.getMonth(), m.getDate() - 7).getTime();
  const key = projectKeyFor(LEDGER_PROJECT_CWD);
  /** @type {Map<string, string[]>} */
  const byDay = new Map();
  const push = (t, body) => {
    const day = dayKey(t);
    const list = byDay.get(day) || [];
    list.push(JSON.stringify({ t, machineId: 'x'.repeat(32), projectKey: key, ...body }));
    byDay.set(day, list);
  };
  for (let d = 0; d < 5; d++) {
    const at = start + d * DAY + 10 * HOUR;
    push(at, { sessionId: 's1', kind: 'state', dim: 'activity', from: 'ended', to: 'working' });
    push(at + 20 * MINUTE, {
      sessionId: 's1',
      kind: 'state',
      dim: 'activity',
      from: 'working',
      to: 'for_review',
    });
    push(at + 80 * MINUTE, {
      sessionId: 's1',
      kind: 'state',
      dim: 'activity',
      from: 'for_review',
      to: 'ended',
    });
    push(at + 30 * MINUTE, { sessionId: 's1', kind: 'tokens', delta: 50_000 });
    push(at + 40 * MINUTE, { sessionId: 's1', kind: 'send', chars: 30 });
  }
  for (const [day, lines] of byDay) {
    await fs.writeFile(path.join(ledgerDir, `${day}.jsonl`), lines.join('\n') + '\n', 'utf8');
  }
  return { key, start, monday };
}

test('the week card reports what the day files say', async () => {
  await withDaemon(seedWeek, async (d) => {
    const res = await fetch(`${d.url}api/wrapped?kind=week&at=${mondayAt()}`);
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(body.kind, 'week');
    assert.equal(body.until - body.since, 7 * DAY, 'the window is not a week');
    assert.equal(body.window.turns, 5, 'five turns were written, one a day');
    assert.equal(body.window.discharges, 5);
    assert.equal(body.window.tokens, 250_000);
    assert.equal(body.window.sends, 5);
    assert.equal(body.window.roomCount, 1);
    assert.equal(body.window.busiestHour.hour, 10);
    assert.equal(body.window.longestWait.ms, 60 * MINUTE);
    assert.equal(body.window.longestWait.cleared, true);
    // The comparison window is present and exactly as long.
    assert.equal(body.previous.turns, 0);
    // The rate card version travels with the money, whatever the money is.
    assert.match(body.spend.rateCardVersion, /^\d{4}-\d{2}-\d{2}$/);
    // Nothing on this floor, so nothing can be priced — null, never zero.
    assert.equal(body.spend.estimate, null);
  });
});

test('PRIVACY: nothing the ledger holds reaches the response as a word', async () => {
  await withDaemon(seedWeek, async (d) => {
    const floor = await fetch(`${d.url}api/state`).then((r) => r.json());
    const onTheFloor = floor.projects || [];

    // FIXTURE GUARD, first, because the assertions below are only worth
    // anything if the word being looked for could not have come from the
    // daemon. A floor that already says `wrapped-fixture-only` would make
    // every needle check below pass or fail for the wrong reason.
    for (const p of onTheFloor) {
      assert.notEqual(
        p.name,
        LEDGER_PROJECT_NAME,
        `the floor names a project ${LEDGER_PROJECT_NAME}; pick a fixture name the daemon cannot produce`,
      );
      assert.notEqual(p.cwd, LEDGER_PROJECT_CWD);
    }

    const res = await fetch(`${d.url}api/wrapped?kind=week&at=${mondayAt()}`);
    const text = await res.text();
    for (const needle of [LEDGER_PROJECT_NAME, '/code', 'code\\\\', os.homedir(), SANDBOX]) {
      assert.equal(
        text.includes(needle),
        false,
        `the response leaked ${needle}; the ledger holds hashes for exactly this reason`,
      );
    }
    // What it does carry is the hash, which spells nothing.
    const key = projectKeyFor(LEDGER_PROJECT_CWD);
    assert.ok(text.includes(key));

    // And the invariant §119.6 states, rather than the coincidence that used to
    // stand in for it: every name in the card's `projects` lookup was already
    // on the floor, hashed from a cwd the floor holds. A project the ledger
    // knows and the floor does not — which is what the fixture is — gets no
    // entry at all, and so no name is invented for it.
    const body = JSON.parse(text);
    const fromTheFloor = new Map(
      onTheFloor.filter((p) => p.cwd).map((p) => [projectKeyFor(p.cwd), p.name || p.id]),
    );
    for (const [hash, name] of Object.entries(body.projects)) {
      assert.equal(
        fromTheFloor.get(hash),
        name,
        `${hash} is named ${name} by nothing on the floor`,
      );
    }
    assert.equal(
      Object.hasOwn(body.projects, key),
      false,
      'a project only the ledger knows was given a name',
    );
  });
});

test('the annual card is the year so far, and asks the ledger for it', async () => {
  await withDaemon(seedWeek, async (d) => {
    const res = await fetch(`${d.url}api/wrapped?kind=annual`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.kind, 'annual');
    assert.equal(new Date(body.since).getMonth(), 0);
    assert.equal(new Date(body.since).getDate(), 1);
    assert.match(body.key, /^\d{4}-annual$/);
  });
});

test('an unknown kind is refused rather than silently made a week', async () => {
  await withDaemon(seedWeek, async (d) => {
    const res = await fetch(`${d.url}api/wrapped?kind=fortnight`);
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /week, annual/);
  });
});

test('a non-numeric `at` is refused rather than read as the epoch', async () => {
  await withDaemon(seedWeek, async (d) => {
    const res = await fetch(`${d.url}api/wrapped?kind=week&at=tuesday`);
    assert.equal(res.status, 400);
  });
});

test('an empty ledger produces a card, not an error', async () => {
  await withDaemon(
    async () => {},
    async (d) => {
      const res = await fetch(`${d.url}api/wrapped?kind=week`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.window.turns, 0);
      assert.equal(body.window.rooms.length, 0);
      assert.equal(body.window.longestWait, null);
      assert.equal(body.spend.estimate, null);
    },
  );
});

test('the derived stat never blocks the card', async () => {
  // The phrase count reads transcripts, and the machine running the tests may
  // have any number of them or none. What is asserted is the CONTRACT: the
  // field is always present and always shaped, so the client can decide
  // whether to draw the line without knowing why it is empty.
  await withDaemon(seedWeek, async (d) => {
    const res = await fetch(`${d.url}api/wrapped?kind=week`);
    const body = await res.json();
    assert.equal(typeof body.catchphrase, 'object');
    assert.equal(typeof body.catchphrase.supported, 'boolean');
    assert.equal(typeof body.catchphrase.count, 'number');
    assert.ok(body.catchphrase.count >= 0);
  });
});

test('GET /api/stats carries the window the postcard reads', async () => {
  // WP-18 asks `/api/stats?since=<local midnight>` and reads `window`. Its
  // presence and its bounds are the contract between the two packages.
  await withDaemon(seedWeek, async (d) => {
    const since = mondayAt() - 3 * DAY;
    const res = await fetch(`${d.url}api/stats?since=${since}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.window.since, since);
    assert.ok(body.window.until >= since);
    assert.ok(Array.isArray(body.window.rooms));
    // The rest of the body is untouched by this package.
    assert.ok(body.forReview);
    assert.ok(body.records);
  });
});
