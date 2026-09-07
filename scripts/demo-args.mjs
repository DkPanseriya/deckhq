/**
 * The demo's flags, and the fixture directory they name (WP-22 follow-up).
 *
 * Split out of `demo-floor.mjs` unchanged. Each population, theme, pack and
 * ledger run gets its own fixture root, because this script's first act is to
 * delete its own directory: two demos sharing one would tear down each
 * other's floor. Found by doing it.
 *
 * Nothing here touches the real `~/.claude` or `~/.deckhq` — the whole point
 * of the script is that nothing real ends up in a committed screenshot, and
 * the inverse matters just as much.
 */

import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { CLOCK_ENV, now as clockNow, parseInstant } from '../src/core/clock.mjs';

export const argv = process.argv.slice(2);
export const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
export const PORT = Number(opt('--port', 4499));

/**
 * WP-63. The instant a capture pins the whole machine to.
 *
 * A fixed date, in the past, chosen once and never moved: it is what makes
 * "2d 7h" a property of the fixture rather than of the day somebody ran it.
 * Nothing derives from it being THIS date — it only has to be a real instant
 * far enough from a boundary that no golden sits on the edge of a rounding.
 * `scripts/goldens.mjs` is what passes it; `npm run demo` does not, and gets
 * the real clock exactly as before.
 */
export const DEMO_EPOCH = '2026-09-01T09:00:00Z';

/**
 * `--now <ISO>` pins this run's clock, for the daemon this script starts as
 * well as for the fixture it writes. It is the same override the daemon reads
 * from the environment (`DECKHQ_NOW`), set here so a caller can spell it as a
 * flag; a caller that exported the variable instead needs nothing.
 *
 * Assigned before anything asks the clock for a time, and before `NOW` below,
 * which is the one reading the whole fixture is built from.
 */
const nowFlag = String(opt('--now', '')).trim();
if (nowFlag) process.env[CLOCK_ENV] = nowFlag;

/**
 * The single instant every timestamp in this fixture is seeded relative to.
 *
 * Read ONCE, deliberately. Before WP-63 the fixture called `Date.now()` about
 * a dozen times while it was being written — per transcript, per junior, per
 * ack record, per ledger day — so a slow build seeded its own sessions
 * milliseconds apart and no two runs agreed exactly. One reading makes every
 * age a pure function of the population's own numbers, which is what §87 says
 * a population is and what the goldens have always assumed.
 */
export const NOW = clockNow();

/** True when this run's clock is pinned, so the fixture directory can say so. */
export const NOW_FIXED = parseInstant(process.env[CLOCK_ENV]) !== null;
export const POPULATION = opt('--population', 'demo');
/**
 * WP-30. Which floor theme this demo starts in. It is written into the
 * fixture's `state.json` rather than clicked in the settings sheet, for the
 * same reason `onboarded` is: a capture script must not have to drive the
 * interface to get the floor it wants to photograph.
 */
export const THEME = opt('--theme', 'default');
/**
 * WP-18 / WP-27. Write a synthetic ledger into the fixture's state directory
 * and let the day's card and Wrapped appear.
 *
 * The cards are the only surfaces in this product whose content comes from the
 * ledger rather than from the floor, so photographing them needs a ledger — and
 * a real one is somebody's real work. This builds a week of plausible records
 * against the same fake sessions the floor is already made of, using the
 * documented record shapes, so what the card renders is the real
 * `windowDigest` over real records and only the data is invented.
 *
 * Off by default, and the goldens never use it: with a ledger present the
 * cards would appear over the floor and every capture would depend on the day
 * of the week.
 */
export const LEDGER_FIXTURE = argv.includes('--ledger-fixture');
/**
 * WP-45. A signed asset pack to install into the fixture before the floor
 * comes up, so a demo can be photographed in one of its themes and its
 * settings sheet can be photographed offering them.
 *
 *     node scripts/demo-floor.mjs --pack packs/supporter-sample/supporter-sample-1.0.0.deckhq-pack.json --theme warehouse
 *
 * It goes into the FIXTURE's state directory, never the real one: this script
 * exists so that nothing real ends up in a committed screenshot, and the
 * inverse is just as important — a demo must not install anything into the
 * developer's own `~/.deckhq`.
 */
export const PACK_FILE = opt('--pack', '');

// Each population gets its own fixture directory, so a goldens run cannot
// tear down the floor somebody is looking at in `npm run demo`. A run with the
// synthetic ledger gets its own too, for the same reason and one more: this
// script's first act is to delete its fixture directory, so a card run sharing
// the plain demo's root would take the plain demo's ledger with it — and the
// two floors would then append into one directory. Found by doing it.
export const ROOT = path.join(
  os.tmpdir(),
  (POPULATION === 'demo' ? 'deckhq-demo' : `deckhq-demo-${POPULATION}`) +
    // WP-30. A themed run gets its own fixture directory for the reason the
    // ledger run does: this script's first act is to delete its own directory,
    // so two demos sharing one would tear down each other's floor.
    (THEME !== 'default' ? `-${THEME.replace(/[^a-z0-9]+/g, '-')}` : '') +
    (PACK_FILE ? '-pack' : '') +
    (LEDGER_FIXTURE ? '-ledger' : ''),
);
// WP-63 deliberately does NOT key this directory to the pinned instant, which
// was the obvious next line and is wrong. The project identities are derived
// from these paths and the carpet grain is seeded from those identities
// (`docs/DEVIATIONS.md` §87, the 3 September regeneration), so a path that
// moved with the clock would make the floor's own texture a function of the
// instant — the exact coupling this package exists to cut. Two runs at two
// instants therefore share a fixture root and must not run at the same time,
// which nothing does: the goldens use one epoch for every capture.
export const CLAUDE_DIR = path.join(ROOT, 'claude');
export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
export const STATE_DIR = path.join(ROOT, 'state');
export const BIN_DIR = path.join(ROOT, 'bin');

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
