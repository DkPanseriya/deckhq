/**
 * The first-run pin offer — WP-75.
 *
 * `deckhq app` opens a window. On the run where that window is the first one
 * this machine has ever had, and only then, it asks one question:
 *
 *     Put DeckHQ on your Desktop and Start Menu? [y/N]
 *
 * WHY IT IS HERE AT ALL. The friction this package exists to delete is the
 * list of steps a person has to be told: install Node, install the package,
 * run `deckhq app`, then run `deckhq shortcut --install --yes`. The last of
 * those is the one nobody discovers on their own, and it is the one that turns
 * a command into an icon — after which there is no command at all. A product
 * whose job is to let you stop watching (`docs/plan/08-PLAN-V2-100X.md` §1.2)
 * cannot require a second command to become reachable.
 *
 * THE CONSENT DISCIPLINE IS NOT RELAXED, and this is the part to read before
 * changing anything here:
 *
 *   - The question is asked **after** the window is open, so the user has seen
 *     what they are being offered a shortcut to.
 *   - The full path list `deckhq shortcut --install` prints is printed first,
 *     unchanged, by the same function. Nothing is written before the user has
 *     seen every path.
 *   - `y` is the consent. It is exactly as strong as `--yes`, because it is
 *     the same answer to the same printed list; `src/cli/shortcut.mjs` takes
 *     it through `deps.confirm` rather than by passing `--yes` behind the
 *     user's back, so there is one place where a plan turns into files.
 *   - Anything else writes nothing and **never asks again**: the answer is
 *     recorded as `app.pinOffered` in `<state dir>/installed.json`.
 *   - Off a TTY there is no question. There is one line naming the command,
 *     because a prompt nobody can answer is a prompt that hangs a login
 *     script, and because an unanswered question must not be recorded as
 *     answered.
 *
 * Nothing here spawns anything off a TTY — in particular it does not build the
 * Windows plan, which asks PowerShell for the real Desktop folder. A machine
 * that is not being asked a question pays nothing for the offer existing.
 */
import process from 'node:process';

import { DATA_DIR } from '../core/paths.mjs';
import { readAppFlags, recordedPaths, writeAppFlags } from '../core/launcher-apply.mjs';
// WP-92i. The question, the flag, the two lines and the consent primitives all
// live in `offers.mjs` now — the module `app`, `pin` and `shortcut` share, so
// that none of the three has to import another to know what the offer says.
// The wording is unchanged; `cli-graph.test.mjs` holds it there.
import { PIN_DECLINED, PIN_FLAG, PIN_HINT, PIN_QUESTION, askLine, isYes } from './offers.mjs';

/**
 * Should this run ask?
 *
 * Pure, so every branch is asserted rather than reasoned about.
 *
 *   `--no-pin`            never.
 *   `--pin`               always, even if the question was answered before —
 *                         it is the user asking for the question.
 *   a recorded shortcut   no: they already have one.
 *   `app.pinOffered`      no: they have already answered.
 *   otherwise             yes.
 *
 * @param {{argv?:string[], installed?:boolean, offered?:boolean}} opts
 * @returns {boolean}
 */
export function shouldOfferPin(opts = {}) {
  const argv = opts.argv || [];
  if (argv.includes('--no-pin')) return false;
  if (argv.includes('--pin')) return true;
  if (opts.installed) return false;
  if (opts.offered) return false;
  return true;
}

/**
 * Make the offer, once.
 *
 * @param {string[]} argv the `deckhq app` argv, for `--pin` / `--no-pin`
 * @param {{write?:(s:string)=>void, error?:(s:string)=>void, dataDir?:string,
 *          tty?:boolean, ask?:(q:string)=>Promise<string>,
 *          install?:(confirm:(plan:any)=>Promise<boolean>) => Promise<number>,
 *          flags?:Record<string, any>,
 *          record?:(patch:Record<string, any>) => void,
 *          installedPaths?:string[], now?:number}} [deps]
 * @returns {Promise<{asked:boolean, answered:boolean, installed:boolean,
 *                    hinted:boolean}>}
 */
export async function offerPin(argv = [], deps = {}) {
  const write = deps.write || ((s) => process.stdout.write(s));
  const dataDir = deps.dataDir || DATA_DIR;
  const quiet = { asked: false, answered: false, installed: false, hinted: false };

  let installedPaths = deps.installedPaths;
  let flags = deps.flags;
  try {
    if (!installedPaths) installedPaths = recordedPaths('shortcut', dataDir);
    if (!flags) flags = readAppFlags(dataDir);
  } catch {
    // An unreadable record costs the offer and nothing else. It must never
    // cost the window that has already opened.
    return quiet;
  }

  if (
    !shouldOfferPin({
      argv,
      installed: (installedPaths || []).length > 0,
      offered: Boolean(flags?.[PIN_FLAG]),
    })
  ) {
    return quiet;
  }

  const tty = deps.tty ?? Boolean(process.stdin.isTTY && process.stdout.isTTY);
  if (!tty) {
    // No question, and nothing recorded: an offer nobody could answer has not
    // been made, so the next interactive run still owes it.
    write(PIN_HINT);
    return { ...quiet, hinted: true };
  }

  const ask = deps.ask || ((q) => askLine(q, {}));
  const record = deps.record || ((patch) => writeAppFlags(patch, { dataDir }));

  let answer = '';
  let installed = false;
  // The printed path list and the write are `deckhq shortcut --install`'s own,
  // called with the answer as its consent. One implementation of the
  // discipline, not two.
  const confirm = async () => {
    answer = await ask(`\n  ${PIN_QUESTION}`);
    return isYes(answer);
  };

  const install =
    deps.install ||
    (async (fn) => {
      const { runShortcut } = await import('./shortcut.mjs');
      return runShortcut(['--install'], { write, error: deps.error, dataDir, confirm: fn });
    });

  try {
    await install(confirm);
    installed = isYes(answer);
  } catch (err) {
    write(`\n  The shortcut could not be written: ${err?.message || err}\n\n`);
  }

  try {
    record({ [PIN_FLAG]: { at: deps.now ?? Date.now(), answer: isYes(answer) ? 'yes' : 'no' } });
  } catch {
    // A state directory that cannot be written is a machine that will be
    // asked again. That is the right failure: it never writes anything the
    // user did not just agree to.
  }

  if (!installed) write(PIN_DECLINED);

  return { asked: true, answered: true, installed, hinted: false };
}

export default offerPin;
