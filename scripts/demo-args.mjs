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

export const argv = process.argv.slice(2);
export const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] !== undefined ? argv[i + 1] : fallback;
};
export const PORT = Number(opt('--port', 4499));
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
export const CLAUDE_DIR = path.join(ROOT, 'claude');
export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
export const STATE_DIR = path.join(ROOT, 'state');
export const BIN_DIR = path.join(ROOT, 'bin');

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
