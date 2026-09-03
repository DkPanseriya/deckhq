/**
 * WP-15's office-cleared moment.
 *
 * Two rules decide whether it fires, and both exist to stop the product's one
 * celebration becoming noise:
 *
 *   1. It fires **once per clearing** — the transition from "somebody is
 *      waiting" to "nobody is", not every snapshot in which nobody is.
 *   2. It fires **only after the office has been busy for sixty seconds**
 *      (`docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md` §2, borrowed from
 *      Munder Difflin): a two-second turn does not earn a cheer.
 *
 * Both are asserted here against an injected clock rather than a real one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MIN_BUSY_MS,
  clearedLine,
  createClearedTracker,
  waitingAgents,
} from '../../public/office-cleared.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const MINUTE = 60_000;
const HOUR = 3_600_000;

/** A snapshot with `n` agents waiting on you, each since `since`. */
function floor(ids, since = null) {
  return {
    agents: ids.map((id) => ({
      id,
      ackState: 'active',
      activityState: 'for_review',
      reviewSince: since,
    })),
  };
}

// ------------------------------------------------------------ the queue

test('waiting means what the header numeral means, and nothing else', () => {
  const snap = {
    agents: [
      { id: 'a', ackState: 'active', activityState: 'for_review' },
      { id: 'b', ackState: 'active', activityState: 'needs_input' },
      { id: 'c', ackState: 'active', activityState: 'stalled' },
      { id: 'd', ackState: 'active', activityState: 'working' },
      // Benched and let-go are the user's own decisions; they are not owed.
      { id: 'e', ackState: 'benched', activityState: 'for_review' },
      { id: 'f', ackState: 'let_go', activityState: 'for_review' },
    ],
  };
  assert.deepEqual(
    waitingAgents(snap).map((a) => a.id),
    ['a', 'b', 'c'],
  );
});

// ------------------------------------------------------------- the rule

test('the first snapshot only establishes a baseline', () => {
  // A tab opened onto an already-empty floor must not count the page load as
  // a clearing, and one opened onto a busy floor must not date "busy since"
  // to the page load.
  const t = createClearedTracker();
  assert.equal(t.update(floor([]), 0).fire, false);
  assert.equal(t.counters().busySince, null);

  const t2 = createClearedTracker();
  t2.update(floor(['a']), 1000);
  assert.equal(t2.counters().busySince, 1000);
});

test('it fires once, on the clearing, and never again while the floor stays empty', () => {
  const t = createClearedTracker();
  let now = 0;
  t.update(floor([]), now); // baseline
  now += 1000;
  t.update(floor(['a', 'b']), now); // the office fills
  now += 2 * MINUTE;
  t.update(floor(['a']), now); // one discharged
  now += 1000;

  const cleared = t.update(floor([]), now);
  assert.equal(cleared.fire, true);
  assert.equal(cleared.discharged, 2);

  // Every subsequent empty snapshot is silence.
  for (let i = 0; i < 5; i++) {
    now += 1000;
    assert.equal(t.update(floor([]), now).fire, false, 'the moment fired twice for one clearing');
  }
});

test('a two-second turn does not earn a cheer', () => {
  // §2's Munder Difflin rule. This is the whole reason the moment is worth
  // having: it marks a real milestone, so it must not fire for a session that
  // appeared and was discharged in the same breath.
  const t = createClearedTracker();
  t.update(floor([]), 0);
  t.update(floor(['a']), 1000);
  const quick = t.update(floor([]), 1000 + 2000);
  assert.equal(quick.fire, false, 'a two-second wait produced a celebration');
  // The discharge is still counted — it happened — it just did not celebrate.
  assert.equal(quick.discharged, 1);
});

test('the sixtieth second is the boundary, exactly', () => {
  const just = createClearedTracker();
  just.update(floor([]), 0);
  just.update(floor(['a']), 1000);
  assert.equal(just.update(floor([]), 1000 + MIN_BUSY_MS - 1).fire, false);

  const enough = createClearedTracker();
  enough.update(floor([]), 0);
  enough.update(floor(['a']), 1000);
  assert.equal(enough.update(floor([]), 1000 + MIN_BUSY_MS).fire, true);
  assert.equal(MIN_BUSY_MS, 60_000, '§2 says at least sixty seconds');
});

test('the busy clock restarts when the office refills, and does not carry over', () => {
  const t = createClearedTracker();
  let now = 0;
  t.update(floor([]), now);

  // A long, quiet stretch that earns a moment.
  now += 1000;
  t.update(floor(['a']), now);
  now += 5 * MINUTE;
  assert.equal(t.update(floor([]), now).fire, true);

  // Then a two-second one, which must not inherit the first one's credit.
  now += 30_000;
  t.update(floor(['b']), now);
  now += 2000;
  assert.equal(t.update(floor([]), now).fire, false, 'the busy clock carried over');
});

// --------------------------------------------------------- the counters

test('the line counts the day, not the clearing, and reports the longest wait', () => {
  const t = createClearedTracker();
  const base = new Date('2026-09-04T09:00:00').getTime();
  t.update(floor([]), base);

  // Two agents, one waiting 26 hours and one four.
  t.update(
    {
      agents: [
        { id: 'a', ackState: 'active', activityState: 'for_review', reviewSince: base - 26 * HOUR },
        { id: 'b', ackState: 'active', activityState: 'for_review', reviewSince: base - 4 * HOUR },
      ],
    },
    base + 1000,
  );
  const out = t.update(floor([]), base + 2 * MINUTE);
  assert.equal(out.fire, true);
  assert.equal(out.discharged, 2);
  assert.equal(out.line, 'Office clear. 2 discharged today, longest wait 1d 2h.');
});

test('the counters reset at local midnight, and the queue does not', () => {
  const t = createClearedTracker();
  const day1 = new Date('2026-09-04T22:00:00').getTime();
  t.update(floor([]), day1);
  t.update(floor(['a']), day1 + 1000);
  assert.equal(t.update(floor([]), day1 + 2 * MINUTE).discharged, 1);

  const day2 = new Date('2026-09-05T09:00:00').getTime();
  // An agent that has been waiting since yesterday is still waiting.
  t.update(floor(['b'], day1), day2);
  const out = t.update(floor([]), day2 + 2 * MINUTE);
  assert.equal(out.fire, true);
  assert.equal(out.discharged, 1, "yesterday's discharges leaked into today");
  // And its wait is measured from when it actually started, not from midnight.
  assert.ok(out.longestWaitMs > 10 * HOUR, 'the overnight wait was reset with the counter');
});

test('an agent that arrives and leaves without a clock of its own is still timed', () => {
  const t = createClearedTracker();
  t.update(floor([]), 0);
  t.update(floor(['a'], null), 1000); // no reviewSince — a stalled session
  const out = t.update(floor([]), 1000 + 5 * MINUTE);
  assert.equal(out.fire, true);
  // Timed from when this tab first saw it waiting, which is the honest answer.
  assert.equal(out.longestWaitMs, 5 * MINUTE);
});

// -------------------------------------------------------------- the copy

test('the line reads at one, at many, and with no measurable wait', () => {
  // The spec's example is `longest wait 26h`; the product says `1d 2h`
  // everywhere else a wait is shown — the floor's own badges, the office
  // plate, the snapshot strip — and one register beats one example.
  // `docs/DEVIATIONS.md` §98.
  assert.equal(
    clearedLine({ discharged: 7, longestWaitMs: 26 * HOUR }),
    'Office clear. 7 discharged today, longest wait 1d 2h.',
  );
  assert.equal(
    clearedLine({ discharged: 1, longestWaitMs: 4 * HOUR }),
    'Office clear. 1 discharged today, longest wait 4h.',
  );
  // A clearing so quick the wait is unmeasurable drops the clause rather
  // than printing "longest wait just now".
  assert.equal(
    clearedLine({ discharged: 3, longestWaitMs: 0 }),
    'Office clear. 3 discharged today.',
  );
});

test('the celebration never scores the human', () => {
  // docs/plan/04-ENGAGEMENT-AND-GAMIFICATION.md §1 and §5. The line records
  // the TEAM's work. There is no version of it that says what you failed to
  // do, no streak, no level, and no second person at all.
  for (const n of [0, 1, 7, 40]) {
    for (const wait of [0, 5 * MINUTE, 26 * HOUR]) {
      const line = clearedLine({ discharged: n, longestWaitMs: wait });
      for (const forbidden of [
        /\byou\b/i,
        /\byour\b/i,
        /streak/i,
        /\blevel\b/i,
        /\bxp\b/i,
        /badge/i,
        /well done/i,
        /finally/i,
      ]) {
        assert.doesNotMatch(line, forbidden, `"${line}" scores or addresses the human`);
      }
    }
  }
});

// ------------------------------------------------------------ the motion

test('reduced motion drops the light and keeps the line', () => {
  // WP-15's acceptance, asserted where the rule actually lives: `app.js`
  // checks the preference before adding the class that runs the warm, and
  // the line is written before that check. A behavioural test needs a
  // browser; this at least fails if the order is reversed.
  const app = fs.readFileSync(path.join(ROOT, 'public', 'app.js'), 'utf8');
  const fn = app.slice(app.indexOf('function celebrateOfficeCleared'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  const lineAt = body.indexOf('officeCleared.hidden = false');
  const guardAt = body.indexOf('if (prefersReducedMotion()) return');
  const lightAt = body.indexOf("stage.classList.add('is-cleared')");
  assert.ok(lineAt > -1 && guardAt > -1 && lightAt > -1, 'the celebration changed shape');
  assert.ok(lineAt < guardAt, 'the line is written after the reduced-motion guard returns');
  assert.ok(guardAt < lightAt, 'the light is added before the reduced-motion guard');
});

test('the warm is a stage overlay, not a change in the renderer', () => {
  // §9 and this package's boundary: public/render/** belongs to another
  // engineer, and the light is chrome about the floor rather than part of it.
  const css = fs.readFileSync(path.join(ROOT, 'public', 'style.css'), 'utf8');
  assert.match(css, /\.stage\.is-cleared::after/);
  assert.match(css, /@keyframes office-cleared-light/);
  // 6% at the top of the warm, per §9.
  const frames = css.slice(css.indexOf('@keyframes office-cleared-light'));
  assert.match(frames.slice(0, 300), /opacity:\s*0\.06/);
});
